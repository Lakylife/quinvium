// Převod bloků, transakcí a účtenek do formátu JSON-RPC, který znají Ethereum nástroje.
import { RLP } from '@ethereumjs/rlp';
import { Address, generateAddress } from '@ethereumjs/util';
import { bytesToInt, quantity, toHex } from '../util/bytes.js';

export function txToRpc(tx, location) {
  const out = {
    hash: toHex(tx.hash()), nonce: quantity(tx.nonce), from: tx.getSenderAddress().toString(),
    to: tx.to ? tx.to.toString() : null, value: quantity(tx.value), gas: quantity(tx.gasLimit), input: toHex(tx.data),
    type: quantity(tx.type), chainId: quantity(tx.common.chainId()), v: quantity(tx.v), r: quantity(tx.r), s: quantity(tx.s),
    blockHash: location?.blockHash ?? null, blockNumber: location ? quantity(location.number) : null,
    transactionIndex: location ? quantity(location.index) : null,
  };
  if (tx.type === 2) {
    out.maxFeePerGas = quantity(tx.maxFeePerGas);
    out.maxPriorityFeePerGas = quantity(tx.maxPriorityFeePerGas);
    out.gasPrice = location?.baseFee !== undefined ? quantity(effectivePrice(tx, location.baseFee)) : quantity(tx.maxFeePerGas);
    out.accessList = [];
  } else {
    out.gasPrice = quantity(tx.gasPrice);
  }
  return out;
}

export function effectivePrice(tx, baseFee) {
  if (tx.type !== 2) return tx.gasPrice;
  const withTip = baseFee + tx.maxPriorityFeePerGas;
  return withTip < tx.maxFeePerGas ? withTip : tx.maxFeePerGas;
}

export function decodeReceipt(encoded) {
  const typed = encoded[0] < 0x80;
  const body = typed ? encoded.subarray(1) : encoded;
  const [status, cumulative, bloom, logs] = RLP.decode(body);
  return { status: status.length ? 1 : 0, cumulative: bytesToInt(cumulative), bloom, logs };
}

/** Rozbalí účtenky bloku do seznamu s gasem a indexy logů. */
export function blockReceipts(block, encoded) {
  let previous = 0n;
  let logIndex = 0;
  return block.txs.map((tx, i) => {
    const r = decodeReceipt(encoded[i]);
    const gasUsed = r.cumulative - previous;
    previous = r.cumulative;
    const logs = r.logs.map((l) => ({
      address: new Address(l[0]).toString(), topics: l[1].map((t) => toHex(t)), data: toHex(l[2]),
      logIndex: logIndex++, transactionIndex: i, transactionHash: toHex(tx.hash()),
      blockNumber: block.header.number, blockHash: toHex(block.hash()), removed: false,
    }));
    return { tx, index: i, status: r.status, gasUsed, cumulative: r.cumulative, bloom: r.bloom, logs };
  });
}

export const logToRpc = (l) => ({
  ...l, logIndex: quantity(l.logIndex), transactionIndex: quantity(l.transactionIndex), blockNumber: quantity(l.blockNumber),
});

export function receiptToRpc(r, block) {
  const { tx } = r;
  const from = tx.getSenderAddress();
  const contract = tx.to ? null : new Address(generateAddress(from.bytes, intNonce(tx.nonce))).toString();
  return {
    transactionHash: toHex(tx.hash()), transactionIndex: quantity(r.index), blockHash: toHex(block.hash()),
    blockNumber: quantity(block.header.number), from: from.toString(), to: tx.to ? tx.to.toString() : null,
    cumulativeGasUsed: quantity(r.cumulative), gasUsed: quantity(r.gasUsed), contractAddress: contract,
    logs: r.logs.map(logToRpc), logsBloom: toHex(r.bloom), status: quantity(r.status), type: quantity(tx.type),
    effectiveGasPrice: quantity(effectivePrice(tx, block.header.baseFee)),
  };
}

function intNonce(n) {
  if (n === 0n) return new Uint8Array(0);
  let h = n.toString(16);
  if (h.length % 2) h = `0${h}`;
  return new Uint8Array(Buffer.from(h, 'hex'));
}

export function blockToRpc(block, full, td) {
  const h = block.header;
  const size = block.encode().length;
  const hash = toHex(block.hash());
  const transactions = block.txs.map((tx, i) => (full
    ? txToRpc(tx, { blockHash: hash, number: h.number, index: i, baseFee: h.baseFee })
    : toHex(tx.hash())));
  return h.toRpc({ size: quantity(size), totalDifficulty: quantity(td ?? 0n), transactions });
}

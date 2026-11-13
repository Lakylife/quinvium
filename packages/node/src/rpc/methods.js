// Metody JSON-RPC. Sada eth_* odpovídá Ethereu, takže fungují běžné peněženky a nástroje.
import { RLP } from '@ethereumjs/rlp';
import { getMerkleStateProof } from '@ethereumjs/statemanager';
import { Address, createAddressFromString } from '@ethereumjs/util';
import { randomBytes } from 'node:crypto';
import { CONSENSUS as C } from '../params.js';
import { emitted, nextBaseFee, blockReward } from '../core/economics.js';
import { FEE_WINDOW, estimateFees } from '../core/fees.js';
import { decodeTx } from '../core/types.js';
import { MempoolError } from '../core/mempool.js';
import { fromHex, keccak, quantity, toHex } from '../util/bytes.js';
import { blockReceipts, blockToRpc, effectivePrice, logToRpc, receiptToRpc, txToRpc } from './format.js';
import { RpcCallError, estimateGas, ethCall } from './call.js';
import { VmBusyError } from './vm-pool.js';

export class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const MAX_LOG_RANGE = 10000n;
const FILTER_TTL = 300_000;
const MAX_FILTERS = 1024;
const MAX_PROOF_SLOTS = 1024;
const hexAddress = (a) => {
  if (typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw new RpcError(-32602, 'neplatná adresa');
  return createAddressFromString(a);
};
const hexHash = (h) => {
  if (typeof h !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(h)) throw new RpcError(-32602, 'neplatný hash');
  return fromHex(h);
};
const pad32 = (bytes) => {
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
};

const MAX_PAGE = 100;
const HASHRATE_QUIET_S = 180n;       // 12 cílových časů bloku: u běžící těžby taková pauza prakticky nenastane
const MAX_OFFSET = 1_000_000;
const MAX_CHART_POINTS = 600;
const TX_KINDS = { transfer: 0, call: 1, create: 2 };
const MAX_SUMMED = 2000;
const MAX_PAID_SUMS = 1024;
const MAX_HOLDER_SCAN = 500;
const HOLDER_SCAN_MS = 2000;
const MAX_LOG_PAGE = 500;
const MAX_SHARE_ROWS = 2000;
const REVERTED = 3;      // kód chyby JSON-RPC pro zamítnuté volání
const TOP_HOLDERS = 25;
const paidSums = new Map();
const PAID_TOPIC = keccak(new TextEncoder().encode('Paid(address,uint256)'));
const TRANSFER_TOPIC = keccak(new TextEncoder().encode('Transfer(address,address,uint256)'));
const SHARE_TOPIC = keccak(new TextEncoder().encode('ShareAccepted(address,uint256,uint256,uint256)'));
const POOL_CREATED_TOPIC = keccak(new TextEncoder().encode('PoolCreated(address,address,string,uint256,uint256,uint256)'));
const POOL_FACTORY = fromHex('0xae0000000000000000000000000000000000000c');
const POOL_WINDOW_BLOCKS = 5760;   // bez zadání den zpátky
const MAX_POOLS = 10_000;           // seznam poolů z továrny, víc jich žebříček nečte
const MAX_MINED_ROWS = 20_000;      // bloků na souhrn odměn po dnech
const DAY_S = 86_400;
const MAX_TX_ERRORS = 512;          // přehrané neúspěšné transakce v paměti
const POOL_PERIOD_S = 86_400;       // žebříček poolů bez zadání podle posledních 24 hodin
const URL_CALL = toHex(keccak(new TextEncoder().encode('url()')).subarray(0, 4));
/** Řetězec z dat ABI: na pozici `slot` je posun, na něm délka a pak bajty textu. */
const abiText = (hex, slot = 0) => {
  const data = fromHex(hex);
  const offset = Number(BigInt(toHex(data.subarray(slot * 32, slot * 32 + 32))));
  const length = Number(BigInt(toHex(data.subarray(offset, offset + 32))));
  return new TextDecoder().decode(data.subarray(offset + 32, offset + 32 + length));
};
const abiWord = (hex, slot) => BigInt(toHex(fromHex(hex).subarray(slot * 32, slot * 32 + 32)));
const HASHRATE_BLOCKS = 240n;
const HASHRATE_WINDOW_S = 900n;
const MIN_CHART_BUCKET_S = 60;    // kratší úsek má jen pár bloků a výkon by z něj byl jen náhodný šum

/** Metody, které rozdávají a přijímají práci. Na veřejném uzlu je vypíná volba --no-mining-rpc. */
export const MINING_METHODS = ['eth_getWork', 'aether_getWork', 'eth_submitWork', 'aether_submitWork', 'eth_submitHashrate'];

export function createMethods(node) {
  const { chain, mempool, network, work, version, vm } = node;
  const receiptsCache = new Map();
  const filters = new Map();
  const tokenCache = new Map();

  const resolve = (tag = 'latest') => {
    if (typeof tag === 'object' && tag !== null) {
      if (tag.blockHash) {
        const h = chain.getHeader(hexHash(tag.blockHash));
        if (!h) throw new RpcError(-32001, 'blok nenalezen');
        return h;
      }
      return resolve(tag.blockNumber);
    }
    const head = chain.head;
    switch (tag) {
      case 'latest': case 'pending': return head;
      case 'earliest': return chain.genesis;
      case 'safe': return chain.getHeaderByNumber(head.number > 32n ? head.number - 32n : 0n);
      case 'finalized': return chain.getHeaderByNumber(head.number > BigInt(C.maxReorgDepth) ? head.number - BigInt(C.maxReorgDepth) : 0n);
      default: {
        let n;
        try { n = BigInt(tag); } catch { throw new RpcError(-32602, 'neplatné číslo bloku'); }
        const h = chain.getHeaderByNumber(n);
        if (!h) throw new RpcError(-32001, 'blok nenalezen');
        return h;
      }
    }
  };

  const fullReceipts = (block) => {
    const key = toHex(block.hash());
    let r = receiptsCache.get(key);
    if (!r) {
      r = blockReceipts(block, chain.getReceipts(block.hash()).receipts);
      receiptsCache.set(key, r);
      if (receiptsCache.size > 256) receiptsCache.delete(receiptsCache.keys().next().value);
    }
    return r;
  };

  const state = (header) => chain.stateAt(header.stateRoot);
  const pendingNonce = (address, stateNonce) => {
    const list = mempool.bySender.get(address.toString());
    let n = stateNonce;
    while (list?.has(n)) n += 1n;
    return n;
  };

  const blockByRpc = (header, full) => (header ? blockToRpc(chain.getBlock(header.hash()), full, chain.getTd(header.hash())) : null);

  const locateTx = (hash) => {
    const loc = chain.store.txLocation(hash);
    if (!loc) return null;
    const block = chain.getBlockByNumber(loc.number);
    return { block, tx: block.txs[loc.index], index: loc.index };
  };

  const collectLogs = (f) => {
    const from = f.blockHash ? chain.getHeader(hexHash(f.blockHash))?.number : resolve(f.fromBlock ?? 'latest').number;
    const to = f.blockHash ? from : resolve(f.toBlock ?? 'latest').number;
    if (from === undefined || from === null) throw new RpcError(-32001, 'blok nenalezen');
    if (to - from > MAX_LOG_RANGE) throw new RpcError(-32005, `rozsah může mít nejvýše ${MAX_LOG_RANGE} bloků`);
    const addresses = f.address ? [f.address].flat().map((a) => hexAddress(a).bytes) : undefined;
    const topics = f.topics?.map((t) => (t == null ? null : Array.isArray(t) ? t.map(fromHex) : fromHex(t)));
    let rows;
    try {
      rows = chain.store.queryLogs({ fromBlock: from, toBlock: to, addresses, topics });
    } catch (e) {
      throw new RpcError(-32005, e.message);
    }
    const out = [];
    let current = null;
    for (const row of rows) {
      if (!current || current.number !== row.number) {
        current = { number: row.number, receipts: fullReceipts(chain.getBlockByNumber(row.number)) };
      }
      const log = current.receipts[row.tx_idx].logs.find((l) => l.logIndex === row.log_idx);
      if (log) out.push(logToRpc(log));
    }
    return out;
  };

  const newFilter = (kind, data) => {
    if (filters.size >= MAX_FILTERS) throw new RpcError(-32005, 'příliš mnoho filtrů');
    const id = toHex(randomBytes(16));
    filters.set(id, { kind, ...data, lastBlock: chain.head.number, seenTx: new Set(), at: Date.now() });
    return id;
  };

  setInterval(() => {
    for (const [id, f] of filters) if (Date.now() - f.at > FILTER_TTL) filters.delete(id);
  }, 60_000).unref();

  // Spočítá se jednou za blok, data se během bloku nemění.
  let feeCache = null;
  const feeBlocks = () => {
    const key = toHex(chain.head.hash());
    if (feeCache?.key === key) return feeCache.blocks;
    const head = chain.head;
    const blocks = [];
    const first = head.number > BigInt(FEE_WINDOW) ? head.number - BigInt(FEE_WINDOW) + 1n : 1n;
    for (let n = first; n <= head.number; n++) {
      const block = chain.getBlockByNumber(n);
      const h = block.header;
      blocks.push({
        ratio: Number(h.gasUsed) / Number(h.gasLimit), time: Number(h.timestamp),
        txs: fullReceipts(block).map((r) => ({ tip: effectivePrice(r.tx, h.baseFee) - h.baseFee, gas: r.gasUsed })),
      });
    }
    feeCache = { key, blocks };
    return blocks;
  };
  const feeEstimates = () => {
    const head = chain.head;
    const baseFee = nextBaseFee(head);
    return estimateFees({ blocks: feeBlocks(), baseFee, pending: mempool.competing(baseFee), capacity: head.gasLimit });
  };
  const suggestedTip = () => feeEstimates().tiers.normal.tip;

  const feeHistory = (count, newest, percentiles = []) => {
    const n = Math.min(Number(BigInt(count)), 1024);
    const last = resolve(newest);
    const first = last.number - BigInt(n) + 1n > 0n ? last.number - BigInt(n) + 1n : 0n;
    const baseFeePerGas = [];
    const gasUsedRatio = [];
    const reward = [];
    for (let i = first; i <= last.number; i++) {
      const block = chain.getBlockByNumber(i);
      const h = block.header;
      baseFeePerGas.push(quantity(h.baseFee));
      gasUsedRatio.push(Number(h.gasUsed) / Number(h.gasLimit));
      const tips = fullReceipts(block).map((r) => ({ tip: effectivePrice(r.tx, h.baseFee) - h.baseFee, gas: r.gasUsed })).sort((a, b) => (a.tip < b.tip ? -1 : 1));
      reward.push(percentiles.map((p) => {
        if (!tips.length) return quantity(0n);
        const limit = (h.gasUsed * BigInt(Math.round(p * 100))) / 10000n;
        let sum = 0n;
        for (const t of tips) { sum += t.gas; if (sum >= limit) return quantity(t.tip); }
        return quantity(tips[tips.length - 1].tip);
      }));
    }
    baseFeePerGas.push(quantity(nextBaseFee(last)));
    return { oldestBlock: quantity(first), baseFeePerGas, gasUsedRatio, reward };
  };


  /** Skutečně odvedená práce za posledních 15 minut. Když se přestane těžit, odhad klesá, i když nepřišel nový blok. */
  const estimatedHashrate = () => {
    const head = chain.head;
    const now = BigInt(chain.now());
    const end = now > head.timestamp ? now : head.timestamp;
    if (end - head.timestamp > HASHRATE_QUIET_S) return 0n;
    let start = head;
    for (let n = head.number; n > 0n && head.number - n < HASHRATE_BLOCKS; n -= 1n) {
      const h = chain.getHeaderByNumber(n);
      if (h.timestamp + HASHRATE_WINDOW_S < end) break;
      start = h;
    }
    const first = start.number > 1n ? chain.getHeaderByNumber(start.number - 1n) : start;
    if (first.number === 0n || head.number < 2n) return 0n;
    const elapsed = end - first.timestamp;
    return elapsed > 0n ? (chain.headTd - chain.getTd(first.hash())) / elapsed : 0n;
  };

  /**
   * Odhad z bloků je náhodný: u 60 bloků kolísá o 13 %, i když výkon stojí. Těžaři připojení k tomuto uzlu hlásí přesné číslo,
   * proto má přednost, dokud s odhadem souhlasí. Výrazně vyšší odhad znamená, že v síti těží ještě někdo další.
   */
  const networkHashrate = () => {
    const estimate = estimatedHashrate();
    const reported = work?.hashrate() ?? 0n;
    if (reported === 0n) return estimate;
    return estimate > (reported * 13n) / 10n ? estimate : reported;
  };

  const count = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) throw new RpcError(-32602, `neplatné číslo ${v}`);
    return n;
  };
  const paging = (f) => ({ limit: Math.min(MAX_PAGE, count(f.limit) ?? 25) || 25, offset: Math.min(MAX_OFFSET, count(f.offset) ?? 0) });

  const indexedTx = ({ number, idx }) => {
    const b = chain.getBlock(chain.store.canonicalHash(number));
    const rc = fullReceipts(b)[idx];
    return {
      ...txToRpc(b.txs[idx], { blockHash: toHex(b.hash()), number: b.header.number, index: idx, baseFee: b.header.baseFee }),
      status: rc.status, gasUsed: quantity(rc.gasUsed), timestamp: Number(b.header.timestamp),
    };
  };

  /** Transakce podle místa v rejstříku: hash, odesílatel, částka a čas bloku. */
  const txAt = (loc) => {
    if (!loc) return null;
    const b = chain.getBlock(chain.store.canonicalHash(loc.number));
    const tx = b?.txs[loc.idx];
    if (!tx) return null;
    return { hash: toHex(tx.hash()), from: tx.getSenderAddress().toString(), to: tx.to ? tx.to.toString() : null, value: tx.value.toString(), number: loc.number, timestamp: Number(b.header.timestamp) };
  };

  /** Souhrn bloku. Těžař dostane odměnu za blok a všechny poplatky, nic se nepálí: income je jejich součet. */
  const summary = (h) => {
    const fees = h.number > 0n ? chain.store.feesAt(h.number) - chain.store.feesAt(h.number - 1n) : 0n;
    const reward = blockReward(h.number);
    return {
      number: Number(h.number), hash: toHex(h.hash()), parentHash: toHex(h.parentHash), miner: new Address(h.miner).toString(),
      timestamp: Number(h.timestamp), difficulty: h.difficulty.toString(), gasUsed: Number(h.gasUsed), gasLimit: Number(h.gasLimit),
      baseFee: h.baseFee.toString(), txCount: chain.txCount(h.hash()), reward: reward.toString(), fees: fees.toString(), income: (reward + fees).toString(),
    };
  };

  const methods = {
    web3_clientVersion: () => version,
    web3_sha3: ([d]) => toHex(keccak(fromHex(d))),
    net_version: () => chain.network.chainId.toString(),
    net_listening: () => true,
    net_peerCount: () => quantity(BigInt(network?.peerCount ?? 0)),
    eth_chainId: () => quantity(chain.network.chainId),
    eth_protocolVersion: () => '0x1',
    eth_syncing: () => {
      if (!network?.behind) return false;
      const top = [...network.peers].reduce((m, p) => (p.headNumber > m ? p.headNumber : m), chain.head.number);
      return { startingBlock: '0x0', currentBlock: quantity(chain.head.number), highestBlock: quantity(top) };
    },
    eth_accounts: () => [],
    eth_requestAccounts: () => [],
    eth_blockNumber: () => quantity(chain.head.number),
    eth_coinbase: () => node.minerAddress ? toHex(node.minerAddress) : '0x0000000000000000000000000000000000000000',
    eth_gasPrice: () => quantity(nextBaseFee(chain.head) + suggestedTip()),
    eth_maxPriorityFeePerGas: () => quantity(suggestedTip()),
    eth_feeHistory: ([count, newest, pct]) => feeHistory(count, newest, pct),
    eth_getBalance: async ([a, tag]) => {
      const s = await state(resolve(tag));
      return quantity((await s.stateManager.getAccount(hexAddress(a)))?.balance ?? 0n);
    },
    eth_getTransactionCount: async ([a, tag]) => {
      const address = hexAddress(a);
      const s = await state(resolve(tag));
      const nonce = (await s.stateManager.getAccount(address))?.nonce ?? 0n;
      return quantity(tag === 'pending' ? pendingNonce(address, nonce) : nonce);
    },
    eth_getCode: async ([a, tag]) => {
      const s = await state(resolve(tag));
      return toHex(await s.stateManager.getCode(hexAddress(a)));
    },
    eth_getStorageAt: async ([a, slot, tag]) => {
      const s = await state(resolve(tag));
      const key = pad32(fromHex(BigInt(slot).toString(16).padStart(64, '0')));
      const value = await s.stateManager.getStorage(hexAddress(a), key);
      return toHex(pad32(value));
    },
    eth_getProof: async ([a, slots, tag]) => {
      if (!Array.isArray(slots) || slots.length > MAX_PROOF_SLOTS) throw new RpcError(-32602, `nejvýše ${MAX_PROOF_SLOTS} položek`);
      const s = await state(resolve(tag));
      return getMerkleStateProof(s.stateManager, hexAddress(a), slots.map((x) => pad32(fromHex(x))));
    },
    eth_getBlockByNumber: ([tag, full]) => {
      try { return blockByRpc(resolve(tag), !!full); } catch (e) { if (e.code === -32001) return null; throw e; }
    },
    eth_getBlockByHash: ([h, full]) => blockByRpc(chain.getHeader(hexHash(h)), !!full),
    eth_getBlockTransactionCountByHash: ([h]) => {
      const b = chain.getBlock(hexHash(h));
      return b ? quantity(b.txs.length) : null;
    },
    eth_getBlockTransactionCountByNumber: ([tag]) => quantity(chain.getBlock(resolve(tag).hash()).txs.length),
    eth_getUncleCountByBlockHash: () => '0x0',
    eth_getUncleCountByBlockNumber: () => '0x0',
    eth_getTransactionByHash: ([h]) => {
      const hash = hexHash(h);
      const hit = locateTx(hash);
      if (hit) return txToRpc(hit.tx, { blockHash: toHex(hit.block.hash()), number: hit.block.header.number, index: hit.index, baseFee: hit.block.header.baseFee });
      const pending = mempool.get(hash);
      return pending ? txToRpc(pending, null) : null;
    },
    eth_getTransactionByBlockHashAndIndex: ([h, i]) => {
      const b = chain.getBlock(hexHash(h));
      const tx = b?.txs[Number(BigInt(i))];
      return tx ? txToRpc(tx, { blockHash: h, number: b.header.number, index: Number(BigInt(i)), baseFee: b.header.baseFee }) : null;
    },
    eth_getTransactionByBlockNumberAndIndex: ([tag, i]) => {
      const b = chain.getBlock(resolve(tag).hash());
      const tx = b.txs[Number(BigInt(i))];
      return tx ? txToRpc(tx, { blockHash: toHex(b.hash()), number: b.header.number, index: Number(BigInt(i)), baseFee: b.header.baseFee }) : null;
    },
    eth_getTransactionReceipt: ([h]) => {
      const hit = locateTx(hexHash(h));
      return hit ? receiptToRpc(fullReceipts(hit.block)[hit.index], hit.block) : null;
    },
    eth_getBlockReceipts: ([tag]) => {
      const b = chain.getBlock(resolve(tag).hash());
      return fullReceipts(b).map((r) => receiptToRpc(r, b));
    },
    eth_sendRawTransaction: async ([raw]) => {
      let tx;
      try {
        tx = decodeTx(fromHex(raw), chain.commonAt(chain.head.number + 1n));
      } catch (e) {
        throw new RpcError(-32000, `neplatná transakce: ${e.message}`);
      }
      try {
        await node.sendTx(tx);
      } catch (e) {
        if (e instanceof MempoolError) throw new RpcError(-32000, e.message);
        throw e;
      }
      return toHex(tx.hash());
    },
    eth_call: ([c, tag]) => evm('call', c, tag),
    eth_estimateGas: ([c, tag]) => evm('estimate', c, tag),
    eth_createAccessList: () => { throw new RpcError(-32601, 'metoda není podporována'); },
    eth_getLogs: ([f]) => collectLogs(f ?? {}),
    eth_newFilter: ([f]) => newFilter('log', { filter: f ?? {} }),
    eth_newBlockFilter: () => newFilter('block', {}),
    eth_newPendingTransactionFilter: () => newFilter('pending', {}),
    eth_uninstallFilter: ([id]) => filters.delete(id),
    eth_getFilterLogs: ([id]) => {
      const f = filters.get(id);
      if (f?.kind !== 'log') throw new RpcError(-32000, 'filtr nenalezen');
      return collectLogs(f.filter);
    },
    eth_getFilterChanges: ([id]) => {
      const f = filters.get(id);
      if (!f) throw new RpcError(-32000, 'filtr nenalezen');
      f.at = Date.now();
      const head = chain.head.number;
      if (f.kind === 'pending') {
        const fresh = mempool.all().map((t) => toHex(t.hash())).filter((h) => !f.seenTx.has(h));
        fresh.forEach((h) => f.seenTx.add(h));
        return fresh;
      }
      if (head <= f.lastBlock) return [];
      const start = f.lastBlock + 1n;
      f.lastBlock = head;
      if (f.kind === 'block') {
        const out = [];
        for (let n = start; n <= head; n++) out.push(toHex(chain.store.canonicalHash(n)));
        return out;
      }
      return collectLogs({ ...f.filter, fromBlock: quantity(start), toBlock: quantity(head) });
    },
    eth_mining: () => (work?.hashrate() ?? 0n) > 0n,
    eth_hashrate: () => quantity(work?.hashrate() ?? 0n),
    eth_getWork: async () => {
      if (!node.minerAddress) throw new RpcError(-32000, 'uzel nemá nastavenou adresu výplaty, použijte aether_getWork nebo --miner-address');
      return formatWork(await requireWork(node.minerAddress));
    },
    aether_getWork: async ([a]) => formatWork(await requireWork(hexAddress(a).bytes)),
    eth_submitWork: async ([nonce, seal, mix]) => {
      const r = await work.submit(fromHex(nonce), hexHash(seal), hexHash(mix));
      return r.accepted;
    },
    aether_submitWork: async ([nonce, seal, mix]) => {
      const r = await work.submit(fromHex(nonce), hexHash(seal), hexHash(mix));
      return { accepted: r.accepted, stale: !!r.stale, reason: r.reason ?? null, hash: r.hash ? toHex(r.hash) : null, number: r.number !== undefined ? Number(r.number) : null };
    },
    eth_submitHashrate: ([rate, id]) => { work.reportHashrate(id, BigInt(rate)); return true; },

    // ---- pool --------------------------------------------------------------------------
    aether_poolInfo: async ([f = {}] = []) => (node.pool ? node.pool.info({ miner: f.miner ? hexAddress(f.miner).toString() : null, limit: count(f.limit), offset: count(f.offset) }) : null),
    aether_poolWork: async ([a, worker]) => {
      const pool = requirePool();
      try {
        const w = await pool.workFor(hexAddress(a).bytes, String(worker ?? 'rig').slice(0, 32));
        return [...formatWork(w), toHex(RLP.encode(w.sealFields.sealFields())), toHex(pool.address)];
      } catch (e) {
        throw new RpcError(-32000, e.message);
      }
    },
    aether_poolSubmit: async ([nonce, seal, mix]) => {
      const r = await requirePool().submit(fromHex(nonce), hexHash(seal), hexHash(mix));
      const b = r.block;
      return { accepted: r.accepted, stale: !!r.stale, reason: r.reason ?? null, block: b?.accepted ? { hash: toHex(b.hash), number: Number(b.number), stale: !!b.stale } : null };
    },

    // ---- rozšíření pro explorer a aplikace ------------------------------------------
    aether_stats: () => {
      const h = chain.head;
      const n = h.number < 50n ? h.number : 50n;
      // Genesis má pevný čas, do průměru se proto nepočítá.
      const span = h.number - n === 0n && n > 1n ? n - 1n : n;
      const start = n > 0n ? chain.getHeaderByNumber(h.number - span) : h;
      const minted = emitted(h.number);
      const fees = chain.store.feesAt(h.number);
      return {
        network: chain.network.name, chainId: Number(chain.network.chainId), currency: chain.network.currency,
        height: Number(h.number), headHash: toHex(h.hash()), difficulty: h.difficulty.toString(), totalDifficulty: chain.headTd.toString(),
        blockTimeTarget: C.targetBlockTime, avgBlockTime: span > 0n ? Number(h.timestamp - start.timestamp) / Number(span) : 0,
        hashrate: networkHashrate().toString(), reward: blockReward(h.number + 1n).toString(), halvingInterval: Number(C.halvingInterval),
        nextHalving: Number((h.number / C.halvingInterval + 1n) * C.halvingInterval), minted: minted.toString(), fees: fees.toString(),
        supply: minted.toString(), maxSupply: C.maxSupply.toString(), baseFee: nextBaseFee(h).toString(), gasLimit: Number(h.gasLimit),
        ...((fe) => ({ tips: Object.fromEntries(Object.entries(fe.tiers).map(([k, t]) => [k, t.tip.toString()])), congested: fe.congested, fullness: fe.fullness }))(feeEstimates()),
        forks: (chain.network.forks ?? []).map((f) => ({ name: f.name, block: Number(f.block) })),
        mempool: mempool.size, txCount: chain.store.txCount(), peers: network?.peerCount ?? 0, syncing: !!network?.behind, accounts: chain.store.accountCount(), holders: chain.store.holderCount(),
        version, genesisHash: toHex(chain.genesis.hash()), reorgs: chain.reorgs,
      };
    },
    /**
     * Provoz za posledních 24 hodin pro přehled, seznam transakcí a bloků: transakce, poplatky, aktivní adresy,
     * vytížení sítě, bloky poolů a čekající transakce za poslední hodinu. Čas počítá od posledního bloku.
     */
    aether_activity: async () => {
      const h = chain.head;
      const now = Math.max(Number(h.timestamp), chain.now());
      const a = await index('activity', now - 86400);
      const safe = h.number > 32n ? h.number - 32n : 0n;
      const finalized = h.number > BigInt(C.maxReorgDepth) ? h.number - BigInt(C.maxReorgDepth) : 0n;
      return {
        txs: a.txs, fees: BigInt(Math.round(a.fees)).toString(), avgFee: a.txs ? BigInt(Math.round(a.fees / a.txs)).toString() : '0', activeAddresses: a.senders, failed: a.failed,
        tps: a.txs / 86400, blocks: a.blocks, avgBlockTime: a.solve, utilization: Number(h.gasLimit) ? a.gas / Number(h.gasLimit) : 0, poolBlocks: a.poolBlocks,
        rewards: BigInt(Math.round(a.income)).toString(), pending: mempool.size, pendingHour: mempool.countSince(3600_000),
        safe: Number(safe), finalized: Number(finalized), height: Number(h.number), txCount: chain.store.txCount(),
      };
    },
    aether_feeEstimates: () => {
      const e = feeEstimates();
      const tier = (t) => ({ tip: t.tip.toString(), maxFee: t.maxFee.toString(), blocks: t.blocks, seconds: t.seconds });
      return {
        baseFee: e.baseFee.toString(), congested: e.congested, fullness: e.fullness, blockTime: e.blockTime,
        tiers: { slow: tier(e.tiers.slow), normal: tier(e.tiers.normal), fast: tier(e.tiers.fast) },
      };
    },
    aether_blockIncome: ([tag]) => {
      const block = chain.getBlock(resolve(tag).hash());
      const h = block.header;
      const reward = blockReward(h.number);
      const baseFees = h.gasUsed * h.baseFee;
      const tips = fullReceipts(block).reduce((sum, r) => sum + (effectivePrice(r.tx, h.baseFee) - h.baseFee) * r.gasUsed, 0n);
      return {
        number: Number(h.number), miner: new Address(h.miner).toString(), reward: reward.toString(), baseFees: baseFees.toString(),
        tips: tips.toString(), total: (reward + baseFees + tips).toString(),
      };
    },
    aether_recentBlocks: ([limit = 20, offset = 0] = []) => {
      const take = Math.min(100, Number(limit));
      const out = [];
      for (let n = chain.head.number - BigInt(offset); n >= 0n && out.length < take; n--) out.push(summary(chain.getHeaderByNumber(n)));
      return out;
    },
    aether_recentTxs: ([limit = 20] = []) => {
      // Z indexu: řetězec bez transakcí se nesmí procházet od špičky po genesis.
      return chain.store.recentTxs(Math.min(100, Number(limit)) || 20).map(({ number, idx }) => {
        const b = chain.getBlock(chain.store.canonicalHash(number));
        return { ...txToRpc(b.txs[idx], { blockHash: toHex(b.hash()), number: BigInt(number), index: idx, baseFee: b.header.baseFee }), timestamp: Number(b.header.timestamp) };
      });
    },
    aether_pendingTxs: () => mempool.all().slice(0, 200).map((t) => txToRpc(t, null)),
    /** Čekající transakce po stránkách se souhrnem fronty. U každé je vidět, jestli může do dalšího bloku. */
    aether_mempool: async ([f = {}] = []) => {
      const { limit, offset } = paging(f);
      const v = await mempool.view({ order: f.order === 'time' ? 'time' : 'fee', limit, offset, sender: f.address ? hexAddress(f.address).toString() : null });
      const tip = (x) => (x > 0n ? x : 0n).toString();
      return {
        total: v.total, size: v.size, max: v.max, bytes: v.bytes, baseFee: v.baseFee.toString(),
        tips: v.tips && { min: v.tips.min.toString(), median: v.tips.median.toString(), max: v.tips.max.toString() },
        oldest: v.oldest === null ? null : Math.floor(v.oldest / 1000),
        items: v.items.map((x) => ({
          ...txToRpc(x.tx, null), addedAt: Math.floor(x.addedAt / 1000), tip: tip(x.tip), waitingFor: x.missing === null ? null : Number(x.missing), underpriced: x.underpriced,
        })),
      };
    },
    aether_addressTxs: ([a, limit = 25, offset = 0]) => {
      const address = hexAddress(a);
      const rows = chain.store.addressTxs(address.bytes, Math.min(100, Number(limit)), Number(offset));
      const items = rows.map((r) => {
        const b = chain.getBlockByNumber(r.number);
        const rc = fullReceipts(b)[r.idx];
        return { ...txToRpc(b.txs[r.idx], { blockHash: toHex(b.hash()), number: b.header.number, index: r.idx, baseFee: b.header.baseFee }), status: rc.status, gasUsed: quantity(rc.gasUsed), timestamp: Number(b.header.timestamp) };
      });
      return { total: chain.store.addressTxCount(address.bytes), items };
    },
    /** Bloky s filtry: těžař, počet transakcí, čas, rozsah výšek. */
    aether_blocks: async ([f = {}] = []) => {
      const { limit, offset } = paging(f);
      const { total, capped, numbers } = await index('findBlocks', {
        miner: f.miner ? hexAddress(f.miner).bytes : undefined, minTxs: count(f.minTxs), onlyEmpty: !!f.onlyEmpty, fromTime: count(f.fromTime), toTime: count(f.toTime),
        fromBlock: count(f.fromBlock), toBlock: count(f.toBlock), ascending: f.order === 'asc', limit, offset,
      });
      return { total, capped, items: numbers.map((n) => summary(chain.getHeaderByNumber(BigInt(n)))) };
    },
    /** Transakce s filtry: adresa a směr, druh, stav, čas, výše, rozsah výšek. */
    aether_txs: async ([f = {}] = []) => {
      const { limit, offset } = paging(f);
      const { total, capped, rows } = await index('findTxs', {
        address: f.address ? hexAddress(f.address).bytes : undefined, direction: f.direction, kind: TX_KINDS[f.kind], ok: f.status === 'ok' ? 1 : f.status === 'failed' ? 0 : undefined,
        fromTime: count(f.fromTime), toTime: count(f.toTime), fromBlock: count(f.fromBlock), toBlock: count(f.toBlock),
        minValue: f.minValue ? Number(BigInt(f.minValue)) : undefined, ascending: f.order === 'asc', limit, offset,
      });
      return { total, capped, items: rows.map(indexedTx) };
    },
    /** Všechno, co uzel ví o adrese: zůstatek, souhrn transakcí, vytěžené bloky a tokeny. */
    aether_addressInfo: async ([a]) => {
      const address = hexAddress(a);
      const head = chain.head;
      const account = await (await state(head)).stateManager.getAccount(address);
      const code = await (await state(head)).stateManager.getCode(address);
      const { out, received, mined, firstSent, lastSent, funding, self } = await index('addressSummary', address.bytes);
      const seen = [out.first, received.first, mined.first].filter((n) => n !== null);
      const last = [out.last, received.last, mined.last].filter((n) => n !== null);
      const stamp = (n) => (n === undefined ? null : { number: n, timestamp: Number(chain.getHeaderByNumber(BigInt(n)).timestamp) });
      return {
        address: address.toString(), balance: (account?.balance ?? 0n).toString(), nonce: Number(account?.nonce ?? 0n), isContract: code.length > 0, codeSize: code.length,
        sent: { count: out.n, value: out.value, fees: out.fee, failed: out.failed }, received: { count: received.n, value: received.value }, selfCount: self,
        mined: { blocks: mined.n, income: mined.income, last: mined.last },
        first: stamp(seen.length ? Math.min(...seen) : undefined), last: stamp(last.length ? Math.max(...last) : undefined),
        tokens: (await index('tokensOf', address.bytes, TRANSFER_TOPIC)).map((t) => new Address(t).toString()),
        poolPayouts: (await index('logsForAddress', address.bytes, PAID_TOPIC, 1, 0)).total,
        tokenTransfers: (await index('holderTransfers', address.bytes, TRANSFER_TOPIC, 1, 0)).total,
        firstSent: txAt(firstSent), lastSent: txAt(lastSent), fundedBy: txAt(funding),
      };
    },
    /** Držitelé a počet převodů tokenu. Zůstatky čte přímo z kontraktu, výsledek platí do dalšího bloku. */
    aether_tokenInfo: ([a]) => {
      const address = hexAddress(a);
      const key = address.toString();
      const head = toHex(chain.head.hash());
      const known = tokenCache.get(key);
      if (known?.head === head) return known.value;
      const value = tokenHolders(address).catch((e) => { tokenCache.delete(key); throw e; });
      if (tokenCache.size >= MAX_PAID_SUMS) tokenCache.delete(tokenCache.keys().next().value);
      tokenCache.set(key, { head, value });
      return value;
    },
    /** Převody tokenu s částkami, stránkovaně. */
    /**
     * Převody tokenů jedné adresy v obou směrech: co poslala a co dostala, i z cizích transakcí, třeba výstup swapu.
     * U NFT (ERC-721) je místo částky číslo tokenu.
     */
    aether_addressTransfers: async ([a, limit = 25, offset = 0]) => {
      const address = hexAddress(a);
      const { total, capped, rows } = await index('holderTransfers', address.bytes, TRANSFER_TOPIC, Math.min(MAX_PAGE, count(limit) ?? 25) || 25, Math.min(MAX_OFFSET, count(offset) ?? 0));
      return {
        total,
        capped,
        items: rows.map((r) => {
          const block = chain.getBlock(chain.store.canonicalHash(r.number));
          const log = fullReceipts(block)[r.tx_idx].logs.find((l) => l.logIndex === r.log_idx);
          const nft = r.t3 !== null;
          return {
            number: r.number, timestamp: Number(block.header.timestamp), hash: log.transactionHash, token: new Address(Uint8Array.from(r.address)).toString(),
            from: new Address(Uint8Array.from(r.t1).slice(12)).toString(), to: new Address(Uint8Array.from(r.t2).slice(12)).toString(),
            ...(nft ? { tokenId: BigInt(toHex(r.t3)).toString() } : { value: BigInt(log.data === '0x' ? 0 : log.data).toString() }),
          };
        }),
      };
    },
    aether_tokenTransfers: async ([a, limit = 25, offset = 0]) => {
      const address = hexAddress(a);
      const { total, capped, rows } = await index('tokenEvents', address.bytes, TRANSFER_TOPIC, Math.min(MAX_PAGE, count(limit) ?? 25) || 25, Math.min(MAX_OFFSET, count(offset) ?? 0));
      return {
        total,
        capped,
        items: rows.map((r) => {
          const block = chain.getBlock(chain.store.canonicalHash(r.number));
          const log = fullReceipts(block)[r.tx_idx].logs.find((l) => l.logIndex === r.log_idx);
          return {
            number: r.number, timestamp: Number(block.header.timestamp), hash: log.transactionHash,
            from: new Address(Uint8Array.from(r.t1).slice(12)).toString(), to: new Address(Uint8Array.from(r.t2).slice(12)).toString(), value: BigInt(log.data).toString(),
          };
        }),
      };
    },
    /** Události jednoho druhu z kontraktu, nejnovější první. Stránka Swap z nich skládá cenu a poslední obchody. */
    aether_contractLogs: async ([a, topic, limit = 50, offset = 0]) => {
      const address = hexAddress(a);
      const { total, rows } = await index('tokenEvents', address.bytes, fromHex(topic), Math.min(MAX_LOG_PAGE, count(limit) ?? 50) || 50, Math.min(MAX_OFFSET, count(offset) ?? 0));
      return {
        total,
        items: rows.map((r) => {
          const block = chain.getBlock(chain.store.canonicalHash(r.number));
          const log = fullReceipts(block)[r.tx_idx].logs.find((l) => l.logIndex === r.log_idx);
          return { number: r.number, timestamp: Number(block.header.timestamp), hash: log.transactionHash, topics: log.topics, data: log.data };
        }),
      };
    },
    /** Podíl těžařů a poolů na blocích za období, stejný zdroj jako grafy. */
    aether_minerShares: async ([f = {}] = []) => {
      const [{ from, to, rows }, pools] = await Promise.all([shareRows(f), poolList()]);
      const isPool = new Set(pools.map((p) => p.pool));
      const seconds = Math.max(1, to - from + 1);
      return {
        from, to, blocks: rows.reduce((sum, r) => sum + r.blocks, 0), work: rows.reduce((sum, r) => sum + r.work, 0),
        items: rows.map((r) => { const address = new Address(r.miner).toString(); return { address, pool: isPool.has(address), blocks: r.blocks, work: r.work, hashrate: r.work / seconds, last: r.last }; }),
      };
    },
    /** Výplaty z poolů na adresu. Jsou to vnitřní převody kontraktu, běžný seznam transakcí je neukáže. */
    /**
     * Těžaři poolu od daného bloku podle přijatých podílů: kolik podílů a kdy naposledy. Práci v okně,
     * čekající výplatu a vyplacené mince čte stránka přímo z kontraktu poolu.
     */
    aether_poolMiners: async ([a, fromBlock, f = {}] = []) => {
      const pool = hexAddress(a);
      const head = Number(chain.head.number);
      const from = Math.max(0, count(fromBlock) ?? head - POOL_WINDOW_BLOCKS);
      const limit = Math.min(MAX_PAGE, count(f.limit) ?? MAX_PAGE) || MAX_PAGE;
      const offset = Math.min(MAX_OFFSET, count(f.offset) ?? 0);
      const item = (r) => ({ miner: new Address(Uint8Array.from(r.who).slice(12)).toString(), shares: r.count, last: r.last });
      // Hledaný těžař přijde i s pořadím, takže ho najde i ten, kdo je mezi tisíci na poslední stránce.
      const [{ total, rows }, match] = await Promise.all([
        index('poolMiners', pool.bytes, SHARE_TOPIC, from, limit, offset),
        f.miner ? index('poolMinerRank', pool.bytes, SHARE_TOPIC, from, hexAddress(f.miner).bytes) : null,
      ]);
      return { fromBlock: from, total, items: rows.map(item), ...(f.miner ? { match: match ? { ...item(match), rank: match.rank } : null } : {}) };
    },
    /**
     * Žebříček poolů z továrny podle podílu na blocích za období, nejsilnější první, po stránkách a s hledáním
     * podle jména, adresy poolu nebo provozovatele. Pool bez bloků v období je za aktivními, nejnovější dřív.
     */
    aether_pools: async ([f = {}] = []) => {
      const limit = Math.min(MAX_PAGE, count(f.limit) ?? 10) || 10;
      const offset = Math.min(MAX_OFFSET, count(f.offset) ?? 0);
      const now = Number(chain.head.timestamp);
      const seconds = count(f.seconds) ?? POOL_PERIOD_S;
      const [pools, period] = await Promise.all([poolList(), shareRows(seconds ? { from: now - seconds, to: now } : {})]);
      const byMiner = new Map(period.rows.map((r) => [new Address(r.miner).toString(), r]));
      const allWork = period.rows.reduce((sum, r) => sum + r.work, 0);
      const words = String(f.query ?? '').trim().toLowerCase().slice(0, 64);
      const rows = pools.map((p) => ({ p, s: byMiner.get(p.pool) }))
        .filter(({ p }) => !words || p.name.toLowerCase().includes(words) || p.pool.includes(words) || p.operator.includes(words))
        .sort((x, y) => (y.s?.work ?? 0) - (x.s?.work ?? 0) || y.p.number - x.p.number);
      const head = Number(chain.head.number);
      const span = Math.max(1, period.to - period.from + 1);
      const items = await Promise.all(rows.slice(offset, offset + limit).map(async ({ p, s }) => {
        const [miners, url] = await Promise.all([
          index('poolMinerCount', fromHex(p.pool), SHARE_TOPIC, Math.max(0, head - p.roundBlocks * p.windowRounds)),
          evm('call', { to: p.pool, data: URL_CALL }, 'latest').then((hex) => abiText(hex), () => ''),
        ]);
        return {
          address: p.pool, order: p.order, operator: p.operator, name: p.name, feeBps: p.feeBps, roundBlocks: p.roundBlocks, windowRounds: p.windowRounds, created: p.number,
          blocks: s?.blocks ?? 0, work: s?.work ?? 0, share: allWork ? (s?.work ?? 0) / allWork : 0, hashrate: (s?.work ?? 0) / span, last: s?.last ?? null, miners, url,
        };
      }));
      return { total: pools.length, matched: rows.length, from: period.from, to: period.to, work: allWork, items };
    },
    /**
     * Odměny za vytěžené bloky po dnech: kolik bloků a kolik přinesly, tedy odměna za blok a všechny poplatky.
     * Den se počítá v časovém pásmu volajícího (`tz` je posun v sekundách), aby seděl s jeho kalendářem.
     */
    aether_minedByDay: async ([a, f = {}] = []) => {
      const miner = hexAddress(a);
      const days = Math.min(31, count(f.days) ?? 7) || 7;
      const tz = Math.max(-14 * 3600, Math.min(14 * 3600, Math.trunc(Number(f.tz) || 0)));
      const now = Number(chain.head.timestamp);
      const rows = await index('minedSince', miner.bytes, now - days * DAY_S, MAX_MINED_ROWS);
      const byDay = new Map();
      for (const r of rows) {
        const day = Math.floor((r.time + tz) / DAY_S);
        const n = BigInt(r.number);
        const income = blockReward(n) + (n > 0n ? chain.store.feesAt(n) - chain.store.feesAt(n - 1n) : 0n);
        const d = byDay.get(day) ?? { day, blocks: 0, income: 0n, first: r.number, last: r.number, time: r.time };
        d.blocks += 1;
        d.income += income;
        d.first = Math.min(d.first, r.number);
        d.last = Math.max(d.last, r.number);
        d.time = Math.max(d.time, r.time);
        byDay.set(day, d);
      }
      return { capped: rows.length >= MAX_MINED_ROWS, items: [...byDay.values()].map((d) => ({ start: d.day * DAY_S - tz, blocks: d.blocks, income: d.income.toString(), first: d.first, last: d.last, time: d.time })) };
    },
    /**
     * Proč transakce v bloku selhala. Uzel přehraje blok až po ni a vrátí chybu EVM a data revertu, Explorer z nich
     * pozná chybu kontraktu (třeba SlippageExceeded). U úspěšné, čekající nebo neznámé transakce vrátí null.
     */
    aether_txError: async ([h]) => {
      const hash = hexHash(h);
      const key = toHex(hash);
      if (txErrors.has(key)) return txErrors.get(key);
      const found = locateTx(hash);
      if (!found) return null;
      const receipts = fullReceipts(found.block);
      if (Number(receipts[found.index]?.status) === 1) return null;
      const r = await chain.replayTx(found.block, found.index);
      const result = { error: r.error, data: toHex(r.returnValue ?? new Uint8Array(0)), gasUsed: r.gasUsed.toString(), gasLimit: found.tx.gasLimit.toString() };
      if (txErrors.size >= MAX_TX_ERRORS) txErrors.delete(txErrors.keys().next().value);
      txErrors.set(key, result);
      return result;
    },
    /** Pooly, které adresa založila a provozuje. Jen z události továrny poolů, jiný kontrakt se za ni vydávat nemůže. */
    aether_poolsOf: async ([a]) => {
      const operator = hexAddress(a);
      const rows = await index('eventsBySecond', POOL_FACTORY, POOL_CREATED_TOPIC, operator.bytes, 100);
      return rows.map((r) => ({ pool: new Address(Uint8Array.from(r.first).slice(12)).toString(), number: r.number, timestamp: Number(chain.getHeaderByNumber(BigInt(r.number)).timestamp) }));
    },
    aether_poolPayouts: async ([a, limit = 25, offset = 0]) => {
      const address = hexAddress(a);
      const { total, rows } = await index('logsForAddress', address.bytes, PAID_TOPIC, Math.min(MAX_PAGE, count(limit) ?? 25) || 25, Math.min(MAX_OFFSET, count(offset) ?? 0));
      const amount = (r) => {
        const block = chain.getBlock(chain.store.canonicalHash(r.number));
        const log = fullReceipts(block)[r.tx_idx].logs.find((l) => l.logIndex === r.log_idx);
        return { number: r.number, timestamp: Number(block.header.timestamp), pool: new Address(r.address).toString(), amount: BigInt(log.data).toString(), hash: log.transactionHash };
      };
      // Součet čte stovky bloků, proto se počítá jen když přibude výplata. Jinak by šel opakovaným dotazem přetížit uzel.
      const key = address.toString();
      let known = paidSums.get(key);
      if (known?.total !== total) {
        const all = (await index('logsForAddress', address.bytes, PAID_TOPIC, MAX_SUMMED, 0)).rows;
        known = { total, sum: all.reduce((v, r) => v + BigInt(amount(r).amount), 0n).toString() };
        if (paidSums.size >= MAX_PAID_SUMS) paidSums.delete(paidSums.keys().next().value);
        paidSums.set(key, known);
      }
      return { total, sum: known.sum, items: rows.map(amount) };
    },
    /** Historie sítě po úsecích: čas bloku, obtížnost, odhad výkonu, transakce a gas. */
    aether_chartSeries: async ([f = {}] = []) => {
      const range = await index('indexRange');
      const to = count(f.to) ?? range.last ?? 0;
      const from = Math.max(count(f.from) ?? range.first ?? 0, range.first ?? 0);
      const points = Math.min(MAX_CHART_POINTS, Math.max(10, count(f.points) ?? 120));
      // Pevný úsek, třeba den pro graf za 14 dní. Jinak se úsek dopočítá z počtu bodů.
      const bucket = Math.max(MIN_CHART_BUCKET_S, count(f.bucket) ?? Math.ceil((to - from + 1) / points));
      const [rows, extra] = await Promise.all([index('chartSeries', from, to, bucket), index('chartExtra', from, to, bucket, TRANSFER_TOPIC)]);
      const txOf = new Map(extra.tx.map((r) => [r.b, r]));
      const transfersOf = new Map(extra.transfers.map((r) => [r.b, r.c]));
      return {
        from, to, bucket, first: range.first, last: range.last,
        items: rows.map((r) => ({
          activeAddresses: txOf.get(r.b)?.senders ?? 0, fees: String(Math.round(txOf.get(r.b)?.fees ?? 0)), contracts: txOf.get(r.b)?.created ?? 0,
          failed: txOf.get(r.b)?.failed ?? 0, transfers: transfersOf.get(r.b) ?? 0,
          time: r.time, first: r.first, last: r.last, blocks: r.blocks, blockTime: r.solve, slowest: r.slowest, difficulty: r.difficulty,
          // Poslední úsek bývá neúplný. Dělit celou délkou by na konci grafu ukázalo falešný pokles výkonu.
          hashrate: r.work / Math.max(bucket / 2, Math.min(bucket, to - (from + r.b * bucket) + 1)), txs: r.txs, gas: r.gas,
        })),
      };
    },
    aether_richList: ([limit = 100] = []) => ({
      accounts: chain.store.accountCount(),
      items: chain.store.richList(Math.min(500, Number(limit))).map((r) => ({ address: new Address(r.addr).toString(), balance: r.balance.toString(), isContract: r.isContract })),
    }),
    aether_miners: ([window = 1000] = []) => {
      const head = chain.head.number;
      const span = BigInt(Math.min(2000, Number(window)) || 1000);
      const stats = new Map();
      for (let n = head; n > 0n && head - n < span; n--) {
        const h = chain.getHeaderByNumber(n);
        const k = new Address(h.miner).toString();
        const s = stats.get(k) ?? { address: k, blocks: 0, lastBlock: Number(h.number) };
        s.blocks += 1;
        stats.set(k, s);
      }
      return [...stats.values()].sort((a, b) => b.blocks - a.blocks);
    },
    /**
     * Všichni těžaři za celou historii po stránkách, z průběžných součtů. Volitelně jeden těžař s pořadím,
     * aby šel najít i mezi miliony.
     */
    aether_minerList: async ([f = {}] = []) => {
      const { limit, offset } = paging(f);
      const now = Number(chain.head.timestamp);
      const [list, active, match] = await Promise.all([
        index('minerList', { order: f.order === 'last' ? 'last' : 'blocks', limit, offset }),
        index('activeMiners', now - 86400),
        f.address ? index('minerRank', hexAddress(f.address).bytes) : null,
      ]);
      const row = (r) => ({
        address: new Address(r.miner).toString(), blocks: r.blocks, work: r.work, income: r.income, first: r.first, last: r.last,
        lastTime: Number(chain.getHeaderByNumber(BigInt(r.last))?.timestamp ?? 0),
      });
      return {
        total: list.total, blocks: Number(chain.head.number), active, items: list.rows.map(row),
        match: match ? { rank: match.rank, ...row(match) } : null,
      };
    },
    aether_charts: ([window = 200] = []) => {
      const head = chain.head.number;
      const n = BigInt(Math.min(1000, Number(window)) || 200);
      const out = [];
      for (let i = head > n ? head - n + 1n : 1n; i <= head; i++) {
        const h = chain.getHeaderByNumber(i);
        const prev = chain.getHeader(h.parentHash);
        const solve = Number(h.timestamp - prev.timestamp);
        out.push({ number: Number(i), timestamp: Number(h.timestamp), blockTime: solve, difficulty: h.difficulty.toString(), gasUsed: Number(h.gasUsed), hashrate: (h.difficulty / BigInt(Math.max(solve, 1))).toString() });
      }
      return out;
    },
    aether_peers: () => network?.peersInfo() ?? [],
    /** Adresy, na kterých uzel přijímá peněženky. Prázdné pole `lan` znamená, že RPC slyší jen na tomto počítači. */
    // Rozložení místní sítě patří jen volajícím z ní. Cizí volající dostane jen veřejnou adresu.
    aether_endpoints: (_, caller) => {
      const e = node.endpoints?.() ?? null;
      if (!e || caller?.local !== false) return e;
      const a = e.access;
      return { chainId: e.chainId, rpcPort: e.rpcPort, p2pPort: e.p2pPort, local: null, lan: [], public: e.public, restricted: true, access: a && { method: a.method, upnp: a.upnp, behindNat: a.behindNat, nat: a.nat, ports: a.ports, checked: a.checked } };
    },
    /** Vlastní identita uzlu. Klíč patří do seznamu seedů jako `klíč@host:port`, nový uzel tak seed pozná. */
    aether_nodeInfo: () => (network ? {
      id: Buffer.from(network.nodeId).toString('hex'), publicKey: Buffer.from(network.identity.publicKey).toString('hex'),
      port: network.port, seed: `${Buffer.from(network.identity.publicKey).toString('hex')}@HOST:${network.port}`,
    } : null),
    aether_search: ([q]) => {
      const s = String(q ?? '').trim();
      if (/^\d+$/.test(s) && chain.getHeaderByNumber(BigInt(s))) return { type: 'block', id: s };
      if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { type: 'address', id: s };
      if (/^0x[0-9a-fA-F]{64}$/.test(s)) {
        const b = fromHex(s);
        if (chain.getHeader(b)) return { type: 'block', id: s };
        if (chain.store.txLocation(b) || mempool.has(b)) return { type: 'tx', id: s };
      }
      return null;
    },
  };

  /** Výpočet EVM ve vlákně s časovým limitem. Databáze v paměti (testy) vlákno mít nemůže. */
  /** Dotaz do indexu mimo hlavní vlákno. Přetížený uzel raději odpoví chybou, než aby zdržel bloky. */
  /** Bloky a práce každého příjemce odměny za období. Celá historie jde z průběžných součtů, ne přes miliony bloků. */
  async function shareRows(f = {}) {
    const range = await index('indexRange');
    const to = count(f.to) ?? range.last ?? 0;
    const from = Math.max(count(f.from) ?? range.first ?? 0, range.first ?? 0);
    const all = from <= (range.first ?? 0) && to >= (range.last ?? 0);
    const rows = await index(all ? 'minerTotals' : 'minerShares', ...(all ? [MAX_SHARE_ROWS] : [from, to, MAX_SHARE_ROWS]));
    return { from, to, rows };
  }

  // Pooly z události továrny. Jméno, poplatek a okno se po založení nemění, proto si je uzel pamatuje
  // a čte jen nově založené. Klíč hlídá i výměnu bloků: změní se počet nebo nejnovější založení.
  let poolDirectory = { key: null, items: [] };
  const txErrors = new Map();
  async function poolList() {
    const { total, rows } = await index('tokenEvents', POOL_FACTORY, POOL_CREATED_TOPIC, MAX_POOLS, 0);
    const key = `${total}:${rows[0]?.number}:${rows[0]?.log_idx}`;
    if (poolDirectory.key === key) return poolDirectory.items;
    const known = new Map(poolDirectory.items.map((p) => [`${p.number}:${p.txIdx}:${p.logIdx}:${p.pool}`, p]));
    const items = rows.map((r) => {
      const pool = new Address(Uint8Array.from(r.t1).slice(12)).toString();
      const old = known.get(`${r.number}:${r.tx_idx}:${r.log_idx}:${pool}`);
      if (old) return old;
      const block = chain.getBlock(chain.store.canonicalHash(r.number));
      const log = fullReceipts(block)[r.tx_idx].logs.find((l) => l.logIndex === r.log_idx);
      return {
        pool, operator: new Address(Uint8Array.from(r.t2).slice(12)).toString(), name: abiText(log.data, 0).slice(0, 64),
        feeBps: Number(abiWord(log.data, 1)), roundBlocks: Number(abiWord(log.data, 2)), windowRounds: Number(abiWord(log.data, 3)),
        number: r.number, txIdx: r.tx_idx, logIdx: r.log_idx,
      };
    });
    // Pořadí založení drží barvu poolu v grafech: nový pool ani změna období nikoho nepřebarví.
    items.forEach((p, i) => { p.order = items.length - 1 - i; });
    poolDirectory = { key, items };
    return items;
  }

  async function index(name, ...args) {
    if (!vm) return chain.store[name](...args);
    try {
      return await vm.run('index', null, { name, args });
    } catch (e) {
      throw new RpcError(e instanceof VmBusyError ? -32005 : -32603, e.message);
    }
  }

  /** Cizí kontrakt může `balanceOf` schválně prodražit, proto má celý průchod časový limit a částečný výsledek se přizná. */
  async function tokenHolders(address) {
    const { total } = await index('tokenEvents', address.bytes, TRANSFER_TOPIC, 1, 0);
    const recipients = await index('tokenRecipients', address.bytes, TRANSFER_TOPIC, MAX_HOLDER_SCAN);
    const deadline = Date.now() + HOLDER_SCAN_MS;
    const holders = [];
    let scanned = 0;
    for (const topic of recipients) {
      if (Date.now() > deadline) break;
      scanned += 1;
      // Revert znamená, že kontrakt zůstatek nevrací. Plná fronta je jiná věc: zůstatek by se tiše počítal jako nula.
      const result = await evm('call', { to: address.toString(), data: `0x70a08231${toHex(topic).slice(2)}` }, 'latest').catch((e) => { if (e.code === REVERTED) return '0x'; throw e; });
      const balance = result === '0x' ? 0n : BigInt(result);
      if (balance > 0n) holders.push({ address: new Address(Uint8Array.from(topic).slice(12)).toString(), balance });
    }
    holders.sort((x, y) => (x.balance < y.balance ? 1 : x.balance > y.balance ? -1 : 0));
    return {
      transfers: total, holders: holders.length, complete: scanned === recipients.length && recipients.length < MAX_HOLDER_SCAN,
      top: holders.slice(0, TOP_HOLDERS).map((h) => ({ address: h.address, balance: h.balance.toString() })),
    };
  }

  async function evm(kind, call, tag) {
    if (typeof call !== 'object' || call === null) throw new RpcError(-32602, 'chybí parametry volání');
    const header = resolve(tag);
    try {
      if (vm) return await vm.run(kind, header, call);
      return kind === 'call' ? toHex(await ethCall(chain, header, call)) : quantity(await estimateGas(chain, header, call));
    } catch (e) {
      if (e instanceof RpcCallError) throw new RpcError(3, e.message, e.data);
      if (e instanceof VmBusyError) throw new RpcError(-32005, e.message);
      throw e;
    }
  }

  function requirePool() {
    if (!node.pool) throw new RpcError(-32000, 'tento uzel nevede pool');
    return node.pool;
  }

  async function requireWork(miner) {
    if (!work) throw new RpcError(-32000, 'těžba není zapnutá');
    try {
      return await work.getWork(miner);
    } catch (e) {
      throw new RpcError(-32000, e.message);
    }
  }

  function formatWork(w) {
    return [toHex(w.sealHash), toHex(w.seedHash), `0x${w.target >= 2n ** 256n ? 'f'.repeat(64) : w.target.toString(16).padStart(64, '0')}`, quantity(w.number)];
  }

  // Veřejný uzel (--no-mining-rpc) práci nerozdává ani nepřijímá: sestavení šablony zdrží zpracování bloků
  // a hlášený výkon by mohl kdokoli zfalšovat. Těžaři patří na vlastní uzel nebo na Stratum.
  if (node.miningRpc === false) {
    const off = () => { throw new RpcError(-32601, 'těžba přes RPC je na tomto uzlu vypnutá'); };
    for (const name of MINING_METHODS) methods[name] = off;
  }

  // Vlastní metody sítě se jmenují quinvium_*. Dřívější názvy quintium_* a aether_* zůstávají, aby starší programy fungovaly dál.
  for (const name of Object.keys(methods)) {
    if (!name.startsWith('aether_')) continue;
    const rest = name.slice('aether_'.length);
    methods[`quintium_${rest}`] = methods[name];
    methods[`quinvium_${rest}`] = methods[name];   // jméno sítě od 13. 11. 2026
  }
  return { methods, collectLogs, resolve };
}

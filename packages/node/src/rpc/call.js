// eth_call a eth_estimateGas: běží nad kopií stavu a nikdy nic nezapisují.
import { createBlock } from '@ethereumjs/block';
import { createLegacyTx } from '@ethereumjs/tx';
import { Address, createAddressFromString, createZeroAddress } from '@ethereumjs/util';
import { newVm, openState } from '../core/executor.js';
import { fromHex } from '../util/bytes.js';

export class RpcCallError extends Error {
  constructor(message, data) {
    super(message);
    this.data = data;
  }
}

function parseCall(c) {
  return {
    caller: c.from ? createAddressFromString(c.from) : createZeroAddress(),
    to: c.to ? createAddressFromString(c.to) : undefined,
    value: c.value ? BigInt(c.value) : 0n,
    data: c.data ?? c.input ? fromHex(c.data ?? c.input) : new Uint8Array(0),
  };
}

async function freshVm(chain, header) {
  const common = chain.commonAt(header.number + 1n);
  const { stateManager } = await openState(chain.store, common, header.stateRoot);
  const vm = await newVm(common, stateManager, {
    getBlock: async (n) => ({ hash: () => chain.store.canonicalHash(n) ?? new Uint8Array(32) }), shallowCopy() { return this; },
  }, { pow: chain.pow, number: header.number + 1n });
  const block = createBlock({
    header: {
      number: header.number + 1n, coinbase: new Address(header.miner), timestamp: header.timestamp + 15n, gasLimit: header.gasLimit,
      baseFeePerGas: header.baseFee, difficulty: 0n, mixHash: header.mixHash, nonce: new Uint8Array(8),
    },
  }, { common, setHardfork: false, skipConsensusFormatValidation: true });
  return { vm, block };
}

async function runOnce(chain, header, call, gasLimit) {
  const { vm, block } = await freshVm(chain, header);
  const r = await vm.evm.runCall({
    caller: call.caller, to: call.to, value: call.value, data: call.data, gasLimit, block, skipBalance: true, gasPrice: 0n, origin: call.caller,
  });
  return r.execResult;
}

function revertError(res) {
  const data = `0x${Buffer.from(res.returnValue ?? []).toString('hex')}`;
  let reason = 'execution reverted';
  if (data.startsWith('0x08c379a0') && data.length >= 138) {
    try {
      const len = Number(BigInt(`0x${data.slice(74, 138)}`));
      reason = `execution reverted: ${Buffer.from(data.slice(138, 138 + len * 2), 'hex').toString('utf8')}`;
    } catch { /* necháme obecnou zprávu */ }
  }
  return new RpcCallError(reason, data);
}

export async function ethCall(chain, header, params) {
  const call = parseCall(params);
  const gas = params.gas ? BigInt(params.gas) : header.gasLimit;
  const limit = gas > 50_000_000n ? 50_000_000n : gas;
  const res = await runOnce(chain, header, call, limit);
  if (res.exceptionError) {
    if (res.exceptionError.error === 'revert') throw revertError(res);
    throw new RpcCallError(`chyba EVM: ${res.exceptionError.error}`);
  }
  return res.returnValue;
}

export async function estimateGas(chain, header, params) {
  const call = parseCall(params);
  const intrinsic = createLegacyTx({ to: call.to, data: call.data, value: call.value, gasLimit: 1n }, { common: chain.commonAt(header.number + 1n), freeze: false }).getIntrinsicGas();
  const cap = params.gas ? BigInt(params.gas) : header.gasLimit;
  const attempt = async (total) => {
    if (total < intrinsic) return { ok: false };
    const res = await runOnce(chain, header, call, total - intrinsic);
    return { ok: !res.exceptionError, res };
  };
  const top = await attempt(cap);
  if (!top.ok) {
    if (top.res?.exceptionError?.error === 'revert') throw revertError(top.res);
    throw new RpcCallError(`transakce selže: ${top.res?.exceptionError?.error ?? 'málo gasu'}`);
  }
  let lo = intrinsic - 1n;
  let hi = cap;
  const used = intrinsic + top.res.executionGasUsed;
  if (used < hi && (await attempt(used)).ok) hi = used;
  else lo = used < hi ? used : lo;
  while (hi - lo > 1n + hi / 64n) {
    const mid = (hi + lo) / 2n;
    if ((await attempt(mid)).ok) hi = mid;
    else lo = mid;
  }
  return hi;
}

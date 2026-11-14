// Thread for eth_call, eth_estimateGas and Explorer queries. It has its own read-only database connection.
import { parentPort, workerData } from 'node:worker_threads';
import { forkIndex, rulesAt } from '../core/forks.js';
import { makeCommon } from '../core/executor.js';
import { Pow } from '../core/pow.js';
import { INDEX_QUERIES, StateReader } from '../core/store.js';
import { Header } from '../core/types.js';
import { quantity, toHex } from '../util/bytes.js';
import { RpcCallError, estimateGas, ethCall } from './call.js';

const { network, dbPath, powDir } = workerData;
const commons = new Map();
const chain = {
  store: new StateReader(dbPath),
  pow: new Pow(powDir),
  commonAt(number) {
    const i = forkIndex(network, number);
    if (!commons.has(i)) commons.set(i, makeCommon(network, rulesAt(network, number)));
    return commons.get(i);
  },
};

parentPort.on('message', async ({ id, kind, header, params }) => {
  try {
    if (kind === 'index') {
      if (!INDEX_QUERIES.includes(params.name)) throw new Error('neznámý dotaz');
      parentPort.postMessage({ id, result: chain.store[params.name](...params.args) });
      return;
    }
    const h = Header.decode(header);
    const result = kind === 'call' ? toHex(await ethCall(chain, h, params)) : quantity(await estimateGas(chain, h, params));
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message, data: e instanceof RpcCallError ? e.data : undefined });
  }
});

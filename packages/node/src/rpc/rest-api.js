// The Quinvium REST API, read only: GET /api?module=account&action=balance&address=0x…
// It uses the common module/action query format of block explorers, so wallets, portfolio trackers and scripts that already
// speak it work against a Quinvium node with only the address changed.
// Everything is answered from the node's own JSON-RPC methods, so the same rate limit and the same privacy rules apply:
// nothing here returns IP addresses, and nothing writes to the chain (no eth_sendRawTransaction).
const OK = (result) => ({ status: '1', message: 'OK', result });
const EMPTY = (what) => ({ status: '0', message: `No ${what} found`, result: [] });
const FAIL = (text) => ({ status: '0', message: 'NOTOK', result: `Error! ${text}` });
const MAX_OFFSET = 100;          // one page holds at most 100 rows (page through for more)
const MAX_MULTI = 20;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const TAG = /^(latest|earliest|pending|safe|finalized|0x[0-9a-fA-F]{1,16})$/;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Quantities in the answers are decimal strings. */
const dec = (v) => (v === null || v === undefined ? '' : BigInt(v).toString());
const int = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
};

/** Which RPC calls a GET request costs: a page of history counts as more than one balance. */
export const COST = { txlist: 5, tokentx: 5, getminedblocks: 5, getLogs: 5, getblocknobytime: 3, balancemulti: 2 };

/**
 * @param {URLSearchParams} q
 * @param {(method: string, params?: unknown[]) => Promise<unknown>} call the node's own RPC methods; throws on an RPC error
 */
export async function restApi(q, call) {
  const module = q.get('module');
  const action = q.get('action');
  const address = q.get('address');
  const page = int(q.get('page'), 1);
  const offset = Math.min(MAX_OFFSET, int(q.get('offset'), 10));
  if (Number.isNaN(page) || page < 1 || Number.isNaN(offset) || offset < 1) return FAIL('Invalid page or offset');
  const sortAsc = (q.get('sort') ?? 'asc') !== 'desc';
  const head = async () => BigInt(await call('eth_blockNumber'));
  const needAddress = () => { if (!ADDRESS.test(address ?? '')) throw new UserError('Invalid address format'); return address; };
  const tag = () => { const t = q.get('tag') ?? 'latest'; if (!TAG.test(t)) throw new UserError('Invalid tag'); return t; };

  try {
    switch (`${module}.${action}`) {
      case 'account.balance': return OK(dec(await call('eth_getBalance', [needAddress(), tag()])));
      case 'account.balancemulti': {
        const list = String(address ?? '').split(',').map((a) => a.trim()).filter(Boolean);
        if (!list.length || list.length > MAX_MULTI || !list.every((a) => ADDRESS.test(a))) return FAIL(`Up to ${MAX_MULTI} valid addresses separated by commas`);
        const t = tag();
        return OK(await Promise.all(list.map(async (a) => ({ account: a, balance: dec(await call('eth_getBalance', [a, t])) }))));
      }
      case 'account.txlist': {
        const r = await call('aether_txs', [{
          address: needAddress(), fromBlock: int(q.get('startblock'), undefined), toBlock: int(q.get('endblock'), undefined),
          order: sortAsc ? 'asc' : 'desc', limit: offset, offset: (page - 1) * offset,
        }]);
        if (!r.items.length) return EMPTY('transactions');
        const top = await head();
        return OK(r.items.map((tx) => {
          const failed = tx.status === '0x0' || tx.status === 0 || tx.status === false;
          return {
            blockNumber: dec(tx.blockNumber), timeStamp: String(tx.timestamp), hash: tx.hash, nonce: dec(tx.nonce), blockHash: tx.blockHash,
            transactionIndex: dec(tx.transactionIndex), from: tx.from, to: tx.to ?? '', value: dec(tx.value), gas: dec(tx.gas),
            gasPrice: dec(tx.gasPrice), isError: failed ? '1' : '0', txreceipt_status: failed ? '0' : '1', input: tx.input,
            contractAddress: tx.creates ?? '', cumulativeGasUsed: '', gasUsed: dec(tx.gasUsed),
            confirmations: String(top - BigInt(tx.blockNumber) + 1n), methodId: tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : '0x', functionName: '',
          };
        }));
      }
      case 'account.tokentx': {
        const contract = q.get('contractaddress');
        if (contract && !ADDRESS.test(contract)) return FAIL('Invalid contract address format');
        if (!contract && !address) return FAIL('Missing address or contractaddress');
        // The node keeps both indexes newest first; a page is read and filtered, never the whole history.
        const r = address ? await call('aether_addressTransfers', [needAddress(), offset, (page - 1) * offset]) : await call('aether_tokenTransfers', [contract, offset, (page - 1) * offset]);
        let rows = (r.items ?? []).map((x) => ({ ...x, token: x.token ?? contract })).filter((x) => x.value !== undefined);
        if (contract) rows = rows.filter((x) => x.token.toLowerCase() === contract.toLowerCase());
        if (sortAsc) rows.reverse();
        if (!rows.length) return EMPTY('transactions');
        const top = await head();
        const meta = new Map();
        for (const token of new Set(rows.map((x) => x.token.toLowerCase()))) meta.set(token, await tokenMeta(call, token));
        return OK(rows.map((x) => {
          const m = meta.get(x.token.toLowerCase());
          return {
            blockNumber: String(x.number), timeStamp: String(x.timestamp), hash: x.hash, from: x.from, to: x.to, value: x.value,
            contractAddress: x.token, tokenName: m.name, tokenSymbol: m.symbol, tokenDecimal: m.decimals, confirmations: String(top - BigInt(x.number) + 1n),
          };
        }));
      }
      case 'account.tokenbalance': {
        const contract = q.get('contractaddress');
        if (!ADDRESS.test(contract ?? '')) return FAIL('Invalid contract address format');
        const data = `0x70a08231${needAddress().slice(2).toLowerCase().padStart(64, '0')}`;
        return OK(dec(await call('eth_call', [{ to: contract, data }, tag()])));
      }
      case 'account.getminedblocks': {
        const r = await call('aether_blocks', [{ miner: needAddress(), order: sortAsc ? 'asc' : 'desc', limit: offset, offset: (page - 1) * offset }]);
        if (!r.items.length) return EMPTY('blocks');
        return OK(r.items.map((b) => ({ blockNumber: String(b.number), timeStamp: String(b.timestamp), blockReward: b.income })));
      }
      case 'transaction.getstatus':
      case 'transaction.gettxreceiptstatus': {
        const hash = q.get('txhash');
        if (!HASH.test(hash ?? '')) return FAIL('Invalid transaction hash');
        const rc = await call('eth_getTransactionReceipt', [hash]);
        if (action === 'gettxreceiptstatus') return OK({ status: rc ? (rc.status === '0x1' ? '1' : '0') : '' });
        if (!rc || rc.status === '0x1') return OK({ isError: '0', errDescription: '' });
        const reason = await call('aether_txError', [hash]).catch(() => null);
        return OK({ isError: '1', errDescription: typeof reason === 'string' ? reason : reason?.message ?? 'Reverted' });
      }
      case 'block.getblockreward': {
        const n = int(q.get('blockno'), NaN);
        if (Number.isNaN(n)) return FAIL('Invalid block number');
        const r = await call('aether_blockIncome', [`0x${n.toString(16)}`]);
        const b = await call('eth_getBlockByNumber', [`0x${n.toString(16)}`, false]);
        return OK({ blockNumber: String(r.number), timeStamp: dec(b.timestamp), blockMiner: r.miner, blockReward: r.total, uncles: [], uncleInclusionReward: '0' });
      }
      case 'block.getblocknobytime': {
        const ts = int(q.get('timestamp'), NaN);
        if (Number.isNaN(ts)) return FAIL('Invalid timestamp');
        const after = q.get('closest') === 'after';
        const time = async (n) => Number(BigInt((await call('eth_getBlockByNumber', [`0x${n.toString(16)}`, false])).timestamp));
        let lo = 0;
        let hi = Number(await head());
        if (after ? (await time(hi)) < ts : (await time(0)) > ts) return FAIL('No closest block found');
        while (lo < hi) {        // the last block at or before the time, or the first at or after it
          const mid = after ? Math.floor((lo + hi) / 2) : Math.ceil((lo + hi) / 2);
          if (after ? (await time(mid)) >= ts : (await time(mid)) <= ts) { if (after) hi = mid; else lo = mid; } else if (after) lo = mid + 1; else hi = mid - 1;
        }
        return OK(String(lo));
      }
      case 'block.getblockcountdown': {
        const n = int(q.get('blockno'), NaN);
        if (Number.isNaN(n)) return FAIL('Invalid block number');
        const now = Number(await head());
        if (n <= now) return FAIL('Block number already pass');
        const stats = await call('aether_stats');
        return OK({ CurrentBlock: String(now), CountdownBlock: String(n), RemainingBlock: String(n - now), EstimateTimeInSec: String((n - now) * Number(stats.blockTimeTarget ?? 15)) });
      }
      case 'logs.getLogs': {
        const filter = { fromBlock: blockTag(q.get('fromBlock'), 'earliest'), toBlock: blockTag(q.get('toBlock'), 'latest') };
        if (address) filter.address = needAddress();
        const topics = [0, 1, 2, 3].map((i) => q.get(`topic${i}`) ?? null);
        if (topics.some((t) => t && !HASH.test(t))) return FAIL('Invalid topic');
        while (topics.length && topics[topics.length - 1] === null) topics.pop();
        if (topics.length) filter.topics = topics;
        const logs = await call('eth_getLogs', [filter]);
        if (!logs.length) return EMPTY('records');
        const from = (page - 1) * offset;
        const times = new Map();
        const rows = [];
        for (const l of logs.slice(from, from + offset)) {
          if (!times.has(l.blockNumber)) times.set(l.blockNumber, (await call('eth_getBlockByNumber', [l.blockNumber, false])).timestamp);
          rows.push({ address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber, timeStamp: times.get(l.blockNumber), logIndex: l.logIndex, transactionHash: l.transactionHash, transactionIndex: l.transactionIndex });
        }
        return OK(rows);
      }
      case 'stats.ethsupply':
      case 'stats.coinsupply': return OK(String((await call('aether_stats')).supply));
      case 'stats.nodecount': {
        const s = await call('aether_stats');
        return OK({ UTCDate: new Date().toISOString().slice(0, 10), TotalNodeCount: String(s.peers + 1) });
      }
      case 'stats.ethprice': return FAIL('Quinvium has no price feed; prices come from pools on the chain');
      case 'gastracker.gasoracle': {
        const [e, n] = await Promise.all([call('aether_feeEstimates'), head()]);
        const gwei = (wei) => (Number(BigInt(wei)) / 1e9).toString();
        const base = BigInt(e.baseFee);
        return OK({
          LastBlock: String(n), SafeGasPrice: gwei(base + BigInt(e.tiers.slow.tip)), ProposeGasPrice: gwei(base + BigInt(e.tiers.normal.tip)),
          FastGasPrice: gwei(base + BigInt(e.tiers.fast.tip)), suggestBaseFee: gwei(base), gasUsedRatio: String(e.fullness ?? ''),
        });
      }
      default:
        if (module === 'proxy') return proxy(action, q, call);
        return FAIL('Unknown module or action. See /api in the Explorer for the list.');
    }
  } catch (e) {
    return FAIL(e instanceof UserError ? e.message : `Query failed: ${String(e.message ?? e).slice(0, 200)}`);
  }
}

class UserError extends Error {}

function blockTag(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (/^(latest|earliest)$/.test(v)) return v;
  const n = int(v, NaN);
  if (Number.isNaN(n)) throw new UserError('Invalid block number');
  return `0x${n.toString(16)}`;
}

const tokenCache = new Map();
/** Name, symbol and decimals of a token, read from the contract. Missing values stay empty. */
async function tokenMeta(call, token) {
  if (tokenCache.has(token)) return tokenCache.get(token);
  const read = async (selector) => call('eth_call', [{ to: token, data: selector }, 'latest']).catch(() => '0x');
  const text = (hex) => {
    try {
      const b = Buffer.from(String(hex).slice(2), 'hex');
      if (b.length >= 96) return b.subarray(64, 64 + Number(b.readBigUInt64BE(56))).toString('utf8').replace(/[^\x20-\x7e -￿]/g, '').slice(0, 64);
      return b.toString('utf8').replace(/\0+$/g, '').slice(0, 64);
    } catch { return ''; }
  };
  const [name, symbol, decimals] = await Promise.all([read('0x06fdde03'), read('0x95d89b41'), read('0x313ce567')]);
  const meta = { name: text(name), symbol: text(symbol), decimals: decimals && decimals !== '0x' ? BigInt(decimals).toString() : '' };
  if (tokenCache.size > 1000) tokenCache.clear();
  tokenCache.set(token, meta);
  return meta;
}

/** proxy module: the read-only JSON-RPC methods with the usual parameter names (tag, txhash, to, data …). */
const PROXY = {
  eth_blockNumber: () => [],
  eth_getBlockByNumber: (q) => [q.get('tag') ?? 'latest', q.get('boolean') === 'true'],
  eth_getBlockTransactionCountByNumber: (q) => [q.get('tag') ?? 'latest'],
  eth_getTransactionByHash: (q) => [q.get('txhash')],
  eth_getTransactionByBlockNumberAndIndex: (q) => [q.get('tag') ?? 'latest', q.get('index') ?? '0x0'],
  eth_getTransactionCount: (q) => [q.get('address'), q.get('tag') ?? 'latest'],
  eth_getTransactionReceipt: (q) => [q.get('txhash')],
  eth_call: (q) => [{ to: q.get('to'), data: q.get('data') ?? '0x' }, q.get('tag') ?? 'latest'],
  eth_getCode: (q) => [q.get('address'), q.get('tag') ?? 'latest'],
  eth_getStorageAt: (q) => [q.get('address'), q.get('position') ?? '0x0', q.get('tag') ?? 'latest'],
  eth_gasPrice: () => [],
  eth_estimateGas: (q) => [Object.fromEntries(['to', 'data', 'value', 'gas', 'gasPrice', 'from'].filter((k) => q.get(k)).map((k) => [k, q.get(k)]))],
};

async function proxy(action, q, call) {
  const params = PROXY[action];
  if (!params) return { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unsupported proxy action (the API is read-only)' } };
  try {
    return { jsonrpc: '2.0', id: 1, result: await call(action, params(q)) };
  } catch (e) {
    return { jsonrpc: '2.0', id: 1, error: { code: -32000, message: String(e.message ?? e).slice(0, 200) } };
  }
}

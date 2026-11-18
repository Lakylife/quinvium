// Mining pools: the rules are enforced by a contract from the network's factory; the operator cannot reach the rewards.
import { ethers } from 'ethers';
import { CliError, pairs, rate, table, units } from './context.js';
import { L } from './i18n.js';
import { encode, submit } from './tx.js';
import { walletAddress } from './wallets.js';

const LIST_LIMIT = 100;
const SECONDS_PER_BLOCK = 15;
const MAX_FEE_PCT = 5;

/** The rules are guaranteed only for a pool from the factory. A foreign contract can look the same and keep the rewards. */
export async function factoryPool(ctx, text) {
  await ctx.connect();
  if (!ethers.isAddress(text ?? '')) throw new CliError(L('Zadejte adresu poolu.', 'Give the pool address.'));
  // The node checks the built-in factory and version 2 factories with verified code; an older node knows only the first.
  const version = await ctx.rpc('aether_poolVersion', [text]).catch(() => null);
  if (version === 2) return ctx.at('AetherPool2', ethers.getAddress(text));
  const count = Number(await ctx.at('PoolFactory').poolCount());
  const known = await ctx.at('PoolFactory').list(0, count);
  const address = known.find((a) => a.toLowerCase() === text.toLowerCase());
  if (!address) throw new CliError(L('Tato adresa není pool z továrny sítě. Netěžte do ní.', 'This address is not a pool from the network factory. Do not mine into it.'));
  return ctx.at('AetherPool', address);
}

const minutes = (round, window) => Math.round((Number(round) * Number(window) * SECONDS_PER_BLOCK) / 60);

async function list(ctx) {
  await ctx.connect();
  const found = [...await ctx.at('PoolFactory').list(0, LIST_LIMIT)];
  // Version 2 pools come from factories the node verified.
  const listed = await ctx.rpc('aether_pools', [{ limit: LIST_LIMIT }]).catch(() => null);
  for (const p of listed?.items ?? []) if (p.version === 2) found.push(ethers.getAddress(p.address));
  const rows = await Promise.all(found.map(async (address) => {
    const c = ctx.at('AetherPool', address);
    const [name, url, fee, paid] = await Promise.all([c.name(), c.url(), c.feeBps(), c.totalPaid()]);
    return { address, name, url, feePercent: Number(fee) / 100, paid };
  }));
  ctx.print(rows, rows.length ? table([L('Název', 'Name'), L('Poplatek', 'Fee'), L('Vyplaceno', 'Paid out'), L('Adresa', 'Address'), 'Server'], rows.map((r) => [r.name, `${r.feePercent} %`, `${units(r.paid, 18, 4)} ${ctx.symbol}`, r.address, r.url]), [1, 2]) : L('Zatím tu žádný pool není. Založí ho: quinvium pool create', 'There is no pool yet. Create one with: quinvium pool create'));
}

async function info(ctx, [address, miner]) {
  const c = await factoryPool(ctx, address);
  const [name, url, operator, fee, round, window, paid, unsettled, reserved, opFee] = await Promise.all([c.name(), c.url(), c.operator(), c.feeBps(), c.roundBlocks(), c.windowRounds(), c.totalPaid(), c.unsettled(), c.reserved(), c.operatorOwed()]);
  const who = miner ?? (ctx.opts.wallet || !ctx.opts.json ? safeAddress(ctx) : null);
  const rows = [['Pool', name], [L('Adresa', 'Address'), c.target], ['Server', url || L('neuveden', 'not given')], [L('Provozovatel', 'Operator'), operator], [L('Poplatek', 'Fee'), `${Number(fee) / 100} %`], [L('Dělí se za posledních', 'Shared over the last'), `${minutes(round, window)} min`],
    [L('Vyplaceno těžařům', 'Paid to miners'), `${units(paid, 18, 4)} ${ctx.symbol}`], [L('Čeká na rozdělení', 'Waiting to be shared'), `${units(unsettled, 18, 4)} ${ctx.symbol}`], [L('Patří těžařům', 'Owed to miners'), `${units(reserved, 18, 4)} ${ctx.symbol}`], [L('Poplatek k výběru', 'Fee to withdraw'), `${units(opFee, 18, 4)} ${ctx.symbol}`]];
  const data = { address: c.target, name, url, operator, feeBps: fee, roundBlocks: round, windowRounds: window, totalPaid: paid, unsettled, reserved, operatorOwed: opFee };
  if (who) {
    const [pending, work, paidTo] = await Promise.all([c.pendingOf(who), c.windowWork(who), c.paidTo(who)]);
    const share = work[0] ? Number((work[1] * 10000n) / work[0]) / 100 : 0;
    rows.push([L('Vaše adresa', 'Your address'), who], [L('K výběru', 'To claim'), `${units(pending)} ${ctx.symbol}`], [L('Podíl v okně', 'Share in the window'), `${share} %`], [L('Už vyplaceno', 'Paid so far'), `${units(paidTo, 18, 4)} ${ctx.symbol}`]);
    Object.assign(data, { miner: who, pending, share, paidTo });
  }
  ctx.print(data, pairs(rows));
}

function safeAddress(ctx) {
  try { return walletAddress(ctx); } catch { return null; }
}

async function claim(ctx, [address]) {
  const c = await factoryPool(ctx, address);
  const me = walletAddress(ctx);
  const pending = await c.pendingOf(me);
  if (pending === 0n) throw new CliError(L('V tomto poolu teď nemáte nic k výběru.', 'You have nothing to claim in this pool right now.'));
  ctx.print(await submit(ctx, { to: c.target, data: encode(c, 'claim', [me]) }, [[L('Výběr z poolu', 'Claim from pool'), `${units(pending)} ${ctx.symbol}`], [L('Na adresu', 'To address'), me]]), L('Vyplaceno.', 'Paid out.'));
}

async function create(ctx) {
  await ctx.connect();
  const { name, url } = ctx.opts;
  if (!name) throw new CliError(L('Použití: quinvium pool create --name <název> --url http://server:port [--fee-percent 1] [--round 32] [--window 16]', 'Usage: quinvium pool create --name <name> --url http://server:port [--fee-percent 1] [--round 32] [--window 16]'));
  const pct = Number(String(ctx.opts['fee-percent'] ?? 1).replace(',', '.'));
  if (!(pct >= 0 && pct <= MAX_FEE_PCT)) throw new CliError(L(`Poplatek smí být nejvýše ${MAX_FEE_PCT} %.`, `The fee can be at most ${MAX_FEE_PCT}%.`));
  const round = BigInt(ctx.opts.round ?? 32);
  const window = BigInt(ctx.opts.window ?? 16);
  const factory = ctx.at('PoolFactory');
  const data = encode(factory, 'createPool', [name, url ?? '', BigInt(Math.round(pct * 100)), round, window]);
  const lines = [['Pool', name], ['Server', url ?? L('neuveden', 'not given')], [L('Poplatek', 'Fee'), L(`${pct} %, po založení nejde změnit`, `${pct}%, cannot be changed later`)], [L('Dělí se za posledních', 'Shared over the last'), `${minutes(round, window)} min`]];
  const result = await submit(ctx, { to: factory.target, data }, lines);
  const created = result.logs?.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(Boolean);
  const address = created?.args?.pool ?? created?.args?.[0];
  ctx.print({ ...result, pool: address }, L(`Pool je založený: ${address}\nSpusťte jeho server: quinvium node --network ${ctx.networkName} --pool ${address} --stratum-host 0.0.0.0\nA pošlete malou částku na účet na gas, platí se z něj podíly a výplaty.`,
    `The pool is created: ${address}\nStart its server: quinvium node --network ${ctx.networkName} --pool ${address} --stratum-host 0.0.0.0\nThen send a small amount to its gas account, shares and payouts are paid from it.`));
}

async function withdrawFee(ctx, [address]) {
  const c = await factoryPool(ctx, address);
  if ((await c.operator()).toLowerCase() !== walletAddress(ctx).toLowerCase()) throw new CliError(L('Poplatek smí vybrat jen provozovatel poolu.', 'Only the pool operator can withdraw the fee.'));
  ctx.print(await submit(ctx, { to: c.target, data: encode(c, 'withdrawFee', []) }, [[L('Výběr poplatku', 'Fee withdrawal'), `${units(await c.operatorOwed())} ${ctx.symbol}`]]), L('Vyplaceno.', 'Paid out.'));
}

const COMMANDS = { list, info, claim, create, 'withdraw-fee': withdrawFee };

export async function pool(ctx, [sub = 'list', ...rest]) {
  const fn = COMMANDS[sub];
  if (!fn) throw new CliError(L(`Možnosti: quinvium pool ${Object.keys(COMMANDS).join(', ')}`, `Options: quinvium pool ${Object.keys(COMMANDS).join(', ')}`));
  await fn(ctx, rest);
}

export { rate };

// Balances, transfers, tokens and Swap.
import { ethers } from 'ethers';
import { tokenApp } from './apps.js';
import { CliError, SWAP_DEADLINE_S, amountText, pairs, parseAmount, sameAddress, short, significant, table, units } from './context.js';
import { L } from './i18n.js';
import { approve, confirm, encode, submit } from './tx.js';
import { walletAddress } from './wallets.js';

const HIGH_IMPACT = 0.05;
const DEFAULT_SLIPPAGE_PCT = '0.5';
const MAX_SLIPPAGE_PCT = 50;
const POOL_PAGE = 100;
const QUOTE_PROBE = 1000n;

const deadline = () => Math.floor(Date.now() / 1000) + SWAP_DEADLINE_S;

/** Symbol of the token in a pool. The wrapped coin is shown as the network coin because Swap wraps and unwraps it itself. */
const symbolOf = (ctx, list, address) => (sameAddress(address, ctx.contracts.WAET.address) ? ctx.symbol : list.find((t) => sameAddress(t.address, address))?.symbol ?? short(address));
const decimalsOf = (list, address) => list.find((t) => sameAddress(t.address, address))?.decimals ?? 18;

export async function balance(ctx, [who]) {
  await ctx.connect();
  const a = who ? await ctx.address(who) : walletAddress(ctx);
  const coin = await ctx.provider.getBalance(a);
  const list = ctx.opts.token ? [await ctx.token(ctx.opts.token)] : await ctx.tokens();
  const held = (await Promise.all(list.filter((t) => !t.native).map(async (t) => ({ ...t, balance: await ctx.at('AetherToken', t.address).balanceOf(a) })))).filter((t) => ctx.opts.token || t.balance > 0n);
  const data = { address: a, [ctx.symbol]: units(coin, 18, 18), tokens: held.map((t) => ({ symbol: t.symbol, address: t.address, balance: units(t.balance, t.decimals, t.decimals), verified: t.verified })) };
  if (ctx.opts.json) { ctx.print(data); return; }
  console.log(`${L('Adresa', 'Address')}: ${a}\n`);
  console.log(table([L('Mince', 'Coin'), L('Zůstatek', 'Balance')], [[ctx.symbol, units(coin)], ...held.map((t) => [`${t.symbol}${t.verified ? '' : L(' (neověřený)', ' (unverified)')}`, units(t.balance, t.decimals)])], [1]));
}

export async function send(ctx, [to, amount]) {
  if (!to || !amount) throw new CliError(L('Použití: quinvium send <adresa> <částka> [--token symbol]', 'Usage: quinvium send <address> <amount> [--token symbol]'));
  await ctx.connect();
  const target = await ctx.address(to);
  const token = ctx.opts.token ? await ctx.token(ctx.opts.token) : ctx.native();
  const value = parseAmount(amount, token.decimals);
  const lines = [[L('Od', 'From'), walletAddress(ctx)], [L('Komu', 'To'), target], [L('Částka', 'Amount'), `${units(value, token.decimals, token.decimals)} ${token.symbol}`], [L('Síť', 'Network'), ctx.networkName]];
  if (!token.verified) lines.push([L('Pozor', 'Warning'), L('token není na ověřeném seznamu, jeho název nic nedokazuje', 'the token is not on the verified list, its name proves nothing')]);
  const sent = L('Odesláno.', 'Sent.');
  if (!token.native) {
    const c = ctx.at('AetherToken', token.address);
    const have = await c.balanceOf(walletAddress(ctx));
    if (have < value) throw new CliError(L(`Nedostatek ${token.symbol}: je k dispozici ${units(have, token.decimals)}.`, `Not enough ${token.symbol}: ${units(have, token.decimals)} is available.`));
    ctx.print(await submit(ctx, { to: token.address, data: encode(c, 'transfer', [target, value]) }, lines), sent);
    return;
  }
  ctx.print(await submit(ctx, { to: target, value }, lines), sent);
}

/** Token price from the pool with Quinvium. No pool, no price. */
async function poolWithCoin(ctx, d, token) {
  if (!d?.swap?.factory) return null;
  const address = await ctx.at('SwapFactory', d.swap.factory).getPair(token.address, ctx.contracts.WAET.address).catch(() => ethers.ZeroAddress);
  if (address === ethers.ZeroAddress) return null;
  const pair = ctx.at('SwapPair', address);
  const [first, r] = await Promise.all([pair.token0(), pair.getReserves()]);
  const [own, coin] = first.toLowerCase() === token.address.toLowerCase() ? [r[0], r[1]] : [r[1], r[0]];
  return own ? { address, reserveCoin: coin, price: (coin * 10n ** BigInt(token.decimals)) / own } : null;
}

/** An older node does not know token statistics. The tool must not fail because of that; it just does not show them. */
const tokenInfo = (ctx, t) => ctx.rpc('aether_tokenInfo', [t.address]).catch(() => ({ holders: '—', transfers: '—', top: [], complete: false }));

export async function tokens(ctx) {
  await ctx.connect();
  const d = await ctx.deployment();
  const list = await ctx.tokens();
  const rows = await Promise.all(list.map(async (t) => {
    const [supply, info, pool] = await Promise.all([ctx.at('AetherToken', t.address).totalSupply(), tokenInfo(ctx, t), poolWithCoin(ctx, d, t)]);
    return { ...t, supply, holders: info.holders, transfers: info.transfers, price: pool?.price ?? null };
  }));
  ctx.print(rows, rows.length
    ? table(['Token', L('Cena', 'Price'), L('V oběhu', 'Supply'), L('Držitelé', 'Holders'), L('Převody', 'Transfers'), L('Adresa', 'Address')], rows.map((t) => [t.symbol, t.price === null ? '—' : `${significant(t.price, 18, 6)} ${ctx.symbol}`, units(t.supply, t.decimals, 2), t.holders, t.transfers, t.address]), [1, 2, 3, 4])
    : L('Na této síti zatím nejsou ověřené tokeny.', 'There are no verified tokens on this network yet.'));
}

const TOKEN_USAGE = () => L(`Tokeny:

  quinvium tokens                              ověřené tokeny s cenou, držiteli a převody
  quinvium token <symbol|adresa>               detail tokenu
  quinvium token create <název> <zkratka> <počet>   vlastní token s pevným počtem, všechny dostanete vy
  quinvium token created [adresa]              tokeny, které adresa vytvořila
  quinvium send <adresa> <částka> --token <symbol|adresa>   převod tokenu`, `Tokens:

  quinvium tokens                              verified tokens with price, holders and transfers
  quinvium token <symbol|address>              token details
  quinvium token create <name> <symbol> <supply>    your own token with a fixed supply, all of it goes to you
  quinvium token created [address]             tokens created by the address
  quinvium send <address> <amount> --token <symbol|address>   send a token`);

export async function token(ctx, [text, ...rest]) {
  if (text === 'create') { await tokenApp.create(ctx, rest); return; }
  if (text === 'created') { await tokenApp.created(ctx, rest); return; }
  if (!text || text === 'help' || ctx.opts.help) { console.log(TOKEN_USAGE()); return; }
  const t = await ctx.token(text);
  if (t.native) throw new CliError(L(`${ctx.symbol} je nativní mince sítě, zůstatek zobrazí: quinvium balance`, `${ctx.symbol} is the native coin of the network, see your balance with: quinvium balance`));
  const d = await ctx.deployment();
  const [supply, info, pool] = await Promise.all([ctx.at('AetherToken', t.address).totalSupply(), tokenInfo(ctx, t), poolWithCoin(ctx, d, t)]);
  const text2 = [pairs([['Token', `${t.name} (${t.symbol})`], [L('Adresa', 'Address'), t.address], [L('Stav', 'Status'), t.verified ? L('ověřený', 'verified') : L('NEOVĚŘENÝ, název ani zkratka nic nedokazují', 'UNVERIFIED, its name and symbol prove nothing')],
    [L('Vydavatel', 'Issuer'), t.issuer], [L('Desetinná místa', 'Decimals'), t.decimals], [L('V oběhu', 'Supply'), units(supply, t.decimals, t.decimals)], [L('Držitelé', 'Holders'), info.holders], [L('Převody', 'Transfers'), info.transfers],
    [L('Cena', 'Price'), pool ? `${significant(pool.price, 18, 8)} ${ctx.symbol}` : L('bez poolu, není známá', 'no pool, unknown')]])];
  if (info.top.length) text2.push('', table([L('Největší držitelé', 'Top holders'), L('Zůstatek', 'Balance')], info.top.slice(0, 10).map((h) => [h.address, units(h.balance, t.decimals, 4)]), [1]));
  ctx.print({ ...t, supply, ...info, price: pool?.price ?? null }, text2.join('\n'));
}
token.usage = TOKEN_USAGE;

// ------------------------------------------------------------------- Swap
async function swapSetup(ctx) {
  await ctx.connect();
  const d = await ctx.deployment();
  if (!d?.swap?.router) throw new CliError(L('Swap na této síti ještě neběží.', 'Swap does not run on this network yet.'));
  return d;
}

/** A direct pool, otherwise the path through the network coin. The same as on the Swap page. */
async function bestRoute(ctx, router, a, b, amount) {
  const hub = ctx.contracts.WAET.address;
  const paths = [[a.address, b.address]];
  if (!sameAddress(a.address, hub) && !sameAddress(b.address, hub)) paths.push([a.address, hub, b.address]);
  const quotes = await Promise.all(paths.map((path) => router.getAmountsOut(amount, path).then((out) => ({ path, out: out[out.length - 1] })).catch(() => null)));
  return quotes.filter(Boolean).sort((x, y) => (x.out < y.out ? 1 : -1))[0] ?? null;
}

function slippageBps(ctx) {
  const pct = Number(String(ctx.opts.slippage ?? DEFAULT_SLIPPAGE_PCT).replace(',', '.'));
  if (!(pct >= 0 && pct <= MAX_SLIPPAGE_PCT)) throw new CliError(L(`Skluz --slippage musí být mezi 0 a ${MAX_SLIPPAGE_PCT} %.`, `The slippage --slippage must be between 0 and ${MAX_SLIPPAGE_PCT}%.`));
  return BigInt(Math.round(pct * 100));
}

async function quote(ctx, d, amountText2, fromText, toText) {
  const [a, b] = await Promise.all([ctx.token(fromText), ctx.token(toText)]);
  if (sameAddress(a.address, b.address)) throw new CliError(L('Zvolte dva různé tokeny.', 'Choose two different tokens.'));
  const router = ctx.at('SwapRouter', d.swap.router);
  const amount = parseAmount(amountText2, a.decimals);
  if (amount === 0n) throw new CliError(L('Částka musí být větší než nula.', 'The amount must be greater than zero.'));
  const found = await bestRoute(ctx, router, a, b, amount);
  if (!found) throw new CliError(L(`Pro dvojici ${a.symbol} a ${b.symbol} zatím není pool.`, `There is no pool for ${a.symbol} and ${b.symbol} yet.`));
  const probe = amount / QUOTE_PROBE || 1n;
  const small = await bestRoute(ctx, router, a, b, probe);
  const spot = small ? Number(small.out) / Number(probe) : 0;
  const impact = spot > 0 ? Math.max(0, 1 - Number(found.out) / Number(amount) / spot) : 0;
  const bps = slippageBps(ctx);
  const minimum = found.out - (found.out * bps) / 10000n;
  const list = await ctx.tokens();
  const names = found.path.map((address) => symbolOf(ctx, list, address));
  const lines = [[L('Směna', 'Swap'), `${units(amount, a.decimals, a.decimals)} ${a.symbol} → ${units(found.out, b.decimals)} ${b.symbol}`],
    [L('Nejméně dostanete', 'You get at least'), L(`${units(minimum, b.decimals)} ${b.symbol} (skluz ${Number(bps) / 100} %)`, `${units(minimum, b.decimals)} ${b.symbol} (slippage ${Number(bps) / 100}%)`)],
    [L('Dopad na cenu', 'Price impact'), `${(impact * 100).toFixed(2)} %${impact > HIGH_IMPACT ? L(', VELKÝ, pool je pro tuto částku malý', ', HIGH, the pool is small for this amount') : ''}`],
    [L('Poplatek poolu', 'Pool fee'), `${(0.3 * (found.path.length - 1)).toFixed(1)} %`], [L('Cesta', 'Route'), names.join(' → ')]];
  return { a, b, amount, out: found.out, minimum, path: found.path, impact, lines, router };
}

async function swapPools(ctx, d) {
  const list = await ctx.tokens();
  const name = (address) => symbolOf(ctx, list, address);
  const pairsList = await ctx.at('SwapFactory', d.swap.factory).list(0, POOL_PAGE);
  const rows = await Promise.all([...pairsList].map(async (address) => {
    const pair = ctx.at('SwapPair', address);
    const [t0, t1, r] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
    return { address, pair: `${name(t0)} / ${name(t1)}`, reserve0: `${amountText(r[0], decimalsOf(list, t0), 4)} ${name(t0)}`, reserve1: `${amountText(r[1], decimalsOf(list, t1), 4)} ${name(t1)}` };
  }));
  ctx.print(rows, rows.length ? table([L('Dvojice', 'Pair'), L('Zásoba', 'Reserve'), L('Zásoba', 'Reserve'), 'Pool'], rows.map((r) => [r.pair, r.reserve0, r.reserve1, r.address])) : L('Zatím tu není žádný pool.', 'There is no pool yet.'));
}

export async function swap(ctx, args) {
  const d = await swapSetup(ctx);
  if (args[0] === 'pools') { await swapPools(ctx, d); return; }
  const preview = args[0] === 'quote';
  const [amount, from, to] = preview ? args.slice(1) : args;
  if (!amount || !from || !to) throw new CliError(L('Použití: quinvium swap [quote] <částka> <z> <na>   nebo   quinvium swap pools', 'Usage: quinvium swap [quote] <amount> <from> <to>   or   quinvium swap pools'));
  const q = await quote(ctx, d, amount, from, to);
  if (preview) {
    ctx.print({ amountIn: q.amount, amountOut: q.out, minimum: q.minimum, path: q.path, impact: q.impact }, pairs(q.lines));
    return;
  }
  ctx.note(pairs(q.lines));
  await confirm(ctx, L('Směnit?', 'Swap?'));
  const me = walletAddress(ctx);
  const router = q.router;
  let request;
  if (q.a.native) request = { to: router.target, value: q.amount, data: encode(router, 'swapExactNativeForTokens', [q.minimum, q.path, me, deadline()]) };
  else {
    await approve(ctx, q.a, router.target, q.amount);
    request = { to: router.target, data: q.b.native ? encode(router, 'swapExactTokensForNative', [q.amount, q.minimum, q.path, me, deadline()]) : encode(router, 'swapExactTokensForTokens', [q.amount, q.minimum, q.path, me, deadline()]) };
  }
  ctx.print(await submit(ctx, request, [], { confirmed: true, label: L('Směna', 'Swap') }), L('Směna proběhla.', 'The swap is done.'));
}

/** An existing pool accepts deposits only in its ratio. The surplus stays in the wallet, otherwise the contract would reject the deposit. */
async function fitToPool(ctx, d, a, b, x, y) {
  const address = await ctx.at('SwapFactory', d.swap.factory).getPair(a.address, b.address);
  if (address === ethers.ZeroAddress) return [x, y];
  const pair = ctx.at('SwapPair', address);
  const [first, r] = await Promise.all([pair.token0(), pair.getReserves()]);
  const [ra, rb] = first.toLowerCase() === a.address.toLowerCase() ? [r[0], r[1]] : [r[1], r[0]];
  if (ra === 0n || rb === 0n) return [x, y];
  const needB = (x * rb) / ra;
  return needB <= y ? [x, needB] : [(y * ra) / rb, y];
}

export async function liquidity(ctx, [sub, ...args]) {
  const d = await swapSetup(ctx);
  const router = ctx.at('SwapRouter', d.swap.router);
  const me = walletAddress(ctx);
  if (sub === 'add') {
    const [amountA, tokenA, amountB, tokenB] = args;
    if (!tokenB) throw new CliError(L('Použití: quinvium liquidity add <částka> <token> <částka> <token>', 'Usage: quinvium liquidity add <amount> <token> <amount> <token>'));
    const [a, b] = await Promise.all([ctx.token(tokenA), ctx.token(tokenB)]);
    if (sameAddress(a.address, b.address)) throw new CliError(L('Zvolte dva různé tokeny.', 'Choose two different tokens.'));
    const asked = [parseAmount(amountA, a.decimals), parseAmount(amountB, b.decimals)];
    const [x, y] = await fitToPool(ctx, d, a, b, asked[0], asked[1]);
    const floor = (v) => v - (v * slippageBps(ctx)) / 10000n;
    ctx.note(pairs([[L('Vklad', 'Deposit'), L(`${units(x, a.decimals)} ${a.symbol} a ${units(y, b.decimals)} ${b.symbol}`, `${units(x, a.decimals)} ${a.symbol} and ${units(y, b.decimals)} ${b.symbol}`)],
      [L('Pozor', 'Note'), L('když se kurz změní, může být vklad méně než při prostém držení mincí', 'if the rate changes, the deposit can be worth less than simply holding the coins')]]));
    await confirm(ctx, L('Přidat do poolu?', 'Add to the pool?'));
    let request;
    if (a.native || b.native) {
      const [other, amountOther, coin] = a.native ? [b, y, x] : [a, x, y];
      await approve(ctx, other, router.target, amountOther);
      request = { to: router.target, value: coin, data: encode(router, 'addLiquidityNative', [other.address, amountOther, floor(amountOther), floor(coin), me, deadline()]) };
    } else {
      await approve(ctx, a, router.target, x);
      await approve(ctx, b, router.target, y);
      request = { to: router.target, data: encode(router, 'addLiquidity', [{ tokenA: a.address, tokenB: b.address, desiredA: x, desiredB: y, minA: floor(x), minB: floor(y) }, me, deadline()]) };
    }
    ctx.print(await submit(ctx, request, [], { confirmed: true, label: L('Vklad', 'Deposit') }), L('Likvidita je v poolu.', 'The liquidity is in the pool.'));
    return;
  }
  if (sub === 'remove') {
    const [tokenA, tokenB] = args;
    if (!tokenB) throw new CliError(L('Použití: quinvium liquidity remove <token> <token> [--percent 100]', 'Usage: quinvium liquidity remove <token> <token> [--percent 100]'));
    const [a, b] = await Promise.all([ctx.token(tokenA), ctx.token(tokenB)]);
    const address = await ctx.at('SwapFactory', d.swap.factory).getPair(a.address, b.address);
    if (address === ethers.ZeroAddress) throw new CliError(L('Takový pool neexistuje.', 'There is no such pool.'));
    const pair = ctx.at('SwapPair', address);
    const mine = await pair.balanceOf(me);
    if (mine === 0n) throw new CliError(L('V tomto poolu nemáte žádnou likviditu.', 'You have no liquidity in this pool.'));
    const percentText = String(ctx.opts.percent ?? 100);
    const percent = /^\d+$/.test(percentText) ? BigInt(percentText) : 0n;
    if (percent < 1n || percent > 100n) throw new CliError(L('--percent musí být celé číslo 1 až 100.', '--percent must be a whole number from 1 to 100.'));
    const part = (mine * percent) / 100n;
    ctx.note(pairs([[L('Výběr', 'Withdraw'), L(`${percent} % podílu v poolu ${a.symbol} / ${b.symbol}`, `${percent}% of your share in the ${a.symbol} / ${b.symbol} pool`)]]));
    await confirm(ctx, L('Vybrat?', 'Withdraw?'));
    await approve(ctx, { address, symbol: 'LP', decimals: 18 }, router.target, part);
    const other = a.native ? b : a;
    const data = a.native || b.native ? encode(router, 'removeLiquidityNative', [other.address, part, 0n, 0n, me, deadline()]) : encode(router, 'removeLiquidity', [a.address, b.address, part, 0n, 0n, me, deadline()]);
    ctx.print(await submit(ctx, { to: router.target, data }, [], { confirmed: true, label: L('Výběr', 'Withdrawal') }), L('Likvidita je vybraná.', 'The liquidity is withdrawn.'));
    return;
  }
  if (sub === 'list' || sub === undefined) {
    const list = await ctx.at('SwapFactory', d.swap.factory).list(0, POOL_PAGE);
    const known = await ctx.tokens();
    const name = (t) => symbolOf(ctx, known, t);
    const rows = (await Promise.all([...list].map(async (address) => {
      const pair = ctx.at('SwapPair', address);
      const [mine, supply, t0, t1] = await Promise.all([pair.balanceOf(me), pair.totalSupply(), pair.token0(), pair.token1()]);
      return { address, pair: `${name(t0)} / ${name(t1)}`, share: supply ? (Number((mine * 10000n) / supply) / 100) : 0, mine };
    }))).filter((r) => r.mine > 0n);
    ctx.print(rows, rows.length ? table([L('Dvojice', 'Pair'), L('Podíl %', 'Share %'), 'Pool'], rows.map((r) => [r.pair, r.share, r.address]), [1]) : L('V žádném poolu nemáte likviditu.', 'You have no liquidity in any pool.'));
    return;
  }
  throw new CliError(L('Možnosti: quinvium liquidity add, remove, list', 'Options: quinvium liquidity add, remove, list'));
}

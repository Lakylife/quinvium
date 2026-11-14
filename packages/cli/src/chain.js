// Reading from the chain: signs nothing and needs no wallet.
import { ethers } from 'ethers';
import { CliError, ago, amountText, count, dateText, gwei, methodOf, pairs, rate, revertInfo, revertReason, short, table, units } from './context.js';
import { L } from './i18n.js';
import { APPS } from './apps.js';
import { token } from './money.js';
import { signer } from './tx.js';
import { walletAddress } from './wallets.js';

const LIST_LIMIT = 20;
const MINER_WINDOW = 1000;
const txs = (n) => count(n, ['transakce', 'transakce', 'transakcí'], ['transaction', 'transactions']);

/** The network's system contracts have a name in the overview; other addresses only a kind. */
function kindOf(ctx, x) {
  const name = Object.entries(ctx.contracts).find(([, c]) => c.address && c.address.toLowerCase() === x.address.toLowerCase())?.[0];
  if (name === 'WAET') return L(`kontrakt Wrapped ${ctx.symbol}`, `contract Wrapped ${ctx.symbol}`);
  if (name) return L(`kontrakt ${name}`, `contract ${name}`);
  return x.isContract ? L('kontrakt', 'contract') : L('účet', 'account');
}

/** Why a failed transaction ended: the node replays the block up to it (aether_txError). */
function failureOf(res) {
  if (!res) return null;
  if (res.error && res.error !== 'revert') {
    return /out of gas/i.test(res.error) ? { code: 'OutOfGas', text: L(`došel gas, limit byl ${res.gasLimit}`, `out of gas, the limit was ${res.gasLimit}`) } : { code: res.error, text: res.error };
  }
  const info = revertInfo(res.data);
  if (info) return { code: info.name, text: revertReason(res.data) };
  return { code: null, text: res.data && res.data.length > 2 ? L(`neznámá chyba ${res.data.slice(0, 10)}`, `unknown error ${res.data.slice(0, 10)}`) : L('kontrakt transakci odmítl bez udání důvodu', 'the contract rejected the transaction without a reason') };
}

export async function status(ctx) {
  const s = await ctx.rpc('aether_stats');
  const latest = await ctx.rpc('aether_recentBlocks', [1, 0]);
  const tip = latest[0];
  ctx.print(s, pairs([
    [L('Síť', 'Network'), `${s.network} (chain ID ${s.chainId})`], [L('Uzel', 'Node'), `${ctx.url}, ${s.version}`], [L('Stav', 'Status'), s.syncing ? L('synchronizace', 'syncing') : L('v pořádku', 'healthy')],
    [L('Výška', 'Height'), `${s.height}${tip ? L(`, poslední blok ${ago(tip.timestamp)}`, `, last block ${ago(tip.timestamp)}`) : ''}`], [L('Výkon sítě', 'Network hashrate'), rate(s.hashrate)], [L('Obtížnost', 'Difficulty'), s.difficulty],
    [L('Průměrný čas bloku', 'Average block time'), L(`${s.avgBlockTime.toFixed(1)} s, cíl ${s.blockTimeTarget} s`, `${s.avgBlockTime.toFixed(1)} s, target ${s.blockTimeTarget} s`)], [L('Odměna za blok', 'Block reward'), `${units(s.reward)} ${s.currency}`],
    [L('V oběhu', 'Supply'), L(`${units(s.supply, 18, 2)} z ${units(s.maxSupply, 18, 0)} ${s.currency}`, `${units(s.supply, 18, 2)} of ${units(s.maxSupply, 18, 0)} ${s.currency}`)], [L('Základní poplatek', 'Base fee'), `${gwei(s.baseFee)} gwei`],
    [L('Čekající transakce', 'Pending transactions'), s.mempool], [L('Připojené uzly', 'Connected peers'), s.peers], [L('Další půlení', 'Next halving'), L(`blok ${s.nextHalving}`, `block ${s.nextHalving}`)],
    s.reorgs?.count || s.reorgs?.refused ? [L('Přepisy řetězce', 'Reorganisations'), L(`${s.reorgs.count}, nejhlubší ${s.reorgs.deepest} bloků, odmítnuté ${s.reorgs.refused}`, `${s.reorgs.count}, deepest ${s.reorgs.deepest} blocks, refused ${s.reorgs.refused}`)] : null,
  ]));
}

export async function block(ctx, [id = 'latest']) {
  const isHash = /^0x[0-9a-fA-F]{64}$/.test(id);
  if (!isHash && id !== 'latest' && !/^\d+$/.test(id)) throw new CliError(L(`Zadejte číslo nebo hash bloku, ne ${id}.`, `Give a block number or hash, not ${id}.`));
  const tag = isHash || id === 'latest' ? id : ethers.toQuantity(BigInt(id));
  const b = await ctx.rpc(isHash ? 'eth_getBlockByHash' : 'eth_getBlockByNumber', [tag, false]);
  if (!b) throw new CliError(L(`Blok ${id} neexistuje.`, `Block ${id} does not exist.`));
  ctx.print(b, pairs([
    [L('Blok', 'Block'), BigInt(b.number)], ['Hash', b.hash], [L('Předchozí', 'Parent'), b.parentHash], [L('Čas', 'Time'), `${dateText(b.timestamp)} (${ago(Number(b.timestamp))})`],
    [L('Těžař', 'Miner'), b.miner], [L('Transakce', 'Transactions'), b.transactions.length], ['Gas', L(`${BigInt(b.gasUsed)} z ${BigInt(b.gasLimit)}`, `${BigInt(b.gasUsed)} of ${BigInt(b.gasLimit)}`)], [L('Základní poplatek', 'Base fee'), `${gwei(b.baseFeePerGas)} gwei`],
    [L('Obtížnost', 'Difficulty'), BigInt(b.difficulty)], [L('Kořen stavu', 'State root'), b.stateRoot], ['Nonce', b.nonce],
  ]));
}

export async function tx(ctx, [hash]) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash ?? '')) throw new CliError(L('Zadejte hash transakce.', 'Give a transaction hash.'));
  const [x, r] = await Promise.all([ctx.rpc('eth_getTransactionByHash', [hash]), ctx.rpc('eth_getTransactionReceipt', [hash])]);
  if (!x) throw new CliError(L(`Transakce ${hash} neexistuje. Uzel ji nezná, nebo ji fronta zahodila a mince zůstaly odesílateli.`, `Transaction ${hash} does not exist. The node does not know it, or the queue dropped it and the coins stayed with the sender.`));
  const failed = r && Number(r.status) !== 1;
  const failure = failed ? failureOf(await ctx.rpc('aether_txError', [hash]).catch(() => null)) : null;
  const state = !r ? L('čeká na blok', 'waiting for a block') : failed ? L('selhala', 'failed') : L('úspěch', 'success');
  const method = methodOf(x);
  ctx.print({ transaction: x, receipt: r, method, failure: failure?.code ?? failure?.text ?? null, failureText: failure?.text ?? null }, pairs([
    ['Hash', hash], [L('Stav', 'Status'), state], failure ? [L('Důvod', 'Reason'), failure.text] : null, [L('Blok', 'Block'), x.blockNumber ? BigInt(x.blockNumber) : '—'], [L('Od', 'From'), x.from], [L('Komu', 'To'), x.to ?? r?.contractAddress ?? '—'],
    [L('Metoda', 'Method'), method], [L('Částka', 'Value'), `${units(x.value, 18, 18)} ${ctx.symbol}`], [L('Poplatek', 'Fee'), r ? `${units(BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice))} ${ctx.symbol}` : undefined],
    ['Nonce', BigInt(x.nonce)], ['Data', x.input === '0x' ? undefined : `${x.input.slice(0, 74)}${x.input.length > 74 ? '…' : ''}`],
  ]));
}

export async function address(ctx, [who]) {
  const a = who ? await ctx.address(who) : walletAddress(ctx);
  const i = await ctx.rpc('aether_addressInfo', [a]);
  ctx.print(i, pairs([
    [L('Adresa', 'Address'), a], [L('Druh', 'Kind'), i.isContract ? L('kontrakt', 'contract') : L('účet', 'account')], [L('Zůstatek', 'Balance'), `${units(i.balance)} ${ctx.symbol}`], [L('Počet transakcí', 'Nonce'), i.nonce],
    [L('Přijato', 'Received'), txs(i.received.count)], [L('Odesláno', 'Sent'), txs(i.sent.count)], [L('Vytěžené bloky', 'Mined blocks'), i.mined.blocks], [L('Tokeny', 'Tokens'), i.tokens.length],
  ]));
}

export async function gas(ctx) {
  const f = await ctx.rpc('aether_feeEstimates');
  const rows = ['slow', 'normal', 'fast'].map((k) => [k, `${gwei(f.tiers[k].tip)} gwei`, `${gwei(f.tiers[k].maxFee)} gwei`, L(`asi ${f.tiers[k].seconds} s`, `about ${f.tiers[k].seconds} s`)]);
  ctx.print(f, `${L('Základní poplatek', 'Base fee')}: ${gwei(f.baseFee)} gwei${f.congested ? L(', síť je vytížená', ', the network is busy') : ''}\n\n${table([L('Rychlost', 'Speed'), L('Dýško', 'Tip'), L('Nejvýše', 'Max fee'), L('Čekání', 'Wait')], rows)}`);
}

export async function peers(ctx) {
  const list = await ctx.rpc('aether_peers');
  ctx.print(list, list.length ? table([L('Adresa', 'Address'), L('Klient', 'Client'), L('Výška', 'Height')], list.map((p) => [p.address, p.agent, p.height])) : L('Žádný uzel není připojený.', 'No peer is connected.'));
}

export async function mempool(ctx) {
  const list = await ctx.rpc('aether_pendingTxs');
  ctx.print(list, list.length ? table(['Hash', L('Od', 'From'), L('Komu', 'To'), L('Částka', 'Value')], list.slice(0, LIST_LIMIT).map((x) => [short(x.hash), short(x.from), short(x.to), units(x.value)])) : L('Žádné čekající transakce.', 'No pending transactions.'));
}

export async function miners(ctx) {
  const list = await ctx.rpc('aether_miners', [MINER_WINDOW]);
  ctx.print(list, list.length ? table([L('Adresa', 'Address'), L(`Bloky z posledních ${MINER_WINDOW}`, `Blocks of the last ${MINER_WINDOW}`), L('Poslední blok', 'Last block')], list.slice(0, LIST_LIMIT).map((m) => [m.address, m.blocks, m.lastBlock]), [1, 2]) : L('Zatím žádní těžaři.', 'No miners yet.'));
}

/** Rich list by balance. Empty addresses (contracts without coins) do not belong in it. */
export async function rich(ctx) {
  const r = await ctx.rpc('aether_richList', [LIST_LIMIT]);
  const items = r.items.filter((x) => BigInt(x.balance) > 0n);
  ctx.print({ ...r, items }, items.length
    ? table([L('Adresa', 'Address'), L('Druh', 'Kind'), `${L('Zůstatek', 'Balance')} (${ctx.symbol})`], items.map((x) => [x.address, kindOf(ctx, x), amountText(x.balance, 18, 4)]), [2])
    : L('Zatím žádná adresa nemá mince.', 'No address holds coins yet.'));
}

/** A direct query to the node, like bitcoin-cli or geth attach. */
export async function rawRpc(ctx, [method, ...params]) {
  if (!method) throw new CliError(L('Zadejte metodu, například: quinvium rpc eth_blockNumber', 'Give a method, for example: quinvium rpc eth_blockNumber'));
  const parsed = params.map((p) => { try { return JSON.parse(p); } catch { return p; } });
  console.log(JSON.stringify(await ctx.rpc(method, parsed), null, 2));
}

export async function sign(ctx, [message]) {
  if (message === undefined) throw new CliError(L('Zadejte text k podpisu.', 'Give the text to sign.'));
  const account = await signer(ctx);
  const signature = await account.signMessage(message);
  ctx.print({ address: account.address, message, signature }, pairs([[L('Adresa', 'Address'), account.address], [L('Podpis', 'Signature'), signature]]));
}

export async function verify(ctx, [message, signature, expected]) {
  if (!message || !signature) throw new CliError(L('Použití: quinvium verify <text> <podpis> [adresa]', 'Usage: quinvium verify <text> <signature> [address]'));
  let who;
  try { who = ethers.verifyMessage(message, signature); } catch { throw new CliError(L('Neplatný podpis.', 'Invalid signature.')); }
  if (expected && who.toLowerCase() !== expected.toLowerCase()) throw new CliError(L(`Podpis patří adrese ${who}, ne ${expected}.`, `The signature belongs to ${who}, not ${expected}.`));
  ctx.print({ address: who, valid: true }, L(`Podpis je platný, patří adrese ${who}.`, `The signature is valid and belongs to ${who}.`));
}

/**
 * Search as in the Explorer: the node recognises a block number or hash, a transaction hash and an address (aether_search).
 * Also a .qu name from the name registry and the symbol of a verified token.
 */
export async function search(ctx, words) {
  const q = words.join(' ').trim();
  if (!q) throw new CliError(L('Zadejte, co hledat: číslo nebo hash bloku, hash transakce, adresu, jméno .qu nebo zkratku tokenu.', 'Give something to search for: a block number or hash, a transaction hash, an address, a .qu name or a token symbol.'));
  await ctx.connect();
  const found = (kind) => ctx.note(L(`Nalezeno: ${kind.cs}`, `Found: ${kind.en}`));
  const hit = await ctx.rpc('aether_search', [q]).catch(() => null);
  if (hit?.type === 'block') { found({ cs: 'blok', en: 'block' }); await block(ctx, [hit.id]); return; }
  if (hit?.type === 'tx') { found({ cs: 'transakce', en: 'transaction' }); await tx(ctx, [hit.id]); return; }
  if (hit?.type === 'address') { found({ cs: 'adresa', en: 'address' }); await address(ctx, [hit.id]); return; }
  if (/^\d+$/.test(q)) {
    const height = Number(await ctx.rpc('eth_blockNumber'));
    throw new CliError(L(`Blok ${q} zatím neexistuje, poslední je ${height}.`, `Block ${q} does not exist yet, the latest is ${height}.`));
  }
  const symbol = (await ctx.tokens()).find((t) => t.symbol.toLowerCase() === q.toLowerCase());
  if (symbol && !/\.qu$/i.test(q)) { found({ cs: 'token', en: 'token' }); await token(ctx, [symbol.address]); return; }
  const name = q.toLowerCase().replace(/\.qu$/, '');
  const names = ctx.at('AetherNames');
  if (await names.valid(name).catch(() => false)) {
    const [owner] = await names.info(name);
    if (owner !== ethers.ZeroAddress) { found({ cs: 'jméno', en: 'name' }); await APPS.name.info(ctx, [name]); return; }
  }
  throw new CliError(L(`Nic nenalezeno pro ${q}. Hledat jde číslo nebo hash bloku, hash transakce, adresu, jméno .qu a zkratku ověřeného tokenu.`, `Nothing found for ${q}. You can search for a block number or hash, a transaction hash, an address, a .qu name and a verified token symbol.`));
}

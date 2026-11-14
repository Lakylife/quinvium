// Bridge between Quinvium and other networks. The bridge validators guard the coins, not this tool.
import { ethers } from 'ethers';
import { custodyScript, scriptAddress } from '../../bridge/src/bitcoin.js';
import { CliError, TX_WAIT_MS, pairs, parseAmount, reason, short, table, units } from './context.js';
import { L } from './i18n.js';
import { approve, confirm, encode, signer, submit } from './tx.js';
import { walletAddress } from './wallets.js';

const HISTORY_BLOCKS = 9000;     // the node returns logs from at most 10,000 blocks at a time
const BTC_PREFIX = { mainnet: 'bc', testnet: 'tb', regtest: 'bcrt' };
const DOMAIN = ethers.id('AetherBridge.v1');
const coder = ethers.AbiCoder.defaultAbiCoder();
const PLANNED = () => L('Most na této síti ještě neběží: čeká na nezávislé validátory a nezávislý audit.', 'The bridge does not run on this network yet: it waits for independent validators and an independent audit.');

async function setup(ctx) {
  await ctx.connect();
  const d = await ctx.deployment();
  if (!d?.gateway) throw new CliError(PLANNED());
  return d;
}

const networkOf = (d, asset) => d.networks.find((n) => n.id === asset.network);

function findAsset(d, text) {
  const hits = d.assets.filter((a) => a.symbol.toLowerCase() === text.toLowerCase() || `${a.symbol}.${networkOf(d, a)?.name}`.toLowerCase() === text.toLowerCase());
  if (!hits.length) throw new CliError(L(`Trasa pro ${text} není. Seznam zobrazí: quinvium bridge routes`, `There is no route for ${text}. See the list: quinvium bridge routes`));
  const names = hits.map((a) => `${a.symbol}.${networkOf(d, a)?.name}`).join(', ');
  if (hits.length > 1) throw new CliError(L(`${text} jde na více sítí, upřesněte: ${names}`, `${text} goes to several networks, choose one: ${names}`));
  return hits[0];
}

function bridgeTarget(net, recipient) {
  if (!net.bitcoin) return ethers.getAddress(recipient);
  if (!recipient.toLowerCase().startsWith(`${BTC_PREFIX[net.bitcoin]}1`)) throw new CliError(L(`Tato adresa nepatří síti Bitcoin ${net.bitcoin}.`, `This address does not belong to the Bitcoin ${net.bitcoin} network.`));
  return ethers.toUtf8Bytes(recipient);
}

async function routes(ctx) {
  await ctx.connect();
  const d = await ctx.deployment();
  if (!d?.gateway) { ctx.print({ open: false }, `${PLANNED()}\n${L('Připravené trasy: BTC, ETH, USDT, USDC a USD1, oběma směry.', 'Prepared routes: BTC, ETH, USDT, USDC and USD1, both ways.')}`); return; }
  const gate = ctx.at('BridgeGateway', d.gateway);
  const [paused, threshold, validators] = await Promise.all([gate.paused(), gate.threshold(), gate.validators()]);
  const rows = d.assets.map((a) => ({ symbol: a.symbol, network: networkOf(d, a)?.name, min: units(a.min, a.decimals) }));
  ctx.print({ open: !paused, threshold, validators, routes: rows }, [
    pairs([[L('Stav', 'Status'), paused ? L('zastavený', 'stopped') : L('v provozu', 'running')], [L('Validátoři', 'Validators'), L(`převod potvrzuje ${threshold} z ${validators.length}`, `a transfer needs ${threshold} of ${validators.length}`)]]), '',
    table([L('Mince', 'Coin'), L('Síť', 'Network'), L('Nejméně', 'Minimum')], rows.map((r) => [r.symbol, r.network, r.min]), [2]),
  ].join('\n'));
}

async function out(ctx, [amountText, assetText, recipient]) {
  if (!assetText) throw new CliError(L('Použití: quinvium bridge out <částka> <mince> [příjemce]', 'Usage: quinvium bridge out <amount> <coin> [recipient]'));
  const d = await setup(ctx);
  const asset = findAsset(d, assetText);
  const net = networkOf(d, asset);
  if (asset.token === undefined) throw new CliError(L(`${asset.symbol} z Quinvia nejde, zkuste opačný směr: quinvium bridge in`, `${asset.symbol} cannot leave Quinvium, try the other direction: quinvium bridge in`));
  const amount = parseAmount(amountText, asset.decimals);
  if (amount < BigInt(asset.min)) throw new CliError(L(`Nejméně ${units(asset.min, asset.decimals)} ${asset.symbol}.`, `At least ${units(asset.min, asset.decimals)} ${asset.symbol}.`));
  if (await ctx.at('BridgeGateway', d.gateway).paused()) throw new CliError(L('Most je dočasně zastavený.', 'The bridge is temporarily stopped.'));
  const me = walletAddress(ctx);
  const target = recipient ?? me;
  if (net.bitcoin && !recipient) throw new CliError(L('Zadejte adresu Bitcoinu, kam mince přijdou.', 'Give the Bitcoin address the coins go to.'));
  const encoded = bridgeTarget(net, target);
  ctx.note(pairs([[L('Převod', 'Transfer'), L(`${units(amount, asset.decimals)} ${asset.symbol} na síť ${net.name}`, `${units(amount, asset.decimals)} ${asset.symbol} to ${net.name}`)], [L('Příjemce', 'Recipient'), target], [L('Pozor', 'Note'), L('most je tak bezpečný, jak nezávislí jsou jeho validátoři', 'a bridge is only as safe as its validators are independent')]]));
  await confirm(ctx, L('Přemostit?', 'Bridge?'));
  const gate = ctx.at('BridgeGateway', d.gateway);
  const native = asset.token === ethers.ZeroAddress;
  if (!native && !asset.burn) await approve(ctx, { address: asset.token, symbol: asset.symbol, decimals: asset.decimals }, d.gateway, amount);
  const data = encode(gate, 'send', [asset.token, amount, net.id, encoded]);
  ctx.print(await submit(ctx, { to: d.gateway, data, value: native ? amount : 0n }, [], { confirmed: true, label: L('Převod', 'Transfer') }), L('Převod je odeslaný. Validátoři ho potvrdí a mince dorazí na cílovou síť.', 'The transfer is sent. The validators confirm it and the coins arrive on the target network.'));
}

/** The way to Quinvium: the same key signs the transaction on the source network, and its fee is paid there. */
async function into(ctx, [amountText, assetText, recipient]) {
  if (!assetText) throw new CliError(L('Použití: quinvium bridge in <částka> <mince> [příjemce na Quinviu]', 'Usage: quinvium bridge in <amount> <coin> [recipient on Quinvium]'));
  const d = await setup(ctx);
  const asset = findAsset(d, assetText);
  const net = networkOf(d, asset);
  if (net.bitcoin) throw new CliError(L('Bitcoin se posílá na vkladovou adresu: quinvium bridge deposit-btc', 'Bitcoin is sent to a deposit address: quinvium bridge deposit-btc'));
  if (asset.remoteToken === undefined) throw new CliError(L(`Trasa ${asset.symbol} na Quinvium není.`, `There is no ${asset.symbol} route to Quinvium.`));
  const amount = parseAmount(amountText, asset.decimals);
  if (amount < BigInt(asset.min)) throw new CliError(L(`Nejméně ${units(asset.min, asset.decimals)} ${asset.symbol}.`, `At least ${units(asset.min, asset.decimals)} ${asset.symbol}.`));
  const me = walletAddress(ctx);
  const target = ethers.getAddress(recipient ?? me);
  ctx.note(pairs([[L('Převod', 'Transfer'), L(`${units(amount, asset.decimals)} ${asset.symbol} ze sítě ${net.name} na Quinvium`, `${units(amount, asset.decimals)} ${asset.symbol} from ${net.name} to Quinvium`)], [L('Příjemce', 'Recipient'), target], [L('Podepisuje', 'Signed by'), L(`${me} na síti ${net.name}`, `${me} on ${net.name}`)]]));
  await confirm(ctx, L('Přemostit?', 'Bridge?'));
  const remote = new ethers.JsonRpcProvider(net.rpc, undefined, { staticNetwork: true });
  const account = (await signer(ctx)).connect(remote);
  const gate = ctx.at('BridgeGateway', net.gateway, account);
  const native = asset.remoteToken === ethers.ZeroAddress;
  try {
    if (!native && !asset.remoteBurn) {
      const token = ctx.at('AetherToken', asset.remoteToken, account);
      if (await token.allowance(me, net.gateway) < amount) await (await token.approve(net.gateway, amount)).wait(1, TX_WAIT_MS);
    }
    const sent = await gate.send(asset.remoteToken, amount, ctx.chainId, target, native ? { value: amount } : {});
    ctx.note(`${L('Převod', 'Transfer')}: ${sent.hash}`);
    const receipt = await sent.wait(1, TX_WAIT_MS);
    ctx.print({ hash: sent.hash, block: receipt.blockNumber }, L(`Potvrzeno v bloku ${receipt.blockNumber}. Validátoři převod ověří a mince dorazí na Quinvium.`, `Confirmed in block ${receipt.blockNumber}. The validators check the transfer and the coins arrive on Quinvium.`));
  } catch (e) {
    throw new CliError(L(`Převod selhal: ${reason(e)}`, `The transfer failed: ${reason(e)}`));
  } finally {
    remote.destroy();
  }
}

/** The same address computation the validators do: the script with the recipient and the custody keys. */
function depositAddress(net, recipient) {
  return scriptAddress(custodyScript(net.keys.map((k) => Buffer.from(k, 'hex')), net.threshold, recipient), net.bitcoin);
}

async function depositBtc(ctx, [recipient]) {
  const d = await setup(ctx);
  const asset = d.assets.find((a) => networkOf(d, a)?.bitcoin);
  if (!asset) throw new CliError(L('Trasa pro Bitcoin na této síti není.', 'There is no Bitcoin route on this network.'));
  const net = networkOf(d, asset);
  const target = ethers.getAddress(recipient ?? walletAddress(ctx));
  const gate = ctx.at('BridgeGateway', d.gateway);
  ctx.note(pairs([[L('Příjemce na Quinviu', 'Recipient on Quinvium'), target], [L('Co se stane', 'What happens'), L('adresa se zapíše do řetězce, aby ji validátoři sledovali', 'the address is recorded on chain so the validators watch it')]]));
  const result = await submit(ctx, { to: d.gateway, data: encode(gate, 'requestBitcoinDeposit', [target]) });
  const address = depositAddress(net, target);
  ctx.print({ ...result, deposit: address, confirmations: net.confirmations }, pairs([[L('Vkladová adresa', 'Deposit address'), address], [L('Potvrzení', 'Confirmations'), L(`${net.confirmations} bloků Bitcoinu, pak se na Quinviu připíše ${asset.symbol}`, `${net.confirmations} Bitcoin blocks, then ${asset.symbol} is credited on Quinvium`)]]));
}

async function history(ctx, [who]) {
  const d = await setup(ctx);
  const me = who ? await ctx.address(who) : walletAddress(ctx);
  const gate = ctx.at('BridgeGateway', d.gateway);
  const tip = await ctx.provider.getBlockNumber();
  const logs = await gate.queryFilter('Sent', Math.max(0, tip - HISTORY_BLOCKS), tip);
  const mine = logs.filter((l) => l.args.sender.toLowerCase() === me.toLowerCase()).reverse();
  const rows = await Promise.all(mine.map(async (l) => {
    const net = d.networks.find((n) => BigInt(n.id) === l.args.dstChain);
    const asset = d.assets.find((a) => a.token?.toLowerCase() === l.args.token.toLowerCase());
    let state = net?.bitcoin ? L('výplata v Bitcoinu', 'paid out in Bitcoin') : L('čeká na potvrzení', 'awaiting confirmation');
    if (net?.gateway && !net.bitcoin) {
      const message = { dstChain: l.args.dstChain, nonce: l.args.nonce, srcToken: ethers.zeroPadValue(l.args.token, 32), recipient: ethers.getAddress(l.args.recipient), amount: l.args.amount };
      const id = ethers.keccak256(coder.encode(['bytes32', 'address', 'uint64', 'uint64', 'uint64', 'bytes32', 'address', 'uint256'], [DOMAIN, net.gateway, ctx.chainId, message.dstChain, message.nonce, message.srcToken, message.recipient, message.amount]));
      const remote = new ethers.JsonRpcProvider(net.rpc, undefined, { staticNetwork: true });
      if (await ctx.at('BridgeGateway', net.gateway, remote).delivered(id).catch(() => false)) state = L('doručeno', 'delivered');
      remote.destroy();
    }
    return { hash: l.transactionHash, amount: asset ? `${units(l.args.amount, asset.decimals)} ${asset.symbol}` : l.args.amount.toString(), to: net?.name ?? String(l.args.dstChain), state };
  }));
  ctx.print(rows, rows.length ? table([L('Transakce', 'Transaction'), L('Částka', 'Amount'), L('Cíl', 'Target'), L('Stav', 'Status')], rows.map((r) => [short(r.hash), r.amount, r.to, r.state])) : L('Zatím žádné převody.', 'No transfers yet.'));
}

const COMMANDS = { routes, out, in: into, 'deposit-btc': depositBtc, status: history };

export async function bridge(ctx, [sub = 'routes', ...rest]) {
  const fn = COMMANDS[sub];
  if (!fn) throw new CliError(L(`Možnosti: quinvium bridge ${Object.keys(COMMANDS).join(', ')}`, `Options: quinvium bridge ${Object.keys(COMMANDS).join(', ')}`));
  await fn(ctx, rest);
}

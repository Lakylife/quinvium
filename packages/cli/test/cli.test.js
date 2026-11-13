// Příkazová řádka proti skutečným uzlům: každý příkaz běží jako samostatný proces, tak jak ho spustí uživatel.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { BITCOIN, BitcoinBridge } from '../../bridge/src/btc-bridge.js';
import { publicKey } from '../../bridge/src/bitcoin.js';
import { Relayer } from '../../bridge/src/relayer.js';
import { MockBitcoin } from '../../bridge/test/helpers/mock-bitcoin.js';
import { WEI, artifacts, makeChain } from '../../bridge/test/helpers/chains.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'bin', 'quintium.js');
const FAR = 2_000_000_000_000;
const PASSWORD = 'heslo-pro-test-cli';
const admin = ethers.Wallet.createRandom();
const validators = Array.from({ length: 3 }, () => ({ wallet: ethers.Wallet.createRandom(), btcKey: `0x${crypto.randomBytes(32).toString('hex')}` }));
const everyone = [admin, ...validators.map((v) => v.wallet)];
const A = makeChain(52403n, 'aether', everyone);
const B = makeChain(1115511n, 'ethereum', everyone);
const btc = new MockBitcoin();
const home = mkdtempSync(join(tmpdir(), 'aether-cli-'));
const passwordFile = join(home, 'heslo.txt');
const deploymentsFile = join(home, 'nasazeni.json');
const pad = (a) => ethers.zeroPadValue(a, 32);
const iface = new ethers.Interface(artifacts.BridgeGateway.abi);
const wrapped = (r) => iface.parseLog(r.logs.find((l) => l.topics[0] === iface.getEvent('WrappedCreated').topicHash)).args.token;

let url;
let usd;
let router;
let gateA;
let me;
let stopping = false;
let beat;
let team = [];

/** Spustí nástroj a vrátí výstup, chyba se vrací jako hodnota, aby ji test mohl číst. */
function run(args, { input, env = {} } = {}) {
  return new Promise((resolve) => {
    // Texty testů jsou česky. Jazyk systému by jinak na jiném počítači přepnul výpis do angličtiny.
    const child = execFile(process.execPath, ['--no-warnings', CLI, ...args], { env: { ...process.env, AETHER_HOME: home, QUINTIUM_LANG: 'cs', ...env }, timeout: 120_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}
const common = () => ['--network', 'dev', '--rpc', url, '--deployments', deploymentsFile, '--password-file', passwordFile];
const ok = async (...args) => {
  const r = await run([...args, ...common(), '--yes', '--json']);
  assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const fails = async (args, pattern) => {
  const r = await run([...args, ...common(), '--yes']);
  assert.notEqual(r.code, 0, `${args.join(' ')} měl selhat: ${r.stdout}`);
  assert.match(r.stderr, pattern);
};

before(async () => {
  writeFileSync(passwordFile, `${PASSWORD}\n`, { mode: 0o600 });
  await A.start();
  await B.start();
  url = `http://127.0.0.1:${A.node.rpc.port}`;
  const factory = await A.deploy('SwapFactory', admin);
  router = await A.deploy('SwapRouter', admin, factory.target, artifacts.WAET.address);
  const registry = await A.deploy('TokenRegistry', admin, admin.address);
  usd = await A.deploy('StableToken', admin, 'Test USD', 'tUSD', 6, admin.address);
  await A.ok(usd.configureMinter(admin.address, 10n ** 30n));
  await A.ok(usd.mint(admin.address, 10n ** 15n));
  await A.ok(usd.connect(A.connect(admin)).approve(router.target, ethers.MaxUint256));
  await A.ok(router.connect(A.connect(admin)).addLiquidityNative(usd.target, 4_000_000_000n, 0n, 0n, admin.address, FAR, { value: 2000n * WEI }));
  await A.ok(registry.add(usd.target, 0, 'Vydavatel', ''));
  const btcToken = await A.deploy('StableToken', admin, 'Test BTC', 'tBTC', 8, admin.address);
  await A.ok(btcToken.configureMinter(admin.address, 10n ** 30n));
  await A.ok(btcToken.mint(admin.address, 10n ** 12n));
  await A.ok(btcToken.connect(A.connect(admin)).approve(router.target, ethers.MaxUint256));
  await A.ok(router.connect(A.connect(admin)).addLiquidityNative(btcToken.target, 10n ** 9n, 0n, 0n, admin.address, FAR, { value: 2000n * WEI }));
  await A.ok(registry.add(btcToken.target, 0, 'Vydavatel', ''));

  const list = validators.map((v) => v.wallet.address);
  gateA = await A.deploy('BridgeGateway', admin, admin.address, admin.address, list, 2);
  const gateB = await B.deploy('BridgeGateway', admin, admin.address, admin.address, list, 2);
  const aetB = wrapped(await B.ok(gateB.createWrapped('Quinvium', 'QU.e', 18, Number(A.id), ethers.ZeroHash, 100n * WEI, 50n * WEI)));
  const aBtc = wrapped(await A.ok(gateA.createWrapped('Bridged Bitcoin', 'aBTC', 8, Number(BITCOIN), ethers.ZeroHash, 10n ** 12n, 10n ** 11n)));
  await A.ok(gateA.setOutbound(ethers.ZeroAddress, Number(B.id), true, false, 1n));
  await A.ok(gateA.setRoute(Number(B.id), pad(aetB), ethers.ZeroAddress, false, true, 100n * WEI, 50n * WEI));
  await B.ok(gateB.setOutbound(aetB, Number(A.id), true, true, 1n));
  const chains = () => [
    { id: A.id, name: 'Quinvium', provider: A.provider, gateway: gateA.target, confirmations: 1, startBlock: 0 },
    { id: B.id, name: 'Ethereum', provider: B.provider, gateway: gateB.target, confirmations: 1, startBlock: 0 },
  ];
  team = validators.map((v) => {
    const relayer = new Relayer({ chains: chains(), privateKey: v.wallet.privateKey });
    const bridge = new BitcoinBridge({
      rpc: btc.rpc, network: 'regtest', relayer, chainId: A.id, token: aBtc, btcKey: v.btcKey, threshold: 2, confirmations: 3,
      validators: validators.map((x) => ({ address: x.wallet.address, btcKey: publicKey(x.btcKey).toString('hex') })),
    });
    return { relayer, bridge };
  });
  const keys = validators.map((v) => publicKey(v.btcKey).toString('hex'));
  writeFileSync(deploymentsFile, JSON.stringify({
    [A.id]: {
      registry: registry.target, gateway: gateA.target,
      swap: { factory: factory.target, router: router.target, tokens: [] },
      networks: [
        { id: Number(B.id), name: 'Ethereum', rpc: `http://127.0.0.1:${B.node.rpc.port}`, gateway: gateB.target },
        { id: Number(BITCOIN), name: 'Bitcoin', bitcoin: 'regtest', keys, threshold: 2, confirmations: 3 },
      ],
      assets: [
        { symbol: 'dQU', token: ethers.ZeroAddress, decimals: 18, network: Number(B.id), min: '1', remoteToken: aetB, remoteBurn: true },
        { symbol: 'aBTC', token: aBtc, decimals: 8, network: Number(BITCOIN), min: '50000', burn: true },
      ],
    },
  }));
  beat = (async () => {
    while (!stopping) {
      await A.mine().catch(() => {});
      await B.mine().catch(() => {});
      for (const m of team) {
        await m.bridge.tick().catch(() => {});
        await m.relayer.tick().catch(() => {});
      }
      await new Promise((r) => { setTimeout(r, 120); });
    }
  })();
});

after(async () => {
  stopping = true;
  await beat;
  await A.stop();
  await B.stop();
});

test('nápověda a verze fungují bez uzlu i peněženky', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  for (const word of ['wallet create', 'swap quote', 'bridge out', 'mine', 'pool claim', 'node']) assert.ok(help.stdout.includes(word), word);
  assert.match((await run(['--version'])).stdout, /^\d+\.\d+\.\d+/);
  assert.match((await run(['neexistuje'])).stderr, /Neznámý příkaz/);
  assert.match((await run(['status', '--nesmysl'])).stderr, /nesmysl/);
});

test('nedostupný uzel: srozumitelná rada, ne výpis chyby', async () => {
  const r = await run(['status', '--network', 'dev', '--rpc', 'http://127.0.0.1:9']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /neodpovídá/);
  assert.match(r.stderr, /quinvium node/);
  assert.ok(!r.stderr.includes(' at '), 'bez výpisu zásobníku');
});

test('peněženka: založení, šifrování na disku a práva souborů', async () => {
  const w = await ok('wallet', 'create', 'hlavni');
  me = w.address;
  assert.ok(ethers.isAddress(me));
  assert.equal(statSync(w.path).mode & 0o777, 0o600, 'soubor jen pro vlastníka');
  assert.equal(statSync(dirname(w.path)).mode & 0o777, 0o700, 'složka jen pro vlastníka');
  const onDisk = readFileSync(w.path, 'utf8');
  const parsed = JSON.parse(onDisk);
  assert.equal(parsed.Crypto.kdf, 'scrypt');
  assert.ok(parsed.Crypto.kdfparams.n >= 2 ** 17, 'silná derivace klíče');
  assert.ok(!onDisk.includes(PASSWORD));
  const secret = await run(['wallet', 'phrase', 'hlavni', ...common()]);
  assert.notEqual(secret.code, 0, 'do roury se tajemství samo nevypíše');
  assert.match(secret.stderr, /--show-secret/);
  const shown = await run(['wallet', 'phrase', 'hlavni', ...common(), '--show-secret']);
  const phrase = shown.stdout.trim().split('\n').at(-1).trim();
  assert.equal(phrase.split(' ').length, 12);
  assert.ok(!onDisk.includes(phrase.split(' ')[0] + ' ' + phrase.split(' ')[1]), 'fráze není na disku čitelná');
  const list = await ok('wallet', 'list');
  assert.deepEqual(list.map((x) => x.name), ['hlavni']);
  assert.equal(list[0].default, true);
});

test('peněženka: stejné heslo nestačí, chybné se odmítne a název nejde přepsat', async () => {
  const wrong = join(home, 'spatne.txt');
  writeFileSync(wrong, 'tohle-neni-spravne-heslo', { mode: 0o600 });
  const r = await run(['wallet', 'key', 'hlavni', '--password-file', wrong, '--show-secret']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Špatné heslo/);
  await fails(['wallet', 'create', 'hlavni'], /už existuje/);
  await fails(['wallet', 'create', '../mimo'], /Název peněženky/);
  const short = join(home, 'kratke.txt');
  writeFileSync(short, 'kratke', { mode: 0o600 });
  const weak = await run(['wallet', 'create', 'slaba', '--password-file', short]);
  assert.match(weak.stderr, /nejméně 10/);
});

test('peněženka: obnova z fráze dá stejnou adresu jako aplikace, klíč jde vložit jen vstupem', async () => {
  const phrase = 'test test test test test test test test test test test junk';
  const r = await run(['wallet', 'import', 'obnovena', '--password-file', passwordFile, '--json'], { input: `${phrase}\n` });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  const second = await run(['wallet', 'import', 'druhy-ucet', '--index', '1', '--password-file', passwordFile, '--json'], { input: `${phrase}\n` });
  assert.equal(JSON.parse(second.stdout).address, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  const key = ethers.Wallet.createRandom();
  const k = await run(['wallet', 'import-key', 'zklice', '--password-file', passwordFile, '--json'], { input: `${key.privateKey}\n` });
  assert.equal(JSON.parse(k.stdout).address, key.address);
  const exported = await run(['wallet', 'key', 'zklice', '--password-file', passwordFile, '--show-secret']);
  assert.ok(exported.stdout.includes(key.privateKey));
  await fails(['wallet', 'phrase', 'zklice', '--show-secret'], /fráze u ní není/);
  const bad = await run(['wallet', 'import', 'spatna', '--password-file', passwordFile], { input: 'tohle neni fraze\n' });
  assert.match(bad.stderr, /Neplatná fráze/);
});

test('peněženka: výchozí, smazání a nic jiného se nesmaže', async () => {
  assert.equal((await ok('wallet', 'default', 'zklice')).default, 'zklice');
  assert.equal((await ok('wallet', 'show')).name, 'zklice');
  await ok('wallet', 'default', 'hlavni');
  await ok('wallet', 'remove', 'druhy-ucet');
  assert.deepEqual(readdirSync(join(home, 'wallets')).filter((f) => f.endsWith('.json')).sort(), ['hlavni.json', 'obnovena.json', 'zklice.json']);
  await fails(['wallet', 'show', 'druhy-ucet'], /neexistuje/);
});

test('výchozí zůstává první založená peněženka, ne první podle abecedy', async () => {
  const place = mkdtempSync(join(tmpdir(), 'aether-cli-vychozi-'));
  const env = { AETHER_HOME: place };
  const zeta = JSON.parse((await run(['wallet', 'create', 'zeta', '--password-file', passwordFile, '--json'], { env })).stdout);
  await run(['wallet', 'create', 'alfa', '--password-file', passwordFile, '--json'], { env });
  const shown = JSON.parse((await run(['wallet', 'show', '--json'], { env })).stdout);
  assert.equal(shown.name, 'zeta');
  assert.equal(shown.address, zeta.address);
  await run(['wallet', 'remove', 'zeta', '--yes'], { env });
  assert.equal(JSON.parse((await run(['wallet', 'show', '--json'], { env })).stdout).name, 'alfa', 'po smazání výchozí zbyde další');
});

test('přehled sítě: status, blok, gas a přímý dotaz', async () => {
  const s = await ok('status');
  assert.equal(s.chainId, Number(A.id));
  assert.ok(s.height > 0);
  const b = await ok('block', '1');
  assert.equal(BigInt(b.number), 1n);
  assert.equal((await ok('block', b.hash)).hash, b.hash);
  await fails(['block', '99999999'], /neexistuje/);
  assert.ok((await ok('gas')).tiers.fast);
  const r = await run(['rpc', 'eth_chainId', ...common()]);
  assert.equal(BigInt(JSON.parse(r.stdout)), A.id);
});

test('uzel z jiné sítě se odmítne dřív, než se cokoli podepíše', async () => {
  await A.ok(A.connect(admin).sendTransaction({ to: me, value: 500n * WEI }));
  const r = await run(['send', ethers.ZeroAddress, '1', '--network', 'testnet', '--rpc', url, '--password-file', passwordFile, '--yes']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /je na síti 52403/);
});

test('převod mince: částka dorazí a zůstatek sedí na řetězci', async () => {
  const to = ethers.Wallet.createRandom().address;
  const sent = await ok('send', to, '1.5');
  assert.equal(await A.provider.getBalance(to), 3n * WEI / 2n);
  const r = await A.provider.getTransactionReceipt(sent.hash);
  assert.equal(r.status, 1);
  assert.equal((await ok('tx', sent.hash)).receipt.status, '0x1');
  const b = await ok('balance', to);
  assert.equal(b.dQU, '1.5');
});

test('převod: chyby se chytí před podpisem', async () => {
  await fails(['send', 'nesmysl', '1'], /Neplatná adresa/);
  await fails(['send', ethers.ZeroAddress, 'abc'], /Neplatná částka/);
  await fails(['send', ethers.ZeroAddress, '999999'], /Nedostatek/);
  await fails(['send', ethers.ZeroAddress, '1', '--fee', 'turbo'], /slow, normal nebo fast/);
  await fails(['send', ethers.ZeroAddress, '1', '--token', 'NIC'], /není na ověřeném seznamu/);
  const r = await run(['send', ethers.ZeroAddress, '1', ...common()]);
  assert.match(r.stderr, /--yes/, 'bez terminálu a bez --yes se nic neodešle');
});

test('tokeny: seznam a detail odpovídají kontraktu', async () => {
  const list = await ok('tokens');
  const row = list.find((t) => t.symbol === 'tUSD');
  assert.equal(row.verified, true);
  assert.equal(BigInt(row.supply), await usd.totalSupply());
  assert.equal(BigInt(row.price), (2000n * WEI * 10n ** 6n) / 4_000_000_000n, 'cena z poolu');
  const one = await ok('token', 'tusd');
  assert.equal(one.address, usd.target);
  assert.equal(one.decimals, 6);
  assert.equal(one.holders, 2);
  const foreign = await A.deploy('StableToken', admin, 'Falešný', 'tUSD', 6, admin.address);
  assert.equal((await ok('token', foreign.target)).verified, false, 'stejná zkratka nedělá token ověřeným');
});

test('swap: odhad se shoduje s kontraktem a směna tam i zpět projde', async () => {
  const q = await ok('swap', 'quote', '10', 'dQU', 'tUSD');
  const [, out] = await router.getAmountsOut(10n * WEI, [artifacts.WAET.address, usd.target]);
  assert.equal(BigInt(q.amountOut), out);
  assert.equal(BigInt(q.minimum), out - (out * 50n) / 10000n);
  await ok('swap', '10', 'dQU', 'tUSD');
  const got = await usd.balanceOf(me);
  assert.ok(got >= BigInt(q.minimum), `dostal ${got}`);
  const before = await A.provider.getBalance(me);
  await ok('swap', '5', 'tUSD', 'dQU');
  assert.equal(await usd.balanceOf(me), got - 5_000_000n);
  assert.ok(await A.provider.getBalance(me) > before, 'mince se vrátily');
  assert.equal(await usd.allowance(me, router.target), 0n, 'povolení přesně na částku, nic nezbývá');
  await ok('swap', '1', 'tUSD', 'tBTC');
  // Uzel vrací adresy v kontrolním tvaru, contracts.json malými písmeny: mince sítě se přesto ukáže zkratkou.
  const pools = await ok('swap', 'pools');
  assert.ok(pools.length >= 2);
  for (const p of pools) assert.doesNotMatch(p.pair, /0x/, `pool ${p.pair} ukazuje adresu místo zkratky`);
  assert.ok(pools.some((p) => /dQU/.test(p.pair)));
  await fails(['swap', '1', 'dQU', 'dQU'], /různé tokeny/);
  await fails(['swap', 'quote', '1', 'dQU', 'NIC'], /není na ověřeném seznamu/);
  await fails(['swap', '10000000', 'dQU', 'tUSD', '--slippage', '0.1'], /Nedostatek|selhala/);
});

test('transakce: metoda z ABI a důvod selhání přehraný uzlem', async () => {
  const sent = await ok('send', ethers.Wallet.createRandom().address, '0.1');
  assert.equal((await ok('tx', sent.hash)).method, 'převod');
  // Směna s nesplnitelným minimem a pevným limitem gasu: projde do bloku a tam selže.
  const signer = A.connect(admin);
  const bad = await router.connect(signer).swapExactNativeForTokens(10n ** 30n, [artifacts.WAET.address, usd.target], admin.address, FAR, { value: WEI, gasLimit: 300_000n });
  await bad.wait().catch(() => {});
  const shown = await ok('tx', bad.hash);
  assert.equal(shown.receipt.status, '0x0');
  assert.equal(shown.method, 'swapExactNativeForTokens');
  assert.equal(shown.failure, 'SlippageExceeded');
  const text = await run(['tx', bad.hash, ...common()]);
  assert.match(text.stdout, /Stav:\s+selhala/);
  assert.match(text.stdout, /Důvod:\s+Kurz se mezi odhadem a vytěžením změnil.*\(SlippageExceeded\)/);
});

test('žebříček bez prázdných adres a přehled adresy česky', async () => {
  const r = await ok('rich');
  assert.ok(r.items.length > 0);
  for (const x of r.items) assert.ok(BigInt(x.balance) > 0n, `${x.address} nemá mince`);
  const text = (await run(['address', me, ...common()])).stdout;
  assert.match(text, /Odesláno:\s+\d+ transakc[eí]/);
  assert.doesNotMatch(text, /\b[234] transakcí/, '2 až 4 transakce, ne transakcí');
});

test('quinvium node vedle běžícího uzlu poradí místo chyby EADDRINUSE', async () => {
  const r = await run(['node', '--network', 'dev', '--rpc-port', String(A.node.rpc.port)]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /už běží uzel/);
  assert.match(r.stderr, /--data-dir/);
  assert.doesNotMatch(r.stderr, /EADDRINUSE/);
});

test('swap: skluz chrání před horším kurzem', async () => {
  const q = await ok('swap', 'quote', '1', 'dQU', 'tUSD', '--slippage', '1');
  assert.equal(BigInt(q.minimum), BigInt(q.amountOut) - (BigInt(q.amountOut) * 100n) / 10000n);
  await fails(['swap', '1', 'dQU', 'tUSD', '--slippage', '99'], /Skluz/);
});

test('likvidita: vklad, podíl a výběr', async () => {
  await ok('liquidity', 'add', '1', 'dQU', '2', 'tUSD');
  const list = await ok('liquidity', 'list');
  assert.equal(list.length, 1);
  assert.ok(list[0].mine !== '0');
  await ok('liquidity', 'remove', 'dQU', 'tUSD', '--percent', '50');
  const half = await ok('liquidity', 'list');
  assert.ok(BigInt(half[0].mine) < BigInt(list[0].mine));
  await ok('liquidity', 'remove', 'dQU', 'tUSD');
  assert.deepEqual(await ok('liquidity', 'list'), []);
  await fails(['liquidity', 'remove', 'dQU', 'tUSD'], /nemáte žádnou likviditu/);
});

test('pool: založení, přehled a ochrana před cizí adresou', async () => {
  const made = await ok('pool', 'create', '--name', 'Pool z příkazové řádky', '--url', 'http://127.0.0.1:1', '--fee-percent', '2');
  assert.ok(ethers.isAddress(made.pool));
  const list = await ok('pool', 'list');
  assert.ok(list.some((p) => p.address === made.pool && p.feePercent === 2));
  const info = await ok('pool', 'info', made.pool);
  assert.equal(info.operator, me);
  await fails(['pool', 'claim', made.pool], /nic k výběru/);
  await fails(['pool', 'info', usd.target], /není pool z továrny/);
  await fails(['pool', 'create', '--name', 'X', '--fee-percent', '50'], /nejvýše 5/);
});

test('těžba: miner dostane správnou adresu, uzel i pool', async () => {
  const fake = join(home, 'falesny-miner.sh');
  writeFileSync(fake, '#!/bin/sh\necho "ARGUMENTY $*"\n');
  chmodSync(fake, 0o755);
  const env = { AETHER_MINER: fake };
  const solo = await run(['mine', '--intensity', '60', '--device', '1', ...common()], { env });
  assert.equal(solo.code, 0, solo.stderr);
  assert.ok(solo.stdout.includes(`--node ${url}`));
  assert.ok(solo.stdout.includes(`--address ${me}`), 'odměna jde do výchozí peněženky');
  assert.ok(solo.stdout.includes('--intensity 60'));
  assert.ok(solo.stdout.includes('--device 1'));
  const other = ethers.Wallet.createRandom().address;
  assert.ok((await run(['mine', '--address', other, ...common()], { env })).stdout.includes(`--address ${other}`));
  const [{ address: pool, url: server }] = await ok('pool', 'list');
  const pooled = await run(['mine', '--pool', pool, '--worker', 'stroj1', ...common()], { env });
  assert.ok(pooled.stdout.includes(`--pool ${pool}`));
  assert.ok(pooled.stdout.includes(`--node ${server}`), 'pool má vlastní server');
  assert.ok(pooled.stdout.includes('--worker stroj1'));
  const bad = await run(['mine', '--pool', usd.target, ...common()], { env });
  assert.match(bad.stderr, /Netěžte do ní/, 'do cizího kontraktu se netěží');
  assert.ok(!bad.stdout.includes('ARGUMENTY'));
});

test('most: trasy, převod na jinou síť a doručení validátory', async () => {
  const routes = await ok('bridge', 'routes');
  assert.equal(routes.open, true);
  assert.equal(routes.routes.length, 2);
  await fails(['bridge', 'out', '0.5', 'NIC'], /Trasa pro NIC není/);
  const before = await B.provider.getBalance(me);
  const r = await ok('bridge', 'out', '5', 'dQU');
  assert.ok(r.hash);
  const token = (JSON.parse(readFileSync(deploymentsFile, 'utf8'))[A.id]).assets[0].remoteToken;
  const remote = B.at('WrappedAsset', token);
  for (let i = 0; i < 300 && await remote.balanceOf(me) === 0n; i++) await new Promise((res) => { setTimeout(res, 100); });
  assert.equal(await remote.balanceOf(me), 5n * WEI);
  assert.equal(await B.provider.getBalance(me), before);
  for (let i = 0; i < 100; i++) {
    const history = await ok('bridge', 'status');
    if (history[0]?.state === 'doručeno') return;
    await new Promise((res) => { setTimeout(res, 100); });
  }
  assert.fail('stav převodu se nezměnil na doručeno');
});

test('most: cesta zpět na Quinvium podepisuje stejný klíč na zdrojové síti', async () => {
  await B.ok(B.connect(admin).sendTransaction({ to: me, value: 5n * WEI }));
  const token = (JSON.parse(readFileSync(deploymentsFile, 'utf8'))[A.id]).assets[0].remoteToken;
  const remote = B.at('WrappedAsset', token);
  const before = await A.provider.getBalance(me);
  const had = await remote.balanceOf(me);
  const r = await ok('bridge', 'in', '2', 'dQU');
  assert.ok(r.hash);
  assert.equal(await remote.balanceOf(me), had - 2n * WEI, 'na zdrojové síti se token spálil');
  for (let i = 0; i < 300 && await A.provider.getBalance(me) === before; i++) await new Promise((res) => { setTimeout(res, 100); });
  assert.equal(await A.provider.getBalance(me), before + 2n * WEI);
});

test('most: vkladová adresa pro Bitcoin je stejná, jakou spočítají validátoři', async () => {
  const r = await ok('bridge', 'deposit-btc');
  assert.match(r.deposit, /^bcrt1/);
  const expected = team[0].bridge.depositAddress(me);
  assert.equal(r.deposit, expected);
  await fails(['bridge', 'out', '1', 'aBTC', 'bc1qneplatna'], /Nedostatek|nepatří síti/);
});

test('podpis zprávy a jeho ověření', async () => {
  const s = await ok('sign', 'jsem majitel adresy');
  assert.equal(s.address, me);
  assert.equal((await ok('verify', 'jsem majitel adresy', s.signature)).address, me);
  await fails(['verify', 'jiný text', s.signature, me], /patří adrese/);
});

test('quinvium node spustí plný uzel s nápovědou uzlu', async () => {
  const r = await run(['node', '--help']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /--data-dir/);
  assert.match(r.stdout, /--stratum-port/);
});

test('výstup bez --json je čitelný a výpis zůstatku ukáže tokeny', async () => {
  const r = await run(['balance', ...common()]);
  assert.match(r.stdout, /dQU/);
  assert.match(r.stdout, /tUSD/);
  const noWallet = spawn(process.execPath, ['--no-warnings', CLI, 'balance', '--network', 'dev', '--rpc', url], { env: { ...process.env, AETHER_HOME: join(home, 'prazdna') } });
  let text = '';
  noWallet.stderr.on('data', (d) => { text += d; });
  await new Promise((res) => { noWallet.on('exit', res); });
  assert.match(text, /quinvium wallet create/);
});

test('čísla: malá cena zůstane vidět, nenulová částka nevypadá jako nula, čeština skloňuje', async () => {
  const { amountText, plural, significant } = await import('../src/context.js');
  assert.equal(significant(8_017_647_058n, 18, 6), '0.00000000801764', 'cena pod miliontinou: šest platných číslic');
  assert.equal(significant(3_770_849_507_980_000_000_000n, 18, 6), '3770.849507');
  assert.equal(significant(0n), '0');
  assert.equal(amountText(1n, 18, 4), '< 0.0001');
  assert.equal(amountText(0n, 18, 4), '0');
  assert.equal(amountText(15n * 10n ** 17n, 18, 4), '1.5');
  assert.deepEqual([0, 1, 2, 4, 5, 28].map((n) => plural(n, 'transakce', 'transakce', 'transakcí')), ['0 transakcí', '1 transakce', '2 transakce', '4 transakce', '5 transakcí', '28 transakcí']);
});

// ------------------------------------------------------------------- aplikace sítě
const walletOf = async (name) => (await ok('wallet', 'show', name)).address;
const fund = async (name) => {
  const address = await walletOf(name);
  if (await A.provider.getBalance(address) < 20n * WEI) await A.ok(A.connect(admin).sendTransaction({ to: address, value: 50n * WEI }));
  return address;
};

test('aplikace: notář zapíše otisk souboru i textu, ověří ho a odvolá', async () => {
  const file = join(home, 'smlouva.txt');
  writeFileSync(file, 'Smlouva o dílo, verze 1');
  const sha = `0x${crypto.createHash('sha256').update(readFileSync(file)).digest('hex')}`;
  const stamped = await ok('notary', 'stamp', file, '--note', 'podepsáno');
  assert.equal(stamped.hash, sha, 'otisk souboru je SHA-256 jako v Exploreru');
  const found = await ok('notary', 'verify', file);
  assert.equal(found.exists, true);
  assert.equal(found.author, me);
  assert.equal(found.note, 'podepsáno');
  assert.equal(found.revokedAt, '0');
  assert.equal((await ok('notary', 'verify', sha)).exists, true, 'ověření podle otisku');
  await fails(['notary', 'stamp', file], /už máte zapsaný/);
  assert.equal((await ok('notary', 'stamp', '--text', 'Ahoj světe')).hash, ethers.id('Ahoj světe'), 'text jako v Exploreru: keccak256');
  await ok('notary', 'revoke', file, '--reason', 'nahrazeno novou verzí');
  assert.notEqual((await ok('notary', 'verify', file)).revokedAt, '0');
  const text = (await run(['notary', 'verify', file, ...common()])).stdout;
  assert.match(text, /ODVOLÁNO/);
  writeFileSync(join(home, 'jiny.txt'), 'nikdo nezapsal');
  assert.equal((await ok('notary', 'verify', join(home, 'jiny.txt'))).exists, false);
  await fails(['notary', 'stamp', join(home, 'neni.txt')], /neexistuje/);
});

test('aplikace: certifikáty od registrace vydavatele po odvolání', async () => {
  const holder = ethers.Wallet.createRandom().address;
  await fails(['credential', 'issue', 'DIPLOM-1', holder], /zaregistrujte jako vydavatel/);
  await ok('credential', 'register', 'Testovací univerzita', '--website', 'https://example.edu');
  await ok('credential', 'issue', 'DIPLOM-1', holder, '--type', 'Bakalář');
  const valid = await ok('credential', 'verify', 'DIPLOM-1', me);
  assert.equal(valid.valid, true);
  assert.equal(valid.subject, holder);
  assert.equal(valid.issuerName, 'Testovací univerzita');
  assert.equal(valid.expiresAt, '0', 'bez --days platí bez omezení');
  await fails(['credential', 'issue', 'DIPLOM-1', holder], /Doklad s tímto číslem už jste vydali/);
  await ok('credential', 'issue', 'DIPLOM-2', holder, '--days', '30');
  assert.ok(Number((await ok('credential', 'verify', 'DIPLOM-2', me)).expiresAt) > Date.now() / 1000);
  await ok('credential', 'revoke', 'DIPLOM-1', '--reason', 'chyba v zápisu');
  assert.equal((await ok('credential', 'verify', 'DIPLOM-1', me)).valid, false);
  assert.equal((await ok('credential', 'verify', 'NIKDY-NEVYDANO', me)).issued, false);
});

test('aplikace: dodavatelský řetězec s předáním mezi dvěma peněženkami', async () => {
  const other = await fund('obnovena');
  const evidence = join(home, 'dodaci-list.txt');
  writeFileSync(evidence, 'dodací list 42');
  const { id } = await ok('supply', 'create', 'KAVA-001');
  assert.ok(Number(id) >= 1, 'číslo nové položky');
  await ok('supply', 'step', id, 'Praha', 'expedováno', '--evidence', evidence);
  await ok('supply', 'offer', id, other);
  await fails(['supply', 'accept', id], /Předání není určené vám/);
  await ok('supply', 'accept', id, '--wallet', 'obnovena');
  const shown = await ok('supply', 'show', id);
  assert.equal(shown.sku, 'KAVA-001');
  assert.equal(shown.custodian, other);
  assert.equal(shown.steps.length, 1);
  assert.equal(shown.steps[0].location, 'Praha');
  assert.equal(shown.steps[0].evidence, `0x${crypto.createHash('sha256').update('dodací list 42').digest('hex')}`);
  await fails(['supply', 'step', id, 'Brno', 'na cestě'], /Zboží teď nedržíte/);
  await ok('supply', 'close', id, '--wallet', 'obnovena');
  assert.equal((await ok('supply', 'show', id)).closed, true);
  await fails(['supply', 'show', '999999'], /neexistuje/);
  await fails(['supply', 'show', 'abc'], /celé číslo/);
});

test('aplikace: úschova od zaplacení po výběr, spor rozhodne rozhodce', async () => {
  const seller = await fund('obnovena');
  const arbiter = await fund('zklice');
  const deal = await ok('escrow', 'create', seller, arbiter, '2', '--days', '3');
  const d = await ok('escrow', 'show', deal.id);
  assert.equal(d.state, 1);
  assert.equal(BigInt(d.amount), 2n * WEI);
  assert.equal(d.seller, seller);
  assert.equal(d.buyer, me);
  await fails(['escrow', 'release', deal.id, '--wallet', 'obnovena'], /jen jiná strana/);
  await ok('escrow', 'release', deal.id);
  const before = await A.provider.getBalance(seller);
  await ok('escrow', 'withdraw', '--wallet', 'obnovena');
  assert.ok(await A.provider.getBalance(seller) > before + WEI, 'prodávající dostal platbu');
  await fails(['escrow', 'withdraw', '--wallet', 'obnovena'], /nic nečeká/);
  const second = await ok('escrow', 'create', seller, arbiter, '1');
  await ok('escrow', 'dispute', second.id);
  assert.equal((await ok('escrow', 'show', second.id)).state, 2);
  await ok('escrow', 'resolve', second.id, '75', '--wallet', 'zklice');
  assert.equal((await ok('escrow', 'show', second.id)).state, 3);
  await fails(['escrow', 'create', me, arbiter, '1'], /tři různé adresy/);
});

test('aplikace: hlasování, každá adresa má jeden hlas', async () => {
  await fund('obnovena');
  await fund('zklice');
  const poll = await ok('poll', 'create', 'Kam na výlet?', 'Hory', 'Moře', 'Doma', '--days', '1');
  await ok('poll', 'vote', poll.id, '2');
  await fails(['poll', 'vote', poll.id, '1'], /už jste hlasovali/);
  await ok('poll', 'vote', poll.id, '2', '--wallet', 'obnovena');
  const shown = await ok('poll', 'show', poll.id);
  assert.deepEqual(shown.choices, ['Hory', 'Moře', 'Doma']);
  assert.deepEqual(shown.votes, ['0', '2', '0']);
  assert.equal(shown.open, true);
  await fails(['poll', 'vote', poll.id, '4', '--wallet', 'zklice'], /jen 3 možnosti/);
  await fails(['poll', 'vote', poll.id, '0', '--wallet', 'zklice'], /od 1/);
  const comma = await ok('poll', 'create', 'Ano, nebo ne?', 'Ano, Ne');
  assert.deepEqual((await ok('poll', 'show', comma.id)).choices, ['Ano', 'Ne'], 'možnosti oddělené čárkou');
  await fails(['poll', 'create', 'Jen jedna?', 'Ano'], /aspoň dvě možnosti/);
});

test('aplikace: jméno .qu na dva kroky, převod na jméno a jeho správa', async () => {
  const other = await fund('obnovena');
  assert.equal((await ok('name', 'info', 'testcli')).available, true);
  const reg = await ok('name', 'register', 'testcli');
  assert.equal(reg.target, me);
  assert.ok(Number(reg.expires) > Date.now() / 1000);
  const info = await ok('name', 'info', 'testcli.qu');
  assert.equal(info.owner, me);
  assert.equal(info.target, me);
  await ok('name', 'primary', 'testcli');
  assert.equal((await ok('name', 'of', me)).name, 'testcli');
  await ok('name', 'target', 'testcli', other);
  const before = await A.provider.getBalance(other);
  await ok('send', 'testcli.qu', '1');
  assert.equal(await A.provider.getBalance(other), before + WEI, 'převod na jméno dorazil na cílovou adresu');
  const expires = BigInt(info.expires);
  await ok('name', 'renew', 'testcli');
  assert.ok(BigInt((await ok('name', 'info', 'testcli')).expires) > expires, 'prodloužení posune platnost');
  await ok('name', 'transfer', 'testcli', other);
  assert.equal((await ok('name', 'info', 'testcli')).owner, other);
  await fails(['name', 'register', 'testcli'], /obsazené/);
  await fails(['name', 'info', 'X!'], /Neplatné jméno/);
  await fails(['name', 'primary', 'nikdo-nevlastni'], /nikdo nevlastní/);
});

test('aplikace: vlastní token, převod přes --token a seznam vytvořených', async () => {
  const made = await ok('token', 'create', 'Body věrnosti', 'BODY', '1000');
  assert.ok(ethers.isAddress(made.token));
  const to = ethers.Wallet.createRandom().address;
  await ok('send', to, '10', '--token', made.token);
  const erc20 = new ethers.Contract(made.token, ['function balanceOf(address) view returns (uint256)'], A.provider);
  assert.equal(await erc20.balanceOf(to), 10n * WEI);
  assert.equal(await erc20.balanceOf(me), 990n * WEI);
  const created = await ok('token', 'created');
  assert.ok(created.some((t) => t.address === made.token && t.symbol === 'BODY'));
  assert.equal((await ok('token', made.token)).verified, false, 'vlastní token je neověřený');
  assert.match((await run(['token', 'help', ...common()])).stdout, /token create/);
});

test('aplikace: sbírka NFT, ražba jen tvůrcem a bezpečný převod', async () => {
  const other = await fund('obnovena');
  const col = await ok('nft', 'create', 'Vstupenky', 'VST');
  assert.ok(ethers.isAddress(col.collection));
  const minted = await ok('nft', 'mint', col.collection, me, 'ipfs://vstupenka-1');
  assert.equal(minted.id, '1');
  const shown = await ok('nft', 'show', col.collection, minted.id);
  assert.equal(shown.owner, me);
  assert.equal(shown.uri, 'ipfs://vstupenka-1');
  assert.equal(shown.minted, '1');
  await fails(['nft', 'mint', col.collection, other, 'ipfs://x', '--wallet', 'obnovena'], /jen tvůrce/);
  await ok('nft', 'send', col.collection, minted.id, other);
  assert.equal((await ok('nft', 'show', col.collection, minted.id)).owner, other);
  await fails(['nft', 'send', col.collection, minted.id, me], /nevlastníte/);
  assert.ok((await ok('nft', 'created')).some((c) => c.address === col.collection));
  await fails(['nft', 'show', ethers.Wallet.createRandom().address], /není sbírka/);
});

test('aplikace: peněženka se dvěma podpisy ze tří', async () => {
  const b = await fund('obnovena');
  const c = await fund('zklice');
  const made = await ok('multisig', 'create', `${me},${b},${c}`, '2');
  assert.ok(ethers.isAddress(made.wallet));
  await ok('send', made.wallet, '3');
  const payee = ethers.Wallet.createRandom().address;
  const proposal = await ok('multisig', 'propose', made.wallet, payee, '1.5');
  await fails(['multisig', 'execute', made.wallet, proposal.id], /Chybí schválení/);
  await ok('multisig', 'approve', made.wallet, proposal.id, '--wallet', 'zklice');
  await ok('multisig', 'execute', made.wallet, proposal.id, '--wallet', 'obnovena');
  assert.equal(await A.provider.getBalance(payee), 3n * WEI / 2n, 'platba odešla až po dvou schváleních');
  const shown = await ok('multisig', 'show', made.wallet, proposal.id);
  assert.equal(shown.executed, true);
  assert.equal(shown.approvals, '2');
  assert.equal(BigInt(shown.balance), 3n * WEI / 2n);
  assert.ok((await ok('multisig', 'list', b)).some((w) => w.address === made.wallet));
  await fails(['multisig', 'create', `${me},${me}`, '1'], /jen jednou/);
  await fails(['multisig', 'create', `${me},${b}`, '3'], /1 až 2/);
});

test('aplikace bez podpříkazu ukážou nápovědu, neznámý podpříkaz je chyba', async () => {
  for (const app of ['notary', 'credential', 'supply', 'escrow', 'poll', 'name', 'nft', 'multisig']) {
    const r = await run([app, ...common()]);
    assert.equal(r.code, 0, `${app}: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`quinvium ${app} `), app);
  }
  assert.match((await run(['help', 'escrow'])).stdout, /quinvium escrow create/);
  const bad = await run(['notary', 'smazat', ...common()]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /Neznámý příkaz notary smazat/);
});

test('angličtina: --lang, uložená volba a jazyk systému', async () => {
  const en = await run(['status', ...common(), '--lang', 'en']);
  assert.equal(en.code, 0, en.stderr);
  assert.match(en.stdout, /Network:/);
  assert.match(en.stdout, /Height:/);
  assert.match((await run(['neexistuje', '--lang', 'en'])).stderr, /Error: Unknown command/);
  assert.match((await run(['notary', '--lang', 'en'])).stdout, /Notary: proves/);
  assert.match((await run(['node', '--help', '--lang', 'en'])).stdout, /Usage: quintium-node/);
  const failed = await run(['send', 'nesmysl', '1', ...common(), '--yes', '--lang', 'en']);
  assert.match(failed.stderr, /Invalid address/);
  const json = JSON.parse((await run(['status', ...common(), '--json', '--lang', 'en'])).stdout);
  assert.equal(json.chainId, Number(A.id), 'JSON pro skripty je v obou jazycích stejný');

  const place = mkdtempSync(join(tmpdir(), 'aether-cli-jazyk-'));
  const system = (lang) => ({ AETHER_HOME: place, QUINTIUM_LANG: '', LC_ALL: '', LC_MESSAGES: '', LANG: lang });
  assert.match((await run(['--help'], { env: system('en_US.UTF-8') })).stdout, /Usage: quinvium/);
  assert.match((await run(['--help'], { env: system('cs_CZ.UTF-8') })).stdout, /Použití: quinvium/);
  assert.match((await run(['--help'], { env: system('de_DE.UTF-8') })).stdout, /Usage: quinvium/, 'jiný jazyk systému dá angličtinu');
  assert.match((await run(['lang', 'cs'], { env: system('en_US.UTF-8') })).stdout, /čeština/);
  assert.equal(JSON.parse(readFileSync(join(place, 'cli.json'), 'utf8')).lang, 'cs');
  assert.match((await run(['--help'], { env: system('en_US.UTF-8') })).stdout, /Použití/, 'uložená volba má přednost před jazykem systému');
  assert.match((await run(['--help', '--lang', 'en'], { env: system('en_US.UTF-8') })).stdout, /Usage/, '--lang má přednost před uloženou volbou');
  assert.notEqual((await run(['lang', 'xx'], { env: system('en_US.UTF-8') })).code, 0);
});

// ------------------------------------------------------------------- hledání, přihlášení a peněženka z aplikace
/** Trezor jako v aplikaci (background.js): WebCrypto, PBKDF2-SHA256 a AES-GCM. Méně iterací kvůli rychlosti testu. */
async function appVault(text, secret, iterations = 1000) {
  const { subtle, getRandomValues } = crypto.webcrypto;
  const salt = getRandomValues.call(crypto.webcrypto, new Uint8Array(16));
  const iv = getRandomValues.call(crypto.webcrypto, new Uint8Array(12));
  const base = await subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) };
}

test('peněženka z aplikace: stejná adresa jen heslem, u MetaMasku a špatného hesla rada', async () => {
  const phrase = 'test test test test test test test test test test test junk';
  const appData = mkdtempSync(join(tmpdir(), 'aether-cli-aplikace-'));
  const place = mkdtempSync(join(tmpdir(), 'aether-cli-zaplikace-'));
  const env = { AETHER_HOME: place, AETHER_APP_DATA: appData };
  const key = ethers.Wallet.createRandom();
  writeFileSync(join(appData, 'wallet.json'), JSON.stringify({ vault: await appVault(phrase, PASSWORD), keyVault: await appVault(JSON.stringify([key.privateKey]), PASSWORD), accountCount: 2, selected: 1 }));
  const picked = await run(['wallet', 'import-app', 'zaplikace', '--password-file', passwordFile, '--json'], { env });
  assert.equal(picked.code, 0, picked.stderr);
  assert.equal(JSON.parse(picked.stdout).address, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'účet vybraný v aplikaci, druhý z fráze');
  const imported = await run(['wallet', 'import-app', 'klic-z-aplikace', '--index', '2', '--password-file', passwordFile, '--json'], { env });
  assert.equal(JSON.parse(imported.stdout).address, key.address, 'importovaný klíč aplikace');
  const signed = await run(['sign', 'ahoj', '--wallet', 'zaplikace', ...common(), '--json'], { env });
  assert.equal(JSON.parse(signed.stdout).address, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'heslo zůstalo stejné jako v aplikaci');
  const wrong = join(place, 'spatne.txt');
  writeFileSync(wrong, 'tohle-heslo-aplikace-neni', { mode: 0o600 });
  assert.match((await run(['wallet', 'import-app', 'x', '--password-file', wrong], { env })).stderr, /Špatné heslo peněženky aplikace/);
  assert.match((await run(['wallet', 'import-app', 'x', '--index', '5', '--password-file', passwordFile], { env })).stderr, /má jich 3/);
  writeFileSync(join(appData, 'wallet.json'), JSON.stringify({ external: { kind: 'injected', name: 'MetaMask', address: me } }));
  const external = await run(['wallet', 'import-app', 'y', '--password-file', passwordFile], { env });
  assert.match(external.stderr, /přes MetaMask/);
  assert.match(external.stderr, /quinvium wallet import/);
  assert.match((await run(['wallet', 'import-app', 'z', '--password-file', passwordFile], { env: { AETHER_HOME: place, AETHER_APP_DATA: join(place, 'zadna') } })).stderr, /se nenašla/);
});

test('login ukáže, se kterou peněženkou se pracuje, a přepne ji', async () => {
  const shown = await ok('login');
  assert.equal(shown.wallet, 'hlavni');
  assert.equal(shown.address, me);
  assert.equal((await ok('login', 'zklice')).wallet, 'zklice');
  assert.equal((await ok('wallet', 'show')).name, 'zklice');
  await ok('login', 'hlavni');
  await fails(['login', 'neexistuje'], /neexistuje/);
  const empty = await run(['login'], { env: { AETHER_HOME: mkdtempSync(join(tmpdir(), 'aether-cli-bez-penezenky-')) } });
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /wallet import-app/);
});

test('hledání jako v Exploreru: blok, transakce, adresa, token a jméno', async () => {
  const sent = await ok('send', ethers.Wallet.createRandom().address, '0.01');
  assert.equal(BigInt((await ok('search', '1')).number), 1n, 'číslo bloku');
  const b = await ok('block', '2');
  assert.equal((await ok('search', b.hash)).hash, b.hash, 'hash bloku');
  assert.equal((await ok('search', sent.hash)).transaction.hash, sent.hash, 'hash transakce');
  assert.ok('balance' in (await ok('search', me)), 'adresa');
  assert.equal((await ok('search', 'tusd')).symbol, 'tUSD', 'zkratka tokenu bez ohledu na velikost písmen');
  assert.equal((await ok('search', 'testcli.qu')).owner, await walletOf('obnovena'), 'jméno .qu');
  assert.match((await run(['search', '1', ...common()])).stdout, /Nalezeno: blok/);
  await fails(['search', '99999999'], /zatím neexistuje/);
  await fails(['search', 'nic-takoveho-neni'], /Nic nenalezeno/);
  await fails(['search'], /Zadejte, co hledat/);
});

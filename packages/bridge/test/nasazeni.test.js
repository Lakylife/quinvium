// The scripts/nasadit-most.mjs script on two local chains: one has the Quinvium testnet chainId, the other Sepolia's.
// The deployment completes, validators with the generated configuration convert ETH to qETH and back, and the Explorer gets the route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { Relayer } from '../src/relayer.js';
import { WEI, artifacts, makeChain } from './helpers/chains.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const admin = ethers.Wallet.createRandom();
const alice = ethers.Wallet.createRandom();
const keys = { spravce: admin, strazce: ethers.Wallet.createRandom(), 'validator-1': ethers.Wallet.createRandom(), 'validator-2': ethers.Wallet.createRandom(), 'validator-3': ethers.Wallet.createRandom() };
const Q = makeChain(52402n, 'quinvium', [admin, alice]);
const S = makeChain(11155111n, 'sepolia', [admin, alice]);
const home = mkdtempSync(join(tmpdir(), 'most-nasazeni-'));
const dir = join(home, '.aether', 'most-testnet');
const deployments = join(home, 'deployments.json');

let mining = true;
async function keepMining() {
  while (mining) {
    await Q.mine().catch(() => {});
    await S.mine().catch(() => {});
    await new Promise((r) => { setTimeout(r, 40); });
  }
}
const script = (qRpc, sRpc) => new Promise((resolve, reject) => {
  execFile(process.execPath, [join(root, 'scripts/nasadit-most.mjs'), qRpc, sRpc], { env: { ...process.env, HOME: home, MOST_DEPLOYMENTS: deployments }, timeout: 120000 }, (e, out, err) => (e ? reject(new Error(`${e.message}\n${out}\n${err}`)) : resolve(out)));
});

test.before(async () => {
  await Q.start();
  await S.start();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [name, w] of Object.entries(keys)) writeFileSync(join(dir, `${name}.key`), `${w.privateKey}\n`, { mode: 0o600 });
  copyFileSync(join(root, 'packages/explorer/public/deployments.json'), deployments);
});
test.after(async () => { mining = false; await Q.stop(); await S.stop(); });

test('the test bridge deployment passes and an ETH ↔ qETH transfer works in both directions', async () => {
  const loop = keepMining();
  const qRpc = `http://127.0.0.1:${Q.node.rpc.port}`;
  const sRpc = `http://127.0.0.1:${S.node.rpc.port}`;
  let out;
  try {
    out = await script(qRpc, sRpc);
    // A second run deploys nothing new; it only continues from the saved progress.
    const again = await script(qRpc, sRpc);
    assert.equal(again.match(/Brána na Quinviu: (0x\w+)/)[1], out.match(/Brána na Quinviu: (0x\w+)/)[1], 'opakované spuštění nasazuje znovu');
  } finally {
    mining = false;
    await loop;
  }
  assert.doesNotMatch(out, new RegExp(admin.privateKey.slice(2)), 'skript nevypisuje klíče');
  const state = JSON.parse(readFileSync(join(dir, 'nasazeni.json'), 'utf8'));
  const here = JSON.parse(readFileSync(deployments, 'utf8'))['52402'];
  assert.equal(here.gateway, state.gatewayQ);
  assert.ok(here.swap?.router, 'Swap v souboru zůstal');
  assert.deepEqual(here.networks.map((n) => [n.id, n.gateway]), [[11155111, state.gatewayS]]);
  assert.deepEqual(here.assets.map((a) => [a.symbol, a.token, a.remoteToken]), [['ETH', state.qETH, ethers.ZeroAddress]]);

  const gateQ = Q.at('BridgeGateway', state.gatewayQ);
  const gateS = S.at('BridgeGateway', state.gatewayS);
  assert.equal(await gateQ.threshold(), 2n);
  assert.deepEqual([...(await gateS.validators())].sort(), [keys['validator-1'].address, keys['validator-2'].address, keys['validator-3'].address].sort());
  for (const name of ['validator-1', 'validator-2', 'validator-3']) {
    assert.ok(await Q.provider.getBalance(keys[name].address) > 0n && await S.provider.getBalance(keys[name].address) > 0n, `${name} má plyn`);
  }

  // Validators with the configuration from the script: only the RPC is taken from the local chains in the test.
  const relayers = ['validator-1', 'validator-2', 'validator-3'].map((name) => {
    const config = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
    assert.equal(config.chains.length, 2);
    const chains = config.chains.map((c) => ({ ...c, id: BigInt(c.id), provider: (c.id === 52402 ? Q : S).provider }));
    return new Relayer({ chains, privateKey: keys[name].privateKey, statePath: join(dir, `${name}-test-stav.json`) });
  });
  const run = async (rounds = 40) => {
    for (let i = 0; i < rounds; i++) {
      for (const r of relayers) await r.tick();
      await Q.mine();
      await S.mine();
    }
  };
  const qETH = Q.at('WrappedAsset', state.qETH);
  await S.ok(gateS.connect(S.connect(alice)).send(ethers.ZeroAddress, WEI / 100n, 52402, alice.address, { value: WEI / 100n }));
  await run();
  assert.equal(await qETH.balanceOf(alice.address), WEI / 100n, 'qETH dorazil na Quinvium');
  const before = await S.provider.getBalance(alice.address);
  await Q.ok(gateQ.connect(Q.connect(alice)).send(state.qETH, WEI / 200n, 11155111, alice.address));
  await run();
  assert.equal(await qETH.balanceOf(alice.address), WEI / 200n, 'polovina qETH se spálila');
  assert.equal(await S.provider.getBalance(alice.address) - before, WEI / 200n, 'ETH se vrátil na Sepolii');
  assert.equal(await gateS.locked(ethers.ZeroAddress), WEI / 200n, 'v bráně zůstalo krytí zbylého qETH');
});

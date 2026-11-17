// The main server goes down: the network must keep going without it. Separate dev network nodes on 127.0.0.1 only:
// A plays our public server (seed, RPC and the only miner), B and C are independent nodes that know only A as a seed,
// D is a new node that joins after A is gone. Nothing here touches mainnet or testnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const SLOT = { A: 0, B: 1, C: 2, D: 3 };
const P2P = (n) => 31620 + SLOT[n];
const RPC = (n) => `http://127.0.0.1:${18620 + SLOT[n]}`;

// node:http with a fresh connection each time: pooled fetch sockets can crash on macOS after a node is killed.
const call = (n, method, params = []) => new Promise((resolve, reject) => {
  const req = http.request(RPC(n), { method: 'POST', agent: false, timeout: 5000, headers: { 'Content-Type': 'application/json', Connection: 'close' } }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; });
    res.on('end', () => { try { const d = JSON.parse(text); if (d.error) reject(new Error(d.error.message)); else resolve(d.result); } catch (e) { reject(e); } });
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
});
const height = (n) => call(n, 'eth_blockNumber').then((h) => Number(BigInt(h))).catch(() => -1);
const peers = (n) => call(n, 'aether_stats').then((s) => s.peers).catch(() => -1);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function until(fn, ms, step = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(step); }
  return false;
}

test('the network keeps working when the main server goes down', { timeout: 15 * 60_000 }, async () => {
  const base = mkdtempSync(join(tmpdir(), 'qu-outage-'));
  const procs = {};
  const wallet = ethers.Wallet.createRandom();
  const start = (name, { seeds = [], mine = false } = {}) => {
    const args = ['--no-warnings', CLI, '--network', 'dev', '--data-dir', join(base, name), '--p2p-port', String(P2P(name)), '--rpc-port', String(18620 + SLOT[name]),
      '--stratum-port', String(33620 + SLOT[name]), '--allow-private', '--no-site-check', '--exit-with-parent'];
    if (seeds.length) args.push('--seeds', seeds.map((s) => `127.0.0.1:${P2P(s)}`).join(','));
    if (mine) args.push('--dev-mine', '--miner-address', wallet.address);
    procs[name] = spawn(process.execPath, args, { stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, AETHER_NO_SEEDS: '1' } });
  };
  // Waits for the process itself to end, not only for its RPC: a node that still holds its ports or data folder
  // would make the restarted one fail.
  const stop = async (name) => {
    const p = procs[name];
    if (p.exitCode !== null || p.signalCode !== null) return;
    const ended = new Promise((r) => { p.once('exit', r); });
    p.kill('SIGINT');
    if (!(await Promise.race([ended.then(() => true), sleep(30_000).then(() => false)]))) { p.kill('SIGKILL'); await ended; }
  };
  try {
    start('A', { mine: true });
    start('B', { seeds: ['A'] });
    start('C', { seeds: ['A'] });
    assert.ok(await until(async () => (await height('B')) >= 5 && (await height('C')) >= 5, 180_000), 'B and C sync from A');
    assert.ok(await until(async () => (await peers('B')) >= 2 && (await peers('C')) >= 2, 180_000, 3000), 'B and C find each other through peer exchange');

    // The main server disappears without a goodbye; an independent operator (B) starts mining.
    procs.A.kill('SIGKILL');
    await stop('B');
    start('B', { seeds: ['A'], mine: true });
    assert.ok(await until(async () => (await height('B')) >= 0, 60_000), 'B starts again');
    const from = await height('B');
    assert.ok(await until(async () => (await height('B')) >= from + 3, 180_000), 'mining continues without A');
    assert.ok(await until(async () => (await height('C')) >= from + 3, 180_000), 'C keeps syncing from B');
    assert.ok((await peers('B')) >= 1, 'B reconnects from its remembered peers, without the seed');

    // A wallet uses another node: balance and a transaction through C, mined by B.
    const provider = new ethers.JsonRpcProvider(RPC('C'), undefined, { staticNetwork: true });
    assert.ok((await provider.getBalance(wallet.address)) > 0n, 'balance through C');
    const to = ethers.Wallet.createRandom().address;
    await wallet.connect(provider).sendTransaction({ to, value: ethers.parseEther('1') });
    assert.ok(await until(async () => (await provider.getBalance(to)) === ethers.parseEther('1'), 180_000, 2000), 'a transaction sent through C is mined');

    // A new node needs one seed that still runs: with A alone it stays alone, with A and C it joins.
    start('D', { seeds: ['A'] });
    assert.ok(!(await until(async () => (await peers('D')) >= 1, 20_000, 2000)), 'with only the dead seed there is nobody to find');
    await stop('D');
    rmSync(join(base, 'D'), { recursive: true, force: true });
    start('D', { seeds: ['A', 'C'] });
    assert.ok(await until(async () => (await peers('D')) >= 1 && (await height('D')) >= (await height('B')) - 1, 180_000, 2000), 'with a second independent seed the new node joins and syncs');
  } finally {
    for (const p of Object.values(procs)) p.kill('SIGKILL');
    await sleep(500);
    rmSync(base, { recursive: true, force: true });
  }
});

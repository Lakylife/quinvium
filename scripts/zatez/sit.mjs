// Network: how fast a block passes through a chain of nodes, how fast a new node catches up and what verifying work costs.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call, root } from './spolecne.mjs';

const NODES = 5;
const ADDRESS = '0x2546BcD3c84621e976D8185a91A922aE77ECEc30';
const cli = join(root, 'packages/node/src/cli.js');
const procs = [];
const sizeOf = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => sum + (e.isDirectory() ? sizeOf(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);

function start(i, seed, extra = []) {
  const dataDir = mkdtempSync(join(tmpdir(), 'aether-sit-'));
  const args = ['--no-warnings', cli, '--network', 'dev', '--data-dir', dataDir, '--rpc-port', String(8910 + i), '--p2p-port', String(30910 + i), '--stratum-port', String(3910 + i), '--rate-limit', '0', '--allow-private'];
  if (seed !== undefined) args.push('--seeds', `127.0.0.1:${30910 + seed}`);
  const proc = spawn(process.execPath, [...args, ...extra], { stdio: 'ignore' });
  procs.push(proc);
  return { url: `http://127.0.0.1:${8910 + i}`, dataDir, proc };
}
const height = (n) => call(n.url, 'eth_blockNumber').then(BigInt);
const waitUp = async (n) => { for (let i = 0; i < 600; i++) { if (await height(n).catch(() => null) !== null) return; await new Promise((r) => { setTimeout(r, 100); }); } throw new Error('uzel se nerozběhl'); };

try {
  const nodes = [start(0, undefined, ['--dev-mine', '--miner-address', ADDRESS])];
  await waitUp(nodes[0]);
  for (let i = 1; i < NODES; i++) {
    nodes.push(start(i, i - 1));
    await waitUp(nodes[i]);
  }
  while (await height(nodes[0]) < 3n) await new Promise((r) => { setTimeout(r, 100); });
  for (;;) {
    const peers = await Promise.all(nodes.map((n) => call(n.url, 'aether_stats').then((s) => s.peers)));
    if (peers.every((p) => p >= 1)) break;
    await new Promise((r) => { setTimeout(r, 200); });
  }
  console.log(`Řetěz ${NODES} uzlů spojený, měřím šíření…`);
  const hops = Array.from({ length: NODES }, () => []);
  let last = await height(nodes[0]);
  for (let sample = 0; sample < 12;) {
    const now = await height(nodes[0]);
    if (now === last) { await new Promise((r) => { setTimeout(r, 5); }); continue; }
    last = now;
    const t = performance.now();
    await Promise.all(nodes.slice(1).map(async (n, i) => {
      while (await height(n) < now && performance.now() - t < 5000) await new Promise((r) => { setTimeout(r, 2); });
      hops[i + 1].push(performance.now() - t);
    }));
    sample += 1;
  }
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  hops.slice(1).forEach((list, i) => console.log(`Uzel ${i + 2} vidí blok po ${median(list).toFixed(0)} ms (nejhůř ${Math.max(...list).toFixed(0)} ms)`));

  const target = await height(nodes[0]);
  while (await height(nodes[0]) < target + 150n) await new Promise((r) => { setTimeout(r, 200); });
  const tip = await height(nodes[0]);
  const fresh = start(NODES, 0);
  await waitUp(fresh);
  const t = performance.now();
  while (await height(fresh) < tip) await new Promise((r) => { setTimeout(r, 20); });
  const seconds = (performance.now() - t) / 1000;
  console.log(`Nový uzel stáhl ${tip} bloků za ${seconds.toFixed(1)} s, tedy ${Math.round(Number(tip) / seconds)} bloků/s, data ${(sizeOf(fresh.dataDir) / 1024 / 1024).toFixed(1)} MB`);
} finally {
  for (const p of procs) p.kill('SIGTERM');
}

const { Pow } = await import('../../packages/node/src/core/pow.js');
const { POW_DIR } = await import('../../packages/node/test/helpers/chain.js');
const pow = new Pow(POW_DIR);
const seal = new Uint8Array(32).fill(1);
const started = performance.now();
const ROUNDS = 40;
for (let i = 0; i < ROUNDS; i++) {
  const nonce = new Uint8Array(8);
  nonce[7] = i;
  await pow.compute(seal, nonce, 1n);
}
console.log(`Ověření práce (Ethash, lehký režim): ${((performance.now() - started) / ROUNDS).toFixed(1)} ms`);
process.exit(0);

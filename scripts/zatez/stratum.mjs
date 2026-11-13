// Tisíce těžařů na jednom uzlu přes Stratum: připojení, rozeslání nové práce a ověřování podílů.
import net from 'node:net';
import { execSync } from 'node:child_process';
import { call, root, startNode } from './spolecne.mjs';

const ADDRESS = '0x2546BcD3c84621e976D8185a91A922aE77ECEc30';
const TARGETS = (process.argv[2] ?? '1000,5000,10000').split(',').map(Number);
const node = await startNode({ rpc: '8902', p2p: '30902', stratum: '3902', extra: ['--dev-mine', '--miner-address', ADDRESS, '--stratum-sessions', '100000', '--stratum-sessions-per-ip', '100000'] });
const rss = () => Math.round(Number(execSync(`ps -o rss= -p ${node.proc.pid}`).toString().trim()) / 1024);
const sockets = [];

function connect(id, onJob) {
  return new Promise((resolve) => {
    const socket = net.connect(3902, '127.0.0.1');
    let text = '';
    let done = false;
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method: 'mining.subscribe', params: ['zatez/1.0', 'EthereumStratum/1.0.0'] })}\n${JSON.stringify({ id: 2, method: 'mining.authorize', params: [`${ADDRESS}.w${id}`, 'x'] })}\n`));
    socket.on('data', (d) => {
      text += d;
      for (;;) {
        const i = text.indexOf('\n');
        if (i < 0) break;
        const line = text.slice(0, i);
        text = text.slice(i + 1);
        if (/mining\.notify/.test(line)) { onJob(); if (!done) { done = true; resolve(socket); } }
        if (!done && /"id":2/.test(line)) { done = true; resolve(socket); }
      }
    });
    socket.on('error', () => { if (!done) { done = true; resolve(null); } });
    socket.on('close', () => { if (!done) { done = true; resolve(null); } });
    setTimeout(() => { if (!done) { done = true; resolve(null); } }, 20000);
  });
}

try {
  let jobsSeen = 0;
  let firstJob = 0;
  let lastJob = 0;
  const onJob = () => { const t = performance.now(); if (!firstJob || t - lastJob > 1000) firstJob = t; lastJob = t; jobsSeen += 1; };
  let opened = 0;
  for (const target of TARGETS) {
    const start = performance.now();
    while (sockets.length < target) {
      const batch = Math.min(256, target - sockets.length);
      const made = await Promise.all(Array.from({ length: batch }, (_, i) => connect(opened + i, onJob)));
      opened += batch;
      const alive = made.filter(Boolean);
      sockets.push(...alive);
      if (alive.length < batch / 2) break;
    }
    const seconds = (performance.now() - start) / 1000;
    const before = jobsSeen;
    const startHeight = BigInt(await call(node.url, 'eth_blockNumber'));
    while (BigInt(await call(node.url, 'eth_blockNumber')) < startHeight + 2n) await new Promise((r) => { setTimeout(r, 100); });
    await new Promise((r) => { setTimeout(r, 1500); });
    const t = performance.now();
    await call(node.url, 'aether_stats');
    console.log(`${sockets.length} spojení (cíl ${target}): navázání ${seconds.toFixed(1)} s, rozeslání práce všem ${(lastJob - firstJob).toFixed(0)} ms, zpráv ${jobsSeen - before}, odezva RPC při zátěži ${(performance.now() - t).toFixed(1)} ms, paměť ${rss()} MB`);
    if (sockets.length < target) { console.log(`Limit uzlu: přijato ${sockets.length} z ${target} spojení`); break; }
  }
} finally {
  for (const s of sockets) s.destroy();
  node.proc.kill('SIGTERM');
}
process.exit(0);

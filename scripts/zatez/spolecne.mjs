// Společné pro zátěžové testy: spuštění uzlu a měření. Testy běží na oddělených portech a dočasných datech.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startNode({ rpc, p2p, stratum, extra = [] }) {
  const dataDir = mkdtempSync(join(tmpdir(), 'aether-zatez-'));
  const proc = spawn(process.execPath, ['--no-warnings', join(root, 'packages/node/src/cli.js'), '--network', 'dev', '--data-dir', dataDir, '--rpc-port', rpc, '--p2p-port', p2p, '--stratum-port', stratum, '--rate-limit', '100000000', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  proc.stdout.on('data', (d) => lines.push(d.toString()));
  proc.stderr.on('data', (d) => lines.push(d.toString()));
  const url = `http://127.0.0.1:${rpc}`;
  for (let i = 0; i < 600; i++) {
    const r = await call(url, 'eth_blockNumber').catch(() => null);
    if (r !== null) return { proc, url, dataDir, lines };
    await new Promise((f) => { setTimeout(f, 100); });
  }
  throw new Error(`uzel se nerozběhl: ${lines.join('').slice(-400)}`);
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 2048 });

export function call(url, method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = http.request(url, { method: 'POST', agent, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        try {
          const j = JSON.parse(text);
          if (j.error) reject(new Error(j.error.message)); else resolve(j.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

/** Pustí `concurrency` paralelních klientů na `ms` milisekund a vrátí propustnost a zpoždění. */
export async function measure(fn, concurrency, ms) {
  const times = [];
  let errors = 0;
  const end = Date.now() + ms;
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (Date.now() < end) {
      const t = performance.now();
      try { await fn(); times.push(performance.now() - t); } catch { errors += 1; }
    }
  }));
  times.sort((a, b) => a - b);
  const seconds = (Date.now() - started) / 1000;
  return { rps: Math.round(times.length / seconds), p50: percentile(times, 0.5), p95: percentile(times, 0.95), p99: percentile(times, 0.99), errors };
}

export const row = (name, r) => console.log(`${name.padEnd(38)} ${String(r.rps).padStart(7)} /s   p50 ${r.p50.toFixed(1).padStart(7)} ms   p95 ${r.p95.toFixed(1).padStart(7)} ms   p99 ${r.p99.toFixed(1).padStart(7)} ms   chyby ${r.errors}`);

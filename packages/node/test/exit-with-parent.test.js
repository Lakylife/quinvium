// The app keeps a pipe open to the node's standard input. When the app disappears, the node must stop by itself
// instead of running on and holding the ports, which would stop the next app start from launching its node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

test('a node started with --exit-with-parent stops when its standard input closes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'exit-with-parent-'));
  const p = spawn(process.execPath, ['--no-warnings', CLI, '--network', 'dev', '--data-dir', dir, '--p2p-port', '0', '--rpc-port', '0', '--stratum-port', '0', '--no-site-check', '--exit-with-parent'],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AETHER_NO_SEEDS: '1' } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`the node did not start: ${out}`)), 30_000);
      const check = () => { if (/RPC/.test(out)) { clearTimeout(t); resolve(); } };
      p.stdout.on('data', check);
      p.on('exit', () => { clearTimeout(t); reject(new Error(`the node ended early: ${out}`)); });
    });
    const exited = new Promise((resolve) => p.on('exit', (code) => resolve(code)));
    p.stdin.end();
    const code = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('timeout'), 15_000))]);
    assert.equal(code, 0, out);
    assert.match(out, /Stopping the node/);
  } finally {
    p.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

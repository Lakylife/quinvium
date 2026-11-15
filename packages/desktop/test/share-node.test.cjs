// Share node publicly: cloudflared only from the pinned official build, and the tunnel address read from its output.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { BUILDS, VERSION, TUNNEL_PORTS, ensureCloudflared, startTunnel } = require('../src/share-node.cjs');

test('every pinned build comes from the official release and has a SHA-256', () => {
  for (const [platform, b] of Object.entries(BUILDS)) {
    assert.match(b.sha256, /^[0-9a-f]{64}$/, platform);
    assert.match(b.file, /^cloudflared-/, platform);
  }
  assert.match(VERSION, /^\d{4}\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(TUNNEL_PORTS).sort(), ['dev', 'mainnet', 'testnet']);
});

test('a download that does not match the published checksum is deleted and never run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudflared-'));
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, arrayBuffer: async () => new TextEncoder().encode('not cloudflared').buffer }; };
  await assert.rejects(ensureCloudflared(dir, { platform: 'win32', arch: 'x64', fetchImpl }), /does not match/);
  assert.deepEqual(urls, [`https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-windows-amd64.exe`]);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing stays on disk');
  await assert.rejects(ensureCloudflared(dir, { platform: 'sunos', arch: 'x64', fetchImpl }), /not available/);
});

test('the tunnel address is taken from cloudflared output, only a trycloudflare.com https address', () => {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill() { this.killed = true; } });
  let args;
  const urls = [];
  const t = startTunnel('/bin/cloudflared', 8565, { spawnImpl: (bin, a) => { args = a; return proc; }, onUrl: (u) => urls.push(u) });
  assert.deepEqual(args, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8565']);
  proc.stderr.emit('data', 'INF Requesting new quick Tunnel on trycloudflare.com...\n');
  proc.stderr.emit('data', 'INF |  https://quiet-river-sun-1234.trycloudflare.com  |\n');
  proc.stderr.emit('data', 'INF see https://evil.example.com and https://quiet-river-sun-1234.trycloudflare.com again\n');
  assert.deepEqual(urls, ['https://quiet-river-sun-1234.trycloudflare.com']);
  assert.equal(t.url, 'https://quiet-river-sun-1234.trycloudflare.com');
  t.stop();
  assert.ok(proc.killed);
});

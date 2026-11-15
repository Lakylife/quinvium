// "Share node publicly": the node's public RPC reaches the internet through a Cloudflare quick tunnel (trycloudflare.com).
// No account, no open port on the router, and the operator's IP address stays hidden behind Cloudflare. The node then
// announces the tunnel's https address to its peers, signed by its node key (packages/node/src/watch/public-nodes.js),
// and other nodes list it after checking it themselves. Off by default; it uses the computer's upload bandwidth.
// cloudflared comes only from Cloudflare's official GitHub release, pinned by version and SHA-256 below.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const VERSION = '2026.10.7';
const BASE = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}`;
/** Official builds of cloudflared by platform: file and SHA-256 published with the release. */
const BUILDS = {
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha256: '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848' },
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha256: '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd' },
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343' },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872' },
};
/** Local ports the node opens for the tunnel only (--tunnel-port): everything on them counts as foreign. */
const TUNNEL_PORTS = { mainnet: 8565, testnet: 8566, dev: 8567 };
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const binaryName = (platform) => (platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

/**
 * The cloudflared program in `dir`, downloaded and checked on first use. Returns its path.
 * A download whose SHA-256 differs from the pinned one is deleted and nothing is run.
 */
async function ensureCloudflared(dir, { platform = process.platform, arch = process.arch, fetchImpl = fetch } = {}) {
  const build = BUILDS[`${platform}-${arch}`];
  if (!build) throw new Error(`cloudflared is not available for ${platform}-${arch}`);
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, binaryName(platform));
  const stamp = path.join(dir, 'cloudflared.version');
  if (fs.existsSync(bin) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === `${VERSION} ${build.sha256}`) return bin;
  const r = await fetchImpl(`${BASE}/${build.file}`, { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} downloading cloudflared`);
  const download = path.join(dir, `${build.file}.part`);
  fs.writeFileSync(download, Buffer.from(await r.arrayBuffer()));
  if (sha256(download) !== build.sha256) {
    fs.rmSync(download, { force: true });
    throw new Error('The downloaded cloudflared does not match the published checksum. It was deleted.');
  }
  if (build.file.endsWith('.tgz')) {
    execFileSync('tar', ['-xzf', download, '-C', dir, 'cloudflared']);
    fs.rmSync(download, { force: true });
  } else {
    fs.renameSync(download, bin);
  }
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(stamp, `${VERSION} ${build.sha256}`);
  return bin;
}

/**
 * Starts a quick tunnel to the node's tunnel port. `onUrl` gets the https address once Cloudflare assigns it.
 * Returns { stop }. Nothing is listened on publicly: cloudflared dials out to Cloudflare.
 */
function startTunnel(bin, port, { onUrl = () => {}, onExit = () => {}, onLog = () => {}, spawnImpl = spawn } = {}) {
  const proc = spawnImpl(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let url = null;
  const read = (chunk) => {
    const text = String(chunk);
    onLog(text);
    const m = TUNNEL_URL.exec(text);
    if (m && m[0] !== url) {
      url = m[0];
      onUrl(url);
    }
  };
  proc.stdout?.on('data', read);
  proc.stderr?.on('data', read);
  proc.on('exit', (code) => onExit(code));
  return { stop: () => { try { proc.kill(); } catch { /* already gone */ } }, get url() { return url; }, proc };
}

module.exports = { VERSION, BUILDS, TUNNEL_PORTS, TUNNEL_URL, ensureCloudflared, startTunnel, sha256 };

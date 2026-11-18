// Remote updates and status reports for test operation. Both are off until the settings specify an address.
// An update runs foreign code on the user's computer, so only a package signed with the publisher's key is accepted
// and only newer versions. The server address therefore does not have to be trusted and the private key never leaves the publisher's computer.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isNewer } = require('./versions.cjs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApnfEpCT34oj8xVXT3h/ch0LFaOv3Js/FweG9WNuOXl8=
-----END PUBLIC KEY-----
`;
const MAX_MANIFEST = 16 * 1024;
const MAX_PACKAGE = 1024 * 1024 * 1024;
const REQUEST_MS = 15_000;
const PLATFORMS = ['win32', 'darwin'];

/**
 * Verifies the signature and shape of an update description. The file is named by a plain name only, not a path or address.
 * The platform is part of the signature: otherwise a server could feed a Mac a valid package for Windows.
 * @param {string} [platform] expected platform, `win32` or `darwin`
 */
function verifyManifest(text, signature, key = PUBLIC_KEY, platform) {
  if (!crypto.verify(null, Buffer.from(text), key, Buffer.from(signature.trim(), 'base64'))) throw new Error('The update signature does not match');
  const m = JSON.parse(text);
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) throw new Error('Invalid update version');
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(m.file ?? '')) throw new Error('Invalid package name');
  if (!/^[0-9a-f]{64}$/.test(m.sha256 ?? '')) throw new Error('Invalid package hash');
  if (!Number.isInteger(m.size) || m.size <= 0 || m.size > MAX_PACKAGE) throw new Error('Invalid package size');
  if (!PLATFORMS.includes(m.platform)) throw new Error('The update does not name a platform');
  if (platform && m.platform !== platform) throw new Error(`The update is for another platform (${m.platform})`);
  return m;
}

/** Reads at most MAX_MANIFEST bytes and stops the transfer beyond that, with or without Content-Length. */
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`The server returned ${r.status}`);
    if (Number(r.headers.get('content-length') ?? 0) > MAX_MANIFEST) throw new Error('The update description is too long');
    const chunks = [];
    let received = 0;
    for await (const chunk of r.body ?? []) {
      received += chunk.length;
      if (received > MAX_MANIFEST) { controller.abort(); throw new Error('The update description is too long'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<object|null>} verified description of a newer version, otherwise null */
async function checkForUpdate(baseUrl, currentVersion, name = 'manifest', platform = process.platform) {
  const base = baseUrl.replace(/\/$/, '');
  const [text, signature] = await Promise.all([fetchText(`${base}/${name}.json`), fetchText(`${base}/${name}.sig`)]);
  const manifest = verifyManifest(text, signature, PUBLIC_KEY, platform);
  return isNewer(manifest.version, currentVersion) ? manifest : null;
}

/**
 * Downloads the package and verifies its size and hash. An incomplete or modified file is deleted.
 * The download stops as soon as the server sends more than the signed description promises; otherwise it could fill the disk.
 */
async function downloadPackage(baseUrl, manifest, directory) {
  const target = path.join(directory, manifest.file);
  const r = await fetch(`${baseUrl.replace(/\/$/, '')}/${manifest.file}`, { signal: AbortSignal.timeout(600_000) });
  if (!r.ok || !r.body) throw new Error(`The server returned ${r.status}`);
  let received = 0;
  const limit = new Transform({
    transform(chunk, _, done) {
      received += chunk.length;
      done(received > manifest.size ? new Error('The downloaded package does not match the signature: it is larger') : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(r.body), limit, fs.createWriteStream(target));
  } catch (e) {
    fs.rmSync(target, { force: true });
    throw e;
  }
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(target), hash);
  if (hash.digest('hex') !== manifest.sha256 || fs.statSync(target).size !== manifest.size) {
    fs.rmSync(target, { force: true });
    throw new Error('The downloaded package does not match the signature');
  }
  return target;
}

/** Counters from the miner's line `Hashrate 3.91 MH/s, blocks found 2, stale 1, rejected 0` (older miners wrote the same line in Czech). */
function parseMinerLine(line) {
  const m = /(?:Hashrate|Výkon) ([\d.]+) ([^\s,]+), (?:blocks found|nalezené bloky) (\d+), (?:stale|osiřelé) (\d+), (?:rejected|odmítnuté) (\d+)(?:, (?:shares|podíly) (\d+))?/.exec(line);
  if (!m) return null;
  const scale = { 'H/s': 1, 'kH/s': 1e3, 'MH/s': 1e6, 'GH/s': 1e9 }[m[2]] ?? 1;
  return { rate: Math.round(Number(m[1]) * scale), found: Number(m[3]), stale: Number(m[4]), rejected: Number(m[5]), shares: Number(m[6] ?? 0) };
}

/** Sends a status line to the address from the settings. A server outage must not affect the app in any way. */
async function sendReport(reportUrl, name, data) {
  const url = `${reportUrl.replace(/\/$/, '')}/report?name=${encodeURIComponent(name)}`;
  await fetch(url, { method: 'POST', body: `${JSON.stringify(data)}\n`, signal: AbortSignal.timeout(5000) }).catch(() => {});
}

module.exports = { checkForUpdate, downloadPackage, isNewer, parseMinerLine, sendReport, verifyManifest };

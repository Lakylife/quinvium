// New versions without remote installs. The app asks GitHub for the latest release, shows what is new and on request
// downloads the build for this computer. The file is opened only when its SHA-256 matches the checksum list on GitHub
// and the same list on quinvium.com: two independent places would both have to be forged.
// Nothing is installed by itself; the user runs the installer (the decision of 13 Nov 2026: no remote update key on mainnet).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isNewer } = require('./updater.cjs');

const REPO = 'Lakylife/quinvium';
const GITHUB = `https://api.github.com/repos/${REPO}/releases/latest`;
const SITE = 'https://quinvium.com/downloads';
const TIMEOUT_MS = 15_000;
const MAX_NOTES = 4000;

/** A readable reason: Node's fetch only says "fetch failed" and hides the real network error in `cause`. */
function reason(e) {
  const c = e?.cause;
  const detail = c ? [c.code, c.message].filter(Boolean).join(' ') : '';
  return detail && !String(e.message).includes(detail) ? `${e.message} (${detail})` : String(e?.message ?? e);
}

/** The file name of this computer's build in a release. */
function assetName(version, platform) {
  return platform === 'win32' ? `Quinvium-${version}-Windows-x64.exe` : `Quinvium-${version}-macOS-x64.zip`;
}

/** Checksums from a SHA256SUMS.txt text: file name -> lowercase hex. */
function parseSums(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
}

async function getText(fetchImpl, url, accept = 'text/plain') {
  const r = await fetchImpl(url, { headers: { Accept: accept, 'User-Agent': 'quinvium-app' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

/**
 * The newest release when it is newer than `current`, else null.
 * @returns {Promise<null | {version: string, notes: string, url: string, page: string, name: string, size: number}>}
 */
async function latest(current, platform, fetchImpl = fetch) {
  const release = JSON.parse(await getText(fetchImpl, GITHUB, 'application/vnd.github+json'));
  const version = String(release.tag_name ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewer(version, current) || release.draft || release.prerelease) return null;
  const name = assetName(version, platform);
  const asset = (release.assets ?? []).find((a) => a.name === name);
  const sums = (release.assets ?? []).find((a) => a.name === 'SHA256SUMS.txt');
  // Say so instead of claiming this is the latest version.
  if (!asset || !sums) throw new Error(`Version ${version} is out, but its release has no ${asset ? 'SHA256SUMS.txt' : name}. Download it from ${release.html_url}`);
  return {
    version, name, size: asset.size, url: asset.browser_download_url, sums: sums.browser_download_url,
    page: release.html_url, notes: String(release.body ?? '').slice(0, MAX_NOTES),
  };
}

/** The expected checksum, only when GitHub and quinvium.com agree. */
async function expectedSum(release, fetchImpl = fetch) {
  const [github, site] = await Promise.all([
    getText(fetchImpl, release.sums).then(parseSums),
    getText(fetchImpl, `${SITE}/${release.version}/SHA256SUMS.txt`).then(parseSums),
  ]);
  const a = github[release.name];
  const b = site[release.name];
  if (!a || !b) throw new Error('The checksum of this file is not published in both places.');
  if (a !== b) throw new Error('The checksums on GitHub and quinvium.com differ. The download was not opened.');
  return a;
}

/** Downloads the build into `dir` and checks it. Returns the file path; a file that does not match is deleted. */
async function download(release, dir, fetchImpl = fetch, onProgress = () => {}) {
  const expected = await expectedSum(release, fetchImpl);
  const r = await fetchImpl(release.url, { headers: { 'User-Agent': 'quinvium-app' }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, release.name);
  const partial = `${file}.part`;
  const out = fs.createWriteStream(partial);
  const hash = crypto.createHash('sha256');
  let got = 0;
  try {
    for await (const chunk of r.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
      onProgress(got, release.size);
    }
    await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
  } catch (e) {
    out.destroy();
    fs.rmSync(partial, { force: true });
    throw e;
  }
  if (hash.digest('hex') !== expected) {
    fs.rmSync(partial, { force: true });
    throw new Error('The downloaded file does not match the published checksum. It was deleted.');
  }
  fs.renameSync(partial, file);
  return file;
}

module.exports = { latest, download, expectedSum, parseSums, assetName, reason };

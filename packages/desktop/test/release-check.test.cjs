// New versions: found on GitHub, opened only when the checksum agrees on GitHub and on quinvium.com.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const releases = require('../src/release-check.cjs');

const file = Buffer.from('installer bytes');
const sum = crypto.createHash('sha256').update(file).digest('hex');
const release = (tag, extra = {}) => ({
  tag_name: tag, html_url: `https://github.com/Lakylife/quinvium/releases/tag/${tag}`, body: 'What is new', draft: false, prerelease: false,
  assets: [{ name: `Quinvium-${tag.slice(1)}-macOS-x64.zip`, size: file.length, browser_download_url: 'https://gh/zip' }, { name: 'SHA256SUMS.txt', browser_download_url: 'https://gh/sums' }],
  ...extra,
});
const fake = (routes) => async (url) => {
  const body = routes[url];
  if (body === undefined) return new Response('no', { status: 404 });
  return new Response(typeof body === 'string' ? body : JSON.stringify(body));
};
const GH = 'https://api.github.com/repos/Lakylife/quinvium/releases/latest';

test('checksum lists are read in the usual format', () => {
  assert.deepEqual(releases.parseSums(`${sum}  Quinvium-2.16.0-macOS-x64.zip\n${'a'.repeat(64)} *other.exe\nnoise`), { 'Quinvium-2.16.0-macOS-x64.zip': sum, 'other.exe': 'a'.repeat(64) });
  assert.equal(releases.assetName('2.16.0', 'win32'), 'Quinvium-2.16.0-Windows-x64.exe');
});

test('only a newer, final release with a build for this computer is offered', async () => {
  assert.equal(await releases.latest('2.15.1', 'darwin', fake({ [GH]: release('v2.15.1') })), null, 'same version');
  assert.equal(await releases.latest('2.15.1', 'darwin', fake({ [GH]: release('v2.16.0', { prerelease: true }) })), null, 'pre-release');
  await assert.rejects(releases.latest('2.15.1', 'win32', fake({ [GH]: release('v2.16.0') })), /no Quinvium-2\.16\.0-Windows-x64\.exe/, 'no Windows build in this release is reported, not hidden');
  const e = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { code: 'ENOTFOUND' }) });
  assert.equal(releases.reason(e), 'fetch failed (ENOTFOUND getaddrinfo ENOTFOUND api.github.com)');
  const r = await releases.latest('2.15.1', 'darwin', fake({ [GH]: release('v2.16.0') }));
  assert.equal(r.version, '2.16.0');
  assert.equal(r.notes, 'What is new');
});

test('the download is kept only when GitHub and quinvium.com agree on the checksum', async () => {
  const r = await releases.latest('2.15.1', 'darwin', fake({ [GH]: release('v2.16.0') }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  const line = `${sum}  ${r.name}\n`;
  const ok = fake({ 'https://gh/sums': line, 'https://quinvium.com/downloads/2.16.0/SHA256SUMS.txt': line, 'https://gh/zip': file.toString() });
  const saved = await releases.download(r, dir, ok);
  assert.equal(fs.readFileSync(saved, 'utf8'), file.toString());
  const other = `${'b'.repeat(64)}  ${r.name}\n`;
  await assert.rejects(() => releases.download(r, dir, fake({ 'https://gh/sums': line, 'https://quinvium.com/downloads/2.16.0/SHA256SUMS.txt': other, 'https://gh/zip': file.toString() })), /differ/);
  await assert.rejects(() => releases.download(r, dir, fake({ 'https://gh/sums': other, 'https://quinvium.com/downloads/2.16.0/SHA256SUMS.txt': other, 'https://gh/zip': file.toString() })), /does not match/);
  assert.ok(!fs.existsSync(`${path.join(dir, r.name)}.part`), 'a bad download leaves nothing behind');
});

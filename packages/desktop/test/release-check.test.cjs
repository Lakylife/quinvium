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
  assert.equal(await releases.latest('2.15.1', 'win32', fake({ [GH]: release('v2.16.0') })), null, 'no Windows build in this release');
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

test('the check falls back to a second fetch only when the first cannot connect', async () => {
  const fail = (code) => async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code}`), { code }) }); };
  const ok = fake({ [GH]: release('v9.0.0') });
  const found = await releases.latest('2.16.2', 'darwin', releases.withFallback(fail('UNABLE_TO_GET_ISSUER_CERT_LOCALLY'), ok));
  assert.equal(found.version, '9.0.0');
  let second = 0;
  const http = releases.withFallback(async () => new Response('limit', { status: 403 }), async () => { second += 1; return new Response('{}'); });
  await assert.rejects(releases.latest('2.16.2', 'darwin', http), /HTTP 403/);
  assert.equal(second, 0, 'an HTTP answer is not retried');
});

test('a failed check explains itself instead of a bare "fetch failed"', async () => {
  const cause = (code) => new TypeError('fetch failed', { cause: Object.assign(new Error(`boom ${code}`), { code }) });
  const both = releases.withFallback(async () => { throw new Error('net::ERR_CERT_AUTHORITY_INVALID'); }, async () => { throw cause('SELF_SIGNED_CERT_IN_CHAIN'); });
  const e = await releases.latest('2.16.2', 'win32', both).catch((x) => x);
  assert.match(releases.describe(e), /antivirus or firewall/);
  assert.match(releases.describe(e), /SELF_SIGNED_CERT_IN_CHAIN/);
  assert.doesNotMatch(releases.describe(e), /^fetch failed$/);
  assert.match(releases.describe(cause('ENOTFOUND')), /internet connection.*ENOTFOUND/);
  assert.match(releases.describe(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), /did not answer in time/);
  assert.match(releases.describe(new Error(`HTTP 403 ${GH}`)), /rate limit/);
  assert.equal(releases.describe(new Error('HTTP 404 https://quinvium.com/downloads/x')), 'HTTP 404 https://quinvium.com/downloads/x');
  assert.equal(releases.describe(new Error('The downloaded file does not match the published checksum. It was deleted.')), 'The downloaded file does not match the published checksum. It was deleted.');
});

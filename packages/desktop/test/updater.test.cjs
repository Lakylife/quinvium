// An update runs new code on the user's computer, so it must reject everything the publisher did not sign.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { checkForUpdate, downloadPackage, isNewer, parseMinerLine, verifyManifest } = require('../src/updater.cjs');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const sign = (text, key = privateKey) => crypto.sign(null, Buffer.from(text), key).toString('base64');
const manifest = (over = {}) => JSON.stringify({ version: '2.0.1', file: 'aether-2.0.1.zip', sha256: 'ab'.repeat(32), size: 100, platform: 'win32', ...over });

test('versions are compared numerically', () => {
  assert.equal(isNewer('2.0.10', '2.0.9'), true);
  assert.equal(isNewer('2.1.0', '2.0.9'), true);
  assert.equal(isNewer('2.0.9', '2.0.10'), false);
  assert.equal(isNewer('2.0.0', '2.0.0'), false);
});

test('a valid signature passes', () => {
  assert.equal(verifyManifest(manifest(), sign(manifest()), pub).version, '2.0.1');
});

test('a changed description or a foreign key is rejected', () => {
  const signature = sign(manifest());
  assert.throws(() => verifyManifest(manifest({ version: '9.9.9' }), signature, pub), /signature/);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.throws(() => verifyManifest(manifest(), sign(manifest(), other), pub), /signature/);
  assert.throws(() => verifyManifest(manifest(), 'smetí', pub), /signature/);
});

test("the built-in key does not accept another publisher's signature", () => {
  assert.throws(() => verifyManifest(manifest(), sign(manifest())), /signature/);
});

test('not even a signed description may point outside the updates folder', () => {
  for (const file of ['../../zlo.zip', 'http://zlo.cz/a.zip', 'C:\\a.zip', 'aplikace.exe']) {
    const text = manifest({ file });
    assert.throws(() => verifyManifest(text, sign(text), pub), /name/);
  }
  for (const size of [0, -1, 1.5, 2 ** 40]) {
    const text = manifest({ size });
    assert.throws(() => verifyManifest(text, sign(text), pub), /size/);
  }
});

test('the platform is in the signature: a Windows package cannot reach a Mac', () => {
  const text = manifest();
  assert.equal(verifyManifest(text, sign(text), pub, 'win32').platform, 'win32');
  assert.throws(() => verifyManifest(text, sign(text), pub, 'darwin'), /another platform/);
  const without = manifest({ platform: undefined });
  assert.throws(() => verifyManifest(without, sign(without), pub), /platform/);
  const unknown = manifest({ platform: 'linux' });
  assert.throws(() => verifyManifest(unknown, sign(unknown), pub), /platform/);
});

test("the miner's line is converted to numbers", () => {
  assert.deepEqual(parseMinerLine('Hashrate 3.91 MH/s, blocks found 2, stale 1, rejected 0'), { rate: 3910000, found: 2, stale: 1, rejected: 0, shares: 0 });
  assert.deepEqual(parseMinerLine('Hashrate 424.00 kH/s, blocks found 0, stale 0, rejected 0').rate, 424000);
  assert.equal(parseMinerLine('[card] BLOCK FOUND #5'), null);
  assert.equal(parseMinerLine('Výkon 2.00 MH/s, nalezené bloky 1, osiřelé 0, odmítnuté 0').found, 1, 'older miners wrote the line in Czech');
  assert.equal(parseMinerLine('Hashrate 3.91 MH/s, blocks found 2, stale 1, rejected 0, shares 75').shares, 75, 'v poolu přibývají podíly');
});

test('a downloaded package must match its hash, otherwise it is deleted', async () => {
  const body = Buffer.from('obsah aktualizace');
  const server = http.createServer((req, res) => res.end(body)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-akt-'));
  try {
    const good = { file: 'a.zip', size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
    assert.equal(fs.readFileSync(await downloadPackage(base, good, dir)).toString(), 'obsah aktualizace');
    await assert.rejects(downloadPackage(base, { ...good, sha256: 'cd'.repeat(32) }, dir), /does not match/);
    assert.equal(fs.existsSync(path.join(dir, 'a.zip')), false, 'nepodařený soubor nezůstane');
    await assert.rejects(downloadPackage(base, { ...good, size: 5 }, dir), /does not match/);
    assert.equal(fs.existsSync(path.join(dir, 'a.zip')), false, 'větší soubor se přeruší a smaže');
  } finally {
    server.close();
  }
});

test('an unavailable server is not an app error; it is only reported', async () => {
  await assert.rejects(checkForUpdate('http://127.0.0.1:9', '2.0.0'));
});

test('an oversized update description is cut off while it arrives, with or without Content-Length', async () => {
  let sentBytes = 0;
  const server = http.createServer((req, res) => {
    // Without Content-Length: the body is streamed in pieces and never ends by itself.
    res.writeHead(200, req.url.endsWith('.json') && req.url.includes('declared') ? { 'content-length': String(10 * 1024 * 1024) } : {});
    const piece = Buffer.alloc(64 * 1024, 0x61);
    const pump = () => { if (res.destroyed || sentBytes > 50 * 1024 * 1024) { res.end(); return; } sentBytes += piece.length; res.write(piece, pump); };
    pump();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(checkForUpdate(base, '2.0.0', 'streamed'), /too long/);
    assert.ok(sentBytes < 5 * 1024 * 1024, `stopped early (${sentBytes} bytes sent)`);
    await assert.rejects(checkForUpdate(base, '2.0.0', 'declared'), /too long/);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});

// ---- versions in their own folders --------------------------------------------------------------------
const { execFileSync } = require('node:child_process');
const versions = require('../src/versions.cjs');

function makePackage(files) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-balik-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    fs.writeFileSync(path.join(folder, name), text);
  }
  execFileSync('zip', ['-qr', 'balik.zip', ...Object.keys(files)], { cwd: folder });
  return path.join(folder, 'balik.zip');
}
const GOOD = { 'resources/app.asar': 'aplikace'.repeat(1000), 'resources/bin/quintium-miner': 'miner', 'resources/explorer/index.html': '<html>' };
const emptyDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aether-verze-'));

test('the ZIP package unpacks unchanged and the miner can be started', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  assert.equal(fs.readFileSync(path.join(dir, '2.3.0', 'app.asar'), 'utf8'), GOOD['resources/app.asar']);
  assert.equal(fs.readFileSync(path.join(dir, '2.3.0', 'explorer', 'index.html'), 'utf8'), '<html>');
  assert.ok(fs.statSync(path.join(dir, '2.3.0', 'bin', 'quintium-miner')).mode & 0o100);
});

test('a path outside the version folder or a package without the app is rejected and nothing is chosen', () => {
  const dir = emptyDir();
  assert.throws(() => versions.installVersion(makePackage({ 'jinde/app.asar': 'x' }), dir, '2.3.0'), /Invalid path/);
  // On Windows the backslash is a separator: this entry would be written two folders above the version folder.
  assert.throws(() => versions.installVersion(makePackage({ ...GOOD, 'resources/a\\..\\..\\zlo.txt': 'x' }), dir, '2.3.0'), /Invalid path/);
  assert.throws(() => versions.installVersion(makePackage({ 'resources/bin/x': 'x' }), dir, '2.3.0'), /lacks the app/);
  assert.equal(versions.pickVersion(dir, '2.2.0'), null);
  assert.equal(fs.existsSync(path.join(dir, '2.3.0')), false, 'rozdělaná složka se nepoužije');
});

test('an installed newer version takes precedence over an old update', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.3.0'), null);
  assert.equal(versions.pickVersion(dir, '2.4.0'), null);
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
});

test('a version that fails to start twice is abandoned and not downloaded again', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.2.0'), null, 'třetí start jde na nainstalovanou verzi');
  assert.equal(versions.isBad(dir, '2.3.0'), true);
  assert.equal(versions.pickVersion(dir, '2.2.0'), null);
});

test('a confirmed version holds and a crash of the next one returns the previous', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  versions.pickVersion(dir, '2.2.0');
  versions.confirmVersion(dir, '2.3.0');
  for (let i = 0; i < 5; i++) {
    assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
    versions.confirmVersion(dir, '2.3.0');
  }
  versions.installVersion(makePackage(GOOD), dir, '2.3.1');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.1');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.1');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0', 'návrat na poslední funkční');
  assert.equal(versions.isBad(dir, '2.3.1'), true);
});

test('a version that cannot be loaded is rejected immediately', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  versions.pickVersion(dir, '2.2.0');
  versions.confirmVersion(dir, '2.3.0');
  versions.installVersion(makePackage(GOOD), dir, '2.3.1');
  versions.rejectVersion(dir, '2.3.1');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
  assert.equal(versions.isBad(dir, '2.3.1'), true);
});

test('after confirmation only the two latest versions remain', () => {
  const dir = emptyDir();
  for (const v of ['2.3.0', '2.3.1', '2.3.2']) {
    versions.installVersion(makePackage(GOOD), dir, v);
    versions.pickVersion(dir, '2.2.0');
    versions.confirmVersion(dir, v);
  }
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== 'current.json').sort(), ['2.3.1', '2.3.2']);
});

// ---- home network --------------------------------------------------------------------------------------
const { followHost } = require('../src/home-network.cjs');
const POOL = 'http://192.168.1.235:8546';
const peers = [{ address: '192.168.1.139:30525' }, { address: '203.0.113.9:30525' }];

test('a working address does not change', async () => {
  assert.equal(await followHost(POOL, peers, async () => true), POOL);
});

test("after the iMac's address changes, the service is found through the connected node", async () => {
  const alive = async (url) => url === 'http://192.168.1.139:8546';
  assert.equal(await followHost(POOL, peers, alive), 'http://192.168.1.139:8546');
  assert.equal(await followHost('http://192.168.1.235:8090/aktualizace', peers, async (u) => u.includes('.139')), 'http://192.168.1.139:8090/aktualizace');
});

test('public addresses and nodes outside the private network are not tried', async () => {
  const asked = [];
  const alive = async (url) => { asked.push(url); return false; };
  assert.equal(await followHost(POOL, [{ address: '203.0.113.9:30525' }], alive), POOL);
  assert.deepEqual(asked, [POOL], 'veřejný uzel se nezkouší');
  assert.equal(await followHost('https://pool.example.org', peers, alive), 'https://pool.example.org');
});

test('when nobody answers, the original address stays', async () => {
  assert.equal(await followHost(POOL, peers, async () => false), POOL);
});

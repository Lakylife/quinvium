// Aktualizace spouští nový kód na počítači uživatele, proto musí odmítnout vše, co nepodepsal vydavatel.
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

test('verze se porovnávají číselně', () => {
  assert.equal(isNewer('2.0.10', '2.0.9'), true);
  assert.equal(isNewer('2.1.0', '2.0.9'), true);
  assert.equal(isNewer('2.0.9', '2.0.10'), false);
  assert.equal(isNewer('2.0.0', '2.0.0'), false);
});

test('platný podpis projde', () => {
  assert.equal(verifyManifest(manifest(), sign(manifest()), pub).version, '2.0.1');
});

test('změněný popis nebo cizí klíč se odmítne', () => {
  const signature = sign(manifest());
  assert.throws(() => verifyManifest(manifest({ version: '9.9.9' }), signature, pub), /Podpis/);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.throws(() => verifyManifest(manifest(), sign(manifest(), other), pub), /Podpis/);
  assert.throws(() => verifyManifest(manifest(), 'smetí', pub), /Podpis/);
});

test('zabudovaný klíč nepřijme podpis jiného vydavatele', () => {
  assert.throws(() => verifyManifest(manifest(), sign(manifest())), /Podpis/);
});

test('ani podepsaný popis nesmí ukázat mimo složku aktualizací', () => {
  for (const file of ['../../zlo.zip', 'http://zlo.cz/a.zip', 'C:\\a.zip', 'aplikace.exe']) {
    const text = manifest({ file });
    assert.throws(() => verifyManifest(text, sign(text), pub), /název/);
  }
  for (const size of [0, -1, 1.5, 2 ** 40]) {
    const text = manifest({ size });
    assert.throws(() => verifyManifest(text, sign(text), pub), /velikost/);
  }
});

test('platforma je v podpisu: balíček pro Windows se na Mac nedostane', () => {
  const text = manifest();
  assert.equal(verifyManifest(text, sign(text), pub, 'win32').platform, 'win32');
  assert.throws(() => verifyManifest(text, sign(text), pub, 'darwin'), /jinou platformu/);
  const without = manifest({ platform: undefined });
  assert.throws(() => verifyManifest(without, sign(without), pub), /platformu/);
  const unknown = manifest({ platform: 'linux' });
  assert.throws(() => verifyManifest(unknown, sign(unknown), pub), /platformu/);
});

test('řádek těžaře se převede na čísla', () => {
  assert.deepEqual(parseMinerLine('Výkon 3.91 MH/s, nalezené bloky 2, osiřelé 1, odmítnuté 0'), { rate: 3910000, found: 2, stale: 1, rejected: 0, shares: 0 });
  assert.deepEqual(parseMinerLine('Výkon 424.00 kH/s, nalezené bloky 0, osiřelé 0, odmítnuté 0').rate, 424000);
  assert.equal(parseMinerLine('[karta] NALEZEN BLOK #5'), null);
  assert.equal(parseMinerLine('Výkon 3.91 MH/s, nalezené bloky 2, osiřelé 1, odmítnuté 0, podíly 75').shares, 75, 'v poolu přibývají podíly');
});

test('stažený balíček musí sedět s otiskem, jinak se smaže', async () => {
  const body = Buffer.from('obsah aktualizace');
  const server = http.createServer((req, res) => res.end(body)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-akt-'));
  try {
    const good = { file: 'a.zip', size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') };
    assert.equal(fs.readFileSync(await downloadPackage(base, good, dir)).toString(), 'obsah aktualizace');
    await assert.rejects(downloadPackage(base, { ...good, sha256: 'cd'.repeat(32) }, dir), /nesouhlasí/);
    assert.equal(fs.existsSync(path.join(dir, 'a.zip')), false, 'nepodařený soubor nezůstane');
    await assert.rejects(downloadPackage(base, { ...good, size: 5 }, dir), /nesouhlasí/);
    assert.equal(fs.existsSync(path.join(dir, 'a.zip')), false, 'větší soubor se přeruší a smaže');
  } finally {
    server.close();
  }
});

test('nedostupný server není chyba aplikace, jen se ohlásí', async () => {
  await assert.rejects(checkForUpdate('http://127.0.0.1:9', '2.0.0'));
});

// ---- verze ve vlastních složkách --------------------------------------------------------------------
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

test('balíček ZIP se rozbalí beze změny a miner jde spustit', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  assert.equal(fs.readFileSync(path.join(dir, '2.3.0', 'app.asar'), 'utf8'), GOOD['resources/app.asar']);
  assert.equal(fs.readFileSync(path.join(dir, '2.3.0', 'explorer', 'index.html'), 'utf8'), '<html>');
  assert.ok(fs.statSync(path.join(dir, '2.3.0', 'bin', 'quintium-miner')).mode & 0o100);
});

test('cesta mimo složku verze nebo balíček bez aplikace se odmítne a nic se nevybere', () => {
  const dir = emptyDir();
  assert.throws(() => versions.installVersion(makePackage({ 'jinde/app.asar': 'x' }), dir, '2.3.0'), /Neplatná cesta/);
  // Na Windows je zpětné lomítko oddělovač: tahle položka by se zapsala dvě složky nad složku verze.
  assert.throws(() => versions.installVersion(makePackage({ ...GOOD, 'resources/a\\..\\..\\zlo.txt': 'x' }), dir, '2.3.0'), /Neplatná cesta/);
  assert.throws(() => versions.installVersion(makePackage({ 'resources/bin/x': 'x' }), dir, '2.3.0'), /chybí aplikace/);
  assert.equal(versions.pickVersion(dir, '2.2.0'), null);
  assert.equal(fs.existsSync(path.join(dir, '2.3.0')), false, 'rozdělaná složka se nepoužije');
});

test('nainstalovaná novější verze má přednost před starou aktualizací', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.3.0'), null);
  assert.equal(versions.pickVersion(dir, '2.4.0'), null);
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
});

test('verze, která se dvakrát nerozběhne, se opustí a znovu se nestáhne', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
  assert.equal(versions.pickVersion(dir, '2.2.0'), null, 'třetí start jde na nainstalovanou verzi');
  assert.equal(versions.isBad(dir, '2.3.0'), true);
  assert.equal(versions.pickVersion(dir, '2.2.0'), null);
});

test('potvrzená verze vydrží a pád další vrátí tu předchozí', () => {
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

test('verze, kterou nejde načíst, se odmítne hned', () => {
  const dir = emptyDir();
  versions.installVersion(makePackage(GOOD), dir, '2.3.0');
  versions.pickVersion(dir, '2.2.0');
  versions.confirmVersion(dir, '2.3.0');
  versions.installVersion(makePackage(GOOD), dir, '2.3.1');
  versions.rejectVersion(dir, '2.3.1');
  assert.equal(versions.pickVersion(dir, '2.2.0').version, '2.3.0');
  assert.equal(versions.isBad(dir, '2.3.1'), true);
});

test('po potvrzení zůstanou jen dvě poslední verze', () => {
  const dir = emptyDir();
  for (const v of ['2.3.0', '2.3.1', '2.3.2']) {
    versions.installVersion(makePackage(GOOD), dir, v);
    versions.pickVersion(dir, '2.2.0');
    versions.confirmVersion(dir, v);
  }
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== 'current.json').sort(), ['2.3.1', '2.3.2']);
});

// ---- domácí síť --------------------------------------------------------------------------------------
const { followHost } = require('../src/home-network.cjs');
const POOL = 'http://192.168.1.235:8546';
const peers = [{ address: '192.168.1.139:30525' }, { address: '203.0.113.9:30525' }];

test('funkční adresa se nemění', async () => {
  assert.equal(await followHost(POOL, peers, async () => true), POOL);
});

test('po změně adresy iMacu se služba najde podle spojeného uzlu', async () => {
  const alive = async (url) => url === 'http://192.168.1.139:8546';
  assert.equal(await followHost(POOL, peers, alive), 'http://192.168.1.139:8546');
  assert.equal(await followHost('http://192.168.1.235:8090/aktualizace', peers, async (u) => u.includes('.139')), 'http://192.168.1.139:8090/aktualizace');
});

test('veřejné adresy a uzly mimo soukromou síť se nezkouší', async () => {
  const asked = [];
  const alive = async (url) => { asked.push(url); return false; };
  assert.equal(await followHost(POOL, [{ address: '203.0.113.9:30525' }], alive), POOL);
  assert.deepEqual(asked, [POOL], 'veřejný uzel se nezkouší');
  assert.equal(await followHost('https://pool.example.org', peers, alive), 'https://pool.example.org');
});

test('když nikdo neodpoví, zůstane původní adresa', async () => {
  assert.equal(await followHost(POOL, peers, async () => false), POOL);
});

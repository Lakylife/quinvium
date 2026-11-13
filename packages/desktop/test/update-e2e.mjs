// Skutečná aktualizace sestavené aplikace: stará verze si stáhne novou, sama se restartuje, a když je nová vadná, vrátí se.
// Vyžaduje macOS a klíč ~/.aether/aktualizace-klic.pem, klíč zůstává v paměti testu. Uzel má vlastní porty, otevřená aplikace Quinvium nevadí.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const OLD = '2.2.9';
const NEW = '2.3.9';
const BROKEN = '2.3.10';
const work = mkdtempSync(join(tmpdir(), 'aether-aktualizace-'));
const site = join(work, 'site');
const userData = join(work, 'data');
mkdirSync(site);
mkdirSync(userData);
const key = readFileSync(join(homedir(), '.aether', 'aktualizace-klic.pem'));
const states = [];
let downloads = 0;

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { try { states.push(JSON.parse(body)); } catch { /* jiný řádek */ } res.writeHead(204); res.end(); });
    return;
  }
  const name = req.url.split('/').pop();
  try {
    const data = readFileSync(join(site, name));
    if (name.endsWith('.zip')) downloads += 1;
    res.writeHead(200);
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const base = `http://127.0.0.1:${server.address().port}`;

function build(version, output) {
  execFileSync('npx', ['electron-builder', '--mac', 'dir', '--x64', '--publish', 'never', '-c.electronDist=../../node_modules/electron/dist', `-c.extraMetadata.version=${version}`, `-c.directories.output=${output}`], { cwd: desktop, stdio: 'pipe' });
  return join(output, 'mac', 'Quinvium.app');
}

function publish(version, resources) {
  const pack = join(work, `pack-${version}`, 'resources');
  mkdirSync(pack, { recursive: true });
  cpSync(resources, pack, { recursive: true, filter: (f) => !/\.lproj$|icon\.icns$|default_app/.test(f) });
  const file = `aether-${version}-mac.zip`;
  execFileSync('zip', ['-qr', join(site, file), 'resources'], { cwd: dirname(pack) });
  const data = readFileSync(join(site, file));
  const manifest = JSON.stringify({ version, file, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: statSync(join(site, file)).size, platform: 'darwin', notes: 'test' });
  writeFileSync(join(site, 'manifest-mac.sig'), crypto.sign(null, Buffer.from(manifest), key).toString('base64'));
  writeFileSync(join(site, 'manifest-mac.json'), manifest);
}

const until = async (what, fn, ms = 120000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => { setTimeout(r, 500); });
  }
  throw new Error(`vypršel čas: ${what}`);
};
const current = () => { try { return JSON.parse(readFileSync(join(userData, 'versions', 'current.json'), 'utf8')); } catch { return {}; } };
const lastVersion = () => states.at(-1)?.verze;

let app;
let code = 0;
try {
  console.log('Sestavuji starou verzi…');
  const oldApp = build(OLD, join(work, 'stara'));
  const newApp = build(NEW, join(work, 'nova'));
  console.log('Vydávám novou verzi…');
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ updateUrl: base, reportUrl: base, tag: 'test' }));
  app = spawn(join(oldApp, 'Contents', 'MacOS', 'Quinvium'), [], { env: { ...process.env, AETHER_NO_SEEDS: '1', AETHER_USER_DATA: userData, AETHER_LAN_PORT: '30592', AETHER_P2P_PORT: '30593', AETHER_RPC_PORT: '18776', AETHER_STRATUM_PORT: '13776', AETHER_UPDATE_MS: '4000', AETHER_REPORT_MS: '2000' }, stdio: 'ignore', detached: true });

  await until('stará verze běží', () => lastVersion() === OLD);
  console.log(`[OK  ] běží stará verze ${OLD}`);

  publish(NEW, join(newApp, 'Contents', 'Resources'));
  await until('nová verze běží', () => lastVersion() === NEW);
  assert.equal(current().version, NEW);
  // První hlášení nové verze může přijít dřív, než se její uzel rozběhne. Uzel musí naskočit do minuty.
  await until('uzel běží v nové verzi', () => states.filter((s) => s.verze === NEW).at(-1)?.uzel === true, 60000);
  console.log(`[OK  ] aplikace se sama aktualizovala a restartovala na ${NEW}`);

  // Aplikace potvrzuje zdravý běh 60 s po startu, a když okno nebo uzel ještě nejsou hotové, zkusí to znovu za dalších 60 s.
  await until('potvrzení zdravého běhu', () => current().tries === 0, 150000);
  console.log('[OK  ] nová verze potvrdila zdravý běh');

  // Vadná verze: kód spadne hned při načtení.
  const broken = join(work, 'vadna');
  mkdirSync(join(broken, 'src'), { recursive: true });
  writeFileSync(join(broken, 'package.json'), JSON.stringify({ name: 'aether-desktop', version: BROKEN, main: 'src/main.cjs' }));
  writeFileSync(join(broken, 'src', 'main.cjs'), "throw new Error('zkouska vadne verze');\n");
  const require = createRequire(join(desktop, 'package.json'));
  const asar = require('@electron/asar');
  const resources = join(work, 'vadne-soubory');
  mkdirSync(resources);
  await asar.createPackage(broken, join(resources, 'app.asar'));
  const before = downloads;
  states.length = 0;
  publish(BROKEN, resources);
  await until('návrat z vadné verze', () => current().bad === BROKEN);
  await until('funkční verze znovu běží', () => lastVersion() === NEW);
  assert.equal(current().version, NEW);
  console.log(`[OK  ] vadná verze ${BROKEN} se odmítla a aplikace běží dál na ${NEW}`);

  const count = downloads;
  await new Promise((r) => { setTimeout(r, 12000); });
  assert.equal(downloads, count, 'vadná verze se znovu nestahuje');
  assert.equal(downloads - before, 1);
  console.log('[OK  ] vadná verze se už znovu nestahuje');
} catch (e) {
  code = 1;
  console.log(`[FAIL] ${e.message}`);
  console.log('Poslední stavy:', JSON.stringify(states.slice(-2)).slice(0, 500), JSON.stringify(current()));
  // Průběh hlášení: kdy běžela která verze a od kdy s uzlem. Bez toho nejde poznat, proč potvrzení nepřišlo.
  const first = states[0]?.t ?? 0;
  console.log('Průběh:', states.map((x) => `${x.t - first}s ${x.verze}${x.uzel ? '+uzel' : ''}`).filter((v, i, all) => i === 0 || v.split(' ')[1] !== all[i - 1].split(' ')[1]).join(', '));
} finally {
  try { execFileSync('pkill', ['-f', 'aether-aktualizace-']); } catch { /* nic neběží */ }
  server.close();
  rmSync(work, { recursive: true, force: true });
}
console.log(code ? 'Selhalo.' : 'Vše prošlo.');
process.exit(code);

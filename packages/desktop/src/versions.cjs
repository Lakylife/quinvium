// Verze aplikace ve vlastních složkách. Aktualizace nic nepřepisuje: nová verze se rozbalí vedle a spustí se po restartu.
// Běžící soubory tak nikdo nezamyká, není potřeba žádný vnější skript a návrat na předchozí verzi je jen změna záznamu.
const path = require('node:path');
const zlib = require('node:zlib');

// Elektron čte soubory .asar jako složky, pro práci se soubory verzí je potřeba obyčejný přístup.
const fs = (() => { try { return require('original-fs'); } catch { return require('node:fs'); } })();

const STATE = 'current.json';
const MAX_TRIES = 2;
const ZIP_END = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;

/** @returns {boolean} je `candidate` novější než `current`, verze ve tvaru 1.2.3 */
function isNewer(candidate, current) {
  const parts = (v) => v.split('.').map(Number);
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function readState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, STATE), 'utf8')); } catch { return {}; }
}

function writeState(dir, state) {
  const file = path.join(dir, STATE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
  fs.renameSync(`${file}.tmp`, file);
}

const usable = (dir, version, builtin) => !!version && isNewer(version, builtin) && fs.existsSync(path.join(dir, version, 'app.asar'));

/**
 * Vybere verzi ke spuštění a započítá pokus. Potvrzení zdravého běhu počítadlo vynuluje, takže verze,
 * která se dvakrát nerozběhla, se opustí a uloží se jako vadná, aby se nestáhla znovu.
 * @param {string} dir složka s verzemi
 * @param {string} builtin verze nainstalované aplikace
 * @returns {{ version: string, folder: string }|null} null znamená spustit nainstalovanou verzi
 */
function pickVersion(dir, builtin) {
  const state = readState(dir);
  if (!usable(dir, state.version, builtin)) return null;
  if ((state.tries ?? 0) >= MAX_TRIES) {
    const previous = usable(dir, state.previous, builtin) ? state.previous : null;
    writeState(dir, { version: previous, previous: null, tries: 0, bad: state.version });
    return previous ? pickVersion(dir, builtin) : null;
  }
  writeState(dir, { ...state, tries: (state.tries ?? 0) + 1 });
  return { version: state.version, folder: path.join(dir, state.version) };
}

const isBad = (dir, version) => readState(dir).bad === version;

/** Verzi nejde spustit: zapíše se jako vadná a příště se vybere předchozí. */
function rejectVersion(dir, version) {
  const state = readState(dir);
  writeState(dir, { version: state.previous ?? null, previous: null, tries: 0, bad: version });
}

/** Verze běží zdravě: vynuluje pokusy a smaže staré složky kromě předchozí, na kterou se dá vrátit. */
function confirmVersion(dir, version) {
  const state = readState(dir);
  if (state.version !== version) return;
  writeState(dir, { ...state, tries: 0 });
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== version && entry.name !== state.previous) fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
  }
}

/** Soubory z archivu ZIP, který vytvořil publikační skript. Balíček je v tu chvíli ověřený podpisem. */
function readZip(zip) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== ZIP_END) end -= 1;
  if (end < 0) throw new Error('Balíček není platný archiv');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== ZIP_ENTRY) throw new Error('Balíček není platný archiv');
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    if (name.endsWith('/')) continue;
    if (method !== STORED && method !== DEFLATED) throw new Error('Neznámá komprese v balíčku');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    files.push({ name, data: method === DEFLATED ? zlib.inflateRawSync(body) : body });
  }
  return files;
}

/**
 * Rozbalí ověřený balíček do složky verze a nastaví ji jako další ke spuštění.
 * Rozepsaná složka se nikdy nevybere, přejmenuje se až celá hotová.
 */
function installVersion(zipFile, dir, version) {
  const target = path.join(dir, version);
  const temp = `${target}.novy`;
  fs.rmSync(temp, { recursive: true, force: true });
  let complete = false;
  for (const { name, data } of readZip(fs.readFileSync(zipFile))) {
    if (name === 'Aether.exe') continue;     // spouštěč se mění jen instalací
    // Zpětné lomítko je na Windows oddělovač cesty, `resources\..\..` by jinak vedlo mimo složku verze.
    if (!name.startsWith('resources/') || /[\\:\0]/.test(name) || name.split('/').some((part) => part === '..' || part === '')) throw new Error(`Neplatná cesta v balíčku: ${name}`);
    const relative = name.slice('resources/'.length);
    const out = path.join(temp, relative);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data, { mode: relative.startsWith('bin/') ? 0o755 : 0o644 });
    if (relative === 'app.asar') complete = true;
  }
  if (!complete) throw new Error('V balíčku chybí aplikace');
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(temp, target);
  const state = readState(dir);
  writeState(dir, { version, previous: state.version ?? null, tries: 0, bad: state.bad === version ? null : state.bad ?? null });
}

module.exports = { confirmVersion, installVersion, isBad, isNewer, pickVersion, readZip, rejectVersion };

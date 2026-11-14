// App versions in their own folders. An update overwrites nothing: the new version is unpacked next to it and starts after a restart.
// Nobody locks the running files, no external script is needed and rolling back to the previous version is just a change of record.
const path = require('node:path');
const zlib = require('node:zlib');

// Electron reads .asar files as folders; working with version files needs plain access.
const fs = (() => { try { return require('original-fs'); } catch { return require('node:fs'); } })();

const STATE = 'current.json';
const MAX_TRIES = 2;
const ZIP_END = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;

/** @returns {boolean} whether `candidate` is newer than `current`, versions in the form 1.2.3 */
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
 * Chooses the version to start and counts an attempt. Confirming a healthy run resets the counter, so a version
 * that failed to start twice is abandoned and recorded as faulty so it is not downloaded again.
 * @param {string} dir folder with versions
 * @param {string} builtin version of the installed app
 * @returns {{ version: string, folder: string }|null} null means start the installed version
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

/** The version cannot start: it is recorded as faulty and the previous one is chosen next time. */
function rejectVersion(dir, version) {
  const state = readState(dir);
  writeState(dir, { version: state.previous ?? null, previous: null, tries: 0, bad: version });
}

/** The version runs healthily: resets attempts and deletes old folders except the previous one, which can be rolled back to. */
function confirmVersion(dir, version) {
  const state = readState(dir);
  if (state.version !== version) return;
  writeState(dir, { ...state, tries: 0 });
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== version && entry.name !== state.previous) fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
  }
}

/** Files from the ZIP archive created by the publishing script. At this point the package has been verified by its signature. */
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
 * Unpacks a verified package into a version folder and sets it as the next to start.
 * A folder being written is never chosen; it is renamed only when complete.
 */
function installVersion(zipFile, dir, version) {
  const target = path.join(dir, version);
  const temp = `${target}.novy`;
  fs.rmSync(temp, { recursive: true, force: true });
  let complete = false;
  for (const { name, data } of readZip(fs.readFileSync(zipFile))) {
    if (name === 'Aether.exe') continue;     // the launcher changes only with installation
    // A backslash is a path separator on Windows; `resources\..\..` would otherwise lead outside the version folder.
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

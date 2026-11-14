// Launcher of the quintium command: runs from the version in use, after its folder disappears from the installation, and adds the path only once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installPath, manualLine, writeLauncher } = require('../src/cli-launcher.cjs');

const place = fs.mkdtempSync(path.join(os.tmpdir(), 'quintium-spoustec-'));
// A folder with a space and a quote, like "Application Support": the path must be quoted correctly in sh.
const data = path.join(place, 'Application Support', 'Aeth"er');
const version = path.join(data, 'versions', '9.9.9', 'bin');
const installed = path.join(place, 'Quinvium.app', 'Contents', 'Resources', 'bin');
fs.mkdirSync(version, { recursive: true });
fs.mkdirSync(installed, { recursive: true });
const fake = (dir, label) => {
  const file = path.join(dir, 'quintium-node.cjs');
  fs.writeFileSync(file, `console.log(JSON.stringify({ from: '${label}', args: process.argv.slice(2), node: process.env.ELECTRON_RUN_AS_NODE }));\n`);
  return file;
};
const bundle = fake(version, 'verze');
const fallback = fake(installed, 'instalace');

test("the launcher calls the running version's command line and passes arguments unchanged", { skip: process.platform === 'win32' }, () => {
  const dir = path.join(data, 'bin');
  const file = writeLauncher({ dir, execPath: process.execPath, bundle, fallback, platform: process.platform });
  assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  const out = JSON.parse(execFileSync(file, ['send', 'alice.qu', '1 000', '--note', 'a "b" $c'], { encoding: 'utf8' }));
  assert.deepEqual(out, { from: 'verze', args: ['cli', 'send', 'alice.qu', '1 000', '--note', 'a "b" $c'], node: '1' });
  const before = fs.statSync(file).mtimeMs;
  writeLauncher({ dir, execPath: process.execPath, bundle, fallback, platform: process.platform });
  assert.equal(fs.statSync(file).mtimeMs, before, 'stejný obsah se nepřepisuje');
  fs.rmSync(bundle);
  assert.equal(JSON.parse(execFileSync(file, ['status'], { encoding: 'utf8' })).from, 'instalace', 'bez složky verze poslouží instalace');
});

test('Windows launcher: paths through variables, without diacritics from the user name', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Lukáš\\AppData\\Local', APPDATA: 'C:\\Users\\Lukáš\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\Lukáš' };
  const dir = path.join(place, 'win');
  const file = writeLauncher({
    dir, platform: 'win32', env,
    execPath: 'C:\\Users\\Lukáš\\AppData\\Local\\AetherApp\\Aether.exe',
    bundle: 'C:\\Users\\Lukáš\\AppData\\Roaming\\Aether\\versions\\2.10.3\\bin\\quintium-node.cjs',
    fallback: 'C:\\Users\\Lukáš\\AppData\\Local\\AetherApp\\resources\\bin\\quintium-node.cjs',
  });
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(file.endsWith('quintium.cmd'));
  assert.doesNotMatch(text, /Lukáš/);
  assert.match(text, /set "B=%APPDATA%\\Aether\\versions\\2\.10\.3\\bin\\quintium-node\.cjs"/);
  assert.match(text, /"%LOCALAPPDATA%\\AetherApp\\Aether\.exe" "%B%" cli %\*/);
  assert.match(text, /\r\n/, 'řádky pro cmd');
  assert.equal(fs.readFileSync(path.join(dir, 'quinvium.cmd'), 'utf8'), text, 'příkaz quinvium spouští totéž');
});

test('the path is added to the profile once and the manual line does the same', async () => {
  const profile = path.join(place, 'zshrc');
  fs.writeFileSync(profile, 'export EDITOR=vim');
  const dir = path.join(data, 'bin');
  const first = await installPath({ dir, platform: 'darwin', home: place, profile });
  assert.deepEqual(first, { ok: true, added: true, file: profile });
  const again = await installPath({ dir, platform: 'darwin', home: place, profile });
  assert.equal(again.added, false, 'podruhé už nic nepřidá');
  const text = fs.readFileSync(profile, 'utf8');
  assert.ok(text.startsWith('export EDITOR=vim\n'), 'původní obsah zůstal');
  assert.equal(text.split('export PATH=').length, 2);
  // A line from the profile in sh really adds the folder to PATH, even with a space and a quote in the path.
  const shown = execFileSync('/bin/sh', ['-c', `. "${profile}"; printf %s "$PATH"`], { encoding: 'utf8' });
  assert.ok(shown.startsWith(`${dir}:`), shown);
  assert.match(manualLine(dir, 'darwin'), /^echo 'export PATH=".*" >> ~\/\.zshrc$|^echo 'export PATH=".*:\$PATH"' >> ~\/\.zshrc$/);
});

test('Windows: PowerShell gets only the user path and nothing runs through cmd', async () => {
  let call;
  const run = (cmd, args, opts, done) => { call = { cmd, args }; done(null, 'added\r\n'); };
  const r = await installPath({ dir: "C:\\Users\\O'Brien\\AppData\\Roaming\\Aether\\bin", platform: 'win32', run });
  assert.deepEqual(r, { ok: true, added: true });
  assert.equal(call.cmd, 'powershell.exe');
  const script = call.args.at(-1);
  assert.match(script, /\$d = 'C:\\Users\\O''Brien\\AppData\\Roaming\\Aether\\bin'/, 'apostrof se v PowerShellu zdvojí');
  assert.match(script, /GetEnvironmentVariable\('Path', 'User'\)/);
  assert.match(script, /-contains \$d/, 'podruhé cestu nepřidá');
  assert.doesNotMatch(script, /setx|Machine/);
  assert.doesNotMatch(manualLine('C:\\x', 'win32'), /setx/);
});

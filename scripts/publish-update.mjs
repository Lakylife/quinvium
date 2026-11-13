#!/usr/bin/env node
// Vydání aktualizace na dálku: sestaví aplikaci pro Windows, zabalí její části a podepíše je.
// Použití: node scripts/publish-update.mjs 2.0.2 "co je nového" [--with-exe]
// --with-exe přibalí i Aether.exe. Rozbalí ho jen aplikace od verze 2.2.0, starší by takový balíček odmítla.
// Soukromý klíč je v ~/.aether/aktualizace-klic.pem, nikam se nekopíruje a složka aktualizací ho neobsahuje.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const withExe = args.includes('--with-exe');
const [version, notes = ''] = args.filter((a) => a !== '--with-exe');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Použití: publish-update.mjs <verze> [popis]');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'packages', 'desktop');
const out = join(homedir(), '.aether', 'aktualizace');
const key = readFileSync(join(homedir(), '.aether', 'aktualizace-klic.pem'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });

const pkgFile = join(desktop, 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
pkg.version = version;
writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

run('cargo', ['build', '--release', '--target', 'x86_64-pc-windows-gnu'], join(root, 'packages', 'miner'));
run(process.execPath, ['scripts/prepare.mjs', 'win'], desktop);
run('npx', ['electron-builder', '--win', 'dir', '--x64', '--publish', 'never'], desktop);

const unpacked = join(desktop, 'release', 'win-unpacked');
// Aplikace přijme jakýkoli název z podepsaného manifestu, starší verze se tedy aktualizují i na nový název.
const file = `quintium-${version}.zip`;
const zip = join(unpacked, file);
rmSync(zip, { force: true });
run('zip', ['-qr', file, 'resources/app.asar', 'resources/bin', 'resources/explorer', ...(withExe ? ['Aether.exe'] : [])], unpacked);

mkdirSync(out, { recursive: true });
copyFileSync(zip, join(out, file));
rmSync(zip, { force: true });
const sha256 = crypto.createHash('sha256').update(readFileSync(join(out, file))).digest('hex');
// Platforma je v podpisu, aby se balíček pro Windows nedal podstrčit jiné platformě. Aplikace od 2.11.1 bez ní aktualizaci odmítne.
const manifest = JSON.stringify({ version, file, sha256, size: statSync(join(out, file)).size, platform: 'win32', notes });
writeFileSync(join(out, 'manifest.sig'), crypto.sign(null, Buffer.from(manifest), key).toString('base64'));
writeFileSync(join(out, 'manifest.json'), manifest);
console.log(`Vydána verze ${version}: ${file}, ${sha256}`);
if (!existsSync(join(out, file))) throw new Error('balíček chybí');

#!/usr/bin/env node
// Publishing a remote update: builds the app for Windows, packs its parts and signs them.
// Usage: node scripts/publish-update.mjs 2.0.2 "what's new" [--with-exe]
// --with-exe also bundles Aether.exe. Only apps from version 2.2.0 unpack it; older ones would reject such a package.
// The private key is kept by the publisher outside the repository, is never copied and the update folder does not contain it.
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
// The app accepts any name from a signed manifest, so older versions also update to the new name.
const file = `quintium-${version}.zip`;
const zip = join(unpacked, file);
rmSync(zip, { force: true });
run('zip', ['-qr', file, 'resources/app.asar', 'resources/bin', 'resources/explorer', ...(withExe ? ['Aether.exe'] : [])], unpacked);

mkdirSync(out, { recursive: true });
copyFileSync(zip, join(out, file));
rmSync(zip, { force: true });
const sha256 = crypto.createHash('sha256').update(readFileSync(join(out, file))).digest('hex');
// The platform is in the signature so a Windows package cannot be fed to another platform. Apps from 2.11.1 reject an update without it.
const manifest = JSON.stringify({ version, file, sha256, size: statSync(join(out, file)).size, platform: 'win32', notes });
writeFileSync(join(out, 'manifest.sig'), crypto.sign(null, Buffer.from(manifest), key).toString('base64'));
writeFileSync(join(out, 'manifest.json'), manifest);
console.log(`Vydána verze ${version}: ${file}, ${sha256}`);
if (!existsSync(join(out, file))) throw new Error('balíček chybí');

// Prepares files for the build: the node in one file, the miner and the shared wallet code.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const walletDir = join(here, '..', 'src', 'renderer', 'wallet');
mkdirSync(walletDir, { recursive: true });
for (const f of ['background.js', 'popup.js', 'popup.css', 'i18n.js', 'qrcode.js', 'jsqr.js', 'qr-tools.js', 'quinvium-symbol.ttf', 'ethers.umd.min.js']) copyFileSync(join(root, 'extension', f), join(walletDir, f));
for (const f of ['config.js', 'walletconnect.js']) copyFileSync(join(root, 'explorer', 'public', f), join(walletDir, f));
await import('./bundle-node.mjs');
const build = join(here, '..', 'build');
const target = process.argv[2] ?? 'mac';
const miner = target === 'win'
  ? join(root, 'miner', 'target', 'x86_64-pc-windows-gnu', 'release', 'quintium-miner.exe')
  : join(root, 'miner', 'target', 'release', 'quintium-miner');
if (target === 'mac') copyFileSync(miner, join(build, 'quintium-miner'));   // running without a build
// The folder the built app takes into resources/bin.
const bin = join(build, target);
rmSync(bin, { recursive: true, force: true });     // files from older builds must not remain in the folder
mkdirSync(bin, { recursive: true });
copyFileSync(miner, join(bin, target === 'win' ? 'quintium-miner.exe' : 'quintium-miner'));
for (const f of ['quintium-node.cjs', 'vm-worker.cjs']) copyFileSync(join(build, f), join(bin, f));
// Hashes of the website and Explorer this release carries: the node compares the public sites with them (watch/site.js).
const { siteManifest } = await import('../../../scripts/site-manifest.mjs');
const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
writeFileSync(join(bin, 'site-manifest.json'), `${JSON.stringify(siteManifest(version), null, 1)}\n`);
// Command line: runs on the Node built into the app; the user does not need to install anything.
// quinvium is the new command name; quintium stays. Both run the same thing.
for (const name of target === 'win' ? ['quintium.cmd', 'quinvium.cmd'] : ['quintium', 'quinvium']) copyFileSync(join(here, 'bin', target === 'win' ? 'quintium.cmd' : 'quintium'), join(bin, name));
console.log('Připraveno pro', target);

// Připraví soubory pro sestavení: uzel v jednom souboru, miner a sdílený kód peněženky.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const walletDir = join(here, '..', 'src', 'renderer', 'wallet');
mkdirSync(walletDir, { recursive: true });
for (const f of ['background.js', 'popup.js', 'popup.css', 'i18n.js', 'qrcode.js', 'ethers.umd.min.js']) copyFileSync(join(root, 'extension', f), join(walletDir, f));
for (const f of ['config.js', 'walletconnect.js']) copyFileSync(join(root, 'explorer', 'public', f), join(walletDir, f));
await import('./bundle-node.mjs');
const build = join(here, '..', 'build');
const target = process.argv[2] ?? 'mac';
const miner = target === 'win'
  ? join(root, 'miner', 'target', 'x86_64-pc-windows-gnu', 'release', 'quintium-miner.exe')
  : join(root, 'miner', 'target', 'release', 'quintium-miner');
if (target === 'mac') copyFileSync(miner, join(build, 'quintium-miner'));   // spuštění bez sestavení
// Složka, kterou si sestavená aplikace bere do resources/bin.
const bin = join(build, target);
rmSync(bin, { recursive: true, force: true });     // ve složce nesmí zůstat soubory ze starších sestavení
mkdirSync(bin, { recursive: true });
copyFileSync(miner, join(bin, target === 'win' ? 'quintium-miner.exe' : 'quintium-miner'));
for (const f of ['quintium-node.cjs', 'vm-worker.cjs']) copyFileSync(join(build, f), join(bin, f));
// Příkazová řádka: běží na Node zabudovaném v aplikaci, uživatel nemusí nic instalovat.
// Příkaz quinvium je nové jméno, quintium zůstává. Oba spouštějí totéž.
for (const name of target === 'win' ? ['quintium.cmd', 'quinvium.cmd'] : ['quintium', 'quinvium']) copyFileSync(join(here, 'bin', target === 'win' ? 'quintium.cmd' : 'quintium'), join(bin, name));
console.log('Připraveno pro', target);

// Složí assets/icon.ico z PNG obrázků v zadané složce (16.png, 32.png…). Formát ICO s PNG uvnitř umí Windows od verze Vista.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
const sizes = readdirSync(dir).map((f) => Number(f.replace('.png', ''))).filter(Boolean).sort((a, b) => a - b);
const images = sizes.map((s) => readFileSync(join(dir, `${s}.png`)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(s === 256 ? 0 : s, at);
  head.writeUInt8(s === 256 ? 0 : s, at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(images[i].length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.ico'), Buffer.concat([head, ...images]));
console.log('icon.ico:', sizes.join(', '));

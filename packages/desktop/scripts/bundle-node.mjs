// Zabalí plný uzel a příkazovou řádku do jednoho souboru pro desktopovou aplikaci i samostatné .exe.
// Vedle něj vznikne vm-worker.cjs, vlákno pro eth_call a eth_estimateGas.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'build');
const src = join(here, '..', '..', 'node', 'src');
mkdirSync(out, { recursive: true });

// tiny-secp256k1 čte .wasm ze souboru vedle sebe. V jednom souboru žádný vedle není, proto se vloží přímo.
const embedWasm = {
  name: 'embed-secp256k1-wasm',
  setup(b) {
    b.onLoad({ filter: /tiny-secp256k1[\\/]lib[\\/](cjs[\\/])?wasm_loader\.c?js$/ }, (args) => {
      const dir = dirname(args.path);
      const wasm = readFileSync(join(dir.endsWith('cjs') ? join(dir, '..') : dir, 'secp256k1.wasm')).toString('base64');
      const code = readFileSync(args.path, 'utf8');
      const patched = code.replace(/readFileSync\)?\(\s*(?:\(0,\s*)?[\w$.]*path\)?\(\s*["']secp256k1\.wasm["']\s*\)\s*\)/, `Buffer.from("${wasm}", "base64")`);
      if (patched === code) throw new Error('Nepodařilo se vložit secp256k1.wasm, změnil se tvar knihovny');
      return { contents: patched, loader: args.path.endsWith('.cjs') ? 'js' : 'js', resolveDir: dir };
    });
  },
};

const common = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node22', minifySyntax: true, legalComments: 'none',
  external: ['bufferutil', 'utf-8-validate'], plugins: [embedWasm],
  define: { 'import.meta.url': '"file:///quintium-node.cjs"' },
  logLevel: 'warning',
};
await build({ ...common, entryPoints: [join(here, 'entry.js')], outfile: join(out, 'quintium-node.cjs') });
await build({ ...common, entryPoints: [join(src, 'rpc', 'vm-worker.js')], outfile: join(out, 'vm-worker.cjs') });
console.log('Uzel zabalen.');

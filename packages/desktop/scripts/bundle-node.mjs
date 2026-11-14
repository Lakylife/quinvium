// Packs the full node and the command line into one file for the desktop app and the standalone .exe.
// vm-worker.cjs is created next to it, the thread for eth_call and eth_estimateGas.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'build');
const src = join(here, '..', '..', 'node', 'src');
mkdirSync(out, { recursive: true });

// tiny-secp256k1 reads .wasm from a file next to it. In a single file there is none, so it is embedded directly.
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

// Sestaví public/walletconnect.js. Stránka ho načte, až když si uživatel WalletConnect vybere.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Okno AppKit nepoužíváme (showQrModal: false, QR kreslí stránka), v balíčku by bylo jen zbytečných 500 kB cizího kódu.
const noModal = {
  name: 'no-modal',
  setup(b) {
    b.onResolve({ filter: /^@reown\/appkit/ }, (a) => ({ path: a.path, namespace: 'no-modal' }));
    b.onLoad({ filter: /.*/, namespace: 'no-modal' }, () => ({ contents: 'export const createAppKit = () => { throw new Error("no modal"); };', loader: 'js' }));
  },
};
await build({
  entryPoints: [join(here, 'walletconnect-entry.js')],
  outfile: join(here, '..', 'public', 'walletconnect.js'),
  bundle: true,
  plugins: [noModal],
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'linked',
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

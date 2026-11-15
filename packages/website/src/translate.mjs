// Translating the built English pages. The site is written in English (pages.mjs, build.mjs); every other language is made
// from the finished HTML: each paragraph, heading, list item, button or link is one unit, looked up by its English HTML
// in i18n/<lang>.json. Inline markup (<a>, <strong>, <code> …) stays part of the unit, so a translation can reorder words
// around it. A unit without a translation stays English, and the test lists it, so nothing silently goes missing.
// Code, scripts, SVG and the whitepaper body are never touched.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'pre', 'textarea', 'svg']);
const INLINE = new Set(['a', 'abbr', 'b', 'br', 'code', 'em', 'i', 'kbd', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u']);
/** Attributes people read. Meta tags are handled by their name or property. */
const ATTRS = ['title', 'alt', 'aria-label', 'placeholder', 'data-before', 'data-on', 'data-off', 'data-copied'];
const META = /^(description|og:title|og:description|og:image:alt|twitter:title|twitter:description)$/;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
/** Text worth translating: it has letters and is not an address, a host name, a number or a command. */
const wordy = (s) => {
  const text = norm(s.replace(/<[^>]+>/g, ' '));
  if (!/\p{L}{2,}/u.test(text)) return false;
  if (/^(https?:\/\/|0x[0-9a-f]|[\w.-]+\.(com|org|io|json|js|css|png|svg|pdf|qu|zip|exe|gz|txt|ttf)\b)/i.test(text) && !/\s/.test(text)) return false;
  if (/^[\d.,]+\s*(kB|MB|GB)$/.test(text)) return false;   // file sizes
  return true;
};

/** A small parser for the site's own, well-formed HTML. */
export function parse(html) {
  const root = { tag: '#root', attrs: '', children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { top.children.push({ text: m[4] }); continue; }
    if (!m[2]) { top.children.push({ raw: m[0] }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const node = { tag, attrs: m[3], children: [] };
    top.children.push(node);
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      const stop = end < 0 ? html.length : end;
      node.rawBody = html.slice(re.lastIndex, stop);
      re.lastIndex = stop;
      const close = html.indexOf('>', stop);
      re.lastIndex = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
  }
  return root;
}

export function serialize(node) {
  if (node.text !== undefined) return node.text;
  if (node.raw !== undefined) return node.raw;
  const inner = node.rawBody !== undefined ? node.rawBody : node.children.map(serialize).join('');
  if (node.tag === '#root') return inner;
  if (VOID.has(node.tag)) return `<${node.tag}${node.attrs}>`;
  return `<${node.tag}${node.attrs}>${inner}</${node.tag}>`;
}

const attr = (n, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(n.attrs ?? '')?.[1];
const skipped = (n) => RAW.has(n.tag) || n.tag === 'code' || /\btranslate="no"/.test(n.attrs ?? '') || /\bclass="[^"]*\b(wp|wp-toc)\b/.test(n.attrs ?? '');
const inlineOnly = (n) => n.children.every((c) => c.text !== undefined || c.raw !== undefined || (INLINE.has(c.tag) && !skippedDeep(c) && inlineOnly(c)) || c.tag === 'code');
const skippedDeep = (n) => /\btranslate="no"/.test(n.attrs ?? '');

/**
 * Walks the tree and hands every unit to `visit(key, set)`: the key is the normalized English HTML,
 * `set(html)` replaces it. Attribute texts come the same way.
 */
function walk(node, visit) {
  for (const name of ATTRS) {
    const v = attr(node, name);
    if (v && wordy(v)) visit(norm(v), (t) => { node.attrs = node.attrs.replace(`${name}="${v}"`, `${name}="${t.replace(/"/g, '&quot;')}"`); });
  }
  if (node.tag === 'meta') {
    const key = attr(node, 'name') ?? attr(node, 'property');
    const v = attr(node, 'content');
    if (key && META.test(key) && v && wordy(v)) visit(norm(v), (t) => { node.attrs = node.attrs.replace(`content="${v}"`, `content="${t.replace(/"/g, '&quot;')}"`); });
  }
  if (skipped(node) || !node.children) return;
  if (node.tag !== '#root' && node.children.length && inlineOnly(node)) {
    const html = node.children.map(serialize).join('');
    if (wordy(html)) {
      // Leading and trailing spaces belong to the layout, not to the sentence.
      const lead = /^\s*/.exec(html)[0];
      const tail = /\s*$/.exec(html)[0];
      visit(norm(html), (t) => { node.children = [{ raw: `${lead}${t}${tail}` }]; });
    }
    return;
  }
  for (const c of node.children) {
    if (c.text !== undefined) {
      if (wordy(c.text)) {
        const lead = /^\s*/.exec(c.text)[0];
        const tail = /\s*$/.exec(c.text)[0];
        visit(norm(c.text), (t) => { c.text = `${lead}${t}${tail}`; });
      }
    } else if (c.tag) walk(c, visit);
  }
}

/** Every unit of a page, for the dictionaries and their test. */
export function units(html) {
  const out = [];
  walk(parse(html), (key) => out.push(key));
  return out;
}

/**
 * The translation of a unit. Version numbers (2.15.2) are not part of the dictionary: a key written with {ver}
 * matches any version, so a new release needs no new translations.
 */
export function lookup(dict, key) {
  if (dict[key]) return dict[key];
  const versions = key.match(/(?<![\d.])\d+\.\d+\.\d+(?!\.?\d)/g);
  if (!versions) return null;
  const generic = dict[key.replace(/(?<![\d.])\d+\.\d+\.\d+(?!\.?\d)/g, '{ver}')];
  if (!generic) return null;
  let i = 0;
  return generic.replace(/\{ver\}/g, () => versions[Math.min(i++, versions.length - 1)]);
}

/** The page in another language. `missing` collects English units without a translation. */
export function translateHtml(html, dict, missing = new Set()) {
  const tree = parse(html);
  walk(tree, (key, set) => {
    const t = lookup(dict, key);
    if (t) set(t);
    else missing.add(key);
  });
  return serialize(tree);
}

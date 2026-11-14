// Simple Markdown to HTML conversion for the whitepaper: headings, paragraphs, lists, tables, code blocks,
// `code`, **bold**, *italic*. The input is our own document from docs/, not user content.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/(https:\/\/[a-z0-9.\-/]+[a-z0-9/])/gi, '<a href="$1">$1</a>');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = []; const toc = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i += 1; continue; }
    if (l.startsWith('```')) {
      const buf = []; i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(esc(lines[i])); i += 1; }
      i += 1; out.push(`<pre><code>${buf.join('\n')}</code></pre>`); continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(l);
    if (h) {
      const lvl = h[1].length; const text = inline(h[2]); const id = slug(h[2]);
      if (lvl === 2) toc.push([id, h[2]]);
      out.push(`<h${lvl} id="${id}">${text}</h${lvl}>`); i += 1; continue;
    }
    if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i += 1; }
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(rows[0]); const body = rows.slice(2).map(cells);
      out.push(`<div class="wp-table"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l); const items = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) { items.push(inline(lines[i].replace(/^(- |\d+\. )/, ''))); i += 1; }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${t}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||```|- |\d+\. )/.test(lines[i])) { para.push(inline(lines[i])); i += 1; }
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return { html: out.join('\n'), toc };
}

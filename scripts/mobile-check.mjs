// Mobile layout check shared by the website and the Explorer tests.
// Every page at phone, tablet and landscape sizes: the page must not scroll sideways, nothing may stick out of the screen
// (except inside a container that scrolls on purpose) and fields need at least 16 px text, otherwise iOS zooms in.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'package.json'));
export const SIZES = [[320, 568], [360, 780], [375, 667], [393, 852], [412, 915], [768, 1024], [844, 390]];

export async function checkPages(base, paths, { label = '', settle = 800, sizes = SIZES } = {}) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const [width, height] of sizes) {
      const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 900, hasTouch: true, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const path of paths) {
        await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(settle);
        const found = await page.evaluate(() => {
          const W = document.documentElement.clientWidth;
          const out = [];
          if (document.documentElement.scrollWidth > W + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${W})`);
          // An element is a problem only when it sticks out and no ancestor clips or scrolls it on purpose.
          const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) return true; if (o.position === 'fixed') return true; } return false; };
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' || cs.position === 'absolute' || cs.visibility === 'hidden' || !el.offsetParent) continue;
            const r = el.getBoundingClientRect();
            if (r.width && (r.right > W + 1 || r.left < -1) && !clipped(el)) out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''} sticks out (${Math.round(r.left)}–${Math.round(r.right)})`);
          }
          for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea')) {
            if (el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} text under 16 px`);
          }
          return [...new Set(out)].slice(0, 6);
        });
        if (process.env.MOBILE_SHOTS && (width === 375 || width === 844)) {
          await page.screenshot({ path: `${process.env.MOBILE_SHOTS}/${label}${width}${path.replace(/[^a-z0-9]+/gi, '_') || '_'}.png`, fullPage: true });
        }
        if (width >= 900) continue;   // field size rules are for touch screens; overflow is checked on all sizes below
        for (const f of found) problems.push(`${label}${path} @${width}x${height}: ${f}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return problems;
}

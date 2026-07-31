/* Right-to-left: the facts that must mirror, plus screenshots to look at.
 *
 * Run: node .claude/tooling/rtl.mjs <router> [lang] — sets uci luci.main.lang, restores it at the end.
 * Writes PNGs next to the JSON in the scratchpad dir given by $SHOT (default /tmp).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const exec = promisify(execFile);
const router = process.argv[2] || 'owrt2512';
const lang = process.argv[3] || 'he';
const SHOT = process.env.SHOT || '/tmp';
const BASE = `http://localhost:${PORTS[router]}`;
const U = (p) => '/cgi-bin/luci/' + p;

const owlab = async (...a) => (await exec(`${process.env.HOME}/go/bin/owlab`, a)).stdout;
const setLang = async (l) => { await owlab('exec', router, '--', 'uci', 'set', `luci.main.lang=${l}`);
                               await owlab('exec', router, '--', 'uci', 'commit', 'luci'); };

/* Every fact below is stated as "which EDGE", so the same expression describes both directions and
 * the LTR pass is a control rather than a separate probe. */
const GEO = `(() => {
  const de = document.documentElement, W = de.clientWidth;
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect();
    return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width),
             atStart: Math.round(r.left) <= 2, atEnd: Math.round(r.right) >= W - 2 }; };
  const cs = (sel, p) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[p] : null; };
  return {
    dir: de.getAttribute('dir'),
    computedDir: getComputedStyle(de).direction,
    W,
    hOverflow: de.scrollWidth - de.clientWidth,
    sidebar: box('.fs-sidebar'),
    content: box('.fs-content'),
    brand: box('.fs-brand'),
    cluster: box('#fs-appearance'),
    tabs: box('#tabmenu ul.tabs'),
    firstTab: box('#tabmenu ul.tabs > li'),
    firstMenuLink: box('#topmenu > li > a'),
    textAlign: cs('.fs-content', 'textAlign'),
    labelAlign: cs('#view .cbi-value-title', 'textAlign'),
    actionsAlign: cs('#view .cbi-section-actions', 'textAlign'),
    alertBorder: (() => { const e = document.querySelector('.alert-message'); if (!e) return null;
      const s = getComputedStyle(e); return { l: s.borderLeftWidth, r: s.borderRightWidth }; })()
  };
})()`;

const out = { router, lang, passes: {} };
const b = await chromium.launch();

for (const [name, code] of [['ltr', 'auto'], ['rtl', lang]]) {
  await setLang(code);
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  await login(p, BASE);
  out.passes[name] = {};
  for (const [pname, path] of [['system', 'admin/system/system'], ['banip', 'admin/services/banip/overview'],
                               ['zones', 'admin/network/firewall/zones'], ['overview', 'admin/status/overview']]) {
    for (const w of [1500, 900, 390]) {
      await p.setViewportSize({ width: w, height: 950 });
      await p.goto(BASE + U(path), { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2200);
      out.passes[name][`${pname}@${w}`] = await p.evaluate(GEO);
      if (w !== 900) await p.screenshot({ path: `${SHOT}/${name}-${pname}-${w}.png`, fullPage: false });
    }
  }
  /* the popover and a rail flyout, which are absolutely positioned and the likeliest to escape */
  await p.setViewportSize({ width: 1500, height: 950 });
  await p.goto(BASE + U('admin/system/system'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  await p.evaluate(() => document.getElementById('fs-appearance').click());
  await p.waitForTimeout(600);
  out.passes[name].popover = await p.evaluate(() => {
    const e = document.getElementById('fs-appearance-pop'); if (!e) return null;
    const r = e.getBoundingClientRect(), W = document.documentElement.clientWidth;
    return { l: Math.round(r.left), r: Math.round(r.right), inside: r.left >= -1 && r.right <= W + 1 };
  });
  await p.screenshot({ path: `${SHOT}/${name}-popover.png` });
  await p.keyboard.press('Escape');
  /* rail: collapse the sidebar and hover a section so the flyout renders */
  await p.evaluate(() => document.getElementById('fs-rail-toggle')?.click());
  await p.waitForTimeout(500);
  const flySel = '#topmenu > li:nth-child(2)';
  await p.evaluate((s) => document.querySelector(s)?.querySelector(':scope > a')?.click(), flySel);
  await p.waitForTimeout(600);
  out.passes[name].flyout = await p.evaluate((s) => {
    const li = document.querySelector(s); if (!li) return null;
    const ul = li.querySelector(':scope > ul'); if (!ul) return null;
    const r = ul.getBoundingClientRect(), lr = li.getBoundingClientRect();
    const W = document.documentElement.clientWidth;
    return { l: Math.round(r.left), r: Math.round(r.right), liL: Math.round(lr.left), liR: Math.round(lr.right),
             inside: r.left >= -1 && r.right <= W + 1, visible: !!ul.getClientRects().length };
  }, flySel);
  await p.screenshot({ path: `${SHOT}/${name}-flyout.png` });
  await p.evaluate(() => document.getElementById('fs-rail-toggle')?.click());
  await p.close();
  process.stderr.write(name + ' ');
}
process.stderr.write('\n');
await setLang('auto');
console.log(JSON.stringify(out, null, 1));
await b.close();

/* Which element inside the last cell demands 634px after a carded -> table resize, and what does it
 * demand on a fresh load at the same width? */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const PATH = 'admin/network/firewall/zones';

const DIG = `(() => {
  const t = document.querySelector('.table.cbi-section-table');
  const row = [...t.querySelectorAll('.tr:not(.cbi-section-table-titles)')][0];
  const cells = [...row.children];
  const wide = cells.map((c, i) => ({ i, w: Math.round(c.getBoundingClientRect().width),
    cls: c.className, widget: c.getAttribute('data-widget'), title: c.getAttribute('data-title') }))
    .sort((a, b) => b.w - a.w)[0];
  const cell = cells[wide.i];
  const kids = [...cell.querySelectorAll('*')].map((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { tag: e.nodeName.toLowerCase(), cls: (typeof e.className === 'string' ? e.className : '').slice(0, 46),
      w: Math.round(r.width), sw: e.scrollWidth, styleW: e.style.width || '', cssW: cs.width,
      minW: cs.minWidth, ws: cs.whiteSpace, disp: cs.display, flex: cs.flex, pos: cs.position };
  }).filter((k) => k.w > 100).sort((a, b) => b.w - a.w).slice(0, 8);
  return { cellIndex: wide.i, cellW: wide.w, cellCls: wide.cls, widget: wide.widget, title: wide.title,
    cellCss: (() => { const c = getComputedStyle(cell); return { disp: c.display, ws: c.whiteSpace, minW: c.minWidth, w: c.width }; })(),
    kids };
})()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
await login(p, BASE);
const settle = async () => { await p.waitForTimeout(400); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(500); };

await p.setViewportSize({ width: 1000, height: 900 });
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
await p.setViewportSize({ width: 1280, height: 900 }); await settle();
const broken = await p.evaluate(DIG);

await p.setViewportSize({ width: 1280, height: 900 });
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
const fresh = await p.evaluate(DIG);
console.log(JSON.stringify({ broken, fresh }, null, 1));
await b.close();

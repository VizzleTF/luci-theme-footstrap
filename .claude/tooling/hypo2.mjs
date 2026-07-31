/* Candidate fixes for the pinned actions column, tried in the live broken page. The pin is an INLINE
 * style written by luci-base's form.js (stabilizeActionColumnWidth), so only !important or removing
 * the attribute can beat it. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const PATH = 'admin/network/firewall/zones';

const M = `(() => { const t = document.querySelector('.table.cbi-section-table');
  const c = document.querySelector('.fs-content'); const main = document.getElementById('maincontent');
  const act = t.querySelector('.tr:not(.cbi-section-table-titles) > .td.cbi-section-actions');
  const btns = [...act.querySelectorAll('button')].map((x)=>Math.round(x.getBoundingClientRect().width));
  return { tableW: Math.round(t.getBoundingClientRect().width), contentW: Math.round(c.getBoundingClientRect().width),
    mainOverflow: main.scrollWidth - main.clientWidth, actW: Math.round(act.getBoundingClientRect().width), btns }; })()`;

const CSS = {
  'baseline (broken)': '',
  'td+th min-width:0 !imp': `.table.cbi-section-table .td.cbi-section-actions,
     .table.cbi-section-table .th.cbi-section-actions { min-width: 0 !important; width: 15% !important; }`,
  'td only, width:auto':   `.table.cbi-section-table .td.cbi-section-actions { min-width: 0 !important; width: auto !important; }`,
  'inner div max-content': `.table.cbi-section-table .td.cbi-section-actions > div { width: max-content !important; }`,
};
/* and the JS alternative: wipe the pin and let upstream re-measure from a clean DOM */
const WIPE = () => {
  document.querySelectorAll('.table.cbi-section-table').forEach((t) => {
    delete t.dataset.actionColWidth;
    t.querySelectorAll('.cbi-section-actions').forEach((el) => { el.style.minWidth = ''; el.style.width = ''; });
  });
  window.dispatchEvent(new Event('resize'));
};

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
await login(p, BASE);
const settle = async () => { await p.waitForTimeout(400); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(600); };
const broken = async () => { await p.setViewportSize({ width: 1000, height: 900 });
  await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  await p.setViewportSize({ width: 1280, height: 900 }); await settle(); };

const out = [];
for (const [name, css] of Object.entries(CSS)) {
  await broken();
  if (css) await p.addStyleTag({ content: css });
  await settle();
  out.push({ name, ...(await p.evaluate(M)) });
}
await broken(); await p.evaluate(WIPE); await settle();
out.push({ name: 'JS: wipe pin + resize', ...(await p.evaluate(M)) });
/* the target */
await p.setViewportSize({ width: 1280, height: 900 });
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
out.push({ name: 'FRESH @1280 (target)', ...(await p.evaluate(M)) });
console.log(JSON.stringify(out, null, 1));
await b.close();

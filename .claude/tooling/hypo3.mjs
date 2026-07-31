/* Narrow the fix down. The pin luci-base writes lands on the header cell too, and in a table the
 * COLUMN is sized by every cell in it — so an override that misses the <th> changes nothing. Each
 * candidate is checked in BOTH modes: the resized table (must stop overflowing) and a card layout
 * (must be left exactly as designed). */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const PATH = 'admin/network/firewall/zones';

const M = `(() => { const t = document.querySelector('.table.cbi-section-table');
  const c = document.querySelector('.fs-content'); const main = document.getElementById('maincontent');
  const act = t.querySelector('.tr:not(.cbi-section-table-titles) > .td.cbi-section-actions');
  const cs = act ? getComputedStyle(act) : null;
  return { tableW: Math.round(t.getBoundingClientRect().width), contentW: Math.round(c.getBoundingClientRect().width),
    mainOverflow: main.scrollWidth - main.clientWidth,
    actW: act ? Math.round(act.getBoundingClientRect().width) : null,
    actDisplay: cs ? cs.display : null,
    btns: act ? [...act.querySelectorAll('button')].map((x)=>Math.round(x.getBoundingClientRect().width)) : [] }; })()`;

const SEL = '.table.cbi-section-table .th.cbi-section-actions, .table.cbi-section-table .td.cbi-section-actions';
const CSS = {
  'baseline':                    '',
  'a) min-width:0 (td+th)':      `${SEL} { min-width: 0 !important; }`,
  'b) min+width:auto (td+th)':   `${SEL} { min-width: 0 !important; width: auto !important; }`,
  'c) min+width:15% (td+th)':    `${SEL} { min-width: 0 !important; width: 15% !important; }`,
};

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
await login(p, BASE);
const settle = async () => { await p.waitForTimeout(400); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(600); };

const out = [];
for (const [name, css] of Object.entries(CSS)) {
  /* TABLE mode reached by the breaking path: load carded at 1000, grow to 1280 */
  await p.setViewportSize({ width: 1000, height: 900 });
  await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  if (css) await p.addStyleTag({ content: css });
  await p.setViewportSize({ width: 1280, height: 900 }); await settle();
  const table = await p.evaluate(M);
  /* CARD mode, freshly, with the same rule in place */
  await p.setViewportSize({ width: 900, height: 900 });
  await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  if (css) await p.addStyleTag({ content: css });
  await settle();
  const card = await p.evaluate(M);
  out.push({ name, table, card });
}
/* targets */
await p.setViewportSize({ width: 1280, height: 900 });
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
const tTarget = await p.evaluate(M);
await p.setViewportSize({ width: 900, height: 900 });
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
const cTarget = await p.evaluate(M);
out.push({ name: 'TARGET (fresh loads)', table: tTarget, card: cTarget });
console.log(JSON.stringify(out, null, 1));
await b.close();

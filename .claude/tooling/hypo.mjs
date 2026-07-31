/* Reproduce the carded -> table resize break, then try candidate fixes IN the live page and measure
 * each. Testing the hypothesis before writing any CSS. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const PATH = process.argv[3] || 'admin/network/firewall/zones';

const M = `(() => { const t = document.querySelector('.table.cbi-section-table');
  const c = document.querySelector('.fs-content'); const main = document.getElementById('maincontent');
  return { tableW: Math.round(t.getBoundingClientRect().width), contentW: Math.round(c.getBoundingClientRect().width),
    mainOverflow: main.scrollWidth - main.clientWidth,
    cells: [...t.querySelectorAll('.tr:not(.cbi-section-table-titles) > .td')].slice(0,6).map((d)=>Math.round(d.getBoundingClientRect().width)) }; })()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
await login(p, BASE);

const settle = async () => { await p.waitForTimeout(400);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await p.waitForTimeout(500); };

const CASES = {
  'baseline (broken)': () => {},
  'max-width:100%':    () => { document.querySelectorAll('.table.cbi-section-table').forEach((t) => t.style.maxWidth = '100%'); },
  'width:100%':        () => { document.querySelectorAll('.table.cbi-section-table').forEach((t) => t.style.width = '100%'); },
  'table-layout:fixed':() => { document.querySelectorAll('.table.cbi-section-table').forEach((t) => { t.style.tableLayout = 'fixed'; t.style.width = '100%'; }); },
  'reflow nudge':      () => { document.querySelectorAll('.table.cbi-section-table').forEach((t) => { const d = t.style.display; t.style.display = 'none'; void t.offsetWidth; t.style.display = d || ''; }); },
};

const out = [];
for (const [name, fn] of Object.entries(CASES)) {
  await p.setViewportSize({ width: 1000, height: 900 });
  await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  await p.setViewportSize({ width: 1280, height: 900 });
  await settle();
  await p.evaluate(fn);
  await settle();
  out.push({ name, ...(await p.evaluate(M)) });
}
/* what a fresh 1280 load looks like, for comparison */
await p.setViewportSize({ width: 1280, height: 900 });
await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
out.push({ name: 'FRESH @1280 (target)', ...(await p.evaluate(M)) });
console.log(JSON.stringify(out, null, 1));
await b.close();

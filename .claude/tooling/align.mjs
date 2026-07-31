/* The pin exists so the actions column lines up across rows whose buttons differ. Wiping it must not
 * cost that: check every row's actions cell has the same width and the same left edge, on tables
 * where the buttons really do differ per row, on a fresh load AND after the resizes that trigger the
 * wipe. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;

const A = `(() => [...document.querySelectorAll('.table.cbi-section-table')].map((t, i) => {
  const cells = [...t.querySelectorAll('.tr:not(.cbi-section-table-titles):not(.cbi-section-table-descr) > .cbi-section-actions')];
  if (!cells.length) return null;
  const w = cells.map((c) => Math.round(c.getBoundingClientRect().width));
  const x = cells.map((c) => Math.round(c.getBoundingClientRect().left));
  const btns = cells.map((c) => c.querySelectorAll('button, .btn').length);
  return { table: i, rows: cells.length, widths: [...new Set(w)], lefts: [...new Set(x)], btnCounts: [...new Set(btns)],
    aligned: new Set(w).size === 1 && new Set(x).size === 1 };
}).filter(Boolean))()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await login(p, BASE);
const settle = async () => { await p.waitForTimeout(500); await p.evaluate(() => new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)))); await p.waitForTimeout(700); };

for (const path of ['admin/network/wireless', 'admin/network/firewall/zones', 'admin/network/firewall/forwards', 'admin/network/dhcp']) {
  for (const step of [['fresh 1280', 1280, null], ['1000->1280', 1000, 1280], ['768->800', 768, 800], ['2560->1280', 2560, 1280]]) {
    const [label, from, to] = step;
    await p.setViewportSize({ width: from, height: 900 });
    await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' }).catch(()=>{});
    await p.waitForTimeout(3000);
    if (to) { await p.setViewportSize({ width: to, height: 900 }); await settle(); }
    const r = await p.evaluate(A);
    const bad = r.filter((x) => !x.aligned && x.rows > 1);
    console.log(path.split('/').slice(-1)[0].padEnd(10), label.padEnd(12),
      r.length ? r.map((x)=>`t${x.table}:${x.rows}r w=${JSON.stringify(x.widths)} btn=${JSON.stringify(x.btnCounts)}${x.aligned||x.rows<2?'':'  <-- MISALIGNED'}`).join('  ') : '(no actions column)');
  }
}
await b.close();

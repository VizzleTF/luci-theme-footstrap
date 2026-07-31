/* Load at one width, resize to another, and compare against loading at the target width directly.
 * A config table is laid out by @container, which the engine re-evaluates on its own — so any
 * difference between "loaded at W" and "resized to W" is layout that did not re-fit. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const PATH = process.argv[3] || 'admin/network/firewall/zones';

const M = `(() => {
  const t = document.querySelector('.table.cbi-section-table');
  const c = document.querySelector('.fs-content'); const main = document.getElementById('maincontent');
  const r = t && t.getBoundingClientRect();
  return { tableW: r ? Math.round(r.width) : null, needs: t ? t.scrollWidth : null,
    contentW: Math.round(c.getBoundingClientRect().width),
    carded: t ? getComputedStyle(t).display : null,
    mainOverflow: main.scrollWidth - main.clientWidth };
})()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await login(p, BASE);

const settle = async () => { await p.waitForTimeout(400);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.waitForTimeout(400); };

const fresh = {};
for (const w of [1000, 1280, 1600]) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  fresh[w] = await p.evaluate(M);
}
const resized = [];
for (const [from, to] of [[1000, 1280], [1600, 1280], [1280, 1600], [1280, 1000], [768, 1280], [2560, 1280]]) {
  await p.setViewportSize({ width: from, height: 900 });
  await p.goto(BASE + '/cgi-bin/luci/' + PATH, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const before = await p.evaluate(M);
  await p.setViewportSize({ width: to, height: 900 });
  await settle();
  const after = await p.evaluate(M);
  /* and again after a long pause, in case something re-fits late */
  await p.waitForTimeout(2500);
  const late = await p.evaluate(M);
  resized.push({ from, to, before, after, late, matchesFresh: JSON.stringify(after) === JSON.stringify(fresh[to]) });
}
console.log(JSON.stringify({ path: PATH, fresh, resized }, null, 1));
await b.close();

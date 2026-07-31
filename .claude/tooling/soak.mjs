/* A long SPA walk over everything reachable from the chrome — sidebar items AND the tab strip, so
 * third-level pages (banip/feeds, ssclash/log, mwan3/*) are actually reached the way a user reaches
 * them. Watches every accumulation shape at once: sheets, DOM nodes, live intervals, the poll queue
 * and the JS heap. Anything that grows monotonically over hundreds of hops is a leak. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const HOPS = Number(process.argv[3] || 150);
const BASE = `http://localhost:${PORTS[router]}`;

const COUNT = `(() => ({
  styles: document.querySelectorAll('style').length,
  links: document.querySelectorAll('link[rel~="stylesheet"]').length,
  shims: [...document.querySelectorAll('style')].filter((s) => (s.textContent||'').startsWith('@import')).length,
  layerStmts: [...document.querySelectorAll('style')].filter((s) => (s.textContent||'').trim().startsWith('@layer tokens')).length,
  nodes: document.getElementsByTagName('*').length,
  intervals: window.__fsViewIntervals ? window.__fsViewIntervals.size : 0,
  pollQueue: (window.L && L.Poll && L.Poll.queue) ? L.Poll.queue.length : 0,
  notifications: document.querySelectorAll('#maincontent > .alert-message').length,
  strayInView: document.querySelectorAll('.fs-content > *:not(#view):not(#tabmenu):not(.alert-message):not(noscript)').length,
  heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
}))()`;

const b = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = new Map();
p.on('pageerror', (e) => errs.set('pageerror: ' + e.message.split('\n')[0], (errs.get('pageerror: ' + e.message.split('\n')[0]) || 0) + 1));
p.on('console', (m) => { if (m.type() === 'error') { const k = 'console: ' + m.text().split('\n')[0].slice(0, 120); errs.set(k, (errs.get(k) || 0) + 1); } });

await login(p, BASE);
/* unfold every sidebar section once, so its leaves are clickable for the rest of the run */
await p.evaluate(() => document.querySelectorAll('#topmenu > li.has-sub:not(.open) > a').forEach((a) => a.click()));
await p.waitForTimeout(600);

const series = [];
let fullLoads = 0;
for (let i = 0; i < HOPS; i++) {
  /* every same-origin chrome link on screen: sidebar leaves plus the current page's tab strip */
  const hrefs = await p.evaluate(() => [...document.querySelectorAll('#topmenu a[href^="/cgi-bin/luci/"], #tabmenu a[href^="/cgi-bin/luci/"]')]
    .map((a) => a.getAttribute('href')).filter((h) => !/logout/.test(h)));
  if (!hrefs.length) break;
  const href = hrefs[(i * 7 + 3) % hrefs.length];          /* deterministic stride, no Math.random */
  await p.evaluate(() => { window.__fsSentinel = 1; });
  await p.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), href);
  await p.waitForTimeout(1400);
  if (!(await p.evaluate(() => window.__fsSentinel === 1))) fullLoads++;
  if (i % 10 === 9) series.push({ hop: i + 1, ...(await p.evaluate(COUNT)) });
  if (i % 25 === 24) process.stderr.write(String(i + 1) + ' ');
}
process.stderr.write('\n');
console.log(JSON.stringify({ router, hops: HOPS, fullLoads, series,
  errors: [...errs.entries()].map(([k, v]) => ({ n: v, k })).sort((a, b) => b.n - a.n).slice(0, 10) }, null, 1));
await b.close();

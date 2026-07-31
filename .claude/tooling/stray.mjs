/* Catch the two anomalies the soak turned up, with the page and the offending elements attached:
 *  - a sibling of #view left inside .fs-content (fs-router sweeps those on every navigation, so a
 *    survivor is either the incoming view's own or a hole in the sweep);
 *  - a runtime notification in #maincontent outliving the page that raised it;
 *  - and the stack of every pageerror, to tell a theme fault from an app's own. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const HOPS = Number(process.argv[3] || 200);
const BASE = `http://localhost:${PORTS[router]}`;

const PROBE = `(() => ({
  page: document.body.getAttribute('data-page'),
  stray: [...document.querySelectorAll('.fs-content > *')]
    .filter((e) => e.id !== 'view' && e.id !== 'tabmenu' && !e.classList.contains('alert-message') && e.nodeName !== 'NOSCRIPT')
    .map((e) => e.nodeName + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + ' :: ' + (e.textContent || '').trim().slice(0, 50)),
  notif: [...document.querySelectorAll('#maincontent > .alert-message')].map((e) => (e.textContent || '').trim().slice(0, 70))
}))()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
let current = '(start)';
const faults = [];
p.on('pageerror', (e) => faults.push({ kind: 'pageerror', page: current, msg: e.message.split('\n')[0], stack: (e.stack || '').split('\n').slice(1, 4).map((s) => s.trim()) }));

await login(p, BASE);
await p.evaluate(() => document.querySelectorAll('#topmenu > li.has-sub:not(.open) > a').forEach((a) => a.click()));
await p.waitForTimeout(600);

const hits = [];
for (let i = 0; i < HOPS; i++) {
  const hrefs = await p.evaluate(() => [...document.querySelectorAll('#topmenu a[href^="/cgi-bin/luci/"], #tabmenu a[href^="/cgi-bin/luci/"]')]
    .map((a) => a.getAttribute('href')).filter((h) => !/logout/.test(h)));
  if (!hrefs.length) break;
  const href = hrefs[(i * 7 + 3) % hrefs.length];
  const from = current;
  await p.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), href);
  await p.waitForTimeout(1400);
  const r = await p.evaluate(PROBE);
  current = r.page;
  if (r.stray.length || r.notif.length) hits.push({ hop: i, from, to: r.page, href, stray: r.stray, notif: r.notif });
  if (i % 25 === 24) process.stderr.write(String(i + 1) + ' ');
}
process.stderr.write('\n');
console.log(JSON.stringify({ router, hops: HOPS, hits, faults }, null, 1));
await b.close();

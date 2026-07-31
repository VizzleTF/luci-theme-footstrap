/* Does a page's polling really stop when you leave it?
 *
 * navigate() flushes L.Poll's queue and clears every setInterval a view set. Neither reaches a
 * RECURSIVE setTimeout — the other way an app tails a log — and a full load would have killed that
 * too. So measure it from the outside: sit on a neutral page and count the RPCs the browser actually
 * sends, first as a baseline, then after having visited each app.
 *
 * Attribution is by ubus method + object out of the POST body, so a stray poller names itself.
 */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const U = (p) => '/cgi-bin/luci/' + p;
const WATCH_MS = Number(process.argv[3] || 15000);
const NEUTRAL = 'admin/network/routes';   /* no poller of its own */

const APPS = ['admin/services/podkop', 'admin/services/banip/overview', 'admin/services/adblock/overview',
              'admin/services/ssclash/log', 'admin/system/filemanager', 'admin/status/realtime/load',
              'admin/status/processes', 'admin/modem/3ginfo-lite/3gdetail', 'admin/network/mwan3/globals',
              'admin/services/https-dns-proxy'];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await login(p, BASE);

const calls = [];
let recording = false;
p.on('request', (r) => {
  if (!recording) return;
  const url = r.url();
  let tag = url.replace(BASE, '');
  const post = r.postData();
  if (post && post.indexOf('"method"') >= 0) {
    const m = [...post.matchAll(/"method"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
    const o = [...post.matchAll(/"object"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
    tag = 'ubus:' + (o.length ? o.join('+') + '/' : '') + m.join('+');
  }
  calls.push(tag.slice(0, 90));
});

const hop = async (path) => {
  await p.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (a) return a.click();
    const s = document.createElement('a'); s.href = h; document.getElementById('view').appendChild(s); s.click();
  }, U(path));
  await p.waitForTimeout(2600);
};

const watch = async (label) => {
  calls.length = 0;
  recording = true;
  await p.waitForTimeout(WATCH_MS);
  recording = false;
  const agg = {};
  for (const c of calls) agg[c] = (agg[c] || 0) + 1;
  return { label, total: calls.length, agg };
};

const out = { router: process.argv[2] || 'owrt2512', watchMs: WATCH_MS, runs: [] };

/* baseline: land on the neutral page by a full load and just sit there */
await p.goto(BASE + U(NEUTRAL), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3000);
out.baseline = await watch('baseline');

for (const app of APPS) {
  await hop(app);
  await p.waitForTimeout(5000);            /* let its pollers get going */
  await hop(NEUTRAL);
  const r = await watch(app);
  r.extra = r.total - out.baseline.total;
  out.runs.push(r);
  process.stderr.write(app.split('/').pop() + ' ');
}
process.stderr.write('\n');
console.log(JSON.stringify(out, null, 1));
await b.close();

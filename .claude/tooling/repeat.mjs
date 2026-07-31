/* Do sheets, nodes, listeners or pollers pile up when the same page is visited over and over by the
 * SPA router? podkop calls injectGlobalStyles() from render() with no guard, ssclash's Ace adds
 * sheets lazily, and a view's own setInterval used to outlive the page that set it. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const N = Number(process.argv[3] || 8);
const BASE = `http://localhost:${PORTS[router]}`;

const PAIRS = [
  ['podkop',      'admin/services/podkop',           'admin/system/system'],
  ['ssclash/cfg', 'admin/services/ssclash/config',   'admin/system/system'],
  ['filemanager', 'admin/system/filemanager',        'admin/system/system'],
  ['banip/feeds', 'admin/services/banip/feeds',      'admin/system/system'],
  ['processes',   'admin/status/processes',          'admin/network/routes'],
];

const COUNT = `(() => ({
  styles: document.querySelectorAll('style').length,
  links: document.querySelectorAll('link[rel~="stylesheet"]').length,
  shims: [...document.querySelectorAll('style')].filter((s) => (s.textContent||'').startsWith('@import')).length,
  layerStmts: [...document.querySelectorAll('style')].filter((s) => (s.textContent||'').trim().startsWith('@layer tokens')).length,
  nodes: document.getElementsByTagName('*').length,
  intervals: window.__fsViewIntervals ? window.__fsViewIntervals.size : null,
  pollQueue: (window.L && L.Poll && L.Poll.queue) ? L.Poll.queue.length : null,
  heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
}))()`;

const b = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await login(p, BASE);

/* Click a link that is really IN the sidebar. A third-level page (banip/feeds, ssclash/config) is a
 * TAB, not a sidebar item — renderMainMenu stops at level 1 — so its href exists only while you are
 * already on that app. Fall back to the app's SECTION link, which is an alias the router resolves to
 * exactly that leaf; that is a genuine SPA hop, where a p.goto() would be a full load and would
 * measure nothing about accumulation. */
const go = async (path) => {
  const cands = [ '/cgi-bin/luci/' + path,
                  '/cgi-bin/luci/' + path.split('/').slice(0, 3).join('/') ];
  const used = await p.evaluate((hs) => {
    for (const h of hs) { const a = document.querySelector(`a[href="${h}"]`); if (a) { a.click(); return h; } }
    return null;
  }, cands);
  if (!used) await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  return !!used;                               /* false = we had to full-load, i.e. not an SPA hop */
};

const res = [];
for (const [name, appPath, otherPath] of PAIRS) {
  await p.goto(BASE + '/cgi-bin/luci/' + otherPath, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const series = [];
  let allSpa = true;
  for (let i = 0; i < N; i++) {
    const a = await go(appPath); const c = await go(otherPath);
    if (!a || !c) allSpa = false;
    series.push(await p.evaluate(COUNT));
  }
  const f = series[0], l = series[series.length - 1];
  res.push({ name, allSpa, first: f, last: l,
    delta: { styles: l.styles - f.styles, links: l.links - f.links, shims: l.shims - f.shims,
             layerStmts: l.layerStmts - f.layerStmts, nodes: l.nodes - f.nodes,
             intervals: (l.intervals ?? 0) - (f.intervals ?? 0), pollQueue: (l.pollQueue ?? 0) - (f.pollQueue ?? 0),
             heapMB: (l.heap ?? 0) - (f.heap ?? 0) } });
  process.stderr.write(name + ' ');
}
process.stderr.write('\n');
console.log(JSON.stringify({ router, cycles: N, res }, null, 1));
await b.close();

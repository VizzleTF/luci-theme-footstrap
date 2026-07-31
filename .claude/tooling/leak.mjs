/* Leak hunt with the noise removed: force GC through CDP before every reading, and count the things
 * that actually leak in this codebase's history — event listeners on an enhanced <select> (teardown
 * used to leave the `change` listener behind, one per CBI dependency rebuild), document-level
 * listeners, live intervals, and the DOM node count. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const HOPS = Number(process.argv[3] || 240);

const b = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('HeapProfiler.enable'); await cdp.send('Runtime.enable'); await cdp.send('DOM.enable');
await login(p, BASE);
await p.evaluate(() => document.querySelectorAll('#topmenu > li.has-sub:not(.open) > a').forEach((a) => a.click()));
await p.waitForTimeout(600);

async function listenersOn(selector) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
  if (!result.objectId) return null;
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  const by = {}; for (const l of listeners) by[l.type] = (by[l.type] || 0) + 1;
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
  return by;
}
async function docListeners() {
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  const by = {}; for (const l of listeners) by[l.type] = (by[l.type] || 0) + 1;
  return by;
}
async function measure() {
  await cdp.send('HeapProfiler.collectGarbage');
  await p.waitForTimeout(300);
  const m = await p.evaluate(() => ({
    nodes: document.getElementsByTagName('*').length,
    selects: document.querySelectorAll('select[data-fs-select="1"]').length,
    intervals: window.__fsViewIntervals ? window.__fsViewIntervals.size : 0,
    pollQueue: (window.L && L.Poll && L.Poll.queue) ? L.Poll.queue.length : 0,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
  }));
  return { ...m, doc: await docListeners(), sel: await listenersOn('select[data-fs-select="1"]') };
}

/* churn the firewall pages hard: their CBI dependencies rebuild option lists constantly, which is
 * what drives fs-select's teardown/enhance cycle */
const RING = ['admin/network/firewall/zones', 'admin/network/firewall/forwards',
              'admin/network/firewall/rules', 'admin/network/dhcp', 'admin/network/wireless',
              'admin/status/processes', 'admin/system/system'];
const series = [];
for (let i = 0; i <= HOPS; i++) {
  if (i % 40 === 0) series.push({ hop: i, ...(await measure()) });
  const href = '/cgi-bin/luci/' + RING[i % RING.length];
  await p.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), href);
  await p.waitForTimeout(900);
  if (i % 40 === 39) process.stderr.write(String(i + 1) + ' ');
}
process.stderr.write('\n');
console.log(JSON.stringify({ hops: HOPS, series }, null, 1));
await b.close();

/* Is the heap growth a leak or just the module cache filling? Measure ALWAYS ON THE SAME PAGE, after
 * a forced GC, so page size cannot colour the reading. A cache that fills plateaus; a leak does not. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const HOPS = Number(process.argv[3] || 560);
const RING = ['admin/network/firewall/zones', 'admin/network/firewall/forwards',
              'admin/network/firewall/rules', 'admin/network/dhcp', 'admin/network/wireless',
              'admin/status/processes', 'admin/system/system'];

const b = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('HeapProfiler.enable');
await login(p, BASE);
await p.evaluate(() => document.querySelectorAll('#topmenu > li.has-sub:not(.open) > a').forEach((a) => a.click()));
await p.waitForTimeout(600);

const rows = [];
for (let i = 0; i <= HOPS; i++) {
  const href = '/cgi-bin/luci/' + RING[i % RING.length];
  await p.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), href);
  await p.waitForTimeout(850);
  /* measure only at the top of the ring: same page, same content, every time */
  if (i % (RING.length * 10) === 0) {
    await cdp.send('HeapProfiler.collectGarbage'); await p.waitForTimeout(400);
    await cdp.send('HeapProfiler.collectGarbage'); await p.waitForTimeout(400);
    rows.push({ hop: i, page: RING[i % RING.length].split('/').pop(), ...(await p.evaluate(() => ({
      heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2),
      nodes: document.getElementsByTagName('*').length,
      history: history.length })))});
    process.stderr.write(String(i) + ' ');
  }
}
process.stderr.write('\n');
console.log(JSON.stringify(rows, null, 1));
await b.close();

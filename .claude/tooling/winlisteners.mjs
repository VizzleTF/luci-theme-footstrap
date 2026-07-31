/* Count listeners on window across navigations. luci-base's stabilizeActionColumnWidth registers
 * `window.addEventListener('resize', () => ... tableEl ...)` once per TABLE ELEMENT, guarded by an
 * expando ON that element — so every re-render of a config page adds another one, and each closes
 * over the table it was created for. Nothing ever removes them. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const HOPS = Number(process.argv[3] || 120);
const RING = ['admin/network/firewall/zones', 'admin/network/firewall/forwards',
              'admin/network/dhcp', 'admin/system/system'];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send('Runtime.enable');
await login(p, BASE);
await p.evaluate(() => document.querySelectorAll('#topmenu > li.has-sub:not(.open) > a').forEach((a) => a.click()));
await p.waitForTimeout(600);

async function winListeners() {
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  const by = {}; for (const l of listeners) by[l.type] = (by[l.type] || 0) + 1;
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
  return by;
}
console.log('hop  window listeners');
for (let i = 0; i <= HOPS; i++) {
  if (i % 20 === 0) console.log(String(i).padEnd(5), JSON.stringify(await winListeners()));
  await p.evaluate((h) => document.querySelector(`a[href="${h}"]`)?.click(), '/cgi-bin/luci/' + RING[i % RING.length]);
  await p.waitForTimeout(850);
}
await b.close();

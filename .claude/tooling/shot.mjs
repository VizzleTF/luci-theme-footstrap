import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await login(p, BASE);
for (const [name, path, w] of [
  ['zones-1280', 'admin/network/firewall/zones', 1280],
  ['zones-1600', 'admin/network/firewall/zones', 1600],
  ['zones-1000', 'admin/network/firewall/zones', 1000],
  ['dhcp-1280',  'admin/network/dhcp', 1280],
]) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(3000);
  const m = await p.evaluate(() => {
    const t = document.querySelector('.table.cbi-section-table');
    const c = document.querySelector('.fs-content'); const main = document.getElementById('maincontent');
    const tr = t?.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return { table: tr ? Math.round(tr.width) : null, tableNeeds: t ? t.scrollWidth : null,
             content: Math.round(cr.width), contentRight: Math.round(cr.right),
             tableRight: tr ? Math.round(tr.right) : null,
             mainOverflow: main.scrollWidth - main.clientWidth };
  });
  console.log(name.padEnd(12), JSON.stringify(m));
  await p.screenshot({ path: `/tmp/shot-${name}.png`, fullPage: false });
}
await b.close();

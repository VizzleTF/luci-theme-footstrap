/* A legacy Lua CBI page (openclash, openvpn — `call` nodes the router never takes SPA) renders its
 * form as a SIBLING of #view. Leaving one is the case fs-router's sweep exists for: the outgoing
 * page's form, scripts and stray headings must not ride along into the next page. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;

const CONTENT = `(() => ({
  page: document.body.getAttribute('data-page'),
  siblings: [...document.querySelectorAll('.fs-content > *')].map((e) => e.nodeName + (e.id ? '#' + e.id : '')),
  viewKids: document.getElementById('view')?.children.length ?? null,
  viewText: (document.getElementById('view')?.textContent || '').trim().slice(0, 60),
  title: document.querySelector('.fs-title-main')?.textContent,
  docTitle: document.title
}))()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await login(p, BASE);

const out = [];
for (const legacy of ['admin/services/openclash/client', 'admin/vpn/openvpn', 'admin/services/openclash/config']) {
  await p.goto(BASE + '/cgi-bin/luci/' + legacy, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(3000);
  const on = await p.evaluate(CONTENT);
  await p.evaluate(() => { window.__s = 1; });
  await p.evaluate(() => document.querySelector('a[href="/cgi-bin/luci/admin/system/system"]')?.click());
  await p.waitForTimeout(2600);
  const after = await p.evaluate(CONTENT);
  const spa = await p.evaluate(() => window.__s === 1);
  /* and one more hop, to be sure nothing was merely deferred */
  await p.evaluate(() => document.querySelector('a[href="/cgi-bin/luci/admin/network/routes"]')?.click());
  await p.waitForTimeout(2400);
  const after2 = await p.evaluate(CONTENT);
  out.push({ legacy, on, spa, after, after2 });
}
console.log(JSON.stringify(out, null, 1));
await b.close();

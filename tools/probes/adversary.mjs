/* The documented adversaries, in the order that matters: open the app's page, then LEAVE it and
 * look at the page you land on. Containment is about the NEXT page — the fence keeps a foreign
 * `!important` off the chrome, page ownership darkens the sheet, and documentPoisoned decides
 * whether the router may hand the document on at all. */
import { chromium } from 'playwright';
import { login, SNAP, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const BASE = `http://localhost:${PORTS[router]}`;

/* titled, reachable pages of each adversary; openclash's are `call` nodes (legacy Lua CBI), which
 * the router deliberately never takes SPA — they still have to leave the chrome intact. */
const TARGETS = [
  ['banip/feeds',        'admin/services/banip/feeds'],
  ['adblock/feeds',      'admin/services/adblock/feeds'],
  ['podkop',             'admin/services/podkop'],
  ['ssclash/config',     'admin/services/ssclash/config'],
  ['ssclash/log',        'admin/services/ssclash/log'],
  ['filemanager',        'admin/system/filemanager'],
  ['openclash/config',   'admin/services/openclash/config'],
  ['openclash/settings', 'admin/services/openclash/settings'],
  ['openclash/log',      'admin/services/openclash/log'],
  ['3ginfo/detail',      'admin/modem/3ginfo-lite/3gdetail'],
  ['mwan3/status',       'admin/status/mwan3/overview'],
  ['statistics/graphs',  'admin/statistics/graphs'],
];

const DETAIL = `(() => [...document.querySelectorAll('style, link[rel~="stylesheet"]')].map((el) => {
  let rules = null, err = null;
  try { rules = el.sheet ? el.sheet.cssRules.length : null; } catch (e) { err = 'unreadable'; }
  return { tag: el.tagName, href: el.getAttribute('href'),
    head: el.tagName === 'STYLE' ? (el.textContent || '').slice(0, 60).replace(/\\s+/g, ' ') : null,
    shell: el.hasAttribute('data-fs-shell'), layered: el.dataset.fsLayered === '1',
    elDisabled: el.disabled, sheetDisabled: (() => { try { return el.sheet ? el.sheet.disabled : null; } catch (e) { return err; } })(),
    rules };
}))()`;

/* The chrome's own geometry: what openclash's \`*{padding:0}\` destroys first. */
const CHROME = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect();
    const c = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), pad: c.padding, gap: c.gap }; };
  const link = q('#topmenu > li > a');
  return { sidebar: box('.fs-sidebar'), brand: box('.fs-brand'), content: box('.fs-content'),
    firstMenuLink: link ? { pad: getComputedStyle(link).padding, x: Math.round(link.getBoundingClientRect().x) } : null,
    tabs: box('#tabmenu'), appearanceBtn: box('#fs-appearance') };
})()`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await login(p, BASE);

const clean = { snap: await p.evaluate(SNAP), chrome: await p.evaluate(CHROME) };
const out = [];
for (const [name, path] of TARGETS) {
  await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(3000);
  const onApp = { snap: await p.evaluate(SNAP), chrome: await p.evaluate(CHROME),
                  sheets: (await p.evaluate(DETAIL)).filter((s) => !s.shell) };
  /* now LEAVE, by the router's own path, and look at the page we land on */
  await p.evaluate(() => { window.__fsSentinel = 1; });
  await p.evaluate(() => document.querySelector('a[href="/cgi-bin/luci/admin/system/system"]')?.click());
  await p.waitForTimeout(2600);
  const after = { spa: await p.evaluate(() => window.__fsSentinel === 1),
                  snap: await p.evaluate(SNAP), chrome: await p.evaluate(CHROME) };
  out.push({ name, path, onApp, after });
  process.stderr.write('.');
}
process.stderr.write('\n');
console.log(JSON.stringify({ router, clean, out }, null, 1));
await b.close();

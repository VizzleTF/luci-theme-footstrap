/* SPA-arrival vs FULL-LOAD parity, page by page.
 *
 * The router's whole contract is "the document ends up the way a full load would have left it".
 * Every SPA bug found so far was a field where that stopped being true (data-page, the sibling of
 * #view, the runtime notifications, nodespec.readonly, the poll tick). So stop guessing which field
 * is next and diff the WHOLE snapshot for every page the menu offers.
 *
 * The SPA hop is made by appending a real <a href> into #view and clicking it: the router intercepts
 * any same-origin link, so this reaches a page that has no sidebar link of its own (a third-level tab)
 * without the probe having to model the menu.
 */
import { chromium } from 'playwright';
import { login, PAGES, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const engine = process.argv[3] || 'chromium';
const BASE = `http://localhost:${PORTS[router]}`;
const U = (p) => '/cgi-bin/luci/' + p;
const NEUTRAL = 'admin/status/processes';

const SNAP = `(() => {
  const view = document.getElementById('view');
  const txt = (el) => (el ? el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60) : null);
  return {
    dataPage: document.body.getAttribute('data-page'),
    title: document.title,
    dispatch: (L.env.dispatchpath || []).join('/'),
    request: (L.env.requestpath || []).join('/'),
    pathinfo: L.env.pathinfo,
    readonly: !!(L.env.nodespec && L.env.nodespec.readonly),
    tabs: [...document.querySelectorAll('#tabmenu ul.tabs')].map((ul) =>
      [...ul.children].map((li) => (li.classList.contains('active') ? '*' : '') +
        li.className.replace(/tabmenu-item-| active|/g, '')).join('|')).join(' // '),
    current: [...document.querySelectorAll('#topmenu a[aria-current="page"]')].map((a) => a.getAttribute('href')).join(','),
    views: document.querySelectorAll('#view').length,
    siblings: [...(view ? view.parentNode.children : [])].map((c) => c.id || c.nodeName).join(','),
    kids: view ? view.children.length : null,
    head: txt(view && view.firstElementChild),
    h2: [...document.querySelectorAll('#view h2')].map((h) => txt(h)).join('|'),
    sections: document.querySelectorAll('#view .cbi-section, #view .table').length,
    forms: document.querySelectorAll('#view form').length,
    btns: document.querySelectorAll('#view button:not([disabled]), #view .cbi-button:not([disabled])').length,
    notif: document.querySelectorAll('#maincontent > .alert-message').length,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    styles: document.querySelectorAll('style').length,
    links: document.querySelectorAll('link[rel~="stylesheet"]').length,
    disabled: [...document.querySelectorAll('link[rel~="stylesheet"]')].filter((l) => l.disabled).length,
    poll: (L.Poll && L.Poll.queue) ? L.Poll.queue.length : null
  };
})()`;

const engines = { chromium };
if (engine === 'webkit') engines.webkit = (await import('playwright')).webkit;
const launcher = engine === 'webkit' ? engines.webkit : chromium;

const b = await launcher.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).split('\n')[0].slice(0, 120)));
await login(p, BASE);

const pages = await p.evaluate(PAGES);
process.stderr.write(`${pages.length} pages\n`);

/* fields where a difference is timing, not state */
const SOFT = new Set(['poll', 'styles', 'links', 'disabled', 'btns', 'notif']);
const diffs = [];
let n = 0;

for (const pg of pages) {
  n++;
  /* full load */
  await p.goto(BASE + U(pg.path), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2600);
  const full = await p.evaluate(SNAP);

  /* SPA arrival from a neutral page */
  await p.goto(BASE + U(NEUTRAL), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { window.__s = 1; });
  await p.evaluate((h) => {
    const a = document.createElement('a');
    a.href = h; a.textContent = 'x';
    document.getElementById('view').appendChild(a);
    a.click();
  }, U(pg.path));
  await p.waitForTimeout(2600);
  const spa = await p.evaluate(SNAP);
  const wasSpa = await p.evaluate(() => window.__s === 1);

  const d = {};
  for (const k of Object.keys(full))
    if (JSON.stringify(full[k]) !== JSON.stringify(spa[k]))
      d[k] = [full[k], spa[k]];
  const hard = Object.keys(d).filter((k) => !SOFT.has(k));
  if (hard.length || !wasSpa)
    diffs.push({ path: pg.path, type: pg.type, spa: wasSpa, hard, d });
  if (n % 10 === 0) process.stderr.write(`${n} `);
}
process.stderr.write('\n');
console.log(JSON.stringify({ router, engine, pages: pages.length, diffs, errs: [...new Set(errs)].slice(0, 10) }, null, 1));
await b.close();

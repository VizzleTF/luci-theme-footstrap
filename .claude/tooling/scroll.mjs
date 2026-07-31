/* Scrolling is where this theme differs from stock, so it is where an engine difference would show.
 * In the SIDEBAR layout .fs-shell is exactly 100dvh with overflow:hidden and .fs-main owns overflow-y,
 * so #maincontent is the scroller and the DOCUMENT must not scroll at all (a document scrollbar there
 * is a double scrollbar). In the TOP layout the document scrolls instead. Back must restore the inner
 * scroller, which no browser does for a same-document traversal — fs-router records it itself. */
import { chromium, firefox, webkit } from 'playwright';
import { login, PORTS } from './lib.mjs';
const ENGINES = { chromium, firefox, webkit };
const engine = process.argv[3] || 'chromium';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const LONG = 'admin/status/processes';   /* a page tall enough to scroll */

const S = `(() => {
  const de = document.documentElement, main = document.getElementById('maincontent');
  const shell = document.querySelector('.fs-shell'), side = document.querySelector('.fs-sidebar');
  return {
    layout: de.getAttribute('data-layout'),
    docScrolls: de.scrollHeight - de.clientHeight,
    mainScrolls: main.scrollHeight - main.clientHeight,
    mainOverflowY: getComputedStyle(main).overflowY,
    shellH: shell ? Math.round(shell.getBoundingClientRect().height) : null,
    viewportH: de.clientHeight,
    shellOverflow: shell ? getComputedStyle(shell).overflow : null,
    sidebarScrolls: side ? side.scrollHeight - side.clientHeight : null,
    docScrollTop: de.scrollTop || document.body.scrollTop,
    mainScrollTop: main.scrollTop
  };
})()`;

const b = await ENGINES[engine].launch();
const p = await b.newPage({ viewport: { width: 1400, height: 700 } });
await login(p, BASE);
const out = {};

for (const layout of ['sidebar', 'top']) {
  await p.evaluate((l) => { try { localStorage.setItem('fs-layout', l); } catch (e) {} }, layout);
  await p.goto(BASE + '/cgi-bin/luci/' + LONG, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  const at0 = await p.evaluate(S);
  /* scroll the thing that is supposed to scroll */
  await p.evaluate(() => { const m = document.getElementById('maincontent');
    if (m.scrollHeight > m.clientHeight) m.scrollTop = 400; else window.scrollTo(0, 400); });
  await p.waitForTimeout(400);
  const at1 = await p.evaluate(S);
  out[layout] = { at0, scrolled: { doc: at1.docScrollTop, main: at1.mainScrollTop } };
}

/* Back must restore the inner scroller after an SPA hop (fs-router's _scrollMem) */
await p.evaluate(() => { try { localStorage.setItem('fs-layout', 'sidebar'); } catch (e) {} });
await p.goto(BASE + '/cgi-bin/luci/' + LONG, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3500);
await p.evaluate(() => { document.getElementById('maincontent').scrollTop = 500; });
await p.waitForTimeout(400);
const before = await p.evaluate(() => document.getElementById('maincontent').scrollTop);
await p.evaluate(() => document.querySelector('a[href="/cgi-bin/luci/admin/system/system"]')?.click());
await p.waitForTimeout(2500);
const afterNav = await p.evaluate(() => document.getElementById('maincontent').scrollTop);
await p.goBack();
await p.waitForTimeout(3500);
const afterBack = await p.evaluate(() => document.getElementById('maincontent').scrollTop);
out.backRestore = { before, afterNav, afterBack, ok: Math.abs(afterBack - before) < 60 };

console.log(JSON.stringify({ engine, ...out }, null, 1));
await b.close();

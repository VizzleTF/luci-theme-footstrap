/* SPA nuances a full load gets for free, batch 1:
 *   A. Back/Forward scroll restoration in the TOP layout, where the DOCUMENT is the scroller and the
 *      router deliberately leaves the restore to the browser (fs-router.js §_scrollMem comment).
 *      The swap empties #view, so the document height collapses right after the traversal — the same
 *      argument that broke #maincontent restoration in the sidebar layout.
 *   B. history entry integrity: N SPA clicks must cost exactly N Back presses.
 *   C. #tabmenu links (a third-level page is a TAB, not a sidebar item) navigate by SPA and leave a
 *      correct strip behind.
 *   D. <title> host prefix: navigate() re-derives it from the live title on every hop.
 */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const BASE = `http://localhost:${PORTS[router]}`;
const U = (p) => '/cgi-bin/luci/' + p;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
await login(p, BASE);

const setLayout = async (v) => {
  await p.evaluate((l) => localStorage.setItem('fs-layout', l), v);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1800);
};

/* click a sidebar/topmenu link; returns false if there was no such link (=> not an SPA hop) */
const click = async (path) => {
  await p.evaluate(() => { window.__s = 1; });
  const ok = await p.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (!a) return false;
    a.click(); return true;
  }, U(path));
  if (!ok) return { clicked: false, spa: false };
  await p.waitForTimeout(2200);
  return { clicked: true, spa: await p.evaluate(() => window.__s === 1) };
};

const state = () => p.evaluate(() => ({
  path: location.pathname,
  page: document.body.getAttribute('data-page'),
  title: document.title,
  win: Math.round(window.scrollY),
  main: Math.round(document.getElementById('maincontent')?.scrollTop ?? -1),
  docH: document.documentElement.scrollHeight,
  tabs: [...document.querySelectorAll('#tabmenu ul.tabs')].map((ul) =>
    [...ul.children].map((li) => li.className.replace('tabmenu-item-', '')).join(',')),
  viewKids: document.getElementById('view')?.children.length ?? null
}));

const out = { router, A: {}, B: {}, C: {}, D: {} };

/* ---- A. scroll restoration, both layouts ---- */
for (const layout of ['top', 'sidebar']) {
  await setLayout(layout);
  await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const scroller = layout === 'top' ? 'window' : 'main';
  const before = await p.evaluate(() => {
    const sc = document.getElementById('maincontent');
    const docScrolls = document.documentElement.scrollHeight - window.innerHeight > 300;
    if (docScrolls) window.scrollTo(0, 400); else if (sc) sc.scrollTop = 400;
    return { docScrolls, win: Math.round(window.scrollY), main: Math.round(sc?.scrollTop ?? -1),
             h: document.documentElement.scrollHeight, mh: sc?.scrollHeight ?? -1 };
  });
  const hop = await click('admin/system/system');
  await p.goBack();
  await p.waitForTimeout(3000);
  const back = await state();
  /* and forward again */
  await p.goForward();
  await p.waitForTimeout(2000);
  await p.goBack();
  await p.waitForTimeout(3000);
  const back2 = await state();
  out.A[layout] = { scroller, before, hop, back: { win: back.win, main: back.main, page: back.page },
                    back2: { win: back2.win, main: back2.main } };
}

/* ---- B. history depth ---- */
await setLayout('sidebar');
await p.goto(BASE + U('admin/status/overview'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const chain = ['admin/system/system', 'admin/network/routes', 'admin/status/processes', 'admin/system/admin'];
const hops = [];
for (const c of chain) hops.push({ c, ...(await click(c)) });
const backs = [];
for (let i = 0; i < chain.length; i++) {
  await p.goBack();
  await p.waitForTimeout(1600);
  const s = await state();
  backs.push(s.path);
}
out.B = { hops, backs, landedOnStart: backs[backs.length - 1].endsWith('admin/status/overview') };

/* ---- C. tab strip ---- */
await p.goto(BASE + U('admin/system/system'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const beforeTabs = await state();
const tabHop = await p.evaluate(() => {
  window.__s = 1;
  const a = document.querySelector('#tabmenu ul.tabs li:not(.active) a');
  if (!a) return null;
  const href = a.getAttribute('href');
  a.click();
  return href;
});
await p.waitForTimeout(2500);
const afterTabs = await state();
const spaTab = await p.evaluate(() => window.__s === 1);
/* leave the app entirely: the strip must not survive onto a page with no tabs */
const away = await click('admin/status/processes');
const afterAway = await state();
out.C = { beforeTabs: beforeTabs.tabs, tabHop, spaTab,
          afterTabs: { tabs: afterTabs.tabs, page: afterTabs.page, path: afterTabs.path },
          away, afterAway: { tabs: afterAway.tabs, page: afterAway.page } };

/* ---- D. title host prefix over many hops, and after a view renames the document ---- */
await p.goto(BASE + U('admin/status/overview'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const t0 = (await state()).title;
const titles = [];
for (const c of ['admin/system/system', 'admin/network/routes', 'admin/system/system']) {
  await click(c);
  titles.push((await state()).title);
}
/* now a page that renames the tab, as several third-party apps do (log viewers, dashboards) */
await p.evaluate(() => { document.title = 'ACME Dashboard'; });
const afterRename = [];
for (const c of ['admin/network/routes', 'admin/system/system']) {
  await click(c);
  afterRename.push((await state()).title);
}
out.D = { t0, titles, afterRename };

console.log(JSON.stringify(out, null, 1));
await b.close();

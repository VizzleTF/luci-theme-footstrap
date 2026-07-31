/* SPA nuances, batch 3 — chrome that is OPEN when the navigation happens, and view-owned widgets
 * that a full load initialises but an SPA arrival may not.
 *   I. a view's OWN tab strip (.cbi-tabmenu, System → General/Logging/Time) after an SPA arrival:
 *      does clicking an internal tab still switch panes?
 *   J. the search palette: Enter navigates — does the overlay close, does focus land somewhere sane,
 *      and does the body keep any scroll lock?
 *   K. the Appearance popover left open across a navigation.
 *   L. the phone bar (390px): a section dropdown open, then a page tap — the panel must not survive.
 *   M. a modal opened by a view, then Back.
 */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const BASE = `http://localhost:${PORTS[router]}`;
const U = (p) => '/cgi-bin/luci/' + p;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).split('\n')[0].slice(0, 120)));
await login(p, BASE);

const out = { router, I: {}, J: {}, K: {}, L: {}, M: {} };
const spa = () => p.evaluate(() => window.__s === 1);
const mark = () => p.evaluate(() => { window.__s = 1; });

const clickHref = async (path) => {
  await mark();
  const ok = await p.evaluate((h) => { const a = document.querySelector(`a[href="${h}"]`); if (!a) return false; a.click(); return true; }, U(path));
  if (!ok) {
    await p.evaluate((h) => { const a = document.createElement('a'); a.href = h; document.getElementById('view').appendChild(a); a.click(); }, U(path));
  }
  await p.waitForTimeout(2400);
  return { spa: await spa() };
};

/* ---- I. a view's own tab strip after an SPA arrival ---- */
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2400);
await clickHref('admin/system/system');
const tabState = async () => p.evaluate(() => {
  const strip = document.querySelector('#view .cbi-tabmenu');
  const panes = [...document.querySelectorAll('#view .cbi-tabcontainer')];
  return {
    strip: strip ? [...strip.children].map((li) => (li.classList.contains('cbi-tab') ? '*' : '') + li.textContent.trim()).join('|') : null,
    visible: panes.filter((x) => x.getClientRects().length).map((x) => x.getAttribute('data-tab')).join(','),
    panes: panes.length
  };
});
const tBefore = await tabState();
const tClicked = await p.evaluate(() => {
  const li = [...document.querySelectorAll('#view .cbi-tabmenu > li')].find((x) => !x.classList.contains('cbi-tab'));
  if (!li) return null;
  const a = li.querySelector('a') || li;
  a.click();
  return li.textContent.trim();
});
await p.waitForTimeout(900);
const tAfter = await tabState();
out.I = { tBefore, tClicked, tAfter, switched: tBefore.visible !== tAfter.visible };

/* ---- J. search palette ---- */
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2400);
await p.keyboard.press('Control+k');
await p.waitForTimeout(500);
const palOpen = await p.evaluate(() => !!document.getElementById('fs-search-ov'));
await p.keyboard.type('routes');
await p.waitForTimeout(600);
await mark();
await p.keyboard.press('Enter');
await p.waitForTimeout(2600);
out.J = {
  palOpen,
  spa: await spa(),
  after: await p.evaluate(() => ({
    path: location.pathname,
    ovPresent: !!document.getElementById('fs-search-ov'),
    ovVisible: !!document.getElementById('fs-search-ov')?.getClientRects().length,
    bodyClass: document.body.className,
    bodyOverflow: getComputedStyle(document.body).overflow,
    active: document.activeElement ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) : null
  }))
};

/* ---- K. Appearance popover open across a navigation ---- */
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2400);
const appOpened = await p.evaluate(() => {
  const b = document.getElementById('fs-appearance');
  if (b) { b.click(); return b.id || b.className; }
  return null;
});
await p.waitForTimeout(600);
const popSel = '.fs-pop, .fs-appearance-pop, [role="dialog"]';
const popBefore = await p.evaluate((s) => document.querySelectorAll(s).length
  + '/' + [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, popSel);
const kHop = await clickHref('admin/system/system');
const popAfter = await p.evaluate((s) => document.querySelectorAll(s).length
  + '/' + [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length, popSel);
out.K = { appOpened, popBefore, kHop, popAfter };

/* ---- L. phone bar: a section dropdown open, then a page tap ---- */
await p.setViewportSize({ width: 390, height: 780 });
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2600);
const opened = await p.evaluate(() => {
  const a = document.querySelector('#topmenu > li > a');
  if (!a) return null;
  a.click();
  return { txt: a.textContent.trim(), open: document.querySelectorAll('#topmenu > li.open').length };
});
await p.waitForTimeout(500);
const openBefore = await p.evaluate(() => document.querySelectorAll('#topmenu > li.open').length);
const target = await p.evaluate(() => {
  const a = document.querySelector('#topmenu > li.open a[href*="/cgi-bin/luci/admin/"][href$="system"], #topmenu > li.open ul a[href]');
  return a ? a.getAttribute('href') : null;
});
await mark();
if (target) await p.evaluate((h) => document.querySelector(`#topmenu li.open a[href="${h}"]`)?.click(), target);
await p.waitForTimeout(2600);
out.L = { opened, openBefore, target, spa: await spa(),
  after: await p.evaluate(() => ({
    path: location.pathname,
    open: document.querySelectorAll('#topmenu > li.open').length,
    expanded: document.querySelectorAll('#topmenu > li > a[aria-expanded="true"]').length,
    scrollLock: getComputedStyle(document.body).overflow,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  })) };

/* ---- M. a modal open, then Back ---- */
await p.setViewportSize({ width: 1500, height: 900 });
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2400);
await clickHref('admin/system/system');
await p.evaluate(() => L.ui.showModal('probe', [ E('p', {}, 'modal body') ]));
await p.waitForTimeout(400);
const mBefore = await p.evaluate(() => ({
  modal: document.querySelectorAll('body > .modal, #modal_overlay .modal').length,
  overlayActive: document.getElementById('modal_overlay')?.classList.contains('active') ?? null,
  bodyClass: document.body.className
}));
await p.goBack();
await p.waitForTimeout(2600);
const mAfter = await p.evaluate(() => ({
  path: location.pathname,
  modal: document.querySelectorAll('body > .modal, #modal_overlay .modal').length,
  overlayActive: document.getElementById('modal_overlay')?.classList.contains('active') ?? null,
  bodyClass: document.body.className,
  overflow: getComputedStyle(document.body).overflow
}));
out.M = { mBefore, mAfter };

out.errs = [...new Set(errs)].slice(0, 8);
console.log(JSON.stringify(out, null, 1));
await b.close();

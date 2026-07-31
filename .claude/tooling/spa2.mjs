/* SPA nuances, batch 2 — the ones a full load answers by construction:
 *   E. menu-level tabs (#tabmenu): navigate BY tab, and leave the app; the strip must follow.
 *   F. F5 on a URL reached by SPA hops, and a deep link straight to a tab.
 *   G. a rapid click storm, then a rapid Back storm: URL, <body data-page>, the menu highlight and
 *      the rendered view must all agree afterwards, with one poller set and no duplicate content.
 *   H. the session dying mid-SPA: a full load lands on the login form; what does a click do?
 */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const BASE = `http://localhost:${PORTS[router]}`;
const U = (p) => '/cgi-bin/luci/' + p;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
await login(p, BASE);

const state = () => p.evaluate(() => ({
  path: location.pathname,
  page: document.body.getAttribute('data-page'),
  title: document.title,
  dispatch: (L.env.dispatchpath || []).join('/'),
  tabs: [...document.querySelectorAll('#tabmenu ul.tabs')].map((ul) => ({
    items: [...ul.children].map((li) => li.className.replace(/tabmenu-item-/, '')).join(' '),
    active: [...ul.children].filter((li) => li.classList.contains('active'))
      .map((li) => li.textContent.trim()).join(',')
  })),
  current: [...document.querySelectorAll('#topmenu a[aria-current="page"], .fs-sidebar a[aria-current="page"]')]
    .map((a) => a.getAttribute('href')),
  viewKids: document.getElementById('view')?.children.length ?? null,
  forms: document.querySelectorAll('#view form').length,
  poll: L.Poll?.queue?.length ?? null,
  ivals: window.__fsViewIntervals?.size ?? null,
  h1: [...document.querySelectorAll('#view h2, #view h3')].slice(0, 2).map((h) => h.textContent.trim())
}));

const click = async (sel) => {
  await p.evaluate(() => { window.__s = 1; });
  const ok = await p.evaluate((s) => { const a = document.querySelector(s); if (!a) return false; a.click(); return true; }, sel);
  if (!ok) return { clicked: false };
  await p.waitForTimeout(2200);
  return { clicked: true, spa: await p.evaluate(() => window.__s === 1) };
};

const out = { router, E: {}, F: {}, G: {}, H: {} };

/* ---- E. find a page whose menu really produces a #tabmenu, then walk it by tab ---- */
const CANDIDATES = ['admin/services/banip', 'admin/network/firewall', 'admin/services/adblock',
                    'admin/system/admin', 'admin/services/ssclash', 'admin/status/nlbwmon'];
let tabbed = null;
for (const c of CANDIDATES) {
  await p.goto(BASE + U(c), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const s = await state();
  if (s.tabs.length && s.tabs[0].items.split(' ').length > 1) { tabbed = { path: c, s }; break; }
}
if (tabbed) {
  const first = await state();
  const hop = await click('#tabmenu ul.tabs li:not(.active) a');
  const afterTab = await state();
  /* second hop, back to the first tab */
  const hop2 = await click('#tabmenu ul.tabs li:not(.active) a');
  const afterTab2 = await state();
  /* leave the app for a page with no tabs at all */
  const away = await click(`a[href="${U('admin/status/processes')}"]`);
  const afterAway = await state();
  out.E = { app: tabbed.path, first: first.tabs, hop, afterTab: { tabs: afterTab.tabs, page: afterTab.page, path: afterTab.path, kids: afterTab.viewKids },
            hop2, afterTab2: { tabs: afterTab2.tabs, page: afterTab2.page }, away,
            afterAway: { tabs: afterAway.tabs, page: afterAway.page } };
} else out.E = { app: null, note: 'no candidate produced a #tabmenu' };

/* ---- F. F5 after SPA hops, and a deep link straight to a tab ---- */
await p.goto(BASE + U('admin/status/overview'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
for (const c of ['admin/system/system', 'admin/network/routes'])
  await click(`a[href="${U(c)}"]`);
const beforeF5 = await state();
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2800);
const afterF5 = await state();
const deep = tabbed ? (out.E.afterTab?.path || null) : null;
let deepState = null;
if (deep) {
  await p.goto(BASE + deep, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2800);
  deepState = await state();
}
out.F = { beforeF5: { path: beforeF5.path, page: beforeF5.page, title: beforeF5.title },
          afterF5: { path: afterF5.path, page: afterF5.page, title: afterF5.title, kids: afterF5.viewKids },
          deep, deepState: deepState && { page: deepState.page, tabs: deepState.tabs, kids: deepState.viewKids } };

/* ---- G. click storm, then Back storm ---- */
await p.goto(BASE + U('admin/status/overview'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const STORM = ['admin/system/system', 'admin/network/routes', 'admin/status/processes',
               'admin/system/admin', 'admin/network/dhcp', 'admin/system/mounts'];
const warn = [];
p.on('console', (m) => { if (m.type() === 'warning' && /footstrap/.test(m.text())) warn.push(m.text().slice(0, 120)); });
for (let i = 0; i < STORM.length; i++) {
  await p.evaluate((h) => { const a = document.querySelector(`a[href="${h}"]`); if (a) a.click(); }, U(STORM[i]));
  await p.waitForTimeout(60 + (i % 3) * 90);   /* 60-240 ms: mid-require, deliberately */
}
await p.waitForTimeout(4000);
const afterStorm = await state();
for (let i = 0; i < 4; i++) { await p.goBack(); await p.waitForTimeout(120); }
await p.waitForTimeout(4000);
const afterBackStorm = await state();
out.G = { afterStorm, afterBackStorm, warn, errs: errs.slice(-6) };

/* ---- H. session expiry mid-SPA ---- */
await p.goto(BASE + U('admin/status/overview'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
await p.context().clearCookies();
const dead = await click(`a[href="${U('admin/system/system')}"]`);
await p.waitForTimeout(3000);
const afterDead = await p.evaluate(() => ({
  path: location.pathname,
  modal: document.querySelector('.modal, #modal_overlay.active')?.textContent?.trim().slice(0, 120) ?? null,
  loginForm: !!document.querySelector('input[name="luci_password"]'),
  viewText: (document.getElementById('view')?.textContent || '').trim().slice(0, 120)
}));
out.H = { dead, afterDead };

console.log(JSON.stringify(out, null, 1));
await b.close();

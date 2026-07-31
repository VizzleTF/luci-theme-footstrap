/* Verify the popover/palette close-on-traversal fix, and drive the phone bar by what the DOM
 * actually is rather than by a guessed selector. */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const U = (p) => '/cgi-bin/luci/' + p;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await login(p, BASE);
const out = {};

const dump = () => p.evaluate(() => ({
  pop: (() => { const e = document.getElementById('fs-appearance-pop');
                return e ? { hidden: e.hidden, vis: !!e.getClientRects().length,
                             exp: document.getElementById('fs-appearance')?.getAttribute('aria-expanded') } : null; })(),
  ov: (() => { const e = document.getElementById('fs-search-ov');
               return e ? { hidden: e.hidden, vis: !!e.getClientRects().length,
                            exp: document.getElementById('fs-search-btn')?.getAttribute('aria-expanded') } : null; })(),
  active: document.activeElement ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) : null,
  path: location.pathname
}));

const hop = async (path) => {
  await p.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (a) return a.click();
    const s = document.createElement('a'); s.href = h; document.getElementById('view').appendChild(s); s.click();
  }, U(path));
  await p.waitForTimeout(2400);
};

/* --- Appearance popover across Back and Forward --- */
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2400);
await hop('admin/system/system');
await p.evaluate(() => document.getElementById('fs-appearance').click());
await p.waitForTimeout(500);
out.popOpen = await dump();
await p.goBack();
await p.waitForTimeout(2400);
out.popAfterBack = await dump();
await p.evaluate(() => document.getElementById('fs-appearance').click());
await p.waitForTimeout(500);
await p.goForward();
await p.waitForTimeout(2400);
out.popAfterForward = await dump();
/* it must still OPEN afterwards */
await p.evaluate(() => document.getElementById('fs-appearance').click());
await p.waitForTimeout(500);
out.popReopen = await dump();
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
out.popEscape = await dump();

/* --- search palette across Back --- */
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2400);
await hop('admin/system/system');
await p.keyboard.press('Control+k');
await p.waitForTimeout(500);
out.ovOpen = await dump();
await p.goBack();
await p.waitForTimeout(2400);
out.ovAfterBack = await dump();
/* still usable: open, type, Enter */
await p.keyboard.press('Control+k');
await p.waitForTimeout(400);
await p.keyboard.type('routes');
await p.waitForTimeout(500);
await p.keyboard.press('Enter');
await p.waitForTimeout(2500);
out.ovAfterPick = await dump();

/* --- the phone bar, described rather than guessed --- */
await p.setViewportSize({ width: 390, height: 780 });
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2800);
out.bar = await p.evaluate(() => ({
  narrow: document.documentElement.hasAttribute('data-narrow'),
  layout: document.documentElement.getAttribute('data-layout'),
  topmenuItems: [...document.querySelectorAll('#topmenu > li')].map((li) => ({
    t: li.textContent.trim().slice(0, 14),
    sub: li.querySelectorAll('ul a[href]').length,
    href: li.querySelector(':scope > a')?.getAttribute('href') || null
  })),
  sidebarItems: document.querySelectorAll('.fs-sidebar > ul.nav > li').length
}));
const secIdx = (out.bar.topmenuItems || []).findIndex((x) => x.sub > 0);
if (secIdx >= 0) {
  const opened = await p.evaluate((i) => {
    const li = document.querySelectorAll('#topmenu > li')[i];
    const a = li.querySelector(':scope > a');
    a.click();
    return { open: li.classList.contains('open'), exp: a.getAttribute('aria-expanded'),
             href: li.querySelector('ul a[href]')?.getAttribute('href') };
  }, secIdx);
  await p.waitForTimeout(600);
  const openCount = await p.evaluate(() => document.querySelectorAll('#topmenu > li.open').length);
  await p.evaluate(() => { window.__s = 1; });
  if (opened.href)
    await p.evaluate((h) => document.querySelector(`#topmenu li.open a[href="${h}"]`)?.click(), opened.href);
  await p.waitForTimeout(2600);
  out.phone = { opened, openCount, spa: await p.evaluate(() => window.__s === 1),
    after: await p.evaluate(() => ({
      path: location.pathname,
      open: document.querySelectorAll('#topmenu > li.open').length,
      exp: document.querySelectorAll('#topmenu > li > a[aria-expanded="true"]').length,
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: getComputedStyle(document.body).overflow
    })) };
  /* and the same section opened, then BACK */
  await p.evaluate((i) => document.querySelectorAll('#topmenu > li')[i].querySelector(':scope > a').click(), secIdx);
  await p.waitForTimeout(500);
  const beforeBack = await p.evaluate(() => document.querySelectorAll('#topmenu > li.open').length);
  await p.goBack();
  await p.waitForTimeout(2500);
  out.phoneBack = { beforeBack, after: await p.evaluate(() => ({
    path: location.pathname, open: document.querySelectorAll('#topmenu > li.open').length })) };
}

console.log(JSON.stringify(out, null, 1));
await b.close();

/* Batch 3, redone where the selectors missed:
 *   I'. a view's OWN tabs after an SPA arrival — measured by which FIELDS are on screen, not by a
 *       pane class that page may not use.
 *   K'. what is still visible after navigating with the Appearance popover open.
 *   L'. the phone bar: open a section that actually HAS a submenu, then tap a page inside it.
 */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const U = (p) => '/cgi-bin/luci/' + p;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await login(p, BASE);
const out = {};

const clickHref = async (path) => {
  await p.evaluate(() => { window.__s = 1; });
  await p.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (a) return a.click();
    const s = document.createElement('a'); s.href = h; document.getElementById('view').appendChild(s); s.click();
  }, U(path));
  await p.waitForTimeout(2400);
  return p.evaluate(() => window.__s === 1);
};

/* fields actually on screen, as a fingerprint of which tab pane is showing */
const fields = () => p.evaluate(() => {
  const vis = [...document.querySelectorAll('#view .cbi-value-title, #view label')]
    .filter((el) => el.getClientRects().length).map((el) => el.textContent.trim()).slice(0, 12);
  return { n: vis.length, sample: vis.slice(0, 5) };
});

/* ---- I'. view-owned tabs, SPA arrival vs full load ---- */
const tabRun = async (spaArrival) => {
  if (spaArrival) {
    await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2400);
    await clickHref('admin/system/system');
  } else {
    await p.goto(BASE + U('admin/system/system'), { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2800);
  }
  const before = await fields();
  const clicked = await p.evaluate(() => {
    const li = [...document.querySelectorAll('#view .cbi-tabmenu > li')].find((x) => !x.classList.contains('cbi-tab'));
    if (!li) return null;
    (li.querySelector('a') || li).click();
    return li.textContent.trim();
  });
  await p.waitForTimeout(900);
  const after = await fields();
  return { clicked, before, after, switched: JSON.stringify(before.sample) !== JSON.stringify(after.sample) };
};
out.I_full = await tabRun(false);
out.I_spa = await tabRun(true);

/* ---- K'. the Appearance popover across a navigation ---- */
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2400);
await p.evaluate(() => document.getElementById('fs-appearance')?.click());
await p.waitForTimeout(600);
const popDump = () => p.evaluate(() => [...document.querySelectorAll('.fs-pop, .fs-appearance-pop, [role="dialog"], .fs-search-ov')]
  .map((e) => ({ id: e.id, cls: e.className, vis: !!e.getClientRects().length, hidden: e.hidden,
                 expanded: document.getElementById('fs-appearance')?.getAttribute('aria-expanded') })));
out.K_before = await popDump();
out.K_spa = await clickHref('admin/system/system');
out.K_after = await popDump();
/* the same thing on the way BACK, which takes the popstate path */
await p.evaluate(() => document.getElementById('fs-appearance')?.click());
await p.waitForTimeout(500);
await p.goBack();
await p.waitForTimeout(2400);
out.K_afterBack = await popDump();

/* ---- L'. phone bar section dropdown ---- */
await p.setViewportSize({ width: 390, height: 780 });
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2800);
const sect = await p.evaluate(() => {
  const li = [...document.querySelectorAll('#topmenu > li')].find((x) => x.querySelector('ul a[href]'));
  if (!li) return null;
  (li.querySelector(':scope > a') || li).click();
  return { name: li.textContent.trim().slice(0, 20),
           open: li.classList.contains('open'),
           href: li.querySelector('ul a[href]')?.getAttribute('href') };
});
await p.waitForTimeout(600);
const openedCount = await p.evaluate(() => document.querySelectorAll('#topmenu > li.open').length);
let lSpa = null;
if (sect?.href) {
  await p.evaluate(() => { window.__s = 1; });
  await p.evaluate((h) => document.querySelector(`#topmenu li.open a[href="${h}"]`)?.click(), sect.href);
  await p.waitForTimeout(2600);
  lSpa = await p.evaluate(() => window.__s === 1);
}
out.L = { sect, openedCount, lSpa, after: await p.evaluate(() => ({
  path: location.pathname,
  open: document.querySelectorAll('#topmenu > li.open').length,
  expanded: document.querySelectorAll('#topmenu > li > a[aria-expanded="true"]').length,
  hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
})) };

console.log(JSON.stringify(out, null, 1));
await b.close();

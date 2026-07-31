/* Does visiting a page that injects an invasive <link> turn the SPA router off?
 *
 * banIP's view/banip/feeds.js appends <link href=.../view/banip/custom.css> to <head> at MODULE
 * EVAL, and that sheet is `.cbi-input-text{width:90%!important}` — a stock widget class, unpinned,
 * so fs-sheets judges it invasive, re-hosts it as a fenced @import shim and silences the original.
 *
 * The measurement is the user-facing one: set a sentinel on `window`, click a menu link, read the
 * sentinel back. It survives a client-side navigation and dies with a full page load. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:8025';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const log = [];
p.on('console', (m) => { const t = m.text(); if (/footstrap|Unhandled|error/i.test(t)) log.push(t); });

await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
if (await p.locator('input[name="luci_password"]').count()) {
  await p.fill('input[name="luci_username"]', 'root');
  await p.fill('input[name="luci_password"]', '');
  await Promise.all([ p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.click('input[type=submit]') ]);
}

const sheets = () => p.evaluate(() => {
  const out = { links: [], styles: 0, shims: 0 };
  for (const el of document.querySelectorAll('link[rel~="stylesheet"], style')) {
    if (el.tagName === 'LINK') {
      let sd = null; try { sd = el.sheet ? el.sheet.disabled : null; } catch (e) { sd = 'unreadable'; }
      out.links.push({ href: el.getAttribute('href'), elDisabled: el.disabled, sheetDisabled: sd,
                       layered: el.dataset.fsLayered === '1' });
    } else {
      out.styles++;
      if ((el.textContent || '').startsWith('@import')) out.shims++;
    }
  }
  return out;
});

/* 1. the banIP page that carries the injector */
await p.goto(BASE + '/cgi-bin/luci/admin/services/banip/feeds', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const after = await sheets();
const banip = after.links.filter((l) => /banip/.test(l.href || ''));

/* 2. sentinel, then a menu click to a plain `view` node */
await p.evaluate(() => { window.__fsSentinel = 'alive'; });
/* Clicked from INSIDE the page: the target sits in a folded sidebar section, and el.click() reaches
 * the router's document-level handler exactly as the search palette's Enter does (fs-search.js).
 * detail 0 and button 0, no modifiers — the same shape the handler filters on. */
const target = '/cgi-bin/luci/admin/system/system';
const how = await p.evaluate((t) => {
  const a = document.querySelector(`a[href="${t}"]`);
  if (!a) return 'no menu link for ' + t;
  a.click();
  return 'in-page click on the menu <a>';
}, target);
await p.waitForTimeout(3000);
const survived = await p.evaluate(() => window.__fsSentinel === 'alive');
const landed = await p.evaluate(() => location.pathname + ' | data-page=' + document.body.getAttribute('data-page'));

console.log(JSON.stringify({
  banipLinks: banip,
  importShims: after.shims,
  navigatedBy: how,
  landedOn: landed,
  sentinelSurvived: survived,
  verdict: survived ? 'SPA navigation (document not spent)' : 'FULL PAGE LOAD (document spent)',
  console: log.slice(0, 8)
}, null, 2));
await b.close();

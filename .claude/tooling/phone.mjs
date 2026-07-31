/* The phone bar (data-narrow): a section panel is a POPUP there. Open one, tap a page inside it, and
 * check the panel does not ride the SPA navigation — and the same across a Back. The section trigger
 * is the <li> whose own <a> is href="#" (a leaf like Dashboard is a real link). */
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const U = (p) => '/cgi-bin/luci/' + p;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 780 } });
await login(p, BASE);
await p.goto(BASE + U('admin/status/processes'), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2800);

const out = { narrow: await p.evaluate(() => document.documentElement.hasAttribute('data-narrow')) };

const openSection = () => p.evaluate(() => {
  const lis = [...document.querySelectorAll('#topmenu > li')];
  const li = lis.find((x) => x.querySelector(':scope > a')?.getAttribute('href') === '#');
  if (!li) return null;
  const a = li.querySelector(':scope > a');
  a.click();
  return { name: a.textContent.trim().slice(0, 14), open: li.classList.contains('open'),
           exp: a.getAttribute('aria-expanded'),
           href: li.querySelector('ul a[href^="/cgi-bin"]')?.getAttribute('href') || null };
});
const panels = () => p.evaluate(() => ({
  open: document.querySelectorAll('#topmenu > li.open').length,
  exp: document.querySelectorAll('#topmenu > li > a[aria-expanded="true"]').length,
  visiblePanels: [...document.querySelectorAll('#topmenu > li > ul')].filter((u) => u.getClientRects().length).length,
  path: location.pathname,
  hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
}));

out.opened = await openSection();
await p.waitForTimeout(600);
out.whileOpen = await panels();

await p.evaluate(() => { window.__s = 1; });
if (out.opened?.href)
  await p.evaluate((h) => document.querySelector(`#topmenu li.open a[href="${h}"]`)?.click(), out.opened.href);
await p.waitForTimeout(2600);
out.spa = await p.evaluate(() => window.__s === 1);
out.afterTap = await panels();

/* now open it again and traverse back */
out.opened2 = await openSection();
await p.waitForTimeout(600);
out.whileOpen2 = await panels();
await p.goBack();
await p.waitForTimeout(2600);
out.afterBack = await panels();

console.log(JSON.stringify(out, null, 1));
await b.close();

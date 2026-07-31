/* A menu node named `constructor` is a name any package may choose in its menu.d. iconSvg() looks
 * the section name up in the icon table, so a table with Object.prototype behind it answers that
 * name with a function — which then goes into the sidebar link's innerHTML. Read what the live
 * sidebar actually contains for that item. */
import { chromium } from 'playwright';
const BASE = process.env.FS_BASE || 'http://localhost:8025';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
if (await p.locator('input[name="luci_password"]').count()) {
  await p.fill('input[name="luci_username"]', 'root'); await p.fill('input[name="luci_password"]', '');
  await Promise.all([ p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.click('input[type=submit]') ]);
}
await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(() => {
  const li = [...document.querySelectorAll('#topmenu > li')].find((x) => x.dataset.name === 'constructor');
  if (!li) return { found: false, sections: [...document.querySelectorAll('#topmenu > li')].map((x) => x.dataset.name) };
  const a = li.querySelector(':scope > a');
  const html = a.innerHTML;
  return {
    found: true,
    label: a.querySelector('.fs-label')?.textContent,
    leaksNativeCode: /native code|\[object Object\]|function Object/.test(html),
    startsWithSvg: html.trimStart().startsWith('<svg'),
    iconHtml: html.slice(0, 130)
  };
}), null, 2));
await b.close();

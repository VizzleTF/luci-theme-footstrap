import { chromium } from '/Users/ivan/Documents/home/openwrt/theme/luci-theme-footstrap/node_modules/playwright/index.mjs';
const base = `http://localhost:${process.argv[2] || '8025'}/cgi-bin/luci`;
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 720, height: 900 } })).newPage();
await p.goto(base, { waitUntil: 'domcontentloaded' });
if (await p.$('input[name="luci_password"]')) { await p.fill('input[name="luci_username"]','root'); await Promise.all([p.waitForNavigation(),p.press('input[name="luci_password"]','Enter')]); }
await p.goto(base + '/admin/status/processes', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(() => {
  const t = document.querySelector('#view .table.fs-dt');
  const row = [...t.querySelectorAll('.tr')].find(r => !r.classList.contains('table-titles'));
  const cell = row.children[2], span = cell.firstElementChild;
  const dump = (el) => { const c = getComputedStyle(el); return { tag: el.tagName, cls: el.className,
    ow: c.overflowWrap, wb: c.wordBreak, ws: c.whiteSpace, hy: c.hyphens, lb: c.lineBreak, tw: c.textWrap }; };
  return { cell: dump(cell), span: dump(span), html: cell.innerHTML.slice(0, 120) };
}), null, 1));
await b.close();

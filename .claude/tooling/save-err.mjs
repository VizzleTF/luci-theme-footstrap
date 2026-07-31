import { chromium } from 'playwright';
const BASE = 'http://localhost:8025';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
if (await p.locator('input[name="luci_password"]').count()) {
  await p.fill('input[name="luci_username"]', 'root'); await p.fill('input[name="luci_password"]', '');
  await Promise.all([ p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.click('input[type=submit]') ]);
}
await p.waitForTimeout(2500);
await p.click('#fs-appearance'); await p.waitForTimeout(400);
await p.evaluate(() => [...document.querySelectorAll('.fs-ap-wall .fs-seg button')].find((b) => b.dataset.val === 'file').click());
await p.waitForTimeout(200);
await p.evaluate(() => [...document.querySelectorAll('.fs-appearance-pop button')].find((x) => /^Save as default$/.test(x.textContent.trim())).click());
await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(() => {
  const e = document.querySelector('.fs-appearance-pop .fs-ap-err');
  const s = [...document.querySelectorAll('.fs-appearance-pop button')].find((x) => /^Saved? as default$/.test(x.textContent.trim()));
  return { errHidden: e?.hidden, errText: e?.textContent, errTitle: e?.title,
           button: s ? { text: s.textContent.trim(), disabled: s.disabled } : null,
           sd: window.__fsSD };
}), null, 2));
await b.close();

/* The updater's check() reaches GitHub and ships in a package this repo does not own, so the theme
 * must not assume it resolves. With a stub whose check() rejects, nothing may reach the console and
 * the badge/button must stay hidden — "no answer" reads as "no update". */
import { chromium } from 'playwright';
const BASE = process.env.FS_BASE || 'http://localhost:8025';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().split('\n')[0]); });

await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
if (await p.locator('input[name="luci_password"]').count()) {
  await p.fill('input[name="luci_username"]', 'root'); await p.fill('input[name="luci_password"]', '');
  await Promise.all([ p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.click('input[type=submit]') ]);
}
await p.waitForTimeout(4000);          /* the updater is loaded at idle, then check() runs */
await p.click('#fs-appearance');
await p.waitForTimeout(1500);

const ui = await p.evaluate(() => ({
  updaterSeenByServer: window.__fsUpd,
  updatesRowPresent: [...document.querySelectorAll('.fs-ap-label')].some((l) => l.textContent.trim() === 'Updates'),
  badgeHidden: document.querySelector('.fs-ap-badge')?.hidden ?? null,
  updateBtnHidden: document.querySelector('.fs-ap-update')?.hidden ?? null,
  triggerFlagged: document.getElementById('fs-appearance').classList.contains('fs-has-update')
}));
const rejections = errs.filter((e) => /in promise|unhandled|stub: network/i.test(e));
console.log(JSON.stringify({ ...ui, rejections, otherErrors: errs.filter((e) => !rejections.includes(e)).slice(0, 3),
  verdict: rejections.length === 0 && ui.badgeHidden !== false ? 'PASS — rejection swallowed, no update UI' : 'FAIL' }, null, 2));
await b.close();

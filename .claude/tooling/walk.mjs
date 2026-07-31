/* Walk every page the dispatcher can render, then leave it, and report what the chrome looked like
 * and whether the document survived. The adversaries are the point: openclash/ssclash/justclash/
 * podkop/filemanager/banip/adblock/mwan3/3ginfo all put CSS into a document they do not own. */
import { chromium } from 'playwright';
import { login, PAGES, SNAP, navAndCheck, PORTS } from './lib.mjs';

const router = process.argv[2] || 'owrt2512';
const BASE = `http://localhost:${PORTS[router]}`;
const only = process.argv[3];               /* optional substring filter */

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push({ where: 'pageerror', text: e.message.split('\n')[0] }));
p.on('console', (m) => { if (m.type() === 'error') errs.push({ where: 'console', text: m.text().split('\n')[0] }); });

await login(p, BASE);
let pages = await p.evaluate(PAGES);
if (only) pages = pages.filter((x) => x.path.includes(only));
console.error(`# ${router}: ${pages.length} pages`);

const base = await p.evaluate(SNAP);          /* the chrome before any app has touched it */
const rows = [];
for (const pg of pages) {
  const href = '/cgi-bin/luci/' + pg.path;
  errs.length = 0;
  await p.goto(href, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(2200);
  const on = await p.evaluate(SNAP);
  /* leave it for a plain stock page and see whether the document survived */
  const away = await navAndCheck(p, '/cgi-bin/luci/admin/status/overview');
  rows.push({
    path: pg.path, type: pg.type,
    hOverflow: on.hOverflow,
    sidebarPad: on.sidebarPad === base.sidebarPad ? 'ok' : `CHANGED ${on.sidebarPad}`,
    menuItems: on.menuItems === base.menuItems ? 'ok' : `${on.menuItems} vs ${base.menuItems}`,
    brand: on.brandVisible ? 'ok' : 'HIDDEN',
    sheets: `${on.sheets.styles}s/${on.sheets.links}l/${on.sheets.shims}i/${on.sheets.disabledLinks}d`,
    leaving: away.clicked ? (away.spa ? 'SPA' : 'FULL LOAD') : 'no-link',
    errors: errs.length
  });
  process.stderr.write('.');
}
process.stderr.write('\n');
console.log(JSON.stringify({ router, baseline: base, rows }, null, 1));
await b.close();

/* Sweep viewport widths over pages of every shape and look for the things a width breaks: the
 * document scrolling sideways, an element wider than the column it sits in, the sidebar/bar
 * transition, and the tab strip. Third-party pages are included because their tables and widgets
 * are the ones with no width contract at all. */
import { chromium, firefox, webkit } from 'playwright';
import { login, PORTS } from './lib.mjs';

const ENGINES = { chromium, firefox, webkit };
const engineName = process.argv[3] || 'chromium';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const WIDTHS = [320, 360, 390, 480, 600, 768, 800, 900, 1024, 1280, 1440, 1857, 2560];
const PAGES = [
  ['overview',    'admin/status/overview'],
  ['processes',   'admin/status/processes'],
  ['fw/zones',    'admin/network/firewall/zones'],
  ['wireless',    'admin/network/wireless'],
  ['dhcp',        'admin/network/dhcp'],
  ['pkg-manager', 'admin/system/package-manager'],
  ['podkop',      'admin/services/podkop'],
  ['ssclash',     'admin/services/ssclash/config'],
  ['filemanager', 'admin/system/filemanager'],
  ['statistics',  'admin/statistics/graphs'],
  ['openclash',   'admin/services/openclash/config'],
  ['banip',       'admin/services/banip/overview'],
];

const CHECK = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const wide = [];
  /* every element sticking out past the viewport's right edge, deepest-first so the report names the
   * actual offender rather than each of its ancestors */
  for (const el of document.querySelectorAll('.fs-content *, .fs-sidebar *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1.5 || r.left < -1.5) {
      wide.push({ el, d: Math.round(Math.max(r.right - vw, -r.left)),
        sel: el.nodeName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '') });
    }
  }
  const main = document.getElementById('maincontent');
  return {
    vw,
    docOverflow: de.scrollWidth - de.clientWidth,
    mainOverflow: main ? main.scrollWidth - main.clientWidth : null,
    narrow: de.hasAttribute('data-narrow'),
    layout: de.getAttribute('data-layout'),
    barStack: !!document.querySelector('.fs-sidebar.fs-bar-stack'),
    actRow: !!document.querySelector('.fs-sidebar.fs-bar-actrow'),
    sidebarW: Math.round(document.querySelector('.fs-sidebar')?.getBoundingClientRect().width || 0),
    contentW: Math.round(document.querySelector('.fs-content')?.getBoundingClientRect().width || 0),
    tabsWrapped: (() => { const ul = document.querySelector('#tabmenu ul.tabs'); if (!ul) return null;
      const k = [...ul.children].filter((c) => c.getClientRects().length); if (k.length < 2) return false;
      return k[0].offsetTop !== k[k.length - 1].offsetTop; })(),
    worst: wide.sort((a, b) => b.d - a.d).slice(0, 3).map((w) => w.sel + ' +' + w.d)
  };
})()`;

const b = await ENGINES[engineName].launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await login(p, BASE);
const rows = [];
for (const [name, path] of PAGES) {
  await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(2600);
  for (const w of WIDTHS) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(450);
    rows.push({ page: name, w, ...(await p.evaluate(CHECK)) });
  }
  process.stderr.write('.');
}
process.stderr.write('\n');
console.log(JSON.stringify({ engine: engineName, rows }, null, 1));
await b.close();

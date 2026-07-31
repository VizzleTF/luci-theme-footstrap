/* Does the CONTENT COLUMN scroll sideways? Measured on #maincontent, which is the scroller in the
 * sidebar layout, and attributed to the widest element inside .fs-content. Off-screen furniture is
 * excluded by construction: a tooltip parked at +10000px and Ace's virtual text layer are not
 * overflow, they are how those widgets work. */
import { chromium, firefox, webkit } from 'playwright';
import { login, PORTS } from './lib.mjs';
const ENGINES = { chromium, firefox, webkit };
const engine = process.argv[3] || 'chromium';
const BASE = `http://localhost:${PORTS[process.argv[2] || 'owrt2512']}`;
const WIDTHS = [320, 360, 390, 480, 600, 768, 800, 900, 1000, 1100, 1200, 1280, 1366, 1440, 1600, 1857, 2560];
const PAGES = [
  ['fw/zones',    'admin/network/firewall/zones'],
  ['fw/forwards', 'admin/network/firewall/forwards'],
  ['dhcp',        'admin/network/dhcp'],
  ['wireless',    'admin/network/wireless'],
  ['processes',   'admin/status/processes'],
  ['pkg-manager', 'admin/system/package-manager'],
  ['overview',    'admin/status/overview'],
  ['podkop',      'admin/services/podkop'],
];

const CHECK = `(() => {
  const main = document.getElementById('maincontent');
  const content = document.querySelector('.fs-content');
  const de = document.documentElement;
  const box = content.getBoundingClientRect();
  const cs = getComputedStyle(content);
  const inner = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const offenders = [];
  for (const el of content.querySelectorAll('*')) {
    const c = getComputedStyle(el);
    if (c.visibility === 'hidden' || c.display === 'none' || c.position === 'fixed') continue;
    if (el.closest('.ace_editor, .cbi-tooltip, [aria-hidden="true"]')) continue;
    const need = el.scrollWidth;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const past = Math.round(r.right - (box.right - parseFloat(cs.paddingRight)));
    if (past > 1)
      offenders.push({ sel: el.nodeName.toLowerCase() + (el.id ? '#' + el.id : '') +
        (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''),
        past, w: Math.round(r.width), need: Math.round(need) });
  }
  offenders.sort((a, b) => b.past - a.past);
  return {
    contentInner: Math.round(inner),
    mainOverflow: main.scrollWidth - main.clientWidth,
    docOverflow: de.scrollWidth - de.clientWidth,
    narrow: de.hasAttribute('data-narrow'),
    stacked: document.querySelectorAll('.table.fs-stacked').length,
    dt: document.querySelectorAll('.table.fs-dt').length,
    cfgTables: document.querySelectorAll('.table.cbi-section-table').length,
    top: offenders.slice(0, 2)
  };
})()`;

const b = await ENGINES[engine].launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await login(p, BASE);
const rows = [];
for (const [name, path] of PAGES) {
  await p.goto(BASE + '/cgi-bin/luci/' + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(2800);
  for (const w of WIDTHS) {
    await p.setViewportSize({ width: w, height: 900 });
    /* let the fitters settle: they run on a rAF after the resize observer fires */
    await p.waitForTimeout(300);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.waitForTimeout(300);
    rows.push({ page: name, w, ...(await p.evaluate(CHECK)) });
  }
  process.stderr.write('.');
}
process.stderr.write('\n');
console.log(JSON.stringify({ engine, rows }, null, 1));
await b.close();

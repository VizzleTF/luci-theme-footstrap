/* What the chrome does in a language that is not English.
 *
 * Three failure modes to separate:
 *   - RTL (ar/he/fa): does anything set `dir`, and if not, what actually breaks?
 *   - long words (de) and dense scripts (ja): does the sidebar/tab/cluster fit escalation cope?
 *   - a language the theme ships no catalogue for: does the chrome inherit luci-base's strings?
 *
 * Run: node .claude/tooling/lang.mjs <router> [langs] — sets uci luci.main.lang over ssh between
 * passes and puts it back at the end.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { login, PORTS } from './lib.mjs';

const exec = promisify(execFile);
const router = process.argv[2] || 'owrt2512';
const LANGS = (process.argv[3] || 'en,de,ru,ja,he,ar,fa').split(',');
const BASE = `http://localhost:${PORTS[router]}`;
const U = (p) => '/cgi-bin/luci/' + p;
const WIDTHS = [1500, 1100, 900, 390];
const PAGES = ['admin/status/overview', 'admin/system/system', 'admin/network/firewall/zones',
               'admin/services/banip/overview'];

const owlab = async (...args) => (await exec(`${process.env.HOME}/go/bin/owlab`, args)).stdout;
const setLang = (l) => owlab('exec', router, '--', 'uci', 'set', `luci.main.lang=${l}`)
  .then(() => owlab('exec', router, '--', 'uci', 'commit', 'luci'));

const SNAP = `(() => {
  const de = document.documentElement, body = document.body;
  const over = [];
  for (const el of document.querySelectorAll('.fs-sidebar *, #tabmenu *, .fs-content *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.left > 20000) continue;
    if (r.right > de.clientWidth + 1 || r.left < -1)
      over.push((el.tagName + '.' + (el.className || '').toString().split(' ')[0]).slice(0, 40)
                + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  }
  const bar = document.querySelector('.fs-sidebar');
  return {
    dir: de.getAttribute('dir') || getComputedStyle(de).direction,
    bodyDir: getComputedStyle(body).direction,
    lang: de.getAttribute('lang'),
    hOverflow: de.scrollWidth - de.clientWidth,
    narrow: de.hasAttribute('data-narrow'),
    barClasses: bar ? bar.className : null,
    dense: [...document.querySelectorAll('.tabs, .cbi-tabmenu')].map((u) =>
      u.classList.contains('fs-dense2') ? 2 : u.classList.contains('fs-dense1') ? 1 : 0).join(','),
    menuWrapped: (() => { const m = document.getElementById('topmenu');
      if (!m || m.children.length < 2) return null;
      const k = [...m.children].filter((c) => c.getClientRects().length);
      return k.length ? (k[0].offsetTop !== k[k.length - 1].offsetTop) : null; })(),
    firstMenu: document.querySelector('#topmenu > li > a')?.textContent.trim().slice(0, 24) || null,
    appearance: document.getElementById('fs-appearance')?.textContent.trim().slice(0, 24) || null,
    over: over.slice(0, 6),
    overN: over.length
  };
})()`;

const b = await chromium.launch();
const out = { router, langs: {} };

for (const lang of LANGS) {
  await setLang(lang === 'en' ? 'auto' : lang);
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  await login(p, BASE);
  out.langs[lang] = {};
  for (const path of PAGES) {
    out.langs[lang][path] = {};
    for (const w of WIDTHS) {
      await p.setViewportSize({ width: w, height: 950 });
      await p.goto(BASE + U(path), { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2000);
      out.langs[lang][path][w] = await p.evaluate(SNAP);
    }
  }
  await p.close();
  process.stderr.write(lang + ' ');
}
process.stderr.write('\n');
await setLang('auto');
console.log(JSON.stringify(out, null, 1));
await b.close();

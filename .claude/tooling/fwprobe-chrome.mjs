/* H3 follow-up to fwprobe.mjs: a framework page under footstrap moved the chrome (Bootstrap 5:
 * 84/259 elements, font-size 12->16px). Footstrap side only, no theme switch. Per page
 * (none, and each framework): which chrome properties moved and how many rects; the cascade
 * winners (matched + inherited chain, with layers) of font-size/line-height/font-family on html,
 * body, the sidebar and a menu link; then a CSSOM proof on the winner found on body.
 *
 *   node .claude/tooling/fwprobe-chrome.mjs owrt2512 [bs,tw3,...]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PORTS } from './lib.mjs';

const stand = process.argv[2] || 'owrt2512';
const FWS = (process.argv[3] || 'bs,tw3,tw4,daisy').split(',');
const BASE = 'http://localhost:' + PORTS[stand];
const OUT = new URL('../../../../../../tmp/task-0051-splify2-hidden/fwprobe/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PROPS = ['font-size', 'line-height', 'font-family'];
const NODES = ['html', 'body', '.fs-sidebar', '#topmenu > li > a', '.fs-content'];

const CHROME = () => [...document.querySelectorAll('[data-fs-chrome], [data-fs-chrome] *, .fs-content, #maincontent')].map((e) => {
  const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
  return { tag: e.tagName.toLowerCase(), cls: (typeof e.className === 'string' ? e.className : '').slice(0, 50), rect: [b.x, b.y, b.width, b.height].map(Math.round),
    display: cs.display, padding: cs.padding, margin: cs.margin, fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontFamily: cs.fontFamily.slice(0, 30), boxSizing: cs.boxSizing, border: cs.borderTopWidth + ' ' + cs.borderTopStyle };
});

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
{
  const p = await ctx.newPage();
  await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
  if (await p.locator('input[name="luci_password"]').count()) {
    await p.fill('input[name="luci_username"]', 'root'); await p.fill('input[name="luci_password"]', '');
    await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.press('input[name="luci_password"]', 'Enter')]);
  }
  await p.waitForTimeout(1500); await p.close();
}
const report = { stand, when: new Date().toISOString(), pages: {} };
let none = null;
for (const fw of ['none', ...FWS]) {
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const sheets = new Map();
  cdp.on('CSS.styleSheetAdded', (e) => sheets.set(e.header.styleSheetId, (e.header.sourceURL || (e.header.isInline ? 'inline' : e.header.origin)).replace(BASE, '')));
  await p.goto(`${BASE}/cgi-bin/luci/admin/services/fwprobe-${fw}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction((fw) => { const r = document.getElementById('fwprobe-' + fw); return !!(r && r.querySelectorAll('[data-k]').length > 10); }, fw, { timeout: 30000 });
  if (fw !== 'none') await p.waitForFunction((fw) => {
    const s = [...document.querySelectorAll('style[data-fs-layered]')].find((x) => x.textContent.includes('fwprobe/' + fw));
    try { return !!(s && s.sheet.cssRules[0].styleSheet.cssRules.length); } catch (e) { return false; }
  }, fw, { timeout: 20000 });
  await p.waitForTimeout(2000);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); await p.waitForTimeout(300);
  const chrome = await p.evaluate(CHROME);
  const page = { fw };
  page.show = await p.evaluate((fw) => Object.fromEntries([...document.querySelectorAll(`#fwprobe-${fw} [data-k^="resp"], #fwprobe-${fw} [data-k="modal"]`)]
    .map((e) => [e.dataset.k, getComputedStyle(e).display + '/' + Math.round(e.getBoundingClientRect().width)])), fw);
  if (fw === 'none') none = chrome;
  else {
    const tally = {}; let moved = 0; const rectMoves = [];
    for (let i = 0; i < Math.min(none.length, chrome.length); i++) {
      const dk = Object.keys(chrome[i]).filter((k) => !['tag', 'cls'].includes(k) && JSON.stringify(chrome[i][k]) !== JSON.stringify(none[i][k]));
      if (!dk.length) continue;
      moved++; dk.forEach((k) => { tally[k] = (tally[k] || 0) + 1; });
      if (dk.includes('rect') && chrome[i].cls !== 'fs-content' && rectMoves.length < 12) rectMoves.push({ tag: chrome[i].tag, cls: chrome[i].cls, none: none[i].rect, app: chrome[i].rect });
    }
    page.moved = moved; page.of = none.length; page.tally = tally; page.rectMoves = rectMoves;
  }
  // winners on the nodes the chrome inherits from
  page.nodes = {};
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  for (const sel of NODES) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    if (!nodeId) continue;
    const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
    const rows = (list, via) => (list || []).filter((mr) => mr.rule.origin !== 'user-agent').flatMap((mr) => {
      const d = mr.rule.style.cssProperties.filter((x) => !x.disabled && (PROPS.includes(x.name) || x.name === 'font'));
      return d.length ? [{ via, sel: mr.rule.selectorList.text.replace(/\s+/g, ' ').slice(0, 110), sheet: (sheets.get(mr.rule.styleSheetId) || '?').split('?')[0],
        line: mr.rule.style.range ? mr.rule.style.range.startLine + 1 : null, layers: (mr.rule.layers || []).map((l) => l.text).join('.'), decl: [...new Set(d.map((x) => `${x.name}:${x.value}${x.important ? '!' : ''}`))].join('; ') }] : [];
    });
    const own = rows(m.matchedCSSRules, 'self');
    const inh = (m.inherited || []).flatMap((e, depth) => rows(e.matchedCSSRules, 'ancestor+' + (depth + 1)));
    const comp = await p.evaluate(({ sel, PROPS }) => { const e = document.querySelector(sel); const cs = getComputedStyle(e); return Object.fromEntries(PROPS.map((q) => [q, cs.getPropertyValue(q).slice(0, 40)])); }, { sel, PROPS });
    page.nodes[sel] = { computed: comp, self: own, inheritedChain: inh.slice(0, 12) };
  }
  report.pages[fw] = page;
  await p.close();
}
await b.close();
const file = OUT + 'chrome-' + FWS.join('_') + '.json';
writeFileSync(file, JSON.stringify(report, null, 1));
for (const [fw, pg] of Object.entries(report.pages)) {
  console.log(`\n== ${fw}` + (pg.moved != null ? ` moved ${pg.moved}/${pg.of} tally ${JSON.stringify(pg.tally)}` : ''));
  if (pg.rectMoves && pg.rectMoves.length) console.log('   rect moves e.g.', JSON.stringify(pg.rectMoves.slice(0, 5)));
  for (const sel of ['html', 'body', '.fs-sidebar']) {
    const n = pg.nodes[sel]; if (!n) continue;
    console.log(`   ${sel} ${JSON.stringify(n.computed)}`);
    for (const r of n.self) console.log(`     self  ${r.sheet}:${r.line} [${r.layers}] ${r.sel.slice(0, 70)} { ${r.decl.slice(0, 90)} }`);
  }
}
console.log('->', file);

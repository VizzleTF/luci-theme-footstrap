/* Issue #51: luci-app-splify2's page under this theme — the Rail `aside` (`hidden lg:flex`) stays
 * hidden, and the Home grid's right column is clipped off the right edge.
 *
 * Per viewport: was splify-index.css re-hosted; computed display of each `aside` and every CSS rule
 * (with its cascade layers, via CDP) that declares `display` on it; the `.grid` carrying
 * `xl:grid-cols-*` — its grid-template-columns, its width against #splify-root/.fs-content/#view,
 * scrollWidth vs clientWidth up the ancestor chain; the element sticking out furthest past the right
 * edge and the rules that size it. Then variant A applied in the CSSOM (cascade.css's `.hidden.hidden`
 * gets `:not([class*=":"])`, no repo file touched) and everything measured again.
 *
 *   node .claude/tooling/splify2.mjs owrt2512 [label]     # label names the artefacts (footstrap|bootstrap)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PORTS, login } from './lib.mjs';

const stand = process.argv[2] || 'owrt2512';
const label = process.argv[3] || 'footstrap';
const BASE = 'http://localhost:' + PORTS[stand];
const OUT = new URL('../../../../../../tmp/task-0051-splify2-hidden/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PROPS = ['display', 'width', 'min-width', 'max-width', 'grid-template-columns', 'flex', 'flex-shrink',
  'flex-basis', 'overflow', 'overflow-x', 'white-space', 'margin', 'margin-left', 'margin-right', 'padding',
  'inline-size', 'min-inline-size', 'box-sizing', 'contain', 'position', 'left', 'right', 'inset'];

const MEASURE = () => {
  const path = (el) => {
    if (!el) return null;
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = typeof el.className === 'string' ? el.className.trim() : '';
    if (c) s += '.' + c.split(/\s+/).slice(0, 8).join('.');
    return s;
  };
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
  const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
  const vw = document.documentElement.clientWidth;
  const out = { vw, theme: (document.querySelector('link[href*="cascade.css"]') ? 'footstrap' : 'other') };

  out.layered = [...document.querySelectorAll('style[data-fs-layered]')].map((s) => (s.textContent || '').slice(0, 160));
  out.splifyLinks = [...document.querySelectorAll('link[rel~=stylesheet]')].filter((l) => /splify/.test(l.href))
    .map((l) => ({ href: l.href.replace(location.origin, ''), disabled: l.disabled, media: l.media }));

  out.asides = [...document.querySelectorAll('#splify-root aside, aside')].map((a, i) => {
    a.setAttribute('data-probe', 'aside' + i);
    return { i, path: path(a), display: cs(a, 'display'), ...r(a) };
  });

  const grid = [...document.querySelectorAll('[class*="xl:grid-cols"]')][0];
  if (grid) {
    grid.setAttribute('data-probe', 'grid');
    out.grid = { path: path(grid), gtc: cs(grid, 'grid-template-columns'), display: cs(grid, 'display'), ...r(grid),
      children: [...grid.children].map((c, i) => { c.setAttribute('data-probe', 'gridkid' + i); return { i, path: path(c), ...r(c), minW: cs(c, 'min-width'), sw: c.scrollWidth, cw: c.clientWidth }; }) };
    const chain = [];
    for (let e = grid; e; e = e.parentElement)
      chain.push({ path: path(e), ...r(e), cw: e.clientWidth, sw: e.scrollWidth, ox: cs(e, 'overflow-x'), minW: cs(e, 'min-width'), w: cs(e, 'width') });
    out.chain = chain;
  }
  for (const [k, sel] of [['splifyRoot', '#splify-root'], ['fsContent', '.fs-content'], ['view', '#view'], ['maincontent', '#maincontent']]) {
    const e = document.querySelector(sel); out[k] = e ? { ...r(e), cw: e.clientWidth, sw: e.scrollWidth } : null;
  }

  // Deepest-and-furthest element past the right edge of the viewport (or of #splify-root's box).
  // `.sp-root` is overflow:hidden, so "clipped" means past ITS right edge, not the viewport's.
  const root = document.querySelector('#splify-root') || document.body;
  const clip = document.querySelector('.sp-root') || root;
  const rootR = Math.min(vw, clip.getBoundingClientRect().right);
  let worst = null;
  for (const e of root.querySelectorAll('*')) {
    if (!e.getClientRects().length) continue;
    const b = e.getBoundingClientRect();
    if (b.right > rootR + 1 && (!worst || b.right > worst.right + 0.5 || (Math.abs(b.right - worst.right) < 0.5 && e.contains && worst.el.contains(e)))) worst = { el: e, right: b.right };
  }
  if (worst) { worst.el.setAttribute('data-probe', 'worst'); out.worst = { path: path(worst.el), ...r(worst.el), minW: cs(worst.el, 'min-width'), w: cs(worst.el, 'width') }; }
  out.rootRight = Math.round(rootR);

  const btn = [...document.querySelectorAll('button, a')].find((b) => /Добавить правило|Add rule/i.test(b.textContent));
  if (btn) { btn.setAttribute('data-probe', 'addrule'); out.addRule = { path: path(btn), ...r(btn), visible: b2v(btn) }; }
  const outs = [...document.querySelectorAll('h1,h2,h3,h4,div,span')].find((h) => h.children.length === 0 && /^(Выходы|Outbounds|Outputs)$/.test(h.textContent.trim()));
  if (outs) out.outputsHeading = { path: path(outs), ...r(outs) };
  function b2v(el) { const b = el.getBoundingClientRect(); return b.right <= vw && b.width > 0; }
  out.docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.bodyOverflow = document.body.scrollWidth - document.body.clientWidth;
  return out;
};

async function cdpRules(cdp, probe) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-probe="${probe}"]` });
  if (!nodeId) return null;
  const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  const rows = [];
  for (const mr of m.matchedCSSRules || []) {
    const rule = mr.rule;
    const decl = rule.style.cssProperties.filter((p) => PROPS.includes(p.name) && !p.disabled && p.value !== undefined && (p.text || p.implicit === false || true));
    const uniq = [...new Map(decl.map((p) => [p.name + p.value, p])).values()].filter((p) => !p.implicit || p.name === 'display');
    if (!uniq.length) continue;
    rows.push({
      sel: rule.selectorList.text.slice(0, 140), origin: rule.origin,
      sheet: (sheets.get(rule.styleSheetId) || '').replace(BASE, ''),
      layers: (rule.layers || []).map((l) => l.text).join(' > '),
      media: (rule.media || []).map((x) => x.text).join(' | '),
      decl: uniq.map((p) => `${p.name}:${p.value}${p.important ? '!' : ''}`).join('; ')
    });
  }
  return rows;
}

// cascade.css's `.hidden.hidden` → `.hidden.hidden:not([class*=":"])`, found by walking the CSSOM.
const VARIANT_A = () => {
  const hits = [];
  const walk = (rules, where) => {
    for (const rule of rules) {
      if (rule.selectorText === '.hidden.hidden') { rule.selectorText = '.hidden.hidden:not([class*=":"])'; hits.push({ where, now: rule.selectorText }); }
      if (rule.cssRules) walk(rule.cssRules, where);
      if (rule.styleSheet) { try { walk(rule.styleSheet.cssRules, where + ' @import ' + rule.href); } catch (e) {} }
    }
  };
  for (const s of document.styleSheets) { try { walk(s.cssRules, s.href || (s.ownerNode && s.ownerNode.tagName)); } catch (e) {} }
  return hits;
};

const sheets = new Map();
const report = { stand, label, when: new Date().toISOString(), runs: [] };
const b = await chromium.launch();
for (const [W, H] of [[1920, 1080], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  /* Without steer the app renders its "engine not installed" gate (`r.build && !r.build.present`),
   * not Rail + Home. Answer `splify2.engine` as present in the browser only — nothing is installed. */
  await p.route('**/ubus/**', async (route) => {
    const req = route.request();
    let body; try { body = JSON.parse(req.postData() || 'null'); } catch (e) { body = null; }
    const calls = Array.isArray(body) ? body : body ? [body] : [];
    // DATA=1 also answers `status` with outputs, so the Home grid's right column ("Выходы") has content.
    const FAKE = { engine: { present: true, vless: true, enabled: true, running: true } };
    if (process.env.DATA === '1') FAKE.status = { ok: true, outputs: {
      direct: { kind: 'direct' },
      'wg-home-office-backup-tunnel': { kind: 'interface', iface: 'wg-home-office-backup-tunnel', up: true },
      awg0: { kind: 'interface', iface: 'awg0', up: false },
      'vless-reality-frankfurt-de-01': { kind: 'vless', up: true, latency_ms: 42 },
      'vless-nl-amsterdam-02': { kind: 'vless', up: true, latency_ms: 71 }
    }, warnings: [] };
    // The store reads Home's data from `live` (`t.status`), not from `status`.
    if (FAKE.status) FAKE.live = { ok: true, status: FAKE.status };
    const hit = (c) => c && c.params && c.params[1] === 'splify2' && FAKE[c.params[2]];
    if (!calls.some(hit)) return route.continue();
    const resp = await route.fetch();
    let json = await resp.json();
    const arr = Array.isArray(json) ? json : [json];
    for (const r of arr) {
      const c = calls.find((x) => x.id === r.id);
      if (hit(c)) r.result = [0, FAKE[c.params[2]]];
    }
    await route.fulfill({ response: resp, body: JSON.stringify(Array.isArray(json) ? arr : arr[0]) });
  });
  const cdp = await ctx.newCDPSession(p);
  cdp.on('CSS.styleSheetAdded', (e) => sheets.set(e.header.styleSheetId, e.header.sourceURL || (e.header.isInline ? 'inline' : e.header.origin)));
  // lib.mjs's login clicks `input[type=submit]`, which stock bootstrap's sysauth form does not have.
  if (label.startsWith('bootstrap')) {
    await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
    if (await p.locator('input[name="luci_password"]').count()) {
      await p.fill('input[name="luci_username"]', 'root');
      await p.fill('input[name="luci_password"]', '');
      await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.press('input[name="luci_password"]', 'Enter')]);
    }
    await p.waitForTimeout(2000);
  } else await login(p, BASE);
  await p.goto(BASE + '/cgi-bin/luci/admin/services/splify2', { waitUntil: 'domcontentloaded' });
  const ok = await p.waitForFunction(() => { const r = document.querySelector('#splify-root'); return r && r.querySelectorAll('*').length > 30; }, null, { timeout: 30000 }).then(() => true, () => false);
  await p.waitForTimeout(3000);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const run = { W, H, rendered: ok, errs };
  const tag = `${label}-${W}`;

  run.before = await p.evaluate(MEASURE);
  run.before.rules = {};
  for (const k of ['aside0', 'aside1', 'grid', 'gridkid0', 'gridkid1', 'worst', 'addrule']) run.before.rules[k] = await cdpRules(cdp, k);
  await p.screenshot({ path: OUT + `${tag}-before.png` });

  run.variantA = await p.evaluate(VARIANT_A);
  await p.waitForTimeout(800);
  run.after = await p.evaluate(MEASURE);
  run.after.rules = {};
  for (const k of ['aside0', 'grid', 'gridkid1', 'worst', 'addrule']) run.after.rules[k] = await cdpRules(cdp, k);
  await p.screenshot({ path: OUT + `${tag}-variantA.png` });
  report.runs.push(run);
  await ctx.close();
}
await b.close();
const file = OUT + `probe-${label}.json`;
writeFileSync(file, JSON.stringify(report, null, 1));
for (const run of report.runs) {
  const s = (m) => ({ asides: m.asides.map((a) => `${a.display}/${a.w}`).join(','), gtc: m.grid && m.grid.gtc, gridW: m.grid && m.grid.w,
    root: m.splifyRoot && m.splifyRoot.w, fs: m.fsContent && m.fsContent.w, worst: m.worst && `${m.worst.path.slice(0, 80)} r=${m.worst.r}`, addRule: m.addRule && `r=${m.addRule.r} vis=${m.addRule.visible}`, docOv: m.docOverflow, layered: m.layered.length });
  console.log(run.W, 'rendered', run.rendered, 'errs', run.errs.length, '\n before', JSON.stringify(s(run.before)), '\n variantA hits', run.variantA.length, '\n after ', JSON.stringify(s(run.after)));
}
console.log('->', file);

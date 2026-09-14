/* Issue #51 follow-up: which third-party CSS frameworks render differently inside a LuCI app view
 * under footstrap vs stock bootstrap, and which footstrap rule wins each difference.
 *
 * Needs the stub views from ../tmp/task-0051-splify2-hidden/fw/gen-views.mjs on the stand
 * (admin/services/fwprobe-{none,tw3,tw4,daisy,bs}). Per framework page at 1440x900, once under
 * bootstrap (theme switched with uci, footstrap restored on exit/signal) and once under footstrap:
 * whether the app sheet was re-hosted, its layer names (CSSOM), computed props of every [data-k]
 * fixture element, CDP matched rules for each. Diff, name the winner on both sides, and on the
 * footstrap side PROVE the footstrap winner by removing its declaration in the CSSOM and watching
 * the computed value move. Chrome snapshot of each framework page vs the no-app page.
 *
 *   node .claude/tooling/fwprobe.mjs owrt2512          # FWS=tw4,bs to narrow
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { PORTS } from './lib.mjs';

const stand = process.argv[2] || 'owrt2512';
const BASE = 'http://localhost:' + PORTS[stand];
const OUT = new URL('../../../../../../tmp/task-0051-splify2-hidden/fwprobe/', import.meta.url).pathname;
const STYLES = new URL('../../luci-theme-footstrap/styles/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const FWS = (process.env.FWS || 'tw3,tw4,daisy,bs').split(',');
const PAGES = ['none', ...FWS];
const W = 1440, H = 900;

const LAYOUT = ['display', 'position', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
const COSMETIC = ['font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border-top-width',
  'border-top-style', 'border-top-color', 'border-bottom-width', 'border-top-left-radius', 'visibility'];
const PROPS = [...LAYOUT, ...COSMETIC];
const INHERITED = new Set(['font-size', 'font-weight', 'line-height', 'color', 'visibility']);
const SHORT = { padding: 'padding-', margin: 'margin-', border: 'border-', 'border-top': 'border-top-',
  'border-bottom': 'border-bottom-', 'border-width': 'border-', 'border-style': 'border-', 'border-color': 'border-',
  'border-radius': 'border-', background: 'background-', font: 'font-', inset: '', 'padding-block': 'padding-',
  'padding-inline': 'padding-', 'margin-block': 'margin-', 'margin-inline': 'margin-', 'inline-size': 'width', 'block-size': 'height' };
const touches = (name, prop) => name === prop || (SHORT[name] !== undefined && (SHORT[name] === '' || prop.startsWith(SHORT[name]) || SHORT[name] === prop)) ||
  (name === 'padding-inline-start' && prop === 'padding-left') || (name === 'padding-inline-end' && prop === 'padding-right') ||
  (name === 'margin-inline-start' && prop === 'margin-left') || (name === 'margin-inline-end' && prop === 'margin-right') ||
  (name === 'padding-block-start' && prop === 'padding-top') || (name === 'padding-block-end' && prop === 'padding-bottom') ||
  (name === 'margin-block-start' && prop === 'margin-top') || (name === 'margin-block-end' && prop === 'margin-bottom');

/* ---- theme switch with a trap: footstrap is restored however this process ends ---- */
const owlab = (cmd) => execFileSync('owlab', ['exec', stand, '--', cmd], { encoding: 'utf8',
  env: { ...process.env, PATH: process.env.HOME + '/go/bin:' + process.env.PATH } });
let switched = false;
const setTheme = (t) => { owlab(`uci set luci.main.mediaurlbase=/luci-static/${t} && uci commit luci`); switched = t !== 'footstrap'; };
const restore = () => { if (switched) { try { setTheme('footstrap'); console.error('trap: footstrap restored'); } catch (e) { console.error('TRAP FAILED', e.message); } } };
process.on('exit', restore);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { restore(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); restore(); process.exit(1); });

/* ---- in-page measurement ---- */
const MEASURE = ({ fw, PROPS, side }) => {
  const out = { fw, side };
  const root = document.getElementById('fwprobe-' + fw);
  const href = (h) => (h || '').replace(location.origin, '');
  out.links = [...document.querySelectorAll('link[rel~=stylesheet]')].filter((l) => /fwprobe/.test(l.href))
    .map((l) => ({ href: href(l.href), disabled: l.disabled, layered: l.dataset.fsLayered || null, sheetOn: !!l.sheet }));
  out.shims = [...document.querySelectorAll('style[data-fs-layered]')].map((s) => (s.textContent || '').slice(0, 140));
  // layer names declared by the app's sheet, fully qualified as the cascade sees them
  const layers = new Set(); let appRules = 0, fenced = 0;
  const walk = (rules, prefix) => {
    for (const r of rules) {
      if (r instanceof CSSImportRule) { const p = r.layerName != null ? (prefix ? prefix + '.' : '') + r.layerName : prefix; if (r.layerName != null) layers.add(p); try { walk(r.styleSheet.cssRules, p); } catch (e) {} continue; }
      if (typeof CSSLayerStatementRule !== 'undefined' && r instanceof CSSLayerStatementRule) { r.nameList.forEach((n) => layers.add((prefix ? prefix + '.' : '') + n)); continue; }
      if (typeof CSSLayerBlockRule !== 'undefined' && r instanceof CSSLayerBlockRule) { const p = (prefix ? prefix + '.' : '') + (r.name || '<anon>'); layers.add(p); walk(r.cssRules, p); continue; }
      if (r.selectorText) { appRules++; if (/:where\(:not\(\[data-fs-chrome/.test(r.selectorText)) fenced++; }
      if (r.cssRules) walk(r.cssRules, prefix);
    }
  };
  for (const s of document.styleSheets) {
    const own = s.ownerNode;
    const isApp = /fwprobe/.test(s.href || '') || (own && own.dataset && own.dataset.fsLayered && /fwprobe/.test(own.textContent || ''));
    if (!isApp || (own && own.disabled) || s.disabled) continue;
    try { walk(s.cssRules, ''); } catch (e) {}
  }
  out.layers = [...layers]; out.appRules = appRules; out.fencedRules = fenced;
  const snap = (el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); const o = { rect: [b.x, b.y, b.width, b.height].map((v) => Math.round(v)) }; for (const p of PROPS) o[p] = cs.getPropertyValue(p); return o; };
  out.els = root ? [...root.querySelectorAll('[data-k]')].map((e) => ({ k: e.dataset.k, tag: e.tagName.toLowerCase(), cls: e.className, ...snap(e) })) : null;
  // chrome: every fenced chrome element (footstrap), or stock bootstrap's header/menu
  const chromeSel = document.querySelector('[data-fs-chrome]') ? '[data-fs-chrome], [data-fs-chrome] *, .fs-content, #maincontent' : 'header, header *, #mainmenu, #mainmenu *, #maincontent, .main';
  out.chrome = [...document.querySelectorAll(chromeSel)].map((e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect();
    return { tag: e.tagName.toLowerCase(), cls: (typeof e.className === 'string' ? e.className : '').slice(0, 60), rect: [b.x, b.y, b.width, b.height].map((v) => Math.round(v)),
      display: cs.display, padding: cs.padding, margin: cs.margin, fontSize: cs.fontSize, lineHeight: cs.lineHeight, boxSizing: cs.boxSizing, border: cs.borderTopWidth + ' ' + cs.borderTopStyle }; });
  out.docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.bodyFont = getComputedStyle(document.body).fontFamily.slice(0, 60) + ' / ' + getComputedStyle(document.body).fontSize + ' / ' + getComputedStyle(document.body).color;
  return out;
};

async function matched(cdp, fw, sheets) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `#fwprobe-${fw} [data-k]` });
  const res = [];
  for (const nodeId of nodeIds) {
    const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
    const rules = [];
    for (const mr of m.matchedCSSRules || []) {
      const r = mr.rule;
      if (r.origin === 'user-agent') continue;
      const decls = r.style.cssProperties.filter((p) => !p.disabled && p.parsedOk !== false && PROPS.some((q) => touches(p.name, q)))
        .map((p) => ({ n: p.name, v: p.value, imp: !!p.important, impl: !!p.implicit }));
      if (!decls.length) continue;
      const sel = mr.matchingSelectors.map((i) => r.selectorList.selectors[i]).filter(Boolean);
      const spec = sel.map((s) => s.specificity ? [s.specificity.a, s.specificity.b, s.specificity.c] : null).filter(Boolean)
        .sort((x, y) => (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]))[0] || null;
      rules.push({ sel: r.selectorList.text.replace(/\s+/g, ' '), matchSel: sel.map((s) => s.text).join(', ').slice(0, 160), spec,
        sheet: (sheets.get(r.styleSheetId) || '?').replace(BASE, ''), line: r.style.range ? r.style.range.startLine + 1 : null,
        layers: (r.layers || []).map((l) => l.text), media: (r.media || []).map((x) => x.text).join(' | '), decls });
    }
    const inline = m.inlineStyle && m.inlineStyle.cssProperties.filter((p) => !p.disabled && PROPS.some((q) => touches(p.name, q))).map((p) => ({ n: p.name, v: p.value, imp: !!p.important }));
    res.push({ rules, inline: inline && inline.length ? inline : null });
  }
  return res;
}

/* the cascade's winner for one prop, from CDP's ascending order: last normal declaration, unless an
 * important one exists (then the important one; several are flagged for the CSSOM proof to settle) */
function winner(mm, prop) {
  if (!mm) return null;
  const hits = [];
  mm.rules.forEach((r, i) => r.decls.filter((d) => touches(d.n, prop)).forEach((d) => hits.push({ r, d, i })));
  if (mm.inline) mm.inline.filter((d) => touches(d.n, prop)).forEach((d) => hits.push({ r: { sel: 'style=""', sheet: 'inline', layers: [] }, d, i: 1e6 }));
  if (!hits.length) return null;
  const imp = hits.filter((h) => h.d.imp);
  const pick = (imp.length ? imp : hits)[(imp.length ? imp : hits).length - 1];
  return { ...pick, multiImportant: imp.length > 1 };
}
function mech(w, app) {
  if (w.d.imp) return '!important';
  if (!app) return 'uncontested (app declares nothing)';
  if (app.layers.length > w.r.layers.length) return 'nested sublayer (' + app.layers.join('.') + ' < ' + (w.r.layers.join('.') || 'unlayered') + ')';
  if (w.r.layers.length === 0 && app.layers.length) return 'layer order (theme unlayered > app layer ' + app.layers.join('.') + ')';
  if (app.decls && app.decls.some((x) => x.imp)) return 'app !important lost?';
  return 'specificity ' + JSON.stringify(w.r.spec) + ' vs app ' + JSON.stringify(app.spec);
}
const own = (sheet) => /\/luci-static\/(footstrap|bootstrap)\//.test(sheet) ? 'theme' : /fwprobe/.test(sheet) ? 'app' : sheet === 'inline' ? 'app' : 'other';

/* remove the named rule's declaration(s) for prop from cascade.css in the CSSOM, read, restore */
const PROVE = ({ fw, k, prop, sel, names }) => {
  const norm = (s) => s.replace(/\s+/g, '').replace(/["']/g, '');
  const el = document.querySelector(`#fwprobe-${fw} [data-k="${k}"]`);
  const before = getComputedStyle(el).getPropertyValue(prop);
  const touched = [];
  const walk = (rules) => { for (const r of rules) {
    if (r.selectorText && norm(r.selectorText) === norm(sel)) {
      const st = r.style; const saved = [];
      // the longhand itself, plus whatever names CDP reported for it (logical props are separate in the CSSOM)
      for (const n of names) if (st.getPropertyValue(n) !== '' && !saved.some((s) => s[0] === n)) saved.push([n, st.getPropertyValue(n), st.getPropertyPriority(n)]);
      saved.forEach(([n]) => st.removeProperty(n));
      if (saved.length) touched.push({ r, saved });
    }
    if (r.cssRules) walk(r.cssRules);
  } };
  for (const s of document.styleSheets) if (/cascade\.css/.test(s.href || '')) { try { walk(s.cssRules); } catch (e) {} }
  const after = getComputedStyle(el).getPropertyValue(prop);
  touched.forEach(({ r, saved }) => saved.forEach(([n, v, p]) => r.style.setProperty(n, v, p)));
  return { before, after, rules: touched.length, moved: before !== after };
};

async function visit(ctx, side, fw) {
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  const cdp = await ctx.newCDPSession(p);
  const sheets = new Map();
  cdp.on('CSS.styleSheetAdded', (e) => sheets.set(e.header.styleSheetId, e.header.sourceURL || (e.header.isInline ? 'inline-style' : e.header.origin)));
  await p.goto(`${BASE}/cgi-bin/luci/admin/services/fwprobe-${fw}`, { waitUntil: 'domcontentloaded' });
  const rendered = await p.waitForFunction((fw) => { const r = document.getElementById('fwprobe-' + fw); return !!(r && r.querySelectorAll('[data-k]').length > 10); }, fw, { timeout: 30000 }).then(() => true, () => false);
  let settled = true;
  if (fw !== 'none') settled = await p.waitForFunction((fw) => {
    const l = [...document.querySelectorAll('link[rel~=stylesheet]')].find((x) => x.href.includes('fwprobe/' + fw + '.css'));
    if (!l) return false;
    if (l.dataset.fsLayered) { const s = [...document.querySelectorAll('style[data-fs-layered]')].find((x) => x.textContent.includes('fwprobe/' + fw)); try { return !!(s && s.sheet.cssRules[0].styleSheet.cssRules.length); } catch (e) { return false; } }
    try { return !!(l.sheet && l.sheet.cssRules.length); } catch (e) { return false; }
  }, fw, { timeout: 20000 }).then(() => true, () => false);
  await p.waitForTimeout(2000);	/* fence rAF retries + any late re-host; see third-party-apps.md "the gap is time" */
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  await p.waitForTimeout(300);
  const m = await p.evaluate(MEASURE, { fw, PROPS, side });
  m.rendered = rendered; m.settled = settled; m.errs = errs;
  if (fw !== 'none') m.matched = await matched(cdp, fw, sheets);
  if (fw !== 'none') await p.screenshot({ path: `${OUT}${side}-${fw}.png`, fullPage: true });
  return { p, m };
}

async function loginCtx(b) {
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/cgi-bin/luci/', { waitUntil: 'domcontentloaded' });
  if (await p.locator('input[name="luci_password"]').count()) {
    await p.fill('input[name="luci_username"]', 'root');
    await p.fill('input[name="luci_password"]', '');
    await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }), p.press('input[name="luci_password"]', 'Enter')]);
  }
  await p.waitForTimeout(1500); await p.close();
  return ctx;
}

/* ---- source mapping: cascade.css selector -> styles/**:line ---- */
const styleFiles = (() => { const out = []; const rec = (d) => { for (const f of readdirSync(d)) { const q = d + f; if (statSync(q).isDirectory()) rec(q + '/'); else if (f.endsWith('.css')) out.push(q); } }; rec(STYLES); return out; })();
const srcCache = new Map();
/* The layer CDP reports picks the directory (tokens -> styles/*.css, base, theme, page -> pages), so
 * a selector repeated across layers maps to the copy that actually won. A selector list is found by
 * its first part at a line start, followed by `,` or `{`. */
function mapSource(sel, layer, decl) {
  const key = sel + '|' + layer + '|' + decl;
  if (srcCache.has(key)) return srcCache.get(key);
  const dir = { tokens: null, base: 'base/', theme: 'theme/', page: 'pages/' }[layer];
  const files = styleFiles.filter((f) => { const rel = f.slice(STYLES.length); return dir ? rel.startsWith(dir) : !rel.includes('/'); });
  const parts = sel.split(/,(?![^()]*\))/).map((s) => s.trim().replace(/\s+/g, ' ').replace(/"/g, "'"));
  const prop = decl ? decl.split(':')[0] : null;
  let hit = null, fallback = null;
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim().replace(/\s+/g, ' ').replace(/"/g, "'");
      if (L.startsWith('/*') || L.startsWith('*')) continue;
      if (!(L.startsWith(parts[0] + ' {') || L === parts[0] + ',' || L.startsWith(parts[0] + ', ') || L === parts[0] + '{')) continue;
      const at = f.replace(STYLES, 'styles/') + ':' + (i + 1);
      if (!fallback) fallback = at;
      // prefer the copy whose block (up to the closing brace) declares the property
      const block = lines.slice(i, i + 40).join('\n'); const end = block.indexOf('}');
      if (!prop || block.slice(0, end < 0 ? undefined : end).includes(prop)) { hit = at; break; }
    }
    if (hit) break;
  }
  srcCache.set(key, hit || fallback);
  return hit || fallback;
}

/* ---- run ---- */
const report = { stand, when: new Date().toISOString(), viewport: [W, H], fws: FWS, pages: {} };
const b = await chromium.launch();
try {
  const cur = owlab('uci get luci.main.mediaurlbase').trim();
  report.startTheme = cur;
  // bootstrap side first, then footstrap (which is also the restore)
  setTheme('bootstrap');
  const bctx = await loginCtx(b);
  const bs = {};
  for (const fw of PAGES) { const { p, m } = await visit(bctx, 'bootstrap', fw); bs[fw] = m; await p.close(); console.log('bootstrap', fw, 'rendered', m.rendered, 'settled', m.settled, 'errs', m.errs.length); }
  await bctx.close();
  setTheme('footstrap');
  report.themeAfterRestore = owlab('uci get luci.main.mediaurlbase').trim();
  const fctx = await loginCtx(b);
  const noneChrome = {};
  for (const fw of PAGES) {
    const { p, m } = await visit(fctx, 'footstrap', fw);
    console.log('footstrap', fw, 'rendered', m.rendered, 'settled', m.settled, 'errs', m.errs.length);
    if (fw === 'none') { noneChrome.footstrap = m.chrome; noneChrome.bootstrap = bs.none.chrome; await p.close(); continue; }
    const B = bs[fw];
    const page = { versions: null, footstrap: { links: m.links, shims: m.shims, layers: m.layers, appRules: m.appRules, fencedRules: m.fencedRules, errs: m.errs, settled: m.settled, docOverflow: m.docOverflow, bodyFont: m.bodyFont },
      bootstrap: { links: B.links, layers: B.layers, errs: B.errs, settled: B.settled, docOverflow: B.docOverflow, bodyFont: B.bodyFont }, diffs: [], chrome: {} };
    for (let i = 0; i < m.els.length; i++) {
      const F = m.els[i], S = B.els[i];
      if (!S || S.k !== F.k) { page.diffs.push({ k: F.k, error: 'element order mismatch' }); continue; }
      for (const prop of PROPS) {
        if (F[prop] === S[prop]) continue;
        const wf = winner(m.matched[i], prop), wb = winner(B.matched[i], prop);
        const d = { k: F.k, tag: F.tag, cls: String(F.cls).slice(0, 80), prop, fs: F[prop], bs: S[prop], kind: LAYOUT.includes(prop) ? 'layout' : 'cosmetic' };
        d.fsWin = wf ? { sel: wf.r.sel, sheet: wf.r.sheet, line: wf.r.line, layers: wf.r.layers, spec: wf.r.spec, decl: `${wf.d.n}:${wf.d.v}${wf.d.imp ? '!' : ''}`, owner: own(wf.r.sheet), multiImp: wf.multiImportant } : { owner: INHERITED.has(prop) ? 'inherited' : 'initial/UA' };
        d.bsWin = wb ? { sel: wb.r.sel, sheet: wb.r.sheet, line: wb.r.line, layers: wb.r.layers, spec: wb.r.spec, decl: `${wb.d.n}:${wb.d.v}${wb.d.imp ? '!' : ''}`, owner: own(wb.r.sheet) } : { owner: INHERITED.has(prop) ? 'inherited' : 'initial/UA' };
        // the app's own strongest candidate under footstrap, for the mechanism
        const appHits = (m.matched[i].rules || []).filter((r) => own(r.sheet) === 'app' && r.decls.some((x) => touches(x.n, prop)));
        const app = appHits[appHits.length - 1];
        d.appRule = app ? { sel: app.sel.slice(0, 120), layers: app.layers, spec: app.spec, decl: app.decls.filter((x) => touches(x.n, prop)).map((x) => `${x.n}:${x.v}${x.imp ? '!' : ''}`).join(';') } : null;
        if (d.fsWin.owner === 'theme') {
          d.src = mapSource(d.fsWin.sel, d.fsWin.layers[0], d.fsWin.decl);
          d.mechanism = mech(wf, app);
          const names = [prop, ...wf.r.decls.filter((x) => touches(x.n, prop)).map((x) => x.n)];
          d.proof = await p.evaluate(PROVE, { fw, k: F.k, prop, sel: d.fsWin.sel, names });
        }
        d.cause = d.fsWin.owner === 'theme' ? 'footstrap' : d.bsWin.owner === 'theme' ? 'bootstrap-theme'
          : (d.fsWin.owner === 'inherited' || d.bsWin.owner === 'inherited') ? 'inherited'
          : 'consequential (same owner both sides: container width / content / UA)';
        page.diffs.push(d);
      }
    }
    /* The H1 measure proper, independent of the bootstrap diff (stock bootstrap's unlayered sheet
     * beats a layered app too, so equal values can hide a loss on both sides): every app
     * declaration whose property is won by a THEME rule. Footstrap side proven in the CSSOM. */
    page.overrides = { footstrap: [], bootstrap: [] };
    for (let i = 0; i < m.els.length; i++) {
      for (const prop of PROPS) {
        for (const [side, mm] of [['footstrap', m.matched[i]], ['bootstrap', B.matched[i]]]) {
          if (!mm) continue;
          const appHits = mm.rules.filter((r) => own(r.sheet) === 'app' && r.decls.some((x) => touches(x.n, prop)));
          const inlineApp = mm.inline && mm.inline.some((x) => touches(x.n, prop));
          if (!appHits.length && !inlineApp) continue;
          const w = winner(mm, prop);
          if (!w || own(w.r.sheet) !== 'theme') continue;
          const app = appHits[appHits.length - 1] || { layers: [], spec: [1, 0, 0, 0], sel: 'style=""', decls: [] };
          const o = { k: m.els[i].k, prop, kind: LAYOUT.includes(prop) ? 'layout' : 'cosmetic', sel: w.r.sel, layers: w.r.layers, spec: w.r.spec,
            decl: `${w.d.n}:${w.d.v}${w.d.imp ? '!' : ''}`, app: { sel: app.sel.slice(0, 100), layers: app.layers, spec: app.spec }, mechanism: mech(w, app) };
          if (side === 'footstrap') {
            o.src = mapSource(w.r.sel, w.r.layers[0], o.decl);
            const names = [prop, ...w.r.decls.filter((x) => touches(x.n, prop)).map((x) => x.n)];
            o.proof = await p.evaluate(PROVE, { fw, k: o.k, prop, sel: w.r.sel, names });
            o.value = m.els[i][prop];
          } else o.value = B.els[i][prop];
          page.overrides[side].push(o);
        }
      }
    }
    // chrome vs the no-app page, both themes
    const cmp = (a, z) => { const moved = []; const n = Math.min(a.length, z.length); for (let i = 0; i < n; i++) { const x = a[i], y = z[i]; const keys = ['rect', 'display', 'padding', 'margin', 'fontSize', 'lineHeight', 'boxSizing', 'border']; const dk = keys.filter((kk) => JSON.stringify(x[kk]) !== JSON.stringify(y[kk])); if (dk.length) moved.push({ i, tag: x.tag, cls: x.cls, dk, none: dk.map((kk) => x[kk]), app: dk.map((kk) => y[kk]) }); } return { countNone: a.length, countApp: z.length, moved: moved.length, first: moved.slice(0, 8) }; };
    page.chrome.footstrap = cmp(noneChrome.footstrap, m.chrome);
    page.chrome.bootstrap = cmp(noneChrome.bootstrap, B.chrome);
    report.pages[fw] = page;
    await p.close();
  }
  await fctx.close();
} finally {
  await b.close();
  restore();
}
const REPORT = OUT + `report-${FWS.join('_')}.json`;
writeFileSync(REPORT, JSON.stringify(report, null, 1));

for (const [fw, pg] of Object.entries(report.pages)) {
  const ds = pg.diffs.filter((d) => !d.error);
  const by = (f) => ds.filter(f).length;
  console.log(`\n== ${fw}: rehosted=${pg.footstrap.links.map((l) => l.layered).join(',')} layers=[${pg.footstrap.layers.join(' ')}] rules=${pg.footstrap.appRules} fenced=${pg.footstrap.fencedRules} errs fs/bs=${pg.footstrap.errs.length}/${pg.bootstrap.errs.length}`);
  console.log(`   diffs=${ds.length} footstrap-caused layout=${by((d) => d.cause === 'footstrap' && d.kind === 'layout')} cosmetic=${by((d) => d.cause === 'footstrap' && d.kind === 'cosmetic')} | bootstrap-theme-caused ${by((d) => d.cause === 'bootstrap-theme')} | inherited ${by((d) => d.cause === 'inherited')} | other ${by((d) => d.cause === 'other')}`);
  console.log(`   chrome moved: footstrap ${pg.chrome.footstrap.moved}/${pg.chrome.footstrap.countNone} (${pg.chrome.footstrap.countApp}), bootstrap ${pg.chrome.bootstrap.moved}/${pg.chrome.bootstrap.countNone}`);
  const ov = pg.overrides.footstrap, eff = ov.filter((o) => o.proof && o.proof.moved);
  const bov = pg.overrides.bootstrap;
  console.log(`   app decls won by a theme rule: footstrap ${ov.length} (CSSOM-proven effective ${eff.length}: layout ${eff.filter((o) => o.kind === 'layout').length}, cosmetic ${eff.filter((o) => o.kind === 'cosmetic').length}) | stock bootstrap ${bov.length} (layout ${bov.filter((o) => o.kind === 'layout').length})`);
  const agg = new Map();
  for (const o of ov) {
    const key = `${o.src || '?'} \`${o.sel.slice(0, 70)}\` | ${o.mechanism.replace(/\[.*?\]/g, (s) => s)}`;
    const a = agg.get(key) || { n: 0, eff: 0, props: new Set(), els: new Set() }; a.n++; if (o.proof && o.proof.moved) a.eff++; a.props.add(o.prop); a.els.add(o.k); agg.set(key, a);
  }
  for (const [key, a] of [...agg].sort((x, y) => y[1].eff - x[1].eff).slice(0, 14)) console.log(`   ${a.eff}/${a.n} ${key} :: ${[...a.props].join(',')} @ ${[...a.els].join(',')}`);
}
console.log('->', REPORT);

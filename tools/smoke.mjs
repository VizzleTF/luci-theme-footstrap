/* Early detector: do the shipped modules come up in a REAL browser, and do the Appearance axes
 * stamp in the documented order? Not a userland run (`owlab test`): the gallery has no luci-base,
 * session, menu or rpc, so every dependency is a stub. `npm test` cannot see a module that throws
 * on its first box measure: its window and document RECORD calls (tests/lib/luci-module.mjs).
 *
 * Order check: every colour axis sets its custom property BEFORE the attribute that switches the
 * rotation on, else a reload paints one frame in the previous hue (`tools/axes.mjs` reads source).
 * Export contract (`missingExports`): every `axes.*`/`prefs.*` name fs-appearance.js, fs-assets.js
 * and fs-axes.js reach for exists on fs-axes.js/fs-prefs.js (docs/development.md, "smoke").
 *
 * `--staged` runs what a router gets: the minified, token-mangled modules and header.ut that
 * `tools/stage.sh` leaves in dist/ ($DIST); the static half stays on the source tree.
 *   node tools/smoke.mjs
 *   sh tools/stage.sh && node tools/smoke.mjs --staged
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveGallery } from './lib/gallery.mjs';
import { buildCss, seamOf } from './lib/css.mjs';
import { pragmas, aliasFor } from '../tests/lib/luci-module.mjs';
import { ROOT, RESOURCES } from './lib/root.mjs';
import { parseFlags } from './lib/util.mjs';

/* ---- export-contract: does every `alias.name(` one module reaches for exist on what the other
 * exports? Folded in here because this is its only caller. Deliberately narrow, and safe to be
 * narrow: a MISS (an export built dynamically, e.g. `exported[key] = fn`) makes the check see fewer
 * exports than there are, which can only produce a false failure — never a false pass — and every
 * module this is pointed at lists its exports as a literal, comma-separated identifier list. */
function stripComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/* The KEYS of the module's own `return baseclass.extend({ … });` — the LAST such call in the file,
 * which is where every one of these modules places it. A shorthand (`currentTint, applyTint`)
 * exports the name itself; in `key: value` only the key counts, so a value identifier is never
 * mistaken for an export. Entries are split on commas at depth 0 (a value may hold a call or literal). */
function exportedKeys(src) {
	const clean = stripComments(src);
	const m = clean.match(/return\s+baseclass\.extend\(\{([\s\S]*)\}\)\s*;?\s*$/);
	if (!m) return null;
	const body = m[1];
	const keys = new Set();
	let depth = 0, start = 0;
	const take = (end) => { const k = body.slice(start, end).match(/^\s*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)/); if (k) keys.add(k[1]); };
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if ('([{'.includes(c)) depth++;
		else if (')]}'.includes(c)) depth--;
		else if (c === ',' && !depth) { take(i); start = i + 1; }
	}
	take(body.length);
	return keys;
}

/* Every `alias.name` reference in `src` — a call (`axes.currentContentWidth()`) or a bare
 * reference handed to another function (`bump(axes.applyContentWidth)`), because the second shape
 * fails the same way one call later: `bump()` invokes whatever it was given, undefined included. */
function referencedNames(src, alias) {
	const clean = stripComments(src);
	const re = new RegExp(`\\b${alias}\\.([A-Za-z_$][A-Za-z0-9_$]*)`, 'g');
	const names = new Set();
	for (const m of clean.matchAll(re)) names.add(m[1]);
	return names;
}

/* Every name `callerSrc` reaches for on `alias` must be a key `calleeSrc` exports. Returns `null`
 * (not an empty array) when the callee's export shape was not recognised, so a caller can tell
 * "nothing missing" from "could not check" and never turns the second into a silent pass. */
function missingExports(callerSrc, alias, calleeSrc) {
	const exported = exportedKeys(calleeSrc);
	if (!exported) return null;
	const referenced = referencedNames(callerSrc, alias);
	return [...referenced].filter((n) => !exported.has(n)).sort();
}

/* Dependency order, not alphabetical: each module is evaluated once and handed to the next as its
 * pragma argument, the way luci.js's require cache does it. fs-router and fs-chrome are the two
 * that measure a box at eval. */
const MODULES = ['fs-fit', 'fs-prefs', 'fs-axes', 'fs-version', 'fs-assets', 'fs-select', 'fs-chrome', 'fs-router', 'fs-appearance'];

const FLAGS = parseFlags('smoke', { staged: { type: 'boolean', default: false } });
const STAGED = FLAGS.staged;
const DIST = process.env.DIST || join(ROOT, 'dist');
const SHIPPED = join(DIST, 'root/www/luci-static');
const MODS = STAGED ? join(SHIPPED, 'resources') : RESOURCES;
if (STAGED && !existsSync(join(MODS, 'fs-fit.js'))) {
	console.error(`smoke --staged: no staged tree under ${DIST}; run sh tools/stage.sh first`);
	process.exit(2);
}

/* The minifier writes the prologue as one line of directives, in whichever quote it picked for the
 * file (fs-version.js keeps single quotes), which pragmas() - a line-wise reader of the source tree - does not see. */
const stagedPragmas = (src) => [ ...(/^(?:(["'])[^"'\n]*\1;)+/.exec(src)?.[0] ?? '').matchAll(/(["'])([^"']*)\1;/g) ]
	.map((m) => m[2]).filter((p) => p !== 'use strict');

/* `src` is the readable source, which the static half reads; `run` is what the browser evaluates. */
const sources = MODULES.map((name) => {
	const src = readFileSync(join(RESOURCES, name + '.js'), 'utf8');
	const run = STAGED ? readFileSync(join(MODS, name + '.js'), 'utf8') : src;
	return { name, src, run, deps: (STAGED ? stagedPragmas(run) : pragmas(src)).map(aliasFor).filter(Boolean) };
});

/* ---- the static half: every `axes.` / `prefs.` reference held against what is exported ----
 * Runs before the browser even launches, and fails the build on its own if it finds anything —
 * which says WHICH name is missing. */
const staticChecks = [];
{
	const appearanceSrc = sources.find((s) => s.name === 'fs-appearance').src;
	const assetsSrc = sources.find((s) => s.name === 'fs-assets').src;
	const axesSrc = sources.find((s) => s.name === 'fs-axes').src;
	const prefsSrc = sources.find((s) => s.name === 'fs-prefs').src;
	for (const [callerName, callerSrc, alias, calleeName, calleeSrc] of [
		['fs-appearance', appearanceSrc, 'axes', 'fs-axes', axesSrc],
		['fs-appearance', appearanceSrc, 'prefs', 'fs-prefs', prefsSrc],
		['fs-assets', assetsSrc, 'axes', 'fs-axes', axesSrc],
		['fs-axes', axesSrc, 'prefs', 'fs-prefs', prefsSrc],
	]) {
		const missing = missingExports(callerSrc, alias, calleeSrc);
		if (missing === null) {
			staticChecks.push({ ok: false, m: `export-contract: could not find ${calleeName}'s ` +
				`'return baseclass.extend({ … })' — the shape moved and this check cannot see its exports` });
		} else if (missing.length) {
			staticChecks.push({ ok: false, m: `export-contract: ${callerName} calls ${alias}.` +
				`${missing.join('(), ' + alias + '.')}(), which ${calleeName} does not export` });
		} else {
			staticChecks.push({ ok: true, m: `export-contract: every ${alias}.* ${callerName} calls is exported by ${calleeName}` });
		}
	}
}

/* The five colour axes built by colorAxis() in fs-axes.js. Each one is `--fs-<x>-h` then
 * `data-<x>="hue"`, and the property must be written first. `axis` names the key fs-axes.js
 * exports the `{current, apply}` object under. */
const COLOR_AXES = [
	{ axis: 'tint', attr: 'data-tint', prop: '--fs-tint-h' },
	{ axis: 'accent', attr: 'data-accent', prop: '--fs-accent-h' },
	{ axis: 'good', attr: 'data-good', prop: '--fs-good-h' },
	{ axis: 'warn', attr: 'data-warn', prop: '--fs-warn-h' },
	{ axis: 'danger', attr: 'data-danger', prop: '--fs-danger-h' },
];

/* The staged JS writes the mangled names, so it meets the sheet mangled the same way; a stage left
 * from an older tree would agree on nothing and fail on the first axis. */
const css = buildCss({ shipped: STAGED });
const seam = (n) => seamOf(css)?.names.get(n) ?? n;
if (STAGED) {
	const fresh = readFileSync(join(SHIPPED, 'footstrap/cascade.css'), 'utf8') === readFileSync(css, 'utf8');
	staticChecks.push({ ok: fresh, m: fresh ? 'staged: cascade.css is the sheet a fresh build ships'
		: 'staged: cascade.css differs from a fresh shipped build; re-run sh tools/stage.sh (not --dev)' });
}
const { base, close } = await serveGallery(css);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/* A module that logs an error instead of throwing still "loaded", and the theme's own history is
 * exactly that shape: the Appearance tab is built in ONE try/catch, so one missing name cost the
 * whole panel and a single console line.
 *
 * Network 404s are the fixture, not the theme: serveGallery holds two files, so the favicon the
 * browser asks for on its own and any asset a background-image names are absent by construction.
 * They are dropped rather than reported, and a real load failure of cascade.css surfaces as the
 * computed-style assertions failing instead. */
const consoleErrors = [];
const fixtureNoise = (t) => (/Failed to load resource/i).test(t);
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !fixtureNoise(m.text())) consoleErrors.push(m.text()); });

await page.goto(base, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const result = await page.evaluate(({ mods, axes }) => {
	const notes = [];
	const fail = (m) => notes.push({ ok: false, m });
	const pass = (m) => notes.push({ ok: true, m });

	/* A luci-base that answers every existence check and does nothing else. Same shape as
	 * tests/lib/luci-module.mjs's fakeL — a second stub with a different shape would be a second
	 * definition of what luci-base is, and the theme's assumptions about it are held by
	 * tools/upstream-contract.mjs on a real router, not here. */
	const L = {
		env: {
			scriptname: '/cgi-bin/luci', base_url: '/luci-static/resources',
			resource: '/luci-static/resources', media: '/luci-static/footstrap', resource_version: '1',
			dispatchpath: ['admin', 'status', 'overview'], requestpath: ['admin', 'status', 'overview'],
			pathinfo: '/admin/status/overview', nodespec: { readonly: false },
		},
		Class: function Class() {},
		require: () => Promise.resolve({}),
		dom: { content() {}, parse: () => null, append() {} },
		Poll: { active: () => false, start() {}, stop() {}, add() {}, remove() {} },
		Request: { addInterceptor() {}, get: () => Promise.resolve({ status: 200 }) },
		url: () => '/cgi-bin/luci',
		get: () => Promise.resolve({}),
		hasSystemFeature: () => false,
	};
	window.L = L;
	/* `_(msgid, ctx)` with no catalogue returns msgid unchanged (luci.js); fs-assets.js calls it at eval. */
	window._ = window._ || ((s) => s);

	const registry = {
		baseclass: { extend: (o) => o },
		rpc: { declare: () => () => Promise.resolve({}) },
		ui: {
			instantiateView: () => Promise.resolve({}), hideModal() {}, hideIndicator() {},
			showIndicator() {}, addNotification() {}, menu: { load: () => Promise.resolve({}) },
		},
		dom: L.dom,
	};

	for (const { name, src, deps } of mods) {
		const args = deps.map((d) => (Object.prototype.hasOwnProperty.call(registry, d.dep) ? registry[d.dep] : {}));
		try {
			const factory = new Function('window', 'document', 'L', ...deps.map((d) => d.alias), src);
			const exported = factory.call(window, window, document, L, ...args);
			if (!exported || typeof exported !== 'object') { fail(`${name}: evaluated but exported ${typeof exported}, not an object`); continue; }
			if (Object.keys(exported).length === 0) { fail(`${name}: exported an object with no keys`); continue; }
			registry[name] = exported;
			pass(`${name}: evaluated, ${Object.keys(exported).length} export(s)`);
		} catch (e) {
			fail(`${name}: threw at eval — ${e && e.message ? e.message : e}`);
		}
	}

	/* ---- the ordering contract, watched rather than read ---- */
	const axesMod = registry['fs-axes'];
	if (!axesMod) { fail('fs-axes did not load, so the axis order could not be watched'); return notes; }

	const root = document.documentElement;
	for (const ax of axes) {
		const axisObj = axesMod[ax.axis];
		if (!axisObj || typeof axisObj.apply !== 'function') { fail(`fs-axes.${ax.axis} is missing or has no .apply(); the axis list in tools/smoke.mjs is stale`); continue; }

		/* Start from off, so the apply under measurement writes both halves rather than one. */
		root.removeAttribute(ax.attr);
		root.style.removeProperty(ax.prop);

		/* The two write CALLS are recorded, not the resulting mutations. A MutationObserver reports
		 * that `style` changed, not which property inside it did, and a colorAxis apply() removes
		 * one custom property before setting another — so from the record alone "the hue was set"
		 * is indistinguishable from "the hex was cleared". Wrapping the two methods reads the order
		 * the module actually wrote in, which is the whole claim. */
		const seen = [];
		const realSetAttr = root.setAttribute.bind(root);
		const realSetProp = root.style.setProperty.bind(root.style);
		root.setAttribute = (n, v) => { if (n === ax.attr) seen.push('attr'); return realSetAttr(n, v); };
		root.style.setProperty = (n, v, p) => { if (n === ax.prop) seen.push('prop'); return realSetProp(n, v, p); };

		let threw = null;
		try { axisObj.apply(200); } catch (e) { threw = e; }

		delete root.setAttribute;
		delete root.style.setProperty;
		if (threw) { fail(`fs-axes.${ax.axis}.apply(200) threw — ${threw.message || threw}`); continue; }

		const first = seen.indexOf('prop');
		const firstAttr = seen.indexOf('attr');
		if (first < 0 || firstAttr < 0) {
			fail(`${ax.axis}: expected both ${ax.prop} and ${ax.attr} to be written, saw [${seen.join(', ') || 'nothing'}]`);
		} else if (first > firstAttr) {
			fail(`${ax.axis}: wrote ${ax.attr} BEFORE ${ax.prop}. A reload paints one frame in the previous hue.`);
		} else {
			pass(`${ax.axis}: ${ax.prop} then ${ax.attr}`);
		}

		if (root.getAttribute(ax.attr) !== 'hue') fail(`${ax.axis}: ${ax.attr} is '${root.getAttribute(ax.attr)}', expected 'hue'`);
		if (root.style.getPropertyValue(ax.prop).trim() !== '200') fail(`${ax.axis}: ${ax.prop} is '${root.style.getPropertyValue(ax.prop)}', expected '200'`);
	}

	/* The axes must reach the CASCADE, not only the DOM: a custom property set on :root that no rule
	 * reads changes nothing on the page, and every assertion above would still pass. Measured from
	 * OFF to a hue, in that order, because 0 means off rather than red. */
	axesMod.tint.apply(0);
	const off = getComputedStyle(document.body).backgroundColor;
	axesMod.tint.apply(200);
	const on = getComputedStyle(document.body).backgroundColor;
	if (off === on) fail(`tint.apply(200) changed no computed value on body (${off}); the tint tokens are not reaching the cascade`);
	else pass(`tint.apply reaches the cascade: body background ${off} -> ${on}`);
	axesMod.tint.apply(0);

	return notes;
}, { mods: sources.map(({ name, run, deps }) => ({ name, src: run, deps })), axes: COLOR_AXES.map((a) => ({ ...a, prop: seam(a.prop) })) });

/* ---- the body-litter recorder (header.ut) actually wraps document.body, on a real DOM ----
 *
 * Server-rendered markup that docs/gallery.html lacks, so its text is pulled out of header.ut
 * (as tools/lib/ut-scripts.mjs does for eslint) and run verbatim against THIS page's document.body:
 * the wrap must intercept the calls fs-router.js's bodyLittered() depends on (issue #56), not only
 * parse. It runs after the module checks: their own body-parented probes must not be caught by it. */
const headerUt = readFileSync(STAGED ? join(DIST, 'root/usr/share/ucode/luci/template/themes/footstrap/header.ut')
	: join(ROOT, 'luci-theme-footstrap/ucode/template/themes/footstrap/header.ut'), 'utf8');
const bodyTag = headerUt.indexOf('<body');
const recorderMatch = bodyTag >= 0 && headerUt.slice(bodyTag).match(/<script>([\s\S]*?)<\/script[^>]*>/i);

const recorderNotes = recorderMatch ? await page.evaluate((src) => {
	const notes = [];
	const check = (cond, m) => notes.push({ ok: !!cond, m: 'body-litter recorder: ' + m });

	try { new Function(src)(); }
	catch (e) {
		check(false, 'threw on a real document.body — ' + (e && e.message ? e.message : e));
		return notes;
	}

	const probe = document.createElement('div');
	document.body.appendChild(probe);
	check((window.__fsBodyAdds || []).includes(probe), 'appendChild is recorded');
	document.body.removeChild(probe);

	/* a fragment dissolves on insertion: its children become direct children of <body>, which is
	 * the shape the classifier reads — not the fragment itself, which is never a child of anything */
	const frag = document.createDocumentFragment();
	const fromFrag = document.createElement('span');
	frag.appendChild(fromFrag);
	document.body.append(frag);
	check((window.__fsBodyAdds || []).includes(fromFrag), 'append(fragment) is recorded');
	document.body.removeChild(fromFrag);

	document.body.insertAdjacentHTML('beforeend', '<div id="fs-smoke-iah-probe"></div>');
	const iah = document.getElementById('fs-smoke-iah-probe');
	check(!!iah && (window.__fsBodyAdds || []).includes(iah), 'insertAdjacentHTML(beforeend) is recorded');
	if (iah) iah.remove();

	/* the wrap is on the <body> INSTANCE only — an append onto some other element must not be seen */
	const other = document.createElement('div');
	const child = document.createElement('span');
	other.appendChild(child);
	check(!(window.__fsBodyAdds || []).includes(child), 'a non-body appendChild is not recorded');

	return notes;
}, recorderMatch[1]) : [ { ok: false, m: 'body-litter recorder: header.ut\'s <body> no longer opens '
	+ 'with a plain, non-interpolated <script>…</script> — the recorder moved, was deleted, or '
	+ 'gained a ucode interpolation this extractor does not handle' } ];

/* ---- fs-sheets fences an @import's rules on a real CSSOM ----
 *
 * fenceRules() follows CSSImportRule.styleSheet; a fake rule list cannot model that, a real
 * stylesheet can. The import is a data: URL so the gallery server needs to serve nothing. */
const sheetsSrc = readFileSync(join(MODS, 'fs-sheets.js'), 'utf8');
const sheetsNotes = await page.evaluate(async ([ src, staged ]) => {
	const notes = [];
	const check = (cond, m) => notes.push({ ok: !!cond, m: 'fs-sheets: ' + m });
	const mod = new Function('window', 'document', 'L', 'baseclass', src)(window, document, window.L, { extend: (o) => o });
	const el = document.createElement('style');
	el.textContent = '@import url("data:text/css,p%7Bcolor%3Ared%7D") layer(theme);';
	document.head.appendChild(el);
	/* bounded: a load that already fired, or never comes, would hang the gate; 3 s is far over a data: URL */
	const loaded = await Promise.race([
		new Promise((res) => { if (el.sheet && el.sheet.cssRules[0].styleSheet) res(true); else el.addEventListener('load', () => res(true), { once: true }); }),
		new Promise((res) => setTimeout(() => res(false), 3000)),
	]);
	if (!loaded) { check(false, 'the @import never loaded within 3 s'); el.remove(); return notes; }
	try {
		if (staged) check(mod.fenceRules === undefined, 'fenceRules is a probe export and is not in the shipped tree');
		else {
			mod.fenceRules(el.sheet.cssRules, new Set());
			const inner = el.sheet.cssRules[0].styleSheet.cssRules[0];
			check(inner && inner.selectorText.includes(':where(:not([data-fs-chrome]'), "an @import's rule is fenced (" + (inner && inner.selectorText) + ')');
		}
	} catch (e) { check(false, 'fenceRules threw — ' + e.message); }
	el.remove();

	/* a link the app marks alternate/disabled and enables later has no node added, so only the
	 * observer's attribute records can fence it */
	const stub = { env: { dispatchpath: [ 'admin', 'x', 'y' ] } };
	new Function('window', 'document', 'L', 'baseclass', src)(window, document, stub, { extend: (o) => o }).watchViewSheets();
	const tick = () => new Promise((res) => setTimeout(res, 300));
	for (const [ label, arm, fire ] of [
		[ 'rel=alternate → stylesheet', (l) => { l.rel = 'alternate stylesheet'; }, (l) => { l.rel = 'stylesheet'; } ],
		[ 'disabled attribute removed', (l) => { l.rel = 'stylesheet'; l.setAttribute('disabled', ''); }, (l) => { l.removeAttribute('disabled'); } ],
	]) {
		const href = 'data:text/css,*%7Bmargin%3A0%7D/*' + label.length + '*/';
		const l = document.createElement('link');
		arm(l);
		l.href = href;
		document.head.appendChild(l);
		await tick();
		const shims = () => [ ...document.querySelectorAll('style[data-fs-layered]') ].filter((s) => s.textContent.includes(href)).length;
		check(shims() === 0, label + ': not re-hosted while marked');
		let childList = 0;
		const watch = new MutationObserver((ms) => { for (const m of ms) if (m.type === 'childList') childList++; });
		watch.observe(document.head, { childList: true });
		fire(l);
		await tick();
		watch.disconnect();
		check(shims() === 1, label + ': gains one @import shim (' + shims() + ')');
		check(childList === 1, label + ': one node added, no feedback loop (' + childList + ' childList records)');
		document.querySelectorAll('style[data-fs-layered]').forEach((x) => { if (x.textContent.includes(href)) x.remove(); });
		l.remove();
	}
	return notes;
}, [ sheetsSrc, STAGED ]);

await browser.close();
close();

/* the static half runs before the browser and is reported with the rest: collected and then
 * dropped, it proved nothing — removing an export from fs-axes.js left this gate green. */
result.unshift(...staticChecks);
result.push(...recorderNotes, ...sheetsNotes);

let failed = 0;
for (const n of result) {
	console.log(`  ${n.ok ? 'ok  ' : 'FAIL'} ${n.m}`);
	if (!n.ok) failed++;
}

for (const e of consoleErrors) { console.log(`  FAIL console: ${e}`); failed++; }

console.log(`\nsmoke: ${result.length} check(s), ${failed} failure(s). This proves the modules come up against a real DOM; it does not prove behaviour on a page (owlab).`);
process.exit(failed ? 1 : 0);

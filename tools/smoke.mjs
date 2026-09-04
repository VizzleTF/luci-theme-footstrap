/* Early detector: do the shipped modules come up in a REAL browser, does the Appearance PAGE
 * actually render, and do the Appearance axes stamp in the documented order?
 *
 * This is NOT a substitute for a userland run and does not earn a release the right to skip owlab.
 * The gallery has no luci-base, no session, no menu, no rpc and no router — every dependency here
 * is a stub, so what this proves is that a module EVALUATES against a real DOM, a real CSSOM and
 * real layout, and that the axes it applies land on :root in the right order. Behaviour on a page
 * is still `owlab test` and `npm run live` (docs/development.md).
 *
 * What it adds over `npm test`: the unit suite runs against tests/lib/luci-module.mjs, whose window
 * and document RECORD calls rather than answer them — there is no layout there, so a module that
 * throws the first time it measures a box passes the unit suite and fails on a router. Here the box
 * is real.
 *
 * The order check is the one that earns its own gate. Every colour axis sets its custom property
 * BEFORE the attribute that switches the rotation on; reversed, a reload paints one frame in the
 * previous hue. `tools/axes.mjs` holds the pre-paint in head.ut to the live appliers by reading the
 * source; this watches the two writes actually happen in that order on a live :root.
 *
 * ---- the Appearance render check, and why it lives HERE ----
 *
 * fs-appearance.js called `axes.currentContentWidth()` while fs-axes.js exported no such name; the
 * call returned undefined, `build()` threw inside the one try/catch mount() wraps it in, and the
 * whole "Footstrap" section vanished from System with a single console line nobody was watching.
 * Every gate stayed green: `npm run smoke` EVALUATED fs-appearance.js (a factory call that only
 * defines functions and returns `{ wire }`) but never rendered its form, and nothing else in
 * `npm run check` opens a page. This is the cheapest honest fix — build the DOM `wire()` watches
 * for, call it, and assert the tab actually mounted — so it lives beside the module-eval checks
 * above rather than as a gate of its own; `docs/gallery.html` supplies the served page, the same
 * way it already does for the axis-order watch. A weaker, browser-free companion runs first:
 * `tools/lib/export-contract.mjs` checks every `axes.*`/`prefs.*` name fs-appearance.js (and
 * fs-assets.js) reaches for against what fs-axes.js/fs-prefs.js actually export, which is the exact
 * shape of this bug, caught in milliseconds even where Playwright cannot run at all.
 *
 *   node tools/smoke.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveGallery, ROOT } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';
import { pragmas, aliasFor } from '../tests/lib/luci-module.mjs';
import { missingExports } from './lib/export-contract.mjs';

const RESOURCES = join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/resources');

/* Dependency order, not alphabetical: each module is evaluated once and handed to the next as its
 * pragma argument, the way luci.js's require cache does it. fs-router and fs-chrome are the two
 * that measure a box at eval, and fs-appearance is the one that only RENDERS its box once `wire()`
 * finds the stock System page — which is exactly why it, fs-version and fs-assets (its two other
 * dependencies) are here and not only in the unit suite. */
const MODULES = ['fs-fit', 'fs-prefs', 'fs-axes', 'fs-version', 'fs-assets', 'fs-select', 'fs-chrome', 'fs-router', 'fs-appearance'];

const sources = MODULES.map((name) => {
	const src = readFileSync(join(RESOURCES, name + '.js'), 'utf8');
	return { name, src, deps: pragmas(src).map(aliasFor).filter(Boolean) };
});

/* ---- the static half: every `axes.` / `prefs.` reference held against what is exported ----
 * Runs before the browser even launches, and fails the build on its own if it finds anything —
 * the render check below would fail too, but this says WHICH name is missing rather than "the tab
 * never mounted". */
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
 * `data-<x>="hue"`, and the property must be written first. */
const COLOR_AXES = [
	{ apply: 'applyTint', attr: 'data-tint', prop: '--fs-tint-h' },
	{ apply: 'applyAccent', attr: 'data-accent', prop: '--fs-accent-h' },
	{ apply: 'applyGood', attr: 'data-good', prop: '--fs-good-h' },
	{ apply: 'applyWarn', attr: 'data-warn', prop: '--fs-warn-h' },
	{ apply: 'applyDanger', attr: 'data-danger', prop: '--fs-danger-h' },
];

const { base, close } = await serveGallery(buildCss());
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/* A module that logs an error instead of throwing still "loaded", and the theme's own history is
 * exactly that shape: the Appearance tab is built in ONE try/catch, so a missing ui.RangeSlider cost
 * the whole panel and a single console line (openwrt/luci#8978).
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
	/* A real `E(tag, attrs, children)`, not the bare `createElement` the module-eval checks got by
	 * with: none of THEM call it before the render check below does, but fs-appearance.js's build()
	 * calls it ~120 times to construct the whole Appearance form the moment it mounts, and a stub
	 * that drops attrs/children would build a page of empty, class-less, label-less nodes — which
	 * would pass "did it throw" while failing to prove any of the groups this check counts exist. */
	window.E = window.E || ((tag, attrs, children) => {
		const el = (typeof tag === 'string') ? document.createElement(tag) : document.createElement('div');
		if (attrs) for (const k in attrs) {
			const v = attrs[k];
			if (v === null || v === undefined || v === false) continue;
			if (k === 'class') el.className = String(v);
			else el.setAttribute(k, String(v));
		}
		const append = (c) => {
			if (c === null || c === undefined || c === '') return;
			if (Array.isArray(c)) { c.forEach(append); return; }
			el.appendChild((c instanceof Node) ? c : document.createTextNode(String(c)));
		};
		if (children !== undefined) append(children);
		return el;
	});
	/* `_(msgid, ctx)` with no catalogue returns msgid unchanged (luci.js); the theme then calls
	 * `.format(...)` on some of those strings (the contrast readouts), so the polyfill luci.js
	 * installs on String.prototype has to exist here too or build() throws reaching for it — a
	 * throw the render check exists to catch, not to manufacture out of a missing stub. */
	window._ = window._ || ((s) => s);
	if (!String.prototype.format) {
		Object.defineProperty(String.prototype, 'format', { value: function (...args) {
			let i = 0;
			return this.replace(/%s/g, () => (i < args.length ? args[i++] : '%s'));
		} });
	}

	const registry = {
		baseclass: { extend: (o) => o },
		rpc: { declare: () => () => Promise.resolve({}) },
		ui: {
			instantiateView: () => Promise.resolve({}), hideModal() {}, hideIndicator() {},
			showIndicator() {}, addNotification() {}, menu: { load: () => Promise.resolve({}) },
			tabs: { switchTab() {} },
			/* Minimal stand-ins for the two stock widgets the Appearance form builds every row
			 * from (`new ui.Select(...)`, `new ui.RangeSlider(...)`): a real DOM node from
			 * `.render()` and the value back from `.getValue()`, nothing else. Neither is
			 * exercised for behaviour here — `fs-appearance.js` wiring `widget-change` to a real
			 * router value is `owlab test`'s question, not this file's. */
			Select: function Select(value) { this._v = value; this._el = document.createElement('select'); },
			RangeSlider: function RangeSlider(value) { this._v = value; this._el = document.createElement('input'); this._el.type = 'range'; },
		},
		dom: { ...L.dom, callClassMethod() {} },
		poll: L.Poll,
		request: L.Request,
		uci: { get: () => null, load: () => Promise.resolve() },
		fs: { read: () => Promise.resolve(''), exec: () => Promise.resolve({ code: 0 }) },
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
		if (typeof axesMod[ax.apply] !== 'function') { fail(`fs-axes.${ax.apply} is missing; the axis list in tools/smoke.mjs is stale`); continue; }

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
		try { axesMod[ax.apply](200); } catch (e) { threw = e; }

		delete root.setAttribute;
		delete root.style.setProperty;
		if (threw) { fail(`fs-axes.${ax.apply}(200) threw — ${threw.message || threw}`); continue; }

		const first = seen.indexOf('prop');
		const firstAttr = seen.indexOf('attr');
		if (first < 0 || firstAttr < 0) {
			fail(`${ax.apply}: expected both ${ax.prop} and ${ax.attr} to be written, saw [${seen.join(', ') || 'nothing'}]`);
		} else if (first > firstAttr) {
			fail(`${ax.apply}: wrote ${ax.attr} BEFORE ${ax.prop}. A reload paints one frame in the previous hue.`);
		} else {
			pass(`${ax.apply}: ${ax.prop} then ${ax.attr}`);
		}

		if (root.getAttribute(ax.attr) !== 'hue') fail(`${ax.apply}: ${ax.attr} is '${root.getAttribute(ax.attr)}', expected 'hue'`);
		if (root.style.getPropertyValue(ax.prop).trim() !== '200') fail(`${ax.apply}: ${ax.prop} is '${root.style.getPropertyValue(ax.prop)}', expected '200'`);
	}

	/* The axes must reach the CASCADE, not only the DOM: a custom property set on :root that no rule
	 * reads changes nothing on the page, and every assertion above would still pass. Measured from
	 * OFF to a hue, in that order, because 0 means off rather than red. */
	axesMod.applyTint(0);
	const off = getComputedStyle(document.body).backgroundColor;
	axesMod.applyTint(200);
	const on = getComputedStyle(document.body).backgroundColor;
	if (off === on) fail(`applyTint(200) changed no computed value on body (${off}); the tint tokens are not reaching the cascade`);
	else pass(`applyTint reaches the cascade: body background ${off} -> ${on}`);
	axesMod.applyTint(0);

	return notes;
}, { mods: sources, axes: COLOR_AXES });

await browser.close();
close();

/* the static half runs before the browser and is reported with the rest: collected and then
 * dropped, it proved nothing — removing an export from fs-axes.js left this gate green. */
result.unshift(...staticChecks);

let failed = 0;
for (const n of result) {
	console.log(`  ${n.ok ? 'ok  ' : 'FAIL'} ${n.m}`);
	if (!n.ok) failed++;
}

for (const e of consoleErrors) { console.log(`  FAIL console: ${e}`); failed++; }

console.log(`\nsmoke: ${result.length} check(s), ${failed} failure(s). This proves the modules come up against a real DOM; it does not prove behaviour on a page (owlab).`);
process.exit(failed ? 1 : 0);

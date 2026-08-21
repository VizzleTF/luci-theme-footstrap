#!/usr/bin/env node
/* THE COUPLING REGISTRY: every assumption this theme makes about luci-base, checked against the
 * luci-base a router actually runs.
 *
 * The theme ships no framework and depends on `+luci-base` alone, which means every fs-*.js module
 * is written against somebody else's code — and against parts of it that are not an API. `L.Poll` is
 * a deprecated alias; `uci.state.values` and `uci.loaded` are private; `L.env.dispatchpath` is
 * re-pointed by us on a client navigation; `network.js` loads three uci packages exactly once and
 * answers out of that cache forever. None of those is a promise anyone made, and each is load-
 * bearing here.
 *
 * What made this file necessary: the network.js coupling broke in the field, not in a gate. The
 * router flushed uci's cache on navigation, network.js never reloaded it, and Status → Channel
 * Analysis and Network → Switch came back empty — reported by a reviewer on the upstream PR, three
 * days after the flush shipped. Every static gate was green, because the fact that broke lives in
 * another package's source.
 *
 * Each entry names WHAT is assumed, WHO in this repo assumes it, and a probe that answers on a live
 * page. A failure is not "the theme is broken" — it is "this luci-base moved, and the module named
 * here has to be looked at before the theme ships against it".
 *
 *   node tools/upstream-contract.mjs [--only owrt2512,owrt2410] [--verbose]
 *
 * Needs a running owlab router (docs/development.md); run it against SNAPSHOT too, which is where
 * luci-base's master lands first.
 */
import { chromium } from 'playwright';
import { stands, login, requireStands } from './lib/stands.mjs';

const VERBOSE = process.argv.includes('--verbose');
const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};

/* Every probe returns `true`, or a STRING saying what it found instead — the string is what a
 * developer reads six months from now, so it names the value, not the expectation. */
const CONTRACT = [
	{
		id: 'env-shape',
		what: 'L.env carries dispatchpath, requestpath, pathinfo, nodespec, scriptname, base_url, cgi_base',
		used_by: 'fs-router.js (re-points all of them on a client navigation), fs-chrome.js, fs-menutree.js, fs-search.js',
		fn: () => {
			const missing = [ 'dispatchpath', 'requestpath', 'pathinfo', 'nodespec', 'scriptname', 'base_url', 'cgi_base' ]
				.filter((k) => !(k in L.env));
			return missing.length ? 'L.env is missing ' + missing.join(', ') : true;
		},
	},
	{
		id: 'poll-alias',
		what: 'the deprecated L.Poll alias still exists, with queue[], start(), stop() and a readable tick',
		used_by: 'fs-router.js — flushes the queue and re-arms the tick so an incoming view polls at once',
		fn: () => {
			if (!L.Poll) return 'L.Poll is gone; fs-router falls back to leaving the queue alone';
			if (!Array.isArray(L.Poll.queue)) return 'L.Poll.queue is not an array: ' + typeof L.Poll.queue;
			if (typeof L.Poll.start !== 'function' || typeof L.Poll.stop !== 'function') return 'L.Poll has no start/stop';
			if (typeof L.Poll.active !== 'function' && !('timer' in L.Poll)) return 'neither L.Poll.active() nor L.Poll.timer is readable';
			return true;
		},
	},
	{
		id: 'uci-cache-shape',
		what: 'uci keeps its document-scoped cache in state.values + loaded, and unload() clears both',
		used_by: 'fs-router.js flushUciCache() — the whole flush is written against these two fields',
		fn: async () => {
			const uci = await L.require('uci');
			if (!uci.state || typeof uci.state.values !== 'object') return 'uci.state.values is not an object';
			if (typeof uci.loaded !== 'object') return 'uci.loaded is not an object';
			for (const m of [ 'load', 'unload', 'sections' ]) if (typeof uci[m] !== 'function') return 'uci.' + m + ' is not a function';
			return true;
		},
	},
	{
		id: 'uci-load-returns-fetched-names',
		what: 'uci.load() answers "which packages did THIS call fetch", not "which exist"',
		used_by: 'fs-router.js flushUciCache() exists precisely because four shipped apps read it as an existence check',
		fn: async () => {
			const uci = await L.require('uci');
			uci.unload([ 'system' ]);
			const first = await uci.load([ 'system' ]);
			const second = await uci.load([ 'system' ]);
			if (!Array.isArray(first) || first.indexOf('system') === -1) return 'a cold uci.load did not report the package it fetched';
			if (Array.isArray(second) && second.indexOf('system') !== -1) return 'a warm uci.load re-reported a cached package — the flush is no longer needed';
			return true;
		},
	},
	{
		id: 'network-loads-uci-once',
		what: 'network.js loads exactly network, wireless and luci inside initNetworkState(), and never again',
		used_by: 'fs-router.js refills those three after the flush; a fourth package here empties a page',
		fn: async () => {
			const src = await (await fetch(L.env.base_url + '/network.js')).text();
			const i = src.indexOf('function initNetworkState');
			if (i === -1) return 'initNetworkState() is gone from network.js — the refill has no basis';
			const chunk = src.slice(i, src.indexOf('function ', i + 30));
			const pkgs = [ ...chunk.matchAll(/uci\.load\('([a-z]+)'\)/g) ].map((m) => m[1]).sort();
			const want = [ 'luci', 'network', 'wireless' ].join(',');
			if (pkgs.join(',') !== want) return 'initNetworkState() now loads [' + pkgs.join(', ') + '], not [' + want + ']';
			if (!/_state\s*!=\s*null\s*\?\s*Promise\.resolve\(_state\)/.test(chunk + src.slice(i, i + 4000)))
				return 'initNetworkState() no longer short-circuits on _state — the refill may be unnecessary';
			return true;
		},
	},
	{
		id: 'require-attaches-to-L',
		what: 'require() publishes each class onto L\'s prototype, so window.L.uci / window.L.network are the instances pages use',
		used_by: 'fs-router.js reads uci and network through window.L rather than a require pragma (the two-L trap)',
		fn: async () => {
			const uci = await L.require('uci');
			if (window.L.uci !== uci) return 'window.L.uci is not the instance require() hands back';
			const net = await L.require('network');
			if (window.L.network !== net) return 'window.L.network is not the instance require() hands back';
			return true;
		},
	},
	{
		id: 'view-class',
		what: 'L.view is a class whose __init__ renders into #view, and whose prototype carries load/render',
		used_by: 'fs-router.js re-instantiates a cached view with `new view.constructor()` and wraps prototype.render',
		fn: () => {
			if (typeof L.view !== 'function') return 'L.view is not a constructor';
			for (const m of [ 'load', 'render' ]) if (!(m in L.view.prototype)) return 'L.view.prototype has no ' + m;
			return true;
		},
	},
	{
		id: 'menu-tree-rooted-at-admin',
		what: 'ui.menu.load() returns the tree ALREADY rooted at admin',
		used_by: 'fs-menutree.js, fs-chrome.js and every live gate that walks the menu',
		fn: async () => {
			const ui = await L.require('ui');
			const tree = await ui.menu.load();
			if (!tree || !tree.children) return 'ui.menu.load() returned no tree';
			/* walk it the way fs-menutree and every live gate do, and check the SHAPE of what comes
			 * out: seeding the walk with the root's own name once produced /admin/admin/... and a
			 * sweep of 404s that read as a clean run */
			const out = [];
			const walk = (node, path) => {
				for (const name of Object.keys(node.children || {})) {
					const child = node.children[name];
					const p = path.concat(name);
					if (child.children && Object.keys(child.children).length) walk(child, p);
					else out.push('/' + p.join('/'));
				}
			};
			walk(tree, []);
			if (!out.length) return 'the menu tree has no leaves';
			const strays = out.filter((p) => !p.startsWith('/admin/'));
			if (strays.length) return 'leaves outside /admin/: ' + strays.slice(0, 3).join(' ');
			if (out.some((p) => p.startsWith('/admin/admin/'))) return 'the tree gained a level — every walked path now doubles admin';
			return true;
		},
	},
	{
		id: 'modal-contract',
		what: 'showModal() builds #modal_overlay beside #view and marks <body> with modal-overlay-active; hideModal() drops the mark and leaves the markup',
		used_by: 'fs-select.js counts a dialog as a table root only while that class is on <body>; fs-fit.js watches it',
		fn: async () => {
			const ui = await L.require('ui');
			ui.showModal('probe', [ E('p', {}, 'probe') ]);
			const overlay = document.getElementById('modal_overlay');
			const marked = document.body.classList.contains('modal-overlay-active');
			ui.hideModal();
			const stillThere = !!document.getElementById('modal_overlay');
			const unmarked = !document.body.classList.contains('modal-overlay-active');
			if (!overlay) return 'showModal() did not create #modal_overlay';
			if (!marked) return 'showModal() no longer marks <body> with modal-overlay-active';
			if (!unmarked) return 'hideModal() left the body class on';
			if (!stillThere) return 'hideModal() now removes the overlay markup — the closed-dialog guard is dead code';
			return true;
		},
	},
	{
		id: 'notifications-host',
		what: 'ui.addNotification() inserts its banner as the first child of #maincontent',
		used_by: 'fs-router.js sweeps those banners on navigation — a full load clears them, SPA has to',
		fn: async () => {
			const ui = await L.require('ui');
			const node = ui.addNotification(null, E('p', {}, 'probe'), 'info');
			const host = node && node.parentElement;
			if (node) node.remove();
			if (!host) return 'addNotification() returned no attached node';
			if (host.id !== 'maincontent') return 'the banner now lands in #' + (host.id || host.className) + ', not #maincontent';
			return true;
		},
	},
	{
		id: 'widget-base-class',
		what: 'ui.AbstractElement is the base widget class on every supported release, and it carries '
			+ 'setUpdateEvents/setChangeEvents — the seam a widget publishes widget-update/widget-change through',
		used_by: 'fs-appearance.js builds its own range slider from it where ui.RangeSlider does not exist',
		fn: async () => {
			const ui = await L.require('ui');
			if (!ui.AbstractElement) return 'ui.AbstractElement is gone; the Appearance sliders have no base class';
			for (const m of [ 'setUpdateEvents', 'setChangeEvents', 'getValue', 'setValue' ])
				if (typeof ui.AbstractElement.prototype[m] !== 'function')
					return 'ui.AbstractElement.prototype has no ' + m;
			return true;
		},
	},
	{
		id: 'slider-widget-available',
		/* ui.RangeSlider arrived in 24.10. On 23.05 its absence took the WHOLE Appearance tab down —
		 * one try/catch, one console line, and a user to report it, because no gate had ever opened a
		 * 23.05 router. Either path is fine; having neither is not. */
		what: 'a range widget is reachable: ui.RangeSlider (24.10+), or ui.AbstractElement to build one from (23.05)',
		used_by: 'fs-appearance.js: the number axes — rounding, tint strength, pattern size/strength, photo dim',
		fn: async () => {
			const ui = await L.require('ui');
			if (ui.RangeSlider) {
				const w = new ui.RangeSlider('5', { min: 0, max: 10 });
				const node = w.render();
				const input = node.querySelector('input[type="range"]');
				return input ? true : 'ui.RangeSlider no longer renders an input[type=range]';
			}
			if (!ui.AbstractElement) return 'no ui.RangeSlider and no ui.AbstractElement: nothing to build a slider from';
			/* the fallback's own machinery, exercised rather than assumed */
			const Slider = ui.AbstractElement.extend({
				/* `options` is not optional: setUpdateEvents reads options.datatype off it */
				__init__(value) { this.value = value; this.options = {}; },
				render() {
					this.el = E('input', { type: 'range', min: 0, max: 10, value: this.value });
					this.setUpdateEvents(this.el, 'input');
					this.setChangeEvents(this.el, 'change');
					return E('div', { class: 'cbi-range-slider' }, [ this.el ]);
				},
				getValue() { return this.el.value; }
			});
			const node = new Slider('5').render();
			return node.querySelector('input[type="range"]') ? true : 'ui.AbstractElement can no longer carry a slider';
		},
	},
	{
		id: 'tabs-api',
		what: 'ui.tabs exposes initTabGroup() and switchTab()',
		used_by: 'fs-chrome.js re-renders the section tab strip; fs-router.js relies on a view calling initTabGroup during render',
		fn: async () => {
			const ui = await L.require('ui');
			if (!ui.tabs) return 'ui.tabs is gone';
			for (const m of [ 'initTabGroup', 'switchTab' ]) if (typeof ui.tabs[m] !== 'function') return 'ui.tabs.' + m + ' is not a function';
			return true;
		},
	},
	{
		id: 'dropdown-popup-is-absolute',
		what: 'an open ui.Dropdown\'s list is position:absolute inside the widget, so ANY overflow ancestor clips it',
		used_by: 'fs-select.js never gives a control-bearing table a scroll container; theme/65-dropdown.css keeps :has(.cbi-dropdown) out of one',
		fn: async () => {
			const ui = await L.require('ui');
			const dd = new ui.Dropdown('a', { a: 'A', b: 'B' });
			const node = dd.render();
			document.getElementById('view').appendChild(node);
			/* the list is a plain <ul> until the widget opens it, which is when it gains `.dropdown`
			 * and the positioning this theme's overflow rules are written against */
			if (typeof dd.openDropdown !== 'function') { node.remove(); return 'ui.Dropdown has no openDropdown()'; }
			dd.openDropdown(node);
			const ul = node.querySelector('ul');
			const pos = ul ? getComputedStyle(ul).position : null;
			const opened = ul ? ul.classList.contains('dropdown') : false;
			node.remove();
			if (!ul) return 'an open dropdown has no list element any more';
			if (!opened) return 'openDropdown() no longer marks the list with .dropdown';
			if (pos !== 'absolute') return 'the dropdown list is position:' + pos + ' — an overflow ancestor may no longer clip it';
			return true;
		},
	},
	{
		id: 'theme-is-registered',
		what: 'uci luci.main.mediaurlbase points at this theme once it is installed',
		used_by: 'root/etc/uci-defaults/30_luci-theme-footstrap — the single source of registration',
		fn: async () => {
			const uci = await L.require('uci');
			await uci.load('luci');
			const base = uci.get('luci', 'main', 'mediaurlbase');
			return /footstrap$/.test(base || '') ? true : 'mediaurlbase is ' + base;
		},
	},
	{
		id: 'expiry-signals',
		what: 'L.Request.addInterceptor() and rpc.addInterceptor() exist, and luci-base still answers a '
			+ 'dead session through them (403 + X-LuCI-Login-Required, and the session.access probe it '
			+ 'fires after a -32002)',
		used_by: 'fs-router.js — watchSession() learns the session is gone and stops claiming navigations, '
			+ 'so the next click is a full load that lands on the login form',
		fn: async () => {
			if (!L.Request || typeof L.Request.addInterceptor !== 'function')
				return 'L.Request.addInterceptor is gone; a dead session would go unnoticed by the router';
			const rpc = await L.require('rpc');
			if (typeof rpc.addInterceptor !== 'function')
				return 'rpc.addInterceptor is gone; the session.access probe cannot be observed';
			/* the two signals are luci-base's, so what is asserted here is that luci-base still LOOKS
			 * at them: notifySessionExpiry is the function both paths end in, and setupDOM is where
			 * they are wired. A rename upstream leaves the router silent, which is the failure this
			 * probe exists to name. */
			if (typeof L.notifySessionExpiry !== 'function')
				return 'LuCI.prototype.notifySessionExpiry is gone: luci-base no longer ends a dead session '
					+ 'the way fs-router assumes';
			return true;
		},
	},
	{
		id: 'menu-acl-shape',
		what: '/admin/menu serves depends.acl and the readonly flag per node',
		used_by: 'fs-menutree.js — readonlyForSegs() folds readonly down the dispatch path the way '
			+ 'check_acl_depends() does, which needs to tell an acl-bearing writable node from an ungated one',
		fn: async () => {
			const ui = await L.require('ui');
			const tree = await ui.menu.load();
			let nodes = 0, gated = 0;
			const walk = (n) => {
				nodes++;
				const acl = n && n.depends && n.depends.acl;
				if (acl && acl.length) gated++;
				for (const k of Object.keys((n && n.children) || {})) walk(n.children[k]);
			};
			walk(tree);
			if (!nodes) return 'the menu tree is empty';
			return gated > 0 ? true
				: 'no node carries depends.acl any more: readonly can no longer be folded client-side '
					+ '(' + nodes + ' nodes walked)';
		},
	},
	{
		id: 'session-id',
		what: 'rpc.getSessionID() answers with the session token',
		used_by: 'fs-prefs.js posts to cgi-upload with the session in a form FIELD, which is what luci-base\'s own upload does',
		fn: async () => {
			const rpc = await L.require('rpc');
			const id = rpc.getSessionID();
			return (typeof id === 'string' && id.length >= 8) ? true : 'getSessionID() returned ' + JSON.stringify(id);
		},
	},
];

const list = requireStands(stands(arg('only', '')), 'upstream-contract');
const browser = await chromium.launch();
let failed = 0;

for (const stand of list) {
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await login(page, stand.base);
	/* a page with a #view and the full module set loaded — Status → Overview is on every router */
	await page.goto(`${stand.base}/admin/status/overview`, { waitUntil: 'domcontentloaded' });
	await page.waitForTimeout(1500);

	const lines = [];
	for (const c of CONTRACT) {
		let verdict;
		try { verdict = await page.evaluate(c.fn); }
		catch (e) { verdict = 'the probe itself threw: ' + String(e).replace(/\s+/g, ' ').slice(0, 140); }
		if (verdict === true) { if (VERBOSE) lines.push(`  ok   ${c.id}`); continue; }
		failed++;
		lines.push(`  FAIL ${c.id}\n       assumed: ${c.what}\n       found:   ${verdict}\n       used by: ${c.used_by}`);
	}
	console.log(`${stand.id} (${stand.distro} ${stand.release}, ${stand.pkg})`);
	if (lines.length) console.log(lines.join('\n'));
	else console.log(`  all ${CONTRACT.length} assumptions hold`);
	await ctx.close();
}
await browser.close();

if (failed) {
	console.error(`\nupstream-contract: ${failed} assumption(s) no longer hold.`);
	console.error('Each names the module in this repo that was written against it — read that module');
	console.error('before shipping against this luci-base.');
	process.exit(1);
}
console.log(`\nupstream-contract: ${CONTRACT.length} assumption(s) hold on ${list.length} router(s).`);

'use strict';
'require baseclass';
'require ui';
'require fs-fit as fit';
'require fs-menutree as tree';
'require fs-chrome as chrome';
'require fs-router as router';
'require fs-prefs as prefs';
'require fs-sheets as sheets';
'require fs-search as search';

/* Page modules: `fs-appearance` (System -> System) and `fs-overview` (Status -> Overview) each
 * serve one page and are required only on it. A `require` pragma would make them a hard
 * dependency — luci.js fetches and evaluates before this factory runs — costing 11.5 KB and 3.8 KB
 * after terser on every admin page that has neither.
 *
 * Each module keeps its own `body[data-page]` observer; `wire()` re-checks the page
 * synchronously, so a module arriving after the stamp still starts watching.
 *
 * The map duplicates a page name that also lives inside each module; `npm run page-modules`
 * derives both sides and fails on drift. */
const PAGE_MODULES = {
	'admin-system-system': 'fs-appearance',
	'admin-status-overview': 'fs-overview'
};
const _pageModules = new Map();
function wirePageModules() {
	/* through window.L, never the factory's `L`: that one carries no require() of its own */
	const RT = window.L;
	const load = () => {
		const name = PAGE_MODULES[document.body.getAttribute('data-page') || ''];
		if (!name || _pageModules.has(name)) return;
		_pageModules.set(name, RT.require(name).then((m) => m.wire()).catch((e) => {
			/* a failed page module costs only its own page's extras: drop it and retry the next
			 * time that page comes up */
			_pageModules.delete(name);
			console.error('footstrap: ' + name + ' did not load', e);
		}));
	};
	/* the server's stamp is already in the DOM; every later one is the router's */
	new MutationObserver(load).observe(document.body, { attributes: true, attributeFilter: [ 'data-page' ] });
	load();
}

/* The three template globals Status -> Overview needs, defined where ordering is guaranteed.
 *
 * `admin_status/index.ut` defines `progressbar`, `renderBox` and `renderBadge` in an inline script
 * the stock includes (18_cpu, 30_network, 60_wifi…) call bare from their own `render()`. An SPA
 * arrival never runs that script, so the theme is their only definition — and a late definition is
 * a `ReferenceError` from a stock include on a page already committed to the document.
 *
 * They live here rather than in `fs-overview.js` because a page module is required DURING the
 * navigation that needs it, racing the router's own require of the view class with nothing
 * ordering the two. This file is required by the footer on every page and evaluates before the
 * router exists.
 *
 * Bodies are verbatim from upstream except for two deltas: L.itemlist -> window.L.itemlist (the
 * two-L trap, docs/spa-router.md), and renderBox's `[title]` — dom.append parses a scalar child as
 * innerHTML (luci.js:1395) and an array member as text (:1383), and this file defines the global on
 * every admin page where upstream defines it on Status -> Overview alone. Same output: nothing in
 * 24.10, 25.12 or master calls renderBox. The typeof guards make each a no-op on a full page load,
 * where the template's own copies win the race. */
function ensureOverviewHelpers() {
	/* eslint-disable no-var -- these three bodies are copies of LuCI's admin_status/index.ut so
	   they can be diffed against upstream when it changes. Modernising the `var`s would break
	   that property, which is what makes carrying the copies safe. */
	if (typeof window.progressbar !== 'function')
		window.progressbar = function(query, value, max, byte) {
			var pg = document.querySelector(query),
			    vn = parseInt(value) || 0,
			    mn = parseInt(max) || 100,
			    fv = byte ? String.format('%1024.2mB', value) : value,
			    fm = byte ? String.format('%1024.2mB', max) : max,
			    pc = Math.floor((100 / mn) * vn);
			if (pg) {
				pg.firstElementChild.style.width = pc + '%';
				pg.setAttribute('title', '%s / %s (%d%%)'.format(fv, fm, pc));
			}
		};
	if (typeof window.renderBox !== 'function')
		window.renderBox = function(title, active, childs) {
			childs = childs || [];
			childs.unshift(window.L.itemlist(E('span'), [].slice.call(arguments, 3)));
			return E('div', { class: 'ifacebox' }, [
				E('div', { class: 'ifacebox-head center ' + (active ? 'active' : '') },
					E('strong', [title])),
				E('div', { class: 'ifacebox-body left' }, childs)
			]);
		};
	if (typeof window.renderBadge !== 'function')
		window.renderBadge = function(icon, title) {
			return E('span', { class: 'ifacebadge' }, [
				E('img', { src: icon, title: title || '' }),
				window.L.itemlist(E('span'), [].slice.call(arguments, 2))
			]);
		};
	/* eslint-enable no-var */
}

ensureOverviewHelpers();

/* Chrome bootstrap: load the menu tree once, hand it to the parts that need it and wire them in
 * order. It renders nothing itself — every piece lives in its own module:
 *
 *   fs-menutree    path <-> menu node, alias/firstchild resolution (a port of dispatcher.uc)
 *   fs-prefs       the Appearance axes and their localStorage
 *   fs-widgets     the inline-SVG wrapper, the disclosure primitives, the colour control
 *   fs-chrome      mode menu, section tabs, the rail toggle, the "does it still fit" measurements
 *   fs-router      the SPA client router (docs/spa-router.md)
 *   fs-sheets      the guard against a view's injected CSS repainting every later page
 *   fs-search      the page-search palette (indexes the same tree, on first open)
 *   fs-appearance  the Appearance controls, appended to the stock System page
 *   fs-overview    the overview grid — a theme module, not a luci-mod-status include
 *   fs-version     the shipped version string
 *
 * They compose by calling, never by inheriting: LuCI makes every required module a singleton, so
 * `base.extend` across modules throws (docs/conventions.md). Hence the main menu arriving as a
 * callback — menu-footstrap.js injects renderMainMenu rather than overriding a method. A
 * require() cycle raises DependencyError, so the graph is a DAG by construction and the shared
 * halves (fs-menutree, fs-prefs) are separate modules. */

return baseclass.extend({
	init(renderMainMenu) {
		/* First, and outside the promise: a third-party sheet that outranks the chrome is already
		 * painting (fs-sheets: openclash's `* { margin: 0; padding: 0 }`). Deferring this to
		 * ui.menu.load() extends the broken frame by a round trip, or forever when the .catch()
		 * below swallows a menu failure. */
		sheets.watchViewSheets();
		prefs.guardDarkStamp();		/* same, for a third party stamping :root */

		ui.menu.load().then((menu) => {
			tree.setTree(menu);
			chrome.setRenderMain(renderMainMenu);

			/* the view this full load already rendered — see fs-router's seed() */
			router.seed();

			/* the bar's "does the menu fit beside the brand" measurement joins the engine the
			 * tables use: re-run on every #view resize and on content mutations */
			fit.add(chrome.fitChrome);

			chrome.renderChrome();
			/* after setTree(): the palette indexes that tree on first open, and records recent
			 * pages from the first navigation onwards */
			search.wire();
			chrome.wireRail();
			chrome.wireIndicatorCounts();
			/* before router.wire(): the router restamps body[data-page] on every SPA navigation,
			 * and that attribute is what the page modules key off */
			wirePageModules();
			router.wire();
			router.wireVisibility();
		/* no sane partial recovery — a throw above loses the menu, the router and the Appearance
		 * tab together — so this fails loudly rather than silently */
		}).catch((e) => console.error('footstrap: chrome init failed', e));
	}
});

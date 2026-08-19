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

/* PAGE MODULES: TWO OF THESE MODULES ARE FOR ONE PAGE EACH, AND USED TO SHIP WITH EVERY PAGE.
 *
 * `fs-appearance` draws the Appearance controls on System -> System and `fs-overview` reshapes
 * Status -> Overview; each watches `body[data-page]` and does nothing anywhere else, which is the
 * right design — a theme may not register a dispatcher node, so it cannot own a route. But they
 * were `require`d in the directive prologue, and a pragma is a hard dependency: luci.js fetches and
 * evaluates them before this file's factory runs, on EVERY admin page. Measured after terser: 11.5
 * KB for the Appearance panel and 3.8 KB for the Overview one, on every cold visit to a page that
 * has neither.
 *
 * So the pragma is replaced by the same observation they were doing for themselves, once, here: on
 * the page they belong to — and only there — the module is required and wired. What each of them
 * then does is unchanged, including its own observer: `wire()` re-checks the page synchronously, so
 * a module that arrives after the stamp still starts watching. The dependency EDGE is what moved,
 * not the behaviour.
 *
 * The map duplicates a page name that also lives inside each module, and `npm run page-modules`
 * derives both sides and fails if they drift — the same trade as the Appearance axes, which are
 * implemented twice on purpose and held by a gate. */
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
			/* a page module that will not load costs its own page's extras and nothing else, so it
			 * is dropped from the map and retried the next time that page comes up */
			_pageModules.delete(name);
			console.error('footstrap: ' + name + ' did not load', e);
		}));
	};
	/* the server's stamp is already in the DOM; every later one is the router's */
	new MutationObserver(load).observe(document.body, { attributes: true, attributeFilter: [ 'data-page' ] });
	load();
}

/* The chrome BOOTSTRAP: load the menu tree once, hand it to the parts that need it, and wire them
 * in the right order. It renders nothing itself — every piece lives in its own module:
 *
 *   fs-menutree    path <-> menu node, alias/firstchild resolution (a port of dispatcher.uc)
 *   fs-prefs       the Appearance axes and their localStorage
 *   fs-widgets     the inline-SVG wrapper, the disclosure primitives, the colour control
 *   fs-chrome      mode menu, section tabs, the rail toggle, the "does it still fit" measurements
 *   fs-router      the SPA client router (docs/spa-router.md)
 *   fs-sheets      the guard against a view's injected CSS repainting every later page
 *   fs-search      the page-search palette (indexes the same tree, on first open)
 *   fs-appearance  the Appearance controls, appended to the stock System page
 *   fs-overview    the overview grid — a THEME module, not a luci-mod-status include
 *   fs-version     the shipped version string (shown in the Appearance section, no network)
 *
 *
 * They compose by CALLING each other, never by inheriting: LuCI instantiates every required module
 * into a singleton, so `base.extend` across modules throws and a module cannot subclass another
 * (docs/conventions.md — proven, not assumed). The same constraint is why the MAIN menu arrives as a callback:
 * menu-footstrap.js is the one renderer, and it injects renderMainMenu here rather than overriding
 * a method. LuCI raises DependencyError on a require() cycle, so the graph above is a DAG by
 * construction — the shared halves (fs-menutree, fs-prefs) were pulled out precisely so that no two
 * modules have to reach across into each other. */

return baseclass.extend({
	/* entry point: load the menu tree, render the mode menu (which drives the injected
	 * renderMainMenu) and the section tabs, and wire the chrome. */
	init(renderMainMenu) {
		/* FIRST, and outside the promise: a third-party sheet that outranks the chrome is already
		 * painting (fs-sheets: openclash's `* { margin: 0; padding: 0 }`). Nothing below depends on
		 * it, and hanging it off ui.menu.load() only made the broken frame last a round-trip
		 * longer — or forever, since the .catch() below swallows a menu failure into console. */
		sheets.watchViewSheets();
		prefs.guardDarkStamp();		/* a third party stamping :root — same shape, different vector */

		ui.menu.load().then((menu) => {
			tree.setTree(menu);
			chrome.setRenderMain(renderMainMenu);

			/* the view this full load already rendered — see fs-router's seed() */
			router.seed();

			/* the bar's "does the menu fit beside the brand" measurement joins the engine the
			 * tables use: it re-runs on every #view resize (a rail collapse and a layout toggle
			 * produce one) and on content mutations */
			fit.add(chrome.fitChrome);

			chrome.renderChrome();
			/* after setTree(): the palette indexes that tree — lazily, on its first open, but its
			 * recent-pages list is recorded from the first navigation onwards */
			search.wire();
			chrome.wireRail();
			chrome.wireIndicatorCounts();
			/* BEFORE router.wire(): the router restamps body[data-page] on every SPA navigation,
			 * and that attribute is what the page modules key off. Wiring the observer after the
			 * router's would still work today (the first stamp is the server's, already in the
			 * DOM), but it would make a route change racy against a listener that is not attached
			 * yet — cheap to order correctly, expensive to debug. */
			wirePageModules();
			router.wire();
			router.wireVisibility();
		/* fs-chrome's renderTabMenu warns about exactly this, and the root chain was left bare: a
		 * throw anywhere in the calls above took out the menu, the router and the Appearance tab
		 * together, silently. It still fails — there is no sane partial recovery — but loudly. */
		}).catch((e) => console.error('footstrap: chrome init failed', e));
	}
});

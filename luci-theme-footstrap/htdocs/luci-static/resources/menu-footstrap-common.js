'use strict';
'require baseclass';
'require ui';
'require fs-fit as fit';
'require fs-menutree as tree';
'require fs-chrome as chrome';
'require fs-router as router';
'require fs-prefs as prefs';
'require fs-sheets as sheets';

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

/* ---- the search palette, held at arm's length ----
 *
 * The palette is 5 KB and opens on a keystroke most sessions never press, so it is not required
 * here: this holds the shortcut and fetches the module on the first gesture. What CANNOT wait is
 * the recents list — it has to be written on every navigation, or it is empty on the first open —
 * and the warm pass that uses it, so both live here, in the file every page already loads.
 *
 * The palette reads the list back from localStorage when it opens, so the two halves share the key
 * and nothing else. */
const RECENT_KEY = 'fs-recent';
const RECENT_MAX = 8;
const RECENT_WARM = 5;

/* A key is a menu path, or a page path plus the heading of a section inside it
 * (`admin/system/system#Footstrap`) — a section has no dispatcher node to name it, and only the
 * source that produced the row can build that half. Exported for exactly that: the writer stays
 * one function, or the two halves would drift on the cap and the de-duplication. */
function remember(key) {
	if (typeof key !== 'string' || !key) return;
	const recent = prefs.lsGetArr(RECENT_KEY).filter((x) => typeof x === 'string');
	prefs.lsSet(RECENT_KEY, JSON.stringify([ key ].concat(recent.filter((p) => p !== key)).slice(0, RECENT_MAX)));
}

/* the page half of a key: what the router can navigate to and what warmRecent() prefetches */
function pageOf(key) {
	const h = key.indexOf('#');
	return h < 0 ? key : key.slice(0, h);
}

/* ---- warm the pages this admin actually uses ----
 *
 * The router's per-link prefetch needs a hover, tap or focus first, so a session's first visit to a
 * page still pays for its module chain. The recents list is the best predictor available and is
 * already on disk; warming the whole menu instead would pull every view module on the box
 * (docs/spa-router.md).
 *
 * The current page is skipped — remember() has just recorded it and it is loaded by definition.
 * Under saveData nothing speculative runs; the per-link prefetch stays, since it follows a
 * deliberate hover or tap. Nothing waits on this, so it runs at idle, with a long fallback delay:
 * it competes with the view's own module fetches and RPCs and must lose that race. */
function warmRecent() {
	try { if (navigator.connection && navigator.connection.saveData) return; } catch (e) {}
	const here = (L.env.dispatchpath || []).join('/');
	/* Keys, not paths: a section key names the page it sits on, and two sections of one page must
	 * warm it once — the module chain is the page's. */
	const keys = prefs.lsGetArr(RECENT_KEY).filter((p) => typeof p === 'string');
	const paths = [ ...new Set(keys.map(pageOf)) ].filter((p) => p !== here).slice(0, RECENT_WARM);
	if (!paths.length) return;
	const go = () => paths.forEach((p) => router.prefetchSegs(p.split('/')));
	if (typeof window.requestIdleCallback === 'function')
		window.requestIdleCallback(go, { timeout: 4000 });
	else
		window.setTimeout(go, 2000);
}

function wireSearch() {
	const btn = document.getElementById('fs-search-btn');
	if (!btn) return;
	const RT = window.L;

	/* the page this full load landed on; onNavigate covers the SPA path afterwards */
	const rememberSegs = (segs) => remember((segs || []).join('/'));
	rememberSegs(L.env.dispatchpath);
	router.onNavigate(rememberSegs);
	warmRecent();

	/* One fetch, on the first gesture. The module builds its overlay and opens itself; every later
	 * gesture reaches the same instance, `require` being a singleton.
	 *
	 * …and then this half stands down: fs-search binds its own toggle to the same button and its
	 * own copies of Ctrl+K and `/`, so while both were live the module's toggle closed the palette
	 * and this one re-opened it in the microtask after, and the button looked broken. */
	let pending = false, loaded = false;
	const open = () => {
		if (pending || loaded) return;
		pending = true;
		RT.require('fs-search').then((m) => { pending = false; loaded = true; m.open(); },
			(e) => { pending = false; console.error('footstrap: fs-search did not load', e); });
	};

	btn.addEventListener('click', () => open());
	/* the same two shortcuts the palette used to own, with the same guard: `/` must not steal a
	 * keystroke from someone typing into a field, a contenteditable, or a .cbi-dropdown, where
	 * fs-select.js's typeahead reads it as a search character */
	document.addEventListener('keydown', (ev) => {
		if (ev.defaultPrevented || loaded) return;
		if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'k' || ev.key === 'K')) {
			ev.preventDefault(); open(); return;
		}
		if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
		if (ev.target.closest?.('input, textarea, select, [contenteditable], .cbi-dropdown')) return;
		ev.preventDefault(); open();
	});
}

/* ---- optional companion packages ----
 *
 * header.ut prints `window.__fsPlugins` from `footstrap.settings.plugin`, a list a package writes
 * from its own uci-defaults; each entry is a LuCI module name, already whitelisted there. The
 * chrome requires each one after everything below is wired — a plugin registers itself through the
 * seams the theme exports (`fs-router.onNavigate`, `fs-search.addSource`) and the theme names
 * nobody. A plugin that throws costs only itself.
 *
 * No plugin, no cost: an empty list is the shipped state and this loop does nothing. */
function loadPlugins() {
	const RT = window.L;
	const names = Array.isArray(window.__fsPlugins) ? window.__fsPlugins : [];
	names.forEach((name) => {
		RT.require(name).catch((e) => console.error('footstrap: plugin ' + name + ' did not load', e));
	});
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
	/* the seam a companion package writes its own rows into the recents list through; see
	 * remember() for what a key is */
	remember,

	init(renderMainMenu) {
		/* First, and outside the promise: a third-party sheet that outranks the chrome is already
		 * painting (fs-sheets: openclash's `* { margin: 0; padding: 0 }`). Deferring this to
		 * ui.menu.load() extends the broken frame by a round trip, or forever when the .catch()
		 * below swallows a menu failure. */
		sheets.watchViewSheets();
		prefs.guardDarkStamp();		/* same, for a third party stamping :root */
		prefs.watchThemeColor();	/* the mobile address bar, from the live page colour */

		ui.menu.load().then((menu) => {
			tree.setTree(menu);
			chrome.setRenderMain(renderMainMenu);

			/* the view this full load already rendered — see fs-router's seed() */
			router.seed();

			/* the bar's "does the menu fit beside the brand" measurement joins the engine the
			 * tables use: re-run on every #view resize and on content mutations */
			fit.add(chrome.fitChrome);

			chrome.renderChrome();
			wireSearch();
			chrome.wireRail();
			chrome.wireIndicatorCounts();
			/* before router.wire(): the router restamps body[data-page] on every SPA navigation,
			 * and that attribute is what the page modules key off */
			wirePageModules();
			router.wire();
			router.wireVisibility();
			/* last: a plugin registers against the parts above, and a broken one must not be able
			 * to take the chrome with it */
			loadPlugins();
		/* no sane partial recovery — a throw above loses the menu, the router and the Appearance
		 * tab together — so this fails loudly rather than silently */
		}).catch((e) => console.error('footstrap: chrome init failed', e));
	}
});

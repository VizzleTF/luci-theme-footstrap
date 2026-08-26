'use strict';
'require baseclass';
'require dom';
'require network';
'require fs-fit as fit';

/* Overview layout only: renders nothing of its own, it re-arranges the STOCK System / Memory /
 * Storage sections into a grid. Content, data and styling stay luci-mod-status's — rendering a
 * custom tree every poll instead (the old 05_footstrap_dashboard.js) flickered and reset mobile
 * scroll. The stock poll fills each section in place via dom.content() and never rebuilds the
 * .cbi-section wrapper, so the wrappers stay inside our grid across polls.
 *
 * This must NOT be filed in LuCI's global include dir (view/status/include/): luci-mod-status
 * evaluates every *.js there, so the file would be fetched and run on routers using another theme,
 * with an `L.env.media` gate only silencing it after the fact. As a chrome module it is
 * unreachable except through this theme's footer partial, which is why nothing below re-checks
 * `L.env.media`. That location also supplied two timing guarantees for free, by evaluating inside
 * index.load(); both are paid for explicitly here — patchOverview() below, and
 * ensureOverviewHelpers() in menu-footstrap-common.js. */
/* section title -> grid role. _() with no msgctxt on purpose: these must resolve to exactly what
 * luci-mod-status resolves to, or the titles stop matching. Built once, not per poll tick. */
const ROLES = { [_('System')]: 'sys', [_('Memory')]: 'mem', [_('Storage')]: 'sto' };

function sectionTitle(sec) {
	/* two title markups, one per release: 25.12 wraps the heading (`.cbi-title > h3`), 24.10 emits
	 * a bare `<h3>` as the section's first child. Matching only one silently disables the grid on
	 * the other. */
	const h = sec.querySelector('.cbi-title h3, :scope > h3');
	if (!h) return '';
	/* the first non-empty TEXT node, not `firstChild`: 25.12 appends a hide/show <span> inside the
	 * same <h3>, so `firstChild` depends on upstream keeping the words first */
	for (const n of h.childNodes) {
		if (n.nodeType !== 3) continue;
		const t = String(n.nodeValue || '').trim();
		if (t) return t;
	}
	return '';
}

/* the wrapper we built, so the poll-tick fast path costs one property read */
let _wrapEl = null;

/* A port name the card had to cut stays readable on hover: styles/pages/20-overview.css ellipses
 * it at one line so every card takes the width the row can spare, and the name is the one thing on
 * a card that cannot be guessed from the rest.
 *
 * The tooltip is set unconditionally: testing `scrollWidth` against `clientWidth` per card would
 * force a synchronous layout on every poll tick, since 29_ports.js rebuilds these tiles each time.
 *
 * Runs BEFORE arrange()'s fast path, which returns as soon as the grid is intact while the tiles
 * under it are new elements. */
function nameTooltips(view) {
	for (const icon of view.querySelectorAll('img[src*="/port_"]')) {
		const head = icon.closest('.ifacebox')?.firstElementChild;
		const name = head ? head.textContent.trim() : '';
		/* `!==`: a mutation inside the tree we observe is not cheap, even when the write is */
		if (name && head.title !== name)
			head.title = name;
	}
}

function arrange() {
	/* an SPA nav can leave the observer wired while another page renders into #view: detach as soon
	 * as the route stops being the overview. body[data-page] carries the DISPATCH path from both
	 * the server template and the router, so /admin/status (firstchild -> overview) matches. */
	if ((document.body.getAttribute('data-page') || '') !== 'admin-status-overview') {
		stopWatch();
		return;
	}
	const view = document.getElementById('view');
	if (!view) return;

	nameTooltips(view);

	/* Fast path: the poll lands here on every tick, forever, and the stock poll never rebuilds
	 * the .cbi-section wrappers, so the grid survives. Deliberately not a disconnect() — if a
	 * future luci-mod-status does rebuild a section, the wrapper loses its children and the slow
	 * path below rebuilds the grid. */
	if (_wrapEl && _wrapEl.isConnected && _wrapEl.parentElement === view && _wrapEl.children.length === 3)
		return;

	const found = {};
	view.querySelectorAll(':scope > .cbi-section').forEach((sec) => {
		const r = ROLES[sectionTitle(sec)];
		if (r && !found[r]) found[r] = sec;
	});
	/* wait until all three stock sections exist */
	if (!(found.sys && found.mem && found.sto)) return;
	/* already wrapped? (first tick after a rebuild re-finds the existing grid) */
	if (found.sys.parentElement && found.sys.parentElement.classList.contains('fs-ovl')) {
		_wrapEl = found.sys.parentElement;
		return;
	}
	const wrap = document.createElement('div');
	wrap.className = 'fs-ovl';
	found.sys.parentNode.insertBefore(wrap, found.sys);
	found.sys.classList.add('fs-ovl-sys'); wrap.appendChild(found.sys);
	found.mem.classList.add('fs-ovl-mem'); wrap.appendChild(found.mem);
	found.sto.classList.add('fs-ovl-sto'); wrap.appendChild(found.sto);
	_wrapEl = wrap;
}

/* Stock sections render async and repaint every poll, so watch #view and re-run arrange(),
 * coalesced and one observer per #view node. The SPA router may replace #view between visits, so
 * re-attach when the observed node is no longer the current one — a singleton bound to the first
 * #view would watch a detached tree and the grid would never apply again. */
let _observer = null, _observedView = null, _routeObserver = null;
function stopWatch() {
	if (_observer) _observer.disconnect();
	_observer = null;
	_observedView = null;
	_wrapEl = null;	/* the grid belongs to the #view we are leaving */
}
function watch() {
	const view = document.getElementById('view');
	if (_observer && _observedView !== view)
		stopWatch();
	arrange();
	/* a chrome module is alive on every page, so without the route check an observer would attach
	 * to #view on, say, the firewall page and re-run arrange() for every table mutation */
	if (_observer || !view ||
	    (document.body.getAttribute('data-page') || '') !== 'admin-status-overview')
		return;
	_observedView = view;
	/* one arrange() per frame, however many mutations a poll tick delivers (fit.frame — the
	 * theme's shared coalescer, fs-fit.js) */
	_observer = new MutationObserver(fit.frame(arrange));
	_observer.observe(view, { childList: true, subtree: true });
}

/* A chrome module is instantiated once per page load, so it has to notice SPA navigation itself.
 * `body[data-page]` is the signal — the server template and fs-router both stamp it with the
 * dispatch path — so one attribute observer covers arriving, leaving and coming back. */
function wire() {
	if (_routeObserver || !document.body)
		return;
	_routeObserver = new MutationObserver(() => {
		if ((document.body.getAttribute('data-page') || '') === 'admin-status-overview')
			onOverview();
		else
			stopWatch();
	});
	_routeObserver.observe(document.body, { attributes: true, attributeFilter: [ 'data-page' ] });
	if ((document.body.getAttribute('data-page') || '') === 'admin-status-overview')
		onOverview();
}

/* Arrival at the overview, from a full page load or an SPA navigation. patchOverview() is
 * idempotent (the __fsProgressive flag), so the two paths cannot double-patch. */
function onOverview() {
	patchOverview();
	watch();
}

/* ---- progressive paint ----
 *
 * Stock `view.status.index` calls poll_status(first_load=true), which Promise.all's over every
 * include's load(), and render() withholds the tree until it resolves — #view stays empty for as
 * long as the slowest include takes (measured: 182 ms, of which most sections were ready at 88 ms
 * and waiting on 29_ports and 60_wifi).
 *
 * Replacing poll_status does two things:
 *  1. each section paints when its own data lands (182 -> ~90 ms). Nothing jumps: the frames are
 *     already in the DOM, a section goes hidden -> filled as on any poll tick;
 *  2. drops the redundant re-fetch — stock adds the poller after the first load and Poll.add()
 *     steps at once, re-fetching everything (~250 ms of ubus) right after the first paint.
 *
 * Not a re-implementation: frames, toggles, includes and their render() stay upstream's.
 * fillSection() transcribes stock's loop in the same order so it can be diffed against index.js;
 * if that shape is gone, the patch is skipped and the page runs stock. */
function fillSection(inc, container, res) {
	if (inc.failed)
		return;
	let content = null;
	if (typeof inc.render === 'function')
		content = inc.render(res);
	else if (inc.content != null)
		content = inc.content;
	if (typeof inc.oneshot === 'function') {
		inc.oneshot(res);
		inc.oneshot = null;
	}
	if (content != null) {
		container.parentNode.style.display = '';
		container.parentNode.classList.add('fade-in');
		if (!inc.hide)
			dom.content(container, content);
	}
}

let _inflight = null;
/* Which containers the in-flight run is filling. The guard is module-level because the duplicate
 * load it kills is, but frames are per render: joining a run blindly joins one filling somebody
 * else's frames, and the second arrival's sections then stay at `display:none` for a full poll
 * interval (5.9 s against 0.4 s). */
let _inflightFor = null;

function pollProgressive(includes, containers, first_load) {
	/* a run already fetching this data for THESE frames is joined rather than duplicated; a run for
	 * older frames is left to finish into the detached nodes it owns */
	if (_inflight && _inflightFor === containers)
		return first_load ? Promise.resolve() : _inflight;

	const run = network.flushCache().then(() => Promise.all(
		includes.map((inc, i) => {
			if (inc.hide && !first_load)
				return null;
			const loaded = (typeof inc.load === 'function')
				? Promise.resolve(inc.load()).catch(() => { inc.failed = true; })
				: Promise.resolve(null);
			/* the point of the patch: fill this section when its own data lands, not at the
			 * end of a Promise.all over all of them */
			return loaded.then((res) => {
				try { fillSection(inc, containers[i], res); }
				catch (e) { console.error('footstrap: overview section failed', e); }
			});
		}).filter(Boolean)
	)).then(() => {
		const ssi = document.querySelector('div.includes');
		if (ssi) { ssi.style.display = ''; ssi.classList.add('fade-in'); }
	});

	_inflight = run.finally(() => {
		/* only if still ours: a newer render may have replaced it mid-run */
		if (_inflightFor === containers) { _inflight = null; _inflightFor = null; }
	});
	_inflightFor = containers;
	/* Nobody awaits this on the first load (the caller gets a fresh Promise.resolve()), so a
	 * rejection would surface as an unhandled one. `run` rejects for one ordinary reason:
	 * flushCache() on an expired session, when the user is already being redirected to login.
	 * Section failures cannot reach it — fillSection runs in a try/catch and inc.load() has its
	 * own .catch. */
	_inflight.catch(() => {});

	/* first load resolves now, so index.render() returns its tree and the frames reach #view while
	 * the sections fill themselves; a poll tick resolves when its data is in, as the poller
	 * expects */
	return first_load ? Promise.resolve() : _inflight;
}

/* Patch the stock overview view: replace poll_status so each section paints when its own data
 * lands.
 *
 * Called from the route (wire()), not at module eval: requiring 'view.status.index' at eval would
 * pull the whole stock view into memory on every page, and on a full load it would race
 * index.load(). Hence the `__fsProgressive` guard and the fact that missing the window is
 * harmless — the page then renders the stock way, one Promise.all, ~90 ms later. */
function patchOverview() {
	/* `window.L`, never the bare `L` this factory was handed. require() passes the object it was
	 * called on into the loaded module's factory, and index.js loads its own includes with that
	 * same `L` — 30_network.js then calls `L.itemlist(...)`, which lives on the runtime instance
	 * (`window.L = new LuCI()`), not on the prototype a chrome module receives. require() caches
	 * by class name, so the first caller decides this for everybody: through the bare `L` the
	 * overview dies mid-render on "L.itemlist is not a function", stuck on "Loading view…" (issue
	 * #22 follow-up). docs/spa-router.md. */
	window.L.require('view.status.index').then((idx) => {
		const proto = idx ? Object.getPrototypeOf(idx) : null;
		if (!proto || proto.__fsProgressive || typeof proto.poll_status !== 'function')
			return;
		proto.__fsProgressive = true;
		proto.poll_status = function(includes, containers, first_load) {
			return pollProgressive(includes, containers, first_load);
		};
	}).catch((e) => console.error('footstrap: overview progressive paint not applied', e));
}

/* `progressbar`, `renderBox` and `renderBadge` are defined in menu-footstrap-common.js, not here:
 * a stock include calls them bare from its own render(), so they must exist before the view class
 * does, and this page module is required during the navigation that races it. */

return baseclass.extend({
	/* called once by menu-footstrap-common's init; everything route-dependent hangs off the
	 * data-page observer inside */
	wire,
});

'use strict';
'require baseclass';
'require dom';
'require network';
'require fs-fit as fit';

/* Footstrap overview LAYOUT-only include: renders NOTHING of its own, only re-arranges the STOCK
 * sections — wrapping System / Memory / Storage in a grid so Memory and Storage sit in a right
 * column beside System. Content, data and styling stay luci-mod-status's. (Do not go back to the
 * old 05_footstrap_dashboard.js: re-rendering a custom tree every poll flickered and reset mobile
 * scroll.) The stock poll updates each section IN PLACE via dom.content() and never rebuilds the
 * .cbi-section wrapper, so once moved into our grid the wrappers stay put across polls.
 *
 * Installed to the global include dir, so LuCI loads it under EVERY theme — hence the gate. */
function isFootstrapTheme() {
	return String(L.env.media || '').indexOf('footstrap') >= 0;
}

/* section title -> grid role. _() with NO msgctxt on purpose: these must resolve to exactly what
 * luci-mod-status resolves to, or the titles stop matching. Built once — it used to cost an
 * allocation plus three _() lookups per poll tick. */
const ROLES = { [_('System')]: 'sys', [_('Memory')]: 'mem', [_('Storage')]: 'sto' };

function sectionTitle(sec) {
	/* TWO title markups, one per release: 25.12 wraps the heading (`.cbi-title > h3`), 24.10
	 * emits a bare `<h3>` as the section's first child. Matching only the wrapped one meant the
	 * grid never applied on 24.10 at all — measured on the dev container: every section tagged
	 * `none`, `.fs-ovl` never built, silently. */
	const h = sec.querySelector('.cbi-title h3, :scope > h3');
	return (h && h.firstChild) ? String(h.firstChild.nodeValue || '').trim() : '';
}

/* the wrapper we built, so the poll-tick fast path costs one property read */
let _wrapEl = null;

function arrange() {
	/* the SPA nav can leave this _observer wired while another page renders into #view — detach as
	 * soon as the route stops being the overview. Both the server template and the SPA router
	 * stamp body[data-page] with the DISPATCH path, so /admin/status (firstchild -> overview)
	 * matches too. */
	if ((document.body.getAttribute('data-page') || '') !== 'admin-status-overview') {
		stopWatch();
		return;
	}
	const view = document.getElementById('view');
	if (!view) return;

	/* Fast path — the poll lands here once a second, forever. The stock poll never rebuilds the
	 * .cbi-section wrappers, so the grid survives and there is nothing to do; proving that used
	 * to cost a querySelectorAll over #view plus a sectionTitle() dig per section, every tick.
	 * Deliberately NOT a disconnect(): if a future luci-mod-status ever DOES rebuild a section,
	 * the wrapper loses its children and the slow path below rebuilds the grid — self-healing. */
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

/* Stock sections render async and repaint every poll, so watch #view and re-run arrange()
 * (coalesced, ONE _observer per #view node — a per-poll _observer leak would slow the page down).
 * The SPA router may REPLACE the #view element between visits, so re-attach when the node we
 * observed is no longer the current one: a singleton bound to the first #view would silently
 * watch a detached tree and the grid would never apply on a later SPA visit. */
let _observer = null, _observedView = null;
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
	if (_observer || !view) return;
	_observedView = view;
	/* one arrange() per frame, however many mutations a poll tick delivers (fit.frame — the
	 * theme's shared coalescer, fs-fit.js) */
	_observer = new MutationObserver(fit.frame(arrange));
	_observer.observe(view, { childList: true, subtree: true });
}

/* ---- progressive paint -----------------------------------------------------
 *
 * Stock `view.status.index` calls poll_status(first_load=true), which Promise.all's over EVERY
 * include's load(), and render() does not return the tree until it resolves — so #view stays
 * EMPTY for as long as the slowest include takes. Measured on the dev router (warm SPA nav):
 * 182 ms of blank page, of which System/CPU/Memory/Storage/DHCP/Network were ready at 88 ms and
 * were simply waiting on 29_ports and 60_wifi (180 ms each).
 *
 * Replacing poll_status does two things:
 *  1. Each section paints when ITS OWN data lands: first content halves, 182 -> ~90 ms. Nothing
 *     jumps — the frames are already in the DOM (built before poll_status is called), a section
 *     just goes hidden -> filled, exactly as on a stock poll tick.
 *  2. Kills the redundant re-fetch: stock adds the poller only after the first load completes
 *     and Poll.add() steps at once, so the overview re-fetched EVERYTHING (~250 ms of ubus)
 *     right after the first paint. The in-flight guard joins that to the run already going.
 *
 * NOT a re-implementation — frames, toggles, includes and their render() stay upstream's.
 * fillSection() transcribes stock's own loop in the same order so it can be diffed against
 * index.js when luci-mod-status changes; if that shape is gone, the patch is skipped and the
 * page runs stock. */
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

function pollProgressive(includes, containers, first_load) {
	/* A run is already fetching exactly this data — join it instead of starting a second
	 * stampede of the same RPCs. This is what kills the duplicate load. */
	if (_inflight)
		return first_load ? Promise.resolve() : _inflight;

	const run = network.flushCache().then(() => Promise.all(
		includes.map((inc, i) => {
			if (inc.hide && !first_load)
				return null;
			const loaded = (typeof inc.load === 'function')
				? Promise.resolve(inc.load()).catch(() => { inc.failed = true; })
				: Promise.resolve(null);
			/* the point of the patch: fill THIS section the moment ITS data is here,
			 * not at the end of a Promise.all over all of them */
			return loaded.then((res) => {
				try { fillSection(inc, containers[i], res); }
				catch (e) { console.error('footstrap: overview section failed', e); }
			});
		}).filter(Boolean)
	)).then(() => {
		const ssi = document.querySelector('div.includes');
		if (ssi) { ssi.style.display = ''; ssi.classList.add('fade-in'); }
	});

	_inflight = run.finally(() => { _inflight = null; });

	/* First load: resolve NOW so index.render() returns its tree and the frames reach #view
	 * immediately; the sections fill themselves. A poll tick resolves when the data is in —
	 * that is what the poller expects. */
	return first_load ? Promise.resolve() : _inflight;
}

/* Patch the stock overview view while index.load() is requiring its includes — after the instance
 * exists, before render() is called: the one window where replacing poll_status is safe. Covers a
 * full page load and an SPA nav alike, since both go through index.load(). */
function patchOverview() {
	L.require('view.status.index').then((idx) => {
		const proto = idx ? Object.getPrototypeOf(idx) : null;
		if (!proto || proto.__fsProgressive || typeof proto.poll_status !== 'function')
			return;
		proto.__fsProgressive = true;
		proto.poll_status = function(includes, containers, first_load) {
			return pollProgressive(includes, containers, first_load);
		};
	}).catch((e) => console.error('footstrap: overview progressive paint not applied', e));
}

/* Status→Overview is a `template` node whose server template (admin_status/index.ut) defines 3
 * globals the stock status includes use (18_cpu/20_memory/25_storage/…) and then instantiates
 * view.status.index. Arriving by the theme's SPA router never runs that inline <script>, so
 * define them here — at module eval, i.e. inside index.load(), before ANY include renders —
 * guarded, so a full load's copies (any theme) are not clobbered. Lives in this include and not
 * in fs-router.js on purpose: the router ships on every page, and this ~1.1 KB is overview-only.
 * Bodies are verbatim from upstream except L.itemlist → window.L.itemlist (the two-L trap,
 * docs/14). */
function ensureOverviewHelpers() {
	/* eslint-disable no-var -- these three bodies are copied VERBATIM from LuCI's
	   admin_status/index.ut so they can be diffed against upstream when it changes.
	   Modernising the `var`s would silently break that property, which is the whole
	   reason the copies are safe to carry. */
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
					E('strong', title)),
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
/* Unconditional (no theme gate): on a full load — any theme — the template's own copies exist
 * first and the typeof guards make this a no-op; on an SPA arrival they are what saves the page. */
ensureOverviewHelpers();

/* Module-evaluation time = inside index.load(), before render(). From render() it would be too
 * late: poll_status has already been called by then. */
if (isFootstrapTheme())
	patchOverview();

return baseclass.extend({
	title: '',            /* no section title -> stock renders an empty wrapper */
	render() {
		if (!isFootstrapTheme())
			return E([]);
		watch();
		/* marker lets CSS hide our own empty stock .cbi-section wrapper */
		return E('div', { 'class': 'fs-ovl-marker', 'style': 'display:none' });
	}
});

'use strict';
'require baseclass';

/* Footstrap overview LAYOUT-only include.
 *
 * Unlike the old 05_footstrap_dashboard.js (which re-rendered a whole custom
 * tree every poll and flickered/reset scroll on mobile), this include renders
 * NOTHING itself. It only re-arranges the STOCK overview sections: it wraps the
 * System / Memory / Storage sections in a grid container so Memory and Storage
 * sit in a right column beside System — the rest of the stock content, data and
 * per-section styling stay exactly as luci-mod-status renders them.
 *
 * The stock poll (index.js) updates each section IN PLACE via
 * dom.content(container, ...) — it never rebuilds the .cbi-section wrapper — so
 * once we move those wrappers into our grid they stay put across polls, and only
 * each section's small inner body repaints (minimal flicker, no full-tree swap).
 *
 * Installed to the global include dir, so it loads under every theme; gate on a
 * footstrap theme being active (see 05_footstrap_dashboard.js rationale). */
function isFootstrapTheme() {
	return String(L.env.media || '').indexOf('footstrap') >= 0;
}

/* section title -> grid role. Titles via _() to match the stock locale. */
function roleMap() {
	return { [_('System')]: 'sys', [_('Memory')]: 'mem', [_('Storage')]: 'sto' };
}

function sectionTitle(sec) {
	const h = sec.querySelector('.cbi-title h3');
	return (h && h.firstChild) ? String(h.firstChild.nodeValue || '').trim() : '';
}

function arrange() {
	/* the theme's SPA nav can leave this observer wired while another page
	 * renders into #view — detach as soon as the route stops being the overview,
	 * instead of re-running on every mutation of every subsequent page. Both the
	 * server template and the SPA router stamp body[data-page]. */
	if ((document.body.getAttribute('data-page') || '') !== 'admin-status-overview') {
		stopWatch();
		return;
	}
	const view = document.getElementById('view');
	if (!view) return;
	const map = roleMap(), found = {};
	view.querySelectorAll(':scope > .cbi-section').forEach((sec) => {
		const r = map[sectionTitle(sec)];
		if (r && !found[r]) found[r] = sec;
	});
	/* wait until all three stock sections exist */
	if (!(found.sys && found.mem && found.sto)) return;
	/* already wrapped? nothing to do (poll re-render lands here every time) */
	if (found.sys.parentElement && found.sys.parentElement.classList.contains('fs-ovl'))
		return;
	const wrap = document.createElement('div');
	wrap.className = 'fs-ovl';
	found.sys.parentNode.insertBefore(wrap, found.sys);
	found.sys.classList.add('fs-ovl-sys'); wrap.appendChild(found.sys);
	found.mem.classList.add('fs-ovl-mem'); wrap.appendChild(found.mem);
	found.sto.classList.add('fs-ovl-sto'); wrap.appendChild(found.sto);
}

/* Stock sections render/re-render async (they sort after us and repaint every
 * poll), so watch #view and re-run arrange() on change (debounced, ONE observer
 * per #view node — a per-poll observer leak would slow the page down). The SPA
 * router may REPLACE the #view element between visits, so watch() re-attaches
 * whenever the node it observed is no longer the current one; a singleton bound
 * forever to the first #view would silently watch a detached tree and the grid
 * would never apply on a later SPA visit. */
let observer = null, observedView = null;
function stopWatch() {
	if (observer) observer.disconnect();
	observer = null;
	observedView = null;
}
function watch() {
	const view = document.getElementById('view');
	if (observer && observedView !== view)
		stopWatch();
	arrange();
	if (observer || !view) return;
	observedView = view;
	let pending = false;
	observer = new MutationObserver(() => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => { pending = false; arrange(); });
	});
	observer.observe(view, { childList: true, subtree: true });
}

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

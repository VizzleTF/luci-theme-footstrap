/* A page fs-fit can run its state machine against, with no layout engine behind it.
 *
 * fs-fit decides everything from a handful of reads — `scrollTop()`, a box's `min-height` against
 * its measured height, a reference element's `top` — and writes back through `scrollTo`. Here every
 * one of those reads is a number the test sets, so a scenario is "the box grew 120px, the reference
 * did not move, the offset did not move" stated directly, and the assertion is which exit the
 * correction took (`lateWhy()`, `anchorWhy()`) and where the offset ended up.
 *
 * What it does NOT do: dispatch events or produce frames. `requestAnimationFrame` is a macrotask,
 * the MutationObserver never fires on its own — a test hands the observer its records. Anything that
 * depends on real layout is tools/scroll-anchor.mjs's, on a stand. */
import { loadModule, fakeWindow, fakeDocument, installBrowserGlobals } from './luci-module.mjs';

const observers = [];
globalThis.MutationObserver = class {
	constructor(cb) { this.cb = cb; observers.push(this); }
	observe() {}
	disconnect() {}
	takeRecords() { return []; }
};
globalThis.requestAnimationFrame = (fn) => globalThis.setTimeout(() => fn(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => globalThis.clearTimeout(id);
/* the module reads these bare, inside try/catch; a key set here is what the dev switches read */
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null) };
installBrowserGlobals();

/* one element: enough surface for holdFloor(), anchorRef() and the observer callbacks */
export function el({ classes = [], attrs = {}, top = 0, height = 0, parent = null } = {}) {
	const e = {
		nodeType: 1, isConnected: true, parentElement: null, kids: [],
		style: {}, dataset: {},
		attrs: new Map(Object.entries(attrs)),
		classList: {
			contains: (c) => classes.includes(c),
			add: (c) => { if (!classes.includes(c)) classes.push(c); },
			remove: (c) => { const i = classes.indexOf(c); if (i >= 0) classes.splice(i, 1); }
		},
		rect: { top, left: 0, width: 800, height },
		get offsetHeight() { return this.rect.height; },
		getBoundingClientRect() {
			return { top: this.rect.top, left: this.rect.left, width: this.rect.width,
				height: this.rect.height, bottom: this.rect.top + this.rect.height };
		},
		getClientRects() { return [ this.getBoundingClientRect() ]; },
		hasAttribute(n) { return this.attrs.has(n); },
		getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; },
		setAttribute(n, v) { this.attrs.set(n, String(v)); },
		removeAttribute(n) { this.attrs.delete(n); },
		contains(n) { for (let p = n; p; p = p.parentElement) if (p === this) return true; return false; },
		matches(sel) { return matchOne(this, sel); },
		closest(sel) { for (let p = this; p; p = p.parentElement) if (matchOne(p, sel)) return p; return null; },
		querySelectorAll(sel) {
			const out = [];
			const walk = (n) => { for (const k of n.kids) { if (matchOne(k, sel)) out.push(k); walk(k); } };
			walk(this);
			return out;
		},
		querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
	};
	if (parent) { e.parentElement = parent; parent.kids.push(e); }
	return e;
}

/* the selectors fs-fit actually asks of a page; anything else matches nothing */
function matchOne(e, sel) {
	switch (sel) {
	case '[data-fs-floor]': return e.attrs.has('data-fs-floor');
	case '[data-fs-chrome]': return e.attrs.has('data-fs-chrome');
	case '.table.fs-dt': return e.classList.contains('table') && e.classList.contains('fs-dt');
	default: return false;
	}
}

/* A page: `#view` holding `boxes` (each already floored at `minHeight`, measuring `height`) and one
 * reference element the hit test lands on. `engine: 'off'` takes the non-anchoring path. */
export function page({ scrollY = 1000, docHeight = 5000, boxes = [], refTop = 300, engine = 'on',
	pageName = 'admin-status-overview' } = {}) {
	for (const k of Object.keys(store)) delete store[k];
	if (engine === 'off') store.fsEngineAnchor = 'off';

	const host = el({ attrs: { id: 'view' }, top: 0, height: docHeight });
	const made = boxes.map((b) => {
		const box = el({ attrs: { 'data-fs-floor': '' }, top: b.top ?? 100, height: b.height, parent: host });
		box.style.minHeight = b.minHeight + 'px';
		return box;
	});
	const ref = el({ top: refTop, height: 40, parent: host });

	const win = fakeWindow({
		innerWidth: 800, innerHeight: 900, scrollY,
		scrollTo(x, y) { this.scrollY = Math.max(0, Math.min(y, docHeight - 900)); },
		getComputedStyle: () => ({ display: 'block', overflowY: 'visible', getPropertyValue: () => '' })
	});
	const doc = fakeDocument({
		body: { getAttribute: (n) => (n === 'data-page' ? pageName : null), appendChild() {} },
		documentElement: { scrollHeight: docHeight, clientHeight: 900, dataset: {},
			getAttribute: () => null, hasAttribute: () => false, setAttribute() {},
			classList: { add() {}, remove() {}, contains: () => false } },
		getElementById: (id) => (id === 'view' ? host : null),
		elementFromPoint: () => ref
	});

	const before = observers.length;
	const fit = loadModule('fs-fit', { window: win, document: doc });
	/* the observers exist only once a fitter is registered; this one measures nothing */
	fit.add(() => {});
	const mo = observers.slice(before);
	/* observeContent() registers three observers, in this order */
	const observe = () => ({ content: mo[0], flag: mo[1], tabs: mo[2] });

	return {
		win, doc, host, ref, fit, boxes: made, observe,
		/* fire the `scroll` listener the module put on window */
		scroll() { win.listeners.find((l) => l.type === 'scroll').fn({ target: doc }); },
		/* a childList record the way the observer would deliver it */
		record(target, { added = 1, removed = 0 } = {}) {
			return { type: 'childList', target,
				addedNodes: Array.from({ length: added }, () => ({})),
				removedNodes: Array.from({ length: removed }, () => ({})) };
		}
	};
}

export const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));

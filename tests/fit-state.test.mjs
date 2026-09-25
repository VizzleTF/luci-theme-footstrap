/* fs-fit's correction state machine, driven by numbers rather than by a page.
 *
 * tools/scroll-anchor.mjs proves the corrections hold on a real engine; this proves the decisions
 * between them — which exit a correction takes, when the engine stops being trusted and when trust
 * comes back, whose scroll event the motion sampler ignores — because a stand shows only the offset
 * at the end, and every one of these decisions has a twin that ends at the same offset for the wrong
 * reason. The sweep reads the same exports this file asserts on. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeWindow, fakeDocument, installBrowserGlobals } from './lib/luci-module.mjs';

/* ---- a page fs-fit can run its state machine against, with no layout engine behind it ----
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
function el({ classes = [], attrs = {}, top = 0, height = 0, parent = null } = {}) {
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
function page({ scrollY = 1000, docHeight = 5000, boxes = [], refTop = 300, engine = 'on',
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

const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));

const GROW = 120;

/* a poll refill: the floored box is `by` taller than the floor it wears */
function refill(p, box, by) {
	box.rect.height = parseFloat(box.style.minHeight) + by;
	p.observe().content.cb([ p.record(box) ]);
}

test('the sweep can read every export it waits on', () => {
	const { fit } = page();
	for (const name of [ 'scrolling', 'restAt', 'engineTrusted', 'lateWhy', 'lateTrail', 'anchorWhy', 'anchorTrail' ])
		assert.equal(typeof fit[name], 'function', name);
	assert.equal(fit.engineTrusted(), true, 'an engine that knows overflow-anchor is trusted at load');
	assert.equal(fit.lateWhy(), null);
	assert.deepEqual(fit.lateTrail(), []);
});

test('a refill the trusted engine did not anchor is written back, and two of them cost the trust', async () => {
	const p = page({ boxes: [ { minHeight: 500, height: 500 } ] });
	const [ box ] = p.boxes;
	p.fit.schedule();
	await settle();
	assert.equal(p.fit.restAt(), 1000, 'a still page has a reference');

	refill(p, box, GROW);
	await settle();
	assert.equal(p.fit.lateWhy(), 'wrote-' + GROW, 'the growth witness carries the whole correction');
	assert.equal(p.win.scrollY, 1000 + GROW);
	assert.equal(box.style.minHeight, '620px', 'the floor follows the content');
	assert.equal(p.fit.engineTrusted(), true, 'one miss is headroom');

	refill(p, box, GROW);
	await settle();
	assert.equal(p.fit.lateWhy(), 'wrote-' + GROW);
	assert.equal(p.win.scrollY, 1000 + 2 * GROW);
	assert.equal(p.fit.engineTrusted(), false, 'the second miss moves the fork');
	assert.match(p.fit.lateTrail().at(-1), /^wrote-120@\d+$/, 'the trail carries the clock');
});

test('trust comes back after two refills the engine handled on its own', async () => {
	const p = page({ boxes: [ { minHeight: 500, height: 500 } ] });
	const [ box ] = p.boxes;
	p.fit.schedule();
	await settle();
	refill(p, box, GROW); await settle();
	refill(p, box, GROW); await settle();
	assert.equal(p.fit.engineTrusted(), false);

	/* the reference holds its screen position across the refill: the engine's own work */
	refill(p, box, GROW); await settle();
	assert.equal(p.fit.engineTrusted(), false, 'one hit is not yet recovery');
	assert.equal(p.fit.anchorWhy(), 'no-drift', 'the fast path had nothing to write');
	refill(p, box, GROW); await settle();
	assert.equal(p.fit.engineTrusted(), true);
	assert.equal(p.win.scrollY, 1000 + 2 * GROW, 'recovery wrote nothing');
});

test('the theme reads its own write as settling, not as the reader moving', async () => {
	const p = page({ engine: 'off', boxes: [ { minHeight: 500, height: 500 } ] });
	p.fit.schedule();
	await settle();
	assert.equal(p.fit.restAt(), 1000);

	/* content grew above the reference: its top moved down by GROW, the offset did not follow */
	p.ref.rect.top += GROW;
	p.observe().content.cb([ p.record(p.boxes[0]) ]);
	await settle();
	assert.equal(p.fit.anchorWhy(), 'wrote-' + GROW);
	assert.equal(p.win.scrollY, 1000 + GROW);

	p.scroll();
	assert.equal(p.fit.scrolling(), false, 'the scroll event of the write itself');
	p.scroll();
	assert.equal(p.fit.scrolling(), false, 'asked twice of the same pixel, answered the same');
	p.win.scrollY += 50;
	p.scroll();
	assert.equal(p.fit.scrolling(), true, 'a different pixel is the reader');
});

test('a batch that only removes nodes is not a page to correct against', async () => {
	const p = page({ boxes: [ { minHeight: 500, height: 500 } ] });
	const [ box ] = p.boxes;
	p.fit.schedule();
	await settle();
	p.observe().content.cb([ p.record(box, { added: 0, removed: 3 }) ]);
	assert.equal(p.fit.lateWhy(), 'emptying');
	await settle();
	assert.equal(p.win.scrollY, 1000, 'nothing written');
});

test('#view emptied and refilled is a page swap: the reference is dropped', async () => {
	const p = page({ boxes: [ { minHeight: 500, height: 500 } ] });
	p.fit.schedule();
	await settle();
	assert.equal(p.fit.restAt(), 1000);
	p.observe().content.cb([ p.record(p.host, { added: 4, removed: 4 }) ]);
	assert.equal(p.fit.restAt(), null);
	assert.equal(p.fit.lateWhy(), null, 'no correction was armed');
});

test('a floor is re-measured only where the mutation reached', async () => {
	const p = page({ boxes: [ { minHeight: 100, height: 150 }, { minHeight: 200, height: 260 } ] });
	const [ a, b ] = p.boxes;
	const inB = el({ parent: b });
	p.fit.schedule();
	await settle();
	/* schedule()'s own run() sweeps everything: reset the untouched one to a stale value */
	a.style.minHeight = '100px';
	p.observe().content.cb([ p.record(inB) ]);
	assert.equal(b.style.minHeight, '260px');
	assert.equal(a.style.minHeight, '100px', 'a box nothing touched keeps the floor it had');
	p.observe().flag.cb([ {} ]);
	assert.equal(a.style.minHeight, '150px', 'the class observer sweeps every box');
});

test('an attribute write that changed nothing does not run the fitters', async () => {
	const p = page();
	let runs = 0;
	p.fit.add(() => { runs++; });
	assert.equal(runs, 1, 'registration runs the fitter once');
	const { tabs } = p.observe();
	const rec = (attributeName, oldValue, now, dataset = {}) =>
		({ attributeName, oldValue, target: { getAttribute: () => now, dataset } });
	tabs.cb([ rec('class', 'a', 'a', { field: 'x' }) ]);
	assert.equal(runs, 1, 'same value');
	tabs.cb([ rec('class', 'a', 'a b') ]);
	assert.equal(runs, 1, 'a class change off a [data-field] element is the poll rewriting rows');
	tabs.cb([ rec('class', 'a', 'a hidden', { field: 'x' }) ]);
	assert.equal(runs, 2, 'depends() hiding a row');
	tabs.cb([ rec('hidden', null, '') ]);
	assert.equal(runs, 3, 'a disclosure closing');
	tabs.cb([ rec('data-tab-active', 'false', 'false') ]);
	assert.equal(runs, 3);
});

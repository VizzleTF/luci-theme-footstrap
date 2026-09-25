/* The poll-status pill's click handler is bound only ONCE, when ui.showIndicator (ui.js) first
 * builds its <span> — updating an EXISTING span never rebinds it. So any teardown that leaves a
 * stale, handler-less span in place for the next `poll-start` to reuse produces a pill that is
 * visible and permanently inert.
 *
 * Two different callers empty the poll queue and reach `L.Poll.stop()`, which is what needs the
 * pill hidden: fs-router's own navigate() teardown, and a VIEW emptying its own queue with no
 * navigation at all (`L.Poll.remove()` — `luci-mod-status`'s Realtime Graphs on unload,
 * `luci-app-banip`'s log template). A version of this fix that called the hide only from
 * navigate()'s teardown covered the first and silently missed the second — reproduced live,
 * owrt2410b/owrt2512b, add-then-remove on Statistics with no navigation:
 * `{"active":false,"q":0,"pill":{"text":"Paused","clickable":true}}`, unchanged by a click.
 *
 * One `poll-stop` LISTENER covers both callers, since `stop()` dispatches the same event either
 * way — but a listener racing luci.js's own (`showIndicator('poll-status', 'Paused', null,
 * 'inactive')`, registered from `setupDOM()` after an async chain, against this module's own eval,
 * from the inline `L.require('menu-footstrap')` in footer.ut) is exactly the original bug:
 * network/cache timing decided which one ran first, and a hide that ran BEFORE luci.js's own
 * "Paused" show left a fresh, handler-less span for the next `poll-start` to reuse forever. The fix
 * defers the actual hide by one microtask: `stop()` dispatches synchronously to every listener
 * registered at that moment, and a microtask runs only once that whole synchronous turn — every
 * `poll-stop` listener included, in whichever order they ran — has unwound. So the check always
 * sees the state stock's listener actually left, never races it, and covers whichever caller emptied
 * the queue without needing to know which one it was.
 *
 * This drives the real module: `hidePollIndicatorIfEmpty` directly for the plain cases, and through
 * an actual dispatched `poll-stop` (awaiting a microtask, the way the shipped listener defers) for
 * the ones that must prove the deferral itself — against a faithful port of ui.js's
 * `showIndicator`/`hideIndicator` and luci.js's `Poll` (queue/tick/timer, `add()`'s auto-start,
 * `remove()`'s auto-stop, and the events dispatched synchronously to `document`) — with the stock
 * indicator listener wired both BEFORE and AFTER fs-router's own module eval, to show neither order
 * has anything left to hold on to. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, fakeWindow, fakeDocument, fakeL } from './lib/luci-module.mjs';

/* ui.showIndicator/hideIndicator (ui.js ~4501-4557): a span's click handler is fixed at creation and
 * an update to an existing span never touches it — the fact the historical bug turned on. */
function realishUi() {
	const spans = new Map();
	return {
		spans,
		showIndicator(id, label, handler, style) {
			const handlerFn = typeof handler === 'function' ? handler : null;
			let span = spans.get(id);
			if (!span) {
				span = { label: null, style: null, handler: handlerFn };
				spans.set(id, span);
			}
			span.label = label;
			span.style = (style === 'inactive') ? 'inactive' : 'active';
			return true;
		},
		hideIndicator(id) {
			return spans.delete(id);
		}
	};
}

/* LuCI.poll (luci.js ~1091-1192), ported the same way: `add()`'s auto-start when a fresh `tick` is
 * already set from a prior start()-on-empty-queue, `remove()`'s own auto-stop when the queue it
 * leaves is empty (the exact call the missed finding turns on), and `start()`/`stop()` dispatching
 * their events to `document` synchronously and ONLY on an actual state change. */
function realishPoll(doc) {
	function dispatch(type) {
		doc.listeners.filter((l) => l.type === type).forEach((l) => l.fn());
	}
	return {
		queue: [], tick: undefined, timer: undefined,
		active() { return this.timer != null; },
		start() {
			if (this.active()) return false;
			this.tick = 0;
			if (this.queue.length) { this.timer = 1; dispatch('poll-start'); }
			return true;
		},
		stop() {
			if (!this.active()) return false;
			dispatch('poll-stop');
			this.timer = undefined;
			this.tick = undefined;
			return true;
		},
		add(fn, interval) {
			this.queue.push({ fn, interval });
			if (this.tick != null && !this.active()) this.start();
			return true;
		},
		remove(fn) {
			const len = this.queue.length;
			this.queue = this.queue.filter((e) => e.fn !== fn);
			if (!this.queue.length && this.stop()) this.tick = 0;
			return this.queue.length !== len;
		}
	};
}

/* luci.js:2738-2746, ported: the click handler toggles on whatever `poll` is active right now. */
function wireStockIndicator(doc, ui, poll) {
	doc.addEventListener('poll-start', () => {
		ui.showIndicator('poll-status', 'Refreshing', () => (poll.active() ? poll.stop() : poll.start()));
	});
	doc.addEventListener('poll-stop', () => {
		ui.showIndicator('poll-status', 'Paused', null, 'inactive');
	});
}

/* `order` is 'stock-first' (what happened to work before the fix) or 'stock-last' (the reported
 * break) — the exact race this fix makes irrelevant. */
function boot(order) {
	const doc = fakeDocument();
	const win = fakeWindow();
	const L = fakeL();
	const ui = realishUi();
	const poll = realishPoll(doc);
	L.Poll = poll;

	if (order === 'stock-first') wireStockIndicator(doc, ui, poll);
	const mod = loadModule('fs-router', { window: win, document: doc, L, stubs: { ui } });
	if (order === 'stock-last') wireStockIndicator(doc, ui, poll);

	return { doc, win, L, ui, poll, mod };
}

/* the shipped listener defers its hide by exactly one microtask (queueMicrotask); one empty turn is
 * enough to let it run, and a second costs nothing if it is not */
async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
}

/* what navigate() does around the require()/staging chain this harness has no DOM for: flush, stop
 * (which dispatches `poll-stop` to whatever is registered, including fs-router's own deferred
 * listener), let the deferral run, then start on the now-empty queue */
async function teardown(poll) {
	poll.queue.length = 0;
	poll.stop();
	await flushMicrotasks();
	poll.start();
}

for (const order of [ 'stock-first', 'stock-last' ]) {
	test(`${order}: the hide is deferred past the synchronous poll-stop dispatch`, async () => {
		const { ui, poll } = boot(order);
		poll.tick = 0;
		poll.add(() => {}, 1000);

		poll.queue.length = 0;
		poll.stop();
		/* right after the synchronous dispatch returns, stock's listener has already run (whichever
		 * order it registered in) and the span still stands — the hide has not fired yet */
		assert.ok(ui.spans.has('poll-status'), 'the hide must not run inside the synchronous dispatch');
		await flushMicrotasks();
		assert.equal(ui.spans.has('poll-status'), false, 'and must have run by the next microtask');
	});

	test(`${order}: the pill is clickable after navigating polled page -> polled page`, async () => {
		const { ui, poll } = boot(order);

		/* the outgoing page is already polling, exactly as if a previous navigate() had start()ed an
		 * empty queue and this page's own view had just added its poller */
		poll.tick = 0;
		poll.add(() => {}, 1000);
		assert.equal(typeof ui.spans.get('poll-status').handler, 'function', 'sanity: pill has a handler');

		await teardown(poll);
		/* the incoming page polls too — its own poll.add() runs well after the deferred hide above,
		 * the same way a real navigate()'s require()/render() chain always lands after a microtask
		 * queued during the synchronous stop() that preceded it */
		poll.add(() => {}, 1000);

		const span = ui.spans.get('poll-status');
		assert.ok(span, 'the pill must exist on a page that polls');
		assert.equal(typeof span.handler, 'function',
			'the pill must be clickable after the navigation, regardless of listener order');
		assert.equal(span.label, 'Refreshing');

		/* and it stays a real toggle: clicking it now must pause, clicking again must resume */
		span.handler();
		assert.equal(poll.active(), false, 'the pill\'s own handler must still stop the poll');
		assert.equal(ui.spans.get('poll-status').handler, span.handler, 'a manual pause must not rebind it');
		span.handler();
		assert.equal(poll.active(), true, 'and resume it again');
	});

	test(`${order}: the pill hides on a page with no polls`, async () => {
		const { ui, poll } = boot(order);

		poll.tick = 0;
		poll.add(() => {}, 1000);
		assert.ok(ui.spans.has('poll-status'));

		await teardown(poll);
		/* the incoming page never calls poll.add() */

		assert.equal(ui.spans.has('poll-status'), false,
			'a page with nothing to poll must not report "Paused" about a poll that does not exist');
	});

	test(`${order}: a page that empties its own queue with Poll.remove(), no navigation, hides the pill`, async () => {
		/* the finding this round is for: luci-mod-status's Realtime Graphs and luci-app-banip's log
		 * template call L.Poll.remove() on unload, never navigate() — reproduced live on
		 * owrt2410b/owrt2512b, add-then-remove on Statistics, pill left reading "Paused" and clickable
		 * with nothing left to poll */
		const { ui, poll } = boot(order);
		const fn = () => {};
		poll.tick = 0;
		poll.add(fn, 1000);
		assert.ok(ui.spans.has('poll-status'), 'sanity: the page was polling');

		poll.remove(fn);
		await flushMicrotasks();

		assert.equal(ui.spans.has('poll-status'), false,
			'a page that emptied its own queue must not leave "Paused" up with nothing to poll');
	});

	test(`${order}: Poll.remove() down to a non-empty queue leaves the pill alone`, async () => {
		const { ui, poll } = boot(order);
		const a = () => {}, b = () => {};
		poll.tick = 0;
		poll.add(a, 1000);
		poll.add(b, 1000);
		const span = ui.spans.get('poll-status');

		poll.remove(a);
		await flushMicrotasks();

		assert.ok(ui.spans.has('poll-status'), 'one poller is still queued — the pill must stay up');
		assert.equal(ui.spans.get('poll-status').handler, span.handler, 'and keep its handler');
	});

	test(`${order}: a stale handler-less span left over is still cleared by the deferred check`, () => {
		/* the exact shape the historical bug left behind — a span shown for "Paused" with no
		 * previous element to reuse, so ui.showIndicator bound it with handler: null. Reproduced here
		 * directly (calling the probe rather than dispatching) to show the check recovers even from
		 * the worst state a leftover span could be in. */
		const { ui, poll, mod } = boot(order);
		ui.spans.set('poll-status', { label: 'Paused', style: 'inactive', handler: null });
		poll.tick = 0;

		mod.hidePollIndicatorIfEmpty();
		poll.add(() => {}, 1000);

		const span = ui.spans.get('poll-status');
		assert.ok(span, 'a page that polls gets a pill');
		assert.equal(typeof span.handler, 'function', 'the stale, handler-less span must not survive the check');
	});
}

test('a manual pause is left alone by the deferred check (queue non-empty)', () => {
	const { ui, poll, mod } = boot('stock-first');
	poll.tick = 0;
	poll.add(() => {}, 1000);

	/* the user pauses by hand, mid-page — the queue still has the entry, nothing was navigated */
	const span = ui.spans.get('poll-status');
	span.handler();
	assert.equal(poll.active(), false);
	assert.equal(ui.spans.get('poll-status').label, 'Paused');

	/* hidePollIndicatorIfEmpty() reads the same queue the listener would, and declines: the queue is
	 * not empty, whatever emptied it into this state */
	mod.hidePollIndicatorIfEmpty();
	assert.ok(ui.spans.has('poll-status'), 'a manual pause must survive being read by the check');
	assert.equal(typeof ui.spans.get('poll-status').handler, 'function', 'and stay clickable');

	/* resume, repeatedly, across what a manual pause actually is: no navigation at all */
	span.handler();
	assert.equal(poll.active(), true);
	span.handler();
	assert.equal(poll.active(), false);
	assert.equal(typeof ui.spans.get('poll-status').handler, 'function', 'still the same clickable span');
});

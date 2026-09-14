/* fs-fit's correction state machine, driven by numbers rather than by a page.
 *
 * tools/scroll-anchor.mjs proves the corrections hold on a real engine; this proves the decisions
 * between them — which exit a correction takes, when the engine stops being trusted and when trust
 * comes back, whose scroll event the motion sampler ignores — because a stand shows only the offset
 * at the end, and every one of these decisions has a twin that ends at the same offset for the wrong
 * reason. The sweep reads the same exports this file asserts on. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page, el, settle } from './lib/fit-page.mjs';

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

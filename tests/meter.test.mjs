/* The meter's threshold logic, exercised without a screen reader or a stand.
 *
 * `annotateMeter` (menu-footstrap-common.js) has no test of its own before this file: `smoke` only
 * proves the module loads, and `computed-diff`/`a11y` read a rendered `.cbi-progressbar` rather than
 * the function that built its attributes. What is worth pinning down without either — the percentage
 * parse out of `title` in both shapes it is written in, the 0..100 clamp on a value `%d` never
 * bounds, and the warn/80 - danger/92 split, including the attribute coming back OFF a bar that
 * cools back down — is exactly what a poll tick re-runs on every unchanged and every improving
 * reading alike. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './lib/luci-module.mjs';

const common = () => loadModule('menu-footstrap-common');

/* A `.cbi-progressbar` node is never asked for a label in these cases (closest() answers null, as it
 * does for the bare Software/package-manager bar the module's own comment names), so every case here
 * is about the value alone. */
function fakeMeter(title) {
	const attrs = { title };
	return {
		getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
		hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
		setAttribute(name, value) { attrs[name] = value; },
		removeAttribute(name) { delete attrs[name]; },
		closest() { return null; }
	};
}

test('parseMeterPercent reads the parenthesised form window.progressbar writes', () => {
	assert.equal(common().parseMeterPercent('303.37 MiB / 484.11 MiB (62%)'), 62);
});

test('parseMeterPercent reads a bare percent with nothing around it', () => {
	assert.equal(common().parseMeterPercent('97%'), 97);
});

test('parseMeterPercent reads the localised reading the same way', () => {
	assert.equal(common().parseMeterPercent('3,5 МиБ / 10 МиБ (35%)'), 35);
});

test('parseMeterPercent finds nothing in an empty title', () => {
	assert.equal(common().parseMeterPercent(''), null);
});

test('parseMeterPercent finds nothing when there is no percent at all', () => {
	assert.equal(common().parseMeterPercent('-55.9 dBm'), null);
});

test('parseMeterPercent finds nothing when there is no title', () => {
	assert.equal(common().parseMeterPercent(null), null);
});

test('annotateMeter clamps a reading past 100 down to 100', () => {
	const pg = fakeMeter('150%');
	common().annotateMeter(pg);
	assert.equal(pg.getAttribute('aria-valuenow'), '100');
	assert.equal(pg.getAttribute('data-fs-level'), 'danger');
});

test('annotateMeter clamps a reading under 0 up to 0', () => {
	const pg = fakeMeter('-5%');
	common().annotateMeter(pg);
	assert.equal(pg.getAttribute('aria-valuenow'), '0');
	assert.equal(pg.hasAttribute('data-fs-level'), false);
});

test('the warn/danger split sits at 80 and 92, not one reading either side', () => {
	const cases = [ [ 79, null ], [ 80, 'warn' ], [ 91, 'warn' ], [ 92, 'danger' ], [ 100, 'danger' ] ];
	for (const [ pc, level ] of cases) {
		const pg = fakeMeter(pc + '%');
		common().annotateMeter(pg);
		assert.equal(pg.getAttribute('data-fs-level'), level, pc + '% should read data-fs-level=' + level);
	}
});

test('data-fs-level comes back off a bar that cools back down under warn', () => {
	const pg = fakeMeter('85%');
	common().annotateMeter(pg);
	assert.equal(pg.getAttribute('data-fs-level'), 'warn');
	pg.setAttribute('title', '50%');
	common().annotateMeter(pg);
	assert.equal(pg.hasAttribute('data-fs-level'), false);
});

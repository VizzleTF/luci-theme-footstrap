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

/* bare global, the same way `installBrowserGlobals()` supplies MutationObserver etc for other
 * suites (tests/assets.test.mjs carries the identical line): a `new Function(...)`-built factory
 * runs in the GLOBAL scope, so `window._` in luci-module.mjs's fakes never reaches the bare
 * `_('Total Available')` this module now calls at top level. Identity is enough here — the module
 * under test is asked to match its OWN output, never a translated string. */
globalThis._ = globalThis._ || ((s) => s);

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

/* The key/value-table shape `findProgressbarLabel` reads a row's name off of (Memory, Storage —
 * menu-footstrap-common.js's own comment on that function): `.cbi-value` answers null, `.tr`
 * answers a stub row whose first cell is the label, and the bar's OWN `.td, td` differs from that
 * cell so the lookup does not read its own wrapper back as its name. */
function fakeMeterWithLabel(title, label) {
	const attrs = { title };
	const own = {};
	const cell = { textContent: label };
	const tr = { querySelector: () => cell };
	return {
		getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
		hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
		setAttribute(name, value) { attrs[name] = value; },
		removeAttribute(name) { delete attrs[name]; },
		closest(sel) {
			if (sel === '.tr') return tr;
			if (sel === '.td, td') return own;
			return null;	/* '.cbi-value' */
		}
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

/* forum #134: a fill that reads "how much is left" must warn on a LOW value, not a high one — a
 * memory row reading 91% "Total Available" is healthy, not a warning, and a "Swap free" bar that
 * reads 100% is the best possible outcome, not permanent danger. */
test('an inverted metric at a healthy (high) reading gets no warning', () => {
	const pg = fakeMeterWithLabel('14.15 GiB / 15.50 GiB (91%)', 'Total Available');
	common().annotateMeter(pg);
	assert.equal(pg.hasAttribute('data-fs-level'), false);
});

test('an inverted metric at a full reading gets no warning either', () => {
	const pg = fakeMeterWithLabel('4.00 GiB / 4.00 GiB (100%)', 'Swap free');
	common().annotateMeter(pg);
	assert.equal(pg.hasAttribute('data-fs-level'), false);
});

test('an inverted metric at an unhealthy (low) reading gets a warning', () => {
	const warn = fakeMeterWithLabel('2.30 GiB / 15.50 GiB (15%)', 'Total Available');
	common().annotateMeter(warn);
	assert.equal(warn.getAttribute('data-fs-level'), 'warn');

	const danger = fakeMeterWithLabel('0.40 GiB / 15.50 GiB (3%)', 'Swap free');
	common().annotateMeter(danger);
	assert.equal(danger.getAttribute('data-fs-level'), 'danger');
});

/* Buffered/Cached are the kernel doing its job, not a resource running out — no colour, at any
 * reading, not even one that would read "danger" under the plain fill-based rule. */
test('a cache/buffer bar gets no colour at any reading', () => {
	for (const label of [ 'Buffered', 'Cached' ]) {
		for (const pc of [ 0, 50, 92, 100 ]) {
			const pg = fakeMeterWithLabel(pc + '%', label);
			common().annotateMeter(pg);
			assert.equal(pg.hasAttribute('data-fs-level'), false, label + ' at ' + pc + '% should stay uncoloured');
		}
	}
});

/* A bar this theme does not recognise — a third-party app's own meter included — keeps the plain
 * fill-based rule rather than going dark: most such meters are used-based, and a wrong colour on
 * the rare exception is the accepted cost of not losing the common case. */
test('an unrecognised bar keeps the plain fill-based rule', () => {
	const pg = fakeMeterWithLabel('95%', 'Some Other App Metric');
	common().annotateMeter(pg);
	assert.equal(pg.getAttribute('data-fs-level'), 'danger');
});

/* The package-manager's own disk bar (view/system/packages.js, not this theme's) leads with the
 * percentage instead of trailing it, and used to parse to null — no role, no aria-*, no colour —
 * because parseMeterPercent only matched a percentage at the END of the string. */
test('parseMeterPercent reads the package-manager title, which LEADS with the percentage', () => {
	assert.equal(
		common().parseMeterPercent('6% used (62.91 GiB used of 1006.85 GiB, 943.95 GiB free)'), 6);
});

test('parseMeterPercent reads the same leading form localised', () => {
	assert.equal(
		common().parseMeterPercent('6% использовано (62.91 GiB использовано из 1006.85 GiB, 943.95 GiB свободно)'),
		6);
});

test('parseMeterPercent does not pick a decimal quantity out of a title with no percent at all', () => {
	assert.equal(common().parseMeterPercent('62.91 GiB used of 1006.85 GiB'), null);
});

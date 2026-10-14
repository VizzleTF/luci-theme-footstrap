#!/usr/bin/env node
/* The poll floor, asked what no other gate asks: is it the right height, does it come off, and
 * does it come off in time?
 *
 * `holdFloor()` in fs-fit.js pins `min-height` on the containers a poll empties, so the document
 * cannot shrink under the reader while `dom.content()` refills them (docs/anchoring.md). A floor
 * too short, never taken off, or taken off late ships as a blank page, and none shows on a page
 * that is only loaded. Floors are found by their inline `min-height`, whatever the
 * `data-fs-floor` mark says, because a box emptied of children leaves the sweep's selector. Asked:
 * accuracy (floor vs bare `offsetHeight`, 4px), shrink, fold, depends, tab switch (the pane the
 * reader left keeps none), release (the tallest floor, emptied) and liveness (the page answers).
 * Faults, with numbers: docs/anchoring-log.md, "Gate details moved out of `tools/floor-contract.mjs`".
 *
 *   node tools/floor-contract.mjs [--only owrt2512] [--all] [--pages /admin/network/network,…] [--settle ms]
 *
 * Needs a running owlab router (docs/development.md). */
import { chromium } from 'playwright';
import { withDeadline } from './lib/page-shapes.mjs';
import { stands, login, requireStands, sealToRouter } from './lib/stands.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('floor-contract', {
	pages: { type: 'string', default: '/admin/network/network,/admin/status/overview,/admin/network/dhcp,'
		+ '/admin/system/footstrap,/admin/system/system,/admin/system/filemanager' },
	settle: { type: 'string', default: '10000' },
	only: { type: 'string', default: '' }, all: { type: 'boolean', default: false },
});

/* Pages that carry the shapes a floor is written on: a tabbed map of tables (Interfaces), a
 * status page a poll rewrites (Overview), a form page whose sections end in prose (DHCP), and the
 * two that hide content IN PLACE (FOLD_TRIGGER/DEPENDS_TRIGGER): Footstrap's Appearance
 * disclosure and System -> System, Time Synchronization. A trigger a page does not offer does not
 * fire. /admin/system/filemanager is here for LIVENESS: a foreign app whose header cells carry
 * `data-field`, the shape that fed the sweep's class writes back into its own wake-up
 * (`_moTabs`). It is absent from the CORE routers, where it costs one 404. */
const PAGES = FLAGS.pages.split(',');

/* Opens then closes the one `.fs-ap-fold` disclosure Footstrap's Appearance panel carries — the
 * OPEN half mutates nodes (refreshColours()) and is not the fault; the CLOSE half writes `hidden`
 * and `aria-expanded` only, no node moving, which is what ACCURACY below must catch once this has
 * run. null where the page has no such control. */
const FOLD_TRIGGER = async (page) => {
	const has = await page.evaluate(() => !!document.querySelector('#view .fs-ap-fold'));
	if (!has) return null;
	const click = () => page.evaluate(() => document.querySelector('#view .fs-ap-fold').click());
	await click();
	await page.waitForTimeout(1200);
	await click();
	await page.waitForTimeout(1200);
	return true;
};

/* Switches to the tab a stock "Time Synchronization"/"Синхронизация времени" section lives on and
 * unticks its first checkbox — form.js's setActive() answers by toggling the CLASS `hidden` on the
 * `[data-field]` row, not the attribute, so this is the one trigger ACCURACY cannot see without a
 * class-based observer. null where the page carries no such tab or control. */
const DEPENDS_TRIGGER = async (page) => {
	const tabbed = await page.evaluate(() => {
		const a = [ ...document.querySelectorAll('#view .cbi-tabmenu li a') ]
			.find((x) => /time|время/i.test(x.textContent || ''));
		if (!a) return false;
		a.click();
		return true;
	});
	if (!tabbed) return null;
	await page.waitForTimeout(1200);
	const clicked = await page.evaluate(() => {
		const pane = document.querySelector('#view [data-tab-active="true"]') || document.querySelector('#view');
		const cb = pane.querySelector('input[type="checkbox"]');
		if (!cb) return false;
		cb.click();
		return true;
	});
	if (!clicked) return null;
	await page.waitForTimeout(1800);
	return true;
};

/* A floor is a lower bound on a height that is about to be replaced, not a layout the page is drawn
 * to, so it may sit a pixel or two off what the box measures: a collapsed bottom margin on the last
 * child is not in the span, and both numbers are rounded. 4px is that slack and nothing more —
 * the faults this gate exists for were 41 and 98. */
const SLACK = 4;

/* What the 0.14.3 shape wrote, asked of every box wearing one of ours: take the floor off, read the
 * box, put it back. Expensive — a forced layout per box — which is why the theme does not do this
 * per tick and this gate does it once per page. */
const ACCURACY = () => {
	const out = [];
	for (const el of document.querySelectorAll('#view [style*="min-height"]')) {
		const floor = Math.round(parseFloat(el.style.minHeight) || 0);
		const keep = el.style.minHeight;
		el.style.minHeight = '';
		const bare = el.offsetHeight;
		el.style.minHeight = keep;
		out.push({ cls: (el.className || el.tagName).split(' ')[0], floor, bare, delta: floor - bare });
	}
	return { floors: out };
};

/* Switch to the next tab and read what the pane the reader LEFT is still wearing.
 *
 * The click is the real one — `ui.tabs` writes `data-tab-active` on the panes and moves no node, so
 * a synthetic attribute write would be measuring this gate rather than the theme. What must be true
 * the moment the switch lands: no inactive pane carries an inline `min-height`. It is checked after
 * a beat rather than in the same frame because the sweep runs from a MutationObserver callback, one
 * microtask after the attribute. */
const TAB_SWITCH = () => {
	const tabs = [ ...document.querySelectorAll('#view .cbi-tabmenu li a') ];
	if (tabs.length < 2) return null;
	const panes = () => [ ...document.querySelectorAll('#view [data-tab-title]') ];
	const open = panes().find((p) => p.getAttribute('data-tab-active') === 'true');
	const from = open ? open.getAttribute('data-tab-title') : '?';
	const doc = document.documentElement.scrollHeight;
	const next = tabs.findIndex((a) => a.parentElement.className.indexOf('cbi-tab-disabled') !== -1);
	tabs[next === -1 ? 1 : next].click();
	return { from, doc };
};

const TAB_AFTER = () => {
	const panes = [ ...document.querySelectorAll('#view [data-tab-title]') ];
	const open = panes.find((p) => p.getAttribute('data-tab-active') === 'true');
	return {
		to: open ? open.getAttribute('data-tab-title') : '?',
		/* the pane the reader can see must start where the page starts, and the ones they cannot
		 * must hold nothing up */
		openTop: open ? Math.round(open.getBoundingClientRect().top + window.scrollY) : null,
		stale: panes.filter((p) => p.getAttribute('data-tab-active') !== 'true' && p.style.minHeight)
			.map((p) => (p.getAttribute('data-tab-title') || '?') + '=' + p.style.minHeight),
		doc: document.documentElement.scrollHeight,
	};
};

/* Shrinks the tallest floored box by ABOUT HALF ITS CHILDREN — a real childList mutation, the same
 * shape a poll's `dom.content()` makes, but a genuine PARTIAL shrink rather than RELEASE's full
 * empty below. This is the shape a per-box skip in `holdFloor()` has to get
 * right: a skip that reads a box's height WHILE ITS OLD FLOOR IS STILL APPLIED cannot see a shrink
 * at all — `min-height` forces `offsetHeight` up to the floor no matter what is actually left
 * inside, so "this box already reads its own floor" is trivially true after every ordinary shrink,
 * not only a coincidental one. Needs at least 2 children so removing some leaves the box non-empty
 * — RELEASE below already covers the fully-emptied case. */
const SHRINK_HALF = () => {
	const el = [ ...document.querySelectorAll('#view [style*="min-height"]') ]
		.sort((a, b) => parseFloat(b.style.minHeight) - parseFloat(a.style.minHeight))
		.find((e) => e.children.length >= 2);
	if (!el) return null;
	window.__fsShrinkBox = el;
	const n = Math.max(1, Math.floor(el.children.length / 2));
	for (let i = 0; i < n; i++) el.removeChild(el.lastElementChild);
	return { cls: (el.className || el.tagName).split(' ')[0], floorBefore: el.style.minHeight,
	         removed: n, doc: document.documentElement.scrollHeight };
};

/* What the box's floor reads once the mutation observer has had a turn, against what it is
 * actually standing at with no floor under it — the same clear/measure/put-back AFTER below uses,
 * so a passing floor and a passing bare box are told apart by the SAME yardstick RELEASE holds
 * them to. */
const SHRINK_AFTER = () => {
	const el = window.__fsShrinkBox;
	if (!el || !document.getElementById('view').contains(el)) return { inDoc: false };
	const was = el.style.minHeight;
	el.style.minHeight = '';
	const bare = Math.round(el.getBoundingClientRect().height);
	el.style.minHeight = was;
	return { inDoc: true, floorAfter: el.style.minHeight, bare,
	         doc: document.documentElement.scrollHeight };
};

/* Empty the tallest floored box the way a tick does, and DO NOT refill it: a container that is not
 * coming back must not keep holding the page open. Returns what to look at afterwards. */
const EMPTY_TALLEST = () => {
	const el = [ ...document.querySelectorAll('#view [style*="min-height"]') ]
		.sort((a, b) => parseFloat(b.style.minHeight) - parseFloat(a.style.minHeight))[0];
	if (!el) return null;
	window.__fsFloorBox = el;
	while (el.firstChild) el.removeChild(el.firstChild);
	return { cls: (el.className || el.tagName).split(' ')[0], min: el.style.minHeight,
	         doc: document.documentElement.scrollHeight };
};

const AFTER = () => {
	const el = window.__fsFloorBox;
	/* A POLL MAY HAVE REPLACED THE BOX rather than refilled it — on the Overview it replaces whole
	 * sections — and a detached node keeps whatever inline style it died with. It holds nothing up,
	 * so it is not a stale floor and this gate must not report one: the page is judged by what is
	 * still in it. */
	return { inDoc: document.getElementById('view').contains(el),
	         /* …and a poll that REFILLED it earns its floor back, so the box is judged only while it
	          * is still empty. Both are true on the Overview, whose tick rewrites whole sections. */
	         empty: !el.childElementCount && !(el.textContent || '').trim(),
	         min: el.style.minHeight,
	         /* WHAT THE EMPTY BOX STANDS AT WITH NO FLOOR UNDER IT. A box empty of children is not
	          * empty of padding and border, and a floor at exactly that height holds nothing up:
	          * /admin/network/network's section measures 34px either way. The blank page is a floor
	          * TALLER than the box, so the two are asked apart the way the theme itself does it —
	          * clear, measure, put back. */
	         bare: (() => {
	                 const was = el.style.minHeight;
	                 el.style.minHeight = '';
	                 const h = Math.round(el.getBoundingClientRect().height);
	                 el.style.minHeight = was;
	                 return h;
	         })(),
	         h: Math.round(el.getBoundingClientRect().height), doc: document.documentElement.scrollHeight };
};

/* The first question asked of every page is whether it still answers. The sweep's observer can
 * loop on a page whose elements carry `data-field` (926 sweeps a second on filemanager,
 * `_moTabs`), and every `page.evaluate()` then times out; a page that misses the deadline is a
 * finding, not a page skipped. A detector, not a remedy, and generous: the reads it guards are a
 * `querySelectorAll` and arithmetic on a page that has had 7s to settle. */
const SETTLE_DEADLINE = Number(FLAGS.settle);
if (!(SETTLE_DEADLINE > 0)) {
	console.error(`floor-contract: --settle wants milliseconds, got "${FLAGS.settle}"`);
	process.exit(2);
}

const deadline = (p) => withDeadline(p, SETTLE_DEADLINE);

/* …and, once it does answer, how hard it is still working. Not a finding on its own — a threshold
 * separating "busy" from "looping" cannot be shown red, because a page that loops never answers the
 * read — but the number belongs in the log beside the floors: it is the theme's own class churn as
 * the theme's own observer sees it, and a page that has settled reports a handful of writes where a
 * page feeding itself reported thousands. */
const CHURN = () => {
	const view = document.getElementById('view');
	if (!view) return false;
	const s = window.__fsChurn = { batches: 0, records: 0, changed: 0 };
	s.mo = new MutationObserver((rs) => {
		s.batches++; s.records += rs.length;
		for (const r of rs) if (r.oldValue !== r.target.getAttribute(r.attributeName)) s.changed++;
	});
	s.mo.observe(view, { attributes: true, attributeOldValue: true, subtree: true,
		attributeFilter: [ 'data-tab-active', 'hidden', 'aria-expanded', 'class' ] });
	return true;
};
const CHURN_READ = () => {
	const s = window.__fsChurn;
	if (!s) return null;
	s.mo.disconnect();
	return { batches: s.batches, records: s.records, changed: s.changed };
};
/* How long the churn is counted for. One second is longer than any single sweep and shorter than
 * the poll interval, so an idle page usually reports zero and a looping one cannot hide. */
const CHURN_WINDOW = 1000;

/* holdFloor() runs in the observer callback, so a release lands within a microtask or 400ms after
 * motion stops; 600ms is past that with no network or timer of its own to wait on. */
const SWEEP_WAIT = 600;

const list = requireStands(stands(FLAGS.only, { all: FLAGS.all }), 'floor-contract');
const browser = await chromium.launch();
const findings = [];
let boxes = 0, worst = 0, released = 0, switches = 0, folds = 0, depends = 0, shrinks = 0, live = 0;

for (const stand of list) {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await sealToRouter(ctx, stand.base);
	/* not const: a page whose main thread has stopped turning is replaced below */
	let page = await ctx.newPage();
	await login(page, stand.base);

	for (const path of PAGES) {
		try { await page.goto(stand.base + path, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
		catch (e) { continue; }
		/* long enough for a settled tick to have written the floors it is going to write */
		await page.waitForTimeout(7000);

		const where = `${stand.id} ${path}`;
		/* …and it has to still be turning, before anything else is asked of it (SETTLE_DEADLINE).
		 * The deadline is the caller's own — `page.evaluate()` takes none, and against a renderer
		 * that is spinning it never settles either way, which is exactly how a frozen page used to
		 * read here as a page with no floors. */
		let churn = null, alive = true;
		try {
			await deadline(page.evaluate(CHURN));
			await page.waitForTimeout(CHURN_WINDOW);
			churn = await deadline(page.evaluate(CHURN_READ));
		} catch (e) { alive = false; }
		if (!alive) {
			findings.push(`${where}: the page's main thread did not answer for `
				+ `${Math.round(SETTLE_DEADLINE / 1000)}s, ${7 + Math.round(SETTLE_DEADLINE / 1000)}s after `
				+ `it loaded — the fit engine is not settling, so no floor on this page can be measured `
				+ `at all and the reader's tab is pinned for as long as it is open`);
			/* A tab in that state will not navigate either, so the pages after this one would be
			 * measured through a renderer that is still spinning. Start the next one in a fresh tab. */
			await page.close({ runBeforeUnload: false }).catch(() => {});
			page = await ctx.newPage();
			await login(page, stand.base);
			continue;
		}
		if (churn)
			process.stdout.write(`  ${where}  settled: ${churn.records} watched attribute write(s) in `
				+ `${churn.batches} batch(es) over ${CHURN_WINDOW}ms, ${churn.changed} of them a real change\n`);
		live++;

		/* content hidden IN PLACE, before ACCURACY reads a floor — the two triggers ARE the case:
		 * the sweep's own accuracy check catches the discrepancy on its own once the DOM is left
		 * in the state closing/hiding leaves it in (docs/anchoring.md). */
		let fold, dep;
		try { fold = await FOLD_TRIGGER(page); } catch (e) { fold = null; }
		if (fold) { folds++; process.stdout.write(`  ${where}  fold opened then closed\n`); }
		try { dep = await DEPENDS_TRIGGER(page); } catch (e) { dep = null; }
		if (dep) { depends++; process.stdout.write(`  ${where}  a depends() row switched off\n`); }

		let r;
		try { r = await page.evaluate(ACCURACY); }
		catch (e) { continue; }
		if (!r.floors.length) { process.stdout.write(`  ${where}: no floor standing\n`); continue; }

		for (const f of r.floors) {
			boxes++;
			if (Math.abs(f.delta) > Math.abs(worst)) worst = f.delta;
			if (Math.abs(f.delta) > SLACK)
				findings.push(`${where}: the floor on ${f.cls} is ${f.floor}px where the box measures `
					+ `${f.bare}px (${f.delta > 0 ? '+' : ''}${f.delta}px) — ${f.delta > 0
						? 'that difference IS blank page' : 'the document may shrink by that much mid-tick'}`);
		}

		process.stdout.write(`  ${where}  ${r.floors.length} floor(s), worst ${
			r.floors.reduce((a, f) => Math.abs(f.delta) > Math.abs(a) ? f.delta : a, 0)}px\n`);

		/* …and a genuine PARTIAL shrink — before the switch and the release, both
		 * of which mutate #view themselves and would otherwise be read as this test's own effect. */
		const shrinkBefore = await page.evaluate(SHRINK_HALF);
		if (shrinkBefore) {
			/* the observer's callback runs as a microtask off the removeChild() calls above (SWEEP_WAIT) */
			await page.waitForTimeout(SWEEP_WAIT);
			const shrinkAfter = await page.evaluate(SHRINK_AFTER);
			if (!shrinkAfter.inDoc) {
				process.stdout.write(`  ${where}  shrink probe: the poll replaced ${shrinkBefore.cls} `
					+ `before the read, nothing to check\n`);
			} else {
				shrinks++;
				const floorAfter = Math.round(parseFloat(shrinkAfter.floorAfter) || 0);
				const gap = floorAfter - shrinkAfter.bare;
				if (Math.abs(gap) > SLACK)
					findings.push(`${where}: ${shrinkBefore.cls} lost ${shrinkBefore.removed} child(ren) `
						+ `(floor was ${shrinkBefore.floorBefore}) and still wears ${shrinkAfter.floorAfter} `
						+ `where it now measures ${shrinkAfter.bare}px (+${gap}px) — a shrink the floor `
						+ `never came down for, document ${shrinkBefore.doc} -> ${shrinkAfter.doc}`);
				else
					process.stdout.write(`  ${where}  shrink probe: ${shrinkBefore.cls} lost `
						+ `${shrinkBefore.removed} child(ren), floor ${shrinkBefore.floorBefore} -> `
						+ `${shrinkAfter.floorAfter} over ${shrinkAfter.bare}px of box\n`);
			}
		}

		/* …and the switch, on a page that has a tab strip. Before the release test, which empties
		 * a box: the floors this reads are the ones a settled page wrote. */
		const tabBefore = await page.evaluate(TAB_SWITCH);
		if (tabBefore) {
			await page.waitForTimeout(SWEEP_WAIT);
			const tabAfter = await page.evaluate(TAB_AFTER);
			if (tabAfter.stale.length)
				findings.push(`${where}: switching from "${tabBefore.from}" to "${tabAfter.to}" left `
					+ `${tabAfter.stale.join(', ')} on a pane the reader cannot see — that floor IS blank `
					+ `page above the tab they opened, document ${tabBefore.doc} -> ${tabAfter.doc}, `
					+ `its content ${tabAfter.openTop}px down`);
			else
				process.stdout.write(`  ${where}  tab "${tabBefore.from}" -> "${tabAfter.to}": no floor left `
					+ `standing, document ${tabBefore.doc} -> ${tabAfter.doc}\n`);
			switches++;
		}

		/* …and the release, on the tallest floor this page carries */
		const before = await page.evaluate(EMPTY_TALLEST);
		if (!before) continue;
		await page.waitForTimeout(SWEEP_WAIT);
		const after = await page.evaluate(AFTER);
		if (!after.inDoc || !after.empty) {
			process.stdout.write(`  ${where}  emptied ${before.cls}: the poll `
				+ `${after.inDoc ? 'refilled' : 'replaced'} the box, nothing to release\n`);
			continue;
		}
		released++;
		const held = after.min ? Math.round(parseFloat(after.min) - after.bare) : 0;
		if (held > SLACK)
			findings.push(`${where}: ${before.cls} emptied and left empty still wears ${after.min} `
				+ `after ${SWEEP_WAIT}ms — ${held}px more than the empty box `
				+ `stands at (${after.bare}px), which is that much page holding nothing, `
				+ `document ${before.doc} -> ${after.doc}`);
		process.stdout.write(`  ${where}  emptied ${before.cls}: ${before.min} -> `
			+ `${after.min ? after.min + ' over ' + after.bare + 'px of box' : 'released'}, `
			+ `document ${before.doc} -> ${after.doc}\n`);
	}
	await ctx.close();
}
await browser.close();

if (findings.length) {
	console.error(`\nfloor-contract: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nThe floor is written by holdFloor() in fs-fit.js and explained in docs/anchoring.md.');
	console.error('Too short and it does not hold; too tall, or never taken off, and it IS the blank page.');
	console.error('A page that does not answer holds no measurable floor at all: the sweep is feeding itself.\n');
	process.exit(1);
}
if (!boxes) {
	console.error(`\nfloor-contract: 0 of ${list.length} router(s) produced a floor, ${live} page(s) answering — `
		+ 'the theme wrote no floor on any page (not logged in, theme not active, or every page failed to '
		+ 'load). This is not a clean sweep; it is nothing measured.\n');
	process.exit(1);
}
console.log(`floor-contract: ${boxes} floor(s) over ${list.length} router(s), worst ${worst}px against the box, `
	+ `${released} released after emptying, ${switches} released on a tab switch, ${folds} fold(s) `
	+ `closed, ${depends} depends() row(s) switched off, ${shrinks} partial shrink(s) checked, `
	+ `${live} page(s) still answering after the sweep.`);

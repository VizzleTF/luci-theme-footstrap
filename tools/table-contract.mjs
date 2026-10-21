#!/usr/bin/env node
/* The table contract, held to the sheet and to the render. Which tier a table gets is decided by
 * measurement (fs-select.js's ladder); this gate holds what that measurement rests on:
 *
 *   1. where the break values live: `overflow-wrap: anywhere` lowers min-content to one character
 *      (css-text-3 §5.4), which starves a column in the tier that is measured.
 *   2. what the render does: docs/gallery.html carries a fixture per tier, bug-report shapes included.
 *   3. the gate that keeps an unanswered table out of the layout.
 *   4. a `display` rule on a table part has a matching role in fs-select.js's TABLE_ROLE_* (WCAG 1.3.1).
 *
 * Cannot assert: the gallery has no LuCI JS, so the ladder's pick, the pathological-column pick, the
 * poll and `roomFor` belong to tools/table-tick.mjs and tools/live-audit.mjs. Usage: [--verbose] */
import { readFileSync } from 'node:fs';
import * as csstree from 'css-tree';
import { chromium } from 'playwright';
import { serveGallery, assertRendered } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';
import { read } from './lib/root.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('table-contract', { verbose: { type: 'boolean', default: false } });
const VERBOSE = FLAGS.verbose;
const cssPath = buildCss();
const css = readFileSync(cssPath, 'utf8');
const fails = [];
const notes = [];

/* ---- 1. the sheet ----
 *
 * Each entry is a selector ALLOWED to carry that break value on a cell, with the reason. Anything
 * else carrying one is a failure — not because the value is wrong in itself, but because a fifth
 * place to decide how a column may break is how the four per-page rules and the three JS heuristics
 * happened in the first place. */
const BREAK_OK = {
	'anywhere': [
		{ sel: '.table .td', why: 'base: the containment default for every tier that cannot card or scroll' },
		{ sel: '.table.fs-stacked .td', why: 'a carded cell owns the row — no neighbour left to starve' },
		{ sel: '.table.cbi-section-table .td', why: 'the config table\'s card, under @container 960' },
		{ sel: '.table.fs-dt:not(.fs-stacked) .td.fs-td-break', why: 'the one column the fitter marked' },
	],
	'break-word': [
		{ sel: '.table .th', why: 'base: a header keeps the floor of its longest word' },
		{ sel: '.table .tr > .td:first-child', why: 'base: the row identity keeps its floor (issue #36)' },
		{ sel: '.table.fs-dt:not(.fs-stacked) .td', why: 'THE floor: a data table is measured, so it must not lie' }
	]
};

const cellish = (sel) => /\.(td|th)\b/.test(sel);
/* css-tree prints combinators without spaces (`.tr>.td`); the contract above is written the way a
 * human writes it. Compare on one normal form so the two never disagree about whitespace. */
const norm = (sel) => sel.replace(/\s*([>+~])\s*/g, ' $1 ').replace(/\s+/g, ' ').trim();
const ast = csstree.parse(css, { positions: false });
const seen = { anywhere: new Set(), 'break-word': new Set() };
let inMedia = null;

csstree.walk(ast, {
	visit: 'Rule',
	enter(node, item, list) {
		const sel = csstree.generate(node.prelude).replace(/\s+/g, ' ').trim();
		csstree.walk(node.block, {
			visit: 'Declaration',
			enter(decl) {
				if (decl.property !== 'overflow-wrap' && decl.property !== 'word-wrap') return;
				const value = csstree.generate(decl.value).trim();
				if (!(value in BREAK_OK)) return;
				if (!cellish(sel)) return;
				for (const part of sel.split(',').map((s) => s.trim())) {
					if (!cellish(part)) continue;
					seen[value].add(norm(part));
					const ok = BREAK_OK[value].some((e) => norm(part) === norm(e.sel) || norm(part).endsWith(' ' + norm(e.sel)));
					if (!ok) fails.push(`unlisted break rule: \`${part} { overflow-wrap: ${value} }\`\n` +
						'      every place a cell may break is listed in tools/table-contract.mjs — add it there with the reason, or use the tier that already covers it');
				}
			}
		});
	}
});

/* the reverse: a listed rule that has quietly disappeared is just as much a drift */
for (const [ value, entries ] of Object.entries(BREAK_OK))
	for (const e of entries)
		if (![ ...seen[value] ].some((s) => s === norm(e.sel) || s.endsWith(' ' + norm(e.sel))))
			notes.push(`not in the sheet any more: \`${e.sel} { overflow-wrap: ${value} }\` (${e.why})`);

/* a break value under a viewport query would put the decision back on the screen */
csstree.walk(ast, {
	visit: 'Atrule',
	enter(node) {
		if (node.name !== 'media') return;
		const cond = csstree.generate(node.prelude || { type: 'Raw', value: '' });
		if (!/width/.test(cond)) return;
		csstree.walk(node.block, {
			visit: 'Declaration',
			enter(decl) {
				if (decl.property === 'overflow-wrap' || decl.property === 'word-break')
					fails.push(`\`${decl.property}\` inside \`@media ${cond}\` — how a value may break is a property of the value and its column, never of the viewport`);
			}
		});
	}
});

/* ---- 1b. a `display` override must not cost a table its own roles (WCAG 1.3.1) ----
 *
 * fs-select.js writes the table roles unconditionally onto `.table`/`.thead`/`.tbody`/`.tfoot`/`.tr`/
 * `.th`/`.td` and the bare tags (JS cannot read a media or container query's state). The map shrinks only by an edit to fs-select.js, caught below. Two ways a NEW rule slips past it are
 * checked from the CSS side (docs/css.md, "Tables: roles survive a `display` override"):
 *   A. an unqualified `display` rule, with no ladder class and no `:not()` fence, touches every table.
 *   B. an unknown class standing in for `.tr`/`.td` inside a `.cbi-section`, named like a table part.
 */
const selJs = read('luci-theme-footstrap/htdocs/luci-static/resources/fs-select.js');
const roleClassesDecl = /const TABLE_ROLE_CLASSES = \[([\s\S]*?)\n\];/.exec(selJs);
const roleTagsDecl = /const TABLE_ROLE_TAGS = \[([\s\S]*?)\n\];/.exec(selJs);
if (!roleClassesDecl || !roleTagsDecl) {
	fails.push('fs-select.js no longer declares TABLE_ROLE_CLASSES/TABLE_ROLE_TAGS, so a `display` override cannot be checked against a role');
} else {
	const classesCovered = new Set([ ...roleClassesDecl[1].matchAll(/'\.([\w-]+)'/g) ].map((m) => m[1]));
	const tagsCovered = new Set([ ...roleTagsDecl[1].matchAll(/'([\w-]+)'/g) ].map((m) => m[1]));
	const ROLE_CLASS_NAMES = [ 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td' ];
	const ROLE_TAG_NAMES = [ 'thead', 'tbody', 'tfoot' ];
	for (const cls of ROLE_CLASS_NAMES)
		if (!classesCovered.has(cls))
			fails.push(`TABLE_ROLE_CLASSES in fs-select.js no longer covers .${cls} — a \`display\` override on it would strip the role and nothing replaces it`);
	for (const tag of ROLE_TAG_NAMES)
		if (!tagsCovered.has(tag))
			fails.push(`TABLE_ROLE_TAGS in fs-select.js no longer covers <${tag}> — a \`display\` override on a real one would strip its implicit rowgroup role and nothing replaces it`);

	/* Split on a top-level comma only — outside `()`/`[]`, so a comma inside `:is(a, b)` is never
	 * mistaken for one, which appears in this sheet (`.table:is([id], .fs-dt)`). */
	const splitTop = (s) => {
		const parts = []; let depth = 0, cur = '';
		for (const ch of s) {
			if (ch === '(' || ch === '[') depth++;
			else if (ch === ')' || ch === ']') depth--;
			if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
		}
		parts.push(cur);
		return parts.map((p) => p.trim()).filter(Boolean);
	};
	/* -> the compound this rule's `display` actually lands on: everything after the LAST top-level
	 * combinator (space/>/+/~). Scanned from the end so a combinator-looking character inside a
	 * `:not(:has(> .tr))` argument (depth > 0 there) is never mistaken for the real one. */
	const lastCompound = (s) => {
		let depth = 0;
		for (let i = s.length - 1; i >= 0; i--) {
			const ch = s[i];
			if (ch === ')' || ch === ']') depth++;
			else if (ch === '(' || ch === '[') depth--;
			else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~'))
				return s.slice(i + 1).trim();
		}
		return s.trim();
	};

	/* values that KEEP the browser's own table/row/cell mapping — a `display` with nothing to lose,
	 * so a rule that only ever sets one of these is never checked below regardless of shape */
	const TABLE_PRESERVING_DISPLAY = new Set([
		'table', 'table-row', 'table-cell', 'table-row-group', 'table-header-group',
		'table-footer-group', 'table-column', 'table-column-group', 'table-caption', 'inline-table'
	]);
	/* `.cbi-section` is the one ancestor nearly every rule in this stylesheet shares and says
	 * nothing about scope on its own — excluded here so it never counts as the qualifying class in
	 * check A, and used on its own as the entry condition for check B below */
	const NEUTRAL = new Set([ ...ROLE_CLASS_NAMES, 'cbi-section' ]);
	const allClasses = (s) => [ ...s.matchAll(/\.([\w-]+)/g) ].map((m) => m[1]);
	/* check A: a state class, an id, an attribute or a `:not()`/`:has()` anywhere in the selector —
	 * not necessarily on the compound `display` lands on; the key/value fence (theme/30-tables.css
	 * ~300) puts its four `:not()`s on the ANCESTOR `.table`, never on the `.tr`/`.td` itself */
	const isQualified = (s) => allClasses(s).some((c) => !NEUTRAL.has(c)) ||
		/:(?:not|has)\(/.test(s) || /\[/.test(s) || /#[\w-]/.test(s);
	const TABLE_KEYWORDS = new Set([
		'row', 'cell', 'col', 'column', 'head', 'body', 'foot', 'table', 'grid', 'thead', 'tbody', 'tfoot'
	]);
	const looksLikeTablePart = (cls) => cls.toLowerCase().split('-').some((w) => TABLE_KEYWORDS.has(w));

	csstree.walk(ast, {
		visit: 'Rule',
		enter(node) {
			let displayValue = null;
			csstree.walk(node.block, {
				visit: 'Declaration',
				enter(decl) { if (decl.property === 'display') displayValue = csstree.generate(decl.value).trim(); }
			});
			if (!displayValue || TABLE_PRESERVING_DISPLAY.has(displayValue)) return;
			const sel = csstree.generate(node.prelude);
			for (const part of splitTop(sel)) {
				const key = lastCompound(part);
				/* the class list, read off the key compound — a `.tr`/`.table-titles` inside a
				 * `:not()`/`:has()` argument earlier in `key` may be swept in too (the paren content
				 * is not stripped, only used to find the split point); harmless, since it can only
				 * ADD a name already required to be covered, never miss one that IS on the compound
				 * `display` actually applies to. */
				const keyClasses = [ ...key.matchAll(/\.([\w-]+)/g) ].map((m) => m[1]);
				const roleOnTarget = keyClasses.filter((c) => ROLE_CLASS_NAMES.includes(c));
				/* the tag name, only when the compound actually starts with one (not `.td:empty`,
				 * not `[data-title]`, not `:not(...)`) */
				const tagMatch = /^([a-zA-Z][\w-]*)/.exec(key);
				const tagOnTarget = tagMatch && ROLE_TAG_NAMES.includes(tagMatch[1]) ? tagMatch[1] : null;

				if (roleOnTarget.length || tagOnTarget) {
					for (const cls of roleOnTarget)
						if (!classesCovered.has(cls))
							fails.push(`\`${part} { display: ${displayValue} }\` changes .${cls}'s display with no matching role in fs-select.js's TABLE_ROLE_CLASSES`);
					if (tagOnTarget && !tagsCovered.has(tagOnTarget))
						fails.push(`\`${part} { display: ${displayValue} }\` changes a real <${tagOnTarget}>'s display with no matching role in fs-select.js's TABLE_ROLE_TAGS`);
					/* check A — the map still lists it, but nothing in THIS rule's own selector scopes
					 * it to one rung of the ladder */
					if (!isQualified(part))
						fails.push(`\`${part} { display: ${displayValue} }\` is unqualified — no state class, :not()/:has(), attribute or id restricts it to one rung of the ladder, so it changes display on every .table's role-bearing element at once (docs above, item 4A)`);
				} else if (allClasses(part).includes('cbi-section') && keyClasses.some(looksLikeTablePart)) {
					/* check B — a class fs-select.js was never told about, inside a .cbi-section and
					 * named like a table part, with no role class of its own on the same element */
					fails.push(`\`${part} { display: ${displayValue} }\` changes .${keyClasses.join('.')}'s display inside a .cbi-section; named like a table row/cell but carries none of fs-select.js's TABLE_ROLE_CLASSES, so nothing writes it a role (docs above, item 4B)`);
				}
			}
		}
	});
}

/* ---------------------------------------------------------------- 2. the render */
/* ---- 3. the gate that keeps a freshly polled table out of the layout ----
 *
 * A fresh table carries no marks until stamped, so it lays out full-width, several screens taller
 * than the card stack it becomes (390px), and a forced layout re-anchors the reader. theme/30-tables.css
 * holds it out of the flow and must name every root fs-select's `ROOTS` scans; both lists are
 * derived and compared here.
 */
/* selJs: read once, above, for the role-map check */
const rootsDecl = /const ROOTS = \[([^\]]*)\]/.exec(selJs);
if (!rootsDecl) fails.push('fs-select.js no longer declares ROOTS, so the gate rule cannot be checked against it');
else {
	const roots = [ ...rootsDecl[1].matchAll(/'([^']+)'/g) ].map((m) => m[1]);
	/* what fs-fit arms the rule with, read from the JS rather than assumed */
	const armed = /dataset\.fsFit\s*=/.test(read('luci-theme-footstrap/htdocs/luci-static/resources/fs-fit.js'));
	if (!armed) fails.push('fs-fit.js no longer writes the data-fs-fit attribute the gate rule is guarded on');

	const gateSelectors = [];
	csstree.walk(ast, {
		visit: 'Rule',
		enter(node) {
			const sel = csstree.generate(node.prelude);
			if (!/\.table\.fs-dt:not\(\.fs-fitted\)/.test(sel)) return;
			const decls = csstree.generate(node.block);
			if (!/display:\s*none/.test(decls)) return;
			for (const part of sel.split(',')) gateSelectors.push(norm(part));
		}
	});
	if (!gateSelectors.length)
		fails.push('nothing in the sheet holds an unanswered .table.fs-dt out of the layout — the intermediate a poll tick paints is back');
	for (const root of roots) {
		const covered = gateSelectors.some((sel) => sel.includes(root) && sel.includes('[data-fs-fit]'));
		if (!covered)
			fails.push(`fs-select scans "${root}" for data tables and no guarded rule hides an unanswered one there`);
	}
	for (const sel of gateSelectors)
		if (!/:root\[data-fs-fit\]/.test(sel))
			fails.push(`the gate rule "${sel}" is not guarded on :root[data-fs-fit] — a document whose JS never ran would hide its tables for good`);
	if (VERBOSE) console.log(`  gate: ${roots.join(', ')} covered by ${gateSelectors.length} selector(s)`);
}

const { base, close } = await serveGallery(cssPath);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(base, { waitUntil: 'load' });
await assertRendered(page);
await page.evaluate(() => document.fonts.ready);

/* 2a. the computed values, tier by tier — the sheet half proved they exist, this proves they LAND */
const computed = await page.evaluate(() => {
	const pick = (sel) => document.querySelector(sel);
	const ow = (el) => (el ? getComputedStyle(el).overflowWrap : null);
	const dt = pick('.table.fs-dt .tr:not(.table-titles) .td');
	const kv = pick('.cbi-section .table:not([id]):not(.fs-dt) .tr .td:last-child');
	const th = pick('.table .tr.table-titles .th');
	const first = pick('.table:not(.fs-dt) .tr > .td:first-child');
	return { dataCell: ow(dt), keyValueCell: ow(kv), header: ow(th), firstColumn: ow(first) };
});
const want = { dataCell: 'break-word', keyValueCell: 'anywhere', header: 'break-word', firstColumn: 'break-word' };
for (const [ k, v ] of Object.entries(want))
	if (computed[k] && computed[k] !== v)
		fails.push(`${k} computes \`overflow-wrap: ${computed[k]}\`, contract says \`${v}\``);
	else if (!computed[k])
		fails.push(`${k}: no fixture in docs/gallery.html to measure — nothing measured`);

/* 2b. THE FLOOR, as a relation and never as a pixel: squeeze a data-table fixture and assert its
 * used width stops shrinking at the width of the widest token it must show. Ratio-based, so it
 * holds on both engines and at every density — and it reads USED width only, because an intrinsic
 * query (`width: min-content`) is what returned the same number for all three break values in the
 * measurement that sent this theme down the wrong path in the first place. */
const floor = await page.evaluate(() => {
	const t = document.querySelector('.table.fs-dt');
	if (!t) return null;
	const host = t.parentElement;
	const prev = host.style.width;
	const widths = [];
	for (const w of [ 1200, 900, 700, 560, 420 ]) {
		host.style.width = `${w}px`;
		void t.offsetWidth;
		widths.push(Math.round(t.getBoundingClientRect().width));
	}
	host.style.width = prev;
	/* the widest single token any cell must render, measured in that cell's own font */
	const cx = document.createElement('canvas').getContext('2d');
	let widest = 0;
	for (const cell of t.querySelectorAll('.tr:not(.table-titles) .td')) {
		const s = getComputedStyle(cell);
		cx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
		for (const word of (cell.textContent || '').trim().split(/\s+/))
			widest = Math.max(widest, cx.measureText(word).width);
	}
	return { widths, widest: Math.round(widest) };
});
if (!floor) fails.push('no `.table.fs-dt` in docs/gallery.html — the floor was not measured');
else {
	const min = Math.min(...floor.widths);
	if (min + 2 < floor.widest)
		fails.push(`the data table shrank to ${min}px against a widest token of ${floor.widest}px — the floor is gone, the fitter is blind`);
	else if (VERBOSE) console.log(`  floor  widths ${floor.widths.join(' ')} against a ${floor.widest}px token`);
}

/* 2c. the card prints what the card promises */
const card = await page.evaluate(() => {
	const t = document.querySelector('.table.fs-dt');
	if (!t) return null;
	t.classList.add('fs-stacked');
	const rows = [ ...t.querySelectorAll('.tr:not(.table-titles)') ];
	const cells = rows.flatMap((r) => [ ...r.children ]);
	const out = {
		rowIsFlex: rows.length ? getComputedStyle(rows[0]).display === 'flex' : null,
		headerHidden: getComputedStyle(t.querySelector('.tr.table-titles')).display === 'none',
		labelled: cells.filter((c) => c.hasAttribute('data-title') &&
			getComputedStyle(c, '::before').content !== 'none').length,
		cells: cells.length
	};
	t.classList.remove('fs-stacked');
	return out;
});
if (!card) fails.push('no `.table.fs-dt` in docs/gallery.html — the card was not measured');
else {
	if (!card.rowIsFlex) fails.push('a carded row is not a flex row — the card layout is gone');
	if (!card.headerHidden) fails.push('a carded table still shows its header row');
	if (!card.labelled) fails.push('a carded cell prints no `data-title` label — the card says nothing about which column a value came from');
}

/* 2d. an open dropdown is usable the way a user meets it. Static half: nothing from the dropdown up
 * may clip (hidden, clip) or scroll (auto, scroll; `overflow-x: auto` computes `overflow-y` to auto as
 * well and luci-base sizes an open list against the nearest scroll parent). Render half: a real click
 * opens every visible dropdown (a ComboButton on its arrow) and `elementFromPoint` at each li's centre
 * must return that li; dispatchEvent + getBoundingClientRect cannot see a clip, which is how 0.14.16
 * shipped a ComboButton menu under `overflow: hidden`. The gallery has no LuCI JS, so a stand-in
 * mirrors openDropdown's DOM ([open], the ul as `.dropdown` under a `top`, a `.preview` clone) less
 * `.cbi-dropdown-open` and the upward flip, which no theme rule reads. */
await page.evaluate(() => {
	document.addEventListener('click', (ev) => {
		const sb = ev.target.closest('.cbi-dropdown');
		if (!sb || sb.hasAttribute('open')) return;
		/* UIComboButton.handleClick: a closed button runs its action unless the arrow was hit */
		if (sb.matches('.btn, .cbi-button') && !ev.target.matches('.cbi-dropdown > span.open')) return;
		const ul = sb.querySelector('ul');
		const pv = ul.cloneNode(true);
		pv.classList.add('preview');
		sb.setAttribute('open', '');
		ul.style.top = `${sb.offsetHeight}px`;
		ul.style.maxHeight = `${Math.max(innerHeight - sb.getBoundingClientRect().bottom, 0)}px`;
		ul.classList.add('dropdown');
		sb.insertBefore(pv, ul.nextElementSibling);
	});
	window.__closeDropdown = (sb) => {
		const ul = sb.querySelector('ul.dropdown');
		sb.querySelector('ul.preview')?.remove();
		sb.removeAttribute('open');
		ul.classList.remove('dropdown');
		ul.style.top = ul.style.maxHeight = '';
	};
	/* the gallery stages two lists open; one open at a time is what ui.js keeps, and a staged list lies over the next widget's */
	document.querySelectorAll('.cbi-dropdown[open]').forEach((sb) => window.__closeDropdown(sb));
});
const dropdowns = page.locator('.cbi-dropdown');
let hitTested = 0;
for (let i = 0, n = await dropdowns.count(); i < n; i++) {
	const dd = dropdowns.nth(i);
	if (!(await dd.isVisible())) continue;
	/* what a failure names: the position, the label and the id LuCI gave a ComboButton */
	const name = await dd.evaluate((el, k) => `#${k} "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"` +
		(el.dataset.idref ? ` [data-idref=${el.dataset.idref}]` : ''), i);
	const clips = await dd.evaluate((el) => {
		const bad = [];
		for (let a = el; a && a !== document.body; a = a.parentElement) {
			const cs = getComputedStyle(a);
			if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY))
				bad.push(`${a.tagName.toLowerCase()}.${(a.className || '').toString().split(' ')[0]} ${cs.overflowX}/${cs.overflowY}`);
		}
		return bad;
	});
	for (const c of clips) fails.push(`dropdown ${name} sits in ${c} — its open list is clipped or mis-sized`);
	/* near the top of the viewport, so the list has room below it */
	await dd.evaluate((el) => scrollTo(0, scrollY + el.getBoundingClientRect().top - 100));
	const combo = await dd.evaluate((el) => el.matches('.btn, .cbi-button'));
	const target = combo ? dd.locator(':scope > span.open') : dd;
	if (!(await target.isVisible())) { fails.push(`ComboButton ${name} has no visible arrow (> span.open) — nothing opens its list`); continue; }
	try { await target.click({ timeout: 3000 }); }
	catch (e) { fails.push(`dropdown ${name} cannot be clicked${combo ? ' on its arrow' : ''}: ${e.message.split('\n')[0]}`); continue; }
	if (!(await dd.evaluate((el) => el.hasAttribute('open')))) { fails.push(`dropdown ${name}: a click on it did not open the list`); continue; }
	const miss = await dd.evaluate((el) => {
		const bad = [];
		let tested = 0;
		for (const li of el.querySelectorAll('ul.dropdown > li')) {
			const r = li.getBoundingClientRect();
			if (!r.width || !r.height) continue;
			tested++;
			const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			if (!hit || !li.contains(hit)) {
				const at = hit ? `${hit.tagName.toLowerCase()}.${(hit.className || '').toString().split(' ')[0]}` : 'nothing';
				bad.push(`"${(li.textContent || '').trim().slice(0, 24)}" -> ${at}`);
			}
		}
		return { bad, tested };
	});
	hitTested += miss.tested;
	for (const m of miss.bad) fails.push(`an open dropdown ${name}: the centre of li ${m}, so the user cannot reach it`);
	await dd.evaluate((el) => window.__closeDropdown(el));
}
if (!hitTested) fails.push('no open dropdown li was hit-tested — nothing measured');
else if (VERBOSE) console.log(`  dropdown  ${hitTested} li hit-tested`);
await page.evaluate(() => scrollTo(0, 0));

/* 2e. every .fs-dt frame, div or real table, shares one overflow: the generic `.table` rule's
 * overflow:hidden made a bare div table the sticky header's scroll container, one bar-height off
 * its first row (GitHub #67). */
const frame = await page.evaluate(() => {
	document.documentElement.setAttribute('data-layout', 'top');
	window.scrollTo(0, 0);
	const bad = [];
	for (const t of document.querySelectorAll('.table.fs-dt:not(.fs-stacked)')) {
		const o = getComputedStyle(t).overflow;
		if (o !== 'visible') bad.push(`${t.tagName.toLowerCase()}#${t.id || '-'} overflow:${o}`);
	}
	const t = document.querySelector('[data-fs-bare]');
	const th = t && t.querySelector('.tr.table-titles .th');
	const off = th ? Math.round(th.getBoundingClientRect().top - th.parentElement.getBoundingClientRect().top) : null;
	return { bad, off };
});
for (const b of frame.bad) fails.push(`a .table.fs-dt computes ${b} — it becomes the sticky header's scroll container`);
if (frame.off === null) fails.push('no bare div `.table.fs-dt` in docs/gallery.html — the sticky frame was not measured');
else if (frame.off !== 0) fails.push(`a bare div .table.fs-dt: the first .th sits ${frame.off}px off its .tr at scroll 0 (layout top)`);

/* 2f. an app's own rules meet a real fs-dt table in the SAME layer, so each rule v0.14.14 keyed on
 * `table.fs-dt` must still score as it did: `:is(table, div).fs-dt` is (0,1,1) like `table.fs-dt` and
 * reaches the bare div; `.table.fs-dt` is (0,2,0), a class higher, and filemanager's `.table
 * td:nth-child(1)` (0,2,1) lost to the cell rule, 5px -> 12px. The sheet lists every key, the render
 * measures the cell rule. The `.table.fs-dt` rules that were never `table.fs-dt` are not listed. */
const DT_KEY = ':is(table, div).fs-dt';
const dtKeys = new Set();
csstree.walk(ast, {
	visit: 'Rule',
	enter(node) {
		if (node.prelude.type === 'SelectorList') node.prelude.children.forEach((s) => dtKeys.add(csstree.generate(s)));
	}
});
for (const tail of [ '', ' .td', ' .th',
	' :is(.tr.table-titles, .thead) .th:first-child', ' :is(.tr.table-titles, .thead) .th:last-child',
	' .tr:last-child .td:first-child', ' .tr:last-child .td:last-child', ' .tr.placeholder .td' ])
	if (!dtKeys.has(csstree.generate(csstree.parse(DT_KEY + tail, { context: 'selector' }))))
		fails.push(`no rule keys on \`${DT_KEY}${tail}\` — \`.table.fs-dt\` scores (0,2,0), a class above \`table.fs-dt\`'s (0,1,1), so an app's same-layer rule on a real table loses; a plain \`table.fs-dt\` misses the bare div table`);

const appPad = await page.evaluate(() => {
	const td = document.querySelector('[data-fs-app-pad] td:first-child');
	return td ? getComputedStyle(td).paddingLeft : null;
});
if (appPad === null) fails.push('no `[data-fs-app-pad]` table in docs/gallery.html — an app\'s column padding was not measured');
else if (appPad !== '5px') fails.push(`a real .fs-dt table: an app's \`td:nth-child(1) { padding-left: 5px }\` computes ${appPad} — the fs-dt cell rule scores above table.fs-dt`);

await browser.close();
close();

for (const n of notes) console.log(`  note  ${n}`);
if (fails.length) {
	console.error('\nFAIL: the table contract has drifted\n');
	for (const f of fails) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('table-contract: break values where the contract puts them, floor holds, card labelled, every open dropdown list reachable.');

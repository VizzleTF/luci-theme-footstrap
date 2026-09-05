#!/usr/bin/env node
/* The table contract, held to the sheet and to the render.
 *
 * Every table in this theme reaches one of a few outcomes, decided by measurement (fs-select.js's
 * ladder) rather than by a breakpoint. What a gate CAN hold is the three things that measurement
 * rests on, each of which has been broken by a change that looked local:
 *
 *   1. where the break values live. `overflow-wrap: anywhere` lowers a cell's min-content to one
 *      character (css-text-3 §5.4), which is right for a tier with nowhere to put an overflow and
 *      catastrophic for the tier that is measured — the browser then answers "it fits" while a
 *      column is starved.
 *   2. what the render does. docs/gallery.html carries a fixture per tier, including the shapes
 *      that only ever appeared in bug reports (a 130-character token, an 8 000-character value, a
 *      MAC, a hyphenated identifier).
 *   3. the gate that keeps an unanswered table out of the layout.
 *   4. that a `display` rule on `.table`/`.thead`/`.tbody`/`.tfoot`/`.tr`/`.th`/`.td` (or a real
 *      `<thead>`/`<tbody>`/`<tfoot>` this file never classes) has a matching role in fs-select.js's
 *      TABLE_ROLE_CLASSES/TABLE_ROLE_TAGS — the pairing that survives the moment any of those
 *      twenty-odd rules strip the browser's own implicit table/row/cell role (WCAG 1.3.1).
 *
 * WHAT IT CANNOT ASSERT, so a green run is not read as coverage: the gallery ships CSS only — no
 * LuCI JS — so which class the ladder picks, the pathological-column pick, the poll, the dialog
 * flag and `roomFor` under the real chrome belong to the live gates (tools/table-tick.mjs,
 * tools/live-audit.mjs).
 *
 * Usage: node tools/table-contract.mjs [--verbose] */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as csstree from 'css-tree';
import { chromium } from 'playwright';
import { serveGallery } from './lib/gallery.mjs';
import { buildCss, ROOT } from './lib/css.mjs';

const VERBOSE = process.argv.includes('--verbose');
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
 * fs-select.js writes `table`/`rowgroup`/`row`/`columnheader`/`cell` UNCONDITIONALLY onto
 * `.table`/`.thead`/`.tbody`/`.tfoot`/`.tr`/`.th`/`.td` (and the three bare tags for a real
 * `<thead>`/`<tbody>`/`<tfoot>` it never classes) rather than pairing a role write to each
 * `display` rule across theme/*.css and pages/*.css — a race with every one of them, since a media
 * query's or a container's live state is not something JS can read at the point a role would need
 * writing. That map can only ever SHRINK by an edit to fs-select.js itself, which the block below
 * catches from the source. It cannot catch the two ways a NEW `styles/**` rule slips past it, so
 * both are checked here too, from the CSS side:
 *
 *   A. an unqualified rule — one `display` change on `.table`/`.tr`/`.td`/… with nothing in its own
 *      selector (a state class, `:not()`/`:has()`, an attribute, an id) restricting it to one rung
 *      of the ladder — touches every such element on the page at once, the "fifth place to decide"
 *      item 1 above already refuses for `overflow-wrap`. Every rule this file ships either carries
 *      a ladder class (`.fs-stacked`, `.fs-dt`, `.cbi-section-table`, `.fs-rowstack`, `.fs-xscroll`,
 *      `hide-xs`/`hide-sm`) or the four-way `:not()` fence around the key/value tables
 *      (theme/30-tables.css ~300) that stands in for one; a rule with neither is new and unproven,
 *      whichever specific class it names.
 *   B. a class fs-select.js was never told about, standing in for `.tr`/`.td` rather than beside
 *      them — nothing in TABLE_ROLE_CLASSES can shrink to catch a name it never held. Undetectable
 *      in general (a `display: flex` row is ordinary CSS everywhere outside a table), so this is
 *      scoped to where a false alarm has not been found: inside a `.cbi-section` — every rule that
 *      touches a real table lives there — and named like a table part (`row`/`cell`/`col`/`head`/
 *      `body`/`foot`/`table`/`grid` as a whole hyphenated word, not a substring — `.fs-kv-row`
 *      catches it, `.fs-ovl-empty`/`.ifacebox-head` do not). A false NEGATIVE stays possible (a
 *      table part named some other way, or one built outside a `.cbi-section`); a false positive
 *      breaking Appearance's `.fs-color-row`/`.fs-ap-actrow`/`.fs-ap-bgrow`/`.fs-ap-verrow` or
 *      75-search.css's `.fs-search-row` — none of them a `.cbi-section` descendant — is the risk
 *      that kept this from being a plain name-contains-"row" scan. */
const selJs = readFileSync(join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/resources/fs-select.js'), 'utf8');
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
 * A poll tick REPLACES a data table, and a fresh one carries no marks: for the moment between
 * landing and being stamped it is laid out as a full-width table, at 390px several screens taller
 * than the card stack it is about to become. If anything forces layout in that moment, the engine
 * re-anchors on the intermediate and throws the reader.
 *
 * theme/30-tables.css answers it by holding an unanswered table out of the flow, and the rule has to
 * name the roots a table can land in. fs-select scans `ROOTS`; the stylesheet lists them again, so
 * the two are derived and compared here — a root added to the JS without the CSS is a table nothing
 * protects, and the symptom is a page that jumps on a router with an app that renders tables
 * somewhere new. */
/* selJs: read once, above, for the role-map check */
const rootsDecl = /const ROOTS = \[([^\]]*)\]/.exec(selJs);
if (!rootsDecl) fails.push('fs-select.js no longer declares ROOTS, so the gate rule cannot be checked against it');
else {
	const roots = [ ...rootsDecl[1].matchAll(/'([^']+)'/g) ].map((m) => m[1]);
	/* what fs-fit arms the rule with, read from the JS rather than assumed */
	const armed = /dataset\.fsFit\s*=/.test(readFileSync(join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/resources/fs-fit.js'), 'utf8'));
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
		notes.push(`${k}: no fixture in docs/gallery.html to measure`);

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
if (floor) {
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
if (card) {
	if (!card.rowIsFlex) fails.push('a carded row is not a flex row — the card layout is gone');
	if (!card.headerHidden) fails.push('a carded table still shows its header row');
	if (!card.labelled) fails.push('a carded cell prints no `data-title` label — the card says nothing about which column a value came from');
}

/* 2d. nothing that can hold a popup may become a scroll container: `overflow-x: auto` computes
 * `overflow-y` to auto as well, and luci-base sizes an open dropdown against the nearest scroll
 * parent. This is the assertion that keeps the scroll tier honest as it grows. */
const clipped = await page.evaluate(() => {
	const bad = [];
	for (const dd of document.querySelectorAll('.cbi-dropdown')) {
		for (let el = dd.parentElement; el && el !== document.body; el = el.parentElement) {
			const cs = getComputedStyle(el);
			if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) {
				bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
				break;
			}
		}
	}
	return bad;
});
for (const el of clipped)
	fails.push(`a .cbi-dropdown sits inside a scroll container (${el}) — its open list will be clipped and mis-sized`);

await browser.close();
close();

for (const n of notes) console.log(`  note  ${n}`);
if (fails.length) {
	console.error('\nFAIL: the table contract has drifted\n');
	for (const f of fails) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('table-contract: break values where the contract puts them, floor holds, card labelled, no popup inside a scroller.');

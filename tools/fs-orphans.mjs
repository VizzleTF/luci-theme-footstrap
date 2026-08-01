#!/usr/bin/env node
/* Dead-selector check, scoped to the theme's OWN namespace — the scoping is the whole point.
 *
 * PurgeCSS/uncss/coverage-pruning are ACTIVELY DANGEROUS here. docs/conventions.md: "never drop the styling
 * of a selector because no shipped LuCI page uses it." Content is rendered by third-party
 * luci-app-* JS, so a `.cbi-*` selector with no example on this router is still styled for the
 * package that emits it on someone else's — anything pruning what it did not SEE rendered
 * un-themes other people's apps. We never ask "was this rule exercised".
 *
 * `.fs-*` is OURS: only this theme's templates and JS can emit one. So inside that namespace, and
 * only there, "nothing we ship emits this class" really does mean dead. Every LuCI/cbi class is
 * ignored on purpose — that is the set the contract protects.
 *
 *   FORWARD  — styled but never emitted: left behind when markup is deleted (would have caught
 *              .fs-topnav/.fs-mainmenu when the top-nav template went).
 *   REVERSE  — emitted but never styled: dead markup, a typo, or something riding on inherited
 *              base styles by accident.
 *
 * Usage: node tools/fs-orphans.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as csstree from 'css-tree';

import { ROOT } from './lib/root.mjs';
const PKG = join(ROOT, 'luci-theme-footstrap');

/* Names that look like fs-* classes to a regex but are not. Without this the reverse check
 * drowns in custom properties and localStorage keys. */
const IGNORE_EXACT = new Set([
	/* localStorage keys (fs-update-check lives in the optional updater's own repo, not scanned here) */
	'fs-darkmode', 'fs-palette', 'fs-wallpaper', 'fs-radius', 'fs-tint', 'fs-accent',
	'fs-good', 'fs-warn', 'fs-danger', 'fs-card', 'fs-control', 'fs-bar', 'fs-line',
	'fs-rail', 'fs-layout', 'fs-menu-open', 'fs-menu-autocollapse', 'fs-recent', 'fs-tint-strength',
	'fs-density', 'fs-photo-dim',
	/* the Appearance tab's data-tab value — ui.tabs matches panes and menu items on it, so it is an
	 * identifier in the stock tab machinery rather than a class of ours */
	'fs-appearance',
	/* UI state, not axes: which of the Appearance groups are unlocked for editing */
	'fs-ui-colours', 'fs-ui-background',
	/* a sessionStorage key, not a class: the one-shot flag a reset leaves so the reload it triggers
	 * lands back on the Appearance tab instead of the stock page's remembered one */
	'fs-ap-return',
	/* custom events / id prefixes */
	'fs-autocollapse', 'fs-sub-', 'fs-topsub-',
	/* a console log PREFIX (`console.error('fs-fit: a fitter threw')`), not markup. This is the one
	 * name still ignored BY NAME, and it is safe only because nothing styles `.fs-fit`; see the note
	 * below for why the blanket list of module names was the wrong fix. */
	'fs-fit',
]);
/* MODULE NAMES are not classes — and they are handled by STRIPPING the two places a module is
 * REFERENCED (the `'require fs-x as y'` pragma, and footer.ut's `L.require('fs-x')`), not by listing
 * the names. Listing every module was the first fix and it is wrong the moment a module is named
 * after the markup it owns: `fs-appearance` is BOTH a module and the id of the button that opens it,
 * so ignoring the NAME to silence the pragma also silenced the real `#fs-appearance` — and the tool
 * duly reported a live selector as dead CSS. Blind the scan to a POSITION, never to a name. */
/* Two more POSITIONS in which an fs-* token is not a class: a custom property (`--fs-accent`) and a
 * data attribute (`data-fs-select`, `data-fs-shell`). Matched by what PRECEDES the token, so a class
 * that happens to share a name with one of them is still seen. */
const NOT_A_CLASS_BEFORE = /(?:--|data-)$/;
/* A THIRD position: a module FILENAME. `head.ut` globs `/www/luci-static/resources/fs-update.js` on
 * the server to decide whether the optional updater is installed, and that path is not markup. Keyed
 * on the `.js` that follows the token, so a class is still seen even if a module is named after it —
 * the same position-not-name rule as the pragmas above. */
const NOT_A_CLASS_AFTER = /^\.js\b/;

/* readdirSync(recursive) also returns the directory entries; every caller filters by extension,
 * which drops them. */
const filesIn = (dir, ext) => readdirSync(dir, { recursive: true })
	.filter((f) => f.endsWith(ext)).map((f) => join(dir, f));

/* ---- what the CSS styles ------------------------------------------------- */
/* Ids as well as classes: the theme mounts #fs-appearance and #fs-rail-toggle by id, and a
 * class-only sweep would report them as "emitted but never styled" — a false alarm teaches you
 * to ignore the tool. */
const styled = new Map();
for (const f of filesIn(join(PKG, 'styles'), '.css')) {
	const ast = csstree.parse(readFileSync(f, 'utf8'), { positions: true });
	csstree.walk(ast, (node) => {
		if (node.type !== 'ClassSelector' && node.type !== 'IdSelector') return;
		if (!node.name.startsWith('fs-')) return;
		if (!styled.has(node.name))
			styled.set(node.name, `${f.slice(ROOT.length + 1)}:${node.loc?.start.line ?? 0}`);
	});
}

/* ---- what the markup + JS actually emit ---------------------------------- */
/* COMMENTS ARE STRIPPED FIRST, and that is load-bearing: half of this source is prose
 * explaining why a rule exists, and it names the very classes that were deleted (".fs-topnav is
 * gone because…"). A sweep that reads comments reports those as live markup — backwards. */
function stripComments(text, file) {
	if (file.endsWith('.ut'))
		return text.replace(/\{#[\s\S]*?#\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
			.replace(/L\.require\('[^']*'\)/g, ' ');	/* footer.ut mounts the modules by name */
	return text
		.replace(/\/\*[\s\S]*?\*\//g, ' ')					/* block */
		.replace(/(^|[^:])\/\/.*$/gm, '$1')				/* line (keep http://) */
		/* `'require fs-chrome as chrome';` names a MODULE, not a class — and blanking the POSITION
		 * rather than the name is what lets a module share its name with the markup it owns. */
		.replace(/^'require\s+[^']*';\s*$/gm, ' ')
		.replace(/L\.require\('[^']*'\)/g, ' ');
}

const emitted = new Map();
const SRC = [
	...filesIn(join(PKG, 'ucode'), '.ut'),
	...filesIn(join(PKG, 'htdocs'), '.js'),
];
for (const f of SRC) {
	const text = stripComments(readFileSync(f, 'utf8'), f);
	text.split('\n').forEach((line, i) => {
		for (const m of line.matchAll(/\bfs-[a-z0-9-]+/g)) {
			const name = m[0];
			if (IGNORE_EXACT.has(name)) continue;
			if (NOT_A_CLASS_BEFORE.test(line.slice(0, m.index))) continue;
			if (NOT_A_CLASS_AFTER.test(line.slice(m.index + name.length))) continue;
			if (!emitted.has(name)) emitted.set(name, `${f.slice(ROOT.length + 1)}:${i + 1}`);
		}
	});
}

/* ---- report -------------------------------------------------------------- */
/* Emitted-but-unstyled names that are NOT a styling bug, with the reason. Anything not here is
 * new and wants a look. */
const JUSTIFIED_UNSTYLED = {
	'fs-rail-toggle': 'a JS hook (getElementById); the button is styled by its .fs-railtoggle class',
	'fs-title': 'the document <h1> wrapper; hidden by the .fs-sr clip utility beside it, so it stays in the a11y tree',
	'fs-title-main': 'that <h1>; it rides on base h1 styles and the SPA router keeps its text in sync',
	'fs-nav-status': 'a JS hook (getElementById): the router\'s aria-live region, hidden by .fs-sr',
	'fs-search-btn': 'a JS hook (getElementById); the button is styled by its .fs-themerow class',
	'fs-ap-fold-': 'an id PREFIX built in JS (`fs-ap-fold-` + n) so each folded group\'s button can point aria-controls at its panel; the button and panel are styled by .fs-ap-fold / .fs-ap-body',
	'fs-search-opt-': 'an id PREFIX built in JS (`fs-search-opt-` + i) so the combobox can point aria-activedescendant at a row; the rows themselves are styled by .fs-search-opt',
};

const orphanCss = [...styled.keys()].filter(c => !emitted.has(c)).sort();
const unstyled  = [...emitted.keys()].filter(c => !styled.has(c) && !IGNORE_EXACT.has(c)).sort();
const unexpected = unstyled.filter(c => !(c in JUSTIFIED_UNSTYLED));

console.log(`fs-* names styled: ${styled.size}   emitted: ${emitted.size}`);

console.log(`\n== STYLED BUT NEVER EMITTED (dead CSS — safe to delete, it is our namespace) ==`);
if (!orphanCss.length) console.log('  none');
for (const c of orphanCss) console.log(`  .${c.padEnd(24)} ${styled.get(c)}`);

console.log(`\n== EMITTED BUT NEVER STYLED ==`);
if (!unexpected.length) console.log(`  none unexpected (${unstyled.length} known, see JUSTIFIED_UNSTYLED)`);
for (const c of unexpected) console.log(`  .${c.padEnd(24)} ${emitted.get(c)}   <-- NEW: style it, delete it, or justify it`);

/* Only FORWARD gates: dead CSS in our own namespace is bytes shipped for nothing, with no
 * coverage contract to protect it. REVERSE is a report — an unstyled class can be legitimate (a
 * JS hook, a hidden element riding on inherited styles). */
if (orphanCss.length) {
	console.error(`\nFAIL: ${orphanCss.length} fs-* selector(s) styled but emitted by nothing.`);
	process.exit(1);
}

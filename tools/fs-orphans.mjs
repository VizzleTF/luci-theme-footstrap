#!/usr/bin/env node
/* Dead-selector check, scoped to the theme's OWN namespace, and the scoping is the whole point.
 *
 * PurgeCSS and friends are actively dangerous here: content is rendered by third-party luci-app-*
 * JS, so a `.cbi-*` selector with no example on this router is still styled for the package that
 * emits it on someone else's, and anything pruning what it did not SEE rendered un-themes other
 * people's apps (docs/conventions.md). We never ask "was this rule exercised".
 *
 * `.fs-*` is OURS: only this theme's templates and JS can emit one, so inside that namespace, and
 * only there, "nothing we ship emits this class" really does mean dead. Every LuCI/cbi class is
 * ignored on purpose — that is the set the coverage contract protects.
 *
 *   FORWARD  — styled but never emitted: left behind when markup is deleted. Gated.
 *   REVERSE  — emitted but never styled: dead markup, a typo, or something riding on inherited
 *              base styles. Reported only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as csstree from 'css-tree';

import { ROOT, filesIn } from './lib/root.mjs';
const PKG = 'luci-theme-footstrap';

/* Names that look like fs-* classes to a regex but are not. Without this the reverse check
 * drowns in custom properties and localStorage keys. */
const IGNORE_EXACT = new Set([
	/* localStorage keys */
	'fs-darkmode', 'fs-palette', 'fs-wallpaper', 'fs-radius', 'fs-tint', 'fs-accent',
	'fs-good', 'fs-warn', 'fs-danger', 'fs-card', 'fs-control', 'fs-bar', 'fs-line',
	'fs-rail', 'fs-layout', 'fs-menu-open', 'fs-menu-autocollapse', 'fs-recent', 'fs-tint-strength',
	'fs-density', 'fs-photo-dim', 'fs-pattern-size', 'fs-pattern-strength', 'fs-pattern-ink',
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
]);
/* Module names are not classes, and they are handled by STRIPPING the two places a module is
 * referenced (the `'require fs-x as y'` pragma and footer.ut's `L.require('fs-x')`), never by
 * listing the names: a module may be named after the markup it owns — `fs-appearance` is BOTH a
 * module and an id — so ignoring the NAME to silence the pragma also silences the real selector,
 * and the tool reports a live one as dead CSS. Blind the scan to a POSITION, never to a name. */
/* Two more POSITIONS in which an fs-* token is not a class: a custom property (`--fs-accent`) and a
 * data attribute (`data-fs-select`, `data-fs-shell`). Matched by what PRECEDES the token, so a class
 * that happens to share a name with one of them is still seen. */
const NOT_A_CLASS_BEFORE = /(?:--|data-)$/;
/* A THIRD position: a module FILENAME. A source line naming `fs-router.js` or `fs-prefs.js` — a
 * comment cross-reference, or a server-side path test the way head.ut once probed for the retired
 * updater — is a path, not markup. Keyed on the `.js` that follows the token, so a class is still
 * seen even if a module is named after it — the same position-not-name rule as the pragmas above. */
const NOT_A_CLASS_AFTER = /^\.js\b/;

/* ---- what the CSS styles ------------------------------------------------- */
/* Ids as well as classes: the theme mounts #fs-appearance and #fs-rail-toggle by id, and a
 * class-only sweep would report them as "emitted but never styled" — a false alarm teaches you
 * to ignore the tool. */
const styled = new Map();
for (const f of filesIn(join(PKG, 'styles'), '.css')) {
	const ast = csstree.parse(readFileSync(join(ROOT, f), 'utf8'), { positions: true });
	csstree.walk(ast, (node) => {
		if (node.type !== 'ClassSelector' && node.type !== 'IdSelector') return;
		if (!node.name.startsWith('fs-')) return;
		if (!styled.has(node.name))
			styled.set(node.name, `${f}:${node.loc?.start.line ?? 0}`);
	});
}

/* ---- what the markup + JS actually emit ---------------------------------- */
/* COMMENTS ARE STRIPPED FIRST, and that is load-bearing: half of this source is prose
 * explaining why a rule exists, and it names the very classes that were deleted (".fs-topnav is
 * gone because…"). A sweep that reads comments reports those as live markup — backwards. */
function stripComments(text, file) {
	if (file.endsWith('.ut'))
		return text.replace(/\{#[\s\S]*?#\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
			.replace(/\b[A-Za-z_$][\w$]*\.require\('[^']*'\)/g, ' ');	/* footer.ut mounts the modules by name */
	return text
		.replace(/\/\*[\s\S]*?\*\//g, ' ')					/* block */
		.replace(/(^|[^:])\/\/.*$/gm, '$1')				/* line (keep http://) */
		/* `'require fs-chrome as chrome';` names a MODULE, not a class — and blanking the POSITION
		 * rather than the name is what lets a module share its name with the markup it owns. */
		.replace(/^'require\s+[^']*';\s*$/gm, ' ')
		/* ANY receiver, not just `L`: .claude/rules/js.md requires a stock class to be pulled through
		 * `window.L` (`const RT = window.L; RT.require(name)`), so the canonical call site is
		 * `RT.require('fs-search')` — and a pattern anchored on the letter `L` walked straight past
		 * it. That is how the lazy search palette (0.14.3) turned its own module name into a class
		 * "emitted but never styled": the position was right, the receiver was not. */
		.replace(/\b[A-Za-z_$][\w$]*\.require\('[^']*'\)/g, ' ')
		/* …and so does the page-module map, for the same reason: its values are module names, and
		 * `fs-overview` was reported as markup emitted and never styled on the strength of one. */
		.replace(/const PAGE_MODULES = \{[^}]*\}/g, ' ')
		/* A THIRD position, and the last one a module name reaches: this theme's console messages,
		 * which all start `footstrap: ` and name the module they are about —
		 * `console.error('footstrap: fs-search did not load', e)`. That one line is what put
		 * `.fs-search` in the "emitted but never styled" list. IGNORE_EXACT already carries
		 * `fs-fit` for exactly this reason and said in its own comment that the blanket list was
		 * the wrong fix; this is that fix, by position, and that entry is gone with it.
		 *
		 * Two spellings, because the messages have two: most start `footstrap: ` and a few name the
		 * module instead (`console.error('fs-fit: a fitter threw')`). The second pattern takes the
		 * FIRST string argument of any console call — the message slot — so a class passed as a
		 * later argument is still seen. */
		.replace(/'footstrap: [^']*'/g, ' ')
		.replace(/console\.\w+\(\s*'[^']*'/g, ' ');
}

const emitted = new Map();
const SRC = [
	...filesIn(join(PKG, 'ucode'), '.ut'),
	...filesIn(join(PKG, 'htdocs'), '.js'),
];
for (const f of SRC) {
	const text = stripComments(readFileSync(join(ROOT, f), 'utf8'), f);
	text.split('\n').forEach((line, i) => {
		for (const m of line.matchAll(/\bfs-[a-z0-9-]+/g)) {
			const name = m[0];
			if (IGNORE_EXACT.has(name)) continue;
			if (NOT_A_CLASS_BEFORE.test(line.slice(0, m.index))) continue;
			if (NOT_A_CLASS_AFTER.test(line.slice(m.index + name.length))) continue;
			if (!emitted.has(name)) emitted.set(name, `${f}:${i + 1}`);
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

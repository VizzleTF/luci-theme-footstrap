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
import { join } from 'node:path';
import * as csstree from 'css-tree';

import { read, readAll, filesIn } from './lib/root.mjs';
import { storageKeys } from './lib/axes.mjs';
const PKG = 'luci-theme-footstrap';

/* Names that look like fs-* classes to a regex but are not. The localStorage keys are derived from
 * the JS (lib/axes.mjs), so a new axis needs no entry here; the rest are UI state and id
 * prefixes. */
const IGNORE_EXACT = new Set([
	...storageKeys(readAll(join(PKG, 'htdocs/luci-static/resources'), '.js')),
	/* UI state, not axes: which of the Appearance groups are unlocked for editing */
	'fs-ui-colours', 'fs-ui-background',
	/* custom events / id prefixes */
	'fs-autocollapse', 'fs-sub-',
]);
/* Module names are not classes. They are handled by STRIPPING the two places a module is referenced
 * (the `'require fs-x as y'` pragma and `L.require('fs-x')`), never by listing names: a module may
 * be named after the markup it owns, and ignoring the NAME would hide the real selector.
 * Blind the scan to a POSITION, never to a name. */
/* Two more POSITIONS in which an fs-* token is not a class: a custom property (`--fs-accent`) and a
 * data attribute (`data-fs-select`, `data-fs-shell`). Matched by what PRECEDES the token, so a
 * class that happens to share a name with one of them is still seen. */
const NOT_A_CLASS_BEFORE = /(?:--|data-)$/;
/* A THIRD position: a module FILENAME (`fs-router.js` in a comment or a path test), keyed on the
 * `.js` that follows, so a class sharing a module's name is still seen. */
const NOT_A_CLASS_AFTER = /^\.js\b/;

/* ---- what the CSS styles ------------------------------------------------- */
/* Ids as well as classes: the theme mounts #fs-rail-toggle by id, and a class-only sweep would
 * false-alarm. */
const styled = new Map();
for (const f of filesIn(join(PKG, 'styles'), '.css')) {
	const ast = csstree.parse(read(f), { positions: true });
	csstree.walk(ast, (node) => {
		if (node.type !== 'ClassSelector' && node.type !== 'IdSelector') return;
		if (!node.name.startsWith('fs-')) return;
		if (!styled.has(node.name))
			styled.set(node.name, `${f}:${node.loc?.start.line ?? 0}`);
	});
}

/* ---- what the markup + JS actually emit ---------------------------------- */
/* Comments are stripped first: they name classes that were deleted (".fs-topnav is gone
 * because…"), and a sweep that reads them reports those as live markup. */
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
		/* ANY receiver, not just `L`: js.md pulls a stock class through `window.L`, so the call site is
		 * `RT.require('fs-search')`. A pattern anchored on `L` made the lazy search palette's module name
		 * a class "emitted but never styled" (0.14.3). */
		.replace(/\b[A-Za-z_$][\w$]*\.require\('[^']*'\)/g, ' ')
		/* …and so does the page-module map: its values are module names (`fs-overview` was reported
		 * as a class). */
		.replace(/const PAGE_MODULES = \{[^}]*\}/g, ' ')
		/* A THIRD position: this theme's console messages, which name their module —
		 * `console.error('footstrap: fs-search did not load', e)` put `.fs-search` in the "emitted but
		 * never styled" list. Two spellings (`footstrap: …`, and `fs-fit: …`); the second pattern
		 * takes only the FIRST string argument of a console call, so a class passed later is still
		 * seen. */
		.replace(/'footstrap: [^']*'/g, ' ')
		.replace(/console\.\w+\(\s*'[^']*'/g, ' ');
}

const emitted = new Map();
const SRC = [
	...filesIn(join(PKG, 'ucode'), '.ut'),
	...filesIn(join(PKG, 'htdocs'), '.js'),
];
for (const f of SRC) {
	const text = stripComments(read(f), f);
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
	'fs-title-main': 'that <h1>; it rides on base h1 styles and the SPA router keeps its text in sync',
	'fs-nav-status': 'a JS hook (getElementById): the router\'s aria-live region, hidden by .fs-sr',
	'fs-search-btn': 'a JS hook (getElementById); the button is styled by its .fs-themerow class',
	'fs-ap-fold-': 'an id PREFIX built in JS (`fs-ap-fold-` + n) so each folded group\'s button can point aria-controls at its panel; the button and panel are styled by .fs-ap-fold / .fs-ap-body',
	'fs-search-opt-': 'an id PREFIX built in JS (`fs-search-opt-` + i) so the combobox can point aria-activedescendant at a row; the rows themselves are styled by .fs-search-opt',
	'fs-ovl-panel-': 'an id PREFIX built in JS (`fs-ovl-panel-` + n) so a disclosure header can point aria-controls at its panel; the panel itself rides on the card\'s own styling, unclassed',
	'fs-appearance-probe': 'a JS hook (fs-appearance.js, issue #56): fs-router.js\'s strayBodyNode() reads the id to tell this hidden colour-reading probe apart from body litter; it is painted entirely by its own inline !important declarations, on purpose (issue #19), never by a stylesheet',
	'fs-chrome-geom-probe': 'a JS hook (fs-chrome.js, issue #56): same reason as fs-appearance-probe above, for the hidden geometry-reading probe; also painted only by its own inline !important declarations',
};

const orphanCss = [...styled.keys()].filter(c => !emitted.has(c)).sort();
const unstyled  = [...emitted.keys()].filter(c => !styled.has(c)).sort();
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

/* A gate that walks a tree it never checked exists reads "0 orphans" the same as a real pass:
 * point this at an empty styles/ (or one that failed to build/checkout) and `styled` is empty,
 * `orphanCss` is trivially empty too, and the FORWARD check above has nothing to say — exit 0,
 * "STYLED BUT NEVER EMITTED: none". MEASURED is the current count (83); the floor sits well below
 * it so an ordinary edit never trips it, but zero, or a styles/ tree gutted down to a handful of
 * files, cannot pass as if it were clean. */
const MEASURED_STYLED = 83;
const STYLED_FLOOR = 40;
if (styled.size < STYLED_FLOOR) {
	console.error(`\nFAIL: measured only ${styled.size} fs-* selector(s) in styles/ (last real run: `
		+ `${MEASURED_STYLED}) — styles/ is missing, empty, or far short of the theme's own sheet. `
		+ `This is not a clean run; it is a run that found nothing to check.`);
	process.exit(1);
}

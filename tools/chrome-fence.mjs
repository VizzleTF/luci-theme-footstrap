#!/usr/bin/env node
/* The chrome is defended from third-party CSS in three places that must agree, and nothing else
 * holds them together: breaking the fence constant to `.fs-sidebarTYPO` leaves the menu completely
 * unprotected while `npm run check`, `jsmin-verify` and `eslint` all exit 0.
 *
 *   1. `header.ut` — the markup. A chrome root MARKS itself with `data-fs-chrome`; the <nav> is
 *      one, and so are the skip link and the two sr-only elements, none of which is inside it.
 *   2. `fs-sheets.js` — CHROME_FENCE, appended to a foreign selector's subject so it can no longer
 *      MATCH a chrome element, which is what beats a third party's `!important`.
 *   3. `theme/10-chrome.css` — the pin, which closes the way a fence cannot: inheritance.
 *
 * The mark is DERIVED FROM THE MARKUP here, never restated: rename it in header.ut and this gate
 * re-derives it, then fails on the two copies that still say the old one.
 *
 * The fence and the pin are each ONE canonical string, compared whole rather than tested for
 * tokens. That is the hole the token version had: its four independent `includes()` checks all
 * passed on `:where(:not(.fs-sidebar), .fs-sidebar *)`, the exact INVERSE of a fence — it stops
 * sparing the chrome and starts TARGETING it. */
import { read, readAll } from './lib/root.mjs';

const HEADER = read('luci-theme-footstrap/ucode/template/themes/footstrap/header.ut');
const SHEETS = read('luci-theme-footstrap/htdocs/luci-static/resources/fs-sheets.js');
const PREFS = read('luci-theme-footstrap/htdocs/luci-static/resources/fs-prefs.js');
const CHROME = read('luci-theme-footstrap/styles/theme/10-chrome.css');

/* Every module the theme ships, concatenated — for the "does any JS build a chrome root" check
 * below. A GLOB, not a named file: the popover that used to build one lived in fs-appearance.js and
 * this gate read that one path, so a root moved to another module would have left the check quietly
 * looking at a file that no longer had one. */
const JS = readAll('luci-theme-footstrap/htdocs/luci-static/resources', '.js');

const errors = [];
const ok = [];

/* ---- 1. the chrome mark, derived from the markup -------------------------------------- */
/* `{# … #}` first: header.ut's own comments argue about markup in prose ("<nav>, not <aside>"), so a
 * scanner that does not strip them counts tags the template never emits — this gate found four <nav>
 * elements in a template with one. */
const MARKUP = HEADER.replace(/\{#[\s\S]*?#\}/g, '');

/* One <nav> in the template, and it is the menu — `<nav>, not <aside>` is a deliberate choice the
 * header documents. If that ever stops being true this throws rather than guessing wrong. */
const navs = [...MARKUP.matchAll(/<nav\b([^>]*)>/g)].map((m) => m[1]);
if (navs.length !== 1) {
	console.error(`FAIL: expected exactly one <nav> in header.ut (the menu), found ${navs.length}.`);
	console.error('This gate derives the chrome mark from it; teach it the new shape.');
	process.exit(1);
}
const marks = [...new Set(navs[0].match(/\bdata-[a-z][a-z0-9-]*/g) || [])];
if (marks.length !== 1) {
	console.error(`FAIL: the <nav> in header.ut carries ${marks.length} data-* attributes (${marks.join(', ') || 'none'}).`);
	console.error('Exactly one of them is the chrome mark the fence and the pin key off, and this gate');
	console.error('derives it from here rather than restate it. Teach it which, or mark the nav.');
	process.exit(1);
}
const MARK = marks[0];
if (!(/^data-fs-/).test(MARK)) {
	console.error(`FAIL: the chrome mark "${MARK}" is not in the fs-* namespace.`);
	console.error('Nobody outside this theme may emit an fs-* name — that is what makes the fence safe.');
	process.exit(1);
}
/* Every root that carries it, RATCHETED rather than merely reported: this count is the whole thesis
 * that the chrome is not one element. Gating only the JS root leaves the template side unguarded —
 * deleting the mark from the skip link printed "3 root(s)" and exited 0, which is the v0.9.1 damage
 * exactly (popover flattened 12px -> 0 and `position: fixed` -> `static`, both sr-only elements
 * un-clipped onto every page; the <nav> alone held). Adding or removing a root is a deliberate act,
 * so it is a deliberate edit here. */
const EXPECT_ROOTS = 5;	/* + .fs-pattern, the wallpaper's paint layer: a body-level sibling of .fs-shell */
/* …and how many the JS builds: fs-search.js's command palette, a `position: fixed` overlay parented
 * to <body> and therefore outside every template root. A page rendered inside .fs-main is zone 2,
 * where an app is entitled to win, so it must NOT be marked.
 *
 * Ratcheted like the template count: a module that mounts a floating panel on <body> has to come
 * back here and account for it — either it is chrome, and the mark plus this number move together,
 * or it is not, and it belongs inside #view. */
const EXPECT_JS_ROOTS = 1;
const roots = [...MARKUP.matchAll(new RegExp(`<([a-z]+)\\b[^>]*\\b${MARK}\\b`, 'g'))].map((m) => m[1]);
const jsRoots = [...JS.matchAll(new RegExp(`'${MARK}'`, 'g'))].length;
ok.push(`chrome mark derived from header.ut: [${MARK}] — ${roots.length} root(s) in the template `
	+ `(${roots.join(', ')}) + ${jsRoots} built by the theme's JS`);
if (roots.length !== EXPECT_ROOTS)
	errors.push(`header.ut marks ${roots.length} chrome root(s) with ${MARK} (${roots.join(', ') || 'none'}), `
		+ `expected ${EXPECT_ROOTS}. Each one is a Zone 1 root that is NOT inside the <nav>: the skip link is a `
		+ `sibling of .fs-shell, and the sr-only <h1> and live region sit inside .fs-main. An unmarked root is `
		+ `fenced by nothing and pinned by nothing — silently. If you added or removed one on purpose, say so `
		+ `by changing EXPECT_ROOTS; if you did not, the mark went missing`);
if (jsRoots !== EXPECT_JS_ROOTS)
	errors.push(`the theme's JS marks ${jsRoots} chrome root(s) with ${MARK}, expected ${EXPECT_JS_ROOTS}. `
		+ `A root built in JS lives outside header.ut, so nothing else counts it. If a module now mounts `
		+ `chrome of its own, say so by changing EXPECT_JS_ROOTS — and make sure it is chrome: anything `
		+ `rendered inside #view is Zone 2, where an app is entitled to win, and must not carry the mark`);

/* ---- 2. the fence (fs-sheets.js) ------------------------------------------------------ */
/* ONE canonical string, compared whole. See the header: the token-testing version passed an
 * INVERTED fence, which targets the chrome instead of sparing it. */
const EXPECT_FENCE = `:where(:not([${MARK}],[${MARK}] *))`;
const fenceM = SHEETS.match(/const CHROME_FENCE = '([^']+)';/);
if (!fenceM) {
	errors.push('fs-sheets.js no longer declares `const CHROME_FENCE = \'…\';` — the fence is what '
		+ 'keeps a third party\'s !important out of the chrome; this gate cannot find it');
} else if (fenceM[1] !== EXPECT_FENCE) {
	errors.push(`CHROME_FENCE is\n      ${fenceM[1]}\n    and must be exactly\n      ${EXPECT_FENCE}\n`
		+ `    It is appended to a foreign selector's SUBJECT, so every part of it is load-bearing: `
		+ `:where() keeps it at zero specificity, :not() spares the chrome instead of selecting it, `
		+ `[${MARK}] is the mark header.ut emits, and "[${MARK}] *" covers the subtree — the root alone `
		+ `leaves every element inside the chrome exposed`);
} else {
	ok.push(`fence excludes [${MARK}] and its subtree, at zero specificity`);
}

/* ---- 3. the pin (theme/10-chrome.css) ------------------------------------------------- */
/* Inherited properties, per CSS. Only these belong in the pin: it exists to break the inheritance
 * chain from html/body, and a non-inherited property cannot arrive that way. */
const INHERITED = new Set([
	'azimuth', 'border-collapse', 'border-spacing', 'caption-side', 'color', 'cursor', 'direction',
	'empty-cells', 'font', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
	'font-size-adjust', 'font-stretch', 'hanging-punctuation', 'hyphens', 'letter-spacing',
	'line-height', 'list-style', 'list-style-image', 'list-style-position', 'list-style-type',
	'orphans', 'overflow-wrap', 'quotes', 'tab-size', 'text-align', 'text-align-last',
	'text-indent', 'text-justify', 'text-shadow', 'text-transform', 'visibility', 'white-space',
	'widows', 'word-break', 'word-spacing', 'word-wrap', 'writing-mode', 'text-rendering',
	'image-rendering', 'pointer-events', 'caret-color', 'accent-color', 'color-scheme',
	'font-feature-settings', 'font-variation-settings', 'font-kerning', 'text-decoration-color'
]);

/* Found by the MARK, not by position: the old matcher took the first `:where(.x…){…}` in the file,
 * so a second such rule added above it would have been checked in the pin's place. */
const EXPECT_PIN = `:where([${MARK}]:not([${MARK}] *))`;
/* Comments stripped and the WHOLE selector captured, because a partial match is how a gate lies: a
 * pattern anchored on `:where(…)` alone reads `.fs-x :where([m]:not([m] *))` as the pin it wanted and
 * never sees the `.fs-x ` that scopes it to nothing. `[^{}]+` cannot cross a brace, so the nested
 * rules inside `@layer theme { … }` are what this matches, not the layer block. */
const CSS = CHROME.replace(/\/\*[\s\S]*?\*\//g, '');
const pins = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
	.map((m) => [m[0], m[1].trim().replace(/\s+/g, ' '), m[2]])
	.filter((m) => m[1].includes(MARK));
if (pins.length !== 1) {
	errors.push(`theme/10-chrome.css carries ${pins.length} \`:where(…[${MARK}]…) { … }\` rules, expected 1. `
		+ `The pin is what stops a foreign rule on html/body reaching the chrome by INHERITANCE, which `
		+ `the fence cannot: a rule on an ANCESTOR needs no match at all`);
} else {
	const [, sel, body] = pins[0];
	if (sel !== EXPECT_PIN)
		errors.push(`the pin's selector is\n      ${sel}\n    and must be exactly\n      ${EXPECT_PIN}\n`
			+ `    :where() keeps it at 0,0,0 so every chrome rule outranks it — the pin is a floor, never `
			+ `a ceiling. ":not([${MARK}] *)" is what holds it to ROOTS: a mark nested inside another mark `
			+ `would otherwise put a direct declaration on a descendant, which beats an inherited value `
			+ `even when the inherited one is OURS (measured: .fs-label lost its nowrap, text-align forced `
			+ `from start to left on 302 elements — that alone breaks every RTL language LuCI ships)`);
	const props = [...body.matchAll(/([-a-z]+)\s*:/g)].map((m) => m[1]);
	const notInherited = props.filter((p) => !INHERITED.has(p));
	if (notInherited.length)
		errors.push(`the pin declares non-inherited propert${notInherited.length > 1 ? 'ies' : 'y'} `
			+ `${notInherited.join(', ')} — the pin exists only to break the inheritance chain, and at `
			+ `zero specificity it cannot win anything else anyway`);
	if (!props.length)
		errors.push('the pin declares nothing — a pin of nothing pins nothing');
	if (!notInherited.length && props.length && sel === EXPECT_PIN)
		ok.push(`pin on [${MARK}] roots only, ${props.length} inherited properties, zero specificity`);
}

/* ---- 4. the dark-mode guard is watching everything stampDark writes -------------------- */
const stampM = PREFS.match(/function stampDark\([^)]*\)\s*\{([\s\S]*?)\n\}/);
const guardM = PREFS.match(/attributeFilter:\s*\[([^\]]*)\]/);
if (!stampM) {
	errors.push('fs-prefs.js no longer declares `function stampDark(…)` — this gate holds the guard to it');
} else if (!guardM) {
	errors.push('fs-prefs.js declares stampDark() but no observer attributeFilter — the published '
		+ 'dark-mode attributes are UNGUARDED. luci-app-openclash writes data-darkmode onto :root from '
		+ 'seven templates; without the guard an explicit Light choice is lost to the OS setting');
} else {
	const written = [...stampM[1].matchAll(/setAttribute\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
	const watched = [...guardM[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
	const missing = written.filter((a) => !watched.includes(a));
	const extra = watched.filter((a) => !written.includes(a));
	/* Two empty lists agree with each other, and that used to PASS — "watches all 0 published
	 * dialects". Both halves are read by regex, so either one going quiet (stampDark stamping through
	 * a helper or a loop instead of a literal setAttribute, an emptied attributeFilter) is the failure
	 * this gate exists to catch, not a clean bill. */
	if (!written.length)
		errors.push('stampDark() writes no attribute this gate can see — it matches literal '
			+ "setAttribute('…') calls, and finding none means either the guard is gone or the stamping "
			+ 'moved somewhere this check cannot follow. Both leave the published dark-mode attributes '
			+ 'unguarded, and both would otherwise read here as "nothing to guard"');
	else if (!watched.length)
		errors.push('the observer\'s attributeFilter is EMPTY while stampDark() writes '
			+ `${written.join(', ')} — every published dialect is unguarded`);
	if (missing.length)
		errors.push(`stampDark() writes ${missing.join(', ')} but the guard does not watch `
			+ `${missing.length > 1 ? 'them' : 'it'} — a third party can hijack that dialect silently`);
	if (extra.length)
		errors.push(`the guard watches ${extra.join(', ')}, which stampDark() does not write — it would `
			+ `restamp on an attribute it does not own`);
	if (!missing.length && !extra.length && written.length)
		ok.push(`dark-mode guard watches all ${written.length} published dialects: ${written.join(', ')}`);
}

/* ---- report --------------------------------------------------------------------------- */
for (const line of ok) console.log('  ok   ' + line);

if (errors.length) {
	console.error('\nFAIL: the chrome\'s defences have drifted from the chrome.');
	for (const e of errors) console.error('  - ' + e);
	console.error('\nThe fence, the pin and the markup name the same element in three places, and the');
	console.error('dark-mode guard mirrors stampDark. None of these fails loudly on its own: a stale');
	console.error('copy just stops defending, every other test stays green, and the menu breaks on');
	console.error('someone else\'s router — next to a third-party app we have never seen.');
	process.exit(1);
}

console.log('\nchrome-fence: the fence, the pin and the dark-mode guard all still match the chrome.');

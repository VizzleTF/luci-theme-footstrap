#!/usr/bin/env node
/* Every Appearance axis (dark mode, palette, wallpaper, rounding, tint, accent, rail, layout) is
 * implemented TWICE, and nothing held the copies together:
 *
 *   1. `partials/head.ut` — inline <script>s that read localStorage and stamp :root BEFORE THE
 *      FIRST PAINT, or the page flashes the wrong theme on every reload. They cannot `require` a
 *      LuCI module: the module loader does not exist yet.
 *   2. `fs-prefs.js` — the live appliers behind the Appearance popover. (The update-check control is
 *      NOT one of these: it is not pre-painted, and it lives in the optional updater package, not the
 *      theme tree this gate scans.)
 *
 * Forced duplication, like the @mirror cases — but these two can never be byte-identical (inline
 * script vs module), so mirror.mjs cannot hold them. What CAN be held is the CONTRACT: key names,
 * :root attributes, custom properties, valid ranges, the default — and the load-bearing rule:
 *
 *      set the custom property BEFORE the attribute that switches the mixes on,
 *      or a fresh load paints one frame with the previous hue.
 *
 * The contract is DERIVED FROM THE JS, not restated here a third time: read the axes out of the
 * theme's resource modules, then hold head.ut (plus the CSS token and fs-orphans' ignore list) to
 * them. Add an axis and the gate tells you what you forgot.
 *
 * The JS side is the WHOLE resources tree concatenated, deliberately: it used to name one file, and
 * an axis moved (or added) elsewhere would have left the gate quietly checking nothing. A glob
 * cannot go stale that way.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, read } from './lib/root.mjs';
const readTree = (p) => readdirSync(join(ROOT, p), { recursive: true })
	.filter((f) => f.endsWith('.css'))
	.map((f) => read(join(p, f)))
	.join('\n');

const readJs = (p) => readdirSync(join(ROOT, p), { recursive: true })
	.filter((f) => f.endsWith('.js'))
	.map((f) => read(join(p, f)))
	.join('\n');

/* every module the theme ships — the axes live across fs-prefs.js and menu-footstrap.js */
const JS = readJs('luci-theme-footstrap/htdocs/luci-static/resources');
const HEAD = read('luci-theme-footstrap/ucode/template/themes/footstrap/partials/head.ut');
/* the SERVER side of the axes: header.ut is what reads /etc/config/footstrap back for head.ut */
const HEADER = read('luci-theme-footstrap/ucode/template/themes/footstrap/header.ut');
const TOKENS = read('luci-theme-footstrap/styles/02-tokens.css');
const STYLES = readTree('luci-theme-footstrap/styles');
const ORPHANS = read('tools/fs-orphans.mjs');
/* The THIRD implementation of the axes, and the one nothing held. lib/gallery.mjs stamps them onto
 * :root so a11y-gallery.mjs and export-tier.mjs can sweep the matrix — its own header calls itself
 * "THE ONE COPY" and it was the forgotten one. Renaming --fs-tint-h there left every gate at exit 0
 * while export-tier reported "28 palette x mode x tint combinations" and silently measured an
 * UNTINTED page in 21 of them: 7 distinct results presented as 28. A gate that measures the wrong
 * thing quietly is worse than no gate — which is the sentence that file opens with. */
const GALLERY = read('tools/lib/gallery.mjs');

const errors = [];
const ok = [];

/* ---- 1. every localStorage key the theme uses, taken from the JS -------------------- */
const keysIn = (src) => {
	const out = new Set();
	for (const m of src.matchAll(/(?:lsGet|lsSet|lsDel)\(\s*'(fs-[a-z-]+)'/g)) out.add(m[1]);
	for (const m of src.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*'(fs-[a-z-]+)'/g)) out.add(m[1]);
	/* the accordion's remembered set keeps its key in a constant, not at the call site */
	for (const m of src.matchAll(/^const\s+\w*KEY\w*\s*=\s*'(fs-[a-z-]+)'/gm)) out.add(m[1]);
	return out;
};
/* ...plus the axes built by a FACTORY, which pass their key in as an argument — colorAxis(key,
 * attr, hueProp, colorProp) and enumAxis(key, attr, on, off). Those have no lsGet('fs-…') call site
 * at all (the factory body reads a variable), so the scan above misses them entirely and every check
 * below would go quiet on exactly the axes it is meant to hold. Match each factory call by its
 * literal args. */
const colorAxes = [...JS.matchAll(/colorAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, attr, hueProp, colorProp]) => ({ key, attr, hueProp, colorProp }));
const enumAxes = [...JS.matchAll(/enumAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, attr, on, off]) => ({ key, attr, on, off }));
/* propAxis(key, sdKey, prop, …) — an inline-property slider (rounding, tint strength). Same reason
 * as above: its lsGet(key) sits in the factory body, so keysIn() cannot see the key. Match the call. */
const propAxes = [...JS.matchAll(/propAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g)]
	.map(([, key, sdKey, prop]) => ({ key, sdKey, prop }));
/* surfaceAxis(key, sdKey, prop) — a surface repaint (cards, controls, bar, borders). Same blind
 * spot again, and section 2e needs its sdKey. */
const surfaceAxes = [...JS.matchAll(/surfaceAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, sdKey, prop]) => ({ key, sdKey, prop }));

const jsKeys = new Set([...keysIn(JS), ...colorAxes.map(a => a.key), ...enumAxes.map(a => a.key),
	...propAxes.map(a => a.key), ...surfaceAxes.map(a => a.key)]);
/* head.ut pre-paints the five colour axes through ONE local helper, so their keys are arguments
 * there too and keysIn() cannot see them either — the same blind spot, on the other side. Matched
 * by the call, and the four literals are what section 2 holds against the JS. */
const headColorCalls = [...HEAD.matchAll(/colour\(\s*'([^']+)'\s*,[^,]*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, attr, hueProp, colorProp]) => ({ key, attr, hueProp, colorProp }));
const headKeys = new Set([...keysIn(HEAD), ...headColorCalls.map(a => a.key)]);

if (!jsKeys.size) errors.push('found no fs-* localStorage keys in the theme JS — this tool is broken, not the theme');

/* A key the TEMPLATE touches but the JS does not know is a leftover: head.ut would go on
 * pre-painting a preference nothing can set or clear. */
for (const k of headKeys)
	if (!jsKeys.has(k))
		errors.push(`head.ut reads localStorage '${k}', but no theme JS ever writes it — dead pre-paint, or a typo`);

/* ---- 2. the colour axes: key, attribute, both custom properties, order, range ---------
 *
 * A colour axis holds off | a hue 1–360 | a '#rrggbb', and the attribute's VALUE says which of the
 * last two is in effect. Both sides build all five from one helper — colorAxis() in the JS,
 * colour() in the pre-paint — so the contract that can drift is the ARGUMENT LIST: a renamed
 * property or a mistyped attribute on one side and the pre-paint silently stops matching the
 * stylesheet, whose only symptom is one wrong frame on reload.
 *
 * The property-before-attribute ordering is therefore checked ONCE, inside the helper, rather than
 * per axis: with one helper there is one place it can be wrong, and checking it five times over the
 * same source text would report the same defect five times. */
if (!colorAxes.length) errors.push('no colorAxis() calls found in the theme JS — did the axis helper get renamed?');
if (!headColorCalls.length) errors.push('head.ut no longer pre-paints any colour axis through colour(key, sd, attr, hueProp, colorProp)');

/* the helper's body, where the ordering rule lives */
const headColourFn = (HEAD.match(/const colour = \([\s\S]*?\n\t{5}\};/) || [''])[0];
for (const [mode, prop] of [ [ 'hex', 'colorProp' ], [ 'hue', 'hueProp' ] ]) {
	const iProp = headColourFn.indexOf(`setProperty(${prop}`);
	const iAttr = headColourFn.indexOf(`setAttribute(attr, '${mode}')`);
	if (iProp < 0 || iAttr < 0) {
		errors.push(`head.ut's colour() no longer sets ${prop} and the ${mode} attribute value — the `
			+ `pre-paint and 03-palettes.css disagree about how a ${mode} axis is stamped`);
		continue;
	}
	if (iProp > iAttr)
		errors.push(`head.ut's colour() sets data-* = '${mode}' BEFORE ${prop}. The property must come `
			+ `first, or a fresh load paints one frame in the previous colour.`);
	else ok.push(`colour pre-paint ${mode}: property before attribute`);
}
/* the valid hue range, as the JS validates it (1..360) */
if (!(/>=\s*1\s*&&[\s\S]{0,40}?<=\s*360/).test(headColourFn))
	errors.push('head.ut\'s colour() does not validate a stored hue as 1..360 the way normColor() does '
		+ '(an out-of-range value would be pre-painted and then rejected by the page)');

for (const { key, attr, hueProp, colorProp } of colorAxes) {
	const where = `colour axis '${key}'`;
	const head = headColorCalls.find((c) => c.key === key);
	if (!head) { errors.push(`${where}: head.ut never pre-paints it — it will flash on reload`); continue; }
	if (head.attr !== attr || head.hueProp !== hueProp || head.colorProp !== colorProp) {
		errors.push(`${where}: head.ut pre-paints it as (${head.attr}, ${head.hueProp}, ${head.colorProp}) `
			+ `but the JS applies it as (${attr}, ${hueProp}, ${colorProp}) — one of the two is painting `
			+ `a token the stylesheet does not read`);
		continue;
	}
	/* the stylesheet's half: both modes have to be declared, or an axis stamps an attribute nothing
	 * matches. The hex mode of the canvas is the exception — it overwrites --fs-bg inline, so there
	 * is no rule for it to match and none to look for. */
	if (!STYLES.includes(`[${attr}="hue"]`))
		errors.push(`${where}: no :root[${attr}="hue"] rule in styles/ — the pre-paint stamps a mode the `
			+ `stylesheet does not implement, so the slider would move nothing`);
	/* the gates' own stamper, held to the same axis it claims to sweep. Only the two axes the
	 * matrix actually walks (tint, accent) — the status colours are not part of the export-tier
	 * contract, and asserting a sweep that does not exist would be a demand to write a slower gate
	 * rather than a defect. */
	if ((key === 'fs-tint' || key === 'fs-accent') && !GALLERY.includes(`'${attr}', '${hueProp}'`))
		errors.push(`${where}: tools/lib/gallery.mjs does not stamp ${attr} with ${hueProp} — the axe and `
			+ `export-tier sweeps would go on reporting this axis in their combination count while every `
			+ `point of it measured the UNSTAMPED page, which is a pass by not looking`);
	ok.push(`colour axis ${key.padEnd(10)} -> ${attr}, ${hueProp} / ${colorProp}   (key, attr and both properties agree)`);
}

/* ---- 2b. the enum axes: key, attribute and the ON value ------------------------------
 *
 * A two-value axis (palette, wallpaper) stamps the ON value as the attribute's value and removes
 * the attribute for OFF — a bare :root IS the default. Both halves matter: pre-paint the attribute
 * and forget the removal and a browser that has switched the axis back off keeps the old look for
 * one frame; stamp the wrong VALUE ('dark' for 'hicontrast') and the palette block never matches at
 * all, silently, until the popover is touched. */
if (!enumAxes.length) errors.push('no enumAxis() calls found in the theme JS — did the axis helper get renamed?');

for (const { key, attr, on } of enumAxes) {
	const where = `enum axis '${key}'`;
	if (!headKeys.has(key)) { errors.push(`${where}: head.ut never reads localStorage '${key}' — it will flash on reload`); continue; }
	if (!HEAD.includes(`setAttribute('${attr}', '${on}')`)) {
		errors.push(`${where}: head.ut never stamps ${attr}='${on}' — the pre-paint and the live applier `
			+ `disagree about this axis's ON value, so a fresh load paints the default and the popover `
			+ `paints the choice`);
		continue;
	}
	if (!HEAD.includes(`removeAttribute('${attr}')`)) {
		errors.push(`${where}: head.ut never removes ${attr} — OFF is a bare :root, so without the `
			+ `removal the pre-paint can only ever turn this axis on`);
		continue;
	}
	ok.push(`enum axis ${key.padEnd(10)} -> ${attr}='${on}'   (key, attr and both directions agree)`);
}

/* ...and the converse: an axis lib/gallery.mjs stamps that the JS no longer has is a sweep of a
 * dead attribute, which also reads as "28 combinations" and measures 7. */
for (const [, attr, prop] of GALLERY.matchAll(/hue\(\w+, '([^']+)', '([^']+)'\)/g))
	if (!colorAxes.some((a) => a.attr === attr && a.hueProp === prop))
		errors.push(`tools/lib/gallery.mjs stamps ${attr}/${prop}, which no colorAxis() in the theme JS `
			+ `declares — the gates sweep an axis the theme does not have`);

/* ---- 2c. EVERY OTHER :root attribute an applier stamps -------------------------------
 *
 * The hue and enum checks above only cover the two FACTORY shapes. The axes that keep their own
 * applier — wallpaper (three-valued) and density (three-valued) — stamped a `data-*` attribute that
 * nothing held to head.ut at all: rename it on one side and the pre-paint silently stops matching,
 * whose only symptom is one wrong frame on reload, which is the exact failure this file exists for.
 *
 * Derived, not listed: take the attributes the JS appliers stamp and require head.ut to stamp each
 * one too.
 *
 * It deliberately does NOT require the matching removeAttribute, and the reason is worth keeping:
 * the first version of this check did, and it failed on `data-rail` — which is correct code. The
 * pre-paint runs on a FRESH document where :root carries nothing but what the SERVER wrote (only
 * `data-layout`), so there is never a stale attribute to clear; an axis whose off-state is a deleted
 * key (applyRail lsDel's) simply falls through its `if` and is already right. The removals the other
 * pre-paints do are defensive symmetry, not a requirement — asserting them would have made this gate
 * demand a change that fixes nothing. */
const OUTBOUND = new Set(['data-theme', 'data-bs-theme', 'data-darkmode']);	/* checked in 3b */
const factoryAttrs = new Set([...colorAxes.map(a => a.attr), ...enumAxes.map(a => a.attr)]);
const jsSets = new Set([...JS.matchAll(/root\.setAttribute\('(data-[a-z-]+)'/g)].map((m) => m[1]));

for (const attr of jsSets) {
	if (OUTBOUND.has(attr) || factoryAttrs.has(attr)) continue;
	if (!HEAD.includes(`setAttribute('${attr}'`)) {
		errors.push(`axis attribute '${attr}': an applier in the theme JS stamps it, but head.ut never `
			+ `does — the axis is not pre-painted, so a reload shows the default for one frame and jumps`);
		continue;
	}
	ok.push(`axis attr ${attr.padEnd(14)} (the applier stamps it and head.ut pre-paints it)`);
}

/* ---- 2d. THE SERVER READ: every option Save-as-default writes must be read back -------
 *
 * A third implementation nothing held. saveAsDefault() uci-sets the fields snapshotAxes() returns;
 * header.ut reads /etc/config/footstrap back into `fs_defaults`, head.ut sanitises that into
 * window.__fsSD, and fs-prefs.js's def() reads it from there. An axis missing from the SERVER read
 * is written to disk correctly and never comes back: Save as default reports success, the file is
 * right, and "Reset to saved" drops the browser to the BUILT-IN default because the value the
 * server hands the client was never there.
 *
 * It has happened twice — `density`, then all seven colour and surface axes at once — and neither
 * time did anything fail: the pre-paint and the live applier agreed with each other, which is all
 * this file used to check. Derived from snapshotAxes(), the one list that IS the contract. */
/* The uci options header.ut reads back that are NOT axes: they have no browser layer, no Appearance
 * control and therefore no business in snapshotAxes() — Save as default must never write them.
 * login_bg and pattern are the two uploaded images' cache-bust tokens, written by the upload path
 * itself; font_sans, font_mono and fonts are the router's webfont setting, written by
 * fonts/set-font.sh or by hand. All five still travel to the client through FS_AXES. */
const SERVER_ONLY = new Set(['login_bg', 'pattern', 'font_sans', 'font_mono', 'fonts']);

const snapBody = (JS.match(/function snapshotAxes\(\)\s*\{([\s\S]*?)\n\}/) || [, ''])[1];
const snapFields = [...snapBody.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
const headerAxes = (HEADER.match(/const FS_AXES = \[([\s\S]*?)\]/) || [, ''])[1];
const headerFields = [...headerAxes.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

if (!snapFields.length) errors.push('no snapshotAxes() found in the theme JS — did Save-as-default get renamed?');
else if (!headerFields.length) errors.push('header.ut no longer declares `const FS_AXES = [...]` — the gate cannot tell which uci options the server reads back');
else {
	for (const f of snapFields)
		if (!headerFields.includes(f))
			errors.push(`uci option '${f}': saveAsDefault() writes it, but header.ut's FS_AXES does not read `
				+ `it back — the router default for this axis reaches no browser, so "Reset to saved" `
				+ `falls through to the built-in and Save-as-default looks like it did nothing`);
	for (const f of headerFields)
		if (!SERVER_ONLY.has(f) && !snapFields.includes(f))
			errors.push(`uci option '${f}': header.ut reads it back, but snapshotAxes() never writes it — `
				+ `either a leftover from a removed axis, or the axis is missing from Save-as-default`);
	if (!errors.length)
		ok.push(`server read: all ${snapFields.length} saved option(s) are read back by header.ut`);
}

/* ---- 2e. THE FIELD NAME: every sd() lookup must name a field head.ut actually EMITS ----
 *
 * The factories reach the router default through window.__fsSD, and they get the field name two
 * different ways: enumAxis and colorAxis DERIVE it from the localStorage key (key minus 'fs-',
 * hyphens folded to underscores, because the key is hyphenated and the uci option is not), while
 * propAxis and surfaceAxis are HANDED it, since one of them is a rename rather than a spelling
 * ('fs-radius' -> rounding). Nothing checked either against the template.
 *
 * `fs-pattern-ink` is what that cost: a bare slice(3) asked for 'pattern-ink', head.ut emits
 * `pattern_ink`, so sd() answered undefined forever and the axis reported the BUILT-IN default
 * however the router was configured — the Ink control said Theme while the pre-paint had already
 * painted Original, matchesSavedDefault() was false with nothing touched, and pressing
 * Save-as-default wrote the built-in over the admin's stored value. Every symptom is silent, which
 * is how it survived a review round (openwrt/luci#8903) and every gate in this file.
 *
 * THE DERIVING FACTORIES' FORMULA IS TAKEN FROM THE SOURCE AND RUN, never restated here. Written
 * the obvious way — repeat `key.slice(3).replace(/-/g, '_')` in this file and compare — the gate
 * holds head.ut against ITSELF and stays green while fs-prefs.js says something else entirely:
 * measured by breaking the fold back to a bare slice(3), which such a version passed. */
const sdLine = (HEAD.match(/window\.__fsSD\s*=\s*\{[^\n]*/) || [''])[0];
const sdFields = [...sdLine.matchAll(/[{,]\s*([a-z_]+)\s*:/g)].map((m) => m[1]);
/* `const sdKey = <expr>;` out of the named factory's body, compiled into a function of `key` */
const sdFormula = (factory) => {
	const body = JS.match(new RegExp(`function ${factory}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
	const expr = body && body[0].match(/const\s+sdKey\s*=\s*([^;]+);/);
	if (!expr) return null;
	try { return new Function('key', `return (${expr[1]});`); }
	catch { return null; }
};
const colorFormula = sdFormula('colorAxis');
const enumFormula = sdFormula('enumAxis');
if (!colorFormula) errors.push('colorAxis() no longer derives `const sdKey = …` — this gate cannot follow it any more');
if (!enumFormula) errors.push('enumAxis() no longer derives `const sdKey = …` — this gate cannot follow it any more');
const sdReaders = [
	...(colorFormula ? colorAxes.map((a) => ({ ...a, sdKey: colorFormula(a.key), how: "derived from the key by colorAxis" })) : []),
	...(enumFormula ? enumAxes.map((a) => ({ ...a, sdKey: enumFormula(a.key), how: "derived from the key by enumAxis" })) : []),
	...propAxes.map((a) => ({ ...a, how: 'passed to propAxis explicitly' })),
	...surfaceAxes.map((a) => ({ ...a, how: 'passed to surfaceAxis explicitly' })),
];
/* the axes read outside a factory spell the field at the call site — hold those too */
const sdLiterals = [...JS.matchAll(/\bsd\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1]);

if (!sdFields.length)
	errors.push('head.ut no longer emits a `window.__fsSD={…}` object literal on one line — the gate that '
		+ 'holds every sd() field name against the template cannot read it any more');
else {
	for (const a of sdReaders)
		if (!sdFields.includes(a.sdKey))
			errors.push(`axis '${a.key}' reads its router default from window.__fsSD.${a.sdKey} (${a.how}), but `
				+ `head.ut emits no such field — sd() is undefined forever, so the axis reports the built-in `
				+ `default whatever the router saved, and Save-as-default then overwrites the saved value with it`);
	for (const f of sdLiterals)
		if (!sdFields.includes(f))
			errors.push(`sd('${f}') is read in the theme JS, but head.ut emits no window.__fsSD.${f} — `
				+ `same silent failure as above: the router default never reaches the browser`);
	if (!errors.length)
		ok.push(`sd() fields: ${sdReaders.length} factory axes + ${new Set(sdLiterals).size} direct reads all name a field head.ut emits`);
}

/* ---- 3. the rounding default: JS, template and CSS token must be the same number ----- */
const jsRadius = JS.match(/const\s+FS_RADIUS_DEFAULT\s*=\s*(\d+)/);
const cssRadius = TOKENS.match(/--fs-radius-base:\s*(\d+)px/);
const headRadius = HEAD.match(/r\s*!==?\s*(\d+)/);
if (!jsRadius) errors.push('FS_RADIUS_DEFAULT not found in the theme JS (fs-prefs.js)');
else if (!cssRadius) errors.push('--fs-radius-base not found in styles/02-tokens.css');
else if (!headRadius) errors.push('head.ut no longer skips the default rounding (the `r !== <default>` test is gone)');
else if (!(jsRadius[1] === cssRadius[1] && cssRadius[1] === headRadius[1]))
	errors.push(`the rounding DEFAULT disagrees across the three places that state it: `
		+ `JS FS_RADIUS_DEFAULT=${jsRadius[1]}, CSS --fs-radius-base=${cssRadius[1]}px, head.ut r!==${headRadius[1]}. `
		+ `head.ut cannot read the CSS token (it runs before the stylesheet), so this is the only thing checking it.`);
else ok.push(`rounding default ${jsRadius[1]}px agrees in the JS, the CSS token and head.ut`);

/* ---- 3b. the dark-mode attributes: the same SET, same values, in both places -----------
 *
 * Dark mode is announced three times: `data-darkmode` (what this theme's CSS reads) plus
 * `data-theme` and `data-bs-theme` (the two dialects third-party apps sniff for). Both head.ut's
 * pre-paint and stampDark() write them; one added to one copy and forgotten in the other has a
 * symptom nobody reports — an app's dark styles are dead on a fresh load and come alive the
 * moment you touch the Appearance popover (or vice versa). Derive the set from the JS. */
const stampBody = (src, re) => (src.match(re) || [, null])[1];
const attrsIn = (body) => new Map([...(body || '').matchAll(
	/setAttribute\('([^']+)',\s*dark\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => [m[1], `${m[2]}/${m[3]}`]));

const jsStamp = attrsIn(stampBody(JS, /function stampDark\([^)]*\)\s*\{([\s\S]*?)\n\}/));
const headStamp = attrsIn(stampBody(HEAD, /function set\(dark\)\s*\{([\s\S]*?)\n\t\t\t\t\}/));

if (!jsStamp.size) errors.push('no stampDark() found in the theme JS — did the dark-mode applier get renamed?');
else if (!headStamp.size) errors.push('head.ut no longer stamps the dark-mode attributes in its pre-paint set(dark)');
else {
	for (const [attr, val] of jsStamp)
		if (!headStamp.has(attr))
			errors.push(`dark mode: stampDark() sets ${attr}, head.ut does not — an app sniffing it sees the `
				+ `wrong mode until the user touches the Appearance popover`);
		else if (headStamp.get(attr) !== val)
			errors.push(`dark mode: ${attr} is '${val}' in the JS but '${headStamp.get(attr)}' in head.ut`);
	for (const attr of headStamp.keys())
		if (!jsStamp.has(attr))
			errors.push(`dark mode: head.ut pre-paints ${attr}, but stampDark() never updates it — toggling the `
				+ `mode live would leave it stating the mode the page loaded in`);
	if (!errors.length)
		ok.push(`dark mode  -> ${[...jsStamp.keys()].join(', ')}   (pre-paint and live applier stamp the same set)`);
}

/* The two compat names are OUTBOUND, like the --*-color-* export tier: apps read them, this
 * theme must not. A styles/ rule keyed off data-theme is hijackable by any app that stamps it
 * (OpenClash writes data-darkmode on :root from its own luminance sniff). */
for (const attr of ['data-theme', 'data-bs-theme'])
	if (STYLES.includes(`[${attr}`))
		errors.push(`styles/ keys a rule off [${attr}] — that name is OUTBOUND compatibility for third-party `
			+ `apps, not a theme input. The theme's own dark rules read [data-darkmode].`);

/* ---- 4. css-orphans must know every key, or a new axis breaks that gate -------------- */
for (const k of jsKeys)
	if (!ORPHANS.includes(`'${k}'`))
		errors.push(`tools/fs-orphans.mjs does not list '${k}' in IGNORE_EXACT — it looks like an fs-* CSS `
			+ `class to that tool's regex, so adding this axis makes css-orphans report a phantom dead selector`);

/* ---- report --------------------------------------------------------------------------- */
for (const line of ok) console.log('  ok   ' + line);
console.log(`  ok   ${jsKeys.size} localStorage keys, all known to css-orphans`);

if (errors.length) {
	console.error('\nFAIL: the Appearance axes have drifted between their two implementations.');
	for (const e of errors) console.error('  - ' + e);
	console.error('\nhead.ut pre-paints every axis before the first frame and fs-prefs.js');
	console.error('applies it live; the two cannot share code (the template runs before the module');
	console.error('loader exists), so this is what keeps them saying the same thing.');
	process.exit(1);
}

console.log('\naxes: the pre-paint template and the live appliers agree on every axis.');

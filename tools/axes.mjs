#!/usr/bin/env node
/* Every Appearance axis (twenty-five localStorage keys, five axis shapes) is implemented TWICE, and
 * nothing else holds the copies together:
 *
 *   1. `partials/head.ut` — inline <script>s that read localStorage and stamp :root BEFORE THE
 *      FIRST PAINT, or the page flashes the wrong theme on every reload. They cannot `require` a
 *      LuCI module: the loader does not exist yet.
 *   2. `fs-axes.js` — the five axis factories behind the Appearance tab; `fs-prefs.js` wires them.
 *
 * The two can never be byte-identical, so mirror.mjs cannot hold them; this holds the CONTRACT: key
 * names, :root attributes, custom properties, valid ranges, every slider's limits and default, and the load-bearing rule: set the custom
 * property BEFORE the attribute that switches the mixes on, or a fresh load paints one frame with
 * the previous hue. The JS side is the WHOLE resources tree, so a moved axis is still found. */
import { read, readAll } from './lib/root.mjs';
import { keysIn, storageKeys, colorAxesIn, enumAxesIn, listAxesIn, propAxesIn, surfaceAxesIn } from './lib/axes.mjs';

/* every module the theme ships — the axes live in fs-axes.js and fs-prefs.js */
const JS = readAll('luci-theme-footstrap/htdocs/luci-static/resources', '.js');
const HEAD = read('luci-theme-footstrap/ucode/template/themes/footstrap/partials/head.ut');
const TOKENS = read('luci-theme-footstrap/styles/02-tokens.css');
const STYLES = readAll('luci-theme-footstrap/styles', '.css');
/* The third implementation of the axes: lib/gallery.mjs stamps them onto :root so a11y-gallery.mjs
 * and export-tier.mjs can sweep the matrix. A rename of `--fs-tint-h` there left export-tier
 * measuring an UNTINTED page in 21 of its 28 combinations (7 distinct results). */
const GALLERY = read('tools/lib/gallery.mjs');

const errors = [];
const ok = [];

/* "did MY section pass?", not "has nothing failed yet": a global-empty test lets one unrelated failure
 * delete a later section's success line, and the operator cannot tell passed from never ran. */
const errorMark = () => errors.length;
const cleanSince = (m) => errors.length === m;

/* ---- 1. every localStorage key the theme uses, taken from the JS -------------------- */
const colorAxes = colorAxesIn(JS), enumAxes = enumAxesIn(JS), listAxes = listAxesIn(JS),
	propAxes = propAxesIn(JS), surfaceAxes = surfaceAxesIn(JS);
if (listAxes.length !== 3) errors.push(`found ${listAxes.length} listAxis() calls, expected 3 — did the factory's signature change?`);
if (surfaceAxes.length !== 4) errors.push(`found ${surfaceAxes.length} surfaceAxis() calls, expected 4 — did the factory's signature change?`);
const jsKeys = storageKeys(JS);
/* head.ut pre-paints the five colour axes through ONE helper, so its keys are arguments too; matched
 * by the call, and the four literals are what section 2 holds against the JS. */
const headColorCalls = [...HEAD.matchAll(/colour\(\s*'([^']+)'\s*,[^,]*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*(?:,\s*'([^']+)'\s*)?\)/g)]
	.map(([, key, attr, hueProp, colorProp, inkProp]) => ({ key, attr, hueProp, colorProp, inkProp }));
const headKeys = new Set([...keysIn(HEAD), ...headColorCalls.map(a => a.key)]);

if (!jsKeys.size) errors.push('found no fs-* localStorage keys in the theme JS — this tool is broken, not the theme');

/* A key the TEMPLATE touches but the JS does not know is a leftover: head.ut would go on
 * pre-painting a preference nothing can set or clear. */
for (const k of headKeys)
	if (!jsKeys.has(k))
		errors.push(`head.ut reads localStorage '${k}', but no theme JS ever writes it — dead pre-paint, or a typo`);

/* ---- 2. the colour axes: key, attribute, both custom properties, order, range ----
 *
 * A colour axis holds off | a hue 1-360 | a '#rrggbb'; the attribute's VALUE says which. Both sides
 * build all five from one helper, so what can drift is its ARGUMENT LIST (a renamed property or
 * attribute makes the pre-paint stop matching the stylesheet: one wrong frame on reload). The
 * property-before-attribute order is checked once, inside the helper. */
if (!colorAxes.length) errors.push('no colorAxis() calls found in the theme JS — did the axis helper get renamed?');
if (!headColorCalls.length) errors.push('head.ut no longer pre-paints any colour axis through colour(key, sd, attr, hueProp, colorProp, inkProp)');

/* the helper's body, where the ordering rule lives */
const headColourFn = (HEAD.match(/const colour = \([\s\S]*?\n\t{5}\};/) || [''])[0];
/* the hex branch ends where the hue branch's parseInt starts; each ink call is looked for in its own branch only */
const hueAt = headColourFn.indexOf('parseInt(');
const branchOf = { hex: headColourFn.slice(0, hueAt), hue: headColourFn.slice(hueAt) };
for (const [mode, prop, ink] of [ [ 'hex', 'colorProp', 'setProperty(inkProp' ], [ 'hue', 'hueProp', 'removeProperty(inkProp' ] ]) {
	if (!branchOf[mode].includes(ink))
		errors.push(`head.ut's colour() never calls ${ink}, in the ${mode} branch — the pre-paint would leave the `
			+ `ink of a ${mode} fill unset or stale for the first frame`);
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
/* The ink is computed in JS where the hex is applied, in two copies that cannot share code. Text
 * comparison would pass a changed constant on one side, so take both function bodies and RUN them
 * over a spread of fills, including both sides of the .62 threshold. */
const inkFn = (src, re, param) => {
	const m = src.match(re);
	try { return m ? new Function(param, m[1]) : null; } catch { return null; }
};
const jsInk = inkFn(JS, /function inkFor\(hex\)\s*\{([\s\S]*?)\n\}/, 'hex');
const headInk = inkFn(HEAD, /const inkFor = \(hx\) => \{([\s\S]*?)\n\t{5}\};/, 'hx');
if (!jsInk || !headInk) errors.push('inkFor() is not readable in fs-axes.js and head.ut — the hex-ink gate cannot compare the two copies');
else {
	const inkMark = errorMark();
	const palette = [...STYLES.matchAll(/--fs-(?:accent|good|warn|danger)-base:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]);
	const grey = Array.from({ length: 16 }, (_, i) => '#' + (i * 17).toString(16).padStart(2, '0').repeat(3));
	for (const hex of ['#ffcc00', '#0033aa', '#808080', ...palette, ...grey]) {
		const a = jsInk(hex), b = headInk(hex);
		if (a !== b) errors.push(`hex ink for ${hex}: fs-axes.js gives ${a}, head.ut gives ${b} — the pre-paint and the live applier disagree`);
	}
	if (cleanSince(inkMark)) ok.push('hex ink: fs-axes.js inkFor() and head.ut inkFor() agree over the sample');
}
/* the valid hue range, as the JS validates it (1..360) */
if (!(/>=\s*1\s*&&[\s\S]{0,40}?<=\s*360/).test(headColourFn))
	errors.push('head.ut\'s colour() does not validate a stored hue as 1..360 the way normColor() does '
		+ '(an out-of-range value would be pre-painted and then rejected by the page)');

for (const { key, attr, hueProp, colorProp, inkProp } of colorAxes) {
	const where = `colour axis '${key}'`;
	const head = headColorCalls.find((c) => c.key === key);
	if (!head) { errors.push(`${where}: head.ut never pre-paints it — it will flash on reload`); continue; }
	if (head.attr !== attr || head.hueProp !== hueProp || head.colorProp !== colorProp || head.inkProp !== inkProp) {
		errors.push(`${where}: head.ut pre-paints it as (${head.attr}, ${head.hueProp}, ${head.colorProp}, ${head.inkProp}) `
			+ `but the JS applies it as (${attr}, ${hueProp}, ${colorProp}, ${inkProp}) — one of the two is painting `
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

/* ---- 2b. the enum axes: key, attribute and the ON value ----
 *
 * A two-value axis stamps the ON value as the attribute's value and removes the attribute for OFF,
 * so a bare :root IS the default. Both halves matter: pre-paint the attribute and forget the
 * removal and a browser that has switched the axis back off keeps the old look for one frame; stamp
 * the wrong VALUE and the block never matches at all, silently, until the tab is touched. */
if (!enumAxes.length) errors.push('no enumAxis() calls found in the theme JS — did the axis helper get renamed?');

for (const { key, attr, on } of enumAxes) {
	const where = `enum axis '${key}'`;
	if (!headKeys.has(key)) { errors.push(`${where}: head.ut never reads localStorage '${key}' — it will flash on reload`); continue; }
	if (!HEAD.includes(`setAttribute('${attr}', '${on}')`)) {
		errors.push(`${where}: head.ut never stamps ${attr}='${on}' — the pre-paint and the live applier `
			+ `disagree about this axis's ON value, so a fresh load paints the default and the tab `
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

/* The list-shaped axes, held the same way, in their own loop: once their attribute is factory-stamped
 * 2c skips it, and `data-density` renamed on one side alone went unreported. head.ut pre-paints them
 * as a chain of literal comparisons, so every value the JS stamps must appear there as a stamp. */
for (const { key, attr, values, listName } of listAxes) {
	const where = `list axis '${key}'`;
	if (!values.length) { errors.push(`${where}: ${listName} is not a list of string literals this gate can read`); continue; }
	if (!headKeys.has(key)) { errors.push(`${where}: head.ut never reads localStorage '${key}' — it will flash on reload`); continue; }
	/* Looked for in the LINES THAT STAMP, not file-wide: every value also sits in head.ut's sanitiser
	 * whitelist. Deleting `'large'` from the stamp left a file-wide search green. */
	const stampLines = HEAD.split('\n')
		.map((l, i, all) => (l.includes(`setAttribute('${attr}'`) ? all.slice(Math.max(0, i - 2), i + 1).join('\n') : ''))
		.join('\n');
	const missing = values.filter((v) => !stampLines.includes(`'${v}'`));
	if (missing.length) {
		errors.push(`${where}: head.ut never stamps ${attr} for ${missing.map((v) => `'${v}'`).join(', ')} — `
			+ `the pre-paint and the live applier disagree about this axis's values, so a fresh load `
			+ `paints the default and the tab paints the choice`);
		continue;
	}
	if (!HEAD.includes(`removeAttribute('${attr}')`)) {
		errors.push(`${where}: head.ut never removes ${attr} — the default is a bare :root, so without `
			+ `the removal the pre-paint can only ever turn this axis on`);
		continue;
	}
	ok.push(`list axis ${key.padEnd(10)} -> ${attr}=${values.map((v) => `'${v}'`).join('|')}   (key, attr and both directions agree)`);
}

/* ...and the converse: an axis lib/gallery.mjs stamps that the JS no longer has is a sweep of a
 * dead attribute, which also reads as "28 combinations" and measures 7. */
for (const [, attr, prop] of GALLERY.matchAll(/hue\(\w+, '([^']+)', '([^']+)'\)/g))
	if (!colorAxes.some((a) => a.attr === attr && a.hueProp === prop))
		errors.push(`tools/lib/gallery.mjs stamps ${attr}/${prop}, which no colorAxis() in the theme JS `
			+ `declares — the gates sweep an axis the theme does not have`);

/* ---- 2c. every other :root attribute an applier stamps ----
 *
 * The checks above cover the two FACTORY shapes. An axis with its own applier stamps a `data-*`
 * attribute nothing holds to head.ut. Derived, not listed: every attribute the JS appliers stamp
 * must be stamped by head.ut. The matching removeAttribute is not required (`data-rail` has none). */
const OUTBOUND = new Set(['data-theme', 'data-bs-theme', 'data-darkmode']);	/* checked in 3b */
const factoryAttrs = new Set([...colorAxes.map(a => a.attr), ...enumAxes.map(a => a.attr),
	...listAxes.map(a => a.attr)]);
/* Both spellings of the receiver: applyLayout() writes `document.documentElement.setAttribute('data-layout', …)`
 * while the others use a local `root`. `\w`, not `[a-z-]+`: `data-raiL` must land IN the derived set
 * instead of making the whole match fail and dropping out of it. */
const jsSets = new Set(
	[...JS.matchAll(/(?:^|[^\w.])(?:root|document\.documentElement)\.setAttribute\('(data-[\w-]+)'/g)]
		.map((m) => m[1]));

/* A derived list needs an expected size: a regex that matched no call at all would report zero
 * findings, the same as "every axis agrees". data-layout and data-rail are the two bespoke appliers. */
const MIN_2C_ATTRS = 2;
if (jsSets.size < MIN_2C_ATTRS)
	errors.push(`only ${jsSets.size} axis attribute(s) matched by the (root|document.documentElement)`
		+ `.setAttribute(...) scan in section 2c — expected at least ${MIN_2C_ATTRS} (data-layout, `
		+ `data-rail). A derived list this short has likely stopped matching one of them rather than `
		+ `run out of axes to find.`);

for (const attr of jsSets) {
	if (OUTBOUND.has(attr) || factoryAttrs.has(attr)) continue;
	if (!HEAD.includes(`setAttribute('${attr}'`)) {
		errors.push(`axis attribute '${attr}': an applier in the theme JS stamps it, but head.ut never `
			+ `does — the axis is not pre-painted, so a reload shows the default for one frame and jumps`);
		continue;
	}
	ok.push(`axis attr ${attr.padEnd(14)} (the applier stamps it and head.ut pre-paints it)`);
}

/* ---- 2d. the server read: every option Save-as-default writes must be read back ----
 *
 * saveAsDefault() uci-sets the AXES table's keys; header.ut hands /etc/config/footstrap's section to
 * head.ut as `fs_defaults`, which becomes window.__fsSD, which fs-prefs.js's def() reads. An axis
 * missing from that read is saved correctly and never comes back: "Reset to saved" falls to the
 * built-in default. It happened for `density`, then for all seven colour and surface axes at once. */
/* The uci options header.ut reads back that are NOT axes, so Save as default must never write them:
 * login_bg and pattern are the uploaded images' cache-bust tokens, font_sans, font_mono and fonts
 * the router's webfont setting (fonts/set-font.sh). */
const SERVER_ONLY = new Set(['login_bg', 'pattern', 'font_sans', 'font_mono', 'fonts']);

const serverReadMark = errorMark();
/* The AXES table's top-level keys, found by stripping the nested { ... } rows until none is left. */
let axesBody = (JS.match(/const AXES = \{([\s\S]*?)\n\};/) || [, ''])[1];
for (let prev; prev !== axesBody;) { prev = axesBody; axesBody = axesBody.replace(/\{[^{}]*\}/g, ''); }
const snapFields = [...axesBody.matchAll(/\b([a-z_]+)\s*:/g)].map((m) => m[1]);
/* head.ut is what consumes the section, so its fs_defaults.<key> reads are the options the server uses */
const headerFields = [...new Set([...HEAD.matchAll(/\bfs_defaults\.([a-z_]+)/g)].map((m) => m[1]))];

if (!snapFields.length) errors.push('no `const AXES = {...}` table found in the theme JS — did Save-as-default get renamed?');
else if (!headerFields.length) errors.push('head.ut no longer reads `fs_defaults.<key>` — the gate cannot tell which uci options the server reads back');
else {
	for (const f of snapFields)
		if (!headerFields.includes(f))
			errors.push(`uci option '${f}': saveAsDefault() writes it, but head.ut's fs_defaults does not read `
				+ `it back — the router default for this axis reaches no browser, so "Reset to saved" `
				+ `falls through to the built-in and Save-as-default looks like it did nothing`);
	for (const f of headerFields)
		if (!SERVER_ONLY.has(f) && !snapFields.includes(f))
			errors.push(`uci option '${f}': head.ut reads it back, but snapshotAxes() never writes it — `
				+ `either a leftover from a removed axis, or the axis is missing from Save-as-default`);
	if (cleanSince(serverReadMark))
		ok.push(`server read: all ${snapFields.length} saved option(s) are read back by head.ut`);
}

/* ---- 2e. the field name: every sd() lookup must name a field head.ut actually emits ----
 *
 * enumAxis and colorAxis DERIVE the field from the localStorage key (minus 'fs-', hyphens to
 * underscores); propAxis and surfaceAxis are HANDED it. `fs-pattern-ink` with a bare slice(3) asked
 * for 'pattern-ink' where head.ut emits `pattern_ink`: sd() answered undefined forever
 * (openwrt/luci#8903). */
const sdMark = errorMark();
const sdLine = (HEAD.match(/window\.__fsSD\s*=\s*\{[^\n]*/) || [''])[0];
const sdFields = [...sdLine.matchAll(/[{,]\s*([a-z_]+)\s*:/g)].map((m) => m[1]);
/* The deriving factories' formula is taken from the source and run, never restated: a restated fold
 * holds head.ut against itself (a bare slice(3) in fs-prefs.js passed). */
const sdFormula = (factory) => {
	const body = JS.match(new RegExp(`function ${factory}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
	const expr = body && body[0].match(/const\s+sdKey\s*=\s*([^;]+);/);
	if (!expr) return null;
	try { return new Function('key', `return (${expr[1]});`); }
	catch { return null; }
};
const colorFormula = sdFormula('colorAxis');
/* enumAxis() delegates to listAxis(), so the fold is stated once, there — and both families are
 * held to it. */
const enumFormula = sdFormula('listAxis');
if (!colorFormula) errors.push('colorAxis() no longer derives `const sdKey = …` — this gate cannot follow it any more');
if (!enumFormula) errors.push('listAxis() no longer derives `const sdKey = …` — this gate cannot follow it any more');
const sdReaders = [
	...(colorFormula ? colorAxes.map((a) => ({ ...a, sdKey: colorFormula(a.key), how: "derived from the key by colorAxis" })) : []),
	...(enumFormula ? enumAxes.map((a) => ({ ...a, sdKey: enumFormula(a.key), how: "derived from the key by enumAxis" })) : []),
	...(enumFormula ? listAxes.map((a) => ({ ...a, sdKey: enumFormula(a.key), how: "derived from the key by listAxis" })) : []),
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
	if (cleanSince(sdMark))
		ok.push(`sd() fields: ${sdReaders.length} factory axes + ${new Set(sdLiterals).size} direct reads all name a field head.ut emits`);
}

/* ---- 3. every propAxis slider: min, max and default in the JS, head.ut (pre-paint and _sd_range) and the CSS token ----
 *
 * head.ut runs before the stylesheet and the module loader, so it states each limit again as a literal;
 * a copy that drifts silently reverts a stored value on every page but Appearance. A copy this gate
 * cannot find is an error, never a skip. */
if (propAxes.length !== 6) errors.push(`found ${propAxes.length} propAxis() calls with literal limits, expected 6 — did the factory's signature change?`);
const cssNum = (s) => s.trim().replace(/^0(?=\.)/, '');
for (const { key, sdKey, prop, min, max, dfl, fmt } of propAxes) {
	const where = `slider '${key}'`;
	const mark = errorMark();
	const pre = new RegExp(`>=\\s*${min}\\s*&&\\s*\\w+\\s*<=\\s*${max}\\s*&&\\s*\\w+\\s*!==?\\s*${dfl}\\)\\s*root\\.style\\.setProperty\\('${prop}'`);
	if (!pre.test(HEAD))
		errors.push(`${where}: head.ut's pre-paint does not test ${min}..${max} and !== ${dfl} before stamping ${prop} — `
			+ `the JS says min ${min}, max ${max}, default ${dfl}`);
	if (!new RegExp(`_sd_range\\(fs_defaults\\.${sdKey},\\s*${min},\\s*${max}\\)`).test(HEAD))
		errors.push(`${where}: head.ut has no _sd_range(fs_defaults.${sdKey}, ${min}, ${max}) — the server clamps a saved default to other limits than the JS`);
	const token = STYLES.match(new RegExp(`${prop}:\\s*([^;]+);`));
	const want = String(new Function('v', `return ${fmt.replace(/^\(v\) => /, '')};`)(dfl));
	if (!token) errors.push(`${where}: ${prop} is declared nowhere in styles/`);
	else if (cssNum(token[1]) !== cssNum(want))
		errors.push(`${where}: CSS ${prop} is ${token[1].trim()} but the JS default ${dfl} formats to ${want} — `
			+ `head.ut skips the default, so the stylesheet's value is what the page shows`);
	if (cleanSince(mark)) ok.push(`slider ${key.padEnd(20)} min ${min}, max ${max}, default ${dfl} agree in the JS, head.ut (pre-paint, _sd_range) and ${prop}`);
}

/* ---- 3b. the dark-mode attributes: the same SET, same values, in both places ----
 *
 * Dark mode is announced three times: `data-darkmode` (what this theme's CSS reads) plus
 * `data-theme` and `data-bs-theme` (the dialects third-party apps sniff for). Both head.ut's
 * pre-paint and stampDark() write them, and one added to one copy and forgotten in the other has a
 * symptom nobody reports — an app's dark styles dead on a fresh load and alive the moment the
 * Appearance tab is touched. Derive the set from the JS. */
const stampBody = (src, re) => (src.match(re) || [, null])[1];
const attrsIn = (body) => new Map([...(body || '').matchAll(
	/setAttribute\('([^']+)',\s*dark\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)].map((m) => [m[1], `${m[2]}/${m[3]}`]));

const darkMark = errorMark();
const jsStamp = attrsIn(stampBody(JS, /function stampDark\([^)]*\)\s*\{([\s\S]*?)\n\}/));
const headStamp = attrsIn(stampBody(HEAD, /function set\(dark\)\s*\{([\s\S]*?)\n\t\t\t\t\}/));

if (!jsStamp.size) errors.push('no stampDark() found in the theme JS — did the dark-mode applier get renamed?');
else if (!headStamp.size) errors.push('head.ut no longer stamps the dark-mode attributes in its pre-paint set(dark)');
else {
	for (const [attr, val] of jsStamp)
		if (!headStamp.has(attr))
			errors.push(`dark mode: stampDark() sets ${attr}, head.ut does not — an app sniffing it sees the `
				+ `wrong mode until the user touches the Appearance tab`);
		else if (headStamp.get(attr) !== val)
			errors.push(`dark mode: ${attr} is '${val}' in the JS but '${headStamp.get(attr)}' in head.ut`);
	for (const attr of headStamp.keys())
		if (!jsStamp.has(attr))
			errors.push(`dark mode: head.ut pre-paints ${attr}, but stampDark() never updates it — toggling the `
				+ `mode live would leave it stating the mode the page loaded in`);
	if (cleanSince(darkMark))
		ok.push(`dark mode  -> ${[...jsStamp.keys()].join(', ')}   (pre-paint and live applier stamp the same set)`);
}

/* The two compat names are OUTBOUND, like the --*-color-* export tier: apps read them, this
 * theme must not. A styles/ rule keyed off data-theme is hijackable by any app that stamps it
 * (OpenClash writes data-darkmode on :root from its own luminance sniff). */
for (const attr of ['data-theme', 'data-bs-theme'])
	if (STYLES.includes(`[${attr}`))
		errors.push(`styles/ keys a rule off [${attr}] — that name is OUTBOUND compatibility for third-party `
			+ `apps, not a theme input. The theme's own dark rules read [data-darkmode].`);

/* ---- report --------------------------------------------------------------------------- */
for (const line of ok) console.log('  ok   ' + line);
console.log(`  ok   ${jsKeys.size} localStorage keys`);

if (errors.length) {
	console.error('\nFAIL: the Appearance axes have drifted between their two implementations.');
	for (const e of errors) console.error('  - ' + e);
	console.error('\nhead.ut pre-paints every axis before the first frame and fs-prefs.js');
	console.error('applies it live; the two cannot share code (the template runs before the module');
	console.error('loader exists), so this is what keeps them saying the same thing.');
	process.exit(1);
}

console.log('\naxes: the pre-paint template and the live appliers agree on every axis.');

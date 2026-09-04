/* Static half of the "does the page render" check in tools/smoke.mjs: does every `alias.name(`
 * reference one module makes into another actually exist in what the other exports?
 *
 * The shape it holds against: fs-appearance.js called `axes.currentContentWidth()` while
 * fs-axes.js's `return baseclass.extend({ … })` carried no such key. Nothing ran that branch until
 * a router did, `undefined(v)` threw inside the Appearance tab's one try/catch, and the whole
 * "Footstrap" section vanished from System with a single console line — `npm run smoke` never
 * built that page (it only evaluated modules) and `npm run check` stayed green end to end. This
 * catches the same shape in milliseconds, with no browser, by reading source text the way
 * `tools/axes.mjs` already reads the axis factories.
 *
 * Deliberately narrow, and safe to be narrow: a MISS here (an export built dynamically, e.g.
 * `exported[key] = fn`) makes the check see fewer exports than there are, which can only produce a
 * false failure — never a false pass — and every module this is pointed at lists its exports as a
 * literal, comma-separated identifier list. It is a second, cheap line behind the render check in
 * tools/smoke.mjs, not a replacement for it: a name can exist and still be wired to the wrong
 * value, which only rendering the page catches. */

function stripComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/* The identifiers inside the module's own `return baseclass.extend({ … });` — the LAST such call
 * in the file, which is where every one of these modules places it. Comments are stripped first so
 * a word inside one ("the storage wrappers") cannot be mistaken for an export. Both shapes the
 * theme uses are covered: a bare identifier (`currentTint, applyTint`) exports the name itself, and
 * a `key: value` pair (not used today, but cheap to hold) exports the key. */
export function exportedKeys(src) {
	const clean = stripComments(src);
	const m = clean.match(/return\s+baseclass\.extend\(\{([\s\S]*)\}\)\s*;?\s*$/);
	if (!m) return null;
	const body = m[1];
	const keys = new Set();
	for (const km of body.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/g)) keys.add(km[1]);
	return keys;
}

/* Every `alias.name` reference in `src` — a call (`axes.currentContentWidth()`) or a bare
 * reference handed to another function (`bump(axes.applyContentWidth)`), because the second shape
 * fails the same way one call later: `bump()` invokes whatever it was given, undefined included. */
export function referencedNames(src, alias) {
	const clean = stripComments(src);
	const re = new RegExp(`\\b${alias}\\.([A-Za-z_$][A-Za-z0-9_$]*)`, 'g');
	const names = new Set();
	for (const m of clean.matchAll(re)) names.add(m[1]);
	return names;
}

/* The check itself: every name `callerSrc` reaches for on `alias` must be a key `calleeSrc`
 * exports. Returns `null` (not an empty array) when the callee's export shape was not recognised,
 * so a caller can tell "nothing missing" from "could not check" and never turns the second into a
 * silent pass. */
export function missingExports(callerSrc, alias, calleeSrc) {
	const exported = exportedKeys(calleeSrc);
	if (!exported) return null;
	const referenced = referencedNames(callerSrc, alias);
	return [...referenced].filter((n) => !exported.has(n)).sort();
}

/* The scan of the Appearance axes in the theme JS, shared by axes.mjs (the contract between head.ut
 * and fs-axes.js) and fs-orphans.mjs (which must not read a localStorage key as a CSS class). */

/* every localStorage key the theme uses, taken from a source text */
export const keysIn = (src) => {
	const out = new Set();
	/* `lsGet(…)` counts as a read: both files wrap storage in a helper of that name (4 of head.ut's 15 keys otherwise). */
	for (const m of src.matchAll(/(?:lsGet|lsSet|lsDel|localStorage\.(?:getItem|setItem|removeItem))\(\s*'(fs-[a-z0-9-]+)'/g)) out.add(m[1]);
	/* the accordion's remembered set keeps its key in a constant, not at the call site */
	for (const m of src.matchAll(/^const\s+\w*KEY\w*\s*=\s*'(fs-[a-z0-9-]+)'/gm)) out.add(m[1]);
	return out;
};
/* ...plus the axes built by a FACTORY (colorAxis, enumAxis), which pass their key as an argument:
 * they have no lsGet('fs-…') call site, so the scan above misses them. Matched by literal args. */
export const colorAxesIn = (JS) => [...JS.matchAll(/colorAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*(?:,\s*'([^']+)'\s*)?\)/g)]
	.map(([, key, attr, hueProp, colorProp, inkProp]) => ({ key, attr, hueProp, colorProp, inkProp }));
export const enumAxesIn = (JS) => [...JS.matchAll(/enumAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, attr, on, off]) => ({ key, attr, on, off }));
/* listAxis(key, attr, VALUES, 'dflt', …): the third argument names an array, read from THAT
 * declaration; the key is inside the factory, so the call is what is matched. */
export const listAxesIn = (JS) => [...JS.matchAll(/listAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*([A-Z_]+)\s*,\s*'([^']+)'/g)]
	.map(([, key, attr, listName, dflt]) => {
		const decl = JS.match(new RegExp(`const ${listName} = \\[([^\\]]*)\\]`));
		const values = decl ? [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
		return { key, attr, listName, dflt, values };
	});
/* propAxis(key, sdKey, prop, min, max, dfl, fmt, …): an inline-property slider; the key sits in the
 * factory body. dfl is a number or the name of a `const FS_*_DEFAULT = n`; fmt is `(v) => (…)` or `(v) => String(…)`. */
export const propAxesIn = (JS) => [...JS.matchAll(/propAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\w+)\s*,\s*(\(v\) => (?:\([^()]*\)|String\([^()]*\)))/g)]
	.map(([, key, sdKey, prop, min, max, dflRaw, fmt]) => {
		const named = JS.match(new RegExp(`const ${dflRaw}\\s*=\\s*(\\d+)`));
		return { key, sdKey, prop, min: +min, max: +max, dfl: named ? +named[1] : +dflRaw, fmt };
	});
/* surfaceAxis(key, sdKey, prop): a surface repaint; tools/axes.mjs section 2e needs its sdKey. */
export const surfaceAxesIn = (JS) => [...JS.matchAll(/surfaceAxis\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
	.map(([, key, sdKey, prop]) => ({ key, sdKey, prop }));

/* every key the JS uses: call sites plus the factories' arguments */
export const storageKeys = (JS) => new Set([...keysIn(JS), ...colorAxesIn(JS).map(a => a.key), ...enumAxesIn(JS).map(a => a.key),
	...listAxesIn(JS).map(a => a.key), ...propAxesIn(JS).map(a => a.key), ...surfaceAxesIn(JS).map(a => a.key)]);

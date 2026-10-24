/* Pre-minify the theme's shipped JS with uglify-js, in place, for the owfeed release build.
 *
 * uglify-js rather than jsmin, which strips comments and whitespace only and mangles nothing; it also
 * beat terser 5.51.2 by 2,687 B (docs/ci.md, "The steps", step 2). Top-level mangling is safe
 * because a LuCI resource file is evaluated inside a function wrapper and everything crossing a module seam goes through
 * undeclared globals (`L`, `E`, `_`, the pragma aliases), which uglify-js never renames. Runs from
 * tools/stage.sh over the STAGED payload, never the checkout. The two minifiers sit on disjoint
 * paths: owfeed never runs luci.mk, and an SDK build never calls this file, so jsmin sees the
 * untouched source (jsmin's one-character-lookback trap is openwrt/luci#8299).
 *
 * THE SEAM NAMES ARE RESERVED, AND THE LIST IS DERIVED. uglify-js never renames a free variable
 * like `L` but will CREATE one: handed the file alone it takes `L` for a name nobody declared and
 * may give it to a mangled variable. So the free variables of the SOURCE are reserved, per file. */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as acorn from 'acorn';
import { minify } from 'uglify-js';

const ACORN = { ecmaVersion: 2022, allowReturnOutsideFunction: true };
const VERSION_DECL = /const FS_VERSION\s*=\s*'[^']*'/;

const roots = process.argv.slice(2);
if (!roots.length) {
	console.error('usage: node tools/minify-js.mjs <dir-or-file.js> ...');
	process.exit(2);
}

const files = [];
const walk = (p) => {
	const st = statSync(p);
	if (st.isDirectory()) readdirSync(p).forEach((f) => walk(join(p, f)));
	else if (p.endsWith('.js')) files.push(p);
};
roots.forEach(walk);

/* Walk every node of an acorn AST. Hand-rolled because acorn-walk is not a dependency and this
 * is the whole of what would be used from it: recurse into anything that looks like a node. */
function walkAst(node, visit) {
	if (!node || typeof node.type !== 'string') return;
	visit(node);
	for (const k of Object.keys(node)) {
		if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
		const v = node[k];
		if (Array.isArray(v)) v.forEach((c) => walkAst(c, visit));
		else walkAst(v, visit);
	}
}

/* Every name the file BINDS, anywhere and at any depth. Deliberately scope-blind: this feeds a
 * subtraction, and over-collecting here can only shrink the reserved set's input, never invent a
 * free name that is not one. (Both callers below want the same conservative answer.) */
function boundNames(ast) {
	const out = new Set();
	const fromPattern = (p) => walkAst(p, (n) => {
		if (n.type === 'Identifier') out.add(n.name);
		/* a property KEY inside a destructuring pattern binds nothing: `{ a: b }` binds b */
		if (n.type === 'Property' && !n.computed && n.key && n.key.type === 'Identifier') out.delete(n.key.name);
	});
	walkAst(ast, (n) => {
		if (n.type === 'VariableDeclarator') fromPattern(n.id);
		else if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' ||
		         n.type === 'ArrowFunctionExpression' || n.type === 'ClassDeclaration' ||
		         n.type === 'ClassExpression') {
			if (n.id) out.add(n.id.name);
			(n.params || []).forEach(fromPattern);
		}
		else if (n.type === 'CatchClause' && n.param) fromPattern(n.param);
	});
	return out;
}

/* Names the file USES but never binds — its seam with the LuCI wrapper and with the browser.
 * These are exactly the names uglify-js must not hand to one of its own variables. */
function freeNames(src) {
	const ast = acorn.parse(src, ACORN);
	const bound = boundNames(ast);
	const used = new Set();
	walkAst(ast, (n) => {
		if (n.type === 'MemberExpression' && !n.computed && n.property) n.property._notARef = true;
		/* `{ E }` is BOTH the key and a reference to E — a shorthand key must stay a reference */
		if (n.type === 'Property' && !n.computed && !n.shorthand && n.key) n.key._notARef = true;
		if (n.type === 'LabeledStatement' && n.label) n.label._notARef = true;
		if (n.type === 'BreakStatement' && n.label) n.label._notARef = true;
		if (n.type === 'ContinueStatement' && n.label) n.label._notARef = true;
		if (n.type === 'Identifier' && !n._notARef) used.add(n.name);
	});
	return new Set([...used].filter((n) => !bound.has(n)));
}

/* The wrapper's parameters, which are bound whether the file mentions them or not — the half a
 * "free variables of the source" answer gets wrong. luci.js evaluates a resource file as
 * `function(window, document, L, <one arg per require pragma>) { … }`, so those names are already
 * declared in the scope uglify-js minifies into: a file that never reads `L` outside a comment is not
 * free of it by any AST measure, and uglify-js handing `L` to a top-level `const` is a redeclaration
 * of the parameter and a SyntaxError before a line of it runs.
 *
 * The alias is derived exactly the way luci.js derives it, so this list cannot drift. */
function wrapperParams(src) {
	/* `E` and `_` are not parameters — luci.js puts them on `window` — so shadowing one is legal and,
	 * for a file that never reads it, harmless. They are reserved anyway: three files came back
	 * declaring `const E=…`, and the difference between "harmless" and "the element factory is gone"
	 * is whether some future line reads E from a place the AST cannot see. 40 bytes across the tree
	 * buys not having to make that judgement per file. */
	const names = new Set([ 'window', 'document', 'L', 'E', '_' ]);
	for (const d of directives(src).split('\n')) {
		const m = /^require[ \t]+(\S+)(?:[ \t]+as[ \t]+([a-zA-Z_]\S*))?$/.exec(d);
		if (m) names.add(m[2] || m[1].replace(/[^a-zA-Z0-9_]/g, '_'));
	}
	return names;
}

/* the leading run of string-literal ExpressionStatements: 'use strict' + the require pragmas */
function directives(src) {
	const body = acorn.parse(src, ACORN).body;
	const out = [];
	for (const n of body) {
		if (n.type !== 'ExpressionStatement' || n.expression.type !== 'Literal' ||
		    typeof n.expression.value !== 'string')
			break;
		out.push(n.expression.value);
	}
	return out.join('\n');
}

let before = 0, after = 0, failed = 0;
for (const f of files) {
	const name = basename(f);
	const src = readFileSync(f, 'utf8');
	const isVersion = (name === 'fs-version.js');
	/* the two halves of "names this scope already has": what the file reads without binding, and
	 * what the LuCI wrapper binds for it whether it reads them or not */
	const free = new Set([ ...freeNames(src), ...wrapperParams(src) ]);
	const res = minify(src, {
		/* a LuCI resource is a function body, not a module; webkit and v8 switch on uglify-js's
		 * workarounds for Safari and Chrome engine bugs, which a router's admin browser can be */
		module: false, webkit: true, v8: true, toplevel: true,
		parse: { bare_returns: true },
		/* directives:false = do NOT remove them — the pragmas ARE directives. keep_fargs keeps
		 * every function's arity. fs-version.js: evaluate would fold the literal into its readers
		 * (the guard below); the bytes it costs are in docs/ci.md, step 2. */
		compress: {
			directives: false, passes: 3, keep_fargs: true,
			...(isVersion ? { evaluate: false } : {})
		},
		mangle: { reserved: [ ...free, ...(isVersion ? [ 'FS_VERSION' ] : []) ] },
		/* quote_style 1 = single quotes, so the version sed's '[^']*' still matches */
		output: isVersion ? { quote_style: 1 } : {}
	});
	if (res.error) throw res.error;
	const min = res.code;
	try {
		acorn.parse(min, ACORN);
		/* a lost require pragma raises nothing at minify time: the module would simply load with no
		 * dependencies, on the router, for good */
		if (directives(min) !== directives(src))
			throw new Error('directive prologue changed — a require pragma was lost');
		/* The one that matters most: a name the source only USES must not come back DECLARED.
		 * `const L = …` in the output shadows the wrapper's parameter and the module dies at
		 * parse time with "Identifier 'L' has already been declared" (v0.11.6). */
		const clash = [ ...boundNames(acorn.parse(min, ACORN)) ].filter((n) => free.has(n));
		if (clash.length)
			throw new Error(`the minifier declared ${clash.join(', ')} — a name this file gets from the LuCI wrapper`);
		if (isVersion && !VERSION_DECL.test(min))
			throw new Error('the FS_VERSION declaration did not survive — the version sed would miss');
		/* …and that the declaration is still REFERENCED. `compress.toplevel` is free to inline a
		 * const that is only read: the declaration would survive for stage.sh's sed to stamp,
		 * every reader would carry the pre-stamp literal, and every release would report
		 * "Footstrap (dev)" with nothing saying otherwise. Four occurrences today — one
		 * declaration and three reads in label() once isReal() is inlined; the check needs one read
		 * to survive. */
		if (isVersion && (min.match(/FS_VERSION/g) || []).length < 2)
			throw new Error('FS_VERSION was inlined — the declaration survives for the sed to stamp, '
				+ 'but nothing reads it any more, so a stamped release would still say "(dev)"');
		/* a floor, not a budget: an empty/truncated write must not ship (build-css.sh's rule) */
		if (!min || min.length < 100 || min.length >= src.length)
			throw new Error(`implausible output size ${min && min.length} (source ${src.length})`);
	} catch (e) {
		console.log(`  FAIL ${name}: ${e.message}`);
		failed++;
		continue;
	}
	writeFileSync(f, min);
	before += src.length; after += min.length;
	console.log(`  ${String(src.length).padStart(7)} -> ${String(min.length).padStart(6)}  ${name}`);
}

console.log(`minify-js: ${before} -> ${after} bytes (${before ? Math.round(100 - after * 100 / before) : 0}% smaller), ${files.length} files`);
if (failed) {
	console.error(`minify-js: ${failed} file(s) failed verification — refusing to ship`);
	process.exit(1);
}

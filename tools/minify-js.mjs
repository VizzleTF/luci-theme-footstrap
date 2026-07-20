/* Pre-minify the theme's shipped JS with terser, IN PLACE, before the SDK build.
 *
 * Why terser and not jsmin: jsmin strips comments and whitespace only — identifiers are wire
 * bytes, and uhttpd serves /www with no compression. Measured on this tree: jsmin ~57 KB,
 * terser (mangle toplevel) ~41 KB — −27%. Top-level mangling is safe BECAUSE a LuCI resource
 * file is evaluated inside a function wrapper: its top level is function scope, and everything
 * that crosses a module seam goes through undeclared globals (`L`, `E`, `_`, the `'require x
 * as y'` pragma aliases), which terser never renames.
 *
 * The CI build job runs this over the checkout and then builds with FOOTSTRAP_PREMIN=1, which
 * makes the theme Makefile set LUCI_MINIFY_JS:=0 — jsmin MUST NOT run over terser output:
 * terser legitimately emits `return/^v/.test(s)` shapes, the exact one-character-lookback trap
 * (openwrt/luci#8299) that eats the rest of the file and exits 0. A build without this step
 * (an SDK user, the buildbot) minifies the untouched source with jsmin as before; wrap-regex
 * and tools/jsmin-verify.mjs keep guarding that path.
 *
 * fs-version.js is special: Build/Prepare and dev-sync.sh stamp the git version by sed-ing the
 * declaration `const FS_VERSION *= *'…'` — so for that one file the name is RESERVED from the
 * mangle, quotes stay single, and the tool FAILS unless the declaration survives verbatim
 * enough for the sed to match. Silently losing it would make every release report "(dev)".
 *
 * Two self-checks per file, because a silent mis-minify here ships broken chrome:
 *  - the output must PARSE (acorn, same options jsmin-verify uses);
 *  - the directive prologue must be IDENTICAL — the `'require x as y'` pragmas are how LuCI
 *    resolves dependencies, and a compress option that dropped them would leave every module
 *    loading with no dependencies and no error at minify time.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as acorn from 'acorn';
import { minify } from 'terser';

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
	const res = await minify(src, {
		parse: { bare_returns: true },
		/* directives:false = do NOT remove them — the pragmas ARE directives */
		compress: { directives: false },
		mangle: { toplevel: true, reserved: isVersion ? [ 'FS_VERSION' ] : [] },
		/* quote_style 1 = single quotes, so the version sed's '[^']*' still matches */
		format: isVersion ? { quote_style: 1 } : {}
	});
	const min = res.code;
	try {
		acorn.parse(min, ACORN);
		if (directives(min) !== directives(src))
			throw new Error('directive prologue changed — a require pragma was lost');
		if (isVersion && !VERSION_DECL.test(min))
			throw new Error('the FS_VERSION declaration did not survive — the version sed would miss');
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

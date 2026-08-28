#!/usr/bin/env node
/* Minify the inline <script> blocks inside the shipped templates.
 *
 * These are the largest bytes in the package that nothing was shrinking. `strip-templates.sh`
 * removes comments and says so — "it does not minify: no joining of lines, no touching of anything
 * that is not a comment from column one" — so the pre-paint went to the wire with full indentation
 * and full identifiers. And it is the most expensive place to pay: it is in the HTML document
 * itself, before a single module is fetched, on every page AND on the login page, which downloads
 * no modules at all. Measured over the shipped templates: 10,625 B of script in, 2,176 B saved.
 *
 * ONLY blocks with no ucode interpolation are touched. `partials/head.ut`'s first block is the
 * `window.__fsSD = {…}` data object, 23 `{{ … }}` substitutions that are ucode expressions and not
 * JavaScript at all — terser would parse `{{ _sd_lay }}` as a block statement and rewrite it into
 * something ucode never emits. A block containing `{{`, `{%` or `{#` is left exactly as it is.
 *
 * Over a BUILD TREE, never the checkout — same rule as minify-js.mjs, and for a sharper reason
 * here: tools/axes.mjs and tools/chrome-fence.mjs both read `head.ut` as TEXT and match it with
 * regexes pinned to its literal shape (`/function set\(dark\)\s*\{([\s\S]*?)\n\t{4}\}/`). Minify
 * the source and those gates stop being able to read the file they exist to hold.
 *
 * CI-only, like the JS minifier: an SDK build has no node and keeps the source, which is the trade
 * already accepted for the shipped modules.
 *
 * Usage: node tools/minify-prepaint.mjs <ucode-dir> */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { minify } from 'terser';

/* not lib/root.mjs's filesIn(): that one resolves against the repo, and this runs over a build tree
 * whose path is given absolutely */
const templates = (dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' })
	.filter((f) => f.endsWith('.ut')).map((f) => join(dir, f));

const dir = process.argv[2];
if (!dir) {
	console.error('usage: minify-prepaint.mjs <ucode-dir>');
	process.exit(2);
}

const UCODE = /\{\{|\{%|\{#/;			/* an interpolation, not JavaScript */
let files = 0, blocks = 0, before = 0, after = 0;

for (const file of templates(dir)) {
	const src = readFileSync(file, 'utf8');
	const out = [];
	let last = 0, touched = false;

	/* The open tag is kept verbatim: it may carry attributes, and one of them may be ucode.
	 *
	 * Case-insensitive, and the closing tag takes attributes too, because HTML's parser does: a
	 * `</SCRIPT>` or a `</script foo>` this missed would not merely leave one block unminified —
	 * `[\s\S]*?` would run on to the NEXT block's `</script>` and the replacement would swallow
	 * every byte of template between the two. Our templates are all lower case today; the cost of
	 * assuming they stay that way is a silently mangled page (CodeQL js/bad-tag-filter). */
	const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script\b[^>]*>)/gi;
	let m;
	while ((m = re.exec(src)) !== null) {
		const [ whole, open, body, close ] = m;
		if (!body.trim() || UCODE.test(body)) continue;
		const min = await minify(body, {
			/* the pre-paint runs before anything else on the page and owns no module scope, so it
			 * is a script, not a module; `toplevel` would rename the IIFEs' own bindings safely but
			 * buys little here and is one more way to differ from what the gates read */
			ecma: 2020,
			compress: { passes: 2 },
			mangle: true,
			format: { comments: false },
		}).catch((e) => { throw new Error(`${file}: ${e.message}`); });
		if (!min.code) continue;
		out.push(src.slice(last, m.index), open, min.code, close);
		last = m.index + whole.length;
		before += body.length;
		after += min.code.length;
		blocks++;
		touched = true;
	}
	if (!touched) continue;
	out.push(src.slice(last));
	writeFileSync(file, out.join(''));
	files++;
}

/* A run that minified nothing is a run that measured nothing — the same failure mode
 * tools/scroll-anchor.mjs was taught to report rather than exit 0 on. */
if (!blocks) {
	console.error('minify-prepaint: no inline <script> block was minified — the templates changed shape '
		+ 'or every block now carries ucode; refusing to report a saving of zero as success');
	process.exit(1);
}

console.log(`minify-prepaint: ${blocks} block(s) in ${files} template(s), ${before} -> ${after} B `
	+ `(${before - after} B off every page load)`);

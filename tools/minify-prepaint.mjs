#!/usr/bin/env node
/* Minify the inline <script> blocks inside the shipped templates: the largest bytes nothing shrank
 * (strip-build.sh only removes comments and indentation), in the HTML document before any module
 * is fetched. Measured in stage order, 6424 -> 4511 B (docs/ci.md).
 *
 * ONLY blocks with no ucode interpolation are touched: a block containing `{{`, `{%` or `{#` (the
 * `window.__fsSD` data object in partials/head.ut) is not JavaScript and is left exactly as it is.
 * Over a BUILD TREE, never the checkout. CI-only, like the JS minifier.
 *
 * Usage: node tools/minify-prepaint.mjs <ucode-dir> */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { minify } from 'uglify-js';

/* walks the given build tree, not the repo */
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
		/* the pre-paint runs before anything else on the page and owns no module scope, so it
		 * is a script, not a module; `toplevel` would rename the IIFEs' own bindings safely but
		 * buys little here and is one more way to differ from the source.
		 * passes 2, not minify-js.mjs's 3: the blocks are short and a third pass saves 2 B of 4767; webkit/v8
		 * are the engine-bug workarounds explained there */
		const min = minify(body, { module: false, webkit: true, v8: true, compress: { passes: 2 }, mangle: true });
		if (min.error) throw new Error(`${file}: ${min.error.message}`);
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

/* A run that minified nothing is a run that measured nothing, and it must not exit 0. */
if (!blocks) {
	console.error('minify-prepaint: no inline <script> block was minified — the templates changed shape '
		+ 'or every block now carries ucode; refusing to report a saving of zero as success');
	process.exit(1);
}

console.log(`minify-prepaint: ${blocks} block(s) in ${files} template(s), ${before} -> ${after} B `
	+ `(${before - after} B off every page load)`);

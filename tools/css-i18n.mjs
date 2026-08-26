#!/usr/bin/env node
/* Gate: no CSS rule may key off a `data-title` VALUE.
 *
 * `data-title` is what LuCI stamps on a data cell so a carded table can print the column label.
 * Reading it is fine; MATCHING it is not, and it fails in two independent ways, both silent:
 *
 *   1. it is TRANSLATED — LuCI fills the attribute from the column HEADING, so a selector carrying
 *      the English literal matches nothing and the rule is dead in ~40 languages while looking
 *      alive on the dev box (issue #7);
 *   2. it is RENDER-DEPENDENT — for the tables LuCI builds from the heading's `innerText`, the
 *      value is what the heading renders, which the theme's own CSS uppercases. */
import { filesIn, read } from './lib/root.mjs';
const STYLES = 'luci-theme-footstrap/styles';

/* any data-title comparison carrying a NON-EMPTY value: =, ^=, $=, *=, ~=, |= */
const BAD = /\[\s*data-title\s*[~^$*|]?=\s*(?:"([^"]+)"|'([^']+)'|([^\]\s"']+))/g;

const files = filesIn(STYLES, '.css');
const hits = [];

for (const f of files) {
	const rel = f.replace(/\\/g, '/');
	const src = read(f);
	/* strip comments: this file's own rationale quotes the very selectors it bans */
	const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
	code.split('\n').forEach((line, i) => {
		for (const m of line.matchAll(BAD))
			hits.push({ file: rel, line: i + 1, value: m[1] ?? m[2] ?? m[3] });
	});
}

if (hits.length) {
	console.error('FAIL: a CSS rule keys off a data-title VALUE — a translated, render-dependent string.\n');
	for (const h of hits)
		console.error(`  ${h.file}:${h.line}  [data-title="${h.value}"]`);
	console.error('\nOn a localised router that value is the TRANSLATION, so the rule matches nothing and');
	console.error('dies silently (issue #7). Anchor on the column instead — `.td:nth-child(N)` — which no');
	console.error('translation can reorder. `[data-title]` on its own (presence) is fine.');
	process.exit(1);
}

console.log(`css-i18n: ${files.length} files, no rule keys off a translated data-title value.`);

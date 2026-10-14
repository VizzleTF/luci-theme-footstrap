#!/usr/bin/env node
/* Comment share of every shipped JS file: under 40 % of the bytes, docs/conventions.md "Size". The
 * shipped JS is read by a model that has the file open and no history, and a file that is mostly
 * comment buries the invariant it is there to carry. Comments never reach a router (uglify-js and jsmin
 * strip them), so the limit costs no bytes; it keeps each comment to the invariant, the number
 * behind it and one pointer.
 *
 *   node tools/comment-share.mjs [dir]     # default: the theme's htdocs/luci-static/resources
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RESOURCES } from './lib/root.mjs';
import { commentBytes } from './lib/comment-share.mjs';

const LIMIT = 0.40;
const dir = process.argv[2] ?? RESOURCES;
const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).sort();
/* a gate that measured nothing proves nothing: an empty dir is a wrong path, not a pass */
if (!files.length) { console.error(`comment-share: no .js file under ${dir}; it is nothing measured.`); process.exit(1); }

const over = [];
for (const f of files) {
	const { comment, total } = commentBytes(readFileSync(join(dir, f), 'utf8'));
	const share = comment / total;
	console.log(`${(100 * share).toFixed(1).padStart(5)} %  ${String(comment).padStart(6)} of ${String(total).padStart(6)} B  ${f}`);
	if (share >= LIMIT) over.push(`${f} ${(100 * share).toFixed(1)} %`);
}
if (over.length) {
	console.error(`\ncomment-share: ${over.length} of ${files.length} file(s) at or over ${LIMIT * 100} % comment bytes:\n  ${over.join('\n  ')}`);
	console.error('\nCut to the invariant, its number and one pointer; the explanation is a docs/<area>.md section (docs/conventions.md, "Comments").');
	process.exit(1);
}
console.log(`\ncomment-share: ${files.length} file(s), each under ${LIMIT * 100} % comment bytes.`);

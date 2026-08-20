#!/usr/bin/env node
/* WHAT THIS TREE AND THE LuCI TREE DISAGREE ABOUT, and which of those disagreements are supposed
 * to exist.
 *
 * The theme now lives in two places: here, where it is developed and released, and in
 * openwrt/luci as `themes/luci-theme-footstrap`, where it ships with the distribution. Three
 * kinds of difference are possible between them and only one of them is a problem:
 *
 *   EXPECTED   the copy over there gets the BUILT `cascade.css` and no `styles/`, no build or
 *              release scripts, no README — `tools/sync-luci-fork.sh` says why. Reported as a
 *              count and nothing more.
 *   HAND-HELD  the Makefile is maintained by hand on the far side (`include ../../luci.mk`,
 *              PKG_MAINTAINER), and `po/` belongs to Weblate there. A change to either on this
 *              side does NOT travel: this is the report that says so out loud, because it is the
 *              one that has already been missed once — a postrm cleaned up here and not there.
 *   DRIFT      anything else. A shipped file that differs is either a change that has not been
 *              proposed upstream yet, or one that landed there and was never brought back.
 *
 * It is a REPORT, not a verdict: an in-flight PR is a legitimate drift, and so is an upstream
 * commit this repository has not merged yet. It exits non-zero only when it cannot look
 * (a checkout that is not there is a skip, not a failure), so `npm run check` can call it
 * anywhere and it stays quiet on a machine with no luci checkout.
 *
 *   node tools/fork-drift.mjs [path-to-luci-checkout]      (default: ../luci-fork)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/root.mjs';

const DEST = process.argv[2] || join(ROOT, '..', 'luci-fork');
const SRC = join(ROOT, 'luci-theme-footstrap');
const OUT = join(DEST, 'themes/luci-theme-footstrap');

if (!existsSync(join(DEST, 'luci.mk')) || !existsSync(OUT)) {
	console.log(`fork-drift: no luci checkout at ${DEST} (or the theme is not in it) — nothing compared.`);
	process.exit(0);
}

/* the sync's own exclude list, restated as the shape of an EXPECTED difference */
const NOT_SENT = [ 'styles', 'build-css.sh', 'mangle-tokens.sh', 'strip-templates.sh',
	'strip-shell.sh', 'build-apk.sh', 'dev-sync.sh', 'update-po.sh', 'luci-upstream.pin',
	'README.md', '.DS_Store' ];
const HAND_HELD = [ 'Makefile', 'po' ];
/* generated on this side, committed on that one */
const GENERATED = [ 'htdocs/luci-static/footstrap/cascade.css' ];

function walk(dir, base = dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p, base));
		else out.push(relative(base, p));
	}
	return out;
}
const owner = (rel) => {
	const top = rel.split('/')[0];
	if (HAND_HELD.includes(top)) return 'hand';
	if (NOT_SENT.includes(top)) return 'not-sent';
	if (GENERATED.includes(rel)) return 'generated';
	return 'shipped';
};

const here = new Set(walk(SRC).filter((f) => owner(f) !== 'not-sent'));
const there = new Set(walk(OUT));
const drift = [], hand = [];

for (const rel of new Set([ ...here, ...there ])) {
	const kind = owner(rel);
	if (kind === 'not-sent') continue;
	const a = join(SRC, rel), b = join(OUT, rel);
	const inA = existsSync(a), inB = existsSync(b);
	let how = null;
	if (!inB) how = 'only here';
	else if (!inA) how = 'only in luci';
	else if (!readFileSync(a).equals(readFileSync(b))) how = 'differs';
	if (!how) continue;
	/* the generated sheet differs by construction unless a sync just ran */
	if (kind === 'generated') { hand.push(`  ${rel}: ${how} (built here, committed there — run the sync)`); continue; }
	(kind === 'hand' ? hand : drift).push(`  ${rel}: ${how}`);
}

/* what the far side's git says about its own copy, which is the other half of "are we in step" */
let head = '';
try {
	head = execFileSync('git', [ '-C', DEST, 'log', '-1', '--format=%h %s', '--', 'themes/luci-theme-footstrap' ],
		{ encoding: 'utf8' }).trim();
} catch (e) { /* not a git checkout, or no history for the path */ }

console.log(`fork-drift: ${DEST}`);
if (head) console.log(`  their last commit touching the theme: ${head}`);
if (hand.length) {
	console.log('\n  maintained separately — a change here does NOT travel:');
	for (const line of hand) console.log(line);
}
if (drift.length) {
	console.log('\n  DRIFT — shipped files that are not the same on both sides:');
	for (const line of drift) console.log(line);
	console.log('\n  Either the change is still an unproposed PR, or the trees have fallen out of step.');
} else {
	console.log('\n  every shipped file is byte-identical on both sides.');
}

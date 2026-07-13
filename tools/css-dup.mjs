#!/usr/bin/env node
/* Structural duplicate detector: the SAME declaration body written under DIFFERENT guards.
 *
 * WHY THIS EXISTS, AND WHY NO LINTER DOES IT
 * -----------------------------------------
 * stylelint's `no-duplicate-selectors` catches the same selector twice in a file, and
 * `declaration-block-no-duplicate-properties` catches a property twice in a block. Neither
 * can see THIS: two rules with different selectors, under mutually-exclusive guards
 * (a media query vs an attribute selector, or two @container queries), carrying an
 * IDENTICAL set of declarations.
 *
 * To a cascade-aware tool those two rules are not redundant — they are both required,
 * because only one of them ever matches. So no linter will ever call it an error. It is
 * only findable as a STRUCTURAL duplicate, and it is exactly the shape that drifts: the
 * two copies are correct today and silently disagree six months from now (this theme had
 * the same bar written under `@media(max-width:767px)` and under `:root[data-layout=top]`
 * — 55 of ~75 declarations identical).
 *
 * So this tool does not fail the build on a find. It REPORTS, and it holds a budget: the
 * duplication a CSS-language limit forces on you is legitimate, but it must be visible and
 * it must not grow. Raise BUDGET deliberately, with a comment saying why.
 *
 * Usage: node tools/css-dup.mjs [--min N] [--json]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as csstree from 'css-tree';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIN_DECLS = Number(process.argv[includesIdx('--min') + 1]) || 3;
function includesIdx(f) { return process.argv.indexOf(f); }

/* build the real stylesheet the router serves */
const tmp = join(mkdtempSync(join(tmpdir(), 'cssdup-')), 'cascade.css');
execFileSync(join(ROOT, 'luci-theme-footstrap', 'build-css.sh'), [tmp, '--dev'], { stdio: 'ignore' });
const css = readFileSync(tmp, 'utf8');

const ast = csstree.parse(css, { positions: true });

/* The "guard" of a rule = the chain of at-rules it sits inside (media/container/supports)
 * plus its cascade layer. Two rules under the same guard with the same body are a plain
 * duplicate (stylelint's job); two under DIFFERENT guards are what we are hunting. */
const rules = [];
const stack = [];
csstree.walk(ast, {
	enter(node) {
		if (node.type === 'Atrule' && node.prelude && ['media', 'container', 'supports', 'layer'].includes(node.name))
			stack.push(`@${node.name} ${csstree.generate(node.prelude)}`);
		if (node.type !== 'Rule' || node.block?.type !== 'Block') return;

		const decls = [];
		for (const d of node.block.children) {
			if (d.type !== 'Declaration') continue;
			decls.push(`${d.property}:${csstree.generate(d.value).replace(/\s+/g, ' ').trim()}${d.important ? '!' : ''}`);
		}
		if (decls.length < MIN_DECLS) return;

		rules.push({
			guard: stack.filter(g => !g.startsWith('@layer')).join(' & ') || '(none)',
			selector: csstree.generate(node.prelude).replace(/\s+/g, ' ').trim(),
			line: node.loc?.start.line ?? 0,
			key: decls.slice().sort().join('; '),
			n: decls.length,
		});
	},
	leave(node) {
		if (node.type === 'Atrule' && node.prelude && ['media', 'container', 'supports', 'layer'].includes(node.name))
			stack.pop();
	},
});

/* group by identical declaration body, keep only groups spanning >1 DISTINCT guard */
const byBody = new Map();
for (const r of rules) {
	if (!byBody.has(r.key)) byBody.set(r.key, []);
	byBody.get(r.key).push(r);
}

const findings = [];
for (const [key, group] of byBody) {
	if (group.length < 2) continue;
	const guards = new Set(group.map(r => r.guard));
	if (guards.size < 2) continue;			/* same guard = plain dup, stylelint owns it */
	findings.push({ key, n: group[0].n, group });
}
findings.sort((a, b) => b.n * b.group.length - a.n * a.group.length);

const wasted = findings.reduce((s, f) => s + f.n * (f.group.length - 1), 0);

const BUDGET = 2;	/* the config table's card, duplicated between theme/30-tables.css
					 * (.fs-stacked, the data table's) and theme/65-dropdown.css (its
					 * @container 960). It cannot be folded: a class and a container query
					 * are different guards, and CSS cannot share a declaration block across
					 * them. It cannot be measured away either — see fs-select.js: a config
					 * row is full of widgets that bake in a width from the layout they were
					 * rendered in, so un-collapsing one to measure it changes the thing being
					 * measured. Lower this when a copy dies. Raising it is a decision, and
					 * wants a comment saying why the copy could not be folded. */

if (process.argv.includes('--json')) {
	console.log(JSON.stringify({ findings, wasted, budget: BUDGET }, null, 2));
} else {
	for (const f of findings) {
		console.log(`\n--- ${f.n} decls x ${f.group.length} occurrences`);
		for (const r of f.group)
			console.log(`    L${String(r.line).padEnd(6)} guard=${r.guard.padEnd(42)} ${r.selector}`);
		console.log(`    decls: ${f.key}`);
	}
	console.log(`\n${findings.length} duplicated declaration bodies across differing guards `
		+ `(>= ${MIN_DECLS} decls); ~${wasted} redundant declarations.  budget: ${BUDGET}`);
}

if (findings.length > BUDGET) {
	console.error(`\nFAIL: ${findings.length} duplicated declaration bodies > budget ${BUDGET}.`);
	console.error('Fold them into one rule. If the guards genuinely cannot be merged in CSS');
	console.error('(a media query vs an attribute selector, a class vs a container query, two');
	console.error('@container thresholds), raise BUDGET in tools/css-dup.mjs and say why there.');
	process.exit(1);
}

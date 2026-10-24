#!/usr/bin/env node
/* Does tools/anchor-check.mjs fail when the theme's anchoring is broken? Each mutant below is one
 * known-bad edit to fs-fit.js. It is put on a running owlab router as a dev build (unminified, so the
 * edit is a plain string replace), anchor-check runs against it, and a mutant it passes is a hole in
 * the check. The normal build goes back on the router at the end, whatever happened.
 *
 *   node tools/anchor-mutants.mjs --router owrt2512 [--only name,name] [anchor-check flags…]
 *
 * Flags it does not know (--engines, --widths) go to anchor-check. Exit 0 when every mutant was
 * killed, 1 when one survived, 2 when a mutant no longer applies (fs-fit.js changed: fix its text). */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/root.mjs';
import { stands } from './lib/stands.mjs';

const MUTANTS = [
	{ name: 'sync-scroll', why: 'the scroll listener reads the offset inside the event (the WebKit anchoring killer)',
		from: 'const noteScroll = frame(noteMotion);', to: 'const noteScroll = noteMotion;' },
	{ name: 'late-frame', why: 'the correction is written one frame after the growth',
		from: '\t_anchorPending = ref;\n\trequestAnimationFrame(() => {\n', to: '\t_anchorPending = ref;\n\trequestAnimationFrame(() => requestAnimationFrame(() => {\n',
		and: { from: '\t\trememberRest(wrote);\n\t});', to: '\t\trememberRest(wrote);\n\t}));' } },
	{ name: 'no-correction', why: 'the correction never runs',
		from: '\tif (!ref) return;\n\tif (!anchorEnabled()) return;', to: '\treturn;' },
	{ name: 'no-floor', why: 'containers are not floored while a tick refills them',
		from: '\tif (scrolling() || !fittersEnabled()) return;\n\tconst host', to: '\treturn;\n\tconst host' },
	{ name: 'no-deferred-floor', why: 'a floor met mid-scroll is never settled afterwards',
		from: '_deferredFloors.add(b);', to: 'void b;' },
];

const args = process.argv.slice(2);
const take = (flag) => { const i = args.indexOf(flag); return i < 0 ? null : args.splice(i, 2)[1]; };
const router = take('--router'), only = take('--only');
if (!router) { console.error('usage: node tools/anchor-mutants.mjs --router <id> [--only list] [anchor-check flags]'); process.exit(2); }
stands(router);
const status = JSON.parse(execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8' }));
const CONTAINER = `owlab-${status.project}-${router}`;
const FIT = join(ROOT, 'dist/root/www/luci-static/resources/fs-fit.js');

const stage = (...flag) => execFileSync(join(ROOT, 'tools/stage.sh'), flag,
	{ cwd: ROOT, env: { ...process.env, FOOTSTRAP_VERSION: '9999.0.0' }, stdio: [ 'ignore', 'ignore', 'inherit' ] });
const deploy = () => execFileSync('sh', [ '-c', `tar -C dist/root -cf - www usr/share/ucode | docker exec -i ${CONTAINER} tar -C / -xf -` ], { cwd: ROOT });
const swap = (text, from, to, name) => {
	if (text.split(from).length !== 2) { console.error(`${name}: its text is not in fs-fit.js exactly once — the mutant no longer applies`); process.exit(2); }
	return text.replace(from, () => to);
};

const picked = only ? MUTANTS.filter((m) => only.split(',').includes(m.name)) : MUTANTS;
const results = [];
try {
	stage('--dev');
	const clean = readFileSync(FIT, 'utf8');
	for (const m of picked) {
		let text = swap(clean, m.from, m.to, m.name);
		if (m.and) text = swap(text, m.and.from, m.and.to, m.name);
		writeFileSync(FIT, text);
		execFileSync(process.execPath, [ '--check', FIT ]);
		deploy();
		const t0 = Date.now();
		const run = spawnSync(process.execPath, [ join(ROOT, 'tools/anchor-check.mjs'), '--router', router, ...args ], { encoding: 'utf8' });
		const fails = (run.stdout || '').split('\n').filter((l) => l.startsWith('FAIL '));
		results.push({ ...m, status: run.status, fails });
		console.log(`${run.status === 1 ? 'killed  ' : 'SURVIVED'} ${m.name} (${m.why}) in ${Math.round((Date.now() - t0) / 1000)} s`);
		for (const f of fails) console.log(`  ${f}`);
		if (run.status !== 0 && run.status !== 1) console.log((run.stdout || '') + (run.stderr || ''));
	}
	writeFileSync(FIT, clean);
} finally {
	stage();
	deploy();
	console.log(`the normal build is back on ${router}`);
}
const survived = results.filter((r) => r.status !== 1);
console.log(`anchor-mutants ${router}: ${results.length - survived.length} of ${results.length} killed`);
process.exit(survived.length ? 1 : 0);

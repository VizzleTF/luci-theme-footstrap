#!/usr/bin/env node
/* Steering files may not name what is not there. CLAUDE.md, .claude/**.md and docs/crew.md are
 * instructions a model follows literally; a deleted tool or renamed path in them sends the next
 * session into a dead end that reads as its own mistake. Checks, per `file:line`:
 *   - `npm run <x>`            x is a script in package.json
 *   - `tools/<x>`              exists under the repo root
 *   - a backticked repo path   exists (root-relative, or relative to the file, the package dir or .claude/);
 *                              a bare `name.ext` must be the basename of some tracked file
 * Skipped: ../ and ~ and absolute paths, a bare `.ext`, <placeholders>, globs and {a,b} braces, URLs, $vars.
 * "Exists" is the same on every checkout: tracked by git (a directory: any tracked file under it) or
 * ignored as generated output (`dist/`); an untracked file on this disk is not, a clean CI checkout lacks it.
 * Outside a git checkout the disk decides.
 *
 *   node tools/agent-refs.mjs [--root <dir>] */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('agent-refs', { root: { type: 'string', default: '.' } });
const ROOT = resolve(FLAGS.root);
const EXT = /\.(md|mjs|js|sh|json|ut|css|yml|yaml|html|py|svg|pin|po|pot)$/;
/* generated or per-machine, so absent from a clean checkout by design */
const GENERATED = new Set([ 'cascade.css', 'settings.local.json', 'release-notes.md', 'devkit.html' ]);
/* named on purpose without being in this repo: the parent directory, a file of the task dir
 * (../tmp/task-<id>/), the openwrt/luci clone, a URL segment, owfeed-packages' workflow */
const FOREIGN = new Set([ 'luci-fork/', 'tmp/', 'handoff.md', 'card.json', 'compare/', '.github/formalities.json', 'update.yml' ]);

const scripts = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts);
let list = [], inGit = true;
try {
	list = execFileSync('git', [ '-C', ROOT, 'ls-files', '-z' ], { encoding: 'utf8' }).split('\0').filter(Boolean);
} catch { inGit = false; }
const names = new Set(list.map((p) => basename(p)));
const known = new Set(list);
for (const p of list) for (let d = dirname(p); d !== '.' && !known.has(d); d = dirname(d)) known.add(d);
const here = (rel) => inGit ? known.has(rel.replace(/\/$/, '')) : existsSync(join(ROOT, rel));

function mdFiles(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'worktrees' || e.name === 'preview-venv' || e.name === 'node_modules') continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) mdFiles(p, out);
		else if (e.name.endsWith('.md')) out.push(p);
	}
	return out;
}
const files = [ join(ROOT, 'CLAUDE.md'), join(ROOT, 'docs/crew.md'), ...mdFiles(join(ROOT, '.claude')) ].filter(existsSync);

const PKG = 'luci-theme-footstrap';
const rels = (p, from) => [ '.', relative(ROOT, dirname(from)), PKG, '.claude', `${PKG}/styles`,
	`${PKG}/ucode/template/themes/footstrap`, '.github/workflows' ]
	.map((b) => join(b, p)).filter((r) => !r.startsWith('..'));

/* each reference carries the candidate paths (`rel`) it may resolve to; it is a miss unless one is present */
const pending = [];
for (const f of files) {
	const shown = f.slice(ROOT.length + 1);
	readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
		const miss = (what, why, rel = []) => pending.push({ at: `${shown}:${i + 1}`, what, why, rel });
		for (const m of line.matchAll(/npm run ([\w:-]+)/g))
			if (!scripts.includes(m[1])) miss(`npm run ${m[1]}`, 'no such script in package.json');
		for (const m of line.matchAll(/(?<![\w./~-])tools\/([\w.-]+(?:\/[\w.-]+)*)/g)) {
			const t = 'tools/' + m[1].replace(/[.]+$/, '');
			miss(t, 'not in the repository', [ t ]);
		}
		for (const m of line.matchAll(/`([^`\s]+)`/g)) {
			let p = m[1].replace(/#.*$/, '').replace(/:\d+(-\d+)?$/, '');
			if (FOREIGN.has(p) || /^(\.\.|~|\/|\.\w+$|https?:|\$)|[<>*{}$=|()]/.test(p) || p.startsWith('tools/')) continue;
			if (p.includes('/') ? !(EXT.test(p) || p.endsWith('/') || /^[\w.-]+\//.test(p) && here(p.split('/')[0])) : !EXT.test(p)) continue;
			if (GENERATED.has(basename(p))) continue;
			if (p.includes('/') || (names.size && !names.has(p))) miss(p, 'no such path', rels(p, f));
		}
	});
}
const open = pending.filter((c) => !c.rel.some(here));
const ignored = new Set();
if (inGit && open.length) {
	const r = spawnSync('git', [ '-C', ROOT, 'check-ignore', '--no-index', '--stdin', '-z' ], { input: [ ...new Set(open.flatMap((c) => c.rel)) ].join('\0'), encoding: 'utf8' });
	if (r.status > 1) throw new Error(`git check-ignore: ${r.stderr}`);
	for (const p of r.stdout.split('\0')) ignored.add(p);
}
const hits = open.filter((c) => !c.rel.some((r) => ignored.has(r))).map((c) => `${c.at}: ${c.what} — ${c.why}`);
if (hits.length) {
	console.error(hits.join('\n'));
	console.error(`\nagent-refs: ${hits.length} reference(s) to something that is not in the repository; fix the steering file or restore the target.`);
	process.exit(1);
}
console.log(`agent-refs: ${files.length} steering file(s), every named path, script and tool exists.`);

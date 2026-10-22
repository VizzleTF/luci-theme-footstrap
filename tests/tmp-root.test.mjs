/* The shared ../tmp is the MAIN checkout's, from the main tree and from a linked worktree under it or
 * outside it (.claude/worktrees/*, ../tmp/wt-*, the pre-push one under mktemp -d); a copy with no git
 * keeps its own parent. Each tool that resolves it is run from a worktree and must land in that one:
 * from a worktree they used to compute .claude/worktrees/tmp or ../tmp/tmp, and a stand lock taken
 * there was not the main tree's. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';
import { tmpRoot } from '../tools/lib/tmp-root.mjs';
import { CLEAN } from './lib/git-env.mjs';

const git = (cwd, ...a) => {
	const r = spawnSync('git', [ '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a ], { cwd, env: CLEAN, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
};
const FILES = [ 'tools/bg.sh', 'tools/bg-wait.sh', 'tools/ci-local.sh', 'tools/install-check.sh', 'tools/pr-watch.sh', 'tools/lib/tmp-root.sh', 'tools/lib/tmp-root.mjs', 'tools/lib/root.mjs',
	'tools/lib/stands.mjs', '.claude/hooks/permission-denied.sh' ];
const put = (dir) => FILES.forEach((f) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(dir, f)); });

/* proj/main is the repo, proj/main/.claude/worktrees/in a worktree under it, elsewhere/out one outside
 * it, other/plain a copy with no git at all. */
const d = realpathSync(mkdtempSync(join(tmpdir(), 'tmp-root-')));
after(() => rmSync(d, { recursive: true, force: true }));
const main = join(d, 'proj/main'), under = join(main, '.claude/worktrees/in'), out = join(d, 'elsewhere/out'), plain = join(d, 'other/plain');
mkdirSync(main, { recursive: true });
git(main, 'init', '-q');
put(main);
git(main, 'add', '.');
git(main, 'commit', '-q', '-m', 'one');
git(main, 'worktree', 'add', '-q', '--detach', under);
git(main, 'worktree', 'add', '-q', '--detach', out);
mkdirSync(plain, { recursive: true });
put(plain);
const SHARED = join(d, 'proj/tmp');

const shTmpRoot = (dir) => {
	const r = spawnSync('sh', [ '-c', '. "$1"; tmp_root "$2"', 'sh', join(ROOT, 'tools/lib/tmp-root.sh'), dir ], { encoding: 'utf8', env: CLEAN });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout.trim();
};

test('both helpers give the main checkout\'s ../tmp from the main tree and from a worktree under and outside it', () => {
	for (const dir of [ main, under, out ]) {
		assert.equal(tmpRoot(dir), SHARED, `node, from ${dir}`);
		assert.equal(shTmpRoot(dir), SHARED, `sh, from ${dir}`);
	}
});

test('a subdirectory of a worktree resolves the same, and a relative root too', () => {
	assert.equal(tmpRoot(join(under, 'tools')), SHARED);
	assert.equal(shTmpRoot(join(under, 'tools')), SHARED);
	const r = spawnSync('sh', [ '-c', '. "$1"; tmp_root .', 'sh', join(ROOT, 'tools/lib/tmp-root.sh') ], { cwd: out, encoding: 'utf8', env: CLEAN });
	assert.equal(r.stdout.trim(), SHARED);
});

test('outside git both helpers give <root>/../tmp', () => {
	assert.equal(tmpRoot(plain), join(d, 'other/tmp'));
	assert.equal(shTmpRoot(plain), join(d, 'other/tmp'));
});

// A 300-character argument made the log name 'File name too long'; the waiter, run from another worktree, finds it.
test('bg.sh from a worktree logs into the shared ../tmp under a run-id of at most 60 characters, and bg-wait.sh finds it from another', () => {
	const r = spawnSync('sh', [ join(under, 'tools/bg.sh'), 'true', 'a'.repeat(300) ], { cwd: under, encoding: 'utf8', env: CLEAN });
	assert.equal(r.status, 0, r.stderr);
	const id = /^run-id: (\S+)$/m.exec(r.stdout)[1];
	assert.ok(id.length < 61, `run-id is ${id.length} characters: ${id}`);
	assert.ok(existsSync(join(SHARED, `${id}.log`)), 'the log is in the shared ../tmp');
	assert.ok(!existsSync(join(main, '.claude/worktrees/tmp')), 'no ../tmp beside the worktree');
	const w = spawnSync('sh', [ join(out, 'tools/bg-wait.sh'), id, '1', '20' ], { cwd: out, encoding: 'utf8', env: CLEAN, timeout: 30000 });
	assert.equal(w.status, 0, w.stdout + w.stderr);
	assert.match(w.stdout, /^exit: 0$/m);
});

test('bg.sh outside git logs into <root>/../tmp', () => {
	const r = spawnSync('sh', [ join(plain, 'tools/bg.sh'), 'true' ], { cwd: plain, encoding: 'utf8', env: CLEAN });
	assert.equal(r.status, 0, r.stderr);
	assert.ok(existsSync(join(d, 'other/tmp', `${/^run-id: (\S+)$/m.exec(r.stdout)[1]}.log`)));
});

test('a stand lock taken from a worktree is the main tree\'s file', () => {
	const mod = JSON.stringify(join(out, 'tools/lib/stands.mjs'));
	const r = spawnSync(process.execPath, [ '--input-type=module', '-e',
		`import { requireStands } from ${mod}; requireStands([ { id: 'tmproot' } ], 'tmp-root test');` ],
	{ cwd: out, encoding: 'utf8', env: CLEAN, timeout: 20000 });
	assert.equal(r.status, 0, r.stderr);
	assert.match(readFileSync(join(SHARED, 'stands-tmproot.lock'), 'utf8'), /^tmp-root test pid \d+/);
	assert.ok(!existsSync(join(d, 'elsewhere/tmp')), 'no lock beside the worktree');
});

test('ci-local.sh from a worktree opens its run dir in the shared ../tmp', () => {
	const r = spawnSync('sh', [ join(out, 'tools/ci-local.sh'), '--list' ], { cwd: out, encoding: 'utf8', env: CLEAN, timeout: 30000 });
	assert.equal(r.status, 0, r.stderr);
	assert.ok(readdirSync(SHARED).some((f) => f.startsWith('ci-local-')), 'the run dir is in the shared ../tmp');
	assert.ok(!existsSync(join(d, 'elsewhere/tmp')), 'no ../tmp beside the worktree');
});

// owlab and docker stubbed as in install-check-lock.test.mjs: every command succeeds, so what is left to read is the lock.
test('install-check.sh from a worktree takes the main tree\'s stand lock', () => {
	const bin = join(d, 'bin');
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, 'owlab'), '#!/bin/sh\n[ "$1" = status ] && echo \'{"project": "t"}\'\nexit 0\n');
	writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 0\n');
	chmodSync(join(bin, 'owlab'), 0o755);
	chmodSync(join(bin, 'docker'), 0o755);
	const r = spawnSync('sh', [ join(out, 'tools/install-check.sh'), 'tmproot-ic' ], { cwd: out, encoding: 'utf8', timeout: 20000,
		env: { ...CLEAN, PATH: `${bin}:${process.env.PATH}` } });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(readFileSync(join(SHARED, 'stands-tmproot-ic.lock'), 'utf8'), /^install-check pid \d+/);
	assert.ok(!existsSync(join(d, 'elsewhere/tmp')), 'no lock beside the worktree');
});

// A gh stand-in that fails ends the run right after the seen-file is created, which is all this reads.
test('pr-watch.sh from a worktree keeps its seen-file in the shared ../tmp', () => {
	const bin = join(d, 'bin-gh');
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
	chmodSync(join(bin, 'gh'), 0o755);
	spawnSync('sh', [ join(out, 'tools/pr-watch.sh'), '1' ], { cwd: out, encoding: 'utf8', timeout: 20000, env: { ...CLEAN, PATH: `${bin}:${process.env.PATH}` } });
	assert.ok(existsSync(join(SHARED, 'pr-watch-openwrt-luci-1.seen')), 'the seen-file is in the shared ../tmp');
	assert.ok(!existsSync(join(d, 'elsewhere/tmp')), 'no ../tmp beside the worktree');
});

// The guard hooks source nothing from outside .claude/hooks (tools/ is no guard path, so a file there that a role can
// edit must not decide where a hook reads or writes): each carries the rule itself. Poisoned helper: it prints, exits 2
// and names a directory that does not exist.
test('the denial log of a worktree session is the main tree\'s, and no tools/lib/tmp-root.sh or missing git moves it', { skip: spawnSync('jq', [ '--version' ]).error ? 'no jq' : false }, () => {
	const hook = join(under, '.claude/hooks/permission-denied.sh');
	const input = JSON.stringify({ session_id: 's', tool_name: 'Bash', reason: 'r', tool_input: { command: 'echo hi' } });
	const denial = (cwd, project, env = CLEAN) => spawnSync('/bin/sh', [ hook ], { cwd, encoding: 'utf8', env: { ...env, CLAUDE_PROJECT_DIR: project }, input });
	const log = join(SHARED, 'denials.log');
	let r = denial(under, under);
	assert.equal(r.status, 0, r.stderr);
	assert.match(readFileSync(log, 'utf8'), /\tBash\tr\techo hi\n$/);
	writeFileSync(join(under, 'tools/lib/tmp-root.sh'), 'echo poisoned >&2\ntmp_root() { echo /nonexistent; }\nexit 2\n');
	r = denial(under, under);
	assert.deepEqual([ r.status, r.stdout, r.stderr ], [ 0, '', '' ], 'a poisoned helper is not read');
	assert.equal(readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 2, 'the second denial is in the main ../tmp too');
	// no git: the project dir's own ../tmp, silently
	const bin = join(d, 'bin-nogit');
	mkdirSync(bin, { recursive: true });
	for (const tool of [ 'jq', 'date', 'mkdir' ]) {
		const found = process.env.PATH.split(':').map((p) => join(p, tool)).find((p) => existsSync(p));
		if (!existsSync(join(bin, tool))) symlinkSync(found, join(bin, tool));
	}
	r = denial(under, under, { PATH: bin });
	assert.deepEqual([ r.status, r.stdout, r.stderr ], [ 0, '', '' ], 'a hook without git stays silent');
	assert.match(readFileSync(join(main, '.claude/worktrees/tmp/denials.log'), 'utf8'), /\tBash\tr\techo hi\n$/);
	// outside git the same
	r = spawnSync('sh', [ join(plain, '.claude/hooks/permission-denied.sh') ], { cwd: plain, encoding: 'utf8', env: { ...CLEAN, CLAUDE_PROJECT_DIR: plain }, input });
	assert.deepEqual([ r.status, r.stdout, r.stderr ], [ 0, '', '' ]);
	assert.match(readFileSync(join(d, 'other/tmp/denials.log'), 'utf8'), /\tBash\tr\techo hi\n$/);
});

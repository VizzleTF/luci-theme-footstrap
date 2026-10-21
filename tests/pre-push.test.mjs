import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const ZERO = '0'.repeat(40);
const HOOK = join(ROOT, '.githooks/pre-push');
const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([ k ]) => !k.startsWith('GIT_')));
const git = (cwd, ...a) => spawnSync('git', [ '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a ], { cwd, env: CLEAN, encoding: 'utf8' });

/* A scratch checkout holding one commit, then the two things a working-tree check would trip on: an
 * unstaged edit of a tracked file and an untracked one. A stub npm logs where and on what it ran.
 * `decoy` is the repo git's own GIT_DIR would name, which the hook must not touch. */
function rig(d) {
	const repo = join(d, 'repo'), decoy = join(d, 'decoy'), log = join(d, 'npm.log');
	mkdirSync(repo); mkdirSync(join(repo, 'node_modules'));
	git(repo, 'init', '-q');
	git(d, 'init', '-q', decoy);
	writeFileSync(join(repo, 'a.txt'), 'committed\n');
	copyFileSync(join(ROOT, 'package-lock.json'), join(repo, 'package-lock.json'));
	git(repo, 'add', '.');
	git(repo, 'commit', '-q', '-m', 'one');
	const sha = git(repo, 'rev-parse', 'HEAD').stdout.trim();
	git(repo, 'tag', '-a', '-m', 'v1', 'v1');
	const tag = git(repo, 'rev-parse', 'v1').stdout.trim();
	writeFileSync(join(repo, 'a.txt'), 'edited\n');
	writeFileSync(join(repo, 'junk.txt'), 'untracked\n');
	writeFileSync(join(d, 'npm'), `#!/bin/sh
echo "$PWD|$*|$(cat a.txt)|$([ -e junk.txt ] && echo junk || echo nojunk)|$([ -L node_modules ] && echo link || echo nolink)" >> "${log}"
[ -n "\${NESTED:-}" ] && mkdir "$NESTED" && git -C "$NESTED" init -q --bare
exit "\${NPM_EXIT:-0}"
`);
	chmodSync(join(d, 'npm'), 0o755);
	const run = (input, env = {}) => spawnSync('sh', [ HOOK ], {
		cwd: repo, input, encoding: 'utf8',
		env: { ...process.env, PATH: `${d}:${process.env.PATH}`, GIT_DIR: join(decoy, '.git'), GIT_PREFIX: '', ...env },
	});
	const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split('|')) : []);
	const push = (...shas) => shas.map((s) => `refs/heads/main ${s} refs/heads/main ${ZERO}\n`).join('');
	return { repo, decoy, sha, tag, run, calls, push };
}

const withRig = (fn) => () => {
	const d = mkdtempSync(join(tmpdir(), 'pre-push-'));
	try { fn(d, rig(d)); } finally { rmSync(d, { recursive: true, force: true }); }
};

/* only the checkout is a worktree of the repo, and the hook's temp dir (the check's cwd, one up) is gone */
const clean = (r, cwd) => {
	const wts = git(r.repo, 'worktree', 'list', '--porcelain').stdout.split('\n').filter((l) => l.startsWith('worktree '));
	assert.equal(wts.length, 1, `worktrees left: ${wts}`);
	assert.ok(!existsSync(dirname(cwd)), 'temp dir removed');
};

// The check reads the commit being pushed. The hook also inherits GIT_DIR from git; a nested
// `git -C tmp init` must not re-init that repo.
test('pre-push checks the pushed commit in a detached worktree, once per sha, without the hook GIT_* env', withRig((d, r) => {
	const nested = join(d, 'nested'), cfg = join(r.decoy, '.git', 'config'), before = readFileSync(cfg, 'utf8');
	const res = r.run(r.push(r.sha, r.sha), { NESTED: nested });
	assert.equal(res.status, 0, res.stderr);
	const calls = r.calls();
	assert.equal(calls.length, 1, 'two refs at one sha, one check');
	const [ cwd, args, a, junk, link ] = calls[0];
	assert.equal(args, 'run check');
	assert.equal(basename(cwd), 'wt');
	assert.notEqual(cwd, r.repo);
	assert.deepEqual([ a, junk, link ], [ 'committed', 'nojunk', 'link' ], 'committed content, node_modules linked');
	assert.equal(readFileSync(join(r.repo, 'a.txt'), 'utf8'), 'edited\n', 'the checkout is untouched');
	clean(r, cwd);
	assert.ok(existsSync(join(nested, 'HEAD')), 'nested repo created in its own dir');
	assert.equal(readFileSync(cfg, 'utf8'), before, 'the repo GIT_DIR named is untouched');
}));

test('pre-push: a branch and its annotated tag are one commit, one check', withRig((d, r) => {
	assert.notEqual(r.tag, r.sha, 'the tag is its own object');
	const res = r.run(r.push(r.sha, r.tag));
	assert.equal(res.status, 0, res.stderr);
	assert.equal(r.calls().length, 1);
}));

test('pre-push: a red check fails the hook with its message and still cleans up', withRig((d, r) => {
	const res = r.run(r.push(r.sha), { NPM_EXIT: '1' });
	assert.equal(res.status, 1);
	assert.match(res.stderr, /pre-push: npm run check failed — the failing gate is above/);
	clean(r, r.calls()[0][0]);
}));

test('pre-push: a lockfile that differs from the checkout gets its own npm ci', withRig((d, r) => {
	writeFileSync(join(r.repo, 'package-lock.json'), '{}\n');
	const res = r.run(r.push(r.sha));
	assert.equal(res.status, 0, res.stderr);
	const calls = r.calls();
	assert.deepEqual(calls.map((c) => c[1]), [ 'ci', 'run check' ]);
	assert.equal(calls[1][4], 'nolink', 'no checkout node_modules once npm ci ran');
	clean(r, calls[0][0]);
}));

test('pre-push: a delete-only push exits 0 without npm', withRig((d, r) => {
	const res = r.run(`refs/heads/x ${ZERO} refs/heads/x ${r.sha}\n`);
	assert.equal(res.status, 0, res.stderr);
	assert.deepEqual(r.calls(), []);
}));

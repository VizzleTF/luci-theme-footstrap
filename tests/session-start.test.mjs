import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';
import { CLEAN } from './lib/git-env.mjs';

const HOOK = join(ROOT, '.claude/hooks/session-start.sh');
const git = (cwd, ...a) => spawnSync('git', [ '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a ], { cwd, env: CLEAN, encoding: 'utf8' });
const RED = /^main CI red on [0-9a-f]{7} \(run \d+\)$/m;

/* A scratch clone level with its origin/main and carrying owlab.yaml, so only the CI line can speak.
 * A stub `gh` logs its argv, then plays `mode`: JSON on stdout, exit 1, or a hang past the hook's timeout. */
function rig(d) {
	const origin = join(d, 'origin.git'), repo = join(d, 'repo'), bin = join(d, 'bin'), log = join(d, 'gh.log');
	mkdirSync(bin);
	git(d, 'init', '-q', '--bare', '-b', 'main', origin);
	git(d, 'init', '-q', '-b', 'main', repo);
	writeFileSync(join(repo, 'a.txt'), 'one\n');
	git(repo, 'add', '.');
	git(repo, 'commit', '-q', '-m', 'one');
	git(repo, 'remote', 'add', 'origin', origin);
	git(repo, 'push', '-q', 'origin', 'main');
	writeFileSync(join(repo, 'owlab.yaml'), '');
	writeFileSync(join(bin, 'gh'), `#!/bin/sh
echo "$*" >> "${log}"
case "$GH_MODE" in
	fail) exit 1 ;;
	hang) exec sleep 30 ;;
	*) printf '%s' "$GH_OUT" ;;
esac
`);
	chmodSync(join(bin, 'gh'), 0o755);
	// a PATH holding only what the hook calls, so `gh` can be absent whatever this machine has
	const bare = join(d, 'bare-bin');
	mkdirSync(bare);
	for (const t of [ 'git', 'jq', 'timeout', 'grep', 'sh' ]) {
		const p = spawnSync('sh', [ '-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
		symlinkSync(p, join(bare, t));
	}
	const run = (env = {}, path = bin + ':' + process.env.PATH) => {
		const r = spawnSync('sh', [ HOOK ], { cwd: repo, env: { ...CLEAN, PATH: path, ...env }, encoding: 'utf8' });
		const out = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
		return { status: r.status, out };
	};
	const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
	return { origin, repo, bare, run, calls };
}

const withRig = (fn) => () => {
	const d = mkdtempSync(join(tmpdir(), 'session-start-'));
	try { fn(rig(d)); } finally { rmSync(d, { recursive: true, force: true }); }
};

const runs = (conclusion, status = 'completed') => JSON.stringify([ { conclusion, status, headSha: 'abcdef0123456789abcdef0123456789abcdef01', databaseId: 4242 } ]);

test('a failed push run of build.yml on main is one line naming its sha7 and run id', withRig((r) => {
	const { status, out } = r.run({ GH_OUT: runs('failure') });
	assert.equal(status, 0);
	assert.equal(out, 'main CI red on abcdef0 (run 4242)');
	assert.equal(r.calls().length, 1);
	for (const f of [ '--branch main', '--workflow build.yml', '--event push', '--status completed' ]) {
		assert.ok(r.calls()[0].includes(f), `gh got ${f}: ${r.calls()[0]}`);
	}
}));

test('any other latest run of build.yml leaves the hook silent', withRig((r) => {
	for (const out of [ runs('success'), runs('cancelled'), runs('skipped'), runs('', 'in_progress'), '[]', '', 'not json' ]) {
		const res = r.run({ GH_OUT: out });
		assert.equal(res.status, 0, out);
		assert.doesNotMatch(res.out, RED, out);
		assert.equal(res.out, '', out);
	}
}));

test('gh exiting non-zero, gh hanging past its timeout: gh was reached, the hook is silent, exit 0', withRig((r) => {
	const res = r.run({ GH_MODE: 'fail', GH_OUT: runs('failure') });
	assert.equal(res.status, 0);
	assert.equal(res.out, '');
	assert.equal(r.calls().length, 1);
	const t0 = Date.now();
	const hung = r.run({ GH_MODE: 'hang' });
	assert.equal(hung.status, 0);
	assert.equal(hung.out, '');
	assert.equal(r.calls().length, 2);
	assert.ok(Date.now() - t0 < 20000, 'the hook gave up on gh inside its bound');
}));

test('a failed fetch keeps the hook off gh; the red line rides with a drift note; no gh on PATH leaves only the drift note', withRig((r) => {
	git(r.repo, 'remote', 'set-url', 'origin', join(r.repo, 'nowhere.git'));
	const res = r.run({ GH_OUT: runs('failure') });
	assert.equal(res.out, '');
	assert.deepEqual(r.calls(), []);
	git(r.repo, 'remote', 'set-url', 'origin', r.origin);
	git(r.repo, 'switch', '-q', '-c', 'work');
	git(r.repo, 'commit', '-q', '--allow-empty', '-m', 'two');
	const both = r.run({ GH_OUT: runs('failure') });
	assert.match(both.out, /0 behind \/ 1 ahead of origin\/main/);
	assert.match(both.out, RED);
	// the drift note proves the fetch ran on a PATH with no gh, so the silence is gh's absence
	const none = r.run({ GH_OUT: runs('failure') }, r.bare);
	assert.equal(none.status, 0);
	assert.match(none.out, /0 behind \/ 1 ahead of origin\/main/);
	assert.doesNotMatch(none.out, RED);
	assert.equal(r.calls().length, 1);
}));

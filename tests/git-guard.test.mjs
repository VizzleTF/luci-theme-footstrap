import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('../.claude/hooks/git-guard.sh', import.meta.url).pathname;
const PRECOMMIT = new URL('../.claude/hooks/precommit-gate.sh', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'git-guard-'));
writeFileSync(join(dir, 'pipe.sh'), 'set -e\ngit commit -m x\n');
writeFileSync(join(dir, 'outer.sh'), 'sh pipe.sh\n');
writeFileSync(join(dir, 'clean.sh'), 'git status\n');
mkdirSync(join(dir, 'sub'));
writeFileSync(join(dir, 'sub', 'p.sh'), 'git push\n');
// nested scripts: the inner path resolves against the directory the caller ran in
mkdirSync(join(dir, 'n1', 'dd'), { recursive: true });
writeFileSync(join(dir, 'n1', 'outer.sh'), 'sh dd/p.sh\n');
writeFileSync(join(dir, 'n1', 'dd', 'p.sh'), 'git push\n');
mkdirSync(join(dir, 'n2', 'ee'), { recursive: true });
writeFileSync(join(dir, 'n2', 'outer.sh'), 'cd ee && sh p.sh\n');
writeFileSync(join(dir, 'n2', 'ee', 'p.sh'), 'git push\n');

// A PATH holding only the tools the hooks need, minus the ones named: a missing tool is the failure
// being simulated.
function binWithout(...skip) {
	const bin = mkdtempSync(join(tmpdir(), 'git-guard-bin-'));
	for (const tool of [ 'jq', 'awk', 'tr', 'cat', 'head', 'grep', 'dirname', 'git', 'node', 'sort', 'sed', 'sh' ]) {
		if (skip.includes(tool)) continue;
		for (const d of process.env.PATH.split(':')) {
			if (existsSync(join(d, tool))) { symlinkSync(join(d, tool), join(bin, tool)); break; }
		}
	}
	return bin;
}

function run(command, { cwd = dir, hook = HOOK, env, timeout } = {}) {
	const r = spawnSync('/bin/sh', [ hook ], { input: JSON.stringify({ cwd, tool_input: { command } }), encoding: 'utf8', env, timeout });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
}
const decide = (command, o) => run(command, o).permissionDecision || '';

const ask = [
	// a shell behind a wrapper, in any token position
	'env FOO=1 sh -c "git push"',
	'/usr/bin/env bash pipe.sh',
	'timeout 5 bash -c "git commit -m x"',
	'nice -n 5 sh pipe.sh',
	'nohup sh -c "git push" &',
	'xargs sh -c "git push"',
	'sudo sh -c "git push"',
	'doas sh pipe.sh',
	'command sh -c "git push"',
	'exec bash -c "git push"',
	"find . -exec sh -c 'git push' sh {} \\;",
	'find . -execdir sh pipe.sh \\;',
	'git bisect run sh -c "git push"',
	// here-string and redirected input are scanned as nested input
	'bash <<< "git push"',
	'sh <<< "git commit -m x"',
	'cat <<< "git push" | sh',
	'sh < pipe.sh',
	'bash < ./pipe.sh',
	`cd ${dir}/n1 && sh outer.sh`,
	`cd ${dir}/n2 && sh outer.sh`,
	'git pull --reb',
	'git pull --rebase=true',
	'git reset --h HEAD~1',
	'git commit -m x',
	'set -e; X=1; git commit -m x',
	'cd a && git push',
	'true | git push origin main',
	'(git commit -m x)',
	'FOO=1 git push',
	'git -C /r -c user.name=a commit -m x',
	'wsl.exe -e git push',
	"git rebase --exec 'git commit --amend' HEAD~2",
	'git commit --amend --no-edit',
	'git reset --hard HEAD~1',
	'sh pipe.sh',
	'bash ./pipe.sh',
	'sh outer.sh',
	'./pipe.sh',
	'sh -c "git push"',
	// a script path is resolved after a cd in the same line, and an unresolvable cd is unknown
	'cd sub && sh p.sh',
	'cd sub; ./p.sh',
	`cd ${join(dir, 'sub')} && bash p.sh`,
	'(cd sub && true); sh pipe.sh',
	'echo "$(git push)"',
	'eval "git push"',
	'git cherry-pick abc',
	'git am x.patch',
	'git merge topic',
	'git pull --rebase',
	'git pull -r',
	'git commit -m "a; b"',
];
const deny = [
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
	'export GIT_CONFIG_KEY_0=core.hookspath',
	'env GIT_CONFIG_KEY_3=CORE.HOOKSPATH git push',
	`GIT_CONFIG_PARAMETERS="'core.hookspath'='/x'" git push`,
	"export GIT_CONFIG_PARAMETERS='core.hooksPath=/x'",
	'git config core.hooksPath /dev/null',
	'git config --global core.hooksPath /dev/null',
	'git config --local CORE.HOOKSPATH x',
	'git config --worktree core.hookspath x',
	'git config --system core.hooksPath x',
	'git config set core.hooksPath /dev/null',
	'cd a && git config core.hooksPath /dev/null',
	'git commit --no-verify -m x',
	'git commit -n -m x',
	'git commit -m x --no-verify',
	'cd a && git push --no-verify',
	'git commit -nm x',
	// a separator inside a quote is not a separator
	'git commit -m "a; b" -n',
	"git commit -m 'x && y' --no-verify",
	// git accepts any unique long-option prefix
	'git commit --no-verif -m x',
	'git commit --no-ver -m x',
	'git push --no-v',
	'git merge --no-verify topic',
	// a hooks path pointed elsewhere skips them just the same
	'git -c core.hooksPath=/dev/null commit -m x',
	'git -c core.hooksPath=/x push',
	'git -ccore.hookspath=/x push',
];
const none = [
	'env FOO=1 sh clean.sh',
	'timeout 5 sh -c "git status"',
	'bash <<< "git status"',
	'sh < clean.sh',
	'xargs echo sh',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name git status',
	'git config --unset core.hooksPath',
	'git config --global --unset core.hooksPath',
	'git config core.hooksPath',
	'git config --get core.hooksPath',
	'git config user.name x',
	'git pull --recurse-submodules',
	'git pull --refmap=x',
	'git status',
	'git log --grep commit',
	"echo 'git push'",
	'git reset --soft HEAD~1',
	'git diff -n',
	'sh clean.sh',
	'git log --grep "fix -n handling"',
	'echo "a; git push"',
	'git pull',
	'git merge-base a b',
	'git cherry -v',
	'git commit-graph verify',
	'cd sub && git status',
	// uncertainty is not a find: an unresolvable cd leaves the script unknown and the hook silent
	'cd "$X" && sh p.sh',
];

for (const c of ask) test(`ask: ${c}`, () => assert.equal(decide(c), 'ask'));
for (const c of deny) test(`deny: ${c}`, () => assert.equal(decide(c), 'deny'));
for (const c of none) test(`silent: ${c}`, () => assert.equal(decide(c), ''));
// Fan-out: the same script reached 40 ways is scanned once; 60 distinct scripts hit the cap.
test('80-way nested fan-out of one script is deduplicated and fast', () => {
	const f = join(dir, 'fan');
	mkdirSync(f);
	writeFileSync(join(f, 'f.sh'), 'git status\n');
	writeFileSync(join(f, 'g.sh'), 'sh f.sh\n'.repeat(80));
	writeFileSync(join(f, 'h.sh'), 'sh g.sh\n'.repeat(80));
	assert.equal(decide('sh h.sh', { cwd: f, timeout: 8000 }), '');
});
test('more than 50 distinct scripts is silent in hook mode and script-scan-cap in --kinds', () => {
	const c = join(dir, 'cap');
	mkdirSync(c);
	let top = '';
	for (let i = 0; i < 60; i++) { writeFileSync(join(c, `s${i}.sh`), 'true\n'); top += `sh s${i}.sh\n`; }
	writeFileSync(join(c, 'top.sh'), top);
	assert.equal(decide('sh top.sh', { cwd: c, timeout: 20000 }), '');
	const r = spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input: JSON.stringify({ cwd: c, tool_input: { command: 'sh top.sh' } }), encoding: 'utf8', timeout: 20000 });
	assert.match(r.stdout, /script-scan-cap/);
});
test('multi-word message with -n is not no-verify', () => assert.equal(decide("git commit -m 'a -n b'"), 'ask'));
test('commit message containing -n is not no-verify', () => assert.equal(decide('git commit -m "fix -n"'), 'ask'));

// A tripwire acts only on a positive find: an internal failure stays silent in hook mode.
test('no jq: hook is silent', () => {
	const env = { PATH: binWithout('jq') };
	assert.equal(decide('git push', { env }), '');
	assert.equal(decide('ls', { env }), '');
});
test('no awk: hook is silent', () => {
	const env = { PATH: binWithout('awk') };
	assert.equal(decide('git push', { env }), '');
	assert.equal(decide('ls', { env }), '');
});
test('nonexistent cwd: plain line is silent, git line asks', () => {
	const cwd = join(dir, 'gone');
	assert.equal(decide('ls', { cwd }), '');
	assert.equal(decide('git push', { cwd }), 'ask');
});
test('--kinds exits non-zero on an internal failure', () => {
	const r = spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input: '{"tool_input":{"command":"git commit"}}', encoding: 'utf8', env: { PATH: binWithout('awk') } });
	assert.notEqual(r.status, 0);
});
test('precommit-gate asks when the detector fails', () => {
	assert.equal(decide('git commit -m x', { hook: PRECOMMIT, env: { PATH: binWithout('awk') } }), 'ask');
});
test('precommit-gate asks without jq on a commit line, stays silent on a plain one', () => {
	const env = { PATH: binWithout('jq') };
	assert.equal(decide('git commit -m x', { hook: PRECOMMIT, env }), 'ask');
	assert.equal(decide('ls', { hook: PRECOMMIT, env }), '');
});

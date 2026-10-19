import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const HOOK = join(ROOT, '.claude/hooks/git-guard.sh');
const PRECOMMIT = join(ROOT, '.claude/hooks/precommit-gate.sh');
const dir = mkdtempSync(join(tmpdir(), 'git-guard-'));
const bins = [];
after(() => { for (const d of [ dir, ...bins ]) rmSync(d, { recursive: true, force: true }); });
writeFileSync(join(dir, 'pipe.sh'), 'set -e\ngit tag v1\n');
writeFileSync(join(dir, 'outer.sh'), 'sh pipe.sh\n');
writeFileSync(join(dir, 'clean.sh'), 'git status\n');
mkdirSync(join(dir, 'sub'));
writeFileSync(join(dir, 'sub', 'p.sh'), 'git tag v1\n');
// nested scripts: the inner path resolves against the directory the caller ran in
mkdirSync(join(dir, 'n1', 'dd'), { recursive: true });
writeFileSync(join(dir, 'n1', 'outer.sh'), 'sh dd/p.sh\n');
writeFileSync(join(dir, 'n1', 'dd', 'p.sh'), 'git tag v1\n');
mkdirSync(join(dir, 'n2', 'ee'), { recursive: true });
writeFileSync(join(dir, 'n2', 'outer.sh'), 'cd ee && sh p.sh\n');
writeFileSync(join(dir, 'n2', 'ee', 'p.sh'), 'git tag v1\n');

// A PATH holding only the tools the hooks need, minus the ones named: a missing tool is the failure
// being simulated.
function binWithout(...skip) {
	const bin = mkdtempSync(join(tmpdir(), 'git-guard-bin-'));
	bins.push(bin);
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
	'env FOO=1 sh -c "git tag v1"',
	'/usr/bin/env bash pipe.sh',
	'timeout 5 bash -c "git tag v1"',
	'nice -n 5 sh pipe.sh',
	'nohup sh -c "git tag v1" &',
	'xargs sh -c "git tag v1"',
	'sudo sh -c "git tag v1"',
	'doas sh pipe.sh',
	'command sh -c "git tag v1"',
	'exec bash -c "git tag v1"',
	"find . -exec sh -c 'git tag v1' sh {} \\;",
	'find . -execdir sh pipe.sh \\;',
	'git bisect run sh -c "git tag v1"',
	// here-string and redirected input are scanned as nested input
	'bash <<< "git tag v1"',
	'sh <<< "git tag v1"',
	'cat <<< "git tag v1" | sh',
	'sh < pipe.sh',
	'bash < ./pipe.sh',
	`cd ${dir}/n1 && sh outer.sh`,
	`cd ${dir}/n2 && sh outer.sh`,
	'git reset --h HEAD~1',
	'git tag v1',
	'set -e; X=1; git tag v1',
	'cd a && git tag v1',
	'true | git tag v1',
	'(git tag v1)',
	'FOO=1 git tag v1',
	'git -C /r -c user.name=a tag v1',
	'wsl.exe -e git tag v1',
	'git reset --hard HEAD~1',
	'sh pipe.sh',
	'bash ./pipe.sh',
	'sh outer.sh',
	'./pipe.sh',
	'sh -c "git tag v1"',
	// a script path is resolved after a cd in the same line, and an unresolvable cd is unknown
	'cd sub && sh p.sh',
	'cd sub; ./p.sh',
	`cd ${join(dir, 'sub')} && bash p.sh`,
	'(cd sub && true); sh pipe.sh',
	'echo "$(git tag v1)"',
	'eval "git tag v1"',
	'git tag v1 -m "a; b"',
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
// Policy: commit and push are the agent's; a tag, a release, a rewrite of main and a hard reset need the maintainer's word.
const askPolicy = [
	'git tag -a v1 -m x', 'git tag v1', 'git tag -d v1', 'git tag -f v1 HEAD', 'git -C /r tag -s v1',
	'git push origin v0.14.17', 'git push --follow-tags', 'git push --tags', 'git push origin --tags', 'git push --mirror',
	'git push origin refs/tags/v1', 'git push origin :refs/tags/v1', 'git push origin HEAD:refs/tags/x', 'git push origin tag v1',
	'git config push.followTags true', 'git update-ref refs/tags/v1 HEAD', 'git update-ref -d refs/tags/v1',
	'gh release create v1', 'gh release edit v1', 'gh release delete v1', 'gh release upload v1 f.apk',
	'gh api -X POST repos/VizzleTF/luci-theme-footstrap/git/refs -f ref=refs/tags/v1',
	'gh api --method=DELETE repos/VizzleTF/luci-theme-footstrap/git/refs/tags/v1',
	'gh api repos/VizzleTF/luci-theme-footstrap/releases -f tag_name=v1',
	'gh workflow run release.yml', 'gh workflow run build.yml -R VizzleTF/luci-theme-footstrap',
	'gh -R VizzleTF/luci-theme-footstrap release create v1', 'gh --repo VizzleTF/luci-theme-footstrap workflow run u.yml', 'gh -R owfeed/x api -X POST repos/VizzleTF/luci-theme-footstrap/git/refs -f a=1',
	'git push --force origin main', 'git push -f origin master', 'git push origin +main', 'git push --force-with-lease origin main',
	'git push origin --delete main', 	'sh -c "git tag v1"', 'git commit -m x && git tag v1',
];
const nonePolicy = [
	'git commit -m x', 'git commit -am x', 'git push', 'git push origin main', 'git push -u origin claude/x',
	'git push --force origin claude/x', 'git push --force-with-lease origin feat/y', 'git push origin +fix/z',
	'git cherry-pick abc', 'git am x.patch', 'git merge topic', 'git pull --rebase', 'git pull -r', 'git rebase main', 'git commit --amend --no-edit',
	'git tag', 'git tag -l', 'git tag --list "v*"', 'git tag --contains abc', 'git tag -v v1', 'git tag --points-at HEAD',
	'git config push.followTags', 'git update-ref refs/heads/x HEAD',
	'gh release list', 'gh release view v1', 'gh api repos/VizzleTF/luci-theme-footstrap/releases',
	'gh api -X POST repos/owfeed/owfeed-packages/git/refs -f x=1', 'gh api repos/VizzleTF/luci-theme-footstrap/issues -f title=x',
	'gh workflow run update.yml -R owfeed/owfeed-packages', 'gh workflow run update.yml --repo owfeed/owfeed-packages', 'gh run list',
	// a heredoc to git or cat is data, not a command line
	"git commit -F - <<'E'\nfix: drop --no-verify advice\nE",
	"cat >> docs/x.md <<'E'\ngit commit --no-verify\nE",
	"python3 - <<'E'\nprint('git push --no-verify')\nE",
	"tee x <<-E\n\tgit tag v1\n\tE\nls",
];
for (const c of askPolicy) test(`policy ask: ${c}`, () => assert.equal(decide(c), 'ask'));
for (const c of nonePolicy) test(`policy silent: ${c}`, () => assert.equal(decide(c), ''));
test('a heredoc fed to a shell is still scanned', () => {
	assert.equal(decide("sh <<'E'\ngit commit --no-verify\nE"), 'deny');
	assert.equal(decide("bash <<E\ngit tag v1\nE"), 'ask');
	assert.equal(decide("cat <<E\nhi\nE\ngit tag v1"), 'ask');
});

// History rewrite is judged on the repository the hook runs in: HEAD inside origin/main asks, own work is silent.
test('rebase, amend and a bare force push ask only on pushed main work', () => {
	const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
	const r = join(dir, 'repo');
	mkdirSync(r);
	g(r, 'init', '-q', '-b', 'main');
	g(r, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'a');
	g(r, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
	for (const c of [ 'git rebase -i HEAD~1', 'git commit --amend --no-edit', 'git push --force-with-lease', 'git push -f origin HEAD' ]) assert.equal(decide(c, { cwd: r }), 'ask', c);
	g(r, 'checkout', '-q', '-b', 'claude/x');
	g(r, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'b');
	for (const c of [ 'git rebase main', 'git commit --amend --no-edit', 'git push --force-with-lease', 'git push -f origin HEAD' ]) assert.equal(decide(c, { cwd: r }), '', c);
});

// A push is judged on the remote URL of the directory it runs in (cd or git -C): outside the theme repo asks.
test('a push to a remote other than the theme repo asks, to the theme repo is silent', () => {
	const g = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
	const f = join(dir, 'pushrepo');
	mkdirSync(f);
	g(f, 'init', '-q');
	g(f, 'remote', 'add', 'origin', 'git@github.com:VizzleTF/luci-theme-footstrap.git');
	g(f, 'remote', 'add', 'fork', 'git@github.com:VizzleTF/luci.git');
	g(f, 'remote', 'add', 'up', 'https://github.com/openwrt/luci');
	for (const c of [ 'git push fork feat/x', 'git push up x', `git -C ${f} push fork x`, `cd ${f} && git push fork x`, 'git -C pushrepo push up x', 'cd pushrepo && git push fork x', 'git push https://github.com/openwrt/luci x' ]) assert.equal(decide(c, { cwd: c.includes(f) || c.includes('pushrepo') ? dir : f }), 'ask', c);
	for (const c of [ 'git push', 'git push origin main', 'git -C pushrepo push origin x', 'git push nosuch x', 'cd "$X" && git push fork x' ]) assert.equal(decide(c, { cwd: c.includes('pushrepo') ? dir : f }), '', c);
});

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
test('multi-word message with -n is not no-verify', () => assert.equal(decide("git commit -m 'a -n b'"), ''));
test('commit message containing -n is not no-verify', () => assert.equal(decide('git commit -m "fix -n"'), ''));

// A tripwire acts only on a positive find: an internal failure stays silent in hook mode.
test('no jq: hook is silent', () => {
	const env = { PATH: binWithout('jq') };
	assert.equal(decide('git tag v1', { env }), '');
	assert.equal(decide('ls', { env }), '');
});
test('no awk: hook is silent', () => {
	const env = { PATH: binWithout('awk') };
	assert.equal(decide('git tag v1', { env }), '');
	assert.equal(decide('ls', { env }), '');
});
test('nonexistent cwd: plain line is silent, tag line asks', () => {
	const cwd = join(dir, 'gone');
	assert.equal(decide('ls', { cwd }), '');
	assert.equal(decide('git tag v1', { cwd }), 'ask');
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

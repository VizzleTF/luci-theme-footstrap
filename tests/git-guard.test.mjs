import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
	// every probe runs on a healthy PATH unless it simulates a missing tool, and a hook that runs on every Bash call must say nothing on stderr
	if (!env) assert.equal(r.stderr, '', `stderr of ${command}`);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
}
const decide = (command, o) => run(command, o).permissionDecision || '';
// Real git only ever runs in a scratch repository under the tmp dir, never in this checkout.
const g = (cwd, ...a) => {
	assert.ok(!resolve(cwd).startsWith(ROOT), `scratch git must not run in the checkout: ${cwd}`);
	const r = spawnSync('git', [ '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a ], { cwd, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
};
const THEME = 'git@github.com:VizzleTF/luci-theme-footstrap.git';
const FORK = 'https://github.com/openwrt/luci';
function repo(path, remotes = {}) {
	mkdirSync(path, { recursive: true });
	g(path, 'init', '-q', '-b', 'main');
	for (const [ name, url ] of Object.entries(remotes)) g(path, 'remote', 'add', name, url);
	return path;
}

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
	// follow-tags set as config for one call carries every annotated tag just like the flag
	'git -c push.followTags=true push', 'git -c push.followTags push', 'git -cpush.followTags=yes push', 'git -c alias.p=push -c push.followTags=1 p',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.followTags GIT_CONFIG_VALUE_0=true git push',
	`GIT_CONFIG_PARAMETERS="'push.followTags'='true'" git push`,
	'gh release create v1', 'gh release edit v1', 'gh release delete v1', 'gh release upload v1 f.apk',
	'gh api -X POST repos/VizzleTF/luci-theme-footstrap/git/refs -f ref=refs/tags/v1',
	'gh api --method=DELETE repos/VizzleTF/luci-theme-footstrap/git/refs/tags/v1',
	'gh api repos/VizzleTF/luci-theme-footstrap/releases -f tag_name=v1',
	'gh workflow run release.yml', 'gh workflow run build.yml -R VizzleTF/luci-theme-footstrap',
	// cobra takes -R/--repo after the group verb too, so the subcommand is read past it
	'gh release -R VizzleTF/luci-theme-footstrap create v1', 'gh release --repo VizzleTF/luci-theme-footstrap create v1', 'gh release --repo=VizzleTF/luci-theme-footstrap delete v1 -y',
	'gh release -RVizzleTF/luci-theme-footstrap upload v1 a.tgz', 'gh workflow -R VizzleTF/luci-theme-footstrap run build.yml', "bash -c 'gh release -R VizzleTF/luci-theme-footstrap create v1'",
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
	'git -c push.followTags=false push', 'git -c push.followTags=off push', 'git -c push.followTags= push', 'git -c push.default=simple push',
	'gh release list', 'gh release view v1', 'gh api repos/VizzleTF/luci-theme-footstrap/releases',
	'gh api -X POST repos/owfeed/owfeed-packages/git/refs -f x=1', 'gh api repos/VizzleTF/luci-theme-footstrap/issues -f title=x',
	'gh workflow run update.yml -R owfeed/owfeed-packages', 'gh workflow run update.yml --repo owfeed/owfeed-packages', 'gh run list',
	'gh workflow -R owfeed/owfeed-packages run update.yml', 'gh workflow --repo=owfeed/owfeed-packages run update.yml', 'gh release -R VizzleTF/luci-theme-footstrap list',
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
	const r = repo(join(dir, 'repo'));
	g(r, 'commit', '-q', '--allow-empty', '-m', 'a');
	g(r, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
	for (const c of [ 'git rebase -i HEAD~1', 'git commit --amend --no-edit', 'git push --force-with-lease', 'git push -f origin HEAD' ]) assert.equal(decide(c, { cwd: r }), 'ask', c);
	g(r, 'checkout', '-q', '-b', 'claude/x');
	g(r, 'commit', '-q', '--allow-empty', '-m', 'b');
	for (const c of [ 'git rebase main', 'git commit --amend --no-edit', 'git push --force-with-lease', 'git push -f origin HEAD' ]) assert.equal(decide(c, { cwd: r }), '', c);
});

// A push is judged on the remote URL of the directory it runs in (cd or git -C): outside the theme repo asks.
test('a push to a remote other than the theme repo asks, to the theme repo is silent', () => {
	const f = repo(join(dir, 'pushrepo'), { origin: THEME, fork: 'git@github.com:VizzleTF/luci.git', up: FORK });
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
test('no grep: hook is silent, a push to the theme repo is not mistaken for a fork push', () => {
	const env = { PATH: binWithout('grep') };
	const r = repo(join(dir, 'nogrep'), { origin: THEME });
	assert.equal(decide('git tag v1', { env }), '');
	assert.equal(decide('git push origin main', { env, cwd: r }), '');
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

// ---- the forms a line takes to hide the same act: a `--` before the refspec, an alias, an interpreter, a moved ref ----
const hide = {
	ask: [
		// everything after `--` is a refspec, not an option
		'git push origin -- +main', 'git push origin -- refs/tags/v1', 'git push origin -- :main', 'git push -- origin v1.2',
		'git push -o ci.skip origin -- +main', 'git push --force -- origin main', 'git update-ref -- refs/tags/v9 HEAD',
		// a delete refspec is a rewrite of main
		'git push origin :main', 'git push origin :master',
		// an alias set on the command line or earlier in the same line
		'git -c alias.t=tag t v1', 'git -calias.t=tag t v1', "git -c alias.p='push --tags' p", "git -c alias.x='!git tag v1' x", 'git -C a -c alias.T=tag t v1',
		'git config alias.tt tag && git tt v1', 'git config --global alias.tt "tag -f" ; git tt v1',
		// an interpreter one-liner is classified on its code string
		`python3 -c 'import os; os.system("git tag v1")'`, `python -c "import subprocess; subprocess.run(['git', 'push', '--tags'])"`,
		`/usr/bin/python3.12 -u -c 'import os; os.system("git tag v1")'`, `env X=1 python3 -c 'import os; os.system("git tag v1")'`, `timeout 5 python3 -c 'import os; os.system("git tag v1")'`,
		`node -e "require('child_process').execSync('git tag v1')"`, `node -pe "require('child_process').execSync('git push --tags')"`, `node --eval "require('child_process').spawnSync('git', ['tag', 'v1'])"`,
		`perl -e 'system("git", "tag", "v1")'`, `perl -lane 'system "git tag v1"'`, `ruby -e 'system("git push --tags")'`, `php -r 'system("git tag v1");'`,
		// a branch moved by force, main by name or by ref
		'git checkout -B main origin/main', 'git checkout -B master', 'git checkout -fB main', 'git switch -C main', 'git switch --force-create main origin/main',
		'git branch -f main HEAD~1', 'git branch --force main abc', 'git branch -D main', 'git branch -M main', 'git branch -m main old', 'git branch -M x main',
		'git update-ref refs/heads/main HEAD', 'git update-ref -d refs/heads/main', 'git update-ref -m msg refs/heads/master HEAD~1',
		"git -c alias.p=push p --force origin main", 'git -c alias.a=b -c alias.b=push a --tags',
		// the wrapper that is allow-listed hides nothing from the line it carries
		'tools/bg.sh sh -c "git reset --hard HEAD~3"', 'tools/bg.sh gh workflow run release.yml', 'tools/bg.sh git update-ref refs/tags/x HEAD', 'tools/bg.sh git branch -f main HEAD~5',
		// a commit message that is followed by a real tag
		'git commit -m "$(cat <<\'EOM\'\nx\nEOM\n)" && git tag v1',
		// a substitution that a shell, eval or xargs runs: the heredoc body inside it is the code, not data
		'bash -c "$(cat <<\'EOF\'\ngit tag v1\nEOF\n)"', 'sh -c "$(cat <<\'EOF\'\ngit push --tags\nEOF\n)"', 'eval "$(cat <<\'EOF\'\ngit tag v1\nEOF\n)"',
		'eval $(cat <<\'EOF\'\ngit tag v1\nEOF\n)', 'sh -c "`cat <<\'EOF\'\ngit tag v1\nEOF\n`"', 'xargs sh -c "$(cat <<\'EOF\'\ngit tag v1\nEOF\n)"',
		// a heredoc piped into a shell is that shell's program, whoever prints it
		'cat <<EOF | sh\ngit tag v9\nEOF', "cat <<'EOF' | bash\ngit tag v9\nEOF", 'cat <<EOF | sh -s\ngit push --tags\nEOF', 'cat <<-EOF | zsh\n\tgit tag v9\n\tEOF', 'cat <<EOF | tee x | sh\ngit tag v9\nEOF',
		// gh fills {owner}/{repo} itself: a brace inside a word is part of the path, a brace group is still a group
		'gh api repos/{owner}/{repo}/git/refs -f ref=refs/tags/v1 -f sha=x', 'gh api -X POST repos/{owner}/{repo}/releases -f tag_name=v1', 'gh api --method=DELETE repos/{owner}/{repo}/git/refs/tags/v1',
		'{ git tag v1; }', 'true && { git tag v1; }', '{\ngit tag v1\n}',
	],
	deny: [
		`python3 -c 'import os; os.system("git commit --no-verify -m x")'`, `node -e "require('child_process').execSync('git push --no-verify')"`,
		"git -c alias.c='commit -n' c -m x", "git -c alias.c='commit --no-verify' c -m x",
		// an included file arrives at the command scope, which beats the repository's own hook path
		'git -c include.path=../tmp/gc push', 'git -cinclude.path=/x commit -m x', 'git -c includeIf.gitdir:/a/.path=/x push',
		'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path GIT_CONFIG_VALUE_0=/x git push', "GIT_CONFIG_PARAMETERS=\"'include.path'='/x'\" git push",
	],
	none: [
		// a heredoc that goes to a file, a filter or nowhere near a shell stays data
		'cat <<EOF | grep x\ngit tag v9\nEOF', 'cat <<EOF > f.txt\ngit tag v9\nEOF', 'cat <<EOF; sh clean.sh\ngit tag v9\nEOF', 'cat <<EOF\ngit tag v9\nEOF\nsh clean.sh',
		// a placeholder path that is not a ref or release write
		'gh api repos/{owner}/{repo}/issues -f title=x', 'gh api repos/{owner}/{repo}/git/refs', 'gh api repos/{owner}/{repo}/releases', 'echo ${HOME}/x && git status',
		// moving a branch that is not main, or reading main
		'git checkout -B claude/x origin/main', 'git checkout -b claude/x origin/main', 'git switch -c feat/x', 'git switch -C fix/y main', 'git checkout main', 'git switch main',
		'git branch -f claude/x main', 'git branch -D claude/x', 'git branch feat/z', 'git branch -m old new', 'git branch --list main', 'git branch -a',
		'git update-ref refs/heads/claude/x HEAD', 'git update-ref -d refs/heads/feat/x', 'git push origin :feat/x', 'git push origin -- HEAD', 'git push -- origin main',
		// code that names no git, or a script run as a file
		`python3 -c 'print(1)'`, `node -e 'console.log(1)'`, `perl -e 'print 1'`, `ruby -e 'puts 1'`, 'python3 script.py', 'python3 -m http.server', `node tools/x.mjs`, 'perl -pi -e "s/a/b/" f',
		// an alias for something harmless, a plain -c
		'git -c alias.s=status s', 'git -c user.name=a status', 'git ll', 'git -c color.ui=never log', 'git -c alias.a=a a', 'git -c alias.a=b -c alias.b=a a',
		'tools/bg.sh tools/ci-watch.sh --sha x', 'tools/bg.sh sh -c "npm test"',
		// a commit message that talks about tags, however it is passed
		'git commit -m "$(cat <<\'EOM\'\ndocs(releasing): explain the tag step\n\nThe tag step runs git tag -s only on the maintainer\'s word, and git push --tags later.\nEOM\n)"',
		'bash -c "git commit -m \\"$(cat <<\'EOM\'\ndocs: explain git tag policy\nEOM\n)\\""', 'sh -c "$(cat <<\'EOF\'\necho hi\nEOF\n)"', 'bash -c "cat <<\'EOF\'\ngit tag v1\nEOF"',
		'git commit -m "docs: explain git tag policy"', "git commit -F - <<'EOM'\ndocs: x\n\ngit push --tags later\nEOM",
		// a double dash before a path is a path
		'git commit -m x -- --no-verify', 'git log -- docs', 'git checkout -- f',
	],
};
for (const c of hide.ask) test(`hidden act asks: ${c}`, () => assert.equal(decide(c), 'ask'));
for (const c of hide.deny) test(`hidden act denied: ${c}`, () => assert.equal(decide(c), 'deny'));
for (const c of hide.none) test(`not a find: ${c}`, () => assert.equal(decide(c), ''));

test('an alias in the repository config is resolved before the line is classified', () => {
	const r = repo(join(dir, 'aliasrepo'), { origin: THEME });
	for (const [ k, v ] of Object.entries({ 'alias.tt': 'tag', 'alias.pt': 'push --tags origin', 'alias.sh1': '!git tag v1', 'alias.ll': 'log --oneline', 'alias.chain': 'tt', 'alias.loop': 'loop', 'alias.nb': 'commit -n' })) g(r, 'config', k, v);
	for (const c of [ 'git tt v1', 'git pt', 'git sh1', 'git -C aliasrepo tt v1', 'git -C aliasrepo chain v1', 'cd aliasrepo && git tt v1' ]) assert.equal(decide(c, { cwd: c.includes('aliasrepo') ? dir : r }), 'ask', c);
	assert.equal(decide('git nb -m x', { cwd: r }), 'deny');
	for (const c of [ 'git ll', 'git ll -3', 'git nosuchalias', 'git loop' ]) assert.equal(decide(c, { cwd: r }), '', c);
	// the other repository has no such alias
	assert.equal(decide('git tt v1', { cwd: dir }), '');
});

test('a push is judged on the repository a line redirects it to, and on a remote the line itself sets', () => {
	const home = join(dir, 'home');
	const fork = repo(join(home, 'fork'), { origin: FORK });
	const mine = repo(join(dir, 'mine'), { origin: THEME, up: FORK });
	const env = { ...process.env, HOME: home };
	const ask = [
		`git --git-dir=${fork}/.git push origin HEAD:x`, `git --git-dir ${fork}/.git push origin HEAD:x`, `GIT_DIR=${fork}/.git git push origin HEAD:x`, `env GIT_DIR=${fork}/.git git push origin HEAD:x`,
		`export GIT_DIR=${fork}/.git; git push origin HEAD:x`, `git -C ${home} --git-dir=fork/.git push origin HEAD:x`,
		'git -C ~/fork push origin HEAD:x', 'cd ~/fork && git push origin HEAD:x', 'cd $HOME/fork && git push origin HEAD:x', 'cd "${HOME}/fork" && git push origin HEAD:x', 'git -C $HOME/fork push origin HEAD:x',
		// a repository chosen at run time is a push nobody can place
		'git --git-dir=$X push origin HEAD:x', 'GIT_DIR=$X git push', 'export GIT_DIR=$X; git push',
		// a remote or URL that the same line sets is never on disk when the hook reads it
		'git remote add f https://github.com/openwrt/luci && git push f HEAD:x', 'git remote add f https://github.com/openwrt/luci; git push f HEAD:x',
		'git remote set-url --push origin https://github.com/openwrt/luci && git push origin HEAD', 'git remote set-url origin https://github.com/openwrt/luci.git && git push',
		'git -c remote.origin.pushurl=https://github.com/openwrt/luci.git push origin HEAD:x', 'git -c remote.origin.url=https://github.com/openwrt/luci push',
		`git -c url.https://github.com/openwrt/luci.insteadOf=${THEME} push origin HEAD`, `git -c url.https://github.com/openwrt/luci.pushInsteadOf=${THEME} push origin HEAD`,
		`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/openwrt/luci.insteadOf GIT_CONFIG_VALUE_0=${THEME} git push origin HEAD`,
		'git config remote.origin.pushurl https://github.com/openwrt/luci && git push', 'git config url.https://github.com/openwrt/luci.insteadOf x; git push',
		'git push --repo=https://github.com/openwrt/luci', 'git push --repo https://github.com/openwrt/luci',
		// a value taken by a push option is not the remote
		'git push -o ci.skip up x', 'git push --push-option=a up x', 'git push --push-option a up x',
		// the match is anchored: a lookalike prefix, suffix or host is a different repository
		'git push evil1 x', 'git push evil2 x', 'git push evil3 x', 'git push evil4 x',
	];
	g(mine, 'remote', 'add', 'evil1', 'https://github.com/evil/VizzleTF/luci-theme-footstrap');
	g(mine, 'remote', 'add', 'evil2', 'https://github.com/VizzleTF/luci-theme-footstrap-fork.git');
	g(mine, 'remote', 'add', 'evil3', 'https://evilgithub.com/VizzleTF/luci-theme-footstrap');
	g(mine, 'remote', 'add', 'evil4', 'https://github.com/VizzleTF/luci-theme-footstrap.evil');
	for (const c of ask) assert.equal(decide(c, { cwd: mine, env }), 'ask', c);
	const none = [
		'git push', 'git push origin main', 'git push -u origin claude/x', 'git push -o ci.skip origin x', 'git push --push-option=a origin x',
		`git --git-dir=${mine}/.git push origin x`, `GIT_DIR=${mine}/.git git push origin x`, 'git -C ../mine push origin x',
		// --work-tree does not choose the repository, and a remote added with the theme URL is the theme repo
		`git --work-tree=${fork} push origin x`, `GIT_WORK_TREE=${fork} git push`,
		`git remote add origin ${THEME} && git push -u origin x`, 'git remote add f https://github.com/openwrt/luci', 'git remote -v && git status', 'git config remote.origin.pushurl',
		`git -c remote.origin.pushurl=${THEME} push origin x`, 'git -c url.https://example.com/.insteadOf=gh: status', 'git push --repo=git@github.com:VizzleTF/luci-theme-footstrap.git',
		'cd "$X" && git push up x', 'git push nosuch x',
	];
	for (const c of none) assert.equal(decide(c, { cwd: mine, env }), '', c);
	// every spelling of the theme repo's own URL is the theme repo
	for (const [ i, url ] of [ 'https://github.com/VizzleTF/luci-theme-footstrap', 'https://github.com/vizzletf/luci-theme-footstrap.git', 'https://github.com/VizzleTF/luci-theme-footstrap/', 'ssh://git@github.com/VizzleTF/luci-theme-footstrap.git', 'git@github.com:VizzleTF/luci-theme-footstrap', 'https://x-access-token:tok@github.com/VizzleTF/luci-theme-footstrap.git' ].entries()) {
		g(mine, 'remote', 'add', `home${i}`, url);
		assert.equal(decide(`git push home${i} x`, { cwd: mine, env }), '', url);
	}
});

test('hook stays quiet on stderr for plain, alias, interpreter and push lines', () => {
	for (const c of [ 'git status', 'git tag v1', `python3 -c 'print(1)'`, 'git push origin -- +main', 'git tt v1' ]) {
		const r = spawnSync('/bin/sh', [ HOOK ], { input: JSON.stringify({ cwd: dir, tool_input: { command: c } }), encoding: 'utf8' });
		assert.equal(r.status, 0);
		assert.equal(r.stderr, '', c);
	}
});

// ---- precommit-gate: the one-call `add && commit` exemption belongs to a real, unbroken `add` ----
// The gate speaks only for the repository that holds it, so the hooks run from a scratch repository carrying copies of them.
function gateRepo(name = 'gate', stage = true) {
	const r = repo(join(dir, name));
	mkdirSync(join(r, '.claude/hooks'), { recursive: true });
	mkdirSync(join(r, 'tools'));
	for (const f of [ 'git-guard.sh', 'precommit-gate.sh' ]) copyFileSync(join(ROOT, '.claude/hooks', f), join(r, '.claude/hooks', f));
	writeFileSync(join(r, 'tools/changelog.mjs'), 'process.exit(0);\n'); // the mechanical half passes: the exemption is what is tested
	writeFileSync(join(r, 'CHANGELOG.md'), '# c\n');
	writeFileSync(join(r, 'CHANGELOG_ru.md'), '# c\n');
	g(r, 'add', '.');
	g(r, 'commit', '-q', '-m', 'init');
	if (stage) {
		writeFileSync(join(r, 'a.txt'), 'a\n');
		g(r, 'add', 'a.txt');
	}
	return r;
}
test('precommit-gate: add && commit is exempt only when the add is a clean segment of its own', () => {
	const r = gateRepo();
	const gate = (c) => decide(c, { cwd: r, hook: join(r, '.claude/hooks/precommit-gate.sh') });
	const add = `node tools/changelog.mjs add 0 --en '- **A (b); c.** d' --ru '- **А.** б'`;
	// /ship step 3 prints its recipe with a backslash-newline before the `&&`: the shell reads that as one line
	const ship = "node tools/changelog.mjs add 2 --en '- **Lead.** x' --ru '- **Лид.** y' \\\n  && git commit -m 'fix(tools): x'";
	for (const c of [ `${add} && git commit -m x`, `${add} && node tools/changelog.mjs add 1 --en '- **B.** c' --ru '- **Б.** в' && git commit -m x`, `${add} && git commit -m "a && b; c"`, ship, `${add} \\\n  && git commit -m x`, `${add} && \\\n git commit -m x` ]) assert.equal(gate(c), '', c);
	for (const c of [
		'git commit -m x', `${add} || true && git commit -m x`, `${add}; true && git commit -m x`, `${add} | cat && git commit -m x`, `${add} & git commit -m x`,
		`${add}; git commit -m x`, `${add} && echo ok; git commit -m x`, `${add} || git commit -m x`, `echo ${add} && git commit -m x`, `true && ${add} && git commit -m x`,
		`${add}\ngit commit -m x`, `x=1 ${add} && git commit -m x`,
		'echo changelog.mjs add && git commit -m x',
	]) assert.equal(gate(c), 'deny', c);
});

// The index is read before an `add` in the same call has run, so a chained `git add` is read as the files it would stage.
test('precommit-gate: a git add chained before the commit counts its pending files', () => {
	const r = gateRepo('gate2', false);
	writeFileSync(join(r, 'b.txt'), 'b\n');
	writeFileSync(join(r, 'c.txt'), 'c\n');
	const gate = (c) => decide(c, { cwd: r, hook: join(r, '.claude/hooks/precommit-gate.sh') });
	const add = `node tools/changelog.mjs add 0 --en '- **A.** d' --ru '- **А.** б'`;
	// nothing staged, nothing changelogged: every add that reaches b.txt or c.txt is a substantive commit with no entry
	for (const c of [
		'git add b.txt && git commit -m x', 'git add b.txt \\\n  && git commit -m x', 'git add -A && git commit -m x', 'git add --all && git commit -m x', 'git add . && git commit -m x', 'git add -- b.txt && git commit -m x',
		'git add b.txt c.txt && git commit -m x', 'git add b.txt && git add c.txt && git commit -m x', 'git add *.txt && git commit -m x', 'git add b.txt && git commit -am x',
	]) assert.equal(gate(c), 'deny', c);
	// an add that matches nothing, one that runs after the commit, and one next to a changelog add stay silent
	for (const c of [ 'git add nothing-here && git commit -m x', 'git commit -m x && git add b.txt', `git add b.txt && ${add} && git commit -m x`, `${add} && git add b.txt && git commit -m x` ]) assert.equal(gate(c), '', c);
	// a form the gate cannot read is a question, not a pass
	for (const c of [
		"git add 'b.txt' && git commit -m x", 'git add -p && git commit -m x', 'git add -f b.txt && git commit -m x', 'git add -u && git commit -m x', 'git add b.txt; git commit -m x',
		'git add b.txt || true && git commit -m x', 'git add b.txt | cat && git commit -m x', 'git add b.txt & git commit -m x', 'git -C . add b.txt && git commit -m x', 'git add $(echo b.txt) && git commit -m x',
		'git add b.txt\ngit commit -m x', 'git add b.txt\nc.txt && git commit -m x', 'cd . && git add b.txt && git commit -m x', 'git add b.txt && echo ok && git commit -m x',
	]) assert.equal(gate(c), 'ask', c);
	// both changelog files pending in the worktree: an add that reaches them, and only then, carries the entry
	writeFileSync(join(r, 'CHANGELOG.md'), '# c\n- e\n');
	writeFileSync(join(r, 'CHANGELOG_ru.md'), '# c\n- e\n');
	for (const c of [ 'git add b.txt CHANGELOG.md && git commit -m x', 'git add b.txt c.txt CHANGELOG_ru.md && git commit -m x' ]) assert.equal(gate(c), 'deny', c);
	for (const c of [
		'git add -A && git commit -m x', 'git add --all && git commit -m x', 'git add . && git commit -m x', 'git add b.txt CHANGELOG.md CHANGELOG_ru.md && git commit -m x',
		'git add CHANGELOG.md CHANGELOG_ru.md && git commit -m x', 'git add *.md && git commit -m x', 'git add CHANGELOG.md && git add CHANGELOG_ru.md && git commit -m x',
	]) assert.equal(gate(c), '', c);
});

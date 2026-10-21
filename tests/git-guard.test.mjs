import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

// `agent` is the hook input's agent_type: set for a subagent (a crew role or any other), absent for the lead
function run(command, { cwd = dir, hook = HOOK, env, timeout, agent } = {}) {
	const r = spawnSync('/bin/sh', [ hook ], { input: JSON.stringify({ cwd, ...(agent && { agent_type: agent }), tool_input: { command } }), encoding: 'utf8', env, timeout });
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
	return r.stdout.trim();
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
	// a quote in a heredoc body inside "$( )" is text: it does not close the token and expose the lines after it
	'git commit -m "$(cat <<\'EOM\'\nfix: handle the " in names\ngit tag v1 is not run here\nEOM\n)"',
	// a word of the previous segment is not the verb of the next
	'echo a create; gh release',
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
	// cobra takes -R/--repo after the group verb too, so the subcommand is read past it
	'gh release -R VizzleTF/luci-theme-footstrap create v1', 'gh release --repo VizzleTF/luci-theme-footstrap create v1', 'gh release --repo=VizzleTF/luci-theme-footstrap delete v1 -y',
	'gh release -RVizzleTF/luci-theme-footstrap upload v1 a.tgz', "bash -c 'gh release -R VizzleTF/luci-theme-footstrap create v1'",
	'gh -R VizzleTF/luci-theme-footstrap release create v1', 'gh -R owfeed/x api -X POST repos/VizzleTF/luci-theme-footstrap/git/refs -f a=1',
	'gh workflow run build.yml -f publish-pages=true', 'gh workflow run build.yml --field publish-pages=true', 'gh workflow run build.yml -F publish-pages=true',
	'gh workflow run build.yml --raw-field publish-pages=true', 'gh workflow run build.yml -f publish-pages=1', 'gh workflow run build.yml -fpublish-pages=true',
	'gh workflow run build.yml --raw-field=publish-pages=true', 'gh workflow run pages.yml', 'gh workflow run pages', 'gh workflow run pages.yml --ref main',
	'gh workflow run pages.yml -R VizzleTF/luci-theme-footstrap', 'gh workflow run build.yml --repo VizzleTF/luci-theme-footstrap -f publish-pages=true',
	'gh -R VizzleTF/luci-theme-footstrap workflow run pages.yml', 'gh workflow -R VizzleTF/luci-theme-footstrap run pages.yml',
	'git push --force origin main', 'git push -f origin master', 'git push origin +main', 'git push --force-with-lease origin main',
	'git push origin --delete main', 	'sh -c "git tag v1"', 'git commit -m x && git tag v1',
	// a PR or issue comment or review is a publication on any repo, the theme's too
	'gh pr comment 9 --repo openwrt/luci -b x', 'gh issue comment 1 -R owfeed/owfeed -b x', 'gh pr review 3 --approve', 'gh pr comment 1 -b x', 'gh issue comment 1 -R VizzleTF/luci-theme-footstrap -b x',
	'gh pr -R openwrt/luci comment 9 -b x', 'gh -R openwrt/luci pr review 9 -c -b x', 'gh pr review 3 -R VizzleTF/luci-theme-footstrap --request-changes -b x',
	// a write asks when it is aimed at another repo: -R, --repo, --repo=, -Rx before or after the group, or a PR or issue URL
	'gh pr create -R openwrt/luci -t t -b b', 'gh issue create --repo VizzleTF/owlab -t t', 'gh issue create --repo=owfeed/owfeed -t t', 'gh pr create -Ropenwrt/luci -t t',
	'gh pr -R openwrt/luci create -t t', 'gh -R openwrt/luci issue create -t t', 'gh pr edit 4 --repo openwrt/luci --title t', 'gh issue close 7 -R owfeed/owfeed', 'gh pr reopen 7 -R openwrt/luci',
	'gh pr close https://github.com/openwrt/luci/pull/9', 'gh issue edit https://github.com/VizzleTF/owlab/issues/2 -t t', 'gh issue reopen HTTPS://GitHub.com/OpenWrt/luci/issues/2',
	'gh pr create -R VizzleTF/luci-theme-footstrap-fork -t t', 'gh pr create -R github.com/openwrt/luci -t t', 'gh issue create -R hub.example.com/VizzleTF/luci-theme-footstrap -t t',
	// reached through a loop, a nested shell or a chain
	// new is gh's alias for create, revert opens a PR, a discussion is published like an issue
	'gh pr new -R openwrt/luci -t t -b b', 'gh issue new -R owfeed/owfeed -t t', 'gh pr revert 3 -R openwrt/luci', 'gh discussion comment 1 -R openwrt/luci -b x', 'gh discussion create -R openwrt/luci -t t',
	// GH_REPO names the target as a prefix, behind env or an export
	'GH_REPO=openwrt/luci gh pr create -t t -b b', 'env GH_REPO=openwrt/luci gh pr edit 3 -t t', 'export GH_REPO=openwrt/luci; gh pr close 9', 'GH_REPO=openwrt/luci; export GH_REPO; gh pr new -t t',
	'GH_REPO=VizzleTF/luci-theme-footstrap gh pr create -R openwrt/luci -t t',
	// close and reopen post a comment on any repo when given one
	'gh pr close 9 --comment x', 'gh issue close 9 -c x', 'gh issue reopen 9 --comment=x', 'gh pr close 9 -R VizzleTF/luci-theme-footstrap -c x', 'gh pr close 9 -cx',
	'for i in 1; do gh issue comment $i -b x; done', "sh -c 'gh pr comment 2 -b x'", 'git -C . status && gh pr comment 1 -b x', 'echo x | xargs gh pr comment 1 -b',
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
	'gh workflow run build.yml --ref main', 'gh -R VizzleTF/luci-theme-footstrap workflow run build.yml',
	'gh workflow run build.yml -f publish-pages=false', 'gh workflow run pages.yml --repo owfeed/owfeed-packages', 'gh workflow run build.yml -R owfeed/x -f publish-pages=true',
	'gh workflow run update.yml -R owfeed/owfeed-packages', 'gh workflow run update.yml --repo owfeed/owfeed-packages', 'gh run list',
	'gh workflow -R owfeed/owfeed-packages run update.yml', 'gh workflow --repo=owfeed/owfeed-packages run update.yml', 'gh release -R VizzleTF/luci-theme-footstrap list',
	// the theme's own PRs and issues are the agent's, and so is every read verb on any repo
	'gh pr create -t t -b b', 'gh pr merge 5 --rebase', 'gh pr merge 5 --squash -R openwrt/luci', 'gh issue list -R openwrt/luci', 'gh pr checks 3', 'gh pr view 1 --repo openwrt/luci', 'gh pr list', 'gh pr status',
	'gh pr diff 3 -R openwrt/luci', 'gh issue view 1 -R owfeed/owfeed', 'gh issue status', 'gh pr checkout 3', 'gh pr ready 3',
	'gh pr create -R VizzleTF/luci-theme-footstrap -t t', 'gh pr create --repo vizzletf/luci-theme-footstrap -t t -b b', 'gh pr create --repo=VizzleTF/luci-theme-footstrap -t t',
	'gh pr create -R https://github.com/VizzleTF/luci-theme-footstrap -t t', 'gh issue create -R github.com/VizzleTF/luci-theme-footstrap.git -t t', 'gh -R VizzleTF/luci-theme-footstrap pr edit 4 --title t',
	'gh issue close 7 -R VizzleTF/luci-theme-footstrap', 'gh pr close https://github.com/VizzleTF/luci-theme-footstrap/pull/9',
	'gh pr new -t t', 'gh pr close 9', 'gh pr close 9 -d', 'gh pr revert 3', 'gh pr new -R VizzleTF/luci-theme-footstrap -t t', 'gh discussion view 1 -R openwrt/luci', 'gh discussion list',
	'GH_REPO=VizzleTF/luci-theme-footstrap gh pr create -t t', 'export GH_REPO=VizzleTF/luci-theme-footstrap; gh pr close 9', 'GH_REPO=openwrt/luci gh pr create -R VizzleTF/luci-theme-footstrap -t t',
	'GH_REPO=openwrt/luci gh pr view 3', 'GH_REPO=$X gh pr create -t t', 'export GH_REPO=$X; gh pr close 9',
	// a repository picked at run time or by gh itself is no find
	'gh pr create -R "$R" -t t', 'gh issue create --repo {owner}/{repo} -t t', 'gh pr close 3 -R $REPO',
	// the words in an echo, a commit message or a heredoc are text
	'echo gh pr comment 1', 'git commit -m "docs: run gh pr comment 1 on the PR"', "cat <<'E'\ngh pr comment 1 -b x\nE",
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

// With no -R and no GH_REPO, gh writes to the repository of the directory it runs in: a remote that is not the theme repo asks.
test('a gh write with no repo named is judged on the remotes of its directory', () => {
	const up = repo(join(dir, 'luci-pr'), { origin: FORK });
	const mixed = repo(join(dir, 'ghmixed'), { origin: THEME, up: FORK });
	const own = repo(join(dir, 'ghown'), { origin: THEME });
	const bare = repo(join(dir, 'ghbare'));
	for (const c of [ 'cd luci-pr && gh pr create --fill', 'cd luci-pr; gh pr new --fill', `cd ${up} && gh pr create --fill`, 'cd ghmixed && gh issue close 3', 'cd luci-pr && gh pr revert 3', 'cd luci-pr && sh -c "gh pr create --fill"' ]) assert.equal(decide(c), 'ask', c);
	assert.equal(decide('gh pr create --fill', { cwd: up }), 'ask');
	assert.equal(decide('gh pr edit 3 -t t', { cwd: mixed }), 'ask');
	for (const c of [ 'cd ghown && gh pr create --fill', 'cd ghbare && gh pr create --fill', 'cd nosuch && gh pr create --fill', 'cd "$X" && gh pr create --fill', 'cd luci-pr && gh pr create -R VizzleTF/luci-theme-footstrap --fill', 'cd luci-pr && GH_REPO=VizzleTF/luci-theme-footstrap gh pr create --fill', 'cd luci-pr && gh pr view 3', 'cd luci-pr && gh pr merge 3' ]) assert.equal(decide(c), '', c);
	assert.equal(decide('gh pr create --fill', { cwd: own }), '');
	assert.equal(decide('gh pr create --fill', { cwd: bare }), '');
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
// precommit-gate reads --kinds: a commit that hides behind a `<<` in a "…" token must still be seen as one
test('--kinds still lists the commit behind a << inside a quoted token', () => {
	const input = JSON.stringify({ cwd: dir, tool_input: { command: 'echo "$(true) <<X\n" ; git commit -m x ; echo "\nX\n"' } });
	assert.match(spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input, encoding: 'utf8' }).stdout, /\bcommit\b/);
});
test('--kinds still lists the commit behind a backtick span that holds a <<', () => {
	const input = JSON.stringify({ cwd: dir, tool_input: { command: 'echo "`cat <<X\nfoo\n`"; git commit -m x #\nX\n`"' } });
	assert.match(spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input, encoding: 'utf8' }).stdout, /\bcommit\b/);
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
		'tools/bg.sh sh -c "git reset --hard HEAD~3"', 'tools/bg.sh git update-ref refs/tags/x HEAD', 'tools/bg.sh git branch -f main HEAD~5',
		// a commit message that is followed by a real tag
		'git commit -m "$(cat <<\'EOM\'\nx\nEOM\n)" && git tag v1',
		// a substitution that a shell, eval or xargs runs: the heredoc body inside it is the code, not data
		'bash -c "$(cat <<\'EOF\'\ngit tag v1\nEOF\n)"', 'sh -c "$(cat <<\'EOF\'\ngit push --tags\nEOF\n)"', 'eval "$(cat <<\'EOF\'\ngit tag v1\nEOF\n)"',
		'eval $(cat <<\'EOF\'\ngit tag v1\nEOF\n)', 'sh -c "`cat <<\'EOF\'\ngit tag v1\nEOF\n`"', 'xargs sh -c "$(cat <<\'EOF\'\ngit tag v1\nEOF\n)"',
		// a stray quote in that body leaves it inside the token, so the code before it is still read
		'sh -c "$(cat <<\'EOM\'\ngit tag v1\nsay " hi\nEOM\n)"', 'sh -c "$(cat <<-EOM\n\tgit tag v1\n\tEOM\n)"',
		// a `<<` inside a "…" token is text unless the shell is certainly in the first $( ): the quote after it still closes the token, and what follows it runs
		'echo "$(true) <<EOF\n"; git tag v1\nEOF', 'echo "$(true) <<EOF\n"; git push --tags\nEOF', 'echo "$(true) <<EOF\n"; gh release create v1\nEOF', 'echo "$(true) <<EOF\n"; git update-ref refs/tags/v9 HEAD\nEOF',
		'echo "`true` <<EOF\n"; git tag v1\nEOF', 'echo "$(true) <<-X\n" ; git tag v1 ; echo "\nX\n"', 'echo "$(true) <<X\n" ; git push --force origin main ; echo "\nX\n"', 'echo "$(true) <<X\n" ; gh release create v1 ; echo "\nX\n"',
		// the same with the `<<` in a single quote, a comment, an arithmetic, a substitution already closed or a second one, or behind a redirection
		'echo "$(echo \'<<EOF\'\n)"; git tag v1\nEOF', 'echo "$(true # $(\n) <<X\n"; git tag v1\nX', 'echo "$((1 <<X\n))"; git tag v1\nX', 'echo "$(cat <<X) <<Y\n"; git tag v1\nX\nY',
		'echo "$(echo \'$(cat <<X\'\n)"; git tag v1\nX', 'echo "$$(cat <<X\n"; git tag v1\nX', 'echo "$(true)$(cat <<X\n"; git tag v1\nX', 'echo "$(cat >f <<X\n"; git tag v1\nX',
		// a delimiter with an unbalanced quote is not read: the shell would take a different word, so the line is left to the plain scan
		'echo "$(cat <<X\'\n" ; git tag v1 ; echo "\nX\n\' )"',
		// a backtick span ends at the next backtick whatever a heredoc says, so the line after it runs
		'echo "`cat <<X\nfoo\n`"; git tag v1 #\nX\n`"', 'echo "`cat <<X\nfoo\n`"; git push --tags #\nX\n`"', 'echo "`cat <<X\nfoo\n`"; gh release create v1 #\nX\n`"',
		// an unquoted delimiter lets the shell run a substitution in the body, a quote in the plain text around it is text
		'cat <<X\n$(git tag v1)\nX', 'cat <<X\n`git tag v1`\nX', 'cat <<X\nsay " hi $(git tag v1)\nX', 'echo "$(cat <<X\n$(git tag v1)\nX\n)"', 'git commit -m "$(cat <<X\nmsg $(git push --tags)\nX\n)"',
		// `$$` is the PID: a `$(` after one or more pairs, or after an escaped $, is still a substitution
		'cat <<X\n$$$(git tag v1)\nX', 'cat <<X\n\\$$(git tag v1)\nX', 'git commit -F - <<EOF\ncost: \\$$(git push --tags)\nEOF', 'git commit -m "$(cat <<EOF\npid $$$(git tag v1)\nEOF\n)"',
		// a " inside a substitution opens a nested string; the outer token ends at its own closing quote
		'echo "$(echo "<<X\n"; git tag v1 #\nX\n)"', 'echo "$(echo "x")"; git tag v1', 'echo "$(echo "$(git tag v1)")"',
		// a heredoc piped into a shell is that shell's program, whoever prints it
		'cat <<EOF | sh\ngit tag v9\nEOF', "cat <<'EOF' | bash\ngit tag v9\nEOF", 'cat <<EOF | sh -s\ngit push --tags\nEOF', 'cat <<-EOF | zsh\n\tgit tag v9\n\tEOF', 'cat <<EOF | tee x | sh\ngit tag v9\nEOF',
		// gh fills {owner}/{repo} itself: a brace inside a word is part of the path, a brace group is still a group
		'gh api repos/{owner}/{repo}/git/refs -f ref=refs/tags/v1 -f sha=x', 'gh api -X POST repos/{owner}/{repo}/releases -f tag_name=v1', 'gh api --method=DELETE repos/{owner}/{repo}/git/refs/tags/v1',
		'{ git tag v1; }', 'true && { git tag v1; }', '{\ngit tag v1\n}',
	],
	deny: [
		`python3 -c 'import os; os.system("git commit --no-verify -m x")'`, `node -e "require('child_process').execSync('git push --no-verify')"`,
		"git -c alias.c='commit -n' c -m x", "git -c alias.c='commit --no-verify' c -m x",
		// the same hole as above, for the act that is never allowed
		'echo "$(true) <<EOF\n"; git commit --no-verify -m x\nEOF', 'echo "$(true) <<X\n" ; git commit --no-verify -m x ; echo "\nX\n"',
		'echo "`cat <<X\nfoo\n`"; git commit --no-verify -m x #\nX\n`"',
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
		// a quote in the body of the leading heredoc of a commit message is text, with <<- and with words before the $(
		'git commit -m "$(cat <<-EOM\n\tit\'s a \" b\n\tgit tag v1\n\tEOM\n)"', 'git commit -m "msg $(cat <<EOM\nx \" y\nEOM\n)"',
		// a quoted delimiter leaves the body as data; an escaped $ is no substitution; a string inside a substitution is text
		"cat <<'X'\n$(git tag v1)\nX", 'cat <<"X"\n$(git tag v1)\nX', 'cat <<\\X\n$(git tag v1)\nX', 'cat <<X\n\\$(git tag v1)\nX', 'cat <<X\nit\'s " fine $(date)\nX',
		// a PID followed by parentheses is text, not a substitution
		'cat <<X\n$$(git tag v1)\nX', 'cat <<X\n\\$$$(git tag v1)\nX',
		'echo "$(echo "; git tag v1")"',
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

// ---- precommit-gate, the verdict half: a package or guard path needs a recorded tester verdict on its content ----
// The cards are read from ../tmp of the repository that holds the hook, so each scratch repo gets a parent of its own.
function verdictRepo(name) {
	const r = gateRepo(`${name}/repo`, false);
	const hook = join(r, '.claude/hooks/precommit-gate.sh');
	const log = (rel) => { for (const f of [ 'CHANGELOG.md', 'CHANGELOG_ru.md' ]) appendFileSync(join(r, f), `- ${rel}\n`); };
	return {
		r,
		run: (c, cwd = r) => run(c, { cwd, hook }),
		// the commit's content: the file in the index, with both changelog entries so only the verdict half can speak
		stage(rel, text) {
			mkdirSync(dirname(join(r, rel)), { recursive: true });
			writeFileSync(join(r, rel), text);
			log(rel);
			g(r, '--literal-pathspecs', 'add', rel, 'CHANGELOG.md', 'CHANGELOG_ru.md'); // a name may hold a backslash or a glob
		},
		remove(rel, to) { // a deletion, or a move when `to` is given
			if (to) g(r, 'mv', rel, to); else g(r, 'rm', '-q', rel);
			log(rel);
			g(r, 'add', 'CHANGELOG.md', 'CHANGELOG_ru.md');
		},
		// the content only the worktree holds: the changelog is modified but not staged
		touch(rel, text) {
			mkdirSync(dirname(join(r, rel)), { recursive: true });
			writeFileSync(join(r, rel), text);
			log(rel);
		},
		// a round's tree of whatever is in the worktree for these paths, the way the developer's private index writes it
		snap(...paths) {
			g(r, 'add', ...paths);
			const t = g(r, 'write-tree');
			g(r, 'reset', '-q');
			return t;
		},
		// a card as the lead leaves it after a tester (and security) round
		card(n, ...history) {
			mkdirSync(join(r, '..', 'tmp', `task-${n}`), { recursive: true });
			writeFileSync(join(r, '..', 'tmp', `task-${n}`, 'card.json'), JSON.stringify({ id: `${n}`, history }));
		},
	};
}
const pass = (tree, more = {}) => ({ round: 1, tree, verdict: 'PASS', blocking: [], ...more });

test('precommit-gate verdict: a package path needs a PASS tree holding the same blob', () => {
	const v = verdictRepo('v1');
	const PKG = 'luci-theme-footstrap/a.txt';
	v.stage(PKG, 'one\n');
	const none = v.run('git commit -m x');
	assert.equal(none.permissionDecision, 'ask', 'no card at all');
	assert.match(none.permissionDecisionReason, /luci-theme-footstrap\/a\.txt/);
	assert.match(none.permissionDecisionReason, /package class/);
	const tree = g(v.r, 'write-tree');
	v.card('1', { ...pass(tree), verdict: 'NEEDS_WORK' });
	assert.equal(v.run('git commit -m x').permissionDecision, 'ask', 'a verdict that is not PASS');
	v.card('1', pass(tree));
	assert.equal(v.run('git commit -m x').permissionDecision, undefined, 'the PASS tree holds the same blob');
	// one byte of difference is a different blob: the PASS covered the other content
	v.stage(PKG, 'one!\n');
	assert.match(v.run('git commit -m x').permissionDecisionReason, /luci-theme-footstrap\/a\.txt/);
	// a card that is not JSON is skipped, and the cards behind it are still read
	v.card('0-bad');
	writeFileSync(join(v.r, '..', 'tmp', 'task-0-bad', 'card.json'), '{ "PASS" nope');
	v.card('2', pass(g(v.r, 'write-tree')));
	assert.equal(v.run('git commit -m x').permissionDecision, undefined);
	// a history that is not a list of objects reads as no verdict
	v.card('2', 'PASS');
	assert.equal(v.run('git commit -m x').permissionDecision, 'ask');
});

test('precommit-gate verdict: a guard path needs CLEAN on the same entry, any other path needs nothing', () => {
	const v = verdictRepo('v2');
	v.stage('.githooks/pre-push', '#!/bin/sh\n');
	const tree = g(v.r, 'write-tree');
	v.card('1', pass(tree));
	const q = v.run('git commit -m x');
	assert.equal(q.permissionDecision, 'ask', 'PASS without CLEAN');
	assert.match(q.permissionDecisionReason, /\.githooks\/pre-push/);
	assert.match(q.permissionDecisionReason, /CLEAN/);
	// CLEAN on a different entry is not the same entry
	v.card('2', pass(g(v.r, 'write-tree'), { security: 'FINDINGS' }));
	assert.equal(v.run('git commit -m x').permissionDecision, 'ask');
	v.card('1', pass(tree, { security: 'CLEAN' }));
	assert.equal(v.run('git commit -m x').permissionDecision, undefined);
	for (const rel of [ '.claude/hooks/x.sh', '.claude/settings.json', '.github/workflows/x.yml' ]) {
		v.stage(rel, 'x\n');
		assert.equal(v.run('git commit -m x').permissionDecision, 'ask', rel);
	}
	// the other paths go out on T0 and the pre-push check, and the tester reads them afterwards
	const w = verdictRepo('v3');
	for (const rel of [ 'tools/x.mjs', 'docs/x.md', 'tests/x.mjs', '.claude/skills/x.md', '.claude/agents/x.md', 'CLAUDE.md' ]) w.stage(rel, 'x\n');
	assert.equal(w.run('git commit -m x').permissionDecision, undefined);
	// a mixed commit names only the path that is uncovered
	w.stage('luci-theme-footstrap/b.txt', 'b\n');
	w.card('1', pass(g(w.r, 'write-tree')));
	w.stage('install.sh', '#!/bin/sh\n');
	const mixed = w.run('git commit -m x').permissionDecisionReason;
	assert.match(mixed, /install\.sh/);
	assert.doesNotMatch(mixed, /b\.txt|tools\/x/);
});

test('precommit-gate verdict: a deletion is covered by a PASS tree that lacks the path', () => {
	const v = verdictRepo('v4');
	v.stage('luci-theme-footstrap/old.txt', 'old\n');
	g(v.r, 'commit', '-q', '-m', 'add');
	const held = g(v.r, 'write-tree');
	v.remove('luci-theme-footstrap/old.txt');
	v.card('1', pass(held));
	assert.equal(v.run('git commit -m x').permissionDecision, 'ask', 'a tree that still holds the file');
	v.card('1', pass(g(v.r, 'write-tree')));
	assert.equal(v.run('git commit -m x').permissionDecision, undefined);
	// a move is a deletion of the old name too
	const m = verdictRepo('v5');
	m.stage('luci-theme-footstrap/old.txt', 'old\nmore\nlines\nso\nthat\ngit\nsees\na rename\n');
	g(m.r, 'commit', '-q', '-m', 'add');
	const heldHere = g(m.r, 'write-tree');
	m.remove('luci-theme-footstrap/old.txt', 'docs-old.txt');
	m.card('1', pass(g(m.r, 'write-tree')));
	assert.equal(m.run('git commit -m x').permissionDecision, undefined);
	m.card('1', pass(heldHere));
	assert.equal(m.run('git commit -m x').permissionDecision, 'ask');
});

test('precommit-gate verdict: a tree from before a file existed does not cover its deletion', () => {
	const d = verdictRepo('v8');
	d.stage('luci-theme-footstrap/keep.js', 'a\n');
	g(d.r, 'commit', '-q', '-m', 'A');
	const old = g(d.r, 'write-tree');
	// the next commit changes the directory the file lives in, and the file sits in a directory of its own
	d.stage('luci-theme-footstrap/keep.js', 'b\n');
	d.stage('luci-theme-footstrap/sub/new.js', 'n\n');
	g(d.r, 'commit', '-q', '-m', 'B');
	d.remove('luci-theme-footstrap/sub/new.js');
	d.card('1', pass(old));
	const q = d.run('git commit -m x');
	assert.equal(q.permissionDecision, 'ask', 'the old tree lacks new.js and holds another keep.js');
	assert.match(q.permissionDecisionReason, /sub\/new\.js/);
	d.card('1', pass(g(d.r, 'write-tree')));
	assert.equal(d.run('git commit -m x').permissionDecision, undefined, 'a tree of this very change');
	// when nothing else moved, the old tree is exactly what the commit leaves, so it does cover it
	const e = verdictRepo('v9');
	e.stage('luci-theme-footstrap/keep.js', 'a\n');
	g(e.r, 'commit', '-q', '-m', 'A');
	const same = g(e.r, 'write-tree');
	e.stage('luci-theme-footstrap/new.js', 'n\n');
	g(e.r, 'commit', '-q', '-m', 'B');
	e.remove('luci-theme-footstrap/new.js');
	e.card('1', pass(same));
	assert.equal(e.run('git commit -m x').permissionDecision, undefined);
	// a root-level file is judged on the policed files of the whole tree
	const f = verdictRepo('v10');
	f.stage('install.sh', '#!/bin/sh\n');
	f.stage('luci-theme-footstrap/a.txt', 'a\n');
	g(f.r, 'commit', '-q', '-m', 'A');
	const before = g(f.r, 'write-tree');
	f.stage('luci-theme-footstrap/a.txt', 'a2\n');
	g(f.r, 'commit', '-q', '-m', 'B');
	f.remove('install.sh');
	f.card('1', pass(before));
	assert.equal(f.run('git commit -m x').permissionDecision, 'ask');
	f.card('1', pass(g(f.r, 'write-tree')));
	assert.equal(f.run('git commit -m x').permissionDecision, undefined);
});

test('precommit-gate verdict: the cards are read newest first and the order never changes the answer', () => {
	const v = verdictRepo('v11');
	v.stage('luci-theme-footstrap/a.txt', 'one\n');
	const tree = g(v.r, 'write-tree');
	const at = (n, sec) => utimesSync(join(v.r, '..', 'tmp', `task-${n}`, 'card.json'), sec, sec);
	v.card('match', pass(tree));
	for (let i = 0; i < 5; i++) v.card(`other${i}`, pass('0'.repeat(40)), pass('1'.repeat(40)));
	for (const [ old, fresh ] of [ [ 'match', 'other0' ], [ 'other0', 'match' ] ]) {
		at(old, 1000);
		at(fresh, 2000);
		assert.equal(v.run('git commit -m x').permissionDecision, undefined, `${fresh} newest`);
	}
	// a guard path wants CLEAN from some entry, and a newer entry without it does not hide the older one that has it
	const w = verdictRepo('v12');
	w.stage('.githooks/pre-push', 'x\n');
	const t = g(w.r, 'write-tree');
	w.card('old', pass(t, { security: 'CLEAN' }));
	w.card('new', pass(t));
	utimesSync(join(w.r, '..', 'tmp', 'task-old', 'card.json'), 1000, 1000);
	utimesSync(join(w.r, '..', 'tmp', 'task-new', 'card.json'), 2000, 2000);
	assert.equal(w.run('git commit -m x').permissionDecision, undefined);
});

test('precommit-gate verdict: a one-call add, changelog add or `-a` is checked against what the commit will carry', () => {
	const v = verdictRepo('v6');
	const PKG = 'luci-theme-footstrap/n.txt';
	const log = "node tools/changelog.mjs add 0 --en '- **A.** d' --ru '- **А.** б'";
	// `git add` stages the worktree: the PASS tree is the worktree content, and one byte off asks
	v.touch(PKG, 'new\n');
	v.card('1', pass(v.snap(PKG)));
	const add = `git add ${PKG} CHANGELOG.md CHANGELOG_ru.md && git commit -m x`;
	assert.equal(v.run(add).permissionDecision, undefined);
	assert.equal(v.run(`git add -A && git commit -m x`).permissionDecision, undefined);
	v.touch(PKG, 'new!\n');
	assert.match(v.run(add).permissionDecisionReason, /luci-theme-footstrap\/n\.txt/);
	// the changelog add stages only the changelog: the package file is the index's, whatever the worktree holds
	writeFileSync(join(v.r, PKG), 'worktree only\n');
	const worktree = v.snap(PKG);
	writeFileSync(join(v.r, PKG), 'index\n');
	g(v.r, 'add', PKG);
	const index = g(v.r, 'write-tree');
	writeFileSync(join(v.r, PKG), 'worktree only\n');
	v.card('1', pass(worktree));
	assert.equal(v.run(`${log} && git commit -m x`).permissionDecision, 'ask');
	v.card('1', pass(index));
	assert.equal(v.run(`${log} && git commit -m x`).permissionDecision, undefined);
	// `-a` takes tracked files from the worktree, and leaves an untracked one out
	g(v.r, 'reset', '-q');
	g(v.r, 'add', PKG);
	g(v.r, 'commit', '-q', '-m', 'add');
	v.touch(PKG, 'second\n');
	v.touch('luci-theme-footstrap/untracked.txt', 'u\n');
	v.card('1', pass(v.snap(PKG)));
	assert.equal(v.run('git commit -am x').permissionDecision, undefined);
	v.touch(PKG, 'third\n');
	assert.equal(v.run('git commit -am x').permissionDecision, 'ask');
});

test('precommit-gate verdict: a name git quotes is read as the path it is', () => {
	for (const [ i, name ] of [ 'a"b.js', 'a\tb.js', 'a\\b.js', 'a\nb.js', 'a[1]*b.js' ].entries()) {
		const v = verdictRepo(`q${i}`);
		const rel = `luci-theme-footstrap/${name}`;
		v.stage(rel, 'one\n');
		assert.equal(v.run('git commit -m x').permissionDecision, 'ask', `${JSON.stringify(name)} uncovered`);
		v.card('1', pass(g(v.r, 'write-tree')));
		assert.equal(v.run('git commit -m x').permissionDecision, undefined, `${JSON.stringify(name)} covered`);
		v.stage(rel, 'two\n');
		assert.equal(v.run('git commit -m x').permissionDecision, 'ask', `${JSON.stringify(name)} one byte off`);
		assert.equal(v.run('git commit -am x').permissionDecision, 'ask', `${JSON.stringify(name)} read from the worktree`);
	}
	const w = verdictRepo('q-guard');
	w.stage('.githooks/a"b', 'x\n');
	assert.equal(w.run('git commit -m x').permissionDecision, 'ask', 'a guard path with a quoted name');
});

test('precommit-gate verdict: the commit forms that take worktree content are read from the worktree', () => {
	const v = verdictRepo('f1');
	const PKG = 'luci-theme-footstrap/a.txt';
	v.stage(PKG, 'one\n');
	g(v.r, 'commit', '-q', '-m', 'add');
	const held = g(v.r, 'rev-parse', 'HEAD^{tree}');
	v.touch(PKG, 'two\n'); // an edit only the worktree holds
	const edited = v.snap(PKG);
	g(v.r, 'add', 'CHANGELOG.md', 'CHANGELOG_ru.md'); // the index carries the changelog and no package file
	const reads = [
		'git commit -m x -a', 'git commit -m "x y" -a', "git commit -m 'x y' --all", 'git commit -qa -m x', 'git commit -sa -m x', 'git commit -am x', 'git commit --all -m x',
		`git commit -m x ${PKG}`, `git commit -m "x y" ${PKG}`, `git commit -o ${PKG} -m x`, `git commit -i ${PKG} -m x`, `git commit --only -m x -- ${PKG}`, `git commit --include ${PKG} -m x`,
		'git commit -m x luci-theme-footstrap',
	];
	v.card('1', pass(held));
	for (const c of reads) assert.equal(v.run(c).permissionDecision, 'ask', c);
	v.card('1', pass(edited));
	for (const c of reads) assert.equal(v.run(c).permissionDecision, undefined, c);
	// a line that only mentions the flag, or whose flag is another command's, leaves the index as the content
	v.card('1', pass(held));
	for (const c of [
		'git commit -m x', 'git commit -m "add -a flag"', "git commit -m 'x' # -a", 'git commit -ma', 'git commit -m x && ls -a', 'ls -a && git commit -m x', 'git commit -m x 2>&1',
		'git commit -m x; ls luci-theme-footstrap', 'git commit -m x | cat', 'git commit -m x -- docs',
		// a quoted path is named in the header as unread
		`git commit -m x "${PKG}"`,
		// the value of --pathspec-from-file is a file name, not a path the commit takes
		`git commit -m x --pathspec-from-file ${PKG}`,
	]) assert.equal(v.run(c).permissionDecision, undefined, c);
});

test('precommit-gate verdict: an exec bit and a symlink are part of the content', () => {
	const v = verdictRepo('m1');
	const G = '.githooks/pre-push';
	v.stage(G, '#!/bin/sh\n');
	g(v.r, 'commit', '-q', '-m', 'add');
	v.card('1', pass(g(v.r, 'rev-parse', 'HEAD^{tree}'), { security: 'CLEAN' }));
	v.touch(G, '#!/bin/sh\n'); // the same bytes, and the bit
	chmodSync(join(v.r, G), 0o755);
	const exec = v.snap(G);
	const staged = () => g(v.r, 'add', 'CHANGELOG.md', 'CHANGELOG_ru.md');
	g(v.r, 'add', G);
	staged();
	assert.equal(v.run('git commit -m x').permissionDecision, 'ask', 'staged with the bit');
	g(v.r, 'reset', '-q');
	staged();
	for (const c of [ 'git commit -am x', `git add ${G} && git commit -m x`, `git commit -m x ${G}` ]) assert.equal(v.run(c).permissionDecision, 'ask', c);
	v.card('1', pass(exec, { security: 'CLEAN' }));
	for (const c of [ 'git commit -am x', `git add ${G} && git commit -m x`, `git commit -m x ${G}` ]) assert.equal(v.run(c).permissionDecision, undefined, c);
	g(v.r, 'add', G);
	assert.equal(v.run('git commit -m x').permissionDecision, undefined, 'the tree holds the bit');

	// a file replaced by a symlink holding the same bytes, and a link that was never a file
	const w = verdictRepo('m2');
	const L = 'luci-theme-footstrap/l.txt';
	w.stage('luci-theme-footstrap/real.txt', 'real.txt'); // no newline: the bytes a link to it holds
	w.stage(L, 'real.txt');
	g(w.r, 'commit', '-q', '-m', 'add');
	const held = g(w.r, 'rev-parse', 'HEAD^{tree}');
	w.card('1', pass(held));
	w.touch('luci-theme-footstrap/real.txt', 'real.txt');
	rmSync(join(w.r, L));
	symlinkSync('real.txt', join(w.r, L));
	const link = w.snap(L);
	g(w.r, 'add', L, 'CHANGELOG.md', 'CHANGELOG_ru.md');
	assert.equal(w.run('git commit -m x').permissionDecision, 'ask', 'staged as a link');
	g(w.r, 'reset', '-q');
	g(w.r, 'add', 'CHANGELOG.md', 'CHANGELOG_ru.md');
	assert.equal(w.run('git commit -am x').permissionDecision, 'ask', 'a link in the worktree');
	w.card('1', pass(link));
	assert.equal(w.run('git commit -am x').permissionDecision, undefined, 'the tree holds the link');
	symlinkSync('nowhere', join(w.r, 'luci-theme-footstrap/new'));
	assert.equal(w.run('git add luci-theme-footstrap/new CHANGELOG.md CHANGELOG_ru.md && git commit -m x').permissionDecision, 'ask', 'a new link, dangling');
});

test('precommit-gate verdict: one entry has to hold every class path of the commit together', () => {
	const v = verdictRepo('c1');
	const A = 'luci-theme-footstrap/a.txt';
	const B = 'luci-theme-footstrap/b.txt';
	v.stage(A, 'a0\n');
	v.stage(B, 'b0\n');
	g(v.r, 'commit', '-q', '-m', 'add');
	v.touch(A, 'a1\n');
	const aNew = v.snap(A);
	v.touch(A, 'a0\n');
	v.touch(B, 'b1\n');
	const bNew = v.snap(B);
	v.touch(A, 'a1\n');
	const both = v.snap(A, B);
	g(v.r, 'add', A, B, 'CHANGELOG.md', 'CHANGELOG_ru.md');
	v.card('1', pass(aNew));
	v.card('2', pass(bNew));
	const q = v.run('git commit -m x');
	assert.equal(q.permissionDecision, 'ask', 'each path has an entry of its own');
	assert.match(q.permissionDecisionReason, /no single history entry/);
	v.card('3', pass(both));
	assert.equal(v.run('git commit -m x').permissionDecision, undefined, 'the pair is one entry');
	// the entry that holds both may be an older one, behind newer entries that hold one each
	v.card('3', pass('0'.repeat(40)), pass(both), pass(aNew));
	assert.equal(v.run('git commit -m x').permissionDecision, undefined);

	// a package path and a guard path: the entry holding both is the one that says CLEAN
	const w = verdictRepo('c2');
	const P = 'luci-theme-footstrap/p.txt';
	const G = '.githooks/pre-push';
	w.stage(P, 'p0\n');
	w.stage(G, 'g0\n');
	g(w.r, 'commit', '-q', '-m', 'add');
	w.touch(G, 'g1\n');
	const guardNew = w.snap(G);
	w.touch(P, 'p1\n');
	const pair = w.snap(P, G);
	g(w.r, 'add', P, G, 'CHANGELOG.md', 'CHANGELOG_ru.md');
	w.card('1', pass(guardNew, { security: 'CLEAN' }));
	w.card('2', pass(pair));
	const r = w.run('git commit -m x');
	assert.equal(r.permissionDecision, 'ask', 'CLEAN on one entry, both paths on another');
	assert.match(r.permissionDecisionReason, /CLEAN/);
	w.card('2', pass(pair, { security: 'CLEAN' }));
	assert.equal(w.run('git commit -m x').permissionDecision, undefined);
});

test('precommit-gate verdict: the changelog deny comes first, and another repository is left alone', () => {
	const v = verdictRepo('v7');
	mkdirSync(join(v.r, 'luci-theme-footstrap'));
	writeFileSync(join(v.r, 'luci-theme-footstrap/a.txt'), 'a\n');
	g(v.r, 'add', 'luci-theme-footstrap/a.txt');
	assert.equal(v.run('git commit -m x').permissionDecision, 'deny');
	const other = repo(join(dir, 'v7', 'other'));
	mkdirSync(join(other, 'luci-theme-footstrap'));
	writeFileSync(join(other, 'luci-theme-footstrap/a.txt'), 'a\n');
	g(other, 'add', 'luci-theme-footstrap/a.txt');
	assert.equal(v.run('git commit -m x', other).permissionDecision, undefined);
});

// ---- precommit-gate, the oracle half: a commit that weakens a baseline, a limit, a test or an allow-list asks ----
// None of these paths is in the verdict class, so only the oracle half can speak. `was` is committed first, `now` is staged.
function oracle(name, rel, was, now) {
	const v = verdictRepo(name);
	if (was !== null) { v.stage(rel, was); g(v.r, 'commit', '-q', '-m', 'add'); }
	v.stage(rel, now);
	return v;
}
const reason = (v, c = 'git commit -m x') => v.run(c).permissionDecisionReason;
const decision = (v, c = 'git commit -m x') => v.run(c).permissionDecision;

test('precommit-gate oracle: a line added under tools/baselines asks, a `release: ` subject does not', () => {
	const B = 'tools/baselines/b.json';
	const was = '{\n\t"a": [\n\t\t"x",\n\t\t"y"\n\t]\n}\n';
	// "y" gains a comma and "z" is the one new line
	const v = oracle('o1', B, was, '{\n\t"a": [\n\t\t"x",\n\t\t"y",\n\t\t"z"\n\t]\n}\n');
	assert.equal(decision(v), 'ask');
	assert.match(reason(v), /this commit weakens an oracle: tools\/baselines\/b\.json gained 1 line\(s\), first: "z"/);
	for (const c of [ "git commit -m 'release: 1.2.3'", 'git commit -m "release: 1.2.3"', "git commit -qm 'release: 1.2.3'", 'git commit --message="release: 1.2.3"', "git commit --message 'release: 1.2.3'" ]) assert.equal(decision(v, c), undefined, c);
	// the first -m is the subject, and the word has to start it
	for (const c of [ "git commit -m 'fix: release: 1.2.3'", "git commit -m x -m 'release: 1.2.3'", "git commit -m 'prerelease: 1.2.3'", 'git commit --amend --no-edit' ]) assert.equal(decision(v, c), 'ask', c);
	// a removal, and a baseline brought in at the same content, are not growth; a baseline file that is new is all growth
	assert.equal(decision(oracle('o1b', B, '{\n\t"a": [\n\t\t"x",\n\t\t"y"\n\t]\n}\n', '{\n\t"a": [\n\t\t"x"\n\t]\n}\n')), undefined);
	assert.equal(decision(oracle('o1c', B, null, was)), 'ask');
	assert.equal(decision(oracle('o1d', B, was, was.replace('"x"', '"x"'))), undefined);
	// -a reads the worktree: the index holds nothing new, the file on disk does
	const w = verdictRepo('o1e');
	w.stage(B, was);
	g(w.r, 'commit', '-q', '-m', 'add');
	w.touch(B, `${was}"more"\n`);
	assert.equal(decision(w, 'git commit -am x'), 'ask');
	assert.equal(decision(w), undefined);
});

test('precommit-gate oracle: a baseline line is new under its key, so a copy or a move between keys asks', () => {
	// the shape of tools/baselines/live-audit.json: stand keys, each a sorted list, most entries repeated across them
	const L = 'tools/baselines/live-audit.json';
	const shared = [ '/admin/dashboard|320|overflow|span', '/admin/services/acme/logread|0|noname|textarea#syslog' ];
	const only = '/admin/network/diagnostics|0|noname|textarea';
	const book = (o) => `${JSON.stringify(o, null, '\t')}\n`;
	const base = { owrt2512: [ only, ...shared ], owrt2410: [ ...shared ], owrtsnap: [ ...shared ], 'owrt2410@ru': [ ...shared ] };
	const was = book(base);
	const q = (name, o) => oracle(name, L, was, book(o));
	// a copy: the text sits in the file already, under owrt2512, and is new under owrt2410
	const copy = q('o1f', { ...base, owrt2410: [ only, ...shared ] });
	assert.equal(decision(copy), 'ask');
	assert.ok(reason(copy).includes(`${L} gained 1 line(s), first: "${only}"`), reason(copy));
	// a move: out of one key, into another
	assert.equal(decision(q('o1g', { ...base, owrt2512: [ ...shared ], owrt2410: [ only, ...shared ] })), 'ask');
	// a key that is new is its opener line and its entries; the closer already stands under the root
	assert.match(reason(q('o1h', { ...base, owrtnew: [ ...shared ] })), /gained 3 line\(s\), first: "owrtnew": \[/);
	// a reordering within a key, a removal and a file brought in unchanged are not growth
	assert.equal(decision(q('o1i', { ...base, owrt2512: [ ...shared, only ] })), undefined);
	assert.equal(decision(q('o1j', { ...base, owrt2512: [ only ], owrtsnap: [ shared[0] ] })), undefined);
	assert.equal(decision(q('o1k', JSON.parse(was))), undefined);
	// the key is the whole path of openers, so two lists under different parents are different keys
	const nest = (a, b) => book({ x: { list: a }, y: { list: b } });
	assert.equal(decision(oracle('o1l', L, nest([ 'p' ], [ 'p' ]), nest([ 'p', 'q' ], [ 'p' ]))), 'ask');
	assert.equal(decision(oracle('o1m', L, nest([ 'p', 'q' ], [ 'p' ]), nest([ 'p', 'q' ], [ 'p', 'q' ]))), 'ask', 'copied between the two lists');
	assert.equal(decision(oracle('o1n', L, nest([ 'p', 'q' ], [ 'p' ]), nest([ 'q', 'p' ], [ 'p' ]))), undefined);
	// a `release: ` subject still carries a baseline refresh, a copy included
	assert.equal(decision(copy, "git commit -m 'release: 1.2.3'"), undefined);
});

test('precommit-gate oracle: a raised number in css-metrics LIMITS asks, a lowering and size-budget do not', () => {
	const C = 'tools/css-metrics.mjs';
	const css = (n, more = '') => `// importants: 99 in a comment\nconst LIMITS = {\n\t/* a raise: importants: 77 */\n\timportants: ${n},\n\temptyRules: 0,${more}\n};\nconst importants = 5;\n`;
	const up = oracle('o2', C, css(35), css(36));
	assert.equal(decision(up), 'ask');
	assert.match(reason(up), /tools\/css-metrics\.mjs LIMITS raised: importants 35 -> 36/);
	assert.equal(decision(oracle('o2b', C, css(35), css(34))), undefined);
	assert.equal(decision(oracle('o2c', C, css(35), css(35, '\n\tnewKey: 9,'))), undefined, 'a limit that is new is a new check');
	assert.match(reason(oracle('o2d', C, css(35), css(35).replace('emptyRules: 0', 'emptyRules: 1'))), /emptyRules 0 -> 1/);
	assert.equal(decision(oracle('o2e', C, css(35), css(35).replace('// importants: 99', '// importants: 100'))), undefined, 'a comment is not a limit');
	// the size budget is under a standing grant
	const budget = (n) => `const LIMITS = {\n\tcascadeCss: ${n},\n};\n`;
	assert.equal(decision(oracle('o2f', 'tools/size-budget.mjs', budget('118_420'), budget('120_000'))), undefined);
	assert.equal(decision(oracle('o2g', C, budget('118_420'), budget('118_421'))), 'ask', 'an underscored number is read whole');
});

test('precommit-gate oracle: a net drop of test( calls in a tests file asks, per file', () => {
	const T = 'tests/a.test.mjs';
	// `latest(` and `contest(` hold the letters, not a call
	const tf = (...names) => `import { test } from 'node:test';\n${names.map((n) => `test('${n}', () => {});`).join('\n')}\nlatest(1); contest(2);\n`;
	const drop = oracle('o3', T, tf('a', 'b', 'c'), tf('a', 'b'));
	assert.equal(decision(drop), 'ask');
	assert.match(reason(drop), /tests\/a\.test\.mjs lost test\( calls: 3 -> 2/);
	assert.equal(decision(oracle('o3b', T, tf('a', 'b'), tf('a', 'b', 'c'))), undefined);
	assert.equal(decision(oracle('o3c', T, tf('a', 'b'), tf('x', 'y'))), undefined, 'the same count');
	assert.equal(decision(oracle('o3d', T, null, tf('a'))), undefined, 'a new file');
	assert.equal(decision(oracle('o3e', 'tests/helper.mjs', tf('a', 'b'), tf('a'))), undefined, 'not a *.test.mjs');
	// a test moved to another file still asks on the file it left
	const m = oracle('o3f', T, tf('a', 'b', 'c'), tf('a', 'b'));
	m.stage('tests/b.test.mjs', tf('c'));
	assert.match(reason(m), /tests\/a\.test\.mjs lost/);
	assert.doesNotMatch(reason(m), /tests\/b\.test\.mjs/);
	// a deleted file is every test gone
	const del = verdictRepo('o3g');
	del.stage(T, tf('a', 'b', 'c'));
	g(del.r, 'commit', '-q', '-m', 'add');
	del.remove(T);
	assert.match(reason(del), /tests\/a\.test\.mjs lost test\( calls: 3 -> 0/);
	// -a reads the worktree
	const w = verdictRepo('o3h');
	w.stage(T, tf('a', 'b'));
	g(w.r, 'commit', '-q', '-m', 'add');
	w.touch(T, tf('a'));
	assert.equal(decision(w, 'git commit -am x'), 'ask');
	assert.equal(decision(w), undefined);
});

test('precommit-gate oracle: a literal added to an ALLOW list of a tools gate asks, a removal does not', () => {
	const G = 'tools/gate.mjs';
	// the apostrophe is escaped in a literal, a quote and a `//` in a comment are text, and a set after the list is not the list
	const map = (...entries) => `const SKIP = [ 'not-in-a-list' ];\n/* ALLOW = [ 'in a comment' ] */\nconst ALLOW = new Map([\n\t// 'x': skipped\n${entries.map(([ k, why ]) => `\t[ '${k}', '${why}' ], // it's here`).join('\n')}\n]);\nconst after = new Set([ 'later' ]);\n`;
	const one = [ 'a in .b', "the reason, it\\'s long" ];
	const two = [ 'c in .d', 'http://x/y' ];
	const add = oracle('o4', G, map(one), map(one, two));
	assert.equal(decision(add), 'ask');
	assert.match(reason(add), /tools\/gate\.mjs ALLOW gained 2 literal\(s\), first: 'c in \.d'/);
	assert.equal(decision(oracle('o4b', G, map(one, two), map(one))), undefined);
	assert.equal(decision(oracle('o4c', G, map(one), map(one).replace("'later'", "'later', 'and more'"))), undefined, 'outside the list');
	assert.equal(decision(oracle('o4d', G, map(one), map(one).replace("\t// 'x': skipped", "\t// 'x': skipped, 'y' /* 'z' */"))), undefined, 'inside a comment');
	// a bare array, several entries on one line: a removal from the line is not a new entry, and a one-line list ends on its `;`
	const arr = (...e) => `const ALLOW = [\n\t${e.map((x) => `'${x}'`).join(', ')},\n];\n`;
	assert.equal(decision(oracle('o4e', G, arr('a', 'b'), arr('b'))), undefined);
	assert.match(reason(oracle('o4f', G, arr('a', 'b'), arr('a', 'b', 'c'))), /ALLOW gained 1 literal\(s\), first: 'c'/);
	const flat = (...e) => `const ALLOW = [ ${e.map((x) => `'${x}'`).join(', ')} ];\nconst other = [ 'zz' ];\n`;
	assert.equal(decision(oracle('o4g', G, flat('a'), flat('a', 'b'))), 'ask');
	assert.equal(decision(oracle('o4h', G, flat('a'), flat('a').replace("'zz'", "'zz', 'yy'"))), undefined);
	// a file with no ALLOW list is never read, and the list belongs to a tools/*.mjs
	assert.equal(decision(oracle('o4i', G, 'const X = [ "a" ];\n', 'const X = [ "a", "b" ];\n')), undefined);
	assert.equal(decision(oracle('o4j', 'docs/gate.mjs', arr('a'), arr('a', 'b'))), undefined);
});

test('precommit-gate oracle: a find joins the verdict half question, and a clean commit stays silent', () => {
	const v = oracle('o5', 'tools/baselines/b.json', '[\n\t"a"\n]\n', '[\n\t"a",\n\t"b"\n]\n');
	v.stage('luci-theme-footstrap/a.txt', 'one\n');
	const q = reason(v);
	assert.match(q, /weakens an oracle: tools\/baselines\/b\.json/);
	assert.match(q, /no recorded PASS on the content of luci-theme-footstrap\/a\.txt/);
	v.card('1', pass(g(v.r, 'write-tree')));
	assert.match(reason(v), /^precommit-gate: this commit weakens an oracle: tools\/baselines\/b\.json gained 1 line\(s\), first: "b"\. Waiving a gate is the maintainer's word/);
	const quiet = verdictRepo('o5b');
	for (const [ rel, text ] of [ [ 'tools/baselines/b.json', '[ "a" ]\n' ], [ 'tests/a.test.mjs', "test('a', () => {});\n" ], [ 'tools/x.mjs', 'const ALLOW = [ "a" ];\n' ], [ 'tools/css-metrics.mjs', 'const LIMITS = {\n\timportants: 1,\n};\n' ] ]) quiet.stage(rel, text);
	g(quiet.r, 'commit', '-q', '-m', 'add');
	quiet.stage('docs/x.md', 'x\n');
	assert.equal(decision(quiet), undefined);
});

// ---- precommit-gate: `--amend` is read against HEAD^, and a commit from a subdirectory is read from the root ----
test('precommit-gate: an amend is the combination of its parent and the index', () => {
	const v = verdictRepo('am1');
	const A = 'luci-theme-footstrap/a.txt';
	const B = 'luci-theme-footstrap/b.txt';
	v.stage(A, 'a0\n');
	v.stage(B, 'b0\n');
	g(v.r, 'commit', '-q', '-m', 'base');
	v.touch(A, 'a1\n');
	const aNew = v.snap(A); // A new, B old
	v.touch(A, 'a0\n');
	v.touch(B, 'b1\n');
	const bNew = v.snap(B); // B new, A old
	v.touch(A, 'a1\n');
	const both = v.snap(A, B);
	g(v.r, 'add', A, 'CHANGELOG.md', 'CHANGELOG_ru.md');
	g(v.r, 'commit', '-q', '-m', 'A');
	v.stage(B, 'b1\n'); // HEAD holds A new; the index adds B new
	v.card('1', pass(aNew));
	v.card('2', pass(bNew));
	assert.equal(decision(v), undefined, 'a plain commit adds B alone, and B has a PASS');
	const q = v.run('git commit --amend -m x');
	assert.equal(q.permissionDecision, 'ask', 'the amended commit is A and B together, which no entry holds');
	assert.match(q.permissionDecisionReason, /no single history entry/);
	assert.equal(decision(v, 'git commit --no-edit --amend'), 'ask');
	v.card('3', pass(both));
	for (const c of [ 'git commit --amend -m x', 'git commit --amend --no-edit', 'git commit -a --amend -m x' ]) assert.equal(decision(v, c), undefined, c);
	// a root commit has no parent: its content is the whole index, and the hooks it carries are guard paths
	const r = gateRepo('am2');
	assert.match(decide('git commit --amend -m x', { cwd: r, hook: join(r, '.claude/hooks/precommit-gate.sh') }), /ask/);
	const root = run('git commit --amend -m x', { cwd: r, hook: join(r, '.claude/hooks/precommit-gate.sh') });
	assert.match(root.permissionDecisionReason, /\.claude\/hooks\/precommit-gate\.sh/);
});

test('precommit-gate: an amend that deletes a path judges the deletion against the amend base', () => {
	const v = verdictRepo('am3');
	const A = 'luci-theme-footstrap/a.txt';
	const B = 'luci-theme-footstrap/b.txt';
	for (const f of [ A, B, 'luci-theme-footstrap/c.txt' ]) v.stage(f, `${f}0\n`);
	g(v.r, 'commit', '-q', '-m', 'base');
	v.stage(B, 'b1\n');
	g(v.r, 'commit', '-q', '-m', 'b1');
	// HEAD minus A still holds b1, which the amend rolls back to its parent's blob: that tree was never the combination
	g(v.r, 'rm', '-q', '--cached', A);
	const headMinusA = g(v.r, 'write-tree');
	g(v.r, 'reset', '-q');
	v.remove(A);
	v.stage(B, `${B}0\n`);
	const made = g(v.r, 'write-tree');
	v.card('1', pass(headMinusA));
	assert.equal(decision(v, 'git commit --amend -m x'), 'ask', 'the tree the amend does not make');
	v.card('1', pass(made));
	assert.equal(decision(v, 'git commit --amend -m x'), undefined, 'the tree the amend makes');
});

test('precommit-gate: a commit from a subdirectory runs the changelog check from the root', () => {
	const v = verdictRepo('sub1');
	v.stage('docs/x.md', 'x\n');
	assert.equal(decision(v, 'git commit -m x') ?? '', '');
	assert.equal(v.run('git commit -m x', join(v.r, 'docs')).permissionDecision, undefined);
	// the contract still bites from there: a staged file with no entry is the changelog deny, not a missing module
	const r = gateRepo('sub2');
	mkdirSync(join(r, 'docs'));
	const q = run('git commit -m x', { cwd: join(r, 'docs'), hook: join(r, '.claude/hooks/precommit-gate.sh') });
	assert.equal(q.permissionDecision, 'deny');
	assert.match(q.permissionDecisionReason, /Changelog contract/);
	assert.doesNotMatch(q.permissionDecisionReason, /MODULE_NOT_FOUND|changelog\.mjs failed/);
});

// ---- a crew role in the lead's checkout: what rewrites its worktree, index or config is denied, and only there ----
const ROLES = [ 'developer', 'tester', 'security', 'researcher', 'upstream-reviewer' ];
const roleDeny = [
	// a discard of paths, whatever sits before the `--`, and a cd into nowhere that stays put
	'git checkout -q -- .', 'git checkout -- f', 'git checkout .', 'git checkout HEAD -- a b', 'git checkout -f -- .', 'git checkout -- ./luci-theme-footstrap',
	'cd "" && git checkout -- .', 'cd -- "" && git checkout -- .', "cd '' && git restore .", 'git -c core.pager=cat checkout -- .',
	'git restore f', 'git restore .', 'git restore --staged f', 'git restore -S f', 'git restore --source HEAD~1 f', 'git restore --worktree --staged .',
	'git clean -fd', 'git clean -fdx', 'git clean -f',
	'git stash', 'git stash push -m x', 'git stash -u', 'git stash pop', 'git stash apply', 'git stash drop', 'git stash clear', 'git stash save x',
	'git reset', 'git reset --hard HEAD~1', 'git reset --soft HEAD~1', 'git reset --mixed', 'git reset HEAD f', 'git reset -q',
	'git add f', 'git add -A', 'git add .', 'git add -- f g', 'git rm f', 'git rm --cached f', 'git mv a b',
	'git remote add zz u', 'git remote remove zz', 'git remote rm zz', 'git remote rename a b', 'git remote set-url origin u', 'git remote set-url --add origin u', 'git remote set-head origin main',
	'git config user.name x', 'git config --global user.name x', 'git config --local a.b c', 'git config --unset user.name', 'git config --unset-all a.b', 'git config --add a.b c', 'git config --replace-all a.b c',
	'git config set a.b c', 'git config unset a.b', 'git config --edit', 'git config --file f a b', 'git config --type bool a.b true', 'git config --remove-section a', 'git config --rename-section a b',
	// behind a wrapper, a nested shell or a chain; the private index does not make a worktree verb safe
	'sh -c "git checkout -- ."', "bash -c 'git restore .'", 'true && git clean -fd', 'env FOO=1 git reset', 'timeout 5 git stash', 'tools/bg.sh git checkout -- .', 'echo x | xargs git restore',
	'GIT_INDEX_FILE=../tmp/task-x/round.idx git checkout -- .', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git restore .', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git rm f', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git mv a b',
	'GIT_INDEX_FILE= git add f',
	// a bare assignment is a shell variable: git never sees it and writes the real index
	'GIT_INDEX_FILE=../tmp/task-x/round.idx; git add -- f', 'GIT_INDEX_FILE=../tmp/task-x/round.idx; git read-tree HEAD', 'FOO=1; GIT_INDEX_FILE=x; git add f', 'foo GIT_INDEX_FILE=x git add f', 'GIT_INDEX_FILE=x && git add f',
	// a discard that is no `-- .`: a pathspec that cannot be a ref, a tree-ish and a path, a forced or patch checkout, a lone word that is no ref
	'git checkout ./', 'git checkout ./luci-theme-footstrap', 'git checkout :/', "git checkout ':(top)docs'", "git checkout '*'", 'git checkout .gitignore', 'git checkout HEAD f', 'git checkout HEAD~1 a b', 'git checkout f', 'git checkout nosuchbranch',
	'git checkout -f', 'git checkout -f HEAD', 'git checkout --force HEAD', 'git checkout -fq HEAD', 'git checkout -p', 'git checkout --patch HEAD f', 'git checkout --pathspec-from-file=list',
	'git switch --discard-changes HEAD', 'git switch -f HEAD', 'git switch --force HEAD', 'git switch -fq HEAD',
	'git checkout-index -f -a', 'git checkout-index -a', 'git checkout-index f',
	'git read-tree HEAD', 'git read-tree -u --reset HEAD', 'git read-tree --reset -u HEAD', 'git read-tree -m HEAD HEAD',
	// an empty -C operand stays put like cd ""
	'git -C "" checkout -- .', "git -C '' restore .", 'find . -name x -exec git checkout -- {} \\;', 'git -c alias.co=checkout co -- .', 'eval "git checkout -- ."', '(cd tests && git restore .)', 'sh -c \'cd "" && git checkout -- .\'',
];
const roleNone = [
	// reads
	'git status', 'git diff', 'git diff --cached', 'git log -3', 'git show HEAD', 'git ls-files', 'git rev-parse HEAD', 'git worktree list', 'git branch', 'git blame f',
	'git remote', 'git remote -v', 'git remote get-url origin', 'git remote show origin',
	'git stash list', 'git stash show -p', 'git stash create',
	'git config user.name', 'git config --get user.name', 'git config --get-regexp remote', 'git config -l', 'git config --list', 'git config --global --get user.name', 'git config get user.name', 'git config list',
	'git config --file f --get a.b', 'git config --type bool a.b', 'git config --show-origin --get a.b',
	// a dry run writes nothing
	'git clean -n', 'git clean -nfd', 'git clean -fdn', 'git clean --dry-run -fd', 'git add -n f', 'git add --dry-run .', 'git rm -n f', 'git mv -n a b', 'git read-tree --dry-run HEAD',
	// the round snapshot: a private index, and the verbs that only read the real one
	'GIT_INDEX_FILE=../tmp/task-x/round.idx git add -- f', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git add -A', 'env GIT_INDEX_FILE=../tmp/task-x/round.idx git add -- f',
	'export GIT_INDEX_FILE=../tmp/task-x/round.idx; git add -- f', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git rm --cached f', 'export GIT_INDEX_FILE=../tmp/task-x/round.idx; git read-tree HEAD',
	'timeout 5 env GIT_INDEX_FILE=../tmp/task-x/round.idx git add f', 'GIT_INDEX_FILE=../tmp/task-x/round.idx sudo git add f', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git read-tree -m HEAD HEAD',
	'GIT_INDEX_FILE=../tmp/task-x/round.idx git read-tree HEAD && GIT_INDEX_FILE=../tmp/task-x/round.idx git add -- a b && GIT_INDEX_FILE=../tmp/task-x/round.idx git write-tree',
	// not named by the rule: a branch switch, a commit, an unplaceable directory, a `--` with nothing after it, and words that are text
	'git checkout HEAD', 'git checkout -b x', 'git checkout -b x HEAD', 'git checkout -B x HEAD', 'git checkout --detach HEAD', 'git checkout -', 'git checkout HEAD --',
	'git switch x', 'git switch -c x', 'git switch -', 'git read-tree -n HEAD', 'git commit -m x', 'git checkout --', 'cd "$X" && git checkout -- .', 'cd nosuch && git restore .',
	'echo git checkout -- .', 'git commit -m "git restore ."', "cat <<'E'\ngit clean -fd\nE",
];
const asRole = (agent) => (c, cwd = ROOT) => decide(c, { cwd, agent });
for (const c of roleDeny) test(`role denied in the checkout: ${c}`, () => assert.equal(asRole('developer')(c), 'deny'));
for (const c of roleNone) test(`role silent in the checkout: ${c}`, () => assert.equal(asRole('developer')(c), ''));
for (const a of ROLES) test(`${a} is a role`, () => assert.equal(asRole(a)('git checkout -q -- .'), 'deny'));
// the lead has no agent_type; any other agent type is not a crew role
for (const a of [ undefined, '', 'general-purpose', 'Explore', 'Plan', 'developers' ]) {
	test(`agent_type ${JSON.stringify(a)} is left alone`, () => {
		for (const c of [ 'git checkout -q -- .', 'git restore --staged f', 'git clean -fd', 'git stash', 'git reset', 'git add f', 'git rm f', 'git remote add zz u', 'git config user.name x', 'cd "" && git checkout -- .',
			'git checkout HEAD f', 'git checkout f', 'git checkout -f', 'git checkout :/', 'git switch -f HEAD', 'git checkout-index -a', 'git read-tree HEAD', 'GIT_INDEX_FILE=x; git add f', 'git -C "" restore .' ]) assert.equal(asRole(a)(c), '', c);
	});
}
test('a role that also tags is denied, not asked; the lead is asked', () => {
	assert.equal(asRole('tester')('git tag v1 && git checkout -- .'), 'deny');
	assert.equal(asRole(undefined)('git tag v1 && git checkout -- .'), 'ask');
	assert.equal(asRole('tester')('git tag v1'), 'ask');
});
test('the reason names the checkout and the way out, and --kinds lists rolegit for a role only', () => {
	const r = run('git checkout -q -- .', { cwd: ROOT, agent: 'tester' });
	assert.equal(r.permissionDecision, 'deny');
	assert.ok(r.permissionDecisionReason.includes(realpathSync(ROOT)), r.permissionDecisionReason);
	assert.match(r.permissionDecisionReason, /scratch repo/);
	assert.match(r.permissionDecisionReason, /GIT_INDEX_FILE/);
	assert.match(r.permissionDecisionReason, /literally/);
	const kinds = (agent) => spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input: JSON.stringify({ cwd: ROOT, ...(agent && { agent_type: agent }), tool_input: { command: 'git checkout -- .' } }), encoding: 'utf8' }).stdout.trim();
	assert.equal(kinds('tester'), 'rolegit');
	assert.equal(kinds(), '');
});

// A scratch repo is nobody's: the directory the line resolves to (cd, -C, --git-dir, GIT_DIR, the hook's cwd) decides.
test('a role aimed at a scratch repo is silent, and aimed at the checkout from a scratch repo is denied', () => {
	const s = repo(join(dir, 'rolescratch'));
	const t = asRole('tester');
	for (const c of [ `git -C ${s} checkout -- .`, `cd ${s} && git restore .`, `cd ${s} && git clean -fd`, `git --git-dir=${s}/.git checkout -- .`, `GIT_DIR=${s}/.git git reset`, `cd ${s} && git add f`, `git -C ${s} remote add zz u`, `cd ${s} && git config a.b c`, `cd ${s} && git stash` ]) assert.equal(t(c), '', c);
	// GIT_DIR and GIT_INDEX_FILE reach git only as a prefix, behind env or exported; a bare assignment is a shell variable and git acts where it stands
	for (const c of [ `export GIT_DIR=${s}/.git; git checkout -- .`, `env GIT_DIR=${s}/.git git restore .`, `timeout 5 env GIT_DIR=${s}/.git git clean -fd` ]) assert.equal(t(c), '', c);
	for (const c of [ `GIT_DIR=${s}/.git; git checkout -- .`, `FOO=1; GIT_DIR=${s}/.git; git reset`, `GIT_DIR=${s}/.git && git restore .` ]) assert.equal(t(c), 'deny', c);
	assert.equal(t('git checkout -- .', s), '');
	assert.equal(t('git checkout nosuchbranch', s), '');
	assert.equal(t('git remote add zz u', s), '');
	assert.equal(t('cd sub/.. && git restore .', s), '');
	for (const c of [ `git -C ${ROOT} checkout -- .`, `cd ${ROOT} && git restore .`, `cd ${ROOT}/tests && git clean -fd`, `git -C ${ROOT}/docs reset`, `cd ${s} && cd ${ROOT} && git add f` ]) assert.equal(t(c, s), 'deny', c);
});

// The hook is the checkout it ships in: a copy of it inside a scratch repo makes that repo "this checkout", with a worktree of it beside.
test('worktree and index verbs are denied in the checkout and free in its worktree; config and remotes are shared', () => {
	const home = repo(join(dir, 'rolehome'));
	mkdirSync(join(home, '.claude/hooks'), { recursive: true });
	copyFileSync(HOOK, join(home, '.claude/hooks/git-guard.sh'));
	g(home, 'commit', '-q', '--allow-empty', '-m', 'a');
	const wt = join(dir, 'rolewt');
	g(home, 'worktree', 'add', '-q', wt);
	const hook = join(home, '.claude/hooks/git-guard.sh');
	const d = (c, cwd, agent = 'tester') => decide(c, { cwd, hook, agent });
	for (const c of [ 'git checkout -- .', 'git restore .', 'git clean -fd', 'git reset', 'git add f', 'git stash' ]) {
		assert.equal(d(c, home), 'deny', c);
		assert.equal(d(c, wt), '', `${c} in its worktree`);
		assert.equal(d(`git -C ${home} ${c.slice(4)}`, wt), 'deny', `${c} aimed at the checkout from the worktree`);
		assert.equal(d(`cd ${wt} && ${c}`, home), '', `${c} after a cd into the worktree`);
		assert.equal(d(`GIT_DIR=${home}/.git ${c}`, dir), 'deny', `${c} by GIT_DIR`);
		assert.equal(d(`git --git-dir=${home}/.git ${c.slice(4)}`, dir), 'deny', `${c} by --git-dir`);
		assert.equal(d(c, home, 'general-purpose'), '', `${c} for another agent type`);
	}
	for (const c of [ 'git remote add zz u', 'git remote set-url origin u', 'git config a.b c', 'git config --unset a.b' ]) {
		assert.equal(d(c, home), 'deny', c);
		assert.equal(d(c, wt), 'deny', `${c} in its worktree shares the config`);
		assert.equal(d(c, dir), '', `${c} in no repository`);
	}
	assert.equal(d('git status', wt), '');
	assert.equal(d('git config --get a.b', wt), '');
	// a lone word after checkout is a branch (a switch) or a path (a discard), told apart in the repository the line lands in
	g(home, 'branch', 'side');
	assert.equal(d('git checkout side', home), '');
	assert.equal(d('git checkout nosuchbranch', home), 'deny');
	assert.equal(d('git checkout side', home, 'general-purpose'), '');
	assert.equal(d('git checkout nosuchbranch', home, 'general-purpose'), '');
	assert.equal(d('git checkout nosuchbranch', wt), '');
	assert.equal(d(`git -C ${home} checkout nosuchbranch`, wt), 'deny');
	assert.equal(d(`git --git-dir=${home}/.git checkout side`, dir), '');
	assert.equal(d(`git --git-dir=${home}/.git checkout nosuchbranch`, dir), 'deny');
	assert.equal(d('git checkout side -- f', home), 'deny');
	assert.equal(d('git checkout -b other side', home), '');
});

// `cd ""` and `git -C ""` stay put: the directory a line resolves to is the one it started in, for a push too.
test('an empty cd or -C operand leaves the directory where it was', () => {
	const f = repo(join(dir, 'emptycd'), { origin: THEME, fork: 'git@github.com:VizzleTF/luci.git' });
	assert.equal(decide('cd "" && git push fork x', { cwd: f }), 'ask');
	assert.equal(decide('git -C "" push fork x', { cwd: f }), 'ask');
	assert.equal(decide('git -C "$X" push fork x', { cwd: f }), '');
	assert.equal(decide('cd "$X" && git push fork x', { cwd: f }), '');
});

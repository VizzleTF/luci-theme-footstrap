import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';
import { CLEAN } from './lib/git-env.mjs';

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
function run(command, { cwd = dir, hook = HOOK, env = CLEAN, timeout, agent } = {}) {
	const r = spawnSync('/bin/sh', [ hook ], { input: JSON.stringify({ cwd, ...(agent && { agent_type: agent }), tool_input: { command } }), encoding: 'utf8', env, timeout });
	assert.equal(r.status, 0, r.stderr);
	// every probe runs on a healthy PATH unless it simulates a missing tool, and a hook that runs on every Bash call must say nothing on stderr
	if (env === CLEAN) assert.equal(r.stderr, '', `stderr of ${command}`);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
}
const decide = (command, o) => run(command, o).permissionDecision || '';
// Real git only ever runs in a scratch repository under the tmp dir, never in this checkout.
const g = (cwd, ...a) => {
	assert.ok(!resolve(cwd).startsWith(ROOT), `scratch git must not run in the checkout: ${cwd}`);
	const r = spawnSync('git', [ '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a ], { cwd, encoding: 'utf8', env: CLEAN });
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
	// the substitution in the operand of cd, pushd and popd runs before the directory changes
	'popd "$(git tag v1)"', 'cd "$(git tag v1)"', 'pushd "$(git tag v1)" && true',
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
	// a global option that takes the next word as its value leaves the verb where it is, --attr-source and --shallow-file as --namespace and -C do
	'git --attr-source HEAD tag v1', 'git --shallow-file f tag v1', 'git --namespace n tag v1', 'git --attr-source HEAD push --tags', 'git --shallow-file f push --tags', 'git -C /r --attr-source HEAD tag v1', 'git --attr-source HEAD -c alias.t=tag t v1', 'git --attr-source=HEAD tag v1',
	'git push origin v0.14.17', 'git push --follow-tags', 'git push --tags', 'git push origin --tags', 'git push --mirror',
	'git push origin refs/tags/v1', 'git push origin :refs/tags/v1', 'git push origin HEAD:refs/tags/x', 'git push origin tag v1',
	'git config push.followTags true', 'git update-ref refs/tags/v1 HEAD', 'git update-ref -d refs/tags/v1',
	// an alias the env carries is resolved like one set by -c
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1', 'env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1', 'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag; git t v1',
	`GIT_CONFIG_PARAMETERS="'alias.t'='tag'" git t v1`, 'CI=tag git --config-env=alias.t=CI t v1', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0="push --tags" git p',
	// follow-tags set as config for one call carries every annotated tag just like the flag
	'git -c push.followTags=true push', 'git -c push.followTags push', 'git -cpush.followTags=yes push', 'git -c alias.p=push -c push.followTags=1 p',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=push.followTags GIT_CONFIG_VALUE_0=true git push',
	`GIT_CONFIG_PARAMETERS="'push.followTags'='true'" git push`,
	// every value an alias gets on the line is read, in no order and whatever the count says: a decoy of a read verb hides nothing
	"GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag GIT_CONFIG_KEY_1=alias.t GIT_CONFIG_VALUE_1=log git t v1", "GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=alias.t GIT_CONFIG_VALUE_1=log GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1", "GIT_CONFIG_COUNT=11 GIT_CONFIG_KEY_9=alias.t GIT_CONFIG_VALUE_9=tag GIT_CONFIG_KEY_10=alias.t GIT_CONFIG_VALUE_10=log git t v1", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag GIT_CONFIG_KEY_1=alias.t GIT_CONFIG_VALUE_1=log git t v1", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_00=alias.t GIT_CONFIG_VALUE_00=tag GIT_CONFIG_KEY_01=alias.t GIT_CONFIG_VALUE_01=log git t v1", "GIT_CONFIG_PARAMETERS=\"'alias.t'='tag'\" GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=log git t v1", "GIT_CONFIG_PARAMETERS=\"'alias.t'='log'\" GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1", "GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git -c alias.t=log t v1", "GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=log git -c alias.t=tag t v1",
	// a quote the shell would pass on as a backslash and a quote breaks the quoted read; the plain entry is still read
	"GIT_CONFIG_PARAMETERS=\"'user.name'='a\\'b' 'alias.t'='tag'\" git t v1",
	// the pairs of an alias, whichever way the line spells them and whichever awk runs it
	'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=log GIT_CONFIG_KEY_1=alias.t GIT_CONFIG_VALUE_1=tag git t v1', 'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=alias.t GIT_CONFIG_VALUE_1=tag GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=log git t v1',
	'GIT_CONFIG_COUNT=11 GIT_CONFIG_KEY_9=alias.t GIT_CONFIG_VALUE_9=log GIT_CONFIG_KEY_10=alias.t GIT_CONFIG_VALUE_10=tag git t v1',
	'GIT_CONFIG_COUNT=5 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=log GIT_CONFIG_KEY_1=alias.t GIT_CONFIG_VALUE_1=log GIT_CONFIG_KEY_2=alias.t GIT_CONFIG_VALUE_2=log GIT_CONFIG_KEY_3=alias.t GIT_CONFIG_VALUE_3=log GIT_CONFIG_KEY_4=alias.t GIT_CONFIG_VALUE_4=tag git t v1',
	// an expansion beside a quoted entry does not hide it
	"GIT_CONFIG_PARAMETERS=\"'alias.t'='tag'$(:)\" git t v1", "GIT_CONFIG_PARAMETERS=\"'alias.t'='tag'${X}\" git t v1", "GIT_CONFIG_PARAMETERS=\"'alias.t'='tag'`:`\" git t v1", "GIT_CONFIG_PARAMETERS=\"$X'alias.t'='tag'\" git t v1",
	// an expansion before or after an entry does not hide it, and a backslash before a quote stays in a double quote as the shell has it
	"GIT_CONFIG_PARAMETERS=\"${GIT_CONFIG_PARAMETERS:+$GIT_CONFIG_PARAMETERS }'alias.t'='tag'\" git t v1", "GIT_CONFIG_PARAMETERS=\"'user.name'='x' $X 'alias.t'='tag'\" git t v1", "GIT_CONFIG_PARAMETERS=\"'user.name'='it'\\''s' 'alias.t'='!git tag v1'\" git t", "GIT_CONFIG_PARAMETERS=\"'user.name'='it'\\''s' 'alias.t'='tag'\" git t v1",
	// the pairs of a nested text count whatever carries a count there
	"GIT_CONFIG_COUNT=1 sh -c 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'", "GIT_CONFIG_COUNT=1 bash -c 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'", "env GIT_CONFIG_COUNT=1 sh -c 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'",
	"export GIT_CONFIG_COUNT=1; sh -c 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'", "GIT_CONFIG_COUNT=1 eval 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'", "GIT_CONFIG_COUNT=1 xargs sh -c 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'",
	"GIT_CONFIG_COUNT=1 tools/bg.sh sh -c 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'", "sh -c 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1'",
	// GIT_CONFIG_COUNT is never read: every pair on the line counts, as at HEAD (the count can be spelled in ways the scan cannot follow); a quote inside a GIT_CONFIG_PARAMETERS value is '\'' and does not end the entry
	'GIT_CONFIG_COUNT=0 GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1', 'GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1', 'export GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag; git t v1',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x GIT_CONFIG_KEY_1=alias.t GIT_CONFIG_VALUE_1=tag git t v1', 'GIT_CONFIG_COUNT=$N GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1',
	String.raw`GIT_CONFIG_PARAMETERS="'alias.t'='!echo '\\''x'\\''; git tag v1'" git t`, String.raw`GIT_CONFIG_PARAMETERS="'user.name'='a'\\''b' 'alias.t'='tag'" git t v1`,
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
	'git --attr-source HEAD status', 'git --shallow-file f log', 'git --attr-source HEAD tag -l', 'git --attr-source HEAD push origin main',
	// an alias set where the scan cannot read it is no find for anyone but a role in the checkout
	'git --config-env=alias.t=T t v1', 'git -c help.autocorrect=1 comit', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ll GIT_CONFIG_VALUE_0=log git ll',
	// a quote inside a GIT_CONFIG_PARAMETERS value does not end it, and an entry never closed is unread
	String.raw`GIT_CONFIG_PARAMETERS="'alias.t'='!echo '\\''x'\\''; git log'" git t`, `GIT_CONFIG_PARAMETERS="'alias.t'='tag" git t v1`,
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
	const r = spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input: JSON.stringify({ cwd: c, tool_input: { command: 'sh top.sh' } }), encoding: 'utf8', timeout: 20000, env: CLEAN });
	assert.match(r.stdout, /script-scan-cap/);
});
// precommit-gate reads --kinds: a commit that hides behind a `<<` in a "…" token must still be seen as one
test('--kinds still lists the commit behind a << inside a quoted token', () => {
	const input = JSON.stringify({ cwd: dir, tool_input: { command: 'echo "$(true) <<X\n" ; git commit -m x ; echo "\nX\n"' } });
	assert.match(spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input, encoding: 'utf8', env: CLEAN }).stdout, /\bcommit\b/);
});
test('--kinds still lists the commit behind a backtick span that holds a <<', () => {
	const input = JSON.stringify({ cwd: dir, tool_input: { command: 'echo "`cat <<X\nfoo\n`"; git commit -m x #\nX\n`"' } });
	assert.match(spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input, encoding: 'utf8', env: CLEAN }).stdout, /\bcommit\b/);
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
		'git branch --forc main HEAD~1', 'git branch --del main', 'git branch --mov main old', 'git switch --force-c main origin/main',
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
	const env = { ...CLEAN, HOME: home };
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
		const r = spawnSync('/bin/sh', [ HOOK ], { input: JSON.stringify({ cwd: dir, tool_input: { command: c } }), encoding: 'utf8', env: CLEAN });
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

// The lead writes the cards into the main checkout's ../tmp; a hook run from a linked worktree must read them there.
test('precommit-gate verdict: a linked worktree reads the cards from the main checkout\'s ../tmp', () => {
	const v = verdictRepo('vw');
	const wt = join(dir, 'vw-wt');
	g(v.r, 'worktree', 'add', '-q', '--detach', wt);
	const PKG = 'luci-theme-footstrap/a.txt';
	mkdirSync(dirname(join(wt, PKG)), { recursive: true });
	writeFileSync(join(wt, PKG), 'one\n');
	for (const f of [ 'CHANGELOG.md', 'CHANGELOG_ru.md' ]) appendFileSync(join(wt, f), `- ${PKG}\n`);
	g(wt, 'add', PKG, 'CHANGELOG.md', 'CHANGELOG_ru.md');
	const at = { cwd: wt, hook: join(wt, '.claude/hooks/precommit-gate.sh') };
	assert.equal(run('git commit -m x', at).permissionDecision, 'ask', 'no card yet');
	// the hook sources nothing outside .claude/hooks: a tools/lib/tmp-root.sh that points at a forged PASS card changes nothing
	const forged = join(dir, 'vw-forged');
	mkdirSync(join(forged, 'task-9'), { recursive: true });
	writeFileSync(join(forged, 'task-9/card.json'), JSON.stringify({ id: '9', history: [ pass(g(wt, 'write-tree')) ] }));
	mkdirSync(join(wt, 'tools/lib'), { recursive: true });
	writeFileSync(join(wt, 'tools/lib/tmp-root.sh'), `tmp_root() { printf '%s\\n' ${JSON.stringify(forged)}; }\n`);
	assert.equal(run('git commit -m x', at).permissionDecision, 'ask', 'a helper a role can edit does not pick the cards');
	v.card('1', pass(g(wt, 'write-tree')));
	assert.equal(run('git commit -m x', at).permissionDecision, undefined, 'the card is in the main ../tmp');
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

// ---- a crew role in the lead's checkout: what moves HEAD or a ref, or rewrites its worktree, index or config, is denied, and only there ----
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
	// read-tree -u writes the worktree, which a private index does not make private (-m takes no value, so -mu and -um are the same flags)
	'GIT_INDEX_FILE=../tmp/task-x/round.idx git read-tree -u --reset HEAD', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git read-tree -mu HEAD', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git read-tree -um HEAD',
	'GIT_INDEX_FILE=../tmp/task-x/round.idx git read-tree -m -u HEAD', 'export GIT_INDEX_FILE=../tmp/task-x/round.idx; git read-tree -u HEAD', 'git read-tree -mu HEAD',
	// the real index or worktree by a verb the list had not named: write-tree and update-index are free only behind a private index
	'git write-tree', 'git write-tree --prefix=docs/', 'GIT_INDEX_FILE=x; git write-tree', 'git update-index --refresh', 'git update-index --add f', 'GIT_INDEX_FILE=x; git update-index --refresh',
	'git apply p.diff', 'git apply --index p.diff', 'git apply --cached p.diff', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git apply p.diff',
	'git pull', 'git pull --ff-only origin main', 'git pull --dry-run', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git pull', 'git revert HEAD', 'git revert --no-commit HEAD~2', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git revert HEAD',
	'git sparse-checkout set docs', 'git sparse-checkout init', 'git sparse-checkout disable', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git sparse-checkout set docs', 'sh -c "git write-tree"',
	// --apply makes the patch land whatever else is given; an unplaceable work tree does not hide the git dir the line stands in
	'git apply --check --apply p.diff', 'git apply --stat --apply p.diff', 'git apply --apply --check p.diff', 'git apply --numstat --app p.diff',
	'git --work-tree="$S" reset', 'GIT_WORK_TREE=$S git clean -fd', 'git --work-tree=$S checkout -- .', 'git -C docs --work-tree="$S" restore .', 'export GIT_WORK_TREE="$S"; git restore .', 'GIT_WORK_TREE="$S" git stash',
	// an empty -C operand stays put like cd ""
	'git -C "" checkout -- .', "git -C '' restore .", 'find . -name x -exec git checkout -- {} \\;', 'git -c alias.co=checkout co -- .', 'eval "git checkout -- ."', '(cd tests && git restore .)', 'sh -c \'cd "" && git checkout -- .\'',
	// HEAD moves and ref writes: a commit, a merge, a rebase, a pick, a patch mail, a bisect, a switch or checkout of a branch, whatever the form
	'git commit -m x', 'git commit -am x', 'git commit --amend --no-edit', 'git commit --allow-empty -m x', 'git commit -F msg', 'git commit -m "git restore ."', 'git commit -m "x --dry-run"',
	'git merge topic', 'git merge --abort', 'git merge --no-ff --no-commit topic', 'git rebase main', 'git rebase -i HEAD~3', 'git rebase --abort', 'git rebase --continue',
	'git cherry-pick abc', 'git cherry-pick --abort', 'git cherry-pick -n abc', 'git am x.patch', 'git am --abort',
	'git switch x', 'git switch -c x', 'git switch -C x', 'git switch -', 'git switch --detach HEAD', 'git switch --create x', 'git switch',
	'git checkout HEAD', 'git checkout side', 'git checkout HEAD~1', 'git checkout -b x', 'git checkout -b x HEAD', 'git checkout -B x HEAD', 'git checkout --orphan x', 'git checkout --detach', 'git checkout --detach HEAD',
	'git checkout -d', 'git checkout -qd HEAD', 'git checkout -', 'git checkout HEAD --', 'git checkout -t origin/x', 'git checkout --track origin/x',
	'git bisect', 'git bisect start', 'git bisect bad', 'git bisect good HEAD~5', 'git bisect reset', 'git bisect run sh t.sh', 'git bisect skip',
	'git update-ref refs/heads/x HEAD', 'git update-ref -d refs/heads/x', 'git update-ref HEAD HEAD~1', 'git update-ref --stdin',
	'git branch -f x HEAD', 'git branch --force x', 'git branch -d x', 'git branch -D x', 'git branch --delete x', 'git branch -m a b', 'git branch -M a b', 'git branch --move a b', 'git branch -fd x', 'git branch -r -d origin/x',
	'git branch -c a b', 'git branch -C a b', 'git branch --copy a b', 'git branch -u origin/x', 'git branch --set-upstream-to=origin/x', 'git branch --set-upstream-to origin/x x', 'git branch --unset-upstream', 'git branch --edit-description',
	// a private index is no private HEAD; a wrapper, a chain, a -C inside the checkout and an alias change nothing
	'GIT_INDEX_FILE=../tmp/task-x/round.idx git commit -m x', 'sh -c "git commit -m x"', 'true && git merge topic', 'env FOO=1 git switch x', 'tools/bg.sh git rebase main', 'git -C docs commit -m x', 'git -c user.name=a commit -m x',
	'git -c alias.ci=commit ci -m x', 'timeout 5 git cherry-pick abc', 'echo x | xargs git branch -D', 'cd docs && git update-ref refs/heads/x HEAD',
	// a symbolic ref written or deleted (HEAD moves with it), a reflog expired or deleted (the recovery data goes)
	'git symbolic-ref HEAD refs/heads/x', 'git symbolic-ref -m msg HEAD refs/heads/x', 'git symbolic-ref -q HEAD refs/heads/x', 'git symbolic-ref -d HEAD', 'git symbolic-ref --delete HEAD', 'git symbolic-ref -qd HEAD',
	'git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main', 'git symbolic-ref -d refs/remotes/origin/HEAD', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git symbolic-ref HEAD refs/heads/x', 'sh -c "git symbolic-ref HEAD refs/heads/x"',
	'git reflog expire --all', 'git reflog expire --expire=now --all', 'git reflog expire --expire-unreachable=now refs/heads/main', 'git reflog delete HEAD@{1}', 'git reflog delete --rewrite HEAD@{2}', 'git reflog drop --all',
	'cd docs && git reflog expire --all', 'env FOO=1 git reflog delete HEAD@{1}',
	// git takes any unique prefix of a long option: the flags above, abbreviated (a prefix that fits two options is an error in git, so reading it as this one is only stricter)
	'git checkout --det', 'git checkout --detac HEAD', 'git checkout --orph x', 'git checkout --orph=x', 'git checkout --forc', 'git checkout --discard', 'git checkout --pat', 'git checkout --pathspec-from=list', 'git switch --force-c x',
	'git branch --del x', 'git branch --dele x', 'git branch --mov a b', 'git branch --cop a b', 'git branch --forc x', 'git branch --unset-up', 'git branch --edit-desc', 'git branch --set-up=origin/x', 'git branch --set-upstream-t origin/x',
	'git symbolic-ref --del HEAD',
	// the last of --dry-run and --no-dry-run wins, and so do --check and --no-check
	'git commit --dry-run --no-dry-run', 'git commit --dry-run --no-dry', 'git commit --dry-run --no-dry-run -m x', 'git commit -m x --dry-run --no-dry-run', 'git add -n --no-dry-run f', 'git clean --dry-run --no-dry-run -f',
	'git apply --check --no-check p.diff', 'git apply --stat --no-stat p.diff', 'git apply --check --no-chec p.diff',
	// the read form of rebase and am is the flag alone: a value of an option may be spelled like it, and a patch given beside it is applied
	'git am --directory x --show-current-patch p.patch', 'git am --directory --show-current-patch p.patch', 'git am --dir --show-current-patch p.patch', 'git am -p 1 --show-current-patch', 'git am --empty drop --show-current-patch p.patch',
	'git am --show-current-patch p.patch', 'git rebase --exec --show-current-patch main', 'git rebase -x --show-current-patch main', 'git rebase --show-current-patch main', 'git rebase --onto --show-current-patch main',
	// fetch -u lets a fetch into the checked-out branch through, in whichever worktree holds it
	'git fetch -u . +side:main', 'git fetch --update-head-ok . side:main', 'git fetch --update-head origin', 'git fetch --update-h', 'git fetch -qu', 'git fetch origin -u', 'git -C docs fetch -u . +side:main',
	// worktree add -f gives a second worktree a branch another one holds, -B resets a shared branch
	'git worktree add -f ../tmp/x main', 'git worktree add --force ../tmp/x main', 'git worktree add --for ../tmp/x main', 'git worktree add -B main ../tmp/x', 'git worktree add -fB x ../tmp/x', 'git worktree add -b red -f ../tmp/x HEAD',
	'git -C docs worktree add -f ../x main', 'cd docs && git worktree add --force ../x main',
	// gc and prune with a date, a gc expiry on the line for any verb: what the reflog still names goes
	'git gc --prune=now', 'git gc --prune', 'git gc --prune=1.hour.ago', 'git gc --pru=now', 'git gc --aggressive --prune=now', 'git prune', 'git prune --expire now', 'git prune --expire=now',
	'git -c gc.reflogExpire=now gc', 'git -c gc.reflogExpireUnreachable=now gc', 'git -c gc.pruneExpire=now gc', 'git -c gc.refs/heads/main.reflogExpire=now gc', 'git -cgc.reflogexpire=now gc',
	'git -c gc.reflogExpire=now fetch', 'git -c gc.auto=1 -c gc.pruneExpire=now fetch origin', 'git -c gc.pruneExpire=now status',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=gc.reflogExpire GIT_CONFIG_VALUE_0=now git gc', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=gc.pruneExpire GIT_CONFIG_VALUE_0=now git fetch', 'git --config-env=gc.pruneExpire=EXP gc',
	// an alias or autocorrect the hook cannot read is no read verb: the env a line sets, --config-env, help.autocorrect with a verb git does not know
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x', 'env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x',
	'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit; git ci -m x', 'export GIT_CONFIG_COUNT=1; export GIT_CONFIG_KEY_0=alias.ci; export GIT_CONFIG_VALUE_0="!git commit -am"; git ci x',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.co GIT_CONFIG_VALUE_0=checkout git co -- .', 'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=commit git ci -m x',
	`GIT_CONFIG_PARAMETERS="'alias.ci'='commit'" git ci -m x`, `GIT_CONFIG_PARAMETERS="'alias.ci=commit'" git ci -m x`, `GIT_CONFIG_PARAMETERS="'user.name'='x' 'alias.ci'='commit -m y'" git ci`, `export GIT_CONFIG_PARAMETERS="'alias.ci'='commit'"; git ci -m x`,
	'git --config-env=alias.ci=CI ci -m x', 'git --config-env alias.ci=CI ci -m x', 'CI=commit git --config-env=alias.ci=CI ci -m x', 'env CI=switch git --config-env alias.ci=CI ci x', 'git --config-env=alias.sh=SH sh',
	'git -c help.autocorrect=immediate comit -m x', 'git -c help.autocorrect=1 comit', 'git -c help.autocorrect=prompt chekout x', 'git -chelp.autocorrect=20 comit', 'git -c help.autocorrect comit', 'git -c help.autocorrect=true switch2 x',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=help.autocorrect GIT_CONFIG_VALUE_0=1 git comit -m x', 'git --config-env=help.autocorrect=AC comit', 'export CI=commit; git --config-env=alias.ci=CI ci -m x',
	// the verb is the line's own words: quotes and a backslash in it must not break the reason that names it
	"git -c help.autocorrect=1 'co\"m\\mit' x", `git --config-env='alias.a"b=CI' 'a"b' x`,
	// checkout -B and switch -C reset a branch another worktree may hold
	'git checkout -B x', 'git switch -C x', 'git switch --force-create x',
	// --ignore-other-worktrees lets a checkout or switch take a branch another worktree holds, so a commit after it moves that branch
	'git checkout --ignore-other-worktrees main', 'git switch --ignore-other-worktrees main', 'git checkout --ignore main', 'git switch --ignore-o main', 'git checkout --ignore-other-worktrees -b x main', 'git switch --ignore-other-worktrees -c x main',
	// a push whose receive-pack program names receive.denyCurrentBranch lifts git's refusal of the checked-out branch (-c and the env do not reach a local receive-pack); any push to a repository of this checkout writes its refs
	"git push --receive-pack='git -c receive.denyCurrentBranch=ignore receive-pack' . +side:main", 'git push --receive-pack "git -c receive.denyCurrentBranch=updateInstead receive-pack" . side:main', "git push --exec='git -c receive.denyCurrentBranch=ignore receive-pack' . side:main",
	"git push --rece 'git -c receive.denyCurrentBranch=ignore receive-pack' . +side:main", "git push --exe 'git -c receive.denyCurrentBranch=ignore receive-pack' . side:main", "git push --receive-pack='git -c receive.denyCurrentBranch=ignore receive-pack' \"$X\" +side:main",
	'git push . x:y', 'git push . +side:main', 'git push --force . side:main', 'git push -u . x:y', 'git push --repo . x:y', 'git push --repo=. x:y', 'git push --rep=. x:y', 'git -c receive.denyCurrentBranch=ignore push . side:main', 'sh -c "git push . x:y"',
	'cd docs && git push . x:y', 'git -C docs push . x:y', `git -C docs push ../${basename(ROOT)} x:y`, `cd docs && git push ../${basename(ROOT)} x:y`, `git push ${ROOT} x:y`, `git push ${ROOT}/ x:y`, `git push ${ROOT}/.git x:y`, `git push file://${ROOT} x:y`, `git push ${ROOT}/docs x:y`, `git push --repo=${ROOT} x:y`,
	// GIT_CONFIG_COUNT is never read: every pair on the line counts, as at HEAD
	'GIT_CONFIG_COUNT=0 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x', 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=commit git ci -m x',
	'GIT_CONFIG_COUNT=0 GIT_CONFIG_KEY_0=gc.pruneExpire GIT_CONFIG_VALUE_0=now git gc', 'GIT_CONFIG_KEY_0=gc.pruneExpire GIT_CONFIG_VALUE_0=now git gc', 'export GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit; git ci -m x',
	// any alias set on the line, by any channel, is a find for a role whatever it holds or how many values it has: nothing is resolved, so a decoy hides nothing
	"GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ll GIT_CONFIG_VALUE_0=log git ll", "git -c alias.ll=log ll", "git -c alias.ll=log status", "git -c alias.ll=log -c help.autocorrect=1 ll", "CI=log git --config-env=alias.ll=CI ll", "git --config-env=alias.ci=CI status", "GIT_CONFIG_PARAMETERS=\"'alias.ll'='log'\" git ll", "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ll GIT_CONFIG_VALUE_0=status; git ll", "GIT_CONFIG_PARAMETERS=\"'alias.ll'='!echo '\\\\''x'\\\\''; git log'\" git ll", "GIT_CONFIG_PARAMETERS=\"'alias.ll'='log'\" git status",
	"GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=log git ci", "GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=log GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci", "GIT_CONFIG_COUNT=11 GIT_CONFIG_KEY_9=alias.ci GIT_CONFIG_VALUE_9=commit GIT_CONFIG_KEY_10=alias.ci GIT_CONFIG_VALUE_10=log git ci", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=log git ci -m x", "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_00=alias.ci GIT_CONFIG_VALUE_00=commit GIT_CONFIG_KEY_01=alias.ci GIT_CONFIG_VALUE_01=log git ci -m x", "GIT_CONFIG_PARAMETERS=\"'alias.ci'='commit'\" GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=log git ci -m x", "GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git -c alias.ci=log ci -m x",
	// a relative push path is read from the work tree root when the line stands inside a work tree (the one --work-tree or GIT_WORK_TREE names, else the toplevel), from the line's directory when --git-dir or GIT_DIR names no work tree
	`cd docs && GIT_DIR=${ROOT}/.git git push .. x:y`, `git -C docs --git-dir=${ROOT}/.git push .. x:y`,
	`git -C docs --work-tree=${ROOT} push .git x:y`, `cd docs && GIT_WORK_TREE=${ROOT} git push .git x:y`, `cd docs && git --git-dir=${ROOT}/.git --work-tree=${ROOT} push .git x:y`,
	// a global option that takes the next word as its value leaves the verb where it is: --attr-source and --shallow-file as --namespace and -C do
	'git --attr-source HEAD commit -m x', 'git --shallow-file f commit -m x', 'git --namespace n commit -m x', 'git --attr-source HEAD checkout -- .', 'git --shallow-file f restore .', 'git -c user.name=a --attr-source HEAD commit -m x', 'git --attr-source HEAD --shallow-file f reset',
	'git --attr-source=HEAD commit -m x', 'git --attr-source HEAD push . x:y', 'git --shallow-file f branch -D x', 'git -C docs --attr-source HEAD switch x', 'sh -c "git --attr-source HEAD commit -m x"',
	// every value of a key counts, whichever way the line spells them and whichever awk runs it
	'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=log GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=commit git ci -m x', 'GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=commit GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=log git ci -m x',
	'GIT_CONFIG_COUNT=11 GIT_CONFIG_KEY_9=alias.ci GIT_CONFIG_VALUE_9=log GIT_CONFIG_KEY_10=alias.ci GIT_CONFIG_VALUE_10=commit git ci -m x',
	'GIT_CONFIG_COUNT=5 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=log GIT_CONFIG_KEY_1=alias.ci GIT_CONFIG_VALUE_1=log GIT_CONFIG_KEY_2=alias.ci GIT_CONFIG_VALUE_2=log GIT_CONFIG_KEY_3=alias.ci GIT_CONFIG_VALUE_3=log GIT_CONFIG_KEY_4=alias.ci GIT_CONFIG_VALUE_4=commit git ci -m x',
	'GIT_CONFIG_COUNT=$N GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x',
	// GIT_CONFIG_PARAMETERS is read as the shell reads its single quotes: a quote inside a value is '\'' and does not end the entry, and an entry never closed is unread
	String.raw`GIT_CONFIG_PARAMETERS="'alias.ci'='!echo '\\''x'\\''; git commit -m y'" git ci`, String.raw`GIT_CONFIG_PARAMETERS="'user.name'='a'\\''b' 'alias.ci'='commit'" git ci -m x`, `GIT_CONFIG_PARAMETERS="'alias.ci'='commit" git ci -m x`,
	// an expansion beside a quoted entry does not hide it, and an alias entry that is not quoted or sits beside an expansion is unread
	"GIT_CONFIG_PARAMETERS=\"'alias.ci'='commit'$(:)\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'alias.ci'='commit'${X}\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'alias.ci'='commit'`:`\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"$X'alias.ci'='commit'\" git ci -m x",
	"GIT_CONFIG_PARAMETERS=\"'alias.ci'=commit\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"alias.ci='commit'\" git ci -m x", "GIT_CONFIG_PARAMETERS='alias.ci=commit' git ci -m x", "git -c include.path=/tmp/a.cfg ci -m x",
	// an expansion before or after an entry does not hide it, a backslash before a quote stays in a double quote as the shell has it, and a push option takes its value
	"GIT_CONFIG_PARAMETERS=\"$X'alias.ci'='commit'\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"${GIT_CONFIG_PARAMETERS:+$GIT_CONFIG_PARAMETERS }'alias.ci'='commit'\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'user.name'='x' $X 'alias.ci'='commit'\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"$X'gc.pruneExpire'='now'\" git gc", "GIT_CONFIG_PARAMETERS=\"'gc.pruneExpire'='now'$(:)\" git gc", "GIT_CONFIG_PARAMETERS=\"'user.name'='it'\\''s' 'alias.ci'='!git commit -m x'\" git ci", "git push --recurse-submodules check . x:y", "git push --recurse-submodules=check . x:y", "git push --recurse-sub on-demand . x:y", "git push --dry-run --no-dry-run . x:y", "git push -o --dry-run . x:y",
	// any alias in GIT_CONFIG_PARAMETERS is a find for a role, an unquoted expansion beside the entries included: nothing is resolved
	"GIT_CONFIG_PARAMETERS=\"'alias.t'='tag' $X\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"$X 'alias.t'='tag'\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'alias.t'='tag' $(:)\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'alias.t'='tag' ${X}\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'alias.t'='tag' `:`\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'user.name'='x'$X'alias.t'='tag'\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"'alias.ci'='log' $X\" git ci -m x", "GIT_CONFIG_PARAMETERS=\"$X'alias.ci'='log'\" git ci -m x",
	// the pairs of a nested text count whatever carries a count there
	"GIT_CONFIG_COUNT=1 sh -c 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'", "GIT_CONFIG_COUNT=1 bash -c 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'", "env GIT_CONFIG_COUNT=1 sh -c 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'",
	"export GIT_CONFIG_COUNT=1; sh -c 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'", "GIT_CONFIG_COUNT=1 eval 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'", "GIT_CONFIG_COUNT=1 xargs sh -c 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'",
	"GIT_CONFIG_COUNT=1 tools/bg.sh sh -c 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'", "sh -c 'GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x'",
	// a value-taking option of commit eats the next word, so a --dry-run there is no dry run (any unique prefix of the long ones)
	'git commit --mes --dry-run', 'git commit --mess --dry-run', 'git commit --message --dry-run', 'git commit -m t --trailer --dry-run', 'git commit --trailer --dry-run', 'git commit --tr --dry-run', 'git commit --author --dry-run', 'git commit --date --dry-run', 'git commit --cleanup --dry-run',
	'git commit -F --dry-run', 'git commit --file --dry-run', 'git commit --fi --dry-run', 'git commit -c --dry-run', 'git commit -C --dry-run', 'git commit --reedit-message --dry-run', 'git commit --reuse-m --dry-run HEAD', 'git commit -t --dry-run', 'git commit --template --dry-run', 'git commit --templ --dry-run',
	'git commit --fixup --dry-run', 'git commit --squash --dry-run', 'git commit --pathspec-from-file --dry-run', 'git commit -am --dry-run', 'git commit -qt --dry-run', 'git commit -m t --author --dry-run', 'git commit --amend --mes --dry-run',
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
	'GIT_INDEX_FILE=../tmp/task-x/round.idx git write-tree', 'export GIT_INDEX_FILE=../tmp/task-x/round.idx; git write-tree', 'env GIT_INDEX_FILE=../tmp/task-x/round.idx git write-tree', 'GIT_INDEX_FILE=../tmp/task-x/round.idx git update-index --add f',
	'git apply --check p.diff', 'git apply --stat p.diff', 'git apply --numstat p.diff', 'git apply --summary p.diff', 'git apply --check --index p.diff', 'git sparse-checkout list', 'git read-tree -n -u HEAD', 'git read-tree -nu HEAD', 'git read-tree --dry-run -mu HEAD',
	// a checkout with no word and no branch flag, an unplaceable directory, a `--` with nothing after it, and words that are text
	'git read-tree -n HEAD', 'git checkout', 'git checkout -q', 'git checkout --', 'cd "$X" && git checkout -- .', 'cd nosuch && git restore .',
	'echo git checkout -- .', 'git log --grep "git restore ."', "cat <<'E'\ngit clean -fd\nE",
	// the reads next to the HEAD and ref writes: a dry run, a base, a cherry, a patch shown, a bisect log, a branch list or a new name, a worktree of the checkout
	'git commit --dry-run', 'git commit --dry-run --short', 'git commit-graph verify', 'git commit-tree HEAD^{tree} -m x', 'git merge-base HEAD main', 'git merge-base --is-ancestor a b', 'git cherry -v',
	'git am --show-current-patch', 'git bisect log', 'git bisect view', 'git bisect visualize',
	'git branch -a', 'git branch -r', 'git branch -vv', 'git branch -l', 'git branch --list "x*"', 'git branch --show-current', 'git branch --contains abc', 'git branch --merged main', 'git branch --sort=-committerdate', 'git branch x', 'git branch x HEAD~1',
	'git worktree add ../tmp/task-x/wt HEAD', 'git worktree add -b red ../tmp/task-x/wt HEAD', 'git worktree add --detach ../tmp/task-x/wt HEAD', 'git show-ref', 'git for-each-ref', 'git rev-list --count HEAD',
	'git symbolic-ref HEAD', 'git symbolic-ref --short HEAD', 'git symbolic-ref -q HEAD', 'git symbolic-ref --short -q HEAD', 'git symbolic-ref --no-recurse HEAD', 'git symbolic-ref refs/remotes/origin/HEAD',
	'git reflog', 'git reflog show', 'git reflog show --all', 'git reflog HEAD', 'git reflog -n 5', 'git reflog exists refs/heads/main',
	// named in the header as not touched: they write no HEAD, index or work tree, and git refuses the checked-out branch
	'git fetch origin main:other', 'git replace a b', 'git notes add -m x',
	// abbreviated reads are no write, the pass flag last wins, and the read form of rebase and am is the flag alone
	'git branch --cont abc', 'git branch --merg main', 'git branch --sho', 'git branch --form=x', 'git branch --sort=x', 'git symbolic-ref --sho HEAD', 'git checkout --', 'git checkout --quiet',
	'git commit --no-dry-run --dry-run', 'git commit --dry-run --short', 'git add --no-dry-run --dry-run f', 'git add --dry-run f', 'git apply --no-check --check p.diff', 'git apply --check --stat p.diff',
	'git am --show-current-patch=raw',
	// fetch with no -u, a worktree for a red proof, gc and prune left to their defaults or a dry run, a config that is no expiry
	'git fetch', 'git fetch origin', 'git fetch --all', 'git fetch --prune', 'git fetch -p', 'git fetch -j 4 origin', 'git fetch --update-shallow origin', 'git fetch --unshallow', 'git fetch -q --tags',
	'git worktree add ../tmp/red-x HEAD', 'git worktree add -b red ../tmp/red-x HEAD', 'git worktree add --detach ../tmp/red-x HEAD', 'git worktree add --lock ../tmp/red-x HEAD', 'git worktree remove ../tmp/red-x', 'git worktree remove -f ../tmp/red-x', 'git worktree prune', 'git worktree list',
	'git gc', 'git gc --auto', 'git gc --aggressive', 'git gc --no-prune', 'git gc --quiet', 'git prune -n', 'git prune --dry-run', 'git -c gc.auto=0 status', 'git -c gc.autoDetach=false gc',
	// a config key that is no alias, and an autocorrect that is off or has no unknown verb to act on
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x git status', 'git --config-env=user.name=NAME status',
	'git comit -m x',
	'git -c help.autocorrect=never comit', 'git -c help.autocorrect=0 comit', 'git -c help.autocorrect=show comit', 'git -c help.autocorrect= comit', 'git -c help.autocorrect=false comit', 'git -c help.autocorrect=1 status', 'git -c help.autocorrect=immediate log',
	'git lfs ls-files',
	// a dry run of a push writes nothing
	"git push --dry-run . x:y", "git push -n . x:y", "git push --no-dry-run --dry-run . x:y", "git push --dry-run --receive-pack='git -c receive.denyCurrentBranch=ignore receive-pack' . side:main",
	// the reads behind a global option that takes the next word as its value stay reads
	'git --attr-source HEAD status', 'git --shallow-file f log', 'git --attr-source HEAD commit --dry-run', 'git --attr-source HEAD branch -a', 'git --namespace n diff', 'git -c user.name=a --attr-source HEAD show',
	// a commit stays a dry run when the flag is no value of an option: it comes first, or follows an option that takes its value only attached (-S, -u)
	'git commit -m x --dry-run', 'git commit --dry-run -m x', 'git commit --dry-run --mes x', 'git commit --dry-run --trailer "a: b"', 'git commit --author="A <a@b>" --dry-run', 'git commit -mx --dry-run', 'git commit -am x --dry-run',
	'git commit -S --dry-run', 'git commit --gpg-sign --dry-run', 'git commit -u --dry-run', 'git commit --untracked-files --dry-run', 'git commit --dry-run -m --dry-run', 'git commit --message=--dry-run --dry-run',
];
const asRole = (agent) => (c, cwd = ROOT) => decide(c, { cwd, agent });
for (const c of roleDeny) test(`role denied in the checkout: ${c}`, () => assert.equal(asRole('developer')(c), 'deny'));
for (const c of roleNone) test(`role silent in the checkout: ${c}`, () => assert.equal(asRole('developer')(c), ''));
// GIT_CONFIG_COUNT is never read, so no spelling of it (and none at all) hides a pair from the scan
test('no spelling of GIT_CONFIG_COUNT hides a pair: the lead is asked and a role denied, as at HEAD', () => {
	const forms = [ '', 'GIT_CONFIG_COUNT=0 ', 'GIT_CONFIG_COUNT=99 ', 'GIT_CONFIG_COUNT=$((1)) ', 'GIT_CONFIG_COUNT=$(echo 1) ', 'GIT_CONFIG_COUNT=`echo 1` ', 'GIT_CONFIG_COUNT=$X ', 'GIT_CONFIG_COUNT="$X" ' ];
	const wraps = [ (x) => x, (x) => `env ${x}`, (x) => `sh -c '${x}'`, (x) => `eval '${x}'`, (x) => `X=1; export X; ${x}`, (x) => `f() { ${x}; }; f` ];
	for (const f of forms) for (const w of wraps) {
		const tag = w(`${f}GIT_CONFIG_KEY_0=alias.t GIT_CONFIG_VALUE_0=tag git t v1`), ci = w(`${f}GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x`);
		assert.equal(decide(tag), 'ask', tag);
		assert.equal(asRole('developer')(ci), 'deny', ci);
	}
});
// The kinds the hook lists for a line, as the agent type and the directory ask for them; the push state of this checkout never enters a kind
const kindsOf = (command, agent, cwd = ROOT, hook = HOOK) => spawnSync('/bin/sh', [ hook, '--kinds' ], { input: JSON.stringify({ cwd, ...(agent && { agent_type: agent }), tool_input: { command } }), encoding: 'utf8', env: CLEAN }).stdout.trim().split(' ').filter(Boolean);
// `rebase --show-current-patch` is a read: no role find and no histcheck, which asks on any rebase while HEAD is in origin/main, so the answer would depend on the push state of the checkout the test runs in
test('rebase --show-current-patch is no role find and no histcheck, whatever the push state of this checkout', () => {
	for (const c of [ 'git rebase --show-current-patch', 'git rebase --show-current-patch=diff', 'git -C docs rebase --show-current-patch', 'sh -c "git rebase --show-current-patch"' ]) {
		for (const agent of [ 'developer', undefined ]) {
			assert.deepEqual(kindsOf(c, agent).filter((k) => k !== 'rebase'), [], c);
			assert.equal(decide(c, { cwd: ROOT, agent }), '', c);
		}
	}
	// a rebase, or the flag with another word beside it, still asks while HEAD is pushed
	for (const c of [ 'git rebase main', 'git rebase --continue', 'git rebase --show-current-patch main', 'git rebase --exec --show-current-patch main' ]) assert.ok(kindsOf(c).includes('histcheck'), c);
});
for (const a of ROLES) test(`${a} is a role`, () => assert.equal(asRole(a)('git checkout -q -- .'), 'deny'));
// the lead has no agent_type; any other agent type is not a crew role
for (const a of [ undefined, '', 'general-purpose', 'Explore', 'Plan', 'developers' ]) {
	test(`agent_type ${JSON.stringify(a)} is left alone`, () => {
		for (const c of [ 'git checkout -q -- .', 'git restore --staged f', 'git clean -fd', 'git stash', 'git reset', 'git add f', 'git rm f', 'git remote add zz u', 'git config user.name x', 'cd "" && git checkout -- .',
			'git checkout HEAD f', 'git checkout f', 'git checkout -f', 'git checkout :/', 'git switch -f HEAD', 'git checkout-index -a', 'git read-tree HEAD', 'GIT_INDEX_FILE=x; git add f', 'git -C "" restore .',
			'git write-tree', 'git update-index --refresh', 'git apply p.diff', 'git pull', 'git revert HEAD', 'git sparse-checkout set docs', 'GIT_INDEX_FILE=x git read-tree -mu HEAD', '(cd /tmp && git status); git restore .', 'cd /tmp && git status; cd -; git restore .',
				'git commit -m x', 'git merge topic', 'git cherry-pick abc', 'git switch x', 'git switch -c x', 'git checkout side', 'git checkout -b x', 'git checkout --detach', 'git checkout -', 'git bisect start', 'git update-ref refs/heads/x HEAD', 'git branch -D x', 'git branch -m a b', 'git branch -u origin/x', 'git branch --edit-description',
				'git symbolic-ref HEAD refs/heads/x', 'git symbolic-ref -d HEAD', 'git reflog expire --all', 'git reflog delete HEAD@{1}',
				'git fetch -u . +side:main', 'git worktree add -f ../x main', 'git worktree add -B x ../x', 'git gc --prune=now', 'git prune', 'git -c gc.reflogExpire=now gc', 'git checkout -B x', 'git switch -C x', 'git commit --dry-run --no-dry-run', 'git commit --mes --dry-run', 'git checkout --ignore-other-worktrees main', 'git push . x:y', 'git -c include.path=/tmp/a.cfg ci -m x',
				'git -c help.autocorrect=1 comit', 'git --config-env=alias.ci=CI ci -m x', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=gc.pruneExpire GIT_CONFIG_VALUE_0=now git gc', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x' ]) assert.equal(asRole(a)(c), '', c);
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
	assert.match(run('git commit -m x', { cwd: ROOT, agent: 'tester' }).permissionDecisionReason, /^git commit in .* HEAD, the branches/);
	const kinds = (agent, command = 'git checkout -- .') => spawnSync('/bin/sh', [ HOOK, '--kinds' ], { input: JSON.stringify({ cwd: ROOT, ...(agent && { agent_type: agent }), tool_input: { command } }), encoding: 'utf8', env: CLEAN }).stdout.trim();
	assert.equal(kinds('tester'), 'rolegit');
	assert.equal(kinds(), '');
	// precommit-gate shares this detection: a role's commit is still listed as one
	assert.deepEqual(kinds('tester', 'git commit -m x').split(' ').sort(), [ 'commit', 'rolegit' ]);
	assert.equal(kinds(undefined, 'git commit -m x'), 'commit');
});

// The text every role is handed names what the rule denies: a verb the hook gained and the roles are not told is one they learn by a denial
test('the role text in subagent-start.sh names every verb the role rule denies', () => {
	const r = spawnSync('/bin/sh', [ join(ROOT, '.claude/hooks/subagent-start.sh') ], { encoding: 'utf8', env: CLEAN });
	assert.equal(r.status, 0, r.stderr);
	const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
	for (const v of [ 'commit', 'merge', 'rebase', 'cherry-pick', 'am', 'switch', 'checkout', 'bisect', 'update-ref', 'symbolic-ref', 'reflog', 'branch', 'restore', 'clean', 'reset', 'stash', 'checkout-index',
		'read-tree', 'add', 'rm', 'mv', 'write-tree', 'update-index', 'apply', 'pull', 'revert', 'sparse-checkout', 'remote', 'config', 'fetch', 'worktree', 'gc', 'prune', 'push' ]) assert.match(text, new RegExp(`(^|[ ,(])${v}([ ,)]|$)`, 'm'), v);
	// an alias set inline is denied whatever it holds, so a role is not told only an unreadable one is
	assert.match(text, /Any alias set inline on a git line in the checkout/);
});

// A scratch repo is nobody's: the directory the line resolves to (cd, -C, --git-dir, GIT_DIR, the hook's cwd) decides.
test('a role aimed at a scratch repo is silent, and aimed at the checkout from a scratch repo is denied', () => {
	const s = repo(join(dir, 'rolescratch'));
	const t = asRole('tester');
	// the directory the line stands in, or the work tree it names, is the scratch repo
	for (const c of [ `git -C ${s} checkout -- .`, `cd ${s} && git restore .`, `cd ${s} && git clean -fd`, `cd ${s} && git add f`, `git -C ${s} remote add zz u`, `cd ${s} && git config a.b c`, `cd ${s} && git stash`, `git -C ${s} --git-dir=.git checkout -- .`,
		`git --git-dir=${s}/.git --work-tree=${s} checkout -- .`, `git --git-dir=${s}/.git --work-tree=${s} restore .`, `GIT_DIR=${s}/.git GIT_WORK_TREE=${s} git reset`, `export GIT_DIR=${s}/.git GIT_WORK_TREE=${s}; git clean -fd`, `env GIT_DIR=${s}/.git GIT_WORK_TREE=${s} git restore .`,
		`git --git-dir=${s}/.git remote add zz u`, `GIT_DIR=${s}/.git git config a.b c`,
			`cd ${s} && git commit -m x`, `git -C ${s} switch x`, `cd ${s} && git merge x`, `cd ${s} && git checkout -b x`, `git -C ${s} checkout side`, `cd ${s} && git branch -D x`, `git -C ${s} update-ref refs/heads/x HEAD`, `git --git-dir=${s}/.git branch -D x`, `git --git-dir=${s}/.git update-ref refs/heads/x HEAD`,
			`cd ${s} && git symbolic-ref HEAD refs/heads/x`, `git -C ${s} reflog expire --all`, `git --git-dir=${s}/.git reflog delete HEAD@{1}`, `git --git-dir=${s}/.git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`,
			`cd ${s} && git fetch -u . +side:main`, `cd ${s} && git worktree add -f ../x main`, `cd ${s} && git gc --prune=now`, `git -C ${s} checkout -B x`, `cd ${s} && git switch -C x`, `cd ${s} && git -c gc.reflogExpire=now fetch`,
			`cd ${s} && git --config-env=alias.ci=CI ci -m x`, `cd ${s} && git -c help.autocorrect=1 comit`, `cd ${s} && GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.ci GIT_CONFIG_VALUE_0=commit git ci -m x`,
			`cd ${s} && git push . x:y`, `git -C ${s} push . +x:y`, `cd ${s} && git push --receive-pack='git -c receive.denyCurrentBranch=ignore receive-pack' . +x:y`, `cd ${s} && git checkout --ignore-other-worktrees main`, `cd ${s} && git symbolic-ref HEAD refs/heads/x`, `cd ${s} && git commit --mes --dry-run` ]) assert.equal(t(c), '', c);
	// a push is judged by the repository it lands in, not the one it leaves: into the checkout from a scratch repo is denied, from the checkout into a scratch repo is not
	for (const c of [ `git push ${ROOT} x:y`, `git push ${ROOT} +x:y`, `git push --repo=${ROOT} x:y`, `cd ${s} && git push ${ROOT} x:y`, `git -C ${s} push ${ROOT} x:y`, `cd ${s} && git push ${ROOT}/.git x:y`, `cd ${s} && git push file://${ROOT} x:y` ]) assert.equal(t(c, s), 'deny', c);
	for (const c of [ 'git -C docs push .. x:y', 'cd docs && git push .. x:y', `git push ${s} x:y`, `git push ${s}/.git x:y`, `git push --repo=${s} x:y`, `cd ${s} && git push . x:y`, `git -C ${s} push . x:y`, `cd ${s} && git push ../nosuch x:y`, 'git push', 'git push origin main', 'git push -u origin x', 'git push "$X" x:y' ]) assert.ok(!kindsOf(c, 'tester').includes('rolegit'), c);
	// --git-dir and GIT_DIR name the repository, not the files: with no --work-tree or GIT_WORK_TREE the work tree is the directory the line stands in, here the checkout
	// (GIT_DIR and GIT_INDEX_FILE reach git only as a prefix, behind env or exported; a bare assignment is a shell variable and git acts where it stands)
	for (const c of [ `git --git-dir=${s}/.git checkout -- .`, `git --git-dir ${s}/.git restore .`, `GIT_DIR=${s}/.git git reset`, `GIT_DIR=${s}/.git git clean -fdx`, `export GIT_DIR=${s}/.git; git checkout -- .`, `env GIT_DIR=${s}/.git git restore .`, `timeout 5 env GIT_DIR=${s}/.git git clean -fd`,
		`git --git-dir=${s}/.git --work-tree=${ROOT} checkout -- .`, `GIT_DIR=${s}/.git GIT_WORK_TREE=${ROOT} git clean -fd`, `git -C ${s} --work-tree=${ROOT} restore .`, `cd ${ROOT}/docs && git --git-dir=${s}/.git restore .`, `git -C ${ROOT}/docs --git-dir=${s}/.git restore .`,
		`GIT_DIR=${s}/.git; git checkout -- .`, `FOO=1; GIT_DIR=${s}/.git; git reset`, `GIT_DIR=${s}/.git && git restore .`,
			`git --git-dir=${s}/.git commit -m x`, `GIT_DIR=${s}/.git git switch x`, `git --git-dir=${s}/.git checkout side`, `GIT_DIR=${s}/.git; git commit -m x`,
			`GIT_DIR=${s}/.git; git symbolic-ref HEAD refs/heads/x`, `GIT_DIR=${s}/.git; git reflog expire --all`,
			`GIT_DIR=${s}/.git; git fetch -u . +side:main`, `GIT_DIR=${s}/.git; git gc --prune=now`, `GIT_DIR=${s}/.git; git checkout -B x`, `GIT_DIR=${s}/.git; git worktree add -f ../x main`, `GIT_DIR=${s}/.git; git --config-env=alias.ci=CI ci` ]) assert.equal(t(c), 'deny', c);
	// the same lines from the scratch repo are free, and the lead is never asked
	for (const c of [ `git --git-dir=${s}/.git checkout -- .`, `GIT_DIR=${s}/.git git reset`, `export GIT_DIR=${s}/.git; git checkout -- .`, `env GIT_DIR=${s}/.git git restore .` ]) {
		assert.equal(t(c, s), '', c);
		assert.equal(asRole(undefined)(c), '', c);
	}
	// an unplaceable work tree drops the work-tree chance only: the git dir named is still judged, and an unplaceable one stays no find
	for (const c of [ `git --git-dir=${s}/.git --work-tree="$S" checkout -- .`, `GIT_DIR=${s}/.git GIT_WORK_TREE=$S git reset`, `git -C "$X" --work-tree=${s} reset` ]) assert.equal(t(c), '', c);
	// a git dir made earlier on the line is not there when the hook reads it: the work tree is still judged, a config verb is no find
	const nogd = `${dir}/nogitdir/.git`;
	for (const c of [ `git init ${dir}/nogitdir && git --git-dir=${nogd} clean -fd`, `GIT_DIR=${nogd} git checkout -- .`, `git --git-dir=${nogd} --work-tree=${ROOT} restore .`, `export GIT_DIR=${nogd}; git reset` ]) assert.equal(t(c), 'deny', c);
	for (const c of [ `git --git-dir=${nogd} --work-tree=${s} checkout -- .`, `GIT_DIR=${nogd} GIT_WORK_TREE=${s} git reset`, `git --git-dir=${nogd} config a.b c`, `GIT_DIR=${nogd} git remote add zz u` ]) assert.equal(t(c), '', c);
	assert.equal(t(`GIT_DIR=${nogd} git checkout -- .`, s), '');
	// a subshell, a substitution, `cd -` and popd leave the directory the line stood in: a command after them runs there
	for (const c of [ `(cd ${s} && git status); git restore .`, `(cd ${s}; git status) && git clean -fd`, `x=$(cd ${s} && pwd); git add f`, `cd ${s} && git status; cd - && git restore .`, `cd ${s} && git status; cd - >/dev/null; git reset`,
		`pushd ${s} >/dev/null; git status; popd; git restore .`, `pushd ${s}; popd >/dev/null; git stash`, `(cd ${s} && (cd /; true); git status); git restore .`, `cd ${s}; git status; cd ${ROOT}; cd -; git status; cd - && git restore .` ]) {
		assert.equal(t(c), 'deny', c);
		assert.equal(asRole(undefined)(c), '', c);
	}
	for (const c of [ `(cd ${s} && git restore .)`, `x=$(cd ${s} && git status); cd ${s} && git restore .`, `cd ${s} && (cd ${ROOT}; true); git restore .`, `cd ${s}; git restore .; cd -; git status`, `cd ${s} && cd ${ROOT} && cd - && git restore .`,
		`pushd ${s} >/dev/null; git restore .`, `pushd ${s}; pushd ${ROOT}; popd; git restore .`, 'cd -; git restore .' ]) assert.equal(t(c), '', c);
	assert.equal(t(`(cd ${ROOT} && git status); git restore .`, s), '');
	assert.equal(t(`(cd ${ROOT} && git restore .)`, s), 'deny');
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
	for (const c of [ 'git checkout -- .', 'git restore .', 'git clean -fd', 'git reset', 'git add f', 'git stash', 'git commit -m x', 'git switch x', 'git checkout side', 'git merge x', 'git rebase x', 'git cherry-pick x', 'git am x', 'git bisect start', 'git symbolic-ref -d HEAD', 'git checkout -b x', 'git switch -c x', 'git am --directory x --show-current-patch p.patch', 'git commit --dry-run --no-dry-run', 'git commit --mes --dry-run', 'git commit -m t --trailer --dry-run' ]) {
		assert.equal(d(c, home), 'deny', c);
		assert.equal(d(c, wt), '', `${c} in its worktree`);
		assert.equal(d(`git -C ${home} ${c.slice(4)}`, wt), 'deny', `${c} aimed at the checkout from the worktree`);
		assert.equal(d(`cd ${wt} && ${c}`, home), '', `${c} after a cd into the worktree`);
		assert.equal(d(`GIT_DIR=${home}/.git ${c}`, dir), 'deny', `${c} by GIT_DIR`);
		assert.equal(d(`git --git-dir=${home}/.git ${c.slice(4)}`, dir), 'deny', `${c} by --git-dir`);
		assert.equal(d(c, home, 'general-purpose'), '', `${c} for another agent type`);
	}
	// the refs are shared: a branch or ref written from a worktree is written in the checkout
	for (const c of [ 'git remote add zz u', 'git remote set-url origin u', 'git config a.b c', 'git config --unset a.b', 'git branch -D x', 'git branch -m a b', 'git branch -f x HEAD', 'git update-ref refs/heads/x HEAD', 'git update-ref -d refs/heads/x',
		// HEAD is the worktree's own, any other symbolic ref and every reflog sit in the shared directory
		'git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main', 'git symbolic-ref -d refs/remotes/origin/HEAD', 'git reflog expire --all', 'git reflog delete HEAD@{1}', 'git reflog drop --all',
		// a branch reset by checkout -B or switch -C, a branch another worktree holds, a fetch into it, what gc and prune drop, an alias or autocorrect that hides any of them
		'git checkout -B x', 'git switch -C x', 'git switch --force-create x', 'git fetch -u . +x:y',
		// a branch another worktree holds taken by --ignore-other-worktrees or by pointing HEAD at it, then moved by a commit in this worktree; a push to the repository, or naming receive.denyCurrentBranch
		'git checkout --ignore-other-worktrees main', 'git switch --ignore-other-worktrees side', 'git checkout --ignore main', 'git switch --ignore-o -c x main', 'git symbolic-ref HEAD refs/heads/x', 'git symbolic-ref -m msg HEAD refs/heads/x', 'git symbolic-ref -q HEAD refs/heads/main',
		'git push . x:y', 'git push . +x:y', 'git push --receive-pack="git -c receive.denyCurrentBranch=ignore receive-pack" . +x:y', 'git worktree add -f ../tmp/x main', 'git worktree add -B x ../tmp/x', 'git gc --prune=now', 'git prune', 'git -c gc.reflogExpire=now gc',
		'git branch --del x', 'git -c help.autocorrect=1 comit', 'git --config-env=alias.ci=CI ci', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=gc.pruneExpire GIT_CONFIG_VALUE_0=now git status' ]) {
		assert.equal(d(c, home), 'deny', c);
		assert.equal(d(c, wt), 'deny', `${c} in its worktree shares the config`);
		assert.equal(d(c, dir), '', `${c} in no repository`);
	}
	assert.equal(d('git status', wt), '');
	assert.equal(d('git config --get a.b', wt), '');
	// a push to a path of the checkout is denied from anywhere, and a remote named in it stands for its URL
	for (const c of [ `git push ${home} x:y`, `git push ${home}/.git x:y`, `git push file://${home} x:y`, `git -C ${wt} push ${home} x:y`, `cd ${wt} && git push ${home} x:y` ]) assert.equal(d(c, dir), 'deny', c);
	assert.equal(d(`git push ${wt} x:y`, dir), 'deny', 'the worktree shares the refs');
	assert.equal(d('git push --repo . x:y', wt), 'deny');
	assert.ok(!kindsOf('git push --repo . x:y', 'tester', dir, hook).includes('rolegit'));
	assert.equal(d(`git push ${home} x:y`, dir, 'general-purpose'), 'ask', 'the lead is asked about a push to a path that is not the theme repo, a role is denied');
	g(home, 'remote', 'add', 'loop', home);
	for (const c of [ 'git push loop x:y', 'git push --repo=loop x:y' ]) {
		assert.equal(d(c, home), 'deny', c);
		assert.equal(d(c, wt), 'deny', `${c} in its worktree`);
		assert.ok(!kindsOf(c, 'tester', dir, hook).includes('rolegit'), `${c} in no repository`);
	}
	// the remote name is looked up where the line stands, so a -C or cd to a subdirectory keeps it
	mkdirSync(join(home, 'sub'));
	for (const c of [ 'git -C sub push loop x:y', 'cd sub && git push loop x:y', `cd sub && git push ../${basename(home)} x:y`, 'git -C sub push . x:y', 'git -C sub push --repo=loop x:y' ]) assert.equal(d(c, home), 'deny', c);
	// git runs a push from the toplevel of the work tree: a relative path is read there, so `..` from a subdirectory is the parent of the checkout, not the checkout
	assert.ok(!kindsOf('cd sub && git push .. x:y', 'tester', home, hook).includes('rolegit'));
	assert.ok(!kindsOf('git -C sub push .. x:y', 'tester', home, hook).includes('rolegit'));
	const other = repo(join(dir, 'roleother'));
	assert.ok(!kindsOf(`git push ${other} x:y`, 'tester', home, hook).includes('rolegit'), 'a push to another repository is no find');
	assert.ok(!kindsOf('git push . x:y', 'tester', other, hook).includes('rolegit'), 'nor is a push from one to itself');
	// --work-tree and GIT_WORK_TREE name the root git chdirs to when the line stands inside it, so a relative path is read from there; with --git-dir or GIT_DIR and no work tree it is read from the line's directory, and from it too when the line stands outside the work tree named (`.git` is a target from the root only, `..` the checkout from sub only)
	for (const c of [ `git -C sub --work-tree=${home} push .git x:y`, `cd sub && GIT_WORK_TREE=${home} git push .git x:y`, `cd sub && git --git-dir=${home}/.git --work-tree=${home} push .git x:y`,
		`cd sub && git --git-dir=${home}/.git push .. x:y`, `cd sub && GIT_DIR=${home}/.git git push .. x:y`, `cd sub && git --work-tree=${other} push .. x:y` ]) assert.equal(d(c, home), 'deny', c);
	for (const c of [ `git -C sub --work-tree=${home} push .. x:y`, `cd sub && GIT_WORK_TREE=${home} git push .. x:y`, `cd sub && git --git-dir=${home}/.git --work-tree=${home} push .. x:y`,
		`cd sub && git --git-dir=${home}/.git push .git x:y`, `cd sub && git --work-tree=${other} push .git x:y` ]) assert.ok(!kindsOf(c, 'tester', home, hook).includes('rolegit'), c);
	// the .git of a linked worktree is a file that names a git dir, and git pushes into that: a gitfile, an absolute or a relative one (worktree.useRelativePaths, git 2.48), and a worktree's own git dir stand for the common dir they point at
	const wtr = join(dir, 'rolewtrel');
	g(home, '-c', 'worktree.useRelativePaths=true', 'worktree', 'add', '-q', '--detach', wtr);
	for (const c of [ `git push ${wt}/.git x:y`, `git push ${wtr}/.git x:y`, `git push file://${wt}/.git x:y`, `git push --repo=${wt}/.git x:y`, `git push ${home}/.git/worktrees/${basename(wt)} x:y`, `cd ${wt} && git push .git x:y`, `git -C ${wt} push ${wt}/.git x:y`, `cd ${other} && git push ${wt}/.git x:y` ]) assert.equal(d(c, dir), 'deny', c);
	for (const c of [ `git push ${other}/.git x:y`, `git push ${home}/.claude/hooks/git-guard.sh x:y`, `git push ${dir}/nosuch/.git x:y` ]) assert.ok(!kindsOf(c, 'tester', dir, hook).includes('rolegit'), c);
	// the hook shipped in a linked worktree (where .githooks/pre-push runs the tests, `.git` a file there): its checkout is the shared one, and its own work tree and the main one are two work trees of it
	const hookW = join(wt, '.claude/hooks/git-guard.sh');
	mkdirSync(dirname(hookW), { recursive: true });
	copyFileSync(HOOK, hookW);
	const dw = (c, cwd = dir) => decide(c, { cwd, hook: hookW, agent: 'tester' });
	for (const c of [ `git push ${wt}/.git x:y`, `git push ${wt} x:y`, `git push ${home}/.git x:y`, `git push ${home} x:y`, `git push file://${wt}/.git x:y`, `git push ${wtr}/.git x:y`, `cd ${wt} && git push .git x:y`, `cd ${wt}/.claude && git push .git x:y`, `git -C ${wt} push . x:y` ]) assert.equal(dw(c), 'deny', c);
	assert.equal(dw('git push --repo . x:y', wt), 'deny');
	assert.ok(!kindsOf(`git push ${other}/.git x:y`, 'tester', dir, hookW).includes('rolegit'));
	assert.equal(dw('git restore .', wt), 'deny', 'its own work tree');
	assert.equal(dw('git restore .', home), '', 'the main work tree is a sibling');
	assert.equal(dw(`git -C ${wt} restore .`, home), 'deny');
	assert.equal(dw('git branch -D x', home), 'deny', 'the refs are shared');
	// a lone word after checkout is a branch (a switch) or a path (a discard): either is the lead's, and free in the worktree
	g(home, 'branch', 'side');
	assert.equal(d('git checkout side', home), 'deny');
	assert.equal(d('git checkout nosuchbranch', home), 'deny');
	assert.equal(d('git checkout side', home, 'general-purpose'), '');
	assert.equal(d('git checkout nosuchbranch', home, 'general-purpose'), '');
	assert.equal(d('git checkout nosuchbranch', wt), '');
	assert.equal(d(`git -C ${home} checkout nosuchbranch`, wt), 'deny');
	assert.equal(d(`git --git-dir=${home}/.git checkout side`, dir), 'deny');
	assert.equal(d(`git --git-dir=${home}/.git checkout nosuchbranch`, dir), 'deny');
	assert.equal(d('git checkout side -- f', home), 'deny');
	assert.equal(d('git checkout -b other side', home), 'deny');
	assert.equal(d('git checkout -b other side', wt), '');
	assert.equal(d('git commit -m x', wt), '');
	assert.equal(d('git commit --dry-run', home), '');
	assert.equal(d(`git -C ${home} commit -m x`, wt), 'deny');
});

// `cd ""` and `git -C ""` stay put: the directory a line resolves to is the one it started in, for a push too.
test('an empty cd or -C operand leaves the directory where it was', () => {
	const f = repo(join(dir, 'emptycd'), { origin: THEME, fork: 'git@github.com:VizzleTF/luci.git' });
	assert.equal(decide('cd "" && git push fork x', { cwd: f }), 'ask');
	assert.equal(decide('git -C "" push fork x', { cwd: f }), 'ask');
	assert.equal(decide('git -C "$X" push fork x', { cwd: f }), '');
	assert.equal(decide('cd "$X" && git push fork x', { cwd: f }), '');
});

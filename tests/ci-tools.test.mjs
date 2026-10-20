import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { ROOT } from '../tools/lib/root.mjs';

const WATCH = join(ROOT, 'tools/ci-watch.sh');
const LOG = join(ROOT, 'tools/ci-log.sh');
const BG = join(ROOT, 'tools/bg.sh');
const dir = mkdtempSync(join(tmpdir(), 'ci-tools-'));
after(() => rmSync(dir, { recursive: true, force: true }));

// gh stand-in: it ignores --jq and prints the text the script's own program would have produced,
// taken from env: CI_RUNS (run list), CI_JOBS (failed job rows), CI_NAMES (failed job names), CI_LOG (job log).
// CI_NEEDWF lists runs only when called with `--workflow <it>`, as gh filters; CI_ARGV gets the last argv, one word a line.
writeFileSync(join(dir, 'gh'), `#!/bin/sh
[ -z "$CI_ARGV" ] || printf '%s\\n' "$@" > "$CI_ARGV"
[ -z "$CI_APIFAIL" ] || case "$1" in api) echo "HTTP 502" >&2; exit 1 ;; esac
case "$*" in
	"repo view"*) echo o/r ;;
	*join*) printf '%s\\n' "$CI_NAMES" ;;
	*steps*) printf '%s\\n' "$CI_JOBS" ;;
	*workflowName*) [ -z "$CI_NEEDWF" ] || case "$*" in *"--workflow $CI_NEEDWF "*) ;; *) exit 0 ;; esac
		printf '%b' "$CI_RUNS" ;;
	"api --allow-escape-sequences"*) cat "$CI_LOG" ;;
	api*) echo "the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway" >&2; exit 1 ;;
esac
`);
chmodSync(join(dir, 'gh'), 0o755);
writeFileSync(join(dir, 'job.log'), [
	'2026-10-18T13:26:55.1234567Z \u001b[36;1mnpm test\u001b[0m',
	'2026-10-18T13:26:56.0000000Z ok 1 - fine',
	'2026-10-18T13:26:57.0000000Z live-audit: 3 findings on /cgi-bin/luci/admin',
	'2026-10-18T13:26:58.0000000Z \u001b[31mNEW\u001b[0m  td.cbi-value-field overflows',
	'2026-10-18T13:26:59.0000000Z ##[error]Process completed with exit code 1.',
	'',
].join('\n'));

function sh(script, args, env = {}) {
	return spawnSync('sh', [ script, ...args ], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CI_LOG: join(dir, 'job.log'), ...env } });
}

test('ci-log --filter strips ANSI and the timestamp, keeps decisive lines and the context before ##[error]', () => {
	const r = spawnSync('sh', [ LOG, '--filter', '40' ], { input: require_log(), encoding: 'utf8' });
	assert.equal(r.stdout, 'npm test\nok 1 - fine\nlive-audit: 3 findings on /cgi-bin/luci/admin\nNEW  td.cbi-value-field overflows\n##[error]Process completed with exit code 1.\n');
});

function require_log() { return readFileSync(join(dir, 'job.log'), 'utf8'); }

test('ci-log --filter keeps the LAST n decisive lines', () => {
	const r = spawnSync('sh', [ LOG, '--filter', '1' ], { input: require_log(), encoding: 'utf8' });
	assert.equal(r.stdout, '##[error]Process completed with exit code 1.\n');
});

test('ci-log names the failed job and step, then the log lines', () => {
	const r = sh(LOG, [ '42' ], { CI_JOBS: '7\tlint\tnpm test' });
	assert.match(r.stdout, /^job: lint \(7\)\nstep: npm test\n[\s\S]*live-audit:/);
	assert.ok(r.stdout.split('\n').length <= 41);
});

test('ci-log fails loudly when the log fetch fails', () => {
	const r = sh(LOG, [ '42' ], { CI_JOBS: '7\tlint\tnpm test', CI_APIFAIL: '1' });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /cannot fetch the log of job 7/);
});

test('ci-log with a regex that matches no failed job says so', () => {
	const r = sh(LOG, [ '42', 'verify' ], { CI_JOBS: '7\tlint\tnpm test' });
	assert.match(r.stdout, /no failed job matching \/verify\//);
});

test('ci-watch: green run exits 0 with a verdict line', () => {
	const r = sh(WATCH, [ '--sha', 'abcdef1234', '--interval', '0' ], { CI_RUNS: '5\\tcompleted\\tsuccess\\tBuild\\n6\\tcompleted\\tskipped\\tCodeQL\\n' });
	assert.equal(r.status, 0);
	assert.equal(r.stdout.trim().split('\n').pop(), 'ci: green abcdef1 runs 5 6');
});

test('ci-watch: a red run exits 1, prints its log and names the failed jobs last', () => {
	const r = sh(WATCH, [ '--sha', 'abcdef1234', '--interval', '0' ], { CI_RUNS: '5\\tcompleted\\tfailure\\tBuild\\n', CI_JOBS: '7\tlint\tnpm test', CI_NAMES: 'lint, verify' });
	assert.equal(r.status, 1);
	assert.match(r.stdout, /job: lint/);
	assert.equal(r.stdout.trim().split('\n').pop(), 'ci: red abcdef1 runs 5 failed: lint, verify');
});

test('ci-watch: no run for the sha exits 2', () => {
	const r = sh(WATCH, [ '--sha', 'abcdef1234', '--interval', '0', '--max', '0' ], { CI_RUNS: '' });
	assert.equal(r.status, 2);
	assert.match(r.stdout, /^ci: no run for abcdef1/);
});

// gh matches --workflow against a file name or a display name; the run's workflowName ("release") is the display one.
test('ci-watch: --workflow is handed to gh, so a file name finds the run', () => {
	const argv = join(dir, 'argv');
	const r = sh(WATCH, [ '--sha', 'abcdef1234', '--workflow', 'release.yml', '--interval', '0', '--max', '0' ], { CI_RUNS: '9\\tcompleted\\tsuccess\\trelease\\n', CI_NEEDWF: 'release.yml', CI_ARGV: argv });
	assert.equal(r.status, 0);
	assert.equal(r.stdout.trim().split('\n').pop(), 'ci: green abcdef1 runs 9');
	assert.deepEqual(readFileSync(argv, 'utf8').split('\n').slice(0, 5), [ 'run', 'list', '--workflow', 'release.yml', '--commit' ]);
});

test('ci-watch: a display name with spaces reaches gh as one argument; --run ignores --workflow', () => {
	const argv = join(dir, 'argv2');
	const env = { CI_RUNS: '9\\tcompleted\\tsuccess\\tBuild and test\\n', CI_ARGV: argv };
	assert.equal(sh(WATCH, [ '--sha', 'abcdef1234', '--workflow', 'Build and test', '--interval', '0' ], env).status, 0);
	assert.deepEqual(readFileSync(argv, 'utf8').split('\n').slice(2, 4), [ '--workflow', 'Build and test' ]);
	const r = sh(WATCH, [ '--run', '9', '--workflow', 'nothing.yml', '--interval', '0' ], env);
	assert.equal(r.status, 0);
	assert.doesNotMatch(readFileSync(argv, 'utf8'), /--workflow/);
});

test('ci-watch: a run still going at --max exits 3', () => {
	const r = sh(WATCH, [ '--run', '5', '--interval', '0', '--max', '0' ], { CI_RUNS: '5\\tin_progress\\t\\tBuild\\n' });
	assert.equal(r.status, 3);
	assert.match(r.stdout, /^ci: timeout 5 /);
});

// bg.sh is probed through --check only: it prints the verdict and runs nothing, so a refusal that
// went missing turns a test red instead of running the command. cwd is a fresh dir outside the repo.
const cwd = mkdtempSync(join(tmpdir(), 'ci-bg-'));
after(() => rmSync(cwd, { recursive: true, force: true }));
const check = (c) => spawnSync('sh', [ BG, '--check', ...c.split(' ') ], { encoding: 'utf8', cwd });

const refused = [
	// publishing and history, with and without the global options that sit before the subcommand
	'git push', 'git tag v1', 'git commit -m x', 'git -C /r push', 'git -C /r -c user.name=a commit -m x', 'git --git-dir=/x tag v1', 'git --git-dir /x push', 'git -c alias.p=push p', 'git -calias.p=push p',
	'git reset --hard HEAD~3', 'git update-ref refs/tags/v9 HEAD', 'git update-ref -d refs/heads/main', 'git rebase HEAD~3', 'git branch -f main HEAD~5', 'git branch -D main', 'git checkout -B main', 'git switch -C main',
	'git send-pack x', 'git fetch origin +x:main', 'git stash', 'git clean -fd', 'git restore f', 'git merge x', 'git pull', 'git cherry-pick x', 'git am x.patch', 'git tt v1',
	'gh pr merge 3', 'gh run rerun 1', 'gh run cancel 1', 'gh run delete 1', 'gh api -X POST repos/o/r/git/refs', 'gh api repos/o/r/issues -f title=x', 'gh release create v1', 'gh pr comment 1',
	'gh -R o/r pr merge 1', 'gh --repo o/r issue comment 1', 'gh --repo=o/r release create v1', 'gh -Ro/r pr close 1', 'gh -R o/r api -X POST repos/o/r/issues', 'gh api --method=PATCH repos/o/r', 'gh api repos/o/r/issues --raw-field body=x',
	'gh api repos/o/r/issues --field body=x', 'gh api -XPOST repos/o/r/issues', 'gh api graphql -f query=x', 'gh release upload v1 f', 'gh release delete v1', 'gh workflow run release.yml', 'gh -R o/r workflow run u.yml',
	'gh secret set X', 'gh repo delete x', 'gh repo create x', 'gh label create x', 'gh alias set x y', 'gh extension install x', 'gh auth login', 'gh pr create', 'gh gist create f', 'gh ghx',
	// a command folded into a shell string, behind a separator or a wrapper
	'sh -c git reset --hard HEAD~3', 'sh -c true && git push', 'sh -c npm test ; gh -R o/r pr merge 1', 'env GIT_DIR=/x git push', 'xargs git tag', '/usr/bin/git -C /r push', 'command gh secret set X',
	// the hardware router and the transfer tools
	'ssh r', 'scp a b', '/usr/bin/rsync a b', 'tools/dev-sync.sh h',
];
for (const c of refused) {
	test(`bg.sh --check refuses: ${c}`, () => {
		const r = check(c);
		assert.equal(r.status, 2);
		assert.match(r.stdout, /^refused: .*foreground thread/);
		assert.equal(r.stderr, '');
	});
}
const allowed = [
	'git status', 'git -C /r log --oneline -3', 'git diff', 'git show HEAD', 'git rev-parse HEAD', 'git ls-remote origin', 'git describe --tags', 'git --version', 'git -c color.ui=never log',
	'gh pr checks 1', 'gh pr view 1', 'gh -R o/r pr checks 1', 'gh --repo o/r run watch 1', 'gh --repo=o/r run list', 'gh run view 1 --log', 'gh run list', 'gh run download 1', 'gh release view v1', 'gh release list', 'gh issue list',
	'gh api -X GET repos/o/r', 'gh api --method GET repos/o/r', 'gh api repos/o/r/actions/runs', 'gh api -H Accept:x repos/o/r/commits', 'gh auth status', 'gh workflow list', 'gh repo view', 'gh --version',
	'tools/ci-watch.sh --sha x', 'sshd', 'echo git', 'cd /home/x/git && npm test', 'sh -c git status && npm test', 'node tools/live-audit.mjs --all', 'git',
];
for (const c of allowed) {
	test(`bg.sh --check allows: ${c}`, () => {
		const r = check(c);
		assert.equal(r.status, 0, r.stdout);
		assert.equal(r.stdout, 'allowed\n');
	});
}

test('bg.sh --check without a command is a usage error', () => {
	const r = spawnSync('sh', [ BG, '--check' ], { encoding: 'utf8', cwd });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /^usage:/);
});

test('bg.sh --check runs nothing, allowed or refused', async () => {
	const marker = join(cwd, 'ran');
	assert.equal(check(`touch ${marker}`).stdout, 'allowed\n');
	assert.match(check(`touch ${marker} ssh`).stdout, /^refused:/);
	await sleep(200); // a detached run would have created the marker within a few ms
	assert.equal(existsSync(marker), false);
});

// Static guard: a line that names bg.sh or its path constant must carry --check, so no test here can
// reach the real run path. Comment lines and the constant's own declaration are exempt.
const unchecked = (src) => src.split('\n').filter((l) => /\bBG\b|bg\.sh/.test(l) && !/^const BG =|^\s*\/\//.test(l) && !l.includes('--check'));

test('every bg.sh spawn in this file goes through --check', () => {
	const bad = "spawnSync('sh', [ @, 'git', 'push' ]);".replace('@', 'B' + 'G'); // assembled: the scan must not read it as a call
	assert.equal(unchecked(bad).length, 1);
	assert.deepEqual(unchecked(readFileSync(fileURLToPath(import.meta.url), 'utf8')), []);
});

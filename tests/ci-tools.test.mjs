import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const WATCH = join(ROOT, 'tools/ci-watch.sh');
const LOG = join(ROOT, 'tools/ci-log.sh');
const BG = join(ROOT, 'tools/bg.sh');
const dir = mkdtempSync(join(tmpdir(), 'ci-tools-'));
after(() => rmSync(dir, { recursive: true, force: true }));

// gh stand-in: it ignores --jq and prints the text the script's own program would have produced,
// taken from env: CI_RUNS (run list), CI_JOBS (failed job rows), CI_NAMES (failed job names), CI_LOG (job log).
writeFileSync(join(dir, 'gh'), `#!/bin/sh
[ -z "$CI_APIFAIL" ] || case "$1" in api) echo "HTTP 502" >&2; exit 1 ;; esac
case "$*" in
	"repo view"*) echo o/r ;;
	*join*) printf '%s\\n' "$CI_NAMES" ;;
	*steps*) printf '%s\\n' "$CI_JOBS" ;;
	*workflowName*) printf '%b' "$CI_RUNS" ;;
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

test('ci-log --filter strips ANSI and the timestamp, keeps only decisive lines', () => {
	const r = spawnSync('sh', [ LOG, '--filter', '40' ], { input: require_log(), encoding: 'utf8' });
	assert.equal(r.stdout, 'live-audit: 3 findings on /cgi-bin/luci/admin\nNEW  td.cbi-value-field overflows\n##[error]Process completed with exit code 1.\n');
});

function require_log() { return spawnSync('cat', [ join(dir, 'job.log') ], { encoding: 'utf8' }).stdout; }

test('ci-log --filter keeps the LAST n decisive lines', () => {
	const r = spawnSync('sh', [ LOG, '--filter', '1' ], { input: require_log(), encoding: 'utf8' });
	assert.equal(r.stdout, '##[error]Process completed with exit code 1.\n');
});

test('ci-log names the failed job and step, then the log lines', () => {
	const r = sh(LOG, [ '42' ], { CI_JOBS: '7\tlint\tnpm test' });
	assert.match(r.stdout, /^job: lint \(7\)\nstep: npm test\nlive-audit:/);
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

test('ci-watch: a run still going at --max exits 3', () => {
	const r = sh(WATCH, [ '--run', '5', '--interval', '0', '--max', '0' ], { CI_RUNS: '5\\tin_progress\\t\\tBuild\\n' });
	assert.equal(r.status, 3);
	assert.match(r.stdout, /^ci: timeout 5 /);
});

// bg.sh must refuse every write form before it spawns anything; the reads must reach the spawn,
// which a missing binary then fails harmlessly in the background (the wrapper itself exits 0).
for (const c of [ 'git push', 'git tag v1', 'gh pr merge 3', 'gh run rerun 1', 'gh run cancel 1', 'gh api -X POST repos/o/r/git/refs', 'gh api repos/o/r/issues -f title=x', 'gh release create v1', 'gh pr comment 1' ]) {
	test(`bg.sh refuses: ${c}`, () => {
		const r = spawnSync('sh', [ BG, ...c.split(' ') ], { encoding: 'utf8' });
		assert.equal(r.status, 2);
		assert.match(r.stderr, /foreground thread/);
	});
}
for (const c of [ 'gh pr checks 1', 'gh api -X GET repos/o/r' ]) {
	test(`bg.sh lets through: ${c}`, () => {
		const r = spawnSync('sh', [ BG, 'true', ...c.split(' ') ], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
	});
}

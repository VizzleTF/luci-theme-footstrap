import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const LOG = join(ROOT, 'tools/ci-log.sh');

// Only the pure `--filter` half: it reads stdin, so the test never reaches gh, the network or the repo.
const filter = (lines, n = 40) => spawnSync('sh', [ LOG, '--filter', String(n) ], { input: lines.map((l) => `2026-10-18T13:26:55.1234567Z ${l}`).join('\n') + '\n', encoding: 'utf8' }).stdout;

// What `node --test` prints in CI (the tap reporter) for one passing test, one failing assertion, one
// thrown error and a failing subtest; the line shapes are copied from a real run.
const TAP = [
	'# Subtest: fine',
	'ok 1 - fine',
	'  ---',
	'  duration_ms: 0.46',
	"  type: 'test'",
	'  ...',
	'# Subtest: ci-watch: a red run exits 1',
	'not ok 2 - ci-watch: a red run exits 1',
	'  ---',
	'  duration_ms: 0.81',
	"  type: 'test'",
	"  location: '/home/runner/work/r/r/tests/ci-tools.test.mjs:77:1'",
	"  failureType: 'testCodeFailure'",
	'  error: |-',
	'    Expected values to be strictly equal:',
	'    ',
	'    0 !== 1',
	'    ',
	"  code: 'ERR_ASSERTION'",
	"  stack: |-",
	'    TestContext.<anonymous> (file:///home/runner/work/r/r/tests/ci-tools.test.mjs:80:10)',
	'    Test.run (node:internal/test_runner/test:1402:25)',
	'  ...',
	'# Subtest: throws',
	'not ok 3 - throws',
	'  ---',
	"  location: '/home/runner/work/r/r/tests/ci-tools.test.mjs:90:1'",
	"  error: 'boom'",
	"  code: 'ERR_TEST_FAILURE'",
	'  ...',
	'# Subtest: parent',
	'    # Subtest: child',
	'    not ok 1 - child',
	'      ---',
	"      location: '/home/runner/work/r/r/tests/ci-tools.test.mjs:99:39'",
	'      ...',
	'    1..1',
	'##[error]Process completed with exit code 1.',
];

test('ci-log --filter names the failing node:test case and its location', () => {
	const out = filter(TAP).split('\n');
	assert.ok(out.includes('not ok 2 - ci-watch: a red run exits 1'));
	assert.ok(out.includes("  location: '/home/runner/work/r/r/tests/ci-tools.test.mjs:77:1'"));
});

test('ci-log --filter keeps every failure with its one-line error, then the 8 lines before ##[error]', () => {
	assert.equal(filter(TAP), [
		'not ok 2 - ci-watch: a red run exits 1',
		"  location: '/home/runner/work/r/r/tests/ci-tools.test.mjs:77:1'",
		'not ok 3 - throws',
		"  location: '/home/runner/work/r/r/tests/ci-tools.test.mjs:90:1'",
		"  error: 'boom'",
		'  ...',
		'# Subtest: parent',
		'    # Subtest: child',
		'    not ok 1 - child',
		'      ---',
		"      location: '/home/runner/work/r/r/tests/ci-tools.test.mjs:99:39'",
		'      ...',
		'    1..1',
		'##[error]Process completed with exit code 1.',
		'',
	].join('\n'));
});

test('ci-log --filter prints nothing for a TAP stream that only passes', () => {
	assert.equal(filter([ 'ok 1 - a', '  ---', '  duration_ms: 1', '  ...', '1..1', '# pass 1', '# fail 0' ]), '');
});

test('ci-log --filter keeps the LAST n lines of a long TAP failure', () => {
	const many = Array.from({ length: 30 }, (_, i) => `not ok ${i + 1} - t${i + 1}`);
	const out = filter(many, 5).trimEnd().split('\n');
	assert.deepEqual(out, many.slice(-5));
});

// A step that dies on a plain console.error matches nothing above: the cause is only the line before ##[error].
const AGENT_REFS = [
	'> luci-theme-footstrap@0.0.0 check:fast',
	'> node tools/agent-refs.mjs',
	'.claude/agents/tester.md:15: dist/ — no such path',
	'',
	'agent-refs: 1 reference(s) to something that is not in the repository; fix the steering file or restore the target.',
	'##[error]Process completed with exit code 1.',
];

test('ci-log --filter prints the line before ##[error] that no decisive pattern matches', () => {
	const out = filter(AGENT_REFS).split('\n');
	assert.ok(out.includes('.claude/agents/tester.md:15: dist/ — no such path'));
	assert.equal(out.at(-2), '##[error]Process completed with exit code 1.');
});

test('ci-log --filter prints a line that is both decisive and context once, and skips blank lines', () => {
	const out = filter([ 'Error: boom', '   ', '', 'step output', '##[error]Process completed with exit code 1.' ]);
	assert.equal(out, 'Error: boom\nstep output\n##[error]Process completed with exit code 1.\n');
});

test('ci-log --filter takes the 8 lines before the FIRST ##[error], none from after it', () => {
	const before = Array.from({ length: 12 }, (_, i) => `before ${i + 1}`);
	const out = filter([ ...before, '##[error]first', 'after 1', '##[error]second' ]).trimEnd().split('\n');
	assert.deepEqual(out, [ ...before.slice(-8), '##[error]first', '##[error]second' ]);
});

test('ci-log --filter keeps its n-line cap with the context counted in', () => {
	assert.deepEqual(filter(AGENT_REFS, 3).trimEnd().split('\n'), [
		'.claude/agents/tester.md:15: dist/ — no such path',
		'agent-refs: 1 reference(s) to something that is not in the repository; fix the steering file or restore the target.',
		'##[error]Process completed with exit code 1.',
	]);
});

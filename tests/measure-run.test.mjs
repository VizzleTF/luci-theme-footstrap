import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const TOOL = join(ROOT, '.claude/tooling/measure-run.mjs');
const FIXTURE = join(ROOT, 'tests/fixtures/measure-run/session.jsonl');

const run = (file) => spawnSync('node', [ TOOL, file ], { encoding: 'utf8' });

// The table rows as [ role, model, ...numbers ]: columns are told apart by two or more spaces.
const table = (out) => {
	const lines = out.split('\n');
	return lines.slice(lines.findIndex((l) => /^ {4}role {2}/.test(l)) + 1).filter(Boolean)
		.map((l) => l.trim().split(/\s{2,}/).map((c) => (/^\d+$/.test(c) ? Number(c) : c)));
};

// The fixture: a lead with three streamed messages (msg_L1..L3 repeat their usage over several lines, and
// only the last line of msg_L1 has the full output_tokens), a developer, a tester and one workflow agent
// whose second message (msg_W2) has only its stream-start line, with no stop_reason.
test('measure-run: the character lines are unchanged and come first', () => {
	const lines = run(FIXTURE).stdout.split('\n');
	assert.deepEqual(lines.slice(0, 8), [
		FIXTURE,
		'  tool-result chars (main thread): 2430   images: 0 (0 B)   text: 6   Agent calls: 2   results: 6',
		'  delegated: 3 subagent transcript(s), 3600 tool-result chars — read by the role, not by the lead',
		'    Read                   900  n=1',
		'    Agent                  700  n=2',
		'    Bash                   700  n=1',
		'    Grep                   120  n=1',
		'    Edit                    10  n=1',
	]);
});

test('measure-run: a message repeated over several lines counts once, per role and model', () => {
	// columns: msgs, input, output, cache_read, cache_creation
	assert.deepEqual(table(run(FIXTURE).stdout), [
		[ 'lead', 'claude-opus-5-5', 4, 22, 373, 9500, 640 ],
		[ 'tester', 'claude-opus-5-5', 2, 10, 85, 8500, 300 ],
		[ 'developer', 'claude-sonnet-5-5', 2, 6, 130, 1200, 250 ],
		[ 'general-purpose (workflow)', 'claude-opus-5-5', 1, 2, '>=30 (0/1 final)', 1000, 0 ],
		[ 'general-purpose (workflow)', 'claude-sonnet-5-5', 1, 2, 20, 100, 900 ],
		[ 'total', 10, 42, '>=638 (9/10 final)', 20300, 2090 ],
	]);
});

test('measure-run: the lead per delegation and its five largest tool outputs', () => {
	const out = run(FIXTURE).stdout;
	assert.match(out, /lead per delegation: 1215 chars over 2 Agent call\(s\), budget 15000: within/);
	const top = out.split('largest lead tool outputs:\n')[1].split('\n').slice(0, 5).map((l) => l.trim().split(/\s+/));
	assert.deepEqual(top, [
		[ 'Read', '900', '2026-10-20T10:00:02.000Z' ],
		[ 'Bash', '700', '2026-10-20T10:00:22.000Z' ],
		[ 'Agent', '400', '2026-10-20T10:00:10.000Z' ],
		[ 'Agent', '300', '2026-10-20T10:00:20.000Z' ],
		[ 'Grep', '120', '2026-10-20T10:00:23.000Z' ],
	]);
});

// A lead alone, no subagents/ directory: one tool call and its result of n characters.
const solo = (dir, name, tool, n, stop = 'tool_use') => {
	const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 };
	const use = { type: 'assistant', timestamp: 't1', message: { role: 'assistant', id: 'm1', model: 'claude-opus-5-5', stop_reason: stop, usage, content: [ { type: 'tool_use', id: 'a', name: tool, input: {} } ] }};
	const res = { type: 'user', timestamp: 't2', message: { role: 'user', content: [ { type: 'tool_result', tool_use_id: 'a', content: 'x'.repeat(n) } ] }};
	const file = join(dir, `${name}.jsonl`);
	writeFileSync(file, [ use, res ].map((o) => JSON.stringify(o)).join('\n') + '\n');
	return run(file).stdout;
};

test('measure-run: the budget is 15000 characters per delegation, and a lead with no Agent call has none', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'measure-run-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	assert.match(solo(dir, 'at', 'Agent', 15000), /lead per delegation: 15000 chars over 1 Agent call\(s\), budget 15000: within/);
	assert.match(solo(dir, 'over', 'Agent', 15001), /lead per delegation: 15001 chars over 1 Agent call\(s\), budget 15000: OVER/);
	const out = solo(dir, 'none', 'Bash', 20000);
	assert.match(out, /delegated: 0 subagent transcript\(s\)/);
	assert.match(out, /lead per delegation: n\/a, no Agent calls \(20000 chars, budget 15000\)/);
	assert.deepEqual(table(out), [ [ 'lead', 'claude-opus-5-5', 1, 1, 2, 3, 4 ], [ 'total', 1, 1, 2, 3, 4 ] ]);
});

test('measure-run: a message with only its stream-start line marks the row output as a lower bound', (t) => {
	const dir = mkdtempSync(join(tmpdir(), 'measure-run-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	assert.deepEqual(table(solo(dir, 'start', 'Bash', 1, null)), [ [ 'lead', 'claude-opus-5-5', 1, 1, '>=2 (0/1 final)', 3, 4 ], [ 'total', 1, 1, '>=2 (0/1 final)', 3, 4 ] ]);
	assert.deepEqual(table(solo(dir, 'final', 'Bash', 1)), [ [ 'lead', 'claude-opus-5-5', 1, 1, 2, 3, 4 ], [ 'total', 1, 1, 2, 3, 4 ] ]);
});

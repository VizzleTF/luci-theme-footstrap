import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const HOOK = join(ROOT, '.claude/hooks/card-gate.sh');
const base = mkdtempSync(join(tmpdir(), 'card-gate-'));
after(() => rmSync(base, { recursive: true, force: true }));

/* A scratch workspace shaped like the real one: `<base>/<n>/repo` is the session cwd and `<base>/<n>/tmp/task-*`
 * is what `../tmp/task-*` reaches from it. `tasks` maps a task dir to the files it holds. */
let n = 0;
function rig(tasks = {}) {
	const root = join(base, String(n++)), repo = join(root, 'repo');
	mkdirSync(repo, { recursive: true });
	for (const [ task, files ] of Object.entries(tasks)) {
		mkdirSync(join(root, 'tmp', task), { recursive: true });
		for (const f of files) writeFileSync(join(root, 'tmp', task, f), '');
	}
	return repo;
}
const BOTH = [ 'card.json', 'dirty-at-start' ];

function run(input, { env, cwd } = {}) {
	const r = spawnSync('/bin/sh', [ HOOK ], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env, cwd });
	assert.equal(r.status, 0, r.stderr);
	if (!env) assert.equal(r.stderr, '', 'a hook on every Agent call says nothing on stderr');
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
}
const agent = (subagent_type, prompt, cwd) => ({ cwd, tool_name: 'Agent', tool_input: { description: 'd', subagent_type, prompt } });
const dev = (prompt, cwd) => agent('developer', prompt, cwd);

test('developer with a card and its dirty-at-start passes silently', () => {
	const cwd = rig({ 'task-0001-x': BOTH });
	assert.deepEqual(run(dev('Card: ../tmp/task-0001-x/card.json, round 1.', cwd)), {});
	// the path may sit in the middle of a sentence, in quotes or in brackets
	assert.deepEqual(run(dev('Read "../tmp/task-0001-x/card.json" first', cwd)), {});
	assert.deepEqual(run(dev('(see ../tmp/task-0001-x/card.json)', cwd)), {});
	// an empty dirty-at-start is a clean tree, and counts
	assert.equal(readFileSync(join(cwd, '../tmp/task-0001-x/dirty-at-start'), 'utf8'), '');
});

test('developer whose prompt names no card is denied with the two fixing commands', () => {
	const o = run(dev('Implement the thing, repo root is here.', rig()));
	assert.equal(o.hookEventName, 'PreToolUse');
	assert.equal(o.permissionDecision, 'deny');
	assert.match(o.permissionDecisionReason, /names no \.\.\/tmp\/task-<id>\/card\.json/);
	assert.match(o.permissionDecisionReason, /mkdir -p \.\.\/tmp\/task-<id> && git status --porcelain --untracked-files=all > \.\.\/tmp\/task-<id>\/dirty-at-start/);
	assert.match(o.permissionDecisionReason, /git diff HEAD > \.\.\/tmp\/task-<id>\/dirty-at-start\.diff/);
	// a handoff or a bare task dir is not a card
	assert.equal(run(dev('Read ../tmp/task-0001-x/handoff.md', rig({ 'task-0001-x': BOTH }))).permissionDecision, 'deny');
});

test('a card path that names a missing file is denied, and the fix names that task', () => {
	const o = run(dev('Card: ../tmp/task-0002-y/card.json', rig({ 'task-0001-x': BOTH })));
	assert.equal(o.permissionDecision, 'deny');
	assert.match(o.permissionDecisionReason, /task-0002-y\/card\.json does not exist/);
	assert.match(o.permissionDecisionReason, /mkdir -p \.\.\/tmp\/task-0002-y && /);
});

test('a card without dirty-at-start is denied', () => {
	const o = run(dev('Card: ../tmp/task-0003-z/card.json', rig({ 'task-0003-z': [ 'card.json', 'dirty-at-start.diff' ] })));
	assert.equal(o.permissionDecision, 'deny');
	assert.match(o.permissionDecisionReason, /task-0003-z\/dirty-at-start does not exist/);
});

test('one named card that holds both is enough when another is stale', () => {
	const cwd = rig({ 'task-0001-x': BOTH, 'task-0004-old': [ 'card.json' ] });
	assert.deepEqual(run(dev('Card: ../tmp/task-0001-x/card.json (the old one, ../tmp/task-0004-old/card.json, is context)', cwd)), {});
	assert.equal(run(dev('Card: ../tmp/task-0004-old/card.json', cwd)).permissionDecision, 'deny');
});

test('every other agent type passes with no card', () => {
	const cwd = rig();
	for (const t of [ 'tester', 'security', 'researcher', 'upstream-reviewer', 'general-purpose', 'Explore', 'fork', '' ]) {
		assert.deepEqual(run(agent(t, 'no card here', cwd)), {}, `type ${t || '(none)'}`);
	}
	assert.deepEqual(run({ cwd, tool_name: 'Agent', tool_input: { prompt: 'no subagent_type at all' } }), {});
});

test('every other tool passes, even one that carries the same fields', () => {
	const cwd = rig();
	assert.deepEqual(run({ cwd, tool_name: 'Bash', tool_input: { command: 'git status' } }), {});
	assert.deepEqual(run({ cwd, tool_name: 'Write', tool_input: { subagent_type: 'developer', prompt: 'x' } }), {});
	assert.deepEqual(run({ cwd, tool_input: { subagent_type: 'developer', prompt: 'x' } }), {});
});

test('a tripwire, not a fence: unreadable input and a missing tool stay silent', () => {
	const cwd = rig();
	for (const bad of [ '', 'not json', '{"tool_name":"Agent","tool_input":', '[]', 'null' ]) assert.deepEqual(run(bad), {}, JSON.stringify(bad));
	// a cwd that does not exist cannot place the card
	assert.deepEqual(run(dev('x', join(cwd, 'gone'))), {});
	for (const skip of [ 'jq', 'grep' ]) {
		const bin = join(base, `bin-${skip}`);
		mkdirSync(bin);
		for (const t of [ 'jq', 'grep', 'cat' ]) {
			if (t === skip) continue;
			for (const d of process.env.PATH.split(':')) if (existsSync(join(d, t))) { symlinkSync(join(d, t), join(bin, t)); break; }
		}
		assert.deepEqual(run(dev('no card', cwd), { env: { PATH: bin } }), {}, `no ${skip}`);
	}
});

test('the cwd of the input places the relative path, not the cwd of the process', () => {
	const withCard = rig({ 'task-0001-x': BOTH }), without = rig();
	const prompt = 'Card: ../tmp/task-0001-x/card.json';
	// the process runs in the repo that has no card, and the input points at the one that has
	assert.deepEqual(run(dev(prompt, withCard), { cwd: without }), {});
	// and the other way round: the process sits beside a card the input's cwd does not reach
	assert.equal(run(dev(prompt, without), { cwd: withCard }).permissionDecision, 'deny');
	// an absolute path needs no cwd
	assert.deepEqual(run(dev(`Card: ${join(withCard, '../tmp/task-0001-x/card.json')}`, without)), {});
});

test('a leading ~/ in the card path is expanded against HOME before the file tests', () => {
	const cwd = rig({ 'task-0005-h': BOTH, 'task-0006-h': [ 'card.json' ] }), home = join(cwd, '..');
	const env = { ...process.env, HOME: home };
	assert.deepEqual(run(dev('Card: ~/tmp/task-0005-h/card.json', rig()), { env }), {});
	const o = run(dev('Card: ~/tmp/task-0006-h/card.json', rig()), { env });
	assert.equal(o.permissionDecision, 'deny');
	assert.match(o.permissionDecisionReason, /\/tmp\/task-0006-h\/dirty-at-start does not exist/);
	assert.doesNotMatch(o.permissionDecisionReason, /~/);
});

test('settings.json wires the hook on the Agent matcher and leaves the Bash entries alone', () => {
	const pre = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')).hooks.PreToolUse;
	const agentEntry = pre.filter((e) => e.matcher === 'Agent');
	assert.equal(agentEntry.length, 1);
	assert.deepEqual(agentEntry[0].hooks.map((h) => h.command), [ 'sh "${CLAUDE_PROJECT_DIR}/.claude/hooks/card-gate.sh"' ]);
	assert.ok(agentEntry[0].hooks[0].statusMessage);
	const bash = pre.filter((e) => e.matcher === 'Bash');
	assert.equal(bash.length, 1);
	assert.deepEqual(bash[0].hooks.map((h) => h.command), [
		'sh "${CLAUDE_PROJECT_DIR}/.claude/hooks/git-guard.sh"',
		'sh "${CLAUDE_PROJECT_DIR}/.claude/hooks/precommit-gate.sh"',
	]);
});

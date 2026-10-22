/* The static half of tools/upstream-contract.mjs: shipped files may not carry a ../tmp/ path, a task
 * id or a CI run id (the upstream bot flagged each by hand). Driven on fixture trees; no router. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanEnv } from './lib/git-env.mjs';

function scan(files) {
	const root = mkdtempSync(join(tmpdir(), 'uc-'));
	try {
		for (const [ rel, body ] of Object.entries(files)) {
			const p = join(root, 'luci-theme-footstrap', rel);
			mkdirSync(join(p, '..'), { recursive: true });
			writeFileSync(p, body);
		}
		return spawnSync(process.execPath, [ 'tools/upstream-contract.mjs', '--static-only', '--root', root ], { encoding: 'utf8' });
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test('a clean tree passes', () => {
	const r = scan({ 'htdocs/a.js': '/* the invariant, see docs/chrome.md */\n', 'styles/a.css': 'a { color: red }\n' });
	assert.equal(r.status, 0, r.stderr);
});

for (const [ name, line ] of [ [ '../tmp path', '/* see ../tmp/task-x/log */' ], [ 'task id', '// task-a1b2c3' ], [ 'run id', '/* CI run 34364446910 */' ], [ 'runs url', '// actions/runs/1' ] ]) {
	test(`${name} fails and names file:line`, () => {
		const r = scan({ 'root/etc/x': 'ok\n' + line + '\n' });
		assert.equal(r.status, 1);
		assert.match(r.stderr, /root\/etc\/x:2:/);
	});
}

test('prose such as task-list is not a task id', () => {
	assert.equal(scan({ 'htdocs/a.js': '// task-list rows\n' }).status, 0);
});

test('upstream-review-facts.sh -C runs git on the named tree', () => {
	const d = mkdtempSync(join(tmpdir(), 'urf-'));
	const callerIndex = `${d}.caller-idx`;
	const env = cleanEnv({ ...process.env, GIT_INDEX_FILE: callerIndex });
	try {
		const g = (...a) => spawnSync('git', [ '-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a ], { encoding: 'utf8', env });
		g('init', '-q', '-b', 'master');
		writeFileSync(join(d, 'a'), 'x\n'); g('add', 'a'); g('commit', '-qm', 'a');
		g('checkout', '-qb', 'pr');
		writeFileSync(join(d, 'b'), 'y\n'); g('add', 'b'); g('commit', '-qm', 'b');
		const r = spawnSync('sh', [ 'tools/upstream-review-facts.sh', '-C', d, 'master', 'pr' ], { encoding: 'utf8', env });
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /A b/);
		assert.equal(spawnSync('sh', [ 'tools/upstream-review-facts.sh' ]).status, 2);
		assert.equal(existsSync(callerIndex), false, "the caller's GIT_INDEX_FILE was written by the scratch repo");
	} finally { rmSync(d, { recursive: true, force: true }); rmSync(callerIndex, { force: true }); }
});

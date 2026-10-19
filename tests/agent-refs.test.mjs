/* tools/agent-refs.mjs on fixture trees: a steering file naming a missing path, script or tool
 * fails with file:line; placeholders, globs, ../tmp and generated files pass. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(claude) {
	const root = mkdtempSync(join(tmpdir(), 'ar-'));
	try {
		mkdirSync(join(root, 'tools'));
		mkdirSync(join(root, 'docs'));
		writeFileSync(join(root, 'tools/real.mjs'), '');
		writeFileSync(join(root, 'docs/real.md'), '');
		writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }));
		writeFileSync(join(root, 'CLAUDE.md'), claude);
		return spawnSync(process.execPath, [ 'tools/agent-refs.mjs', '--root', root ], { encoding: 'utf8' });
	} finally { rmSync(root, { recursive: true, force: true }); }
}

test('existing script, tool and path pass', () => {
	const r = run('`npm run test`, `node tools/real.mjs`, `docs/real.md#x`, `docs/real.md:3`\n');
	assert.equal(r.status, 0, r.stderr);
});

test('placeholders, globs, ../tmp, generated files and bare extensions pass', () => {
	const r = run('`tools/<name>.mjs` `docs/*.md` `../tmp/task-x/card.json` `cascade.css` `.ut` `{a,b}/c.md`\n');
	assert.equal(r.status, 0, r.stderr);
});

for (const [ name, line, want ] of [
	[ 'missing script', 'x\n`npm run nope`', /CLAUDE\.md:2: npm run nope/ ],
	[ 'missing tool', '`node tools/gone.mjs`', /CLAUDE\.md:1: tools\/gone\.mjs/ ],
	[ 'missing path', '`docs/gone.md`', /CLAUDE\.md:1: docs\/gone\.md/ ],
]) {
	test(`${name} fails with file:line`, () => {
		const r = run(line + '\n');
		assert.equal(r.status, 1);
		assert.match(r.stderr, want);
	});
}

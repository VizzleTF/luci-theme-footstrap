/* tools/agent-refs.mjs on fixture trees: a steering file naming a missing path, script or tool
 * fails with file:line; placeholders, globs, ../tmp and generated files pass. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLEAN } from './lib/git-env.mjs';

/* The fixture is a real scratch repo: `tracked` files are `git add`ed, `loose` ones are written after
 * and stay untracked, `ignore` is its .gitignore. `git: false` leaves it a bare directory. */
function run(claude, { tracked = {}, loose = {}, ignore = '', git = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'ar-'));
	const put = (files) => {
		for (const [ p, c ] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), c); }
	};
	try {
		put({ 'tools/real.mjs': '', 'docs/real.md': '', 'package.json': JSON.stringify({ scripts: { test: 'x' } }), 'CLAUDE.md': claude, '.gitignore': ignore, ...tracked });
		if (git) for (const a of [ [ 'init', '-q' ], [ 'add', '-A' ] ]) spawnSync('git', a, { cwd: root, env: CLEAN });
		put(loose);
		return spawnSync(process.execPath, [ 'tools/agent-refs.mjs', '--root', root ], { encoding: 'utf8', env: CLEAN });
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

test('outside a git checkout the disk decides', () => {
	assert.equal(run('`docs/real.md`\n', { git: false }).status, 0);
	assert.equal(run('`docs/gone.md`\n', { git: false }).status, 1);
});

test('a tracked file and a directory holding one pass', () => {
	const r = run('`docs/t.md` `docs/sub/` `node tools/t.mjs`\n', { tracked: { 'docs/t.md': '', 'docs/sub/x.md': '', 'tools/t.mjs': '' } });
	assert.equal(r.status, 0, r.stderr);
});

test('a gitignored path passes whether or not it exists on disk', () => {
	const claude = '`dist/` `dist/noarch/x.apk` `gen/out.css`\n';
	const ignore = 'dist/\n/gen/out.css\n';
	assert.equal(run(claude, { ignore }).status, 0);
	assert.equal(run(claude, { ignore, loose: { 'dist/noarch/x.apk': '', 'gen/out.css': '' } }).status, 0);
});

test('an untracked, non-ignored file on disk is not present: a clean checkout lacks it', () => {
	for (const [ ref, file ] of [ [ '`docs/loose.md`', 'docs/loose.md' ], [ '`node tools/loose.mjs`', 'tools/loose.mjs' ], [ '`docs/dir/`', 'docs/dir/x.md' ] ]) {
		const r = run(ref + '\n', { loose: { [file]: '' }, ignore: 'dist/\n' });
		assert.equal(r.status, 1, ref);
		assert.match(r.stderr, /CLAUDE\.md:1: /);
	}
});

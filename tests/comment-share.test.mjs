import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commentBytes } from '../tools/lib/comment-share.mjs';
import { ROOT } from '../tools/lib/root.mjs';

const gate = join(ROOT, 'tools/comment-share.mjs');
const run = (dir) => spawnSync(process.execPath, [ gate, dir ], { encoding: 'utf8' });

test('commentBytes counts comment text with its delimiters, and not a quote or slashes in a literal', () => {
	const src = "'use strict';\n/* ab */\nconst u = 'http://x'; // cd\nreturn (/\\/\\//).test(u);\n";
	assert.deepEqual(commentBytes(src), { comment: '/* ab */'.length + '// cd'.length, total: src.length });
});

test('the gate fails on a file at 40 % comment, passes under it, and fails when it measured nothing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'fs-cshare-'));
	try {
		assert.equal(run(dir).status, 1, 'an empty dir is a wrong path, not a pass');
		writeFileSync(join(dir, 'ok.js'), `/* ${'x'.repeat(20)} */\n${'a();\n'.repeat(60)}`);
		assert.equal(run(dir).status, 0);
		writeFileSync(join(dir, 'bloated.js'), `/* ${'x'.repeat(200)} */\nreturn 1;\n`);
		const r = run(dir);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /bloated\.js/);
		assert.doesNotMatch(r.stderr, /ok\.js/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

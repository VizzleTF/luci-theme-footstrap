import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });

test('computed-diff --max rejects a non-integer instead of passing on NaN', () => {
	for (const bad of [ 'abc', '-1', '1.5' ]) {
		const r = run([ 'tools/computed-diff.mjs', `--max=${bad}` ]);
		assert.equal(r.status, 2, `--max ${bad}`);
		assert.match(r.stderr, /--max wants a non-negative integer/);
	}
});

test('--only naming a stand that is not running exits 2', () => {
	const dir = mkdtempSync(join(tmpdir(), 'fake-owlab-'));
	try {
		const bin = join(dir, 'owlab');
		writeFileSync(bin, `#!/bin/sh\necho '{"routers":[{"id":"up1","state":"running","http_port":1,"distro":"openwrt"}]}'\n`);
		chmodSync(bin, 0o755);
		const code = `import { stands } from './tools/lib/stands.mjs'; console.log(stands(process.argv[1]).map((s) => s.id).join());`;
		const env = { PATH: `${dir}:${process.env.PATH}` };
		const bad = run([ '--input-type=module', '-e', code, 'up1,down2' ], env);
		assert.equal(bad.status, 2);
		assert.match(bad.stderr, /down2: not running/);
		const ok = run([ '--input-type=module', '-e', code, 'up1' ], env);
		assert.equal(ok.stdout.trim(), 'up1');
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

/* smoke.mjs runs on import, so the pure function is lifted out of its source. */
const src = readFileSync(join(ROOT, 'tools/smoke.mjs'), 'utf8');
const fn = src.match(/function stripComments[\s\S]*?\n}\n[\s\S]*?function exportedKeys[\s\S]*?\n}\n/)[0];
const exportedKeys = new Function(`${fn}; return exportedKeys;`)();

test('exportedKeys takes keys, never the identifiers in a value', () => {
	const mod = (b) => `return baseclass.extend({${b}});`;
	assert.deepEqual([ ...exportedKeys(mod('a, b')) ], [ 'a', 'b' ]);
	assert.deepEqual([ ...exportedKeys(mod('a: foo(x, y), b: other, async c() { return z; }')) ], [ 'a', 'b', 'c' ]);
	assert.equal(exportedKeys('nothing'), null);
});

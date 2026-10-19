import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

// The hook inherits GIT_DIR from git; a nested `git -C tmp init` must not re-init that repo.
test('pre-push runs npm run check without the hook GIT_* env', () => {
	const d = mkdtempSync(join(tmpdir(), 'pre-push-'));
	try {
		const real = join(d, 'real'), nested = join(d, 'nested');
		spawnSync('git', [ 'init', '-q', real ]);
		const cfg = join(real, '.git', 'config');
		const before = readFileSync(cfg, 'utf8');
		writeFileSync(join(d, 'npm'), `#!/bin/sh\nmkdir "${nested}" && git -C "${nested}" init -q --bare\n`);
		chmodSync(join(d, 'npm'), 0o755);
		const r = spawnSync('sh', [ join(ROOT, '.githooks/pre-push') ], {
			input: 'refs/heads/x 1111111111111111111111111111111111111111 refs/heads/x 0000000000000000000000000000000000000000\n',
			env: { ...process.env, PATH: `${d}:${process.env.PATH}`, GIT_DIR: join(real, '.git'), GIT_PREFIX: '' },
			encoding: 'utf8',
		});
		assert.equal(r.status, 0, r.stderr);
		assert.ok(existsSync(join(nested, 'HEAD')), 'nested repo created in its own dir');
		assert.equal(readFileSync(cfg, 'utf8'), before, 'real repo config untouched');
	} finally { rmSync(d, { recursive: true, force: true }); }
});

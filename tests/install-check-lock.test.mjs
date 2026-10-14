import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const id = `ict-${process.pid}`;
const lock = join(ROOT, '..', 'tmp', `stands-${id}.lock`);
const bin = mkdtempSync(join(tmpdir(), 'install-check-'));
const holders = [];
mkdirSync(dirname(lock), { recursive: true });

/* install-check.sh against a stub owlab and docker: every command it sends to a "router" succeeds,
 * so the only thing the run can tell the tests is whether it took the stand lock. */
writeFileSync(join(bin, 'owlab'), '#!/bin/sh\n[ "$1" = status ] && echo \'{"project": "t"}\'\nexit 0\n');
writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 0\n');
chmodSync(join(bin, 'owlab'), 0o755);
chmodSync(join(bin, 'docker'), 0o755);

after(() => {
	holders.forEach((h) => h.kill());
	rmSync(bin, { recursive: true, force: true });
	rmSync(lock, { force: true });
});

/* A timeout is a failure here: a script that waits 30 min on a lock it should have skipped is the bug. */
const run = (pair) => spawnSync('sh', [ 'tools/install-check.sh', id ], {
	cwd: ROOT,
	encoding: 'utf8',
	timeout: 20000,
	env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STANDS_LOCK_HELD: id, STANDS_LOCK_PID: String(pair) },
});

test('a live pid that names the lock file but holds no flock does not skip the lock', () => {
	writeFileSync(lock, `ci-local pid ${process.pid}\n`);
	const r = run(process.pid);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(readFileSync(lock, 'utf8'), /^install-check pid \d+/);
});

test('a lock really held by the ci-local named in the pair is not taken again', async () => {
	const h = spawn('flock', [ '-x', lock, 'sleep', '30' ], { stdio: 'ignore' });
	holders.push(h);
	await new Promise((r) => setTimeout(r, 300));
	writeFileSync(lock, `ci-local pid ${h.pid}\n`);
	const r = run(h.pid);
	assert.equal(r.status, 0, r.error ? String(r.error) : r.stdout + r.stderr);
	assert.equal(readFileSync(lock, 'utf8'), `ci-local pid ${h.pid}\n`);
});

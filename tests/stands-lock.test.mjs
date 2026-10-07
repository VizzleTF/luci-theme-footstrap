import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heldBy } from '../tools/lib/stands.mjs';

const dir = mkdtempSync(join(tmpdir(), 'stands-lock-'));
const file = join(dir, 'stands-x.lock');
const holders = [];
after(() => { holders.forEach((h) => h.kill()); rmSync(dir, { recursive: true, force: true }); });

// A live process holding the flock, with the lock file naming it the way ci-local does.
async function hold() {
	const h = spawn('flock', [ '-x', file, 'sleep', '30' ], { stdio: 'ignore' });
	holders.push(h);
	await new Promise((r) => setTimeout(r, 300));
	writeFileSync(file, `ci-local pid ${h.pid}\n`);
	return h.pid;
}
const env = (pid, ids = 'x') => ({ STANDS_LOCK_PID: String(pid), STANDS_LOCK_HELD: ids });

test('no pair in the environment is not held', () => {
	assert.equal(heldBy('x', file, {}), false);
	assert.equal(heldBy('x', file, { STANDS_LOCK_HELD: 'x' }), false);
});

test('a stale pair whose holder is gone does not skip the lock', () => {
	writeFileSync(file, 'ci-local pid 999999\n');
	assert.equal(heldBy('x', file, env(999999)), false);
});

test('a live pid that holds no flock does not skip the lock', () => {
	writeFileSync(file, `ci-local pid ${process.pid}\n`);
	assert.equal(heldBy('x', file, env(process.pid)), false);
});

test('a real holder skips only the ids it was handed down', async () => {
	const pid = await hold();
	assert.equal(heldBy('x', file, env(pid)), true);
	assert.equal(heldBy('x', file, env(pid, 'y')), false);
});

test('a live pid that is not the lock file\'s holder does not skip the lock', async () => {
	await hold();
	assert.equal(heldBy('x', file, env(process.pid)), false);
});

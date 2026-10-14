import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../tools/lib/root.mjs';
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

// A flock that never gets the lock, as a stand another gate holds would look. It ends only when told
// `-w N`; without it, it sleeps an hour, so a wait that killed its shell wrapper instead of letting
// flock give up would leave this one running.
test('a lock wait that times out ends its own flock and leaves none behind', () => {
	const bin = join(dir, 'bin');
	const pids = join(dir, 'fake-flock.pids');
	mkdirSync(bin);
	writeFileSync(join(bin, 'flock'),
		`#!/bin/sh\n[ "$1" = --version ] && exit 0\necho $$ >>"${pids}"\n`
		+ '[ "$1" = -w ] && { sleep "$2"; exit 1; }\nexec sleep 3600\n');
	chmodSync(join(bin, 'flock'), 0o755);
	const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, STANDS_LOCK_TIMEOUT_MS: '2000' };
	delete env.STANDS_LOCK_HELD;
	delete env.STANDS_LOCK_PID;
	const mod = pathToFileURL(join(ROOT, 'tools/lib/stands.mjs')).href;
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [ '--input-type=module', '-e',
		`import { requireStands } from ${JSON.stringify(mod)}; requireStands([ { id: 'f9-${process.pid}' } ], 'f9');` ],
	{ encoding: 'utf8', timeout: 20000, env });
	const alive = readFileSync(pids, 'utf8').split('\n').filter(Boolean).map(Number).filter((pid) => {
		try { process.kill(pid, 0); return true; } catch { return false; }
	});
	alive.forEach((pid) => process.kill(pid, 'SIGKILL'));
	// a wait cut short by the timeout leaves its ack file in the lock dir
	const lockDir = join(ROOT, '..', 'tmp');
	for (const f of readdirSync(lockDir)) if (f.startsWith(`stands-f9-${process.pid}.`)) rmSync(join(lockDir, f));
	assert.equal(r.status, 2, r.error ? String(r.error) : r.stderr);
	assert.match(r.stderr, /still held by .* after 2 s; gave up/);
	assert.ok(Date.now() - t0 < 10000, 'the wait is bounded by the timeout, not by the fake flock');
	assert.deepEqual(alive, [], 'a flock outlived the wait that started it');
});

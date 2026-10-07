/* strip-probes.sh must leave every shipped module parseable. A missing comma after a
 * `navigate /* fs:probe *\/` entry passed npm test and lint:js yet made the script exit 2 and broke
 * packaging, so this runs the real script on a copy of the resources and syntax-checks each output.
 * LuCI modules end in a bare `return`, which `node --check` accepts for a .js (CommonJS) file. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../tools/lib/root.mjs';

const PKG = join(ROOT, 'luci-theme-footstrap');
const RES = 'htdocs/luci-static/resources';

function stripCopy(mutate) {
	const dir = mkdtempSync(join(tmpdir(), 'fs-strip-'));
	try {
		cpSync(join(PKG, RES), join(dir, RES), { recursive: true });
		if (mutate) mutate(join(dir, RES));
		const strip = spawnSync('sh', [ join(PKG, 'strip-probes.sh'), dir ], { encoding: 'utf8' });
		const bad = [];
		for (const f of readdirSync(join(dir, RES), { recursive: true }).filter((p) => p.endsWith('.js'))) {
			const r = spawnSync(process.execPath, [ '--check', join(dir, RES, f) ], { encoding: 'utf8' });
			if (r.status !== 0) bad.push(f);
		}
		return { strip, bad };
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

test('strip-probes.sh output parses in every module', () => {
	const { strip, bad } = stripCopy();
	assert.equal(strip.status, 0, strip.stderr);
	assert.deepEqual(bad, []);
});

test('a probe entry without its comma goes red', () => {
	const { strip, bad } = stripCopy((res) => {
		const f = join(res, 'fs-router.js');
		const src = readFileSync(f, 'utf8');
		const out = src.replace(/(\n\s*navigate),(\s*\/\* fs:probe \*\/)/, '$1$2');
		assert.notEqual(out, src, 'navigate probe line not found: the mutation did not apply');
		writeFileSync(f, out);
	});
	assert.ok(strip.status !== 0 || bad.length > 0, 'a broken probe line passed both the script and --check');
});

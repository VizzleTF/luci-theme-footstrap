/* tools/stage.sh hands owfeed a tree whose modes do not depend on the worktree's: owfeed and luci.mk
 * copy modes from disk and uhttpd answers 403 on a file that is not world-readable. Run for real on
 * a scratch copy whose sources carry the bad modes (the worktree's own 0600 files are the red case and
 * stay as they are). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../tools/lib/root.mjs';

const mode = (p) => lstatSync(p).mode & 0o777;

/* a scratch copy of the tree stage.sh reads, so a test may change its sources */
function scratch() {
	const work = mkdtempSync(join(tmpdir(), 'fs-stage-'));
	cpSync(join(ROOT, 'tools'), join(work, 'tools'), { recursive: true });
	cpSync(join(ROOT, 'luci-theme-footstrap'), join(work, 'luci-theme-footstrap'), { recursive: true });
	symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'));
	return work;
}

test('a 0600 source file and a 0700 directory stage as 0644 and 0755; an executable stays executable', () => {
	const work = scratch();
	try {
		const src = join(work, 'luci-theme-footstrap');
		chmodSync(join(src, 'htdocs/luci-static/footstrap/manifest.json'), 0o600);
		chmodSync(join(src, 'root/usr/share/rpcd/acl.d/luci-theme-footstrap.json'), 0o600);
		chmodSync(join(src, 'root/www/cgi-bin/luci-theme-footstrap-pattern'), 0o700);
		chmodSync(join(src, 'root/www/cgi-bin'), 0o700);
		chmodSync(join(src, 'root/www'), 0o700);

		const dist = join(work, 'dist');
		const r = spawnSync('sh', [ join(work, 'tools/stage.sh') ], {
			encoding: 'utf8', env: { ...process.env, DIST: dist, FOOTSTRAP_VERSION: '0.0.0' },
		});
		assert.equal(r.status, 0, r.stderr);

		const root = join(dist, 'root');
		assert.equal(mode(join(root, 'www/luci-static/footstrap/manifest.json')), 0o644);
		assert.equal(mode(join(root, 'usr/share/rpcd/acl.d/luci-theme-footstrap.json')), 0o644);
		assert.equal(mode(join(root, 'www')), 0o755);
		assert.equal(mode(join(root, 'www/cgi-bin')), 0o755);
		assert.equal(mode(join(root, 'www/cgi-bin/luci-theme-footstrap-pattern')), 0o755);
		assert.equal(mode(join(root, 'etc/uci-defaults/30_luci-theme-footstrap')), 0o755);

		const unreadable = [];
		for (const p of readdirSync(dist, { recursive: true })) {
			const st = lstatSync(join(dist, p));
			if (st.isSymbolicLink()) continue;
			if (!(st.mode & 0o004) || (st.isDirectory() && !(st.mode & 0o001))) unreadable.push(`${p} ${(st.mode & 0o777).toString(8)}`);
		}
		assert.deepEqual(unreadable, []);
	} finally { rmSync(work, { recursive: true, force: true }); }
});

/* The version stamp goes into sed and fs-version.js; dev-sync.sh holds the same value to
 * [0-9A-Za-z._-], and stage.sh refuses anything else before it wipes dist/. */
const stage = (work, version) => spawnSync('sh', [ join(work, 'tools/stage.sh') ], {
	encoding: 'utf8', env: { ...process.env, DIST: join(work, 'dist'), FOOTSTRAP_VERSION: version },
});

for (const bad of [ "1.0'x", '1#2', 'a&b', '1.0\n2', '$(id)', '1.0;x' ]) {
	test(`FOOTSTRAP_VERSION ${JSON.stringify(bad)} is refused before dist/ is touched`, () => {
		const work = scratch();
		try {
			mkdirSync(join(work, 'dist'));
			writeFileSync(join(work, 'dist/keep'), '');
			const r = stage(work, bad);
			assert.equal(r.status, 1, 'stage.sh did not refuse');
			assert.match(r.stderr, /stage: refusing version/);
			assert.ok(existsSync(join(work, 'dist/keep')), 'dist/ was wiped before the refusal');
		} finally { rmSync(work, { recursive: true, force: true }); }
	});
}

for (const good of [ '0.14.15_pre1', '0.20261014.123' ]) {
	test(`FOOTSTRAP_VERSION ${good} is stamped`, () => {
		const work = scratch();
		try {
			const r = stage(work, good);
			assert.equal(r.status, 0, r.stderr);
			const js = readFileSync(join(work, 'dist/root/www/luci-static/resources/fs-version.js'), 'utf8');
			assert.ok(js.includes(`FS_VERSION = '${good}'`), js);
			assert.equal(readFileSync(join(work, 'dist/VERSION'), 'utf8'), `${good}-r1\n`);
		} finally { rmSync(work, { recursive: true, force: true }); }
	});
}

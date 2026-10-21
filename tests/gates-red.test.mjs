/* Every cheap file gate can still go red. A gate that exits 0 on the defect it exists for reads as a
 * pass everywhere (ebbd36b fixed 17 that passed on empty input), so each case plants ONE known
 * defect in a copy of the tree, runs the gate's own `package.json` script there, and wants a
 * non-zero exit and the planted item in what it printed.
 *
 * The copy is what git tracks plus what it does not ignore, from the checkout rather than HEAD: the
 * edit under test is usually a gate not yet committed. node_modules is linked, not copied. Every
 * gate resolves its root from its own path, so it sees the copy and never the checkout.
 * Browser and stand gates are out: a probe needs a page. */
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const PKG = 'luci-theme-footstrap';
const RES = `${PKG}/htdocs/luci-static/resources`;
const THEME = `${PKG}/styles/theme`;

let dir, tree;
const undo = [];

before(() => {
	dir = mkdtempSync(join(tmpdir(), 'gates-red-'));
	tree = join(dir, 'tree');
	const ls = spawnSync('git', [ 'ls-files', '-z', '--cached', '--others', '--exclude-standard' ], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(ls.status, 0, `git ls-files: ${ls.stderr}`);
	for (const f of ls.stdout.split('\0').filter(Boolean)) {
		if (f === 'node_modules') continue;		/* a symlinked one is not matched by the `node_modules/` ignore rule */
		try { lstatSync(join(ROOT, f)); } catch { continue; }		/* in the index, gone from the worktree */
		cpSync(join(ROOT, f), join(tree, f), { verbatimSymlinks: true });
	}
	symlinkSync(join(ROOT, 'node_modules'), join(tree, 'node_modules'), 'dir');
});
after(() => { rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { while (undo.length) undo.pop()(); });

const read = (rel) => readFileSync(join(tree, rel), 'utf8');

/* Edit a file of the copy. An edit that changes nothing throws, so a moved anchor fails loudly
 * instead of becoming a plant that plants nothing. */
function change(rel, fn) {
	const src = read(rel), next = fn(src);
	if (next === src) throw new Error(`${rel}: the planted edit changed nothing`);
	undo.push(() => writeFileSync(join(tree, rel), src));
	writeFileSync(join(tree, rel), next);
}
const edit = (rel, from, to) => change(rel, (s) => s.replace(from, () => to));
const append = (rel, extra) => change(rel, (s) => s + extra);

/* A file the copy did not have; `root` is what to remove afterwards when that is a directory. */
function add(rel, body, root = rel) {
	mkdirSync(dirname(join(tree, rel)), { recursive: true });
	writeFileSync(join(tree, rel), body);
	undo.push(() => rmSync(join(tree, root), { recursive: true, force: true }));
}
/* A new sheet in the theme layer; build-css.sh wants the file to carry its own wrapper. */
const sheet = (name, css) => add(`${THEME}/98-zz-${name}.css`, `@layer theme {\n${css}\n}\n`);

/* a number a gate pins in its own source, read from the copy so a re-pin does not break the case */
const limit = (rel, key) => Number(read(rel).match(new RegExp(`\\b${key}:\\s*([\\d_]+)`))[1].replaceAll('_', ''));

/* `gate` is the package.json script: the case runs what `npm run <gate>` runs, so a script that loses
 * its flag or is dropped fails here too. */
function run(gate) {
	const script = JSON.parse(read('package.json')).scripts[gate];
	assert.ok(script, `package.json has no "${gate}" script`);
	const r = spawnSync('sh', [ '-c', script ], { cwd: tree, encoding: 'utf8', timeout: 60_000 });
	return { r, out: `${r.stdout}${r.stderr}` };
}

/* `plant` edits the copy; it returns the pattern to look for when `match` is not given, for a plant
 * whose size is only known once it has measured the copy. */
function red(gate, defect, item, plant, match) {
	test(`${gate}: ${defect} -> exit != 0, prints ${item}`, (t) => {
		const planted = plant();
		const { r, out } = run(gate);
		const tail = out.trim().split('\n').slice(-6).join('\n');
		assert.ok(r.status > 0, `${gate} exited ${r.status} (signal ${r.signal}) on a planted defect:\n${tail}`);
		const hit = out.match(match ?? planted);
		assert.ok(hit, `${gate} exited ${r.status} but never named ${item}:\n${tail}`);
		t.diagnostic(`${gate}: exit ${r.status}, printed: ${hit[0].replace(/\s+/g, ' ').slice(0, 140)}`);
	});
}

red('mirror', 'a @mirror pair whose copies differ', 'zz/pair',
	() => sheet('mirror', '/* @mirror zz/pair */\n.fs-zz-a { margin: 1px; }\n/* @endmirror */\n'
		+ '/* @mirror zz/pair */\n.fs-zz-a { margin: 2px; }\n/* @endmirror */'),
	/@mirror zz\/pair: the copies have DRIFTED/);

red('axes', 'head.ut pre-paints a localStorage key no JS writes', 'fs-zz-ghost',
	() => append(`${PKG}/ucode/template/themes/footstrap/partials/head.ut`, `\n<script>localStorage.getItem('fs-zz-ghost');</script>\n`),
	/head\.ut reads localStorage 'fs-zz-ghost'/);

red('css-dup', 'one unpinned declaration body under two guards', '.fs-zz-dup-a',
	() => sheet('dup', '.fs-zz-dup-a { margin: 1px; padding: 2px; color: red; }\n'
		+ '@media (min-width: 1px) { .fs-zz-dup-b { margin: 1px; padding: 2px; color: red; } }'),
	/\.fs-zz-dup-a/);

red('chrome-fence', 'CHROME_FENCE no longer spares the chrome mark', 'data-fs-chrome-zz',
	() => edit(`${RES}/fs-sheets.js`, `const CHROME_FENCE = ':where(:not([data-fs-chrome],`, `const CHROME_FENCE = ':where(:not([data-fs-chrome-zz],`),
	/CHROME_FENCE is\s*:where\(:not\(\[data-fs-chrome-zz\]/);

red('css-floor', 'a selector list mixing a :has() part with a plain one', '.fs-zz-hazard',
	() => sheet('floor', '.fs-zz-hazard:has(> .fs-zz-x), .fs-zz-hazard-b { color: red; }'),
	/fs-zz-hazard:has/);

red('css-metrics', 'one more !important than LIMITS.importants allows', 'importants N+1 > N', () => {
	const max = limit('tools/css-metrics.mjs', 'importants');
	const now = Number(run('css-metrics').out.match(/^importants\s+(\d+)/m)[1]);
	assert.ok(now <= max, `the unplanted sheet already has ${now} importants, over ${max}`);
	sheet('metrics', `.fs-zz-bang { ${'margin: 0 !important; '.repeat(max + 1 - now)} }`);
	return new RegExp(`importants ${max + 1} > ${max}\\b`);
});

red('css-orphans', 'a .fs-* class styled and emitted by nothing', '.fs-zz-orphan',
	() => sheet('orphans', '.fs-zz-orphan { color: red; }'),
	/\.fs-zz-orphan/);

red('size', 'a stylesheet one byte over its cascadeCss budget', 'cascade.css over its budget by 1 B', () => {
	/* Padding is one custom property, so the built sheet grows by exactly the length of its value. A
	 * first run with a pad the size of the budget reports how far over that put the sheet, which is
	 * what the least pad that crosses the line is worked out from. */
	const max = limit('tools/size-budget.mjs', 'cascadeCss');
	const pad = (n) => sheet('size', `.fs-zz-pad { --zz-pad: ${'x'.repeat(n)}; }`);
	pad(max);
	const over = Number(run('size').out.match(/over its \d+ B budget by (\d+) B/)[1]);
	pad(Math.max(1, max - over + 1));
	return new RegExp(`cascade\\.css is \\d+ B, over its ${max} B budget by 1 B`);
});

red('audit', 'a var() read of a property nobody defines', '--fs-zz-ghost',
	() => sheet('audit', '.fs-zz-v { color: var(--fs-zz-ghost); }'),
	/--fs-zz-ghost/);

red('makefile-contract', 'a second package in LUCI_DEPENDS', '+zz-curl',
	() => edit(`${PKG}/Makefile`, 'LUCI_DEPENDS:=+luci-base', 'LUCI_DEPENDS:=+luci-base +zz-curl'),
	/LUCI_DEPENDS must be exactly .*\+zz-curl/);

red('conffiles', 'a shipped /etc/config file no conffiles list declares', '/etc/config/zz-planted',
	() => add(`${PKG}/root/etc/config/zz-planted`, ''),
	/\/etc\/config\/zz-planted is shipped but NOT in/);

red('acl', 'an ACL granting exec on /bin/sh', '/bin/sh /etc/footstrap/zz-planted.sh',
	() => change(`${PKG}/root/usr/share/rpcd/acl.d/luci-theme-footstrap.json`, (s) => {
		const acl = JSON.parse(s);
		acl['luci-theme-footstrap'].write.file['/bin/sh /etc/footstrap/zz-planted.sh'] = [ 'exec' ];
		return JSON.stringify(acl, null, '\t');
	}),
	/zz-planted\.sh.*exec on the interpreter 'sh'/);

red('marker', 'the `call BuildPackage` signature gone from the Makefile', `${PKG}/Makefile`,
	() => edit(`${PKG}/Makefile`, '# call BuildPackage - OpenWrt buildroot signature', '# the signature is gone'),
	/luci-theme-footstrap\/Makefile does not match include\/scan\.mk/);

red('page-modules', 'the page map loads fs-overview on a page it does not act on', 'admin-status-zz-planted',
	() => edit(`${RES}/menu-footstrap-common.js`, `'admin-status-overview': 'fs-overview'`, `'admin-status-zz-planted': 'fs-overview'`),
	/fs-overview: the map loads it on "admin-status-zz-planted"/);

red('i18n-packages', 'a po/<lang> that stage.sh and owfeed.yml do not know', 'po/zz',
	() => add(`${PKG}/po/zz/footstrap.po`, 'msgid ""\nmsgstr ""\n', `${PKG}/po/zz`),
	/po\/zz has no label in stage\.sh/);

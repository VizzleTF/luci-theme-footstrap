import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCss, seamOf } from '../tools/lib/css.mjs';
import { ROOT } from '../tools/lib/root.mjs';

const SCRIPT = join(ROOT, 'luci-theme-footstrap/mangle-tokens.sh');

/* A sheet with one private name, and a rewrite dir whose NAME holds a space. */
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), 'mangle-'));
	const css = join(dir, 'cascade.css');
	const src = join(dir, 'with space');
	mkdirSync(src);
	writeFileSync(css, ':root{--fs-accent:red}a{color:var(--fs-accent)}');
	writeFileSync(join(src, 'a.js'), "el.style.setProperty('--fs-accent', 'x');\n");
	return { dir, css, src };
}

test('the seam rename reaches a file under a directory with a space in its name', () => {
	const { dir, css, src } = fixture();
	try {
		const r = spawnSync('sh', [ SCRIPT, css, src ], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		assert.doesNotMatch(readFileSync(join(src, 'a.js'), 'utf8'), /--fs-accent/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed awk on the seam pass fails the build and leaves no temp file behind', () => {
	const { dir, css, src } = fixture();
	try {
		/* passes pass 1 and 2 through; dies on the per-file rename, the only program that reads MAPF */
		const bin = join(dir, 'bin');
		mkdirSync(bin);
		writeFileSync(join(bin, 'awk'), '#!/bin/sh\ncase "$*" in *getline\\ l\\ \\<\\ MAPF*) exit 1 ;; esac\nexec /usr/bin/awk "$@"\n');
		chmodSync(join(bin, 'awk'), 0o755);
		const r = spawnSync('sh', [ SCRIPT, css, src ], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
		assert.notEqual(r.status, 0, 'a failed awk must not be a green build');
		assert.deepEqual(readdirSync(src), [ 'a.js' ]);
		assert.deepEqual(readdirSync(dir).filter((n) => n !== 'bin').sort(), [ 'cascade.css', 'with space' ]);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

/* A sheet shaped like build-css.sh's: a banner whose lines may end in `}`, then one rule per line. */
const BANNER = '/*!\n* notices a rule could never carry {\n*   Copyright with a closing brace }\n*/\n';
const RULES = '@layer a,b;@layer a{:root{--fs-accent:red}\n:root{--fs-gap:1px}\n}\n@layer b{a{color:var(--fs-accent)}\n.x::after{content:"}"}\n}\n';

function mangled(sheet) {
	const { dir, css, src } = fixture();
	try {
		writeFileSync(css, sheet);
		const r = spawnSync('sh', [ SCRIPT, css, src ], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		return readFileSync(css, 'utf8');
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the joined sheet is the renamed sheet with its newlines removed, and ends in one', () => {
	const out = mangled(BANNER + RULES);
	const renamed = (BANNER + RULES).replaceAll('--fs-accent', '--a').replaceAll('--fs-gap', '--b');
	assert.equal(out.replaceAll('\n', ''), renamed.replaceAll('\n', ''));
	assert.ok(out.endsWith('}\n') && !out.endsWith('\n\n'));
});

test('a banner line ending in a brace keeps its newline, and the rules after it take one line', () => {
	const out = mangled(BANNER + RULES);
	assert.ok(out.startsWith(BANNER), 'the Apache attribution is copied byte for byte');
	assert.equal(out.slice(BANNER.length).split('\n').length, 2);
});

test('the shipped sheet is the banner and one line, equal to the plain one but for newlines and names', () => {
	const plain = readFileSync(buildCss(), 'utf8');
	const out = buildCss({ shipped: true });
	const sheet = readFileSync(out, 'utf8');
	const { names } = seamOf(out);
	const banner = plain.slice(0, plain.indexOf('*/') + 3);
	assert.ok(sheet.startsWith(banner));
	assert.equal(sheet.slice(banner.length).split('\n').length, 2, 'one line and the final newline');
	assert.equal(sheet.replaceAll('\n', ''), plain.replace(/--fs-[A-Za-z0-9_-]+/g, (m) => names.get(m) ?? m).replaceAll('\n', ''));
});

test('a failed awk on the join pass fails the build and leaves the sheet and no temp file behind', () => {
	const { dir, css, src } = fixture();
	try {
		const before = readFileSync(css, 'utf8');
		/* the join is the only awk program that holds `inb` */
		const bin = join(dir, 'bin');
		mkdirSync(bin);
		writeFileSync(join(bin, 'awk'), '#!/bin/sh\ncase "$*" in *inb*) exit 1 ;; esac\nexec /usr/bin/awk "$@"\n');
		chmodSync(join(bin, 'awk'), 0o755);
		const r = spawnSync('sh', [ SCRIPT, css, src ], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
		assert.notEqual(r.status, 0, 'a failed join must not be a green build');
		assert.equal(readFileSync(css, 'utf8'), before);
		assert.deepEqual(readdirSync(dir).filter((n) => n !== 'bin').sort(), [ 'cascade.css', 'with space' ]);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

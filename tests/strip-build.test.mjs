/* strip-build.sh, run for real on small inputs and on the shipped trees. templates drops the
 * indentation that reaches the HTML and refuses the shapes where a leading blank is data; shell
 * refuses a `#` line inside a quoted string; probes must leave every module parseable (a missing
 * comma after a `navigate /* fs:probe *\/` entry passed npm test yet broke packaging; LuCI modules
 * end in a bare `return`, which `node --check` accepts for a .js file); assets strip clean. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../tools/lib/root.mjs';

const PKG = join(ROOT, 'luci-theme-footstrap');

/* run `templates` over a directory holding t.ut; returns the script's result and the file after it */
function strip(src) {
	const dir = mkdtempSync(join(tmpdir(), 'fs-strip-ws-'));
	try {
		const f = join(dir, 't.ut');
		writeFileSync(f, src);
		const r = spawnSync('sh', [ join(PKG, 'strip-build.sh'), 'templates', dir ], { encoding: 'utf8' });
		return { r, out: readFileSync(f, 'utf8') };
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

const tokens = (s) => s.split(/\s+/).filter(Boolean);

test('indentation and blank lines go, line 1 and the line below a `%}` keep theirs', () => {
	const src = '\t<html>\n\t\t<body>\n\n\t\t\t{% if (x): %}\n\t\t\t<p>a</p>\n\n\t\t\t{% endif %}\n\t\t</body>\n';
	const { r, out } = strip(src);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(out, '\t<html>\n<body>\n{% if (x): %}\n\t\t\t<p>a</p>\n{% endif %}\n\t\t</body>\n');
	assert.deepEqual(tokens(out), tokens(src), 'a non-blank token changed');
});

test('a blank line below a `%}` stays a bare newline and the line after it is stripped', () => {
	const { r, out } = strip('a\n{% x %}  \n\t\n\tb\n');
	assert.equal(r.status, 0, r.stderr);
	assert.equal(out, 'a\n{% x %}  \n\nb\n');
});

test('a backtick inside a template comment is not a template literal', () => {
	const { r, out } = strip('a\n\t{# the `Top` label #}\n\tb\n');
	assert.equal(r.status, 0, r.stderr);
	assert.equal(out, 'a\nb\n');
});

const REFUSED = [
	[ 'an odd backtick count', 'a\n\tconst s = `x\n\t  y`;\n', /template literal/ ],
	[ 'a trailing backslash', 'a\n\tconst s = "x\\\n\t  y";\n', /backslash/ ],
	[ 'a single-quoted string spanning lines in {% %}', "a\n{% let s = 'x\n    y'; %}\n", /t\.ut:2: a string in a .* block spans lines/ ],
	[ 'a double-quoted string spanning lines in {{ }}', 'a\n{{ "x\n    y" }}\n', /t\.ut:2: a string in a .* block spans lines/ ],
	[ 'a division after a word that only ends like a keyword', "a\n{% let begin = 1, n = begin / 2, s = 'x\n    y'; %}\n", /t\.ut:2: a string in a .* block spans lines/ ],
	[ 'a division after typeof, which ucode reads as a name', "a\n{% let n = typeof / 2, s = 'x\n    y'; %}\n", /t\.ut:2: a string in a .* block spans lines/ ],
	[ 'a division after a property named in', "a\n{% let n = o.in / 2, s = 'x\n    y'; %}\n", /t\.ut:2: a string in a .* block spans lines/ ],
	[ '<pre>', 'a\n<PRE class="x">\n  keep\n</pre>\n', /<pre>/ ],
	[ '<textarea>', 'a\n<textarea>\n  keep\n</textarea>\n', /<textarea>/ ],
];
for (const [ name, src, msg ] of REFUSED) {
	test(`${name} refuses the build`, () => {
		const { r } = strip(src);
		assert.equal(r.status, 1, 'the script did not refuse');
		assert.match(r.stderr, msg);
	});
}

test('a quote in a regex, a comment or the HTML text is not a string spanning lines', () => {
	const { r } = strip("{% let r = match(v, /[\"']/); // it's\n\tlet s = 'a' + \"b\"; /* it's */ %}\n<p>don't</p>\n{{ x ? 'a' : \"b\" }}\n");
	assert.equal(r.status, 0, r.stderr);
});

/* the words ucode's lexer follows with a regex, and the operators before an operand: the quote in each
 * literal must not open a string, or a valid template is refused */
for (const src of [
	'{% function f(v) { return /"/.test(v); } %}',
	'{% switch (v) { case /"/: break; } %}',
	'{% if (v) { x(); } else /"/.test(v); %}',
	'{% let a = delete /"/; %}',
	"{% let a = 1 in /'/; %}",
	'{% let f = (v) => /"/.test(v); %}',
	"{% let a = split(v, /'/); %}",
	"{% let a = x + /'/; %}",
]) {
	test(`a regex literal is not a division: ${src}`, () => {
		const { r } = strip(`a\n${src}\n<p>b</p>\n`);
		assert.equal(r.status, 0, r.stderr);
	});
}

test('a tag that only starts with <pre is not <pre>', () => {
	const { r } = strip('a\n\t<preview>b</preview>\n');
	assert.equal(r.status, 0, r.stderr);
});

test('the shipped templates strip clean and keep indentation only below a `%}`', () => {
	const dir = mkdtempSync(join(tmpdir(), 'fs-strip-ws-'));
	try {
		cpSync(join(PKG, 'ucode'), join(dir, 'ucode'), { recursive: true });
		const r = spawnSync('sh', [ join(PKG, 'strip-build.sh'), 'templates', join(dir, 'ucode') ], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
		const bad = [];
		for (const p of readdirSync(join(dir, 'ucode'), { recursive: true }).filter((f) => f.endsWith('.ut'))) {
			const lines = readFileSync(join(dir, 'ucode', p), 'utf8').split('\n');
			lines.forEach((l, i) => {
				if (i > 0 && /^[ \t]/.test(l) && !/%\}[ \t\r]*$/.test(lines[i - 1])) bad.push(`${p}:${i + 1}`);
			});
		}
		assert.deepEqual(bad, []);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

/* run `shell` over a directory holding t.sh; returns the script's result and the file after it */
function stripShell(src) {
	const dir = mkdtempSync(join(tmpdir(), 'fs-strip-sh-'));
	try {
		const f = join(dir, 't.sh');
		writeFileSync(f, `#!/bin/sh\n${src}`);
		const r = spawnSync('sh', [ join(PKG, 'strip-build.sh'), 'shell', dir ], { encoding: 'utf8' });
		return { r, out: readFileSync(f, 'utf8') };
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [ name, src ] of [
	[ 'double-quoted', 'x="one\n# two\nthree"\n' ],
	[ 'single-quoted', "x='one\n\t# two\nthree'\n" ],
	[ 'double-quoted (with an escaped quote)', 'x="a\\"b\n# c"\n' ],
]) {
	test(`a # line inside a ${name} string refuses the build and names file:line`, () => {
		const { r, out } = stripShell(src);
		assert.equal(r.status, 1, 'the script did not refuse');
		assert.match(r.stderr, /t\.sh:3: a # line inside a quoted string/);
		assert.match(out, /# (two|c)/, 'the file was rewritten anyway');
	});
}

test('a # that is not a comment, or a comment after a closed string, strips as before', () => {
	const src = '# gone\nx="one # two"\necho "$#" ${#x} a#b "it\'s" # it\'s a "comment\n\t# gone too\necho \'a\' # tail\n';
	const { r, out } = stripShell(src);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(out, '#!/bin/sh\nx="one # two"\necho "$#" ${#x} a#b "it\'s" # it\'s a "comment\necho \'a\' # tail\n');
});

test('the shipped root/ shell strips clean', () => {
	const dir = mkdtempSync(join(tmpdir(), 'fs-strip-sh-'));
	try {
		cpSync(join(PKG, 'root'), join(dir, 'root'), { recursive: true });
		const r = spawnSync('sh', [ join(PKG, 'strip-build.sh'), 'shell', join(dir, 'root') ], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

const RES = 'htdocs/luci-static/resources';

function stripCopy(mutate) {
	const dir = mkdtempSync(join(tmpdir(), 'fs-strip-'));
	try {
		cpSync(join(PKG, RES), join(dir, RES), { recursive: true });
		if (mutate) mutate(join(dir, RES));
		const strip = spawnSync('sh', [ join(PKG, 'strip-build.sh'), 'probes', dir ], { encoding: 'utf8' });
		const bad = [];
		for (const f of readdirSync(join(dir, RES), { recursive: true }).filter((p) => p.endsWith('.js'))) {
			const r = spawnSync(process.execPath, [ '--check', join(dir, RES, f) ], { encoding: 'utf8' });
			if (r.status !== 0) bad.push(f);
		}
		return { strip, bad };
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

test('strip-build.sh probes output parses in every module', () => {
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

test('the shipped assets strip clean', () => {
	const dir = mkdtempSync(join(tmpdir(), 'fs-strip-as-'));
	try {
		cpSync(join(PKG, 'htdocs/luci-static/footstrap'), join(dir, 'footstrap'), { recursive: true });
		const r = spawnSync('sh', [ join(PKG, 'strip-build.sh'), 'assets', join(dir, 'footstrap') ], { encoding: 'utf8' });
		assert.equal(r.status, 0, r.stderr);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

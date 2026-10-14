import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../tools/lib/root.mjs';

const PKG = join(ROOT, 'luci-theme-footstrap');

function build(tail) {
	const dir = mkdtempSync(join(tmpdir(), 'build-css-'));
	try {
		cpSync(join(PKG, 'styles'), join(dir, 'styles'), { recursive: true });
		cpSync(join(PKG, 'build-css.sh'), join(dir, 'build-css.sh'));
		appendFileSync(join(dir, 'styles/theme/20-shell.css'), tail);
		return spawnSync('sh', [ join(dir, 'build-css.sh'), join(dir, 'cascade.css') ], { encoding: 'utf8' });
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [ name, rule ] of [
	[ 'one-line', '.x { color: red; }' ],
	[ 'multi-line', '.x {\n\tcolor: red;\n}' ],
]) test(`a ${name} rule after a file's @layer wrapper is rejected, not moved into the layer`, () => {
	const r = build(`\n${rule}\n`);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /20-shell\.css:\d+: a rule after the @layer wrapper/);
});

test('a blank line and comments after the @layer wrapper still build', () => {
	const r = build('\n\n/* one */\n/* two\n   lines */\n');
	assert.equal(r.status, 0, r.stderr);
});

/* `body` goes INSIDE the wrapper, before its closing `}`; the build must keep the close where it was. */
function buildInside(body) {
	const dir = mkdtempSync(join(tmpdir(), 'build-css-'));
	try {
		cpSync(join(PKG, 'styles'), join(dir, 'styles'), { recursive: true });
		cpSync(join(PKG, 'build-css.sh'), join(dir, 'build-css.sh'));
		const f = join(dir, 'styles/theme/20-shell.css');
		writeFileSync(f, readFileSync(f, 'utf8').replace(/\}\s*$/, `${body}\n}\n`));
		const r = spawnSync('sh', [ join(dir, 'build-css.sh'), join(dir, 'cascade.css') ], { encoding: 'utf8' });
		return { r, out: r.status === 0 ? readFileSync(join(dir, 'cascade.css'), 'utf8') : '' };
	} finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [ name, body, kept ] of [
	[ 'a multi-line comment', '/* a { that is\n   prose */\n.fs-t1 { color: red; }', '.fs-t1{color:red}' ],
	[ 'a quoted brace', '.fs-t2::before { content: "{"; }', 'content:"{"' ],
]) test(`the wrapper's close is found past ${name} holding a brace`, () => {
	const { r, out } = buildInside(body);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(out.includes(kept), kept);
});

/* An attribute value that is a whole ident loses its quotes; anything else the quotes were guarding stays. */
for (const [ name, body, kept ] of [
	[ 'a double-quoted ident', '.fs-u1[data-x="foo"] { color: red; }', '.fs-u1[data-x=foo]{color:red}' ],
	[ 'a single-quoted ident', ".fs-u2[data-x='foo'] { color: red; }", '.fs-u2[data-x=foo]{color:red}' ],
	[ 'every operator', '.fs-u3[a~="b"][c|="d"][e^="f"][g$="h"][i*="-j_1"] { color: red; }', '.fs-u3[a~=b][c|=d][e^=f][g$=h][i*=-j_1]{color:red}' ],
	[ 'an ident closing a list entry', '.fs-u4[data-x="a"], .fs-u5[data-y="b"] { color: red; }', '.fs-u4[data-x=a],.fs-u5[data-y=b]{color:red}' ],
	[ 'a digit start', '.fs-k1[data-x="2020"] { color: red; }', '.fs-k1[data-x="2020"]' ],
	[ 'a leading dash and digit', '.fs-k2[data-x="-1"] { color: red; }', '.fs-k2[data-x="-1"]' ],
	[ 'a double dash (mangle-tokens reads it as a name)', '.fs-k3[data-x="--fs-x"] { color: red; }', '.fs-k3[data-x="--fs-x"]' ],
	[ 'a double dash inside the ident', '.fs-k3b[data-x="a--fs-x"] { color: red; }', '.fs-k3b[data-x="a--fs-x"]' ],
	[ 'a space', '.fs-k4[data-x="a b"] { color: red; }', '.fs-k4[data-x="a b"]' ],
	[ 'an empty value', '.fs-k5[data-x=""] { color: red; }', '.fs-k5[data-x=""]' ],
	[ 'a case flag', '.fs-k6[lang|="en" i] { color: red; }', '.fs-k6[lang|="en" i]' ],
	[ 'an escaped quote', '.fs-k7[data-x="a\\"b"] { color: red; }', '.fs-k7[data-x="a\\"b"]' ],
	[ 'an escape', '.fs-k8[data-x="a\\62 c"] { color: red; }', '.fs-k8[data-x="a\\62 c"]' ],
	[ 'a bracket in the value', '.fs-k9[data-x="b]"] { color: red; }', '.fs-k9[data-x="b]"]' ],
	[ 'a value broken from its name by a newline', '.fs-k10[data-x=\n"a"] { color: red; }', '.fs-k10[data-x= "a"]' ],
	[ 'a selector inside a string', '.fs-k11 { content: "[a=\\"b\\"]"; }', 'content:"[a=\\"b\\"]"' ],
]) test(`attribute quotes: ${name}`, () => {
	const { r, out } = buildInside(body);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(out.includes(kept), kept);
});

for (const [ name, body, kept ] of [
	[ 'a space before !important', '.fs-b1 { color: red !important; margin: 0 !important; }', '.fs-b1{color:red!important;margin:0!important}' ],
	[ 'a string holding !important', '.fs-b2 { content: "a !important"; }', 'content:"a !important"' ],
	[ 'a single-colon spelling', '.fs-p1::before, .fs-p2::after { color: red; }', '.fs-p1:before,.fs-p2:after{color:red}' ],
	[ 'an ident that goes on past before', '.fs-p3::beforehand, .fs-p4::after-x { color: red; }', '.fs-p3::beforehand,.fs-p4::after-x{color:red}' ],
	[ 'a pseudo-element that ends its line', '.fs-p5::before\n{ color: red; }', '.fs-p5:before{color:red}' ],
	[ 'a string holding ::before', '.fs-p6 { content: "::before ::after"; }', 'content:"::before ::after"' ],
	[ 'another pseudo-element', '.fs-p7::selection, .fs-p8::first-line { color: red; }', '.fs-p7::selection,.fs-p8::first-line{color:red}' ],
]) test(`squeeze: ${name}`, () => {
	const { r, out } = buildInside(body);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(out.includes(kept), kept);
});

/* A space beside * or / goes only inside a declaration; + and - keep theirs, and so does everything else. */
for (const [ name, body, kept ] of [
	[ 'calc multiply and divide', '.fs-v1 { width: calc(var(--a) * 2 - 1px); height: calc(10px / 4 + 1px); }', 'width:calc(var(--a)*2 - 1px);height:calc(10px/4 + 1px)' ],
	[ 'a minus', '.fs-v2 { width: calc(100% - 8px); }', 'width:calc(100% - 8px)' ],
	[ 'grid-area, ratio and font', '.fs-v3 { grid-area: 1 / 2 / 3 / 4; aspect-ratio: 16 / 9; font: 14px / 1.2 sans-serif; }', 'grid-area:1/2/3/4;aspect-ratio:16/9;font:14px/1.2 sans-serif' ],
	[ 'a keyframe step', '@keyframes fs-v4 { from { width: calc(1px * 2); } }', '@keyframes fs-v4{from{width:calc(1px*2)}}' ],
	[ 'a string', '.fs-v5 { content: "a * b / c"; }', 'content:"a * b / c"' ],
	[ 'a selector', '.fs-v6 * + *, .fs-v7 > * { color: red; }', '.fs-v6 * + *,.fs-v7>*{color:red}' ],
	[ 'a condition', '@supports (width: calc(1px * 2)) { .fs-v8 { color: red; } }', '@supports (width:calc(1px * 2)){.fs-v8{color:red}}' ],
	[ 'a / and a * that would join into a comment opener', '.fs-v9 { --x: a / * b; }', '--x:a/ *b' ],
]) test(`squeeze: spaces beside * and /: ${name}`, () => {
	const { r, out } = buildInside(body);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(out.includes(kept), kept);
});

test('a rule nested in a declaration block fails the build', () => {
	const { r } = buildInside('.fs-n1 { color: red; & .x { color: blue; } }');
	assert.equal(r.status, 1);
	assert.match(r.stderr, /nested in a declaration block/);
});

/* Only the exact triples with a keyword form are rewritten; each result means the same declaration. */
for (const [ from, to ] of [
	[ 'flex: 0 0 auto', 'flex:none' ],
	[ 'flex: 1 1 auto', 'flex:auto' ],
	[ 'flex: 0 1 auto', 'flex:0 auto' ],
	[ 'flex: 1 1 100%', 'flex:100%' ],
	[ 'flex: 1 1 12rem', 'flex:12rem' ],
	[ 'flex: 1 1 .5em', 'flex:.5em' ],
	[ 'flex: 1 1 auto !important', 'flex:auto!important' ],
	[ 'flex:\n\t1 1\n\tauto', 'flex:auto' ],
	[ 'flex: 1 1 0', 'flex:1 1 0' ],
	[ 'flex: 1', 'flex:1' ],
	[ 'flex: 1 0 auto', 'flex:1 0 auto' ],
	[ 'flex: 2 1 auto', 'flex:2 1 auto' ],
	[ 'flex: 1 1 calc(100% - 1px)', 'flex:1 1 calc(100% - 1px)' ],
	[ 'flex: 1 1 var(--x)', 'flex:1 1 var(--x)' ],
	[ '--flex: 0 0 auto', '--flex:0 0 auto' ],
	[ 'flex-basis: 1 1 auto', 'flex-basis:1 1 auto' ],
	[ 'content: "x"; flex: 0 0 auto', 'content:"x";flex:none' ],
	[ 'content: "flex: 0 0 auto"', 'content:"flex: 0 0 auto"' ],
]) test(`squeeze: ${from.replace(/\s+/g, ' ')}`, () => {
	const { r, out } = buildInside(`.fs-f1 { ${from}; }`);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(out.includes(`.fs-f1{${to}}`), to);
});

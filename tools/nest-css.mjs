// nest-css.mjs <cascade.css>: fold runs of consecutive rules that share a selector prefix into one nested
// rule, in place, after minify-css.mjs and before mangle-tokens.sh. Needs relaxed nesting (a nested
// selector may start with a type or a combinator): Chrome 120, Firefox 117, Safari 17.2, the floor in
// docs/css.md "The browser floor". Same rules in the same order, so the cascade is unchanged:
//   * only rules adjacent in one block are folded; nothing moves across another rule or block.
//   * the prefix P is one complex selector ending before a top-level combinator, never a list and
//     never holding a pseudo-element, so the nested `:is(P) X` has `P X`'s own specificity.
// Input is lightningcss's minified output: no comments but a /*! banner, no whitespace but inside
// selectors and values.
import { readFileSync, writeFileSync } from 'node:fs';
import { transform } from 'lightningcss';

// ---- parse: a block is a list of {sel, decls} rules, {at, kids} grouping at-rules and {raw} leaves ----
function parse(css) {
	let i = 0;
	const n = css.length;
	// the end of a prelude or declaration list: the next top-level `{`, `}` or `;` outside strings/parens
	function scan(stops) {
		const s = i;
		let d = 0, q = null;
		for (; i < n; i++) {
			const c = css[i];
			if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
			if (c === '"' || c === "'") q = c;
			else if (c === '(' || c === '[') d++;
			else if (c === ')' || c === ']') d--;
			else if (d === 0 && stops.includes(c)) break;
		}
		return css.slice(s, i);
	}
	function block() {
		const out = [];
		while (i < n && css[i] !== '}') {
			if (css.startsWith('/*', i)) { const e = css.indexOf('*/', i) + 2; out.push({ raw: css.slice(i, e) }); i = e; continue; }
			if (/\s/.test(css[i])) { out.push({ raw: css[i] }); i++; continue; }
			const pre = scan('{;}');
			if (css[i] === ';' || css[i] === '}' || i >= n) { if (css[i] === ';') i++; out.push({ raw: pre + ';' }); continue; }
			i++; // {
			if (pre[0] === '@' && /^@(media|supports|container|layer|scope|starting-style|document)\b/.test(pre)) {
				const kids = block(); i++; out.push({ at: pre, kids });
			} else if (pre[0] === '@') {
				const s = i; let d = 1, q = null;
				for (; i < n && d; i++) { const c = css[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; } if (c === '"' || c === "'") q = c; else if (c === '{') d++; else if (c === '}') d--; }
				out.push({ raw: pre + '{' + css.slice(s, i) });
			} else {
				const decls = scan('}'); i++;
				if (decls.includes('{')) throw new Error('nest-css: input is already nested at ' + pre.slice(0, 60));
				out.push({ sel: pre, decls });
			}
		}
		return out;
	}
	const root = block();
	if (i < n) throw new Error('nest-css: unbalanced } at ' + i);
	return root;
}

function splitTop(sel, sep = ',') {
	const out = []; let d = 0, q = null, cur = '';
	for (let i = 0; i < sel.length; i++) {
		const c = sel[i];
		if (q) { cur += c; if (c === '\\') cur += sel[++i]; else if (c === q) q = null; continue; }
		if (c === '"' || c === "'") q = c;
		else if (c === '(' || c === '[') d++;
		else if (c === ')' || c === ']') d--;
		if (c === sep && d === 0) { out.push(cur); cur = ''; continue; }
		cur += c;
	}
	out.push(cur);
	return out;
}
// candidate prefix lengths: each top-level combinator position (' ', '>', '+', '~') in s
function cuts(s) {
	const b = []; let d = 0, q = null;
	for (let i = 1; i < s.length; i++) {
		const c = s[i];
		if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
		if (c === '"' || c === "'") q = c;
		else if (c === '(' || c === '[') d++;
		else if (c === ')' || c === ']') d--;
		else if (d === 0 && ' >+~'.includes(c) && !' >+~'.includes(s[i - 1])) b.push(i);
	}
	return b;
}
// `item` under prefix P: what follows P's combinator (a descendant space is dropped), or null
function child(item, P) {
	if (item.length <= P.length + 1 || !item.startsWith(P) || !' >+~'.includes(item[P.length])) return null;
	const rest = item.slice(P.length);
	return rest[0] === ' ' ? rest.slice(1) : rest;
}

const ser = (b) => b.map((x) => x.raw ?? (x.at !== undefined ? x.at + '{' + ser(x.kids) + '}'
	: x.kids ? x.sel + '{' + ser(x.kids) + '}' : x.sel + '{' + x.decls + '}')).join('');

function nest(block) {
	for (const x of block) if (x.at !== undefined) x.kids = nest(x.kids);
	const out = [];
	let i = 0;
	while (i < block.length) {
		const r = block[i];
		if (r.sel === undefined || r.kids) { out.push(r); i++; continue; }
		const first = splitTop(r.sel)[0];
		let best = null;
		for (const c of cuts(first)) {
			const P = first.slice(0, c);
			if (P.includes('::') || /:(before|after|first-line|first-letter)\b/.test(P)) continue;
			const prev = out[out.length - 1];
			let j = i, saved = -(P.length + 2) + (prev && prev.sel === P && !prev.kids ? P.length + 1 : 0);
			const sels = [];
			while (j < block.length && block[j].sel !== undefined && !block[j].kids) {
				const ch = splitTop(block[j].sel).map((s) => child(s, P));
				if (ch.includes(null)) break;
				const s = ch.join(',');
				saved += block[j].sel.length - s.length;
				sels.push(s);
				j++;
			}
			if (j - i >= 2 && saved > 0 && (!best || saved > best.saved)) best = { P, j, saved, sels };
		}
		if (!best) { out.push(r); i++; continue; }
		const kids = block.slice(i, best.j).map((x, k) => ({ sel: best.sels[k], decls: x.decls }));
		// `P{d}` right before the run becomes the group's own declarations (they stay first, as they were)
		const prev = out[out.length - 1];
		if (prev && prev.sel === best.P && !prev.kids) { out.pop(); kids.unshift({ raw: prev.decls + ';' }); }
		out.push({ sel: best.P, kids: nest(kids) });
		i = best.j;
	}
	return out;
}

const file = process.argv[2];
if (!file) { console.error('usage: nest-css.mjs <cascade.css>'); process.exit(1); }
const src = readFileSync(file, 'utf8');
const tree = parse(src);
if (ser(tree) !== src) { console.error('nest-css: the parse does not round-trip — refusing'); process.exit(1); }
const out = ser(nest(tree));

// Self-check: lightningcss un-nests both sheets for a pre-nesting target; split into one line per
// (block, selector, sorted declarations) they must match in order. It may merge adjacent rules
// differently on each side, which the per-selector split cancels.
function rules(css) {
	const flat = transform({ filename: 'x.css', code: Buffer.from(css), minify: true, targets: { chrome: 100 << 16 } }).code.toString();
	const lines = [];
	const walk = (b, ctx) => {
		for (const x of b) {
			if (x.at !== undefined) walk(x.kids, ctx + x.at + '|');
			else if (x.sel !== undefined) {
				const d = splitTop(x.decls, ';').sort().join(';');
				for (const s of splitTop(x.sel)) lines.push(ctx + s + '{' + d);
			}
		}
	};
	walk(parse(flat), '');
	return lines;
}
const a = rules(src), b = rules(out);
const bad = a.findIndex((l, k) => l !== b[k]);
if (bad >= 0 || a.length !== b.length) {
	console.error('nest-css: the nested sheet does not un-nest to the same rules — refusing');
	console.error('  was: ' + (a[bad] || '').slice(0, 200) + '\n  now: ' + (b[bad] || '').slice(0, 200));
	process.exit(1);
}
writeFileSync(file, out);
console.log(`nest-css: ${Buffer.byteLength(src)} -> ${Buffer.byteLength(out)} bytes`);

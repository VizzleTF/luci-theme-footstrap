#!/usr/bin/env node
/* Every (widget, container) pair the stylesheet lays out differently must be in docs/gallery.html.
 *
 * The gallery is the oracle a11y, computed-diff, pseudo-loc and smoke measure: a widget absent from
 * a container is measured nowhere. A ui.ComboButton in a stacked `td.cbi-section-actions` was
 * absent, its rule shipped unmeasured, and the arrow wrapped under the label on a router.
 *
 * CONTAINERS ARE READ FROM styles/, never listed: every selector whose subject is a WIDGETS class
 * and which has an ancestor chain is a pair, keyed by that chain. The gallery is parsed without a
 * browser and each chain is matched against the real ancestry of a widget element (tags and classes;
 * states, pseudos and attributes are dropped). WIDGETS is the only hand list: ui.js classes with a
 * layout of their own, folded into families so `cbi-button-apply` and `btn` count as one widget. */
import { fileURLToPath } from 'node:url';
import * as csstree from 'css-tree';

import { read, filesIn } from './lib/root.mjs';
import { GALLERY_FLOOR, blankGallery } from './lib/gallery.mjs';

const PKG = 'luci-theme-footstrap';
/* pairs derived from styles/ today; the floor stays far under it so a rule added or removed never trips it */
const PAIRS_MEASURED = 36;
const PAIRS_FLOOR = 15;
/* ui.js (openwrt/luci modules/luci-base): the class each widget's constructor puts on its root. */
const FAMILY = [
	[ /^(cbi-button(-.*)?|btn)$/, 'cbi-button' ], /* ui.Button, ui.ComboButton's face, form.Button */
	[ /^cbi-input-/, 'cbi-input' ], /* ui.Textfield, ui.Select, ui.Hiddenfield */
	[ /^cbi-(dropdown|checkbox|radio|dynlist|select|progressbar|tooltip|range-slider|filebrowser|tabmenu)$/, null ],
];
const familyOf = (cls) => { for (const [ re, f ] of FAMILY) if (re.test(cls)) return f ?? cls; return null; };

/* Pairs deliberately not shown, each with the reason. A stale entry (the pair now present, or no
 * longer derived) fails too, so the list cannot rot. */
export const ALLOW = new Map([
	[ 'cbi-dropdown in .table.cbi-section-table .td.cbi-section-actions >', '@mirror twin of the stacked-table rule; LuCI wraps section-table row actions in a div (form.js:3186), only 60_wifi.js\'s own table puts a ComboButton directly in the cell — that pair is covered' ],
	[ 'cbi-radio in .cbi-value-field > div >', 'no ui.js/form.js class emits cbi-radio at the pin; an old-template shape, kept styled' ],
	[ 'cbi-select in .table.cbi-section-table', 'cbi-select is the non-JS template fallback, never rendered inside a section table by ui.js' ],
	[ 'cbi-select in .table.cbi-section-table .td.cbi-section-table-cell', 'same: the fallback select, not a ui.Select' ],
	[ 'cbi-button in .fs-login .cbi-page-actions', '.fs-login is the login template\'s chrome; the gallery has no header.ut/sysauth.ut' ],
	[ 'cbi-button in .fs-main .alert-message', '.fs-main is header.ut chrome; live-audit and spa-parity read the page that has it' ],
]);

const VOID = new Set([ 'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr' ]);

/* -> [{ tag, cls: Set, parent, depth }] for every element; a hand-written page, so a tag scan is
 * enough. Comments, script and style bodies are blanked first. */
export function elementsOf(html) {
	const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
	const out = [];
	let top = null;
	for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
		const tag = m[2].toLowerCase();
		if (m[1]) {
			for (let e = top; e; e = e.parent) if (e.tag === tag) { top = e.parent; break; }
			continue;
		}
		const cm = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[3]);
		const el = { tag, cls: new Set((cm ? cm[1] ?? cm[2] : '').split(/\s+/).filter(Boolean)), parent: top };
		out.push(el);
		if (!VOID.has(tag) && !m[3].endsWith('/')) top = el;
	}
	return out;
}

const compound = (c) => ({ tag: c.find((n) => n.type === 'TypeSelector')?.name.toLowerCase(),
	cls: c.filter((n) => n.type === 'ClassSelector').map((n) => n.name) });
const text = (c) => (c.tag ?? '') + c.cls.map((x) => `.${x}`).join('');

/* The pairs ONE selector yields: [] for a bare subject, a sibling combinator, a widget inside a
 * widget (its internals, not a container), or no widget subject. A compound with nothing to match
 * (`:root`, `[data-x]`) is dropped before a descendant combinator and kept as `*` before `>`. */
function pairsOfSelector(sel) {
	const parts = [ [] ], combs = [];
	sel.children.forEach((n) => {
		if (n.type !== 'Combinator') { parts.at(-1).push(n); return; }
		combs.push(n.name.trim() || ' '); parts.push([]);
	});
	if (parts.length < 2 || combs.some((c) => c === '+' || c === '~')) return [];
	const cs = parts.map(compound);
	const chain = [];
	cs.slice(0, -1).forEach((c, i) => {
		if (c.tag || c.cls.length) chain.push({ ...c, comb: combs[i] });
		else if (combs[i] === '>') chain.push({ tag: '*', cls: [], comb: '>' });
	});
	while (chain[0]?.tag === '*' && chain[0].comb !== '>') chain.shift(); /* a leading `*` constrains nothing */
	if (!chain.length || chain.some((c) => c.cls.some(familyOf))) return [];
	const key = (w) => `${w} in ${chain.map((c) => text(c) + (c.comb === '>' ? ' >' : '')).join(' ')}`;
	return [ ...new Set(cs.at(-1).cls.map(familyOf).filter(Boolean)) ].map((w) => [ key(w), { widget: w, chain } ]);
}

/* -> Map(key -> { widget, chain, where }) from the CSS text. Only a rule's own selector list is read:
 * a selector inside `:has()`/`:not()` is relative and says nothing about ancestry. */
export function pairsOf(css, file = '') {
	const pairs = new Map();
	csstree.walk(csstree.parse(css, { positions: true }), { visit: 'Rule', enter(rule) {
		if (rule.prelude.type !== 'SelectorList') return;
		for (const sel of rule.prelude.children)
			for (const [ k, v ] of pairsOfSelector(sel))
				if (!pairs.has(k)) pairs.set(k, { ...v, where: `${file}:${sel.loc.start.line}` });
	} });
	return pairs;
}

const hit = (el, c) => (!c.tag || c.tag === '*' || c.tag === el.tag) && c.cls.every((x) => el.cls.has(x));
/* does `el` have the ancestry `chain` (last entry nearest)? */
function under(el, chain, i = chain.length - 1) {
	if (i < 0) return true;
	const c = chain[i];
	for (let a = el.parent; a; a = a.parent) {
		if (hit(a, c) && under(a, chain, i - 1)) return true;
		if (c.comb === '>') return false;
	}
	return false;
}

/* -> keys of pairs with no widget element in the page, minus the allowlist's */
export function missing(pairs, els) {
	return [ ...pairs ].filter(([ , p ]) => !els.some((e) => [ ...e.cls ].some((c) => familyOf(c) === p.widget) && under(e, p.chain)))
		.map(([ k ]) => k);
}

function gate() {
	const pairs = new Map();
	for (const f of filesIn(PKG + '/styles', '.css'))
		for (const [ k, v ] of pairsOf(read(f), f)) if (!pairs.has(k)) pairs.set(k, v);
	const els = elementsOf(read('docs/gallery.html'));
	const bad = [];
	if (els.length < GALLERY_FLOOR) bad.push(blankGallery(els.length));
	if (pairs.size < PAIRS_FLOOR) bad.push(`derived only ${pairs.size} pair(s) from styles/ (last real run: ~${PAIRS_MEASURED}); the selector walk found nothing, which is not "covered"`);
	const gone = missing(pairs, els);
	for (const k of gone) if (!ALLOW.has(k)) bad.push(`${k}\n    styled at ${pairs.get(k).where}; no such element in docs/gallery.html.`
		+ ' Add the real upstream markup in that container, or an ALLOW entry with the reason.');
	for (const [ k, why ] of ALLOW) {
		if (!pairs.has(k)) bad.push(`ALLOW "${k}" matches no selector in styles/ any more (${why}); delete it`);
		else if (!gone.includes(k)) bad.push(`ALLOW "${k}" is now in the gallery (${why}); delete it`);
	}
	if (bad.length) {
		console.error(`gallery-coverage: ${bad.length} problem(s)\n  ${bad.join('\n  ')}`);
		process.exit(1);
	}
	console.log(`gallery-coverage: ${pairs.size} (widget, container) pairs from styles/, ${pairs.size - ALLOW.size} in the gallery, ${ALLOW.size} allowed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) gate();

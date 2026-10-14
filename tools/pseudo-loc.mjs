#!/usr/bin/env node
/* Pseudo-localisation gate: every other gate renders English, so a box sized for the English string
 * ships broken in Russian. This renders `docs/gallery.html` (tools/lib/gallery.mjs) with every
 * visible text and text attribute grown (+45% per word, accented, bracketed; a pure function of its
 * input) at 320 and 390 CSS px across three densities, plus one 390 dir=rtl point. Three shapes, read
 * off real layout: `self` (scrollWidth past clientWidth on a non-scrolling element), `parent` (a
 * normal-flow box past its parent's edge) and `clip` (clipped by an ancestor with no scrollbar).
 * Each is measured in English and again after growing; only a finding that GREW past `--eps` is
 * reported. The ALLOW list, the 2px floor and the proof it bites: docs/development.md, "The three
 * cheap browser gates".
 *
 *   node tools/pseudo-loc.mjs
 *   node tools/pseudo-loc.mjs --widths 320,390 --densities normal,compact,large --eps 2
 *   node tools/pseudo-loc.mjs --verbose        # print every finding, not just the first 8 per kind
 */
import { chromium } from 'playwright';
import { serveGallery, assertRendered, settle } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('pseudo-loc', {
	widths: { type: 'string', default: '320,390' },
	densities: { type: 'string', default: 'normal,compact,large' },
	eps: { type: 'string', default: '2' },
	verbose: { type: 'boolean', default: false },
});
const VERBOSE = FLAGS.verbose;

/* 320 is the narrowest reflow WCAG 1.4.10 requires; 390 is the modal phone point every other
 * gallery gate reaches for on a phone-width claim (computed-diff.mjs, live-audit.mjs). */
const WIDTHS = FLAGS.widths.split(',').map(Number);
/* null = bare :root (normal). Density=Large exposed the English half of the toggle-knob bug. */
const DENSITIES = FLAGS.densities.split(',').map((d) => (d === 'normal' ? null : d));
/* The intact tree's noise floor: 2px of border/padding rounding (docs/development.md, "The three
 * cheap browser gates"). Lower it only after the intact tree passes at the new value. */
const EPS = Number(FLAGS.eps);

/* Accepted exceptions, each with its reason in docs/development.md, "The three cheap browser gates".
 * A selector added here needs the same one-line justification as an a11y-gallery.mjs `.exclude()`:
 * which contract owns this, and why it is not a theme fault this gate should raise. */
const ALLOW = [
	/* `:not()` carves the row-action cell back out, so its buttons (a flex-sizing fault fixed in
	 * theme/55-buttons.css) are measured; the data cells keep the exemption. */
	'.table', '.table *:not(.cbi-section-actions, .cbi-section-actions *)',
	'.cbi-dropdown > ul > li', '.cbi-dropdown > ul > li *',
	'label[for="g-longlabel"]',
	'.cbi-filebrowser > p', '.cbi-filebrowser > p *',
	'.cbi-tabmenu > li > a', '.cbi-tabmenu > li > a *',
	'.cbi-progressbar',
	'.cbi-filebrowser > ul > li > div:first-child', '.cbi-filebrowser > ul > li > div:first-child *',
	/* `scrollWidth` is cumulative, so each of the three exceptions above pushes its container over.
	 * A container is excused by `:has()` only while it holds that leaf, not by a blanket climb. */
	':is(.cbi-value, .cbi-section-node, .cbi-section, .g-sec):has(#g-longlabel)',
	':is(.cbi-value, .cbi-value-field, .g-sec):has(.cbi-progressbar)',
	':is(.cbi-section, .alert-message, .g-sec):has(.table)',
	/* `.g-wrap` is the gallery's own scaffolding; its scrollWidth is the widest of the 22 sections, so
	 * the three permanent exceptions above keep it from telling a new regression apart. */
	'.g-wrap',
];

/* Gallery chrome (docs/gallery.html: ".g-* — gallery chrome only"): its text tests the gallery's own
 * 1180px wrapper, not a widget. Skipped from pseudo-localisation only; a `.g-sec` is still measured. */
const SKIP_TEXT = ['.g-bar', '.g-sec > h2', '.g-note'];

/* ---- pseudo-localisation, run INSIDE the page ---- */
function pseudoLocalize(skipText) {
	const ACCENT = {
		a: 'á', c: 'ç', d: 'đ', e: 'é', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ĺ', n: 'ñ',
		o: 'ó', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', w: 'ŵ', y: 'ý', z: 'ž',
		A: 'Á', C: 'Ç', D: 'Đ', E: 'É', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ĺ', N: 'Ñ',
		O: 'Ó', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', W: 'Ŵ', Y: 'Ý', Z: 'Ž',
	};
	const accent = (s) => { let out = ''; for (const ch of s) out += ACCENT[ch] || ch; return out; };
	/* Deterministic, so a failure reproduces. Each WORD grows by 45%, filler drawn from its own
	 * letters so no break opportunity is added; 45% sits inside the 1.3-1.6x measured for Russian
	 * once the bracket is counted. Words of 20+ characters, without a letter, or of 3 letters or
	 * fewer are left alone: docs/development.md, "The three cheap browser gates". */
	function pseudo(s) {
		const core = s.trim();
		if (!core) return s;
		const lead = s.slice(0, s.length - s.trimStart().length);
		const trail = s.slice(s.trimEnd().length);
		const parts = core.split(/(\s+)/);
		const grown = parts.map((w) => {
			if (!w || /^\s+$/.test(w)) return w;
			/* a number, a percentage or a bare `/` keeps its digits; a unit symbol (dBm, MiB) is
			 * invariant across locales (ISO 80000) and stays unaccented too */
			if (w.length <= 3 || w.length >= 20 || !/\p{L}/u.test(w)) return w;
			const extra = Math.max(1, Math.round(w.length * 0.45));
			let filler = '';
			for (let i = 0; i < extra; i++) filler += w[i % w.length];
			return accent(w + filler);
		});
		return `${lead}[${grown.join('')}]${trail}`;
	}

	const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
	const skipped = (el) => skipText.some((sel) => el.closest(sel));

	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (!node.data.trim()) return NodeFilter.FILTER_REJECT;
			const p = node.parentElement;
			if (!p || SKIP_TAGS.has(p.tagName) || skipped(p)) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	const nodes = [];
	let n;
	while ((n = walker.nextNode())) nodes.push(n);
	for (const node of nodes) node.data = pseudo(node.data);

	/* Attribute-carried visible text: a button's VALUE is its only label, and placeholder, title and
	 * aria-label are what a reader or tooltip shows; a dropdown value is a `<li>` text node above. */
	let count = nodes.length;
	for (const el of document.querySelectorAll('input[type=button], input[type=submit], input[type=reset]')) {
		if (skipped(el) || !el.value.trim()) continue;
		el.value = pseudo(el.value);
		count++;
	}
	for (const attr of ['placeholder', 'title', 'aria-label']) {
		for (const el of document.querySelectorAll(`[${attr}]`)) {
			if (skipped(el) || !el.getAttribute(attr).trim()) continue;
			el.setAttribute(attr, pseudo(el.getAttribute(attr)));
			count++;
		}
	}
	return count;
}

/* ---- MEASURE: run INSIDE the page twice. Phase 'before' stashes the numbers on `window` (a Map keyed
 * by DOM node cannot cross the Node/browser boundary, and pseudoLocalize() only rewrites text, so
 * the references stay valid); phase 'after' reports a finding only if it exceeds the absolute
 * tolerance AND grew by more than `eps` since 'before'. ---- */
function MEASURE({ allow, eps, phase }) {
	const vis = (el) => {
		const cs = getComputedStyle(el);
		/* a descendant of a `display: none` ancestor (a collapsed submenu) has zero client rects
		 * though its own `display` is ordinary: both it and an empty box read as not visible */
		return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
	};
	const label = (el) => {
		const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
		return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : cls ? `.${cls}` : '');
	};
	const scrolls = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX + getComputedStyle(el).overflowY);
	/* An ALLOW entry excuses only the elements its selector matches, never their ancestors: an
	 * ancestor climb left 311 of 822 elements unmeasurable. A subtree is written out explicitly
	 * (`.table *`); docs/development.md, "The three cheap browser gates". */
	const excluded = new Set();
	for (const sel of allow) for (const match of document.querySelectorAll(sel)) excluded.add(match);
	const allowed = (el) => excluded.has(el);
	/* reachable via a scroller on the element or any ancestor: the `.g-overwide` fixtures are built
	 * not to fit, and a check that stopped at the parent would flag every descendant */
	const inScroller = (el) => { for (let p = el; p; p = p.parentElement) if (scrolls(p)) return true; return false; };
	const all = [...document.body.querySelectorAll('*')].filter((el) => vis(el) && !allowed(el));
	const rtl = document.documentElement.dir === 'rtl';

	/* 1. SELF: an element's own content past its own box, on an element that cannot scroll to it.
	 * `scrollWidth` on an `overflow: visible` box still measures an absolutely-positioned
	 * descendant poking past the padding box (the switch pill's `::after` knob). */
	const self = new Map();
	for (const el of all) {
		if (inScroller(el)) continue;
		self.set(el, { by: el.scrollWidth - el.clientWidth });
	}

	/* 2. PARENT: a normal-flow box whose end edge (the left one under dir=rtl) sits past its parent's.
	 * Absolute and fixed boxes are skipped: a dropdown caret or tooltip arrow is meant to. */
	const parent = new Map();
	for (const el of all) {
		const p = el.parentElement;
		if (!p || inScroller(el) || allowed(p)) continue;
		const pos = getComputedStyle(el).position;
		if (pos === 'absolute' || pos === 'fixed') continue;
		const r = el.getBoundingClientRect();
		if (!r.width) continue;
		const pr = p.getBoundingClientRect();
		parent.set(el, { by: rtl ? pr.left - r.left : r.right - pr.right, p });
	}

	/* 3. CLIP: content clipped by an ancestor with no scrollbar to reach it, the severe case. Walked
	 * up from every element (unlike live-audit's `clipped`, which trusts a few classes, since this
	 * text is only ever the theme's own). The climb stops at the first non-scrolling clipping
	 * ancestor, so both phases diff the same box. */
	const clip = new Map();
	for (const el of all) {
		const r = el.getBoundingClientRect();
		if (!r.width && !r.height) continue;
		for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
			if (allowed(p)) break;
			const cs = getComputedStyle(p);
			const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
			const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
			if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) break;
			if (!clipsX && !clipsY) continue;
			const pr = p.getBoundingClientRect();
			let by = 0;
			if (clipsX) by = Math.max(by, r.right - pr.right, pr.left - r.left);
			if (clipsY) by = Math.max(by, r.bottom - pr.bottom);
			clip.set(el, { by, p });
			break;
		}
	}

	if (phase === 'before') {
		window.__pseudoLocBefore = { self, parent, clip };
		return [];
	}

	const before = window.__pseudoLocBefore;
	delete window.__pseudoLocBefore;
	const grew = (kind, el, by) => by - (before[kind].get(el)?.by || 0) > eps;
	const round = (n) => `${Math.round(n * 100) / 100}px`;
	const out = [];
	for (const [el, { by }] of self) {
		/* Tolerance is EPS plus the element's own horizontal margin: a meter's reading sits in a margin
		 * the bar reserves (80px on the dBm fixture; an unmodified "-55.9 dBm" reads 68px otherwise).
		 * Max(0, …) keeps a NEGATIVE overlap margin (`.zonebadge .cbi-tooltip`) from widening the pass. */
		const cs = getComputedStyle(el);
		const margin = Math.max(0, (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0));
		if (by > eps + margin && grew('self', el, by)) out.push({ kind: 'self', el: label(el), by: `${by}px`, html: el.outerHTML.slice(0, 160) });
	}
	for (const [el, { by, p }] of parent) {
		if (by > eps && grew('parent', el, by)) out.push({ kind: 'parent', el: label(el), by: round(by), parent: label(p) });
	}
	for (const [el, { by, p }] of clip) {
		if (by > eps && grew('clip', el, by)) out.push({ kind: 'clip', el: label(el), by: round(by), ancestor: label(p) });
	}
	return out;
}

const { base, close } = await serveGallery(buildCss());
const browser = await chromium.launch();

const findings = [];
let elementsWalked = 0;

/* One extra point, 390 normal with dir=rtl lang=ar: the end edge is the left one, and the unmirrored
 * `parent` check reports 2 false `input inside label by 4px` on the clean sheet. */
const POINTS = WIDTHS.flatMap((width) => DENSITIES.map((density) => ({ width, density, rtl: false })))
	.concat({ width: 390, density: null, rtl: true });

for (const { width, density, rtl } of POINTS) {
	const page = await browser.newPage({ viewport: { width, height: 1400 } });
	await page.goto(base, { waitUntil: 'load' });
	if (rtl) await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; });
	if (density) await page.evaluate((d) => document.documentElement.setAttribute('data-density', d), density);
	await settle(page);
	await assertRendered(page);

	/* BEFORE: numbers on the untouched English page, stashed on `window` (see MEASURE) */
	await page.evaluate(MEASURE, { allow: ALLOW, eps: EPS, phase: 'before' });

	elementsWalked = await page.evaluate(pseudoLocalize, SKIP_TEXT);
	await settle(page);

	/* AFTER: only a finding that exceeds the tolerance and grew past `eps` since BEFORE is reported */
	const rows = await page.evaluate(MEASURE, { allow: ALLOW, eps: EPS, phase: 'after' });
	const label = `${width}px/${density || 'normal'}${rtl ? '/rtl' : ''}`;
	for (const row of rows) findings.push({ ...row, at: label });
	await page.close();
}

await browser.close();
close();

console.log(`pseudo-loc: docs/gallery.html, ${elementsWalked} string(s) pseudo-localised per run, `
	+ `${POINTS.length} point(s) (${POINTS.map((p) => `${p.width}/${p.density || 'normal'}${p.rtl ? '/rtl' : ''}`).join(' ')}), eps=${EPS}px`);

if (!findings.length) {
	console.log('pseudo-loc: no overflow at any point — clean sheet.');
	process.exit(0);
}

const byKind = new Map();
for (const f of findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind).push(f); }

const KIND_NAME = { self: 'self-overflow (scrollWidth > clientWidth)', parent: 'escapes its parent', clip: 'clipped by an ancestor with no scroller' };
for (const [kind, rows] of byKind) {
	console.error(`\n${rows.length} ${KIND_NAME[kind] || kind} finding(s):`);
	const shown = VERBOSE ? rows : rows.slice(0, 8);
	for (const r of shown) {
		const extra = r.parent ? ` inside ${r.parent}` : r.ancestor ? ` inside ${r.ancestor}` : '';
		console.error(`  ${r.at}  ${r.el}${extra}  by ${r.by}${r.html ? `  ${r.html}` : ''}`);
	}
	if (!VERBOSE && rows.length > shown.length) console.error(`  … and ${rows.length - shown.length} more (--verbose)`);
}
console.error(`\npseudo-loc: ${findings.length} overflow finding(s) — an element, the width, the density and the ` +
	'measured overflow are above. Read docs/development.md, "The three cheap browser gates: smoke, ' +
	'computed-diff and pseudo-loc", for what each kind means and what to do.');
process.exit(1);

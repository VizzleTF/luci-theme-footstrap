/* Prove a CSS change by diffing computed styles, on the gallery instead of a router (docs/css.md):
 * load it once per side, snapshot getComputedStyle over every element and its ::before/::after, diff
 * the two, so any difference was caused by the CSS. Both sides are the SHIPPED sheet (build-css.sh,
 * then mangle-tokens.sh: lib/css.mjs `shipped`), each in its own document, because two sheets can map
 * the private tokens differently and a gallery renamed for one reads the wrong tokens under the other.
 *
 * A live router moves 0.5-1.3% of pixels on the same sheet twice; docs/gallery.html has no clock,
 * poll or data, so `--control` (the SAME stylesheet on both sides) must report exactly 0, the
 * measured threshold. It does not replace the live run: no page, no header.ut chrome, no
 * third-party sheet (docs/development.md, "The three cheap browser gates").
 *
 *   node tools/computed-diff.mjs                 # worktree vs HEAD, light + dark, both viewports
 *   node tools/computed-diff.mjs --control       # the same sheet twice: the threshold, must be 0
 *   node tools/computed-diff.mjs --against v0.15.0 --full --max 0
 */
import { chromium } from 'playwright';
import { serveGallery, applyAppearance, matrix, settle, GALLERY_FLOOR, blankGallery } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';
import { parseFlags } from './lib/util.mjs';

const FLAGS = parseFlags('computed-diff', {
	control: { type: 'boolean', default: false },
	full: { type: 'boolean', default: false },
	against: { type: 'string', default: 'HEAD' },
	max: { type: 'string' },
});

const CONTROL = FLAGS.control;
const REF = FLAGS.against;
const MAX = FLAGS.max ?? null;
if (MAX !== null && !/^\d+$/.test(MAX)) { console.error(`computed-diff: --max wants a non-negative integer, got "${MAX}"`); process.exit(2); }
const POINTS = FLAGS.full
	? matrix([null])
	: [{ palette: 'footstrap', mode: 'light', tint: null }, { palette: 'footstrap', mode: 'dark', tint: null }];

/* 1280 is every page's design width; 390x844 is the phone point. With the flex-shrink:0 fix
 * reverted, the switch pill (styles/theme/60-inputs.css) stays 40.00px at 1280 (0 diffs) and splits
 * 40.00px vs 26.80px at 390, a difference the 1280 pass cannot see. */
const VIEWPORTS = [
	{ width: 1280, height: 900, label: '1280' },
	{ width: 390, height: 844, label: '390' },
];

/* Two more passes beside the plain ones, each a state the plain passes never enter: `fc` emulates
 * forced-colors: active at 1280, where the 95-a11y-media.css repairs live (a repair whose selector
 * stopped reaching its element changes nothing in the other passes); `rtl` sets dir=rtl lang=ar at
 * 390, where a physical margin-left / padding-left that should be logical computes differently, and
 * a background-position (no logical keyword) that was not mirrored by hand stays put.
 * Each has the first appearance point only — forced colors overrides the palette, and a direction
 * flip does not depend on it. */
const PASSES = [
	...VIEWPORTS.map((vp) => ({ vp, kind: '', all: true })),
	{ vp: VIEWPORTS[0], kind: 'fc', all: false },
	{ vp: VIEWPORTS[1], kind: 'rtl', all: false },
];

/* The properties read on every element. This list IS the contract: a property missing from it is a
 * regression this gate cannot see, so add rather than trim. Layout first, then box, then ink — the
 * four bugs docs/css.md credits to this method were a font-family, a max-width, a height/padding
 * pair from two rules, and a lost text-align, one in each group. */
const PROPS = [
	'display', 'position', 'visibility', 'opacity', 'z-index', 'float', 'clear',
	'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
	'top', 'right', 'bottom', 'left',
	'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
	'border-top-style', 'border-top-color', 'border-bottom-color', 'border-radius',
	'box-shadow', 'outline-width', 'outline-color', 'outline-offset',
	'color', 'background-color', 'background-image', 'background-position',
	'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
	'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'overflow-wrap',
	'overflow-x', 'overflow-y',
	'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
	'align-items', 'justify-content', 'gap',
	'grid-template-columns', 'grid-auto-flow',
	'transform', 'transition-property', 'content', 'vertical-align', 'mask-image', '-webkit-mask-image',
	'user-select', '-webkit-user-select', 'pointer-events', 'cursor', 'touch-action',
];

/* One document's readings: a row of PROPS per element, and a row per ::before/::after that
 * generates content (the glyphs, chevrons, switch knobs and poll mask live there). */
const snapshot = ({ props, pseudos }) => {
	/* The 13 `.spinning` buttons turn their ::before forever (fs-spin); two loads catch it at two
	 * angles, 13 phantom `transform` differences per pass. Frozen at frame 0 on both sides. */
	for (const an of document.getAnimations()) {
		if (an.effect.getComputedTiming().iterations === Infinity) { an.pause(); an.currentTime = 0; }
	}
	const els = document.querySelectorAll('*');
	const read = (cs) => props.map((p) => cs.getPropertyValue(p));
	const rows = [], names = [], pseudo = {};
	els.forEach((e, i) => {
		rows.push(read(getComputedStyle(e)));
		const cls = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
		names.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (cls ? '.' + cls : ''));
		for (const pe of pseudos) {
			const cs = getComputedStyle(e, pe);
			if (cs.content !== 'none' && cs.content !== 'normal') pseudo[i + pe] = read(cs);
		}
	});
	return { rows, names, pseudo };
};

/* A pseudo-element a side does not generate has no row: against one that does it is one `content`
 * difference (the rule appeared or vanished), not a row of properties compared with nothing. */
const diffSnapshots = (A, B, cap) => {
	if (A.rows.length !== B.rows.length) {
		return { structural: `element count changed: ${A.rows.length} -> ${B.rows.length}`, diffs: [] };
	}
	const diffs = [];
	const add = (el, prop, from, to) => { if (diffs.length < cap) diffs.push({ el, prop, from, to }); };
	for (let i = 0; i < A.rows.length; i++) {
		for (let p = 0; p < PROPS.length; p++) {
			if (A.rows[i][p] !== B.rows[i][p]) add(A.names[i], PROPS[p], A.rows[i][p], B.rows[i][p]);
		}
	}
	const content = PROPS.indexOf('content');
	for (const key of new Set([...Object.keys(A.pseudo), ...Object.keys(B.pseudo)])) {
		const [ , i, pe ] = key.match(/^(\d+)(::.*)$/);
		const [ a, b ] = [ A.pseudo[key], B.pseudo[key] ];
		if (!a || !b) { add(A.names[i] + pe, 'content', a ? a[content] : 'none', b ? b[content] : 'none'); continue; }
		for (let p = 0; p < PROPS.length; p++) if (a[p] !== b[p]) add(A.names[i] + pe, PROPS[p], a[p], b[p]);
	}
	return { structural: null, diffs };
};

const CAP = 4000;
const PSEUDOS = ['::before', '::after'];

const cssNow = buildCss({ shipped: true });
const cssRef = CONTROL ? cssNow : buildCss({ ref: REF, shipped: true });

const a = await serveGallery(cssRef);
const b = await serveGallery(cssNow);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORTS[0] });

let total = 0;
const report = [];

for (const { vp, kind, all } of PASSES) {
	await page.setViewportSize({ width: vp.width, height: vp.height });
	/* Before goto: the media feature must hold for the first style recalc, not arrive after it. */
	await page.emulateMedia({ forcedColors: kind === 'fc' ? 'active' : 'none' });

	for (const point of all ? POINTS : POINTS.slice(0, 1)) {
		const take = async (url) => {
			await page.goto(url, { waitUntil: 'load' });
			if (kind === 'rtl') await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; });
			await applyAppearance(page, point);
			await settle(page);
			return page.evaluate(snapshot, { props: PROPS, pseudos: PSEUDOS });
		};
		const snapA = await take(a.base);
		const snapB = await take(b.base);
		const n = snapA.rows.length;
		const np = Object.keys(snapA.pseudo).length;
		const { structural, diffs } = diffSnapshots(snapA, snapB, CAP);

		/* The viewport is part of the label, not just the point: a `width` diff that only exists at
		 * 390 and not at 1280 is unreadable as "width: … -> …" alone once two viewports run: a diff
		 * can be silent at 1280 and loud at 390. */
		const label = `${vp.label}${kind ? `/${kind}` : ''}/${point.palette}/${point.mode}${point.tint ? `/tint${point.tint}` : ''}`;
		if (structural) { report.push({ label, structural, diffs: [], n, np }); total += 1; continue; }
		report.push({ label, structural: null, diffs, n, np });
		total += diffs.length;
	}
}

await browser.close();
a.close();
b.close();

const side = CONTROL ? 'the SAME stylesheet on both sides' : `worktree vs ${REF}`;
console.log(`computed-diff: ${side}, ${report[0]?.n ?? 0} elements + ${report[0]?.np ?? 0} pseudo-elements x ${PROPS.length} properties, ${report.length} pass(es): ${report.map((r) => r.label).join(', ')}`);

for (const r of report) {
	if (r.structural) { console.log(`  ${r.label}: ${r.structural}`); continue; }
	console.log(`  ${r.label}: ${r.diffs.length} difference(s)${r.diffs.length >= CAP ? ` (capped at ${CAP})` : ''}`);
	/* Group by property: a real regression is one property over many elements, and printing the
	 * elements one per line buries that shape in a wall of rows. */
	const byProp = new Map();
	for (const d of r.diffs) {
		if (!byProp.has(d.prop)) byProp.set(d.prop, []);
		byProp.get(d.prop).push(d);
	}
	for (const [prop, ds] of [...byProp].sort((x, y) => y[1].length - x[1].length)) {
		const s = ds[0];
		console.log(`    ${prop}: ${ds.length}x  e.g. ${s.el}  ${s.from} -> ${s.to}`);
	}
}

/* A gallery that failed to render snapshots 0 elements on both sides and would print "0 difference(s)".
 * Both checks below run regardless of --control/--max; floor in lib/gallery.mjs. */
const empty = report.filter((r) => (r.n ?? 0) < GALLERY_FLOOR);
if (empty.length) {
	console.error(`\nFAIL: ${blankGallery(empty[0].n ?? 0, ` at ${empty[0].label}`)} On ${empty.length}/${report.length} point(s).`);
	process.exit(1);
}
/* Same for the pseudo-element half: a gallery with generated content on none would read nothing. */
const noPseudo = report.filter((r) => !r.np);
if (noPseudo.length) {
	console.error(`\nFAIL: no ::before/::after with generated content measured at ${noPseudo[0].label} (and ${noPseudo.length - 1} more); the pseudo-element half read nothing.`);
	process.exit(1);
}
const structural = report.filter((r) => r.structural);
if (structural.length) {
	console.error(`\nFAIL: the DOM itself changed shape, which no property list can diff — see the `
		+ `"element count changed" line(s) above.`);
	process.exit(1);
}

if (CONTROL) {
	if (total === 0) { console.log('control pass: 0 differences. The gallery has no noise floor; any non-zero diff above is causal.'); process.exit(0); }
	console.error(`control pass FAILED with ${total} difference(s): the same stylesheet disagreed with itself, so the harness is unstable and no diff it reports can be read as causal.`);
	process.exit(1);
}

if (MAX !== null) {
	const max = Number(MAX);
	if (total > max) { console.error(`computed-diff: ${total} difference(s) over --max ${max}.`); process.exit(1); }
}
console.log(`computed-diff: ${total} difference(s) total. Read them; this gate reports, it does not judge (pass --max N to make it judge).`);

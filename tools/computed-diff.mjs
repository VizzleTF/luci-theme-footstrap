/* Prove a CSS change by diffing computed styles, on the gallery instead of a router.
 *
 * The method is docs/css.md's: one DOM, one data set, two stylesheets — load the page, snapshot
 * getComputedStyle over every element, swap the <link>, snapshot again. Any difference was caused
 * by the CSS, because nothing else moved.
 *
 * What is new here is the SURFACE. On a live router the same sheet twice moves 0.5-1.3% of pixels
 * (uptime, DHCP leases, signal) and a real regression weighs 0.19% — the noise buries the signal,
 * which is why screenshots do not work and why a live computed diff still needs a control pass to
 * learn each page's floor. docs/gallery.html has no clock, no poll and no data: `--control` runs the
 * SAME stylesheet on both sides and must report exactly 0 differences. That 0 is the threshold, and
 * it is measured rather than chosen — run `--control` whenever the gallery gains a widget.
 *
 * This does not replace the live run. The gallery has every widget and none of the pages: no menu,
 * no chrome, no third-party sheet, no container query answered by a real viewport. It catches the
 * regression that is IN the stylesheet; owlab catches the one that is in the page.
 *
 *   node tools/computed-diff.mjs                 # worktree vs HEAD, light + dark
 *   node tools/computed-diff.mjs --control       # the same sheet twice: the threshold, must be 0
 *   node tools/computed-diff.mjs --against v0.15.0 --full --max 0
 */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { serveGallery, applyAppearance, matrix, ROOT } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';

const ARGV = process.argv.slice(2);
const flag = (n) => ARGV.includes(n);
const opt = (n, d) => { const i = ARGV.indexOf(n); return i < 0 ? d : ARGV[i + 1]; };

const CONTROL = flag('--control');
const REF = opt('--against', 'HEAD');
const MAX = opt('--max', null);
const POINTS = flag('--full')
	? matrix([null])
	: [{ palette: 'footstrap', mode: 'light', tint: null }, { palette: 'footstrap', mode: 'dark', tint: null }];

/* The properties read on every element. This list IS the contract: a property missing from it is a
 * regression this gate cannot see, so add rather than trim. Layout first, then box, then ink — the
 * four bugs docs/css.md credits to this method were a font-family, a max-width, a height/padding
 * pair from two rules, and a lost text-align, one in each group. */
const PROPS = [
	'display', 'position', 'visibility', 'opacity', 'z-index', 'float', 'clear',
	'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height',
	'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
	'border-top-style', 'border-top-color', 'border-bottom-color', 'border-radius',
	'box-shadow', 'outline-width', 'outline-color', 'outline-offset',
	'color', 'background-color', 'background-image',
	'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
	'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'overflow-wrap',
	'overflow-x', 'overflow-y',
	'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
	'align-items', 'justify-content', 'gap',
	'grid-template-columns', 'grid-auto-flow',
	'transform', 'transition-property', 'content',
];

/* Build the reference stylesheet from a git ref. `git archive` gives exactly the two things
 * build-css.sh needs — itself and styles/ beside it — and it reads neither the index nor the
 * worktree, so an uncommitted edit cannot leak into the BEFORE side. */
function buildCssAt(ref) {
	const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'fs-css-ref-'));
	const pkg = 'luci-theme-footstrap';
	execFileSync('sh', ['-c',
		`git archive ${JSON.stringify(ref)} ${pkg}/build-css.sh ${pkg}/styles | tar -x -C ${JSON.stringify(dir)}`],
	{ cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
	const out = join(dir, 'cascade.css');
	execFileSync(join(dir, pkg, 'build-css.sh'), [out], { stdio: 'inherit' });
	return out;
}

/* Wait for the sheet AND for font matching. A snapshot taken before matching settles measures
 * fallback metrics: every width on the page shifts a pixel or two, and 291 false differences on the
 * firewall page is what that looked like the first time. Neither sheet ships a face now, but a
 * machine with Manrope installed still resolves one. */
async function settle(page) {
	await page.evaluate(() => document.fonts.ready);
	/* And for every running animation. Measured: with fonts alone, a clean tree still reported one
	 * difference against its own HEAD — `span.cbi-tooltip opacity 0.00245647 -> 0`, a fade caught
	 * mid-flight by one snapshot and finished by the other. Waiting on the animations rather than
	 * disabling them keeps `transition-property` honest, which is itself one of the measured
	 * properties. The 2 s cap is for an infinite animation, which never resolves. */
	await page.evaluate(() => Promise.race([
		Promise.allSettled(document.getAnimations().map((a) => a.finished)),
		new Promise((r) => setTimeout(r, 2000)),
	]));
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function swapSheet(page, href) {
	await page.evaluate((h) => new Promise((resolve, reject) => {
		const link = document.querySelector('link[rel="stylesheet"]');
		if (!link) { reject(new Error('the gallery has no <link rel=stylesheet> to swap')); return; }
		link.addEventListener('load', resolve, { once: true });
		link.addEventListener('error', () => reject(new Error('the swapped stylesheet failed to load')), { once: true });
		link.href = h;
	}), href);
	await settle(page);
}

const snapshot = (props) => {
	const els = document.querySelectorAll('*');
	const out = new Array(els.length);
	for (let i = 0; i < els.length; i++) {
		const cs = getComputedStyle(els[i]);
		const row = new Array(props.length);
		for (let p = 0; p < props.length; p++) row[p] = cs.getPropertyValue(props[p]);
		out[i] = row;
	}
	/* A readable name for each element, computed once so the diff pass carries no DOM work. */
	const names = new Array(els.length);
	for (let i = 0; i < els.length; i++) {
		const e = els[i];
		const cls = (e.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
		names[i] = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (cls ? '.' + cls : '');
	}
	window.__fsSnap = { out, names };
	return els.length;
};

const compare = ({ props, cap }) => {
	const before = window.__fsSnap;
	const els = document.querySelectorAll('*');
	const diffs = [];
	if (els.length !== before.out.length) {
		return { structural: `element count changed: ${before.out.length} -> ${els.length}`, diffs };
	}
	for (let i = 0; i < els.length && diffs.length < cap; i++) {
		const cs = getComputedStyle(els[i]);
		for (let p = 0; p < props.length; p++) {
			const now = cs.getPropertyValue(props[p]);
			if (now !== before.out[i][p]) {
				diffs.push({ el: before.names[i], i, prop: props[p], from: before.out[i][p], to: now });
				if (diffs.length >= cap) break;
			}
		}
	}
	return { structural: null, diffs };
};

const CAP = 4000;

const cssNow = buildCss();
const cssRef = CONTROL ? cssNow : buildCssAt(REF);

const a = await serveGallery(cssRef);
const b = await serveGallery(cssNow);
const originB = new URL(b.base).origin;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let total = 0;
const report = [];

for (const point of POINTS) {
	await page.goto(a.base, { waitUntil: 'load' });
	await applyAppearance(page, point);
	await settle(page);

	/* Swap A onto itself before the FIRST snapshot, so both snapshots are taken in the same state.
	 * Measured: without this, a control pass (the same stylesheet on both sides) reported 28
	 * differences in light and 0 in dark — every one of them a colour re-serialised across the swap,
	 * `oklab(0.539907 -0.0412925 -0.186042 / 0.4)` becoming
	 * `color(srgb 0.0352941 0.411765 0.854902 / 0.4)` on border-top-color, border-bottom-color and
	 * box-shadow. The values are the same colour; only the serialisation of a computed colour
	 * differs between a sheet parsed with the document and one attached afterwards. Symmetry costs
	 * one extra load and takes the floor to 0, which is what makes a non-zero diff readable as
	 * causal rather than as a number to compare against a remembered baseline. */
	await swapSheet(page, `${new URL(a.base).origin}/cascade.css`);
	const n = await page.evaluate(snapshot, PROPS);

	await swapSheet(page, `${originB}/cascade.css`);
	/* The swap does not touch :root, so the axes stamped before it are still in force. Re-stamping
	 * here would be the bug this gate exists to catch, dressed as a fixture. */
	const { structural, diffs } = await page.evaluate(compare, { props: PROPS, cap: CAP });

	const label = `${point.palette}/${point.mode}${point.tint ? `/tint${point.tint}` : ''}`;
	if (structural) { report.push({ label, structural, diffs: [], n }); total += 1; continue; }
	report.push({ label, structural: null, diffs, n });
	total += diffs.length;
}

await browser.close();
a.close();
b.close();

const side = CONTROL ? 'the SAME stylesheet on both sides' : `worktree vs ${REF}`;
console.log(`computed-diff: ${side}, ${report[0]?.n ?? 0} elements x ${PROPS.length} properties, ${POINTS.length} appearance point(s)`);

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

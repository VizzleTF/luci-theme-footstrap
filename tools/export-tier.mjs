/* The --*-color-* export tier is a CONTRACT with other people's packages, and axe cannot see it:
 * those widgets ship in their packages, not in the gallery. It is the only part of this theme
 * anything outside it reads, and the apps that do were written against luci-theme-bootstrap, where
 * a level is read as `color:` about as often as `background:`. So each level owes three things:
 *
 *   LEGIBLE AS TEXT   AA (4.5:1) on all three surfaces. Bootstrap does not manage this (its
 *                     --primary-color-low is 3.6:1 on its own dark panel), which caps our ramp.
 *   LEGIBLE AS A FILL the matching --on-*-color clears AA on top of the level.
 *   A REAL GRADATION  high/medium/low must be three distinguishable colours. They were once three
 *                     aliases of ONE token and nothing caught it — a flat colour passes every
 *                     contrast threshold there is; only a spread check fails on it. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serveGallery, applyAppearance, matrix, installRgba, contrast } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';
import { parseExportTier } from './lib/tokens.mjs';

const AA = 4.5;

/* How far --x-color-high must sit from --x-color-low (max channel delta, 0..1) for the ramp to
 * be a ramp. Not one number, and deliberately NOT a contrast check: --background-* and
 * --border-* separate adjacent surfaces and are MEANT to be quiet (bootstrap's own are 0.04 and
 * 0.13 apart); a family apps print text in has to show a real step. */
const MIN_SPREAD = { background: 0.02, border: 0.10, default: 0.10 };

const SURFACES = ['--fs-bg', '--fs-panel', '--fs-panel2'];

/* THE TIER IS DERIVED, never restated. This used to be a hand-written cross-product of
 * ['text','primary',…] x ['high','medium','low'], which is a list, not the contract — and it had
 * already fallen behind: --text-color-highest was defined in 02-tokens.css, shipped, read by apps,
 * and measured by NOTHING. Painting it #808080 (~3.95:1 on a light --fs-bg) passed clean. What a
 * hand list cannot do is fail when the tokens grow; parsing them can. */
import { ROOT } from './lib/root.mjs';
const TIER = parseExportTier(readFileSync(join(ROOT, 'luci-theme-footstrap/styles/02-tokens.css'), 'utf8'));

/* The one thing that CANNOT be parsed: what a family MEANS. Whether apps print text in it or only
 * separate surfaces with it is a judgement about other people's packages, so it stays written down
 * — but every parsed family must appear in exactly one list, and an unclassified one is a hard
 * failure rather than a silent omission. That is the half the old cross-product got wrong. */
const TEXT_FAMILIES = ['text', 'primary', 'error', 'success', 'warn'];
/* --border-* and --background-* get no contrast floor: surface separations, not content. WCAG
 * 1.4.11's 3:1 covers the boundary that IDENTIFIES a control (focus ring, input outline), not
 * a table rule. */
const NO_FLOOR_FAMILIES = ['background', 'border'];

const setup = [];
const unclassified = TIER.map((t) => t.family)
	.filter((f) => !TEXT_FAMILIES.includes(f) && !NO_FLOOR_FAMILIES.includes(f));
if (unclassified.length)
	setup.push(`02-tokens.css exports the famil${unclassified.length > 1 ? 'ies' : 'y'} `
		+ `${unclassified.join(', ')}, which this gate classifies as neither text nor surface — so `
		+ `${unclassified.length > 1 ? 'they are' : 'it is'} measured by nothing. Apps read a level as `
		+ `color: about as often as background:; decide which, and say so here.`);
for (const f of [...TEXT_FAMILIES, ...NO_FLOOR_FAMILIES])
	if (!TIER.some((t) => t.family === f))
		setup.push(`this gate expects a --${f}-color-* family, and 02-tokens.css defines none — either the `
			+ `tier lost a family or the parser stopped seeing it, and both read here as "nothing to check"`);
for (const t of TIER)
	if (!t.levels.includes(`${t.family}-color-high`) || !t.levels.includes(`${t.family}-color-low`))
		setup.push(`--${t.family}-color-* has no high/low pair (${t.levels.join(', ')}) — the spread check `
			+ `is what proves the ramp is not secretly flat, and it needs both ends`);
if (setup.length) {
	console.error('export tier: FAIL — the gate and the tokens disagree about what the tier IS\n');
	for (const s of setup) console.error(`  ${s}`);
	process.exit(1);
}

const INKS = Object.fromEntries(TIER.filter((t) => t.ink).map((t) => [t.family, `--${t.ink}`]));
const levelsOf = (family) => TIER.find((t) => t.family === family).levels.map((l) => `--${l}`);

/* serve + Appearance-axis stamping: shared by eight tools (tools/lib/gallery.mjs) */
const { base, close } = await serveGallery(buildCss());

const spread = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]))) / 255;

const NAMES = [
	...SURFACES,
	...TIER.flatMap((t) => levelsOf(t.family)),
	...Object.values(INKS),
];

/* The Tint axis re-hues the three SURFACES every level is measured against, so it multiplies
 * this matrix — and it is a user-driven slider: the hue nobody looked at is the one someone
 * picks. Six hues evenly around the wheel — the mix is monotonic in hue, and 60° is finer than
 * the gamut boundaries that could move a result. `null` = untinted. */
const TINTS = [null, 0, 60, 120, 180, 240, 300];

const MATRIX = matrix(TINTS);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'load' });
await installRgba(page);

const failures = [];
let checks = 0;

/* One combination, measured. A function rather than a loop body because the sweep runs TWICE: once
 * as the theme paints by default, and once with `prefers-contrast: more` emulated — that query
 * re-states the ink and hairline tokens, so it publishes a SECOND export tier that nothing else
 * measures. It shipped one: `--fs-faint` was set to `--fs-dim` there, making --text-color-low and
 * -medium the same colour for every app reading the gradation. Untinted only in that pass, the
 * query moving the inks while the tint moves the surfaces. */
async function runCombo({ palette, mode, tint }, suffix) {
	await applyAppearance(page, { mode, palette, tint });

	/* Resolve each custom property by RASTERISING it (installRgba), never by parsing the computed
	 * string: `oklch(L C H)` has three numbers that parse perfectly well — silently and wrongly — as
	 * an rgb() triple. That misread once scored a light token as near-black. The same evaluate reads
	 * <body>'s background for the dark-mode sniff below. */
	const { v, bodyBg } = await page.evaluate((names) => {
		const probe = document.createElement('div');
		document.body.appendChild(probe);
		const out = {};
		for (const n of names) {
			probe.style.color = '';
			probe.style.color = `var(${n})`;
			out[n] = window.__fsRgba(getComputedStyle(probe).color).slice(0, 3);
		}
		probe.remove();
		const raw = getComputedStyle(document.body).backgroundColor;
		return { v: out, bodyBg: { raw, rgba: window.__fsRgba(raw) } };
	}, NAMES);

	const where = `${palette}/${mode}${tint === null ? '' : `/tint ${tint}°`}${suffix}`;

	for (const family of TEXT_FAMILIES)
		for (const name of levelsOf(family))
			for (const surface of SURFACES) {
				const ratio = contrast(v[name], v[surface]);
				checks++;
				if (ratio < AA)
					failures.push(`${where}: ${name} on ${surface} = ${ratio.toFixed(2)} (AA needs ${AA} — apps print text in it)`);
			}

	for (const [family, ink] of Object.entries(INKS))
		for (const name of levelsOf(family)) {
			const ratio = contrast(v[ink], v[name]);
			checks++;
			if (ratio < AA)
				failures.push(`${where}: ${ink} on ${name} = ${ratio.toFixed(2)} (AA needs ${AA} — apps fill with it)`);
		}

	for (const { family } of TIER) {
		const hi = v[`--${family}-color-high`];
		const lo = v[`--${family}-color-low`];
		const need = MIN_SPREAD[family] ?? MIN_SPREAD.default;
		const got = spread(hi, lo);
		checks++;
		if (got < need)
			failures.push(`${where}: --${family}-color-high and -low are ${got.toFixed(3)} apart, need ${need} ` +
				`(${hi} vs ${lo}) — the ramp is FLAT: an app asking for a gradation gets one colour three times`);
	}

	/* ---- dark mode must be sniffable, and <body> is what everyone sniffs ----
	 *
	 * There is no standard to ask, so apps read the LUMINANCE of getComputedStyle(document.body)
	 * .backgroundColor: ssclash (0.299/0.587/0.114), OpenClash (0.2126/0.7152/0.0722, then stamps
	 * `data-darkmode` on OUR :root), passwall's node-widgets (YIQ). So `body` needs an OPAQUE
	 * background on the right side of the midpoint in every palette x mode: transparent or faded,
	 * the readback is `rgba(0, 0, 0, 0)` or the white page showing through, and reads LIGHT. */
	checks++;
	/* what those sniffers compute, in the notation they compute it in */
	const luma = (0.299 * bodyBg.rgba[0] + 0.587 * bodyBg.rgba[1] + 0.114 * bodyBg.rgba[2]) / 255;
	if (bodyBg.rgba[3] !== 255)
		failures.push(`${where}: body background is ${bodyBg.raw} — not opaque. Every third-party dark-mode `
			+ `sniffer reads its luminance, and a transparent body reads back as LIGHT.`);
	else if ((mode === 'dark') !== (luma < 0.5))
		failures.push(`${where}: body background ${bodyBg.raw} has luminance ${luma.toFixed(2)}, which every `
			+ `third-party sniffer will read as "${luma < 0.5 ? 'dark' : 'light'}" — the page is ${mode}.`);
}

for (const combo of MATRIX)
	await runCombo(combo, '');

const CONTRAST = matrix();
await page.emulateMedia({ contrast: 'more' });
for (const combo of CONTRAST)
	await runCombo(combo, ' + prefers-contrast:more');
await page.emulateMedia({ contrast: 'no-preference' });

await browser.close();
close();

if (failures.length) {
	console.error(`export tier: FAIL — ${failures.length} of ${checks} checks\n`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`export tier: OK — ${checks} checks across ${MATRIX.length} palette x mode x tint combinations, `
	+ `plus ${CONTRAST.length} of them again under prefers-contrast:more`);

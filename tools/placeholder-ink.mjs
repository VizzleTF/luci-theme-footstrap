#!/usr/bin/env node
/* The placeholder must not read as a value the reader typed.
 *
 * LuCI writes an option's DEFAULT into the `placeholder` attribute (`form.Value.placeholder`: 128
 * for the log buffer, 514 for the log port), and `ui.js` renders an unset dropdown as a
 * `li[placeholder]` row. Both are the ABSENCE of a value, and the theme drew them in --fs-dim and
 * --fs-faint — inks that sit at 11.12:1 and 9.42:1 on footstrap light's field fill against the
 * value's own 14.84:1, i.e. three blacks. Two forum readers filed the same report against 0.14.8:
 * the Local/Remote Ports fields "actually hold these values" (topic 251930, posts 82-83).
 *
 * No other gate can see it. axe-core's colour-contrast rule skips `::placeholder` outright, and the
 * ink is legal by every threshold the theme measures — a placeholder AT the body colour passes AA
 * with room to spare. What fails is the reader, so the gate measures the DISTANCE between the two
 * inks rather than either one alone:
 *
 *   SEPARATION  the hint must have travelled at least 40% of the way from the value's ink to the
 *               field's own fill in light and 30% in dark, in oklab lightness — the axis the token
 *               is mixed on. A fraction of the range rather than a flat ΔL because the range itself
 *               is per palette: footstrap light has 0.724 of lightness between ink and field, its
 *               dark half 0.464, which is also why the two floors differ.
 *   FLOOR       and the hint is still legible: 3:1, SC 1.4.11 and SC 1.4.3's large-text floor.
 *
 * The two pull against each other, and 3:1 rather than AA's 4.5 is where that argument was settled.
 * Both modes ship under AA on purpose — 3.99-4.48:1 light, 3.43-6.05:1 dark — because a hint
 * mistaken for a value makes a reader configure the wrong thing while a hint at 3.43:1 makes them
 * look twice. The AA-clearing mixes were measured first and moved 37% and 20% of the range against
 * today's 44% and 34%: the same fault, quieter.
 *
 * `prefers-contrast: more` is the SECOND sweep, both modes: that query hands the AA ink back
 * (theme/95-a11y-media.css), so the reader who asked the OS for contrast is checked against 4.5.
 * Without the sweep the override is a declaration nothing reads.
 *
 * axe-core is excluded from `li[placeholder]` for this decision (tools/a11y-gallery.mjs) — it
 * measures that row as real text and skips the `placeholder` ATTRIBUTE carrying the same ink, so its
 * rule reaches half the decision. This gate is what holds the token instead.
 *
 * Colours are RASTERISED, never parsed: a color-mix() computes to the space it was written in, and
 * `oklch(L C H)` parses perfectly well — and wrongly — as an rgb() triple (the trap export-tier.mjs
 * documents).
 */
import { chromium } from 'playwright';
import { serveGallery, applyAppearance, matrix } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';

/* One row per pass: the contrast floor on the field's fill, and how far the hint must have moved as
 * a fraction of the ink-to-field lightness range. The prefers-contrast pass trades the two the other
 * way round on purpose — that reader asked for contrast, and 18% is what buying AA back costs.
 * Shipped today: 43-44%/3.99-4.48:1 light, 33-35%/3.43-6.05:1 dark, and 36-37%/4.98:1 light plus
 * 18-19%/4.61:1 dark under the query. */
const PASS = {
	light:    { ratio: 3, sep: 0.40 },
	dark:     { ratio: 3, sep: 0.30 },
	contrast: { ratio: 4.5, sep: 0.15 },
};

const { base, close } = await serveGallery(buildCss());

const luminance = ([r, g, b]) => {
	const f = (u) => (u /= 255) <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};
/* oklab's L, and only L: the token is a lightness step, and a hue difference between two greys is
 * not what tells a reader "this is not your value". */
const okL = ([r, g, b]) => {
	const f = (u) => (u /= 255) <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
	const [R, G, B] = [f(r), f(g), f(b)];
	const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'load' });

const failures = [];
let checks = 0;

/* the default sweep, then dark again under prefers-contrast:more */
const SWEEP = [
	...matrix().map((c) => ({ ...c, ...PASS[c.mode], more: false })),
	...matrix().map((c) => ({ ...c, ...PASS.contrast, more: true })),
];

for (const { palette, mode, ratio: floor, sep: minSep, more } of SWEEP) {
	await page.emulateMedia({ contrast: more ? 'more' : 'no-preference' });
	await applyAppearance(page, { mode, palette });

	const probes = await page.evaluate(() => {
		const cv = document.createElement('canvas');
		cv.width = cv.height = 1;
		const cx = cv.getContext('2d', { willReadFrequently: true });
		const rgb = (css) => {
			cx.clearRect(0, 0, 1, 1);
			cx.fillStyle = css;
			cx.fillRect(0, 0, 1, 1);
			return [...cx.getImageData(0, 0, 1, 1).data].slice(0, 3);
		};
		/* the fill the hint is READ on: the element's own background where it has one, else the
		 * first ancestor that paints. A transparent field is the search row's shape and the
		 * dropdown menu's, and a ratio against `transparent` is a ratio against nothing. */
		const fillOf = (el) => {
			for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
				const bg = getComputedStyle(n).backgroundColor;
				if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) return bg;
			}
			return getComputedStyle(document.body).backgroundColor;
		};
		const out = [];
		/* the attribute: the hint is a pseudo-element, the value the field's own colour */
		for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
			const cs = getComputedStyle(el);
			out.push({
				what: `${el.tagName.toLowerCase()}[placeholder="${el.getAttribute('placeholder')}"]`,
				hint: rgb(getComputedStyle(el, '::placeholder').color),
				value: rgb(cs.color),
				fill: rgb(fillOf(el)),
			});
		}
		/* the dropdown row: ui.js gives it no pseudo-element, so the hint IS the row's colour and
		 * the value is the ink of a real option beside it */
		for (const el of document.querySelectorAll('.cbi-dropdown li[placeholder]')) {
			const real = el.parentElement.querySelector('li:not([placeholder])');
			if (!real) continue;
			out.push({
				what: `li[placeholder] "${el.textContent.trim()}"`,
				hint: rgb(getComputedStyle(el).color),
				value: rgb(getComputedStyle(real).color),
				fill: rgb(fillOf(el)),
			});
		}
		return out;
	});

	if (!probes.length) {
		console.error('placeholder-ink: FAIL — the gallery rendered no placeholder to measure');
		close(); await browser.close(); process.exit(1);
	}

	const label = `${palette}/${mode}${more ? ' +contrast' : ''}`;
	let worstSep = Infinity, worstRatio = Infinity;
	for (const p of probes) {
		checks += 2;
		const range = Math.abs(okL(p.value) - okL(p.fill));
		const sep = range ? Math.abs(okL(p.value) - okL(p.hint)) / range : 0;
		const ratio = contrast(p.hint, p.fill);
		worstSep = Math.min(worstSep, sep);
		worstRatio = Math.min(worstRatio, ratio);
		if (sep < minSep)
			failures.push(`${label} ${p.what}: hint is ${(sep * 100).toFixed(0)}% of the way from the `
				+ `value's ink to the field (want ${minSep * 100}%) — it reads as a typed value`);
		if (ratio < floor)
			failures.push(`${label} ${p.what}: hint at ${ratio.toFixed(2)}:1 on its fill `
				+ `(want ${floor}) — the hint carries the option's default and has to be readable`);
	}
	console.log(`  ${label.padEnd(24)} ${probes.length} placeholder(s), `
		+ `worst separation ${(worstSep * 100).toFixed(0)}%, worst contrast ${worstRatio.toFixed(2)}:1 `
		+ `(floors ${minSep * 100}% / ${floor})`);
}

close();
await browser.close();

if (failures.length) {
	console.error(`\nplaceholder-ink: FAIL — ${failures.length} of ${checks} checks\n`);
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
console.log(`\nplaceholder-ink: ${checks} checks over ${SWEEP.length} combinations `
	+ `(${matrix().length} palette/mode, each measured again under prefers-contrast:more) — `
	+ 'every hint is quieter than a value and still readable');

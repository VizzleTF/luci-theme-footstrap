/* Shared harness for every gate that renders docs/gallery.html (`grep -l lib/gallery.mjs tools/*.mjs`
 * lists them). Nothing here ships. It serves the gallery on an ephemeral port and stamps the Appearance axes onto
 * :root in one copy, so a changed rule in fs-prefs.js or head.ut's pre-paint (load-bearing:
 * `--fs-tint-h` is set BEFORE the `data-tint` attribute) cannot leave a gate testing the old shape. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

import { ROOT } from './root.mjs';
import { seamOf } from './css.mjs';

/* A blank page passes every gallery gate with nothing found. MEASURED is the node count of
 * docs/gallery.html (1125); the floor sits far under it so a widget added or removed never trips it. */
export const GALLERY_MEASURED = 1125;
export const GALLERY_FLOOR = 200;
export const blankGallery = (n, where = '') => `measured only ${n} element(s)${where} (last real run: `
	+ `~${GALLERY_MEASURED}) — the gallery did not render. This is not "clean"; it is nothing measured.`;
export async function assertRendered(page) {
	const n = await page.evaluate(() => document.querySelectorAll('*').length);
	if (n < GALLERY_FLOOR) { console.error(`\nFAIL: ${blankGallery(n)}`); process.exit(1); }
	return n;
}

/* Serve docs/gallery.html + the freshly-built stylesheet on an ephemeral port. A `shipped` sheet
 * (lib/css.mjs) is served with the gallery renamed by its own token map: the page's unlayered
 * `body { color: var(--fs-text) }` reads a private name, so left alone it would read nothing. */
export async function serveGallery(cssPath) {
	const FILES = {
		'/gallery.html': join(ROOT, 'docs/gallery.html'),
		'/cascade.css': cssPath,
	};
	const TYPES = { '.html': 'text/html', '.css': 'text/css' };
	const renamed = seamOf(cssPath)?.gallery;
	const server = createServer(async (req, res) => {
		const path = req.url.split('?')[0];
		const file = FILES[path === '/' ? '/gallery.html' : path];
		if (!file) { res.writeHead(404).end(); return; }
		res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'text/plain' });
		res.end(renamed && extname(file) === '.html' ? renamed : await readFile(file));
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return {
		base: `http://127.0.0.1:${server.address().port}/gallery.html`,
		close: () => server.close(),
	};
}

/* Stamp one point of the Appearance matrix onto :root, exactly the way the theme does. It must stay
 * in step with applyMode in fs-prefs.js, listAxis/colorAxis in fs-axes.js and head.ut's pre-paint.
 * `tint`/`accent`: null (or 0) is off and CLEARS both attribute and custom property — "off" is not
 * hue 0. Only the HUE half of a colour axis is swept: a rotation keeps the palette's lightness and
 * chroma, so it can be held to a contract; a hex axis is chosen against no palette, so the theme
 * derives readable ink in CSS and the Appearance page reports the ratio instead. */
export async function applyAppearance(page, { mode = 'light', palette = 'footstrap', tint = null, accent = null } = {}) {
	await page.evaluate(([m, p, t, a]) => {
		const root = document.documentElement;
		root.setAttribute('data-darkmode', m === 'dark' ? 'true' : 'false');
		if (p && p !== 'footstrap') root.setAttribute('data-palette', p);
		else root.removeAttribute('data-palette');
		/* colour axes in hue mode: the custom property FIRST, then the attribute that switches the
		 * rotation on. The other order paints one frame with the previous hue — the theme's own
		 * ordering rule. The attribute's VALUE says which mode is in effect, so 'hue' is not
		 * decoration: :root[data-tint="hex"] means something else entirely. */
		const hue = (val, attr, prop) => {
			if (!val) { root.removeAttribute(attr); root.style.removeProperty(prop); return; }
			root.style.setProperty(prop, String(val));
			root.setAttribute(attr, 'hue');
		};
		hue(t, 'data-tint', '--fs-tint-h');
		hue(a, 'data-accent', '--fs-accent-h');
	}, [mode, palette, tint, accent]);
	await page.waitForTimeout(150);
}

/* Define window.__fsRgba(css) -> [r,g,b,a]: it RASTERISES a colour on a 1x1 canvas, never parses it
 * (a color-mix() computes in the space it was written in; `oklch(L C H)` parses as a wrong rgb()
 * triple). Call after goto: a navigation drops it. */
export async function installRgba(page) {
	await page.evaluate(() => {
		const cx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
			.getContext('2d', { willReadFrequently: true });
		window.__fsRgba = (css) => {
			cx.clearRect(0, 0, 1, 1);
			cx.fillStyle = css;
			cx.fillRect(0, 0, 1, 1);
			return [...cx.getImageData(0, 0, 1, 1).data];
		};
	});
}

/* WCAG 2.x relative luminance and contrast ratio, shared by export-tier.mjs and placeholder-ink.mjs;
 * only `contrast` is exported, no caller reads a bare luminance. */
const luminance = ([r, g, b]) => {
	const f = (u) => (u /= 255) <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

/* The palette x mode grid the gates sweep. The TINT list is a PARAMETER, not shared: axe takes the
 * two extremes, export-tier walks the wheel at 60°. That difference is deliberate and argued in
 * each caller; the scaffolding around it is not. The palette list is READ from 03-palettes.css —
 * `footstrap` is the default block with no attribute, every other name is a :root[data-palette]
 * block — so a new palette is swept the moment it exists. */
export function matrix(tints = [null]) {
	const css = readFileSync(join(ROOT, 'luci-theme-footstrap/styles/03-palettes.css'), 'utf8');
	const named = [...new Set([...css.matchAll(/:root\[data-palette="([^"]+)"\]/g)].map((m) => m[1]))];
	if (named.length < 2 || named.includes('footstrap'))
		throw new Error(`matrix(): 03-palettes.css yields [${named}] — expected the named palettes, not the default`);
	return ['footstrap', ...named].flatMap((palette) => ['light', 'dark']
		.flatMap((mode) => tints.map((tint) => ({ palette, mode, tint }))));
}

/* Wait for the sheet AND for font matching. A snapshot taken before matching settles measures
 * fallback metrics: every width on the page shifts a pixel or two, and 291 false differences on the
 * firewall page is what that looked like the first time. Neither sheet ships a face now, but a
 * machine with Manrope installed still resolves one. */
export async function settle(page) {
	await page.evaluate(() => document.fonts.ready);
	/* And for every running animation. Measured: with fonts alone, a clean tree still reported one
	 * difference against its own HEAD — `span.cbi-tooltip opacity 0.00245647 -> 0`, a fade caught
	 * mid-flight by one snapshot and finished by the other. Waiting on the animations rather than
	 * disabling them keeps `transition-property` honest, which is itself one of the measured
	 * properties. Only finite ones: the gallery's 13 `.spinning` buttons run fs-spin forever, and
	 * waiting on those burned the whole 2 s cap three times a pass (~6 of 6.4 s). A paused finite
	 * animation never resolves `finished`, so the wait is bounded at 5 s and a timeout is a failure,
	 * never a pass over a snapshot taken mid-flight. */
	const settled = await page.evaluate(() => Promise.race([
		Promise.allSettled(document.getAnimations()
			.filter((a) => a.effect.getComputedTiming().iterations !== Infinity)
			.map((a) => a.finished)).then(() => true),
		new Promise((r) => setTimeout(() => r(false), 5000)),
	]));
	if (!settled) throw new Error('gallery: animations did not settle within 5 s; the snapshot would be mid-flight');
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

#!/usr/bin/env node
/* Rasterise the app icons the web manifest points at, from the one logo the theme already ships.
 *
 * The PNGs are COMMITTED, not built at package time: the OpenWrt buildbot has no node and no
 * browser, and `Build/Prepare` may only run cat/awk-grade tools. So this is a developer's tool, run
 * when the logo changes, and its output is reviewed like any other asset. Running it must be
 * reproducible — same logo in, same bytes out — which is why the page it screenshots is pinned here
 * rather than described in a doc.
 *
 * WHY NOT AN SVG ICON IN THE MANIFEST. Chrome accepts one and Safari's Add to Home Screen does not,
 * and the home screen is the whole point of the manifest. The SVG stays the favicon (it is a live
 * document — see the dark-mode rule inside logo.svg, which a raster cannot have); these are for the
 * installed app.
 *
 * WHY A BACKGROUND AND A MARGIN. `purpose: "any maskable"` means the platform is free to crop the
 * icon to its own shape (a circle on Android, a squircle on iOS), and it guarantees only the middle
 * 80% — the "safe zone" — survives. The mark is drawn at 60% of the canvas, centred, on the default
 * palette's page colour, so no crop can bite into it and a transparent PNG never lands on a black
 * home screen with an invisible dark-blue ring.
 *
 * Usage: node tools/build-icons.mjs [--check]
 *   --check re-renders and compares against the committed PNGs — for CI, so a logo edit cannot ship
 *           with stale icons.
 *
 * WHAT --check COMPARES, AND WHY NOT BYTES. It compared the two files byte for byte, which is a test
 * of the RENDERER, not of the icon: a Chromium bump moves a subpixel and the gate goes red on a
 * commit that never touched logo.svg, with no diff to show for it. What it now asks is what an
 * installed icon has to be true of:
 *
 *   pixels     the committed raster still matches a fresh render, per channel, with a tolerance —
 *              a logo edit moves whole regions and lands far outside it, an engine's antialiasing
 *              does not. Decoded in the same Chromium, so this needs no image dependency at all.
 *   canvas     the size the manifest declares is the size on flash.
 *   opaque     no alpha anywhere. A transparent PNG lands on a black home screen as an invisible
 *              dark-blue ring, which is the failure the background exists to stop.
 *   safe zone  everything outside the middle 80% is background and nothing else — the guarantee
 *              `purpose: maskable` gives, and the one an over-eager logo edit would break silently
 *              on the round crops only some platforms make.
 *   mark       the middle is NOT background, i.e. there is an icon in the icon.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './lib/css.mjs';

const MEDIA = join(ROOT, 'luci-theme-footstrap/htdocs/luci-static/footstrap');
const CHECK = process.argv.includes('--check');

/* the default palette's page colour (styles/03-palettes.css, footstrap/light --fs-bg-base). The
 * icon cannot follow the live palette — it is a file on flash, not a stylesheet — so it carries the
 * default, which is also what the manifest declares as background_color. */
const BG = '#f6f8fa';
const MARK = 0.6;	/* the mark's share of the canvas: the maskable safe zone is 0.8 */

const ICONS = [
	{ name: 'app-icon-192.png', size: 192 },
	{ name: 'app-icon-512.png', size: 512 },
	/* iOS reads this one directly and never looks at the manifest's icons array */
	{ name: 'apple-touch-icon.png', size: 180 },
];

const logo = readFileSync(join(MEDIA, 'logo.svg'), 'utf8');
const page = (size) => `<!doctype html><meta charset="utf-8"><style>
	html, body { margin: 0; padding: 0; }
	body { width: ${size}px; height: ${size}px; background: ${BG};
	       display: flex; align-items: center; justify-content: center; }
	svg { width: ${Math.round(size * MARK)}px; height: ${Math.round(size * MARK)}px; }
</style>${logo}`;

/* HOW FAR A PIXEL AND AN ICON MAY DRIFT. `CHANNEL` is per-channel, on 0-255: a renderer's
 * antialiasing moves an edge by a shade or two, and a mark that changed shape moves whole regions
 * to a different colour entirely. `SHARE` is how much of the canvas may drift that far at all —
 * the mark's outline is a small part of it, and a redrawn logo is never a rounding difference. */
const CHANNEL = 12;
const SHARE = 0.02;
/* the safe zone `purpose: maskable` guarantees; outside it a platform may crop anything away */
const SAFE = 0.8;

/* Decode both PNGs in the browser and answer with NUMBERS, never with pixels: 512x512 is a million
 * channels, and handing that across the CDP bridge to compare it in node would be slower than the
 * render. `fresh` may be null — then only the invariants are asked, of the committed file alone. */
async function inspect(tab, committed, fresh, bg) {
	return tab.evaluate(async ([ a, b, bgHex, chan, safe ]) => {
		const load = (uri) => new Promise((res, rej) => {
			const img = new Image();
			img.onload = () => res(img);
			img.onerror = () => rej(new Error('the file is not a PNG this engine can decode'));
			img.src = uri;
		});
		const pixels = async (uri) => {
			const img = await load(uri);
			const c = document.createElement('canvas');
			c.width = img.naturalWidth; c.height = img.naturalHeight;
			c.getContext('2d').drawImage(img, 0, 0);
			return { w: c.width, h: c.height, d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
		};

		const A = await pixels(a);
		const B = b ? await pixels(b) : null;
		const want = [ 1, 3, 5 ].map((i) => parseInt(bgHex.substr(i, 2), 16));
		const isBg = (d, o) => Math.abs(d[o] - want[0]) <= chan && Math.abs(d[o + 1] - want[1]) <= chan
			&& Math.abs(d[o + 2] - want[2]) <= chan;

		const out = { w: A.w, h: A.h, opaque: true, outside: 0, mark: 0, drift: null, sizeMatch: null };
		const lo = Math.round(A.w * (1 - safe) / 2), hi = A.w - lo;
		const mid = Math.round(A.w * 0.25), midHi = A.w - mid;
		for (let y = 0; y < A.h; y++) {
			for (let x = 0; x < A.w; x++) {
				const o = (y * A.w + x) * 4;
				if (A.d[o + 3] !== 255) out.opaque = false;
				const inSafe = (x >= lo && x < hi && y >= lo && y < hi);
				if (!inSafe && !isBg(A.d, o)) out.outside++;
				if (x >= mid && x < midHi && y >= mid && y < midHi && !isBg(A.d, o)) out.mark++;
			}
		}
		if (B) {
			out.sizeMatch = (A.w === B.w && A.h === B.h);
			if (out.sizeMatch) {
				let moved = 0;
				for (let o = 0; o < A.d.length; o += 4)
					if (Math.abs(A.d[o] - B.d[o]) > chan || Math.abs(A.d[o + 1] - B.d[o + 1]) > chan ||
					    Math.abs(A.d[o + 2] - B.d[o + 2]) > chan || A.d[o + 3] !== B.d[o + 3])
						moved++;
				out.drift = moved / (A.w * A.h);
			}
		}
		return out;
	}, [ committed, fresh, bg, CHANNEL, SAFE ]);
}

const uri = (buf) => 'data:image/png;base64,' + buf.toString('base64');

const browser = await chromium.launch();
/* forced light: logo.svg carries a prefers-color-scheme rule that lightens the ring for a dark tab
 * strip, and an icon rendered under it would be the wrong one on every light home screen */
const ctx = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1 });
const tab = await ctx.newPage();

const bad = [];

for (const icon of ICONS) {
	await tab.setViewportSize({ width: icon.size, height: icon.size });
	await tab.setContent(page(icon.size));
	const png = await tab.screenshot({ omitBackground: false });
	const target = join(MEDIA, icon.name);

	if (!CHECK) {
		writeFileSync(target, png);
		console.log(icon.name + '  ' + icon.size + 'x' + icon.size + '  ' + png.length + ' B');
		continue;
	}

	if (!existsSync(target)) { bad.push(icon.name + ': not committed'); continue; }

	/* the committed file is what ships, so every invariant is asked OF IT, with the fresh render as
	 * the reference for the one question a file cannot answer about itself */
	const r = await inspect(tab, uri(readFileSync(target)), uri(png), BG);
	const say = (msg) => bad.push(icon.name + ': ' + msg);

	if (r.w !== icon.size || r.h !== icon.size)
		say(`is ${r.w}x${r.h}, and the manifest declares ${icon.size}x${icon.size}`);
	if (!r.opaque)
		say('has transparent pixels — a maskable icon must carry its own background');
	if (r.outside)
		say(`paints ${r.outside} px outside the maskable safe zone (the middle ${SAFE * 100}%), `
			+ 'where a round or a squircle crop is free to cut it away');
	if (!r.mark)
		say('is the background colour all the way through — there is no mark on it');
	if (r.sizeMatch === false)
		say('is a different size from a fresh render of logo.svg');
	else if (r.drift !== null && r.drift > SHARE)
		say(`differs from a fresh render of logo.svg on ${(r.drift * 100).toFixed(1)}% of its pixels `
			+ `(the tolerance is ${SHARE * 100}%, which absorbs a renderer's antialiasing and nothing else)`);
	else if (CHECK)
		console.log('ok  ' + icon.name + '  ' + r.w + 'x' + r.h
			+ '  drift ' + (r.drift * 100).toFixed(2) + '%');
}

await browser.close();

if (CHECK && bad.length) {
	console.error('\nbuild-icons: the committed app icons do not hold.\n');
	for (const line of bad) console.error('  ' + line);
	console.error('\nIf logo.svg changed, run `node tools/build-icons.mjs` and commit the result.\n');
	process.exit(1);
}
if (CHECK) console.log('ok — the committed app icons match logo.svg.');

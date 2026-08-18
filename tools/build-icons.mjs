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
 *   --check re-renders into a temp dir and fails if the committed PNGs differ — for CI, so a logo
 *           edit cannot ship with stale icons.
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

const browser = await chromium.launch();
/* forced light: logo.svg carries a prefers-color-scheme rule that lightens the ring for a dark tab
 * strip, and an icon rendered under it would be the wrong one on every light home screen */
const ctx = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1 });
const tab = await ctx.newPage();

const outDir = CHECK ? mkdtempSync(join(tmpdir(), 'fs-icons-')) : MEDIA;
const stale = [];

for (const icon of ICONS) {
	await tab.setViewportSize({ width: icon.size, height: icon.size });
	await tab.setContent(page(icon.size));
	const png = await tab.screenshot({ omitBackground: false });
	const target = join(MEDIA, icon.name);
	if (CHECK) {
		if (!existsSync(target) || !readFileSync(target).equals(png)) stale.push(icon.name);
	}
	else {
		writeFileSync(join(outDir, icon.name), png);
		console.log(icon.name + '  ' + icon.size + 'x' + icon.size + '  ' + png.length + ' B');
	}
}

await browser.close();

if (CHECK && stale.length) {
	console.error('\nbuild-icons: ' + stale.join(', ') + ' no longer match logo.svg.'
		+ '\nRun `node tools/build-icons.mjs` and commit the result.\n');
	process.exit(1);
}
if (CHECK) console.log('ok — the committed app icons match logo.svg.');

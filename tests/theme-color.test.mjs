/* The one colour literal the theme ships twice, and the wiring that keeps it from mattering.
 *
 * `manifest.json` and the `<meta name="theme-color">` in partials/head.ut state the same fact — the
 * default palette's page colour — because neither file is rendered per request. A router cannot
 * catch them drifting: the manifest paints the installed app's splash and the meta paints the
 * address bar, so a mismatch looks like two slightly different browsers rather than a bug.
 *
 * The meta is only a starting value; fs-prefs.js repaints it from the live body background. That
 * repaint is what makes the literal cosmetic, so the last check here is that the wiring still
 * exists — without it the tag freezes at the default palette in light mode and nothing says so. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../tools/lib/root.mjs';

const HEAD = read('luci-theme-footstrap/ucode/template/themes/footstrap/partials/head.ut');
const MANIFEST = read('luci-theme-footstrap/htdocs/luci-static/footstrap/manifest.json');
const PREFS = read('luci-theme-footstrap/htdocs/luci-static/resources/fs-prefs.js');
const COMMON = read('luci-theme-footstrap/htdocs/luci-static/resources/menu-footstrap-common.js');

test('head.ut ships exactly one theme-color meta, with a literal colour', () => {
	const tags = [ ...HEAD.matchAll(/<meta\s+name="theme-color"[^>]*>/g) ];
	assert.equal(tags.length, 1,
		'a second, media-qualified tag would outrank this one for a viewer whose OS disagrees with '
		+ 'the choice made in Appearance');
	assert.match(tags[0][0], /content="#[0-9a-f]{6}"/,
		'the server cannot compute the palette colour, so the tag carries a literal');
});

test('the meta literal is the manifest theme_color', () => {
	const meta = HEAD.match(/<meta\s+name="theme-color"\s+content="(#[0-9a-f]{6})"/)[1];
	const manifest = JSON.parse(MANIFEST);
	assert.equal(meta, manifest.theme_color,
		'both state the default palette page colour; change one and change the other');
	assert.equal(manifest.theme_color, manifest.background_color,
		'the splash and the window chrome are the same surface');
});

test('the tag is repainted from the live page colour', () => {
	assert.match(PREFS, /function watchThemeColor\(/,
		'fs-prefs owns the repaint; without it the tag freezes at the default palette');
	assert.match(PREFS, /getComputedStyle\(document\.body\)\.backgroundColor/,
		'read the computed background, never the --fs-bg token: a custom property hands back its '
		+ 'token stream, so a mixed palette colour would land in the attribute verbatim');
	assert.match(COMMON, /prefs\.watchThemeColor\(\)/,
		'the watcher is started from init(), beside the dark-stamp guard');
});

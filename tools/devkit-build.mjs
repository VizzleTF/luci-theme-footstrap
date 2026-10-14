/* devkit-build.mjs — assemble the self-contained luci-app developer portal.
 *
 * docs/devkit.html is GENERATED (like cascade.css) and gitignored: the page an external luci-app-*
 * author opens to see what to copy and what not to do, with no router. Every part comes from a
 * file that exists here, so nothing is hand-copied and nothing drifts:
 *
 *   - the stylesheet         <- build-css.sh (the real cascade.css, inlined)
 *   - the export tier        <- styles/02-tokens.css (parsed — the one contract apps may read)
 *   - the component catalogue <- docs/gallery.html (the single source of real widget markup)
 *   - the chrome and prose   <- docs/devkit.src.html
 *
 * The DOM->E() conversion and click-to-copy run in the BROWSER off the rendered preview node.
 * The playground is not part of this build: it is recorded from a real router by
 * `tools/playground/*` and CI's `playground` job, not assembled from a committed source file. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCss } from './lib/css.mjs';
import { parseExportTier } from './lib/tokens.mjs';

import { ROOT } from './lib/root.mjs';
const SRC = join(ROOT, 'docs/devkit.src.html');
const GALLERY = join(ROOT, 'docs/gallery.html');
const TOKENS = join(ROOT, 'luci-theme-footstrap/styles/02-tokens.css');
const OUT = join(ROOT, 'docs/devkit.html');

/* The export tier is the whole contract an app is allowed to read. Its NAMES are parsed from the
 * token file (tools/lib/tokens.mjs — shared with export-tier.mjs, which MEASURES the same set);
 * the values render live from the inlined stylesheet, so we never restate a colour. */

/* Pull each <div class="g-sec"> out of the gallery. They are siblings (g-sec never nests), so a
 * split on the opening tag is exact. Strip the two things that are QA-internal, not dev-facing:
 * HTML comments and the .g-note commentary (absorption backlogs, "until it did" — noise to a
 * consumer). What is left is the widget markup ui.js/cbi.js really emit. */
function parseComponents(html) {
	const body = html.slice(html.indexOf('<div class="g-sec">'));
	return body.split('<div class="g-sec">').filter((c) => c.trim()).map((chunk) => {
		let sec = chunk.slice(0, chunk.search(/<\/div>\s*(?:<\/div>\s*<\/body>|$|<div class="g-sec">)/));
		// the h2 may not be the very first node in the "Data table" section (two h2s) — take the first
		const title = (sec.match(/<h2>([\s\S]*?)<\/h2>/) || [, ''])[1].replace(/&amp;/g, '&').trim();
		let markup = sec.replace(/<h2>[\s\S]*?<\/h2>/, '');
		// strip HTML comments to a fixed point — one pass can re-form <!-- from the removal
		// of a nested/overlapping pair (CodeQL js/incomplete-multi-character-sanitization)
		let prev;
		do { prev = markup; markup = markup.replace(/<!--[\s\S]*?-->/g, ''); } while (markup !== prev);
		markup = markup
			.replace(/<p class="g-note">[\s\S]*?<\/p>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		return { title, markup };
	}).filter((c) => c.title && c.markup);
}

const [src, galleryHtml, tokensCss] = await Promise.all([
	readFile(SRC, 'utf8'), readFile(GALLERY, 'utf8'), readFile(TOKENS, 'utf8'),
]);
const css = await readFile(buildCss(), 'utf8');
if (/url\((?!\s*["']?data:)/.test(css)) throw new Error('cascade.css references a file; devkit.html must be one file');
const tiers = parseExportTier(tokensCss);
const components = parseComponents(galleryHtml);

const data = { tiers, components };
const out = src
	.replace('/*__CASCADE__*/', () => css)
	.replace('/*__DATA__*/', () => 'window.FS_DEVKIT=' + JSON.stringify(data) + ';');

await writeFile(OUT, out);
console.log(`devkit.html: ${tiers.length} token families, ${components.length} components, ${(out.length / 1024 | 0)} KB`);

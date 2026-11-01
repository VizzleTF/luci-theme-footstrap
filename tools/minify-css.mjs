// minify-css.mjs <cascade.css>: lightningcss over the squeezed sheet, in place, before mangle-tokens.sh.
// Targets are the browser floor (docs/css.md "The browser floor"); it may only shorten what that floor
// already parses, so a floor change moves TARGETS too. light-dark() is excluded: the sheet has none,
// and its polyfill would add bytes if one ever came in. Vendor prefixes are excluded so the source
// alone decides them (docs/css.md "Vendor prefixes"): lightningcss would re-add -webkit-backdrop-filter
// for Safari 17.2.
import { readFileSync, writeFileSync } from 'node:fs';
import { transform, Features } from 'lightningcss';

const TARGETS = { chrome: 120 << 16, firefox: 121 << 16, safari: (17 << 16) | (2 << 8) };

const file = process.argv[2];
if (!file) {
	console.error('usage: minify-css.mjs <cascade.css>');
	process.exit(1);
}
const src = readFileSync(file);
const { code, warnings } = transform({ filename: file, code: src, minify: true, targets: TARGETS, exclude: Features.LightDark | Features.VendorPrefixes });
// a warning is a rule lightningcss could not read: shipping its rewrite would drop that rule silently
if (warnings.length) {
	for (const w of warnings) console.error(`minify-css: ${w.message} (line ${w.loc.line})`);
	process.exit(1);
}
writeFileSync(file, code);
console.log(`minify-css: ${src.length} -> ${code.length} bytes`);

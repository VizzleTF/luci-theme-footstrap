/* Accessibility gate — axe-core (WCAG 2.2 AA) over docs/gallery.html.
 *
 * The gallery, not the router: LuCI renders content client-side, so auditing a real page needs a
 * router, a session and a network. The gallery is a static file rendering every widget LuCI or a
 * third-party luci-app-* can emit, with the real class names — the theme's whole widget surface,
 * checkable in CI with no device. The full palette x mode x tint matrix is 24 runs, because a
 * palette switcher multiplies the contrast matrix and colour failures regress silently in the
 * combination nobody looks at: that is how the 1.69:1 white-on-green in hicontrast dark survived
 * as long as it did.
 *
 * Fails on `serious`/`critical` only; `moderate`/`minor` print but do not gate, the gallery
 * rendering widgets out of any page context (isolated <table>s, headings with no document
 * outline), which trips landmark and heading-order rules that say nothing about the theme. */
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { serveGallery, applyAppearance, matrix } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';

/* build + serve + Appearance-axis stamping: shared with export-tier.mjs (tools/lib/gallery.mjs) */
const { base, close } = await serveGallery(buildCss());

/* The Tint axis re-hues every surface, so it multiplies this matrix like the palette does — and
 * unlike the palette it is a slider: the user can land anywhere on the wheel. Two hues, not the
 * six export-tier.mjs sweeps, because these are the extremes that matter: at the tint anchor's
 * fixed lightness, yellow carries the most luminance and blue the least, so they bracket what a
 * mix can do to the contrast of text on the surface. `null` = untinted. */
const TINTS = [null, 60, 260];

const MATRIX = matrix(TINTS);

const browser = await chromium.launch();
/* axe-core needs a real BrowserContext (it injects into every frame), not the implicit page
 * browser.newPage() creates. */
const ctx = await browser.newContext();
let failed = 0;

/* Nothing below asserted the gallery actually rendered: a blank page still runs the axe pass 24
 * times, gets an empty violations array back every time, and prints "clean across all 24
 * combinations" — a pass that measured nothing reads exactly like a pass that measured everything.
 * MEASURED is the current node count (853, task-gate-audit); the floor sits far under it so a
 * widget added or removed never trips it. Checked once, not per-combination, since a page that
 * renders once renders the same DOM every time here (only :root attributes move). */
const EXCLUDE_DROPDOWN = '.cbi-dropdown[multiple] li > form > input[type="checkbox"]';
const EXCLUDE_PLACEHOLDER = '.cbi-dropdown li[placeholder]';
const MEASURED_NODES = 853;
const NODES_FLOOR = 200;
const errorOut = (msg) => { console.error(`\nFAIL: ${msg}`); process.exit(1); };

for (const { mode, palette, tint } of MATRIX) {
	const page = await ctx.newPage();
	await page.goto(base, { waitUntil: 'load' });
	await applyAppearance(page, { mode, palette, tint });
	await page.waitForTimeout(400);   /* let the webfonts settle before measuring contrast */

	const nodeCount = await page.evaluate(() => document.querySelectorAll('*').length);
	if (nodeCount < NODES_FLOOR) {
		console.error(`\nFAIL: the gallery rendered only ${nodeCount} node(s) (last real run: `
			+ `~${MEASURED_NODES}) at ${palette}/${mode} — this is not a clean sweep, it is a blank `
			+ `or broken page. axe-core cannot find a violation on markup that never rendered.`);
		process.exit(1);
	}
	/* The two exclude() selectors below are unverified by axe itself: if either stops matching, the
	 * exclusion silently widens (excludes nothing, which is safe) or the row it used to carve out
	 * goes back to being measured wrong — a labelless checkbox or under-AA placeholder ink flagged
	 * as a real violation, OR the selector rots to matching something else and hides a genuine
	 * fault. Both directions are silent without this. */
	const [dropdownHits, placeholderHits] = await page.evaluate(([a, b]) => (
		[document.querySelectorAll(a).length, document.querySelectorAll(b).length]
	), [EXCLUDE_DROPDOWN, EXCLUDE_PLACEHOLDER]);
	if (!dropdownHits)
		errorOut(`exclude('${EXCLUDE_DROPDOWN}') matched nothing at ${palette}/${mode} — the open `
			+ `multi-select fixture is gone or the selector no longer names it, and axe is measuring `
			+ `nothing where this exclusion used to carve out a known-presentational checkbox`);
	if (!placeholderHits)
		errorOut(`exclude('${EXCLUDE_PLACEHOLDER}') matched nothing at ${palette}/${mode} — the `
			+ `placeholder-ink fixture is gone or the selector no longer names it; placeholder-ink.mjs `
			+ `is the gate that actually holds this token, but this exclusion existing for nothing `
			+ `means nobody is excluding it on purpose any more`);

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		/* The one exclusion, and it is a piece of markup rather than a rule.
		 *
		 * A multi-select `.cbi-dropdown` row is ui.js's own shape: the label neither wraps the input
		 * nor carries `for`, so axe reports `label` (critical) on every row. The checkbox is
		 * PRESENTATIONAL there — out of the tab order, its clicks cancelled, with the `<li>` carrying
		 * the interaction — and nothing in a stylesheet can add the association. Excluding the input
		 * keeps the row itself measured, which is why an open menu is rendered here at all: contrast
		 * on a chosen row is a theme decision and this is the only place it is checked. Narrow on
		 * purpose: the exclusion names the input, not the section. Fix it upstream and delete this. */
		.exclude(EXCLUDE_DROPDOWN)
		/* The second, and it is a DECISION rather than markup: `li[placeholder]` is the theme's
		 * placeholder ink, which ships deliberately under AA — a hint mistaken for a value makes a
		 * reader configure the wrong thing, and only a hint far enough from the body ink stops that
		 * (styles/03-palettes.css has the argument and the numbers). axe measures this row because
		 * ui.js renders it as real text, and skips the `placeholder` ATTRIBUTE beside it, which
		 * carries the same ink for the same reason — so the rule reaches half the decision and
		 * fails it. `placeholder-ink` is the gate that holds this token instead, with its own two
		 * thresholds and a prefers-contrast pass where the AA ink comes back. */
		.exclude(EXCLUDE_PLACEHOLDER)
		.analyze();

	const hard = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
	const soft = violations.filter((v) => !hard.includes(v));

	const label = `${palette}/${mode}${tint === null ? '' : `/tint${tint}`}`;
	if (!hard.length) {
		console.log(`✔ ${label.padEnd(22)} no serious/critical violations` +
			(soft.length ? `  (${soft.length} moderate/minor, not gating)` : ''));
	} else {
		failed += hard.length;
		console.log(`✖ ${label.padEnd(22)} ${hard.length} serious/critical:`);
		for (const v of hard) {
			console.log(`    [${v.impact}] ${v.id}: ${v.help}`);
			const LIMIT = process.env.AXE_ALL ? 999 : 4;
			for (const n of v.nodes.slice(0, LIMIT))
				console.log(`      ${n.target.join(' ')}\n        ${(n.failureSummary || '').split('\n').slice(1).join(' ').trim().slice(0, 200)}`);
			if (v.nodes.length > LIMIT) console.log(`      … and ${v.nodes.length - LIMIT} more`);
		}
	}
	await page.close();
}

await ctx.close();
await browser.close();
close();

if (failed) {
	console.error(`\n${failed} serious/critical accessibility violation(s) — see above`);
	process.exit(1);
}
console.log(`\naxe-core: clean across all ${MATRIX.length} palette x mode x tint combinations`);

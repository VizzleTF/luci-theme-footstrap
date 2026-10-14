/* Accessibility gate — axe-core (WCAG 2.2 AA) over docs/gallery.html.
 *
 * The gallery, not the router: LuCI renders content client-side, so auditing a real page needs a
 * router, a session and a network. The gallery is a static file rendering every widget LuCI or a
 * third-party luci-app-* can emit, with the real class names — the theme's whole widget surface,
 * checkable in CI with no device. One run per palette x mode x tint combination (`MATRIX.length`),
 * because colour failures regress silently in the combination nobody looks at: that is how the
 * 1.69:1 white-on-green in hicontrast dark survived.
 *
 * Fails on `serious`/`critical` only; `moderate`/`minor` print but do not gate, the gallery
 * rendering widgets out of any page context (isolated <table>s, headings with no document
 * outline), which trips landmark and heading-order rules that say nothing about the theme. */
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { serveGallery, applyAppearance, matrix, GALLERY_FLOOR, blankGallery } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';

/* build + serve + Appearance-axis stamping: shared by eight tools (tools/lib/gallery.mjs) */
const { base, close } = await serveGallery(buildCss());

/* Tint is a slider, so the matrix takes two hues, not the six export-tier.mjs sweeps: at the
 * anchor's fixed lightness yellow carries the most luminance and blue the least, bracketing the
 * contrast of text on the surface. `null` = untinted. */
const TINTS = [null, 60, 260];

const MATRIX = matrix(TINTS);

const browser = await chromium.launch();
/* axe-core needs a real BrowserContext (it injects into every frame), not the implicit page
 * browser.newPage() creates. */
const ctx = await browser.newContext();
let failed = 0;

/* A blank page passes axe with no violations in every combination, so a probe page asserts the
 * gallery rendered, once (only :root attributes move between combinations); floor in lib/gallery.mjs. */
const EXCLUDE_DROPDOWN = '.cbi-dropdown[multiple] li > form > input[type="checkbox"]';
const EXCLUDE_PLACEHOLDER = '.cbi-dropdown li[placeholder]';
const errorOut = (msg) => { console.error(`\nFAIL: ${msg}`); process.exit(1); };

{
	const probe = await ctx.newPage();
	await probe.goto(base, { waitUntil: 'load' });
	const [nodeCount, dropdownHits, placeholderHits] = await probe.evaluate(([a, b]) => [
		document.querySelectorAll('*').length,
		document.querySelectorAll(a).length,
		document.querySelectorAll(b).length,
	], [EXCLUDE_DROPDOWN, EXCLUDE_PLACEHOLDER]);
	await probe.close();
	if (nodeCount < GALLERY_FLOOR) errorOut(blankGallery(nodeCount) + ' axe-core cannot find a violation on markup that never rendered.');
	/* axe does not verify the two exclude() selectors below: one that stops matching either flags a
	 * presentational checkbox or placeholder ink as a violation, or rots onto other markup and
	 * hides a real fault, both silently. */
	if (!dropdownHits)
		errorOut(`exclude('${EXCLUDE_DROPDOWN}') matched nothing — the open `
			+ `multi-select fixture is gone or the selector no longer names it, and axe is measuring `
			+ `nothing where this exclusion used to carve out a known-presentational checkbox`);
	if (!placeholderHits)
		errorOut(`exclude('${EXCLUDE_PLACEHOLDER}') matched nothing — the `
			+ `placeholder-ink fixture is gone or the selector no longer names it; placeholder-ink.mjs `
			+ `is the gate that actually holds this token, but this exclusion existing for nothing `
			+ `means nobody is excluding it on purpose any more`);
}

for (const { mode, palette, tint } of MATRIX) {
	const page = await ctx.newPage();
	await page.goto(base, { waitUntil: 'load' });
	await applyAppearance(page, { mode, palette, tint });
	await page.waitForTimeout(400);   /* unmeasured: covers the --fs-dur/--fs-dur-fade transitions after the stamp */

	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		/* ui.js's multi-select row neither wraps the input in its label nor carries `for`, so axe
		 * reports `label` (critical) on every row. The checkbox is presentational (out of the tab
		 * order, clicks cancelled) and no stylesheet can add the association; excluding the input
		 * keeps the row's contrast measured. Fix upstream and delete this. */
		.exclude(EXCLUDE_DROPDOWN)
		/* `li[placeholder]` is the placeholder ink, deliberately under AA (styles/03-palettes.css has
		 * the numbers); axe measures this row as text but skips the `placeholder` attribute, so it
		 * would fail half the decision. `placeholder-ink` holds the token instead. */
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

/* Forced-colors pass. axe cannot run it: forced colors replaces the palette axe measures, and a
 * repair in `@media (forced-colors: active)` (styles/theme/95-a11y-media.css) that no longer
 * reaches its element changes nothing in any other pass — 8430a64 found `.cbi-dropdown > ul >
 * li[selected]` and a `:focus-visible` that 15 `outline: none` rules beat, both green everywhere.
 * Two checks: every selector in a forced-colors block still reaches an element in the gallery, and
 * keyboard focus draws a Highlight outline. */
/* Selectors the gallery cannot reach because only the template chrome (header.ut, and the rail guard
 * head.ut stamps on :root) renders them: no #topmenu, #tabmenu or rail toggle in a static file. */
const CHROME_ONLY = new Map([
	['#topmenu li.active > a', 'the top menu is header.ut chrome'],
	['.fs-railtoggle', 'the rail toggle is header.ut chrome'],
	['#tabmenu ul.tabs > li.active > a', '#tabmenu is header.ut chrome'],
	[':root[data-layout="sidebar"]:not([data-narrow])[data-rail="true"] .fs-sidebar #indicators [data-indicator="poll-status"]', 'the rail guard is stamped on :root by head.ut'],
	[':root[data-layout="sidebar"]:not([data-narrow])[data-rail="true"] .fs-sidebar #indicators [data-indicator="poll-status"]:not([data-style="active"])', 'the rail guard is stamped on :root by head.ut'],
]);
const FC_SELECTORS_FLOOR = 23; // the 23 measured on this tree; a lower count means the walk lost a block
const fcPage = await ctx.newPage();
await fcPage.emulateMedia({ forcedColors: 'active' });
await fcPage.goto(base, { waitUntil: 'load' });
const fc = await fcPage.evaluate(() => {
	const sels = [];
	const walk = (rules, inFc) => {
		for (const r of rules) {
			if (r.selectorText !== undefined) { if (inFc) sels.push(r.selectorText); continue; }
			if (r.cssRules) walk(r.cssRules, inFc || (r.conditionText || '').includes('forced-colors'));
		}
	};
	for (const sheet of document.styleSheets) walk(sheet.cssRules, false);
	const split = (t) => {
		const out = []; let depth = 0, cur = '';
		for (const ch of t) {
			if ('(['.includes(ch)) depth++; else if (')]'.includes(ch)) depth--;
			if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
		}
		return [...out, cur.trim()].filter(Boolean);
	};
	const items = sels.flatMap(split).map((raw) => ({
		raw,
		stripped: raw.replace(/::(?:before|after)|:(?:focus-visible|focus|hover|active)\b/g, '').trim() || '*',
		focus: raw.includes(':focus-visible'),
	}));
	return items.map((i) => ({ ...i, hits: document.querySelectorAll(i.stripped).length }));
});
const fcMiss = fc.filter((i) => !i.hits && !CHROME_ONLY.has(i.raw));
if (fc.length < FC_SELECTORS_FLOOR)
	errorOut(`forced-colors reach: only ${fc.length} selector(s) found in @media (forced-colors) blocks (floor ${FC_SELECTORS_FLOOR}) — the walk lost the blocks`);
if (fcMiss.length)
	errorOut(`forced-colors reach: ${fcMiss.length} repair selector(s) reach no element in the gallery:\n  ${fcMiss.map((i) => i.raw).join('\n  ')}\n`
		+ `  a repair that matches nothing is dead; fix the selector, or add the fixture to docs/gallery.html`);
console.log(`✔ forced-colors reach: ${fc.length} selector(s) checked, ${fc.filter((i) => i.hits).length} reach an element, ${fc.length - fc.filter((i) => i.hits).length} template-chrome-only`);

const focusSel = fc.filter((i) => i.focus).map((i) => i.stripped);
await fcPage.keyboard.press('Tab');   /* keyboard modality, or :focus-visible does not match on focus() */
const focus = await fcPage.evaluate((sel) => {
	const probe = document.createElement('i');
	probe.style.color = 'Highlight';
	document.body.append(probe);
	const want = getComputedStyle(probe).color;
	probe.remove();
	const bad = []; let n = 0;
	for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
		if (!sel.some((s) => el.matches(s))) continue;
		el.focus({ preventScroll: true });
		if (document.activeElement !== el || !el.matches(':focus-visible')) continue;
		n++;
		const cs = getComputedStyle(el);
		if (cs.outlineStyle === 'none' || cs.outlineColor !== want)
			bad.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : ''} outline ${cs.outlineStyle} ${cs.outlineColor}`);
		el.blur();
	}
	return { n, bad, want };
}, focusSel);
if (focus.n < 20) errorOut(`forced-colors focus: only ${focus.n} focusable element(s) measured — the pass lost its targets`);
if (focus.bad.length)
	errorOut(`forced-colors focus: ${focus.bad.length}/${focus.n} element(s) show no ${focus.want} outline under keyboard focus:\n  ${focus.bad.slice(0, 8).join('\n  ')}`);
console.log(`✔ forced-colors focus: ${focus.n} focusable element(s) show a Highlight outline`);

await ctx.close();
await browser.close();
close();

if (failed) {
	console.error(`\n${failed} serious/critical accessibility violation(s) — see above`);
	process.exit(1);
}
console.log(`\naxe-core: clean across all ${MATRIX.length} palette x mode x tint combinations`);

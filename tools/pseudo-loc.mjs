#!/usr/bin/env node
/* Pseudo-localisation gate: every gate in this repository renders English, and every layout fault
 * shipped so far shipped because of that. A toggle knob left its pill on every Russian phone at
 * default density while English only broke at Density=Large on a 360px screen (task 0145) — nothing
 * in `npm run check` renders anything but English, so nothing caught it. Two more of the same class
 * followed within hours: a form label escaping its section, a dropdown cutting its own value.
 *
 * The standard answer (Google, "Pseudolocalization", 2011) is to render the SAME markup with
 * systematically longer strings and assert nothing overflows — no translation catalogue, no router,
 * no second language needed. This is that gate, over `docs/gallery.html` (the fixture `a11y-gallery`
 * and `computed-diff` already share — see tools/lib/gallery.mjs, reused rather than a third harness).
 *
 * WHAT IT DOES
 *   1. builds the stylesheet, serves the gallery (tools/lib/gallery.mjs, same as every other
 *      gallery gate);
 *   2. walks every visible text node and every visible-text-carrying attribute (placeholder, title,
 *      aria-label, the value of input[type=button|submit|reset]) and replaces it with a
 *      pseudo-localised form: each WORD grown by a fixed 45% (filler drawn from the word's own
 *      characters, so no new break opportunity is introduced — real translations make individual
 *      words longer, they do not sprinkle in new spaces) and Latin letters swapped for accented
 *      look-alikes, the whole string bracketed so a human reading a screenshot knows it is not real
 *      copy. Pure function of the input text: the same string always grows to the same string, so a
 *      failure reproduces and a diff is readable;
 *   3. measures at 320 and 390 CSS px (every fault this gate exists for lived on a phone) crossed
 *      with all three densities (Density=Large is what exposed the English half of task 0145's own
 *      bug — a matrix that skips it would have shipped the same gap again);
 *   4. asserts three shapes of overflow, all read off real layout rather than out of the stylesheet:
 *      `self` (an element's own content exceeds its box — `scrollWidth` past `clientWidth` on a
 *      NON-scrolling element; this is what caught task 0145 itself, see below), `parent` (a normal-
 *      flow box whose rendered edge sits past its own parent's), and `clip` (content clipped by an
 *      ancestor that has no scrollbar to reach it with — the severe case, "text the reader cannot
 *      reach", the shape two of today's three faults actually were). Every shape is measured TWICE —
 *      once on the untouched (English) page, once after pseudo-localisation — and only a finding that
 *      GREW past `--eps` between the two is reported (see "BEFORE/AFTER", below). A gate whose job is
 *      "the longer string broke this" has no business reporting a box that was already broken in
 *      English: `docs/gallery.html` measured 13 such self-overflow findings at 320px with NO string
 *      touched at all (a synthetic unbroken RU label built to exercise `min-width: 0`, a breadcrumb
 *      path, an iface stat line) — real, but not this gate's fault to report, and not caused by
 *      translation length.
 *
 * PROVEN TO BITE: `flex-shrink: 0` on `.cbi-checkbox > label[for]` (styles/theme/60-inputs.css,
 * task 0145) reverted in a scratch copy outside this checkout. The switch's pill is a flex item
 * beside a caption that pseudo-localisation just made longer; unshrunk, the pill's own
 * `scrollWidth - clientWidth` (its knob, a `::after` the pill's `overflow: visible` box still
 * measures) sits at 2px everywhere on the intact tree — border/padding rounding, not a fault — and
 * jumps to 6-23px across the six width/density points once the fix is gone (390/compact 6px,
 * 320/normal 18px, 320/large 23px). Nothing about the check names the switch; it is the generic
 * `self` assertion landing on the one element the reverted rule actually broke. `--eps` moves the
 * tolerance the intact tree needs; the default is the 2px this measurement found.
 *
 * KNOWN FALSE-POSITIVE TRAPS, GUARDED:
 *   - an empty `.modal` kept in the DOM at all times on a real router would measure a zero-content
 *     box and report a clean sheet — not reachable here since the gallery's `#modal_overlay` is
 *     forced visible and populated on purpose (docs/gallery.html, "Modal"), but `vis()` below still
 *     requires `getClientRects().length > 0`, so an actually-empty box never becomes a false pass by
 *     being skipped from the count silently;
 *   - a collapsed submenu's links carry an ordinary computed `display` while their `<ul>` ancestor is
 *     `display: none`, so they measure a zero rect rather than a laid-out one — the same
 *     `getClientRects().length > 0` filter used by `tools/live-audit.mjs` excludes them, since a
 *     hidden ancestor gives every descendant zero client rects;
 *   - a third-party app, or the theme itself, can legitimately pin a width and accept the
 *     consequence rather than fix it — the filemanager's 600px case is baselined, not gated, in
 *     `tools/baselines/live-audit.json` for exactly this reason, and this gate has no baseline file
 *     of its own (out of this card's file list), so the decision here is a plain selector ALLOW list,
 *     the same shape as `a11y-gallery.mjs`'s `.exclude()`. Two entries ship, both already decided and
 *     documented elsewhere, neither a new exception invented for this gate:
 *       - `.table` and its DATA descendants (task 0161: `:not(.cbi-section-actions, .cbi-section-actions
 *         *)` carves the action cell back out — see below) — a data table's width is
 *         `tools/table-contract.mjs`, `table-tick` and `live-audit`'s contract, held by
 *         `fs-select.js`'s runtime card transform at CRAMPED widths. `docs/gallery.html` carries no
 *         LuCI JS, so a table here never gets fitted or carded — it renders at its raw intrinsic width
 *         on purpose (the file's own comment: "the gallery has no LuCI JS, so they get a scroll frame
 *         here and the page itself stays measurable"). Flagging that here would be re-litigating a
 *         contract this gate cannot exercise, not a text-overflow finding;
 *       - `.cbi-dropdown > ul > li` — the closed single-value control's ellipsis, which
 *         `styles/theme/65-dropdown.css` documents as accepted and DELIBERATE (task 0149): a flex
 *         item's automatic minimum stops `overflow: hidden` from eliding a value longer than the
 *         400px cap, and no `title`/`aria-label` is added to compensate on purpose — a `title` is
 *         not announced on touch, and a shortened `aria-label` would violate WCAG 2.5.3. The text is
 *         still pseudo-localised (it is real, user-supplied content), only the overflow it already
 *         has by design is not re-reported as new.
 *
 * ACCEPTED (task 0155 triage, 117 findings, 9 distinct root elements): every ellipsis/reserve shape
 * already decided elsewhere and re-measured, not re-litigated here —
 *   - `label[for="g-longlabel"]` — the gallery's own deliberate torture fixture (base/30-forms.css:
 *     one 38-char unbroken RU compound, built to reproduce that file's `min-width: 0` FLOOR, whose
 *     own comment already states "real RU option text with normal word breaks does not need to hit
 *     this floor at all"). Its OTHER, breakable words ("при обрыве") still grow under pseudo-loc,
 *     and even bracket-only growth (no word grows) is enough to push an element already 153px past
 *     its box at 320/Large before this gate ever touches it — no CSS can make an intentionally
 *     unbroken 38-char run fit a 320px column, and reproducing that is this fixture's only job.
 *   - `.cbi-filebrowser > p`, `.cbi-filebrowser > p *` — the upload breadcrumb. `.cbi-filebrowser > *`
 *     (styles/base/95-luci.css) gives every row of this widget `overflow: hidden; text-overflow:
 *     ellipsis; white-space: nowrap` on purpose, the same shape as the dropdown above, applied here
 *     to a real absolute path: a long one ellipsises instead of wrapping, same trade, same reason.
 *   - `.cbi-tabmenu > li > a`, `.cbi-tabmenu > li > a *` — confirmed NOT a repeat of task 0149's own
 *     bug (that fix, `.cbi-tabmenu > li { max-width: 100% }`, still holds: measured, the `<li>`
 *     shrinks to 129.9px against a 264px strip and the label visibly ellipsises). What pseudo-loc
 *     measures here is `scrollWidth` on the now-correctly-truncated `<a>` itself, which is exactly
 *     what an ellipsis'd element always measures — the dropdown case by another selector.
 *   - `.cbi-progressbar` (task 0161: widened from `.cbi-value-field > .cbi-progressbar` — the reserve
 *     below is a property of the bar's own class, styles/theme/25-progressbar.css, whether or not a
 *     `.cbi-value-field` happens to wrap it) — the meter's reading, floated beside the bar in a
 *     margin the bar reserves for it ("meter/beside", 80px measured on the gallery's dBm fixture,
 *     ALREADY special-cased once: the self-check's tolerance is `eps + margin`, not `eps` alone).
 *     Even that documented reserve is marginal for "-140.0 dBm" in plain ENGLISH (86px against an
 *     82px tolerance, measured pre-pseudo-loc) — pseudo-loc's own bracket wrapper (`[…]`, added to
 *     every touched string so a screenshot reads as pseudo-localised) is what pushes it further
 *     over, not a translation: neither the digits nor `dBm` (<= 3 letters) grow under `pseudo()`.
 *     Widening the reserve to swallow a bracket nobody's translation adds would be tuning the
 *     fixture to the gate, backwards from what a gate is for.
 *   - `.cbi-filebrowser > ul > li > div:first-child`, `… *` — the listing's filename column, already
 *     `overflow: hidden; text-overflow: ellipsis` (styles/base/95-luci.css) with `min-width: 0`
 *     (styles/theme/60-inputs.css): the same working, deliberate shrink-then-ellipsis pair as the
 *     dropdown, just on a filename instead of a form value — a long one (a real router's sysupgrade
 *     image or a long cert name is not shorter) ellipsises rather than wrapping mid-name.
 * All five read the SAME shape pseudo-loc already accepts for the dropdown (an intentional ellipsis,
 * or a documented, measured reserve) — none is a new exception invented for this gate.
 *
 * TASK 0161 (verification): the ALLOW walk used to climb from each matched element to <body>,
 * excusing every ancestor along the way — 311 of 822 elements and 14 of 22 gallery sections read as
 * unmeasurable, including all four buttons of the "Row actions, plain table (Startup-style)" fixture
 * this same triage had just added. Fixed to match ONLY the selector's own elements (MEASURE_BEFORE/
 * MEASURE_AFTER below); re-running then surfaced 66 findings, all traceable to the SAME three already-
 * accepted leaves above (`#g-longlabel`, `.cbi-progressbar`, `.table`) cascading into their own
 * container's self-check (`scrollWidth` is cumulative) — none a new theme fault. Each container is
 * now named explicitly with `:has()` against the leaf that causes it (`.cbi-value`, `.cbi-section`,
 * `.g-sec` and similar), not re-climbed automatically, and `.g-wrap` — the gallery's own outermost
 * wrapper, not a widget any page renders — is allowed outright since it will read as "widest content
 * on the page" for as long as any of the three permanent exceptions exists at all, on any of the 22
 * sections. The Startup fixture's buttons themselves are NOT among the 66: `.table *` is narrowed to
 * carve the `.cbi-section-actions` cell back out (see the ALLOW list), and with that done they measure
 * clean — theme/55-buttons.css's `flex-basis: auto` (tonight, same automatic-minimum cause as the
 * toggle knob and the form label above) already covers this exact fixture, reproduced there rather
 * than a second mechanism invented here.
 *
 * BEFORE/AFTER, the general case ALLOW cannot cover: a fixed allowlist names a SELECTOR, which only
 * works for a case already tied to a class. `#g-longlabel`'s 38-character unbroken RU compound (see
 * the `pseudo()` comment below), a breadcrumb's `»`-joined path, and an iface card's live-looking
 * demo stats all read as `self`/`parent` overflow at 320px with the page rendered in plain English —
 * an allowlist would need one entry per fixture, forever, and would hide a REAL regression on that
 * same element if one ever landed. `RUN()` measures every check once on the page as loaded (English)
 * and again after `pseudoLocalize()`, keyed by the actual DOM node (pseudo-localisation only ever
 * rewrites text, never adds or removes an element, so the same reference is valid both times), and
 * reports a finding only where the AFTER value both exceeds the ABSOLUTE tolerance (`eps` plus, for
 * `self`, the element's own margin — the reserved-space case below) AND grew by more than `eps` over
 * BEFORE. An element already broken in English contributes ~0 growth and is silent; the switch's pill
 * (next paragraph) is ~2px in English and jumps to 6-23px once its fix is reverted — 4-21px of growth,
 * comfortably past `eps`.
 *
 *   node tools/pseudo-loc.mjs
 *   node tools/pseudo-loc.mjs --widths 320,390 --densities normal,compact,large --eps 2
 *   node tools/pseudo-loc.mjs --verbose        # print every finding, not just the first 8 per kind
 */
import { chromium } from 'playwright';
import { serveGallery } from './lib/gallery.mjs';
import { buildCss } from './lib/css.mjs';

const ARGV = process.argv.slice(2);
const opt = (name, dflt) => { const i = ARGV.indexOf(`--${name}`); return i < 0 ? dflt : ARGV[i + 1]; };
const VERBOSE = ARGV.includes('--verbose');

/* 320 is the narrowest reflow WCAG 1.4.10 requires; 390 is the modal phone point every other
 * gallery gate reaches for on a phone-width claim (computed-diff.mjs, live-audit.mjs). */
const WIDTHS = opt('widths', '320,390').split(',').map(Number);
/* null = bare :root (normal). Density=Large is the axis that exposed the ENGLISH half of task
 * 0145's bug on its own (a 360px screen); skipping it here would leave that gap open again. */
const DENSITIES = opt('densities', 'normal,compact,large').split(',').map((d) => (d === 'normal' ? null : d));
/* the intact tree's own noise floor, measured above: 2px of border/padding rounding on the one
 * element this gate is proven against. A real project may need to raise this once measured; lower
 * it only after checking the intact tree still passes at the new value. */
const EPS = Number(opt('eps', '2'));

/* Accepted, already-documented exceptions — see the file header for the case each one is. A
 * selector added here needs the same one-line justification an a11y-gallery.mjs `.exclude()`
 * carries: which contract already owns this, why it is not a theme fault THIS gate should raise. */
const ALLOW = [
	/* task 0161: `.table *` used to also net every row-action BUTTON inside a `.td.cbi-section-actions`
	 * cell — a real, unrelated flex-sizing fault (fixed in theme/55-buttons.css, see docs/gallery.html's
	 * "Row actions, plain table (Startup-style)" fixture) that has nothing to do with the no-JS-carding
	 * contract this entry exists for. `:not()` carves the actions cell back out so its buttons are
	 * measured like any other control; the DATA cells this entry is actually for keep their exemption. */
	'.table', '.table *:not(.cbi-section-actions, .cbi-section-actions *)',
	'.cbi-dropdown > ul > li', '.cbi-dropdown > ul > li *',
	'label[for="g-longlabel"]',
	'.cbi-filebrowser > p', '.cbi-filebrowser > p *',
	'.cbi-tabmenu > li > a', '.cbi-tabmenu > li > a *',
	'.cbi-progressbar',
	'.cbi-filebrowser > ul > li > div:first-child', '.cbi-filebrowser > ul > li > div:first-child *',
	/* task 0161 (verification, after the ancestor-climb bug above was fixed): `scrollWidth` is
	 * cumulative, so each of the three exceptions above still pushes its own CONTAINER over — not a
	 * new fault, the same already-accepted content measured one level up. Named by `:has()` against
	 * the SAME leaf the exception already covers, not a blanket climb: a container is excused only
	 * while it actually holds one of those three, and stops being excused the moment it does not —
	 * an unrelated future fault in the same section still surfaces on ITS OWN element. */
	':is(.cbi-value, .cbi-section-node, .cbi-section, .g-sec):has(#g-longlabel)',
	':is(.cbi-value, .cbi-value-field, .g-sec):has(.cbi-progressbar)',
	':is(.cbi-section, .alert-message, .g-sec):has(.table)',
	/* `.g-wrap` is `docs/gallery.html`'s own scaffolding (the file's `<style>` block: ".g-* — gallery
	 * chrome only, never part of the theme"), not a widget any router page renders. Its scrollWidth is
	 * the width of whichever of the 22 sections is currently widest, so as long as the three exceptions
	 * above exist ANYWHERE on the page — permanently, by design — this check can never tell a new
	 * regression from them; a real per-element fault still surfaces at the element or its own
	 * container, which is what the rest of this list exists to leave un-excused. */
	'.g-wrap',
];

/* Gallery CHROME, never theme: the fixture's own heading, toolbar and developer-facing notes
 * (docs/gallery.html's `<style>` block says so explicitly — ".g-* — gallery chrome only, never part
 * of the theme"). Pseudo-localising "Toggle dark" or a `<p class="g-note">` explaining a fixture
 * tests the GALLERY's own `max-width: 1180px` wrapper, not any widget a router ever renders — every
 * `g-sec`/`g-wrap` overflow finding in early runs of this gate traced back to exactly that text.
 * Excluded from pseudo-localisation only; a `.g-sec` itself (the real widget it wraps) still runs
 * through every check below. */
const SKIP_TEXT = ['.g-bar', '.g-sec > h2', '.g-note'];

/* ---- pseudo-localisation, run INSIDE the page ---- */
function pseudoLocalize(skipText) {
	const ACCENT = {
		a: 'á', c: 'ç', d: 'đ', e: 'é', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ĺ', n: 'ñ',
		o: 'ó', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', w: 'ŵ', y: 'ý', z: 'ž',
		A: 'Á', C: 'Ç', D: 'Đ', E: 'É', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ĺ', N: 'Ñ',
		O: 'Ó', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', W: 'Ŵ', Y: 'Ý', Z: 'Ž',
	};
	const accent = (s) => { let out = ''; for (const ch of s) out += ACCENT[ch] || ch; return out; };
	/* Deterministic: the same input string always yields the same output, or a failure never
	 * reproduces and a diff between two runs is unreadable. Each WORD (a run with no whitespace)
	 * grows on its own by a fixed 45% — filler drawn cyclically from the word's own letters — so no
	 * NEW break opportunity is introduced; a real translation makes individual words longer
	 * (agglutinative compounds are the extreme of this, not the exception: task 0145's own Russian
	 * caption is one 14-letter word, "неиспользуемые", where English has "unused"), it does not
	 * scatter extra spaces through a sentence. 45% sits inside the 1.3-1.6x this repo has measured
	 * for Russian, once the bracket markers are counted in.
	 *
	 * A word already 20 characters or longer going IN is left alone rather than grown further. A
	 * real translation does not turn a 20-character token into a 30-character one — a run that long
	 * with no break point already is not natural-language UI text, it is the theme's own deliberate
	 * torture fixture (docs/gallery.html's `#g-longlabel`, one 38-character unbroken compound built
	 * to reproduce styles/base/30-forms.css's `min-width: 0` fix, whose own comment already states
	 * the floor: "real RU option text with normal word breaks does not need to hit this floor at
	 * all"), a checksum, a path, or a URL — none of which pseudo-localisation should be inventing
	 * length for. Growing it anyway manufactures overflow this gate would then be reporting against
	 * a limit the theme has already measured and accepted, not against a translation risk. */
	function pseudo(s) {
		const core = s.trim();
		if (!core) return s;
		const lead = s.slice(0, s.length - s.trimStart().length);
		const trail = s.slice(s.trimEnd().length);
		const parts = core.split(/(\s+)/);
		const grown = parts.map((w) => {
			if (!w || /^\s+$/.test(w)) return w;
			/* No LETTER in it at all (a number, a percentage, a signed dBm reading, a bare `/` or
			 * `»`) — left alone: `-55.9`, `62%` and `303.373` do not gain 45% more digits when a
			 * string is translated, only the unit letters beside them do (their own word, grown
			 * below). Growing the digits was measured to manufacture overflow on
			 * `.cbi-progressbar::after` (styles/theme/25-progressbar.css: `content: attr(title)`,
			 * `position: absolute`, `white-space: nowrap` — an overlay with no width of its own, so
			 * any text glued onto it that is genuinely longer overflows by design) that a real
			 * reading, in any language, never produces. */
			/* <= 3 letters and no vowel-bearing growth worth measuring anyway (also where every SI/
			 * byte unit this theme prints lives — dBm, MiB, GiB, kbps — which does not translate: a
			 * unit symbol is invariant across locales by definition, ISO 80000). Left un-accented
			 * too, or `dBm` alone (no digits beside it to protect it) still picks up one filler
			 * character and the fixed cost of marking it below adds the rest — measured to still
			 * clear `.cbi-progressbar::after`'s reserved margin (see the SELF check) by a handful of
			 * px on its own once combined with the bracket that used to wrap every result. */
			if (w.length <= 3 || w.length >= 20 || !/\p{L}/u.test(w)) return w;
			const extra = Math.max(1, Math.round(w.length * 0.45));
			let filler = '';
			for (let i = 0; i < extra; i++) filler += w[i % w.length];
			return accent(w + filler);
		});
		return `${lead}[${grown.join('')}]${trail}`;
	}

	const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
	const skipped = (el) => skipText.some((sel) => el.closest(sel));

	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (!node.data.trim()) return NodeFilter.FILTER_REJECT;
			const p = node.parentElement;
			if (!p || SKIP_TAGS.has(p.tagName) || skipped(p)) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	const nodes = [];
	let n;
	while ((n = walker.nextNode())) nodes.push(n);
	for (const node of nodes) node.data = pseudo(node.data);

	/* Attribute-carried visible text: a placeholder reads as a hint, a submit/button/reset's VALUE
	 * is its only label (no text child exists to walk), title and aria-label are what a screen
	 * reader or a tooltip shows in place of, or in addition to, the text node — the dropdown-value
	 * fault named in the card is covered by the text walk above (ui.js renders a chosen value as a
	 * `<li>` text node), these four are the attribute-only surface next to it. */
	let count = nodes.length;
	for (const el of document.querySelectorAll('[placeholder]')) {
		if (skipped(el)) continue;
		el.setAttribute('placeholder', pseudo(el.getAttribute('placeholder')));
		count++;
	}
	for (const el of document.querySelectorAll('input[type=button], input[type=submit], input[type=reset]')) {
		if (skipped(el) || !el.value.trim()) continue;
		el.value = pseudo(el.value);
		count++;
	}
	for (const el of document.querySelectorAll('[title]')) {
		if (skipped(el) || !el.getAttribute('title').trim()) continue;
		el.setAttribute('title', pseudo(el.getAttribute('title')));
		count++;
	}
	for (const el of document.querySelectorAll('[aria-label]')) {
		if (skipped(el) || !el.getAttribute('aria-label').trim()) continue;
		el.setAttribute('aria-label', pseudo(el.getAttribute('aria-label')));
		count++;
	}
	return count;
}

/* ---- BEFORE: raw numbers taken on the untouched (English) page, run INSIDE the page. Stashed on
 * `window` rather than returned — a Map keyed by a DOM node has no structured-clone form to cross
 * the Node/browser boundary with, and does not need to: MEASURE_AFTER reads it back out of the same
 * JS realm a couple of page.evaluate() calls later, after pseudoLocalize() has only ever rewritten
 * TEXT, so every element reference collected here is still the right element then. ---- */
function MEASURE_BEFORE(allow) {
	const vis = (el) => {
		const cs = getComputedStyle(el);
		/* the two false-positive traps from today's probes: an ordinary `display` on a descendant
		 * of a `display: none` ancestor (a collapsed submenu) still gives the descendant ZERO
		 * client rects, and a genuinely empty box never reaches this filter with anything to
		 * measure in the first place — both read as "not visible" here, on purpose. */
		return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
	};
	const scrolls = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX + getComputedStyle(el).overflowY);
	/* An ALLOW entry excuses ONLY the element(s) its selector matches — task 0161 (verification):
	 * the previous walk also excused every ancestor up to <body>, which measured 311 of 822
	 * elements and 14 of 22 gallery sections unmeasurable (`scrollWidth` is cumulative, so a
	 * `.table` 340px wide made its `.cbi-section`, then its `.g-sec`, then every section ABOVE it
	 * on the page silent too, since Sets share no per-fixture boundary) — including all four
	 * buttons of the "Row actions, plain table (Startup-style)" fixture this same triage had just
	 * added to cover long Russian captions. A selector that needs to excuse a subtree writes that
	 * subtree explicitly (`.table *`, `.cbi-dropdown > ul > li *` below) rather than relying on
	 * this walk to climb there — the ALLOW list is the contract, not a shortcut around it. */
	const excluded = new Set();
	for (const sel of allow) for (const match of document.querySelectorAll(sel)) excluded.add(match);
	const allowed = (el) => excluded.has(el);
	/* reachable via a scroller either on the element itself or on an ancestor — the deliberately
	 * overflowing `.g-overwide` fixtures (docs/gallery.html: "built to NOT fit — that is what they
	 * are for") give their content exactly this kind of reach, and a check that stopped at the
	 * immediate parent would still flag every descendant inside one. */
	const inScroller = (el) => { for (let p = el; p; p = p.parentElement) if (scrolls(p)) return true; return false; };
	const all = [...document.body.querySelectorAll('*')].filter((el) => vis(el) && !allowed(el));

	const selfBefore = new Map();
	for (const el of all) {
		if (inScroller(el)) continue;
		selfBefore.set(el, el.scrollWidth - el.clientWidth);
	}

	const parentBefore = new Map();
	for (const el of all) {
		const p = el.parentElement;
		if (!p || inScroller(el) || allowed(p)) continue;
		const pos = getComputedStyle(el).position;
		if (pos === 'absolute' || pos === 'fixed') continue;
		const r = el.getBoundingClientRect();
		if (!r.width) continue;
		parentBefore.set(el, r.right - p.getBoundingClientRect().right);
	}

	/* Climbs to the FIRST non-scrolling ancestor that clips on either axis and stops there, whether
	 * or not it clips by much — AFTER has to stop at the same ancestor for the two numbers to be a
	 * diff of the same thing rather than of two different boxes. */
	const clipBefore = new Map();
	for (const el of all) {
		const r = el.getBoundingClientRect();
		if (!r.width && !r.height) continue;
		for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
			if (allowed(p)) break;
			const cs = getComputedStyle(p);
			const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
			const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
			if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) break;
			if (!clipsX && !clipsY) continue;
			const pr = p.getBoundingClientRect();
			let by = 0;
			if (clipsX) by = Math.max(by, r.right - pr.right, pr.left - r.left);
			if (clipsY) by = Math.max(by, r.bottom - pr.bottom);
			clipBefore.set(el, by);
			break;
		}
	}

	window.__pseudoLocBefore = { selfBefore, parentBefore, clipBefore };
}

/* ---- AFTER: the overflow assertion, run INSIDE the page, after pseudo-localisation and a settle.
 * Same three shapes as before this card, PLUS the BEFORE/AFTER growth gate described in the file
 * header — a finding is reported only if it both exceeds the absolute tolerance (unchanged from
 * before this card) AND grew by more than `eps` since the untouched page, so an element already
 * broken in English is silent unless pseudo-localisation made it meaningfully worse. ---- */
function MEASURE_AFTER({ allow, eps }) {
	const { selfBefore, parentBefore, clipBefore } = window.__pseudoLocBefore;
	const out = [];
	const vis = (el) => {
		const cs = getComputedStyle(el);
		return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
	};
	const label = (el) => {
		const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
		return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : cls ? `.${cls}` : '');
	};
	const scrolls = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX + getComputedStyle(el).overflowY);
	/* Same exact-match scoping as MEASURE_BEFORE — see that function's comment for why the walk up
	 * to <body> is gone (task 0161). */
	const excluded = new Set();
	for (const sel of allow) for (const match of document.querySelectorAll(sel)) excluded.add(match);
	const allowed = (el) => excluded.has(el);
	const inScroller = (el) => { for (let p = el; p; p = p.parentElement) if (scrolls(p)) return true; return false; };
	const all = [...document.body.querySelectorAll('*')].filter((el) => vis(el) && !allowed(el));

	/* 1. SELF: an element's own content past its own box, on an element that cannot scroll to it.
	 * This is the shape that caught task 0145 (see the file header): the switch's pill does not grow
	 * or move, its `::after` knob does, and `scrollWidth` on a `position: relative` box with
	 * `overflow: visible` still measures an absolutely-positioned descendant that pokes past the
	 * padding box.
	 *
	 * Tolerance is EPS plus the element's own horizontal margin, not EPS alone. A meter's reading
	 * (`.cbi-progressbar::after`, styles/theme/25-progressbar.css) sits BESIDE the bar on purpose,
	 * in an `margin-inline-end` the bar reserves for exactly that ("`meter/beside`" — 80px measured
	 * on the gallery's dBm fixture) — reserved room is not overflow, and without this a bare, never
	 * pseudo-localised "-55.9 dBm" already reads as 68px of self-overflow on the intact tree, before
	 * this gate touches a single string. A value that outgrows the reserved margin too still shows
	 * up correctly one level up, on `.cbi-value-field`'s own scrollWidth, which reserves nothing. */
	for (const el of all) {
		if (inScroller(el)) continue;
		const cs = getComputedStyle(el);
		/* task 0161 (verification): a NEGATIVE margin (`.zonebadge .cbi-tooltip`,
		 * styles/base/90-widgets.css: `margin: -1.6em 0 0 -5px`, an overlap trick, not reserved
		 * room) drives `eps + margin` below zero, which WIDENS the pass condition (`by > a smaller
		 * number` is easier to satisfy) instead of narrowing it — backwards from the reserve this
		 * tolerance exists for, and the reported `by` can then read as low as 0px, not overflow by
		 * any definition. `Math.max(0, …)` limits the adjustment to reserved (positive) margin only;
		 * a negative margin now costs an element nothing, same as carrying none. */
		const margin = Math.max(0, (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0));
		const by = el.scrollWidth - el.clientWidth;
		const growth = by - (selfBefore.get(el) || 0);
		if (by > eps + margin && growth > eps) out.push({ kind: 'self', el: label(el), by: `${by}px`, html: el.outerHTML.slice(0, 160) });
	}

	/* 2. PARENT: a normal-flow box whose rendered right edge sits past its own parent's. Restricted
	 * to `position: static`/`relative` children of a non-scrolling parent — an absolutely positioned
	 * badge or caret is EXPECTED to sit past its static parent (that is what position: absolute is
	 * for), so counting it here would be noise on every dropdown caret and tooltip arrow the gallery
	 * carries; a normal-flow box has no such excuse. */
	for (const el of all) {
		const p = el.parentElement;
		if (!p || inScroller(el) || allowed(p)) continue;
		const pos = getComputedStyle(el).position;
		if (pos === 'absolute' || pos === 'fixed') continue;
		const r = el.getBoundingClientRect();
		const pr = p.getBoundingClientRect();
		if (!r.width) continue;
		const by = r.right - pr.right;
		const growth = by - (parentBefore.get(el) || 0);
		if (by > eps && growth > eps) out.push({ kind: 'parent', el: label(el), by: `${Math.round(by * 100) / 100}px`, parent: label(p) });
	}

	/* 3. CLIP: content clipped by an ancestor that has no scrollbar to reach it with — "text the
	 * reader cannot reach", the severe case two of today's three faults actually were. Walked up
	 * from every element rather than restricted to a container allowlist (unlike
	 * tools/live-audit.mjs's `clipped` check, which only trusts a handful of classes on a live page
	 * with real app content): pseudo-localisation only ever LENGTHENS text the theme itself renders,
	 * so a false positive here would still be worth reading, not noise from an app's own layout. The
	 * climb stops at the first non-scrolling ancestor that clips on either axis — the same ancestor
	 * MEASURE_BEFORE stopped at, so the two numbers describe the same box. */
	for (const el of all) {
		const r = el.getBoundingClientRect();
		if (!r.width && !r.height) continue;
		for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
			if (allowed(p)) break;
			const cs = getComputedStyle(p);
			const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
			const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
			if (/(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflowY)) break;
			if (!clipsX && !clipsY) continue;
			const pr = p.getBoundingClientRect();
			let by = 0;
			if (clipsX) by = Math.max(by, r.right - pr.right, pr.left - r.left);
			if (clipsY) by = Math.max(by, r.bottom - pr.bottom);
			if (by > 0) {
				const growth = by - (clipBefore.get(el) || 0);
				if (by > eps && growth > eps) out.push({ kind: 'clip', el: label(el), by: `${Math.round(by * 100) / 100}px`, ancestor: label(p) });
			}
			break;
		}
	}

	delete window.__pseudoLocBefore;
	return out;
}

async function settle(page) {
	await page.evaluate(() => document.fonts.ready);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const { base, close } = await serveGallery(buildCss());
const browser = await chromium.launch();

const findings = [];
let elementsWalked = 0;
let combos = 0;

for (const width of WIDTHS) {
	for (const density of DENSITIES) {
		combos++;
		const page = await browser.newPage({ viewport: { width, height: 1400 } });
		await page.goto(base, { waitUntil: 'load' });
		if (density) await page.evaluate((d) => document.documentElement.setAttribute('data-density', d), density);
		await settle(page);

		/* BEFORE: raw numbers on the untouched (English) page, stashed on `window` — see
		 * MEASURE_BEFORE's own comment for why nothing is returned here. */
		await page.evaluate(MEASURE_BEFORE, ALLOW);

		elementsWalked = await page.evaluate(pseudoLocalize, SKIP_TEXT);
		await settle(page);

		/* AFTER: only a finding that both exceeds the absolute tolerance and grew past `eps` since
		 * BEFORE is reported — see the file header, "BEFORE/AFTER". */
		const rows = await page.evaluate(MEASURE_AFTER, { allow: ALLOW, eps: EPS });
		const label = `${width}px/${density || 'normal'}`;
		for (const row of rows) findings.push({ ...row, at: label });
		await page.close();
	}
}

await browser.close();
close();

console.log(`pseudo-loc: docs/gallery.html, ${elementsWalked} string(s) pseudo-localised per run, `
	+ `${combos} width x density point(s) (${WIDTHS.join(',')} x ${DENSITIES.map((d) => d || 'normal').join(',')}), eps=${EPS}px`);

if (!findings.length) {
	console.log('pseudo-loc: no overflow at any point — clean sheet.');
	process.exit(0);
}

const byKind = new Map();
for (const f of findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind).push(f); }

const KIND_NAME = { self: 'self-overflow (scrollWidth > clientWidth)', parent: 'escapes its parent', clip: 'clipped by an ancestor with no scroller' };
for (const [kind, rows] of byKind) {
	console.error(`\n${rows.length} ${KIND_NAME[kind] || kind} finding(s):`);
	const shown = VERBOSE ? rows : rows.slice(0, 8);
	for (const r of shown) {
		const extra = r.parent ? ` inside ${r.parent}` : r.ancestor ? ` inside ${r.ancestor}` : '';
		console.error(`  ${r.at}  ${r.el}${extra}  by ${r.by}${r.html ? `  ${r.html}` : ''}`);
	}
	if (!VERBOSE && rows.length > shown.length) console.error(`  … and ${rows.length - shown.length} more (--verbose)`);
}
console.error(`\npseudo-loc: ${findings.length} overflow finding(s) — an element, the width, the density and the ` +
	'measured overflow are above. Read docs/development.md, "pseudo-loc", for what each kind means and what to do.');
process.exit(1);

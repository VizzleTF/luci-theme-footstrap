/* The --*-color-* export tier, parsed out of styles/02-tokens.css — the ONE place it is defined.
 *
 * This lived inside devkit-build.mjs while export-tier.mjs hand-wrote its own cross-product of
 * families x levels, and the two had already disagreed: devkit knew --text-color-highest, the GATE
 * did not. So that name was defined, shipped, read by apps and inspected by nothing — setting it to
 * #808080 (~3.95:1 on a light --fs-bg, a real AA failure) passed with "export tier: OK — 1820
 * checks". A gate whose subject is a hand-written list checks the list, not the contract.
 *
 * Derived here, consumed by both. A level added to the tokens gets measured on the next run without
 * anyone remembering to widen a constant.
 *
 * Names come back WITHOUT the leading `--`: that is the shape devkit.src.html renders (`'var(--' +
 * name + ')'`), and export-tier.mjs adds it back.
 */

/* Families in the order the devkit renders them. The regex is the gate on what counts as the tier:
 * --fs-* is private and deliberately not surfaced — see the token file's own header. */
const FAMILY_ORDER = ['background', 'border', 'text', 'primary', 'success', 'warn', 'error'];
const LEVEL_RANK = { highest: 0, high: 1, medium: 2, low: 3 };

/* Returns [{ family, levels: ['text-color-high', …] strongest first, ink: 'on-…-color' | null }].
 * A family with no ink is one apps do not fill with — background, border, text. */
export function parseExportTier(css) {
	const found = new Set();
	for (const m of css.matchAll(
		/--((?:background|border|text|primary|success|warn|error)-color-(?:highest|high|medium|low))\s*:/g))
		found.add(m[1]);

	const groups = {};
	for (const name of found) {
		const fam = name.split('-color-')[0];
		(groups[fam] ||= { family: fam, levels: [], ink: null }).levels.push(name);
	}

	for (const m of css.matchAll(/--(on-(?:primary|success|warn|error)-color)\s*:/g)) {
		const fam = m[1].replace(/^on-/, '').replace(/-color$/, '');
		if (groups[fam]) groups[fam].ink = m[1];
	}

	const lvl = (n) => LEVEL_RANK[n.split('-color-')[1]] ?? 9;
	return FAMILY_ORDER.filter((f) => groups[f]).map((f) => ({
		...groups[f],
		levels: groups[f].levels.sort((a, b) => lvl(a) - lvl(b)),
	}));
}

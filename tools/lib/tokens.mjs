/* The --*-color-* export tier, parsed out of styles/02-tokens.css — the one place it is defined.
 *
 * A hand-written cross-product of families x levels describes the list, not the contract: two such
 * lists once disagreed about --text-color-highest, so that name was defined, shipped and read by
 * apps while one of the two never saw it. Derived here, so a level added to the tokens reaches the
 * devkit on the next build.
 *
 * Names come back WITHOUT the leading `--`: that is the shape devkit.src.html renders
 * (`'var(--' + name + ')'`). */

/* Families in the order the devkit renders them. The regex decides what counts as the tier:
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

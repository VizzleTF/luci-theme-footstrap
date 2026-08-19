/* WHICH PAGES ARE WORTH MEASURING, AND WHY MOST OF THEM ARE NOT.
 *
 * The live gates walked every leaf of the router's menu — 37 pages on a bare OpenWrt, 146 across
 * four containers — and measured each one at six widths. That is honest and it is also mostly
 * repetition: the theme does not know what a page is ABOUT, only what it is MADE OF. Network →
 * Routes and Status → Routes are the same data table twice; the dozen `luci-app-*` forms are one
 * `.cbi-map` with different labels in it. Nothing the gates ask can come out differently for two
 * pages built from the same parts, so the second one costs eight seconds and buys nothing.
 *
 * So a page is classified by its SHAPE — the set of structures the theme actually styles and
 * measures — and one representative of each shape is measured. The classification runs on the live
 * page rather than off a list of paths kept here, because a list of paths goes stale the moment an
 * app is installed and a shape does not.
 *
 * WHAT KEEPS THIS HONEST, since a gate that skips things is a gate that can skip the thing that
 * broke:
 *
 *   * every path named in the baseline is measured, whatever its shape. The ratchet's own findings
 *     are the one set that may never be sampled away, or a fixed finding and a skipped page look
 *     the same from here.
 *   * PINNED paths are measured too: the pages the field reports came from (the shredded column of
 *     #11, the clipped submenu of #22, the doubled scrollbar of #12, the arrival that reached a
 *     user on Processes) keep their seat regardless of what else shares their shape.
 *   * every dropped page is REPORTED with the page that stands in for it. A cap nobody can see is a
 *     cap nobody can argue with.
 *   * a narrowed run may not rewrite the baseline. `--update` needs the full sweep, the same way it
 *     already refuses after `--pages` or `--widths`.
 *
 * The discovery pass costs one load per page — about a fifth of what measuring it costs — and the
 * saving is the other four fifths of every page that is a duplicate of one already measured.
 */

/* Runs INSIDE the page. The flags are the things the gates measure or the theme reshapes; two pages
 * with the same set exercise the same code in `fs-select`, `fs-fit` and the stylesheet. Order is
 * fixed by construction (the list below), so the signature is stable across runs and machines. */
export const SHAPE_PROBE = function () {
	const view = document.getElementById('view') || document.body;
	const has = (sel) => view.querySelector(sel) !== null;
	const count = (sel) => view.querySelectorAll(sel).length;

	const tables = [ ...view.querySelectorAll('.table, table') ];
	const cols = tables.reduce((n, t) => {
		const head = t.querySelector('.tr, tr');
		return Math.max(n, head ? head.children.length : 0);
	}, 0);
	const rows = tables.reduce((n, t) => Math.max(n, t.querySelectorAll('.tr, tr').length), 0);

	const flags = [];
	if (has('.table.fs-dt')) flags.push('data-table');
	if (has('.cbi-section-table')) flags.push('config-table');
	if (cols > 6) flags.push('wide-table');
	if (rows > 30) flags.push('long-table');
	if (has('.cbi-map, .cbi-section')) flags.push('form');
	if (has('.cbi-tabmenu, [data-tab]')) flags.push('tabs');
	if (has('select')) flags.push('select');
	if (has('.cbi-dropdown')) flags.push('dropdown');
	if (has('textarea')) flags.push('textarea');
	if (has('.ace_editor, .CodeMirror, .cm-editor')) flags.push('editor');
	if (has('input[type="file"]')) flags.push('file');
	if (has('svg')) flags.push('svg');
	if (has('iframe')) flags.push('iframe');
	if (has('.cbi-progressbar')) flags.push('progressbar');
	if (has('.fs-card, .fs-ovl-sys, .fs-ovl-mem')) flags.push('cards');
	if (has('.cbi-page-actions')) flags.push('actions');
	if (count('*') > 1500) flags.push('heavy');
	return flags.join('+') || 'bare';
};

/* The pages that keep their seat whatever they are made of: every one is a place a defect actually
 * reached a user, and a shape-mate standing in for it would be a bet that the defect was about the
 * shape rather than about the page. */
export const PINNED = [
	'/admin/status/overview',			/* the poll's own page, and the theme's busiest */
	'/admin/status/processes',			/* the wide data table; the arrival bug was reported here */
	'/admin/network/dhcp',				/* leases: the table that cards, plus its own form */
	'/admin/network/wireless',			/* assoclist: the widest table the stock menu has */
	'/admin/network/diagnostics',		/* #11's shredded column and the sub-24px button row */
	'/admin/system/system',				/* the Appearance panel hangs off this one */
	'/admin/system/flash',				/* file inputs and the modal-heavy path */
	'/admin/status/iptables'			/* long pre-formatted output, the nested-scroll case of #12 */
];

/* -> { picked: [path], dropped: Map(path -> representative), shapes: Map(path -> shape) }
 *
 * `keep` is the set that may not be sampled away (the baseline's paths, and PINNED). Order is the
 * menu's, so the choice of representative is deterministic rather than whichever page answered
 * first. */
export function representatives(shapes, keep = []) {
	const mustKeep = new Set(keep);
	const seen = new Map();		/* shape -> the page that represents it */
	const picked = [], dropped = new Map();
	for (const [ path, shape ] of shapes) {
		if (mustKeep.has(path)) { picked.push(path); if (!seen.has(shape)) seen.set(shape, path); continue; }
		if (!seen.has(shape)) { seen.set(shape, path); picked.push(path); continue; }
		dropped.set(path, seen.get(shape));
	}
	return { picked, dropped, shapes };
}

/* Visit each page once and read its shape. One load, one settle — a fifth of what the measuring
 * pass costs, which is what makes the reduction worth doing at all. */
export async function classify(page, base, paths, { settle = 1200, timeout = 20000 } = {}) {
	const shapes = new Map();
	for (const path of paths) {
		try { await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout }); }
		catch (e) { continue; }			/* a page that will not load is measured by nobody */
		await page.waitForTimeout(settle);
		try { shapes.set(path, await page.evaluate(SHAPE_PROBE)); }
		catch (e) { /* context died under us: leave it out rather than guess */ }
	}
	return shapes;
}

/* One line per shape, so the run says what it stood in for rather than quietly not measuring it. */
export function reportReduction(id, picked, dropped, shapes) {
	const bySample = new Map();
	for (const [ path, rep ] of dropped) {
		if (!bySample.has(rep)) bySample.set(rep, []);
		bySample.get(rep).push(path);
	}
	process.stdout.write(`${id}: ${picked.length} of ${shapes.size} page(s) measured — `
		+ `${dropped.size} share a shape with one that is\n`);
	for (const [ rep, list ] of bySample)
		process.stdout.write(`    ${shapes.get(rep)}\n      ${rep} stands in for ${list.join(', ')}\n`);
}

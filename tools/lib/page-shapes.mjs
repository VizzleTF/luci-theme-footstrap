/* Which pages are worth measuring, and why most of them are not.
 *
 * Walking every leaf of the router's menu is 37 pages on a bare OpenWrt and 146 across four
 * containers, each at six widths — honest, and mostly repetition: the theme does not know what a
 * page is ABOUT, only what it is MADE OF. Two pages built from the same parts cannot answer
 * differently, so the sweep is over SHAPES rather than over pages. */

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
/* Shapes already read from this router, shared between the gates that ask for them.
 *
 * Classifying is one load and a 1200ms settle PER PAGE OF THE MENU, and `spa-parity` and
 * `live-audit` both do it, one after the other, against the same routers in the same CI job — the
 * same walk twice, for an answer that cannot differ between them. With `FS_SHAPES` naming a
 * directory, the first gate writes what it read and the second reads it back.
 *
 * Per PAGE rather than per run, because the two gates ask about slightly different lists (spa-parity
 * drops its origin page), and a whole-list key would miss on that alone.
 *
 * A shape describes the page AS THIS BUILD RENDERS IT — `SHAPE_PROBE` looks for `.fs-card` among
 * others — so the cache is only correct while the theme under the router does not change. That is
 * why it is off unless asked for: CI points it at a directory inside the runner's own temp, new for
 * every run. Never point it at a path that outlives an install. */
const CACHE_DIR = process.env.FS_SHAPES || '';

function cacheFile(base) {
	const key = base.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
	return `${CACHE_DIR}/shapes-${key}.json`;
}

async function readCache(base) {
	if (!CACHE_DIR) return new Map();
	try {
		const fs = await import('node:fs');
		return new Map(Object.entries(JSON.parse(fs.readFileSync(cacheFile(base), 'utf8'))));
	} catch (e) { return new Map(); }		/* no file, bad file: classify from scratch */
}

async function writeCache(base, shapes) {
	if (!CACHE_DIR) return;
	try {
		const fs = await import('node:fs');
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		const merged = { ...Object.fromEntries(await readCache(base)), ...Object.fromEntries(shapes) };
		fs.writeFileSync(cacheFile(base), JSON.stringify(merged));
	} catch (e) { /* a cache that cannot be written is a slow run, not a failed one */ }
}

export async function classify(page, base, paths, { settle = 1200, timeout = 20000 } = {}) {
	const shapes = new Map();
	const cached = await readCache(base);
	const fresh = new Map();
	for (const path of paths) {
		if (cached.has(path)) { shapes.set(path, cached.get(path)); continue; }
		try { await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout }); }
		catch (e) { continue; }			/* a page that will not load is measured by nobody */
		await page.waitForTimeout(settle);
		try {
			const shape = await page.evaluate(SHAPE_PROBE);
			shapes.set(path, shape);
			fresh.set(path, shape);
		}
		catch (e) { /* context died under us: leave it out rather than guess */ }
	}
	if (fresh.size) await writeCache(base, fresh);
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

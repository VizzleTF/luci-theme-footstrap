/* Which pages are worth measuring, and why most of them are not.
 *
 * Walking every leaf of the router's menu is 37 pages on a bare OpenWrt and 146 across four
 * containers, each at six widths — honest, and mostly repetition: the theme does not know what a
 * page is ABOUT, only what it is MADE OF. Two pages built from the same parts cannot answer
 * differently, so the sweep is over SHAPES rather than over pages. */

/* Runs INSIDE the page. The flags are the things the gates measure or the theme reshapes; two pages
 * with the same set exercise the same code in `fs-select`, `fs-fit` and the stylesheet. Order is
 * fixed by construction (the list below), so the signature is stable across runs and machines. */
const SHAPE_PROBE = function () {
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
	if (has('.fs-ovl-sys, .fs-ovl-mem')) flags.push('cards');
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
	'/admin/system/system'				/* the Appearance panel hangs off this one */
];

/* -> { picked: [path], dropped: Map(path -> representative) }
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
	return { picked, dropped };
}

/* Visit each page once and read its shape. One load, one settle — a fifth of what the measuring
 * pass costs, which is what makes the reduction worth doing at all. Not cached: each CI slice
 * calls this at most once per stand (docs/ci.md, "It is three jobs, not one"). */

/* How long a page may take to answer the probe. `page.evaluate()` has no timeout, so a pinned main
 * thread is silent forever (docs/development.md, "A page that pins the browser's main thread").
 * The probe costs 4-5 ms on a healthy page; 10 s is ~2000x that, and the widest menu (96 paths on
 * owrt2512b) freezing on every page costs 16 minutes, not the whole 45-minute slice. */
const PROBE_DEADLINE_MS = 10000;

const FROZEN = Symbol('probe deadline');

/* Playwright's timeouts do not cover evaluate(); this is that timeout. The loser of the race is
 * left pending on purpose — `Promise.race` keeps it handled, and the page it belongs to is closed
 * immediately after. */
export function withDeadline(promise, ms) {
	let timer;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise((_, reject) => { timer = setTimeout(() => reject(FROZEN), ms); })
	]);
}

/* `frozen` collects the pages that loaded and then stopped answering — see reportFrozen(). `id` is
 * what the finding calls this router; `base` is a URL with a port owlab picked, so a gate that has
 * a stand id should pass it. */
export async function classify(page, base, paths, { frozen = [], id = base } = {}) {
	const settle = 1200, timeout = 20000;
	const shapes = new Map();
	/* The walk gets its own page so a frozen one can be thrown away: once the renderer stops, every
	 * later goto() burns its 20 s timeout and evaluate() throws `Execution context was destroyed`.
	 * A new page in the SAME context costs 0.5 s and keeps the login and the route seal; the
	 * caller's page carries the console listeners and must not be the one discarded. */
	const ctx = page.context();
	let probe = await ctx.newPage();
	try {
		for (const path of paths) {
			try { await probe.goto(base + path, { waitUntil: 'domcontentloaded', timeout }); }
			catch (e) { continue; }			/* a page that will not load is measured by nobody */
			await probe.waitForTimeout(settle);
			try {
				const shape = await withDeadline(probe.evaluate(SHAPE_PROBE), PROBE_DEADLINE_MS);
				shapes.set(path, shape);
			}
			catch (e) {
				if (e !== FROZEN) continue;	/* context died under us: leave it out rather than guess */
				/* Printed as it happens, not held to the end: this is the one finding whose whole
				 * point is that the log used to say nothing while the run was still going. */
				frozen.push(`${id}  ${path}`);
				process.stdout.write(`  FINDING ${id} ${path} loaded and then stopped answering — `
					+ `no reply to the shape probe in ${PROBE_DEADLINE_MS / 1000}s, where a page that `
					+ 'is alive answers in ~5ms\n');
				await probe.close().catch(() => {});
				probe = await ctx.newPage();
			}
		}
	}
	finally { await probe.close().catch(() => {}); }
	return shapes;
}

/* The frozen pages of a run, as the gate's own closing report. Returns how many there were, so the
 * caller can make its exit status say so.
 *
 * This is NOT the same thing as a page that would not open — that one is the runner or the stand,
 * and this walk already passes over it in silence. A page that answered its own load and then went
 * quiet has a pinned main thread, which is the theme's own defect, measured by nobody after
 * it (docs/development.md, "A page that pins the browser's main thread"). */
export function reportFrozen(frozen) {
	if (!frozen.length) return 0;
	process.stderr.write(`\n${frozen.length} page(s) never answered the shape probe:\n`);
	for (const f of frozen) process.stderr.write(`  ${f}\n`);
	process.stderr.write('\nThe page loaded, so this is not the runner: its main thread stopped'
		+ ' turning. Open the page\nwith a profiler attached, or bisect the theme against it — and'
		+ ' note that every gate walking\nthis menu measured nothing on it.\n');
	return frozen.length;
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

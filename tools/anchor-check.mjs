#!/usr/bin/env node
/* Does a reader parked mid-page stay put when a poll tick grows the page above them, and when the
 * next one shrinks it back? Against one running owlab router with footstrap installed:
 *
 *   - real data: DHCP leases are appended to the router's /tmp/dhcp.leases, and LuCI's own poll
 *     renders them on Status > Overview; the file is then put back and the poll takes them away;
 *   - real input: the reader is parked with the mouse wheel on the heading of the section below the
 *     one that lists the leases, at the top of the viewport, so the growth lands above them;
 *   - measured: the viewport top of every element the reader saw whose text is unique on the page,
 *     every frame; the median shift at the end is how far the reader was moved. A ResizeObserver
 *     reads it again before each paint the change causes: what the reader was shown. Grow and
 *     shrink are judged apart, each from a fresh park, by the same rules, and the shrink once more
 *     under a reader who keeps the wheel going through the tick and is read once they let go
 *     (bootstrap is no reference there: it floors nothing, so nothing is left to change).
 *
 * Four cells per engine and width, on the same router and engine:
 *   bootstrap  the stock theme, the reference
 *   footstrap  may not leave the reader further off than bootstrap did, nor show them off place in
 *              more frames, sampled or painted
 *   no native  footstrap where the engine has no scroll anchoring (Safari before 27): CSS.supports()
 *              answers no for overflow-anchor and `overflow-anchor: none` is on every element. The
 *              theme's own correction must hold the reader before any frame is painted
 *   no native, correction off  the same with fsAnchor=off: it must move the reader by at least half
 *              the change in a painted frame, or the cell above proves nothing. Both must see the
 *              change the footstrap cell saw above the reader, or the emulation changed the page
 * A cell that measured nothing fails: less than 50px changed above the reader (their content's move
 * in the document: the offset's share and the viewport's), no tick landed while they scrolled, or
 * fewer than MIN_TRACKED elements were seen.
 *
 *   node tools/anchor-check.mjs --router owrt2512 [--engines chromium,firefox,webkit] [--widths 1280,390] [--rows 4]
 *
 * Exit 0 when every cell passed, 1 otherwise, 2 when the router is not there. */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import * as playwright from 'playwright';
import { login, sealToRouter, stands } from './lib/stands.mjs';

const { values: opt } = parseArgs({ options: {
	router: { type: 'string' },
	engines: { type: 'string', default: 'chromium,firefox,webkit' },
	widths: { type: 'string', default: '1280,390' },
	rows: { type: 'string', default: '4' },
} });
if (!opt.router) {
	console.error('usage: node tools/anchor-check.mjs --router <id> [--engines list] [--widths list] [--rows n]');
	process.exit(2);
}
const [ stand ] = stands(opt.router);
const status = JSON.parse(execFileSync('owlab', [ 'status', '-json' ], { encoding: 'utf8' }));
const CONTAINER = `owlab-${status.project}-${stand.id}`;
const BASE = stand.base;
const ROWS = +opt.rows;

const TOL = 2;			/* px: rounding of a median over sub-pixel boxes */
const ABOVE_TOL = 8;		/* px: two cells of one page saw the same change above the reader */
const MIN_TRACKED = 5;
const SECS = 15;		/* sampling window; the growth is written 1.5 s in, a poll is 5 s */

const sh = (script, input) => execFileSync('docker', [ 'exec', '-i', CONTAINER, 'sh', '-c', script ],
	{ encoding: 'utf8', input, stdio: [ input == null ? 'ignore' : 'pipe', 'pipe', 'pipe' ] });
const setTheme = (name) => sh(`uci set luci.main.mediaurlbase=/luci-static/${name} && uci commit luci && rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*`);
const LEASES = '/tmp/dhcp.leases';
/* without the rows of a run that was killed before it put the file back */
const saved = sh(`cat ${LEASES}`).split('\n').filter((l) => !/ anchor-check-\d+-\d+ /.test(l)).join('\n');
const firstMac = (saved.split('\n').find((l) => l.trim()) || '').split(/\s+/)[1];
let batch = 0;
function grow() {
	batch++;
	let lines = '';
	for (let i = 0; i < ROWS; i++)
		lines += `4102444800 02:00:00:00:${batch.toString(16).padStart(2, '0')}:${i.toString(16).padStart(2, '0')} 172.20.9.${batch * 10 + i} anchor-check-${batch}-${i} *\n`;
	sh(`cat >> ${LEASES}`, lines);
}
/* the leases the growth added go again: the poll takes the same rows away above the reader */
const shrink = () => sh(`cat > ${LEASES}`, saved);

/* The reader's place: the heading of the section after the one that lists a lease, cut by the top
 * of the viewport, so nothing of the lease section is left in it. The engine anchors to the first
 * box in view, the sticky bar covering it or not, and a poll replaces the lease rows: no engine can
 * anchor to a node that is gone, bootstrap included (it moved by the whole growth with the heading
 * 16px under the bar). Returns how far the heading is from that place. */
const PARK = (mac) => {
	const secs = [ ...document.querySelectorAll('#view .cbi-section') ];
	const i = secs.findIndex((s) => s.textContent.toLowerCase().includes(mac.toLowerCase()));
	const next = i >= 0 ? secs.slice(i + 1).find((s) => s.getClientRects().length) : null;
	const head = next && next.querySelector('h1,h2,h3,h4,legend');
	return head ? head.getBoundingClientRect().top + 8 : null;
};

/* Runs in the page: every frame, the median shift of the elements the reader saw at the start. With
 * `still`, the start is when the offset has not moved for that many ms: a reader who just let go. */
const SAMPLE = async ([ secs, tol, still ]) => {
	const mc = document.getElementById('maincontent');
	const sc = (mc && /(auto|scroll)/.test(getComputedStyle(mc).overflowY)) ? mc : document.scrollingElement;
	if (still) await new Promise((ok) => {
		let y = sc.scrollTop, since = performance.now();
		const f = () => {
			if (sc.scrollTop !== y) { y = sc.scrollTop; since = performance.now(); }
			if (performance.now() - since >= still) ok(); else requestAnimationFrame(f);
		};
		requestAnimationFrame(f);
	});
	const view = document.getElementById('view');
	const SEL = 'h1,h2,h3,h4,legend,label,.cbi-value-title,.th,.td,th,td,.ifacebox-head,.cbi-section-descr,button';
	const key = (e) => e.tagName + '|' + e.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
	const all = [ ...view.querySelectorAll(SEL) ];
	const counts = new Map();
	for (const e of all) counts.set(key(e), (counts.get(key(e)) || 0) + 1);
	const tracked = all.filter((e) => {
		const r = e.getBoundingClientRect();
		return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && counts.get(key(e)) === 1 && e.textContent.trim().length > 2;
	}).map((e) => ({ k: key(e), tag: e.tagName, top0: e.getBoundingClientRect().top, el: e }));
	/* a poll replaces nodes: find the element again by its text */
	const find = (t) => {
		if (t.el.isConnected) return t.el;
		const e = [ ...view.querySelectorAll(t.tag) ].find((x) => key(x) === t.k);
		if (e) t.el = e;
		return e || null;
	};
	const shift = () => {
		const ds = [];
		for (const t of tracked) {
			const e = find(t);
			if (e && e.getClientRects().length) ds.push(e.getBoundingClientRect().top - t.top0);
		}
		ds.sort((a, b) => a - b);
		return ds;
	};
	const t0 = performance.now(), top0 = sc.scrollTop, h0 = sc.scrollHeight;
	let last = null, max = 0, off = 0, painted = 0;
	/* What the reader is shown: a ResizeObserver callback runs after every animation frame callback
	 * of its frame, the theme's correction included, and before the paint. The view resizes in the
	 * frame the growth lands in. */
	const ro = new ResizeObserver(() => {
		const ds = shift();
		if (ds.length && Math.abs(ds[Math.floor(ds.length / 2)]) > tol) painted++;
	});
	ro.observe(view);
	await new Promise((done) => {
		const step = () => {
			const ds = shift();
			if (ds.length) {
				last = { d: ds[Math.floor(ds.length / 2)], n: ds.length };
				if (Math.abs(last.d) > Math.abs(max)) max = last.d;
				if (Math.abs(last.d) > tol) off++;
			}
			if (performance.now() - t0 < secs * 1000) requestAnimationFrame(step); else done();
		};
		requestAnimationFrame(step);
	});
	ro.disconnect();
	const r1 = (x) => Math.round(x * 10) / 10;
	/* what changed above the reader: their content's move in the document, the offset's share and
	 * the viewport's. The document's own height also counts what changed below them. */
	const scrolled = Math.round(sc.scrollTop - top0);
	return { tracked: last ? last.n : 0, grew: Math.round(sc.scrollHeight - h0), scrolled,
		above: last ? Math.round(scrolled + last.d) : 0, end: last ? r1(last.d) : null, max: r1(max), off, painted };
};

/* An engine without scroll anchoring, as the theme sees one: the platform says so, and nothing anchors. */
const NO_NATIVE = () => {
	const own = CSS.supports.bind(CSS);
	CSS.supports = function (a, b) {
		if (/overflow-anchor/.test(String(a))) return false;
		return arguments.length > 1 ? own(a, b) : own(a);
	};
	/* an init script can run before the document has a root element. data-fs-shell keeps fs-sheets.js
	 * off it: an unmarked sheet with a `*` rule is an app's and is re-hosted into the theme layer, a
	 * path this emulation has no business going through */
	const add = () => {
		const s = document.createElement('style');
		s.setAttribute('data-fs-shell', '');
		s.textContent = '*, html, body { overflow-anchor: none !important; }';
		document.documentElement.appendChild(s);
	};
	if (document.documentElement) add();
	else document.addEventListener('DOMContentLoaded', add);
};

async function open(browser, width, cell) {
	const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 800 : 844 } });
	await sealToRouter(ctx, BASE);
	const page = await ctx.newPage();
	await login(page, BASE, stand.id);
	await page.evaluate((off) => { localStorage.removeItem('fsAnchor'); if (off) localStorage.setItem('fsAnchor', 'off'); },
		cell === 'nnOff');
	if (cell.startsWith('nn')) await page.addInitScript(NO_NATIVE);
	await page.goto(`${BASE}/admin/status/overview`, { waitUntil: 'load' });
	await page.waitForFunction(() => { const v = document.getElementById('view');
		return v && v.children.length && !v.querySelector(':scope > .spinning'); }, null, { timeout: 30000 });
	await page.waitForFunction(`(${PARK})(${JSON.stringify(firstMac)}) != null`, null, { timeout: 30000 }).catch(() => {});
	await page.waitForTimeout(6000);	/* the first tick has landed and the layout settled */
	return { ctx, page, parked: await park(page, width) };
}

/* The reader is wheeled to their place, and holds still there */
async function park(page, width) {
	const H = page.viewportSize().height;
	await page.mouse.move(Math.round(width / 2), Math.round(H / 2));
	/* the wheel until the heading is in place and stays there: WebKit scrolls asynchronously, and a
	 * park read as done moved 54px half a second later */
	let at = null;
	for (let i = 0; i < 200; i++) {
		at = await page.evaluate(PARK, firstMac);
		if (at == null) break;
		if (Math.abs(at) < 12) {
			await page.waitForTimeout(600);
			at = await page.evaluate(PARK, firstMac);
			if (Math.abs(at) < 12) break;
		}
		await page.mouse.wheel(0, Math.sign(at) * Math.min(120, Math.abs(at)));
		await page.waitForTimeout(i % 10 === 9 ? 400 : 40);
	}
	await page.waitForTimeout(1500);	/* the reader holds still */
	return at != null;
}

/* The reader keeps the wheel going, 20px a step down and up around their place, until the tick that
 * takes the leases away has landed, then three steps more down and lets go. `rolling` resolves once
 * the reader has been scrolling for a while: the leases may go only then, since a tick landing
 * before the first step met a reader at rest and left nothing to measure. False when no tick
 * landed within 12 s, or the leases went before the reader began. */
async function scrollThrough(page, rolling) {
	const gone = () => page.evaluate(() => !document.getElementById('view').textContent.includes('anchor-check-'));
	for (let i = 0; i < 150; i++) {
		if (i === 5) rolling();
		if (await gone()) {
			if (i <= 5) return false;
			for (let j = 0; j < 3; j++) { await page.mouse.wheel(0, 20); await page.waitForTimeout(80); }
			return true;
		}
		await page.mouse.wheel(0, i % 6 < 3 ? 20 : -20);
		await page.waitForTimeout(80);
	}
	return false;
}

/* A growth and the shrink back under a reader holding still, then the shrink again under a reader
 * scrolling through the tick, every page of the phase watching each. Each is read from a fresh park:
 * a reader a change moved (the correction-off cell) is no longer below the leases. The scrolling
 * one is read from the moment the reader let go: a container fs-fit.js floored keeps its height
 * while the reader scrolls, and gives it up once they stop, above them. */
async function phase(name, browser, cells) {
	const pages = await Promise.all(cells.map((c) => open(browser, c.width, c.cell)));
	const repark = () => Promise.all(pages.map(async (p, i) => { p.parked = p.parked && await park(p.page, cells[i].width); }));
	for (const [ kind, change ] of [ [ 'grow', grow ], [ 'shrink', shrink ] ]) {
		if (kind !== 'grow') await repark();
		const runs = pages.map((p) => (p.parked ? p.page.evaluate(SAMPLE, [ SECS, TOL, 0 ]) : Promise.resolve(null)));
		await new Promise((r) => setTimeout(r, 1500));
		change();
		const out = await Promise.all(runs);
		cells.forEach((c, i) => { (c.res ||= {})[kind] = out[i]; });
	}
	grow();
	await new Promise((r) => setTimeout(r, 7000));	/* a tick has rendered the rows and floored their box */
	await repark();
	const rolls = pages.map(() => { let ok; const p = new Promise((r) => { ok = r; }); return { p, ok }; });
	const scrolled = Promise.all(pages.map(async (p, i) => {
		if (!p.parked) { rolls[i].ok(); return null; }
		if (!(await scrollThrough(p.page, rolls[i].ok))) { rolls[i].ok(); return { missed: true }; }
		return p.page.evaluate(SAMPLE, [ 4, TOL, 200 ]);
	}));
	await Promise.all(rolls.map((r) => r.p));
	shrink();
	const out = await scrolled;
	cells.forEach((c, i) => { c.res.scroll = out[i]; });
	await Promise.all(pages.map((p) => p.ctx.close()));
	console.log(`  ${name}: ${cells.length} pages`);
}

const fails = [];
/* how far the page changed above the reader, in the direction of the change: positive when it
 * measured something */
const change = (x, kind) => (kind === 'grow' ? x.above : -x.above);
const valid = (x, kind, where) => {
	if (!x) fails.push(`${where}: no section below the leases to park on — measured nothing`);
	else if (x.missed) fails.push(`${where}: no tick landed while the reader scrolled — measured nothing`);
	else if (change(x, kind) < 50)
		fails.push(`${where}: the ${kind} did not reach above the reader (${x.above}px there, ${x.grew}px in the document) — measured nothing`);
	else if (x.tracked < MIN_TRACKED) fails.push(`${where}: ${x.tracked} elements seen — measured nothing`);
	else return true;
	return false;
};

const engines = opt.engines.split(','), widths = opt.widths.split(',').map(Number);
const cells = [];
for (const e of engines) for (const w of widths) for (const cell of [ 'fs', 'nn', 'nnOff', 'bs' ]) cells.push({ engine: e, width: w, cell });
const t0 = Date.now();
if (!firstMac) { console.error(`${stand.id}: ${LEASES} has no lease to find the section by`); process.exit(2); }
try {
	for (const theme of [ 'footstrap', 'bootstrap' ]) {
		setTheme(theme);
		for (const e of engines) {
			const browser = await playwright[e].launch();
			try { await phase(`${theme} ${e}`, browser, cells.filter((c) => c.engine === e && (c.cell === 'bs') === (theme === 'bootstrap'))); }
			finally { await browser.close(); }
		}
	}
} finally {
	setTheme('footstrap');
	shrink();
}

for (const e of engines) for (const w of widths) for (const kind of [ 'grow', 'shrink', 'scroll' ]) {
	const k = `${e}@${w} ${kind}`;
	const c = Object.fromEntries(cells.filter((x) => x.engine === e && x.width === w).map((x) => [ x.cell, x.res && x.res[kind] ]));
	const show = (x) => (x ? `${x.end}/${x.max}/${x.off}f/${x.painted}p of ${x.above}px` : '-');
	console.log(`${k}: reader moved (end/max/frames off/painted off of the change) footstrap ${show(c.fs)}, bootstrap ${show(c.bs)}; `
		+ `no native: footstrap ${show(c.nn)}, correction off ${show(c.nnOff)}`);
	/* bootstrap floors nothing, so nothing is left to change once its reader lets go: no reference there */
	const ref = kind !== 'scroll';
	if (![ 'fs', 'nn', 'nnOff', ...(ref ? [ 'bs' ] : []) ].map((n) => valid(c[n], kind, `${k} ${n}`)).every(Boolean)) continue;
	/* the three footstrap cells read one page; a change that differs means the emulation changed it */
	if ([ c.nn, c.nnOff ].some((x) => Math.abs(x.above - c.fs.above) > ABOVE_TOL)) {
		fails.push(`${k}: the no-native cells changed by ${c.nn.above}/${c.nnOff.above}px above the reader where footstrap changed by ${c.fs.above}px — they measured another page`);
		continue;
	}
	const bs = ref ? c.bs : { end: 0, off: 0, painted: 0 };
	if (Math.abs(c.fs.end) > Math.abs(bs.end) + TOL)
		fails.push(`${k}: footstrap left the reader ${c.fs.end}px off where bootstrap left ${bs.end}px`);
	/* an engine that anchors moves the offset inside the layout, so no frame shows the reader off */
	else if (c.fs.off > bs.off || c.fs.painted > bs.painted)
		fails.push(`${k}: footstrap showed the reader off place in ${c.fs.off} frames, ${c.fs.painted} painted (up to ${c.fs.max}px), bootstrap in ${bs.off}, ${bs.painted} painted`);
	if (Math.abs(c.nnOff.end) < change(c.nnOff, kind) / 2)
		fails.push(`${k}: with the correction off the reader moved only ${c.nnOff.end}px of ${c.nnOff.above} — the no-native cell proves nothing`);
	else if (c.nnOff.painted < 1)
		fails.push(`${k}: with the correction off no painted frame showed the reader off — the painted count proves nothing`);
	else if (Math.abs(c.nn.end) > TOL)
		fails.push(`${k}: without native anchoring footstrap left the reader ${c.nn.end}px off (correction off: ${c.nnOff.end}px)`);
	/* the rAF sampler reads the frame the correction is written in, before the write; what counts is
	 * whether a painted frame showed it */
	else if (c.nn.painted > 0)
		fails.push(`${k}: without native anchoring footstrap painted the reader off place in ${c.nn.painted} frames (up to ${c.nn.max}px)`);
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`anchor-check ${stand.id}: ${fails.length ? `${fails.length} failure(s)` : 'PASS'} in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(fails.length ? 1 : 0);

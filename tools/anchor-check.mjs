#!/usr/bin/env node
/* Does a reader parked mid-page stay put when a poll tick grows the page above them? Against one
 * running owlab router with footstrap installed:
 *
 *   - real data: DHCP leases are appended to the router's /tmp/dhcp.leases, and LuCI's own poll
 *     renders them on Status > Overview (restored afterwards);
 *   - real input: the reader is parked with the mouse wheel on the heading of the section below the
 *     one that lists the leases, at the top of the viewport, so the growth lands above them;
 *   - measured: the viewport top of every element the reader saw whose text is unique on the page,
 *     every frame; the median shift at the end is how far the reader was moved.
 *
 * Four cells per engine and width, on the same router and engine:
 *   bootstrap  the stock theme, the reference
 *   footstrap  may not leave the reader further off than bootstrap did, nor show them off place in
 *              more frames
 *   no native  footstrap where the engine has no scroll anchoring (Safari before 27): CSS.supports()
 *              answers no for overflow-anchor and `overflow-anchor: none` is on every element. The
 *              theme's own correction must hold the reader, and write it back in the next frame
 *   no native, correction off  the same with fsAnchor=off: it must move the reader by at least half
 *              the growth, or the cell above proves nothing
 * A cell that measured nothing fails: the growth never reached the document, it was not above the
 * reader, or fewer than MIN_TRACKED elements were seen.
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
const ABOVE_TOL = 8;		/* px: offset + drift must account for the growth */
const MIN_TRACKED = 5;
const SECS = 15;		/* sampling window; the growth is written 1.5 s in, a poll is 5 s */

const sh = (script, input) => execFileSync('docker', [ 'exec', '-i', CONTAINER, 'sh', '-c', script ],
	{ encoding: 'utf8', input, stdio: [ input == null ? 'ignore' : 'pipe', 'pipe', 'pipe' ] });
const setTheme = (name) => sh(`uci set luci.main.mediaurlbase=/luci-static/${name} && uci commit luci && rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/*`);
const LEASES = '/tmp/dhcp.leases';
const saved = sh(`cat ${LEASES}`);
const firstMac = (saved.split('\n').find((l) => l.trim()) || '').split(/\s+/)[1];
let batch = 0;
function grow() {
	batch++;
	let lines = '';
	for (let i = 0; i < ROWS; i++)
		lines += `4102444800 02:00:00:00:${batch.toString(16).padStart(2, '0')}:${i.toString(16).padStart(2, '0')} 172.20.9.${batch * 10 + i} anchor-check-${batch}-${i} *\n`;
	sh(`cat >> ${LEASES}`, lines);
}

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

/* Runs in the page: every frame, the median shift of the elements the reader saw at the start. */
const SAMPLE = async ([ secs, tol ]) => {
	const mc = document.getElementById('maincontent');
	const sc = (mc && /(auto|scroll)/.test(getComputedStyle(mc).overflowY)) ? mc : document.scrollingElement;
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
	const t0 = performance.now(), top0 = sc.scrollTop, h0 = sc.scrollHeight;
	let last = null, max = 0, off = 0;
	await new Promise((done) => {
		const step = () => {
			const ds = [];
			for (const t of tracked) {
				const e = find(t);
				if (e && e.getClientRects().length) ds.push(e.getBoundingClientRect().top - t.top0);
			}
			ds.sort((a, b) => a - b);
			if (ds.length) {
				last = { d: ds[Math.floor(ds.length / 2)], n: ds.length };
				if (Math.abs(last.d) > Math.abs(max)) max = last.d;
				if (Math.abs(last.d) > tol) off++;
			}
			if (performance.now() - t0 < secs * 1000) requestAnimationFrame(step); else done();
		};
		requestAnimationFrame(step);
	});
	const r1 = (x) => Math.round(x * 10) / 10;
	return { tracked: last ? last.n : 0, grew: Math.round(sc.scrollHeight - h0), scrolled: Math.round(sc.scrollTop - top0),
		end: last ? r1(last.d) : null, max: r1(max), off };
};

/* An engine without scroll anchoring, as the theme sees one: the platform says so, and nothing anchors. */
const NO_NATIVE = () => {
	const own = CSS.supports.bind(CSS);
	CSS.supports = function (a, b) {
		if (/overflow-anchor/.test(String(a))) return false;
		return arguments.length > 1 ? own(a, b) : own(a);
	};
	/* an init script can run before the document has a root element */
	const add = () => {
		const s = document.createElement('style');
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
	return { ctx, page, parked: at != null };
}

/* One growth, every page of the phase watching it. */
async function phase(name, browser, cells) {
	const pages = await Promise.all(cells.map((c) => open(browser, c.width, c.cell)));
	const runs = pages.map((p) => (p.parked ? p.page.evaluate(SAMPLE, [ SECS, TOL ]) : Promise.resolve(null)));
	await new Promise((r) => setTimeout(r, 1500));
	grow();
	const out = await Promise.all(runs);
	await Promise.all(pages.map((p) => p.ctx.close()));
	cells.forEach((c, i) => { c.res = out[i]; });
	console.log(`  ${name}: ${cells.length} pages`);
}

const fails = [];
const valid = (x, where) => {
	if (!x) fails.push(`${where}: no section below the leases to park on — measured nothing`);
	else if (x.grew < 50) fails.push(`${where}: the growth never reached the document (${x.grew}px) — measured nothing`);
	else if (Math.abs(x.scrolled + (x.end || 0) - x.grew) > ABOVE_TOL)
		fails.push(`${where}: the growth was not above the reader (grew ${x.grew}px, offset ${x.scrolled} + drift ${x.end}) — measured nothing`);
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
	sh(`cat > ${LEASES}`, saved);
}

for (const e of engines) for (const w of widths) {
	const k = `${e}@${w}`;
	const c = Object.fromEntries(cells.filter((x) => x.engine === e && x.width === w).map((x) => [ x.cell, x.res ]));
	const show = (x) => (x ? `${x.end}/${x.max}/${x.off}f` : '-');
	console.log(`${k}: grew ${c.fs ? c.fs.grew : '-'}px; reader moved (end/max/frames off) footstrap ${show(c.fs)}, bootstrap ${show(c.bs)}; `
		+ `no native: footstrap ${show(c.nn)}, correction off ${show(c.nnOff)}`);
	if (![ 'fs', 'nn', 'nnOff', 'bs' ].map((n) => valid(c[n], `${k} ${n}`)).every(Boolean)) continue;
	if (Math.abs(c.fs.end) > Math.abs(c.bs.end) + TOL)
		fails.push(`${k}: footstrap left the reader ${c.fs.end}px off where bootstrap left ${c.bs.end}px`);
	/* an engine that anchors moves the offset inside the layout, so no frame shows the reader off */
	else if (c.fs.off > c.bs.off)
		fails.push(`${k}: footstrap showed the reader off place in ${c.fs.off} frames (up to ${c.fs.max}px), bootstrap in ${c.bs.off}`);
	if (Math.abs(c.nnOff.end) < c.nnOff.grew / 2)
		fails.push(`${k}: with the correction off the reader moved only ${c.nnOff.end}px of ${c.nnOff.grew} — the no-native cell proves nothing`);
	else if (Math.abs(c.nn.end) > TOL)
		fails.push(`${k}: without native anchoring footstrap left the reader ${c.nn.end}px off (correction off: ${c.nnOff.end}px)`);
	/* one: the sampler reads the frame the correction is written in, before the write */
	else if (c.nn.off > 1)
		fails.push(`${k}: without native anchoring footstrap showed the reader off place in ${c.nn.off} frames (up to ${c.nn.max}px)`);
}
for (const f of fails) console.log('FAIL ' + f);
console.log(`anchor-check ${stand.id}: ${fails.length ? `${fails.length} failure(s)` : 'PASS'} in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(fails.length ? 1 : 0);

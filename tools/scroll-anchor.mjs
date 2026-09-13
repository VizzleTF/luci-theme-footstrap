#!/usr/bin/env node
/* The reader's place, on an engine that will not keep it.
 *
 * A poll tick changes the height of things above the reader and the page below moves. Chromium,
 * Firefox and — since WebKit 26 — Safari all hide that with scroll anchoring of their own
 * (docs/anchoring.md, `ENGINE_ANCHORS`); an older WebKit and every iPhone before it had none, and a
 * current one can still get the COLLAPSE case wrong (task wkanchor, and the `tick` row below).
 *
 * The theme does that job where nobody else does (fs-fit.js, ENGINE_ANCHORS). This gate holds every
 * half of that sentence, since each can break silently:
 *
 *   held      with the engine's anchoring suppressed AND the theme's fallback forced on, a growth
 *             above the fold must move the reader by no more than a pixel or two.
 *   floor     the same refill with the correction switched off (`fsAnchor = 'off'`): the content
 *             column holds its height between ticks, so the document never gets short enough to be
 *             clamped. It can only be measured with the other half silent.
 *   swapped   a section refilled the way `dom.content()` refills one — emptied, then filled again —
 *             must leave the reader where they were too, and PROMPTLY: sampled every frame for
 *             `SWAP_WINDOW` (900ms, well past lateDrift()'s measured 419-420ms), a drift that never
 *             falls back under tolerance is one finding ("never came back") and one that does but
 *             past `LATE_MS` (200ms — task latenet's four-way ablation put the theme's own fallback
 *             at 7-36ms and an engine's late residual at 419-420ms, and this sits between the two
 *             with margin either side) is another ("corrected late") — a single fixed-delay read
 *             cannot tell those apart, and used to fold them into the same `moved 0px`. The moment in
 *             between the empty and the refill has no height, and `held` cannot see that: a growth
 *             only ever inserted never collapses anything.
 *   not twice with the engine's anchoring left alone, the same growth must move the reader just as
 *             little — a fallback that also ran there would throw the page the other way.
 *   quiet     while the reader is SCROLLING the theme must not correct at all: a correction landing
 *             inside a flick is itself a jump.
 *   tick      while the reader is PARKED and nothing is inserted, a REAL poll tick — the engine's own
 *             anchoring included — must not move the offset either. `held` closes inside 800ms and
 *             `quiet` discards a still 400ms; a correction landing between those windows (WebKit's
 *             own, measured 421ms) passed both and is what this row exists to catch.
 *   repeat    `swapped` again, `REPEAT_TIMES` (3) times running on the same section — the shape
 *             every case above is structurally blind to: each closes inside one refill, and
 *             `_engineTrusted` (fs-fit.js) only ever moves on the SECOND miss, so a switch that
 *             flips wrongly — an engine still anchoring correctly loses the theme's trust in it two
 *             ticks later — is invisible to anything that never performs a second one (task
 *             missrule). Both the reader's position after every refill and the trust flag itself
 *             are read; the flag going false while the reader never moved is its own finding,
 *             separate from the reader actually moving. It measures on the SAME section SWAP just
 *             measured — `window.__fsRepeatSection`, not a second search — because a second search
 *             run after SWAP's own two refills can land on a worse candidate than the one SWAP
 *             already proved reaches the scroller (274/274 cells measured nothing before this was
 *             fixed; SWAP's own coverage in the same run is the comparison).
 *
 * The growth in `held`/`swapped`/`quiet` is inserted rather than waited for: a real tick depends on
 * what the router's radios are doing, and a gate that only fails when a station happens to join is
 * not a gate. `tick` is the one case that measures a real one anyway, for the fault only a real tick
 * can show.
 *
 *   node tools/scroll-anchor.mjs [--only owrt2512] [--engines chromium,firefox] [--full]
 *   … [--width 390] [--layout top] [--bail]   one cell, stopping at the first finding
 *
 * The default sweep crosses the axes that were measured to change its answer; `--full` adds the
 * ones that were measured not to (see SCROLLERS and DENSITIES) and is what CI runs on a push.
 *
 * Needs a running owlab router (docs/development.md). */
import * as pw from 'playwright';
import { stands, login, requireStands, sealToRouter, pairStands } from './lib/stands.mjs';

const arg = (name, dflt) => {
	const i = process.argv.indexOf('--' + name);
	return i === -1 ? dflt : process.argv[i + 1];
};
const ENGINES = arg('engines', 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
/* `--full` restores the axes this sweep used to cross in full: every width against every layout,
 * and all three densities. Measured on 132 cells, they multiply the sweep without dividing its
 * answers — see SCROLLERS and DENSITIES. CI crosses them on a push and a tag, where an hour is
 * affordable and a narrowing that turns out to be wrong is caught before a release. */
const FULL = process.argv.includes('--full');
/* Stop at the first finding. A full sweep is 144 cells and tens of minutes, so an answer that only
 * arrives at the end is one nobody can iterate against — a fix attempt cost a whole sweep to learn
 * it had failed in the third cell. CI never passes this: how WIDE a fault is is half of what the
 * sweep says. */
const BAIL = process.argv.includes('--bail');
/* A local iteration loop, not the sweep CI runs: the first stand only, the Overview page alone, the
 * default width/layout/density axes (task sweepspeed). Says what it left out on every run, loudly,
 * so a clean `--quick` is never mistaken for a clean sweep — the same reason a page that never
 * opened is reported apart from a pass rather than folded into one. `--only`/`--page` still override
 * when given explicitly; CI never sets this flag. */
const QUICK = process.argv.includes('--quick');

/* Three shapes, because the shape decides what the theme can anchor ON, and each of these breaks
 * differently:
 *
 *   overview     sections whose BODIES a poll refills (`.cbi-section > div`, every 5 s). The only
 *                page here where a refilled block is ever entirely above the reader, so the
 *                `swapped` scenario is measured here and nowhere else.
 *   dhcp         a table under a section whose ROWS a poll replaces — what `L.ui.Table` does, and
 *                the shape a third-party app is most likely to emit. The leases are stable (32 and
 *                36 rows on the stands), which is what makes it a repeatable cell.
 *   processes    one table, a direct child of `#view`. The climb out of it used to land on the host
 *                and give up, so nothing held the reader at all, on every engine, while a gate that
 *                only opened the first shape passed throughout. It does not poll and its single
 *                block is taller than the page scrolls (6397px against 6108px on owrt2512), so it
 *                proves the CLIMB and never the swap.
 *
 * `--page a,b` overrides. Two pages were measured and NOT taken, which is the cheaper half of this
 * list to lose:
 *
 *   wireless     812px of scroll at 390px wide and 0 at 1440, so every cell of it skipped.
 *   connections  the realtime page. Its length follows the conntrack table, so the same cell
 *                reported 958px of scroll in one run and 400px in the next — a cell that is not
 *                repeatable is not a gate. And the block this sweep swaps there is not the block
 *                its poll replaces: emptying the section `div` moved the reader 252px against a
 *                120px pad while the block itself measured the same height before and after
 *                (`grewOnItsOwn` 0), the same way swapping `.fs-ovl` deletes three sections no poll
 *                touches. What produced the other 132px was not established. */
const PAGES = arg('page', QUICK ? '/admin/status/overview'
	: '/admin/status/overview,/admin/network/dhcp,/admin/status/processes')
	.split(',').map((p) => p.trim()).filter(Boolean);

/* WIDTH AND LAYOUT ARE ONE AXIS FOR HOLD/SWAP/QUIET, and it has two values, not four: what those
 * three measure is which element the correction has to scroll, and only one of the four
 * combinations scrolls anything but the window:
 *
 *   1440 side → #maincontent      1440 top → window      390 side → window      390 top → window
 *
 * `tick` (task wkanchor) does not fit that reduction: at 390 wide both `side` and `top` collapse the
 * sidebar into the same bar chrome and scroll the same window, but `data-layout` itself is still
 * either value underneath that collapse, and something in what THAT leaves in the DOM is what
 * decides whether WebKit's own scroll anchoring misfires — measured on owrt2512/Overview, one real
 * tick with the reader parked: 0px peak-to-peak at 390 side, 41px at 390 top, same page, same tick,
 * same engine. So `top` stays in the default axis for that one case rather than only under `--full`
 * — a PR that reintroduces this fault would otherwise only be caught on a push or a tag. */
const SCROLLERS = (() => {
	const all = FULL
		? [ 1440, 390 ].flatMap((width) => [ 'side', 'top' ].map((layout) => ({ width, layout })))
		: [ { width: 1440, layout: 'side' }, { width: 390, layout: 'side' }, { width: 390, layout: 'top' } ];
	/* `--width 390 --layout top` narrows the sweep to the cell a finding names, which is what turns
	 * a fix attempt from a sweep into a minute. Neither is set in CI, where the axes above are the
	 * contract. */
	const w = arg('width', ''), l = arg('layout', '');
	return all.filter((c) => (!w || String(c.width) === w) && (!l || c.layout === l));
})();

/* One density. The axis moves the geometry — type and spacing scale, so a section is a different
 * height and the fold falls elsewhere — but it does not move the ANSWER: across all 72 Overview
 * cells of a full sweep, normal, compact and large reported the same two outcomes and nothing else
 * (`anchor on` clamped 0-1px with the reader still; `anchor off` clamped 59-60px with the reader
 * moved 60-61px). Three densities measured one thing three times. `--density a,b` widens it. */
const DENSITIES = arg('density', FULL ? 'normal,compact,large' : 'normal')
	.split(',').map((d) => d.trim()).filter(Boolean);
const GROWTH = 120;
/* a rect edge lands on a fraction; two pixels is not a jump */
const TOLERANCE = 2;
/* how many REAL poll ticks TICK insists on before it will trust a 0px reading — see the note on
 * TICK below for why fewer would pass a fault this gate exists to catch */
const TICK_COUNT = 3;
/* How late a correction may land before the drift it leaves is itself a finding — separate from
 * SWAP simply never seeing one at all. Measured (task latenet's four-way SWAP ablation): the
 * theme's own fallback (`applyAnchor` via `scheduleAnchor`) lands 7-36ms after a refill; an engine
 * that anchors but did not keep the reference through THIS refill is caught by the theme's
 * `lateDrift()` (fs-fit.js), which used to answer one rAF plus `SCROLL_IDLE` later — 404-422ms,
 * measured on the `engine DECLINES` cell below across three engines and three stands. 200ms sat
 * roughly midway between those two clusters with well over 150ms of headroom either side, so
 * ordinary jitter on a loaded runner could not cross it, and it is what a maintainer reading a
 * report would call the difference between "instant" and "a jump".
 *
 * Task late419 moved `lateDrift()` itself rather than this number: where the page was already
 * still when the refill landed it now waits the next frame instead, and the same cells read
 * 8-61ms. The threshold is unchanged and still separates the two shapes — what it now separates
 * is "the theme corrected on the next frame" from "the theme waited out a reader who was moving",
 * which is the only case left above it. */
const LATE_MS = 200;
/* How long SWAP watches a refill before it may call a correction "never came". Long enough to hold
 * lateDrift()'s slow path (404-422ms, the reader in motion) with real margin for a loaded runner;
 * short enough that a cell that truly never corrects does not sit idle. NOT shortened to match
 * task late419's faster path: the window has to outlast the SLOWEST correction the theme can
 * legitimately make, or "late" and "never" become the same reading again. */
const SWAP_WINDOW = 900;
/* How many refills REPEAT performs on the SAME section, back to back — see the note on REPEAT
 * below. `LATE_MISS_LIMIT` (fs-fit.js) is 2: one is headroom for a one-off, a second is the count.
 * Two refills only ever REACHES the limit on the second one; a third is what proves the flag it
 * trips STAYS tripped (or, on a correctly-anchoring engine, never trips at all) rather than
 * resetting itself on the very next tick — task missrule. */
const REPEAT_TIMES = 3;

/* Park the reader and wait for the THEME to notice, rather than for a stopwatch.
 *
 * A probe scrolls the page and then has to let the theme settle: fs-fit treats the reader as moving
 * until SCROLL_IDLE (400 ms) of stillness and only then remembers where the page stands — the
 * reference every correction is measured against. A flat wait is a race WebKit loses: a programmatic
 * `scrollTop` write there does not fire `scroll` on the next frame, it arrives up to 1.2 seconds
 * later, so the sampler had not begun settling when the probe grew the page (measured: three
 * findings on WebKit, none on the other two engines, with the theme identical).
 *
 * So the wait is on the EVENT and then on the idle window, both bounded. */

/* Runs in the page: park the reader, grow something above them, report what they saw.
 *
 * The router's poll is held here too, though this case only INSERTS. It used to run underneath, on
 * the reasoning that a pad the probe adds survives a tick landing beside it — and the pad does. The
 * REFERENCE does not: a tick calls `dom.content()` on the section the reader happens to be over, and
 * the element this probe measured the page by is gone before the second read. Measured on the tag
 * build: `the reader's element was replaced mid-measurement` on webkit/Overview at 1440 side, on
 * owrt2512 and owrt2410 both, and on no other engine — WebKit is slow enough here to lose that race
 * repeatably. The growth is synthetic in either case, so a real tick underneath adds nothing but the
 * chance of measuring nothing. */
const HOLD = async (growth) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	/* A page that rendered at all, not one that rendered a particular way. Counting `#view`'s children
	 * was a stand-in for that and got it wrong: the realtime Connections page puts everything inside a
	 * single `.cbi-map`, so one child meant 3219px of content read as an empty page and every cell of
	 * that shape skipped. What "nothing to grow" has to mean is that there is nothing under `#view`;
	 * whether there is enough of it to scroll is the next check's question, and it asks it in pixels. */
	if (!view || !view.firstElementChild) return { skip: 'nothing to grow' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);

	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	try {
	const at = Math.min(Math.round(room / 2), 1600);
	/* park the reader and wait for the ENGINE to say the scroll happened — see the note above */
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		/* AND THEN UNTIL THE THEME SAYS IT IS STILL, which is not the same as SCROLL_IDLE elapsing.
		 * fs-fit starts its motion sampler on the scroll event and only remembers where the page
		 * stands once that sampler has been quiet for SCROLL_IDLE; in WebKit the sampler starts late
		 * enough that a flat wait measured the theme before it had a reference at all — the gate then
		 * reported a jump on every WebKit run and none on the other two engines, with the theme
		 * identical. Asking the theme removes the guess: `scrolling` is exported for exactly this
		 * kind of question. */
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		/* A theme that answers but cannot say where it rested is a FAILURE, not a fallback. This
		 * used to be one try/catch around both, so a stripped export threw a TypeError that read as
		 * "no theme here" and the sweep quietly went back to the flat wait below — which is the
		 * WebKit flake this call exists to remove, and it measured nothing while saying nothing. */
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			/* until the theme has taken a reference AT THIS OFFSET. "Is it scrolling" cannot answer
			 * that: it says no both before the motion sampler starts and after it finishes, and in
			 * WebKit those are 1.5s apart — the probe grew the page in between, while the theme still
			 * had no reference, and the gate reported a jump on every WebKit run and none on the
			 * other two engines with the theme identical on all three. */
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* The host is not a mark, and taking it as one makes this gate report a jump that is its own:
	 * `#view` is a `.cbi-section` gap wide enough to hit at 390px, its own top does not move when the
	 * pad grows INSIDE it, and a correctly compensated page then reads as -120px. Measured: on
	 * 25.12's Overview every point down the middle answered `#view`, so all eight runs on that
	 * release reported "no content under the reader" and measured nothing.
	 *
	 * So the whole STACK at the point is read rather than the topmost element — the section a grid
	 * gap belongs to is right underneath it — and two more rows are tried before giving up, a gap
	 * being a gap only at the y it was measured at. */
	/* STICKY EXCLUDED FOR THE SAME REASON AS #view: a `position: sticky` element's rect.top is
	 * pinned to its stuck offset for as long as it stays stuck, so `after.top - before.top` stops
	 * being a faithful proxy for the reader's place the moment the stick state does — or does not —
	 * change across the measurement. Confirmed live: a sticky mark on a synthetic page reported
	 * moved=0 on every growth from 0 to 120px while a plain sibling at the same point moved with the
	 * page, so the check would silently pass however badly the theme failed there. The walk climbs
	 * to `view` because a plain child of a stuck header inherits the same pinned top. */
	const markAt = (y, x) => {
		for (const el of document.elementsFromPoint(x, y)) {
			if (el === view || !view.contains(el)) continue;
			let stuck = false;
			for (let a = el; a && a !== view; a = a.parentElement)
				if (getComputedStyle(a).position === 'sticky') { stuck = true; break; }
			if (!stuck) return el;
		}
		return null;
	};
	/* THE HIT IS TRIED ACROSS THE VIEWPORT, not at three points down its middle: a mark is anything
	 * inside #view, and on 25.12's Overview the middle column is a grid gap for most of its height,
	 * so all three of those points answered `#view` and every run on that release reported "no
	 * content under the reader" and measured nothing — half the matrix, silently unmeasured. */
	const h = window.innerHeight || 800;
	const vw = window.innerWidth || 800;
	let mark = null;
	for (const fy of [ 0.6, 0.5, 0.7, 0.4, 0.8, 0.35 ]) {
		for (const fx of [ 0.5, 0.25, 0.75 ]) {
			mark = markAt(Math.round(h * fy), Math.round(vw * fx));
			if (mark) break;
		}
		if (mark) break;
	}
	if (!mark) return { skip: 'no content under the reader' };
	const before = { pos: pos(), top: Math.round(mark.getBoundingClientRect().top) };

	/* Sliced from HERE, not from navigation — the writes `parkAt()` already made to reach this
	 * offset are not this measurement's business. `window.__fsW` is an init-script wrapper around
	 * `scrollTo`/`scrollBy`, the `scrollTop` setter and `Element.scrollTo`
	 * (../tmp/task-holdreg/hold-probe.mjs), read back only when a finding needs it: a -505px HOLD
	 * reading on firefox/owrt2512 @1440 top compact was chased a full round before before.top/
	 * after.top were printed at all — before.top read 503 on every local run, so after.top≈0 was
	 * the mark landing at the viewport top, a different event from a failed correction. */
	const w0 = (window.__fsW || []).length;
	const pad = document.createElement('div');
	pad.style.height = growth + 'px';
	view.insertBefore(pad, view.firstChild);
	await wait(800);

	const after = { pos: pos(), top: mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null };
	const writes = (window.__fsW || []).slice(w0);
	pad.remove();
	return { before, after, moved: after.top === null ? null : after.top - before.top,
		scrollDelta: after.pos - before.pos, scroller: sc ? 'maincontent' : 'window', writes };

	} finally { /* the poll stays stopped — see the note on QUIET, which starts it again */ }
};

/* Runs in the page: a poll tick the way LuCI actually performs one — `dom.content()` empties the
 * section before it refills it — and reports where that left the reader.
 *
 * Not the HOLD case above: HOLD inserts a pad, so the page only ever gets TALLER and the reference
 * the theme keeps stays valid. A real tick passes through a moment where the section has no height
 * at all, and a document that short is one the engine clamps the offset into; the section fills
 * again, nobody puts the offset back, and the reader is somewhere else. */
const SWAP = async ([ growth, tol, lateMs, winMs ]) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view) return { skip: 'no view' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	/* The router's own poll is held for the duration, which is what makes this a measurement rather
	 * than a coin toss: this case performs a tick BY HAND, to control when the container is empty,
	 * and a real tick landing in the same window rewrites the very section being swapped. Measured
	 * before it was stopped, the same router and width reported 689px, 577px and 0px on three
	 * consecutive runs. HOLD holds it too, for the reference rather than the pad — see the note there.
	 * QUIET only inserts a pad of its own, so a tick underneath it is noise it survives. */
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	try {

	/* as far down as the page goes: what the reader loses to a clamp is what is left below them */
	const at = room - 60;
	/* park the reader and wait for the ENGINE to say the scroll happened — see the note above */
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		/* AND THEN UNTIL THE THEME SAYS IT IS STILL, which is not the same as SCROLL_IDLE elapsing.
		 * fs-fit starts its motion sampler on the scroll event and only remembers where the page
		 * stands once that sampler has been quiet for SCROLL_IDLE; in WebKit the sampler starts late
		 * enough that a flat wait measured the theme before it had a reference at all — the gate then
		 * reported a jump on every WebKit run and none on the other two engines, with the theme
		 * identical. Asking the theme removes the guess: `scrolling` is exported for exactly this
		 * kind of question. */
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		/* A theme that answers but cannot say where it rested is a FAILURE, not a fallback. This
		 * used to be one try/catch around both, so a stripped export threw a TypeError that read as
		 * "no theme here" and the sweep quietly went back to the flat wait below — which is the
		 * WebKit flake this call exists to remove, and it measured nothing while saying nothing. */
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			/* until the theme has taken a reference AT THIS OFFSET. "Is it scrolling" cannot answer
			 * that: it says no both before the motion sampler starts and after it finishes, and in
			 * WebKit those are 1.5s apart — the probe grew the page in between, while the theme still
			 * had no reference, and the gate reported a jump on every WebKit run and none on the
			 * other two engines with the theme identical on all three. */
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* The tallest section body that is ENTIRELY ABOVE the viewport, and both halves matter. Tall,
	 * because the clamp only bites when what the swap takes away is more than the room left below the
	 * reader. Above, because "the reader must not move" is only true of a change above them: a
	 * section that straddles the fold is one the theme anchors INSIDE, and content growing below that
	 * anchor is supposed to move. */
	/* What a poll actually replaces, not one page's idea of it. Looking for `.cbi-section > div` alone
	 * is the Overview's shape, so the gate measures this fault there and nowhere else: Processes,
	 * Routes and the realtime pages are a TABLE inside the section, and `L.ui.Table` refreshes by
	 * replacing its rows — the same collapse with a different parent — so every one of those runs
	 * reported "no section body big enough to collapse" and passed on the engine where the fault is
	 * real. */
	let body = null;
	/* What a poll replaces, and nothing wider. `:scope > div` also matches `.fs-ovl`, the theme's own
	 * wrapper around System/Memory/Storage, so the probe deletes three whole sections at once, which
	 * no poll does — the stock one refreshes a section's BODY in place. The theme's reference lives
	 * inside that grid, so removing all of it takes the reference and its fallback together and the
	 * gate reports a jump the theme could not have prevented. A section body, a table, a table's
	 * body: those are the three things `dom.content()` is called on.
	 *
	 * `.cbi-section-descr` is excluded for the same reason and was the same mistake one level down:
	 * it is a section's DESCRIPTION, appended once when the section renders (luci-base form.js) and
	 * never replaced by a tick. On DHCP at 1440 wide with the top bar it is the tallest `div` under a
	 * section that sits above the reader, so the probe emptied it and reported 121px of movement on
	 * firefox and webkit — a collapse of static text that no poll performs. */
	for (const el of view.querySelectorAll('.cbi-section > div:not(.cbi-section-descr), .table > .tbody, .table')) {
		if (el.getBoundingClientRect().bottom > 0) continue;		/* must be entirely above the reader */
		if (el.contains(view) || el === view) continue;
		if (!body || el.offsetHeight > body.offsetHeight) body = el;
	}
	if (!body || body.offsetHeight < 200) return { skip: 'nothing above the reader big enough to collapse' };
	/* Stashed for REPEAT as soon as `body` is settled, before the mark search below can still fail
	 * — see the note beside the full stash a few lines down. `mark: null` here so REPEAT can tell
	 * "SWAP found no candidate at all" apart from "SWAP found one but nothing survived under the
	 * reader", rather than reading the second as the first. */
	window.__fsRepeatSection = { body, mark: null };
	/* Named for the guard below: `body` living inside `.fs-ovl` (System/Memory/Storage's own grid,
	 * fs-overview.js) can grow by the full pad and move the DOCUMENT by nothing — the grid's row
	 * tracks size off the taller column, so a shorter column growing 120px never reaches the
	 * scroller. Measured live: `div#fs-ovl-panel-0` at 291px grew the document 0px on both
	 * owrtsnap@900 and owrt2410@1200 — a cell that would otherwise print "moved 0px" and read as
	 * the correction working. */
	const bodyDesc = body.tagName.toLowerCase() + (body.id ? '#' + body.id : '')
		+ (body.className ? '.' + String(body.className).trim().replace(/\s+/g, '.') : '');
	/* WHAT THE THEME'S GROWTH WITNESS CAN SEE FROM HERE — task blindgrow. `observeContent()` measures
	 * a refill against the `min-height` on the floored box, so a refill with no floored box in its
	 * ancestry has no witness at all and a `lateDrift()` whose element-based drift is also blind
	 * writes nothing. That reads in a report exactly like a correction that ran and failed, which is
	 * three CI runs of guesswork; printed here so a "never came back" finding says which of the two
	 * it was. Read BEFORE the swap, while the floor of the settled page is still standing. */
	const floorBox = body.closest && body.closest('[data-fs-floor]');
	const witness = !floorBox ? 'none'
		: (floorBox === body ? 'self' : floorBox.tagName.toLowerCase() + (floorBox.id ? '#' + floorBox.id : ''))
			+ '@' + Math.round(parseFloat(floorBox.style.minHeight) || 0);
	/* AND WHETHER THE THEME HAS A REFERENCE AT ALL — the other half of "why was nothing written".
	 * `anchorRef()` returns null outright while `scrolling()` is true, and `rememberRest()` then
	 * clears `_rest` while still setting `_restAt`, so the wait above (`restAt() === scrollTop`) is
	 * satisfied by a theme that has no reference. `lateDrift()`'s first line is `if (_lateFrame ||
	 * !ref) return`, so that reads as `writes: []` — indistinguishable, in a report, from a
	 * correction that ran and missed. Read here, immediately before the refill. */
	const fitMod = await window.L.require('fs-fit').then((m) => m, () => null);
	const themeStill = fitMod ? !fitMod.scrolling() : null;
	const lateWhy = () => (fitMod && typeof fitMod.lateWhy === 'function' ? fitMod.lateWhy() : 'n/a');
	const anchorWhy = () => (fitMod && typeof fitMod.anchorWhy === 'function' ? fitMod.anchorWhy() : 'n/a');
	const bodyH0 = body.offsetHeight;
	const docH = () => (sc ? sc.scrollHeight : document.documentElement.scrollHeight);

	/* the whole STACK at the point, not just the topmost element: in a grid gap the top of the
	 * stack is `#view` itself — a host is not a mark, its own top does not move when something
	 * grows INSIDE it — and the section that gap belongs to is right underneath it. Measured: on
	 * 25.12's Overview every point down the middle answered `#view`, so all eight runs on that
	 * release reported "no content under the reader" and measured nothing. */
	/* STICKY EXCLUDED FOR THE SAME REASON AS #view AND `.cbi-section-descr`: a `position: sticky`
	 * element's rect.top is pinned to its stuck offset for as long as it stays stuck, so
	 * `after.top - before.top` stops being a faithful proxy for the reader's place the moment the
	 * stick state does — or does not — change across the measurement. Found live on owrtsnap: the
	 * mark landed on `th.th`, the sidebar's own sticky table header (theme/30-tables.css), where
	 * owrt2512 gave `td.td` for the same page and point. It did not fire in the runs that found it
	 * (`headerWasPinned=true, tableTop=-166`, moved 0 throughout) — but a synthetic sticky header
	 * reproduces the failure directly: rect.top read 0 on every growth from 0 to 120px while a plain
	 * sibling at the same point moved with the page, so a mark landing there would pass however
	 * badly the theme failed. The walk climbs to `view` because a plain child of a stuck header
	 * inherits the same pinned top. */
	const markAt = (y, x) => {
		for (const el of document.elementsFromPoint(x, y)) {
			if (el === view || !view.contains(el) || body.contains(el)) continue;
			let stuck = false;
			for (let a = el; a && a !== view; a = a.parentElement)
				if (getComputedStyle(a).position === 'sticky') { stuck = true; break; }
			if (!stuck) return el;
		}
		return null;
	};
	/* THE HIT IS TRIED ACROSS THE VIEWPORT, not at three points down its middle: a mark is anything
	 * inside #view, and on 25.12's Overview the middle column is a grid gap for most of its height,
	 * so all three of those points answered `#view` and every run on that release reported "no
	 * content under the reader" and measured nothing — half the matrix, silently unmeasured. */
	const h = window.innerHeight || 800;
	const vw = window.innerWidth || 800;
	let mark = null;
	for (const fy of [ 0.6, 0.5, 0.7, 0.4, 0.8, 0.35 ]) {
		for (const fx of [ 0.5, 0.25, 0.75 ]) {
			mark = markAt(Math.round(h * fy), Math.round(vw * fx));
			if (mark) break;
		}
		if (mark) break;
	}
	if (!mark) return { skip: 'nothing under the reader that survives the swap' };
	const before = { pos: pos(), top: Math.round(mark.getBoundingClientRect().top) };

	/* `mark` filled in on the same stash — REPEAT reads this rather than re-searching, which runs
	 * next in the same page. Measured live: an independent search, run 700ms after this one, picked
	 * `table.table.cbi-section-table` (1145px, a legitimate-looking candidate) on a cell where THIS
	 * search had already found a sibling that reached the scroller; the growth landed on the wrong
	 * element and `grewDoc` read 0 on every one of 274 cells swept. Nothing here mutates between the
	 * two searches on purpose — it is SWAP's own two `swap()` passes below, each a `dom.content()`-
	 * shaped refill, that wake `holdFloor()` in between and let it hand a second search a different
	 * answer. */
	window.__fsRepeatSection.mark = mark;

	/* the two halves of dom.content(), with the layout the engine performs in between made explicit
	 * — WebKit gets there on its own, and a gate must not depend on when */
	const swap = async () => {
		const startDocH = docH();
		const kept = Array.prototype.slice.call(body.childNodes);
		for (const n of kept) body.removeChild(n);
		const empty = { docH: (sc ? sc.scrollHeight : document.documentElement.scrollHeight), pos: pos() };
		for (const n of kept) body.appendChild(n);
		const pad = document.createElement('div');
		pad.style.height = growth + 'px';
		pad.dataset.fsProbe = '1';
		body.appendChild(pad);
		/* WHEN the mark comes back, not only WHETHER — see LATE_MS above. A single read at a fixed
		 * delay cannot tell "never corrected" from "corrected after the maintainer would call it a
		 * jump": both look identical if the delay lands after the fault has resolved and before a
		 * true non-correction would have. Sampled every frame for winMs instead — long enough to
		 * hold lateDrift()'s 419-420ms correction with margin for a loaded runner — noting the
		 * first frame the drift falls back under tolerance. */
		const t0 = performance.now();
		const w0 = (window.__fsW || []).length;
		let correctedAt = null, lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
		await new Promise((done) => {
			const frame = () => {
				lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
				if (correctedAt === null && lastTop !== null && Math.abs(lastTop - before.top) <= tol)
					correctedAt = Math.round(performance.now() - t0);
				if (performance.now() - t0 < winMs) requestAnimationFrame(frame); else done();
			};
			requestAnimationFrame(frame);
		});
		const after = { pos: pos(), top: lastTop };
		const writes = (window.__fsW || []).slice(w0);
		/* WHICH LINE DECIDED — see `_lateWhy` in fs-fit.js. Read after the window, so it holds the
		 * decision this refill produced rather than the previous cell's. */
		const why = lateWhy(), awhy = anchorWhy();
		/* each entry as `decision+ms`, relative to this refill's own t0 — see `_lateTrail` in fs-fit.js */
		const rel = (tr) => (tr || []).map((e) => {
			const i = e.lastIndexOf('@');
			return e.slice(0, i) + '+' + Math.round(Number(e.slice(i + 1)) - t0);
		}).join(' ');
		const trail = fitMod && typeof fitMod.lateTrail === 'function' ? rel(fitMod.lateTrail()) : 'n/a';
		const atrail = fitMod && typeof fitMod.anchorTrail === 'function' ? rel(fitMod.anchorTrail()) : 'n/a';
		/* The offset the swap actually asked the scroller to move by — separate from `clamped`
		 * (what the engine took OUT of a document momentarily empty) and from `moved` (what the
		 * reader's mark shows). A cell that reports `clamped 0px` because the engine declined to
		 * anchor reads identically here to one where the mark itself misreported; this term is
		 * the one number both a healthy pass and a false one can be told apart by. */
		const offsetDelta = after.pos - before.pos;
		/* Did the pad reach the SCROLLER at all — see the note on `bodyDesc` above. A grid whose
		 * row tracks size off a sibling column can absorb the whole 120px inside `body` without the
		 * document growing by a pixel, which is a different failure from "the reader didn't move". */
		const grewDoc = docH() - startDocH;
		pad.remove();
		await wait(700);		/* let the floor come back down before the next pass measures */
		return { empty, after, moved: after.top === null ? null : after.top - before.top,
			clamped: before.pos - empty.pos, offsetDelta, grewDoc, correctedAt, writes, why, awhy, trail, atrail };
	};

	const corrected = await swap();

	/* THE SAME SWAP WITH THE CORRECTION SWITCHED OFF, which is what isolates the other half. The
	 * content column keeps a floor between ticks (fs-fit.js, holdFloor), so a section emptying inside
	 * it takes nothing off the document and there is nothing for the engine to clamp into. With
	 * `fsAnchor = 'off'` the theme writes no offset at all, so anything that still moves the reader
	 * here is the floor failing rather than the correction covering for it. */
	let floorOnly = { skip: 'no storage' };
	try {
		localStorage.setItem('fsAnchor', 'off');
		floorOnly = await swap();
	} catch (e) { /* no storage, no second pass */ }
	finally { try { localStorage.removeItem('fsAnchor'); } catch (e) { /* … */ } }

	return { before, empty: corrected.empty, after: corrected.after, moved: corrected.moved,
		clamped: corrected.clamped, offsetDelta: corrected.offsetDelta, grewDoc: corrected.grewDoc,
		correctedAt: corrected.correctedAt,
		late: corrected.correctedAt !== null && corrected.correctedAt > lateMs,
		writes: corrected.writes,
		bodyDesc, bodyH: bodyH0, witness, themeStill, why: corrected.why, awhy: corrected.awhy, trail: corrected.trail, atrail: corrected.atrail,
		floorMoved: floorOnly.skip ? null : floorOnly.moved,
		floorClamped: floorOnly.skip ? null : floorOnly.clamped,
		floorOffsetDelta: floorOnly.skip ? null : floorOnly.offsetDelta,
		scroller: sc ? 'maincontent' : 'window' };

	} finally { /* the poll stays stopped — see the note on QUIET, which starts it again */ }
};

/* Runs in the page: SEVERAL of dom.content()'s empty-then-refill cycles on the SAME section, back
 * to back, on a page where the engine's own anchoring is left alone throughout.
 *
 * Why this is not SWAP again: SWAP performs ONE refill and closes inside 900ms, so `LATE_MISS_LIMIT`
 * (2, fs-fit.js) — the count that decides whether the theme keeps trusting an engine that anchors
 * imprecisely — is structurally unreachable from it. A switch that only flips after the SECOND miss
 * is invisible to a case that never performs one (task missrule): 48 green sub-runs proving a fix
 * to the miss-counting formula were all first-miss runs, and the regression the fix itself could
 * introduce — the switch flipping on an engine that is doing the job correctly, two ticks (10s)
 * later — had no case that could see it trip at all.
 *
 * `fs-fit.engineTrusted()` is read rather than inferred from timing, for the same reason `restAt()`
 * already is: "is it scrolling" and a correction's own latency both answer the wrong question, and a
 * flat guess here already cost a false report once (see the note on `parkAt` above).
 *
 * IT DOES NOT PICK ITS OWN SECTION. `window.__fsRepeatSection` — set by SWAP, which runs first in
 * every cell — is read instead of running the same search again: a second search, after SWAP's own
 * two refills have woken `holdFloor()`, can land on a different and sometimes worse candidate than
 * the one just proven to reach the scroller. Measured before this was fixed: 274 of 274 cells in a
 * full three-engine sweep reported either "nothing above the reader big enough to collapse" or a
 * growth that never reached the document, on a page where SWAP — the identical selector, the
 * identical park — had just measured something. See the note beside `window.__fsRepeatSection`
 * above for the one concrete example chased down. */
const REPEAT = async ([ growth, tol, times ]) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view) return { skip: 'no view' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	/* only against the REAL engine — see the note on TICK below for why `noEngineAnchor` skips this
	 * case entirely rather than reaching it with the fallback forced on */
	const poll = (window.L && window.L.Poll) || null;
	const polling = !!(poll && typeof poll.active === 'function' && poll.active());
	if (polling) poll.stop();
	try {

	/* THE SAME SECTION SWAP ALREADY PICKED, not a second search. SWAP's own two `dom.content()`-
	 * shaped passes (corrected + floor-only) wake `holdFloor()` in between, and a fresh search run
	 * afterwards can land on a different — and sometimes worse — candidate than the one SWAP just
	 * proved reaches the scroller: measured live, an independent search here picked
	 * `table.table.cbi-section-table` (1145px, itself a plausible-looking candidate) on a cell where
	 * SWAP's own search had found a sibling that DID reach the scroller, and every one of 274 swept
	 * cells reported "nothing above the reader big enough to collapse" or the growth landing on an
	 * element that never moved the document — SWAP measured 91 of those same 171 cells in the same
	 * run. Re-parking (below) is still needed — SWAP's own `wait(700)` settling window may have left
	 * the reader a pixel or two off `before.top` — but WHICH element is measured is SWAP's call, read
	 * off `window.__fsRepeatSection` rather than re-decided. */
	const picked = window.__fsRepeatSection;
	let body = picked && picked.body && picked.body.isConnected ? picked.body : null;
	if (!body || body.offsetHeight < 200) return { skip: 'nothing above the reader big enough to collapse' };
	let mark = picked && picked.mark && picked.mark.isConnected ? picked.mark : null;
	if (!mark) return { skip: 'nothing under the reader that survives the swap' };
	const bodyDesc = body.tagName.toLowerCase() + (body.id ? '#' + body.id : '')
		+ (body.className ? '.' + String(body.className).trim().replace(/\s+/g, '.') : '');
	/* WHAT THE THEME'S GROWTH WITNESS CAN SEE FROM HERE — task blindgrow. `observeContent()` measures
	 * a refill against the `min-height` on the floored box, so a refill with no floored box in its
	 * ancestry has no witness at all and a `lateDrift()` whose element-based drift is also blind
	 * writes nothing. That reads in a report exactly like a correction that ran and failed, which is
	 * three CI runs of guesswork; printed here so a "never came back" finding says which of the two
	 * it was. Read BEFORE the swap, while the floor of the settled page is still standing. */
	const floorBox = body.closest && body.closest('[data-fs-floor]');
	const witness = !floorBox ? 'none'
		: (floorBox === body ? 'self' : floorBox.tagName.toLowerCase() + (floorBox.id ? '#' + floorBox.id : ''))
			+ '@' + Math.round(parseFloat(floorBox.style.minHeight) || 0);
	const bodyH0 = body.offsetHeight;
	const docH = () => (sc ? sc.scrollHeight : document.documentElement.scrollHeight);

	/* park/wait: the same shape as SWAP above, because the fault this measures is downstream of the
	 * SAME candidate section — duplicated rather than shared, matching every other case in this
	 * file, since each has to run standalone inside `page.evaluate()`. */
	const at = room - 60;
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);
	};
	await parkAt(at);
	const before = { pos: pos(), top: Math.round(mark.getBoundingClientRect().top) };

	const fit = await window.L.require('fs-fit').then((m) => m, () => null);
	/* Absent on a checkout that stripped it, same guard as `restAt` — a case that silently measured
	 * nothing here would read as "trust never left true", which is not the same claim. */
	if (fit && typeof fit.engineTrusted !== 'function')
		throw new Error('fs-fit is loaded but exports no engineTrusted(): this case cannot tell '
			+ 'whether the switch tripped, and a missing export is not the same as "it did not"');
	const trusted = () => (fit ? fit.engineTrusted() : null);
	const trustedBefore = trusted();

	/* Grown by `body`'s OWN mutation, in dom.content()'s shape — empty, then refill, one tick at a
	 * time. The pad is removed and the floor allowed to settle between ticks (SWAP's own comment on
	 * why: the next pass reads a floor already standing, not one still clearing). */
	const startDocH = docH();
	const refills = [];
	/* Read WHILE the first pad is still standing — see SWAP's own `grewDoc`, taken before ITS pad
	 * comes off. This used to be `docH() - startDocH` computed after the loop, by which point every
	 * refill's pad had already been removed and the document was back at its start height on
	 * purpose: net zero on every cell, `.fs-ovl` grid or not, and indistinguishable from the growth
	 * genuinely never reaching the scroller. Measured live on the 39 cells SWAP itself measured
	 * something on in the same run: every one still read `grewDoc` 0 under the old placement. */
	let grewDoc = null;
	for (let i = 0; i < times; i++) {
		const kept = Array.prototype.slice.call(body.childNodes);
		for (const n of kept) body.removeChild(n);
		for (const n of kept) body.appendChild(n);
		const pad = document.createElement('div');
		pad.style.height = growth + 'px';
		pad.dataset.fsProbe = '1';
		body.appendChild(pad);
		const t0 = performance.now();
		const w0 = (window.__fsW || []).length;
		let correctedAt = null, lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
		await new Promise((done) => {
			const frame = () => {
				lastTop = mark.isConnected ? Math.round(mark.getBoundingClientRect().top) : null;
				if (correctedAt === null && lastTop !== null && Math.abs(lastTop - before.top) <= tol)
					correctedAt = Math.round(performance.now() - t0);
				if (performance.now() - t0 < 900) requestAnimationFrame(frame); else done();
			};
			requestAnimationFrame(frame);
		});
		const writes = (window.__fsW || []).slice(w0);
		if (i === 0) grewDoc = docH() - startDocH;
		pad.remove();
		refills.push({ i, moved: lastTop === null ? null : lastTop - before.top, correctedAt, writes,
			engineTrusted: trusted() });
		await wait(700);
	}
	return { before, bodyDesc, bodyH: bodyH0, grewDoc,
		trustedBefore, trustedAfter: trusted(), refills,
		scroller: sc ? 'maincontent' : 'window' };

	} finally { /* the poll stays stopped, matching HOLD/SWAP — nothing here restarts it */ }
};

/* Runs in the page: a scripted flick up and down while ticks land, reporting any offset change the
 * wheel did not ask for. */
/* THE POLL IS STARTED HERE AND NOWHERE ELSE, and the two cases before this leave it stopped rather
 * than handing it back. `Poll.start()` calls `step()` SYNCHRONOUSLY (luci-base, luci.js), so a case
 * that restores the poll on its way out fires a real tick into the case that runs next: measured in
 * CI, HOLD returning the poll put a live tick under SWAP's floor measurement and the sweep reported
 * `the content column's floor is not holding the document up`, 120px, on webkit/owrt2410 @390 top
 * compact — a cell that is green at v0.14.2, green before that change and green again when it was
 * reverted, on a theme those three builds share. This case WANTS ticks landing mid-flick, so it is
 * the one that starts them. */
const QUIET = async (growth) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	/* A FLICK THAT NEVER REACHES AN EDGE. Assigning a scrollTop that is already the current one
	 * fires no scroll event, so a run of steps clamped at 0 or at the bottom is a page standing
	 * still — 400 ms of that and the theme is right to put the pending growth back, which is the
	 * theme's contract and not a jump. So the travel is kept inside the page: a margin at each end,
	 * and a step small enough that six of them fit between the two. */
	/* The ticks this case measures against — see the note above. Started BEFORE the park and given
	 * a tick's worth of time, because `Poll.start()` performs one synchronously: started later, that
	 * first tick lands inside the flick this case is timing, and the sweep reports the jump it came
	 * to look for. Measured in CI: `the offset moved on its own mid-flick (worst 145.5px)` on
	 * firefox/owrt2410 @390 top compact, from starting the poll two statements further down. */
	const poll = (window.L && window.L.Poll) || null;
	if (poll && typeof poll.active === 'function' && !poll.active()) {
		poll.start();
		await wait(1500);
	}

	const edge = Math.max(80, Math.min(200, Math.round(room * 0.15)));
	const lo = edge, hi = room - edge;
	/* six steps out and six back, from the MIDDLE of that band: half the band is what one direction
	 * gets, so the step is a twelfth of it. Measured on the stands, where the Overview has 1582px of
	 * room at 1440 and 4355 at 390 — the old fixed 160px reached the bottom in three steps at 1440
	 * and stood there for the rest of the half-cycle, which is how a page nobody was scrolling came
	 * to be measured as a flick. */
	const reach = Math.max(40, Math.min(160, Math.floor((hi - lo) / 12)));

	let unexplained = 0, biggest = 0, expected = 0, stalls = 0;
	let last = Math.round((lo + hi) / 2);
	if (sc) sc.scrollTop = last; else window.scrollTo(0, last);
	await wait(700);
	last = pos();
	let lastAt = Date.now();
	let movedAt = Date.now();
	for (let i = 0; i < 24; i++) {
		const step = (i % 12 < 6) ? reach : -reach;
		expected = Math.max(lo, Math.min(hi, last + step));
		if (sc) sc.scrollTop = expected; else window.scrollTo(0, expected);
		/* a growth lands mid-flick, which is when the theme must NOT correct */
		if (i % 6 === 3) {
			const pad = document.createElement('div');
			pad.style.height = growth + 'px';
			pad.dataset.fsProbe = '1';
			view.insertBefore(pad, view.firstChild);
		}
		await wait(70);
		const now = pos();
		/* Was this step still part of a flick? The theme calls the reader "scrolling" until the offset
		 * has held still for SCROLL_IDLE (400 ms, fs-fit.js), and a step here is 70 ms, so on a machine
		 * that keeps up the whole loop is one motion. A loaded CI runner does not always keep up, and a
		 * step that took longer has the theme rightly deciding the reader stopped. A gap that long is
		 * not a flick, so the step is excluded — and counted and printed, because silence would make a
		 * run that measured nothing look like a run that found nothing. */
		const gap = Date.now() - lastAt;
		lastAt = Date.now();
		if (now !== last) movedAt = Date.now();
		/* …and the same question asked of the PAGE rather than of the loop: an offset that has not
		 * changed for SCROLL_IDLE is a page nobody is scrolling, whatever this loop asked for. */
		const idle = Date.now() - movedAt;
		/* the offset may differ from the request by the growth the engine compensated; what must not
		 * happen is a correction of the theme's own on top of it while the reader is moving */
		const off = Math.abs(now - expected);
		if (off > growth + 4) {
			if (gap >= 400 || idle >= 400) stalls++;
			else { unexplained++; biggest = Math.max(biggest, off); }
		}
		last = now;
	}
	view.querySelectorAll('[data-fs-probe]').forEach((el) => el.remove());
	return { unexplained, biggest, stalls };
};

/* Runs in the page: park the reader, LEAVE THE POLL RUNNING, and watch the offset across several
 * REAL ticks — no synthetic pad, nothing inserted by the probe at all.
 *
 * HOLD and SWAP stop the poll (see the note on QUIET) and both close their case inside 800ms; QUIET
 * starts the poll but its subject is a reader in MOTION, and it discards any step where the offset
 * held still for 400ms. None of the three ever watches a PARKED reader across a tick the poll fires
 * on its own — which is exactly the shape of task wkanchor's fault: WebKit's own scroll anchoring
 * moved the offset +21px on a tick where nothing above the reader changed height by even a pixel
 * (no `scrollTo`, no `scrollTop` setter recorded — the probe in ../tmp/task-overview12/tick-probe.mjs
 * is what caught that), and lateDrift() (fs-fit.js) wrote it back one rAF + SCROLL_IDLE later,
 * measured 421/421/408ms after the tick. Both HOLD/SWAP's 800ms window and QUIET's 400ms-still
 * discard read that pair as "the reader stayed put" — the correction landing inside their own
 * tolerance, not outside it — which is why this gate held green through it. */
const TICK = async (ticks) => {
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const view = document.getElementById('view');
	if (!view) return { skip: 'no view' };
	const mc = document.getElementById('maincontent');
	const flow = mc ? getComputedStyle(mc).overflowY : '';
	const sc = (flow === 'auto' || flow === 'scroll') ? mc : null;
	const pos = () => (sc ? sc.scrollTop : window.scrollY);
	const room = (sc ? sc.scrollHeight - sc.clientHeight : document.documentElement.scrollHeight - window.innerHeight);
	if (room < 600) return { skip: 'page too short to scroll' };

	const poll = (window.L && window.L.Poll) || null;
	/* An empty queue polls nothing to watch. `L.Poll.queue` is not a new liberty taken with a
	 * private property — fs-router.js already reads it directly (`L.Poll.queue.length === 0`), so
	 * this asks the same question the theme itself asks. Processes registers none (docs/anchoring.md:
	 * "it does not poll"), and starting the interval anyway would just wait out HARD_TIMEOUT below for
	 * a tick that can never land. */
	if (!poll || !Array.isArray(poll.queue) || poll.queue.length === 0)
		return { skip: 'this page registers no poll — nothing to tick' };
	if (typeof poll.active === 'function' && !poll.active()) poll.start();

	/* NOT room/2 — HOLD and SWAP only need SOME room below the reader, but this case's fault is
	 * where the reader rests relative to the FOLD, not to the document's total length: on a page
	 * `room` puts room/2 thousands of pixels past where anything was misbehaving, and a run parked
	 * there measured 0px on 3/3 tries while ../tmp/task-overview12/tick-probe.mjs kept finding 21px
	 * peak-to-peak at the same page's default park, ~0.6 viewport heights down — the same fraction
	 * `anchorRef()` (fs-fit.js) already uses to find the fold, because a reader who just opened a
	 * page rests roughly one screen down into it, not in its middle. */
	const at = Math.min(Math.round((window.innerHeight || 800) * 0.6), room);
	/* park the reader and wait for the ENGINE to say the scroll happened — see the note on HOLD */
	const parkAt = async (y) => {
		const target = sc || window;
		const landed = new Promise((res) => {
			let done = false;
			const on = () => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } };
			target.addEventListener('scroll', on, { passive: true });
			setTimeout(() => { if (!done) { done = true; target.removeEventListener('scroll', on); res(); } }, 2500);
		});
		if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
		await landed;
		const fit = await window.L.require('fs-fit').then((m) => m, () => null);
		if (fit && typeof fit.restAt !== 'function')
			throw new Error('fs-fit is loaded but exports no restAt(): the sweep cannot tell when '
				+ 'the theme has taken its reference, and a flat wait is not a substitute');
		if (fit) {
			for (let i = 0; i < 160; i++) {
				if (fit.restAt() === (sc ? sc.scrollTop : window.scrollY) && !fit.scrolling()) break;
				await wait(25);
			}
		}
		await wait(600);		/* the still moment the theme measures from */
	};
	await parkAt(at);

	/* NOT counted by MutationObserver batch — tried first, and wrong: one real tick on the Overview
	 * refills System, Memory and Storage as three separate `dom.content()` calls, each its own
	 * microtask-batched callback, so 3 "mutations" landed inside a SINGLE real tick and the case
	 * exited after 500ms of quiet having watched about two seconds of page time — long before the
	 * three real, 5-SECOND-APART ticks this case exists to cross. That version measured 0px on 3/3
	 * tries on the exact cell ../tmp/task-overview12/tick-probe.mjs was, at the time, reporting 21px
	 * peak-to-peak on. So the budget is TIME, off the page's own `L.env.pollinterval` — what
	 * `Poll.add()` itself defaults an interval to when a caller gives none (luci-base) — rather than
	 * off how many mutation callbacks happened to fire. */
	const interval = (window.L && window.L.env && Number(window.L.env.pollinterval)) || 5;
	let mutations = 0;
	const mo = new MutationObserver(() => { mutations++; });
	mo.observe(view, { childList: true, subtree: true });

	const samples = [];
	const start = performance.now();
	/* `ticks` real intervals, plus one more tick's worth of headroom for lateDrift's correction
	 * (measured up to 421ms after the mutation, fs-fit.js) to land inside the window instead of
	 * just past its close. */
	const budget = (ticks + 1) * interval * 1000 + 1500;
	await new Promise((done) => {
		const frame = () => {
			samples.push(pos());
			if (performance.now() - start < budget) requestAnimationFrame(frame); else done();
		};
		requestAnimationFrame(frame);
	});
	mo.disconnect();

	if (mutations === 0)
		return { skip: `no tick landed in ${Math.round(performance.now() - start)}ms — the poll did not run` };

	const mn = Math.min(...samples), mx = Math.max(...samples);
	return { moved: Math.round((mx - mn) * 10) / 10, mutations, samples: samples.length,
		scroller: sc ? 'maincontent' : 'window' };
};

let list = requireStands(stands(arg('only', ''), { all: process.argv.includes('--all') }), 'scroll-anchor');
/* `--quick`'s stand narrowing: the first stand `stands()` handed back, unless `--only` already said
 * which ones — an explicit `--only` is the caller overriding the default, and `--quick` narrowing it
 * again on top would make the flag's own effect depend on argument order. */
if (QUICK && !arg('only', '')) list = list.slice(0, 1);
/* Each `-b` twin owlab boots beside a release line (task sweepspeed) is a second container for the
 * SAME measurement, not a fourth release line — see the note on `pairStands()`. `--no-pair` is the
 * escape hatch for debugging the pairing itself, or for a run that wants the twin left idle. */
const PAIRS = process.argv.includes('--no-pair') ? new Map() : pairStands(list);
/* Printed as it is found, not held until the end: the first finding is the whole answer for someone
 * iterating on a fix, and the list below is what says how many cells and which axes. */
const findings = [];
const found = (line) => {
	findings.push(line);
	process.stdout.write(`  FINDING ${line}\n`);
};
/* Cells whose page never loaded. They are NOT findings: this gate measures where the reader ends up
 * after a layout change, and a page that did not open measured nothing at all. Reported separately,
 * and fatal only in bulk — see UNOPENED_TOLERANCE below. */
const unopened = [];
let runs = 0;

if (QUICK) {
	console.log(`scroll-anchor --quick: ${ENGINES.join(',')} on ${list.map((s) => s.id).join(',')} `
		+ `only, page ${PAGES.join(',')} only, default width/layout/density axes. This is NOT the full `
		+ 'sweep: it skips every other stand, both other page shapes (dhcp, processes), and — without '
		+ '--full — compact/large density and every scroller but 1440 side/390 side/390 top. Run without '
		+ '--quick (`npm run anchor`, or CI\'s own `--full` sweep) before trusting a clean result.\n');
}

/* A single `page.goto` in CI is not reliable enough to fail a release on. Two runs an hour apart on
 * the same commit died on webkit/owrt2410 with `page.goto: Timeout 20000ms exceeded` and
 * `page.goto: WebKit encountered an internal error` — two cells out of the sweep, every other cell
 * reporting `reader moved 0px`, and the same sweep green locally over 174 runs. So: three attempts
 * before a cell is written off. */
async function openPage(page, url) {
	let last;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
			return;
		} catch (e) {
			last = e;
			/* the WebKit process may still be dying; give it a moment rather than racing it */
			if (attempt < 3) await page.waitForTimeout(1500);
		}
	}
	throw last;
}

/* How many cells may go unopened before the sweep itself is the problem. One flaky cell is the
 * runner; a stand that stopped answering is not, and a run that measured almost nothing must not
 * report that the reader stayed put. 2% of a ~170-cell sweep is 3 cells. */
const UNOPENED_TOLERANCE = 0.02;
/* one line out of a Playwright error: the rest is a stack through the evaluate wrapper, and the
 * first line is the sentence the browser or this file actually wrote */
const first = (e) => String((e && e.message) || e).split('\n')[0].trim();

/* Reuse a logged-in session across every cell aimed at the same physical container, instead of
 * performing the POST-and-redirect login flow once per cell. Captured with a throwaway context and
 * handed to every context a worker opens afterward; `login()` still runs on each of them and still
 * re-authenticates for real the moment a cookie has expired (LuCI's own session timeout) — this
 * removes the ROUND TRIP for the common case, it does not replace the check. */
async function captureSession(browser, base) {
	const ctx = await browser.newContext();
	await sealToRouter(ctx, base);
	const page = await ctx.newPage();
	await login(page, base);
	const state = await ctx.storageState();
	await ctx.close();
	return state;
}

/* One cell, against ONE physical container — every case in this file, run once, findings printed
 * under `reportId` rather than under `base`'s own container id, so a cell an owlab `-b` twin
 * happened to draw reads identically to one the base container drew (see `pairStands()`). Pulled out
 * of the sweep below so a worker can run its own slice of the cell list without duplicating what
 * used to be the loop body. */
async function runCell(browser, engine, reportId, base, sessionState, { PAGE, width: w, layout, density, noEngineAnchor, declines }) {
	const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, storageState: sessionState });
	await sealToRouter(ctx, base);
	/* HOLD and SWAP's own record of every scroll write made during their measurement
	 * window — read back only when a finding needs it, which is what told a real failed
	 * correction apart from a mark that legitimately reached the top of the viewport (a
	 * -505px HOLD reading, firefox owrt2512 @1440 top compact, chased a full round before
	 * that distinction was made). Borrowed from ../tmp/task-holdreg/hold-probe.mjs. */
	await ctx.addInitScript(() => {
		window.__fsW = [];
		const rec = (how, val) => { try { window.__fsW.push({ t: Math.round(performance.now()), how, val: Math.round(val) }); } catch (e) { /* … */ } };
		const st = window.scrollTo;
		window.scrollTo = function (...a) { rec('window.scrollTo', typeof a[0] === 'object' ? (a[0] && a[0].top) : a[1]); return st.apply(this, a); };
		const sb = window.scrollBy;
		window.scrollBy = function (...a) { rec('window.scrollBy', typeof a[0] === 'object' ? (a[0] && a[0].top) : a[1]); return sb.apply(this, a); };
		const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
		Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, enumerable: d.enumerable,
			get() { return d.get.call(this); },
			set(v) { rec('scrollTop=' + (this.id || this.className || this.tagName), v); return d.set.call(this, v); } });
		const es = Element.prototype.scrollTo;
		if (es) Element.prototype.scrollTo = function (...a) { rec('el.scrollTo=' + (this.id || this.className || this.tagName), typeof a[0] === 'object' ? (a[0] && a[0].top) : a[1]); return es.apply(this, a); };
	});
	/* the Safari path, forced: `fsEngineAnchor=off` makes fs-fit believe the platform has
	 * no anchoring of its own, and the stylesheet turns the engine's off for real, so the
	 * two agree about which of them is responsible.
	 *
	 * `declines` IS THE SAME STYLESHEET WITHOUT THE localStorage HALF — task late419, and it
	 * is the third state of this axis rather than a flag on top of it. An engine that HAS
	 * `overflow-anchor` and declines to use it on a given refill is not a hypothesis: CI
	 * reported it on `webkit owrtsnap @1440 side compact overview` twice in three runs of one
	 * commit and never once locally, because on an unloaded machine the same engine anchors
	 * every time. The two cells above cannot reach that state by construction — one has the
	 * engine working, the other has the theme knowing it is off — so the path the theme takes
	 * when it TRUSTS an engine that did nothing (`lateDrift()`, fs-fit.js) was measured only
	 * by whatever a loaded runner happened to produce. Ablating the engine alone puts the
	 * theme in exactly that state on every engine and every run, which is what turns a 2-in-3
	 * CI coin toss into a cell that either passes or does not. */
	if (noEngineAnchor || declines)
		await ctx.addInitScript((tellTheTheme) => {
			if (tellTheTheme) try { localStorage.setItem('fsEngineAnchor', 'off'); } catch (e) { /* no storage */ }
			document.addEventListener('DOMContentLoaded', () => {
				const s = document.createElement('style');
				s.textContent = 'html, body, #maincontent, .fs-main, #view, #view * { overflow-anchor: none !important; }';
				document.head.appendChild(s);
			});
		}, !!noEngineAnchor);
	const page = await ctx.newPage();
	const mode = noEngineAnchor ? 'engine-anchoring OFF' : (declines ? 'engine DECLINES     ' : 'engine-anchoring on ');
	const where = `${engine} ${reportId} @${w} ${layout.padEnd(4)} ${density.padEnd(7)} ${mode} ${PAGE.replace('/admin/status/', '')}`;
	await login(page, base);
	try {
		await page.evaluate(async ([l, d]) => {
			const prefs = await window.L.require('fs-prefs');
			prefs.applyLayout(l);
			prefs.applyDensity(d);
		}, [ layout, density ]);
		await openPage(page, base + PAGE);
	}
	catch (e) {
		/* NOT a finding: a page that never opened says nothing about where the reader
		 * ended up. Kept apart and counted — see UNOPENED_TOLERANCE. */
		unopened.push(`${where}: ${first(e)}`);
		await ctx.close();
		return;
	}
	await page.waitForTimeout(3000);

	let held, swap, quiet, tick, repeat;
	try {
		/* TICK FIRST, and on the page exactly as it loaded — HOLD's pad, SWAP's two
		 * removeChild/appendChild cycles and QUIET's two dozen scripted flicks all perturb
		 * whatever the engine had picked as its own anchor node, and TICK measures whether
		 * a REAL tick misbehaves on ITS OWN, not after three probes have already leaned on
		 * the page. Measured: run after them, on this same page, TICK read 0px on a cell
		 * ../tmp/task-overview12/tick-probe.mjs (a fresh navigation) was reporting 21px
		 * peak-to-peak on at the time — the same fix, the same page, only its position in
		 * the sequence differed. Only against the REAL engine: with `noEngineAnchor` the
		 * stylesheet above already turns anchoring off for the whole page, which is
		 * precisely what TICK exists to watch for misbehaving — running it there would
		 * measure the theme's own correction against nothing, the question HOLD/SWAP
		 * already answer with a synthetic pad. */
		tick = (noEngineAnchor || declines)
			? { skip: 'engine already forced off — HOLD/SWAP cover the theme\'s own correction' }
			: await page.evaluate(TICK, TICK_COUNT);
		held = await page.evaluate(HOLD, GROWTH);
		swap = await page.evaluate(SWAP, [ GROWTH, TOLERANCE, LATE_MS, SWAP_WINDOW ]);
		/* only against the REAL engine — same reasoning as TICK above: with `noEngineAnchor`
		 * the fallback already runs every refill, so `_engineTrusted` has nothing to say.
		 * AND NOT ON THE `declines` CELL EITHER, for the opposite reason: there the flag going
		 * false is the switch working exactly as built — the engine really is doing nothing —
		 * so REPEAT's "the flag tripped while the reader never moved" finding would fire on
		 * correct behaviour. SWAP above performs one trusted refill per page load, which is
		 * the one measurement this cell is for; a second would be taken on an already-
		 * distrusted theme and measure `applyAnchor()`, which the OFF cell already covers. */
		repeat = (noEngineAnchor || declines)
			? { skip: 'engine already forced off — HOLD/SWAP cover the theme\'s own correction' }
			: await page.evaluate(REPEAT, [ GROWTH, TOLERANCE, REPEAT_TIMES ]);
		quiet = await page.evaluate(QUIET, GROWTH);
	}
	/* A cell that threw proved nothing, and dropping it without a word is how a sweep comes
	 * back green having measured a fraction of what it was asked to. That is not a theory:
	 * `fs-fit.restAt()` was stripped out of the package, every measurement threw, and both
	 * of these catches took the whole run down to "0 run(s)" and exit 0. */
	catch (e) {
		findings.push(`${where}: the measurement threw — ${first(e)}`);
		await ctx.close();
		return;
	}

	/* A cell that grew `body` by the full pad without the DOCUMENT growing has proven
	 * nothing: `.fs-ovl`'s grid sizes a row off its taller column, so a shorter column
	 * (`div#fs-ovl-panel-0`, 291px, on owrtsnap@900 and owrt2410@1200) can absorb 120px
	 * and leave the scroller untouched — `swap.moved` then reads 0 for the same reason a
	 * correctly-anchored page would, and the two are indistinguishable without this
	 * check. Folded into `swap.skip` rather than a separate branch so it is excluded from
	 * the pass line below the same way "nothing to collapse" already is — a skip, not a
	 * silent pass: it says the growth never reached what it was measuring. */
	if (!swap.skip && typeof swap.grewDoc === 'number' && swap.grewDoc < GROWTH - TOLERANCE
			&& swap.grewDoc < GROWTH / 2)
		swap.skip = `the ${GROWTH}px pad only grew the document ${swap.grewDoc}px `
			+ `(${swap.bodyDesc}, ${swap.bodyH}px) — the growth never reached the scroller`;
	/* the same `.fs-ovl` grid guard as SWAP's, above — REPEAT walks the same candidates */
	if (!repeat.skip && typeof repeat.grewDoc === 'number' && repeat.grewDoc < GROWTH - TOLERANCE
			&& repeat.grewDoc < GROWTH / 2)
		repeat.skip = `the ${GROWTH}px pad only grew the document ${repeat.grewDoc}px `
			+ `(${repeat.bodyDesc}, ${repeat.bodyH}px) — the growth never reached the scroller`;

	if (held.skip || quiet.skip) {
		process.stdout.write(`  ${where}: ${held.skip || quiet.skip}\n`);
		await ctx.close();
		return;
	}
	runs++;
	const geom = (h) => `before.top=${h && h.before ? h.before.top : '-'} after.top=${h && h.after ? h.after.top : '-'}`;
	if (held.moved === null)
		findings.push(`${where}: the reader's element was replaced mid-measurement, so nothing was proven`);
	else if (Math.abs(held.moved) > TOLERANCE) {
		/* ONE FLAKE IN ~216 CELLS MUST NOT FAIL A RUN ON ITS OWN. A -505px HOLD finding on
		 * firefox owrt2512 @1440 top compact was chased for a full round and never
		 * reproduced locally: before.top read 503 every run, so after.top≈0 was the mark
		 * landing at the viewport top — a different event from a failed correction — and
		 * nothing here printed the geometry that would have said so at the time. Both
		 * readings are printed now, and a second measurement is taken before either one
		 * becomes a finding. */
		const held2 = await page.evaluate(HOLD, GROWTH);
		if (held2.moved !== null && Math.abs(held2.moved) > TOLERANCE)
			found(`${where}: ${GROWTH}px grew above the reader and the page moved ${held.moved}px `
				+ `under them (${geom(held)}); re-measured: ${held2.moved}px (${geom(held2)})`
				+ ((held.writes && held.writes.length) ? ` — writes: ${JSON.stringify(held.writes)}` : ''));
		else
			process.stdout.write(`  ${where}: HOLD read ${held.moved}px once (${geom(held)}) but `
				+ `${held2.moved}px on re-measure (${geom(held2)}) — one flake, not a finding\n`);
	}
	if (swap.skip)
		process.stdout.write(`  ${where}: the swap measured nothing (${swap.skip})\n`);
	else if (swap.moved === null)
		found(`${where}: the reader's element did not survive the swap, so nothing was proven`);
	else if (Math.abs(swap.moved) > TOLERANCE)
		/* `correctedAt` is null here BY CONSTRUCTION: swap() only sets it once the drift has
		 * fallen back under tolerance, so a moved this large at the end of the window means
		 * it never did — NEVER CORRECTED, not corrected late. `writes` — HOLD's finding
		 * already appends it, this one did not, which is why three CI runs of the same finding
		 * could not say whether the theme ever attempted a correction: an empty array here means
		 * it never wrote, a non-empty one means it wrote somewhere the mark did not see. */
		found(`${where}: a section was refilled the way a poll refills one and the page never `
			+ `came back — still ${swap.moved}px off after ${SWAP_WINDOW}ms `
			+ `(the engine clamped ${swap.clamped}px of offset away)`
			+ `, growth witness: ${swap.witness}, theme still at refill: ${swap.themeStill}, theme said: ${swap.why}, anchor said: ${swap.awhy}, late trail: [${swap.trail}], anchor trail: [${swap.atrail}]`
			+ ` — writes: ${JSON.stringify(swap.writes || [])}`);
	else if (swap.correctedAt !== null && swap.correctedAt > LATE_MS)
		found(`${where}: a section was refilled the way a poll refills one and the correction `
			+ `landed ${swap.correctedAt}ms after the refill (over the ${LATE_MS}ms late `
			+ `threshold — visible to the reader as a jump)`
			+ `, growth witness: ${swap.witness}, theme still at refill: ${swap.themeStill}, theme said: ${swap.why}, anchor said: ${swap.awhy}, late trail: [${swap.trail}], anchor trail: [${swap.atrail}]`
			+ ((swap.writes && swap.writes.length) ? ` — writes: ${JSON.stringify(swap.writes)}` : ''));
	/* The floor is judged on the CLAMP, not on the movement, and only where the theme owns the job:
	 * with the correction switched off nobody compensates the pad the probe grows, so the
	 * reader moves by exactly that and should. What must not happen is the engine taking an
	 * offset away. Where the engine anchors for itself the same subtraction measures its
	 * compensation rather than a clamp — 629px of it, and the reader still level — so it is
	 * printed rather than judged. */
	if (noEngineAnchor && swap.floorClamped !== null && swap.floorClamped !== undefined && swap.floorClamped > TOLERANCE)
		found(`${where}: with the correction switched off the engine clamped `
			+ `${swap.floorClamped}px away — the content column's floor is not holding the document up`);
	if (quiet.unexplained)
		found(`${where}: the offset moved on its own ${quiet.unexplained} time(s) mid-flick (worst ${quiet.biggest}px) `
			+ '— a correction landing inside a scroll is itself a jump');
	/* THE PARKED READER, ACROSS REAL TICKS — see the note on TICK. Nothing here inserted the
	 * growth: a page that ticks at all and still moves is the engine's own anchoring (or its
	 * absence of one), the fault HOLD/SWAP's synthetic pad and QUIET's motion cannot reach. */
	if (tick.skip)
		process.stdout.write(`  ${where}: TICK measured nothing (${tick.skip})\n`);
	else if (Math.abs(tick.moved) > TOLERANCE)
		found(`${where}: the reader drifted ${tick.moved}px across real poll ticks `
			+ `(${tick.mutations} mutation(s) observed) while parked and nobody scrolling`);
	/* SEVERAL REFILLS ON ONE PAGE — see the note on REPEAT. Two things are watched apart,
	 * because they are two different faults: the reader actually moving (a correction ran
	 * where it should not have, or none ran where one should have) is a finding regardless
	 * of the trust flag; the flag going false while the reader never moved at all is a
	 * SEPARATE finding — the engine was doing the job the whole time, and the switch took
	 * the correction away from it anyway (task missrule). */
	if (repeat.skip)
		process.stdout.write(`  ${where}: REPEAT measured nothing (${repeat.skip})\n`);
	else {
		const jumped = repeat.refills.find((r) => r.moved === null || Math.abs(r.moved) > TOLERANCE);
		if (jumped)
			found(`${where}: refill ${jumped.i + 1}/${REPEAT_TIMES} on the same section left the `
				+ `reader ${jumped.moved === null ? 'without a surviving reference' : jumped.moved + 'px off'} `
				+ `(engineTrusted ${jumped.engineTrusted}, corrected ${jumped.correctedAt === null ? 'never' : jumped.correctedAt + 'ms'})`
				+ (jumped.writes && jumped.writes.length ? ` — writes: ${JSON.stringify(jumped.writes)}` : ''));
		else if (repeat.trustedBefore === true && repeat.trustedAfter === false)
			found(`${where}: _engineTrusted went false after ${REPEAT_TIMES} refills the reader `
				+ `never moved for — the engine was anchoring correctly the whole time `
				+ `(misses: ${JSON.stringify(repeat.refills.map((r) => r.engineTrusted))})`);
	}
	/* signed for readability: a positive offset is the scroller compensating for growth
	 * above the reader, which is what tells "the engine declined to anchor" (0px here)
	 * apart from "the mark misreported" (moved itself would be the tell, not this term) */
	const signed = (v) => (v === null || v === undefined ? '-' : (v >= 0 ? '+' : '') + v);
	process.stdout.write(`  ${where}  reader moved ${held.moved}px (${geom(held)}, `
		+ `scroll ${held.scrollDelta >= 0 ? '+' : ''}${held.scrollDelta}, ${held.scroller})`
		+ `  swap moved ${swap.skip ? '-' : swap.moved + 'px'} `
		+ `[offset ${swap.skip ? '-' : signed(swap.offsetDelta)}]`
		+ `  corrected ${swap.skip ? '-' : (swap.correctedAt === null ? 'never' : swap.correctedAt + 'ms')}`
		+ `  floor alone: clamped ${swap.skip || swap.floorClamped === null ? '-' : swap.floorClamped + 'px'}`
		+ `, reader ${swap.skip || swap.floorMoved === null ? '-' : swap.floorMoved + 'px'} `
		+ `[offset ${swap.skip || swap.floorOffsetDelta === null ? '-' : signed(swap.floorOffsetDelta)}]`
		+ `  mid-flick surprises ${quiet.unexplained}`
		+ (quiet.stalls ? `  (${quiet.stalls} step(s) too slow to still be a flick, not counted)` : '')
		+ `  tick drift ${tick.skip ? '-' : tick.moved + 'px/' + tick.mutations + 'mut'}`
		+ `  ${REPEAT_TIMES}x repeat ${repeat.skip ? '-' : repeat.refills.map((r) => (r.moved === null ? '?' : r.moved) + 'px').join('/')} `
		+ `trusted ${repeat.skip ? '-' : `${repeat.trustedBefore}->${repeat.trustedAfter}`}` + '\n');
	await ctx.close();
}

/* THE STANDS RUN AT THE SAME TIME, the way live-audit and spa-parity already do, and so — since
 * task sweepspeed — do the ENGINES: nothing measured here is a frame rate, every wait is on an EVENT
 * (the scroll landing, `fit.restAt()` reporting a reference at this offset) with a bounded fallback,
 * so several routers and several browsers answering at once cannot move an answer — unlike
 * scroll-jank, whose subject IS frame pacing and which therefore stays serial.
 *
 * This gate was once the whole release's critical path at 52 minutes against live's 17 (docs/ci.md);
 * CI's own fix was to shard firefox and webkit onto separate runners, which a single local process
 * cannot do — what this can do instead is stop paying for them one after another IN that process.
 * Each engine gets its own browser, and the three (or however many `--engines` named) now launch and
 * run concurrently rather than in the `for` loop's own sequence. */
await Promise.all(ENGINES.map(async (engine) => {
	if (!pw[engine]) { console.error(`scroll-anchor: no such engine "${engine}"`); process.exit(1); }
	const browser = await pw[engine].launch();
	await Promise.all(list.map(async (stand) => {
		/* One flat list of GROUPS per stand — a group is both `noEngineAnchor` states of the same
		 * page/scroller/density, kept together rather than split by raw cell index. TICK and REPEAT
		 * only run with the engine's own anchoring live (~26s of real poll ticks between them), so a
		 * plain `i % workers.length` over individual cells hands one worker every expensive cell and
		 * the other every cheap one — measured live, task sweepspeed: 16 anchor-OFF cells done against
		 * 4 anchor-ON ones at the same wall-clock point, the split defeating its own purpose. Splitting
		 * whole groups keeps every worker's share an even mix of both. */
		const groups = [];
		for (const PAGE of PAGES)
			for (const { width, layout } of SCROLLERS)
				for (const density of DENSITIES)
					/* Three states, not two — see the note beside the init script in runCell():
					 * the engine working, the engine off with the theme knowing, and the engine
					 * off with the theme still trusting it. The third costs what the second does
					 * (TICK and REPEAT skip it), and it is the only one that exercises
					 * `lateDrift()` as the page's ONLY corrector without waiting for a loaded
					 * runner to arrange it. */
					groups.push([ { noEngineAnchor: false }, { noEngineAnchor: true }, { declines: true } ]
						.map((mode) => ({ PAGE, width, layout, density, ...mode })));
		const twin = PAIRS.get(stand.id);
		const workers = twin ? [ stand.base, twin.base ] : [ stand.base ];
		/* Split evenly across the pair rather than handing the twin a copy of the same list — every
		 * cell still runs exactly once, on whichever of the two containers gets to it, so the sweep
		 * is exactly as wide as before and the wall clock for THIS stand is roughly halved. */
		const perWorker = workers.map(() => []);
		groups.forEach((g, i) => perWorker[i % workers.length].push(...g));
		const sessions = await Promise.all(workers.map((base) => captureSession(browser, base)));
		await Promise.all(workers.map(async (base, wi) => {
			for (const cell of perWorker[wi]) {
				/* --bail: the cells after the first finding measure the same fix attempt again */
				if (BAIL && findings.length) return;
				await runCell(browser, engine, stand.id, base, sessions[wi], cell);
			}
		}));
	}));
	await browser.close();
}));

if (unopened.length) {
	console.error(`\nscroll-anchor: ${unopened.length} cell(s) never opened — the browser or the stand,`
		+ ' not the theme:\n');
	for (const u of unopened) console.error('  ' + u);
	console.error('\nA page that did not load measured nothing about the reader. Tell the two apart by'
		+ '\nre-running the same cell: a real anchor finding reproduces, a runner does not.\n');
}

if (findings.length) {
	console.error(`\nscroll-anchor: ${findings.length} finding(s)\n`);
	for (const f of findings) console.error('  ' + f);
	console.error('\nfs-fit.js keeps the reader\'s place where the engine does not (ENGINE_ANCHORS), and must');
	console.error('stay out of the way where it does. docs/chrome.md.\n');
	process.exit(1);
}

/* Bulk failure to open is its own defect: the sweep did not measure what it claims to have. */
if (unopened.length && unopened.length > Math.max(3, (runs + unopened.length) * UNOPENED_TOLERANCE)) {
	console.error(`scroll-anchor: ${unopened.length} of ${runs + unopened.length} cell(s) never opened `
		+ '— too many to call the runner. Fix the stand or the browser, then re-run.\n');
	process.exit(1);
}
/* A sweep that measured nothing has not shown that the reader stays put, so it may not say so. */
if (!runs) {
	console.error('\nscroll-anchor: 0 run(s) — every cell was skipped, so nothing was measured.\n');
	process.exit(1);
}
console.log(`scroll-anchor: ${runs} run(s), the reader stayed put with and without the engine's own anchoring.`);

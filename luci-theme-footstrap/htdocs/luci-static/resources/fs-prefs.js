'use strict';
'require baseclass';
'require rpc';
'require fs-fit as fit';

/* The Appearance axes this file owns; the controls that present them are fs-appearance.js. The
 * axis list is AXIS_KEYS, which is exactly the fields of snapshotAxes() — what Save-as-default
 * writes.
 * All client-side, instant and persisted in localStorage, with head.ut's inline script re-applying
 * them before paint so a reload never flashes the wrong one; tools/axes.mjs derives the contract
 * from this file and holds the two copies to it.
 *
 * ---- three layers, and the browser always wins ----
 * Every axis resolves as localStorage ?? router-default ?? built-in. The router default is
 * Appearance -> Save as default (written to /etc/config/footstrap, read back into window.__fsSD);
 * the built-in is a bare :root. A new browser inherits the router default; this browser's own
 * choice overrides it in either direction.
 *
 * ---- every applier stores its choice EXPLICITLY ----
 * Once a router default exists, clearing a key means "inherit the router default", not "the
 * built-in" — so an applier that lsDel'd on the default value could not express "the built-in, not
 * the router's" (a router-defaulted tint could never be turned back off). Every axis records the
 * chosen value, including the off/default one. lsDel is reserved for resetToSaved(). */
/* A browser can refuse storage outright (blocked cookies, dom.storage.enabled=false, a partitioned
 * WebView) and then every access throws. The helpers below swallow it, because an axis that cannot
 * be remembered must still APPLY, but they record it: otherwise current*() reads null, falls back
 * to the router default, and the Save button sits disabled reading "Saved as default" over a page
 * painted in axes the router default does not carry. */
let _lsBroken = false;
function storageBroken() { return _lsBroken; }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { _lsBroken = true; return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { _lsBroken = true; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { _lsBroken = true; } }

/* A stored JSON array, or [] — the shape the two remembered lists use (the search palette's recent
 * paths, the menu's open sections). lsGet owns the try/catch around localStorage; this one covers
 * JSON.parse over a value another tab may have corrupted, and the Array guard that stops a stored
 * object being spread into a list. */
function lsGetArr(k) {
	try {
		const a = JSON.parse(lsGet(k) || '[]');
		return Array.isArray(a) ? a : [];
	} catch (e) { return []; }
}

/* the router-wide defaults the server stamped (head.ut), read at runtime so current*() reports the
 * effective default when this browser has no localStorage */
function sd(k) { try { return (window.__fsSD || {})[k]; } catch (e) { return undefined; } }

/* …and the write back: an applier that persists to the router must update the blob the server
 * stamped, or current*() keeps reporting the old router default until the next full load and
 * matchesSavedDefault() lies about whether anything is left to save */
function setSD(field, val) { try { (window.__fsSD = window.__fsSD || {})[field] = val; } catch (e) {} }

/* ---- every axis owns its ROUTER DEFAULT, and nothing else may restate it ----
 * `def()` is the sd() branch of current() alone: the effective value with no localStorage. Exposed
 * because _resolvedDefault() needs exactly that branch, and a second copy of the same validation
 * drifts without a symptom — matchesSavedDefault() then lies about the one thing the Save button
 * is, its own status. */
function modeDefault() {
	const d = sd('darkmode');
	return (d === 'dark' || d === 'light') ? d : 'auto';
}
function currentMode() {
	const s = lsGet('fs-darkmode');
	if (s === 'true') return 'dark';
	if (s === 'false') return 'light';
	if (s === 'auto') return 'auto';
	if (s === null) return modeDefault();
	return 'auto';
}
/* ---- dark mode is announced in three dialects, because apps sniff for it ----
 *
 * An app with its own dark styles has to guess whether the page is dark and there is no standard:
 * apps read `data-theme="dark"` on :root (luci-app-justclash keys 21 rules off it), Bootstrap's
 * `data-bs-theme` (luci-app-ssclash), or, failing both, the luminance of the body background. All
 * three are stamped for the same fact: before that, every one of justclash's [data-theme="dark"]
 * rules was dead and a dark page rendered its light fills.
 *
 * `data-darkmode` is the name the theme's own CSS keys off. The other two are outbound
 * compatibility, like the `--*-color-*` export tier: nothing in `styles/` may read them, and
 * tools/axes.mjs fails the build if it does. */
function stampDark(root, dark) {
	root.setAttribute('data-darkmode', dark ? 'true' : 'false');
	root.setAttribute('data-theme', dark ? 'dark' : 'light');
	root.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
}

const _mqDark = window.matchMedia('(prefers-color-scheme: dark)');

/* the one expression for "is this page dark right now", so the applier, the OS listener and the
 * guard below cannot disagree about it */
function intendedDark() {
	const m = currentMode();
	return m === 'dark' || (m === 'auto' && _mqDark.matches);
}

function applyMode(val) {
	const root = document.documentElement;
	/* 'auto' is stored explicitly, so it overrides a router default of dark/light — otherwise a
	 * router defaulted to dark could never be set back to "follow the OS" */
	if (val === 'auto') lsSet('fs-darkmode', 'auto');
	else lsSet('fs-darkmode', val === 'dark' ? 'true' : 'false');
	/* after the store, so intendedDark() reads the choice just made and no second copy of the
	 * condition is needed in terms of `val` */
	stampDark(root, intendedDark());
}

/* ---- the three dialects are published, so third parties write them too ----
 *
 * Announcing dark mode in a vocabulary apps understand is what makes them follow the page, and it
 * is why an app reaches for the same attribute: `luci-app-openclash` stamps `data-darkmode="true"`
 * onto :root from seven of its templates, gated on an isDarkBackground() that consults
 * `matchMedia('(prefers-color-scheme: dark)')` before it looks at the real background. So a user
 * who chose LIGHT here, on an OS set to dark, has the theme flipped by opening an OpenClash page —
 * and one of those templates removes the attribute head.ut writes as 'false'.
 *
 * No cascade trick answers a DOM write, so watch the attributes we own and restate the truth.
 * Nothing else is guarded: the other axes are private to this theme, no app has a reason to know
 * them, and a survey of ten shipping packages found none that writes one. The published trio is
 * the surface precisely because it is published.
 *
 * This corrects a wrong premise rather than fighting the app's intent: when the page really is
 * dark, the app's write agrees with ours and the guard never fires. It cannot ping-pong either —
 * our write produces a mutation, the callback re-runs, the values match, it returns. */
function guardDarkStamp() {
	const root = document.documentElement;
	const check = () => {
		const dark = intendedDark();
		if (root.getAttribute('data-darkmode') === (dark ? 'true' : 'false') &&
			root.getAttribute('data-theme') === (dark ? 'dark' : 'light') &&
			root.getAttribute('data-bs-theme') === (dark ? 'dark' : 'light')) return;
		stampDark(root, dark);
	};
	/* an app's inline <script> runs while its template is parsed, long before this module is
	 * fetched, so the attribute can already be wrong and observing alone would never see it */
	check();
	new MutationObserver(check).observe(root, {
		attributes: true,
		attributeFilter: ['data-darkmode', 'data-theme', 'data-bs-theme']
	});
}
/* "Auto" means follow the OS continuously, not only at page load. Only while the effective mode is
 * auto: an explicit browser choice, or an explicit router default with no browser override. */
_mqDark.addEventListener('change', () => {
	if (currentMode() === 'auto') {
		const root = document.documentElement;
		stampDark(root, intendedDark());
	}
});
/* Corner radius: the card radius (0–20px) as an inline --fs-radius-base on :root, from which
 * 02-tokens derives every other radius. head.ut pre-paints it and tools/axes.mjs holds JS/CSS/head
 * to this one number, hence the named const. */
const FS_RADIUS_DEFAULT = 12;

/* ---- the four axis shapes, each written once ----
 *
 * Fifteen axes are four shapes, so the shape lives in a factory and each instance is one line:
 * enumAxis (pattern ink), colorAxis (tint, accent, good, warn, danger), surfaceAxis (cards,
 * controls, bar, borders), propAxis (rounding, tint strength, photo dim, pattern size, pattern
 * strength). Same contract throughout: `current()` is localStorage ?? def(), `def()` is the router
 * default alone, `apply()` stores the choice explicitly. None use `this` — every export is a
 * detached method reference, so a `this` here would throw on the first call.
 *
 * Each factory takes its localStorage key as the first argument, and tools/axes.mjs matches the
 * call by its literal args: an axis built by a factory has no lsGet('fs-…') call site for the gate
 * to find.
 *
 * The remaining axes stay separate, each with a quirk a shared table would need an option for:
 * `mode` stores a value it does not apply and owns an MQL listener, `layout` reads the attribute,
 * `wallpaper` and `density` are three-valued, `palette` outgrew the two-value shape when the third
 * one landed, `autoCollapse` has no :root attribute. */

/* An axis whose values are a list, with one of them stamped as nothing.
 *
 * `values` are the names that become `attr="<name>"`; `dflt` is the one that leaves :root bare, and
 * is what a stray or missing value falls back to. `after` runs once the attribute is stamped, for
 * the axis that has to re-take a measurement.
 *
 * The list IS the validation: a name added to the stylesheet and not here is one head.ut pre-paints
 * and this rejects, so the page paints it and the first touch of any other control takes it away. */
function listAxis(key, attr, values, dflt, after) {
	/* 'fs-pattern-ink' -> 'pattern_ink', the window.__fsSD field. The underscore is the point: the
	 * localStorage key is hyphenated and the uci option is not, so a bare slice(3) names a field
	 * head.ut never emits, sd() returns undefined forever, and the axis reports the built-in
	 * default however the router is set — Save-as-default then writes it over the admin's value. */
	const sdKey = key.slice(3).replace(/-/g, '_');
	const ok = (v) => (values.indexOf(v) >= 0);
	const def = () => (ok(sd(sdKey)) ? sd(sdKey) : dflt);
	return {
		def,
		current() {
			const s = lsGet(key);
			if (ok(s)) return s;
			if (s === dflt) return dflt;
			if (s === null) return def();
			return dflt;	/* a stray value reads as the built-in default */
		},
		apply(val) {
			const root = document.documentElement;
			const v = ok(val) ? val : dflt;
			/* stored explicitly (including the default), so it overrides a router default */
			lsSet(key, v);
			if (v === dflt) root.removeAttribute(attr);
			else root.setAttribute(attr, v);
			if (after) after();
		}
	};
}

/* A two-value axis: `on` is stamped as the attribute's value, `off` is a bare :root. The list shape
 * with a list of one — kept as its own name because tools/axes.mjs matches the call, and because
 * "two-valued" is what most of these axes are. */
function enumAxis(key, attr, on, off) {
	return listAxis(key, attr, [ on ], off);
}

/* A colour axis — Tint, Accent and the three status colours are one axis pointed at five tokens:
 * same validation, same "0 is off", same ordering rule (set the custom property BEFORE the
 * attribute, or a fresh load paints one frame in the previous colour).
 *
 * A value is one of three things, and the attribute says which (03-palettes.css matches on it):
 *
 *   0            off — no attribute, the palette as it shipped
 *   1–360        a HUE: CSS rotates the palette's own colour through oklch(from … l c H), so
 *                lightness, chroma and every contrast margin stay the palette's
 *   '#rrggbb'    a COLOUR, stamped inline on :root as the live token; the ink over it is derived
 *                from its lightness in CSS
 *
 * Both live in one localStorage key rather than a colour key beside a hue key: two keys would need
 * a third to say which is in effect, and that third is the one a pre-paint script forgets.
 * `hueProp` carries the degrees, `colorProp` the live token a hex value overwrites; each mode
 * clears the other's property, so the two can never both be half-applied. */
const FS_HEX_RE = /^#[0-9a-f]{6}$/i;
/* 0 | 1..360 | '#rrggbb', from anything: localStorage (always a string), the router default (a uci
 * string, or a number from a config written before the axes took colours) or a caller. Anything
 * unrecognised reads as off, the built-in default. */
function normColor(v) {
	if (typeof v === 'number') return (v >= 1 && v <= 360) ? v : 0;
	if (typeof v !== 'string') return 0;
	const s = v.trim();
	if (FS_HEX_RE.test(s)) return s.toLowerCase();
	const h = parseInt(s, 10);
	return (h >= 1 && h <= 360) ? h : 0;
}
function colorAxis(key, attr, hueProp, colorProp) {
	/* 'fs-tint' -> 'tint', the window.__fsSD field. Every colour key is one word today, so the
	 * hyphen fold changes nothing; it is here because the failure when one is not would be silent
	 * (see enumAxis). */
	const sdKey = key.slice(3).replace(/-/g, '_');
	const def = () => normColor(sd(sdKey));
	return {
		def,
		current() {
			const raw = lsGet(key);
			return (raw !== null) ? normColor(raw) : def();
		},
		apply(val) {
			const root = document.documentElement;
			const v = normColor(val);
			lsSet(key, String(v));
			if (!v) {
				root.removeAttribute(attr);
				root.style.removeProperty(hueProp);
				root.style.removeProperty(colorProp);
			} else if (typeof v === 'number') {
				root.style.removeProperty(colorProp);
				/* the hue first, then the attribute that switches the rotation on: the other
				 * order paints one frame in the previous colour on a fresh load */
				root.style.setProperty(hueProp, String(v));
				root.setAttribute(attr, 'hue');
			} else {
				root.style.removeProperty(hueProp);
				root.style.setProperty(colorProp, v);
				root.setAttribute(attr, 'hex');
			}
		}
	};
}

/* A numeric slider axis that sets an inline custom property and no attribute. Each validates to
 * [min,max], stores the choice explicitly (including the default, so it overrides a router default)
 * and removes the property AT the default, so 02-tokens' own value shows through; they differ only
 * in how the number formats onto the property, which is the one varying argument. The sd() field
 * name is passed explicitly because one instance needs a rename rather than a spelling
 * ('fs-radius' -> rounding), and a factory right for four keys out of five is the trap enumAxis and
 * colorAxis name above. */
function propAxis(key, sdKey, prop, min, max, dfl, fmt) {
	const inRange = (n) => (typeof n === 'number' && n >= min && n <= max);
	const def = () => { const d = sd(sdKey); return inRange(d) ? d : dfl; };
	return {
		def,
		current() {
			const raw = lsGet(key);
			if (raw !== null) { const v = parseInt(raw, 10); return inRange(v) ? v : dfl; }
			return def();
		},
		apply(n) {
			const root = document.documentElement;
			const v = Math.max(min, Math.min(max, n | 0));
			lsSet(key, String(v));
			if (v === dfl) root.style.removeProperty(prop);
			else root.style.setProperty(prop, fmt(v));
		}
	};
}

/* Palette: footstrap is the default (bare :root); every other colourway is an opt-in data-palette
 * value, defined in styles/03-palettes.css.
 *
 * Not the enumAxis shape, which has one `on` name and reads every other stored string — including a
 * real palette — as the default. The array is what VALIDATES a stored value: a name added to the
 * CSS and not here is one head.ut pre-paints and the live applier then rejects, so the page paints
 * it and the first touch of any other control takes it away.
 *
 * Legacy names ('rvht'/'roman'/'github') are migrated by head.ut before paint, so they never reach
 * currentPalette() on a loaded page; the stray fallthrough covers them anyway. */
const PALETTES = [ 'hicontrast', 'bootstrap', '2020' ];	/* the non-default values; 'footstrap' = bare :root */
const PALETTE = listAxis('fs-palette', 'data-palette', PALETTES, 'footstrap');
const currentPalette = PALETTE.current, applyPalette = PALETTE.apply;

/* Wallpaper is a multi-value axis: off (bare canvas), pattern (the admin-uploaded SVG, tiled and
 * recoloured — 15-wallpaper.css) or file (the admin-uploaded photo, 16-login-bg.css).
 * data-wallpaper carries the value, or is absent for 'off'. Both images are router-side; this axis
 * only decides whether THIS browser paints one, so a router-wide backdrop comes from
 * Save-as-default, including the pre-login page.
 *
 * The list validates a stored value, so adding one means this line, the head.ut whitelist, the
 * Wallpaper select in fs-appearance.js and the rules in 15-wallpaper.css. A value that is no longer
 * in the list falls back to 'off'. */
const WALLPAPERS = [ 'pattern', 'file' ];		/* the non-off values; 'off' = bare :root */
const WALLPAPER = listAxis('fs-wallpaper', 'data-wallpaper', WALLPAPERS, 'off');
const currentWallpaper = WALLPAPER.current, applyWallpaper = WALLPAPER.apply;

/* Density: how much air the UI uses. A three-value axis like wallpaper, and a pure token axis —
 * 02-tokens.css multiplies the type and space ladders and every size follows, with no layout switch
 * and no re-render.
 *
 * Beyond stamping the attribute it must re-run the measured decisions (fitChrome, fitTables,
 * fitShell), which were taken against the old metrics: Compact makes more fit and Large less, so
 * otherwise the bar stays stacked — or stays unstacked and overflows — until the next resize. */
const DENSITIES = [ 'compact', 'large' ];	/* the two non-default values; 'normal' = bare :root */
const DENSITY = listAxis('fs-density', 'data-density', DENSITIES, 'normal', () => fit.schedule());
const currentDensity = DENSITY.current, applyDensity = DENSITY.apply;
/* Background-tint axis: the canvas the cards float on (--fs-bg), so a whole install reads as one
 * colour and a tab or a screenshot says which router it belongs to. Cards, chrome and the status
 * colours keep the palette's values — the cue colours the paper, not the UI. On a hue it is mixed
 * in CSS (03-palettes.css explains why that stays contrast-safe at every angle); on a hex it IS the
 * canvas. 0 is off rather than red, a hue wheel wrapping, so one end of the range is free. */
const TINT = colorAxis('fs-tint', 'data-tint', '--fs-tint-h', '--fs-bg');
const currentTint = TINT.current, applyTint = TINT.apply;

/* Accent axis: the UI accent (solid buttons, toggle knobs, sliders, focus rings, accented links)
 * while canvas, cards and status colours stay put. On a hue, CSS rotates --fs-accent and keeps the
 * palette's lightness and chroma, so --fs-on-accent stays legible unrecomputed; on a hex the ink is
 * recomputed from the entered colour's lightness (03-palettes.css). 0 = off. */
const ACCENT = colorAxis('fs-accent', 'data-accent', '--fs-accent-h', '--fs-accent');
const currentAccent = ACCENT.current, applyAccent = ACCENT.apply;

/* The three status colours are the same axis pointed at --fs-good / --fs-warn / --fs-danger, kept
 * separate because they carry separate meanings and every derived tint is a color-mix() of the
 * role, so each follows its own axis. They are not protected from recolouring: a status colour is
 * information, and an admin who paints Danger green has said so. What the theme owes them is
 * readable ink over the fill (03-palettes.css) and the contrast readout beside each field. */
/* ---- the surface axes: the sheet the UI is drawn on, rather than the marks on it ----
 *
 * The cards, the chrome, the inset controls and the hairlines. Their own factory rather than four
 * more colorAxis instances, because:
 *
 *   - there is no hue mode — rotating the hue of a near-white card keeps its chroma (~0.003), so
 *     every angle produces the same white. The Tint axis colours a surface by SETTING a chroma;
 *   - there is no derived ink — what reads on these is --fs-text, a palette token these axes must
 *     not move, so the Appearance page reports the contrast instead;
 *   - they therefore need no attribute: an inline custom property on :root is the whole mechanism,
 *     and every derived token follows because each is a color-mix() of the one this sets. That is
 *     why --fs-bar-bg is a surface of its own — an admin who wants a dark chrome over light cards
 *     has to be able to say so.
 *
 * Off is lsSet('0'), not a deleted key: once a router default exists, clearing means "inherit
 * it". */
function surfaceAxis(key, sdKey, prop) {
	const norm = (v) => {
		const s = (typeof v === 'string') ? v.trim().toLowerCase() : '';
		return FS_HEX_RE.test(s) ? s : 0;
	};
	const def = () => norm(sd(sdKey));
	return {
		def,
		current() {
			const raw = lsGet(key);
			return (raw !== null) ? norm(raw) : def();
		},
		apply(val) {
			const v = norm(val);
			lsSet(key, String(v));
			if (v) document.documentElement.style.setProperty(prop, v);
			else document.documentElement.style.removeProperty(prop);
		}
	};
}
const CARD = surfaceAxis('fs-card', 'card', '--fs-panel-base');
const currentCard = CARD.current, applyCard = CARD.apply;
const CONTROL = surfaceAxis('fs-control', 'control', '--fs-panel2-base');
const currentControl = CONTROL.current, applyControl = CONTROL.apply;
const BAR = surfaceAxis('fs-bar', 'bar', '--fs-bar-bg');
const currentBar = BAR.current, applyBar = BAR.apply;
const LINE = surfaceAxis('fs-line', 'line', '--fs-border-base');
const currentLine = LINE.current, applyLine = LINE.apply;


const GOOD = colorAxis('fs-good', 'data-good', '--fs-good-h', '--fs-good');
const currentGood = GOOD.current, applyGood = GOOD.apply;
const WARN = colorAxis('fs-warn', 'data-warn', '--fs-warn-h', '--fs-warn');
const currentWarn = WARN.current, applyWarn = WARN.apply;
const DANGER = colorAxis('fs-danger', 'data-danger', '--fs-danger-h', '--fs-danger');
const currentDanger = DANGER.current, applyDanger = DANGER.apply;

/* Rounding: the propAxis instance (default const and rationale up top), --fs-radius-base in px. */
const RADIUS = propAxis('fs-radius', 'rounding', '--fs-radius-base', 0, 20, FS_RADIUS_DEFAULT, (v) => (v + 'px'));
const currentRadius = RADIUS.current, applyRadius = RADIUS.apply, radiusDefault = RADIUS.def;

/* Layout axis: horizontal top bar (the default) vs vertical sidebar. One template, one renderer —
 * CSS morphs the chrome off :root[data-layout] and toggling re-renders nothing; menu-footstrap.js
 * observes the attribute and folds the accordion into dropdowns or restores it.
 *
 * Read the ATTRIBUTE, not localStorage: head.ut stamps it server-side from the router default and
 * the pre-paint script overrides it, so it always carries an explicit value. localStorage would
 * report 'sidebar' on a router defaulting to 'top' until the user first touched the toggle. */
function currentLayout() {
	return document.documentElement.getAttribute('data-layout') === 'top' ? 'top' : 'sidebar';
}
function isTopLayout() {
	return currentLayout() === 'top';
}
function applyLayout(val) {
	const layout = (val === 'top') ? 'top' : 'sidebar';
	/* always an explicit value, never a removed attribute: every layout rule matches data-layout
	 * positively, and lsDel would let the server default re-assert on the next load */
	lsSet('fs-layout', layout);
	document.documentElement.setAttribute('data-layout', layout);
	/* the bar and the column leave the menu different room: re-take the fits-on-one-row
	 * measurement */
	fit.schedule();
}

/* Sidebar accordion: auto-collapse on = one section open at a time; off (default) they stack.
 * Only meaningful for the expanded sidebar — rail flyouts and the mobile bar are always
 * exclusive. Read by menu-footstrap.js. */
function autoCollapseDefault() {
	return sd('autocollapse') === 'on';
}
function currentAutoCollapse() {
	const s = lsGet('fs-menu-autocollapse');
	if (s === 'true') return true;
	if (s === 'false') return false;
	if (s === null) return autoCollapseDefault();
	return false;
}
function applyAutoCollapse(val) {
	const on = (val === 'on');
	lsSet('fs-menu-autocollapse', on ? 'true' : 'false');

	/* Switching it on with several sections unfolded leaves the menu in a state the setting says is
	 * impossible, so somebody must fold them — but not this module, which owns storage while the
	 * menu owns every piece of the open/closed state and opens and closes only through setOpen().
	 * Reaching in with a raw classList.remove satisfies the class and leaves the aria saying
	 * expanded. Say what changed and let the menu apply it. */
	document.dispatchEvent(new CustomEvent('fs-autocollapse', { detail: { on } }));
}

/* The sidebar rail's collapsed flag; the button that flips it is chrome (fs-chrome.js). Not part
 * of the router-wide defaults — a transient chrome collapse, not an appearance choice — so it is
 * absent from snapshotAxes() and resetToSaved(). */
function applyRail(on) {
	const root = document.documentElement;
	if (on) { root.setAttribute('data-rail', 'true'); lsSet('fs-rail', 'true'); }
	else { root.removeAttribute('data-rail'); lsDel('fs-rail'); }
}
function currentRail() {
	return document.documentElement.getAttribute('data-rail') === 'true';
}

/* ---- Save as default: write the current effective axes to /etc/config/footstrap ----
 * The scoped rpcd ACL (config 'footstrap' only) lets the admin's session set and commit those
 * options; rpcd validates the config/section/option names, so no value reaches a shell. The server
 * reads them back on the next load and head.ut's sanitiser clamps each before it becomes
 * window.__fsSD.
 *
 * snapshotAxes() reads the effective values, which already fold in this browser's localStorage, so
 * Save captures what the user sees. It does not touch localStorage: this browser keeps overriding,
 * and the saved default is for other devices. resetToSaved() drops this browser back onto it. */
/* Every saved axis's localStorage key: what Save-as-default clears and what a reset walks.
 *
 * Tried as one table of [key, field, def] with the resolved defaults derived from it: correct,
 * and 188 B larger after minification — three lists of short literals compress better than
 * twenty-one rows of data, because a function name is mangled and a row is not. The copies are
 * held together by tools/axes.mjs instead, which reads snapshotAxes()'s body and holds every
 * field against header.ut's FS_AXES. */
const AXIS_KEYS = [
	'fs-layout', 'fs-darkmode', 'fs-palette', 'fs-wallpaper', 'fs-tint',
	'fs-accent', 'fs-good', 'fs-warn', 'fs-danger', 'fs-card', 'fs-control',
	'fs-bar', 'fs-line', 'fs-radius', 'fs-menu-autocollapse', 'fs-tint-strength',
	'fs-density', 'fs-photo-dim', 'fs-pattern-size', 'fs-pattern-strength',
	'fs-pattern-ink'
];
/* Tint strength: a multiplier on the tint chroma (03-palettes.css), 100% being the designed
 * strength and 200% the cap. 0 is not quite "no tint" — the relative colour that applies the tint
 * replaces chroma outright, so 0 leaves a neutral canvas at the same lightness rather than the
 * untinted one; clearing the Tint hue is the real off. It only bites while a Tint hue is set, and
 * is moot under the File wallpaper, where the photo covers the canvas.
 *
 * This axis and its default live above _resolvedDefault()'s module-init call below: a propAxis
 * instance is a `const`, so declaring it further down leaves it in the TDZ at init and the whole
 * module throws, taking the chrome and the menu with it. */
const FS_TSTR_DEFAULT = 100;
const TSTR = propAxis('fs-tint-strength', 'tint_strength', '--fs-tint-strength', 0, 200, FS_TSTR_DEFAULT, (v) => String(v / 100));
const currentTintStrength = TSTR.current, applyTintStrength = TSTR.apply, tintStrengthDefault = TSTR.def;

/* Photo dim: the scrim opacity over the FILE photo (0–100%). The photo is shared; how strongly
 * this browser dims it is not, and it reaches the router through Save-as-default. Only bites while
 * the wallpaper is 'file'. Declared up here for the TDZ reason above. */
const FS_PDIM_DEFAULT = 74;
const PDIM = propAxis('fs-photo-dim', 'photo_dim', '--fs-photo-dim', 0, 100, FS_PDIM_DEFAULT, (v) => (v + '%'));
const currentPhotoDim = PDIM.current, applyPhotoDim = PDIM.apply, photoDimDefault = PDIM.def;

/* The pattern's two live knobs, and the third that is an enum. All three bite only while the
 * wallpaper is 'pattern'; the FILE is shared, how this browser draws it is not.
 *
 * Size is the tile's edge in px, with a wide range because "how big is one repeat" is a property of
 * the artwork. Strength is the layer's opacity 0-100, which is the knob a `<g opacity>` baked into
 * the file would put out of CSS's reach. Declared up here for the TDZ reason above. */
const FS_PSIZE_DEFAULT = 440;
const PSIZE = propAxis('fs-pattern-size', 'pattern_size', '--fs-pattern-size', 40, 1600, FS_PSIZE_DEFAULT, (v) => (v + 'px'));
const currentPatternSize = PSIZE.current, applyPatternSize = PSIZE.apply, patternSizeDefault = PSIZE.def;
const FS_PSTR_DEFAULT = 20;
const PSTR = propAxis('fs-pattern-strength', 'pattern_strength', '--fs-pattern-strength', 0, 100, FS_PSTR_DEFAULT, (v) => String(v / 100));
const currentPatternStrength = PSTR.current, applyPatternStrength = PSTR.apply, patternStrengthDefault = PSTR.def;
/* Ink: 'theme' (the file's alpha, the theme's colour) or 'original' (the file's own colours, no
 * mask). Two-valued with the default as a bare :root, i.e. the enumAxis shape. */
const PINK = enumAxis('fs-pattern-ink', 'data-pattern-ink', 'original', 'theme');
const currentPatternInk = PINK.current, applyPatternInk = PINK.apply;
/* `reject: true` is load-bearing: without it a refused write arrives as SUCCESS. rpc.js raises on
 * the ubus status code only when the declaration asks it to, and otherwise hands the code back as
 * the resolved value — measured on the router, a per-config ACL refusal resolves with 6
 * (permission denied) and every `.then()` below runs as if the file had been written, greying the
 * Save button over a write that never happened. */
const _uciSet = rpc.declare({ object: 'uci', method: 'set', params: [ 'config', 'section', 'values' ], reject: true });
const _uciCommit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ], reject: true });

function snapshotAxes() {
	return {
		layout: currentLayout(),
		darkmode: currentMode(),
		palette: currentPalette(),
		wallpaper: currentWallpaper(),
		tint: String(currentTint()),
		accent: String(currentAccent()),
		good: String(currentGood()),
		warn: String(currentWarn()),
		danger: String(currentDanger()),
		card: String(currentCard()),
		control: String(currentControl()),
		bar: String(currentBar()),
		line: String(currentLine()),
		rounding: String(currentRadius()),
		autocollapse: currentAutoCollapse() ? 'on' : 'off',
		tint_strength: String(currentTintStrength()),
		density: currentDensity(),
		photo_dim: String(currentPhotoDim()),
		pattern_size: String(currentPatternSize()),
		pattern_strength: String(currentPatternStrength()),
		pattern_ink: currentPatternInk()
	};
}
/* The resolved router default (the uci value if set, else the built-in) in snapshotAxes() string
 * form, so the Appearance tab can grey the Save button when this browser already shows exactly it.
 * Seeded from window.__fsSD at load and replaced with the just-saved snapshot, so a save flips the
 * match without a reload.
 *
 * Every field is the axis's own def(): a second copy of a validation drifts with no symptom beyond
 * matchesSavedDefault() lying, which is the one thing the Save button is. `layout` is the exception,
 * since currentLayout() reads the attribute — its fallback must stay `top`, matching head.ut's
 * stamp and resetToBuiltin(), or a fresh install shows dirty before anything is touched and
 * resetToSaved() lands on the wrong layout. */
function _resolvedDefault() {
	return {
		layout: sd('layout') || 'top',
		darkmode: modeDefault(),
		palette: PALETTE.def(),
		wallpaper: WALLPAPER.def(),
		tint: String(TINT.def()),
		accent: String(ACCENT.def()),
		good: String(GOOD.def()),
		warn: String(WARN.def()),
		danger: String(DANGER.def()),
		card: String(CARD.def()),
		control: String(CONTROL.def()),
		bar: String(BAR.def()),
		line: String(LINE.def()),
		rounding: String(radiusDefault()),
		autocollapse: (autoCollapseDefault() ? 'on' : 'off'),
		tint_strength: String(tintStrengthDefault()),
		density: DENSITY.def(),
		photo_dim: String(photoDimDefault()),
		pattern_size: String(patternSizeDefault()),
		pattern_strength: String(patternStrengthDefault()),
		pattern_ink: PINK.def()
	};
}
let _savedDefault = _resolvedDefault();
function matchesSavedDefault() {
	const cur = snapshotAxes();
	return Object.keys(cur).every((k) => cur[k] === _savedDefault[k]);
}

/* ---- no axis reaches /etc/config/footstrap except through Save-as-default ----
 * Every axis is per-browser. An axis that wrote through on change — on the argument that the photo
 * it relates to is router-side — re-pointed the router-wide default for every other device from one
 * browser, and moved the Save baseline with it, so the button did not even light up. A per-browser
 * preference must never mutate shared state invisibly.
 *
 * Only the photo's bytes and its cache-bust token are router-side. Whether a browser paints it is
 * `fs-wallpaper` and how dim is `fs-photo-dim`: ordinary axes, saved with the rest or not at
 * all. */
function saveAsDefault() {
	const snap = snapshotAxes();
	return _uciSet('footstrap', 'settings', snap)
		.then(() => _uciCommit('footstrap'))
		.then(() => { _savedDefault = snap; });
}
/* ---- the two resets, which are not the same escape hatch ----
 *
 * Both drop this browser's tweaks and differ in what is underneath:
 *
 *   resetToSaved()    clears the keys, so every axis falls back to the router default where one is
 *                     set and to the built-in where it is not. The browser goes back to inheriting.
 *   resetToBuiltin()  writes the theme's own defaults explicitly, the only way to say "as the theme
 *                     ships" — clearing the keys is the sentence that means "inherit the router
 *                     default".
 *
 * Both leave /etc/config/footstrap alone: neither un-saves a router default.
 *
 * The caller reloads so head.ut re-applies everything in one pass — the appliers repaint correctly,
 * but the controls on the page were built from the values they had at render time. */
function resetToSaved() {
	AXIS_KEYS.forEach(lsDel);
}

/* The built-in defaults, written through the ordinary appliers so each validates its own value and
 * stamps :root as usual. Stated rather than derived: a default is a default because it is what a
 * bare :root paints, and the five with a named const use it, so the numbers cannot drift from the
 * CSS. */
function resetToBuiltin() {
	/* `top` for layout, not sidebar: the bar is what a bare :root paints (head.ut stamps it when uci
	 * says nothing), so it is what "as the theme ships" means. The colour and surface axes reset to
	 * 0, which is "the palette's own".
	 *
	 * Stated as calls rather than carried in AXES: a fourth column of thunks measured 297 B against
	 * this list, and a wrong value here is what the Save button's "Reset to default" shows on the
	 * first click — the one state no static gate can see and the live check does. */
	applyLayout('top');
	applyMode('auto');
	applyPalette('footstrap');
	applyWallpaper('off');
	applyTint(0);
	applyAccent(0);
	applyGood(0);
	applyWarn(0);
	applyDanger(0);
	applyCard(0);
	applyControl(0);
	applyBar(0);
	applyLine(0);
	applyRadius(FS_RADIUS_DEFAULT);
	applyAutoCollapse('off');
	applyTintStrength(FS_TSTR_DEFAULT);
	applyDensity('normal');
	applyPhotoDim(FS_PDIM_DEFAULT);
	applyPatternSize(FS_PSIZE_DEFAULT);
	applyPatternStrength(FS_PSTR_DEFAULT);
	applyPatternInk('theme');
}

/* ---- the two uploaded wallpapers, browser side ----
 *
 * What the router last saved, what URL that is, and how to paint it. Putting the file THERE is
 * fs-assets.js: a DOMParser pass, a canvas re-encode, a chmod and a rollback, reached only from the
 * Appearance tab and so not worth downloading on every admin page. The token accessors stay here
 * because `sd()` is private to this module and because head.ut's pre-paint reads the same fields.
 *
 * Neither is an axis: an axis is per-browser with a router default, and these have no browser
 * layer — one admin uploads once and every device sees it, pre-login included. So they are absent
 * from AXIS_KEYS, snapshotAxes() and matchesSavedDefault(), and must not move the Save button. */
const PAT_SERVE = '/luci-static/footstrap/pattern.svg';	/* the uhttpd symlink the uci-default makes */
function currentPattern() {
	const t = sd('pattern');
	return (typeof t === 'string' && BG_TOKEN_RE.test(t)) ? t : '';
}
function patternUrl(tok) { return PAT_SERVE + '?v=' + tok; }

/* set/clear the tile URL live. This only supplies the url(); whether it PAINTS is the Wallpaper
 * axis (data-wallpaper="pattern"). Exported because fs-assets.js applies the token it just wrote. */
function applyPattern(tok) {
	const root = document.documentElement;
	if (tok) root.style.setProperty('--fs-pattern-url', 'url("' + patternUrl(tok) + '")');
	else root.style.removeProperty('--fs-pattern-url');
	setSD('pattern', tok || '');
}

const BG_SERVE = '/luci-static/footstrap/bg';	/* the uhttpd symlink the uci-default makes */
/* the cache-bust token charset, an md5/sha hex string. One copy here; head.ut's ucode sanitiser
 * and the pre-paint inline script keep their own identical copies unavoidably, running before this
 * module — see the axes contract in head.ut. */
const BG_TOKEN_RE = /^[a-f0-9]{6,64}$/;
/* the same question asked from fs-assets.js, which validates the checksum an upload replies with.
 * A predicate rather than the pattern itself, so the charset stays stated once. */
function tokenOk(t) { return BG_TOKEN_RE.test(t); }

/* the token the server last saved, validated to the same hex charset head.ut's sanitiser and
 * pre-paint use, so the Appearance tab can build a cache-busted preview src. '' = none. */
function currentLoginBg() {
	const t = sd('login_bg');
	return (typeof t === 'string' && BG_TOKEN_RE.test(t)) ? t : '';
}
function loginBgUrl(tok) { return BG_SERVE + '?v=' + tok; }

/* applyPattern's twin for the photo; data-wallpaper="file" decides whether it paints. */
function applyLoginBg(tok) {
	const root = document.documentElement;
	if (tok) root.style.setProperty('--fs-login-bg-url', 'url("' + loginBgUrl(tok) + '")');
	else root.style.removeProperty('--fs-login-bg-url');
	setSD('login_bg', tok || '');
}

return baseclass.extend({
	lsGet, lsSet, lsGetArr, storageBroken,

	currentMode, applyMode, guardDarkStamp,
	currentPalette, applyPalette,
	currentWallpaper, applyWallpaper,
	currentDensity, applyDensity,
	currentRadius, applyRadius,
	currentTint, applyTint,
	currentAccent, applyAccent,
	currentGood, applyGood,
	currentCard, applyCard,
	currentControl, applyControl,
	currentBar, applyBar,
	currentLine, applyLine,
	currentWarn, applyWarn,
	currentDanger, applyDanger,
	currentLayout, isTopLayout, applyLayout,
	currentAutoCollapse, applyAutoCollapse,
	currentRail, applyRail,

	currentLoginBg, loginBgUrl, applyLoginBg,
	currentPattern, patternUrl, applyPattern,
	tokenOk,
	currentPatternSize, applyPatternSize,
	currentPatternStrength, applyPatternStrength,
	currentPatternInk, applyPatternInk,
	currentTintStrength, applyTintStrength,
	currentPhotoDim, applyPhotoDim,

	saveAsDefault, resetToSaved, resetToBuiltin, matchesSavedDefault
});

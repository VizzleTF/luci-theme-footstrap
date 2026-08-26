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

/* A two-value axis: `on` is stamped as the attribute's value, `off` is a bare :root (no
 * attribute). */
function enumAxis(key, attr, on, off) {
	/* 'fs-pattern-ink' -> 'pattern_ink', the window.__fsSD field. The underscore is the point: the
	 * localStorage key is hyphenated and the uci option is not, so a bare slice(3) names a field
	 * head.ut never emits, sd() returns undefined forever, and the axis reports the built-in
	 * default however the router is set — Save-as-default then writes it over the admin's value. */
	const sdKey = key.slice(3).replace(/-/g, '_');
	const def = () => (sd(sdKey) === on ? on : off);
	return {
		def,
		current() {
			const s = lsGet(key);
			if (s === on) return on;
			if (s === off) return off;
			if (s === null) return def();
			return off;		/* a stray value reads as the built-in default */
		},
		apply(val) {
			const root = document.documentElement;
			const isOn = (val === on);
			lsSet(key, isOn ? on : off);
			if (isOn) root.setAttribute(attr, on);
			else root.removeAttribute(attr);
		}
	};
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
function paletteDefault() {
	const d = sd('palette');
	return (PALETTES.indexOf(d) >= 0) ? d : 'footstrap';
}
function currentPalette() {
	const s = lsGet('fs-palette');
	if (PALETTES.indexOf(s) >= 0) return s;
	if (s === 'footstrap') return 'footstrap';
	if (s === null) return paletteDefault();
	return 'footstrap';
}
function applyPalette(val) {
	const root = document.documentElement;
	const v = (PALETTES.indexOf(val) >= 0) ? val : 'footstrap';
	/* stored explicitly (including 'footstrap'), so it overrides a router default — see the
	 * header */
	lsSet('fs-palette', v);
	if (v === 'footstrap') root.removeAttribute('data-palette');
	else root.setAttribute('data-palette', v);
}

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
function wallpaperDefault() {
	const d = sd('wallpaper');
	return (WALLPAPERS.indexOf(d) >= 0) ? d : 'off';
}
function currentWallpaper() {
	const s = lsGet('fs-wallpaper');
	if (WALLPAPERS.indexOf(s) >= 0) return s;
	if (s === 'off') return 'off';
	if (s === null) return wallpaperDefault();
	return 'off';
}

/* Density: how much air the UI uses. A three-value axis like wallpaper, and a pure token axis —
 * 02-tokens.css multiplies the type and space ladders and every size follows, with no layout switch
 * and no re-render.
 *
 * Beyond stamping the attribute it must re-run the measured decisions (fitChrome, fitTables,
 * fitShell), which were taken against the old metrics: Compact makes more fit and Large less, so
 * otherwise the bar stays stacked — or stays unstacked and overflows — until the next resize. */
const DENSITIES = [ 'compact', 'large' ];	/* the two non-default values; 'normal' = bare :root */
function densityDefault() {
	const d = sd('density');
	return (DENSITIES.indexOf(d) >= 0) ? d : 'normal';
}
function currentDensity() {
	const s = lsGet('fs-density');
	if (DENSITIES.indexOf(s) >= 0) return s;
	if (s === 'normal') return 'normal';
	if (s === null) return densityDefault();
	return 'normal';
}
function applyDensity(val) {
	const root = document.documentElement;
	const v = (DENSITIES.indexOf(val) >= 0) ? val : 'normal';
	lsSet('fs-density', v);
	if (v === 'normal') root.removeAttribute('data-density');
	else root.setAttribute('data-density', v);
	fit.schedule();
}
function applyWallpaper(val) {
	const root = document.documentElement;
	const v = (WALLPAPERS.indexOf(val) >= 0) ? val : 'off';
	lsSet('fs-wallpaper', v);
	if (v === 'off') root.removeAttribute('data-wallpaper');
	else root.setAttribute('data-wallpaper', v);
}

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
const AXIS_KEYS = [
	'fs-layout', 'fs-darkmode', 'fs-palette', 'fs-wallpaper',
	'fs-tint', 'fs-accent', 'fs-good', 'fs-warn', 'fs-danger',
	'fs-card', 'fs-control', 'fs-bar', 'fs-line',
	'fs-radius', 'fs-menu-autocollapse', 'fs-tint-strength', 'fs-density',
	'fs-photo-dim', 'fs-pattern-size', 'fs-pattern-strength', 'fs-pattern-ink'
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
		palette: paletteDefault(),
		wallpaper: wallpaperDefault(),
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
		autocollapse: autoCollapseDefault() ? 'on' : 'off',
		tint_strength: String(tintStrengthDefault()),
		density: densityDefault(),
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
	/* top, not sidebar: the bar is what a bare :root paints (head.ut stamps it when uci says
	 * nothing), so it is what "as the theme ships" means */
	applyLayout('top');
	applyMode('auto');
	applyPalette('footstrap');
	applyDensity('normal');
	applyWallpaper('off');
	applyAutoCollapse('off');
	applyRadius(FS_RADIUS_DEFAULT);
	applyTintStrength(FS_TSTR_DEFAULT);
	applyPhotoDim(FS_PDIM_DEFAULT);
	applyPatternSize(FS_PSIZE_DEFAULT);
	applyPatternStrength(FS_PSTR_DEFAULT);
	applyPatternInk('theme');
	/* every colour and surface axis back to "the palette's own" */
	[ applyTint, applyAccent, applyGood, applyWarn, applyDanger,
		applyCard, applyControl, applyBar, applyLine ].forEach((fn) => fn(0));
}

/* ---- the pattern: an SVG the admin uploads, tiled and recoloured ----
 *
 * The bytes come from the admin, never from a third-party host: a theme in a package feed does not
 * reach out at run time.
 *
 * Router-side, like the login photo and for the same reason — a file cannot live in localStorage,
 * and a pattern is something a router wears. The path is a fixed server-side constant matched
 * exactly by the rpcd ACL, so nothing user-controlled reaches a path. It lives under /etc so a
 * package upgrade cannot delete it (keep.d carries it across a sysupgrade), and the served name
 * ends in .svg because uhttpd types a file by extension.
 *
 * How it is made to fit is 15-wallpaper.css's mask, not anything done to the bytes: the file
 * supplies the alpha and the theme the colour, so one upload reads correctly in both modes and
 * under every palette.
 *
 * What is refused: an SVG is a document, not a picture, and while a masked or background image
 * never executes script, the same file fetched from its own URL would. Uploading already needs an
 * authenticated admin session with uci write rights, so this is defence in depth — but the check is
 * cheap and the failure mode is somebody else's browser. */
const PAT_PATH  = '/etc/footstrap/pattern.svg';			/* cgi-upload target; the ACL grants exactly this */
const PAT_SERVE = '/luci-static/footstrap/pattern.svg';	/* the uhttpd symlink to PAT_PATH (uci-defaults) */
const PAT_MAX   = 512 * 1024;							/* a tile that has to reach a router's flash and then every page load */
/* What makes an uploaded SVG unacceptable, decided on the PARSED document and not on its text: a
 * regex over the source guesses at a grammar the browser already implements, and guesses in both
 * directions — a handler pattern also matches an ordinary `only_selected="false"`, while an entity
 * or odd whitespace hides a real handler from it.
 *
 * DOMParser is the parser the file will actually be read by, and parsing is inert: no script runs,
 * no subresource is fetched, no handler is bound. So the questions are exact ones about nodes:
 *
 *   - is it an SVG at all (a parsererror, or a root that is not <svg>, is not an image)
 *   - does it carry an element that executes or embeds (script, foreignObject, iframe, …)
 *   - does it carry a real event-handler attribute — `^on[a-z]+$`
 *   - does any value start a `javascript:` url
 *   - does any href point off this router; `#fragment` and `data:` stay allowed, being how a tile
 *     refers to its own <defs> and embeds a bitmap
 *
 * The check is for the way the file can be reached that a mask does not cover: its own URL, opened
 * directly, same-origin with the session.
 *
 * `animate`/`set` are listed for a second reason as well: they can retarget an attribute at run
 * time (`<set attributename="href" to="javascript:…">`), and a tile that animates repaints a
 * full-viewport layer behind every page. */
const PAT_BAD_TAGS = [ 'script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'animate', 'set' ];

/* null if the parsed document is fine, otherwise the sentence to show. */
function _svgObjection(text) {
	let doc;
	try { doc = new DOMParser().parseFromString(text, 'image/svg+xml'); }
	catch (e) { return _('That file is not an SVG image.', 'footstrap'); }
	const root = doc && doc.documentElement;
	if (!root || doc.querySelector('parsererror') || root.nodeName.toLowerCase() !== 'svg')
		return _('That file is not an SVG image.', 'footstrap');
	const refused = _('That SVG contains script or external references, which this theme will not install.', 'footstrap');
	const els = [ root ].concat([ ...root.querySelectorAll('*') ]);
	for (const el of els) {
		if (PAT_BAD_TAGS.indexOf(el.nodeName.toLowerCase()) >= 0) return refused;
		const attrs = el.attributes || [];
		for (let i = 0; i < attrs.length; i++) {
			const n = attrs[i].name.toLowerCase();
			const v = String(attrs[i].value || '').trim();
			/* a REAL handler is `on` + letters and nothing else; `only_selected` is not one */
			if ((/^on[a-z]+$/).test(n)) return refused;
			if ((/^javascript:/i).test(v)) return refused;
			/* off-router reference. A leading `//` is protocol-relative and just as external. */
			if ((/(?:^|:)href$/).test(n) && (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i).test(v)) return refused;
		}
	}
	return null;
}

/* read the picked file as text so it can be inspected before upload, and so what reaches the
 * router is exactly the bytes that were checked */
function _readText(file) {
	return new Promise((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => resolve(String(fr.result || ''));
		fr.onerror = () => reject(new Error(_('That file could not be read.', 'footstrap')));
		fr.readAsText(file);
	});
}

/* the token the server last saved, validated to the same hex charset head.ut's sanitiser and the
 * pre-paint use. '' = nothing uploaded. */
function currentPattern() {
	const t = sd('pattern');
	return (typeof t === 'string' && BG_TOKEN_RE.test(t)) ? t : '';
}
function patternUrl(tok) { return PAT_SERVE + '?v=' + tok; }

/* set/clear the tile URL live. This only supplies the url(); whether it PAINTS is the Wallpaper
 * axis (data-wallpaper="pattern"). */
function _applyPattern(tok) {
	const root = document.documentElement;
	if (tok) root.style.setProperty('--fs-pattern-url', 'url("' + patternUrl(tok) + '")');
	else root.style.removeProperty('--fs-pattern-url');
	setSD('pattern', tok || '');
}

/* Upload flow, the login photo's exactly: validate -> multipart POST to cgi-upload -> take the md5
 * `checksum` as the cache-bust token -> save it in uci -> apply live. No canvas step, which is what
 * strips a photo's EXIF: an SVG redrawn to a canvas comes back a raster. The text check above
 * stands in for it. */
function uploadPattern(file) {
	if (!file) return Promise.reject(new Error(_('Please choose an SVG file.', 'footstrap')));
	const isSvg = (/(^image\/svg\+xml$)/i).test(file.type || '') || (/\.svg$/i).test(file.name || '');
	if (!isSvg) return Promise.reject(new Error(_('Please choose an SVG file.', 'footstrap')));
	if (file.size > PAT_MAX) return Promise.reject(new Error(_('That file is too large.', 'footstrap')));
	return _readText(file).then((text) => {
		const objection = _svgObjection(text);
		if (objection) return Promise.reject(new Error(objection));
		const fd = new FormData();
		fd.append('sessionid', rpc.getSessionID());
		fd.append('filename', PAT_PATH);
		fd.append('filedata', new Blob([ text ], { type: 'image/svg+xml' }), 'pattern.svg');
		return fetch(L.env.cgi_base + '/cgi-upload', { method: 'POST', body: fd, credentials: 'same-origin' })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
	}).then((reply) => {
		if (!reply || reply.failure)
			return Promise.reject(new Error((reply && reply.failure && reply.failure[1]) || _('Upload failed.', 'footstrap')));
		const tok = String(reply.checksum || '').toLowerCase();
		if (!BG_TOKEN_RE.test(tok))
			return Promise.reject(new Error(_('Upload failed.', 'footstrap')));
		/* cgi-upload writes 0600 and uhttpd refuses to serve a file that is not world-readable
		 * (0600 -> 403, 0644 -> 200); _chmodServeable checks the command's exit status, not just
		 * the ubus call's */
		return _chmodServeable(PAT_PATH)
			/* uci gets the token and nothing else: putting a file on the router is not the same act
			 * as making every other device paint it */
			.then(() => _uciSet('footstrap', 'settings', { pattern: tok }))
			.then(() => _uciCommit('footstrap'))
			.catch((e) => _rollbackUpload(PAT_PATH, e))
			.then(() => {
				/* switch this browser onto it: the ordinary axis path, localStorage only */
				applyWallpaper('pattern');
				_applyPattern(tok);
				return tok;
			});
	});
}

/* Remove: delete the file, blank the token (uci `set` to '', not delete — the scoped ACL grants
 * set/commit only), clear the tile live. */
function removePattern() {
	return _removeServed(PAT_PATH)
		.then(() => _uciSet('footstrap', 'settings', { pattern: '' }))
		.then(() => _uciCommit('footstrap'))
		.then(() => { _applyPattern(''); });
}

/* ---- login/page background upload: router-side, and deliberately not an axis ----
 * The other axes are per-browser with a router default; this one has no browser layer. An admin
 * uploads an image once, it becomes the router-wide background for every device and shows
 * pre-login, so it is absent from AXIS_KEYS, snapshotAxes() and matchesSavedDefault() — it must not
 * move the Save button — and needs no factory, so tools/axes.mjs never sees it.
 *
 * The image is a served file, uhttpd having no gzip to make inlining it in every <head> viable;
 * only its cache-bust token lives in uci -> window.__fsSD -> the url() head.ut stamps. The path is
 * a fixed server-side constant matched exactly by the rpcd ACL, so nothing user-controlled reaches
 * a path. */
const BG_PATH  = '/etc/footstrap/login-bg';		/* cgi-upload target; the ACL grants exactly this */
const BG_SERVE = '/luci-static/footstrap/bg';	/* the uhttpd symlink to BG_PATH (uci-defaults) */
const BG_MAX_SIDE = 1920;						/* cap the longest side — a router serves this off flash with no gzip, and 1080p covers the screens LuCI is actually admin'd from; still crisp full-screen, far fewer flash/wire bytes */
const BG_QUALITY  = 0.9;
const BG_SRC_MAX  = 25 * 1024 * 1024;			/* refuse a source this big before decoding (decode-bomb guard) */
/* No `reject: true` here, unlike every other declare in this file: with it, "the file was already
 * gone" and "the router refused to delete it" arrive as the same Error. Without it the promise
 * resolves with the ubus status as a number, which this code can branch on. */
const _fileRemoveStatus = rpc.declare({ object: 'file', method: 'remove', params: [ 'path' ] });

/* Delete, treating "not found" as done. Anything else is a real refusal (a read-only or full
 * overlay, an immutable flag, a path replaced by a directory) and must not be reported as a
 * removal: the file stays on flash and stays fetchable WITHOUT a session through the /www symlink,
 * which is what an admin removing a background believes they have stopped. */
const UBUS_NOT_FOUND = 4;
function _removeServed(path) {
	return _fileRemoveStatus(path).then((res) => {
		const code = (typeof res === 'number') ? res : parseInt(res, 10);
		if (code === 0 || code === UBUS_NOT_FOUND || isNaN(code)) return;
		return Promise.reject(new Error(
			_('The router refused to delete the file (ubus status %d).', 'footstrap').format(code)));
	});
}
/* cgi-upload writes the file 0600 and uhttpd refuses to serve a file that is not world-readable
 * (0600 -> 403, 0644 -> 200), so make it 0644 first. The rpcd ACL grants exec on exactly two fixed
 * commands — chmod 644 on the two files this module uploads — with no caller-controlled
 * argument. */
const _fileExec = rpc.declare({ object: 'file', method: 'exec', params: [ 'command', 'params' ], reject: true });
/* …and the ubus status is only half of it: `file.exec` reports the command's exit status inside the
 * payload, so a chmod that ran and failed still comes back as a successful call — and the upload
 * then reports success for a file uhttpd will 403, leaving every device a scrim over nothing. */
function _chmodServeable(path) {
	return _fileExec('/bin/chmod', [ '644', path ]).then((res) => {
		if (res && res.code)
			throw new Error(_('Upload failed.', 'footstrap') + ' (chmod ' + res.code + ')');
		return res;
	});
}
/* the cache-bust token charset, an md5/sha hex string. One copy here; head.ut's ucode sanitiser
 * and the pre-paint inline script keep their own identical copies unavoidably, running before this
 * module — see the axes contract in head.ut. */
const BG_TOKEN_RE = /^[a-f0-9]{6,64}$/;

/* the token the server last saved, validated to the same hex charset head.ut's sanitiser and
 * pre-paint use, so the Appearance tab can build a cache-busted preview src. '' = none. */
function currentLoginBg() {
	const t = sd('login_bg');
	return (typeof t === 'string' && BG_TOKEN_RE.test(t)) ? t : '';
}
function loginBgUrl(tok) { return BG_SERVE + '?v=' + tok; }

/* _applyPattern's twin for the photo; data-wallpaper="file" decides whether it paints. */
function _applyLoginBg(tok) {
	const root = document.documentElement;
	if (tok) root.style.setProperty('--fs-login-bg-url', "url('" + loginBgUrl(tok) + "')");
	else root.style.removeProperty('--fs-login-bg-url');
	setSD('login_bg', tok || '');
}

/* Re-encode the picked image to a bounded JPEG on a canvas. A security step as much as a size one:
 * the canvas keeps only the decoded pixels, so EXIF and any bytes appended past the image are
 * dropped and the uploaded blob is exactly what the browser drew.
 *
 * The whole body is guarded, because a throw inside an event handler does not reject the promise it
 * sits in — it escapes as an uncaught error and leaves the promise pending forever. Two real ways
 * out of `onload`: `getContext('2d')` answers null when the canvas cannot be backed, and
 * drawImage/toBlob can throw. A pending promise leaves the caller's "Uploading…" button disabled
 * and lying until the form is rebuilt on a later arrival at the page. */
function _downscale(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			try {
				const scale = Math.min(1, BG_MAX_SIDE / Math.max(img.width, img.height));
				const w = Math.max(1, Math.round(img.width * scale));
				const h = Math.max(1, Math.round(img.height * scale));
				const cv = document.createElement('canvas');
				cv.width = w; cv.height = h;
				const ctx = cv.getContext('2d');
				if (!ctx) throw new Error('no 2d context');
				ctx.drawImage(img, 0, 0, w, h);
				cv.toBlob((blob) => blob ? resolve(blob) : reject(new Error(_('Could not process the image.', 'footstrap'))),
					'image/jpeg', BG_QUALITY);
			} catch (e) { reject(new Error(_('Could not process the image.', 'footstrap'))); }
		};
		img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(_('That file is not a readable image.', 'footstrap'))); };
		img.src = url;
	});
}

/* An upload that has landed but could not be RECORDED must not stay on the router. The two paths
 * below write the file first and the token second, and the second half can fail on its own (no
 * `settings` section, a narrowed uci ACL, ubus busy) — the image then sits at mode 0644 and is
 * served to anyone through the /www symlink, which does not depend on the token, while Remove is
 * hidden precisely because the token is empty. Roll the file back and report the failure that
 * started it; a rollback that itself fails is appended, because the admin has to know the file is
 * there. */
function _rollbackUpload(path, cause) {
	return _removeServed(path).then(
		() => Promise.reject(cause),
		() => Promise.reject(new Error(String((cause && cause.message) || cause) + ' — '
			+ _('the uploaded file could not be removed either; it is still on the router.', 'footstrap')))
	);
}

/* Upload flow: validate -> canvas re-encode -> multipart POST to cgi-upload (the endpoint
 * L.ui.uploadFile uses; session in the `sessionid` field, path in `filename`, bytes in `filedata`)
 * -> take the md5 `checksum` as the cache-bust token -> save it in uci -> apply live. cgi-upload
 * authorises the write against the ACL's `file` grant for BG_PATH. */
function uploadLoginBg(file) {
	if (!file || !(/^image\//).test(file.type || ''))
		return Promise.reject(new Error(_('Please choose an image file.', 'footstrap')));
	if (file.size > BG_SRC_MAX)
		return Promise.reject(new Error(_('That image is too large.', 'footstrap')));
	return _downscale(file).then((blob) => {
		const fd = new FormData();
		fd.append('sessionid', rpc.getSessionID());
		fd.append('filename', BG_PATH);
		fd.append('filedata', blob, 'login-bg');
		return fetch(L.env.cgi_base + '/cgi-upload', { method: 'POST', body: fd, credentials: 'same-origin' })
			.then((r) => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
	}).then((reply) => {
		/* cgi-upload answers { name, size, checksum, sha256sum } or { failure: [code, msg] } */
		if (!reply || reply.failure)
			return Promise.reject(new Error((reply && reply.failure && reply.failure[1]) || _('Upload failed.', 'footstrap')));
		const tok = String(reply.checksum || '').toLowerCase();
		if (!BG_TOKEN_RE.test(tok))
			return Promise.reject(new Error(_('Upload failed.', 'footstrap')));
		/* make the just-written 0600 file world-readable, or uhttpd 403s it (see _fileExec) */
		return _chmodServeable(BG_PATH)
			/* uci gets the token and nothing else: which browsers paint it is the wallpaper axis,
			 * and writing `wallpaper:file` here would re-point every other device's default from
			 * one upload */
			.then(() => _uciSet('footstrap', 'settings', { login_bg: tok }))
			.then(() => _uciCommit('footstrap'))
			.catch((e) => _rollbackUpload(BG_PATH, e))
			.then(() => {
				/* switch this browser to the photo: the ordinary axis path, localStorage only */
				applyWallpaper('file');
				_applyLoginBg(tok);
				return tok;
			});
	});
}

/* removePattern's twin for the photo. */
function removeLoginBg() {
	return _removeServed(BG_PATH)
		.then(() => _uciSet('footstrap', 'settings', { login_bg: '' }))
		.then(() => _uciCommit('footstrap'))
		.then(() => { _applyLoginBg(''); });
}


return baseclass.extend({
	lsGet, lsSet, lsDel, lsGetArr, storageBroken,

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

	currentLoginBg, loginBgUrl, uploadLoginBg, removeLoginBg,
	currentPattern, patternUrl, uploadPattern, removePattern,
	currentPatternSize, applyPatternSize,
	currentPatternStrength, applyPatternStrength,
	currentPatternInk, applyPatternInk,
	currentTintStrength, applyTintStrength,
	currentPhotoDim, applyPhotoDim,

	saveAsDefault, resetToSaved, resetToBuiltin, matchesSavedDefault
});

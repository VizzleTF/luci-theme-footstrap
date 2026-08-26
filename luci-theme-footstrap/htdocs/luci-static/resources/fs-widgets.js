'use strict';
'require baseclass';

/* The theme's UI primitives: the inline-SVG wrapper, the disclosure pair the menu is built on, and
 * the colour control behind the Appearance tab's colour axes. Nothing here knows what it is used
 * for, so the menu and the Appearance tab share it without requiring each other. */

/* The one inline-SVG wrapper: every theme icon is a 24x24 stroked outline differing only in path
 * data, so stroke width and linecaps are stated once and cannot drift between call sites.
 * aria-hidden, because each icon sits beside its own label — an unlabelled <svg> is otherwise
 * announced as a graphic in its own right. */
function svgIcon(body, cls) {
	return '<svg class="' + (cls || 'fs-ico') + '" aria-hidden="true" viewBox="0 0 24 24" fill="none" '
		+ 'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
		+ body + '</svg>';
}

/* ---- disclosure primitives, shared by the menu ----
 * A section header is a W3C-APG disclosure control: an <a role="button"> owning a panel it shows
 * and hides. The trigger selector stays a parameter. */

/* Every open and close goes through here so `.open` and aria-expanded cannot disagree: `.open`
 * alone tells a sighted user everything and a screen-reader user nothing. `linkSel` is the
 * layout's trigger (the menu's `:scope > a`). */
function setOpen(li, on, linkSel) {
	li.classList.toggle('open', on);
	li.querySelector(linkSel)?.setAttribute('aria-expanded', on ? 'true' : 'false');
}

/* An <a role="button"> is given Enter by the browser but not Space, and a disclosure control has
 * to answer both. */
function wireSpaceKey(link) {
	link.addEventListener('keydown', (ev) => {
		if (ev.key !== ' ' && ev.key !== 'Spacebar') return;
		ev.preventDefault();
		link.click();
	});
}

/* A click outside closes; WCAG 2.2 SC 1.4.13 also requires a hover/focus panel to be dismissible
 * from the keyboard, with focus handed back to the trigger. `when` restricts both to flyout mode,
 * where `.open` means "popup panel" — an unfolded accordion must not close on an outside click. */
function wireDismiss(opts) {
	const active = () => (opts.when ? opts.when() : true);

	document.addEventListener('click', (ev) => {
		/* `closest?.`: a document-level listener sees any dispatched click, including one whose
		 * target is not an Element and has no closest(). The throw would kill this listener for
		 * the rest of the session. */
		if (active() && !ev.target.closest?.(opts.inside))
			opts.close();
	});

	document.addEventListener('keydown', (ev) => {
		if (ev.key !== 'Escape' || !active()) return;
		const open = document.querySelector(opts.open);
		if (!open) return;
		const trigger = open.querySelector(opts.trigger);
		opts.close();
		trigger?.focus();
	});
}

/* The Appearance page draws enums with `ui.Select` and numbers with `ui.RangeSlider`: LuCI widgets
 * are present on every supported release, already dressed by this stylesheet (`select` in
 * base/30-forms.css, `.cbi-range-slider` in theme/60-inputs.css), and cannot be got wrong here.
 * Do not re-add a segmented control or range wrapper of our own. */

/* ---- colour: reading what the page is actually painted ----
 *
 * Two questions no stored value answers: what colour a role is right now (the palette's own while
 * the axis is off — there is deliberately no copy of the palette in JS), and what contrast the
 * user's colour lands at. Both are about the computed cascade, so both are asked of the browser.
 *
 * `getComputedStyle(root).getPropertyValue('--fs-accent')` answers neither: a custom property
 * computes to the token stream after var() substitution, so `oklch(from … l c H)` comes back
 * unevaluated. Setting the expression as a real `color` and reading it back makes the browser
 * resolve it — relative colour, color-mix() and the tint's calc() are what the theme is made of.
 * One hidden probe is reused; an element per query would thrash layout on every slider drag. */
let _probe = null;
function probeColor(expr) {
	if (!_probe) {
		/* Off-screen rather than display:none, so the reading does not depend on a display:none
		 * element computing `color` in every engine. It has no text and no size, so it paints
		 * nothing.
		 *
		 * Every declaration is !important (issue #19): this is an unmarked element in a document
		 * shared with `luci-app-*`, and an app's unlayered `span { color: … !important }` outranks
		 * a layer and a plain inline style alike. A probe that loses its own colour reports the
		 * app's, which then becomes the admin's saved axis on the next confirm. */
		_probe = E('span', { 'aria-hidden': 'true' });
		_probe.style.cssText = 'position:fixed!important;left:-9999px!important;top:0!important;'
			+ 'width:0!important;height:0!important;overflow:hidden!important;'
			+ 'pointer-events:none!important;';
		document.body.appendChild(_probe);
	}
	/* cleared first: an expression the engine rejects leaves the previous colour standing, which
	 * would report a stale answer as a fresh one */
	_probe.style.setProperty('color', '');
	_probe.style.setProperty('color', expr, 'important');
	return getComputedStyle(_probe).color;
}

/* A computed colour -> [r,g,b] 0..255, or null. Rasterised, not parsed: a computed `color` keeps
 * the space it was authored in, so `oklch(0.54 0.19 300)` would parse as three numbers in the
 * wrong units and produce a colour nobody chose — measured: #010078, graded "Too faint to read",
 * in the hex field, the swatch and the contrast readout alike. Painting one pixel makes the engine
 * convert instead (tools/export-tier.mjs uses the same method). The string parse remains only as
 * the fallback for an engine with no 2D context, where only the legacy `rgb()`/`color(srgb …)`
 * forms can appear. */
let _cx = null;
function rasterCtx() {
	if (_cx !== null) return _cx;
	try {
		const cv = document.createElement('canvas');
		cv.width = cv.height = 1;
		_cx = cv.getContext('2d', { willReadFrequently: true }) || false;
	} catch (e) { _cx = false; }
	return _cx;
}
function parseColor(s) {
	const str = String(s || '');
	const cx = rasterCtx();
	if (cx) {
		/* fillStyle keeps the last value it could parse, so a colour this engine rejects would
		 * report the previous one as a fresh reading — the trap probeColor() clears for */
		cx.fillStyle = '#000';
		cx.fillStyle = str;
		cx.clearRect(0, 0, 1, 1);
		cx.fillRect(0, 0, 1, 1);
		const d = cx.getImageData(0, 0, 1, 1).data;
		if (d[3] === 255) return [ d[0], d[1], d[2] ];
		/* translucent: composite over nothing is meaningless for a readout, so fall through */
	}
	const nums = str.match(/[\d.]+/g);
	if (!nums || nums.length < 3) return null;
	const unit = (/^color\(/i).test(str) ? 255 : 1;
	return nums.slice(0, 3).map((n) => Math.max(0, Math.min(255, parseFloat(n) * unit)));
}

/* WCAG 2.x relative luminance and contrast ratio, on sRGB. Used only to report: the theme states
 * what a colour costs and leaves the choice with the user, never correcting it (03-palettes.css
 * derives the ink over a fill, which is a different question). */
function luminance(rgb) {
	const c = rgb.map((v) => {
		const x = v / 255;
		return (x <= .03928) ? (x / 12.92) : Math.pow((x + .055) / 1.055, 2.4);
	});
	return (.2126 * c[0]) + (.7152 * c[1]) + (.0722 * c[2]);
}
function contrastRatio(fgExpr, bgExpr) {
	const fg = parseColor(probeColor(fgExpr)), bg = parseColor(probeColor(bgExpr));
	if (!fg || !bg) return null;
	const a = luminance(fg), b = luminance(bg);
	return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

/* #rrggbb, because <input type="color"> accepts nothing else. An unparseable colour becomes black
 * rather than throwing: the text field beside the swatch is the authoritative one. */
function toHex(s) {
	const rgb = parseColor(s) || [ 0, 0, 0 ];
	return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/* One colour axis: a native swatch, a hex field and a button back to the palette's own colour.
 * Reports through onPick as a hex string, or 0 for "back to the palette", either of which the
 * caller hands straight to fs-prefs.js's colorAxis.
 *
 * There is no hue slider and one is not coming back: rotating a hue keeps the palette's chroma,
 * so no angle of it reaches a grey. The axis still accepts a stored hue (1–360) and the stylesheet
 * still rotates the palette by one, so a saved value goes on working.
 *
 * `opts.probe` is the live token the effective colour is read back from, so the field shows the
 * palette's colour while the axis is off without a copy of the palette in JS. `opts.contrast` is
 * the pair whose ratio is reported under the row. */
function colorControl(current, onPick, label, opts) {
	const o = opts || {};

	/* type=color leaves the picker to the browser: accessible without reimplementing a colour
	 * wheel, and native on a phone. The text field beside it takes a pasted hex and is the
	 * fallback where the browser draws no picker. */
	const swatch = E('input', { 'type': 'color', 'class': 'fs-color-swatch', 'aria-label': label || '' });
	const field = E('input', {
		'type': 'text', 'class': 'fs-color-hex', 'spellcheck': 'false', 'autocomplete': 'off',
		'inputmode': 'text', 'maxlength': '7', 'aria-label': label || ''
	});
	const clear = E('button', { 'class': 'btn fs-color-clear', 'type': 'button' }, [ _('Palette', 'footstrap') ]);
	const ratio = o.contrast ? E('div', { 'class': 'cbi-value-description fs-color-contrast' }) : null;

	/* what the axis holds right now: the page can change it behind this control (a preset, Reset
	 * to default), so a private copy would go stale. `current` is only the build-time value. */
	const currentOf = o.read || (() => current);

	/* Repaint everything that mirrors the axis. Called after every edit, and through the returned
	 * refresh() after a preset, palette switch or dark-mode flip — each changes what the palette's
	 * own colour is while this axis stays off. */
	function reflect(v) {
		const live = probeColor(o.probe);
		const hex = (typeof v === 'string') ? v : toHex(live);
		swatch.value = hex;
		/* do not fight the user mid-edit: `#0` is a legal prefix, and overwriting the field on
		 * every keystroke made the input impossible to type into */
		if (document.activeElement !== field) field.value = hex;
		/* the button back to the palette doubles as the axis state readout: enabled means the axis
		 * holds a colour of its own, disabled means the field shows the palette's */
		clear.disabled = !v;
		if (!ratio) return;
		const r = contrastRatio(o.contrast.fg, o.contrast.bg);
		if (r === null) { ratio.textContent = ''; ratio.removeAttribute('title'); return; }
		/* The readout states what the ratio means; the number itself stays in the title.
		 * Thresholds are WCAG AA: 4.5:1 for body text, 3:1 for large text and for a UI shape, so a
		 * hairline is graded on the second (`kind: 'shape'`) and warns rather than fails — a faint
		 * border is a legitimate choice.
		 *
		 * Class names are written out whole: tools/fs-orphans.mjs sweeps dead CSS by matching
		 * fs-* tokens in the source, and a concatenated name is invisible to it. */
		const where = o.contrast.label;
		const grade = (o.contrast.kind === 'shape')
			? ((r >= 3)
				? { cls: 'fs-contrast-aa', text: _('Clearly visible %s', 'footstrap').format(where) }
				: { cls: 'fs-contrast-aa-large', text: _('Barely visible %s', 'footstrap').format(where) })
			: (r >= 4.5)
				? { cls: 'fs-contrast-aa', text: _('Easy to read %s', 'footstrap').format(where) }
				: (r >= 3)
					? { cls: 'fs-contrast-aa-large', text: _('Hard to read %s — large text only', 'footstrap').format(where) }
					: { cls: 'fs-contrast-low', text: _('Too faint to read %s', 'footstrap').format(where) };
		ratio.className = 'fs-color-contrast ' + grade.cls;
		ratio.textContent = grade.text;
		ratio.title = _('Contrast %s:1 (WCAG AA wants %s:1 here)', 'footstrap')
			.format(r.toFixed(1), (o.contrast.kind === 'shape') ? '3' : '4.5');
	}

	const pick = (v) => { onPick(v); reflect(v); };

	swatch.addEventListener('input', () => pick(swatch.value.toLowerCase()));
	/* commit on blur and Enter, not per keystroke: a half-typed `#0096` would repaint the page
	 * under the cursor. An unparseable value snaps back to what the axis holds, so the field
	 * cannot claim a colour the page is not painted in. */
	const commit = () => {
		const v = field.value.trim().toLowerCase();
		if ((/^#[0-9a-f]{6}$/).test(v)) pick(v);
		else reflect(currentOf());
	};
	field.addEventListener('blur', commit);
	field.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } });
	clear.addEventListener('click', () => pick(0));

	const wrap = E('div', { 'class': 'fs-colorctl' + (o.cls ? ' ' + o.cls : '') }, [
		E('div', { 'class': 'fs-color-row' }, [ swatch, field, clear ])
	].concat(ratio ? [ ratio ] : []));
	/* the caller decides when this runs: probeColor() needs the document, and this control is not
	 * in it yet */
	wrap.fsRefresh = () => reflect(currentOf());
	return wrap;
}

return baseclass.extend({
	svgIcon,
	setOpen,
	wireSpaceKey,
	wireDismiss,
	colorControl,
	probeColor,
	toHex
});

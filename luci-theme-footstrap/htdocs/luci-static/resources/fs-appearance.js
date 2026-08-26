'use strict';
'require baseclass';
'require ui';
'require dom';
'require fs-prefs as prefs';
'require fs-widgets as widgets';
'require fs-version as ver';

/* The Appearance controls: the DOM that presents the axes. It owns no preference — fs-prefs.js
 * holds the axes and fs-version.js the version string; this file is the form they are shown in.
 *
 * It is a tab on System -> System, beside General Settings / Logging / Time Synchronization /
 * Language and Style. Twenty-one axes, nine of them with a colour field, a swatch and a contrast
 * readout, do not fit a floating popover that has to trap Tab and stay inside a 320px column, and
 * keeping both containers would render every axis twice.
 *
 * The form is appended by a MutationObserver rather than by a route of its own, the same boundary
 * fs-overview.js sits on: a theme may not own a dispatcher node, because the node outlives the
 * theme that registered it and the menu would keep an entry whose view is gone. So the theme owns
 * no menu.d and no view — it watches for the stock page, adds one section and removes nothing.
 *
 * The version line makes no request and must not grow one: which version is INSTALLED is what this
 * page answers, and which is available is the package manager's question. */

/* Build the whole form. Returns a promise for one element wire() appends to the stock page.
 *
 * Everything applies immediately and there is nothing to save: every axis is this browser's, in
 * localStorage, and the page repaints under the control as it moves. Only "Save as default" writes
 * anything, pushing the current look to the ROUTER for other browsers. That distinction is the
 * model (docs/design-system.md), and why this page has no Save/Reset footer of LuCI's own. */
function render() {
	/* build() runs inside the promise, not as its argument: `Promise.resolve(build())` evaluates it
	 * synchronously, so a throw unwinds out of render() before mount() can attach .catch/.finally
	 * and leaves _building set for the life of the document — the tab then never builds again and
	 * nothing is logged. */
	return Promise.resolve().then(build);
}

function build() {
	/* every saved axis re-checks the Save button after applying, so it greys the moment this
	 * browser matches the saved default and un-greys when it diverges. Wrapped around the appliers
	 * because the controls call them directly and have no other seam back here. */
	const bump = (fn) => (v) => { fn(v); refreshSave(); };

	/* Every colour control mirrors something it does not own: the palette's colour while its own
	 * axis is off, and the contrast that colour lands at. A palette switch or dark-mode flip moves
	 * all of it under controls nobody touched, so they refresh together. */
	const colourCtls = [];
	const refreshColours = () => colourCtls.forEach((c) => c.fsRefresh());
	/* wrap an applier so the colour readouts follow it: mode and palette change what every axis is
	 * measured against */
	const repaint = (fn) => (v) => { fn(v); refreshColours(); };

	/* One captioned row in LuCI's own shape: `.cbi-value` > `label.cbi-value-title` +
	 * `.cbi-value-field`. Nothing here styles those class names — base/30-forms.css and
	 * theme/60-inputs.css already lay them out — so this page inherits every future fix to the form
	 * layout instead of keeping a private copy. It also puts the row on a shared surface (zone 2,
	 * where an app may win on specificity), which is right for a page inside #view.
	 *
	 * `make` is handed the same label string the caption renders, because every control needs it a
	 * second time as its aria-label; stating it twice is how the visible caption and what a screen
	 * reader announces drift apart. `extra` carries rows with more than a control, `opts.cls` marks
	 * the rows CSS has to single out. */
	const group = (label, make, opts) => {
		const o = opts || {};
		return E('div', { 'class': 'cbi-value' + (o.cls ? ' ' + o.cls : '') }, [
			E('label', { 'class': 'cbi-value-title' }, [ label ]),
			E('div', { 'class': 'cbi-value-field' }, [ make(label) ].concat(o.extra || []))
		]);
	};

	/* ---- the controls are LuCI's own ----
	 *
	 * Every enum axis is a `ui.Select` and every number a `ui.RangeSlider`: the widgets the other
	 * tabs are built from, already dressed by this stylesheet (`select` in base/30-forms.css,
	 * `.cbi-range-slider` in theme/60-inputs.css). Both exist on every release this theme supports
	 * — checked against openwrt-24.10, since `ui.RangeSlider` is the one that did not exist further
	 * back.
	 *
	 * Listen for `widget-change` from UIElement, not for an event on the inner element: that is the
	 * seam the widget publishes, and reaching past it ties this to how the widget happens to be
	 * built. RangeSlider also emits `widget-update` while the handle moves, which is what resizes
	 * the page under the drag; the appliers are idempotent, so wiring both costs nothing. */
	const selectCtl = (current, choices, apply, label) => {
		const w = new ui.Select(String(current), choices, { widget: 'select', sort: Object.keys(choices) });
		const node = w.render();
		node.setAttribute('aria-label', label);
		node.addEventListener('widget-change', () => apply(w.getValue()));
		return node;
	};

	const sliderCtl = (current, min, max, apply, label, opts) => {
		const o = opts || {};
		const w = new ui.RangeSlider(String(current), {
			min: min, max: max, step: o.step || 1
		});
		const node = w.render();
		node.setAttribute('aria-label', label);
		const push = () => apply(parseInt(w.getValue(), 10));
		node.addEventListener('widget-update', push);
		node.addEventListener('widget-change', push);
		return node;
	};

	/* one colour axis: `probe` is the live token the control reads the effective colour back from,
	 * `contrast` the pair it reports */
	const colourGroup = (label, axis, probe, contrast, opts) => group(label, (lbl) => {
		const ctl = widgets.colorControl(axis.current(), bump(axis.apply), lbl, {
			probe: probe,
			read: axis.current,
			contrast: contrast,
			cls: (opts && opts.cls) || ''
		});
		colourCtls.push(ctl);
		return ctl;
	}, opts);

	/* Every label here carries the 'footstrap' context (`_(str, ctx)`, key `ctx\1str`). LuCI serves
	 * one merged catalogue — load_catalog() loads every *.<lang>.lmo and a lookup returns the first
	 * archive holding the hash — so a bare msgid is a global name any luci-app may take, and
	 * readdir order picks the winner: the layout toggle rendered "Максимум" on a Russian router
	 * because another catalogue translates "Top" as "maximum" (issue #6). Contexting cannot be
	 * selective. The chrome, the login/notice sentences and the System/Memory/Storage headings are
	 * deliberately bare — inheriting luci-base's translation covers the ~40 languages this theme
	 * has no catalogue for. */

	/* ---- section 1: the shell ---- */
	const shell = [
		group(_('Layout', 'footstrap'), (label) => selectCtl(prefs.currentLayout(), {
			sidebar: _('Sidebar', 'footstrap'),
			top:     _('Top', 'footstrap')
		}, bump(prefs.applyLayout), label)),

		group(_('Theme', 'footstrap'), (label) => selectCtl(prefs.currentMode(), {
			auto:  _('Auto', 'footstrap'),
			light: _('Light', 'footstrap'),
			dark:  _('Dark', 'footstrap')
		}, bump(repaint(prefs.applyMode)), label)),

		group(_('Palette', 'footstrap'), (label) => selectCtl(prefs.currentPalette(), {
			footstrap:  'Footstrap',
			hicontrast: 'Hi-Contrast',
			/* names the OTHER package, luci-theme-bootstrap, whose colours this palette is —
			 * so it is a proper noun and stays untranslated, like the two above it */
			bootstrap:  'Bootstrap',
			/* names the OTHER package again, luci-theme-openwrt-2020, whose colourway this is */
			'2020':     'OpenWrt 2020'
		}, bump(repaint(prefs.applyPalette)), label)),

		group(_('Density', 'footstrap'), (label) => selectCtl(prefs.currentDensity(), {
			compact: _('Compact', 'footstrap'),
			normal:  _('Normal', 'footstrap'),
			large:   _('Large', 'footstrap')
		}, bump(prefs.applyDensity), label)),

		group(_('Rounding', 'footstrap'),
			(label) => sliderCtl(prefs.currentRadius(), 0, 20, bump(prefs.applyRadius), label)),

		/* The top layout has no accordion, so this switch is meaningless there: always built,
		 * hidden by CSS (:root[data-layout="top"] .fs-ap-submenus). Do not wrap it in an
		 * `if (currentLayout() !== 'top')` — the page is built once, so the branch would freeze
		 * the control to the layout the page loaded in while CSS morphs the chrome live. */
		group(_('Submenus', 'footstrap'), (label) => selectCtl(
			prefs.currentAutoCollapse() ? 'on' : 'off', {
				off: _('Keep open', 'footstrap'),
				on:  _('Auto-collapse', 'footstrap')
			}, bump(prefs.applyAutoCollapse), label),
		{ cls: 'fs-ap-submenus' })
	];

	/* ---- section 2: colours ---- */
	const colours = [
		/* the caption says what the axis is for: "Tint" alone reads as decoration, and nobody
		 * would look for the router-identity cue under it */
		colourGroup(_('Tint (router identification)', 'footstrap'), {
			current: prefs.currentTint, apply: prefs.applyTint
		}, 'var(--fs-bg)', {
			/* the canvas is the one axis with no derived ink: its text is --fs-text, a palette
			 * token this axis must not move, so the ratio is reported instead of corrected */
			fg: 'var(--fs-text)', bg: 'var(--fs-bg)', label: _('on the canvas', 'footstrap')
		}, { cls: 'fs-ap-tint' }),

		/* The strength half of the Tint, meaningful only in hue mode: a hex canvas is the colour
		 * asked for, with no chroma of ours to scale. CSS hides it in the other two states.
		 *
		 * Not called "Density": that is the select above, and this string is both the caption and
		 * the aria-label, so a screen reader would announce two rows under one name. */
		group(_('Tint strength', 'footstrap'),
			(label) => sliderCtl(prefs.currentTintStrength(), 0, 200, bump(repaint(prefs.applyTintStrength)), label, {
				step: 5
			}), { cls: 'fs-ap-tint fs-ap-tintstr' }),

		/* recolours the accented controls (buttons/toggles/sliders/focus rings), not the canvas.
		 * Measured as text on a card, the use that fails first: as a fill it carries derived ink,
		 * as a link or status label it carries only itself. It is also what answers #20 ("sometimes
		 * you want grey or black"), taking any #rrggbb — the colour-chip presets that once sat here
		 * are not coming back. */
		colourGroup(_('Accent', 'footstrap'), {
			current: prefs.currentAccent, apply: prefs.applyAccent
		}, 'var(--fs-accent)', {
			fg: 'var(--fs-accent)', bg: 'var(--fs-panel)', label: _('on a card', 'footstrap')
		}),

		colourGroup(_('Good', 'footstrap'), {
			current: prefs.currentGood, apply: prefs.applyGood
		}, 'var(--fs-good)', {
			fg: 'var(--fs-good)', bg: 'var(--fs-panel)', label: _('on a card', 'footstrap')
		}),

		colourGroup(_('Warning', 'footstrap'), {
			current: prefs.currentWarn, apply: prefs.applyWarn
		}, 'var(--fs-warn)', {
			fg: 'var(--fs-warn)', bg: 'var(--fs-panel)', label: _('on a card', 'footstrap')
		}),

		colourGroup(_('Danger', 'footstrap'), {
			current: prefs.currentDanger, apply: prefs.applyDanger
		}, 'var(--fs-danger)', {
			fg: 'var(--fs-danger)', bg: 'var(--fs-panel)', label: _('on a card', 'footstrap')
		})
	];

	/* ---- the surfaces: the sheet the UI is drawn on ----
	 * Cards, inset controls, the chrome bar and the hairlines between them. Body text is read on
	 * each, so each reports --fs-text against itself. No ink is derived here: --fs-text is the
	 * palette's, and moving it would recolour the very thing being measured against.
	 *
	 * The hairline takes the 3:1 UI-component threshold instead — a border is a shape, not a label
	 * — and below that it is decoration, which a hairline is entitled to be, so the readout states
	 * the number and leaves the call to the admin. */
	const surfaces = [
		colourGroup(_('Cards', 'footstrap'), {
			current: prefs.currentCard, apply: prefs.applyCard
		}, 'var(--fs-panel)', {
			fg: 'var(--fs-text)', bg: 'var(--fs-panel)', label: _('on a card', 'footstrap')
		}),

		colourGroup(_('Controls', 'footstrap'), {
			current: prefs.currentControl, apply: prefs.applyControl
		}, 'var(--fs-panel2)', {
			fg: 'var(--fs-text)', bg: 'var(--fs-panel2)', label: _('on a control', 'footstrap')
		}),

		colourGroup(_('Sidebar and bar', 'footstrap'), {
			current: prefs.currentBar, apply: prefs.applyBar
		}, 'var(--fs-bar-bg)', {
			fg: 'var(--fs-text)', bg: 'var(--fs-bar-bg)', label: _('in the sidebar', 'footstrap')
		}),


		colourGroup(_('Borders', 'footstrap'), {
			current: prefs.currentLine, apply: prefs.applyLine
		}, 'var(--fs-border)', {
			fg: 'var(--fs-border)', bg: 'var(--fs-panel)', label: _('on a card', 'footstrap'), kind: 'shape'
		})
	];

	/* ---- section 3: the wallpaper and the rows each value brings ----
	 *
	 * Wallpaper is three-valued: Off, Pattern (an uploaded SVG, tiled and recoloured) and File (an
	 * uploaded photo). The rows a value brings are SIBLINGS of the Wallpaper row, not children of
	 * its field: nesting a `.cbi-value` inside a `.cbi-value-field` puts a second caption column
	 * inside the first, and those controls started 216px right of every other one on the page,
	 * measured on the router. Flat rows hidden as a group is what the stock pages do with a
	 * dependent field.
	 *
	 * The select is the per-browser switch deciding whether to paint an image, so it is what keeps
	 * the Save button honest; Choose/Remove only swap the picture and never touch the axis. The
	 * native file inputs stay hidden — the styled buttons trigger them. */
	const wallpaper = (() => {
		const err = E('div', { 'class': 'fs-ap-err', 'role': 'alert', 'hidden': '' });
		const preview = E('img', { 'class': 'fs-ap-bgprev', 'alt': '', 'hidden': '' });
		/* display:none, not `hidden`: a bare `hidden=""` still renders the native
		 * "Choose File / No file chosen" control */
		const fileInput = E('input', { 'type': 'file', 'accept': 'image/*', 'style': 'display:none' });
		const chooseLabel = _('Choose image', 'footstrap');
		const chooseBtn = E('button', { 'class': 'btn cbi-button', 'type': 'button' }, [ chooseLabel ]);
		const removeBtn = E('button', { 'class': 'btn cbi-button-remove', 'type': 'button', 'hidden': '' }, [ _('Remove', 'footstrap') ]);

		const patErr = E('div', { 'class': 'fs-ap-err', 'role': 'alert', 'hidden': '' });
		const patPreview = E('img', { 'class': 'fs-ap-bgprev', 'alt': '', 'hidden': '' });
		const patInput = E('input', { 'type': 'file', 'accept': 'image/svg+xml,.svg', 'style': 'display:none' });
		const patChooseLabel = _('Choose SVG', 'footstrap');
		const patChoose = E('button', { 'class': 'btn cbi-button', 'type': 'button' }, [ patChooseLabel ]);
		const patRemove = E('button', { 'class': 'btn cbi-button-remove', 'type': 'button', 'hidden': '' }, [ _('Remove', 'footstrap') ]);

		/* Dim: the scrim opacity over the photo. An ordinary per-browser axis — it is in AXIS_KEYS
		 * and snapshotAxes(), so it moves this browser toward or away from the router default and
		 * must be bump()-ed like every other saved axis, or the Save button misreports its own
		 * status. Separate from the Tint strength above. */
		const dimLabel = _('Dim', 'footstrap');
		const scaleLabel = _('Scale', 'footstrap');
		const strengthLabel = _('Strength', 'footstrap');
		const inkLabel = _('Colours', 'footstrap');

		/* The rows the pattern brings. Scale and Strength are live: the appliers write a custom
		 * property, so the tile resizes and fades under the drag. Colours decides whether the
		 * file's own palette is kept or replaced by the theme's — a mask uses the alpha only,
		 * which is right for line art and wrong for artwork that carries its own colours. */
		const patRows = [
			group(_('Pattern', 'footstrap'),
				() => E('div', { 'class': 'fs-ap-bgrow' }, [ patChoose, patRemove ]),
				{ extra: [ patInput, patPreview, patErr ] }),
			group(scaleLabel, (lbl) => sliderCtl(prefs.currentPatternSize(), 40, 1600,
				bump(prefs.applyPatternSize), lbl, { step: 20 })),
			group(strengthLabel, (lbl) => sliderCtl(prefs.currentPatternStrength(), 0, 100,
				bump(prefs.applyPatternStrength), lbl, { step: 5 })),
			group(inkLabel, (lbl) => selectCtl(prefs.currentPatternInk(), {
				theme:    _('Theme', 'footstrap'),
				original: _('As in file', 'footstrap')
			}, bump(prefs.applyPatternInk), lbl))
		];
		/* …and the rows the FILE photo brings. */
		const fileRows = [
			group(_('File', 'footstrap'),
				() => E('div', { 'class': 'fs-ap-bgrow' }, [ chooseBtn, removeBtn ]),
				{ extra: [ fileInput, preview, err ] }),
			group(dimLabel, (lbl) => sliderCtl(prefs.currentPhotoDim(), 0, 100,
				bump(prefs.applyPhotoDim), lbl, { step: 5 }))
		];

		function reflect(tok) {
			if (tok) { preview.src = prefs.loginBgUrl(tok); preview.hidden = false; removeBtn.hidden = false; }
			else { preview.removeAttribute('src'); preview.hidden = true; removeBtn.hidden = true; }
		}
		function reflectPattern(tok) {
			if (tok) { patPreview.src = prefs.patternUrl(tok); patPreview.hidden = false; patRemove.hidden = false; }
			else { patPreview.removeAttribute('src'); patPreview.hidden = true; patRemove.hidden = true; }
		}
		/* `hidden` on the row, which 80-appearance.css restates at a specificity beating
		 * `.cbi-value`'s own display (the UA's bare `[hidden]` rule loses to it). Hidden, not
		 * removed: each row holds a live control, so rebuilding on every switch would freeze it to
		 * the state it was constructed in. */
		function togglePanel(v) {
			patRows.forEach((r) => { r.hidden = (v !== 'pattern'); });
			fileRows.forEach((r) => { r.hidden = (v !== 'file'); });
		}
		reflect(prefs.currentLoginBg());
		reflectPattern(prefs.currentPattern());
		togglePanel(prefs.currentWallpaper());

		const setWallpaper = (v) => { prefs.applyWallpaper(v); refreshSave(); togglePanel(v); refreshColours(); };

		patChoose.addEventListener('click', () => { patErr.hidden = true; patInput.click(); });
		patInput.addEventListener('change', () => {
			const f = patInput.files && patInput.files[0];
			patInput.value = '';	/* so re-picking the same file fires change again */
			if (!f) return;
			patErr.hidden = true; patChoose.disabled = true;
			patChoose.textContent = _('Uploading…', 'footstrap');
			prefs.uploadPattern(f)
				.then((tok) => {
					reflectPattern(tok);
					/* uploadPattern already switched this browser onto the pattern, so the control
					 * must catch up or the page paints the tile while the dropdown reads Off.
					 * `dom.callClassMethod` is how LuCI moves its own widgets from outside;
					 * setWallpaper is then called directly, because a programmatic setValue emits
					 * no `widget-change`. */
					dom.callClassMethod(seg, 'setValue', 'pattern');
					setWallpaper('pattern');
				})
				.catch((e) => { patErr.textContent = String((e && e.message) || e); patErr.hidden = false; })
				.finally(() => { patChoose.disabled = false; patChoose.textContent = patChooseLabel; });
		});
		patRemove.addEventListener('click', () => {
			patErr.hidden = true; patRemove.disabled = true;
			prefs.removePattern()
				.then(() => reflectPattern(''))
				.catch((e) => { patErr.textContent = String((e && e.message) || e); patErr.hidden = false; })
				.finally(() => { patRemove.disabled = false; });
		});

		chooseBtn.addEventListener('click', () => { err.hidden = true; fileInput.click(); });
		fileInput.addEventListener('change', () => {
			const f = fileInput.files && fileInput.files[0];
			fileInput.value = '';	/* so re-picking the same file fires change again */
			if (!f) return;
			err.hidden = true; chooseBtn.disabled = true;
			chooseBtn.textContent = _('Uploading…', 'footstrap');
			prefs.uploadLoginBg(f)
				.then(reflect)
				.catch((e) => { err.textContent = String((e && e.message) || e); err.hidden = false; })
				.finally(() => { chooseBtn.disabled = false; chooseBtn.textContent = chooseLabel; });
		});
		removeBtn.addEventListener('click', () => {
			err.hidden = true; removeBtn.disabled = true;
			prefs.removeLoginBg()
				.then(() => reflect(''))
				.catch((e) => { err.textContent = String((e && e.message) || e); err.hidden = false; })
				.finally(() => { removeBtn.disabled = false; });
		});

		let seg;
		const wallRow = group(_('Wallpaper', 'footstrap'), (label) => {
			seg = selectCtl(prefs.currentWallpaper(), {
				off:     _('Off', 'footstrap'),
				pattern: _('Pattern', 'footstrap'),
				file:    _('File', 'footstrap')
			}, setWallpaper, label);
			return seg;
		});

		return [ wallRow ].concat(patRows, fileRows);
	})();

	/* ---- section 4: the router default and the version ----
	 *
	 * Save the current look as the router-wide default (fs-prefs writes /etc/config/footstrap over
	 * the scoped uci ACL). It does not change this browser — localStorage keeps overriding — so the
	 * saved default only shows on a fresh browser. The two Reset buttons below are the escape
	 * hatches, and they do not land in the same place. */
	const saveBtn = E('button', { 'class': 'btn cbi-button-action', 'type': 'button' }, [ _('Save as default', 'footstrap') ]);
	/* Two resets, because two things sit underneath a browser's tweaks (fs-prefs.js): "Reset to
	 * saved" clears them and lets every axis fall back to whatever the router holds, while "Reset
	 * to default" writes the theme's built-ins explicitly — the only way to say "as the theme
	 * ships" on a router with a saved default of its own. Neither touches
	 * /etc/config/footstrap. */
	const resetSavedBtn = E('button', { 'class': 'btn', 'type': 'button' }, [ _('Reset to saved', 'footstrap') ]);
	/* the stock destructive class, so the button discarding every local tweak is the red one
	 * (theme/55-buttons.css). "Reset to saved" stays neutral: it steps back to the shared state
	 * rather than discarding. */
	const resetBtn = E('button', { 'class': 'btn cbi-button-negative', 'type': 'button' }, [ _('Reset to default', 'footstrap') ]);
	/* Save's only visible failure surface. The realistic failure is the rpc rejecting — an expired
	 * session (403), a missing ACL, ubus down. A DELETED config is not caught: rpcd stages the set
	 * in the session and commit then no-ops without writing the file, returning success (measured
	 * on the router). The package owns that file and the read side falls back to built-in
	 * defaults. */
	const saveErr = E('div', { 'class': 'fs-ap-err', 'role': 'alert', 'hidden': '' });

	/* The Save button is the status: matching disables it, diverging enables it. Called after every
	 * axis change (via bump).
	 *
	 * Unless the browser refuses storage, where the comparison would always be true — nothing was
	 * written, so every current*() reads the router default back however far the page has been
	 * dragged from it. Say so instead, and leave the button enabled: pushing this browser's look to
	 * the router is the one thing that still works. */
	function refreshSave() {
		if (prefs.storageBroken()) {
			saveBtn.disabled = false;
			saveBtn.textContent = _('Save as default', 'footstrap');
			saveErr.textContent = _('This browser is not storing preferences (site data is blocked), so a change here lasts until you reload. Saving as default still works and applies to every browser.', 'footstrap');
			saveErr.hidden = false;
			return;
		}
		const saved = prefs.matchesSavedDefault();
		saveBtn.disabled = saved;
		saveBtn.textContent = saved ? _('Saved as default', 'footstrap') : _('Save as default', 'footstrap');
	}
	saveBtn.addEventListener('click', () => {
		saveBtn.disabled = true;
		saveErr.hidden = true;
		prefs.saveAsDefault()
			.then(() => { saveErr.hidden = true; })
			/* on failure refreshSave re-enables the button so the user can retry; the usual cause
			 * is a stale session, which a reload fixes. The raw rpc error stays in a title
			 * tooltip. */
			.catch((e) => {
				saveErr.textContent = _('Could not save the default. Reload the page and try again.', 'footstrap');
				saveErr.title = String((e && e.message) || e);
				saveErr.hidden = false;
			})
			.finally(refreshSave);
	});
	/* Two-click confirm on both: discarding local tweaks is destructive and a native confirm() is
	 * banned in this UI. Arming one disarms the other, so a primed button cannot be fired by a
	 * click meant for its neighbour. Each reload lands back on this tab — see armReturn(). */
	const armed = new Map();
	function disarm(btn, label) {
		armed.delete(btn);
		btn.textContent = label;
		btn.classList.remove('fs-ap-armed');
	}
	function twoClick(btn, label, run) {
		btn.addEventListener('click', () => {
			if (!armed.has(btn)) {
				[ ...armed.keys() ].forEach((other) => disarm(other, armed.get(other)));
				armed.set(btn, label);
				btn.textContent = _('Confirm reset', 'footstrap');
				btn.classList.add('fs-ap-armed');
				return;
			}
			disarm(btn, label);
			run();
			armReturn();
			location.reload();
		});
	}
	twoClick(resetSavedBtn, _('Reset to saved', 'footstrap'), prefs.resetToSaved);
	twoClick(resetBtn, _('Reset to default', 'footstrap'), prefs.resetToBuiltin);
	refreshSave();	/* correct label and enabled state before the first paint */

	const versionLink = E('a', {
		'class': 'fs-ap-version',
		'href': ver.REPO_URL,
		'target': '_blank',
		/* `noreferrer` alone: it implies noopener, and the theme's other outward links spell it
		 * that way */
		'rel': 'noreferrer'
	}, [ ver.label() ]);

	const defaults = [
		/* the one row whose control is a pair of buttons, each named by its own text, so `make`
		 * ignores the caption rather than re-using it as an aria-label */
		group(_('Router default', 'footstrap'),
			() => E('div', { 'class': 'fs-ap-actrow' }, [ saveBtn, resetSavedBtn, resetBtn ]),
			{ extra: saveErr })
	];


	defaults.push(E('div', { 'class': 'fs-ap-footer' }, [
		E('div', { 'class': 'fs-ap-verrow' }, [ versionLink ])
	]));

	/* not .cbi-section: inside a tab pane that is a card within a card, and the stock tabs put
	 * their rows straight into the pane. These are grouping headings within one pane, styled by
	 * pages/80-appearance.css. */
	const section = (title, rows) => E('div', { 'class': 'fs-ap-section' }, [
		E('div', { 'class': 'fs-ap-head' }, [ E('h4', {}, [ title ]) ])
	].concat(rows));

	/* ---- the folded groups ----
	 * Nine colour fields and an uploader are the widest rows on the page and most admins never
	 * touch them, so each group is a disclosure, closed by default.
	 *
	 * A disclosure and not a switch: a switch answers "is this feature on", and turning it off
	 * would either revert nine colours or change nothing at all. Opening or closing a fold applies,
	 * un-applies and disables nothing.
	 *
	 * W3C APG disclosure pattern, as the menu's sections use: a <button> owning the region,
	 * `aria-expanded` on it and `aria-controls` pointing at the panel. `hidden` on the panel rather
	 * than a class, so a closed group leaves the tab order and the accessibility tree for free.
	 *
	 * The open/closed state is remembered per browser but is not an axis — it changes nothing about
	 * how the page looks — so it is absent from AXIS_KEYS, snapshotAxes() and the pre-paint. */
	let foldSeq = 0;
	function foldable(title, rows, key) {
		const id = 'fs-ap-fold-' + (++foldSeq);
		let open = (prefs.lsGet(key) === 'on');
		const body = E('div', { 'class': 'fs-ap-body', 'id': id }, rows);
		const btn = E('button', {
			'type': 'button', 'class': 'fs-ap-fold', 'aria-expanded': String(open), 'aria-controls': id
		}, [
			E('h4', {}, [ title ]),
			/* the same chevron the overview's card toggles draw: an empty box whose ::after is two
			 * borders rotated 45° (pages/20-overview.css), not a second <svg> to keep in step.
			 * Empty and aria-hidden — the state is the button's aria-expanded, which is also what
			 * CSS rotates it off. */
			E('span', { 'class': 'fs-ap-chev', 'aria-hidden': 'true' })
		]);
		const paint = () => {
			body.hidden = !open;
			btn.setAttribute('aria-expanded', String(open));
		};
		btn.addEventListener('click', () => {
			open = !open;
			prefs.lsSet(key, open ? 'on' : 'off');
			paint();
			/* refreshed on open because the axes below may have moved while it was collapsed;
			 * skipped while closed, where nothing is on screen to be wrong */
			if (open) refreshColours();
		});
		paint();
		return E('div', { 'class': 'fs-ap-section' }, [
			E('div', { 'class': 'fs-ap-head' }, [ btn ]), body
		]);
	}

	/* Colours and Surfaces are one fold: the same job, split into two headings only because a
	 * figure and the sheet it sits on are read differently */
	const page = E('div', { 'class': 'fs-ap' }, [
		section(_('Interface', 'footstrap'), shell),
		foldable(_('Colours', 'footstrap'),
			colours.concat([ E('div', { 'class': 'fs-ap-head fs-ap-sub' }, [ E('h4', {}, [ _('Surfaces', 'footstrap') ]) ]) ], surfaces),
			'fs-ui-colours'),
		foldable(_('Background', 'footstrap'), wallpaper, 'fs-ui-background'),
		section(_('Defaults', 'footstrap'), defaults)
	]);

	/* The first fill, deferred one microtask so the tree above is finished. It does not wait for
	 * the form to be in the document: every readout resolves through widgets.probeColor(), whose
	 * hidden probe is attached to <body>, so a detached form still reads the live palette. */
	Promise.resolve().then(refreshColours);
	return page;
}

/* ---- mounting it on the stock System page ----
 *
 * The same shape as fs-overview.js's: a chrome module is instantiated once per page load, so it
 * notices SPA navigation itself through `body[data-page]`, which the server template and fs-router
 * both stamp with the dispatch path. */
const PAGE = 'admin-system-system';
/* A reset reloads the page, and a reload opens the tab LuCI remembers — never this one, since
 * ui.tabs only knows the tabs it built itself. sessionStorage rather than a URL fragment: the
 * fragment is the stock page's business, and a stale one would re-open this tab on every later
 * visit. The key is read once and removed, so it survives exactly one reload. */
const RETURN_KEY = 'fs-ap-return';
function armReturn() { try { sessionStorage.setItem(RETURN_KEY, '1'); } catch (e) {} }
function takeReturn() {
	try {
		if (sessionStorage.getItem(RETURN_KEY) === null) return false;
		sessionStorage.removeItem(RETURN_KEY);
		return true;
	} catch (e) { return false; }
}
const MARK = 'fs-ap';	/* the built form's class, and how mount() knows it is already there */
/* how long the stock view gets to render its tabs before a missing group counts as a failure */
const TAB_DEADLINE = 5000;
const TAB = 'fs-appearance';	/* the pane's data-tab, which ui.tabs' click handler matches on */

let _routeObserver = null, _viewObserver = null, _observedView = null, _building = false;

function onPage() { return (document.body.getAttribute('data-page') || '') === PAGE; }

function stopWatch() {
	if (_viewObserver) _viewObserver.disconnect();
	_viewObserver = null;
	_observedView = null;
}

/* The stock tab GROUP: the element whose children are the panes, which ui.tabs marks
 * data-initialized when it builds the menu; the menu it inserted is that element's previous
 * sibling. Both are read from the DOM, because a group that is not initialised yet is a page still
 * rendering, not a page without tabs.
 *
 * The flag and the sibling are the whole test. The panes are deliberately not looked for by class:
 * a modern pane carries none — form.js gives it `data-tab` and `data-tab-title`, and
 * `.cbi-tabcontainer` is luci-compat vocabulary — so matching on that silently finds nothing on a
 * page that plainly has tabs.
 *
 * Groups belonging to the page just left are disqualified: the router stamps body[data-page]
 * before the incoming view renders, and #view still holds the outgoing page's DOM at that moment,
 * so mount() would append the form and a clickable "Footstrap" <li> to another page's tab strip:
 * arriving at System -> System from Network -> DHCP that was two builds for one arrival, and the
 * tab sat on the DHCP strip for 66 ms on localhost (an RTT or more on a real router).
 * The incoming view's own group is a fresh element and is not in this set. */
const _staleGroups = new WeakSet();
function disqualifyCurrentGroups() {
	const view = document.getElementById('view');
	if (!view) return;
	for (const g of view.querySelectorAll('[data-initialized="true"]'))
		_staleGroups.add(g);
}

function tabGroup(view) {
	for (const g of view.querySelectorAll('[data-initialized="true"]')) {
		if (_staleGroups.has(g)) continue;
		const menu = g.previousElementSibling;
		if (menu?.classList.contains('cbi-tabmenu'))
			return { group: g, menu };
	}
	return null;
}

/* Append the pane and its tab once the stock view has rendered. LuCI's system.js resolves its own
 * promises before it puts anything in #view, so there is nothing to hook but the DOM — hence the
 * observer, which also covers the view being re-rendered (a Save & Apply redraws the map).
 *
 * The tab is added by hand rather than by calling ui.tabs.initTabGroup again: that returns
 * immediately on a group carrying data-initialized, and clearing the flag to re-run it builds a
 * second menu beside the first and drops the stock tabs' click bindings. One <li>, the same click
 * handler ui.tabs binds to every other tab, and the pane that handler expects.
 *
 * Idempotent through the marker, since the form's own construction is a mutation the observer sees.
 *
 * A map redraw (Save without Apply) rebuilds the group and `ui.tabs` stamps `data-initialized` as
 * an attribute change that can land after the last childList change, so the observer watches that
 * attribute too and a miss schedules retries on a widening delay — otherwise the tab is missing
 * until the next navigation (openwrt/luci#8903). */
const RETRIES = [ 0, 60, 150, 300, 600, 1200 ];
let _retryTimer = 0, _retryAt = 0;
function retryMount() {
	if (_retryTimer) return;
	if (_retryAt >= RETRIES.length) return;
	const delay = RETRIES[_retryAt++];
	_retryTimer = window.setTimeout(() => { _retryTimer = 0; mount(); }, delay);
}

function mount() {
	const view = document.getElementById('view');
	if (!view || !onPage()) return;
	if (view.querySelector('.' + MARK)) { _retryAt = 0; return; }
	if (_building) return;
	const tabs = tabGroup(view);
	if (!tabs) { retryMount(); return; }
	_building = true;
	render()
		.then((form) => {
			/* re-check: render() resolves on a microtask, and the view may have been replaced or
			 * navigated away from meanwhile */
			const v = document.getElementById('view');
			if (!onPage() || !v || v.querySelector('.' + MARK)) return;
			const t = tabGroup(v);
			if (!t) return;
			/* Named after the theme, not after what it does: beside four stock tabs that are all
			 * "what this page configures", a fifth called Appearance would read as another facet
			 * of the router. A proper noun, so deliberately untranslated. */
			const title = 'Footstrap';
			/* data-tab-active is deliberately absent: the stock page opens on whichever tab it
			 * opened on before, and a theme has no business taking that over. The pane's shape is
			 * a stock pane's — `data-tab` + `data-tab-title`, no class. */
			t.group.appendChild(E('div', {
				'data-tab': TAB,
				'data-tab-title': title
			}, [ form ]));
			const link = E('a', { 'href': '#' }, [ title ]);
			link.addEventListener('click', ui.tabs.switchTab.bind(ui.tabs));
			t.menu.appendChild(E('li', { 'class': 'cbi-tab-disabled', 'data-tab': TAB }, [ link ]));
			/* if this load is the one a reset asked for, open on it: clicking the link goes through
			 * ui.tabs' own switchTab, so nothing here reimplements the switch */
			if (takeReturn()) link.click();
		})
		.catch((e) => console.error('footstrap: the Appearance tab failed to build', e))
		.finally(() => { _building = false; });
}

function watch() {
	const view = document.getElementById('view');
	if (_viewObserver && _observedView !== view) stopWatch();
	if (_viewObserver || !view || !onPage()) return;
	_observedView = view;
	_viewObserver = new MutationObserver(mount);
	/* `data-initialized` is the moment the group becomes usable, and it does not always come with
	 * a childList change (see retryMount above) */
	_viewObserver.observe(view, {
		childList: true, subtree: true,
		attributes: true, attributeFilter: [ 'data-initialized' ],
	});
	mount();
	/* A deadline on an otherwise silent failure. tabGroup() reads two private ui.tabs facts — the
	 * `data-initialized` marker and the `cbi-tabmenu` class on the menu — and mount() writes a
	 * third, `cbi-tab-disabled` on the item it appends; one such fact has already moved between
	 * 24.10 and 25.12 (`data-tab-group` was dropped unannounced). If another does, mount() returns
	 * early on every mutation: the stock page renders, nothing throws, and every Appearance axis
	 * is unreachable. */
	window.setTimeout(() => {
		const v = document.getElementById('view');
		if (!onPage() || !v || v.querySelector('.' + MARK) || _building) return;
		/* one last attempt: the complaint below claims ui.tabs changed shape, which is only true
		 * if a fresh look still finds no group */
		_retryAt = 0;
		mount();
		if (v.querySelector('.' + MARK) || _building || tabGroup(v)) return;
		console.error('footstrap: the Appearance tab could not be attached — this page has tabs, but '
			+ 'ui.tabs no longer marks them the way fs-appearance.js looks for. Every Appearance axis '
			+ 'is unreachable until that is updated.');
	}, TAB_DEADLINE);
}

/* called once by menu-footstrap-common's init; everything route-dependent hangs off the data-page
 * observer inside */
function wire() {
	if (_routeObserver || !document.body) return;
	_routeObserver = new MutationObserver(() => {
		/* before deciding anything: whatever is in #view when data-page changes belongs to the
		 * page being left (see _staleGroups) */
		disqualifyCurrentGroups();
		return onPage() ? watch() : stopWatch();
	});
	_routeObserver.observe(document.body, { attributes: true, attributeFilter: [ 'data-page' ] });
	if (onPage()) watch();
}

return baseclass.extend({
	wire,
	render
});

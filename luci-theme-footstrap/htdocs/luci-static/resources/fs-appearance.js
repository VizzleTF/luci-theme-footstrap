'use strict';
'require baseclass';
'require ui';
'require fs-prefs as prefs';
'require fs-widgets as widgets';
'require fs-version as ver';

/* The Appearance CONTROLS: the DOM that presents the axes. It owns no preference — fs-prefs.js
 * holds the axes, fs-version.js the version string; this file is the form they are shown in.
 *
 * WHERE IT LIVES. It used to be a popover hanging off a button in the chrome; it is now a TAB on
 * System -> System (admin/system/system), beside General Settings / Logging / Time Synchronization
 * / Language and Style — the page an admin already opens to set the things that are not network. The axes had outgrown a floating panel — eighteen of them, nine
 * carrying a colour field, a swatch and a contrast readout — and a dialog that has to trap Tab,
 * place itself against a viewport edge and stay inside a 320px column is the wrong container for
 * that. Keeping BOTH would have meant every axis rendered twice, which is the failure this file's
 * own history is made of.
 *
 * It is appended by a MutationObserver rather than by a route of its own, and that is the same
 * boundary fs-overview.js sits on: a THEME may not own a dispatcher node, because a node outlives
 * the theme that registered it — switch to another theme and the menu keeps an entry whose view is
 * gone. So the theme owns no menu.d and no view; it watches for the stock page and adds one
 * section to it, additively, and removes nothing. Off the footstrap theme, or on any other page,
 * nothing runs at all.
 *
 * THERE IS NO UPDATE CHECKER HERE ANY MORE. The theme used to load an optional
 * luci-app-footstrap-updater at runtime and grow an Updates toggle, a "new version" badge and a
 * one-click Update button. It was a workaround for installing from a downloaded file, which the
 * package manager knows nothing about and will never upgrade; the installer adds the package feed
 * now, so `apk upgrade` carries the theme forward with everything else on the router. A theme
 * checking GitHub on a timer to reimplement what the package manager already does was the wrong
 * shape, and it reached the network from a page that has no business doing so. The version line
 * below stays — it costs no request. */

/* ---- the colour presets --------------------------------------------------------------------
 * A starting point, not a fixed set of themes: each one just sets the ACCENT axis, so the very next
 * edit of a colour field takes over from it and the page carries on as normal. That is why they are
 * stored as the axis value they write rather than as a named "current preset" — there is no such
 * state, nothing has to be un-picked, and a preset overwritten is simply a colour.
 *
 * The accent ALONE, deliberately. A preset that also set the canvas tint made a two-axis change from
 * a one-click control, and undoing half of it meant knowing which half had moved; the surfaces and
 * the status colours are on the page for an admin who wants them.
 *
 * `accent: 0` means "the palette's own", which is what makes the first entry a real reset for the
 * colour half of the page without touching layout, density or the wallpaper.
 *
 * The two neutrals are the reason this list exists: "give me a calm grey interface instead of a
 * blue one" is the request the whole feature came from, and the ink over each is derived from its
 * lightness (03-palettes.css), so they stay pressable in both modes.
 *
 * Nothing here sets the status colours: a preset is a LOOK, and good/warn/danger carry MEANING —
 * shipping a preset that quietly repaints "danger" would be exactly the lie the tint axis is
 * careful not to tell. Their axes are on the page for an admin who wants them. */
const PRESETS = [
	{ id: 'palette',  accent: 0 },
	{ id: 'slate',    accent: '#5b6b7f' },
	{ id: 'graphite', accent: '#4b5563' },
	{ id: 'ocean',    accent: '#0284c7' },
	{ id: 'emerald',  accent: '#0f8a5f' },
	{ id: 'violet',   accent: '#7048d4' },
	{ id: 'amber',    accent: '#b45309' },
	{ id: 'crimson',  accent: '#c02a3a' }
];

/* The preset NAMES, resolved inside render() rather than beside the table above: a `_()` at module
 * scope runs when the module is evaluated, which on a full load is before window.TR has been
 * fetched, so every label would be the untranslated msgid. Keyed by the same id, so a preset that
 * loses its label is a missing key rather than a silently blank button. */
function presetLabel(id) {
	return ({
		palette:  _('Palette default', 'footstrap'),
		slate:    _('Slate', 'footstrap'),
		graphite: _('Graphite', 'footstrap'),
		ocean:    _('Ocean', 'footstrap'),
		emerald:  _('Emerald', 'footstrap'),
		violet:   _('Violet', 'footstrap'),
		amber:    _('Amber', 'footstrap'),
		crimson:  _('Crimson', 'footstrap')
	})[id] || id;
}

/* Build the whole form. Returns a promise for one element wire() appends to the stock page.
 *
 * Everything applies IMMEDIATELY — there is no Save button for the axes themselves, because there
 * is nothing to save: every axis is this browser's, in localStorage, and the page repaints under
 * the control as it moves. The one button that writes anything is "Save as default", which pushes
 * the current look to the ROUTER for other browsers. That distinction is the whole model
 * (docs/design-system.md) and it is why this page has no Save/Reset footer of LuCI's own. */
function render() {
	/* still a promise: the view awaits it, and keeping the shape means a future asynchronous step
	 * (or the caller) needs no change. */
	return Promise.resolve(build());
}

function build() {
	/* every saved axis re-checks the Save button after it applies, so the button greys the moment
	 * this browser matches the saved default again and un-greys the moment it diverges. Wrapped
	 * around the appliers because the seg/slider/colour controls call them directly and have no
	 * other seam back to here. refreshSave is a hoisted function declaration; saveBtn it reads is
	 * assigned below, before any of these fire (all are user events). */
	const bump = (fn) => (v) => { fn(v); refreshSave(); };

	/* Every colour control mirrors something it does not own — the PALETTE's colour, while its own
	 * axis is off, and the contrast that colour lands at. A palette switch, a dark-mode flip or a
	 * preset changes all of that under controls nobody touched, so they are refreshed together
	 * rather than each listening for what might have moved. */
	const colourCtls = [];
	const refreshColours = () => colourCtls.forEach((c) => c.fsRefresh());
	/* wrap an applier so the colour readouts follow it: mode and palette change what every axis is
	 * measured against, and a preset changes the axes themselves */
	const repaint = (fn) => (v) => { fn(v); refreshColours(); };

	/* One captioned row: `<div class=fs-ap-group>` + its label + the control. `make` is handed the
	 * SAME label string the caption renders, because every control in here needs it a second time as
	 * its aria-label (segControl/sliderControl/colorControl take it as their last argument) — and
	 * stating it twice is how the visible caption and what a screen reader announces drift apart.
	 * One literal per axis, used by both, with nothing to keep in sync. `extra` is for the rows that
	 * carry more than a control (the Save row's action pair and its error line), `opts.cls` for the
	 * rows CSS has to be able to single out. */
	const group = (label, make, opts) => {
		const o = opts || {};
		return E('div', { 'class': 'fs-ap-group' + (o.cls ? ' ' + o.cls : '') }, [
			E('div', { 'class': 'fs-ap-label' }, [ label ]),
			make(label)
		].concat(o.extra || []));
	};

	/* one colour axis: the shared shape of the rows below. `probe` is the live token the control
	 * reads the effective colour back from, `contrast` the pair it reports. */
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

	/* EVERY LABEL IN HERE CARRIES THE 'footstrap' CONTEXT (`_(str, ctx)`, key `ctx\1str`). LuCI
	 * serves ONE MERGED catalogue — load_catalog() loads every *.<lang>.lmo in
	 * /usr/lib/lua/luci/i18n and a lookup returns the first archive holding the hash — so a msgid is
	 * a GLOBAL name shared with every luci-app, and readdir order picks the winner: the layout
	 * toggle rendered "Максимум" on a Russian router (issue #6), because another catalogue
	 * translates the msgid "Top" as "maximum". Contexting cannot be selective — whatever we leave
	 * bare is a name anyone may take. The chrome and the login/notice sentences are deliberately
	 * bare (inheriting luci-base's translation is a feature in the ~40 languages we have no
	 * catalogue for), as are System/Memory/Storage in fs-overview.js, which MATCH the stock
	 * headings. */

	/* ---- section 1: the shell ---- */
	const shell = [
		group(_('Layout', 'footstrap'), (label) => widgets.segControl(prefs.currentLayout(), [
			{ val: 'sidebar', label: _('Sidebar', 'footstrap') },
			{ val: 'top',     label: _('Top', 'footstrap') }
		], bump(prefs.applyLayout), label)),

		group(_('Theme', 'footstrap'), (label) => widgets.segControl(prefs.currentMode(), [
			{ val: 'auto',  label: _('Auto', 'footstrap') },
			{ val: 'light', label: _('Light', 'footstrap') },
			{ val: 'dark',  label: _('Dark', 'footstrap') }
		], bump(repaint(prefs.applyMode)), label)),

		group(_('Palette', 'footstrap'), (label) => widgets.segControl(prefs.currentPalette(), [
			{ val: 'footstrap',  label: 'Footstrap' },
			{ val: 'hicontrast', label: 'Hi-Contrast' }
		], bump(repaint(prefs.applyPalette)), label)),

		/* Density: how much air the UI uses. Pure token axis — 02-tokens.css multiplies the type and
		 * space ladders, so every size, gap and padding in the theme follows at once. */
		group(_('Density', 'footstrap'), (label) => widgets.segControl(prefs.currentDensity(), [
			{ val: 'compact', label: _('Compact', 'footstrap') },
			{ val: 'normal',  label: _('Normal', 'footstrap') },
			{ val: 'large',   label: _('Large', 'footstrap') }
		], bump(prefs.applyDensity), label)),

		group(_('Rounding', 'footstrap'),
			(label) => widgets.sliderControl(prefs.currentRadius(), 0, 20, bump(prefs.applyRadius), label)),

		/* The top layout has no accordion (its sections are hover dropdowns, already exclusive), so
		 * this switch is meaningless there. ALWAYS BUILT, HIDDEN BY CSS (:root[data-layout="top"]
		 * .fs-ap-submenus). Do NOT put an `if (currentLayout() !== 'top')` around it: the page is
		 * built once, so the branch would freeze the control to the layout the page LOADED in — it
		 * would stay on screen after a switch to the bar and never appear after a switch away from
		 * it. Toggling the layout re-renders nothing; CSS morphs the chrome. */
		group(_('Submenus', 'footstrap'), (label) => widgets.segControl(
			prefs.currentAutoCollapse() ? 'on' : 'off', [
				{ val: 'off', label: _('Keep open', 'footstrap') },
				{ val: 'on',  label: _('Auto-collapse', 'footstrap') }
			], bump(prefs.applyAutoCollapse), label),
		{ cls: 'fs-ap-submenus' })
	];

	/* ---- section 2: colours ---- */
	/* Applying a preset goes through the same appliers a manual edit does, then refreshes the
	 * controls: the axes are the only state, so there is nothing else to reconcile and no "which
	 * preset is active" to get wrong. */
	function applyPreset(p) {
		prefs.applyAccent(p.accent);
		refreshColours();
		refreshSave();
	}
	const presetRow = E('div', { 'class': 'fs-ap-presets' }, PRESETS.map((p) => {
		const name = presetLabel(p.id);
		/* the chip shows the preset's own accent; the palette-default entry has no colour of its own,
		 * so it takes the palette's accent token — which is exactly what picking it produces. The
		 * colour is written TWICE, as the background and as --fs-preset-c, because CSS cannot read
		 * an inline background back to derive readable ink from it (styles/pages/80-appearance.css).
		 * One expression, one source, so the two cannot disagree. */
		const colour = p.accent || 'var(--fs-accent-base)';
		const b = E('button', {
			'class': 'fs-preset', 'type': 'button', 'title': name, 'aria-label': name,
			'style': 'background:' + colour + ';--fs-preset-c:' + colour
		}, [ E('span', { 'class': 'fs-preset-name' }, [ name ]) ]);
		b.addEventListener('click', () => applyPreset(p));
		return b;
	}));

	const colours = [
		/* the caption says what the axis is FOR: "Tint" alone reads as decoration and nobody would
		 * look for the router-identity cue under it. */
		colourGroup(_('Tint (router identification)', 'footstrap'), {
			current: prefs.currentTint, apply: prefs.applyTint
		}, 'var(--fs-bg)', {
			/* the canvas is the one axis with no derived ink: its text is --fs-text, a palette token
			 * this axis must not move, so the ratio is reported instead of corrected */
			fg: 'var(--fs-text)', bg: 'var(--fs-bg)', label: _('on the canvas', 'footstrap')
		}, { cls: 'fs-ap-tint' }),

		/* the STRENGTH half of the Tint — how strong the hue reads. Only meaningful in hue mode: a
		 * hex canvas IS the colour asked for, with no chroma of ours to scale. CSS hides it in the
		 * other two states (no tint at all, or a hex one). */
		/* NOT "Density": that is the UI-density segment above, and this string is both the visible
		 * caption AND the control's aria-label, so two rows would read "Density" and a screen reader
		 * would announce "Density, radio group" and "Density, slider" with nothing to tell them
		 * apart. */
		group(_('Tint strength', 'footstrap'),
			(label) => widgets.sliderControl(prefs.currentTintStrength(), 0, 200, bump(repaint(prefs.applyTintStrength)), label, {
				step: 5,
				fmt: (v) => v + '%'
			}), { cls: 'fs-ap-tint fs-ap-density' }),

		/* recolours the accented CONTROLS (buttons/toggles/sliders/focus rings), not the canvas the
		 * way Tint does. Measured as TEXT on a card, which is the use that fails first: as a fill it
		 * carries derived ink, as a link or a status label it carries only itself. */
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

	/* ---- the SURFACES: the sheet the UI is drawn on ----
	 * Cards, inset controls, the chrome bar and the hairlines between them. Every one of these is a
	 * surface that body text is read ON, so what each reports is --fs-text against itself — the one
	 * measurement that says whether the page is still readable. There is no ink to derive here and
	 * none is: --fs-text is the palette's, and an axis that silently moved it would be recolouring
	 * the very thing it is being measured against.
	 *
	 * The hairline is the exception and takes the 3:1 UI-component threshold rather than the text
	 * one, which is what its readout comparing --fs-border to --fs-panel means: a border is a shape,
	 * not a label, and AA asks 3:1 of it. Below that it is decoration — which a hairline is entitled
	 * to be, so the readout says the number and leaves the call to the admin. */
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

	/* ---- section 3: the wallpaper, with its upload sub-panel ---- */
	/* Wallpaper is THREE-valued: Off, Cats (doodle), File (the uploaded photo). Picking File reveals
	 * the upload sub-panel BELOW the segments — a file input + preview + Remove, shown only in that
	 * mode. The photo BYTES are router-side (fs-prefs uploads them and stores a token in uci); this
	 * seg is the per-browser switch that decides whether to paint them, so it is what keeps the Save
	 * button honest (refreshSave), while Choose/Remove only swap the picture behind whoever is on
	 * File and never touch the axis. The native file input stays hidden — the styled "Choose image"
	 * button triggers it. */
	const wallpaper = group(_('Wallpaper', 'footstrap'), (label) => {
		const err = E('div', { 'class': 'fs-ap-err', 'role': 'alert', 'hidden': '' });
		const preview = E('img', { 'class': 'fs-ap-bgprev', 'alt': '', 'hidden': '' });
		/* display:none, not the `hidden` attribute — a bare `hidden=""` still rendered the native
		 * "Choose File / No file chosen" control; only the styled button below should be visible. */
		const fileInput = E('input', { 'type': 'file', 'accept': 'image/*', 'style': 'display:none' });
		const chooseBtn = E('button', { 'class': 'btn cbi-button', 'type': 'button' }, [ _('Choose image', 'footstrap') ]);
		const removeBtn = E('button', { 'class': 'btn', 'type': 'button', 'hidden': '' }, [ _('Remove', 'footstrap') ]);
		const chooseLabel = _('Choose image', 'footstrap');
		/* Dim: the scrim opacity over the photo. An ORDINARY per-browser axis — it is in AXIS_KEYS
		 * and in snapshotAxes(), so it moves this browser toward or away from the router default and
		 * must therefore be bump()-ed like every other saved axis. It was not, on the strength of a
		 * comment that said it wrote straight to uci: true until "keep every axis per-browser until
		 * Save as default" made it a propAxis and did not reach this file. The symptom is the one
		 * thing the Save button IS — its own status. Separate from the Tint's strength above. */
		const dimLabel = _('Dim', 'footstrap');
		const dim = E('div', { 'class': 'fs-ap-group' }, [
			E('div', { 'class': 'fs-ap-label' }, [ dimLabel ]),
			widgets.sliderControl(prefs.currentPhotoDim(), 0, 100, bump(prefs.applyPhotoDim), dimLabel, {
				step: 5,
				fmt: (v) => v + '%'
			})
		]);
		/* the upload sub-panel: the preview, then Choose image and Remove on ONE row below it
		 * (Remove appears only once an image exists), then the Dim slider */
		const panel = E('div', { 'class': 'fs-ap-bg', 'hidden': '' }, [
			fileInput, preview,
			E('div', { 'class': 'fs-ap-bgrow' }, [ chooseBtn, removeBtn ]),
			dim, err
		]);

		function reflect(tok) {
			if (tok) { preview.src = prefs.loginBgUrl(tok); preview.hidden = false; removeBtn.hidden = false; }
			else { preview.removeAttribute('src'); preview.hidden = true; removeBtn.hidden = true; }
		}
		function togglePanel(v) { panel.hidden = (v !== 'file'); }
		reflect(prefs.currentLoginBg());
		togglePanel(prefs.currentWallpaper());

		const setWallpaper = (v) => { prefs.applyWallpaper(v); refreshSave(); togglePanel(v); refreshColours(); };

		/* The two doodles are NOT in the package (fs-prefs.js says why), so picking one for the first
		 * time is a DOWNLOAD, and a download is something to be asked about rather than started: the
		 * bytes come from GitHub over the admin's own connection, and an admin on a metered link or
		 * an air-gapped bench is entitled to say no. The dialog states the size before anything is
		 * fetched, which is the whole point of asking.
		 *
		 * The axis is applied only AFTER the file is on the router. Applying first and downloading
		 * behind it would paint a `background-image` at a URL that 404s — a wallpaper that silently
		 * does nothing, on the setting whose entire job is visible. */
		function pickWallpaper(v) {
			if (v === 'off' || v === 'file' || prefs.wallpaperReady(v)) { setWallpaper(v); return; }
			const kb = Math.round(prefs.wallpaperSize(v) / 1024);
			const dlErr = E('div', { 'class': 'fs-ap-err', 'role': 'alert', 'hidden': '' });
			const go = E('button', { 'class': 'btn cbi-button-action', 'type': 'button' }, [ _('Download', 'footstrap') ]);
			const cancel = E('button', { 'class': 'btn', 'type': 'button', 'click': ui.hideModal }, [ _('Cancel', 'footstrap') ]);
			go.addEventListener('click', () => {
				go.disabled = true; cancel.disabled = true; dlErr.hidden = true;
				go.textContent = _('Downloading…', 'footstrap');
				prefs.installWallpaper(v)
					.then(() => { ui.hideModal(); setWallpaper(v); })
					.catch((e) => {
						dlErr.textContent = String((e && e.message) || e);
						dlErr.hidden = false;
						go.disabled = false; cancel.disabled = false;
						go.textContent = _('Download', 'footstrap');
					});
			});
			ui.showModal(_('Download this wallpaper?', 'footstrap'), [
				E('p', {}, [ _('This pattern is not part of the theme package. It is about %d kB and is downloaded once, from the project on GitHub, and stored on the router.', 'footstrap').format(kb) ]),
				dlErr,
				E('div', { 'class': 'right' }, [ cancel, ' ', go ])
			]);
		}

		const seg = widgets.segControl(prefs.currentWallpaper(), [
			{ val: 'off',  label: _('Off', 'footstrap') },
			{ val: 'cats', label: _('Cats', 'footstrap') },
			{ val: 'dinos', label: _('Dinosaurs', 'footstrap') },
			{ val: 'file', label: _('File', 'footstrap') }
		], pickWallpaper, label);

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

		return E('div', { 'class': 'fs-ap-wall' }, [ seg, panel ]);
	});

	/* ---- section 4: the router default and the version ---- */
	/* the version line: read from fs-version.js, which the Makefile stamps at package time. No
	 * request, no check — `apk upgrade` is what tells this router about a new one. */

	/* Save the current look as the ROUTER-WIDE default (fs-prefs writes it to /etc/config/footstrap
	 * via the scoped uci ACL). It does NOT change this browser — localStorage keeps overriding, so
	 * the saved default only shows on a fresh browser/device. "Reset" is the escape hatch: it clears
	 * this browser's overrides and reloads onto the saved default (a two-click confirm, since it
	 * discards local tweaks).
	 *
	 * No status text — the Save BUTTON itself is the status: enabled "Save as default" when this
	 * browser diverges from the saved default, disabled "Saved as default" when it already matches
	 * (nothing to save). refreshSave() below drives that from prefs.matchesSavedDefault(). */
	const saveBtn = E('button', { 'class': 'btn cbi-button-action', 'type': 'button' }, [ _('Save as default', 'footstrap') ]);
	/* TWO resets, because there are two things underneath a browser's tweaks (fs-prefs.js):
	 * "Reset to saved" clears them and lets every axis fall back through the layers — to whatever
	 * Save as default put on the ROUTER; "Reset to default" writes the THEME's own built-ins
	 * explicitly, which is the only way to say "as the theme ships" on a router that has a saved
	 * default of its own. Neither touches /etc/config/footstrap. */
	const resetSavedBtn = E('button', { 'class': 'btn', 'type': 'button' }, [ _('Reset to saved', 'footstrap') ]);
	const resetBtn = E('button', { 'class': 'btn', 'type': 'button' }, [ _('Reset to default', 'footstrap') ]);
	/* Save's only visible failure surface. saveAsDefault() writes /etc/config/footstrap over the
	 * scoped uci ACL; the realistic failure is the rpc REJECTING — an expired session (403), a
	 * missing ACL, ubus down — which the old code buried in a title tooltip nobody sees. (A DELETED
	 * config is NOT caught here: rpcd stages the set in the session and commit then silently no-ops
	 * without writing the file, returning success — measured on the router. The package owns that
	 * file and the read side falls back to built-in defaults, so that edge is left to the package.) */
	const saveErr = E('div', { 'class': 'fs-ap-err', 'role': 'alert', 'hidden': '' });

	/* the Save button IS the status: match -> disabled "Saved as default", diverged -> enabled
	 * "Save as default". Called after every axis change (via bump). */
	function refreshSave() {
		const saved = prefs.matchesSavedDefault();
		saveBtn.disabled = saved;
		saveBtn.textContent = saved ? _('Saved as default', 'footstrap') : _('Save as default', 'footstrap');
	}
	saveBtn.addEventListener('click', () => {
		saveBtn.disabled = true;
		saveErr.hidden = true;
		prefs.saveAsDefault()
			.then(() => { saveErr.hidden = true; })
			/* On failure re-enable (refreshSave, below) so the user can retry. The usual cause is a
			 * stale session, which a reload fixes — so say that. The raw rpc error — the one string
			 * here neither the theme nor LuCI composed — stays in a title tooltip for debugging. */
			.catch((e) => {
				saveErr.textContent = _('Could not save the default. Reload the page and try again.', 'footstrap');
				saveErr.title = String((e && e.message) || e);
				saveErr.hidden = false;
			})
			.finally(refreshSave);
	});
	/* two-click confirm on BOTH: the first click arms, the second resets — discarding this browser's
	 * tweaks is destructive of local work, and a native confirm() is banned in this UI. Arming one
	 * disarms the other, so a primed button can never be fired by a click meant for its neighbour.
	 *
	 * Each reload lands on this tab rather than back on General Settings: a reset is a change to
	 * what is on THIS tab, and being thrown to the top of the page to find it again is the kind of
	 * small rudeness that makes a setting feel unfinished. See armReturn() / the mount() flag. */
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
	refreshSave();	/* correct label/enabled state before the first paint */

	const versionLink = E('a', {
		'class': 'fs-ap-version',
		'href': ver.REPO_URL,
		'target': '_blank',
		'rel': 'noopener noreferrer'
	}, [ ver.label() ]);

	const defaults = [
		/* the one row whose "control" is a pair of buttons, each already named by its own text — so
		 * the caption is not re-used as an aria-label here and `make` ignores it */
		group(_('Router default', 'footstrap'),
			() => E('div', { 'class': 'fs-ap-actrow' }, [ saveBtn, resetSavedBtn, resetBtn ]),
			{ extra: saveErr })
	];


	defaults.push(E('div', { 'class': 'fs-ap-footer' }, [
		E('div', { 'class': 'fs-ap-verrow' }, [ versionLink ])
	]));

	/* NOT .cbi-section: inside a tab pane that class is a card drawn within a card, and the stock
	 * tabs (General Settings, Logging, …) put their rows straight into the pane. These are grouping
	 * headings within one pane, so they are the theme's own class and take their rule from
	 * styles/pages/80-appearance.css. */
	const section = (title, rows) => E('div', { 'class': 'fs-ap-section' }, [
		E('div', { 'class': 'fs-ap-head' }, [ E('h4', {}, [ title ]) ])
	].concat(rows));

	/* ---- the folded groups ------------------------------------------------------------------
	 * Recolouring is a thing most admins never do, and these are the widest rows on the page —
	 * nine colour fields and an uploader, which used to sit permanently open in front of someone
	 * who came here to change the layout. Each is a DISCLOSURE now: the heading is the control,
	 * and both start closed.
	 *
	 * A disclosure and not a switch, which is what these were first. A switch answers "is this
	 * feature on", and that is the wrong question — turning it off would either revert nine colours
	 * (destructive, from a control that looks like a disclosure) or change nothing at all, which is
	 * a switch that lies. Folding answers the question that is actually being asked: am I looking
	 * at this right now. Nothing is applied, un-applied or disabled by opening or closing one.
	 *
	 * It is the W3C APG disclosure pattern, the same one the menu's sections use: a <button> owning
	 * the region it shows, `aria-expanded` on the button and `aria-controls` pointing at the panel.
	 * `hidden` on the panel rather than a class, so a closed group is out of the tab order and out
	 * of the accessibility tree for free.
	 *
	 * The open/closed state is remembered per browser but is NOT an axis: it changes nothing about
	 * how the page looks, so it is absent from AXIS_KEYS, from snapshotAxes() and from the
	 * pre-paint. Closed is the default, including on a router that already has colours set — the
	 * fold says where things are, not whether they are in use. */
	let foldSeq = 0;
	function foldable(title, rows, key) {
		const id = 'fs-ap-fold-' + (++foldSeq);
		let open = (prefs.lsGet(key) === 'on');
		const body = E('div', { 'class': 'fs-ap-body', 'id': id }, rows);
		const btn = E('button', {
			'type': 'button', 'class': 'fs-ap-fold', 'aria-expanded': String(open), 'aria-controls': id
		}, [
			E('h4', {}, [ title ]),
			/* The chevron is the affordance, and it is the SAME one the overview's card toggles
			 * draw: an empty box whose ::after is two borders rotated 45° (styles/pages/
			 * 20-overview.css). Not an <svg> — this theme has one chevron for "this panel opens",
			 * and a second drawing of it would be a second thing to keep looking like the first.
			 * Empty and aria-hidden: the STATE is on the button's aria-expanded, which is also what
			 * CSS rotates it off, so what a screen reader is told and what the eye sees cannot
			 * disagree. */
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
			/* the colour controls read the COMPUTED cascade, and a hidden element computes nothing
			 * useful — so the readouts are filled when the group becomes visible, not before */
			if (open) refreshColours();
		});
		paint();
		return E('div', { 'class': 'fs-ap-section' }, [
			E('div', { 'class': 'fs-ap-head' }, [ btn ]), body
		]);
	}

	/* Colours and Surfaces are ONE fold: they are the same job — "make this router a different
	 * colour" — split into two headings only because a figure and the sheet it sits on are read
	 * differently. Two folds for one decision would be two things to open. */
	const page = E('div', { 'class': 'fs-ap' }, [
		section(_('Interface', 'footstrap'), shell),
		foldable(_('Colours', 'footstrap'),
			[ presetRow ].concat(colours, [ E('h5', { 'class': 'fs-ap-sub' }, [ _('Surfaces', 'footstrap') ]) ], surfaces),
			'fs-ui-colours'),
		foldable(_('Background', 'footstrap'), [ wallpaper ], 'fs-ui-background'),
		section(_('Defaults', 'footstrap'), defaults)
	]);

	/* The colour controls read the COMPUTED cascade, which needs them in the document — so the first
	 * fill cannot happen while the tree is still being assembled above. The view appends this
	 * element synchronously on return, so a microtask is late enough and early enough: late enough
	 * that the probe resolves, early enough that nothing has painted a blank field. */
	Promise.resolve().then(refreshColours);
	return page;
}

/* ---- mounting it on the stock System page ---------------------------------------------------
 *
 * The same shape as fs-overview.js's, and for the same reason: a chrome module is instantiated once
 * per PAGE LOAD, so it has to notice SPA navigation itself. `body[data-page]` is the signal — both
 * the server template and fs-router stamp it with the dispatch path — so one attribute observer
 * covers arriving at System, leaving it, and coming back. */
const PAGE = 'admin-system-system';
/* A reset reloads the page, and a reload opens the stock page on the tab LuCI remembers — which is
 * never this one, because ui.tabs only knows the tabs it built itself. So the reset says where it
 * came from and mount() puts the user back. sessionStorage and not a URL fragment: the fragment is
 * the stock page's own business, and a stale one would keep re-opening this tab on every later
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
const MARK = 'fs-ap';	/* the built form's own class; also how mount() knows it is already there */
const TAB = 'fs-appearance';	/* the pane's data-tab, which ui.tabs' click handler matches on */

let _routeObserver = null, _viewObserver = null, _observedView = null, _building = false;

function onPage() { return (document.body.getAttribute('data-page') || '') === PAGE; }

function stopWatch() {
	if (_viewObserver) _viewObserver.disconnect();
	_viewObserver = null;
	_observedView = null;
}

/* Append the form once the stock view has rendered. LuCI's system.js resolves its own promises
 * before it puts anything in #view, so there is nothing to hook but the DOM — hence the observer,
 * which also covers the view being re-rendered under us (a Save & Apply redraws the map).
 *
 * Idempotent through the marker: an observer fires for every mutation, and the form's own
 * construction is a mutation. Without the check it would append itself for as long as it kept
 * noticing itself. */
/* The stock tab GROUP: the element whose children are the panes, which ui.tabs marks
 * data-initialized when it builds the menu — and the menu it inserted is that element's previous
 * sibling. Both are read from the DOM rather than assumed, because a group that is not initialised
 * yet is a page still rendering, not a page without tabs.
 *
 * The flag and the sibling are the whole test, deliberately: the panes themselves are NOT required
 * to be found here. On the stock System page they are not direct children of the marked element at
 * all — the map nests them a level deeper — so a `:scope > .cbi-tabcontainer` check found none and
 * the tab was never added, silently, on a page that plainly has tabs. */
function tabGroup(view) {
	for (const g of view.querySelectorAll('[data-initialized="true"]')) {
		const menu = g.previousElementSibling;
		if (menu?.classList.contains('cbi-tabmenu'))
			return { group: g, menu };
	}
	return null;
}

/* Append the pane and its tab once the stock view has rendered. LuCI's system.js resolves its own
 * promises before it puts anything in #view, so there is nothing to hook but the DOM — hence the
 * observer, which also covers the view being re-rendered under us (a Save & Apply redraws the map).
 *
 * The tab is added BY HAND rather than by calling ui.tabs.initTabGroup again: that function returns
 * immediately when the group carries data-initialized, and clearing the flag to re-run it would
 * build a SECOND menu beside the first (it inserts one unconditionally) and drop the stock tabs'
 * own click bindings. One <li>, the same click handler ui.tabs binds to every other tab, and the
 * pane the handler expects to find.
 *
 * Idempotent through the marker: an observer fires for every mutation, and the form's own
 * construction is a mutation. Without the check it would append itself for as long as it kept
 * noticing itself. */
function mount() {
	const view = document.getElementById('view');
	if (!view || view.querySelector('.' + MARK) || _building) return;
	const tabs = tabGroup(view);
	if (!tabs) return;
	_building = true;
	render()
		.then((form) => {
			/* re-check: render() resolves on a microtask and the view can have been replaced, or
			 * navigated away from, in the meantime */
			const v = document.getElementById('view');
			if (!onPage() || !v || v.querySelector('.' + MARK)) return;
			const t = tabGroup(v);
			if (!t) return;
			/* The tab is named after the THEME, not after what it does: it sits between four stock
			 * tabs that are all "what this page configures" (General Settings, Logging, …), and a
			 * fifth called Appearance reads as another facet of the router rather than as one
			 * package's settings. "Footstrap" says whose these are — and it is a proper noun, so it
			 * is deliberately NOT translated, like the palette name in the form below. */
			const title = 'Footstrap';
			/* data-tab-active is deliberately absent: the stock page opens on whichever tab it
			 * opened on before, and a theme has no business taking that over. */
			t.group.appendChild(E('div', {
				'class': 'cbi-tabcontainer',
				'data-tab': TAB,
				'data-tab-title': title
			}, [ form ]));
			const link = E('a', { 'href': '#' }, [ title ]);
			link.addEventListener('click', ui.tabs.switchTab.bind(ui.tabs));
			t.menu.appendChild(E('li', { 'class': 'cbi-tab-disabled', 'data-tab': TAB }, [ link ]));
			/* …and if this load is the one a reset asked for, open on it. Clicking the link we just
			 * built goes through ui.tabs' own switchTab, so the stock panes are hidden exactly the
			 * way they are for any other tab — nothing here reimplements the switch. */
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
	_viewObserver.observe(view, { childList: true, subtree: true });
	mount();
}

/* Called by menu-footstrap-common's init, once. Everything route-dependent hangs off the data-page
 * observer inside. */
function wire() {
	if (_routeObserver || !document.body) return;
	_routeObserver = new MutationObserver(() => (onPage() ? watch() : stopWatch()));
	_routeObserver.observe(document.body, { attributes: true, attributeFilter: [ 'data-page' ] });
	if (onPage()) watch();
}

return baseclass.extend({
	wire,
	render,
	PRESETS
});

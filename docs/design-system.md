# Design system: tokens, palettes, type

The theme's values and why they are those values. How the stylesheet is built and how the cascade
is kept disciplined: [css.md](css.md). What the chrome does with them: [chrome.md](chrome.md).

There is one system: one renderer (`fs-chrome.js`), one template directory, one `cascade.css`,
one entry in `luci.themes`. Layout (sidebar or top bar) is a client setting, `:root[data-layout]`,
always with an explicit value.

Colour values live in `styles/02-tokens.css` and `styles/03-palettes.css`, with the reasoning in a
comment beside each one. This page does not repeat them: a copy here would drift.

## Two tiers, and the split is load-bearing

- The private tier `--fs-*` (`02-tokens.css`, `03-palettes.css`): `--fs-bg`, `--fs-panel`,
  `--fs-panel2`, `--fs-border`, `--fs-text`, `--fs-dim`, `--fs-faint`, `--fs-placeholder`,
  `--fs-accent`, `--fs-good/-warn/-danger`, `--fs-track`, plus the radius, z-index, duration and
  spacing scales. Every rule in the theme reads this tier and only this tier.
- The export tier `--*-color-*`: the conventional LuCI names (`--primary-color-high`,
  `--text-color-*`, `--border-color-*`, `--on-*-color`), defined from the private tier. Nothing in
  `styles/` reads an export name.

`:root` is a shared scope, and every `luci-app-*` puts its CSS in the same document unlayered,
where it outranks any `@layer`. One app declaring `:root { --accent: … }`, or `--text-color-high`
(a convention, so apps declare it readily), would recolour the whole theme if the theme read it.

The exception is a local variable declared in the same rule that reads it (`--bd-color`,
`--fg-color`): a foreign `:root` cannot intercept it.

```css
/* NO: reading an export name */
color: var(--text-color-medium);
/* YES: the private tier */
color: var(--fs-dim);
```

The apps' side of this contract: [luci-app-styling-guide.md](luci-app-styling-guide.md).

### The export tier is a RAMP, not a set of aliases

`high`/`medium`/`low` must be three different colours. An app asks for a gradation and gets what we
declared. With all three aliased to one token, `luci-app-podkop` would draw its "no data" latency in
`--primary-color-low`, the same bright accent as a live value. A flat ramp passes every contrast
threshold, so only a reader notices. Stock `firewall.js` and `status/cpu.js` read the ramp too.

The direction follows bootstrap's: `high` is the most pronounced value of the role. The exception
is `--background-color-*`, an elevation axis (`high` = raised).

The ramp varies chroma at constant lightness (`color-mix(in oklch, …, var(--fs-dim))`), so every
level stays readable as text. Fading `low` toward the surface would spend contrast the palette does
not have, and pulling `high` toward `--fs-text` collapses the ramp in dark mode.

`--text-color-low` is `--fs-faint`, the theme's third ink, not a copy of `-medium`.

Apps use a level as `color:` as often as `background:`. Every level must pass AA 4.5:1 as text on
`--fs-bg`, `--fs-panel` and `--fs-panel2` and carry a readable `--on-*-color` as a fill, in every
palette, mode and tint hue. This is checked by hand. Borders are exempt from the text half: a
hairline may fade into the surface.

## Palettes

Five, all in `styles/03-palettes.css`, one block per palette and mode:

- footstrap: GitHub Primer colours. The default, in a bare `:root`.
- hicontrast (`data-palette="hicontrast"`): the same tokens, deeper and more saturated. Its light
  accents are darker than the default's, so it never contrasts worse than the default.
- bootstrap (`data-palette="bootstrap"`): the stock LuCI theme's surfaces and greys. The canvas
  equals the card in light mode only, as in stock. Bootstrap has no dark third ink, so `--fs-faint`
  sits at the first grey that clears AA on `--fs-panel2`.
- 2020 (`data-palette="2020"`): the OpenWrt 2020 theme's cyan on navy. That scheme is the dark mode;
  the light mode keeps the hue and darkens it.
- forum (`data-palette="forum"`): forum.openwrt.org's Discourse colours, read from its computed
  styles. Its search-highlight yellow fills `--fs-warn`. Its header navy is the dark block's
  `--fs-bar-bg`, the only palette that overrides the shared `--fs-bar-bg: var(--fs-panel)`.

A colour taken from a source theme keeps its hue and saturation, and its lightness moves until it
clears AA 4.5:1 on all three surfaces. The export tier is what other people's apps print text in.

Light mode is the bare `:root`; dark is `:root[data-darkmode="true"]`. Each dark block is
self-contained; a light block inherits from the default block, below.

### Adding a palette

`--fs-panel-base` and the four inks (`--fs-on-accent`, `--fs-on-good`, `--fs-on-warn`,
`--fs-on-danger`) are `#fff` in every light palette, so the default block is their only
definition. A new light block inherits them and sets only what differs. If a new palette needs a
different light ink for AA, declare it in that palette's block.

Copy the two hicontrast blocks (light and dark). Set every colour the light block does not inherit.
Every surface and role colour goes through a `-base` token (`--fs-bg-base`, `--fs-panel-base`,
`--fs-accent-base`, `--fs-good-base` and so on), so the tint, accent and colour axes can derive from
it; a palette never declares `--fs-good` directly. Set the dark block's four inks. Then register the
name in three places, each failing quietly if skipped: the PALETTE axis in `fs-axes.js`, the
`_sd_pal` whitelist and pre-paint switch in `partials/head.ut`, and the label map in
`fs-appearance.js`.

### Surfaces carry no transparency axis

`--fs-panel`, `--fs-panel2` and `--fs-border` are solid per palette. A translucent surface thins
the text on it, and contrast against a semi-transparent backdrop is undefined: it depends on
whatever pixel sits behind. The wallpaper axis is the way to show a picture.

### Ink is per palette AND per mode

`--fs-on-accent`, `--fs-on-good`, `--fs-on-warn` and `--fs-on-danger` live in `03-palettes.css`
next to their fills. A dark palette has light fills and needs dark ink; a global `#fff` fails AA on
most dark fills. A new palette defines all four and checks them against its own fills.

### The fourth ink is the one that says "nothing here"

`--fs-text`, `--fs-dim` and `--fs-faint` are three weights of a value. `--fs-placeholder` is what a
field shows when it holds nothing, and LuCI puts the option's default there
(`form.Value.placeholder`). In `--fs-dim` it reads like a value the admin never typed.

It is mixed from `--fs-text` toward `--fs-panel2` in oklch. The percentage is per mode, not per
palette: 55% light, 64% dark.

This is the one token the theme ships under AA on purpose. A hint mistaken for a value makes an
admin configure the wrong thing; a faint hint makes them look twice. The line not crossed is 3:1
(SC 1.4.11). `prefers-contrast: more` restores the AA ink in both modes
(`theme/95-a11y-media.css`).

## The derived ladder: four steps, and the matrix is deliberately full

A tint of a role is mixed from that role, so it follows the palette. Each step has a name, so no
rule invents its own percentage.

| Step | Strength | What it is |
|---|--:|---|
| `-soft` | 12% | a quiet fill: hover on an outline button |
| `-fill` | 18% | a stronger fill: callout, diff, the invalid ring |
| `-line` | 40% | a hairline border |
| `-line-hi` | 55% | the same hairline on hover |

The role × step matrix is filled for the three roles a control can take (accent, good, danger).
Every cell exists whether or not anything reads it today: a hole is where drift starts. `warn` has only `-fill`:
LuCI emits no warning button. `--fs-accent-soft` depends on mode (10% light, 15% dark, hicontrast
dark 14%), so it lives in `03-palettes.css`.

Focus rings:

- `--fs-focus-ring` is a `-soft` halo, under WCAG 1.4.11's 3:1 on its own. Use it only with a
  second cue: every field that takes it also turns `border-color` to `--fs-accent`.
- `--fs-focus-ring-solo` is for a control where the ring is the whole indicator (sidebar links,
  chrome icon buttons, section tabs, range sliders). Its 2px of surface lets it read on a filled
  control.
- `--fs-focus-ring-invalid` takes `-fill`, so a red ring reads as an alarm. It pairs with a red
  border.

`--fs-hover-lift` brightens whatever fill the role set. Light darkens to `.90`, because
brightening drops white on `--fs-accent` under AA. Dark brightens to `1.15`, since its fill is
light and its ink dark.

`--fs-bar-bg` is opaque. A translucent bar shows the page through the chrome, which reads as a
glitch. The sheet has no `backdrop-filter`.

Colour literals outside the palettes are few and fixed: `--fs-scrim` (black at .7 behind a
dialog), the black in `--fs-shadow-pop`, the `.fs-logo-ring` fills in `theme/10-chrome.css`,
and the print palette in `theme/97-print.css`. Do not add more.

## Scales

Type: six steps in `02-tokens.css`, about ×1.25 apart. `--fs-type-2xs` 10px (the port tiles'
traffic figures), `-xs` 11px (eyebrows, badges, tooltips), `--fs-type` 13px (body, tables,
fields), `-lg` 16px (section titles), `-xl` 20px (page titles), `-2xl` 26px (`h1`, third-party
only). 13px is deliberate: a router UI is dense tables of addresses and counters.

Leading is a unitless `1.5`, so it re-resolves against each element's own size. On a 13px body that
gives a 19.5px line box, so never size a box as `--fs-type * --fs-leading`; take the nearest
`--fs-space` step.

The type steps are declared twice: unrounded in `:root`, rounded inside
`@supports (width: round(1px, 1px))`. `round()` is newer than the floor, and an engine without it
would fail at substitution and compute every `var(--fs-type)` to `unset`. `--fs-control-h` is
rounded the same way, up to the 4px control ladder.

Field text: `--fs-type-floor` is `max(16px, --fs-type-lg)`. iOS Safari zooms when a field under
16px takes focus. `--fs-type-field` (inputs, textareas, selects, dropdown rows) and
`--fs-type-field-xs` (the table filter, the Appearance hex field) are the body and dense sizes on
desktop and become the floor under `@media (max-width: 767px)`. The palette search field reads
`--fs-type-floor` at every width, since it focuses as it opens.

Weight: `--fs-weight-normal` 400, `--fs-weight` 600 (the UI default), `--fs-weight-bold` 700.

The eyebrow: `--fs-eyebrow-tracking` (.06em), `--fs-eyebrow-weight` (700) and
`--fs-eyebrow-color` (`--fs-faint`) name one microlabel style: table column headers, stacked-card
labels, Appearance group labels, rail flyout titles, login field titles. Size is not part of it:
10px and 11px are two real tiers. `h6` and `.fs-navlabel` look like eyebrows and are not.

Radius: one user-facing base (the Rounding axis, 0–20px) derives three radii: cards, panels,
modals and popovers; controls (inputs, buttons, dropdowns, tabs, menu items, logo); small parts
(chips, code, insets). Pills and toggles are fully round. Every `border-radius` in `theme` and
`pages` reads one of them.

Z-index: `--fs-z-*`, bottom to top: `raise` 2, `sticky` 50, `flyout` 70, `header` 800, `popover`
850, `overlay` 900, `tooltip` 1000, `dropdown` 1100. Every z-index that orders layers across
components comes from here. The local exceptions are the wallpaper element's `-1`
(`theme/15-wallpaper.css`) and the sticky table cells' `1` and `2` inside a table
(`theme/30-tables.css`).

Motion: four durations. `--fs-dur` .15s (a state change: colour, border, shadow, background,
filter), `--fs-dur-move` .2s (transform, max-height), `--fs-dur-fade` .25s (a transient thing going
away: spinner, notification), `--fs-dur-fill` .4s (a progress bar growing). There is no easing
token: every transition takes the CSS default `ease`. A rule that needs another curve says why in
a comment.

Spacing: independent of the type scale, so a font-size change does not re-space every widget. A
4px grid: `--fs-space-1` through `-7` (the number is the step, `-1` = 4px at Normal density), then
`-8` (32px) and `-10` (40px). The half-steps `-0-5` (2px), `-1-5` (6px), `-2-5` (10px) and `-3-5`
(14px) are named because real insets land on them.

Control heights: `--fs-ctl-h-sm` (30px), `--fs-ctl-h` (38px, default) and `--fs-ctl-h-lg` (44px)
are minimum heights for chrome controls (buttons, not fields). `--fs-control-h` is a field's height,
derived: the text box (`--fs-type` × `--fs-leading`), plus `2 × --fs-space-1` of inset, plus two
1px borders, rounded up to 32px at Normal density.

Density multiplies type, spacing and shell geometry through `--fs-density-type`,
`--fs-density-space` and `--fs-density-box`. Compact is `.9` / `.65` / `.85`, Normal is `1` / `1` /
`1` (a bare `:root`), Large is `1.15` / `1` / `1.15`. Every type, spacing and geometry token is a
`calc()` over one of them, except the content caps (`--fs-content-min`, `--fs-content-max`,
`--fs-field-max`). The numbers on this page are at Normal density.

Shell geometry: `--fs-sidebar-w` (224px), `--fs-rail-w` (68px), `--fs-content-min` (500px),
`--fs-content-max` (1280px) and `--fs-bar-h` (46px) are tokens because the JS reads them.
`fitShell()` reads them with `getComputedStyle` to decide whether the column beside the sidebar is
readable, so the measurement follows Density and no JS copy can drift. `--fs-content-pad` (28px)
is a token no JS reads.

Shadow: `--fs-shadow-pop`, for floating surfaces (menus, dropdown lists, popovers, the modal).

### Two glyphs drawn as tokens, not fetched

`--fs-icon-refresh` (the poll pill's glyph, shared by the rail and the bar's compact cluster) is
the theme's own drawing, so the theme carries no Lucide (ISC) licence obligation. Do not swap a
Lucide `refresh-cw` back in. It does not spin: a spinner makes an idle poll look busy and moves the
click target that pauses it.

`--fs-select-chevron` is two gradient bands, not an SVG data URI. A URI cannot read `var()`; the
bands take `--fs-dim` at paint time, so a new palette gets a correct chevron for free.

## The appearance axes

`fs-appearance.js` builds the controls. `view/footstrap/appearance.js` dispatches them at
System → Footstrap (`admin/system/footstrap`, registered in
`root/usr/share/luci/menu.d/luci-theme-footstrap.json`, ACL-gated like any `luci-app-*` page). The
entry exists while the package is installed, whichever theme is active; see
[architecture.md](architecture.md).

The values live in `fs-axes.js` (`fs-prefs.js` for dark mode, layout, auto-collapse and rail). The
page groups them in four parts:

- Interface: Layout, Theme, Palette, Density, Content width, Rounding, Submenus.
- The Colours fold: Tint and its strength, the four colour axes, the four surface axes.
- The Background fold: Wallpaper, Dim, Pattern and its three axes, File.
- Saving.

| Axis | Values | `localStorage` | `:root` |
|---|---|---|---|
| Layout | top (default) / sidebar | `fs-layout` | `data-layout` (always explicit) |
| Theme | auto / light / dark | `fs-darkmode` | `data-darkmode` + `data-theme` + `data-bs-theme` |
| Palette | footstrap / hicontrast / bootstrap / 2020 / forum | `fs-palette` | `data-palette` |
| Density | compact / normal / large | `fs-density` | `data-density` |
| Wallpaper | off / pattern / file | `fs-wallpaper` | `data-wallpaper` |
| Tint | off, hue 1–360°, `#rrggbb` | `fs-tint` | `data-tint=hue\|hex`, `--fs-tint-h` / `--fs-bg` |
| Tint strength | 0–200%, default 100 | `fs-tint-strength` | `--fs-tint-strength` |
| Accent | off, hue 1–360°, `#rrggbb` | `fs-accent` | `data-accent=hue\|hex`, `--fs-accent-h` / `--fs-accent` |
| Good / Warning / Danger | same shape as Accent | `fs-good`, `fs-warn`, `fs-danger` | `data-good\|warn\|danger`, `--fs-*-h` / `--fs-*` |
| Cards / Controls / Sidebar / Borders | off, `#rrggbb` | `fs-card`, `fs-control`, `fs-bar`, `fs-line` | none; inline `--fs-panel-base`, `--fs-panel2-base`, `--fs-bar-bg`, `--fs-border-base` |
| Photo dim | 0–100%, default 74 | `fs-photo-dim` | `--fs-photo-dim` |
| Pattern scale | 40–1600px, default 440 | `fs-pattern-size` | `--fs-pattern-size` |
| Pattern strength | 0–100%, default 20 | `fs-pattern-strength` | `--fs-pattern-strength` |
| Pattern colours | theme / original | `fs-pattern-ink` | `data-pattern-ink=original` |
| Rounding | 0–20px, default 12 | `fs-radius` | `--fs-radius-base` |
| Content width | 1280–3840px, default 1280 | `fs-content-width` | `--fs-content-max` |
| Submenus | keep open / auto-collapse | `fs-menu-autocollapse` | none |

Content width (issue #44) writes a px length onto `--fs-content-max`. 1280 is the width every page
was designed against, so the axis only widens, and `--fs-content-min` stays out of reach. 3840
stands for "uncapped". The slider steps by 40px.

Photo dim is the scrim over a `file` wallpaper; the three Pattern axes do the same for the tiled
SVG. The images' bytes live on the router; how a browser draws them is an ordinary axis.
`--fs-login-bg-url` and `--fs-pattern-url` are `none` in the bare `:root`, so the sheet stands alone;
`head.ut` and `fs-axes.js` stamp the real `url()` inline. `--fs-photo-scrim` mixes from
`--fs-bg-base`, not the tinted `--fs-bg`, so the tint never colours an uploaded photo.

Pattern colours: on `theme` (the default) the SVG paints through a CSS `mask`, so the file supplies
alpha and the theme supplies `--fs-text`, correct in both modes and every palette. On `original` the
mask drops for a plain tiled `background-image`, keeping artwork that carries its own colours.
`fs-wallpaper` alone decides whether anything paints.

### Wallpaper rendering: why the canvas moves to `:root`

The pattern is a dedicated `.fs-pattern` element, `<body>`'s first child (`header.ut`, and
`sysauth.ut`, which has no `.fs-shell`). A mask applies to the element's children too, so it cannot
sit on `.fs-shell` or `<body>`.

`.fs-pattern` sits at `z-index: -1`. In the root stacking context a negative-z child paints under
every block background, so the canvas colour moves to `:root`, and `body`, `.fs-main` and the footer
go transparent. Both wallpapers use `background-attachment: fixed`.

The uploaded photo (`file`) paints on one element (`.fs-shell`, or `body` before login), with
`--fs-photo-scrim` as a second `background-image` layer on the same element. No `::before` and no
`backdrop-filter`: a full-viewport blur is the most expensive paint a phone does.
`prefers-reduced-transparency` is not honoured here: an opaque scrim would hide the admin's photo
(#66).

Five more `fs-` keys are not axes:

- `fs-rail`: the sidebar collapsed to its icon rail;
- `fs-menu-open`: the open accordion sections;
- `fs-recent`: the command palette's history;
- `fs-ui-colours` and `fs-ui-background`: whether the Appearance page's two folds are open.

None has a router default. So `fs-rail` may delete its key on the off state, where an axis may not.

### Three layers, and the browser always wins

The effective value of every axis is `localStorage` ?? router default ?? built-in.

- The router default is what Save to router writes. `saveAsDefault()` uci-sets the axes into
  `/etc/config/footstrap`; the server passes them as `window.__fsSD`, which `head.ut` stamps. A new
  browser, a private window or a cleared cache inherits the router's look, the login page included.
- The built-in is a bare `:root`.
- This browser's own choice overrides the router default in either direction.

Every applier therefore stores its choice explicitly, the off or default value included. Once a
router default exists, a missing key means "inherit the router default", so deleting the key could
not express "the built-in, not the router default". `lsDel` is reserved for Reset to default.

### Nothing else writes to the router

Only Save to router writes `/etc/config/footstrap`. The only other uci writes on the page are the
login-background token on upload and its blanking on remove. No axis writes through on change,
`wallpaper` and `photo_dim` included: a per-browser pick must never change the default for every
other device.

`/etc/config/footstrap` ships as an empty stub and is written at runtime, so it must be a conffile;
see [package.md](package.md).

Every axis is implemented twice: inline in `partials/head.ut` before first paint, where `require`
does not exist yet, and live in `fs-axes.js` (`fs-prefs.js` for dark mode, layout, auto-collapse
and rail). The JS is the contract and the template follows it. They agree on keys, `:root` attributes,
custom properties and ranges. They agree on every slider's limits and default (JS, pre-paint,
`_sd_range`, CSS token). They follow one ordering rule: custom property first, attribute second. Reversed, a reload paints one frame in
the previous hue.

### The colour axes, and why the slider went

Nine axes take a colour: Tint (the canvas), Accent, Good, Warning, Danger, and the four surfaces
Cards, Controls, Sidebar and Borders. Each holds off, a hue 1–360°, or a `#rrggbb`, and
`data-<axis>` says `hue` or `hex`. The surfaces hold only a colour: they set an inline custom
property and no attribute (`surfaceAxis` in `fs-axes.js`).

The page offers only the hex field. A hue slider keeps the palette's chroma, so no angle reaches a
grey (#20). Hue mode stays in storage and in the stylesheet, so a saved hue keeps painting.

The ink over a hex fill is derived in JS. `inkFor()` (`fs-axes.js`, with a copy in the `head.ut`
pre-paint that must stay equal) writes `--fs-on-accent` and the three status inks inline: black
above OKLab L .62, white below. An inline custom property outranks every stylesheet rule, so no
palette block can leave a grey accent with near-black ink. Surfaces get no derived ink: text on them
stays `--fs-text`, so the page shows the contrast each choice lands at instead.

### Tint and Accent

In hue mode both are an angle 1–360°, both rotate `oklch(from …)`, and both default to off (no
attribute).

- Tint (`data-tint`, `--fs-tint-h`) washes a hue into the canvas (`--fs-bg`), so each router can
  look different at a glance. `localStorage` is per origin, so this needs no server state. Nothing
  else moves: cards, chrome and status colours keep their palette values, so a status colour never
  lies.

  It rotates chroma and hue instead of mixing a colour in: `color-mix` in a polar space gives the
  same colour for small percentages on a dark canvas.

  Tint strength (`--fs-tint-strength`, 0–200%, default 100) multiplies the tint chroma. It applies
  only while a hue is set, and it is hidden under a `file` wallpaper, where the photo covers the
  canvas.

  `--fs-tint-c`, the chroma the hue is applied at, is a floor plus two `cos()` terms per mode, tuned
  against the palettes' blue-grey canvases; the reasoning is in `styles/03-palettes.css`. Keep it
  small: it is an identity cue, not a colourway.
- Accent (`data-accent`, `--fs-accent-h`) rotates the interface colour. Every accented control reads
  `--fs-accent` or a mix of it. `oklch(from … l c H)` keeps lightness and chroma and changes only the
  hue, so `--fs-on-accent` stays readable at any angle.

`--fs-bg` cannot be defined through itself (invalid at computed-value time), so the palette
declares the raw `--fs-bg-base` and `--fs-accent-base`, and one block derives the rest.

## Typography

The theme carries no fonts. `--fs-font-sans` and `--fs-font-mono` (`02-tokens.css`) name Manrope and
JetBrains Mono first and the system stack after:

```
--fs-font-sans: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--fs-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

A bare family name matches fonts installed on the visitor's machine. An admin with either face
installed sees it; one without falls through with no request and no 404. Mono is for values:
addresses, hostnames, versions, port names.

There is no bold mono, and it must not come back. `<strong>` is a label (LuCI writes
`<strong>MAC:</strong> ac:1f:6b:…`), so on a monospace surface it takes the sans face
(`theme/45-misc.css`; likewise `.ifacebadge`, `code` and `pre`). Mono at weight 600 or more is a
synthetic bold that smears the grid. A rule that "needs bold mono" is a label, and a label is not
mono.

Excluding an element from the mono rule is not enough: it still inherits mono from its parent.
Assign the sans face; adding `strong` to a `:not()` changes nothing.

A table's column heading uses the eyebrow size, weight, tracking and ink, but not
`text-transform: uppercase`. The string is the app's: uppercase prints LuCI's `IPv4 address` as
`IPV4 ADDRESS` (issue #39), and LuCI copies the heading's `innerText` into `data-title` for the
cards. Four rules hold this together: `.cbi-section .table .th` and the title row in
`theme/30-tables.css`, the card label copy in `theme/65-dropdown.css`, and the alert's table in
`theme/35-alerts.css`. The chrome's own eyebrows (menu section labels, KPI captions, the search
palette's group headings) stay uppercase: they are the theme's words.

`PKG_LICENSE` is Apache-2.0 alone: with no font files in the package, declaring OFL-1.1 would be
false.

### Putting a font back, per router

The package ships the seam: three uci options in `footstrap.settings`, filled by
`fonts/set-font.sh` or by hand. [fonts/README.md](../fonts/README.md) is the admin's page; this is
the contract.

| option | what | sanitised in `partials/head.ut` by |
|---|---|---|
| `font_sans` | a `font-family` stack, printed into an unlayered `:root` block | `_sd_family()`: `A-Za-z0-9 ,._"'-`, ≤120 chars |
| `font_mono` | the same for the monospace face | `_sd_family()` |
| `fonts` | md5 of the generated `@font-face` sheet: the cache key and the switch that emits its `<link>` | the hex whitelist `login_bg` and `pattern` use |

A stack alone costs nothing and renders for whoever has the face installed. A stack plus a file in
`/etc/footstrap/fonts/` makes the router serve it to every visitor.

- The generated sheet carries `@font-face` and nothing else. The families come from the template,
  so a hand-set `font_sans` works with nothing regenerated.
- The `:root` block is unlayered, so it beats `layer(tokens)` in any sheet order.
- The `<link>` is emitted only when the token is non-empty, and the token is written only after the
  file exists.

None of the three is an axis: no `localStorage`, no Appearance control, no entry in
`snapshotAxes()`. A font belongs to the router, not to a visitor.

## Meter polarity

`annotateMeter()` (`fs-overview.js`, Overview only) colours a `.cbi-progressbar` by its fill:
warn at 80%, danger at 92% (`FS_METER_WARN`, `FS_METER_DANGER`). A fill is not always "how much is
used": "Total Available" is healthy when high, and a free swap reads 100%.

Three cases, keyed on the row's label (`_(msgid)`, no msgctxt, the same match `ROLES` makes). Every
msgid used is in luci-base's `base` domain, loaded on every admin page:

1. Inverted ("Total Available", "Swap free", `FS_METER_INVERTED`): the bar reads `100 - level`
   against the same thresholds.
2. Neutral ("Buffered", "Cached", `FS_METER_NEUTRAL`): no colour. A full page cache is the kernel
   doing its job.
3. Anything else, including any app's meter, keeps the fill-based colour. Most bars are used-based,
   so fill-based is the fallback.

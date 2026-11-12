# Design system: tokens, palettes, type

The theme's values and why they are those values, for someone changing `styles/` or the Appearance page.
The main rule: every rule in the theme reads only `--fs-*` names, never an export name.

How the stylesheet is built and how the cascade is kept disciplined: [css.md](css.md). What the
chrome does with the values: [chrome.md](chrome.md).

There is one system: one renderer (`fs-chrome.js`), one template directory, one `cascade.css`, one
entry in `luci.themes`. Layout (sidebar or top bar) is a client setting, `:root[data-layout]`,
always with an explicit value.

Colour values live in `styles/02-tokens.css` and `styles/03-palettes.css`, with the reasoning in a
comment beside each one. This page does not repeat them: a copy here would drift.

## Short version

1. The theme reads only `--fs-*` names: palette tokens, or a local variable declared in the same
   rule. The export tier `--*-color-*` is written for apps and read by nothing in `styles/`.
2. The export tier is a ramp: `high`, `medium` and `low` are three different colours, each AA as text.
3. Five palettes live in `styles/03-palettes.css`. To add one, follow
   [Adding a palette](add-palette.md#adding-a-palette).
4. Tints come from a named four-step ladder; colour literals outside the palettes are a fixed few.
5. Type, spacing, radius, z-index and motion come from scales in `02-tokens.css`. Text lengths are rem.
6. Every Appearance axis resolves as `localStorage` ?? router default ?? built-in. Only Save to
   router writes `/etc/config/footstrap`.
7. The theme ships no fonts. A router can add one through three uci options.

## Contents

- [Two tiers, and the split is load-bearing](#two-tiers-and-the-split-is-load-bearing)
- [Palettes](#palettes)
- [The derived ladder: four steps, and the matrix is deliberately full](#the-derived-ladder-four-steps-and-the-matrix-is-deliberately-full)
- [Scales](#scales)
- [The appearance axes](#the-appearance-axes)
- [Typography](#typography)
- [Meter polarity](#meter-polarity)

## Two tiers, and the split is load-bearing

| Tier | Names | Defined in | Read by |
|---|---|---|---|
| private | `--fs-*`: `--fs-bg`, `--fs-panel`, `--fs-panel2`, `--fs-border`, `--fs-text`, `--fs-dim`, `--fs-faint`, `--fs-placeholder`, `--fs-accent`, `--fs-good/-warn/-danger`, `--fs-track`, plus the radius, z-index, duration and spacing scales | `02-tokens.css`, `03-palettes.css` | every rule in the theme, and only this tier |
| export | `--*-color-*`: the conventional LuCI names (`--primary-color-high`, `--text-color-*`, `--border-color-*`, `--on-*-color`) | from the private tier | nothing in `styles/` |

Why: `:root` is a shared scope. Every `luci-app-*` puts its CSS in the same document unlayered,
where it outranks any `@layer`.

One app declaring `:root { --accent: … }` would recolour the whole theme if the theme read it. So
would `--text-color-high`, a convention that apps declare readily.

```css
/* NO: reading an export name */
color: var(--text-color-medium);
/* YES: the private tier */
color: var(--fs-dim);
```

A local variable declared in the same rule that reads it (`--fs-bd-color`, `--fs-fg-color`) is safe
as well: a foreign `:root` cannot intercept it. It still takes the `--fs-` prefix, because
`mangle-tokens.sh` shortens only `--fs-*` names.

The apps' side of this contract: [luci-app-styling-guide.md](luci-app-styling-guide.md).

### The export tier is a RAMP, not a set of aliases

`high`/`medium`/`low` must be three different colours. An app asks for a gradation and gets what we
declared.

With all three aliased to one token, `luci-app-podkop` would draw its "no data" latency in
`--primary-color-low`, the same bright accent as a live value. A flat ramp passes every contrast
threshold, so only a reader notices. Stock `firewall.js` and `status/cpu.js` read the ramp too.

The direction follows bootstrap's: `high` is the most pronounced value of the role. The exception
is `--background-color-*`, an elevation axis (`high` = raised).

The ramp varies chroma at constant lightness (`color-mix(in oklch, …, var(--fs-dim))`), so every
level stays readable as text.

- Fading `low` toward the surface would spend contrast the palette does not have.
- Pulling `high` toward `--fs-text` collapses the ramp in dark mode.

`--text-color-low` is `--fs-faint`, the theme's third ink, not a copy of `-medium`.

Apps use a level as `color:` as often as `background:`. So every level must pass two checks, in
every palette, mode and tint hue:

1. AA 4.5:1 as text on `--fs-bg`, `--fs-panel` and `--fs-panel2`;
2. a readable `--on-*-color` as a fill.

This is checked by hand; no script in the repo measures it. Borders are exempt from the text half: a hairline may fade into the
surface.

## Palettes

Five palettes, all in `styles/03-palettes.css`, one block per palette and mode:

| Palette | Attribute | Source and notes |
|---|---|---|
| footstrap | bare `:root` (the default) | GitHub Primer colours |
| hicontrast | `data-palette="hicontrast"` | The same tokens, deeper and more saturated. Its light accents are darker than the default's, so it never contrasts worse than the default. |
| bootstrap | `data-palette="bootstrap"` | The stock LuCI theme's surfaces and greys. The canvas equals the card in light mode only, as in stock. Bootstrap has no dark third ink, so `--fs-faint` sits at the first grey that clears AA on `--fs-panel2`. |
| 2020 | `data-palette="2020"` | The OpenWrt 2020 theme's cyan on navy. That scheme is the dark mode; the light mode keeps the hue and darkens it. |
| forum | `data-palette="forum"` | forum.openwrt.org's Discourse colours, read from its computed styles. Its search-highlight yellow fills `--fs-warn`. Its header navy is the dark block's `--fs-bar-bg`: the only palette that overrides the shared `--fs-bar-bg: var(--fs-panel)`. |

A colour taken from a source theme keeps its hue and saturation. Its lightness moves until it
clears AA 4.5:1 on all three surfaces. The export tier is what other people's apps print text in.

Light mode is the bare `:root`; dark is `:root[data-darkmode="true"]`. Each dark block is
self-contained. A light block inherits from the default block, as the next section explains.

### Adding a palette

The steps, the token table and the registration checklist: [add-palette.md](add-palette.md).

### Transparency: cards and the menu over the wallpaper

Card opacity and Menu opacity let the wallpaper show through the cards and through the sidebar or
bar (issue #87). Material sets how: Flat, Frosted or Acrylic.

Both opacities default to 100%. The glass acts only under a wallpaper and below 100%. There
`fs-axes.js` and the `head.ut` pre-paint stamp `data-glass` and `data-glass-bar`. The rules live in
`theme/17-glass.css`.

#### The palette stays solid; the glass re-declares panel tokens per subtree

No paint rule changes. `17-glass.css` re-declares the `--fs-panel`, `--fs-panel2`, `--fs-track` and
`--fs-border` tokens per subtree.

A card takes the translucent panel for itself and hands a transparent one to everything inside it.
A nested card, a table frame or an ifacebox thus adds no second layer of alpha.

| Material | Inside a card | Blur under each top-level card and the menu |
|---|---|---|
| Flat | each inset in its own colour at the same opacity | none |
| Frosted | a veil of the ink | 30px |
| Acrylic | a veil of the ink | 54px |

Blur scales that radius from 0 to 200%.

Floating surfaces take the solid tokens back, because they cover other text: modals, open lists,
tooltips and the search box.

The menu's popups (bar dropdowns, rail flyouts) are the menu. So they follow Menu opacity and the
menu's material.

The export tier follows the glass. Otherwise an app's tile would sit on a glass card as a solid
block.

#### The glass is opt-in, because contrast on it is undefined

Contrast on a translucent surface depends on the pixel behind. So the glass is opt-in, and Photo
dim still darkens the photo under it.

The glass stays off when the system asks for more contrast or forces colours.

A system asking for less transparency holds back only an opacity that came from the router.
Windows' "Transparency effects" switch reaches Chromium as that query. An opacity set in this
browser is its user asking for glass here (issue #87). The Appearance page says which of the two
keeps the surfaces solid.

JS reads those queries, not `@media`. Safari and Firefox do not know `prefers-reduced-transparency`,
and an unknown query would turn the glass off there.

The Appearance page's contrast readouts measure the solid palette. They hide where the surface
itself is translucent.

#### The blur has costs

A blurred card is a stacking context and the containing block of its fixed descendants. So the card
in use (`:hover`, `:focus-within`) is lifted above its neighbours.

Chromium blurs nothing behind an element inside a blurred one. So a sticky table cell under Frosted
or Acrylic relies on a 95% fill instead.

For the same reason the bar and the rail blur on a layer under themselves (`.fs-sidebar::before`).
Their popups can then blur the page and still rise over it. The expanded sidebar scrolls and opens
no popup, so it blurs itself.

The menu takes the material the cards take:

- Flat leaves the bar, the sidebar and their popups unblurred. The page's text shows through the bar
  as it scrolls.
- Acrylic adds its grain, lit edge and shadow to the bar and the sidebar.
- Flat's one blur is the sticky table cells, at a fixed radius that Blur does not move.

The printed page keeps the solid theme.

### Ink is per palette AND per mode

`--fs-on-accent`, `--fs-on-good`, `--fs-on-warn` and `--fs-on-danger` live in `03-palettes.css`
next to their fills.

A dark palette has light fills and needs dark ink. A global `#fff` fails AA on most dark fills.

A new palette's dark block defines all four. Its light block inherits `#fff` and declares an ink only
where `#fff` fails AA on that fill. Check each ink against its own fill.

### The fourth ink is the one that says "nothing here"

`--fs-text`, `--fs-dim` and `--fs-faint` are three weights of a value. `--fs-placeholder` is what a
field shows when it holds nothing.

LuCI puts the option's default in the placeholder (`form.Value.placeholder`). In `--fs-dim` it reads
like a value the admin never typed.

It is mixed from `--fs-text` toward `--fs-panel2` in oklch. The percentage is per mode, not per
palette: 55% light, 64% dark.

This is the one token the theme ships under AA on purpose.

- A hint mistaken for a value makes an admin configure the wrong thing.
- A faint hint makes them look twice.
- The line not crossed is 3:1 (SC 1.4.11).
- `prefers-contrast: more` restores the AA ink in both modes (`theme/95-a11y-media.css`).

## The derived ladder: four steps, and the matrix is deliberately full

A tint of a role is mixed from that role, so it follows the palette. Each step has a name, so no
rule invents its own percentage.

| Step | Strength | What it is |
|---|--:|---|
| `-soft` | 12% | a quiet fill: hover on an outline button |
| `-fill` | 18% | a stronger fill: callout, diff, the invalid ring |
| `-line` | 40% | a hairline border |
| `-line-hi` | 55% | the same hairline on hover |

The role × step matrix is filled for the three roles a control can take: accent, good, danger.
Every cell exists whether or not anything reads it today. A hole is where drift starts.

`warn` has only `-fill`, because LuCI emits no warning button.

`-soft` is 12% for good and danger (`02-tokens.css`). Accent is the exception: `--fs-accent-soft`
mixes `--fs-accent` at `--fs-accent-soft-mix`, which depends on mode: 10% light, 15% dark,
hicontrast dark 14%. So the accent's `-soft` lives in `03-palettes.css`, and the 12% in the table
does not apply to it.

### Focus rings

| Token | Use |
|---|---|
| `--fs-focus-ring` | A `-soft` halo, under WCAG 1.4.11's 3:1 on its own. Use it only with a second cue: every field that takes it also turns `border-color` to `--fs-accent`. |
| `--fs-focus-ring-solo` | A control where the ring is the whole indicator: sidebar links, chrome icon buttons, section tabs, range sliders. Its 2px of surface lets it read on a filled control. |
| `--fs-focus-ring-invalid` | Takes `-fill`, so a red ring reads as an alarm. It pairs with a red border. |

### Hover, bar and the few literals

`--fs-hover-lift` brightens whatever fill the role set.

- Light darkens to `.90`, because brightening drops white on `--fs-accent` under AA.
- Dark brightens to `1.15`, since its fill is light and its ink dark.

`--fs-bar-bg` is opaque. A translucent bar shows the page through the chrome, which reads as a
glitch. The sheet has no `backdrop-filter`.

Colour literals outside the palettes are few and fixed. Do not add more.

- `--fs-scrim`: black at .7 behind a dialog;
- the black in `--fs-shadow-pop`;
- the `.fs-logo-ring` fills in `theme/10-chrome.css`;
- the print palette in `theme/97-print.css`.

## Scales

The numbers on this page are at Normal density.

### Type

Six steps in `02-tokens.css`, about ×1.25 apart:

| Token | Size | Use |
|---|--:|---|
| `--fs-type-2xs` | 10px | the port tiles' traffic figures |
| `-xs` | 11px | eyebrows, badges, tooltips |
| `--fs-type` | 13px | body, tables, fields |
| `-lg` | 16px | section titles |
| `-xl` | 20px | page titles |
| `-2xl` | 26px | `h1`, third-party only |

13px is deliberate: a router UI is dense tables of addresses and counters.

The steps are written in rem (`--fs-type` is `.8125rem`). So the px above hold at the browser's
default 16px and follow the reader's own font size (issue #88).

The same goes for every length that holds text:

- the control heights and the menu's line heights;
- the label column and `--fs-field-max`;
- the shell geometry;
- field and dropdown widths, and the table columns' flex bases;
- the chrome icons;
- the `@container` thresholds. A row folds when its text no longer fits, and that text is rem.

What stays px:

- the `@media` breakpoints;
- spacing, borders, radii and shadows. A larger font asks for larger text, not more air, and the
  browser's zoom scales them anyway;
- `--fs-type-floor`, since iOS zooms on a field under 16 CSS px whatever the root size.

The Text size axis sets `<html>`'s font-size as a share of the browser's (`--fs-text-size`). That
moves all of them at once.

### Leading

Leading is a unitless `1.5`, so it re-resolves against each element's own size. On a 13px body that
gives a 19.5px line box.

So never size a box as `--fs-type * --fs-leading`; take the nearest `--fs-space` step.

### Rounded type steps

The type steps are declared twice: unrounded in `:root`, rounded inside
`@supports (width: round(1px, 1px))`.

`round()` is newer than the floor. An engine without it would fail at substitution and compute every
`var(--fs-type)` to `unset`.

`--fs-control-h` is rounded the same way, up to the 4px control ladder.

### Field text

`--fs-type-floor` is `max(16px, --fs-type-lg)`. iOS Safari zooms when a field under 16px takes
focus.

| Token | Applies to | Desktop | Under `@media (max-width: 767px)` |
|---|---|---|---|
| `--fs-type-field` | inputs, textareas, selects, dropdown rows | body size | the floor |
| `--fs-type-field-xs` | the table filter, the Appearance hex field | dense size | the floor |

The palette search field reads `--fs-type-floor` at every width, since it focuses as it opens.

### Weight

`--fs-weight-normal` 400, `--fs-weight` 600 (the UI default), `--fs-weight-bold` 700.

### The eyebrow

Three tokens name one microlabel style:

- `--fs-eyebrow-tracking` (.06em);
- `--fs-eyebrow-weight` (700);
- `--fs-eyebrow-color` (`--fs-faint`).

It is used by table column headers, stacked-card labels, Appearance group labels, rail flyout titles
and login field titles.

Size is not part of it: 10px and 11px are two real tiers. `h6` and `.fs-navlabel` look like eyebrows
and are not.

### Radius

One user-facing base (the Rounding axis, 0–20px) derives three radii:

1. cards, panels, modals and popovers;
2. controls: inputs, buttons, dropdowns, tabs, menu items, logo;
3. small parts: chips, code, insets.

Pills and toggles are fully round. Every `border-radius` in `theme` and `pages` reads one of them.

### Z-index

`--fs-z-*`, bottom to top:

| Name | Value |
|---|--:|
| `raise` | 2 |
| `sticky` | 50 |
| `flyout` | 70 |
| `header` | 800 |
| `popover` | 850 |
| `overlay` | 900 |
| `tooltip` | 1000 |
| `dropdown` | 1100 |

Every z-index that orders layers across components comes from here. The local exceptions:

- the wallpaper element's `-1` (`theme/15-wallpaper.css`);
- the sticky table cells' `1` and `2` inside a table (`theme/30-tables.css`).

### Motion

Four durations:

| Token | Value | Use |
|---|--:|---|
| `--fs-dur` | .15s | a state change: colour, border, shadow, background, filter |
| `--fs-dur-move` | .2s | transform, max-height |
| `--fs-dur-fade` | .25s | a transient thing going away: spinner, notification |
| `--fs-dur-fill` | .4s | a progress bar growing |

There is no easing token: every transition takes the CSS default `ease`. A rule that needs another
curve says why in a comment.

### Spacing

Spacing is independent of the type scale, so a font-size change does not re-space every widget.

It is a 4px grid:

- `--fs-space-1` through `-7`: the number is the step, `-1` = 4px at Normal density;
- then `-8` (32px) and `-10` (40px);
- the half-steps `-0-5` (2px), `-1-5` (6px), `-2-5` (10px) and `-3-5` (14px). They are named because
  real insets land on them.

### Control heights

`--fs-ctl-h-sm` (30px), `--fs-ctl-h` (38px, default) and `--fs-ctl-h-lg` (44px) are minimum heights
for chrome controls: buttons, not fields.

`--fs-control-h` is a field's height, derived as the sum of:

- the text box (`--fs-type` × `--fs-leading`);
- `2 × --fs-space-1` of inset;
- two 1px borders.

It is rounded up to 32px at Normal density. All four are rem (see Type).

### Density

Density multiplies type, spacing and shell geometry through `--fs-density-type`,
`--fs-density-space` and `--fs-density-box`.

| Density | type | space | box |
|---|--:|--:|--:|
| Compact | `.9` | `.65` | `.85` |
| Normal (a bare `:root`) | `1` | `1` | `1` |
| Large | `1.15` | `1` | `1.15` |

Every type, spacing and geometry token is a `calc()` over one of them. The exceptions are the
content caps: `--fs-content-min`, `--fs-content-max`, `--fs-field-max`.

### Shell geometry

These are tokens because the JS reads them:

| Token | Value |
|---|--:|
| `--fs-sidebar-w` | 224px |
| `--fs-rail-w` | 68px |
| `--fs-content-min` | 500px |
| `--fs-content-max` | 1280px |
| `--fs-bar-h` | 46px |

`fitShell()` reads them with `getComputedStyle` to decide whether the column beside the sidebar is
readable. So the measurement follows Density, and no JS copy can drift.

`--fs-content-pad` (28px) is a token no JS reads.

### Shadow

`--fs-shadow-pop` is for floating surfaces: menus, dropdown lists, popovers, the modal.

### Two glyphs drawn as tokens, not fetched

`--fs-icon-refresh` is the poll pill's glyph, shared by the rail and the bar's compact cluster. It is
the theme's own drawing, so the theme carries no Lucide (ISC) licence obligation.

- Do not swap a Lucide `refresh-cw` back in.
- It does not spin. A spinner makes an idle poll look busy and moves the click target that pauses
  it.

`--fs-select-chevron` is two gradient bands, not an SVG data URI. A URI cannot read `var()`. The
bands take `--fs-dim` at paint time, so a new palette gets a correct chevron for free.

## The appearance axes

`view/footstrap/appearance.js` builds the controls. It is dispatched at System → Footstrap
(`admin/system/footstrap`), registered in `root/usr/share/luci/menu.d/luci-theme-footstrap.json` and
ACL-gated like any `luci-app-*` page.

The entry exists while the package is installed, whichever theme is active; see
[architecture.md](architecture.md).

The values live in `fs-axes.js`. Dark mode, layout, auto-collapse and rail live in `fs-prefs.js`.

The page groups them in four tabs, LuCI's own `ui.tabs`, with the Saving card under them:

| Tab | Axes |
|---|---|
| Colour scheme | Mode, Palette, Accent |
| Interface | Layout, Submenus, Density, Text size, Content width, Rounding |
| Background | Tint and its strength, Wallpaper, Pattern and its three axes, File and Dim, then Transparency (Card opacity, Menu opacity, Material, Blur), shown only under a wallpaper |
| Colours | Good, Warning, Danger and the four surface axes |

### Every axis: values, storage key and what it sets

One row per axis. The sections after the table explain the axes that need more than a row.

| Axis | Values | `localStorage` | `:root` |
|---|---|---|---|
| Layout | top (default) / sidebar | `fs-layout` | `data-layout` (always explicit) |
| Mode | auto / light / dark | `fs-darkmode` | `data-darkmode` + `data-theme` + `data-bs-theme` |
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
| Card opacity | 0–100%, default 100 | `fs-card-opacity` | `--fs-card-opacity`; `data-glass` below 100 |
| Menu opacity | 0–100%, default 100 | `fs-bar-opacity` | `--fs-bar-opacity`; `data-glass-bar` below 100 |
| Material | flat / frosted (default) / acrylic | `fs-material` | `data-material=flat\|acrylic` |
| Blur | 0–200%, default 100; Frosted and Acrylic | `fs-blur` | `--fs-blur` |
| Rounding | 0–20px, default 12 | `fs-radius` | `--fs-radius-base` |
| Content width | 1280–3840px, default 1280 | `fs-content-width` | `--fs-content-max` |
| Text size | 80–150%, default 100 | `fs-text-size` | `--fs-text-size` (`<html>`'s font-size) |
| Submenus | keep open / auto-collapse | `fs-menu-autocollapse` | none |

### Content width

Content width (issue #44) writes a px length onto `--fs-content-max`.

- 1280 is the width every page was designed against. So the axis only widens, and
  `--fs-content-min` stays out of reach.
- 3840 stands for "uncapped".
- The slider steps by 40px.

### Text size

Text size (issue #88) writes a percentage onto `--fs-text-size`, which is `<html>`'s font-size. So
every rem token follows it on top of the browser's own font size.

- It steps by 5%.
- It applies on release like Content width, because the page grows under the pointer.
- It re-runs the fit.

### Photo dim and the Pattern axes

Photo dim is the scrim over a `file` wallpaper. The three Pattern axes do the same for the tiled
SVG.

The images' bytes live on the router. How a browser draws them is an ordinary axis.

`--fs-login-bg-url` and `--fs-pattern-url` are `none` in the bare `:root`, so the sheet stands alone.
`head.ut` and `fs-axes.js` stamp the real `url()` inline.

`--fs-photo-scrim` mixes from `--fs-bg-base`, not the tinted `--fs-bg`. So the tint never colours an
uploaded photo.

### Pattern colours

| Value | How the SVG paints |
|---|---|
| `theme` (the default) | Through a CSS `mask`: the file supplies alpha and the theme supplies `--fs-text`, correct in both modes and every palette. |
| `original` | The mask drops for a plain tiled `background-image`, keeping artwork that carries its own colours. |

`fs-wallpaper` alone decides whether anything paints.

### Wallpaper rendering: why the canvas moves to `:root`

The pattern is a dedicated `.fs-pattern` element, `<body>`'s first child. It is emitted by
`header.ut`, and by `sysauth.ut`, which has no `.fs-shell`.

A mask applies to the element's children too. So it cannot sit on `.fs-shell` or `<body>`.

`.fs-pattern` sits at `z-index: -1`. In the root stacking context a negative-z child paints under
every block background. So the canvas colour moves to `:root`, and `body`, `.fs-main` and the footer
go transparent.

Both wallpapers use `background-attachment: fixed`.

The uploaded photo (`file`) paints on one element: `.fs-shell`, or `body` before login.
`--fs-photo-scrim` is a second `background-image` layer on the same element.

There is no `::before` and no `backdrop-filter`: a full-viewport blur is the most expensive paint a
phone does.

`prefers-reduced-transparency` is not honoured here: an opaque scrim would hide the admin's photo
(#66).

### Three more `fs-` keys are not axes

| Key | Holds |
|---|---|
| `fs-rail` | the sidebar collapsed to its icon rail |
| `fs-menu-open` | the open accordion sections |
| `fs-recent` | the command palette's history |

None has a router default. So `fs-rail` may delete its key on the off state, where an axis may not.

### Three layers, and the browser always wins

The effective value of every axis is `localStorage` ?? router default ?? built-in.

| Layer | What it is |
|---|---|
| `localStorage` | This browser's own choice. It overrides the router default in either direction. |
| router default | What Save to router writes. `saveAsDefault()` uci-sets the axes into `/etc/config/footstrap`. The server passes them as `window.__fsSD`, which `head.ut` stamps. A new browser, a private window or a cleared cache inherits the router's look, the login page included. |
| built-in | A bare `:root`. |

Every applier therefore stores its choice explicitly, the off or default value included.

Why: once a router default exists, a missing key means "inherit the router default". Deleting the
key could not express "the built-in, not the router default".

`lsDel` is reserved for Reset to router.

### Nothing else writes to the router

Only Save to router writes `/etc/config/footstrap`. The only other uci writes on the page are two:

- the login-background token on upload;
- its blanking on remove.

No axis writes through on change, `wallpaper` and `photo_dim` included. A per-browser pick must
never change the default for every other device.

`/etc/config/footstrap` ships as an empty stub and is written at runtime, so it must be a conffile;
see [package.md](package.md).

#### Every axis is implemented twice

1. Inline in `partials/head.ut` before first paint, where `require` does not exist yet.
2. Live in `fs-axes.js`, or `fs-prefs.js` for dark mode, layout, auto-collapse and rail.

The JS is the contract, and the template follows it. They agree on keys, `:root` attributes, custom
properties and ranges.

They agree on every slider's limits and default in four places: JS, pre-paint, the sanitiser's range
table, CSS token.

They follow one ordering rule: custom property first, attribute second. Reversed, a reload paints
one frame in the previous hue.

### The colour axes, and why the slider went

Nine axes take a colour: Tint (the canvas), Accent, Good, Warning, Danger, and the four surfaces
Cards, Controls, Sidebar and Borders.

Each holds off, a hue 1–360°, or a `#rrggbb`, and `data-<axis>` says `hue` or `hex`. The surfaces
hold only a colour: they set an inline custom property and no attribute (`surfaceAxis` in
`fs-axes.js`).

The page offers only the hex field. A hue slider keeps the palette's chroma, so no angle reaches a
grey (#20). Hue mode stays in storage and in the stylesheet, so a saved hue keeps painting.

The ink over a hex fill is derived in JS. `inkFor()` writes `--fs-on-accent` and the three status
inks inline: black above OKLab L .62, white below. It lives in `fs-axes.js`, with a copy in the
`head.ut` pre-paint that must stay equal.

An inline custom property outranks every stylesheet rule. So no palette block can leave a grey
accent with near-black ink.

Surfaces get no derived ink. Text on them stays `--fs-text`, so the page shows the contrast each
choice lands at instead.

### Tint and Accent

In hue mode both are an angle 1–360°, both rotate `oklch(from …)`, and both default to off (no
attribute).

#### Tint

Tint (`data-tint`, `--fs-tint-h`) washes a hue into the canvas (`--fs-bg`), so each router can look
different at a glance. `localStorage` is per origin, so this needs no server state.

Nothing else moves. Cards, chrome and status colours keep their palette values, so a status colour
never lies.

It rotates chroma and hue instead of mixing a colour in. `color-mix` in a polar space gives the same
colour for small percentages on a dark canvas.

Tint strength (`--fs-tint-strength`, 0–200%, default 100) multiplies the tint chroma. It applies
only while a hue is set. It is hidden under a `file` wallpaper, where the photo covers the canvas.

`--fs-tint-c` is the chroma the hue is applied at. It is a floor plus two `cos()` terms per mode,
tuned against the palettes' blue-grey canvases; the reasoning is in `styles/03-palettes.css`. Keep
it small: it is an identity cue, not a colourway.

#### Accent

Accent (`data-accent`, `--fs-accent-h`) rotates the interface colour. Every accented control reads
`--fs-accent` or a mix of it.

`oklch(from … l c H)` keeps lightness and chroma and changes only the hue. So `--fs-on-accent` stays
readable at any angle.

#### Why the palette declares `-base` tokens

`--fs-bg` cannot be defined through itself: that is invalid at computed-value time. So the palette
declares the raw `--fs-bg-base` and `--fs-accent-base`, and one block derives the rest.

## Typography

The theme carries no fonts. `--fs-font-sans` and `--fs-font-mono` (`02-tokens.css`) name Manrope and
JetBrains Mono first and the system stack after:

```
--fs-font-sans: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--fs-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

A bare family name matches fonts installed on the visitor's machine. An admin with either face
installed sees it. One without falls through with no request and no 404.

Mono is for values: addresses, hostnames, versions, port names.

### There is no bold mono, and it must not come back

`<strong>` is a label: LuCI writes `<strong>MAC:</strong> ac:1f:6b:…`. So on a monospace surface it
takes the sans face (`theme/45-misc.css`; likewise `.ifacebadge`, `code` and `pre`).

Mono at weight 600 or more is a synthetic bold that smears the grid. A rule that "needs bold mono"
is a label, and a label is not mono.

Excluding an element from the mono rule is not enough: it still inherits mono from its parent.
Assign the sans face. Adding `strong` to a `:not()` changes nothing.

### Column headings are not uppercased

A table's column heading uses the eyebrow size, weight, tracking and ink, but not
`text-transform: uppercase`.

The string is the app's. Uppercase prints LuCI's `IPv4 address` as `IPV4 ADDRESS` (issue #39). LuCI
also copies the heading's `innerText` into `data-title` for the cards.

Four rules hold this together:

1. `.cbi-section .table .th` in `theme/30-tables.css`;
2. the title row in `theme/30-tables.css`;
3. the card label copy in `theme/65-dropdown.css`;
4. the alert's table in `theme/35-alerts.css`.

The chrome's own eyebrows stay uppercase: menu section labels, KPI captions, the search palette's
group headings. They are the theme's words.

`PKG_LICENSE` is Apache-2.0 alone. With no font files in the package, declaring OFL-1.1 would be
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
- The `<link>` is emitted only when the token is non-empty. The token is written only after the file
  exists.

None of the three is an axis: no `localStorage`, no Appearance control, no entry in
`snapshotAxes()`. A font belongs to the router, not to a visitor.

## Meter polarity

`annotateMeter()` (`fs-overview.js`, Overview only) colours a `.cbi-progressbar` by its fill: warn
at 80%, danger at 92% (`FS_METER_WARN`, `FS_METER_DANGER`).

A fill is not always "how much is used". "Total Available" is healthy when high, and a free swap
reads 100%.

The three cases are keyed on the row's label: `_(msgid)`, no msgctxt, the same match `ROLES` makes.
Every msgid used is in luci-base's `base` domain, loaded on every admin page.

| Case | Labels | Colour |
|---|---|---|
| Inverted | "Total Available", "Swap free" (`FS_METER_INVERTED`) | The bar reads `100 - level` against the same thresholds. |
| Neutral | "Buffered", "Cached" (`FS_METER_NEUTRAL`) | No colour. A full page cache is the kernel doing its job. |
| Anything else, including any app's meter | | Keeps the fill-based colour. Most bars are used-based, so fill-based is the fallback. |

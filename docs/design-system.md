# Design system: tokens, palettes, type

What the theme's values are and why they are those values. How the stylesheet is built and how the
cascade is kept disciplined: [css.md](css.md). What the chrome does with them:
[chrome.md](chrome.md).

**There is one system.** One renderer (`menu-footstrap.js`), one template directory, one
`cascade.css`, one entry in `luci.themes`. Layout (sidebar or top bar) is a client setting,
`:root[data-layout]`, always with an explicit value.

**No colour literals in this page on purpose** — a colour written in two places drifts, and it
already has: this document was once read as the source for `--accent-soft: rgba(9,105,218,.10)`,
the very per-component copy the project killed. Values live in `styles/02-tokens.css` and
`styles/03-palettes.css`, with the reasoning in a comment beside each one.

## Two tiers, and the split is load-bearing

- **The private tier `--fs-*`** (`02-tokens.css`, `03-palettes.css`) — `--fs-bg`, `--fs-panel`,
  `--fs-panel2`, `--fs-border`, `--fs-text`, `--fs-dim`, `--fs-faint`, `--fs-placeholder`,
  `--fs-accent`, `--fs-good/-warn/-danger`, `--fs-track`, plus the radius, z-index, duration and
  spacing scales.
  **Every rule in the theme reads this and only this.**
- **The export tier `--*-color-*`** — the conventional LuCI names (`--primary-color-high`,
  `--text-color-*`, `--border-color-*`, `--on-*-color`), defined from the private tier and read
  by nobody inside the theme. This is not a bridge, it is a one-way export:
  `audit.py --strict` **fails the build** on any read of an export name from `styles/`.

Why: `:root` is a shared scope, and every `luci-app-*` puts its CSS in the same document
**unlayered**, where it outranks any `@layer`. One app declaring `:root { --accent: … }` — or
`--radius`, `--text`, `--border`, names anyone would take — silently recoloured the whole theme.
Reading export names from `base` was the wider hole still: `--text-color-high` is a
*convention*, so an app declares it more readily.

| Hostile `:root` over `gallery.html` | elements recoloured |
|---|--:|
| before the split | **312 of 336** (93%) |
| after | **0** |

The exception is a local variable declared inside the very rule that reads it (`--bd-color`,
`--fg-color`, `--on-color`, `--focus-color`): a foreign `:root` cannot intercept those.

```css
/* NO — reading an export name; the gate fails */
color: var(--text-color-medium);
/* YES — the private tier */
color: var(--fs-dim);
```

Third-party apps get the other side of this contract in
[luci-app-styling-guide.md](luci-app-styling-guide.md).

### The export tier is a RAMP, not a set of aliases

`high`/`medium`/`low` must be **three different colours**: a consumer asks for a gradation and gets
whatever we declared. All three were once aliases of one token — and `luci-app-podkop` drew its
"no data" latency in `--primary-color-low`, i.e. the same bright accent as a live value. **A flat
colour passes every contrast threshold there is**, so nothing failed; it failed at the user. Not a
rare ask: stock `firewall.js` and `status/cpu.js` read the ramp too, and one app alone reads eleven
of these names. Direction follows bootstrap's, which every app was calibrated against — `high` is
the most pronounced value of the role, except `--background-color-*`, an ELEVATION axis instead
(`high` = raised); the mixing mechanism differs per family and is measured in each block below.

The axis of the ramp is **chroma at constant lightness** (`color-mix(in oklch, …, var(--fs-dim))`),
which drains saturation while leaving luminance in place, keeping every level printable as text.
Both obvious alternatives were measured and rejected: fading `low` toward the surface spends
contrast the palette does not have (in dark mode every accent on `--fs-panel2` already sits at
4.56:1, i.e. +0.06 over AA; an 8% fade took one level to 4.18:1), and pulling `high` toward
`--fs-text` collapses the ramp in dark mode where `--fs-text` is nearly white (the strong end comes
back 0.055 from the weak end — flat). Bootstrap's own ramp walks lightness instead, which is why it
reads inverted in dark mode and lands at 3.6:1 — this theme keeps its direction and drops its
mechanism.

`--text-color-low` is `--fs-faint`, the theme's own third ink, and deliberately not a duplicate of
`-medium`: making the two the same token flattens the export (`spread(high, low)` falls to 0.082 in
the default palette, under the 0.10 the ramp promises) and hands an app asking for a gradation one
colour twice.

The binding constraint: apps read a level as `color:` about as often as `background:`, so every
level must pass AA as text on `--fs-bg`/`--fs-panel`/`--fs-panel2` and carry a readable
`--on-*-color` as a fill. `tools/export-tier.mjs` proves all of it across
{footstrap, hicontrast, bootstrap, 2020} × {light, dark} × a sweep of tint hues — 56 combinations
and 4352 contrast checks today — including that the ramp is not flat, the only check that can catch flatness.
Borders are exempt from the text half: `--border-color-low` may legitimately fade into the surface,
which is what a hairline is for.

## Palettes

Five, all in `styles/03-palettes.css`, one self-contained block per (palette × mode):
**footstrap** (GitHub Primer colours, the default, filling a bare `:root`), **hicontrast**
(`data-palette="hicontrast"`), **bootstrap** (`data-palette="bootstrap"`, the stock LuCI theme's
surfaces and greys), **2020** (`data-palette="2020"`, the OpenWrt 2020 theme's colourway) and
**forum** (`data-palette="forum"`, the OpenWrt forum's Discourse colourway). Light mode is the bare
`:root`; dark is `:root[data-darkmode="true"]`.

### Adding a palette

Copy the two hicontrast blocks (light and dark), set every colour — five go through a `-base` pair
so the tint/accent/colour axes can recolour them, since a palette never declares `--fs-good` etc.
directly — and the four inks, then register the name in four places, each failing differently and
quietly if skipped: the PALETTE axis in `fs-prefs.js`, the `_sd_pal` whitelist and pre-paint switch
in `partials/head.ut`, the label map in `fs-appearance.js`, and `matrix()` in
`tools/lib/gallery.mjs` (absent there, `export-tier.mjs`, `a11y-gallery.mjs` and
`placeholder-ink.mjs` never measure the new palette, and it ships ungated).

### Surfaces carry no transparency axis

`--fs-panel`, `--fs-panel2` and `--fs-border` are solid colours per palette, on purpose: thinning a
surface thins the TEXT sitting on it out from under it, and the contrast tooling cannot even report
the result — a ratio against a semi-transparent backdrop is a ratio against whatever pixel sits
behind it. The wallpaper axis is the honest way to have a picture show through.

**bootstrap** carries the surfaces, greys and semantic colours of the stock theme, so an admin who
wants that look keeps it and still gets the chrome, the client navigation and the axes. Bootstrap
computes everything from HSL axes; evaluated, those are `--background-color` high/medium/low
`#fff`/`#f9f9f9`/`#f5f5f5` (dark `#222`/`#282828`/`#2c2c2c`), `--text-color` high/medium
`#404040`/`#808080` (dark `#bfbfbf`/`#7f7f7f`), `--border-color` high/medium `#ccc`/`#ddd`
(dark `#555`/`#444`). The canvas and the card are both `--background-color-high`: bootstrap is flat
and lets the border carry the structure; panel2 is its `--background-color-low`, the surface it
stripes tables and hovers rows with. Where this palette deviates: bootstrap's own semantic colours
do not clear AA on bootstrap's own surfaces (on `--fs-panel2`, success 2.73:1, warn 1.61:1, error
3.65:1, primary 4.22:1; in dark, error 3.44:1 and success 4.44:1), and every palette here is held
to 4.5:1 on all three because the export tier is what other people's apps print text in — so each
is taken from the step of bootstrap's own ramp that clears it where one exists, and otherwise keeps
hue and saturation while the value moves until it clears 4.95:1 (warn is the only large move: no
yellow readable as text on white is still that yellow). The ink follows the same logic: bootstrap's
own `#404040` body and `#6a6a6a` muted tier measure 10.4:1 and 5.4:1 on white, and the muted one
carries every field title, so it is matched to the default palette's light ramp ratio for ratio
(15.7 / 11.7 / 10.0) in neutral greys — the hue is copied, not the readability. Bootstrap's dark
header gradient is not carried: the chrome reads `--fs-panel`, so a palette cannot give the bar its
own colour without a chrome token pair, which is a change to the chrome, not a colourway. Its dark
neutral tiers are this palette's own construction — bootstrap's dark has no third ink, so AA
decides where the fainter one sits: `--fs-faint` follows the export tier's `-low`, which on a
tinted `--fs-panel2` clears 4.5:1 first at `#9a9a9a` (`#969696` measures 4.46:1, under the floor a
name apps print text in), and `--fs-dim` steps up from it by the twelve channel steps the
hicontrast dark ramp uses. Its own dark `--background-color-low` (`#2c2c2c`) also sits 0.016 from
`--fs-panel`, under the 0.02 the ramp check wants (its light pair is 0.039 apart, so the same check
catches this in the theme this palette is named after) — `--fs-panel2-base` moved to `#303030`
(0.031) to clear it.

**forum** is sampled straight off forum.openwrt.org's own `getComputedStyle`, one read per colour
scheme rather than a guess: light ink `#222`/page `#fff`/accent `#0088cc`, dark ink `#ddd`/page
`#222`/accent `#0f82af`, plus its success, danger and highlight (search-hit) colours. None of the
six clears 4.5:1 as text on the surface Discourse pairs it with — its own contrast rules are for a
filled pill or an icon, not for the export tier every app prints text in — so each is walked the
way 2020's cyan was, hue and saturation held while lightness moves until AA clears (worst case
1.07:1 on white, for the yellow search-highlight that has no footstrap analogue and fills `--fs-warn`
instead, being the only status colour Discourse's scheme leaves spare). The forum's CANVAS never
takes the header bar's navy (`rgb(0, 43, 73)`): its own dark scheme already has a canvas colour,
`#222`, unlike 2020's theme which had none to sample. The navy is carried into exactly one place —
`--fs-bar-bg` in the forum's dark block, since that IS the chrome's own surface on forum.openwrt.org
(measured live: `#ddd` ink at 10.7:1 on it, dimmed ink at 5.8:1) — the one palette that overrides
the shared `--fs-bar-bg: var(--fs-panel)` from `02-tokens.css`.

**2020** is the CI cyan `#00B5E2` on the navy `#002B49`, which is one scheme and no dark mode in
the theme it comes from. Here it is a pair, and the split is the interesting part: 2020's own
scheme IS the dark mode — navy canvas, cyan nearly untouched — while the light mode keeps the hue
and darkens it, because `#00B5E2` measures **2.09:1** on white and the export tier every app prints
text in wants 4.5. Its three semantic colours move for the same reason: on white 2020's green is
2.28:1 and its amber 3.42:1, while its red at 5.25:1 is the one kept where it was.

**hicontrast** is the same tokens, deeper and more saturated. Its light accents are deliberately
darkened: they used to be *brighter* than the defaults, so a palette named "hicontrast" contrasted
**worse** than the default (`--fs-good` as a label on `--fs-panel` — **2.55:1** against **5.08:1**).

### Ink is per palette AND per mode

`--fs-on-accent` / `--fs-on-good` / `--fs-on-warn` / `--fs-on-danger` live in `03-palettes.css`
next to the fills they have to be readable on. A dark palette has light fills and therefore
needs dark ink: one global `--fs-on-accent: #fff` failed WCAG AA on seven of eight dark fills,
down to **1.69:1** against a required 4.5. A new palette must define all four and check them
against its own fills.

### The fourth ink is the one that says "nothing here"

`--fs-text`, `--fs-dim` and `--fs-faint` are three weights of a value. `--fs-placeholder` is not a
weight of anything — it is what a field shows when it holds NOTHING, and LuCI puts the option's
default there (`form.Value.placeholder`). Drawn in `--fs-dim` it measured 11.12:1 on footstrap
light's field fill against the value's own 14.84:1, near enough that two forum readers reported
fields as holding values they had never typed.

It is mixed from `--fs-text` toward `--fs-panel2` in oklch, because the step is a lightness one, and
the PERCENTAGE is per mode rather than per palette — 55% light, 64% dark. Dark is the constrained
half: its ink starts at 6.45:1 on the field against light's 14.84:1, so the same percentage there
would buy a hint nobody can read.

**This is the one token the theme ships deliberately under AA** — 3.99-4.48:1 in light, 3.43-6.05:1
in dark, at 43-44% and 33-35% of the ink-to-field range — because a hint mistaken for a value makes a
reader configure the wrong thing, while a hint at 3.43:1 makes them look twice. The AA-clearing mixes
were measured first and moved 37% and 20%: the same fault, quieter. 3:1 (SC 1.4.11) is the line not
crossed, and `prefers-contrast: more` buys the AA ink back in both modes
(`theme/95-a11y-media.css`): that reader has said which of the two they want.

`placeholder-ink` holds both ends across the eight palette/mode combinations and runs each of them
again under the query. It is the only gate that can: axe-core does not measure `::placeholder` at
all, and it is excluded from the `li[placeholder]` row that carries the same ink, since a rule
reaching half a decision would fail it.

## The derived ladder: four steps, and the matrix is deliberately full

A tint of a role is mixed from that role, so it follows the palette and cannot go stale. What
it lacked was a name, and an unnamed step drifts silently: the same border was 40% in a table
and 45% in an action panel, the same diff block 30% in `base` and 18% in `theme`, the same hover
fill 12% here and 18% there — four forces where the design knows two.

| Step | Strength | What it is |
|---|--:|---|
| `-soft` | 12% | a quiet fill — hover on an outline button |
| `-fill` | 18% | a stronger fill — callout/diff, the invalid ring |
| `-line` | 40% | a hairline border |
| `-line-hi` | 55% | the same hairline on hover |

The role × step matrix is **filled completely for the three roles a control can take** —
accent/good/danger — whether or not anything reads a cell today: a hole is exactly where the drift
started (`--fs-accent-soft` existed, the other two roles had no sibling, and every rule invented
its own percentage). `warn` is the one role kept to a single cell, `-fill`: LuCI emits no warning
BUTTON, so `-soft`/`-line`/`-line-hi` had zero `var()` readers across `styles/`, `htdocs/`, `ucode/`,
`docs/gallery.html` and `tools/`, and were dropped when checked. `--fs-accent-soft` is the one
member of the four kept out of this file, because its strength is the only one that depends on mode
(10% light / 15% dark; hicontrast dark 14%) — light is shared in `03-palettes.css`'s `:root`, dark
varies per palette.

Two focus rings, and which one a control takes is the contract: **`--fs-focus-ring`** is a `-soft`
tint halo (1.15-1.29:1 on its own surface, below WCAG 1.4.11's 3:1) and is legitimate only paired
with a second channel — every field taking it also flips `border-color` to `--fs-accent`
(4.57-7.04:1 across palette × mode × surface), so the border is the indicator and the tint is the
halo. **`--fs-focus-ring-solo`** is for a control where the ring is the WHOLE indicator and nothing
else changes on focus — sidebar links, chrome icon buttons, section tabs, both range sliders — and
its 2px of surface is what lets it read against a *filled* control (5.19-7.04:1 on panel,
4.61-7.55:1 on canvas), where an accent ring would otherwise sit on an accent box.
**`--fs-focus-ring-invalid`** takes `-fill` (18%), not `-soft`: a red ring must read as an alarm
rather than a hover tint, and it is paired with a red border.

`--fs-hover-lift` is the one hover cue that cannot be a colour, since it brightens whatever fill
the role set, and its **direction depends on mode**: light darkens to `.90` (brightening instead
drops white-on-`--fs-accent` from 5.19:1 to 4.08:1 at a visible 1.15 — an AA failure caused by
hovering), dark brightens to `1.15`, since its fill is light and its ink dark.

**`--fs-bar-bg` is opaque, not translucent, and stopped being a decision the moment it was
measured.** A `backdrop-filter` blur under it was tested on the page most favourable to it — a
pattern wallpaper at full strength, the bar sitting over scrolled content — and removing the blur
moved **0.04%** of pixels: what the translucency bought was the page showing through the chrome,
which reads as a glitch rather than as glass. Every `backdrop-filter`, prefixed or not, is gone
from the sheet ([css.md](css.md) "Vendor prefixes still in the sheet"), so
`prefers-reduced-transparency` (`theme/95-a11y-media.css`) now has nothing left to opt out of — the
theme is opaque already, and its handler only flattens the one thing that still varies: the wash
over an uploaded photo. **`--fs-scrim` is the theme's one colour literal and stays one**: black at
.7 is the absence of light behind a dialog, not a shade of any token.

## Scales

**Type** — five steps in `02-tokens.css`, roughly ×1.25 apart: `--fs-type-2xs` 10px, `-xs` 11px
(eyebrows, badges, tooltips), `-type` 13px (body, tables, fields — the base), `-lg` 16px (section
titles), `-xl` 20px (page titles), `-2xl` 26px (`h1`, third-party only). 13px is deliberate: a
router UI is dense tables of addresses and counters. Leading is a unitless `1.5` rather than a hard
`18px`, so it re-resolves against each element's own size instead of being inherited as a fixed
line box that clips a smaller heading; that gives a fractional line box (13 × 1.5 = 19.5px) on an
otherwise whole-px scale, so a BOX must never be sized `--fs-type * --fs-leading` directly — take
the nearer `--fs-space` step. `--fs-type-2xs` exists for one caller, the Port status card's traffic
figures: at `-xs` the card floor is 106px, at 10px it is 94px, which is what turns ten cards plus a
lonely eleventh into one row of eleven.

Declared twice, unrounded in `:root` and rounded in `@supports (width: round(1px, 1px))`, because
`round()` (Chromium 125 / Firefox 118 / Safari 15.4) is younger than the sheet's own floor and a
custom property holds any token stream — an engine without it parses the ladder fine and fails at
*substitution*, computing every `var(--fs-type)` reader to `unset`. Measured by serving a sheet with
`round(` renamed: 5881 of 5912 elements on Overview changed, body type went 13px → 16px, and 5880
`font-size` plus 5733 `line-height` declarations were lost. Declared unrounded first, such an engine
keeps the whole ladder and only pays a fractional pixel at the two non-default densities.
`--fs-control-h` is rounded the same way, up to the 4px control ladder.

**Weight** — three values, `--fs-weight-normal` 400 (no face of its own; resolves onto the 600
face, which is why body text is semibold by design), `--fs-weight` 600 (the UI default) and
`--fs-weight-bold` 700. `700`/`bold` and `400`/`normal` were both in use as the same weight before
these were named.

**The eyebrow** — `--fs-eyebrow-tracking` (.06em), `--fs-eyebrow-weight` (700) and
`--fs-eyebrow-color` (`--fs-faint`) name one microlabel idiom drawn a dozen places: table column
headers, stacked-card `data-title` labels, Appearance group labels, rail flyout titles, login field
titles. It had drifted into four spellings (tracking .04/.05/.06em, weight 600 vs 700, ink `--fs-dim`
vs `--fs-faint`) before being named — the same unnamed-level drift the derived ladder above stops,
in typography. Size is deliberately not part of it: 10px and 11px are two real tiers and collapsing
them resizes half the tables. `h6` (a heading) and `.fs-navlabel` (the menu's section separator,
wider-tracked because it separates rather than captions) look like eyebrows and are not.

**Radius** — one user-facing base (Footstrap page → Rounding, **0–20 px**), from which three semantic
radii are derived proportionally: cards/panels/modals/popovers, controls (inputs, buttons,
dropdowns, tabs, menu items, logo) and small parts (chips, code, insets). Pills and toggles are
always fully round. Every `border-radius` in `theme`/`pages` reads one of them.

**Z-index** — `--fs-z-*`, and **every z-index in the theme comes from here**. Bottom to top:
`raise` 2 → `sticky` 50 → `flyout` 70 → `header` 800 → `popover` 850 → `overlay` 900 →
`tooltip` 1000 → `dropdown` 1100. Before the scale there were nine bare numbers across seven files
and nothing fixing the order — the appearance popover of the day drew **on top of** an open modal.
As a list, that bug is obvious.

**Motion** — four durations, because the UI does four things: `--fs-dur` .15s (state change:
colour, border, shadow, background, filter), `--fs-dur-move` .2s (transform, max-height),
`--fs-dur-fade` .25s (something transient going away: spinner, notification), `--fs-dur-fill` .4s
(a progress bar growing to its value). There were seven durations (.12/.125/.15/.2/.22/.25/.4) and
four curves, none of them chosen.

**There is deliberately no easing token**: every transition omits the timing function and takes the
CSS default (`ease`) — one curve, nothing to keep in sync, and fewer bytes than naming it. A rule
that needs a different curve should justify it in a comment, because it is making a design decision.

**Spacing** — independent of the type scale on purpose: the 18px/9px pair used before this grid was
upstream bootstrap's line-height and half of it, so every gutter in the theme was a function of
Twitter's leading, and changing the font size silently re-spaced every widget. A 4px grid in
`02-tokens.css`: `--fs-space-1` through `-7` at 4px apart (the number is
the step, `-1` = 4px at normal density), then a sparse top of `-8` (32px) and `-10` (40px) with two
or three callers each (the sidebar accordion indent, the search palette's bottom padding, a login
card's bottom margin) — named so no padding in the theme is an unexplained number, not because a
fourth caller is expected. The half-steps `-0-5` (2px), `-1-5` (6px), `-2-5` (10px) and `-3-5`
(14px) are named rather than rounded away: a chip's inset, a nav item's row padding and a card's
inner gutter genuinely land on 6/10/14, and were the single largest group of magic numbers left in
the tree (6px ×26, 10px ×32, 14px ×13, 2px ×13) before they were. Above 16px the grid stays 4px —
nothing needs finer.

**Control heights** — three steps following Density, `--fs-ctl-h-sm` (30px), `--fs-ctl-h` (38px,
the default) and `--fs-ctl-h-lg` (44px): a minimum height that stops a chrome control (a button, not
a field) collapsing onto its content. Distinct from `--fs-control-h`, a *field's* height derived
rather than measured by hand: the text box (`--fs-type` × `--fs-leading` = 19.5px) plus the vertical
inset every such field carries (2 × `--fs-space-1`) plus both 1px borders = 29.5, rounded up to 32
at normal density — arithmetic over one particular leading, so re-scaling the type never leaves a
field the wrong height for its own text.

**Density** multiplies the type scale, the spacing scale and the shell geometry, through three
tokens the Density axis sets: `--fs-density-type`, `--fs-density-space` and `--fs-density-box`.
Compact is `.9` / `.65` / `.85`, Normal is `1` / `1` / `1` (a bare `:root`, so the default costs no
attribute), Large is `1.15` / `1` / `1.15` — the air gives up the most at Compact and does not grow
at Large, so the two ends are deliberately not mirror images. Every type, spacing and geometry token
is a `calc()` over one of them — which is why the numbers below are quoted **at normal density**.

**Shell geometry** — `--fs-sidebar-w` (224 px), `--fs-rail-w` (68 px), `--fs-content-min` (500 px),
plus `--fs-content-max` (1280 px), `--fs-content-pad` (28 px) and `--fs-bar-h` (46 px) — **tokens
rather than literals because the JS reads them**: `fitShell()` uses `getComputedStyle` to subtract
the sidebar's slice from the viewport and decide whether the remaining column is readable. The JS
used to keep its own copies against bare literals in the CSS, so narrowing the rail in styles left
the measurement quietly subtracting the old width. Reading them through `getComputedStyle` is also
what makes the measurement follow Density for free.

Shadows are `--fs-shadow` (per mode) and `--fs-shadow-pop` (floating surfaces).

### Two glyphs drawn as tokens, not fetched

**`--fs-icon-refresh`** (the poll pill's refresh glyph, one copy shared by the rail and the bar's
compact cluster) is OURS and redrawn to stay so: it started from Lucide's `refresh-cw` (ISC) —
`M21 3v5h-5` was byte-identical — which is a second licence obligation the theme never declared.
Redrawn as two open arcs with solid triangular heads, a different construction rather than a nudge
of the same one (Lucide caps a continuous stroke with an L-shaped hook; chevrons were tried and
dissolve at the 18px this renders at). Static on purpose — a spinner makes an idle poll look busy
and moves the click target that pauses it.

**`--fs-select-chevron`** replaced an inline SVG data-URI repeated once per palette and once per
mode (ten copies, ~2.4 KB of the shipped sheet), because a URI cannot read `var()` and needed the
stroke colour written into the string. Two gradient bands cost one declaration and take
`--fs-dim` at paint time, so a new palette gets a correct chevron for free; the round line cap the
SVG had is not visible at 12px (compared side by side before the swap).

## The appearance axes

The controls are `fs-appearance.js`, which builds the form; `view/footstrap/appearance.js`
dispatches it at a route of its own, **System → Footstrap** (`admin/system/footstrap`, registered
in `root/usr/share/luci/menu.d/luci-theme-footstrap.json`, ACL-gated the same as any `luci-app-*`
page). It used to be a fifth tab stapled onto the stock **System → System** page instead, beside
General Settings / Logging / Time Synchronization / Language and Style — watching `body[data-page]`
the way `fs-overview.js` does, then appending one `.cbi-tabcontainer` and one `<li>` to the group
`ui.tabs` had already initialised by hand, because `initTabGroup()` returns immediately on a group
carrying `data-initialized` and clearing that flag builds a *second* menu beside the first. That
workaround stood in for a route: a `luci-theme-*` package was believed unable to register a
dispatcher node of its own. It can — the entry belongs to the package, not to being the *active*
theme, so it is present for exactly as long as the package is installed, regardless of which theme
is selected — and `docs/architecture.md` has the boundary that replaced the old belief.

The values live in `fs-prefs.js`. Grouped the way the page groups them — **Interface** (Layout,
Theme, Palette, Density, Rounding, Submenus), then the **Colours** fold (Tint and its strength, the
four colour axes, the four surface axes), then the **Background** fold (Wallpaper, Dim, Pattern and
its three axes, File), then **Defaults**:

| Axis | Values | `localStorage` | `:root` |
|---|---|---|---|
| **Layout** | **top** (default) / sidebar | `fs-layout` | `data-layout` (always explicit) |
| **Theme** | auto / light / dark | `fs-darkmode` | `data-darkmode` + `data-theme` + `data-bs-theme` |
| **Palette** | footstrap / hicontrast / bootstrap / 2020 / forum | `fs-palette` | `data-palette` |
| **Density** | compact / normal / large | `fs-density` | `data-density` |
| **Wallpaper** | off / pattern / **file** | `fs-wallpaper` | `data-wallpaper` — `pattern` tiles an admin-uploaded SVG through a CSS mask; Scale, Strength and Colours are axes of their own |
| **Tint** | off, hue 1–360°, `#rrggbb` | `fs-tint` | `data-tint=hue\|hex`, `--fs-tint-h` / `--fs-bg` |
| **Tint strength** | 0–200%, default 100 | `fs-tint-strength` | `--fs-tint-strength` |
| **Accent** | off, hue 1–360°, `#rrggbb` | `fs-accent` | `data-accent=hue\|hex`, `--fs-accent-h` / `--fs-accent` |
| **Good / Warning / Danger** | same shape as Accent | `fs-good`, `fs-warn`, `fs-danger` | `data-good\|warn\|danger`, `--fs-*-h` / `--fs-*` |
| **Cards / Controls / Sidebar / Borders** | off, `#rrggbb` | `fs-card`, `fs-control`, `fs-bar`, `fs-line` | — (inline `--fs-panel`, `--fs-panel2`, `--fs-bar-bg`, `--fs-border`) |
| **Photo dim** | 0–100%, default 74 | `fs-photo-dim` | `--fs-photo-dim` |
| **Pattern scale** | 40–1600 px, default 440 | `fs-pattern-size` | `--fs-pattern-size` |
| **Pattern strength** | 0–100%, default 20 | `fs-pattern-strength` | `--fs-pattern-strength` |
| **Pattern colours** | theme / original | `fs-pattern-ink` | `data-pattern-ink=original` |
| **Rounding** | 0–20 px, default 12 | `fs-radius` | `--fs-radius-base` |
| **Content width** | 1280–3840 px, default 1280 | `fs-content-width` | `--fs-content-max` |
| **Submenus** | keep open / auto-collapse | `fs-menu-autocollapse` | — (no attribute) |

**Content width** (issue #44, a slider replacing a three-step picker) is a real px length written
straight onto `--fs-content-max`, the same shape Rounding uses. Neither end of the range is derived
from this file: 1280 is the value the theme has always drawn, so the slider's left end *is* today's
look and the axis can never go narrower than its own default — unlike every other numeric axis,
none of which has a floor that is also the default. `--fs-content-min` (500px) is the width this
axis has to stay clear of; with 1280 as the floor that is now a property of the range, 780px below
the nearest point the slider reaches. 3840 stands in for "uncapped": no CSS viewport width in
ordinary use reaches it, even a physical 4K panel reporting a scaled CSS width well under it. The
step is 128px (2,560px of travel at 20 stops, matching Rounding/Photo dim/Pattern strength's stop
count rather than Pattern scale's near-pixel drag) — a stop here should move a table's column
count, not shave a pixel off a margin, and 128 is the largest round number that divides the range
into that few stops.


**Photo dim** is the scrim over a `file` wallpaper, and the three **Pattern** axes are the same
arrangement for the tiled SVG: both images' *bytes* are router-side — a file cannot live in
`localStorage` — but how a given browser draws them is an ordinary axis. `--fs-login-bg-url` and
`--fs-pattern-url` are `none` in `03-palettes.css`'s bare `:root` (the same default the hues carry)
so the stylesheet stands on its own with no image selected; `head.ut` and `fs-prefs.js` stamp the
real `url()` inline once one is. `--fs-photo-scrim` is mixed from `--fs-bg-base`, not the tinted
`--fs-bg`: the tint colours the canvas and must never leak onto an uploaded photo, so the scrim
stays neutral whatever hue is set.

**Pattern colours** is the one axis whose off state is the interesting one. On `theme` (the bare
`:root`) the SVG is painted through a CSS `mask`, so the file supplies alpha and the theme supplies
`--fs-text`: the same upload reads correctly in both modes and under every palette. On `original`
the mask is dropped for a plain tiled `background-image`, because a mask flattens artwork that
carries its own palette to a single colour. Neither the file nor the two numbers are the axis that
decides whether anything paints — that is `fs-wallpaper`.

### Wallpaper rendering: why the canvas moves to `:root`

A dedicated `.fs-pattern` element, not a `background-image`, because recolouring a rasterised
image needs `mask-image` — the SVG supplies alpha, the element supplies colour — and a mask
applies to the whole element including children, so it can never sit on `.fs-shell` or `<body>`
directly. `.fs-pattern` is emitted as `<body>`'s first child (`header.ut`, `sysauth.ut`, which has
no `.fs-shell`) with no other job.

`z-index: -1` needs a transparent `body`: inside the root stacking context, paint order is html's
background, then negative-z children, then every block background, so an opaque `--fs-bg` on
`body` buries a negative-z layer instead of sitting above it. The canvas therefore moves to
`:root`, and `body`, `.fs-main` and the footer all go transparent so the layer shows through. Both
wallpapers pin `background-attachment: fixed` so the layer is one calm backdrop the page scrolls
under rather than a strip riding along with a table underneath it.

The uploaded photo (`file`) instead paints on one element only (`.fs-shell`, or bare `body`
pre-login): `--fs-photo-scrim` as a second `background-image` layer over the photo on the SAME
element, no `::before` and no `backdrop-filter` — a blur over a full-viewport surface is the most
expensive paint a phone GPU does, and the scrim already carries the legibility;
`prefers-reduced-transparency` turns the scrim opaque instead (`95-a11y-media.css`).

Three more `fs-` keys are not axes: `fs-rail` (the sidebar collapsed to an icon rail,
toggled in the chrome), `fs-menu-open` (the remembered set of open accordion sections) and
`fs-recent` (the command palette's history). None of them has a router default, which is why
`fs-rail` may delete its key on the off state where an axis may not.

### Three layers, and the browser always wins

The effective value of every axis is **`localStorage` ?? router default ?? built-in**.

- The router default is what **Save as default** writes: `saveAsDefault()` uci-sets
  the axes into `/etc/config/footstrap`, and the server reads them back into `window.__fsSD`, which
  `head.ut` stamps. So a new browser, an incognito window or a cleared cache inherits the router's
  look — including the pre-login page, which is the point of putting the wallpaper there.
- The built-in is a bare `:root`.
- **This browser's own choice overrides the router default in either direction.**

**Every applier therefore stores its choice EXPLICITLY, including the off/default value, and that
is load-bearing.** Once a router default exists, clearing the key no longer means "the built-in" —
it means "inherit whatever the router set". An applier that deleted the key on the default value
could not express "I want the built-in, *not* the router default", so a router-defaulted tint could
not be turned back off. `lsDel` is reserved for **Reset to default**, which drops back to the router
default on purpose.

### Nothing else writes to the router

**`/etc/config/footstrap` is written by Save as default and by nothing else.** The only other uci
writes on the whole page are the login-background *token* on upload and its blanking on remove —
the identity of a file that has to live on the router anyway.

Two axes used to write through the moment they changed: `wallpaper` on every pick and `photo_dim`
on every drag, on the argument that the File photo is router-side, so "which wallpaper shows it"
and "how dim" belonged beside the image. The argument did not survive its consequence: choosing
Cats in one browser silently re-pointed the router-wide default for every other device — and
because the write also moved the Save baseline, the button did not even light up. A per-browser
preference must never mutate shared state with no way to see that it did. Both are ordinary axes
now.

`/etc/config/footstrap` ships as an empty stub and is written at runtime, which is why it **must be
declared a conffile** — see [package.md](package.md).

**Every axis is implemented twice** — inline in `partials/head.ut` before first paint, where
`require` is impossible because the module loader does not exist yet, and live in `fs-prefs.js`.
The two cannot be merged byte for byte, so `tools/axes.mjs` derives the contract **from the JS** and
checks the template against it: keys, `:root` attributes, custom properties, the 1–360 ranges, the
rounding default — and the load-bearing ordering rule, **custom property first, attribute second**.
Reversed, a reload paints exactly one frame in the previous hue. The gate exists for that one line:
it would be fixed in the live applier and forgotten in the template, and the only symptom is a single
wrong frame nobody reports.

### The colour axes, and why the slider went

Nine axes take a colour: Tint (the canvas), Accent, the three status colours Good /
Warning / Danger, and the four surfaces Cards / Controls / Sidebar / Borders. Each holds one
of three things — off, a hue 1–360°, or a `#rrggbb` — and `data-<axis>` carries `hue` or `hex` to
say which. The surfaces are the exception and hold only a colour: they set an inline custom property
and no attribute at all (`surfaceAxis` in `fs-prefs.js`), because there is nothing for a rule to
match.

**The UI offers only the hex field.** The hue slider was here and is gone: rotating a hue keeps the
palette's chroma, so no angle of it reaches a grey — which is the one thing #20 asked for. The hue
mode stays in storage and in the stylesheet so a value saved before the change goes on painting.

**The ink over a hex fill is derived, in CSS.** `--fs-on-accent` and the three status inks become
`oklch(from <fill> clamp(0, (l - .62) * -100, 1) 0 0)` — black above the sRGB crossover, white
below, chroma zeroed. The rule is written `[data-accent="hex"][data-accent]`: the palette's dark
block is also (0,2,0) and later in the file, so the single-attribute form lost **in dark mode only**
and left a grey accent carrying near-black ink at 1.9:1. Surfaces get no derived ink — what reads on
them is `--fs-text`, a palette token these axes must not move — so the page reports the contrast
each choice lands at instead.

### Tint and Accent

In HUE mode both are an angle 1–360°, both rotate `oklch(from …)`, and both default to "off" (no
attribute).

- **Tint** (`data-tint`, `--fs-tint-h`) washes a hue into the canvas (`--fs-bg`, the surface the
  cards float on), so a whole LuCI reads as green / purple / amber at a glance. `localStorage` is
  bound to the origin, so "which router is this" comes for free with no server state: the same
  browser shows the main router green and the access point purple. **Nothing else moves** — cards,
  chrome and semantic colours keep their palette values, because a status colour recoloured for
  identification would start lying about status.

  It rotates **chroma and hue rather than mixing a colour in**: `color-mix` in a polar space is a
  trap (measured on a dark canvas, "2%" and "6%" at hue 165 gave the identical green — the knob
  controlled nothing).

  **Tint strength** (`--fs-tint-strength`, 0–200%, default 100) is the paired axis: the hue picks
  the colour, this picks how strongly it reads. It is a multiplier on the tint chroma, it only
  bites while a hue is set, and it is hidden and moot under a `file` wallpaper, where the tint
  resets to neutral because the photo covers the canvas. Do not confuse it with Photo dim,
  which darkens that photo rather than colouring the canvas.

  `--fs-tint-c` (the chroma the hue is applied at) is a floor plus two `cos()` terms rather than a
  flat number, because no palette's canvas is neutral — every one is a blue-grey (oklch hue
  248–264°) — and the cue is read *against* that cast: a boost at 258° (the canvas's own hue;
  without it blue and violet do nothing) and a damp at 55° (red-through-yellow, which the eye
  picks up first, so at a shared floor the warm half would shout while the cold half whispers —
  dark mode only, since on a near-white canvas warm is the quietest hue there is). Light mode runs
  a higher floor: near-white has almost no chroma of its own, so the tint is the only colour
  there, and it clips at the top of the wheel — on bootstrap's `#fff`, 180° and 258° land 1/255
  apart, the price of copying a stock theme's surfaces. Lightness is copied through unmixed, so
  contrast barely moves: a mixed-in tint dragged one export level from 4.61:1 to 4.40:1, where the
  rotated version does not. `tools/export-tier.mjs` runs the AA matrix over six hues × both modes ×
  every palette and `tools/a11y-gallery.mjs` runs axe-core over the tinted gallery at two extreme
  hues; change `--fs-tint-c` and re-run both. The shipped chroma is deliberately tiny — an identity
  cue, not a colourway — since a large flat field is where the eye is most sensitive to a cast;
  loud belongs in a palette, where the cards and chrome can move too.
- **Accent** (`data-accent`, `--fs-accent-h`) is the same idea applied to the interface colour:
  the rotation moves every accented control, because they all read `--fs-accent` or a `color-mix()`
  from it. `oklch(from … l c H)` preserves the palette's lightness and chroma and changes only the
  hue, so the contrast of `--fs-on-accent` — which follows lightness — holds at any angle. The ink
  is not recomputed.

To avoid a cycle (`--fs-bg` cannot be defined through itself — that is invalid at computed-value
time and drops the colour silently), the palette declares the raw `--fs-bg-base` /
`--fs-accent-base` / `--fs-accent-lt-base`, and exactly one block owns the derivation.

## Typography

**THE THEME CARRIES NO FONTS.** `--fs-font-sans` and `--fs-font-mono` (`02-tokens.css`) name
Manrope and JetBrains Mono **first** and the system stack after:

```
--fs-font-sans: "Manrope", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--fs-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

A bare family name in `font-family` is matched against the fonts **installed on the visitor's
machine** before the browser moves down the list, so an admin who has either face installed sees
the theme drawn in it and one who does not falls through silently — no request, no 404, no flash.
Measured in the browser on a machine with neither installed: `"Manrope", system-ui` renders at
exactly the `system-ui` width, while `Impact, system-ui` and `"Courier New", system-ui` render at
their own — the mechanism works, the theme simply has nothing to add to it.

- **Sans: Manrope where present.** Designed against weights 600 and 700; with a locally installed
  family that has 400, `normal` resolves to 400 rather than the semibold the design assumed.
- **Mono: JetBrains Mono where present.** Numeric values, hostnames, versions, port names.

**There is no bold mono and it must not come back.** `<strong>` is a LABEL — LuCI writes every
status as `<strong>MAC:</strong> ac:1f:6b:…` — so on a monospace surface it takes the interface
face instead (`theme/45-misc.css`; likewise `.ifacebadge` as a badge, and `code`/`pre`, whose
literal must not inherit the container's emphasis). Before that rule, **227 elements across seven
pages** rendered in bold mono and the browser fetched `jetbrains-mono-600` (**20 KB**) for the word
"MAC:" — **30% of all font traffic**. Anything now asking for mono at weight ≥600 gets a synthetic
bold that smears the monospace grid; if a rule "needs bold mono", the question is whether it is a
label (then it is not mono at all), not whether to bring 20 KB back.

**Excluding an element from the mono rule is not enough** — it still inherits mono from its
parent. Sans has to be assigned. (The first attempt added `strong` to a `:not()` and changed
nothing at all.)

Sizes (px): card title 14/700; KPI number 27/700 mono; large number 38–40/700 mono; body 13–14;
uppercase label 11/700 with `letter-spacing:.05em`; micro-caption 11–12 dim. Weight 800 from the
mock-up is not loaded — 18 KB for six elements; everything that asked for 800 draws at 700.

**A table's column heading is not one of those labels.** It carries the size, the weight, the
tracking and the faint ink, and NOT `text-transform: uppercase`: the string is the app's, and
uppercasing it printed LuCI's own `IPv4 address` as `IPV4 ADDRESS`, which reads as a typo rather
than as a style (issue #39). It is also the string LuCI copies into `data-title` for the card view,
from `innerText` — so a transform here rewrites the label the cards print and any selector keyed on
it. Four rules hold that decision together: `.cbi-section .table .th` and the title row in
`theme/30-tables.css`, the card label mirrored into `theme/65-dropdown.css`, and the alert's table
in `theme/35-alerts.css`. The chrome's own eyebrows — menu section labels, KPI captions, the search
palette's group headings — stay uppercase; they are the theme's words, not an app's.

The fonts used to be self-hosted: nine `.woff2` subsets (3 faces × latin / latin-ext / cyrillic)
under `htdocs/luci-static/footstrap/fonts/`, `@font-face` in `styles/01-fonts.css`, and the two
latin Manrope subsets preloaded in `partials/head.ut`. They are gone, and the measurement is why:
**the built package went from 128 290 to 66 690 bytes, −48%** — a far larger share than the raw
88 kB of `.woff2` suggests, because woff2 is already compressed and gains nothing from the
package's own compression while everything else does.

Removing them takes THREE deletions, not one, and the third is the one that hides: the
`@font-face` block, the files, **and the `<link rel=preload>` pair**. A preload is not in the
stylesheet, so dropping the rules alone left it behind and every page still asked the router for
the files — six 404s per page, measured, before that was noticed.

The OFL-1.1 half of `PKG_LICENSE` went with them. OFL §2 requires the notice and licence to travel
with every copy of the Font Software; with no Font Software in the package, declaring OFL would be
a false statement about its contents.

### Putting a font back, per router

The package still ships none. What it ships is the seam: **three uci options in
`footstrap.settings`**, filled in by `fonts/set-font.sh` (a repository tool, run once on the router)
or by hand. `fonts/README.md` is the admin-facing page; this is the contract.

| option | what | sanitised in `partials/head.ut` by |
|---|---|---|
| `font_sans` | a `font-family` stack, printed into an unlayered `:root` block | `_sd_family()` — `A-Za-z0-9 ,._"'-`, ≤120 chars |
| `font_mono` | the same for the monospace face | `_sd_family()` |
| `fonts` | md5 of the generated `@font-face` sheet: the cache key **and** the switch that emits its `<link>` | the hex whitelist `login_bg` and `pattern` use |

The two halves are independent by design. A stack alone costs nothing and renders for whoever has
that face installed — the same mechanism the defaults above rely on. A stack **plus** a file in
`/etc/footstrap/fonts/` makes the router serve it, so every visitor gets it.

Three things about the shape are load-bearing:

- **The generated sheet carries `@font-face` and nothing else.** The families come from the template,
  so `uci set footstrap.settings.font_sans=…` by hand takes effect with nothing regenerated.
- **The `:root` block is unlayered**, so it beats `layer(tokens)` whatever order the sheets arrive in
  — the same reason a `theme/` rule never needs `!important` to outrank `base/`. Nothing under
  `styles/` changed to make this work.
- **The `<link>` is emitted only when the token is non-empty**, and the token is written only after
  the file exists. That is the preload lesson above, applied before it could repeat.

None of the three is an **axis**: no localStorage, no Appearance control, no entry in
`snapshotAxes()` (`tools/axes.mjs` knows them as server-only, beside the two upload tokens). A font
is a property of the router, not a per-visitor preference — the one Appearance-adjacent setting with
no browser layer at all.

The weights are where an installed face goes wrong quietly. Body text is 600, so **what a face
claims decides what is visible**: a single static file declared `400 700` covers both, the browser
stops synthesising, and every heading renders in the regular face. The script therefore declares one
static face as `400` alone, a pair as `400 600` + `700`, and leaves `100 900` to be spelled out for
a variable font.

## Components: mock-up primitive → LuCI class

| Component | Spec | LuCI class to style |
|---|---|---|
| **Panel / card** | `--fs-panel` background, 1px `--fs-border`, `--fs-radius-lg` | `.cbi-section`, `.cbi-map > *`, `.table` containers |
| **KPI card** | `--fs-radius-lg`; column of uppercase label + mono-27 number + dim caption | no direct analogue — status overview blocks |
| **Progress bar** | track `--fs-track` at `--fs-radius-pill`; fill `--fs-accent`; value mono/dim over the right edge | `.cbi-progressbar` |
| **Percent badge** | `font: 11/700; padding: 2px 7px`; colour + `-soft` fill by status | inline status in `.cbi-progressbar`, zonebadge |
| **Status pill** | `--fs-radius-pill`; `--fs-panel2` fill, `--fs-border`; active text `--fs-good` | `#indicators [data-indicator]` |
| **Menu item** | `--fs-radius`; active `--fs-accent-soft` on `--fs-accent`; inactive `--fs-dim` | `#topmenu li a`, sidebar nav |
| **Logo** | 30px square, `--fs-radius`, gradient `--fs-accent` → `--fs-accent-lt`, wifi SVG on `currentColor`, wordmark 16/700 | `.fs-brand`/`.fs-logo` in `partials/brand.ut` |
| **Table row** | flex, space-between, 1px `--fs-border` bottom; label dim, value mono | `.cbi-value`, `.table .tr` |

Rings, sparklines and port tiles from the mock-up are content, drawn by view JS — not something
a theme can produce. See the boundary in [architecture.md](architecture.md).

### Meter polarity

`annotateMeter()` (`menu-footstrap-common.js`) colours a `.cbi-progressbar` from its fill
percentage — 80%/92% warn/danger, `docs/conventions.md` — but a fill is not always "how much is
used". Forum #134 (2026-09-06) caught Status -> Overview's memory row 0, "Total Available" /
«Свободно», turning yellow at 91% full: a HIGH reading there is healthy, not a warning. Row 4,
"Swap free" / «Свободно в подкачке», is worse — a fully free swap reads 100% and showed permanent
danger on an otherwise healthy router. Both measured live on owrt2512 and owrt2410, en and ru.

Three decisions, each keyed on the row's own label — `_(msgid)`, no msgctxt, the same match
`ROLES` in `fs-overview.js` already makes, verified against `modules/luci-base/po/ru/base.po`:
every msgid used here has an entry there, so it is in the `base` domain loaded on EVERY admin
page, not one only Status -> Overview fetches (unlike `_('Free')`, absent from that catalogue,
which comes back untranslated wherever it is tried — the trap this rule exists to avoid falling
into a second time):

1. **Inverted** ("Total Available", "Swap free"): the warn/danger split fires on a LOW reading —
   `100 - FS_METER_WARN` / `100 - FS_METER_DANGER`, not a second pair of numbers, because an
   inverted bar asks the identical health question ("how much headroom is left") from the other
   end of the same fill.
2. **Neutral** ("Buffered", "Cached"): no colour, ever. A full page cache is the kernel doing its
   job, not a resource running out — colouring it "danger" would say something false.
3. **Unrecognised** (everything else, including any bar a third-party app draws): keeps the plain
   fill-based rule. Seventeen bars measured live on Overview alone (storage, active connections)
   are used-based and carry no name this theme special-cases, and an app's own meter is unnamed by
   construction — so fill-based stays the FALLBACK. A wrong colour on the rare inverted app meter
   this theme has never seen is the accepted cost of not going dark on the common, correct case.

# Design system: tokens, palettes, type

What the theme's values are and why they are those values. How the stylesheet is built and how the
cascade is kept disciplined: [css.md](css.md). What the chrome does with them:
[chrome.md](chrome.md).

Reference mock-ups: `docs/design/`.

**There is one system.** One renderer (`menu-footstrap.js`), one template directory, one
`cascade.css`, one entry in `luci.themes`. Layout (sidebar or top bar) is a client setting,
`:root[data-layout]`, always with an explicit value.

**No colour literals in this page on purpose** — a colour written in two places drifts, and it
already has: this document was once read as the source for `--accent-soft: rgba(9,105,218,.10)`,
the very per-component copy the project killed. Values live in `styles/02-tokens.css` and
`styles/03-palettes.css`, with the reasoning in a comment beside each one.

## Two tiers, and the split is load-bearing

- **The private tier `--fs-*`** (`02-tokens.css`, `03-palettes.css`) — `--fs-bg`, `--fs-panel`,
  `--fs-panel2`, `--fs-border`, `--fs-text`, `--fs-dim`, `--fs-faint`, `--fs-accent`,
  `--fs-good/-warn/-danger`, `--fs-track`, plus the radius, z-index, duration and spacing scales.
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
colour passes every contrast threshold there is**, so nothing failed; it failed at the user.

The axis of the ramp is **chroma at constant lightness** (`color-mix(in oklch, …, var(--fs-dim))`).
Both obvious alternatives were measured and rejected: fading `low` toward the surface spends
contrast the palette does not have (in dark mode every accent on `--fs-panel2` already sits at
4.56:1, i.e. +0.06 over AA), and pulling `high` toward `--fs-text` collapses the ramp in dark mode
where `--fs-text` is nearly white.

The binding constraint: apps read a level as `color:` about as often as `background:`, so every
level must pass AA as text on `--fs-bg`/`--fs-panel`/`--fs-panel2` and carry a readable
`--on-*-color` as a fill. `tools/export-tier.mjs` proves all of it across
{footstrap, hicontrast, bootstrap, 2020} × {light, dark} × a sweep of tint hues — 56 combinations
and 4352 contrast checks today — including that the ramp is not flat, the only check that can catch flatness.
Borders are exempt from the text half: `--border-color-low` may legitimately fade into the surface,
which is what a hairline is for.

## Palettes

Four, all in `styles/03-palettes.css`, one self-contained block per (palette × mode):
**footstrap** (GitHub Primer colours, the default, filling a bare `:root`), **hicontrast**
(`data-palette="hicontrast"`), **bootstrap** (`data-palette="bootstrap"`, the stock LuCI theme's
surfaces and greys — its semantic colours and its light ink are raised where they miss AA, which
that block documents in place) and **2020** (`data-palette="2020"`, the OpenWrt 2020 theme's
colourway). Light mode is the bare `:root`; dark is `:root[data-darkmode="true"]`. The file also
carries the instructions for adding a palette.

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

The role × step matrix is **filled completely on purpose**, whether or not anything reads a cell
today: a hole is exactly where the drift started (`--fs-accent-soft` existed, `good`/`warn`/
`danger` had no sibling, and every rule invented its own percentage). `--fs-accent-soft` is the one
member still in `03-palettes.css`, because its strength is the only one that depends on mode
(10% light / 15% dark).

Other derived values: `--fs-glass` (a frosted popup surface, panel at 96%) and `--fs-blur` (one
blur radius for every frosted surface); `--fs-emboss` / `--fs-text-emboss` (a raised 1px edge);
`--fs-hover-lift` (the one hover hint that cannot be a colour, since it brightens whatever fill the
role set — and its **direction depends on mode**: light darkens, dark lightens);
`--fs-focus-ring` and `--fs-focus-ring-invalid` (which takes `-fill`, not `-soft`: a red ring has
to read as alarm).

**The bar's blur stays, and that is a decision rather than an oversight.** `--fs-bar-bg` at 88% was
chosen for the blur: content has to show through the strip, and without the blur it shows
through sharply and reads as dirt under the text. One backdrop layer on one strip is what any
native mobile navbar does — unlike `theme/15-wallpaper.css`, which removed the blur from every
form button, where it was dozens of layers rather than one. It could not be measured either way:
a main-thread rAF loop cannot see compositor work, and a headless browser does not rasterise at
all, so the remaining step is a run on a real phone. Meanwhile there is a proper opt-out —
`@media (prefers-reduced-transparency: reduce)` in `theme/95-a11y-media.css` switches
`--fs-bar-bg`/`--fs-glass` to the opaque `--fs-panel` and kills `--fs-blur`. That is both an
accommodation and a measured line of retreat, and it leaves the choice with the device's owner.

**`--fs-bar-bg` (88%) is deliberately NOT merged with `--fs-glass` (96%)**: the bar is a thin strip
the page scrolls under, and content showing through is the point; a dropdown carries a menu and has
to stay readable. **`--fs-scrim` is the theme's one colour literal and stays one**: black at .7 is
the absence of light behind a dialog, not a shade of any token.

## Scales

**Radius** — one user-facing base (Footstrap tab → Rounding, **0–20 px**), from which three semantic
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

**Spacing** — a half-step scale in `02-tokens.css`: `--fs-space-0-5`, `-1`, `-1-5`, `-2`, `-2-5`,
`-3`, `-3-5`, `-4`, `-5`, `-6`, `-7`, `-8`, `-10` (the number is the step, `-1` = 4 px at normal
density).

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

## The appearance axes

The controls are `fs-appearance.js`, added as a fifth tab on the stock **System → System** page,
beside General Settings / Logging / Time Synchronization / Language and Style. It watches
`body[data-page]` the way `fs-overview.js` does, then appends one `.cbi-tabcontainer` and one `<li>`
to the group `ui.tabs` has already initialised — by hand, because `initTabGroup()` returns
immediately on a group carrying `data-initialized` and clearing that flag builds a *second* menu
beside the first. A theme owns no dispatcher node of its own: a node outlives the theme that
registered it, so switching themes would leave a menu entry whose view is gone.

The values live in `fs-prefs.js`. Grouped the way the page groups them — **Interface** (Layout,
Theme, Palette, Density, Rounding, Submenus), then the **Colours** fold (Tint and its strength, the
four colour axes, the four surface axes), then the **Background** fold (Wallpaper, Dim, Pattern and
its three axes, File), then **Defaults**:

| Axis | Values | `localStorage` | `:root` |
|---|---|---|---|
| **Layout** | **top** (default) / sidebar | `fs-layout` | `data-layout` (always explicit) |
| **Theme** | auto / light / dark | `fs-darkmode` | `data-darkmode` + `data-theme` + `data-bs-theme` |
| **Palette** | footstrap / hicontrast / bootstrap / 2020 | `fs-palette` | `data-palette` |
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
| **Submenus** | keep open / auto-collapse | `fs-menu-autocollapse` | — (no attribute) |


**Photo dim** is the scrim over a `file` wallpaper, and the three **Pattern** axes are the same
arrangement for the tiled SVG: both images' *bytes* are router-side — a file cannot live in
`localStorage` — but how a given browser draws them is an ordinary axis.

**Pattern colours** is the one axis whose off state is the interesting one. On `theme` (the bare
`:root`) the SVG is painted through a CSS `mask`, so the file supplies alpha and the theme supplies
`--fs-text`: the same upload reads correctly in both modes and under every palette. On `original`
the mask is dropped for a plain tiled `background-image`, because a mask flattens artwork that
carries its own palette to a single colour. Neither the file nor the two numbers are the axis that
decides whether anything paints — that is `fs-wallpaper`.

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

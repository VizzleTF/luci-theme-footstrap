# Adding a palette

A how-to for adding a sixth colourway to the theme. For someone changing `styles/03-palettes.css`.

What palettes, tiers and inks are: [design-system.md](design-system.md#palettes).


Use this when you add a sixth colourway. All palette CSS goes in `styles/03-palettes.css`. A palette
is two blocks: `:root[data-palette="<NAME>"]` (light) and
`:root[data-palette="<NAME>"][data-darkmode="true"]` (dark).

Eight colours go through a `-base` token: `--fs-bg-base`, `--fs-panel-base`, `--fs-panel2-base`,
`--fs-border-base`, `--fs-accent-base`, `--fs-good-base`, `--fs-warn-base`, `--fs-danger-base`. The
tint, accent and colour axes derive the working token from it. So a palette never declares
`--fs-good` directly.

The inks `--fs-text`, `--fs-dim`, `--fs-faint` and the meter track `--fs-track` have no `-base`. A
palette declares them by their own names.

The light block inherits from the default block; the dark block is self-contained.
`--fs-panel-base` and the four inks (`--fs-on-accent`, `--fs-on-good`, `--fs-on-warn`,
`--fs-on-danger`) are `#fff` in every light palette. So the default block is their only definition,
and a light block sets only what differs.

| Token | Light block | Dark block |
|---|---|---|
| `--fs-bg-base`, `--fs-panel2-base`, `--fs-border-base` | set | set |
| `--fs-text`, `--fs-dim`, `--fs-faint` | set | set |
| `--fs-accent-base`, `--fs-track` | set | set |
| `--fs-good-base`, `--fs-warn-base`, `--fs-danger-base` | set | set |
| `--fs-panel-base` | inherited (`#fff`) | set |
| `--fs-on-accent`, `--fs-on-good`, `--fs-on-warn`, `--fs-on-danger` | inherited (`#fff`); set only if `#fff` fails AA on a fill | set |
| `--fs-accent-soft-mix` | inherited (10%) | optional; hicontrast re-states 14% |
| `--fs-bar-bg` | inherited (`var(--fs-panel)`) | optional; only forum sets it |

1. Copy the two hicontrast blocks (light and dark) to the end of `styles/03-palettes.css`, after
   the forum blocks and inside the closing `}` of `@layer tokens`. The hicontrast light block already
   sets only the tokens marked "set" above.
2. Rename the selector to the new name. The copied hicontrast values are the starting colours.
3. Replace each colour with the new palette's own.
4. Check contrast with the tint off, where `--fs-bg` equals `--fs-bg-base`:
   - each of `--fs-text`, `--fs-dim`, `--fs-faint` and the four role colours against
     `--fs-bg-base`, `--fs-panel-base` and `--fs-panel2-base`;
   - each `--fs-on-*` ink against its own role colour as a fill.

   Use the WCAG 2 contrast ratio: (L1 + 0.05) / (L2 + 0.05), where L1 and L2 are the relative
   luminances of the lighter and the darker colour. Any WCAG 2 contrast checker computes it. Every
   pair must reach 4.5:1. `contrastRatio()` in `view/footstrap/appearance.js` uses the same formula.

   Expected: every pair is at 4.5:1 or above. The existing blocks record their measured ratios in a
   comment; record yours the same way.

   The export tier must also pass at every tint hue
   ([The export tier is a RAMP](design-system.md#the-export-tier-is-a-ramp-not-a-set-of-aliases)). Tint moves only
   `--fs-bg`, so repeat the `--fs-bg` checks with Tint set.
5. Register the name in three places. Each fails quietly if skipped:
   - the `PALETTES` list of the PALETTE axis in `fs-axes.js`;
   - the `palette` whitelist and the pre-paint `list('palette', …)` in `partials/head.ut`;
   - the label map in `view/footstrap/appearance.js`.
6. Add the name to the palette list in `tools/playground/verify.mjs`. That check fails when a listed
   palette is missing from the Palette select.

The `inkFor()` copy in the pre-paint and the sanitiser's range table are not among the three
places. They serve the hex colour axes and the sliders, not the palette name.

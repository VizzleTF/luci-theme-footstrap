---
paths:
  - "**/styles/**/*.css"
  - "**/cascade.css"
  - "luci-theme-footstrap/build-css.sh"
description: The cascade layers, the token tiers, and how a CSS change is proved.
---

# CSS

- **`htdocs/luci-static/footstrap/cascade.css` is generated — never edit it.** Source is `styles/`.
  Enforced by `permissions.deny: Edit(**/cascade.css)` in `.claude/settings.json`, which also covers
  a shell redirection into that path; the rule is here for the reason, not as the defence.
- Layer order `tokens, base, theme, page`, one directory per layer, filename prefix = source order.
  A later layer beats an earlier one regardless of specificity, so a theme rule never needs
  `!important` to outrank base. A file added to a layer directory needs its own `@layer` wrapper —
  `build-css.sh` refuses one that has none and would be swallowed into the block above it.
- **Read the private `--fs-*` tier only.** The `--*-color-*` export tier is defined from it and read
  by nobody inside `styles/` (`audit --strict` fails). A hostile `:root` recoloured 312 of 336
  gallery elements before the split, 0 after.
- **`!important` is a gated allowlist and inverts layer order.** A flag must fight an inline
  `style=` or an app's unlayered rule; one that beats another footstrap rule means the rule is in
  the wrong layer. `theme/95-a11y-media.css` is the one sanctioned exception.
- **Edit the rule that already styles the selector** — never append a second one. **Win on
  specificity, never on source order.**
- **Coverage is a contract.** Never delete a selector because no stock page renders it — some
  third-party app emits it. `css-orphans` is the only safe dead-CSS search, and only because `fs-*`
  is ours alone.
- **No colour literals** (`--fs-scrim` excepted); a tint of X is mixed **from** X. Never reintroduce
  a component bridge (`--*-rgb`, `--*-hsl`).
- **Merge a duplicate or pin it in `@mirror`.** An unpinned duplicate is a hard failure, and so is a
  `@mirror` group with one copy.
- **`styles/base/` is editable**, but prefer the matching `styles/theme/` file, and justify any base
  edit that changes output with a near-empty computed diff.
- **No bold mono**: `<strong>` is a LABEL and must be *assigned* the sans face — excluding it from
  the mono rule changes nothing, since it still inherits.

## Proving the change

`npm run computed-diff` (T1, ~4 s) is the cheap half: it builds the worktree stylesheet and the one
at `HEAD`, loads `docs/gallery.html` once, and diffs `getComputedStyle` over 725 elements × 62
properties at two Appearance points. `--control` runs the SAME sheet on both sides and must report
0; that 0 is the threshold and it is measured, not chosen. Two corrections it took to get there, both
worth keeping in mind when reading a diff:

- the reference sheet is swapped onto itself before the first snapshot, because a colour computed
  from a sheet parsed with the document serialises as `oklab(…)` and the same colour from a sheet
  attached afterwards as `color(srgb …)` — 28 phantom differences in light, 0 in dark;
- every running animation is awaited, because one `span.cbi-tooltip` fade was caught mid-flight at
  `opacity 0.00245647` by one snapshot and finished by the other.

The gallery is not a router. It has every widget and none of the pages — no menu, no chrome, no
third-party sheet, no container query answered by a real viewport — so a clean computed diff is an
early result, not a release. The live half stays `npm run live` and `owlab test` (T2), and the
method there needs its own control pass: on a router the same sheet twice moves 0.5-1.3% of pixels
while a real regression weighs 0.19%. Never screenshots. Method and traps: `docs/css.md`.

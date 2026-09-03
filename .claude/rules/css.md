---
paths:
  - "**/styles/**/*.css"
  - "**/cascade.css"
  - "**/build-css.sh"
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
- **The browser floor is Chrome 108 / Firefox 101 / Safari 15.4**, derived from the sheet by
  `npm run css-floor` and stated in `docs/css.md`. Two shapes fail it: a `:has()` compound sharing
  a selector list with one that has none (the list is not forgiving — the whole rule dies below
  the floor; split it or wrap it in `:is()`), and a CSS feature the sheet has not used before,
  until it is classified hard/soft in `tools/css-floor.mjs`. A token built with `color-mix()`
  needs its static twin in `styles/04-nocolormix.css`: a custom property fails at the point of
  USE, so no fallback declaration in the same block can catch it.
- **No colour literals** (`--fs-scrim` excepted); a tint of X is mixed **from** X. Never reintroduce
  a component bridge (`--*-rgb`, `--*-hsl`).
- **Merge a duplicate or pin it in `@mirror`.** An unpinned duplicate is a hard failure, and so is a
  `@mirror` group with one copy.
- **`styles/base/` is editable**, but prefer the matching `styles/theme/` file, and justify any base
  edit that changes output with a near-empty computed diff.
- **No bold mono**: `<strong>` is a LABEL and must be *assigned* the sans face — excluding it from
  the mono rule changes nothing, since it still inherits.

## Proving the change

`npm run computed-diff` (T1, ~4 s) is the cheap half; `--control` runs the same sheet on both sides
and must report 0. The gallery has every widget and none of the pages, so a clean diff is an early
result, not a release: the live half is `npm run live` and `owlab test` (T2), where the same sheet
twice moves 0.5-1.3% of pixels and a real regression weighs 0.19% — never screenshots. Method and
the two corrections the gate needed: `docs/css.md` "Proving a CSS change", `docs/development.md`
"The two cheap browser gates".

---
name: footstrap-audit
description: Static-audit the CSS sources in styles/ and the theme JS for un-themed spots, duplication and breakage before deploying. Reports bracket balance, CSS custom properties used via var() but never defined (silently-dropped shadows/colors), declarations shadowed by a later rule on the same selector in the same layer, stray !important, and hardcoded color literals in styles/base that bypass the token bridge. A companion cssdiff.py compares computed styles of two stylesheets on a live page — use that to check a change altered nothing. Triggers: "audit css", "проверь css", "un-themed", "что не переопределили", "lint theme", "cssdiff".
---

# footstrap-audit

Fast, dependency-free static check of `luci-theme-footstrap` styles/scripts.

## Run

```sh
python3 .claude/skills/footstrap-audit/audit.py
```

Reports five things:

1. **balance** — `{}`/`()`/`[]` counts for `cascade.css` and every resources JS.
   Any mismatch = a broken block; fix before deploying.
2. **css vars used but not defined** — `var(--x)` with no `--x:` anywhere. These
   drop silently (missing shadows/borders/colors). Common after editing the
   `:root` token block — re-add the HSL component tokens. Runtime-inline vars
   (`--zone-color-rgb`, `--focus-color-rgb`, `--on-color`) are allow-listed.
3. **declarations shadowed within a layer** — the same selector, in the same
   cascade layer and at-rule context, setting the same property twice. The
   earlier one is dead code, and it means a rule was appended at the bottom of
   the file instead of edited in place. Reported for `theme`/`page` only;
   `styles/base` re-states properties on purpose. The group-then-refine idiom
   (`input…, textarea { min-height: 38px }` then `textarea { min-height: 84px }`)
   is not reported.
4. **stray `!important`** outside the files allowed to carry one.
5. **hardcoded colors in styles/base** — `#hex` / numeric `rgb()/hsl()` with
   file, line and selector. These bypass the token bridge, so a palette or
   dark-mode switch cannot reach them → candidates to map to tokens.

Caveat on #5: the script flags a base literal even when a `styles/theme` rule
already overrides that selector (it cannot track cascade order). Cross-check
before touching one — a live hit shows up as a colour that does not follow the
palette; a dead one changes nothing. `cssdiff.py` settles it either way.

## Also compile-check templates (printed as a tip by the script)

```sh
ssh router 'for f in /usr/share/ucode/luci/template/themes/footstrap*/*.ut; do
  ucode -T -c -o /dev/null "$f" && echo OK $f || echo FAIL $f; done'
```

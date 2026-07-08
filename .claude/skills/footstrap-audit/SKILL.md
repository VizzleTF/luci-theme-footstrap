---
name: footstrap-audit
description: Static-audit cascade.css and the theme JS for un-themed spots and breakage before deploying. Reports bracket balance, CSS custom properties used via var() but never defined (silently-dropped shadows/colors), and hardcoded color literals in the base bootstrap region that bypass the token bridge. Use after big CSS edits, when something looks off-theme, or as a pre-commit check. Triggers: "audit css", "проверь css", "un-themed", "что не переопределили", "lint theme".
---

# footstrap-audit

Fast, dependency-free static check of `luci-theme-footstrap` styles/scripts.

## Run

```sh
python3 .claude/skills/footstrap-audit/audit.py
```

Reports three things:

1. **balance** — `{}`/`()`/`[]` counts for `cascade.css` and every resources JS.
   Any mismatch = a broken block; fix before deploying.
2. **css vars used but not defined** — `var(--x)` with no `--x:` anywhere. These
   drop silently (missing shadows/borders/colors). Common after editing the
   `:root` token block — re-add the HSL component tokens. Runtime-inline vars
   (`--zone-color-rgb`, `--focus-color-rgb`, `--on-color`) are allow-listed.
3. **hardcoded colors in base region** — `#hex` / numeric `rgb()/hsl()` in the
   unmodified bootstrap region (before the first appended `FOOTSTRAP` section),
   with selector + line. These bypass the token bridge → candidates to map to
   tokens.

Caveat on #3: the script flags a base literal even if a **later** appended
footstrap block already overrides that selector (it can't track cascade order).
Cross-check: many `header` / `.nav .dropdown-menu` hits are dead (overridden by
the sidebar/top-nav rules); the live ones are form/widget selectors
(`.cbi-*`, `.ifacebox`, `.zonebadge`, `select[multiple]`, `.close`, `.tabs`).

## Also compile-check templates (printed as a tip by the script)

```sh
ssh router 'for f in /usr/share/ucode/luci/template/themes/footstrap*/*.ut; do
  ucode -T -c -o /dev/null "$f" && echo OK $f || echo FAIL $f; done'
```

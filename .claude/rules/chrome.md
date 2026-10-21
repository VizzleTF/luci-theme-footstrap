---
paths:
  - "**/*.ut"
  - "**/fs-*.js"
  - "**/menu-footstrap*.js"
description: The one renderer, the three ownership zones, and the fence that keeps a foreign app out of the chrome.
---

# The chrome, and sharing a document with third-party apps

- **One theme entry, one template dir, one renderer.** Layout is a **client** axis
  (`:root[data-layout]`, always an explicit value) — never write a `:not([data-layout=…])` guard and
  never add a second renderer. The bar is the base; the vertical sidebar is one guarded override
  that wins on specificity.
- Three zones: **ours** (`fs-*`, `--fs-*`, `[data-fs-chrome]`), **shared LuCI** (`.cbi-*`, `#view` —
  where an app is *entitled* to win on specificity), **theirs**. Check who owns a name before
  "fixing" a collision: `.left`/`.right`/`.center` and `ul.nav` are LuCI's.
- The chrome is defended by **not matching**: the mark in `header.ut`, the fence in `fs-sheets.js`,
  the pin in `theme/10-chrome.css` (inherited properties, roots alone). `npm run chrome-fence`
  derives the mark from the markup and compares whole canonical strings — a token-wise check once
  passed on a fence that was the exact inverse of one.
- **A view's CSS is never deleted** — a sheet imported at module eval never comes back. An invasive
  sheet makes the next navigation a full load instead; only a byte-identical duplicate may be
  dropped.
- Every Appearance axis is implemented twice (pre-paint in `partials/head.ut`, live in
  `fs-axes.js`; `fs-prefs.js` for dark mode, layout, auto-collapse and rail) and **the custom
  property is set BEFORE the attribute** — reversed, a reload paints one frame in the previous hue.
  `npm run axes` derives the contract from the JS; `npm run smoke` watches the two writes actually
  happen in that order on a live `:root`.

## Templates

Syntax-check the way LuCI does after any `.ut` edit. `ucode` lives in the stand, not on the host, so
sync the templates there and compile every installed one:

```sh
owlab sync owrt2512
docker exec owlab-luci-theme-footstrap-owrt2512 sh -c 'for f in /usr/share/ucode/luci/template/themes/footstrap/*.ut /usr/share/ucode/luci/template/themes/footstrap/partials/*.ut; do ucode -T -c -o /dev/null "$f" || exit 1; done'
```

The compile is T0 when the stand is up. Stand down (`docker ps` lacks it): booting is T2, started
first: `tools/bg.sh owlab up owrt2512`, then `tools/bg-wait.sh <run-id>`; the 60 s T0 bound is the
compile, not the boot. This proves 25.12's ucode only; 24.10's interpreter accepts a different set,
and CI's `verify` job compiles on both, so report the 24.10 half as CI's.

A `_()` with no catalogue renders silently in English: run `luci-theme-footstrap/update-po.sh` after
touching any `_()`. A msgid is a **global** name shared with every app — Appearance labels carry the
`footstrap` msgctxt; the chrome, the login/notice sentences and the System/Memory/Storage titles
deliberately do not.

- **A comment in a shipped file carries its reason inline.** No `issue #N`, no `tools/` or `tests/` pointer as the only carrier: those do not exist in openwrt/luci, and a `docs/` pointer is never the only carrier either. `docs/conventions.md`, "Comments".

Deeper: `docs/chrome.md`, `docs/third-party-apps.md`, `docs/spa-router.md`.

---
paths:
  - "**/htdocs/luci-static/**/*.js"
  - "tests/**/*.mjs"
description: Module composition, the jsmin traps, and what fs-fit owns.
---

# JS

- One concern per module; `L.require` makes a singleton and throws `DependencyError` on a cycle, so
  a module can never `extend` another — compose by calling.
- **All "does it fit" logic lives in `fs-fit.js`.** Measure uncollapsed, re-fit synchronously on a
  mutation, coalesce on resize. `data-narrow` — not a viewport media query — is the single source of
  "the sidebar became a bar", and the widths are read from the CSS tokens with `getComputedStyle`,
  never copied into JS.
- **Never put a regex literal straight after `return` or `=>`** — jsmin eats the rest of the file
  and **exits 0**. Wrap it: `return (/^https?:\/\//i.test(a));`. No backtick inside a `${…}`.
  eslint's `wrap-regex` holds the cause and `tools/jsmin-verify.mjs` the consequence; the second one
  needs a jsmin built from `luci-upstream.pin` and runs in CI only (T2).
- **Require a stock class through `window.L`** (`const RT = window.L; RT.require(name)`) — the `L` a
  factory receives has no `ui` helpers, and `require()` caches the first requirer's binding.
- **`FS_VERSION` stays in `fs-version.js` at that path** — the Makefile, `dev-sync.sh` and
  `tools/stage.sh` sed it by path; moving it makes every release report "(dev)".
- **The theme never checks for its own updates and never reaches a third-party host at run time.**
  Upgrades are the package manager's job (the installer adds the feed). `fs-router` exports
  `onNavigate(fn)` so an optional module can register itself without the router naming anyone —
  keep that seam inverted, but do not re-add an updater behind it.

## What to run after an edit here

`npm run lint:js` is the T0 gate. Then the one that covers what you touched: `axes` for `fs-prefs`
or `fs-axes`, `chrome-fence` for `fs-sheets`/`fs-prefs`, `page-modules` for the page→module map,
`css-orphans` if a `fs-*` class name moved, `floor` (T2, live) for anything in `holdFloor()` or
`naturalHeight()` — it is the only gate that reads a floor's height back and empties a box to see
the floor come off.

`npm run smoke` (T1, ~1.4 s) runs the modules against a real DOM on the gallery with every
dependency stubbed; `npm test` covers only the branches a stand cannot enter. Neither answers for
a page: behaviour is `owlab test` and the live gates (T2), and a green smoke never earns a release
the right to skip them. `docs/development.md` "The two cheap browser gates".

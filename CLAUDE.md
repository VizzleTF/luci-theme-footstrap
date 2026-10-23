# luci-theme-footstrap

A LuCI theme for **OpenWrt 24.10.3 and newer** (and ImmortalWrt), depending on nothing but
`luci-base`. Server chrome in `ucode/template/themes/footstrap/*.ut`, one generated `cascade.css`
built from `styles/`, and `fs-*.js` in `htdocs/luci-static/resources/`.

The repo root is the workspace (`package.json`, `tools/`, `tests/`, `docs/`, `owlab.yaml`,
`install.sh`); the shipped package is `luci-theme-footstrap/` one level down. Scratch output,
screenshots and logs go to `../tmp/`.

## Language

Talk to the maintainer in Russian. Code, comments, commit messages and PR text are English.

## Read before touching an area

`docs/README.md` indexes every page. Always: `docs/conventions.md` (the rules and the gate behind
each) and `docs/verifying.md` (what to run after an edit). Release: `docs/releasing.md`. The
openwrt/luci PR: `docs/upstream-pr.md`.

## Verifying

- After every edit: `npm test` plus the area's gate from `docs/verifying.md`. Before a push:
  `npm run check` (the pre-push hook runs it on the pushed commit).
- Anything over ~4.5 minutes (stands, live gates, `tools/ci-local.sh`) runs detached:
  `tools/bg.sh <cmd>`, then `tools/bg-wait.sh <run-id>`.
- Done means it ran on both package managers: 25.12/apk and 24.10/opkg (CI's `verify`). Say which
  one a run covered.
- A red gate is fixed in the code under it, never by editing the gate or its baseline.

## Hard rules

- `cascade.css` is generated: edit `styles/`. `styles/base/` is footstrap's own base; the name
  bootstrap belongs only to the real package (the `/luci-static/bootstrap` fallback, `bench/`).
- Every commit carries its entry in **both** `CHANGELOG.md` and `CHANGELOG_ru.md`
  (`node tools/changelog.mjs add <0-7> --en … --ru … && git commit …`). Conventional Commits, no
  attribution trailers.
- Some comments are code: `@mirror`/`@endmirror`, `/* fs:probe */`, eslint `'require …'` pragmas,
  the Makefile's buildroot marker. Keep them verbatim.
- Only on the maintainer's explicit word, each time: creating or pushing a tag, `gh release`,
  force-push or history rewrite on `main`, anything on the hardware router (`ssh`, `dev-sync.sh`),
  any push or comment to openwrt/luci or its fork, any public comment or issue.

## Multi-step work

There are no predefined agents. For work that splits into independent parts — a fan-out search,
a review across dimensions, verification on both stands, a multi-file change — write a dynamic
workflow with the Workflow tool (the maintainer opts in for this repository); for a single side
task, one Agent call. Give each agent the relevant `docs/` page and the gate it must pass.

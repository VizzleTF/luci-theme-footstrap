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

`docs/README.md` indexes every page. Always: `docs/conventions.md` (the rules) and
`docs/verifying.md` (how a change is proven). Release: `docs/releasing.md`. The
openwrt/luci PR: `docs/upstream-pr.md`.

## Verifying

- The one check is `tools/e2e.mjs` (`docs/verifying.md`): the package's life on a real owlab
  router — last release, upgrade, every menu page against bootstrap, removal, fresh install. CI's
  `e2e` job runs it on 25.12/apk and 24.10/opkg; done means both are green. Say which one a run
  covered.
- Locally: `owlab up <router>`, then the e2e command; anything over ~4.5 minutes runs detached
  (`tools/bg.sh <cmd>`, then `tools/bg-wait.sh <run-id>`). If owlab cannot boot here, rely on CI
  and say so.
- A new check is added only for a fault actually seen on a router, never for a guessed one.

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
task, one Agent call. Give each agent the relevant `docs/` page and what proves its part done.

# CLAUDE.md

`luci-theme-footstrap` — a LuCI theme for **OpenWrt 24.10 and newer** (and ImmortalWrt). Standalone:
it ships no framework and depends on nothing but `luci-base`. Page content is rendered client-side
by app view-JS, so the theme is server chrome (`ucode/template/themes/footstrap/*.ut`) + one
generated `cascade.css` + `fs-*.js` in `htdocs/luci-static/resources/`.

**Communicate in Russian.** Code, comments, commit messages and PR text stay in English.

**The floor is 24.10.** 23.05 support ended at 0.14.2 (`ui.RangeSlider` is 24.10-only,
openwrt/luci#8978); `install.sh` serves a 23.05 router that pin. `docs/releasing.md`.

`styles/base/` is footstrap's code: **do not call it "the fork" or reintroduce the word bootstrap**
into filenames, comments or docs. That name belongs to the *other, real* package only — the
`/luci-static/bootstrap` fallback, the `bench/` baseline, the attribution in `styles/00-header.css`.

**Repo root is the workspace** (`package.json` gates, `tools/`, `docs/`, `owlab.yaml`,
`install.sh`); the shipped package is `luci-theme-footstrap/` one level down — same name, one level
apart, so a path is ambiguous unless it is absolute or rooted. Nothing in the root ships. **Work
from the repo root, not from its parent**: the parent holds `luci-fork/` and `tmp/`, is not a git
repository, and loads none of this file. `.claude/hooks/session-start.sh` says so at startup.

## Read the doc first

`docs/` is the reference and every page carries the measurement behind each rule.

| Touching | Read |
|---|---|
| what LuCI expects of a theme, where the boundary runs | `docs/architecture.md` |
| the rule list with the gate that holds each one, the comment rules | `docs/conventions.md` |
| dev routers, pushing a change, proving it, the probe rig, hardware | `docs/development.md` |
| the lead thread, the roles, the card, the loop | `docs/crew.md` |
| `styles/`, cascade layers, `build-css.sh`, `@mirror` | `docs/css.md` |
| tokens, palettes, type, the Appearance axes | `docs/design-system.md` |
| sidebar / bar / rail, the menu renderer, the fit | `docs/chrome.md` |
| the reader's place through a poll tick — floor, reference, the three corrections | `docs/anchoring.md` |
| client navigation | `docs/spa-router.md` |
| foreign `luci-app-*`, the fence | `docs/third-party-apps.md` |
| Makefile, uci-defaults, postinst/postrm, ACL | `docs/package.md` |
| CI job graph, owfeed, packaging, the trust chain | `docs/ci.md` |
| pre-release checklist, changelog contract, runbook | `docs/releasing.md` |
| the navigation benchmark | `docs/benchmark.md` |

`docs/luci-app-styling-guide.md` (+ `_ru`) is outward-facing. `docs/gallery.html` renders every
widget LuCI or any app can emit — it is what `a11y`, `export-tier`, `computed-diff` and `smoke`
measure, and how the theme is checked without a router.

**The rules for one area load with that area** — `.claude/rules/css.md` (`styles/**`),
`js.md` (`htdocs/**/*.js`), `chrome.md` (`*.ut`, `fs-*.js`), `package.md` (Makefile, `root/**`,
`po/**`), `changelog.md` (`CHANGELOG*.md`). Cutting a release is `/release`; openwrt/luci work is
`/upstream-pr`. Read the matching file before editing there; the rules below apply everywhere.

## Commands

```sh
npm run check                              # T1: every gate; exit 0 before pushing
npm run check:fast                         # T1: the static subset, no browser and no CSS build
npm test                                   # T0: the unit suite alone (node --test, no browser)
npm run smoke                              # T1: modules come up in a real DOM (~1.4 s)
npm run computed-diff                      # T1: worktree vs HEAD, computed styles (~4 s)
tools/bg.sh <cmd>                          # T2: detach, log into ../tmp/ (refuses ssh, dev-sync, push)
tools/bg-wait.sh <run-id>                  # the waiter; stops on status, a dead pid, or the 2 h cap
node tools/build-icons.mjs                 # re-raster the app icons after a logo.svg change
owlab up | owlab sync --watch | owlab open owrt2512
./tools/stage.sh && owfeed build           # both formats into dist/
owlab test --release 25.12.4 --install 'dist/noarch/luci-theme-footstrap-*.apk' --assert …
ucode -T -c -o /dev/null <template>.ut     # syntax-check a template the way LuCI does
luci-theme-footstrap/dev-sync.sh <host>    # deploy to a HARDWARE router over ssh (ask)
npm run fork-drift                         # what the two trees disagree about
```

## Verifying

Every gate sits in exactly one tier; the tier says who runs it and whether waiting on it is
allowed. Tiering changes nothing in the release matrix (`/release`, `docs/releasing.md`), and CI
runs every job on every pull request regardless of what a session ran.

Who runs which tier: T0 is the `developer`'s, before it returns; T1 and T2 are the `tester`'s.
The lead runs none of them.

**T0 — always, foreground, 60 s.** `npm test`; the ONE `node tools/<name>.mjs` that covers the file
just edited (the map is in each `.claude/rules/` file and in `docs/conventions.md`);
`ucode -T -c -o /dev/null` over each template touched. Nothing else runs by reflex.

**T1 — on an explicit request, 5 min.** `npm run check` once, when the branch is otherwise finished.
`npm run smoke` and `npm run computed-diff` after a JS or CSS change: seconds each.

**T2 — never blocked on.** `owlab up|test`, the live gates, `bench/nav-benchmark.py`,
`jsmin-verify`, the full token-stream compare. Started detached through `tools/bg.sh` and paired,
in the same turn, with `tools/bg-wait.sh <run-id>` as a background command; the result is reported
unprompted when it arrives. "I started it" is not a status. `docs/development.md`.

- **No bash call runs longer than 5 minutes** (`BASH_MAX_TIMEOUT_MS` in `.claude/settings.json`).
  One that would is T2 by definition; one that hits its timeout is never re-run with a larger one.
- **A tier is lowered by the maintainer, never by the agent.** The gate is started detached, or
  waived out loud.
- **Done is "has run on a real userland on both package managers"** — 25.12/apk and 24.10/opkg —
  held by CI's `verify` job and by the maintainer. Say which of the two a run actually covered; a
  stubbed harness proves a module initialises, nothing more.
- **CI's `lint`, `build`, `verify`, `live` and `anchors` are not reproduced locally**; read them
  with `gh run view`. On a PR `live` and `anchors` boot owrt2512 only, so the 24.10 half of a
  behaviour claim comes from a push, a tag, or a detached local run.
- **A finding about the stands goes in `docs/development.md`, "The stand's own traps", in the same
  session** — what it looked like, what it was, and the command that tells the two apart.
- **One fault, one mechanism — prove that one holds alone.** A spare added "to be safe" is measured
  with the first on its own; if the probe still passes, it does not ship (openwrt/luci#8981).
- **`/security-review` before every release and every upstream PR**, on the final branch diff.
  Surface: the installer's signature chain, shell over a build tree, the login template, sinks in
  the browser JS, the packaging pipeline.
- **Prove a CSS change with a computed-style diff, not screenshots.** Cheap half:
  `npm run computed-diff`; the live half is T2 and not finished until its numbers are read.
- Screenshots, `tools/bg.sh` logs and any other scratch artefact go in `../tmp/`, never inside
  the checkout.

## Comments

Every rule, with the example behind it: `docs/conventions.md`, "Comments". Read it before a comment
pass. Two of them break something silently and are repeated here for that reason alone:

- **Some comments are code** — `@mirror`/`@endmirror`, `/* fs:probe */`, the eslint `'require …'`
  pragmas, the Makefile's buildroot marker. Reword one and a gate or the build breaks.
- **A `#` line inside a quoted `ssh "$R" "…"` string is part of the string**: `sh -n` after editing.

## Crew

The main thread is the lead. It reads no screenshots, runs no gate, edits nothing beyond a
one-sentence diff, and uses Bash for `git status`, `git diff --stat` and `git log` only. The work
goes to a role in `.claude/agents/`: `developer` (writes inside the card's file list, runs T0),
`tester` (the full cycle, read-only, PASS/NEEDS_WORK with evidence), `security` (`security-review`
on the task diff), `researcher` (sourced answers, ranked), and `caveman:cavecrew-investigator`
to locate code. Delegate when a task touches more than one file, needs any gate beyond T0, or would
put more than ~50 lines of tool output into this thread. Protocol and schemas: `docs/crew.md`.

Every delegation carries four fields: **objective** (one sentence + `../tmp/task-<id>/card.json`),
**output format** (the role's return block, ≤25 lines, paths not contents, no diffs), **tools and
sources** (the `.claude/rules/` file for the area by path, the acceptance commands with expected
output), **boundaries** (the file list; anything outside it is reported, not edited). A subagent
inherits no history: what is not in the prompt or the card does not exist for it.

Loop: developer → tester → at most 2 fix rounds. Stop when T0 is green, the verdict has no blocking
finding and the last round touched no file outside the previous round's set. Round N+1 gets the
inter-round diff, the previous findings and fresh gate output — never the full diff again. A stall
— the same blocking finding id twice, or the same `diff_hash` twice — goes to the human, not into
another round. `security` runs per task except CSS-only or one-line diffs; any finding goes to the
human and is never auto-fixed. The Opus `/security-review` before a release or PR stays.

Always through the human: `git commit`, `git push`, a hardware router (`dev-sync.sh` is `ask`),
lowering a tier, waiving a gate, a security finding, a stall. The lead quotes the verdict block, not
the log; a log is read by the role that produced it.

## Commits

**Conventional Commits, message in English. Never commit OR PUSH without an explicit instruction for
that action, each time.** Finished work, green gates, a verified fix or an answered review is not
authorization. This holds for BOTH remotes — `origin`, and the openwrt/luci fork behind a PR, where
amend + `push --force-with-lease` is a push like any other. Leave the tree dirty and say what would
go in; wait to be told. No co-author / "Generated with" / AI attribution trailers.

**Nothing is published without an explicit instruction, each time**: no PR comment, no review, no
issue comment, no reply on an upstream thread. A review finding is answered in the DIFF and by
resolving the thread (`/upstream-pr`). This is a rule, not a matcher: `permissions` in
`.claude/settings.json` fence none of it, on purpose.

`git commit` and `git push` are `ask` in `.claude/settings.json`; trailers are stripped by
`attribution` there and by `.githooks/commit-msg`. Every commit carries its changelog entry in both
files — `.claude/rules/changelog.md`, enforced by `.claude/hooks/precommit-gate.sh`.

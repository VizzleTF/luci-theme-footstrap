`luci-theme-footstrap` — a LuCI theme for **OpenWrt 24.10.3 and newer** (and ImmortalWrt), depending
on nothing but `luci-base`. App view-JS renders page content client-side, so the theme is server
chrome (`ucode/template/themes/footstrap/*.ut`) + one generated `cascade.css` + `fs-*.js` in
`htdocs/luci-static/resources/`. The floor is 24.10.3 (`ui.RangeSlider`); 23.05 ended at 0.14.2,
which `install.sh` pins for it (`docs/releasing.md`).

**Russian prose to the maintainer, including right after an English subagent or background result.**
Code, comments, commit messages and PR text stay in English.

`styles/base/` is footstrap's own base. The name bootstrap belongs to the *other, real* package only:
the `/luci-static/bootstrap` fallback, the `bench/` baseline, the attribution in `styles/00-header.css`.

**Repo root is the workspace** (`package.json`, `tools/`, `docs/`, `owlab.yaml`, `install.sh`); the
shipped package is `luci-theme-footstrap/` one level down, so write paths rooted or absolute.
Start sessions here: the parent (`luci-fork/`, `tmp/`) is no git repository and loads none of this
file, its rules or its hooks. `../tmp` and .claude/worktrees are not the repo: search with
`git grep`. The Bash tool runs zsh: quote globs and `'== X'`, test with `[ a = b ]`, put bash-only
code in `bash -c`.

## Read the doc first

| Touching | Read |
|---|---|
| what LuCI expects of a theme, where the boundary runs | `docs/architecture.md` |
| the rule list with the gate that holds each one, the comment rules | `docs/conventions.md` |
| dev routers, proving a change, the probe rig, the stand's traps | `docs/development.md` |
| roles, the card, the loop, autonomy, guardrails, skills | `docs/crew.md`, `docs/ai-architecture.html` |
| `styles/`, cascade layers, `build-css.sh`, `@mirror` | `docs/css.md` |
| tokens, palettes, type, the Appearance axes | `docs/design-system.md` |
| sidebar / bar / rail, the menu renderer, the fit | `docs/chrome.md` |
| the reader's place through a poll tick | `docs/anchoring.md`, `docs/anchoring-log.md` |
| client navigation | `docs/spa-router.md` |
| foreign `luci-app-*`, the fence | `docs/third-party-apps.md` |
| Makefile, uci-defaults, postinst/postrm, ACL | `docs/package.md` |
| CI job graph, reading a run, owfeed, the trust chain | `docs/ci.md` |
| pre-release checklist, changelog contract, runbook | `docs/releasing.md` |

`docs/gallery.html` renders every widget LuCI or an app can emit; the browser gates measure it.
Area rules load with their files from `.claude/rules/` (css, js, chrome, package, changelog).

## Commands

```sh
tools/bg.sh <cmd>                  # T2: detach, log into ../tmp/; refuses ssh, commit, push, tag
tools/bg-wait.sh <run-id>          # its waiter (a full ci-local takes `30 10800`)
tools/ci-watch.sh --sha <sha>      # a commit's CI runs -> one verdict line; run via tools/bg.sh
./tools/stage.sh && owfeed build   # the package routers get, both formats into dist/
owlab up | owlab sync --watch | owlab open owrt2512
luci-theme-footstrap/dev-sync.sh <host>   # HARDWARE router over ssh: the maintainer's word each time
```

## Verifying

- **T0, the developer's, always, foreground, 60 s:** `npm test`, the area's T0 gate, and a template's
  compile (`.claude/rules/chrome.md` "Templates"; a down stand boots as T2 first, outside the 60 s).
- **T1, the tester's, on request, 5 min:** `npm run check` once on a finished branch; `npm run smoke`
  and `npm run computed-diff` after JS or CSS. The lead runs `npm run check:fast` on its own edits
  and `.githooks/pre-push` on a push, reading the output only on failure (tail).
- **T2, never blocked on past one waiter:** owlab, live gates, the benchmark, `jsmin-verify`:
  `tools/bg.sh` + its waiter, same turn: `tools/bg-wait.sh <run-id> 5 270` with `timeout: 300000`
  in the foreground for a run under 4.5 min, else in the background; report unprompted, ETA >15 min.
- A Bash call stays under 5 minutes; one that would is T2, and a timeout is never retried larger.
- **Done = ran on a real userland on both package managers** (25.12/apk, 24.10/opkg: CI `verify`);
  say which one a run covered. Before/after baselines use the last package published in the feed.
- A red CI job: `tools/ci-log.sh <run-id>`, then `tools/ci-local.sh --force <job>` before any
  hypothesis. "Flaky" and "fixed" are a rate (`tools/rate.sh`).
- One fault, one mechanism: a spare added "to be safe" ships only if the probe fails without it.
- Prove CSS with a computed-style diff; screenshots and scratch files go in `../tmp/`.
- A stand finding goes in `docs/development.md` "The stand's own traps" the same session; an owlab
  or owfeed fault also gets an issue draft (command, exact error, `owlab version`, host).
- `/security-review` on the final diff before every release and every upstream PR.
- Some comments are code (`@mirror`/`@endmirror`, `/* fs:probe */`, eslint `'require …'` pragmas,
  the Makefile's buildroot marker, the literal `dataset.fsFit` write): keep them verbatim. A `#` line
  in a quoted `ssh "$R" "…"` string is part of it: `sh -n` after editing. Rest: `docs/conventions.md`.

## Crew

The main thread is the lead: it orchestrates and edits `docs/**` and config. Code of any size
(`luci-theme-footstrap/**`, `tools/**`, `tests/**`, `install.sh`, `package.json`, `.githooks/**`,
`.github/**`, `.claude/hooks/*.sh`, `.claude/tooling/**`) goes with a card to a role in
`.claude/agents/`, as does a task needing a gate beyond T0 or bringing ~50 lines of output. The
lead's Bash runs git, `npm run check:fast` and the commands a skill it runs spells out (`/ship`,
`/release`, `/retro`, `/upstream-pr`); any other gate, stand, probe or screenshot is a role's card,
a live reproduction a `tester` card. Budget: under 15k characters of tool output per card. Status:
at most 5 lines (done / running with task ids + ETA / waiting on the maintainer), on a state change.
Through the maintainer: a security vulnerability, a stall, the per-word items in "Commits".

A guard is probed through its decision path alone (`tools/bg.sh --check`, hook JSON to `--kinds`);
real git runs in a scratch repo outside this checkout (`docs/crew.md` "Probing a guard").

**Fix policy:** root cause, shared place, established practice; ask before deferring a known defect.

## Commits

Standing grant: the agent commits and pushes to `origin` (`main` and its own `claude/*`, `feat/*`,
`fix/*` branches) on its own judgement, through `/ship`, when all four hold: (1) T0 is green; (2)
both CHANGELOG entries are in the commit (`node tools/changelog.mjs add … && git commit …`;
`.claude/hooks/precommit-gate.sh` refuses otherwise); (3) the branch is based on `origin/main`; (4)
Build's newest completed push run on `main` is `success` (`/ship` step 4), or this push fixes it.
The push runs `.githooks/pre-push` (`npm run check`, 2–4 min): `timeout: 300000` or
`run_in_background`. After every push, same turn: `tools/bg.sh tools/ci-watch.sh --sha <sha>` +
`tools/bg-wait.sh <run-id>` in the background; report the verdict line unprompted.

Also the agent's: rebase, amend and `git push --force-with-lease` on its own branches; the
`release: x.y.z` commit and push inside `/release` once the maintainer asked for that release; the
feed publication after a tag. The lead stages by path only what the agent wrote, and commits; the
maintainer's hunks stay unstaged and roles never stage. Detached runs never commit, push or tag.
Every commit and push runs its hooks (git-guard refuses `--no-verify`, `-n` on commit,
`core.hooksPath`). Conventional Commits, English, no attribution trailers. New work branches from
`origin/main`.

**IMPORTANT: the maintainer names each of these, each time,** and each runs in its own Bash call (a
tag's create and its push are two): a tag created, moved, deleted or pushed (`git tag`, `--tags`,
`--follow-tags`, `refs/tags/*`); `gh release create|edit|delete|upload`; a Pages deploy (`publish-pages`, `pages.yml`); force-push,
rebase or amend of commits already on `origin/main`; `git reset --hard` of pushed work. A tag word
names the tag: "tag 0.14.17", "делай тег", "release 0.14.17".

Also per word, each time: any push to the openwrt/luci fork and every upstream PR action; every
publication (PR or issue comment, review, upstream reply, owlab/owfeed issue; the agent drafts);
the hardware router; lowering a tier; waiving a gate.

# CLAUDE.md

`luci-theme-footstrap` — a LuCI theme for **OpenWrt 24.10 and newer** (and ImmortalWrt). Standalone:
it ships no framework and depends on nothing but `luci-base`. Page content is rendered client-side
by app view-JS, so the theme is server chrome (`ucode/template/themes/footstrap/*.ut`) + one
generated `cascade.css` + `fs-*.js` in `htdocs/luci-static/resources/`.

**Communicate in Russian.** Code, comments, commit messages and PR text stay in English.

**The floor is 24.10.** 23.05 support ended at 0.14.2: `ui.RangeSlider` arrived in 24.10, the
Appearance tab is built in one try/catch, and the whole tab died there until a user reported it —
upstream declined to carry that code (openwrt/luci#8978). `install.sh` serves a 23.05 router the
pinned 0.14.2 and says it is the last one. `docs/releasing.md`.

`styles/base/` began as a fork of `luci-theme-bootstrap`'s cascade.css and is footstrap's code now:
**do not call it "the fork" or reintroduce the word bootstrap** into filenames, comments or docs.
That name is legitimate only for the *other, real* package — the `/luci-static/bootstrap` fallback
in `uci-defaults`, the `bench/` baseline, and the Apache-2.0 attribution in `styles/00-header.css`.

**Repo root is the workspace** (`package.json` gates, `tools/`, `docs/`, `owlab.yaml`,
`install.sh`); the shipped package is `luci-theme-footstrap/` one level down — same name, one level
apart, so a path is ambiguous unless it is absolute or rooted. Nothing in the root ships, and the
OpenWrt buildbot has no node. **Work from the repo root, not from its parent**: the parent holds
`luci-fork/` and `tmp/`, is not a git repository, loads none of this file, and makes `owlab` exit
with `no owlab.yaml found`. `.claude/hooks/session-start.sh` says so at startup.

## Read the doc first

`docs/` is the reference and every page carries the measurement behind each rule. Do not re-derive
what a doc already settled.

| Touching | Read |
|---|---|
| what LuCI expects of a theme, where the boundary runs | `docs/architecture.md` |
| the rule list with the gate that holds each one | `docs/conventions.md` |
| dev routers, pushing a change, proving it | `docs/development.md` |
| `styles/`, cascade layers, `build-css.sh`, `@mirror` | `docs/css.md` |
| tokens, palettes, type, the Appearance axes | `docs/design-system.md` |
| sidebar / bar / rail, the menu renderer, the fit | `docs/chrome.md` |
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
npm run check                              # T1: all 26 gates; exit 0 before pushing
npm run check:fast                         # the 16 that need no browser and no CSS build
npm test                                   # T0: the unit suite alone (node --test, no browser)
npm run smoke                              # T1: modules come up in a real DOM (~1.4 s)
npm run computed-diff                      # T1: worktree vs HEAD, computed styles (~4 s)
tools/bg.sh <cmd>                          # T2: detach, print the run-id, log into ../tmp/
node tools/build-icons.mjs                 # re-raster the app icons after a logo.svg change
owlab up | owlab sync --watch | owlab open owrt2512
./tools/stage.sh && owfeed build           # both formats into dist/
owlab test --release 25.12.4 --install 'dist/noarch/luci-theme-footstrap-*.apk' --assert …
ucode -T -c -o /dev/null <template>.ut     # syntax-check a template the way LuCI does
luci-theme-footstrap/dev-sync.sh <host>    # deploy to a HARDWARE router over ssh
npm run fork-drift                         # what the two trees disagree about
```

## Verifying

Every gate sits in exactly one tier, and the tier says who runs it and whether waiting on it is
allowed. Tiering removes nothing: the release matrix in `/release` and `docs/releasing.md` is
unchanged, and CI runs its jobs on every pull request regardless of what was run in a session.

**T0 — always, foreground, 60 s.** `npm test`; the ONE `node tools/<name>.mjs` that covers the file
just edited (the map is in each `.claude/rules/` file and in `docs/conventions.md`);
`ucode -T -c -o /dev/null` over each template touched this session. Nothing else runs by reflex.

**T1 — on an explicit request, 5 min.** `npm run check` once, when the branch is otherwise finished
— not before every edit. `npm run smoke` and `npm run computed-diff` after a JS or CSS change:
seconds each, and they catch the regression that is in the file rather than in the page.

**T2 — never blocked on.** `owlab up|test`, `npm run live`, `bench/nav-benchmark.py`, the live
computed diff, `jsmin-verify`, the full token-stream compare. Started detached through `tools/bg.sh`
or left to CI, run-id reported the moment it starts: `tail -n 40 ../tmp/<run-id>.log`.

**Detached is not unattended.** `tools/bg.sh` uses `setsid`, so nothing upstream of it — no task
list, no completion event — knows the run exists; the only trace is the log and the `.status` file
beside it. A run started and then forgotten is the failure mode this tier invites, and it is
expensive: three times in one session a chain finished green or red and nobody looked for another
15-30 minutes, twice while the maintainer was waiting on exactly that answer. So every `bg.sh` call
is paired, in the same turn, with something that WAKES you when it ends — a background wait on its
`.status` file is enough:

```sh
until [ -f ../tmp/<run-id>.status ]; do sleep 30; done; cat ../tmp/<run-id>.status
```

Report the result unprompted when it arrives. "I started it" is not a status, and being asked
"what's there?" means the pairing was skipped.

- **Foreground rule: no bash call runs longer than 5 minutes.** A command that would is T2 by
  definition — start it detached, name the run-id, move on. Idling against a running command is a
  defect, not diligence. A command that hits its timeout is never re-run with a larger one; it moves
  to T2. Enforced by `BASH_MAX_TIMEOUT_MS` in `.claude/settings.json`.
- **A tier is lowered by the maintainer, never by the agent.** "This T2 gate is not needed here" is
  not a judgement available to make: the gate is started detached, or waived out loud.
- **The definition of done is not the list the agent verifies.** "Has run on a real userland on
  **both** package managers (25.12/apk and 24.10/opkg)" stays the release contract, held by CI's
  `verify` job and by the maintainer. It is not a per-edit obligation and never a reason to stop
  working. Still say which of the two a run actually covered — a stubbed harness proves a module
  initialises, nothing more, and a cheap gate never earns a release the right to skip owlab.
- **These T2 gates run in CI on every pull request and are not reproduced locally**: `lint` (every
  npm gate plus `jsmin-verify`), `build` (both formats), `verify` (this build installed on a real
  25.12 AND a real 24.10 userland, plus the `ucode -T -c` sweep), `live` and `anchors`. Read them
  with `gh run view`. CI narrows two axes on a PR and widens them on a push or tag: `live` and
  `anchors` boot owrt2512 only, so the 24.10 half of a behaviour claim comes from a push, a tag, or
  a detached local run.
- **A finding about the stands goes in `docs/development.md`, in the same session it was found.**
  Not in a commit message, not only in the changelog, not in a comment on the code it happened to
  touch: the next person hits it while measuring something unrelated, and the only place they will
  look is the page about dev routers. "The stand's own traps" is that section. Each entry says what
  it looked like, what it actually was, and the command that tells the two apart — a trap written
  down without its check is a story. The same holds for a gate that reports something the theme did
  not do: name the page and how to prove it is the app's.
- **One fault, one mechanism — and prove that one holds alone.** A second mechanism added "to be
  safe" must be measured with the first one on its own: if the probe still passes, the spare was
  never needed and does not ship. The Appearance tab's vanishing after a Save (openwrt/luci#8981)
  went in with an attribute watch AND a retry ladder, both landed together, both passed; the ladder
  turned out to catch nothing, and a maintainer had to ask. A suspicion about risk is an experiment
  to run, not a justification to write into a comment. That experiment is T2: run it detached, and
  the spare does not ship until its log has been read and its result stated.
- **`/security-review` before every release and every upstream PR.** It reads the branch diff, so it
  runs once the branch is final and before the tag or the `gh pr create` — not after, and not per
  edit. Surface: the installer's signature chain, any new shell that runs over a build tree, the
  login template (that page is unauthenticated), sinks in the browser JS, the packaging pipeline. A
  maintainer asked outright whether one had been done (openwrt/luci#8981).
- **Prove a CSS change with a computed-style diff, not screenshots.** Live counters move 0.5–1.3% of
  pixels between two runs of the *same* sheet while a real regression weighs 0.19%. Cheap half:
  `npm run computed-diff`. Live half: T2, and not finished until its numbers are read and quoted.
- Screenshots, `tools/bg.sh` logs and any other scratch artefact go in `../tmp/`, never inside the
  checkout. Partly enforced by `permissions.deny` in `.claude/settings.json`.

## Comments

- **Minimally sufficient: the shortest text that still carries the reason.** An inline comment is
  one line, two if the reason needs a number; a block is justified only when it covers several
  rules at once, and a module header is a short paragraph, not a page. Anything longer belongs in
  `docs/`, pointed at from the code in one line. Cut every word that removing does not lose a fact.
- **A comment says why, not what.** One that restates the line it sits on is deleted, not reworded.
  What a reader cannot recover from the code is the reason: the constraint, the alternative that
  failed, the number that was measured.
- **Carry the measurement, not the adjective.** "overflows" is unfalsifiable; "19-109px of overflow,
  once per poll tick, on Firewall/DHCP/Wireless" tells the next reader whether the rule still earns
  its place and how to re-run the check. Same for widths, timings, counts, and the viewport and
  density they were taken at.
- **A negative result stays, in one line** — "tried X, it did Y" is the cheapest way to stop the
  next session re-trying it (`display: none` on top of a zeroed tab pane buys nothing: scrollHeight
  1039 either way). The narrative around it does not stay: how it was first written, what was
  renamed, which attempt came in which order. Current state, present tense.
- **A number or a name in a comment is part of the contract.** 15 comments said the poll re-renders
  "once a second" while `pollinterval` ships at 5 s — a claim that reads as measured and was not.
  The comment changes in the same edit as the code, or it becomes a lie git preserves forever.
- **References are the part that cannot be rebuilt**: issue numbers (#19, openwrt/luci#8981), spec
  text quoted verbatim (WCAG SC 1.4.10's exception, HTML-AAM), upstream commits, file paths. A
  compression pass may cut the sentence around them; it may not cut them.
- **Some comments are code**: `@mirror name/tag` / `@endmirror` (`npm run mirror`), `/* fs:probe */`
  (`strip-probes.sh`), the eslint `'require …'` pragmas, and the Makefile's buildroot signature line
  that scan.mk greps for, which must stay last with nothing between it and the text it announces
  (`npm run marker`). Reword one and a gate or the build breaks — silently, in the Makefile's case.
- **Formal English, no theatre** — no exclamation, no shouting a fix, no addressing the reader. A
  module header states purpose and invariants; an inline comment explains the rule it sits above and
  nothing else. Never stack a second comment on the first: edit the one that is there.
- **Comments cost no router bytes.** `strip-templates.sh`, `strip-shell.sh` and `build-css.sh` remove
  every one at package time and git keeps every word, so **never trade a "why" away for bytes**. A
  stale comment is worse than none.
- **A comment inside a quoted command string is part of the string** — the `#` lines inside
  `ssh "$R" "…"` in `dev-sync.sh` keep their escaped backticks and `$`. Run `sh -n` after any such
  edit.
- **After a bulk comment pass, prove the code did not move**: a token-stream compare against HEAD for
  every JS file, a comment-stripped and whitespace-normalised diff for CSS, `.ut`, shell and yaml.
  That is what caught a deleted Makefile marker and a lost shell escape; no gate would have. The
  full-tree compare is T2 — `tools/bg.sh`, and the pass is not finished until its output has been
  read and reported.

## Commits

**Conventional Commits, message in English. Never commit OR PUSH without an explicit instruction for
that action, each time.** Finished work, green gates, a verified fix or an answered review is not
authorization, and yesterday's "commit and push" covers yesterday only. This holds for BOTH remotes
— `origin` here (the only remote of THIS repository), and the openwrt/luci fork behind the PR, where
the amend + push `--force-with-lease` sequence is a push like any other. Leave the tree dirty and
say what would go in and where it would go; wait to be told. No co-author / "Generated with" / AI
attribution trailers.

`git commit` and `git push` are `ask` in `.claude/settings.json`; the trailers are stripped by
`attribution` there and by `.githooks/commit-msg`, which holds whatever the client does. Every
commit carries its changelog entry in both files — `.claude/rules/changelog.md`, enforced by
`.claude/hooks/precommit-gate.sh`. **Never post a comment on the upstream PR**: a review finding is
answered in the DIFF and by resolving the thread (`/upstream-pr`, enforced by `permissions.deny`).

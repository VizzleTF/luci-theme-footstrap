---
name: ship
description: Commit and push finished work in this repo to its origin/main, then watch its CI to a verdict. Use when the work is done and T0 is green — коммить, пушь, отправь, ship it. Not for the openwrt/luci PR or its fork branch (в апстрим, в luci, ответ на ревью) — that is /upstream-pr.
---

# Ship finished work

The standing grant in `CLAUDE.md` `## Commits` covers every step here. A tag goes through `/release`.

0. **T0 is green.** Read the `gates:` block of the developer's return for this diff: every line
   exits 0. Without one (the lead's own docs or config edit), run `npm run check:fast` in the
   foreground: it holds `npm test` and `agent-refs`. Done = those gate lines, or its exit 0, quoted
   in the report.

   A diff with a package path (`luci-theme-footstrap/**`, `install.sh`) or a guard path
   (`.claude/hooks/**`, `.claude/settings.json`, `.githooks/**`, `.github/workflows/**`) also needs
   the tester's `PASS` (and `security` `CLEAN` for a guard path) on the staged content: append
   `{ "round", "tree", "verdict", "security"?, "blocking" }` from the block to the card's `history`
   and quote the entry in the report. `precommit-gate.sh` asks at step 3 without it. Other paths
   ship on T0 and the pre-push check; their tester card runs after the push, same session.
1. **Base on `origin/main`, before anything is staged** (a staged index makes a rebase refuse).
   `git fetch origin`, then `git rev-list --left-right --count origin/main...HEAD` prints
   `<behind> <ahead>`:
   - `0 …`: the base holds.
   - `N 0`: `git merge --ff-only origin/main`. It runs over unstaged edits and refuses, naming the
     file, only when an incoming commit touches one.
   - `N M` (unpushed commits): `git rebase origin/main`, only with a clean tracked tree
     (`git status --porcelain --untracked-files=no` empty). When the dirty paths are only this
     task's files, run steps 2–3 first, then this step, then continue at step 4.

   Never stash, never `--autostash`: it hides the maintainer's hunks. Any other dirty path or git
   refusal is a stop: nothing is pushed, and the report names each path and asks the maintainer
   what to do with it. Done = `git merge-base --is-ancestor origin/main HEAD` exits 0, or the stop.
2. **Stage what this task wrote.** `git status --short`, then `git add <path> …` by explicit path:
   the card's files, or with no card the files the lead edited in this task, and nothing else (the
   maintainer's own hunks stay unstaged). A path that was dirty before this task started (the
   card's `../tmp/task-<id>/dirty-at-start`, or `git status` read before the first edit) is a stop:
   name it and ask; it is never staged whole, since `git add <path>` takes the maintainer's hunk too.
   Done = `git diff --cached --name-only` lists exactly those files, or the stop.
3. **Commit with both changelog entries**, one Bash call (`.claude/rules/changelog.md` for the
   section index and the entry shape):
   ```sh
   node tools/changelog.mjs add <0-7> --en '- **Lead.** …' --ru '- **Лид.** …' \
     && git commit -m '<type>(<scope>): <summary>'
   ```
   Section 7 (`Development` / `Разработка`) takes a change a theme user never sees: crew, hooks, gates,
   CI, tooling, tests, agent docs; `release-notes.sh` leaves it out of the release page. A change to
   `luci-theme-footstrap/**`, `install.sh` or the feed takes its user-facing section (0-6).
   Conventional Commits, English, no trailers. Only a CLAUDE.md-only commit or a fix to an
   [Unreleased] entry skips `add` (.claude/rules/changelog.md). Done = `git log -1 --stat` shows both CHANGELOG files, or the report names the exemption that applied.
4. **Main is not red.** `gh run list --branch main --workflow build.yml --event push --status completed -L1 --json conclusion,headSha,databaseId`
   reads `success`, or this push is the fix for it, said in the report. Only Build's push run
   counts: CodeQL, pages and Dependabot runs on `main` are not the reading. A `cancelled` or
   `skipped` latest run says nothing about main: the newest completed run before it (`-L2`) decides,
   and the report names both. A `failure` whose failing job's log (`tools/ci-log.sh <id>`) matches
   a row of `docs/development.md` "Known flakes" gets one `gh run rerun <id> --failed` and a new
   `tools/ci-watch.sh` wait; a second red, or no matching row, goes to the maintainer with the log
   line, and a new signature gets a `tester` card to classify it.
5. **Stand gates before the push.** What a push to `main` would prove only after the push goes to
   a `tester` card first; the lead runs no stand and waits for the verdict block.
   - The diff touches `fs-fit.js` or a scroll-anchor/floor gate (both stands, hours): acceptance
     `tools/ci-local.sh --mode push --force build anchors` → every `anchors` step PASS, none SKIP.
   - The diff touches `install.sh`: users fetch it from raw `main` the moment the push lands, and
     T0 only parses it. Acceptance `tools/bg.sh sh tools/install-check.sh owrt2512 owrt2410` →
     PASS on both, the verdict naming 25.12/apk and 24.10/opkg.

   Done = each `PASS` verdict quoted, or the report says it was skipped and why.
6. **Push.** `git push origin HEAD` with `timeout: 300000`: `.githooks/pre-push` runs
   `npm run check` on the pushed commit in a clean worktree, not on the working tree. A red hook is
   a fix and a new commit, then this step again; a non-fast-forward rejection (origin moved
   meanwhile) is step 1 again.
7. **Watch CI**, in the same turn as the push:
   ```sh
   tools/bg.sh tools/ci-watch.sh --sha "$(git rev-parse HEAD)" --max 6000
   tools/bg-wait.sh <run-id>          # run_in_background
   ```
   On red, `tools/ci-log.sh <run-id>`, then a `tester` card reproducing the job
   (`tools/ci-local.sh --force <job>`) before the cause is named as diff, infrastructure or flake (a
   flake is a measured rate, `tools/rate.sh`). Done = the `ci:` verdict line reported unprompted,
   plus on red the card's reproduction result.

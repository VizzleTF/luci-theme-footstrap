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
   node tools/changelog.mjs add <0-6> --en '- **Lead.** …' --ru '- **Лид.** …' \
     && git commit -m '<type>(<scope>): <summary>'
   ```
   Conventional Commits, English, no trailers. Only a CLAUDE.md-only commit or a fix to an
   [Unreleased] entry skips `add` (.claude/rules/changelog.md). Done = `git log -1 --stat` shows both CHANGELOG files, or the report names the exemption that applied.
4. **Main is not red.** `gh run list --branch main -L1 --json conclusion,headSha` is not `failure`,
   or this push is the fix for it, said in the report.
5. **Anchoring gates.** When the diff touches `fs-fit.js` or a scroll-anchor/floor gate, what a
   push to `main` runs (both stands, hours) goes to a `tester` card before the push, acceptance
   `tools/ci-local.sh --mode push --force build anchors` → every `anchors` step PASS, none SKIP.
   The lead runs no stand and waits for the verdict block. Done = the `PASS` verdict quoted, or the
   report says it was skipped and why.
6. **Push.** `git push origin HEAD` with `timeout: 300000`: `.githooks/pre-push` runs
   `npm run check`. A red hook is a fix and a new commit, then this step again; a non-fast-forward
   rejection (origin moved meanwhile) is step 1 again.
7. **Watch CI**, in the same turn as the push:
   ```sh
   tools/bg.sh tools/ci-watch.sh --sha "$(git rev-parse HEAD)" --max 6000
   tools/bg-wait.sh <run-id>          # run_in_background
   ```
   On red, `tools/ci-log.sh <run-id>`, then a `tester` card reproducing the job
   (`tools/ci-local.sh --force <job>`) before the cause is named as diff, infrastructure or flake (a
   flake is a measured rate, `tools/rate.sh`). Done = the `ci:` verdict line reported unprompted,
   plus on red the card's reproduction result.

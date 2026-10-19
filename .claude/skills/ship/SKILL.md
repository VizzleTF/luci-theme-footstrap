---
name: ship
description: Commit and push finished work in this repo, then watch its CI to a verdict. Use when the work is done and T0 is green — коммить, пушь, отправь, ship it.
---

# Ship finished work

The standing grant in `CLAUDE.md` `## Commits` covers every step here. A tag goes through `/release`.

1. **Stage what this task wrote.** `git status --short`, then `git add <path> …` by explicit path:
   the card's files and nothing else (the maintainer's own hunks stay unstaged).
   Done = `git diff --cached --name-only` lists exactly those files.
2. **Base on `origin/main`.** `git fetch origin && git merge-base --is-ancestor origin/main HEAD`;
   when it fails and the local commits are unpushed, `git pull --rebase origin main` — run it with
   only staged-and-committed work in the tree; a tree holding the maintainer's unstaged hunks stops
   here and reports (rebase would refuse, and `--autostash` would hide their hunks in a stash).
   Done = the ancestor check exits 0.
3. **Commit with both changelog entries**, one Bash call (`.claude/rules/changelog.md` for the
   section index and the entry shape):
   ```sh
   node tools/changelog.mjs add <0-6> --en '- **Lead.** …' --ru '- **Лид.** …' \
     && git commit -m '<type>(<scope>): <summary>'
   ```
   Conventional Commits, English, no trailers. Only a CLAUDE.md-only commit or a fix to an
   [Unreleased] entry skips `add` (.claude/rules/changelog.md). Done = `git log -1 --stat` shows both CHANGELOG files.
4. **Main is not red.** `gh run list --branch main -L1 --json conclusion,headSha` is not `failure`,
   or this push is the fix for it, said in the report.
5. **Anchoring gates.** When the diff touches `fs-fit.js` or a scroll-anchor/floor gate, run
   `tools/bg.sh tools/ci-local.sh --force anchors` + `tools/bg-wait.sh <run-id>` first, or say in
   the report that it was skipped.
6. **Push.** `git push origin HEAD` with `timeout: 300000`: `.githooks/pre-push` runs
   `npm run check`. A red hook is a fix and a new commit, then this step again.
7. **Watch CI**, in the same turn as the push:
   ```sh
   tools/bg.sh tools/ci-watch.sh --sha "$(git rev-parse HEAD)" --max 6000
   tools/bg-wait.sh <run-id>          # run_in_background
   ```
   Done = the `ci:` verdict line reported unprompted; on red, `tools/ci-log.sh <run-id>` read and the
   failure named as diff, infrastructure or flake (a flake is a measured rate, `tools/rate.sh`).

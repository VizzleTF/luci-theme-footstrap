---
name: upstream-pr
description: The theme's pull request in openwrt/luci — build or rebuild the branch from the latest release tag, preflight it, answer review. Use for PR в апстрим, отправить в luci, ответить на ревью, пересобери ветку, upstream PR.
argument-hint: "[PR number]"
---

# PR to openwrt/luci

The theme lives upstream since 2026-08-20. Code is almost always accepted; PRs bounce on **form**:
how the commits are cut and how long the messages are. Short is the rule over every other rule: the
median commit body in openwrt/luci is three lines and says WHAT changed.

## Order

1. **Split plan** — before any branch work, list the upstream commits: one per independent concern.
   Done = the plan names each commit's subject and the tag commits it replays. → `reference/mechanics.md` Step 2
2. **Branch** — replay the latest release tag's states (never `main`) in a worktree and cut the PR
   commits. Done = Step 3's `diff -r` prints `tip == tag`. → `reference/mechanics.md`
3. **Preflight, before the FIRST push** — our gates, their eslint, their formalities, templates,
   live stands, the `upstream-reviewer` agent on the branch diff. Done = every section of
   `reference/preflight.md` green and the reviewer's verdict `CLEAN`.
4. **Messages** — written last, once the commit set is final: one or two sentences each.
5. **Publish — the maintainer's word, each time.** Show the one-line summary and the exact push and
   `gh pr create` commands; run them on "пушь" / "создавай". PR body: one line per commit; links and
   `Closes #NNNN` live here only. → `reference/mechanics.md` Step 6
6. **Review** — one watcher per PR; bot review handled here, human review reported first.
   → `reference/answering-review.md`

**Who builds it.** The lead cuts a single-commit PR inline (steps 1, 2, 4); its preflight (step 3)
is a `tester` card plus the `upstream-reviewer`, since the lead runs no gate or stand. A
multi-concern release sync goes through the crew (`docs/crew.md`), one card per concern.

## How many commits

One commit per independent concern. A release sync splits by concern — cleanup, API removal,
router/SPA, security, CSS — and the model is the merged #9111 (sync with 0.14.14): six commits
(foreign-app styling; unused plugin and search API; dead CSS rules and tokens; JS dedupe and
pre-24.10 paths; autofocus and shared input checks; full load after a page litters body). A sync
squashed into one commit was sent back for exactly that. Upstream's median of one commit per PR
(72 % single-commit) describes small PRs: one fix, one commit.

## Message form

```
luci-theme-footstrap: lowercase description

What changed, one or two sentences, wrapped at 72 columns.

Signed-off-by: Ivan Kvashonkin <vizzlef@gmail.com>
```

| | upstream norm |
|---|---|
| body | median 3 lines, p90 15 |
| subject | median 47 chars, soft limit 60, hard 80 |
| links and `#NNNN` in the body | absent in 90 % of commits |
| wrap | **72 columns** (the bot's `max_body_line_len` is 100; 72 is ours) |

Several small fixes are listed together, one line each. The investigation, run counts and selector
rationale live in our changelog and code comments. Subject: package prefix, colon, lowercase, no
final period; shared infrastructure (`luci.mk`) takes `treewide:` (the bot rejects `luci.mk:`).

## Hard rules

Each one was paid for by a bounce.

- The commit body carries no `#NNNN` and no link: a force-push re-sends every mention. The PR body
  carries them.
- Compatibility with EOL releases stays out (23.05 refused twice; 24.10 is next).
- Gate-only code ships stripped: an export for a test is marked `/* fs:probe */` and the sync cuts it.
- The theme names no outside site and no repository of its own.
- Migrations "just in case" stay out: OpenWrt assumes a full image upgrade.
- `po/` stays out: Weblate owns it.
- Release branches (`openwrt-25.12`, …) take bug and security fixes only.
- `Makefile`: edit it on the luci side by hand (`sync-luci-fork.sh` does not carry it), mirroring
  our postinst/postrm/conffiles changes; a Makefile change that mirrors ours belongs in the PR.
  `npm run fork-drift` is a report to read, not a gate to empty.
- Comments on the PR: `CLAUDE.md` `## Commits` (the session drafts, the maintainer posts).

## Already refused — do not offer again

1. 23.05 compatibility — "We are the upstream project. We don't need to keep adding compatibility
   code for old releases just because it happens to be possible".
2. A footer link to an outside site — "None of the other themes do that".
3. A long `uci-defaults` with old-version cleanup — cut from 162 lines to 36.
4. Public exports for our gates.

## Checklist before `gh pr create`

- [ ] the split plan holds: one commit per concern
- [ ] each body one or two sentences, wrapped at 72, no links or `#NNNN`
- [ ] subject ≤ 60, lowercase after the colon, no period
- [ ] `Signed-off-by` on every commit; author is the real full name (`git config user.name` in the
      clone), never a `@users.noreply.github.com` address
- [ ] branch is not `master` and names the change
- [ ] `reference/preflight.md` green, `upstream-reviewer` `CLEAN`, `/security-review` read
- [ ] `diff -r` tip == tag (mechanics Step 3)
- [ ] diff carries no `po/` and none of our build scripts; `Makefile` only as a mirror of ours

## Reference

| Need | Read |
|---|---|
| build or rebuild the branch, publish | `reference/mechanics.md` |
| checks before the push | `reference/preflight.md` |
| watching and answering review | `reference/answering-review.md` |

# Watching and answering review

A remark is closed by a change in the diff and by resolving its thread. Anything to say to a person
is drafted in chat and posted by the maintainer (`CLAUDE.md` `## Commits`, publication).

## Watching

One watcher per PR, each with its own seen-file, as a Monitor (one event batch per run):

```
Monitor  command: tools/pr-watch.sh <N> --seen ../tmp/pr-<N>.seen --max 1700
         timeout_ms: 1800000   description: "openwrt/luci #<N> review events"
```

`pr-watch.sh` polls `gh api` once a minute, dedupes events by id in the seen-file (so a re-arm never
replays one), keys CI by the head SHA (a force-push starts from zero), and exits once a review
(human or bot), a comment or a state change (`MERGED`/`CLOSED`) arrives. A failing check does not
wake it; CI arrives as a line in the next batch. Read the batch, then re-arm the Monitor, also on
exit 3 (`--max` elapsed with nothing new). Done = the PR is `MERGED` or `CLOSED`.

**Humans first.** Before reporting any bot event, read every review on the PR:

```sh
gh api repos/openwrt/luci/pulls/<N>/reviews --jq '.[] | "=== \(.user.login) [\(.state)]\n\(.body)"'
```

A review by anyone other than `openwrt-ai` leads the report, above the bot's.

## Two kinds of review

### The bot (`openwrt-ai`) — handled here

The local fix is made without waiting for the maintainer; what reaches openwrt/luci (the push,
resolving a thread) waits for their word. A remark on a comment is applied **verbatim**: the
bot's suggested text goes into the diff as is; any departure is shown as "bot suggests X / I
suggest Y" with the quote. For each remark:

1. **Measure whether it is right.** The bot is wrong noticeably more often than a person: it claimed
   `text-overflow: ellipsis` did nothing although `white-space: nowrap` comes from base; it also
   found a real regression in the chart-label selector.
2. A real defect: fix it in the same round, in the commit it belongs to, then `commit --amend` (or
   a fixup into that commit).
3. A false one: no change; one line in the report on why.

Then show a one-line summary of the round, the exact update command from `mechanics.md` Step 6
and the threads to resolve. On the maintainer's word, push; once the push lands, resolve the
threads that are fixed or measurably refuted, and only those (the same word covers both).

### A person — report and verdict

1. Tell the maintainer a human review arrived.
2. Read it whole, never from the truncated notification.
3. Give a verdict per point: we do it / the reviewer is mistaken, here is why / needs your decision.
4. Obvious fixes go in at once; a disputed point waits for the maintainer's word.

## Commands

```sh
gh api repos/openwrt/luci/pulls/<N>/comments --jq '.[] | "=== \(.path):\(.line // .original_line)\n\(.body)"'
```

Open threads, and resolving one (after the push, on the maintainer's word):

```sh
gh api graphql -f query='query { repository(owner:"openwrt", name:"luci") {
  pullRequest(number:<N>) { reviewThreads(first:30) { nodes { id isResolved path line
    comments(first:1){nodes{body}} } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | "\(.id)|\(.path):\(.line)"'

gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input:{threadId:$id}) { thread { isResolved } } }' -f id="<THREAD_ID>"
```

CI after a push:

```sh
gh api repos/openwrt/luci/commits/$(git -C ../tmp/luci-pr rev-parse HEAD)/check-runs --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'
```

## Drafts for the maintainer to post

**On `'prefs' is not defined`**

> That is an `eslint.config.mjs` defect: it does not read the `'require X as Y'` pragma, so every
> aliased require reports as undefined — 24 of the 30 aliases in the tree, 59 files across 18
> packages. The fix belongs there; I can send it as a separate PR.

**On security review**

> Yes — the branch diff was reviewed: the installer's signature chain, the new shell script, the
> login template, the browser JS and the build pipeline. No findings.

**On old-release compatibility**

> Dropped — the theme targets 24.10 and newer now. A 23.05 router gets the pinned last release that
> runs on it, verified by the same signature and digest as any other artifact.

## Stance

- A thread is resolved only when fixed or refuted by measurement, never by explanation alone.
- "We are the upstream" wins: removing compatibility or moving a change to its own PR is cheaper to
  do than to argue (both times it took hours and was accepted).
- Reworking the form goes into the same branch with `--force-with-lease`; a PR is closed only when
  its subject changes.

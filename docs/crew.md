# Working as a crew

The protocol for a Claude Code session on this repository: a lead thread that delegates, role
subagents that do the work, a card that holds the state, a loop that ends. For the lead and for
whoever edits a role in `.claude/agents/`. The short form is the "Crew" section of `CLAUDE.md`.

Why it exists: the heaviest session on record put 484 Bash results and 20 screenshots through one
context, against 5 delegations, and a context that carries every gate log recalls less of the rest.
A subagent spends tens of thousands of tokens and returns one to two thousand.

## Roles

| Role | Model | Writes | Sees | Returns |
|---|---|---|---|---|
| lead (main thread) | Opus | one-sentence diffs only | the card, the return blocks | decisions |
| `developer` | Sonnet | inside `card.files` | the card, its rules file, a handoff if any | files + gates block |
| `tester` | Opus | nothing | the diff and the card | verdict block |
| `security` | Sonnet | nothing | the diff | findings block |
| `researcher` | Sonnet | nothing | the question | answer + ranked sources |
| `caveman:cavecrew-investigator` | Haiku | nothing | a "where is X" question | `file:line` table |

One `developer` at a time, sequentially: two writers on one card produce two designs for one
problem, which is the failure every published account of parallel coding agents reports.

The tester runs on a different model from the developer: a judge of the same model recognises its
own text and grades it softer. It never sees the developer's reasoning, only the diff. Set the
lead's model with `/model opus`; the roles name theirs in frontmatter.

## The card

The lead writes `../tmp/task-<id>/card.json` before the first delegation. JSON, because models
rewrite JSON less readily than Markdown, and a file outlives a compaction of the lead's context.

```json
{
  "id": "0142-appearance-note",
  "goal": "one sentence",
  "grade": "task",
  "hardware": false,
  "files": ["luci-theme-footstrap/htdocs/luci-static/resources/fs-appearance.js"],
  "rules": [".claude/rules/js.md"],
  "acceptance": [
    { "cmd": "npm run lint:js", "expect": "exit 0" },
    { "cmd": "node tools/page-modules.mjs", "expect": "exit 0" }
  ],
  "live": [{ "gate": "spa-parity", "flags": "--pages /admin/system/system" }],
  "round": 0,
  "max_rounds": 2,
  "history": []
}
```

| Field | Values |
|---|---|
| `grade` | `task`, or `release` — adds `owlab test` on both formats. Any diff touching the Makefile, `root/**`, `build-css.sh`, `tools/stage.sh` or a `strip-*` script is `release` |
| `hardware` | `false` until the maintainer says otherwise for this card |
| `history` | one entry per tester round: `{ "round", "verdict", "blocking": [ids], "diff_hash" }` |

## Return blocks

Every role returns at most 25 lines: paths, not contents; no diff, no code, no story of the
attempt. The shape is in each role's file. The lead quotes the block and never opens the log it
summarises; the role that produced a log is the role that read it.

## The loop

1. **Size the task.** A diff the lead can describe in one sentence, it makes itself. More than one
   file, any gate beyond T0, or more than ~50 lines of tool output: the crew.
2. **`developer`, round 0.** Implements, runs T0, stages what it touched with `git add`, returns.
3. **`tester`.** Reads `git diff HEAD`, runs what the card asks, returns a verdict. Only
   `blocking: true` findings start a round; the rest go into `history` for the maintainer.
4. **Stop** when all three hold: T0 green, no blocking finding, the last round touched no file
   outside the previous round's set.
5. **Otherwise, one fix round.** The developer gets the blocking findings and its previous
   `not_done`. The tester gets `git diff` (worktree against the index, which holds the previous
   round) and the previous findings — never the full diff again. Two fix rounds at most.
6. **Stall.** The same blocking id in two consecutive verdicts, or the same `diff_hash` twice, ends
   the loop: the card goes to the human. A third round on a stalled finding is the ping-pong the
   loop exists to prevent.
7. **`security`**, once, on the final diff. Skipped for CSS-only and one-line diffs. Findings go to
   the human and are never auto-fixed.

While a card is open the index belongs to the loop: commit with `git commit`, not `git commit -a`,
and read `git status` before staging anything else.

The numbers behind the caps: gains of iterative repair sit in the first two rounds; a review
without a new external signal makes the result worse; a stall counter of 2–3 is what production
orchestrators use. Sources, ranked: the research artifact of 2026-09-03.

## Permissions

| Change in `.claude/settings.json` | Why |
|---|---|
| `owlab up/down/sync/test/exec/status`: `ask` → `allow` | disposable containers; a loop that prompts at every sync is not a loop |
| `dev-sync.sh`, `ssh`: → `ask` | the hardware router is the one thing a wrong run breaks for a person |
| `gh pr comment/review`, `gh issue comment`, MCP review calls: deny removed | publishing is a rule in `CLAUDE.md`, given per action, not a matcher |
| `Read/Write/Edit(../tmp/**)`: `allow` | the scratch directory, cards and handoffs |
| `additionalDirectories: ["../tmp"]` | `../tmp` is outside the project root, and the three rules above do not apply until the directory is registered |
| `git stash/clean/restore/reset --hard/checkout -- `, `git add -A|--all|.`: `ask` | the loop owns the index between rounds; these are the verbs that discard a round's work or widen it past the card, and `/upstream-pr` needs them, so they prompt rather than deny |

`tools/bg.sh` carries its own fence: `ssh`, `scp`, `sftp`, `rsync`, `dev-sync.sh`, `git push`,
`git commit`, `git tag` and `gh pr|release|issue` are refused there. The wrapper is allow-listed and
the matcher reads the first word only, so without that fence `tools/bg.sh sh -c '… ssh …'` runs past
every `ask` rule above. `tester` and `security` also carry `disallowedTools: Edit, Write,
NotebookEdit`, which makes "read-only" a fence and not only a sentence in the prompt.

`.claude/rules/*.md` do load inside a subagent when it reads a matching file (probed 2026-09-03,
Haiku subagent, `styles/**`). The developer still reads its rules file by name from the card: a
rule has to be in front of it before the first edit, not after the first Read.

## Measuring the crew

```sh
node .claude/tooling/measure-run.mjs            # newest transcript of this project
node .claude/tooling/measure-run.mjs latest 3
```

The `delegated:` line is the other half of the trade: a subagent writes its own transcript under
`<session>/subagents/`, so the lead's number alone would only ever say that the lead got lighter.
The crew trial of 2026-09-03 reads 152k characters in the lead against 1.54M across 17 subagent
transcripts — the work moved, it did not evaporate.

Per card the crew must show: lead tool-output under 15k characters, zero images in the lead, every
gate log opened by a role, rounds ≤ 2, no stall. Baseline before the crew, as the command above
prints it: 136,544 characters of tool result plus 11 images (1.96 MB of payload) in this project's
largest session, and 417,073 characters, 20 images and 484 Bash calls against 5 delegations in the
largest of `luci-app-footstrap-files`.

Two testers were run side by side on trial card 1 (2026-09-03), `tester` on Opus and `tester-b` on
Sonnet, same prompt and same diff. Opus returned three findings to Sonnet's one: it also caught
that the new changelog entry pointed at files still untracked, and it ran `computed-diff --control`
without being asked, which is what turned 2468 differences from a number into a causal one. Sonnet
cost 36k tokens against 47k and finished in half the time, and found nothing the other missed.
Opus stays; `tester-b` is deleted.

The loop itself was exercised on a second card the same day: round 0 carried a planted `wrap-regex`
defect, the tester returned NEEDS_WORK with two blocking findings, and the developer closed them in
one round by deleting the unreachable helper rather than wrapping its regex — wrapping would have
been polish on dead code. One fix round, no stall, stop condition met.

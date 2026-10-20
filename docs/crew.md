# The AI-development architecture

How Claude Code works on this repository: one lead thread that orchestrates, role subagents that
do the work, a card that holds the state, a loop that ends, and guardrail layers that hold whatever
must hold every time. For the lead and for whoever edits a role, a hook, a skill or a permission.
`CLAUDE.md` carries the always-needed rules and is the single source of the commit policy; this page
is the reference behind it. The interactive diagram is `docs/ai-architecture.html`: an archify
viewer with inline SVG, ~0.7 MB, kept at that size because the interactivity is the point. Its
source is `docs/ai-architecture.json`; edit that and regenerate with the archify skill.

The design follows one principle: the simplest workflow that works, more machinery only where a
measured failure asks for it. A solo frontend package has few parallel subtasks, and multi-agent
runs cost several times the tokens, so this is one writer at a time with read-only reviewers
beside it, not a swarm. Why delegate at all: the heaviest session on record put 484 Bash results
and 20 screenshots through one context against 5 delegations; a subagent spends tens of thousands
of tokens and returns one to two thousand.

## Overview

```mermaid
flowchart TD
  M([Maintainer]) -->|task, per-word approvals| L[Lead: main thread, Opus]
  L -->|writes| C[(card.json in ../tmp/task-id)]
  L -->|Agent, depth 1| D[developer: Sonnet, writes card.files, runs T0]
  D -->|files + gates block| L
  L --> T[tester: Opus, read-only, T1/T2]
  T -->|PASS / NEEDS_WORK| L
  L -.->|NEEDS_WORK, max 2 rounds| D
  L --> S[security / upstream-reviewer / researcher: read-only]
  L -->|/ship| G{git-guard + precommit-gate hooks}
  G -->|commit + push origin| P[.githooks/pre-push: npm run check]
  P --> CI[GitHub CI: check, lint, build, verify apk+opkg, live, anchors]
  CI -->|tools/ci-watch.sh verdict| L
  L -->|tag, release, fork push, publication| M
  H[[SubagentStart / SessionStart / PermissionDenied hooks]] -.-> L
  H -.-> D
  H -.-> T
```

## Roles

| Role | Model | `maxTurns` | Writes | Sees | Returns |
|---|---|---|---|---|---|
| lead (main thread) | Opus | n/a | `docs/**` and config; stages by path, commits and pushes per `CLAUDE.md` "Commits" | the card, the return blocks | decisions, status |
| `developer` | Sonnet | 60 | inside `card.files`; the round tree in a private index | the card, its rules file, a handoff if any | files + gates block |
| `tester` | Opus | 100 | nothing | the diff and the card | verdict block |
| `security` | Sonnet | 25 | nothing | the diff | findings block |
| `upstream-reviewer` | Opus | 30 | nothing (Bash held read-only by a hook) | the luci branch diff against `origin/master` | findings block |
| `researcher` | Sonnet | 20 | nothing | the question | answer + ranked sources |
| `caveman:cavecrew-investigator` | Haiku | n/a | nothing | a "where is X" question | `file:line` table |

`maxTurns` is the budget one card needs. `developer` 60: a card is one mechanism, and the handoff
is written at turn 45, leaving the next developer a clean state. `tester` 100: it starts detached
runs and reads the waiter's result, so its turns are runbook steps, not wall-clock. A role that
runs out is a card to split. Code is the `developer`'s because the lead's own edits skip T0 and the
tester's diff; docs and config are the lead's because only `npm run check:fast` reads them.

One `developer` at a time: two writers on one card produce two designs for one problem. Subagents
spawn no subagents (nesting depth 1). The tester runs on a different model from the developer and
sees only the diff, never the developer's reasoning: a judge of the same model grades its own text
softer. `tester`, `security`, `researcher` and `upstream-reviewer` carry `disallowedTools: Edit,
Write, NotebookEdit`; Bash can still write, so read-only is a contract, not a sandbox: after the
tester the lead reruns `developer.md` step 2 into `../tmp/task-<id>/check.idx` over the paths
`git diff --name-only HEAD <tree>` prints, and the tree it prints equals the round's `tree`.

The lead relays each return block to the maintainer in Russian: fields, commands, paths and numbers
as printed, the prose around them translated.

## The card

The lead writes `../tmp/task-<id>/card.json` before the first delegation. JSON, because models
rewrite JSON less readily than Markdown, and a file outlives a compaction.

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
  "round": 1,
  "max_rounds": 2,
  "history": []
}
```

| Field | Values |
|---|---|
| `grade` | `task`, or `release` — adds `owlab test` on both formats. Any diff touching the Makefile, `root/**`, `build-css.sh`, `tools/stage.sh` or a `strip-*` script is `release` |
| `hardware` | `false` until the maintainer says otherwise for this card |
| `round` | 1 for the first developer pass, +1 per fix round; the same number in the developer's and the tester's block |
| `history` | one entry per tester round: `{ "round", "tree", "verdict", "blocking": [ids] }` |

- Before its first edit or delegation the lead records what was already dirty, paths and hunks:
  `mkdir -p ../tmp/task-<id> && git status --porcelain --untracked-files=all > ../tmp/task-<id>/dirty-at-start && git diff HEAD > ../tmp/task-<id>/dirty-at-start.diff`.
  A lead-only task with no card writes the same files; `/ship` step 2 stops before staging a path
  listed there. The developer snapshots a card path listed there all the same (the tree is for
  review; the lead stages by path), and the tester leaves out every hunk `dirty-at-start.diff`
  carries.
- `scope_ok` (the tester's): every code path `CLAUDE.md` "Crew" lists that `git status
  --porcelain --untracked-files=all` shows, less `dirty-at-start`, is in `card.files`; and
  `git diff --name-only HEAD <tree>` holds each `card.files` path `git status` shows and nothing
  outside `card.files`. Docs and config are the lead's to edit mid-task and do not count.
- One card, one mechanism; the acceptance fits in 5 lines. A card that needs more is two cards.
- A `SendMessage` to a resumed agent is a round and counts toward `max_rounds`.
- Upstream and release work splits in two: (a) base and history, verified by the `tester`; (b) the
  cut and the messages. A release card is regenerated from `git diff vX..HEAD --stat` before each
  matrix run.
- A live reproduction (stand, probe, baseline, layout question) is a `tester` card on an owlab
  stand (root, empty password).
- Steering edited mid-session (`CLAUDE.md`, measured; `.claude/rules/**` likely) reaches subagents only after a
  session restart: a subagent spawned later still reads the session-start copy (probe 2026-10-20: it
  quoted the old `## Commits` while the file on disk carried the new one). A card that depends on
  the new rule quotes it.

## Return blocks

Every role returns at most 25 lines: paths, not contents; no diff, no code, no story of the attempt.
The shape is in each role's file. The lead quotes the block; the role that produced a log reads it.
Voice, shell and waiting rules reach every role through `.claude/hooks/subagent-start.sh`
(SubagentStart), one copy for all five roles. Files a role leaves on disk are normal English prose.

## The loop

1. **Size the task.** Docs and config the lead edits itself. Code of any size goes to the crew, as
   does any task needing a gate beyond T0 or more than ~50 lines of tool output.
2. **`developer`, round 1.** Implements, runs T0, snapshots the round as a tree, returns `tree:`.
3. **`tester`.** Reads `git diff HEAD <tree>`, runs what the card asks, returns a verdict.
   `blocking` is defined once, in `.claude/agents/tester.md` "Findings"; the rest goes to `history`.
4. **Stop** when T0 is green, no finding is blocking, and the last round touched no file outside the
   previous round's set.
5. **Otherwise, one fix round.** The developer gets the blocking findings and its previous
   `not_done`; the tester gets `git diff <previous tree> <tree>` and the previous findings. Two fix
   rounds at most.
6. **At `max_rounds`** the **Recommended** option to the maintainer is "ship what PASSed, file the rest
   as an issue" or "simplify the approach"; a further round is offered last.
7. **Stall.** The same blocking id in two consecutive verdicts, or the same `tree` twice, sends
   the card to the maintainer.
8. **`security`**, once, on the final diff; skipped for CSS-only and one-line diffs. A vulnerability
   goes to the maintainer and is never auto-fixed; a functional LOW goes to card `history`.
9. **Ship.** The lead stages by path, commits and pushes through `/ship` (`CLAUDE.md` "Commits").

**The round tree.** The real index is the lead's, so a role never stages. The developer writes the
round into a private index under `../tmp/task-<id>/` and returns its tree id (the command:
`.claude/agents/developer.md` "Before returning", step 2); the lead records it in `history` and
passes it to the next tester. Both sides of the tester's diff are trees: a diff against the
worktree goes through the real index, where a file the developer created is untracked, so it drops
this round's new file and shows last round's as deleted (scratch repo, 2026-10-19). The lead
commits with staged paths, never `-a`, and reads `git status` before staging anything.

The caps come from the evidence: iterative repair gains sit in the first two rounds, a review with
no new external signal makes the result worse, and production orchestrators stop at a stall
counter of 2–3.

## Lead conduct

- **Status:** at most 5 lines — done, running (task ids + ETA), waiting on the maintainer — sent
  on a state change, with the action already started in the same message.
- **A role returns without its block:** read `git status` and file mtimes at once and re-dispatch
  with the remaining acceptance; a finished agent sends no later notification.
- **A denied step** in a background or workflow agent: an `ask` rule denied there is re-run by the
  lead in the foreground, where the maintainer's prompt is the gate. A classifier or `deny`-rule
  denial is named to the maintainer and waits for their word on that action and target.
- **Asking:** a question opens with one plain sentence on what the thing is. A decision that a
  rule or memory already settles is taken and reported.
- **Issue replies:** one line in the maintainer's style, "fixed, ships in <next patch>", with the
  version read after `git fetch`.
- **"Not released yet":** say what reaches users from `main` now (`install.sh`) and what waits for
  the feed's next tag.
- **No-agents mode** (the maintainer asks for it on a task, e.g. «без агентов»): the lead runs the
  role's commands itself; gate output still goes to `../tmp` logs and the lead reads the tail.
- **Sessions:** one wave, one session; state lives in `card.json` and `docs/`. Past ~150k tokens
  the lead writes a handoff and asks the maintainer to `/clear` (a CLI command only the maintainer
  types). A second session on the same
  tree works in a worktree under .claude/worktrees.

## Autonomy levels

`CLAUDE.md` "Commits" is the authority; this table sorts it.

| Level | Actions |
|---|---|
| Autonomous | read, plan, edit inside the role's scope; T0–T2; `owlab` stands; commit and push to `origin` `main` and own branches under the four preconditions; rebase, amend, `--force-with-lease` on own branches; the `release:` commit inside `/release`; `gh workflow run` in the theme repo (checks only, not a Pages deploy); feed publication after a tag; `ci-watch`/`ci-log` reads |
| Per word, each time | tag create/move/delete/push; `gh release *`; a Pages deploy (`-f publish-pages=true`, `pages.yml`); force-push, rebase or amend of pushed `main`; `git reset --hard` of pushed work; openwrt/luci fork pushes and upstream PR actions; every publication (comments, reviews, replies, owlab/owfeed issues); hardware router (`dev-sync.sh`, `ssh`); lowering a tier; waiving a gate |
| Never | `--no-verify` on commit or push; AI attribution trailers; staging the maintainer's own hunks; commit, push or tag from a detached run; staging or a commit by a role other than the lead |

## Guardrail layers

Instructions are advisory; hooks and permission rules are deterministic tripwires that fail open
(`.claude/hooks/git-guard.sh` header); CI is the ground truth for done. Nothing server-side stops a
tag or a rewrite of `main` (a tag ruleset was rejected on 2026-10-19).

| Layer | Where | Holds |
|---|---|---|
| 1. Instructions | `CLAUDE.md`, `.claude/rules/*.md` (path-scoped), `.claude/agents/*.md`, skills, auto-memory | the policy, the tiers, the roles; the auto-mode classifier reads `CLAUDE.md` too |
| 2. Hooks | `.claude/hooks/git-guard.sh` (PreToolUse, full command: tags, releases, history rewrite, fork pushes); `precommit-gate.sh` (both CHANGELOG entries); `session-start.sh` (drift from `origin/main`); `.claude/hooks/subagent-start.sh` (shared role rules); `.claude/hooks/permission-denied.sh` (appends to `../tmp/denials.log` for `/retro`) | the per-word list, whatever the permission mode |
| 3. Permissions and auto mode | `.claude/settings.json` `deny`/`ask`/`allow`; `autoMode` in `~/.claude/settings.json` (the classifier reads it only from user settings); `tools/bg.sh` refuses ssh, commit, push, tag and gh writes in detached runs | prompts and denials before a command runs; prefix matching misses `git -C` forms, hence layer 2 |
| 4. Git hooks | `.githooks/pre-push` (`npm run check`), `.githooks/commit-msg` (strips trailers) | every contributor, agent or not |
| 5. CI | `build.yml`: check, lint, build, verify (25.12/apk + 24.10/opkg), live, anchors on every push; deep on a tag or dispatch | the ground truth for "done" |

**Probing a guard.** A hook or `tools/bg.sh` is tested through its decision path only: the hook
JSON on stdin (`.claude/hooks/git-guard.sh --kinds`, `precommit-gate.sh`) or `tools/bg.sh --check
<command>`, which print a verdict and run nothing. The guarded command itself never executes, in a
test, a probe or a stub. Real git runs in a scratch repo `git init`ed outside this checkout, with
its cwd there: `../tmp/` for a probe, the test's `mkdtemp(tmpdir())` dir for a test. The reason:
on 2026-10-19 a refusal test ran real commands through a mid-edit `bg.sh` and, in this checkout,
created a tag, reset away every uncommitted edit and set an Actions secret.

## Skills

| Skill | Invocation | Does | Side effects |
|---|---|---|---|
| `/ship` | model | T0 check, changelog entries, commit by path, push, `ci-watch` in the background | commit and push to `origin`; never a tag |
| `/release` | model, on the maintainer's ask | pre-tag matrix, changelog rename, `release:` commit, tag, feed | asks for the tag unless the maintainer's message named it |
| `/upstream-pr` | model | openwrt/luci branch, local checks, review answers | fork pushes and replies on the maintainer's word |
| `/retro` | maintainer only (`disable-model-invocation`) | reads `measure-run.mjs`, `../tmp/denials.log`, repeated corrections; sorts each into keep / skill / rule / hook / delete | edits the lead-owned rows the maintainer accepts in its "Agree" step; code goes to a card |

A procedure lives in a skill, a fact in `CLAUDE.md`, a path-scoped rule in `.claude/rules/`, a
must-always in a hook. A retro miss becomes an eval scenario for its skill before the text changes.

Evals live in `.claude/skills/<name>/evals/<case>/`: `prompt.md` and a `graders` directory, plus `case.yaml`
and `scaffold.sh` when the case needs a scaffolded repo (the release and ship cases); they run
through `claude plugin eval` as `.claude/skills/retro/SKILL.md` step 8 "Agree, then apply" gives it:
paid model runs, so on the maintainer's word. The sandbox they need is `bubblewrap` and `socat`, and
`TMPDIR` must lie outside `/tmp`: the eval sandbox denies writes under `/tmp`, which covers its own
workspace there, so a case's `git fetch` fails with `Read-only file system`.

## Memory and state

- `CLAUDE.md`: at most 120 lines, facts and hard limits, pointers to `docs/`.
- Auto-memory (`~/.claude/projects/<project>/memory/`): learnings no file shows. A memory that
  recurs twice is promoted to a rule or hook and deleted.
- `card.json`, handoffs and `tools/bg.sh` run logs in `../tmp/`: state outside any context, so a
  dead session resumes from files.

## Workflows for fan-out

A workflow script fans out independent read-only work (audits, research, per-file reviews).

- Scripts live in `../tmp/workflows/<name>.wf.js`, so they survive the session.
- At most 5 agents in flight, through a semaphore.
- Long prompts sit in `.md` files the script reads, not in template strings.
- Each agent writes a large result to a file and returns its path.
- Writers stay one at a time; parallel writers need separate worktrees and separate cards.

## Measuring the crew

```sh
node .claude/tooling/measure-run.mjs            # newest transcript of this project
node .claude/tooling/measure-run.mjs latest 3
```

The `delegated:` line counts the subagent transcripts under `<session>/subagents/`, so the lead's
number never claims work that only moved. Per card: lead tool output under 15k characters, zero
images in the lead, every gate log opened by a role, rounds ≤ 2, no stall. Baseline before the crew:
136,544 characters and 11 images in this project's largest session; the 2026-09-03 trial put 152k
characters in the lead against 1.54M across 17 subagents. On the same diff, `tester` on Opus found
three issues to Sonnet's one, which is why it runs on Opus.

## Sources

- Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
- Multi-agent research system — https://www.anthropic.com/engineering/multi-agent-research-system
- Effective context engineering — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Writing tools for agents — https://www.anthropic.com/engineering/writing-tools-for-agents
- Claude Code best practices — https://code.claude.com/docs/en/best-practices
- Memory — https://code.claude.com/docs/en/memory
- Subagents — https://code.claude.com/docs/en/sub-agents
- Hooks — https://code.claude.com/docs/en/hooks-guide
- Auto mode config — https://code.claude.com/docs/en/auto-mode-config
- Permission modes — https://code.claude.com/docs/en/permission-modes
- Skills — https://code.claude.com/docs/en/skills
- Skill authoring best practices — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices

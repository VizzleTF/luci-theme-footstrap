---
name: retro
description: Retro of this project's Claude sessions since a date, and a revision of the agent environment from what they show.
disable-model-invocation: true
argument-hint: "[since-date YYYY-MM-DD]"
---

# Session retro

Input: `$ARGUMENTS` = the first day to cover (default: seven days
ago). `T=../tmp/retro-<today>`. Each step ends on its done line.

1. **List the sessions.** In `~/.claude/projects/-home-ivan-Documents-home-openwrt-luci-theme-footstrap/`,
   every `<uuid>.jsonl` with mtime on or after the date, plus its `<uuid>/subagents/*.jsonl`
   (workflow agents included). Write `$T/sessions.tsv`: id, start, end, size, subagent count.
   Done = every file of the range is a row.
2. **Extract with `jq`**, the only way a transcript reaches the context: per session, one
   `$T/<id>.md` of user prompts, permission denials, tool errors, interrupts and compactions, each
   with its timestamp, under 20k tokens (split as `<id>-2.md` above that). Done = one file per row.
3. **Measure.** `node .claude/tooling/measure-run.mjs <id>` for each session; append its lines to
   `$T/measure.txt`.
4. **Denials.** Read `../tmp/denials.log` for the range; group by tool and rule.
5. **Findings.** One row per recurring correction, denial, skipped step or stall in `$T/findings.md`:
   evidence (session id + timestamp), still open (yes/no), recurrences.
6. **Fate each finding**: keep, skill, rule, hook or delete, with the target file — hooks for what
   must always happen, skills for procedures, `.claude/rules/` for area facts, `CLAUDE.md` for
   always-true facts. A finding already fixed and not recurring is `keep`.
7. **Lint the instructions.** `node tools/agent-refs.mjs` exits 0 (dead references). Then read
   `CLAUDE.md`, `docs/crew.md`, `.claude/rules/*.md`, `.claude/agents/*.md` and
   `.claude/skills/*/SKILL.md` against each other; each contradiction is a finding with a fate.
8. **Agree, then apply.** Show the maintainer the fate table (finding, fate, target file, the change
   in one line) and ask with AskUserQuestion which rows to apply; nothing is edited before the
   answer. Accepted rows in lead-owned files (`docs/**`, `CLAUDE.md`,
   `.claude/{agents,rules,skills}/**`, `.claude/settings.json`, memory) are edited here;
   `.claude/hooks/*.sh`, `.claude/tooling/**` and other code go to a card per `docs/crew.md`. A
   skill edited here gets its retro miss as an eval case under `.claude/skills/<name>/evals/<case>/` (format in `docs/crew.md`). Running it
   is paid and waits for the maintainer's word:
   `mkdir -p ~/.cache/claude-eval-tmp && TMPDIR=~/.cache/claude-eval-tmp claude plugin eval .claude/skills/<name> --case <case> --scaffold --allow-tools Bash --no-publish --trust-plugin --output-dir ../tmp/evals/<name>`
   (`TMPDIR` outside `/tmp`: the eval sandbox denies writes under `/tmp`, its own workspace included).

Done = every finding in `$T/findings.md` has a fate and a target file, every accepted row is
applied, and the rest are listed for the maintainer.

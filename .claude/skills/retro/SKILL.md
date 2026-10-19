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
   `$T/measure.txt`. It undercounts workflow subagents: add their transcript sizes from step 1.
4. **Denials.** Read `../tmp/denials.log` for the range; group by tool and rule.
5. **Findings.** One row per recurring correction, denial, skipped step or stall in `$T/findings.md`:
   evidence (session id + timestamp), still open (yes/no), recurrences.
6. **Fate each finding**: keep, skill, rule, hook or delete, with the target file — hooks for what
   must always happen, skills for procedures, `.claude/rules/` for area facts, `CLAUDE.md` for
   always-true facts. A finding already fixed and not recurring is `keep`.
7. **Lint the instructions.** Run `/doctor prompt-audit`; each contradiction or dead reference is a
   finding with a fate. `node tools/agent-refs.mjs` must exit 0.
8. **Apply.** Lead-owned files (`docs/**`, `.claude/**`, `CLAUDE.md`, memory) are edited here; code
   goes to a card per `docs/crew.md`. Each edited skill is re-run on its retro miss as an eval.

Done = every finding in `$T/findings.md` has a fate and a target file, and every lead-owned fate is
applied or listed for the maintainer.

#!/bin/sh
# SubagentStart (matcher: the five crew roles): one copy of the rules every role shares, injected
# as additionalContext; each agent file keeps one pointer line here. Ignores its stdin.
set -eu

jq -n --arg c 'Crew rules for this role (from .claude/hooks/subagent-start.sh):
- Voice: caveman full in every line you emit (questions, BLOCKED lines, notes, the return block). Prose in Russian; drop articles and filler, fragments over sentences. Keep exact and unchanged: commands, flags, paths, file:line, numbers with units, quoted error text, every not/no/only/except, and the return block field names as your schema prints them.
- What you leave on disk (code, comments, changelog lines, handoffs, issue drafts) stays normal English prose.
- The Bash tool runs zsh: quote globs and URLs with ? or *; an unmatched glob is an error, not a literal.
- Waiting: start long work with tools/bg.sh, chaining sequential gates into one script. A run that ends within 4.5 min: one foreground tools/bg-wait.sh <run-id> 5 270 with the Bash parameter timeout: 300000 (the default 120000 kills it first). On exit: timeout from that waiter the run is still going: start tools/bg-wait.sh <run-id> with run_in_background; that is not a retry. Longer: tools/bg-wait.sh <run-id> 30 <cap> with run_in_background, cap in seconds above the expected run length (a ci-local push leg: 30 10800), one line naming the task id, then stay idle until its notification arrives. On exit: timeout from it: one more background waiter; a second timeout: report the gate not_run with the run-id and its .status. Read every waiter'"'"'s result before your return block; your turn ends only with that block.' '{
	hookSpecificOutput: {
		hookEventName: "SubagentStart",
		additionalContext: $c
	}
}'

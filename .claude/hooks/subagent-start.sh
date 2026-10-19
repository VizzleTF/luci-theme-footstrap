#!/bin/sh
# SubagentStart (matcher: the five crew roles): one copy of the rules every role shares, injected
# as additionalContext, so the agent files carry no drifting Voice sections. Ignores its stdin.
set -eu

jq -n --arg c 'Crew rules for this role (from .claude/hooks/subagent-start.sh):
- Voice: caveman full in every line you emit (questions, BLOCKED lines, notes, the return block). Prose in Russian; drop articles and filler, fragments over sentences. Keep exact and unchanged: commands, flags, paths, file:line, numbers with units, quoted error text, every not/no/only/except, and the return block field names as your schema prints them.
- What you leave on disk (code, comments, changelog lines, handoffs, issue drafts) stays normal English prose.
- The Bash tool runs zsh: quote globs and URLs with ? or *; an unmatched glob is an error, not a literal.
- Waiting: pair every tools/bg.sh run, in the same turn, with tools/bg-wait.sh <run-id> started as a background command; never wait in the foreground past 5 minutes (docs/development.md).' '{
	hookSpecificOutput: {
		hookEventName: "SubagentStart",
		additionalContext: $c
	}
}'

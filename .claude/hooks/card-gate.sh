#!/bin/sh
# PreToolUse/Agent: a `developer` spawn needs its card on disk, or it is denied.
#
# docs/crew.md "The card" asks the lead for ../tmp/task-<id>/card.json and a dirty-at-start record
# before the first delegation, a rule the model had to remember: from 2026-10-07 on, 16 of 50 developer
# spawns ran with no card, and no dirty-at-start file existed before the 2026-10-21 session
# (../tmp/ai-dev-audit-2026-10-20/report.md P1-2). Deny, not ask: the omission is the lead's own, so the
# maintainer is never prompted for it, and the reason prints the two commands that fix it.
#
# The prompt must name a `<path>/tmp/task-<id>/card.json` that exists (relative to the session `cwd`,
# the repo root where the lead works, or absolute), and its directory must hold `dirty-at-start`.
# The card is not read for its content. Every other agent type and every other tool passes untouched.
#
# A tripwire, not a fence: a stale card passes it, and a Workflow `agent()` spawn is not an Agent tool
# call and never reaches it. A missing jq or grep, unreadable input and an unresolvable cwd or HOME
# stay silent. The input shape (tool_name "Agent", tool_input.subagent_type and .prompt) is the one
# https://code.claude.com/docs/en/hooks.md documents for PreToolUse, and this project's session
# transcripts carry the same fields.
set -eu

IN=$(cat) || exit 0
for t in jq grep; do command -v "$t" >/dev/null 2>&1 || exit 0; done

[ "$(printf '%s' "$IN" | jq -r '.tool_name // ""' 2>/dev/null)" = Agent ] || exit 0
[ "$(printf '%s' "$IN" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null)" = developer ] || exit 0
PROMPT=$(printf '%s' "$IN" | jq -r '.tool_input.prompt // ""' 2>/dev/null) || exit 0
CWD=$(printf '%s' "$IN" | jq -r '.cwd // ""' 2>/dev/null) || exit 0
[ -z "$CWD" ] || cd "$CWD" 2>/dev/null || exit 0

# Path characters only, so a `Card:`, a quote or a closing bracket ends the token and no glob character reaches `for`.
CARDS=$(printf '%s\n' "$PROMPT" | grep -oE '[A-Za-z0-9._/~-]*tmp/task-[A-Za-z0-9._-]+/card\.json' || true)
WHY='the prompt names no ../tmp/task-<id>/card.json'
D='../tmp/task-<id>'
for c in $CARDS; do
	case $c in \~/*) [ -n "${HOME:-}" ] || exit 0; c=$HOME/${c#\~/} ;; esac # no shell has expanded the prompt's ~
	D=${c%/card.json}
	if [ ! -f "$c" ]; then
		WHY="$c does not exist (resolved from $(pwd))"
	elif [ ! -f "$D/dirty-at-start" ]; then
		WHY="$D/dirty-at-start does not exist (resolved from $(pwd))"
	else
		exit 0
	fi
done

jq -n --arg r "card-gate: developer spawn denied, $WHY. The lead writes the card (docs/crew.md \"The card\"), records what is already dirty with the two commands below, and names the card in the prompt (\"Card: ../tmp/task-<id>/card.json\"). 1) mkdir -p $D && git status --porcelain --untracked-files=all > $D/dirty-at-start  2) git diff HEAD > $D/dirty-at-start.diff" '{
	hookSpecificOutput: {
		hookEventName: "PreToolUse",
		permissionDecision: "deny",
		permissionDecisionReason: $r
	}
}'

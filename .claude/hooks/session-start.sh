#!/bin/sh
# SessionStart: say out loud when the session was started somewhere the project's rules do not load.
#
# The checkout's parent holds luci-fork/ and tmp/ and is not a git repository. A session started
# there loads no CLAUDE.md, every `owlab` call exits with "no owlab.yaml found", and the failure
# reads as a broken owlab rather than a wrong directory. The marker is owlab.yaml, which exists at
# the repo root and nowhere above it.
set -eu

NOTES=''
add() { NOTES="${NOTES}${NOTES:+
}$1"; }

[ -f owlab.yaml ] || add "No owlab.yaml in $(pwd): this session was NOT started at the repo root, so CLAUDE.md, .claude/rules/ and .claude/settings.json are not loaded and every owlab command will exit with 'no owlab.yaml found'. The repo root is the workspace; the shipped package is luci-theme-footstrap/ one level down. Ask the user to restart from the root rather than working around it."

[ -n "$NOTES" ] || exit 0

jq -n --arg c "$NOTES" '{
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: $c
	}
}'

#!/bin/sh
# PermissionDenied: append each auto-mode denial to ../tmp/denials.log, one TSV line:
# <iso-ts> <session> <tool> <reason> <command or tool_input, first 300 chars>. The retro reads it.
# Always exits 0 and prints nothing: the denial already happened, a log failure must not add noise.
LOG="${CLAUDE_PROJECT_DIR:-.}/../tmp/denials.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null
jq -r --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '[
	$ts, (.session_id // ""), (.tool_name // ""), (.reason // ""),
	((.tool_input.command // (.tool_input | tostring)) | gsub("[\t\n\r]"; " ") | .[0:300])
] | map(gsub("[\t\n\r]"; " ")) | join("\t")' >>"$LOG" 2>/dev/null
exit 0

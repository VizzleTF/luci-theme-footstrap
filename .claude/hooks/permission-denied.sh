#!/bin/sh
# PermissionDenied: append each auto-mode denial to ../tmp/denials.log, one TSV line:
# <iso-ts> <session> <tool> <reason> <command or tool_input, first 300 chars>. The retro reads it.
# Every field is masked before the write: URL userinfo, Authorization and *api-key* headers, a
# NAME=/NAME: value whose name holds token, secret, password or apikey, --password/--token <v>,
# -u/--user user:pass, sshpass -p, openssl pass:, and the shapes hvs./hvb./hvr./s. (OpenBao),
# gh?_ / github_pat_ and sk-. A credential in any other shape is written as is.
# Always exits 0 and prints nothing: the denial already happened, a log failure must not add noise.
# The main checkout's ../tmp from a linked worktree too: the git common dir is that checkout's .git.
# The rule of tools/lib/tmp-root.sh, written out here because a guard hook sources nothing from outside
# .claude/hooks; no git, or a layout it does not know, leaves the project dir's own ../tmp.
ROOT=${CLAUDE_PROJECT_DIR:-.}
COMMON=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || COMMON=
case $COMMON in /*/.git) ROOT=${COMMON%/.git} ;; esac
TMP=$ROOT/../tmp
LOG="$TMP/denials.log"
mkdir -p "$TMP" 2>/dev/null
jq -r --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
def redact:
	gsub("(?<k>[A-Za-z][A-Za-z0-9+.-]*://)[^/@\\s]+@"; "\(.k)***@")
	| gsub("(?<k>authorization[:=]\\s*(?:(?:bearer|basic|token)\\s+)?)[^\\s\"'\'',]+"; "\(.k)***"; "i")
	| gsub("(?<k>[A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|api[-_]?key)[A-Za-z0-9_.-]*\"?[:=]\\s*\"?)[^\\s\"'\'',]+"; "\(.k)***"; "i")
	| gsub("(?<k>--(?:password|passwd|token|secret|api-key)\\s+)\\S+"; "\(.k)***"; "i")
	| gsub("(?<k>(?:^|\\s)(?:-u|--user)[=\\s]\\s*)[^\\s:]+:\\S+"; "\(.k)***")
	| gsub("(?<k>sshpass\\s+-p\\s*)\\S+"; "\(.k)***")
	| gsub("(?<k>\\bpass:)\\S+"; "\(.k)***")
	| gsub("\\b(?:hv[sbr]|s)\\.[A-Za-z0-9_-]{20,}|\\bgh[pousr]_[A-Za-z0-9]{20,}|\\bgithub_pat_[A-Za-z0-9_]{20,}|\\bsk-[A-Za-z0-9_-]{20,}"; "***");
[
	$ts, (.session_id // ""), (.tool_name // ""), (.reason // ""),
	((.tool_input.command // (.tool_input | tostring)) | redact | .[0:300])
] | map(redact | gsub("[\t\n\r]"; " ")) | join("\t")' >>"$LOG" 2>/dev/null
exit 0

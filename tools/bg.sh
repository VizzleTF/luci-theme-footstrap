#!/bin/sh
# Detach a T2 gate (owlab, npm run live, bench, a computed-style diff) so the session never waits on
# it. Prints the run-id and the log path before the command has produced a byte, and exits 0 whether
# or not the command later fails: the exit status lives in <run-id>.status, read by hand.
#
# Logs go to ../tmp/ beside the main checkout, resolved from this script rather than from $PWD, so a
# run started from a subdirectory or a linked worktree still lands in the one scratch directory
# CLAUDE.md sanctions (tools/lib/tmp-root.sh).
#
#   tools/bg.sh node tools/live-audit.mjs --all
#   tail -n 40 ../tmp/<run-id>.log
#
# `tools/bg.sh --check <command…>` asks the refusal question and nothing else: it prints `allowed`
# (exit 0) or `refused: <why>` (exit 2) on stdout and never detaches or runs the command. A test or a
# probe of the fence uses it, because a refusal that went missing would otherwise run the command
# under test.
set -eu

CHECK=0
if [ "${1-}" = --check ]; then
	CHECK=1
	shift
fi

if [ $# -eq 0 ]; then
	echo "usage: tools/bg.sh [--check] <command> [args...]" >&2
	exit 2
fi

# `Bash(tools/bg.sh:*)` is allow-listed, and the permission engine matches the first word only: it
# cannot see an `ssh` inside `tools/bg.sh sh -c '…'`, which is the form every T2 gate uses. Without
# this the wrapper launders any command past the `ask` fence on the hardware router and on
# publishing. The fence has to live here, where the whole command line is visible.
#
# This is a guardrail against the wrapper laundering a command past a permission rule, not a
# sandbox: it reads the text of the command, so it can be fooled by anything the text itself does
# not reveal (a script that shells out, a binary named to match nothing here). What it does catch is
# scanned as words, not substrings, so `sshd` or a path ending in `-ssh` does not trip it. Backslashes
# are deleted (not folded to a separator) BEFORE the quoting and shell operators are folded to spaces,
# so `s\sh` collapses to the `ssh` it will actually become, rather than scanning as two harmless words.
# Every `;`, `&` and `|` stays as a `;` word, so a git or gh call ends where its command ends.
#
# A detached run only reads. After a `git` or `gh` word the global options are skipped (git -C/-c/
# --git-dir, gh -R/--repo, each with its value) and the subcommand must be on a short read list, so a
# writing verb nobody thought of is refused, and so is an alias: git ignores one that shadows a
# built-in, so a configured alias is never on the list, and `-c alias.*` is refused by name.

# The callers run in decide()'s subshell, so the exit ends that subshell only.
refuse() {
	printf "'%s' writes history, refs or publishes, or is not a read this wrapper knows. Detached runs only read (git status|diff|log|show…, gh run|pr|release view|list…): run it in the foreground thread; a tag goes through /release.\n" "$1"
	exit 2
}

# $@ the words after a `git`, up to the next `;`
gitcheck() {
	while [ $# -gt 0 ]; do
		case "$1" in
			';') return 0 ;;
			-c) case "${2-}" in [Aa][Ll][Ii][Aa][Ss].*) refuse "git -c ${2-}" ;; esac; shift; [ $# -eq 0 ] || shift ;;
			-c[Aa][Ll][Ii][Aa][Ss].*) refuse "git $1" ;;
			-C | --git-dir | --work-tree | --namespace | --config-env | --super-prefix | --attr-source) shift; [ $# -eq 0 ] || shift ;;
			-*) shift ;;
			*) break ;;
		esac
	done
	case "${1-}" in
		'' | ';' | status | diff | log | show | rev-parse | rev-list | describe | ls-files | ls-remote | ls-tree | cat-file | blame | shortlog | merge-base | name-rev | for-each-ref | show-ref | grep | diff-tree | cherry) ;;
		*) refuse "git $1" ;;
	esac
}

# $@ the words after `gh api`, up to the next `;`: a GET unless a method or a body flag turns it into a write
apicheck() {
	m=''
	while [ $# -gt 0 ] && [ "$1" != ';' ]; do
		case "$1" in
			-X | --method) m=${2-}; if [ $# -gt 1 ]; then shift; fi ;;
			--method=*) m=${1#*=} ;;
			-X?*) m=${1#-X} ;;
			-f | -F | -f?* | -F?* | --field | --raw-field | --input | --field=* | --raw-field=* | --input=*) refuse "gh api $1" ;;
			graphql) refuse "gh api graphql" ;;
		esac
		shift
	done
	case "$m" in '' | GET | get) ;; *) refuse "gh api -X $m" ;; esac
}

# $@ the words after a `gh`, up to the next `;`
ghcheck() {
	while [ $# -gt 0 ]; do
		case "$1" in
			';') return 0 ;;
			-R | --repo | --hostname) shift; [ $# -eq 0 ] || shift ;;
			-*) shift ;;
			*) break ;;
		esac
	done
	[ "${2-}" != ';' ] || set -- "$1"
	case "${1-}:${2-}" in
		:) ;;
		run:view | run:watch | run:list | run:download | pr:view | pr:list | pr:checks | pr:diff | pr:status | issue:view | issue:list | issue:status | release:view | release:list | workflow:list | workflow:view | repo:view | auth:status) ;;
		api:*) shift; apicheck "$@" ;;
		*) refuse "gh ${1-}${2:+ $2}" ;;
	esac
}

# Prints the reason and exits 2 on a refusal; prints nothing and returns 0 on a pass.
decide() {
	SCAN=$(printf ' %s ' "$*" | tr -d '\\' | tr '\n\t' '; ' | sed "s/[\"\`()<>']/ /g; s/[;&|]/ ; /g" | tr -s ' ')
	set -f                     # $SCAN is split into words, never globbed: a run may carry a literal `*`
	set -- $SCAN
	while [ $# -gt 0 ]; do
		word=$1
		shift
		# Path forms (`/usr/bin/ssh`, `./ssh`) walk past a bare-word match, so the same names are
		# checked with a `*/name` form too; `*dev-sync.sh` already had this shape and is the model.
		case "$word" in
			ssh | scp | sftp | rsync | */ssh | */scp | */sftp | */rsync | *dev-sync.sh)
				printf "'%s' goes through the human, not through a detached wrapper: tools/bg.sh is allow-listed, so a command run through it never reaches the 'ask' rule that guards this one. Run it in the foreground thread.\n" "$word"
				exit 2 ;;
		esac
		# the basename is what a shell would actually run
		case "${word##*/}" in
			git | git.exe) gitcheck "$@" ;;
			gh | gh.exe) ghcheck "$@" ;;
		esac
	done
}

# The one refusal decision, shared by --check and the real run so the two cannot drift. It runs in
# a command substitution so `set -f` and `exit` stay in the subshell.
if ! WHY=$(decide "$@"); then
	if [ "$CHECK" = 1 ]; then
		printf 'refused: %s\n' "$WHY"
	else
		printf 'refused: %s\n' "$WHY" >&2
	fi
	exit 2
fi
if [ "$CHECK" = 1 ]; then
	echo allowed
	exit 0
fi

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/tools/lib/tmp-root.sh"
TMP=$(tmp_root "$ROOT")
mkdir -p "$TMP"

# The slug is the first two words of the command with everything but [A-Za-z0-9] folded to a dash,
# so `npm run live` and `owlab test` are distinguishable in a directory listing without opening one.
# It is cut so the whole run-id stays under 61 characters: a 300-character argument made the log
# name 'File name too long'.
STAMP=$(date +%Y%m%d-%H%M%S)
PIDS=$$
SLUG=$(printf '%s %s' "$1" "${2-}" | tr -c 'A-Za-z0-9' '-' | sed 's/--*/-/g; s/^-//' | cut -c "1-$((60 - ${#STAMP} - ${#PIDS} - 2))" | sed 's/-$//')
RUN="$STAMP-${SLUG:-cmd}-$$"
LOG="$TMP/$RUN.log"
STATUS="$TMP/$RUN.status"
PIDF="$TMP/$RUN.pid"

{
	printf '# run-id: %s\n' "$RUN"
	printf '# started: %s\n' "$(date -Is 2>/dev/null || date)"
	printf '# cwd: %s\n' "$(pwd)"
	printf '# command: %s\n\n' "$*"
} >"$LOG"

# setsid detaches from the session's process group, so the run survives the shell that started it
# and a Ctrl-C in the session does not reach it. Not every image has it; nohup alone is the fallback.
RUNNER=''
command -v setsid >/dev/null 2>&1 && RUNNER='setsid'

# $0 is the log, $1 the status file and $2 the pid file; the shift is what makes "$@" the caller's
# command alone. The pid written is this inner shell's own, which lives exactly as long as the run:
# $! would name setsid instead, which exits immediately and would read as a dead run.
# shellcheck disable=SC2086 # RUNNER is deliberately word-split: empty means "no wrapper".
nohup $RUNNER sh -c '
	st_file=$1
	pid_file=$2
	shift 2
	printf "%s\n" "$$" >"$pid_file"
	"$@" >>"$0" 2>&1
	st=$?
	printf "\n# exit: %s\n" "$st" >>"$0"
	printf "%s\n" "$st" >"$st_file"
	exit $st
' "$LOG" "$STATUS" "$PIDF" "$@" >/dev/null 2>&1 &

printf 'run-id: %s\n' "$RUN"
printf 'log:    %s\n' "$LOG"
printf 'status: %s (absent while running)\n' "$STATUS"
printf 'read:   tail -n 40 %s\n' "$LOG"

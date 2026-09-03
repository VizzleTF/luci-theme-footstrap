#!/bin/sh
# Detach a T2 gate (owlab, npm run live, bench, a computed-style diff) so the session never waits on
# it. Prints the run-id and the log path before the command has produced a byte, and exits 0 whether
# or not the command later fails: the exit status lives in <run-id>.status, read by hand.
#
# Logs go to ../tmp/ beside the checkout, resolved from this script rather than from $PWD, so a run
# started from a subdirectory still lands in the one scratch directory CLAUDE.md sanctions.
#
#   tools/bg.sh npm run live -- --all
#   tail -n 40 ../tmp/<run-id>.log
set -eu

if [ $# -eq 0 ]; then
	echo "usage: tools/bg.sh <command> [args...]" >&2
	exit 2
fi

# `Bash(tools/bg.sh:*)` is allow-listed, and the permission engine matches the first word only: it
# cannot see an `ssh` inside `tools/bg.sh sh -c '…'`, which is the form every T2 gate uses. Without
# this the wrapper launders any command past the `ask` fence on the hardware router and on
# publishing. The fence has to live here, where the whole command line is visible.
#
# Scanned as words, not substrings, so `sshd` or a path ending in `-ssh` does not trip it; the
# quoting and the shell operators are folded to spaces first so a nested `sh -c '…'` is scanned too.
SCAN=$(printf ' %s ' "$*" | tr '\n\t"`;&|()<>'"'"'\\' ' ' | tr -s ' ')
set -f                     # $SCAN is split into words, never globbed: a run may carry a literal `*`
for word in $SCAN; do
	case "$word" in
		ssh | scp | sftp | rsync | *dev-sync.sh)
			echo "refused: '$word' goes through the human, not through a detached wrapper." >&2
			echo "tools/bg.sh is allow-listed, so a command run through it never reaches the 'ask' rule that guards this one. Run it in the foreground." >&2
			exit 2 ;;
	esac
done
set +f
case "$SCAN" in
	*' git push '* | *' git commit '* | *' git tag '* | *' gh pr '* | *' gh release '* | *' gh issue '*)
		echo "refused: committing, pushing and publishing are given per action by the human (CLAUDE.md), and a detached run cannot be given anything." >&2
		exit 2 ;;
esac

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(dirname -- "$ROOT")/tmp
mkdir -p "$TMP"

# The slug is the first two words of the command with everything but [A-Za-z0-9] folded to a dash,
# so `npm run live` and `owlab test` are distinguishable in a directory listing without opening one.
SLUG=$(printf '%s %s' "$1" "${2-}" | tr -c 'A-Za-z0-9' '-' | sed 's/--*/-/g; s/^-//; s/-$//')
RUN="$(date +%Y%m%d-%H%M%S)-${SLUG:-cmd}-$$"
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

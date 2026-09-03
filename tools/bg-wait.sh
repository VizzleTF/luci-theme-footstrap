#!/bin/sh
# Wait for a tools/bg.sh run to end, then print its exit status and the summary lines of its log.
# This is the pairing CLAUDE.md requires for every detached run, as one command a role can start
# with run_in_background and permissions.allow can name. Exits with the run's own status.
#
#   tools/bg-wait.sh <run-id> [interval-seconds] [max-seconds]
set -eu

if [ $# -lt 1 ]; then
	echo "usage: tools/bg-wait.sh <run-id> [interval-seconds] [max-seconds]" >&2
	exit 2
fi

# The run-id names two files under ../tmp/ and the script is allow-listed, so an argument carrying
# a path would read any .log the user can — `tools/bg-wait.sh ../../../var/log/foo` before this.
case "$1" in
	*/* | *..* | '') echo "bad run-id: $1" >&2; exit 2 ;;
esac

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(dirname -- "$ROOT")/tmp
LOG="$TMP/$1.log"
STATUS="$TMP/$1.status"
PIDF="$TMP/$1.pid"
EVERY=${2:-30}
MAX=${3:-7200}

# A non-numeric interval would make `sleep` fail once per iteration; under `set -e` that ends the
# waiter with a shell error rather than with the run's status, which reads as a failed gate.
case "$EVERY" in '' | *[!0-9]*) echo "bad interval: $EVERY" >&2; exit 2 ;; esac
case "$MAX" in '' | *[!0-9]*) echo "bad max: $MAX" >&2; exit 2 ;; esac

if [ ! -f "$LOG" ]; then
	echo "no such run: $LOG" >&2
	exit 2
fi

# bg.sh writes the status file as its last act, so a run killed outside its own control — SIGKILL,
# a reboot, the machine sleeping — never writes one, and a plain `until [ -f ]` waits for a file
# nobody will create. Two ways out: the run's own pid is gone, or the cap is reached. Both report
# rather than pretend, because a waiter still running when the session ends wakes it with noise.
WAITED=0
while [ ! -f "$STATUS" ]; do
	if [ -f "$PIDF" ]; then
		PID=$(cat "$PIDF" 2>/dev/null || true)
		case "$PID" in
			'' | *[!0-9]*) ;;
			*) if ! kill -0 "$PID" 2>/dev/null; then
					# The gap between the command exiting and the status file landing is one
					# write; give it that before calling the run dead.
					sleep 2
					if [ ! -f "$STATUS" ]; then
						echo "exit: process-gone (pid $PID ended without writing $STATUS)" >&2
						echo "--- tail"
						tail -n 20 "$LOG"
						exit 2
					fi
					break
				fi ;;
		esac
	fi
	if [ "$WAITED" -ge "$MAX" ]; then
		echo "exit: timeout (no status after ${MAX}s; the run may still be going)" >&2
		echo "--- tail"
		tail -n 20 "$LOG"
		exit 2
	fi
	sleep "$EVERY"
	WAITED=$((WAITED + EVERY))
done

# bg.sh writes a bare number, but `exit` on anything else is a shell syntax error, not a bad status.
ST=$(cat "$STATUS")
case "$ST" in '' | *[!0-9]*) echo "unreadable status: $ST" >&2; ST=1 ;; esac
echo "exit: $ST"
# The gates print their findings as `name: value` lines; everything else in the log is progress.
grep -E '^[a-z-]+:' "$LOG" || true
echo "--- tail"
tail -n 20 "$LOG"
exit "$ST"

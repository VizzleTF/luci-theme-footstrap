#!/bin/sh
# Run a network install under a clock, and again if it stalls.
#
#   sh tools/ci-retry.sh <seconds> <command…>
#
# The two things a job of ours fetches from somebody else's server — apt and the Playwright CDN — do
# not fail when the far side is unwell, they STALL, and a hung step is not a failed step: nothing
# retries it and the job's own timeout is the only thing that ends it. So each attempt gets a
# deadline of its own; a genuinely broken command still fails on the first attempt.
#
# The attempt is a process GROUP, not a process: `timeout` signals the child it started and nothing
# below it, so killing `npx playwright install --with-deps` leaves the `apt-get` it spawned running
# and holding /var/lib/apt/lists/lock — after which every retry dies in seconds on the lock and
# proves nothing. `setsid` puts each attempt in a session of its own so the whole tree can be
# signalled by negative pid, and the locks are cleared before the next attempt.
#
# This is for a CI runner and nothing else: it kills by process group and deletes apt's lock files,
# which is only safe because the machine is ephemeral and runs one job.
set -eu

SECONDS_PER_TRY="${1:?usage: ci-retry.sh <seconds> <command...>}"
shift
[ "$#" -gt 0 ] || { echo "ci-retry: nothing to run" >&2; exit 2; }

TRIES=3
STALLED=124

# Runs the command in its own session and kills the whole group if it outlives the deadline.
# Answers 0, the command's status, or $STALLED.
attempt() {
	setsid "$@" &
	pgid=$!

	( sleep "$SECONDS_PER_TRY"
	  kill -TERM -"$pgid" 2>/dev/null || true
	  sleep 20
	  kill -KILL -"$pgid" 2>/dev/null || true ) &
	watchdog=$!

	rc=0
	# NOT `if wait …; then`: an `if` with no else answers 0 when its condition fails, so the status
	# read after it is the `if` statement's rather than the command's.
	wait "$pgid" || rc=$?
	kill "$watchdog" 2>/dev/null || true
	wait "$watchdog" 2>/dev/null || true

	# 143/137 are the TERM and KILL the watchdog sent; anything else is the command's own answer.
	case "$rc" in
		143|137) return "$STALLED" ;;
		*)       return "$rc" ;;
	esac
}

# What a killed apt leaves behind. Not reached when the command is not apt, and harmless there.
clear_apt() {
	sudo -n pkill -KILL -x apt-get 2>/dev/null || true
	sudo -n pkill -KILL -x dpkg 2>/dev/null || true
	sudo -n rm -f /var/lib/apt/lists/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend \
		/var/cache/apt/archives/lock 2>/dev/null || true
	sudo -n dpkg --configure -a >/dev/null 2>&1 || true
}

i=1
while [ "$i" -le "$TRIES" ]; do
	rc=0
	attempt "$@" || rc=$?
	# `[ … ] && exit 0` would be a failing top-level list under `set -e` on every unsuccessful
	# attempt, i.e. no retries at all.
	if [ "$rc" -eq 0 ]; then exit 0; fi

	if [ "$rc" -eq "$STALLED" ]; then
		echo "ci-retry: attempt $i of $TRIES stalled past ${SECONDS_PER_TRY}s: $*" >&2
	else
		echo "ci-retry: attempt $i of $TRIES failed (exit $rc): $*" >&2
	fi
	[ "$i" -lt "$TRIES" ] || { echo "ci-retry: giving up after $TRIES attempts" >&2; exit "$rc"; }

	clear_apt
	sleep $((i * 15))
	i=$((i + 1))
done

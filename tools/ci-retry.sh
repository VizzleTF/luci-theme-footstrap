#!/bin/sh
# RUN A NETWORK INSTALL UNDER A CLOCK, AND AGAIN IF IT STALLS.
#
#   sh tools/ci-retry.sh <seconds> <command…>
#
# Why this exists: the two things a job of ours fetches from somebody else's server — apt (gettext,
# and the system libraries `playwright install --with-deps` pulls) and the Playwright CDN — do not
# fail when the far side is unwell. They STALL. On the 0.13.2 tag one apt step and two playwright
# steps sat for 68, 68 and 17 minutes with GitHub reporting every system operational, and a hung
# step is not a failed step: nothing retries it, the job's own timeout is the only thing that ends
# it, and the release waits behind a download.
#
# So each attempt gets a deadline instead of the job's. A stall is then a retry a few minutes in
# rather than a red tag half an hour later, and a genuinely broken command still fails on the first
# attempt and only costs the retries.
#
# THE ATTEMPT IS A PROCESS GROUP, not a process. `timeout` signals the child it started and nothing
# below it, so killing `npx playwright install --with-deps` leaves the `apt-get` it spawned running
# and holding /var/lib/apt/lists/lock — which is exactly what happened on the first version of this
# script: attempt 1 timed out, attempts 2 and 3 died in seconds on "Could not get lock … held by
# process 2376 (apt-get)", and the retry proved nothing. `setsid` puts each attempt in a session of
# its own so the whole tree can be signalled by negative pid, and the locks and any half-configured
# package are cleared before the next attempt.
#
# This is a CI runner and nothing else: it kills by process GROUP and deletes apt's lock files,
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

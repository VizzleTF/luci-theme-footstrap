#!/bin/sh
# Run a network fetch under a clock, and again if it stalls or fails.
#
#   sh tools/ci-retry.sh <seconds> <command…>
#
# What a job of ours fetches from somebody else's server — apt, the Playwright CDN, owfeed's SDK,
# a release asset — does not fail when the far side is unwell, it STALLS, and a hung step is not a
# failed step: nothing retries it and the job's own timeout is the only thing that ends it. So each
# attempt gets a deadline of its own. A command that fails rather than stalls runs again too, unless
# CI_RETRY_ON names the exits that mean an outage (`CI_RETRY_ON=8 sh tools/ci-retry.sh 240 owfeed
# build`): any other exit is then an answer and ends the run at once.
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
RETRY_ON="${CI_RETRY_ON:-}"	# the exits that mean an outage, besides a stall; empty: any
# The watchdog's note that it fired. Made here, under set -e: a directory the watchdog could not write
# to would have stopped it before its TERM, silently.
MARK=$(mktemp "${TMPDIR:-/tmp}/ci-retry.XXXXXX")
trap 'rm -f "$MARK"' EXIT

# Runs the command in its own session and kills the whole group if it outlives the deadline.
# Answers 0, the command's status, or $STALLED.
attempt() {
	rm -f "$MARK"
	setsid "$@" &
	pgid=$!

	( sleep "$SECONDS_PER_TRY"
	  : >"$MARK"
	  kill -TERM -"$pgid" 2>/dev/null || true
	  sleep 20
	  kill -KILL -"$pgid" 2>/dev/null || true ) </dev/null >/dev/null 2>&1 &
	watchdog=$!

	rc=0
	# NOT `if wait …; then`: an `if` with no else answers 0 when its condition fails, so the status
	# read after it is the `if` statement's rather than the command's.
	wait "$pgid" || rc=$?
	kill "$watchdog" 2>/dev/null || true
	wait "$watchdog" 2>/dev/null || true

	# The watchdog fired: a stall, whatever the command answered its TERM with. Not 143/137 alone:
	# owfeed catches TERM and exits 7, which CI_RETRY_ON would take for an answer.
	if [ "$rc" -ne 0 ] && [ -e "$MARK" ]; then return "$STALLED"; fi
	return "$rc"
}

# What a killed apt leaves behind. Run only after an apt command: it kills apt and rotates the
# mirror list.
clear_apt() {
	sudo -n pkill -KILL -x apt-get 2>/dev/null || true
	sudo -n pkill -KILL -x dpkg 2>/dev/null || true
	sudo -n rm -f /var/lib/apt/lists/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend \
		/var/cache/apt/archives/lock 2>/dev/null || true
	sudo -n dpkg --configure -a >/dev/null 2>&1 || true
	# A slow mirror is still slow on the next attempt, and apt's mirror method falls back only on an
	# error, never on speed (azure.archive.ubuntu.com at ~40 kB/s sank three tries of 117 MB). Drop the
	# first mirror so the retry asks the next one.
	_m=/etc/apt/apt-mirrors.txt
	if [ -f "$_m" ] && [ "$(grep -c . "$_m")" -gt 1 ]; then
		echo "ci-retry: next apt attempt skips mirror $(sed -n 1p "$_m" | cut -f1)" >&2
		sudo -n sed -i 1d "$_m" 2>/dev/null || true
	fi
}

i=1
while [ "$i" -le "$TRIES" ]; do
	rc=0
	attempt "$@" || rc=$?
	# `[ … ] && exit 0` would be a failing top-level list under `set -e` on every unsuccessful
	# attempt, i.e. no retries at all.
	if [ "$rc" -eq 0 ]; then exit 0; fi
	if [ -n "$RETRY_ON" ] && [ "$rc" -ne "$STALLED" ] && ! printf ' %s ' "$RETRY_ON" | grep -q " $rc "; then
		echo "ci-retry: exit $rc is an answer, not an outage: $*" >&2
		exit "$rc"
	fi

	if [ "$rc" -eq "$STALLED" ]; then
		echo "ci-retry: attempt $i of $TRIES stalled past ${SECONDS_PER_TRY}s: $*" >&2
	else
		echo "ci-retry: attempt $i of $TRIES failed (exit $rc): $*" >&2
	fi
	if [ "$i" -ge "$TRIES" ]; then
		echo "ci-retry: giving up after $TRIES attempts" >&2
		# Given up on a stall, or on exits CI_RETRY_ON calls an outage: the title
		# .github/workflows/rerun-infra.yml re-runs a run by. Any other exit is not ours to classify.
		if [ "$rc" -eq "$STALLED" ] || [ -n "$RETRY_ON" ]; then
			echo "::error title=Upstream outage (safe to rerun)::$*" >&2
		fi
		exit "$rc"
	fi

	case " $* " in *" install-deps "*|*" --with-deps "*|*" apt-get "*) clear_apt ;; esac
	sleep $((i * 15))
	i=$((i + 1))
done

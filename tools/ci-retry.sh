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
# `timeout --kill-after` because the first TERM goes to the wrapper: apt or npm below it can ignore
# it and keep the lock, so the deadline has to be able to escalate. And `dpkg --configure -a` after
# a killed apt, because a package manager interrupted mid-unpack leaves the next one refusing to
# start — on a runner nobody can log into.
set -eu

SECONDS_PER_TRY="${1:?usage: ci-retry.sh <seconds> <command...>}"
shift
[ "$#" -gt 0 ] || { echo "ci-retry: nothing to run" >&2; exit 2; }

TRIES=3
i=1
while [ "$i" -le "$TRIES" ]; do
	# NOT `if timeout …; then`: an `if` with no else answers 0 when its condition fails, so the
	# status read after it is the `if` statement's, not the command's — which reported every stall
	# as "exit 0" and then gave up with a green exit code.
	timeout --kill-after=30 "$SECONDS_PER_TRY" "$@" && exit 0
	rc=$?
	# 124 is timeout's own "the command outlived the deadline"; 137 is the KILL that followed.
	case "$rc" in
		124|137) echo "ci-retry: attempt $i of $TRIES stalled past ${SECONDS_PER_TRY}s: $*" >&2 ;;
		*)       echo "ci-retry: attempt $i of $TRIES failed (exit $rc): $*" >&2 ;;
	esac
	[ "$i" -lt "$TRIES" ] || { echo "ci-retry: giving up after $TRIES attempts" >&2; exit "$rc"; }
	# A killed apt leaves its lock and possibly a half-configured package behind. Both are cheap to
	# clear and neither is reached when the command is not apt.
	sudo dpkg --configure -a >/dev/null 2>&1 || true
	sleep $((i * 15))
	i=$((i + 1))
done

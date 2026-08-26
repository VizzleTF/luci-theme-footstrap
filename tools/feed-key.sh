#!/bin/sh
# Fetch the published feed's public key, and report whether the feed answered at all.
#
# Writes `reachable=true|false` to $GITHUB_OUTPUT rather than failing: the step that uses it tests
# what is ALREADY LIVE, not this build, so a feed whose DNS is mid-migration would otherwise turn
# every push red over a channel this repository does not own. A check that can only be repaired
# somewhere else is a warning, not a gate.
set -eu
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"
: "${GITHUB_OUTPUT:=/dev/stdout}"

if curl -fsSL -o "$RUNNER_TEMP/owfeed-packages.pem" https://repo.owfeed.org/owfeed-packages.pem; then
	echo "reachable=true" >> "$GITHUB_OUTPUT"
else
	echo "reachable=false" >> "$GITHUB_OUTPUT"
	echo "::warning::the published feed is unreachable at https://repo.owfeed.org — this build is unaffected, but subscribers cannot update until it is back"
fi

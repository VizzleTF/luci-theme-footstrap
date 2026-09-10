#!/bin/sh
# The published feed's public key, and the verdict on whether the feed was measured at all.
#
#   sh tools/feed-key.sh          fetch the key; write reachable=true|false to $GITHUB_OUTPUT
#   sh tools/feed-key.sh report   say which of the three happened — measured and passed, measured
#                                 and failed, or NOT MEASURED — reading $FEED_REACHABLE (this
#                                 script's own output from the fetch above) and $FEED_OUTCOME (the
#                                 assertion step's `outcome`, which is `skipped` when it never ran)
#
# Neither mode ever fails. The step that uses the key tests what is ALREADY LIVE, not this build, so
# a feed whose DNS is mid-migration would otherwise turn every push red over a channel this
# repository does not own. A check that can only be repaired somewhere else is a warning, not a gate.
#
# `report` exists because that warning was not readable. With `reachable=false` the assertion step's
# `if` went false, the step left no line anyone reads, and the job stayed green — so "the published
# feed serves a working theme" and "nobody asked" were the same picture from outside. Not measured is
# now spelled out where a green run is read: an annotation on the run, a block in the job summary,
# and a line in the log. It is still not a failure, and the fetch mode is still not a gate.
set -eu
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"
: "${GITHUB_OUTPUT:=/dev/stdout}"
# Off the runner there is no summary file; the same sentences still print on stdout below, so
# tools/ci-local.sh's log reads like the workflow's.
: "${GITHUB_STEP_SUMMARY:=/dev/null}"

KEY_URL=https://repo.owfeed.org/owfeed-packages.pem

# `::notice::`/`::warning::` are workflow commands and are noise in a terminal — print the same
# sentence plainly when this is not a GitHub Actions runner.
annotate() {
	if [ -n "${GITHUB_ACTIONS-}" ]; then
		printf '::%s title=%s::%s\n' "$1" "$2" "$3"
	else
		printf '%s: %s\n' "$1" "$3"
	fi
}

fetch_key() {
	if curl -fsSL -o "$RUNNER_TEMP/owfeed-packages.pem" "$KEY_URL"; then
		echo "reachable=true" >>"$GITHUB_OUTPUT"
	else
		echo "reachable=false" >>"$GITHUB_OUTPUT"
		annotate warning 'Published feed unreachable' \
			"the published feed is unreachable at $KEY_URL — this build is unaffected, but subscribers cannot update until it is back"
	fi
}

# Three outcomes, three different words. `skipped` (or an empty outcome, which is what a step that
# never started leaves behind) is the one this whole mode was written for: it must not read like a
# pass anywhere a human looks.
report() {
	case "${FEED_REACHABLE-}::${FEED_OUTCOME-}" in
	true::success)
		level=notice
		headline='measured — the published feed serves a working theme'
		detail="Installed \`luci-theme-footstrap\` by name out of the published signed index, verified against the key at $KEY_URL, and rendered a page from it."
		;;
	true::failure)
		level=warning
		headline='MEASURED AND FAILED — the published feed does not serve a working theme'
		detail='The assertion ran against the ALREADY-PUBLISHED channel and failed. This build is unaffected and the job stays green on purpose, but subscribers are installing whatever the feed is serving right now — read the step above before publishing anything else.'
		;;
	true::*)
		level=warning
		headline='NOT MEASURED — the assertion did not run'
		detail="The feed key was fetched, so the assertion should have run, and it did not (outcome: \`${FEED_OUTCOME:-none}\`). Nothing below this line says anything about the published feed."
		;;
	*)
		level=warning
		headline='NOT MEASURED — the published feed did not answer'
		detail="\`tools/feed-key.sh\` could not fetch $KEY_URL, so \"Assert the feed serves a working theme\" never ran. This build is unaffected; this run makes no claim, good or bad, about what the published feed serves."
		;;
	esac

	annotate "$level" 'Published feed assertion' "feed assertion: $headline"
	printf 'feed assertion: %s\n%s\n' "$headline" "$detail"
	{
		printf '### Published feed assertion: %s\n\n' "$headline"
		printf '%s\n\n' "$detail"
	} >>"$GITHUB_STEP_SUMMARY"
}

case "${1-fetch}" in
fetch) fetch_key ;;
report) report ;;
*)
	echo "usage: $0 [fetch|report]" >&2
	exit 2
	;;
esac

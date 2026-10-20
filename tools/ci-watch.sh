#!/bin/sh
# Wait for the CI runs of one commit and end with a one-line verdict. Run it detached:
#   tools/bg.sh tools/ci-watch.sh --sha "$(git rev-parse HEAD)"   (+ tools/bg-wait.sh <run-id>)
#
#   tools/ci-watch.sh (--sha SHA | --run ID) [--repo owner/name] [--workflow FILE|NAME] [--max S] [--interval S]
#
# --sha polls `gh run list --commit` until a run for it exists (a push takes a few seconds to
# register; never filter by createdAt, which is UTC and missed a run), then until every matching
# run is completed. On red it prints tools/ci-log.sh for each failed run. Read-only.
# --workflow goes to gh, which takes a file name (release.yml) or a display name; matching the run's
# workflowName here missed a file name after 608 s. --run ignores it.
# Exit: 0 green, 1 red, 2 no run found or usage, 3 --max elapsed while still running.
# Last line: `ci: green|red|timeout <sha7|run> runs <ids> [failed: job, job]`.
set -eu

SHA='' RUN='' REPO='' WF='' MAX=6000 INTERVAL=20
while [ $# -gt 0 ]; do
	case "$1" in
		--sha) SHA=${2-} ;; --run) RUN=${2-} ;; --repo) REPO=${2-} ;; --workflow) WF=${2-} ;;
		--max) MAX=${2-} ;; --interval) INTERVAL=${2-} ;;
		*) echo "ci-watch: unknown option $1" >&2; exit 2 ;;
	esac
	shift 2 || { echo "ci-watch: option needs a value" >&2; exit 2; }
done
[ -n "$SHA$RUN" ] || { echo "usage: tools/ci-watch.sh (--sha SHA | --run ID) [--repo R] [--workflow FILE|NAME] [--max S] [--interval S]" >&2; exit 2; }
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# `gh run list --commit` matches the full sha only: an abbreviated one finds nothing
[ -z "$SHA" ] || SHA=$(git rev-parse --verify -q "$SHA^{commit}" 2>/dev/null || printf %s "$SHA")
R=''; [ -z "$REPO" ] || R="--repo $REPO"
LABEL=${SHA:-$RUN}; LABEL=$(printf %.7s "$LABEL")
FIND=$((MAX < 600 ? MAX : 600))   # how long a run may take to show up

# one line per run: id <TAB> status <TAB> conclusion <TAB> workflow
list() {
	set --; [ -z "$WF" ] || set -- --workflow "$WF"   # "$@" keeps a display name with spaces whole
	# shellcheck disable=SC2086
	if [ -n "$RUN" ]; then gh run view "$RUN" $R --json databaseId,status,conclusion,workflowName --jq '"\(.databaseId)\t\(.status)\t\(.conclusion)\t\(.workflowName)"'
	else gh run list $R "$@" --commit "$SHA" --limit 30 --json databaseId,status,conclusion,workflowName --jq '.[] | "\(.databaseId)\t\(.status)\t\(.conclusion)\t\(.workflowName)"'; fi
}

start=$(date +%s)
while :; do
	runs=$(list 2>/dev/null || true)
	now=$(($(date +%s) - start))
	if [ -z "$runs" ]; then
		[ "$now" -lt "$FIND" ] || { echo "ci: no run for $LABEL after ${now}s (pushed? --repo? workflow filter?)"; exit 2; }
	elif ! printf '%s\n' "$runs" | awk -F'\t' '$2 != "completed" { f = 1 } END { exit !f }'; then
		break
	elif [ "$now" -ge "$MAX" ]; then
		echo "ci: timeout $LABEL runs $(printf '%s\n' "$runs" | cut -f1 | tr '\n' ' ')still running after ${now}s"; exit 3
	fi
	sleep "$INTERVAL"
done

ids=$(printf '%s\n' "$runs" | cut -f1 | tr '\n' ' ')
bad=$(printf '%s\n' "$runs" | awk -F'\t' '$3 != "success" && $3 != "skipped" && $3 != "neutral" { print $1 }')
if [ -z "$bad" ]; then echo "ci: green $LABEL runs ${ids% }"; exit 0; fi
names=''
for id in $bad; do
	# shellcheck disable=SC2086
	"$HERE/ci-log.sh" "$id" $R || true
	# shellcheck disable=SC2086
	names="$names $(gh run view "$id" $R --json jobs --jq '[.jobs[] | select(.conclusion=="failure" or .conclusion=="timed_out") | .name] | join(", ")' 2>/dev/null || true),"
done
echo "ci: red $LABEL runs ${ids% } failed:${names%,}"
exit 1

#!/bin/sh
# Print why a CI run failed: failed job, failed step, then the decisive lines of its log
# (##[error], NEW, live-audit:, Error), ANSI and timestamps stripped, 40 lines at most.
# `gh run view --log-failed` prints nothing for a run that is still marked in progress and
# `gh api .../logs` keeps the colour codes, so this reads the job log itself.
#
#   tools/ci-log.sh <run-id> [job-regex] [--repo owner/name]
#   tools/ci-log.sh --filter <N>      # stdin -> the last N decisive lines (the pure part, unit-tested)
set -eu

DECISIVE='##\[error\]|^NEW|live-audit:|Error'

# ESC[...m and the leading ISO timestamp are noise; the CR some steps emit would hide a match's end.
filter() { sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r//g; s/^[0-9T:.Z-]* //' | grep -E "$DECISIVE" | tail -n "$1" || true; }

if [ "${1-}" = --filter ]; then filter "${2:-40}"; exit 0; fi
[ $# -ge 1 ] || { echo "usage: tools/ci-log.sh <run-id> [job-regex] [--repo owner/name]" >&2; exit 2; }
RUN=$1; shift
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo VizzleTF/luci-theme-footstrap)
RE='.'
while [ $# -gt 0 ]; do
	case "$1" in
		--repo) REPO=${2:?--repo needs owner/name}; shift 2 ;;
		*) RE=$1; shift ;;
	esac
done

# one line per failed job: id <TAB> name <TAB> failed step
JOBS=$(gh run view "$RUN" --repo "$REPO" --json jobs --jq '.jobs[] | select(.conclusion=="failure" or .conclusion=="timed_out") | "\(.databaseId)\t\(.name)\t\([.steps[] | select(.conclusion=="failure") | .name][0] // "?")"') || { echo "ci-log: cannot read run $RUN in $REPO (gh auth, or wrong --repo)" >&2; exit 2; }
JOBS=$(printf '%s\n' "$JOBS" | awk -F'\t' -v re="$RE" 'NF && $2 ~ re')
[ -n "$JOBS" ] || { echo "ci-log: run $RUN has no failed job matching /$RE/"; exit 0; }

N=$(printf '%s\n' "$JOBS" | wc -l)
CAP=$((40 / N - 2)); [ "$CAP" -ge 3 ] || CAP=3
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
FAIL=0
while IFS="$(printf '\t')" read -r id name step; do
	echo "job: $name ($id)"
	echo "step: $step"
	# without the flag gh refuses a log holding colour codes; say so instead of printing nothing
	LOGTXT=$(gh api --allow-escape-sequences "repos/$REPO/actions/jobs/$id/logs" 2>&1) || { echo "ci-log: cannot fetch the log of job $id: $LOGTXT" >&2; FAIL=2; continue; }
	printf '%s\n' "$LOGTXT" | filter "$CAP"
done >"$OUT" <<EOF
$JOBS
EOF
head -n 40 "$OUT"
exit "$FAIL"

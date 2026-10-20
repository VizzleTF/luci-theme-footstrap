#!/bin/sh
# Print why a CI run failed: failed job, failed step, then the decisive lines of its log
# (##[error], NEW, live-audit:, Error, node:test `not ok` with its location and one-line error)
# plus the 8 non-empty lines before the first ##[error] (a step that dies on a plain `console.error`
# names its cause there and matches nothing above), ANSI and timestamps stripped, 40 lines at most.
# `gh run view --log-failed` prints nothing for a run that is still marked in progress and
# `gh api .../logs` keeps the colour codes, so this reads the job log itself.
#
#   tools/ci-log.sh <run-id> [job-regex] [--repo owner/name]
#   tools/ci-log.sh --filter <N>      # stdin -> the last N decisive + context lines (the pure part, unit-tested)
set -eu

# A TAP failure is `not ok N - name` + `location:` (indented one level per nesting); `error: |-` carries
# its text on the next line, so only the one-line form `error: '...'` is kept (a bare `|-` is one wasted line).
DECISIVE='##\[error\]|^NEW|live-audit:|Error|^[[:space:]]*(not ok |location: |error: [^|])'

# ESC[...m and the leading ISO timestamp are noise; the CR some steps emit would hide a match's end.
# Both sets are numbered by log line, so a line that is decisive AND context prints once, in log order.
filter() {
	T=$(mktemp)
	sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\r//g; s/^[0-9T:.Z-]* //' >"$T"
	K=$(grep -n -m1 '##\[error\]' "$T" | cut -d: -f1)
	{
		grep -nE "$DECISIVE" "$T" || true
		[ -z "$K" ] || head -n "$((K - 1))" "$T" | grep -n '[^[:space:]]' | tail -n 8
	} | sort -t: -k1,1n -u | tail -n "$1" | cut -d: -f2-
	rm -f "$T"
}

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

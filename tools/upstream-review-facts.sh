#!/bin/sh
# One read-only report of the mechanical facts the upstream bot checks, so the reviewer reads one
# output instead of piping a dozen git calls (the no-pipe hook cost it its turn budget).
#   tools/upstream-review-facts.sh [-C <dir>] <base> <head>
set -eu
D=.
[ "${1:-}" = -C ] && [ $# -ge 2 ] && { D=$2; shift 2; }
[ $# -eq 2 ] || { echo "usage: $0 [-C <dir>] <base> <head>" >&2; exit 2; }
B=$1 H=$2
git() { command git -C "$D" "$@"; }

echo "== file modes (changed files)"
git diff --raw "$B...$H" | awk '{print $2, $5, $6}'
echo "== git diff --check"
git diff --check "$B...$H" && echo clean
echo "== double blank lines in added lines"
git diff -U0 "$B...$H" | awk '
	/^\+\+\+ /{f=substr($2,3); prev=0; next}
	/^\+$/{ if (prev) print f ": blank line doubled"; prev=1; next }
	/^\+/{prev=0}'
echo "== external URLs in added lines"
git diff -U0 "$B...$H" | grep -E '^\+[^+].*https?://' || echo none
echo "== probe leftovers (fs:probe)"
git diff -U0 "$B...$H" | grep -E '^\+[^+].*fs:probe' || echo none
echo "== session litter in added lines (../tmp/, task id, run id)"
git diff -U0 "$B...$H" | grep -E '^\+[^+].*(\.\./tmp/|\btask-[0-9a-z]*[0-9][0-9a-z]*|run [0-9]{9,}|actions/runs/)' || echo none

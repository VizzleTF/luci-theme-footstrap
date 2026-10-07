#!/bin/sh
# usage: tools/rate.sh <N> <cmd...> — run cmd N times, print "K/N failed", exit 1 if any failed.
# A flaky finding is called fixed only with a measured rate (old build red, new build 0/N), never
# from one green run. docs/development.md, "Calling a flaky finding fixed".
set -u
case "${1:-}" in '' | *[!0-9]* | 0) echo "usage: tools/rate.sh <N> <cmd...>" >&2; exit 2 ;; esac
[ $# -ge 2 ] || { echo "usage: tools/rate.sh <N> <cmd...>" >&2; exit 2; }
n=$1
shift
fail=0
i=0
while [ "$i" -lt "$n" ]; do
	i=$((i + 1))
	if "$@"; then :; else fail=$((fail + 1)); fi
done
echo "rate: $fail/$n failed"
[ "$fail" -eq 0 ]

#!/bin/sh
# The package version and the build epoch, written to $GITHUB_ENV.
#
# SOURCE_DATE_EPOCH is what makes the packages reproducible. Both containers record
# mtimes and a package's identity is a hash over its payload, so without a fixed epoch
# byte-identical content rebuilds into a package that claims to be new — which
# invalidates every cached copy and makes an integrity check report tampering that did
# not happen.
#
# The COMMIT's timestamp, not the job's: identity should depend on what went into the
# package and on nothing else, so re-running the workflow over the same commit has to
# produce the same bytes.
set -eu
cd "$(dirname "$0")/.."

case "${GITHUB_REF:-}" in
	refs/tags/v*) version="${GITHUB_REF#refs/tags/v}" ;;
	*)            version="0.$(date +%y%m%d).${GITHUB_RUN_NUMBER:-0}" ;;
esac
epoch="$(git log -1 --format=%ct)"

: "${GITHUB_ENV:=/dev/stdout}"
printf 'FOOTSTRAP_VERSION=%s\nSOURCE_DATE_EPOCH=%s\n' "$version" "$epoch" >> "$GITHUB_ENV"
echo "version $version, epoch $epoch"

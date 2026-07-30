#!/bin/sh
# Flip the draft release to published, then prove the URL a router uses resolves.
#
# THE DRAFT EXISTS TO CLOSE A WINDOW. `latest` moves to a release the moment it is
# published, and the upload action creates the release FIRST and attaches the assets
# after — so a router polling in that gap resolves
# releases/latest/download/manifest.txt to a release that has no manifest yet, and
# reports a hard error. A draft is not `latest`, so the switch happens once, with every
# asset already in place. The same window existed for the .apk assets before the
# manifest and nothing had ever closed it.
#
# Then the check: fetch the manifest from the release CDN, not the API, and compare it
# with the one just built. A 404 here means every install and every update check would
# have failed, and this is the last moment it is still a red build rather than a bug
# report.
set -eu
cd "$(dirname "$0")/.."
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

gh release edit "$GITHUB_REF_NAME" --draft=false --repo "$GITHUB_REPOSITORY"

url="https://github.com/$GITHUB_REPOSITORY/releases/latest/download/manifest.txt"
for i in 1 2 3 4 5; do
	curl -fsSL --retry 2 -o "$RUNNER_TEMP/mf.check" "$url" && break
	[ "$i" = 5 ] && { echo "releases/latest/download/manifest.txt does not resolve"; exit 1; }
	sleep 5
done

diff -u dist/manifest.txt "$RUNNER_TEMP/mf.check" || {
	echo "the manifest served by latest/download is not the one we just built"; exit 1; }
echo "manifest.txt resolves through releases/latest/download and matches."

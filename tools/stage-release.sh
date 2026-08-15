#!/bin/sh
# Put into dist/ the one asset that is not a package — the installer — and write the
# release notes where the workflow can read them. Runs before the manifest, because
# whatever is in dist/ is signed with everything else.
#
# THE NOTES are the tag's CHANGELOG section, one line per change, grouped by
# Fixed/Added/…. They fill the release page and are NOT an asset: the only reader that
# ever fetched notes.md from a release was the self-update package, which is retired and
# archived, and an asset nothing reads is one more file to sign, mirror and keep true.
#
# THE INSTALLER ships as an asset because the documented one-liner fetches it from
# raw.githubusercontent.com, which GitHub rate-limits for unauthenticated callers — so
# the very user whose IP has run out of budget (CGNAT, a shared exit, a DNS-based
# unblocker) fails to download the installer that was supposed to rescue them. Release
# assets are served from the release CDN and carry no such budget. Issue #17.
set -eu
cd "$(dirname "$0")/.."
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

mkdir -p dist

sh tools/release-notes.sh "${GITHUB_REF_NAME#v}" > "$RUNNER_TEMP/notes.md"
cat "$RUNNER_TEMP/notes.md"

cp install.sh dist/install.sh

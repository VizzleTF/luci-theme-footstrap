#!/bin/sh
# Put into dist/ the two assets that are not packages: the release notes and the
# installer. Runs before the manifest, because both are signed with everything else.
#
# THE NOTES are the tag's CHANGELOG section, one line per change, grouped by
# Fixed/Added/…. They are an ASSET as well as the release body: the theme's confirm
# dialog reads them from the release rather than from `@.body`, which needed
# api.github.com. The copy in $RUNNER_TEMP is what fills the release page.
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
cp "$RUNNER_TEMP/notes.md" dist/notes.md
cat "$RUNNER_TEMP/notes.md"

cp install.sh dist/install.sh

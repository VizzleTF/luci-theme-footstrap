#!/bin/sh
# Put into dist/ the one asset that is not a package — the installer — and write the release notes
# where the workflow can read them. Runs before the manifest, since whatever is in dist/ is signed
# with everything else.
#
# The notes are the tag's CHANGELOG section, one line per change, grouped by Fixed/Added/…. They
# fill the release page and are NOT an asset: an asset nothing reads is one more file to sign,
# mirror and keep true. They land in the workspace as release-notes.md — `$RUNNER_TEMP` cannot be
# named in the release job's `with:`.
#
# The installer ships as an asset because the documented one-liner fetches it from
# raw.githubusercontent.com, which GitHub rate-limits for unauthenticated callers — so the very user
# whose IP has run out of budget fails to download the installer meant to rescue them. Release
# assets are served from the release CDN and carry no such budget (issue #17).
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist

# BESIDE dist/, never inside it: everything in dist/ becomes a release asset, and the
# notes are the release BODY. The path is workspace-relative because that is the only kind
# the release workflow can be handed — see the note beside `notes-file` in build.yml.
sh tools/release-notes.sh "${GITHUB_REF_NAME#v}" > release-notes.md
cat release-notes.md

cp install.sh dist/install.sh

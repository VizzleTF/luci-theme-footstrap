#!/bin/sh
# Write and sign manifest.txt, and sign every package beside it.
#
# WHY usign AND NOT THE PACKAGE MANAGER'S OWN: `apk add` verifies against
# /etc/apk/keys, and putting our key there would make footstrap a trust anchor for
# EVERYTHING the router installs — far more authority than a theme needs. opkg on 24.10
# cannot verify a standalone .ipk at all. usign, which base-files puts on every OpenWrt
# image, verifies both formats with a key that authorises nothing but this package.
#
# `--repo` is written into the manifest and readers check it. One key signs BOTH this
# repository's manifests and the updater's, so without that line a manifest lifted from
# the updater's release would verify perfectly under the theme's name: a signature
# proves WHO wrote a file, never WHAT IT IS ABOUT.
#
# THE SECRET IS BASE64 of usign's two-line secret-key FILE — one canonical form, so
# nothing has to guess whether newlines survived a copy-paste — and owfeed wants the
# file itself, hence the decode. It never touches the disk: it goes into a variable
# scoped to the one command, which is not in the process table and not in the tree.
set -eu
cd "$(dirname "$0")/.."

[ -n "${FOOTSTRAP_USIGN_KEY:-}" ] || {
	echo "FOOTSTRAP_USIGN_KEY is not set — a release without a signature is a release"
	echo "no current installer will accept. Refusing to publish one."
	exit 1
}

OWFEED_RELEASE_KEY="$(printf '%s' "$FOOTSTRAP_USIGN_KEY" | base64 -d)" \
	owfeed release --repo "$GITHUB_REPOSITORY" --tag "$GITHUB_REF_NAME" \
	               --sign-also install.sh

cat dist/manifest.txt

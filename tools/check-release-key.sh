#!/bin/sh
# install.sh embeds the same release key as release.pub.
#
# The installer verifies the theme asset's ed25519 signature, so it carries the public
# key: it runs from `curl | sh` before any package exists. release.pub at the repo root
# is the reference copy. A divergence looks exactly like the attack the key stops — the
# installer rejects every release with "BAD SIGNATURE" — so the two are compared here.
#
# The SAME key signs the updater's releases in its own repository
# (VizzleTF/luci-app-footstrap-updater), where the package ships its own copy.
set -eu
cd "$(dirname "$0")/.."

want=$(grep -v '^untrusted comment:' release.pub | tr -d '\n')
[ -n "$want" ] || { echo "no key line in release.pub"; exit 1; }

# Every key-shaped line in the installer, deduplicated: a stale copy left behind by a
# rotation shows up as a second value rather than as a silent second key.
got=$(grep -oE 'RW[A-Za-z0-9+/=]{40,}' install.sh | sort -u)
[ "$got" = "$want" ] || {
	echo "install.sh embeds a different release key than release.pub"
	echo "  release.pub: $want"
	echo "  installer:   ${got:-<none>}"
	exit 1
}
echo "release key matches in both copies."

#!/bin/sh
# Build usign from the commit luci-upstream.pin names, and print the path to the binary.
#
# Two CI jobs need it for opposite reasons — the build job VERIFIES OpenWrt's sha256sums.sig before
# trusting the SDK, the release job SIGNS each package with our own key — so a recipe living in one
# of them would grow a copy in the other, and a second `git checkout <pin>` is exactly the shape
# that ends up on two different commits with nothing to say so.
#
# It needs neither cmake nor libubox: the six sources plus the bundled base64.c compile with plain
# cc. Usage: U="$(tools/build-usign.sh "$RUNNER_TEMP/usign")"
set -eu

dest="${1:?usage: build-usign.sh <dir>}"
here="$(cd "$(dirname "$0")/.." && pwd)"

. "$here/luci-theme-footstrap/luci-upstream.pin"
[ -n "${USIGN_PIN:-}" ] || { echo "USIGN_PIN missing from luci-upstream.pin" >&2; exit 1; }

# Idempotent, because two STEPS of one job call this — the release job signs the installer and then
# verifies every signature — and `git clone` into an existing directory fails. Reuse is only offered
# when the checkout is at the pinned commit: a tree left at some other revision is the drift this
# script exists to prevent, so it is a loud error rather than a silent rebuild.
if [ -e "$dest" ]; then
	head="$(git -C "$dest" rev-parse HEAD 2>/dev/null || true)"
	if [ "$head" = "$USIGN_PIN" ] && [ -x "$dest/usign" ]; then
		printf '%s\n' "$dest/usign"
		exit 0
	fi
	echo "$dest already exists and is not a built usign at $USIGN_PIN — remove it first" >&2
	exit 1
fi

git clone -q https://github.com/openwrt/usign "$dest"
git -C "$dest" checkout -q "$USIGN_PIN"
( cd "$dest" && cc -O2 -o usign ed25519.c edsign.c f25519.c fprime.c sha512.c main.c base64.c )

printf '%s\n' "$dest/usign"

#!/bin/sh
# Build the exact jsmin the OpenWrt buildbot minifies our JS with. Prints the path to the binary;
# tools/jsmin-verify.mjs reads it from $JSMIN.
#
# Pinned to a commit and checksummed, because of what this file is: C source fetched over the
# network, compiled, and then run as the gate that decides whether our shipped JavaScript is safe.
# From a moving `master` the gate would be whatever upstream pushed last. Both the SHA and the
# sha256 live in luci-theme-footstrap/luci-upstream.pin, which update-po.sh sources for its own
# borrowed tool, so bumping upstream cannot leave half the toolchain behind.
#
# jsmin.c is byte-identical on openwrt-24.10 and master, so one build covers both releases.
set -eu
cd "$(dirname "$0")/.."

. ./luci-theme-footstrap/luci-upstream.pin
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

src="$RUNNER_TEMP/jsmin.c"
bin="$RUNNER_TEMP/jsmin"

curl -fsSL --proto '=https' --proto-redir '=https' -o "$src" \
	"https://raw.githubusercontent.com/openwrt/luci/$LUCI_PIN/modules/luci-base/src/jsmin.c"
echo "$JSMIN_SHA256  $src" | sha256sum -c - >&2
cc -O2 -o "$bin" "$src"

echo "$bin"

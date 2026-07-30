#!/bin/sh
# The ucode templates compile — in the ucode the router actually runs.
#
# THEY HAD NO PARSER. luci.mk copies ucode/ to the router verbatim and never compiles
# it, so a stray brace in header.ut built green, released, and then every user's LuCI
# silently fell back to another theme (docs/01) — the one way this repository could
# ship a completely broken UI with CI all green.
#
# `ucode -T -c` is LuCI's own trycompile, run before the release instead of after it.
#
# IT COMES OUT OF THE OPENWRT IMAGE, not out of a source build. This used to clone
# jow-/ucode at a pinned commit and build it with cmake, which needed `sudo apt-get
# install cmake libjson-c-dev` and therefore ran in CI and nowhere else — a gate a
# contributor cannot run locally is a gate they find out about from a red build. The
# stock rootfs already ships /usr/bin/ucode, so pulling the image gives the exact
# interpreter the release line runs, and the pin becomes the image tag.
#
#   sh tools/check-ucode.sh              # 25.12, the default line
#   OPENWRT_IMAGE=... sh tools/check-ucode.sh
#
# THE TWO STUBS. ucode resolves `import` at COMPILE time, so header.ut's imports must
# resolve or nothing compiles — and both are the router's runtime rather than ours:
# `luci.core` is luci-base's ucode library and `uci` is a native binding built only
# against libuci. Installing luci-base to satisfy an import would make this gate a
# package install. What it is for is OUR syntax, so the modules are stubbed and
# ucode's search path points at them: the import resolves, the template is parsed for
# real, and the stub bodies never run (-c compiles, it does not execute). A template
# that imports something new fails here loudly, which is the right behaviour.
set -eu
cd "$(dirname "$0")/.."

IMAGE="${OPENWRT_IMAGE:-openwrt/rootfs:x86-64-25.12.4}"

command -v docker >/dev/null || {
	echo "docker is needed to run the router's own ucode; install it, or set" >&2
	echo "OPENWRT_IMAGE and run this where docker is available" >&2
	exit 1
}

# Written into the tree rather than a temp directory because the container mounts the
# tree, and a path outside it is not visible from inside.
STUB=.owfeed-ucode-stubs
rm -rf "$STUB"
mkdir -p "$STUB/luci"
trap 'rm -rf "$STUB"' EXIT
printf '%s\n' \
	'function cursor() { return { get: function() { return null; } }; }' \
	'export { cursor };' > "$STUB/uci.uc"
printf '%s\n' \
	'function getuid() { return 0; }' \
	'function getspnam() { return null; }' \
	'export { getuid, getspnam };' > "$STUB/luci/core.uc"

docker run --rm -v "$PWD:/w" -w /w "$IMAGE" sh -c '
	set -eu
	n=0
	for f in $(find luci-theme-footstrap/ucode -name "*.ut"); do
		ucode -T -c -L "'"$STUB"'/*.uc" -o /dev/null "$f" || {
			echo "template does not compile: $f"; exit 1; }
		n=$((n + 1))
	done
	[ "$n" -gt 0 ] || { echo "no .ut templates found — the glob is wrong"; exit 1; }
	echo "$n ucode template(s) compile."
'

#!/bin/sh
# The ucode templates compile.
#
# THEY HAD NO PARSER. luci.mk copies ucode/ to the router verbatim and never compiles
# it, so a stray brace in header.ut built green, released, and then every user's LuCI
# silently fell back to another theme (docs/01) — the one way this repository could
# ship a completely broken UI with CI all green.
#
# `ucode -T -c` is LuCI's own trycompile, so this is the check the router would do, run
# before the release instead of after it. ucode is not packaged for Ubuntu and is built
# from the commit pinned in luci-upstream.pin, exactly as jsmin.c is and for the same
# reason: a gate fetched from a moving master is whatever upstream pushed last.
#
# THE TWO STUBS. ucode resolves `import` at COMPILE time, so header.ut's imports must
# resolve or nothing compiles — and both are the ROUTER's runtime, not ours: `luci.core`
# is luci-base's ucode library and `uci` is a native binding built only against libuci.
# Dragging those in would make this gate a distro build. What it is for is OUR syntax, so
# the modules are stubbed and ucode's search path points at them: the import resolves,
# the template is parsed for real, and the stub bodies never run (-c compiles). A
# template that imports something new fails here loudly, which is the right behaviour
# for a missing stub.
set -eu
cd "$(dirname "$0")/.."

. luci-theme-footstrap/luci-upstream.pin
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

if ! command -v cmake >/dev/null; then
	sudo apt-get update && sudo apt-get install -y cmake libjson-c-dev
fi

UC="$RUNNER_TEMP/ucode/build/ucode"
if [ ! -x "$UC" ]; then
	git clone -q https://github.com/jow-/ucode "$RUNNER_TEMP/ucode"
	git -C "$RUNNER_TEMP/ucode" checkout -q "$UCODE_PIN"
	cmake -S "$RUNNER_TEMP/ucode" -B "$RUNNER_TEMP/ucode/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
	cmake --build "$RUNNER_TEMP/ucode/build" -j"$(nproc)" >/dev/null
fi

STUB="$RUNNER_TEMP/ucode-stubs"
mkdir -p "$STUB/luci"
printf '%s\n' \
	'function cursor() { return { get: function() { return null; } }; }' \
	'export { cursor };' > "$STUB/uci.uc"
printf '%s\n' \
	'function getuid() { return 0; }' \
	'function getspnam() { return null; }' \
	'export { getuid, getspnam };' > "$STUB/luci/core.uc"

n=0
for f in $(find luci-theme-footstrap/ucode -name '*.ut'); do
	"$UC" -T -c -L "$STUB/*.uc" -o /dev/null "$f" || { echo "template does not compile: $f"; exit 1; }
	n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "no .ut templates found — the glob is wrong"; exit 1; }
echo "$n ucode template(s) compile."

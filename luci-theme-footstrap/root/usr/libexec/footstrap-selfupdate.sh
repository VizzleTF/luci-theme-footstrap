#!/bin/sh
# Footstrap theme self-update.
#
# Downloads the latest GitHub release package for THIS theme and installs it with
# the platform package manager: apk on 25.12+, opkg on 24.10. The repo and the
# GitHub API endpoint are hard-coded here and the script takes NO arguments, so
# the LuCI `file.exec` call that triggers it (ACL-gated to this exact path) has no
# injection surface — it can only ever install this theme's own signed-by-nobody
# release, over HTTPS, when an authenticated admin asks for it.
#
# Output: a single line "OK" on success, or "ERR: <reason>" (+ non-zero exit) so
# the client can tell them apart.
REPO="VizzleTF/luci-theme-footstrap"
API="https://api.github.com/repos/${REPO}/releases/latest"

if command -v apk >/dev/null 2>&1; then
	EXT="apk"; TMP="/tmp/footstrap-update.apk"
	install_pkg() { apk add --allow-untrusted "$1"; }
elif command -v opkg >/dev/null 2>&1; then
	EXT="ipk"; TMP="/tmp/footstrap-update.ipk"
	install_pkg() { opkg install "$1"; }
else
	echo "ERR: no apk or opkg found"; exit 1
fi

# pick the .apk / .ipk asset URL from the latest release
url="$(curl -fsSL "$API" 2>/dev/null | jsonfilter -e '@.assets[*].browser_download_url' 2>/dev/null | grep -E "\.${EXT}\$" | head -1)"
[ -n "$url" ] || { echo "ERR: no .${EXT} asset in latest release"; exit 1; }

# -L: follow the release->objects.githubusercontent.com redirect
curl -fsSL -o "$TMP" "$url" 2>/dev/null || { echo "ERR: download failed"; exit 1; }
[ -s "$TMP" ] || { echo "ERR: empty download"; rm -f "$TMP"; exit 1; }

out="$(install_pkg "$TMP" 2>&1)"; rc=$?
rm -f "$TMP"
# drop the LuCI menu/dispatch + module caches so the new theme is served at once
rm -f /tmp/luci-indexcache* 2>/dev/null
rm -rf /tmp/luci-modulecache 2>/dev/null

if [ "$rc" = 0 ]; then
	echo "OK"
else
	echo "ERR: install failed: ${out}"
	exit 1
fi

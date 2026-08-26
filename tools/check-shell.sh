#!/bin/sh
# Every shell script in the SOURCE tree parses.
#
# The payload is not here: `owfeed doctor` parses everything under `files:` (OWF213), which covers
# /etc/uci-defaults/* and /usr/libexec/* once tools/stage.sh has staged them. What is left is the
# scripts that never reach a router.
#
# tools/ is in the glob because release-notes.sh is only ever run by the release job, i.e. after
# both packages have built — a syntax error in it would be found at the one moment it costs most.
set -eu
cd "$(dirname "$0")/.."

n=0
for f in luci-theme-footstrap/*.sh install.sh tools/*.sh wallpapers/*.sh fonts/*.sh; do
	[ -f "$f" ] || continue
	sh -n "$f" || { echo "syntax error: $f"; exit 1; }
	n=$((n + 1))
done
echo "$n shell script(s) parse."

#!/bin/sh
# Every shell script in the SOURCE tree parses — and install.sh, which is the one script here that
# actually reaches a router (`wget ... | sh`, run as root on whatever `/bin/sh` is), parses under
# the interpreter that will run it there, not just under whichever `sh` happens to answer on the box
# running this gate.
#
# The payload is not here: `owfeed doctor` parses everything under `files:` (OWF213), which covers
# /etc/uci-defaults/* and /usr/libexec/* once tools/stage.sh has staged them. What is left is the
# scripts that never reach a router, install.sh being the one exception (it is not staged, it is
# fetched and run directly, so nothing else parses it either).
#
# tools/ is in the glob because release-notes.sh is only ever run by the release job, i.e. after
# both packages have built — a syntax error in it would be found at the one moment it costs most.
#
# `sh -n` is whatever `sh` resolves to on the box running it — bash on a developer's machine, dash
# on the ubuntu-latest CI runner, and NEITHER is busybox ash, which is what OpenWrt's own `/bin/sh`
# is and so what actually parses install.sh on a router. bash and dash both accept plenty busybox
# ash does not (an array literal, `arr=(1 2 3)`, parses clean under bash's `sh -n` and only fails at
# the interpreter that would actually run the line) — measured here, not assumed: none of the three
# is a stand-in for another.
set -eu
cd "$(dirname "$0")/.."

n=0
for f in luci-theme-footstrap/*.sh install.sh tools/*.sh wallpapers/*.sh fonts/*.sh; do
	[ -f "$f" ] || continue
	sh -n "$f" || { echo "syntax error: $f"; exit 1; }
	n=$((n + 1))
done

# A vanished payload must not read greener than a whole one: with the package directory moved away
# this used to print "18 shell script(s) parse", down from a real 27 (now 29, tools/ having grown
# since), and exit 0 — nothing compared the count against what should be there. 25 leaves room for a
# script or two to move without editing this floor, and still catches any one of the five directories
# above going missing (the smallest, wallpapers/ and fonts/, cost this gate nothing to lose; the
# largest, tools/, is 17 on its own).
FLOOR=25
[ "$n" -ge "$FLOOR" ] || {
	echo "check-shell: only $n shell script(s) found, expected at least $FLOOR — a directory the glob"
	echo "  above names is missing, not merely a script or two lighter than last measured"
	exit 1
}

# busybox ash is OpenWrt's own `/bin/sh` and the interpreter `wget -qO- .../install.sh | sh` actually
# runs on a router; find_busybox() gets one the same way both places this gate runs already can —
# Debian/Ubuntu (the dev box under WSL, per docs/development.md, and the ubuntu-latest CI runner
# alike) ships `busybox-static` in its default `main` archive, no extra repository pinned or trusted.
find_busybox() {
	if command -v busybox >/dev/null 2>&1; then
		command -v busybox
		return 0
	fi
	if command -v apt-get >/dev/null 2>&1; then
		if command -v sudo >/dev/null 2>&1; then
			sudo -n apt-get install -y --no-install-recommends busybox-static >/dev/null 2>&1 || true
		else
			apt-get install -y --no-install-recommends busybox-static >/dev/null 2>&1 || true
		fi
		if command -v busybox >/dev/null 2>&1; then
			command -v busybox
			return 0
		fi
	fi
	return 1
}

busybox_bin=$(find_busybox) || {
	echo "check-shell: no busybox (ash) available, and apt-get could not install busybox-static —" >&2
	echo "  this gate needs the interpreter that actually runs install.sh on a router; install it by" >&2
	echo "  hand (Debian/Ubuntu: apt-get install busybox-static) or run from WSL/ubuntu-latest CI" >&2
	exit 1
}

for rf in install.sh; do
	[ -f "$rf" ] || continue
	"$busybox_bin" ash -n "$rf" || {
		echo "check-shell: busybox ash rejects $rf — this is the interpreter that actually runs it on"
		echo "  a router (\`wget -qO- .../install.sh | sh\`, OpenWrt's own /bin/sh), and neither the"
		echo "  host's sh above nor the CI runner's dash stands in for it"
		exit 1
	}
done

echo "$n shell script(s) parse (host sh), 1 of them also under busybox ash (the router's)."

#!/bin/sh
# Boot this run's routers and install the build under test — the `live`/`motion` and `anchors`
# jobs (.github/workflows/build.yml) did this by hand, byte-for-byte except which env var each one
# also set around it, so this is the one copy both call.
#
#   sh tools/ci-boot.sh
#
# Needs GITHUB_EVENT_NAME, GITHUB_ENV and owlab already on PATH — true of any step after
# owfeed/owlab/setup in these jobs, never true outside CI.
set -eu

# NOT `. "$GITHUB_ENV"` after this — that file is a KEY=VALUE list, not a script, so a value with a
# space in it ("owrt2512 owrt2410") would run its second word as a command.
#
# The three OpenWrt lines the theme supports: both package managers plus the snapshot box, which
# tracks luci-base master and so fails on an upstream change before a user reports it. ImmortalWrt
# is deliberately absent — same luci-base, different brand, never the leg that caught something
# first; run it locally with --all when curious.
if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then ROUTERS="owrt2512"; else ROUTERS="owrt2512 owrt2410 owrtsnap"; fi
echo "ROUTERS=$ROUTERS" >> "$GITHUB_ENV"

owlab up $ROUTERS
for r in $ROUTERS; do
	case "$r" in
		*2512|*snap) owlab install "$r" dist/noarch/luci-theme-footstrap-*.apk ;;
		*)           owlab install "$r" dist/all/luci-theme-footstrap_*.ipk ;;
	esac
done

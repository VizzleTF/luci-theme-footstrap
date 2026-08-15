#!/bin/sh
# THE INSTALLER GATE: install.sh, run twice, on a real router.
#
# Three field reports were the installer and nothing else — #16 ("doesn't work with 0.10.0"), #28
# ("says it upgraded, still the old version"), #30 ("does not upgrade an older version on 25.12/apk").
# Every one of them was in the half no gate reached: `sh -n` proves the script parses, and
# `owlab test` installs the BUILT package with the package manager directly, which is not what a user
# runs. What a user runs is this script, against the published feed, on a router that may already
# have the theme.
#
# So: copy install.sh onto a stand, run it, then run it AGAIN over its own result — the upgrade path,
# which is the one all three reports were about, and the one that cannot be exercised by a fresh
# install. After each run the package must be present, `luci.main.mediaurlbase` must point at this
# theme, and the theme's own files must be on disk.
#
# It installs the PUBLISHED release, not this working tree, and that is the point: it is the path
# users take. Afterwards the stand is left with that release installed — run `owlab sync` to put your
# working tree back, which is what the last line does.
#
#   sh tools/install-check.sh [router-id ...]        (default: every running router)
#
# Needs owlab and a stand with network access (the installer fetches the feed index).
set -eu
cd "$(dirname "$0")/.."

command -v owlab >/dev/null || { echo "install-check: owlab is not on PATH (docs/development.md)"; exit 2; }

routers="${*:-}"
if [ -z "$routers" ]; then
	routers=$(owlab status -json | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | tr '\n' ' ')
fi
[ -n "$routers" ] || { echo "install-check: no owlab router is running, so nothing was checked."; exit 2; }

project=$(owlab status -json | sed -n 's/.*"project": "\([^"]*\)".*/\1/p' | head -1)
fail=0

for r in $routers; do
	c="owlab-${project}-${r}"
	printf '%s: ' "$r"
	docker cp install.sh "$c:/tmp/fs-install.sh" >/dev/null

	# The version the FEED serves, read from the router's own package manager after the installer has
	# added the feed — the check below compares against it rather than against a number in this repo,
	# which would go stale the moment a release lands.
	pass=1
	for run in 1 2; do
		if ! docker exec "$c" sh /tmp/fs-install.sh >"/tmp/install-check-$r-$run.log" 2>&1; then
			echo; echo "  run $run exited non-zero:"; tail -12 "/tmp/install-check-$r-$run.log" | sed 's/^/    /'
			pass=0; break
		fi
		# installed, registered, and the files it registers are actually there
		if ! docker exec "$c" sh -c '(apk info -e luci-theme-footstrap 2>/dev/null | grep -q . ) || (opkg list-installed 2>/dev/null | grep -q "^luci-theme-footstrap ")'; then
			echo; echo "  run $run: the package manager does not report the theme as installed"; pass=0; break
		fi
		if ! docker exec "$c" sh -c 'uci get luci.main.mediaurlbase 2>/dev/null | grep -q "footstrap$"'; then
			echo; echo "  run $run: luci.main.mediaurlbase does not point at the theme"; pass=0; break
		fi
		if ! docker exec "$c" sh -c 'test -s /www/luci-static/footstrap/cascade.css'; then
			echo; echo "  run $run: cascade.css is missing or empty"; pass=0; break
		fi
		# AND THE VERSION MOVED. This is the assertion the gate was missing when it was written, and
		# the field bug walked straight through the hole: `apk add` on a package already in `world`
		# leaves the old version in place, prints its usual OK line and exits 0, so "installed,
		# registered, cascade.css present" was all true while the router still ran the previous
		# release. Compare what is installed against what the feed serves, on the router itself.
		if ! docker exec "$c" sh -c '
			if command -v apk >/dev/null 2>&1; then
				have=$(apk list -I 2>/dev/null | sed -n "s/^luci-theme-footstrap-\([^ ]*\) .*/\1/p" | head -1)
				want=$(apk list luci-theme-footstrap 2>/dev/null | sed -n "s/^luci-theme-footstrap-\([^ ]*\) .*/\1/p" | sort -V | tail -1)
			else
				have=$(opkg list-installed luci-theme-footstrap 2>/dev/null | awk "{print \$3}")
				want=$(opkg list luci-theme-footstrap 2>/dev/null | awk "{print \$3}" | sort -V | tail -1)
			fi
			[ -n "$have" ] && [ -n "$want" ] && [ "$have" = "$want" ]'; then
			echo; echo "  run $run: the installed version is not the newest the feed serves"
			docker exec "$c" sh -c 'apk list -I 2>/dev/null | grep footstrap || opkg list-installed 2>/dev/null | grep footstrap' | sed 's/^/    installed: /'
			pass=0; break
		fi
	done

	if [ "$pass" = 1 ]; then echo "fresh install and re-install over it both leave the newest version, working"
	else fail=1; fi
done

# put the working tree back, so the next gate does not measure the published release by accident
owlab sync >/dev/null 2>&1 || true

[ "$fail" = 0 ] || { echo "install-check: the installer failed on at least one router."; exit 1; }
echo "install-check: install.sh is good on $(echo "$routers" | wc -w | tr -d ' ') router(s)."

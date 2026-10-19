#!/bin/sh
# The installer gate: install.sh, run twice, on a real router.
#
# Three field reports were the installer alone (#16, #28, #30): `sh -n` proves it parses and
# `owlab test` installs the BUILT package directly, not what a user runs. So: copy install.sh onto
# a stand, run it, then run it AGAIN over its own result, the upgrade path. After each run the
# package must be present, `luci.main.mediaurlbase` must point at this theme and its files must be
# on disk. It installs the PUBLISHED release and leaves it in place; `owlab sync` restores the tree.
#
#   sh tools/install-check.sh [router-id ...]        (default: every running OpenWrt router)
#
# Needs owlab and a stand with network access.
set -eu
cd "$(dirname "$0")/.."

command -v owlab >/dev/null || {
	echo "install-check: owlab is not on PATH (docs/development.md)"; exit 2
}

routers="${*:-}"
if [ -z "$routers" ]; then
	routers=$(node --input-type=module -e "
		import { stands } from './tools/lib/stands.mjs';
		console.log(stands('', { all: true }).map((s) => s.id).join(' '))")
fi
[ -n "$routers" ] || {
	echo "install-check: no owlab router is running, so nothing was checked."; exit 2
}

# heldBy() alone decides whether ci-local.sh's STANDS_LOCK_HELD/STANDS_LOCK_PID is believed: pid
# alive, lock file names it, flock really taken. A stale pair left in a later shell locks normally.
held() {
	node --input-type=module -e "
		import { heldBy } from './tools/lib/stands.mjs';
		process.exit(heldBy(process.argv[1], process.argv[2]) ? 0 : 1)" "$@"
}

project=$(owlab status -json | sed -n 's/.*"project": "\([^"]*\)".*/\1/p' | head -1)
fail=0
tmp=../tmp
mkdir -p "$tmp"

for r in $routers; do
	c="owlab-${project}-${r}"
	# Installing on a stand another gate is measuring invents findings: take
	# ../tmp/stands-<id>.lock the way tools/lib/stands.mjs does (30 min wait, STANDS_LOCK_TIMEOUT_MS), unless ci-local.sh
	# already holds it for this run.
	if ! held "$r" "$tmp/stands-$r.lock"; then
		exec 9>>"$tmp/stands-$r.lock"
		command -v flock >/dev/null 2>&1 || { echo "install-check: flock (util-linux) is missing; the stands cannot be locked"; exit 2; }
		lim=$(( ${STANDS_LOCK_TIMEOUT_MS:-1800000} / 1000 ))
		if ! flock -n 9; then
			echo "install-check: stand $r is in use ($(cat "$tmp/stands-$r.lock" 2>/dev/null || echo 'holder unknown')); waiting"
			flock -w "$lim" 9 || { echo "install-check: stand $r still held after ${lim}s by ($(cat "$tmp/stands-$r.lock" 2>/dev/null || echo 'holder unknown')); gave up"; exit 2; }
		fi
		echo "install-check pid $$" >"$tmp/stands-$r.lock"
	fi
	printf '%s: ' "$r"
	docker cp install.sh "$c:/tmp/fs-install.sh" >/dev/null

	# The version the FEED serves, read from the router's own package manager after the installer has
	# added the feed — the check below compares against it rather than against a number in this repo,
	# which would go stale the moment a release lands.
	pass=1
	for run in 1 2; do
		if ! docker exec "$c" sh /tmp/fs-install.sh >"$tmp/install-check-$r-$run.log" 2>&1; then
			echo; echo "  run $run exited non-zero:"
			tail -12 "$tmp/install-check-$r-$run.log" | sed 's/^/    /'
			pass=0; break
		fi
		# installed, registered, and the files it registers are actually there
		if ! docker exec "$c" sh -c '
			(apk info -e luci-theme-footstrap 2>/dev/null | grep -q . ) ||
			(opkg list-installed 2>/dev/null | grep -q "^luci-theme-footstrap ")'; then
			echo; echo "  run $run: the package manager does not report the theme as installed"
			pass=0; break
		fi
		if ! docker exec "$c" sh -c \
			'uci get luci.main.mediaurlbase 2>/dev/null | grep -q "footstrap$"'; then
			echo; echo "  run $run: luci.main.mediaurlbase does not point at the theme"
			pass=0; break
		fi
		if ! docker exec "$c" sh -c 'test -s /www/luci-static/footstrap/cascade.css'; then
			echo; echo "  run $run: cascade.css is missing or empty"; pass=0; break
		fi
		# The version must not be older than the feed's: `apk add` over a package in `world` keeps the old
		# version and exits 0. Not equality: CI's router carries the build under test, ahead of the feed
		# (docs/development.md, "The live gates", `install-check`). The `want` filter drops a leading
		# number of 26 or more, the rule install.sh pins with in is_foreign_luci_build(). The comment
		# lives HERE: a `#` line inside the quoted payload below would be shipped to the container.
		if ! docker exec "$c" sh -c '
			if command -v apk >/dev/null 2>&1; then
				have=$(apk list -I 2>/dev/null | sed -n "s/^luci-theme-footstrap-\([^ ]*\) .*/\1/p" | head -1)
				want=$(apk list luci-theme-footstrap 2>/dev/null |
					sed -n "s/^luci-theme-footstrap-\([^ ]*\) .*/\1/p" |
					grep -v "^2[6-9]\." | grep -v "^[3-9][0-9]\." | sort -V | tail -1)
			else
				have=$(opkg list-installed luci-theme-footstrap 2>/dev/null | awk "{print \$3}")
				want=$(opkg list luci-theme-footstrap 2>/dev/null | awk "{print \$3}" | sort -V | tail -1)
			fi
			[ -n "$have" ] || exit 1
			[ -n "$want" ] || exit 0                       # no feed candidate to compare against
			[ "$have" = "$want" ] && exit 0
			# behind only if the FEED sorts newest
			newest=$(printf "%s\n%s\n" "$have" "$want" | sort -V | tail -1)
			[ "$newest" = "$have" ]'; then
			echo; echo "  run $run: the router is left BEHIND the version the feed serves"
			docker exec "$c" sh -c 'apk list -I 2>/dev/null | grep footstrap ||
				opkg list-installed 2>/dev/null | grep footstrap' | sed 's/^/    installed: /'
			pass=0; break
		fi
	done

	if [ "$pass" = 1 ]; then
		echo "fresh install and re-install over it both leave the newest version, working"
		rm -f "$tmp/install-check-$r-"*.log
	else fail=1; fi
done

# put the working tree back, so the next gate does not measure the published release by accident
owlab sync >/dev/null 2>&1 || true

[ "$fail" = 0 ] || { echo "install-check: the installer failed on at least one router."; exit 1; }
echo "install-check: install.sh is good on: $routers"

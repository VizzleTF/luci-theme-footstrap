#!/bin/sh
# Install one package file on a running owlab router, offline, and prove it is installed.
#
#   sh tools/ci-install.sh <router> <package file> [--activate]
#
# Not `owlab install`: when a dependency is missing it refreshes every feed and installs again
# (owlab 0.6.7), which puts a feed outage between a job and its verdict. The package needs only
# luci-base, which every stand has, so this never asks a feed; and each step here names itself.
# --activate also makes footstrap the active theme: the package registers it and leaves the active
# one alone (root/etc/uci-defaults), and the playground records whatever is active.
set -eu

r="${1:?usage: ci-install.sh <router> <file> [--activate]}"
f="${2:?usage: ci-install.sh <router> <file> [--activate]}"
# A glob that matched two files would push --activate out of $3, and the playground would record
# bootstrap without a word.
case "$#:${3:-}" in
	2: | 3:--activate) ;;
	*) echo "usage: ci-install.sh <router> <file> [--activate]" >&2; exit 2 ;;
esac
# On a clock as well: owlab asks Docker for each router's state. A hung one leaves the project name
# empty, and `docker cp` below then fails and says so.
c="owlab-$(timeout -k 10 60 owlab status -json | jq -r .project)-$r"
dst="/tmp/${f##*/}"

# on <seconds> <step> <command…>: each docker call on a clock of its own, so a hung cp or exec is
# named here instead of running out the step's timeout. -k: the docker client may outlive a TERM.
# A call that fails names itself too: after anchor's first exit 3 the job already holds an outage
# title, and a bare exit beside it would read to rerun-infra.yml as more of the same outage.
on() {
	t=$1 step=$2
	shift 2
	start=$(date +%s)
	rc=0
	timeout -k 10 "$t" "$@" || rc=$?
	[ "$rc" -ne 0 ] || return 0
	if [ $(($(date +%s) - start)) -ge "$t" ]; then
		echo "::error::ci-install on $r: $step did not return in $t s"
		exit 1
	fi
	echo "::error::ci-install on $r: $step exited $rc"
	exit "$rc"
}

on 60 'docker cp' docker cp "$f" "$c:$dst"
case "$f" in
	*.apk) on 120 'apk add' docker exec "$c" apk add --no-network --allow-untrusted "$dst" ;;
	*)     on 120 'opkg install' docker exec "$c" opkg install "$dst" ;;
esac
if [ "${3:-}" = --activate ]; then
	on 60 'the theme switch' docker exec "$c" sh -c 'uci set luci.main.mediaurlbase=/luci-static/footstrap && uci commit luci'
fi
on 60 'the LuCI cache flush' docker exec "$c" sh -c 'rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache'
# the reading tools/e2e.mjs's installedVersion() takes
on 60 'the install check' docker exec "$c" sh -c 'if command -v apk >/dev/null; then apk list --installed luci-theme-footstrap 2>/dev/null | grep -q "^luci-theme-footstrap-"; else opkg status luci-theme-footstrap 2>/dev/null | grep -q "^Version: "; fi || { echo "luci-theme-footstrap is not installed"; exit 1; }'
echo "ci-install: ${f##*/} installed on $r"

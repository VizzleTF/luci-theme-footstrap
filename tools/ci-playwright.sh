#!/bin/sh
# The browsers a job drives, without going through apt unless it is actually needed.
#
#   sh tools/ci-playwright.sh [engine…]      (default: chromium)
#
# `npx playwright install --with-deps <engine>` is two installs in one: the browser off Playwright's
# CDN and a list of system libraries off apt. On this repository's runners the apt half is what
# stalls — three steps of one tag sat for 68, 68 and 17 minutes — while the CDN half has never been
# the slow one, and Chromium's libraries are already present on GitHub's ubuntu image.
#
# So: fetch the browsers, then PROVE each launches, which is the claim the job needs and a better one
# than "apt exited 0". Only the engines whose launch fails go to apt, which is where a self-hosted
# or a trimmed image lands.
#
# Both installs run under tools/ci-retry.sh, which puts each attempt on a clock and kills its
# process GROUP: a killed apt otherwise keeps /var/lib/apt/lists/lock and every retry dies on the
# lock rather than on the network.
set -eu

cd "$(dirname "$0")/.."

[ $# -gt 0 ] || set -- chromium

# Chromium's headless shell alone: every launch here is headless and none names a channel, and the
# full browser is 393 MB unpacked.
sh tools/ci-retry.sh 300 npx playwright install --only-shell "$@"

launches() {
	node -e "require('playwright')['$1'].launch().then(b => b.close()).then(() => process.exit(0), e => { console.error(String(e).split('\n')[0]); process.exit(1); })"
}

missing=
for engine in "$@"; do
	if launches "$engine"; then echo "ci-playwright: $engine installed and launches."
	else missing="$missing $engine"
	fi
done
[ -n "$missing" ] || { echo "ci-playwright: apt not needed."; exit 0; }

echo "ci-playwright:$missing will not launch on this image — installing their system libraries" >&2
# WebKit's libraries are 117 MB of .deb, fetched again by every run. $PW_DEB_CACHE (restored by
# actions/cache) seeds apt's archive dir, so apt downloads only what changed since it was saved.
DEBS="${PW_DEB_CACHE:-}"
# An exact cache hit is the set apt resolved on this very runner image: dpkg installs it with no apt
# and no mirror. An older image's set (a restore-keys hit) would downgrade the image's own libraries,
# so that one only seeds apt below.
if [ "${PW_DEB_EXACT:-}" = true ] && ls "$DEBS"/*.deb >/dev/null 2>&1; then
	log="${RUNNER_TEMP:-/tmp}/pw-dpkg.log"
	# shellcheck disable=SC2024 # the log is the runner's, not root's
	if sudo -n env DEBIAN_FRONTEND=noninteractive dpkg -i --force-confold "$DEBS"/*.deb >"$log" 2>&1; then
		still=
		for engine in $missing; do launches "$engine" || still="$still $engine"; done
		[ -n "$still" ] || { echo "ci-playwright:$missing launch from $DEBS, apt not run."; exit 0; }
		echo "ci-playwright:$still still will not launch from $DEBS, asking apt" >&2
	else
		tail -n 5 "$log" >&2
	fi
	sudo -n dpkg --configure -a >/dev/null 2>&1 || true
fi
if [ -n "$DEBS" ] && ls "$DEBS"/*.deb >/dev/null 2>&1; then
	echo "ci-playwright: seeding apt from $DEBS"
	sudo -n cp "$DEBS"/*.deb /var/cache/apt/archives/
fi
# 150 s, not the CDN's 300: a healthy mirror moves the 117 MB in under a minute, and the .debs an
# attempt finished stay in apt's archive for the next one.
# shellcheck disable=SC2086
sh tools/ci-retry.sh 150 sudo -n npx playwright install-deps $missing
if [ -n "$DEBS" ]; then
	# Only the versions now installed: a restore-keys seed must not pile up superseded ones, and an
	# exact hit must be exactly the set dpkg installs above.
	mkdir -p "$DEBS"
	rm -f "$DEBS"/*.deb
	for f in /var/cache/apt/archives/*.deb; do
		[ -f "$f" ] || continue
		p=$(dpkg-deb -f "$f" Package)
		if [ "$(dpkg-query -W -f='${Version}' "$p" 2>/dev/null)" = "$(dpkg-deb -f "$f" Version)" ]; then cp "$f" "$DEBS"/; fi
	done
fi

for engine in $missing; do
	launches "$engine" || { echo "ci-playwright: $engine still will not launch after installing its libraries" >&2; exit 1; }
	echo "ci-playwright: $engine launches after the library install."
done

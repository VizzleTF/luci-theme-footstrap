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

sh tools/ci-retry.sh 300 npx playwright install "$@"

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
# shellcheck disable=SC2086
sh tools/ci-retry.sh 300 sudo -n npx playwright install-deps $missing

for engine in $missing; do
	launches "$engine" || { echo "ci-playwright: $engine still will not launch after installing its libraries" >&2; exit 1; }
	echo "ci-playwright: $engine launches after the library install."
done

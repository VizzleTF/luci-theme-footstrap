#!/bin/sh
# The browser the gates drive, without going through apt unless it is actually needed.
#
#   sh tools/ci-playwright.sh
#
# `npx playwright install --with-deps chromium` is two installs in one: the browser off Playwright's
# CDN and a list of system libraries off apt. On this repository's runners the apt half is what
# stalls — three steps of one tag sat for 68, 68 and 17 minutes — while the CDN half has never been
# the slow one, and the libraries are already present on GitHub's ubuntu image.
#
# So: fetch the browser, then PROVE it launches, which is the claim the gates need and a better one
# than "apt exited 0". Only if the launch fails do we go to apt, which is where a self-hosted or
# trimmed image would land.
#
# Both installs run under tools/ci-retry.sh, which puts each attempt on a clock and kills its
# process GROUP: a killed apt otherwise keeps /var/lib/apt/lists/lock and every retry dies on the
# lock rather than on the network.
set -eu

cd "$(dirname "$0")/.."

# One engine by name: the gates that need firefox or webkit run in the `anchors` job, which
# installs them itself. Installing them here would triple both halves of this.
sh tools/ci-retry.sh 300 npx playwright install chromium

launches() {
	node -e "require('playwright').chromium.launch().then(b => b.close()).then(() => process.exit(0), e => { console.error(String(e).split('\n')[0]); process.exit(1); })"
}

if launches; then
	echo "ci-playwright: chromium installed and launches; apt not needed."
	exit 0
fi

echo "ci-playwright: chromium will not launch on this image — installing its system libraries" >&2
sh tools/ci-retry.sh 300 sudo -n npx playwright install-deps chromium

launches || { echo "ci-playwright: chromium still will not launch after installing its libraries" >&2; exit 1; }
echo "ci-playwright: chromium launches after the library install."

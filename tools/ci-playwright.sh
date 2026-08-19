#!/bin/sh
# THE BROWSER THE GATES DRIVE, WITHOUT GOING THROUGH APT UNLESS IT IS ACTUALLY NEEDED.
#
#   sh tools/ci-playwright.sh
#
# `npx playwright install --with-deps chromium` is two installs in one: the browser off Playwright's
# CDN, and a list of system libraries off apt. On this repository's runners the apt half is what
# stalls — three steps of the 0.13.2 tag sat for 68, 68 and 17 minutes, and a later run spent its
# whole 20-minute budget retrying it — while the CDN half has never been the slow one. The libraries
# it installs are, on GitHub's ubuntu image, already there.
#
# So: fetch the browser, then PROVE it launches. That is the claim the gates actually need, and it
# is a better one than "apt exited 0" — a browser that installs and cannot start is the same red
# job one step later. Only if the launch fails do we go to apt for the libraries, which is where a
# self-hosted or a trimmed image would land.
#
# Both installs run under tools/ci-retry.sh, which puts each attempt on a clock and kills its
# process GROUP, because a killed apt otherwise keeps /var/lib/apt/lists/lock and every retry after
# it dies on the lock rather than on the network.
set -eu

cd "$(dirname "$0")/.."

# One engine by name: the gates that need firefox or webkit are local (docs/development.md), and
# installing them here would triple both halves of this.
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

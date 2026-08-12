#!/bin/sh
# luci-theme-footstrap installer for OpenWrt 24.10 (opkg) and 25.12+ (apk).
#
#   wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
#
# It adds the owfeed-packages feed and installs the theme from it, so `apk upgrade` /
# `opkg upgrade` carries the theme forward afterwards. The feed index is verified by the
# package manager against the key pinned below.
#
# Running it again upgrades the theme to the newest version in the feed. Licensed Apache-2.0.

set -e

FEED_HOST="https://repo.owfeed.org"
FEED_NAME="owfeed-packages"
FEED_KEY_OPKG="9040356b214084da"
PKG="luci-theme-footstrap"

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }

# Certificates are always verified: this runs as root from `wget | sh`, and a failed
# verification is the MITM case, not a reason to retry insecurely.
fetch() {	# <url> <outfile>
	if command -v uclient-fetch >/dev/null 2>&1; then uclient-fetch -T 30 -qO "$2" "$1"
	elif command -v curl >/dev/null 2>&1; then curl -fsSL --proto =https --max-time 30 -o "$2" "$1"
	else wget -q -T 30 -O "$2" "$1"; fi
}

printf '\n=== luci-theme-footstrap installer ===\n\n'

# --- compatibility --------------------------------------------------------
[ -f /etc/openwrt_release ] || { err "Not an OpenWrt system."; exit 1; }
. /etc/openwrt_release
ok "Detected: ${DISTRIB_DESCRIPTION:-OpenWrt}"

if command -v apk >/dev/null 2>&1; then PM=apk; INDEX=packages.adb
elif command -v opkg >/dev/null 2>&1; then PM=opkg; INDEX=Packages.gz
else err "Neither apk nor opkg found."; exit 1; fi
ok "Package manager: $PM"

# Read before the branch rather than beside the feed entry, because a router that names
# no branch picks one by asking the feed which branch carries this architecture.
if [ "$PM" = apk ]; then
	ARCH=$(cat /etc/apk/arch) || { err "Cannot read /etc/apk/arch."; exit 1; }
else
	ARCH="${DISTRIB_ARCH:-}"
	[ -n "$ARCH" ] || { err "DISTRIB_ARCH is empty in /etc/openwrt_release."; exit 1; }
fi

# --- version --------------------------------------------------------------
# The feed publishes per OpenWrt minor, so the branch comes from the router. SNAPSHOT
# and anything unparseable name none, and are served the newest branch of their own
# package format instead — see FALLBACK_BRANCHES_* below for why that is sound here.
FALLBACK_BRANCHES_APK="25.12"
FALLBACK_BRANCHES_OPKG="24.10"

# The feed has no snapshot channel, and not by omission: the two lines owfeed-packages
# serves ARE the package-format split (apk from 25.12, ipk on 24.10), not a build of the
# theme per release. A snapshot has no branch of its own to install from, so it gets the
# newest one its package manager can read.
#
# What makes that sound for THIS package and not in general: it is noarch and
# `+luci-base` is its whole dependency list, so nothing in it was compiled against the
# branch it is fetched from. A package carrying a binary, or a versioned dependency,
# must not take this path.
#
# Newest first, and each candidate is probed rather than assumed: a branch listed here
# before it is published — or one that does not carry this router's architecture — falls
# through to the next instead of writing a repository entry that 404s on every update.
# The probe's bytes are discarded on purpose. Existence is all it asks, and the index it
# found is still verified by the package manager against the key pinned above, so a host
# that lies here buys a feed entry that then fails to verify rather than an install.
newest_feed_branch() {	# <candidates> -> the first branch that answers
	for _branch in $1; do
		if fetch "$FEED_HOST/releases/$_branch/$ARCH/$INDEX" /dev/null 2>/dev/null; then
			printf '%s' "$_branch"
			return 0
		fi
	done
	return 1
}

BRANCH=$(printf '%s' "${DISTRIB_RELEASE:-}" | cut -d. -f1,2)
case "$BRANCH" in
[0-9][0-9].[0-9][0-9])
	MAJ=${BRANCH%%.*}; MIN=${BRANCH##*.}
	if [ "$MAJ" -lt 24 ] || { [ "$MAJ" -eq 24 ] && [ "$MIN" -lt 10 ]; }; then
		err "footstrap requires OpenWrt 24.10 or newer (detected $DISTRIB_RELEASE)."
		exit 1
	fi
	# PROBED, exactly like the fallback path below, and for the reason that path states: a router
	# on a branch the feed does not publish yet — every 26.x router on the day it ships — otherwise
	# had a 404 URL written into its repository list, and then `apk update` failed under `set -e`
	# BEFORE the theme was ever installed. A re-run did not rescue it either: the dead line contains
	# $FEED_HOST, so the next run took the "already configured" path and died at the same place,
	# leaving every later `apk update` on that router failing too. Fall back to the newest branch the
	# feed does answer for — sound here for the same reason the fallback path is: noarch package,
	# +luci-base its whole dependency list, nothing compiled against the branch it comes from.
	if ! fetch "$FEED_HOST/releases/$BRANCH/$ARCH/$INDEX" /dev/null 2>/dev/null; then
		info "The feed does not carry $BRANCH for $ARCH yet; asking it for the newest branch..."
		if [ "$PM" = apk ]; then CANDIDATES="$FALLBACK_BRANCHES_APK"; else CANDIDATES="$FALLBACK_BRANCHES_OPKG"; fi
		BRANCH=$(newest_feed_branch "$CANDIDATES") || {
			err "The feed carries no $PM branch for $ARCH (router reports '${DISTRIB_RELEASE:-unknown}')."
			err "Install the release asset by hand instead:"
			err "  https://github.com/VizzleTF/luci-theme-footstrap/releases/latest"
			exit 1
		}
		ok "Using the $BRANCH branch — the theme is noarch and needs only luci-base."
	fi
	;;
*)
	info "'${DISTRIB_RELEASE:-unknown}' names no feed branch; asking the feed for the newest one..."
	if [ "$PM" = apk ]; then CANDIDATES="$FALLBACK_BRANCHES_APK"; else CANDIDATES="$FALLBACK_BRANCHES_OPKG"; fi
	BRANCH=$(newest_feed_branch "$CANDIDATES") || {
		err "The feed carries no $PM branch for $ARCH (router reports '${DISTRIB_RELEASE:-unknown}')."
		err "Install the release asset by hand instead:"
		err "  https://github.com/VizzleTF/luci-theme-footstrap/releases/latest"
		exit 1
	}
	ok "No branch of its own, so the $BRANCH branch it is — the theme is noarch and needs only luci-base."
	;;
esac

# --- feed -----------------------------------------------------------------
# keep.d is not bookkeeping: sysupgrade wipes the key unless something claims it, and
# the theme would come back unupgradable. The repository line itself needs no entry —
# both managers' customfeeds files are conffiles of the manager (`apk-mbedtls` and
# `opkg`), and sysupgrade backs up every conffile whose checksum has moved. It listed
# them anyway until this was measured, and `build_list_of_backup_overlay_files` was
# already dropping the duplicate.
if [ "$PM" = apk ]; then
	# customfeeds.list rather than a file of our own under repositories.d/. apk reads
	# every *.list in that directory, so both work for installing — but LuCI's package
	# manager reads exactly three paths (`repositories`, `distfeeds.list`,
	# `customfeeds.list`, in its rpcd ACL and hardcoded in its view), so a feed in any
	# other file is invisible in "Configure APK" and cannot be edited or removed there.
	# It is also the file OpenWrt ships for this ("add your custom package feeds here")
	# and the apk counterpart of the opkg branch's customfeeds.conf below.
	APK_LIST=/etc/apk/repositories.d/customfeeds.list
	if ! grep -q "$FEED_HOST" "$APK_LIST" 2>/dev/null; then
		info "Adding the $FEED_NAME feed..."
		apk add --quiet ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
		mkdir -p /etc/apk/keys /etc/apk/repositories.d /lib/upgrade/keep.d
		printf '%s/releases/%s/%s/packages.adb\n' "$FEED_HOST" "$BRANCH" "$ARCH" \
			>> "$APK_LIST"
		printf '%s\n' /etc/apk/keys/owfeed-packages.pem > /lib/upgrade/keep.d/owfeed-packages
		# Installers before this one wrote their own file, which apk still reads: left
		# in place it is the same repository configured twice, in one file the admin
		# can see and one they cannot. Removed by name and only after the line above
		# landed, so the feed is never briefly absent.
		rm -f /etc/apk/repositories.d/owfeed-packages.list
		ok "Feed added: $FEED_HOST/releases/$BRANCH/$ARCH"
	else
		info "The $FEED_NAME feed is already configured."
	fi
	# The KEY is fetched on every run, not only when the feed line is written. It used to sit inside
	# the branch above, which meant a rotation could never be repaired by the documented one-liner:
	# the feed was "already configured", the key was never re-fetched, and `apk update` failed
	# verification from then on with the header promising that re-running upgrades the theme. It is
	# one small file, the fetch is verified TLS, and writing it again is idempotent.
	mkdir -p /etc/apk/keys /lib/upgrade/keep.d
	fetch "$FEED_HOST/owfeed-packages.pem" /etc/apk/keys/owfeed-packages.pem
	printf '%s\n' /etc/apk/keys/owfeed-packages.pem > /lib/upgrade/keep.d/owfeed-packages
	apk update
	# `apk add` resolves to the newest version in the feed, so a second run upgrades.
	apk add "$PKG"
else
	if ! grep -q "$FEED_NAME" /etc/opkg/customfeeds.conf 2>/dev/null; then
		info "Adding the $FEED_NAME feed..."
		opkg update >/dev/null 2>&1 || true
		opkg install ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
		mkdir -p /etc/opkg/keys /lib/upgrade/keep.d
		printf 'src/gz %s %s/releases/%s/%s\n' "$FEED_NAME" "$FEED_HOST" "$BRANCH" "$ARCH" \
			>> /etc/opkg/customfeeds.conf
		ok "Feed added: $FEED_HOST/releases/$BRANCH/$ARCH"
	else
		info "The $FEED_NAME feed is already configured."
	fi
	# Same as the apk leg: the key on every run, so a rotation is repairable by re-running. Here the
	# key ID is part of the PATH, so a rotation changes the filename too — the old one is left alone
	# rather than removed, since opkg reads the whole directory and a stale key verifies nothing.
	mkdir -p /etc/opkg/keys /lib/upgrade/keep.d
	fetch "$FEED_HOST/$FEED_KEY_OPKG" "/etc/opkg/keys/$FEED_KEY_OPKG"
	printf '%s\n' "/etc/opkg/keys/$FEED_KEY_OPKG" > /lib/upgrade/keep.d/owfeed-packages
	opkg update
	# `opkg install` on an installed package is a no-op even when the feed has a newer
	# version — it reports "already installed" and exits 0 — so a second run has to ask
	# for the upgrade explicitly. Up to date is not an error for `opkg upgrade`.
	if opkg list-installed | grep -q "^$PKG "; then
		opkg upgrade "$PKG"
	else
		opkg install "$PKG"
	fi
fi

# Both caches, as postinst does: a stale /tmp/luci-modulecache bites exactly here, on a
# package that replaces the theme's JS. reload, never restart — restart logs out every
# LuCI session.
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf /tmp/luci-modulecache 2>/dev/null || true
if [ -x /etc/init.d/rpcd ]; then /etc/init.d/rpcd reload >/dev/null 2>&1 || true; fi

printf '\n'
ok "Installed from the $FEED_NAME feed — \`$PM upgrade\` will keep it current."
info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
info "Layout, dark mode, palette, colours and the wallpaper live in the \"Footstrap\" tab"
info "of System -> System. Then hard-reload the page (Ctrl+F5)."

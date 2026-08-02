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

if command -v apk >/dev/null 2>&1; then PM=apk
elif command -v opkg >/dev/null 2>&1; then PM=opkg
else err "Neither apk nor opkg found."; exit 1; fi
ok "Package manager: $PM"

# --- version --------------------------------------------------------------
# The feed publishes per OpenWrt minor, so the branch comes from the router.
# SNAPSHOT and anything unparseable have no branch to install from.
BRANCH=$(printf '%s' "${DISTRIB_RELEASE:-}" | cut -d. -f1,2)
case "$BRANCH" in
	[0-9][0-9].[0-9][0-9]) ;;
	*) err "footstrap needs a release build of OpenWrt 24.10 or newer (got '${DISTRIB_RELEASE:-unknown}')."; exit 1 ;;
esac
MAJ=${BRANCH%%.*}; MIN=${BRANCH##*.}
if [ "$MAJ" -lt 24 ] || { [ "$MAJ" -eq 24 ] && [ "$MIN" -lt 10 ]; }; then
	err "footstrap requires OpenWrt 24.10 or newer (detected $DISTRIB_RELEASE)."
	exit 1
fi

# --- feed -----------------------------------------------------------------
# keep.d is not bookkeeping: sysupgrade wipes the keys and the repository list unless
# something claims them, and the theme would come back unupgradable.
if [ "$PM" = apk ]; then
	ARCH=$(cat /etc/apk/arch) || { err "Cannot read /etc/apk/arch."; exit 1; }
	if [ ! -f /etc/apk/keys/owfeed-packages.pem ]; then
		info "Adding the $FEED_NAME feed..."
		apk add --quiet ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
		mkdir -p /etc/apk/keys /etc/apk/repositories.d /lib/upgrade/keep.d
		fetch "$FEED_HOST/owfeed-packages.pem" /etc/apk/keys/owfeed-packages.pem
		printf '%s/releases/%s/%s/packages.adb\n' "$FEED_HOST" "$BRANCH" "$ARCH" \
			> /etc/apk/repositories.d/owfeed-packages.list
		printf '%s\n' /etc/apk/keys/owfeed-packages.pem \
			/etc/apk/repositories.d/owfeed-packages.list > /lib/upgrade/keep.d/owfeed-packages
		ok "Feed added: $FEED_HOST/releases/$BRANCH/$ARCH"
	else
		info "The $FEED_NAME feed is already configured."
	fi
	apk update
	# `apk add` resolves to the newest version in the feed, so a second run upgrades.
	apk add "$PKG"
else
	ARCH="$DISTRIB_ARCH"
	if ! grep -q "$FEED_NAME" /etc/opkg/customfeeds.conf 2>/dev/null; then
		info "Adding the $FEED_NAME feed..."
		opkg update >/dev/null 2>&1 || true
		opkg install ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
		mkdir -p /etc/opkg/keys /lib/upgrade/keep.d
		fetch "$FEED_HOST/$FEED_KEY_OPKG" "/etc/opkg/keys/$FEED_KEY_OPKG"
		printf 'src/gz %s %s/releases/%s/%s\n' "$FEED_NAME" "$FEED_HOST" "$BRANCH" "$ARCH" \
			>> /etc/opkg/customfeeds.conf
		printf '%s\n' "/etc/opkg/keys/$FEED_KEY_OPKG" /etc/opkg/customfeeds.conf \
			> /lib/upgrade/keep.d/owfeed-packages
		ok "Feed added: $FEED_HOST/releases/$BRANCH/$ARCH"
	else
		info "The $FEED_NAME feed is already configured."
	fi
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

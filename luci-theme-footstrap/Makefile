#
# Copyright (C) 2026
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-footstrap

# Version is git-derived locally; CI injects FOOTSTRAP_VERSION from the tag
# (the SDK build has no .git so it can't derive one).
FOOTSTRAP_VERSION?=
ifneq ($(FOOTSTRAP_VERSION),)
PKG_VERSION:=$(FOOTSTRAP_VERSION)
PKG_RELEASE:=1
endif

LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

# Ship CSS/JS verbatim — the LuCI minifier mangles modern CSS (:has(),
# color-mix(), nested calc()) and ES syntax, which breaks the layout.
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0

PKG_LICENSE:=Apache-2.0

define Package/luci-theme-footstrap/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# uci-defaults registers the theme entries; refresh rpcd + clear caches so
	# LuCI picks them up without a reboot.
	[ -f /etc/uci-defaults/30_luci-theme-footstrap ] && \
		sh /etc/uci-defaults/30_luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-theme-footstrap/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	for t in FootstrapSidebar FootstrapOnTop Footstrap FootstrapDark \
	         FootstrapLight FootstrapTop FootstrapTopDark FootstrapTopLight; do
		uci -q delete "luci.themes.$$t"
	done
	uci commit luci
	rm -f /tmp/luci-indexcache* >/dev/null 2>&1 || true
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
}
endef

# Stamp the git-derived version into the theme JS so the Appearance popover can
# show it and run its GitHub update check. luci.mk calls this hook right after
# copying htdocs into PKG_BUILD_DIR, so we rewrite the build copy — never the
# source tree. Skipped when PKG_VERSION is empty (leaves the '0.0.0-dev' literal).
define Build/Prepare/luci-theme-footstrap
	$(if $(PKG_VERSION),$(SED) "s#const FS_VERSION = '[^']*'#const FS_VERSION = '$(PKG_VERSION)'#" \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/menu-footstrap-common.js)
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

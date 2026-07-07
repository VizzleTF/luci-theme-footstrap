#
# Copyright (C) 2026
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base

PKG_LICENSE:=Apache-2.0

define Package/luci-theme-footstrap/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.Footstrap
	uci -q delete luci.themes.FootstrapDark
	uci -q delete luci.themes.FootstrapLight
	uci -q delete luci.themes.FootstrapTop
	uci -q delete luci.themes.FootstrapTopDark
	uci -q delete luci.themes.FootstrapTopLight
	uci commit luci
}
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature

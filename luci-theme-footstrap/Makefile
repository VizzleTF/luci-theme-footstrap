#
# Copyright (C) 2026
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-footstrap
# luci.mk keys the Build/Prepare hook name on LUCI_NAME, which defaults to the checkout's
# directory name — a differently-named checkout symlinked into the feed would silently skip
# the CSS build. Pin it.
LUCI_NAME:=luci-theme-footstrap

# Version is git-derived; never hardcode PKG_VERSION. luci.mk falls back to PKG_SRC_VERSION,
# which it always defines, when nothing here sets it — see docs/package.md for why no override
# lives here.
LUCI_TITLE:=Footstrap Theme
# +luci-base is the WHOLE list. Nothing shipped fetches at run time; `curl` is not in OpenWrt's
# default set (8 MB devices), so fall back to uclient-fetch, jsonfilter, sha256sum or do without.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
# Else luci.mk claims MAINTAINER "OpenWrt LuCI community" and URL openwrt/luci.
LUCI_MAINTAINER:=Ivan Kvashonkin <vizzlef@gmail.com>
LUCI_URL:=https://github.com/VizzleTF/luci-theme-footstrap

# CSS ships verbatim: luci.mk's csstidy mangles :has(), color-mix() and nested calc(). build-css.sh
# minifies.
LUCI_MINIFY_CSS:=0
#
# JS: the released package is built by owfeed (tools/stage.sh), not by this Makefile through the
# SDK, so LUCI_MINIFY_JS keeps luci.mk's jsmin. jsmin's one-character lookback does not know `n` or
# `>`, so `return /re/` makes it eat the rest of the file AND EXIT 0 (openwrt/luci#8299); eslint's
# `wrap-regex` bans the shape and tools/jsmin-verify.mjs proves the output token-identical.

# Apache-2.0, not a free choice: styles/base began as a fork of luci-theme-bootstrap's cascade.css,
# the ucode templates derive from LuCI's and a few JS helpers are verbatim copies; the notices
# travel with it. No OFL-1.1: the theme ships no Font Software.
PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE

# /etc/config/footstrap is SHIPPED as an empty stub and WRITTEN AT RUNTIME: Appearance ->
# "Save as default" has rpcd uci-set the router-wide axes into that very file. Without this define
# the package manager owns it as an ordinary file and REPLACES it on upgrade, so the admin's saved
# defaults are wiped by the theme's own one-click Update, silently and reported as success.
# OpenWrt honours the define for BOTH formats (include/package-pack.mk), so one covers 24.10's opkg
# and 25.12's apk alike. Any future root/etc/config/* must be listed here too.
define Package/luci-theme-footstrap/conffiles
/etc/config/footstrap
endef

# No `rpcd reload`: it re-execs rpcd, which drops a plugin that is absent mid-write until the next
# reload, and this package registers no rpcd object (rpcd re-reads acl.d at every login). The postinst
# ends a session only when a fresh login would grant it more. Comments inside a define ship into the
# router's script store (1984 of 3239 B), so the bodies are code only (`set -f`: the unquoted
# `$$(uci -q get …)` lists must split, not glob a `*`). docs/package.md, "Why postinst/postrm never
# call `rpcd reload`".
define Package/luci-theme-footstrap/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	set -f
	ubus list 2>/dev/null | grep -qx session && {
		for s in $$(ubus call session list 2>/dev/null | grep -o '"ubus_rpc_session": "[a-f0-9]*"' | cut -d'"' -f4); do
			case "$$s" in *[!0]*) ;; *) continue ;; esac
			ubus call session access "{\"ubus_rpc_session\":\"$$s\",\"scope\":\"uci\",\"object\":\"footstrap\",\"function\":\"write\"}" 2>/dev/null | grep -q true && continue
			u=$$(ubus call session get "{\"ubus_rpc_session\":\"$$s\"}" 2>/dev/null | grep -o '"username": *"[^"]*"' | cut -d'"' -f4)
			[ -n "$$u" ] || continue
			perm=$$(uci show rpcd 2>/dev/null | grep -F .username= | while read -r kv; do
				sect=$${kv%%.username=*}
				un=$${kv#*.username=}
				un=$${un#\'}
				un=$${un%\'}
				[ "$$un" = "$$u" ] || continue
				for grp in $$(uci -q get "$$sect.write"); do
					[ "$$grp" = luci-theme-footstrap ] && { echo write; break 2; }
				done
				for grp in $$(uci -q get "$$sect.read"); do
					[ "$$grp" = luci-theme-footstrap ] && { echo read; break 2; }
				done
			done)
			[ -n "$$perm" ] || continue
			[ "$$perm" = read ] && ubus call session access "{\"ubus_rpc_session\":\"$$s\",\"scope\":\"uci\",\"object\":\"footstrap\",\"function\":\"read\"}" 2>/dev/null | grep -q true && continue
			ubus call session destroy "{\"ubus_rpc_session\":\"$$s\"}" >/dev/null 2>&1 || true
		done
	}
}
exit 0
endef

# opkg runs the OLD package's postrm with "upgrade" on a version upgrade; it must change nothing
# there, since reverting mediaurlbase flipped upgrading 24.10 users back to bootstrap (apk never
# runs it on upgrade). Removal restores bootstrap only if its media dir and header.ut exist, drops
# /etc/footstrap (the uploaded login background) and, as in the postinst, no rpcd reload.
define Package/luci-theme-footstrap/postrm
#!/bin/sh
case "$$1" in *upgrade*) exit 0 ;; esac
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.Footstrap
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/footstrap*)
			[ -d /www/luci-static/bootstrap ] && \
			[ -f /usr/share/ucode/luci/template/themes/bootstrap/header.ut ] && \
				uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	rm -rf /etc/footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
}
endef

# Runs right after luci.mk copies the sources into PKG_BUILD_DIR, so it rewrites the build copy
# only. cascade.css is generated, not committed, and styles/ is not in luci.mk's copy list:
# build-css.sh reads it from $(CURDIR) (cat and awk only, so it runs on a buildbot). The git-derived
# version is stamped into fs-version.js unconditionally; only an un-built checkout keeps
# '0.0.0-dev'. The catalogue is luci.mk's business: `po/` is what LUCI_LANGUAGES globs.
define Build/Prepare/luci-theme-footstrap
	# PKG_LICENSE_FILES resolves against $(PKG_BUILD_DIR), which luci.mk fills with only src/ luasrc/
	# htdocs/ root/ ucode/; the copy is metadata only, luci.mk never installs it.
	$(CP) $(CURDIR)/LICENSE $(PKG_BUILD_DIR)/
	$(SHELL) $(CURDIR)/build-css.sh $(PKG_BUILD_DIR)/htdocs/luci-static/footstrap/cascade.css
	# Private `--fs-*` names are 13% of the sheet; runs BEFORE the templates and probes strips, which
	# take the comments it reads.
	$(SHELL) $(CURDIR)/mangle-tokens.sh \
		$(PKG_BUILD_DIR)/htdocs/luci-static/footstrap/cascade.css \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources $(PKG_BUILD_DIR)/ucode
	# Strips `{# … #}`, whole-line `/* … */` and the indentation from the templates (-27.2 KB of 47.2).
	# dev-sync.sh does not run this, so a router being debugged keeps its comments and indentation.
	$(SHELL) $(CURDIR)/strip-build.sh templates $(PKG_BUILD_DIR)/ucode
	# The gate-only `/* fs:probe */` exports: the functions stay, the export line goes.
	$(SHELL) $(CURDIR)/strip-build.sh probes $(PKG_BUILD_DIR)/htdocs/luci-static/resources
	# The same for the shell under root/ (about half of uci-defaults and the CGI are comments);
	# whole-line `#` only.
	$(SHELL) $(CURDIR)/strip-build.sh shell $(PKG_BUILD_DIR)/root
	# The SVG favicon's comment and the manifest's indentation; awk only, so no node on a buildbot.
	$(SHELL) $(CURDIR)/strip-build.sh assets $(PKG_BUILD_DIR)/htdocs/luci-static/footstrap
	$(SED) "s#const FS_VERSION *= *'[^']*'#const FS_VERSION = '$(if $(PKG_VERSION),$(PKG_VERSION),$(PKG_SRC_VERSION))'#" \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/fs-version.js
endef

# Absolute, not a relative path: the usual ../../luci.mk resolves only inside the luci feed.
include $(TOPDIR)/feeds/luci/luci.mk

# Load-bearing, not boilerplate: include/scan.mk finds packages by GREPPING Makefiles for
# `call (Build/DefaultTargets|BuildPackage|KernelPackage)`. luci.mk calls BuildPackage, which the
# grep cannot see, so without the literal line below the package gets no CONFIG_PACKAGE_* symbol and
# `make package/<name>/compile` fails with "No rule to make target". tools/scan-marker.sh re-derives
# the grep and fails the build if it goes missing.
# call BuildPackage - OpenWrt buildroot signature

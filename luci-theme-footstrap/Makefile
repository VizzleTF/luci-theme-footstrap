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

# Version is git-derived; never hardcode PKG_VERSION. CI injects FOOTSTRAP_VERSION from the
# tag (an SDK build has no .git, so it cannot derive one).
FOOTSTRAP_VERSION?=
ifneq ($(FOOTSTRAP_VERSION),)
PKG_VERSION:=$(FOOTSTRAP_VERSION)
PKG_RELEASE:=1
endif

LUCI_TITLE:=Footstrap Theme
# +luci-base is the WHOLE list, and keeping it that way is the constraint. Nothing this package
# ships fetches anything at run time any more (the self-updater is retired), so there is no second
# name to justify — and the rule that got it here stands: the one convenience tool that ever wanted
# a dep was `curl`, which is NOT in OpenWrt's default set, on an 8 MB device, for one API call. Fall
# back to what the base image has (uclient-fetch, jsonfilter, sha256sum) or do without.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
# Else luci.mk defaults these to LuCI's own, and the package claims MAINTAINER "OpenWrt LuCI
# community" / URL openwrt/luci.
LUCI_MAINTAINER:=VizzleTF <vizzletf47@gmail.com>
LUCI_URL:=https://github.com/VizzleTF/luci-theme-footstrap

# CSS: ship verbatim. luci.mk would run csstidy over it, which is old enough to mangle
# :has()/color-mix()/nested calc() and break the layout. build-css.sh minifies instead.
LUCI_MINIFY_CSS:=0
#
# JS: TWO minify paths, chosen by who is building.
#
# CI (the released packages) pre-minifies with terser BEFORE the SDK build (tools/minify-js.mjs:
# mangles top-level identifiers too, which jsmin cannot — ~41 KB against jsmin's ~57 KB, −27%)
# and signals it with FOOTSTRAP_PREMIN=1. jsmin must then stay AWAY from the already-minified
# output: terser legitimately emits `return/^v/.test(s)`, the exact one-character-lookback trap
# below, so LUCI_MINIFY_JS goes to 0 for that build.
#
# Everyone else (an SDK user, the buildbot — no node) builds the untouched source and KEEPS
# luci.mk's default jsmin (LUCI_MINIFY_JS=1): ~105 KB of this tree's JS is comments, and uhttpd
# serves /www with NO compression, so those are wire AND flash bytes either way.
#
# The catch on the jsmin path, and why the gates exist: jsmin decides `/` = regex-or-division
# from a ONE-character lookback, and `n` (of `return`) and `>` (of `=>`) are not on its
# allow-list — so `return /re/` makes it eat the rest of the file AND EXIT 0
# (openwrt/luci#8299). eslint's `wrap-regex` bans the shape in the SOURCE; tools/jsmin-verify.mjs
# proves jsmin's output is TOKEN-IDENTICAL to it. Both keep guarding the non-CI path.
FOOTSTRAP_PREMIN?=
ifneq ($(FOOTSTRAP_PREMIN),)
LUCI_MINIFY_JS:=0
endif

# Apache-2.0, and not a free choice: styles/base began as a fork of luci-theme-bootstrap's
# cascade.css, the ucode templates derive from LuCI's own, and a few JS helpers are verbatim
# copies. The notices travel with it.
#
# THE OFL-1.1 HALF IS GONE WITH THE WEBFONTS. The theme carried subsetted Manrope and JetBrains
# Mono and had to ship the OFL text beside them (§2 requires the notice and licence with every
# copy of the Font Software). It ships no Font Software now, so declaring OFL would be a false
# statement about the package's contents.
PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE

# /etc/config/footstrap is SHIPPED as an empty stub and WRITTEN AT RUNTIME: Appearance -> "Save as
# default" has rpcd uci-set the router-wide axes into that very file (fs-prefs.js saveAsDefault()).
# Without this define the package manager owns it as an ordinary file and REPLACES it on upgrade —
# so the admin's saved defaults were wiped by the theme's own one-click Update, silently, reported
# as success. Measured on the dev router: eight options in the live file, package-owned, no
# .conffiles entry beside base-files'/dnsmasq's. OpenWrt honours this for BOTH formats
# (include/package-pack.mk: KEEP_$(1) -> apk .conffiles, ipk CONTROL/conffiles), so one define
# covers 24.10's opkg and 25.12's apk alike. Any future root/etc/config/* must be listed here too.
define Package/luci-theme-footstrap/conffiles
/etc/config/footstrap
endef

# RELOAD, NOT RESTART: rpcd holds sessions in memory, so `restart` logs out every LuCI user —
# including the admin who just clicked Update. `reload` sends SIGHUP, which re-reads
# /usr/share/rpcd/acl.d/*, and that ACL refresh is the only thing this package needs from rpcd.
# Verified on a live router: a session survives `reload` and dies across `restart`; deleting our
# acl.d file + `reload` flips `session access` for the self-update script from true to false.
define Package/luci-theme-footstrap/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# uci-defaults registers the theme; refresh rpcd + drop caches so LuCI sees it without a
	# reboot. Calling it ourselves is belt-and-braces: OpenWrt's default_postinst also runs
	# (then deletes) every /etc/uci-defaults/* we ship, so it executes twice per install. It is
	# idempotent, and its fresh-vs-upgrade marker is written at the end of the first pass, so
	# that pass still sees a fresh install.
	[ -f /etc/uci-defaults/30_luci-theme-footstrap ] && \
		sh /etc/uci-defaults/30_luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-theme-footstrap/postrm
#!/bin/sh
# opkg runs the OLD package's postrm with arg "upgrade" during a version upgrade (proven on 24.10:
# `prerm upgrade`, then `postrm upgrade`, then the new `postinst configure`) and "remove" on a real
# removal. On upgrade this script MUST change nothing: reverting mediaurlbase to bootstrap, wiping
# the theme registration and deleting the .installed marker here is what flipped every updating
# 24.10 user back to bootstrap — and it defeated uci-defaults' own upgrade guard, because with the
# marker gone uci-defaults treated the run as "fresh", yet postrm had already set mediaurlbase to
# bootstrap, which no "fresh" branch re-activates. apk never runs this on upgrade (it uses the new
# package's pre/post-upgrade), so guarding on the arg is correct for both managers; real removal
# passes "remove" (opkg) or no arg and proceeds below.
case "$$1" in *upgrade*) exit 0 ;; esac
[ -n "$${IPKG_INSTROOT}" ] || {
	# Every theme name this package has ever registered. postrm runs when uci-defaults is
	# already deleted, so it cannot source the list: it is duplicated by necessity and
	# mirror-pinned so it cannot drift. Only the assignment is byte-identical — the `$$` is
	# make's escaping.
# @mirror theme/legacy-names
LEGACY_THEMES="Footstrap FootstrapDark FootstrapLight FootstrapTop FootstrapTopDark FootstrapTopLight FootstrapSidebar FootstrapOnTop"
# @endmirror
	for t in $$LEGACY_THEMES; do
		uci -q delete "luci.themes.$$t"
	done
	# The router's DEFAULT layout, set by uci-defaults when migrating an old top-nav install.
	# It means nothing to any other theme, and left behind it would silently re-apply the top
	# bar on a later reinstall.
	uci -q delete luci.main.footstrap_layout
	# Don't leave the active theme pointing at the media dir we just removed. The same TWO-part
	# check uci-defaults uses: a theme needs its media dir AND its ucode template to render, so
	# a one-part check could hand the UI to a half-removed bootstrap — the blank page this
	# branch exists to avoid.
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/footstrap*)
			[ -d /www/luci-static/bootstrap ] && \
			[ -f /usr/share/ucode/luci/template/themes/bootstrap/header.ut ] && \
				uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	# The "installed before" marker uci-defaults writes to tell fresh from upgrade. Removing it
	# makes uninstall-then-reinstall count as fresh again.
	rm -rf /usr/share/luci-theme-footstrap >/dev/null 2>&1 || true
	# The admin-uploaded login background (kept out of the package on purpose, so it survives an
	# upgrade). A real removal is the one time it should go — this branch never runs on upgrade.
	rm -rf /etc/footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true	# see the postinst note: reload keeps sessions
}
endef

# Runs right after luci.mk copies luasrc/ucode/htdocs/root/src into PKG_BUILD_DIR, so it
# rewrites the build copy, never the source tree.
#
# 1. cascade.css is generated, not committed — and styles/ is not in luci.mk's copy list, so
#    build-css.sh reads it from $(CURDIR) and writes into the build tree. cat/awk only, no host
#    toolchain: that is why it runs on an OpenWrt buildbot.
# 2. Stamp the git-derived version into the theme JS (fs-version.js — the string the Appearance tab
#    shows). Unconditional: with PKG_VERSION empty it falls back to PKG_SRC_VERSION, which luci.mk
#    always defines, so only an un-built source checkout keeps the literal '0.0.0-dev'.
#
# THE CATALOGUE IS luci.mk's BUSINESS, and nothing here compiles it. `po/` is the directory
# LUCI_LANGUAGES globs, so luci.mk emits one `luci-i18n-footstrap-<lang>` package per language the
# way it does for every luci-app — which is what a package IN THE LUCI TREE has to look like, and
# what Weblate can see (it translates `po/`, and only `po/`).
#
# It was `i18n/` here for a while, with a po2lmo loop in this hook bundling the catalogue into the
# theme package, because a multi-package release was mis-picked by a self-updater that resolved the
# theme by name and took `head -1` (issue #6). That updater is retired and the release is built by
# owfeed, which packages this theme as exactly one artifact per format regardless of what luci.mk
# would do — so the constraint that bought the rename is gone, and the cost of keeping it (a
# catalogue invisible to the project's own translation platform) is not.
define Build/Prepare/luci-theme-footstrap
	# luci.mk's Build/Prepare copies only src/ luasrc/ htdocs/ root/ ucode/ into
	# $(PKG_BUILD_DIR), and PKG_LICENSE_FILES resolves against THAT — so the Apache text has to
	# be put there by hand or the declaration points at nothing.
	$(CP) $(CURDIR)/LICENSE $(PKG_BUILD_DIR)/
	$(SHELL) $(CURDIR)/build-css.sh $(PKG_BUILD_DIR)/htdocs/luci-static/footstrap/cascade.css
	# The private `--fs-*` names are 16% of the sheet and mean nothing to a browser — the same trade
	# terser makes for the JS. BEFORE strip-templates.sh on purpose: the reserved set is derived by
	# reading the JS and the templates, so it must see them whole. Over-reserving costs bytes,
	# under-reserving breaks the theme silently.
	# The reserved set is read from $(CURDIR), the SOURCE, never from $(PKG_BUILD_DIR): in CI the
	# build tree's JS has already been through terser, so its comments are gone and five names that
	# are only MENTIONED in a comment stop being reserved. That made the shipped sheet depend on WHO
	# built it — 10 reserved names via CI, 15 via a plain SDK build, same source. Reading the source
	# over-reserves by ~1 KB and is the safe direction.
	$(SHELL) $(CURDIR)/mangle-tokens.sh \
		$(PKG_BUILD_DIR)/htdocs/luci-static/footstrap/cascade.css \
		$(CURDIR)/htdocs/luci-static/resources $(CURDIR)/ucode
	# Templates are mostly comments and shipped them all. jsmin/terser strip the JS, build-css.sh the
	# CSS; the .ut files were simply never included in that trade. Only `{# … #}` goes — see the
	# script for why the ucode-code `/* … */` deliberately stays. -22 KB of 60, git keeps every word,
	# and dev-sync.sh does NOT run this: a router you are debugging on keeps its comments.
	$(SHELL) $(CURDIR)/strip-templates.sh $(PKG_BUILD_DIR)/ucode
	# …and the same for the shell under root/ (71% and 95% comment lines). Whole-line `#` only.
	$(SHELL) $(CURDIR)/strip-shell.sh $(PKG_BUILD_DIR)/root
	$(SED) "s#const FS_VERSION *= *'[^']*'#const FS_VERSION = '$(if $(PKG_VERSION),$(PKG_VERSION),$(PKG_SRC_VERSION))'#" \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/fs-version.js
endef

# Absolute, not a relative path: CI rsyncs this package into package/, not into the feed.
include $(TOPDIR)/feeds/luci/luci.mk

# THE LINE BELOW IS LOAD-BEARING AND IT IS NOT A SIGNATURE — do not delete it as boilerplate.
#
# include/scan.mk builds the package list by GREPPING the Makefiles, not by parsing them:
#   find -L package -name Makefile | xargs grep -aHE 'call (Build/DefaultTargets|BuildPackage|KernelPackage)'
# A Makefile that does not match is not in the list, so it is never dumped, no
# CONFIG_PACKAGE_* symbol is emitted for it, and `make package/<name>/compile` answers
# "No rule to make target" — with no error naming the package anywhere in the build.
#
# This theme never calls BuildPackage itself; luci.mk does, at the include above. The grep
# cannot see that. So the only thing that puts this package into the SDK's list is the literal
# text on the next line — which is why every luci-* Makefile carries it.
# Deleting it as a useless comment is exactly what broke the build (both formats, silently).
# tools/scan-marker.sh re-derives the grep from scan.mk and fails the build if it goes missing.
# call BuildPackage - OpenWrt buildroot signature


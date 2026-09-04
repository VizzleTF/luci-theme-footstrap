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
# +luci-base is the WHOLE list, and keeping it that way is the constraint. Nothing this package ships
# fetches anything at run time, so there is no second name to justify — and the rule that got it here
# stands: the one convenience tool that ever wanted a dep was `curl`, which is NOT in OpenWrt's
# default set, on an 8 MB device, for one API call. Fall back to what the base image has
# (uclient-fetch, jsonfilter, sha256sum) or do without.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
# Else luci.mk defaults these to LuCI's own, and the package claims MAINTAINER "OpenWrt LuCI
# community" / URL openwrt/luci.
LUCI_MAINTAINER:=Ivan Kvashonkin <vizzlef@gmail.com>
LUCI_URL:=https://github.com/VizzleTF/luci-theme-footstrap

# CSS: ship verbatim. luci.mk would run csstidy over it, which is old enough to mangle :has(),
# color-mix() and nested calc() and break the layout. build-css.sh minifies instead.
LUCI_MINIFY_CSS:=0
#
# JS: two minify paths, chosen by who is building.
#
# CI (the released packages) pre-minifies with terser BEFORE the SDK build — tools/minify-js.mjs
# mangles top-level identifiers too, which jsmin cannot: ~41 KB against jsmin's ~57 KB, −27% — and
# signals it with FOOTSTRAP_PREMIN=1.
# jsmin must then stay away from the already-minified output: terser legitimately emits
# `return/^v/.test(s)`, the exact one-character-lookback trap below, so LUCI_MINIFY_JS goes to 0.
#
# Everyone else (an SDK user, the buildbot — no node) builds the untouched source and keeps
# luci.mk's default jsmin: ~105 KB of this tree's JS is comments, and uhttpd serves /www with NO
# compression, so those are wire and flash bytes either way.
#
# The catch on the jsmin path, and why the gates exist: jsmin decides regex-or-division from a
# one-character lookback, and `n` (of `return`) and `>` (of `=>`) are not on its allow-list, so
# `return /re/` makes it eat the rest of the file AND EXIT 0 (openwrt/luci#8299). eslint's
# `wrap-regex` bans the shape in the source; tools/jsmin-verify.mjs proves jsmin's output is
# token-identical to it.
FOOTSTRAP_PREMIN?=
ifneq ($(FOOTSTRAP_PREMIN),)
LUCI_MINIFY_JS:=0
endif

# Apache-2.0, and not a free choice: styles/base began as a fork of luci-theme-bootstrap's
# cascade.css, the ucode templates derive from LuCI's own, and a few JS helpers are verbatim copies.
# The notices travel with it.
#
# No OFL-1.1: the theme ships no Font Software, so declaring it would be a false statement about the
# package's contents.
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

# NO `rpcd reload` HERE, on install or removal — it used to be, and it was the more dangerous of
# the two rpcd calls this package could make. Measured on an owrt2512 stand:
#
# 1. RELOAD IS A RE-EXEC, NOT A REFRESH. `/etc/init.d/rpcd reload` is `procd_send_signal rpcd` ->
#    SIGHUP -> rpcd freezes sessions and calls exec_self(): a full re-exec that re-scans the plugin
#    dirs and dlopen()s every .so. A plugin file that is absent or mid-write at that instant is
#    DROPPED, past one stderr line, and does NOT come back on its own:
#
#      mv /usr/lib/rpcd/file.so /tmp/ ; rpcd reload   -> `ubus list` loses `file`
#      file restored, no reload                       -> still missing
#      reload (or restart)                             -> back
#
#    First measured this way on the `luci` ucode plugin (24.10/25.12: /usr/libexec/rpcd/luci) — a
#    reload racing another package's file replacement left every luci/getFeatures,
#    luci/getTimezones and luci/getMountPoints call answering `-32000 Object not found`, reported
#    from the field on a SNAPSHOT router, cleared only by a reboot. The SAME race hits `file`, and
#    losing `file` is worse: it is what makes System -> Backup/Flash Firmware's "Reset to
#    defaults" row silently disappear. view/system/flash.js computes has_rootfs_data from
#    /proc/mtd and /proc/mounts read through fs.trimmed(), wrapped in L.resolveDefault(..., '') —
#    so the -32000 `file` answers with reads as "no overlay" instead of as an error (OpenWrt forum
#    thread 251930, posts 97 and 109 — "fixed" by installing an unrelated package whose OWN
#    postinst reload happened to re-register `file`).
#
# 2. THIS PACKAGE HAS NOTHING FOR A RELOAD TO REFRESH. It registers no rpcd object at all — no
#    /usr/libexec/rpcd/* script, no /usr/lib/rpcd/*.so, only root/usr/share/rpcd/acl.d/*.json — so
#    a reload here only runs the dlopen risk above for every OTHER plugin, for zero gain of its own.
#
# 3. rpcd READS acl.d/*.json AT LOGIN, not only at start or on SIGHUP. Measured: narrow
#    rpcd.@login[0].read/write from '*' to an explicit group list, remove the ACL file with rpcd
#    already running -> `session access` for uci footstrap write answers false; put the file back
#    with NO reload, log in again -> true. A fresh login already sees a just-installed ACL.
#
# 4. On a stock router, root's rpcd login grants read='*' write='*' — blanket. `session access`
#    answers true even for an INVENTED object (measured against `uci totally_made_up_pkg_xyz`), so
#    the theme's ACL group is irrelevant to a root session from the start.
#
# The one case #3 does not cover: a session that logged in BEFORE this install, on a RESTRICTED
# (non-'*') rpcd login — its in-memory ACL set predates the new grant, and only a fresh login
# re-reads acl.d. Measured: that session stays false until it is forced to re-authenticate.
# Ending the session (not reloading rpcd) fixes exactly that, with a narrower blast radius: the
# postinst below ends a session only when a fresh login would actually gain the scope — denied
# uci/footstrap/write right now, AND its own username's rpcd login lists this theme's ACL group —
# so a restricted login the theme's grant was never added to (a second admin account, a monitoring
# script's login) is left running: re-authenticating would deny it exactly the same as before.
# Verified verbatim on the stand: a blanket-root session survived, a stale restricted session was
# destroyed, the unauthenticated all-zero session was left untouched, and a fresh login answered
# true. The one visible price: an admin on a restricted account WHOSE LOGIN ALREADY LISTS the
# theme's group is logged out by their own install action and must log back in — the narrowest set
# this can be, since a session whose login never grants the group gains nothing from re-logging in.
define Package/luci-theme-footstrap/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# uci-defaults registers the theme; drop the LuCI caches so it is seen without a reboot.
	# Calling it ourselves is belt-and-braces: OpenWrt's default_postinst also runs (then
	# deletes) every /etc/uci-defaults/* we ship, so it executes twice per install. It is
	# idempotent: the second pass finds the theme already registered and changes nothing.
	[ -f /etc/uci-defaults/30_luci-theme-footstrap ] && \
		sh /etc/uci-defaults/30_luci-theme-footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	# See the note above the define: no reload. Instead, end a session only when re-authenticating
	# would actually hand it the theme's scope: it must be denied uci/footstrap/write right now
	# AND its own rpcd login entry must list this theme's ACL group, in either read or write — a
	# denied session whose login never grants that group (a second admin account or a monitoring
	# script's login the theme was never added to) stays denied after a fresh login too, so ending
	# it would only cost someone a session for nothing. Guarded on the `session` object existing at
	# all (a router with rpcd built without ubus session support just does nothing here).
	ubus list 2>/dev/null | grep -qx session && {
		for s in $$(ubus call session list 2>/dev/null | grep -o '"ubus_rpc_session": "[a-f0-9]*"' | cut -d'"' -f4); do
			# skips the all-zero session: that one is the UNAUTHENTICATED default and is never
			# denied anything by an ACL, so it is not this sweep's business.
			case "$$s" in *[!0]*) ;; *) continue ;; esac
			ubus call session access "{\"ubus_rpc_session\":\"$$s\",\"scope\":\"uci\",\"object\":\"footstrap\",\"function\":\"write\"}" 2>/dev/null | grep -q true && continue
			# A '*' login already answered true above and never reaches here. What is left is a
			# denied session: only destroy it if ITS OWN username's rpcd login actually lists the
			# theme's ACL group, so a fresh login would gain the scope this sweep is chasing.
			u=$$(ubus call session get "{\"ubus_rpc_session\":\"$$s\"}" 2>/dev/null | grep -o '"username": *"[^"]*"' | cut -d'"' -f4)
			[ -n "$$u" ] || continue
			# Enumerate every login section from `uci show`, not a `uci -q get` index count: the
			# latter stops at the FIRST section with no username option (a login block missing that
			# option is legal UCI) and never looks at any section past it — fails safe (a session is
			# kept, never wrongly destroyed) but skips real sections. `while read` takes one line at
			# a time instead of `for`'s word-splitting, because a username may itself contain a
			# space, which would otherwise split one section's line into two and skip it. The loop
			# runs in a subshell, so its answer cannot survive in a variable — it is echoed out and
			# captured instead. A show line's value comes single-quoted
			# (`rpcd.@login[0].username='root'`), stripped below.
			grant=$$(uci show rpcd 2>/dev/null | grep -F .username= | while read -r kv; do
				sect=$${kv%%.username=*}
				un=$${kv#*.username=}
				un=$${un#\'}
				un=$${un%\'}
				[ "$$un" = "$$u" ] || continue
				for grp in $$(uci -q get "$$sect.read") $$(uci -q get "$$sect.write"); do
					[ "$$grp" = luci-theme-footstrap ] && { echo 1; break 2; }
				done
			done)
			[ -n "$$grant" ] || continue
			ubus call session destroy "{\"ubus_rpc_session\":\"$$s\"}" >/dev/null 2>&1 || true
		done
	}
}
exit 0
endef

define Package/luci-theme-footstrap/postrm
#!/bin/sh
# opkg runs the OLD package's postrm with arg "upgrade" during a version upgrade and "remove" on a
# real removal. On upgrade this script MUST change nothing: reverting mediaurlbase and wiping the
# theme registration here is what flipped every updating 24.10 user back to bootstrap. apk never
# runs this on upgrade (it uses the new package's pre/post-upgrade), so guarding on the arg is
# correct for both managers.
case "$$1" in *upgrade*) exit 0 ;; esac
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.Footstrap
	# Don't leave the active theme pointing at the media dir we just removed: a theme needs its
	# media dir AND its ucode template to render, so both are checked before handing the UI over.
	case "$$(uci -q get luci.main.mediaurlbase)" in
		/luci-static/footstrap*)
			[ -d /www/luci-static/bootstrap ] && \
			[ -f /usr/share/ucode/luci/template/themes/bootstrap/header.ut ] && \
				uci set luci.main.mediaurlbase=/luci-static/bootstrap ;;
	esac
	uci commit luci
	# The admin-uploaded login background (kept out of the package on purpose, so it survives an
	# upgrade). A real removal is the one time it should go — this branch never runs on upgrade.
	rm -rf /etc/footstrap >/dev/null 2>&1 || true
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* >/dev/null 2>&1 || true
	# No rpcd reload here either — see the postinst note. A removal drops nothing rpcd needs to
	# be told about (no plugin object, ever); a session still holding the now-gone ACL group is
	# simply denied uci/footstrap/write on its next call, which is the correct answer anyway.
}
endef

# Runs right after luci.mk copies luasrc/ucode/htdocs/root/src into PKG_BUILD_DIR, so it rewrites
# the build copy and never the source tree.
#
# 1. cascade.css is generated, not committed — and styles/ is not in luci.mk's copy list, so
#    build-css.sh reads it from $(CURDIR) and writes into the build tree. cat and awk only, which
#    is why it runs on an OpenWrt buildbot.
# 2. Stamp the git-derived version into fs-version.js. Unconditional: with PKG_VERSION empty it
#    falls back to PKG_SRC_VERSION, which luci.mk always defines, so only an un-built source
#    checkout keeps the literal '0.0.0-dev'.
#
# The catalogue is luci.mk's business and nothing here compiles it. `po/` is the directory
# LUCI_LANGUAGES globs, so luci.mk emits one `luci-i18n-footstrap-<lang>` package per language, the
# way it does for every luci-app — which is what a package in the luci tree has to look like, and
# what Weblate can see. It was `i18n/` while a fielded self-update script mis-picked a multi-asset
# release with `head -1` (issue #6); that script is retired and owfeed builds one theme artifact
# per format regardless.
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
	# The gate-only exports (`/* fs:probe */`). A handful of module-private functions are also
	# listed in a module's baseclass so a gate in the source repository can call them — nothing on a
	# router does. The functions stay; the export line goes, so the surface a package carries is the
	# one the theme itself uses.
	$(SHELL) $(CURDIR)/strip-probes.sh $(PKG_BUILD_DIR)/htdocs/luci-static/resources
	# …and the same for the shell under root/ (71% and 95% comment lines). Whole-line `#` only.
	$(SHELL) $(CURDIR)/strip-shell.sh $(PKG_BUILD_DIR)/root
	# The two static assets luci.mk has no step for: the SVG favicon carries a 753-byte comment and
	# the manifest its indentation, and both are fetched by every browser over a link uhttpd does
	# not compress. awk only, so this runs on a buildbot with no node.
	$(SHELL) $(CURDIR)/strip-assets.sh $(PKG_BUILD_DIR)/htdocs/luci-static/footstrap
	$(SED) "s#const FS_VERSION *= *'[^']*'#const FS_VERSION = '$(if $(PKG_VERSION),$(PKG_VERSION),$(PKG_SRC_VERSION))'#" \
		$(PKG_BUILD_DIR)/htdocs/luci-static/resources/fs-version.js
endef

# Absolute, not a relative path: CI rsyncs this package into package/, not into the feed.
include $(TOPDIR)/feeds/luci/luci.mk

# The line below is load-bearing and is NOT a signature — do not delete it as boilerplate.
#
# include/scan.mk builds the package list by GREPPING the Makefiles, not by parsing them:
#   find -L package -name Makefile | xargs grep -aHE 'call (Build/DefaultTargets|BuildPackage|KernelPackage)'
# A Makefile that does not match is not in the list, so it is never dumped, no CONFIG_PACKAGE_*
# symbol is emitted for it, and `make package/<name>/compile` answers "No rule to make target" with
# no error naming the package anywhere in the build.
#
# This theme never calls BuildPackage itself; luci.mk does, at the include above, and the grep
# cannot see that. So the only thing that puts this package into the SDK's list is the literal text
# on the next line. tools/scan-marker.sh re-derives the grep from scan.mk and fails the build if it
# goes missing.
# call BuildPackage - OpenWrt buildroot signature

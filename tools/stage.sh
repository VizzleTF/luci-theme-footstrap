#!/bin/sh
# Stage the theme's rootfs for owfeed — the half of the build that owfeed deliberately
# does not do.
#
#   ./tools/stage.sh              # dist/root + dist/VERSION + dist/scripts
#   FOOTSTRAP_VERSION=0.12.0 ./tools/stage.sh
#
# `owfeed build` packages a DIRECTORY; it does not build one. Everything the OpenWrt SDK
# used to do for us on the way in — concatenate the stylesheet, mangle the private custom
# properties, strip the comments out of the templates and the shell, stamp the version —
# has to happen before it, and that is what this file is. The one step it does NOT do is
# the translation catalogue: owfeed compiles the .po files itself (i18n: in owfeed.yml),
# byte-identical to po2lmo, so requiring po2lmo would put a C build of luci-base in front
# of anyone packaging this theme.
#
# THE ORDER IS THE MAKEFILE'S, and it is not arbitrary — see Build/Prepare in
# luci-theme-footstrap/Makefile, which this mirrors step for step:
#
#   1. copy       luci.mk's install mapping: htdocs -> /www, ucode -> /usr/share/ucode/luci,
#                 root -> /
#   2. build-css  cascade.css is generated from styles/ and is not in the tree
#   3. mangle     the private --fs-* names, reading the reserved set from the SOURCE
#   4. minify     terser over the staged JS (in CI this ran over the checkout, before the
#                 rsync into the SDK; there is no SDK now, so it runs over the staged copy)
#   5. strip      {# … #} out of the templates, whole-line # out of the shell
#   6. stamp      FS_VERSION, after the minify — minify-js.mjs keeps that declaration
#                 verbatim precisely so this sed still matches
#
# WHY THE LIFECYCLE SCRIPTS ARE EXTRACTED FROM THE MAKEFILE rather than kept as files
# beside it: they exist in the Makefile already, they are the thing an SDK build installs,
# and two copies of a postrm that only runs on somebody else's router months later is the
# worst duplication in this repo to let rot. The Makefile stays the single source; owfeed
# is handed what it holds. `$$` is make's escaping for a literal `$`, so it is undone here.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/luci-theme-footstrap"
DIST="${DIST:-$ROOT/dist}"
STAGE="$DIST/root"
DEV=0
[ "${1:-}" = "--dev" ] && DEV=1

rm -rf "$DIST"
mkdir -p "$STAGE/www" "$STAGE/usr/share/ucode/luci" "$DIST/scripts"

# 1. luci.mk's mapping. `cp -a` keeps the symlinks under htdocs (the font and wallpaper
#    aliases) as symlinks, which is what the SDK build ships.
#
#    root/ is staged BESIDE the payload rather than into it, and merged at the end: it is
#    the only part strip-shell.sh is pointed at, and the Makefile hands that script
#    $(PKG_BUILD_DIR)/root — a directory holding nothing but shell and one JSON. Merged
#    first, the script would be handed /www and /usr/share/ucode as well, which is neither
#    the set it was reasoned about over nor a set it will accept (it exits non-zero on a
#    subtree with no shell in it).
ROOTPART="$DIST/.root"
cp -a "$SRC/htdocs/." "$STAGE/www/"
cp -a "$SRC/ucode/."  "$STAGE/usr/share/ucode/luci/"
cp -a "$SRC/root"     "$ROOTPART"

# macOS writes these into any directory Finder has looked at, and owfeed refuses a payload
# that carries one — correctly, but the right place to drop it is here.
find "$STAGE" "$ROOTPART" -name '.DS_Store' -delete

CSS="$STAGE/www/luci-static/footstrap/cascade.css"

# 2. cascade.css is concatenated from styles/, which is not in the payload at all.
if [ "$DEV" = 1 ]; then
	"$SRC/build-css.sh" "$CSS" --dev
else
	"$SRC/build-css.sh" "$CSS"

	# 3. The private --fs-* tier, renamed to one- and two-letter names. The reserved set is
	#    DERIVED by reading the theme's JS and templates — from $SRC, the SOURCE, never from
	#    the staged copy: after step 4 the staged JS has no comments left, and five names that
	#    are only mentioned in one would stop being reserved. Over-reserving costs a kilobyte
	#    and is the direction that cannot break the theme.
	"$SRC/mangle-tokens.sh" "$CSS" "$SRC/htdocs/luci-static/resources" "$SRC/ucode"

	# 4. terser. On the SDK path this was optional (luci.mk's jsmin was the fallback for a
	#    buildbot with no node); there is no jsmin here, so it is the only minifier and a
	#    missing node is a failed build rather than a bigger package.
	node "$ROOT/tools/minify-js.mjs" "$STAGE/www/luci-static/resources"

	# 5. Comments out of the templates and out of the shell.
	"$SRC/strip-templates.sh" "$STAGE/usr/share/ucode/luci"
	"$SRC/strip-shell.sh" "$ROOTPART"
fi

# root/ joins the payload once it has been stripped — see the note at step 1.
cp -a "$ROOTPART/." "$STAGE/"
rm -rf "$ROOTPART"

# 6. The version the popover shows and the updater compares against. FOOTSTRAP_VERSION is
#    what CI injects from the tag; a working tree falls back to its newest tag, and a
#    checkout with no tags at all keeps fs-version.js's own '0.0.0-dev'.
VER="${FOOTSTRAP_VERSION:-$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || true)}"
if [ -n "$VER" ]; then
	sed "s#const FS_VERSION *= *'[^']*'#const FS_VERSION = '$VER'#" \
		"$STAGE/www/luci-static/resources/fs-version.js" > "$STAGE/.fs-version.js"
	mv "$STAGE/.fs-version.js" "$STAGE/www/luci-static/resources/fs-version.js"
	grep -q "FS_VERSION = '$VER'" "$STAGE/www/luci-static/resources/fs-version.js" || {
		echo "stage: the FS_VERSION stamp did not take — every install would report (dev)" >&2
		exit 1
	}
else
	VER=0.0.0
	echo "stage: no tag and no FOOTSTRAP_VERSION — staging as $VER" >&2
fi

# PKG_RELEASE is 1 in the Makefile and the -r1 suffix is part of every asset name a
# fielded self-updater matches, so it is written here rather than left to owfeed.
printf '%s-r1\n' "$VER" > "$DIST/VERSION"

# The lifecycle scripts, out of the Makefile's own defines. owfeed wraps them the way
# package-pack.mk does (default_postinst, default_prerm), so what is extracted is the body
# only — the same text the SDK build appends to that wrapper.
extract() {			# <define-suffix> <outfile>
	awk -v want="define Package/luci-theme-footstrap/$1" '
		$0 == want { in_block = 1; next }
		in_block && $0 == "endef" { exit }
		in_block { print }
	' "$SRC/Makefile" | sed 's/\$\$/$/g' > "$2"
	[ -s "$2" ] || {
		echo "stage: no Package/luci-theme-footstrap/$1 block in the Makefile — refusing to" >&2
		echo "       build a package whose install-time half is silently missing" >&2
		exit 1
	}
}
extract postinst "$DIST/scripts/post-install"
extract postrm   "$DIST/scripts/post-deinstall"
chmod +x "$DIST/scripts/"*

echo "staged $DIST/root at $(cat "$DIST/VERSION")"

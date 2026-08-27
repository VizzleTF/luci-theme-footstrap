#!/bin/sh
# Stage the theme's rootfs for owfeed — the half of the build owfeed deliberately does not do.
#
#   ./tools/stage.sh              # dist/root + dist/VERSION + dist/scripts
#   FOOTSTRAP_VERSION=0.12.0 ./tools/stage.sh
#
# `owfeed build` packages a DIRECTORY; it does not build one. Everything the OpenWrt SDK used to do
# on the way in — concatenate the stylesheet, mangle the private custom properties, strip the
# comments out of the templates and the shell, stamp the version — has to happen before it. The one
# step it does NOT do is the translation catalogue: owfeed compiles the .po files itself,
# byte-identical to po2lmo, and requiring po2lmo would put a C build of luci-base in front of anyone
# packaging this theme.
#
# The order is the Makefile's, step for step (see Build/Prepare there):
#
#   1. copy       luci.mk's install mapping: htdocs -> /www, ucode -> /usr/share/ucode/luci, root -> /
#   2. build-css  cascade.css is generated from styles/ and is not in the tree
#   3. mangle     the private --fs-* names, reading the reserved set from the SOURCE
#   4. minify     terser over the staged JS
#   5. strip      {# … #} out of the templates, whole-line # out of the shell
#   6. stamp      FS_VERSION, after the minify — minify-js.mjs keeps that declaration verbatim
#                 precisely so this sed still matches
#
# The lifecycle scripts are EXTRACTED from the Makefile rather than kept as files beside it: they
# exist there already, they are what an SDK build installs, and two copies of a postrm that only
# runs on somebody else's router months later is the worst duplication in this repo to let rot. `$$`
# is make's escaping for a literal `$`, so it is undone here.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/luci-theme-footstrap"
DIST="${DIST:-$ROOT/dist}"
STAGE="$DIST/root"
DEV=0
[ "${1:-}" = "--dev" ] && DEV=1

rm -rf "$DIST"
mkdir -p "$STAGE/www" "$STAGE/usr/share/ucode/luci" "$DIST/scripts"

# 1. luci.mk's mapping. `cp -a` rather than `cp -r`, so anything under htdocs that IS a symlink
#    stays one. Nothing there is today: the background, the pattern and the fonts directory are
#    aliases uci-defaults makes at runtime under /www, /www being repopulated from firmware on a
#    sysupgrade.
#
#    root/ is staged BESIDE the payload and merged at the end: it is the only part strip-shell.sh is
#    pointed at, and the Makefile hands that script a directory holding nothing but shell and one
#    JSON. Merged first, the script would be handed /www and /usr/share/ucode as well, which it
#    exits non-zero on.
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

	# 3. The private --fs-* tier, renamed to one- and two-letter names — in the sheet AND on the
	#    far side of the seam, the staged JS and templates, with the same map. The 36 names that
	#    cross the seam used to be reserved and cost 8,574 B of the sheet on their own
	#    (`--fs-accent` 1,452 B); renaming both sides together takes 4.5 KB more off the wire.
	#
	#    Safe only because every `--fs-` reference in the JS and the templates is a WHOLE string
	#    literal — `setProperty('--fs-accent', …)`, never `'--fs-' + role`. Checked across all 89
	#    sites. If one is ever composed, the sheet renames and the JS keeps asking for a name that
	#    no longer exists, silently, which is why mangle-tokens.sh says so at its --rewrite flag.
	#
	#    The staged copies are rewritten, never $SRC: this runs before terser, so the staged JS
	#    still has its comments and a name mentioned only in one is renamed there too, harmlessly.
	"$SRC/mangle-tokens.sh" "$CSS" "$SRC/htdocs/luci-static/resources" "$SRC/ucode" \
		--rewrite "$STAGE/www/luci-static/resources" "$STAGE/usr/share/ucode/luci"

	# 4. The gate-only exports, BEFORE terser — the marker is a comment, and terser takes every
	#    comment with it. See strip-probes.sh for what a probe is and why a router does not need it.
	"$SRC/strip-probes.sh" "$STAGE/www/luci-static/resources"

	#    …then terser. On the SDK path this was optional (luci.mk's jsmin was the fallback for a
	#    buildbot with no node); there is no jsmin here, so it is the only minifier and a
	#    missing node is a failed build rather than a bigger package.
	node "$ROOT/tools/minify-js.mjs" "$STAGE/www/luci-static/resources"

	# 5. Comments out of the templates and out of the shell.
	"$SRC/strip-templates.sh" "$STAGE/usr/share/ucode/luci"

	#    …then the pre-paint scripts inside those templates, which strip-templates.sh deliberately
	#    leaves alone (it removes comments and nothing else). These are the most expensive bytes in
	#    the package: they sit in the HTML document itself, so every page load pays them before a
	#    single module is fetched — the login page included, which fetches no modules at all.
	node "$ROOT/tools/minify-prepaint.mjs" "$STAGE/usr/share/ucode/luci"

	"$SRC/strip-shell.sh" "$ROOTPART"

	#    …and the two static assets nothing else touches: the SVG favicon's comment and the
	#    manifest's indentation. Both are fetched by a browser, and uhttpd sends them uncompressed
	#    like everything else.
	"$SRC/strip-assets.sh" "$STAGE/www/luci-static/footstrap"

	#    …and the app icon's compressed stream, which build-icons.mjs leaves as Chromium's encoder
	#    wrote it: the same pixels re-deflated are 581 B smaller, and it is a manifest icon a
	#    browser fetches over the same uncompressed channel.
	node "$ROOT/tools/repack-png.mjs" "$STAGE/www/luci-static/footstrap"
fi

# root/ joins the payload once it has been stripped — see the note at step 1.
cp -a "$ROOTPART/." "$STAGE/"
rm -rf "$ROOTPART"

# 6. The version the Appearance page shows. FOOTSTRAP_VERSION is what CI injects from the
#    tag; a working tree falls back to its newest tag, and a checkout with no tags at all
#    keeps fs-version.js's own '0.0.0-dev'.
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

# PKG_RELEASE is 1 in the Makefile and the -r1 suffix is part of every asset name, so it
# is written here rather than left to owfeed.
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

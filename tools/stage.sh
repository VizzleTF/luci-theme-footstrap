#!/bin/sh
# Stage the theme's rootfs for owfeed — the half of the build owfeed deliberately does not do.
#
#   ./tools/stage.sh              # dist/root + dist/VERSION + dist/scripts
#   ./tools/stage.sh --dev        # the same with the CSS unminified and no mangle or strip
#   FOOTSTRAP_VERSION=0.12.0 ./tools/stage.sh
#
# `owfeed build` packages a DIRECTORY; it does not build one, and it compiles the .po files itself
# (byte-identical to po2lmo). Everything else the SDK did happens here, in the order below: 1 copy
# (luci.mk's install mapping), 2 build-css, 3 mangle the private --fs-* names, 4 uglify-js, 5 strip
# templates, minify the pre-paint scripts inside them, strip shell and assets, 6 stamp FS_VERSION
# after the minify (minify-js.mjs keeps that declaration verbatim so the sed still matches). Those
# are the Makefile's Build/Prepare steps plus two minifiers (uglify-js over resources,
# minify-prepaint over head.ut).
# The lifecycle scripts are EXTRACTED from the Makefile, not kept as a second copy; `$$` is make's
# escaping for a literal `$`, undone here.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/luci-theme-footstrap"
DIST="${DIST:-$ROOT/dist}"
STAGE="$DIST/root"
DEV=0
case "${1:-}" in
	'') ;;
	--dev) DEV=1 ;;
	# Else a typo like `--devv` stages a minified build the caller meant to read.
	*) echo "stage: unknown option: $1" >&2; exit 1 ;;
esac

# FOOTSTRAP_VERSION is what CI injects from the tag; a working tree falls back to its newest tag.
# It goes into sed and fs-version.js, so it is checked where it enters, before dist/ is wiped, with
# the pattern dev-sync.sh holds the same stamp to: no quote, `#`, `&` or newline gets through.
VER="${FOOTSTRAP_VERSION:-$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || true)}"
if [ -n "$VER" ] && ! expr "$VER" : '[0-9A-Za-z._-]*$' >/dev/null 2>&1; then
	echo "stage: refusing version '$VER' — only [0-9A-Za-z._-] may reach sed and fs-version.js" >&2
	exit 1
fi

rm -rf "$DIST"
mkdir -p "$STAGE/www" "$STAGE/usr/share/ucode/luci" "$DIST/scripts"

# 1. luci.mk's mapping. `cp -a`, so a symlink under htdocs stays one (none is today: the
#    background, the pattern and the fonts are aliases uci-defaults makes at runtime).
#    root/ is staged BESIDE the payload and merged after the strip, so `strip-build.sh shell` is
#    pointed at root/ alone, as the Makefile points it at $(PKG_BUILD_DIR)/root.
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

	# 3. The private --fs-* tier, renamed to one- and two-letter names in the sheet AND in the staged
	#    JS and templates, with the same map. Safe only because every `--fs-` reference there is a
	#    WHOLE string literal (docs/package.md); a composed one would ask for a name that no longer
	#    exists. The staged copies are rewritten, never $SRC.
	"$SRC/mangle-tokens.sh" "$CSS" "$STAGE/www/luci-static/resources" "$STAGE/usr/share/ucode/luci"

	# 4. uglify-js. On the SDK path this was optional (luci.mk's jsmin was the fallback for a
	#    buildbot with no node); there is no jsmin here, so it is the only minifier and a
	#    missing node is a failed build rather than a bigger package.
	node "$ROOT/tools/minify-js.mjs" "$STAGE/www/luci-static/resources"

	# 5. Comments out of the templates, the pre-paint scripts, the shell and the assets.
	"$SRC/strip-build.sh" templates "$STAGE/usr/share/ucode/luci"

	#    …then the pre-paint scripts inside those templates, which the templates strip deliberately
	#    leaves alone (it removes comments and indentation, nothing else). These are the most expensive bytes in
	#    the package: they sit in the HTML document itself, so every page load pays them before a
	#    single module is fetched — the login page included, which fetches no modules at all.
	node "$ROOT/tools/minify-prepaint.mjs" "$STAGE/usr/share/ucode/luci"

	"$SRC/strip-build.sh" shell "$ROOTPART"

	#    …and the two static assets nothing else touches: the SVG favicon's comment and the
	#    manifest's indentation. Both are fetched by a browser, and uhttpd sends them uncompressed
	#    like everything else.
	"$SRC/strip-build.sh" assets "$STAGE/www/luci-static/footstrap"
fi

# root/ joins the payload once it has been stripped — see the note at step 1.
cp -a "$ROOTPART/." "$STAGE/"
rm -rf "$ROOTPART"

# 6. The version the Appearance page shows: $VER from the top of this script, stamped into
#    fs-version.js. A checkout with no tags at all is refused below.
if [ -n "$VER" ]; then
	sed "s#const FS_VERSION *= *'[^']*'#const FS_VERSION = '$VER'#" \
		"$STAGE/www/luci-static/resources/fs-version.js" > "$STAGE/.fs-version.js"
	mv "$STAGE/.fs-version.js" "$STAGE/www/luci-static/resources/fs-version.js"
	grep -q "FS_VERSION = '$VER'" "$STAGE/www/luci-static/resources/fs-version.js" || {
		echo "stage: the FS_VERSION stamp did not take — every install would report (dev)" >&2
		exit 1
	}
else
	# No tag and no FOOTSTRAP_VERSION: the input is missing, not "0.0.0", so refuse rather than stamp a placeholder.
	echo "stage: no tag and no FOOTSTRAP_VERSION — refusing to stamp a placeholder version" >&2
	echo "stage: fetch tags (git fetch --tags) or set FOOTSTRAP_VERSION=<version>" >&2
	exit 1
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
		echo "stage: build a package whose install-time half is silently missing" >&2
		exit 1
	}
}
extract postinst "$DIST/scripts/post-install"
extract postrm   "$DIST/scripts/post-deinstall"
chmod +x "$DIST/scripts/"*

# ---- one package per language, the way luci.mk emits them ----
#
# owfeed's `i18n.from` compiles every language under one directory into one package, so each
# language gets its own staging directory holding only its own .po. Package names and the
# catalogue basename are luci.mk's (`luci-i18n-footstrap-<lang>`), and so is the uci-defaults line
# that puts the language in LuCI's menu. The label is copied from luci.mk's LUCI_LANG.<code>
# table; a language with no entry stops the build. Adding a language means touching this table, po/
# and owfeed.yml together.
lang_name() {			# <code> -> the label LuCI shows
	case "$1" in
		es) echo 'Español (Spanish)' ;;
		ru) echo 'Русский (Russian)' ;;
		*)  echo '' ;;
	esac
}
for po in "$SRC"/po/*/; do
	[ -d "$po" ] || continue
	lang=$(basename "$po")
	[ "$lang" = templates ] && continue
	[ -n "$(find "$po" -maxdepth 1 -name '*.po' -print -quit)" ] || continue
	label=$(lang_name "$lang")
	[ -n "$label" ] || {
		echo "stage: po/$lang has no label in lang_name() — add LuCI's own LUCI_LANG.$lang" >&2
		exit 1
	}
	mkdir -p "$DIST/po-$lang/$lang" "$DIST/i18n-$lang/etc/uci-defaults"
	cp "$po"*.po "$DIST/po-$lang/$lang/"
	printf "uci set luci.languages.%s='%s'; uci commit luci\n" \
		"$(echo "$lang" | tr - _)" "$label" \
		> "$DIST/i18n-$lang/etc/uci-defaults/luci-i18n-footstrap-$lang"
done

# uhttpd answers 403 on a file that is not world-readable, and owfeed copies modes from disk: a
# worktree can hold 0600/0700 (5 files, 4 directories; a CI checkout is 0644). build-apk.sh and
# dev-sync.sh normalise the same way. X keeps the execute bit of what has one.
chmod -R u=rwX,go=rX "$DIST"

echo "staged $DIST/root at $(cat "$DIST/VERSION")"

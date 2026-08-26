#!/bin/sh
# Put one of this directory's drawings on a router as the footstrap Pattern wallpaper.
#
#   wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/wallpapers/set-pattern.sh | sh -s cats
#   sh set-pattern.sh dinos --size 880 --strength 25
#   sh set-pattern.sh https://example.org/my-tile.svg
#   sh set-pattern.sh /tmp/my-tile.svg
#   sh set-pattern.sh remove
#
# Run it ON THE ROUTER, as root. It does exactly what the Appearance page's upload does — write
# /etc/footstrap/pattern.svg, expose it under /www, and save the file's md5 plus the wallpaper axes
# into /etc/config/footstrap — so nothing here is a private path or a private convention.
#
# The theme itself never fetches this: a theme in a package feed has no business calling a
# third-party host at run time. This script is the admin doing it deliberately, once. Apache-2.0.

set -eu

RAW="https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/wallpapers/svg"
PAT_PATH="/etc/footstrap/pattern.svg"
PAT_SERVE="/www/luci-static/footstrap/pattern.svg"
PAT_MAX=524288					# 512 kB, the cap the upload page enforces

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }
die()  { err "$1"; exit 1; }

usage() {
	cat <<'EOF'
Usage: set-pattern.sh <cats|dinos|URL|FILE|remove> [options]

  cats              870-unit tile, reads well around 440 px   (the default size)
  dinos             2048-unit tile, reads well around 880 px
  URL | FILE        any other SVG, fetched or copied as-is
  remove            delete the pattern and turn the wallpaper off

Options:
  --size N          tile edge in px, 40-1600      (default: per drawing, else 440)
  --strength N      layer opacity 0-100           (default: 20)
  --ink theme|original
                    theme    = the SVG supplies its alpha, footstrap supplies the colour
                    original = use the file's own colours, as a plain tiled image
  --keep-wallpaper  install the file but do not switch the router's wallpaper to Pattern
  -h, --help        this text
EOF
}

# --- arguments ------------------------------------------------------------
WHAT=""; SIZE=""; STRENGTH="20"; INK="theme"; SWITCH=1
while [ $# -gt 0 ]; do
	case "$1" in
		-h|--help) usage; exit 0 ;;
		--size) [ $# -ge 2 ] || die "--size needs a number."; SIZE="$2"; shift 2 ;;
		--strength) [ $# -ge 2 ] || die "--strength needs a number."; STRENGTH="$2"; shift 2 ;;
		--ink) [ $# -ge 2 ] || die "--ink needs theme or original."; INK="$2"; shift 2 ;;
		--keep-wallpaper) SWITCH=0; shift ;;
		-*) die "Unknown option '$1'. Try --help." ;;
		*) [ -z "$WHAT" ] || die "One drawing at a time."; WHAT="$1"; shift ;;
	esac
done
[ -n "$WHAT" ] || { usage; exit 1; }

case "$INK" in theme|original) ;; *) die "--ink takes theme or original." ;; esac
num_in_range() {	# <value> <min> <max>
	case "$1" in ''|*[!0-9]*) return 1 ;; esac
	[ "$1" -ge "$2" ] && [ "$1" -le "$3" ]
}
num_in_range "$STRENGTH" 0 100 || die "--strength takes 0-100."
[ -z "$SIZE" ] || num_in_range "$SIZE" 40 1600 || die "--size takes 40-1600."

# --- the router -----------------------------------------------------------
[ "$(id -u)" = 0 ] || die "Run this as root, on the router."
command -v uci >/dev/null 2>&1 || die "No uci — this is not an OpenWrt router."
[ -d /usr/share/ucode/luci/template/themes/footstrap ] ||
	info "luci-theme-footstrap does not look installed here; writing the settings anyway."

# uci refuses to CREATE a config file, only a section within one, and a router that installed a
# footstrap predating the Appearance defaults has no such file. Same two lines as uci-defaults.
[ -f /etc/config/footstrap ] || : > /etc/config/footstrap
uci -q get footstrap.settings >/dev/null 2>&1 || uci set footstrap.settings=footstrap

# --- remove ---------------------------------------------------------------
if [ "$WHAT" = remove ]; then
	rm -f "$PAT_PATH"
	uci set footstrap.settings.pattern=''
	[ "$SWITCH" = 0 ] || uci set footstrap.settings.wallpaper='off'
	uci commit footstrap
	ok "Pattern removed."
	exit 0
fi

# --- get the bytes --------------------------------------------------------
# Certificates are always verified. This runs as root and a failed verification is the MITM case,
# not a reason to retry insecurely — so there is no -k anywhere, and no fallback to one.
fetch() {	# <url> <outfile>
	if command -v uclient-fetch >/dev/null 2>&1; then uclient-fetch -T 30 -qO "$2" "$1"
	elif command -v curl >/dev/null 2>&1; then curl -fsSL --proto '=https' --max-time 30 -o "$2" "$1"
	else wget -q -T 30 -O "$2" "$1"; fi
}

TMP="/tmp/fs-pattern.$$.svg"
trap 'rm -f "$TMP"' EXIT INT TERM

case "$WHAT" in
	cats)  [ -n "$SIZE" ] || SIZE=440; SRC="$RAW/cats.svg" ;;
	dinos) [ -n "$SIZE" ] || SIZE=880; SRC="$RAW/dinos.svg" ;;
	*://*) [ -n "$SIZE" ] || SIZE=440; SRC="$WHAT" ;;
	*)     [ -n "$SIZE" ] || SIZE=440; SRC="$WHAT"
	       [ -f "$SRC" ] || die "'$SRC' is neither a bundled name (cats, dinos), a URL, nor a file." ;;
esac

if [ -f "$SRC" ]; then
	info "Reading $SRC"
	cat "$SRC" > "$TMP"
else
	info "Downloading $SRC"
	fetch "$SRC" "$TMP" || die "Download failed."
fi
[ -s "$TMP" ] || die "Got an empty file."

# --- what is refused ------------------------------------------------------
# The same objections the upload page raises, minus the parser: an SVG is a document and can carry
# script, and while a masked tile never executes anything, the same file opened at its own URL is
# same-origin with the admin's session. A shell has no DOMParser, so this is text matching and text
# matching guesses — hence the handler pattern `on` + letters + `=` rather than `\son\w+=`: the
# loose one matches `only_selected="false"`, an ordinary Inkscape attribute, and refused one of this
# project's own drawings. A file that trips a check is refused rather than cleaned; upload it from
# the Appearance page instead, where a real parser decides.
SIZE_B=$(wc -c < "$TMP" | tr -d ' ')
[ "$SIZE_B" -le "$PAT_MAX" ] || die "That file is ${SIZE_B} bytes; the theme's cap is ${PAT_MAX}."
grep -qi '<svg' "$TMP" || die "That file is not an SVG image."
grep -qiE '<(script|foreignObject|iframe|embed|object|audio|video|animate|set)[[:space:]/>]' "$TMP" &&
	die "That SVG executes or embeds something; refusing to install it."
grep -qE '[[:space:]]on[a-z]+[[:space:]]*=' "$TMP" &&
	die "That SVG carries an event handler; refusing to install it."
grep -qi 'javascript:' "$TMP" &&
	die "That SVG opens a javascript: URL; refusing to install it."
# off-router reference. A leading `//` is protocol-relative and just as external; `#fragment` and
# `data:` are how a tile refers to its own <defs> and embeds a bitmap, so they stay allowed.
grep -qiE 'href[[:space:]]*=[[:space:]]*.?([a-z][a-z0-9+.-]*:)?//' "$TMP" &&
	die "That SVG references something off this router; refusing to install it."

# --- install --------------------------------------------------------------
# /etc, so a package upgrade cannot delete it and lib/upgrade/keep.d carries it over a sysupgrade.
mkdir -p /etc/footstrap
chmod 0755 /etc/footstrap
cat "$TMP" > "$PAT_PATH"
# uhttpd refuses to SERVE a file that is not world-readable (measured: 0600 -> 403, 0644 -> 200).
chmod 0644 "$PAT_PATH"

# uhttpd serves only /www and types a response BY EXTENSION, so the exposed name keeps its .svg — an
# SVG served as application/octet-stream is one no browser paints. uci-defaults makes this same link
# on every install; repeated here for a router installed before it did.
if [ -d /www/luci-static/footstrap ]; then
	ln -sf "$PAT_PATH" "$PAT_SERVE"
else
	err "No /www/luci-static/footstrap — is the theme installed? The file is in place, but nothing serves it."
fi

# --- the settings ---------------------------------------------------------
# `pattern` is the cache-bust token and nothing else: the browser appends it to the served URL, so
# it must change when the bytes do. The upload page takes cgi-io's md5 `checksum`; md5sum is the
# same number.
TOKEN=$(md5sum "$PAT_PATH" | cut -d' ' -f1)
uci set footstrap.settings.pattern="$TOKEN"
uci set footstrap.settings.pattern_size="$SIZE"
uci set footstrap.settings.pattern_strength="$STRENGTH"
uci set footstrap.settings.pattern_ink="$INK"
[ "$SWITCH" = 0 ] || uci set footstrap.settings.wallpaper='pattern'
uci commit footstrap

ok "Installed $(basename "$SRC") — ${SIZE_B} bytes, tile ${SIZE}px, strength ${STRENGTH}%, colours ${INK}."
if [ "$SWITCH" = 0 ]; then
	ok "The wallpaper axis is untouched: switch it in Appearance -> Wallpaper -> Pattern."
else
	ok "Saved as the router's default wallpaper. Reload LuCI to see it."
	info "A browser that has already chosen a wallpaper keeps ITS choice — every axis is"
	info "per-browser first, the router's saved default second. On such a browser press"
	info "System -> System -> Footstrap -> 'Reset to saved', or pick Pattern there by hand."
fi

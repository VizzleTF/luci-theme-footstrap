#!/bin/sh
# Give a router's footstrap theme a font of your choosing.
#
#   wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/fonts/set-font.sh | sh -s -- --sans Inter
#   sh set-font.sh --sans Inter --sans-file https://example.org/Inter.woff2 --sans-weight '100 900'
#   sh set-font.sh --mono 'Fira Code' --mono-file /tmp/FiraCode-Regular.woff2
#   sh set-font.sh remove
#
# Run it ON THE ROUTER, as root. The theme ships no webfonts — it names Manrope and JetBrains Mono
# first and the system stack after, so a visitor who has either installed sees it and everyone else
# falls through. This script is how an admin adds one back, in either of two independent ways:
#
#   a NAME only          footstrap.settings.font_sans / .font_mono, a plain font-family stack.
#                        Nothing is downloaded and nothing is served; it renders for the visitors
#                        who have that font installed locally. Editable by hand with `uci set`.
#   a NAME and a FILE    the .woff2 is written under /etc/footstrap/fonts, exposed under /www, and
#                        an @font-face sheet is generated next to it. THIS router serves the font,
#                        so every visitor sees it.
#
# No font is named or hosted here on purpose: a family shortcut would be somebody else's licence and
# somebody else's host, written into this repository. You bring the URL or the file.
#
# The theme itself never fetches any of this: a theme in a package feed has no business calling a
# third-party host at run time. This script is the admin doing it deliberately, once. Apache-2.0.

set -eu

FONT_DIR="/etc/footstrap/fonts"			# survives a package upgrade; keep.d carries it over sysupgrade
FONT_SERVE="/www/luci-static/footstrap/fonts"	# the symlink uci-defaults also makes
FONT_URL="/luci-static/footstrap/fonts"		# what the browser asks for
SHEET="$FONT_DIR/fonts.css"
FACES="$FONT_DIR/faces"				# what is installed, so a later run can regenerate the sheet
FONT_MAX=524288					# 512 kB per face, the same cap the pattern upload enforces

# The tails from styles/02-tokens.css. A value with a comma in it is taken as a COMPLETE stack and
# these are not appended — that is how you drop the fallbacks or write your own.
SANS_TAIL='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
MONO_TAIL='ui-monospace, SFMono-Regular, Menlo, monospace'

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }
die()  { err "$1"; exit 1; }

usage() {
	cat <<'EOF'
Usage: set-font.sh [--sans NAME [--sans-file SRC] …] [--mono NAME [--mono-file SRC] …] | remove

  --sans NAME          the UI font family. Without a comma the theme's own fallbacks are
                       appended; with one the value is used as a complete stack.
  --sans-file SRC      a .woff2 URL or local path — this router will serve it
  --sans-bold-file SRC a second file for weight 700 (skip it for a variable font)
  --sans-weight W      what the @font-face CLAIMS. Leave it alone for a static face — the theme
                       sets body text at 600, and a face that claims 400-700 swallows it and
                       flattens every heading. Pass '100 900' for a variable font.
                                                       (default: 400, or "400 600" with a bold file)

  --mono NAME          the same four options for the monospace face
  --mono-file SRC
  --mono-bold-file SRC   (the theme assigns <strong> the sans face: there is no bold mono by design)
  --mono-weight W

  --max BYTES          per-file size cap                        (default: 524288)
  remove               delete every installed face and clear all three settings
  -h, --help           this text

Naming a family DECLARES that whole side: `--sans Inter` with no file removes any sans face this
script installed before, because the file belonged to the previous name. The side you do not
mention is left exactly as it is.
EOF
}

# --- arguments ------------------------------------------------------------
WHAT=""
SANS=""; SANS_FILE=""; SANS_BOLD=""; SANS_WEIGHT=""
MONO=""; MONO_FILE=""; MONO_BOLD=""; MONO_WEIGHT=""
while [ $# -gt 0 ]; do
	case "$1" in
		-h|--help) usage; exit 0 ;;
		--sans) [ $# -ge 2 ] || die "--sans needs a family name."; SANS="$2"; shift 2 ;;
		--sans-file) [ $# -ge 2 ] || die "--sans-file needs a URL or a path."; SANS_FILE="$2"; shift 2 ;;
		--sans-bold-file) [ $# -ge 2 ] || die "--sans-bold-file needs a URL or a path."; SANS_BOLD="$2"; shift 2 ;;
		--sans-weight) [ $# -ge 2 ] || die "--sans-weight needs a weight."; SANS_WEIGHT="$2"; shift 2 ;;
		--mono) [ $# -ge 2 ] || die "--mono needs a family name."; MONO="$2"; shift 2 ;;
		--mono-file) [ $# -ge 2 ] || die "--mono-file needs a URL or a path."; MONO_FILE="$2"; shift 2 ;;
		--mono-bold-file) [ $# -ge 2 ] || die "--mono-bold-file needs a URL or a path."; MONO_BOLD="$2"; shift 2 ;;
		--mono-weight) [ $# -ge 2 ] || die "--mono-weight needs a weight."; MONO_WEIGHT="$2"; shift 2 ;;
		--max) [ $# -ge 2 ] || die "--max needs a number."; FONT_MAX="$2"; shift 2 ;;
		-*) die "Unknown option '$1'. Try --help." ;;
		*) [ -z "$WHAT" ] || die "One command at a time."; WHAT="$1"; shift ;;
	esac
done

[ -z "$WHAT" ] || [ "$WHAT" = remove ] || die "'$WHAT' is not a command. Try --help."
# Before the empty-invocation check below, so that a file with no name gets the reason rather than
# the whole usage text.
[ -z "$SANS_FILE$SANS_BOLD$SANS_WEIGHT" ] || [ -n "$SANS" ] ||
	die "A sans file needs --sans NAME too: the @font-face has to be named something."
[ -z "$MONO_FILE$MONO_BOLD$MONO_WEIGHT" ] || [ -n "$MONO" ] ||
	die "A mono file needs --mono NAME too: the @font-face has to be named something."
if [ -z "$WHAT" ] && [ -z "$SANS" ] && [ -z "$MONO" ]; then usage; exit 1; fi

# The charset partials/head.ut accepts, stated here so a typo is refused where it is typed rather
# than dropped in silence at render time. It excludes < > ( ) { } ; and the backslash, which is what
# makes the value safe to print into the page unescaped — the same defence login_bg's hex has.
family_ok() {	# <stack>
	[ -n "$1" ] || return 1
	[ "${#1}" -le 120 ] || return 1
	printf '%s' "$1" | grep -qE "^[A-Za-z0-9 ,._\"'-]+$"
}
weight_ok() {	# <weight or range>
	printf '%s' "$1" | grep -qE '^[0-9]{1,4}( [0-9]{1,4})?$'
}
[ -z "$SANS" ] || family_ok "$SANS" ||
	die "'$SANS' is not a font-family the theme will print. Letters, digits, space, comma, dot, underscore, quotes and hyphen only, 120 characters at most — a Cyrillic family name has a Latin one too, use that."
[ -z "$MONO" ] || family_ok "$MONO" ||
	die "'$MONO' is not a font-family the theme will print. Letters, digits, space, comma, dot, underscore, quotes and hyphen only, 120 characters at most."
[ -z "$SANS_WEIGHT" ] || weight_ok "$SANS_WEIGHT" || die "--sans-weight takes a number or a range, e.g. 400 or '100 900'."
[ -z "$MONO_WEIGHT" ] || weight_ok "$MONO_WEIGHT" || die "--mono-weight takes a number or a range, e.g. 400 or '100 900'."
case "$FONT_MAX" in ''|*[!0-9]*) die "--max takes a number of bytes." ;; esac

# THE DEFAULT IS 400 AND THE REASON IS THE THEME'S BODY WEIGHT. footstrap sets --fs-weight: 600 on
# body text and 700 on titles and labels, so what a face CLAIMS decides whether any of that is
# visible: a single static face declared `400 700` covers both, the browser stops synthesising, and
# every heading renders in the regular face — the hierarchy quietly flattens. Declared 400 alone it
# synthesises 600 and 700 and the page reads as designed. A real variable font has the weights, so
# say so: --sans-weight '100 900'.
#
# With a bold file there are two real faces, and the split has to land on 600 rather than on 700 for
# the same reason: body text asks for 600, and whichever face claims it is the one the page is set
# in. Regular takes 400-600, bold takes 700.
[ -n "$SANS_WEIGHT" ] || { [ -n "$SANS_BOLD" ] && SANS_WEIGHT='400 600' || SANS_WEIGHT=400; }
[ -n "$MONO_WEIGHT" ] || { [ -n "$MONO_BOLD" ] && MONO_WEIGHT='400 600' || MONO_WEIGHT=400; }

# --- the router -----------------------------------------------------------
[ "$(id -u)" = 0 ] || die "Run this as root, on the router."
command -v uci >/dev/null 2>&1 || die "No uci — this is not an OpenWrt router."
[ -d /usr/share/ucode/luci/template/themes/footstrap ] ||
	info "luci-theme-footstrap does not look installed here; writing the settings anyway."

# uci refuses to CREATE a config file, only a section within one — and a router that installed a
# footstrap predating the Appearance defaults has no such file. Same two lines as uci-defaults.
[ -f /etc/config/footstrap ] || : > /etc/config/footstrap
uci -q get footstrap.settings >/dev/null 2>&1 || uci set footstrap.settings=footstrap

# --- remove ---------------------------------------------------------------
if [ "$WHAT" = remove ]; then
	rm -rf "$FONT_DIR"
	rm -f "$FONT_SERVE"
	uci set footstrap.settings.font_sans=''
	uci set footstrap.settings.font_mono=''
	uci set footstrap.settings.fonts=''
	uci commit footstrap
	ok "Fonts removed. The theme is back to the system stack."
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

TMPD="/tmp/fs-font.$$"
mkdir -p "$TMPD"
trap 'rm -rf "$TMPD"' EXIT INT TERM

# The first four bytes ARE the format. Read with head and compared as text, because a router has no
# way to read them as hex: busybox is built without the `od` applet on all four of this project's dev
# routers (25.12 and 24.10, OpenWrt and ImmortalWrt) — `od: applet not found`. That costs one thing,
# and the messages below are written around it: a command substitution drops NUL bytes, so `wOF2`
# and `wOFF` arrive intact while a TrueType file, whose signature is 0x00010000, arrives as a lone
# 0x01 and cannot be told from any other binary. The catch-all therefore names the conversion too,
# instead of pretending to know what the file is.
signature() {	# <file> -> the first four bytes, as text
	head -c 4 "$1" 2>/dev/null
}

# What is refused, and why each one. A font file is not a document — it cannot carry script the way
# an SVG can — so this is about the two things that actually go wrong on a router: a file that is
# not a font, and a file that fills the overlay.
stage() {	# <slot> <src> -> writes $TMPD/<slot>.font and $TMPD/<slot>.fmt
	slot="$1"; src="$2"; out="$TMPD/$slot.font"
	if [ -f "$src" ]; then
		info "Reading $src"
		cat "$src" > "$out"
	else
		case "$src" in
			*://*) info "Downloading $src"; fetch "$src" "$out" || die "Download failed: $src" ;;
			*) die "'$src' is neither a URL nor a file." ;;
		esac
	fi
	[ -s "$out" ] || die "Got an empty file for $slot."
	bytes=$(wc -c < "$out" | tr -d ' ')
	[ "$bytes" -le "$FONT_MAX" ] ||
		die "$slot is ${bytes} bytes; the cap is ${FONT_MAX}. Raise it with --max if the router has the flash."
	# A .ttf or .otf is refused rather than served: there is no compressor on a router, and the same
	# face is three to five times the bytes uncompressed. Convert it on your own machine first.
	# The extension follows the SIGNATURE, never the source name: uhttpd types a response by
	# extension, and a woff1 body served as .woff2 is a file that describes itself twice, wrongly.
	case "$(signature "$out")" in
		wOF2) echo woff2 > "$TMPD/$slot.fmt" ;;
		wOFF) echo woff  > "$TMPD/$slot.fmt" ;;
		OTTO|ttcf|true)
			die "$slot is a raw OpenType/TrueType file. Convert it to .woff2 first (fonttools: \`fonttools ttLib.woff2 compress FILE\`, or woff2_compress from google/woff2)." ;;
		*)
			die "$slot is not a woff2 or woff file. If it is a .ttf or .otf, convert it to .woff2 first (fonttools: \`fonttools ttLib.woff2 compress FILE\`, or woff2_compress from google/woff2) — there is no compressor on a router and the same face is three to five times the bytes uncompressed." ;;
	esac
}

# slot|src, newline separated so a path with a space in it survives. A slot is staged only when its
# side was named on the command line.
SLOTS=""
add_slot() {	# <slot> <src>
	[ -n "$2" ] || return 0
	SLOTS="$SLOTS
$1|$2"
}
if [ -n "$SANS" ]; then
	add_slot sans "$SANS_FILE"
	add_slot sans-bold "$SANS_BOLD"
fi
if [ -n "$MONO" ]; then
	add_slot mono "$MONO_FILE"
	add_slot mono-bold "$MONO_BOLD"
fi

OLDIFS="$IFS"
IFS='
'
for line in $SLOTS; do
	[ -n "$line" ] || continue
	IFS="$OLDIFS"
	stage "${line%%|*}" "${line#*|}"
	IFS='
'
done
IFS="$OLDIFS"

# --- room for it ----------------------------------------------------------
# A full overlay does not fail loudly: `uci commit` writes a truncated config and reports nothing,
# and the next boot reads what is left. So check before writing, with the new bytes counted twice —
# once for the file, once for the copy the filesystem makes while writing it.
STAGED=0
for f in "$TMPD"/*.font; do
	[ -f "$f" ] || continue
	STAGED=$((STAGED + $(wc -c < "$f" | tr -d ' ')))
done
if [ "$STAGED" -gt 0 ]; then
	AVAIL_KB=$(df -k /etc 2>/dev/null | awk 'NR>1 { print $4; exit }')
	NEED_KB=$(( (STAGED / 1024 + 1) * 2 ))
	case "${AVAIL_KB:-}" in
		''|*[!0-9]*) info "Cannot read the free space on /etc; installing anyway." ;;
		*) [ "$AVAIL_KB" -ge "$NEED_KB" ] ||
			die "${NEED_KB} kB needed on /etc, ${AVAIL_KB} kB free. Free some flash first — a full overlay corrupts uci writes silently." ;;
	esac
fi

# --- install --------------------------------------------------------------
# /etc, so a package upgrade cannot delete it and lib/upgrade/keep.d carries it over a sysupgrade.
mkdir -p "$FONT_DIR"
chmod 0755 /etc/footstrap "$FONT_DIR"
[ -f "$FACES" ] || : > "$FACES"

# Naming a side replaces it whole: the file that is there belongs to the name that was there.
drop_role() {	# <sans|mono>
	rm -f "$FONT_DIR/$1.woff2" "$FONT_DIR/$1.woff" "$FONT_DIR/$1-bold.woff2" "$FONT_DIR/$1-bold.woff"
	# grep exits 1 when nothing survives the filter, which is a normal outcome here and not an
	# error — the redirect has already produced the empty file we want.
	grep -v "^$1|" "$FACES" > "$FACES.new" || true
	mv "$FACES.new" "$FACES"
}
[ -z "$SANS" ] || drop_role sans
[ -z "$MONO" ] || drop_role mono

# `role|weight|filename`, one line per installed face. The sheet is regenerated from this file and
# not from the arguments, so naming only the mono side leaves the sans faces exactly where they are.
install_face() {	# <slot> <role> <weight>
	[ -f "$TMPD/$1.font" ] || return 0
	dest="$1.$(cat "$TMPD/$1.fmt")"
	cat "$TMPD/$1.font" > "$FONT_DIR/$dest"
	# uhttpd refuses to SERVE a file that is not world-readable (measured on the pattern: 0600 -> 403).
	chmod 0644 "$FONT_DIR/$dest"
	printf '%s|%s|%s\n' "$2" "$3" "$dest" >> "$FACES"
}
install_face sans      sans "$SANS_WEIGHT"
install_face sans-bold sans 700
install_face mono      mono "$MONO_WEIGHT"
install_face mono-bold mono 700

# --- the settings ---------------------------------------------------------
# A value with a comma is a complete stack and is written as typed; a bare family name gets the
# theme's own fallbacks, so a visitor without the font still lands on system-ui rather than on the
# browser's default serif.
stack() {	# <name> <tail>
	case "$1" in *,*) printf '%s' "$1" ;; *) printf '%s, %s' "$1" "$2" ;; esac
}
[ -z "$SANS" ] || uci set footstrap.settings.font_sans="$(stack "$SANS" "$SANS_TAIL")"
[ -z "$MONO" ] || uci set footstrap.settings.font_mono="$(stack "$MONO" "$MONO_TAIL")"

# --- the sheet ------------------------------------------------------------
# @font-face only, never a :root block: the family stack reaches the page from head.ut, so
# `uci set footstrap.settings.font_sans=…` by hand takes effect without regenerating anything here.
first_family() {	# "Inter, system-ui" -> Inter
	printf '%s' "${1%%,*}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | tr -d '"'
}
SANS_NAME=$(first_family "$(uci -q get footstrap.settings.font_sans || true)")
MONO_NAME=$(first_family "$(uci -q get footstrap.settings.font_mono || true)")

if [ -s "$FACES" ]; then
	{
		echo "/* Generated by fonts/set-font.sh. Do not edit — re-run the script instead."
		echo "   Served at $FONT_URL/ through the symlink uci-defaults makes; the theme's own"
		echo "   cascade.css knows nothing about it. */"
		while IFS='|' read -r role weight file; do
			[ -n "${file:-}" ] || continue
			[ -f "$FONT_DIR/$file" ] || continue
			case "$role" in sans) name="$SANS_NAME" ;; mono) name="$MONO_NAME" ;; *) continue ;; esac
			[ -n "$name" ] || continue
			case "$(signature "$FONT_DIR/$file")" in wOF2) fmt=woff2 ;; *) fmt=woff ;; esac
			# The file name is fixed, so the URL needs a version key of its own: without it a
			# browser that cached the previous face keeps drawing it after a re-run.
			v=$(md5sum "$FONT_DIR/$file" | cut -d' ' -f1)
			printf '@font-face { font-family: "%s"; src: url("%s/%s?v=%s") format("%s"); font-weight: %s; font-style: normal; font-display: swap; }\n' \
				"$name" "$FONT_URL" "$file" "$v" "$fmt" "$weight"
		done < "$FACES"
	} > "$SHEET"
	chmod 0644 "$SHEET"
	TOKEN=$(md5sum "$SHEET" | cut -d' ' -f1)
else
	rm -f "$SHEET"
	TOKEN=""
fi
uci set footstrap.settings.fonts="$TOKEN"
uci commit footstrap

# uhttpd serves only /www and follows symlinks. Linking a DIRECTORY has two traps and both end the
# same way — `ln` exits 0 and the link lands at .../fonts/fonts, one level too deep, where no
# browser looks: an existing symlink to a directory is followed (that is what -n prevents), and a
# REAL directory is entered (which -n does not prevent — measured on a 25.12 router: exit 0, link
# created inside). Every footstrap before 0.12.1 shipped exactly such a directory here, full of the
# woff2 files it used to carry, so this is the ordinary case on an upgraded router, not a corner.
# uci-defaults does the same two steps on every install; do them here too, for a router whose
# installed theme predates them.
if [ -d /www/luci-static/footstrap ]; then
	if [ -e "$FONT_SERVE" ] && [ ! -L "$FONT_SERVE" ]; then
		info "Clearing the old $FONT_SERVE directory (webfonts a footstrap before 0.12.1 shipped)."
		rm -rf "$FONT_SERVE"
	fi
	ln -sfn "$FONT_DIR" "$FONT_SERVE"
elif [ -n "$TOKEN" ]; then
	err "No /www/luci-static/footstrap — is the theme installed? The files are in place, but nothing serves them."
fi

# --- what happened --------------------------------------------------------
[ -z "$SANS" ] || ok "Sans: $(uci -q get footstrap.settings.font_sans)"
[ -z "$MONO" ] || ok "Mono: $(uci -q get footstrap.settings.font_mono)"
if [ -n "$TOKEN" ]; then
	# The count is what is on the router now, not what this run installed: naming one side leaves
	# the other side's faces exactly where they were.
	ok "$(grep -c . "$FACES") face(s) on this router, $(du -sk "$FONT_DIR" | cut -f1) kB of flash, served from $FONT_URL/."
else
	info "No font file installed: the names above render only for visitors who have that font."
fi
ok "Reload LuCI to see it. This is a router-wide setting; there is no per-browser layer to reset."

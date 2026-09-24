#!/bin/sh
# Rename the PRIVATE `--fs-*` custom properties in a built cascade.css to short names.
#
#   ./mangle-tokens.sh <cascade.css> <reserved-source-dir>...
#
# Run from the package Makefile over $(PKG_BUILD_DIR) only, never over a dev build. The names are
# 16.6% of the sheet and mean nothing to a browser; this is the same trade terser makes for the JS.
# Measured: 135655 -> 123935 bytes, and uhttpd serves /www with no compression, so those are wire
# bytes on every cold load as well as flash bytes.
#
# Why it is safe, each clause checked rather than assumed:
#   * `--fs-*` is the PRIVATE tier. The outbound contract with third-party apps is the `--*-color-*`
#     export tier, a different prefix, and it is not touched. Verified on the router: no installed
#     luci-app reads a `--fs-` name.
#   * The RESERVED set is DERIVED, not listed: every `--fs-` name appearing in the theme's JS or in
#     a .ut template crosses a seam and keeps its name, so a new one cannot be forgotten.
#   * Point the dirs at the SOURCE tree, not at $(PKG_BUILD_DIR): in CI the build tree's JS has
#     already been through terser and its comments are gone, so a name that only appears in a
#     comment stops being reserved and the same source produces a different sheet depending on who
#     built it. Reading the source over-reserves by about a kilobyte, which is the direction that
#     cannot break anything.
#   * The scan is string-aware and reads the WHOLE identifier before deciding: a prefix match would
#     be a silent corruption, `--fs-space-2` being a prefix of `--fs-space-2-5`.
#   * The short names are `--a`…`--z`, `--A`…`--Z`, then `--aa`…. The shortest custom property
#     otherwise present is 5 characters, so a collision is impossible; the script re-checks that
#     rather than trusting it.
#
# What it costs: the SHIPPED sheet is unreadable when debugging on a router. Everything that reads
# the theme's own names runs against an unmangled build, which is why this is a package-build step
# and not part of build-css.sh. Verify a change here with cssdiff.py, mangled against plain.
set -e

CSS="${1:-}"
[ -n "$CSS" ] && [ -f "$CSS" ] || { echo "usage: mangle-tokens.sh <cascade.css> <dir>..." >&2; exit 1; }
shift
# --rewrite <dir>… : the seam names are mangled TOO, and the same map is applied to the JS and
# templates in those directories. Without it they are reserved, which is the safe default and what
# an SDK build (no second pass to rewrite) needs.
#
# The seam is safe to rename only because every `--fs-` reference on the far side is a WHOLE string
# literal — `setProperty('--fs-accent', …)`, never `'--fs-' + role`. Checked across all 89 sites;
# if one is ever composed, this flag renames the CSS and the JS keeps asking for a name that no
# longer exists, silently. The 36 seam names cost 8,574 B in the sheet, `--fs-accent` alone 1,452.
REWRITE=""
RESERVE_DIRS=""
REWRITE_DIRS=""
seen=""
for a in "$@"; do
	if [ "$a" = "--rewrite" ]; then seen=1; REWRITE=1; continue; fi
	if [ -n "$seen" ]; then REWRITE_DIRS="$REWRITE_DIRS $a"; else RESERVE_DIRS="$RESERVE_DIRS $a"; fi
done
# shellcheck disable=SC2086 -- the dirs are ours, and a path with a space would already have broken
# every other loop in this package's build
set -- $RESERVE_DIRS

[ $# -gt 0 ] || { echo "mangle-tokens: no reserved-source dir given" >&2; exit 1; }

RES="$CSS.reserved.$$"
MAP="$CSS.map.$$"
UNSORTED="$CSS.unsorted.$$"
SORTED="$CSS.sorted.$$"
trap 'rm -f "$RES" "$MAP" "$MAP.ord" "$UNSORTED" "$SORTED" "$CSS.tmp.$$"' EXIT

if [ -n "$REWRITE" ]; then
	# nothing is reserved: every name is renamed here and in the far side together
	: > "$RES"
else
	# every --fs- name mentioned anywhere in the JS or the templates keeps its name
	for d in "$@"; do
		[ -d "$d" ] || { echo "mangle-tokens: $d is not a directory" >&2; exit 1; }
		find "$d" -type f \( -name '*.js' -o -name '*.ut' \) -exec cat {} +
	done | grep -oE -- '--fs-[a-z0-9-]+' | sort -u > "$RES"

	[ -s "$RES" ] || { echo "mangle-tokens: reserved set came out EMPTY — refusing (a seam name would be renamed and the theme would break silently)" >&2; exit 1; }
fi

# ---- pass 1: count every manglable --fs- name, string-aware, write unsorted ----
#
# RESFILE/UNSORTFILE travel through ENVIRON, not `-v` (and not a bare `var=value` operand, which
# awk treats the same way): both run the value through awk's OWN escape-sequence processing before
# use, so a path holding a literal `\t` or `\n` (a `$CSS` an OpenWrt buildbot handed us, not ours to
# assume ASCII-clean) is silently rewritten into a tab or newline and no longer names the file that
# is actually there. ENVIRON reads the environment string verbatim.
RESFILE="$RES" UNSORTFILE="$UNSORTED" awk '
	function isname(c) { return (c ~ /[A-Za-z0-9_-]/) }
	# read the identifier starting at i (which points at the first "-" of "--")
	function ident(s, i,   j, n) {
		n = length(s); j = i
		while (j <= n && isname(substr(s, j, 1))) j++
		return substr(s, i, j - i)
	}
	BEGIN {
		RESFILE = ENVIRON["RESFILE"]; UNSORTFILE = ENVIRON["UNSORTFILE"]
		while ((getline line < RESFILE) > 0) reserved[line] = 1
		q = ""
	}
	{ css = css $0 "\n" }
	END {
		n = length(css); i = 1
		while (i <= n) {
			c = substr(css, i, 1)
			if (q != "") { if (c == "\\") { i += 2; continue } ; if (c == q) q = ""; i++; continue }
			if (c == "\"" || c == "'"'"'") { q = c; i++; continue }
			if (c == "-" && substr(css, i, 5) == "--fs-") {
				id = ident(css, i)
				if (!(id in reserved)) { if (!(id in cnt)) order[++ncnt] = id; cnt[id]++ }
				i += length(id); continue
			}
			i++
		}
		for (x = 1; x <= ncnt; x++) print cnt[order[x]], order[x] > UNSORTFILE
	}
' "$CSS"

# sort(1) runs here, in the SHELL, never as a string awk pipes to: building that string by
# concatenating a path in ("sort ... > \"" PATH "\"") lets a `"` in the path break out of the
# quoting. "$SORTED" is a normal shell expansion instead, safe whatever bytes CSS holds.
sort -k1,1nr -k2,2 "$UNSORTED" > "$SORTED" || { echo "mangle-tokens: sort failed" >&2; exit 1; }

# sort must neither drop nor duplicate a line; a bad exit status is not the only way it can lie.
ncnt=$(wc -l < "$UNSORTED" | tr -d ' ')
nsorted=$(wc -l < "$SORTED" | tr -d ' ')
[ "$ncnt" = "$nsorted" ] || {
	echo "mangle-tokens: sort produced $nsorted line(s) from $ncnt — refusing" >&2
	exit 1
}

# ---- pass 2: short-name alphabet from the sorted order (hottest name shortest), then rewrite ----
# SORTFILE/MAPFILE/OUTFILE via ENVIRON too — see the note above pass 1.
SORTFILE="$SORTED" MAPFILE="$MAP" OUTFILE="$CSS.tmp.$$" awk '
	function isname(c) { return (c ~ /[A-Za-z0-9_-]/) }
	function ident(s, i,   j, n) {
		n = length(s); j = i
		while (j <= n && isname(substr(s, j, 1))) j++
		return substr(s, i, j - i)
	}
	BEGIN {
		SORTFILE = ENVIRON["SORTFILE"]; MAPFILE = ENVIRON["MAPFILE"]; OUTFILE = ENVIRON["OUTFILE"]
		x = 0
		while ((getline sline < SORTFILE) > 0) { split(sline, sf, " "); order[++x] = sf[2]; cnt[sf[2]] = sf[1] }
		ncnt = x

		A = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
		nsh = 0
		for (a = 1; a <= 52; a++) short[++nsh] = "--" substr(A, a, 1)
		for (a = 1; a <= 52; a++) for (b = 1; b <= 52; b++) short[++nsh] = "--" substr(A, a, 1) substr(A, b, 1)
		if (ncnt > nsh) { print "mangle-tokens: more names than short forms" > "/dev/stderr"; exit 1 }
		q = ""
	}
	{ css = css $0 "\n" }
	END {
		n = length(css)
		for (x = 1; x <= ncnt; x++) {
			map[order[x]] = short[x]
			# a mangled name must not already exist in the sheet
			if (index(css, short[x] ":") || index(css, "var(" short[x] ")")) {
				print "mangle-tokens: " short[x] " already used in the sheet" > "/dev/stderr"; exit 1
			}
			print order[x] " -> " short[x] " x" cnt[order[x]] > MAPFILE
		}

		q = ""; i = 1; out = ""
		while (i <= n) {
			c = substr(css, i, 1)
			if (q != "") { if (c == "\\") { out = out substr(css, i, 2); i += 2; continue }
			               if (c == q) q = ""; out = out c; i++; continue }
			if (c == "\"" || c == "'"'"'") { q = c; out = out c; i++; continue }
			if (c == "-" && substr(css, i, 5) == "--fs-") {
				id = ident(css, i)
				out = out ((id in map) ? map[id] : id)
				i += length(id); continue
			}
			out = out c; i++
		}
		printf "%s", out > OUTFILE
		print ncnt " names mangled, " (length(css) - length(out)) " bytes saved" > "/dev/stderr"
	}
' "$CSS"

before=$(wc -c < "$CSS")
mv "$CSS.tmp.$$" "$CSS"
after=$(wc -c < "$CSS")
echo "mangle-tokens: $before -> $after bytes (-$((before - after))), $(wc -l < "$RES") name(s) reserved"

# ---- the far side of the seam, renamed with the same map ----
if [ -n "$REWRITE" ]; then
	[ -s "$MAP" ] || { echo "mangle-tokens: --rewrite asked for, but the map is empty" >&2; exit 1; }
	# NEVER the checkout. This rewrites files in place, so a target under the directory this script
	# itself lives in is the source tree, and renaming the seam there destroys it — measured the
	# hard way: a mistake in the argument split sent $SRC here instead of $STAGE and rewrote eight
	# shipped modules and a template before anything noticed.
	SELF_DIR=$(cd "$(dirname "$0")" && pwd -P)
	for d in $REWRITE_DIRS; do
		abs=$(cd "$d" 2>/dev/null && pwd -P) || { echo "mangle-tokens: --rewrite target $d is not a directory" >&2; exit 1; }
		case "$abs/" in
			"$SELF_DIR"/*) echo "mangle-tokens: --rewrite target $d is inside the source tree ($SELF_DIR) — refusing, this rewrites in place" >&2; exit 1 ;;
		esac
	done
	# longest first, or `--fs-accent` would rewrite the head of `--fs-accent-h`
	awk '{ print $1, $3 }' "$MAP" | awk '{ print length($1), $0 }' | sort -rn | cut -d" " -f2- > "$MAP.ord"
	touched=0
	for d in $REWRITE_DIRS; do
		[ -d "$d" ] || { echo "mangle-tokens: --rewrite target $d is not a directory" >&2; exit 1; }
		for f in $(find "$d" -type f \( -name '*.js' -o -name '*.ut' \)); do
			awk -v MAPF="$MAP.ord" '
				BEGIN { while ((getline l < MAPF) > 0) { split(l, a, " "); from[++k] = a[1]; to[k] = a[2] } }
				{ for (x = 1; x <= k; x++) gsub(from[x], to[x]); print }
			' "$f" > "$f.tmp$$" && mv "$f.tmp$$" "$f"
			touched=$((touched + 1))
		done
	done
	rm -f "$MAP.ord"
	echo "mangle-tokens: seam renamed in $touched file(s)"
fi

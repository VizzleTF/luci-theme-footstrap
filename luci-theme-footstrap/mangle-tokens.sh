#!/bin/sh
# Rename the PRIVATE `--fs-*` custom properties in a built cascade.css to short names, then join its rules.
#   ./mangle-tokens.sh <cascade.css> <rewrite-dir>...
#
# Run from the Makefile and tools/stage.sh over a BUILD tree only, never the checkout. The names are
# 14% of the sheet: 18283 of 134210 bytes (measured 2026-10-14), wire bytes too: uhttpd serves /www
# uncompressed.
# The same map rewrites the .js and .ut under each <rewrite-dir> in place, BEFORE `strip-build.sh
# templates` and the JS minifier.
# Safe because (each checked):
#   * `--fs-*` is the private tier; the export tier `--*-color-*` is untouched, and no installed
#     luci-app reads a `--fs-` name.
#   * every far-side `--fs-` is a WHOLE string literal (83 sites, measured 2026-10-14); a composed
#     `'--fs-' + role` would silently ask for a name that no longer exists.
#   * the scan reads the whole identifier (`--fs-space-2` prefixes `--fs-space-2-5`); short names
#     `--a`…`--Z`, `--aa`… cannot collide (shortest existing property is 5 chars).
# Cost: the shipped sheet is unreadable on a router, hence a package step, not build-css.sh.
set -eu

CSS="${1:-}"
[ -n "$CSS" ] && [ -f "$CSS" ] && [ $# -ge 2 ] || { echo "usage: mangle-tokens.sh <cascade.css> <rewrite-dir>..." >&2; exit 2; }
shift

# NEVER the checkout: a target under this script's own directory is the source tree, and an
# in-place rename there destroys it (a bad argument split once rewrote eight modules and a template).
SELF_DIR=$(cd "$(dirname "$0")" && pwd -P)
for d in "$@"; do
	abs=$(cd "$d" 2>/dev/null && pwd -P) || { echo "mangle-tokens: $d is not a directory" >&2; exit 1; }
	case "$abs/" in
		"$SELF_DIR"/*) echo "mangle-tokens: $d is inside the source tree ($SELF_DIR) — refusing, this rewrites in place" >&2; exit 1 ;;
	esac
done

MAP="$CSS.map.$$"
UNSORTED="$CSS.unsorted.$$"
SORTED="$CSS.sorted.$$"
LIST="$CSS.list.$$"
CUR=""
trap 'rm -f "$MAP" "$MAP.ord" "$UNSORTED" "$SORTED" "$CSS.tmp.$$" "$CSS.one.$$" "$LIST" ${CUR:+"$CUR"}' EXIT
trap 'exit 130' INT TERM

# ---- pass 1: count every manglable --fs- name, string-aware, write unsorted ----
#
# Paths travel through ENVIRON, not `-v` or `var=value`: those run awk's escape processing, so a
# literal `\t` in a buildbot-supplied path becomes a tab and names no file. ENVIRON is verbatim.
UNSORTFILE="$UNSORTED" awk '
	function isname(c) { return (c ~ /[A-Za-z0-9_-]/) }
	# read the identifier starting at i (which points at the first "-" of "--")
	function ident(s, i,   j, n) {
		n = length(s); j = i
		while (j <= n && isname(substr(s, j, 1))) j++
		return substr(s, i, j - i)
	}
	BEGIN {
		UNSORTFILE = ENVIRON["UNSORTFILE"]
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
				if (!(id in cnt)) order[++ncnt] = id
				cnt[id]++
				i += length(id); continue
			}
			i++
		}
		for (x = 1; x <= ncnt; x++) print cnt[order[x]], order[x] > UNSORTFILE
	}
' "$CSS"

# sort runs in the SHELL: a path concatenated into an awk pipe string lets a `"` break the quoting.
sort -k1,1nr -k2,2 "$UNSORTED" > "$SORTED" || { echo "mangle-tokens: sort failed" >&2; exit 1; }

# ---- pass 2: short-name alphabet from the sorted order (hottest name shortest), then rewrite ----
# SORTFILE/MAPFILE/OUTFILE via ENVIRON too (see pass 1).
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
		print "mangle-tokens: " ncnt " names mangled, " (length(css) - length(out)) " bytes saved" > "/dev/stderr"
	}
' "$CSS"

before=$(wc -c < "$CSS")
# most of the sheet's newlines (1009 of 1021, measured 2026-10-14) follow a rule's `}`: dead bytes on
# every cold page. A /*! banner keeps its lines.
awk '
	inb || /\/\*!/ { inb = !/\*\//; last = $0; print; next }
	{ printf "%s%s", $0, (/}$/ ? "" : "\n"); last = $0 }
	END { if (last ~ /}$/) printf "\n" }
' "$CSS.tmp.$$" > "$CSS.one.$$" || { echo "mangle-tokens: awk failed on the join — refusing" >&2; exit 1; }
mv "$CSS.one.$$" "$CSS"
after=$(wc -c < "$CSS")
echo "mangle-tokens: $before -> $after bytes (-$((before - after)))"

# ---- the far side of the seam, renamed with the same map ----
[ -s "$MAP" ] || { echo "mangle-tokens: the map is empty — refusing" >&2; exit 1; }
# longest first, or `--fs-accent` would rewrite the head of `--fs-accent-h`
awk '{ print $1, $3 }' "$MAP" | awk '{ print length($1), $0 }' | sort -rn | cut -d" " -f2- > "$MAP.ord"
touched=0
# a list file, not `for f in $(find …)`: that splits a path on whitespace (strip-build.sh does the same)
for d in "$@"; do find "$d" -type f \( -name '*.js' -o -name '*.ut' \); done > "$LIST"
while IFS= read -r f; do
	CUR="$f.tmp$$"
	# ENVIRON, not `-v`: a `\t` in the map path reads 0 lines and the JS stays unrenamed (see pass 1)
	MAPF="$MAP.ord" awk '
		BEGIN { MAPF = ENVIRON["MAPF"]; while ((getline l < MAPF) > 0) { split(l, a, " "); from[++k] = a[1]; to[k] = a[2] } }
		{ for (x = 1; x <= k; x++) gsub(from[x], to[x]); print }
	' "$f" > "$CUR" || { echo "mangle-tokens: awk failed on $f — refusing" >&2; exit 1; }
	mv "$CUR" "$f"
	CUR=""
	touched=$((touched + 1))
done < "$LIST"
rm -f "$MAP.ord"
echo "mangle-tokens: seam renamed in $touched file(s)"

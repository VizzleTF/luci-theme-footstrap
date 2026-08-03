#!/bin/sh
# Rename the PRIVATE `--fs-*` custom properties in a built cascade.css to short names.
#
#   ./mangle-tokens.sh <cascade.css> <reserved-source-dir>...
#
# Run from the package Makefile over $(PKG_BUILD_DIR) only — NEVER over a dev build. The names are
# 16.1% of the sheet (21640 B over 1770 occurrences, 123 distinct) and mean nothing to a browser;
# this is the same trade terser already makes for the JS, where top-level identifiers are mangled
# because a LuCI resource file is function-scoped. Measured: 134240 -> ~119600, i.e. -14.6 KB, and
# uhttpd serves /www with no compression, so those are wire bytes on every cold load as well as
# flash bytes.
#
# WHY IT IS SAFE, and each clause is a thing that was checked rather than assumed:
#   * `--fs-*` is the PRIVATE tier. The outbound contract with third-party apps is the `--*-color-*`
#     export tier, a different prefix, and it is not touched. Verified on the router: no installed
#     luci-app reads a `--fs-` name.
#   * The RESERVED set is DERIVED, not listed: every `--fs-` name that appears in the theme's JS or
#     in a .ut template crosses a seam (fs-prefs.js writes `--fs-tint`, head.ut's pre-paint writes
#     `--fs-radius-base`, fs-chrome.js reads `--fs-sidebar-w` …) and keeps its name. 15 of 123 today.
#     A new one cannot be forgotten, because nothing here names them.
#   * Point the dirs at the SOURCE tree, not at $(PKG_BUILD_DIR). In CI the build tree's JS has
#     already been through terser and its comments are gone, so five names that only appear in a
#     comment stopped being reserved — the same source produced a different sheet depending on who
#     built it (10 reserved via CI, 15 via a plain SDK build). Reading the source over-reserves by
#     about a kilobyte, and over-reserving is the direction that cannot break anything.
#   * The scan is STRING-AWARE and reads the WHOLE identifier before deciding. A prefix match would
#     be a silent corruption: `--fs-space-2` is a prefix of `--fs-space-2-5`.
#   * The short names are `--a`…`--z`, `--A`…`--Z`, then `--aa`… . The shortest custom property
#     otherwise present in this sheet is 5 characters (`--box`), so a collision is impossible;
#     the script re-checks that instead of trusting it.
#
# What it costs: the SHIPPED sheet is unreadable when debugging on a router. Everything that reads
# the theme's own names — dev-sync.sh, galdiff.py, the a11y gate, docs/gallery.html (4 references)
# and docs/devkit (29) — runs against an unmangled build, which is why this is a package-build step
# and not part of build-css.sh. Verify a change here with cssdiff.py, mangled against plain.
set -e

CSS="${1:-}"
[ -n "$CSS" ] && [ -f "$CSS" ] || { echo "usage: mangle-tokens.sh <cascade.css> <dir>..." >&2; exit 1; }
shift
[ $# -gt 0 ] || { echo "mangle-tokens: no reserved-source dir given" >&2; exit 1; }

RES="$CSS.reserved.$$"
MAP="$CSS.map.$$"
trap 'rm -f "$RES" "$MAP" "$CSS.tmp.$$"' EXIT

# every --fs- name mentioned anywhere in the JS or the templates keeps its name
for d in "$@"; do
	[ -d "$d" ] || { echo "mangle-tokens: $d is not a directory" >&2; exit 1; }
	find "$d" -type f \( -name '*.js' -o -name '*.ut' \) -exec cat {} +
done | grep -oE -- '--fs-[a-z0-9-]+' | sort -u > "$RES"

[ -s "$RES" ] || { echo "mangle-tokens: reserved set came out EMPTY — refusing (a seam name would be renamed and the theme would break silently)" >&2; exit 1; }

awk -v RESFILE="$RES" -v MAPFILE="$MAP" '
	function isname(c) { return (c ~ /[A-Za-z0-9_-]/) }
	# read the identifier starting at i (which points at the first "-" of "--")
	function ident(s, i,   j, n) {
		n = length(s); j = i
		while (j <= n && isname(substr(s, j, 1))) j++
		return substr(s, i, j - i)
	}
	BEGIN {
		while ((getline line < RESFILE) > 0) reserved[line] = 1
		q = ""
	}
	{ css = css $0 "\n" }
	END {
		n = length(css)

		# ---- pass 1: count every manglable name, string-aware ----
		i = 1
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

		# ---- short-name alphabet, hottest name gets the shortest ----
		A = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
		nsh = 0
		for (a = 1; a <= 52; a++) short[++nsh] = "--" substr(A, a, 1)
		for (a = 1; a <= 52; a++) for (b = 1; b <= 52; b++) short[++nsh] = "--" substr(A, a, 1) substr(A, b, 1)

		# selection sort by count (asort() is not portable to busybox/mawk)
		for (x = 1; x <= ncnt; x++) {
			best = x
			for (y = x + 1; y <= ncnt; y++) if (cnt[order[y]] > cnt[order[best]]) best = y
			t = order[x]; order[x] = order[best]; order[best] = t
		}
		if (ncnt > nsh) { print "mangle-tokens: more names than short forms" > "/dev/stderr"; exit 1 }
		for (x = 1; x <= ncnt; x++) {
			map[order[x]] = short[x]
			# a mangled name must not already exist in the sheet
			if (index(css, short[x] ":") || index(css, "var(" short[x] ")")) {
				print "mangle-tokens: " short[x] " already used in the sheet" > "/dev/stderr"; exit 1
			}
			print order[x] " -> " short[x] " x" cnt[order[x]] > MAPFILE
		}

		# ---- pass 2: rewrite ----
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
' OUTFILE="$CSS.tmp.$$" "$CSS"

before=$(wc -c < "$CSS")
mv "$CSS.tmp.$$" "$CSS"
after=$(wc -c < "$CSS")
echo "mangle-tokens: $before -> $after bytes (-$((before - after))), $(wc -l < "$RES") name(s) reserved"

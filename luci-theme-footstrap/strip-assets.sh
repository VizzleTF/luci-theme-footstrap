#!/bin/sh
# Strip the two static assets nothing else strips: the SVG favicon's comment and the manifest's
# indentation. Over a BUILD TREE, never the checkout — the comment is a "why" git keeps, and
# `logo.svg` is also the source `tools/build-icons.mjs` rasterises the PNGs from.
#
# Small, but honest bytes: the favicon is fetched by every browser on every cold visit, and uhttpd
# serves it uncompressed like everything else. 1,360 -> ~590 B for the SVG, 366 -> ~310 B for the
# manifest.
#
# Why not `strip-templates.sh`: that one is line-oriented and only removes comments from column one,
# which is right for a template and wrong for a single-line XML document.
#
# Usage: strip-assets.sh <dir>
set -eu

DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "usage: strip-assets.sh <dir>" >&2; exit 2; }

found=0

# ---- SVG: drop XML comments, then the whitespace BETWEEN tags only ----
# Never inside a tag: `viewBox="-9 -1 100 100"` and `d="M2 3 L4 5"` are attribute values whose
# spaces are data. Only `>   <` is collapsed to `><`.
for f in $(find "$DIR" -type f -name '*.svg' | sort); do
	tmp="$f.tmp$$"
	awk '
		BEGIN { RS = "\0" }
		{
			# comments first: they may span lines and may contain angle brackets
			while (match($0, /<!--([^-]|-[^-]|--[^>])*-->/)) {
				$0 = substr($0, 1, RSTART - 1) substr($0, RSTART + RLENGTH)
			}
			gsub(/>[ \t\r\n]+</, "><")
			gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "")
			printf "%s", $0
		}
	' "$f" > "$tmp"
	# a truncated write must never ship: the same floor build-css.sh keeps
	if [ ! -s "$tmp" ] || [ "$(wc -c < "$tmp")" -lt 100 ]; then
		rm -f "$tmp"
		echo "strip-assets: $f came out implausibly small — refusing" >&2
		exit 1
	fi
	mv "$tmp" "$f"
	found=$((found + 1))
done

# ---- JSON: one line, no indentation ----
# Structure only. A value keeps every byte, so a name or a URL with a space survives.
for f in $(find "$DIR" -type f -name '*.json' ! -path '*/rpcd/acl.d/*' | sort); do
	tmp="$f.tmp$$"
	# acl.d is excluded on purpose: rpcd skips a malformed ACL SILENTLY, so the grant would go to
	# nobody and only Save-as-default and the upload would break, on someone else's router. Those
	# files are also never fetched over the wire. Not worth the risk for ~200 B.
	awk '
		BEGIN { RS = "\0"; q = 0 }
		{
			out = ""
			n = length($0)
			for (i = 1; i <= n; i++) {
				c = substr($0, i, 1)
				if (q) {
					out = out c
					if (c == "\\") { out = out substr($0, i + 1, 1); i++; continue }
					if (c == "\"") q = 0
					continue
				}
				if (c == "\"") { q = 1; out = out c; continue }
				if (c == " " || c == "\t" || c == "\n" || c == "\r") continue
				out = out c
			}
			printf "%s", out
		}
	' "$f" > "$tmp"
	if [ ! -s "$tmp" ]; then
		rm -f "$tmp"
		echo "strip-assets: $f came out empty — refusing" >&2
		exit 1
	fi
	mv "$tmp" "$f"
	found=$((found + 1))
done

[ "$found" -gt 0 ] || { echo "strip-assets: no .svg or .json in $DIR" >&2; exit 1; }
echo "strip-assets: $found file(s)"

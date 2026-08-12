#!/bin/sh
# Strip `{# … #}` template comments from the .ut files IN A BUILD TREE.
#
#   ./strip-templates.sh <dir>
#
# Run from the package Makefile (Build/Prepare) over $(PKG_BUILD_DIR), never over the source tree:
# git keeps every word, the router does not need any of them. Same trade this project already makes
# for JS (jsmin/terser) and CSS (build-css.sh) — templates were simply never included in it, and
# they are mostly comments: `{# … #}` is 22633 of 60227 bytes (38%).
#
# sh + awk only, like build-css.sh: an OpenWrt buildbot has no node and this must not become the
# reason a build needs one.
#
# WHAT IS AND IS NOT TOUCHED, and the distinction is the whole safety argument:
#   * `{# … #}` — a TEMPLATE comment. ucode treats `{#` as a comment opener everywhere outside a
#     `{% … %}` code block, so a `{#` that survives in this tree is a comment BY DEFINITION; if one
#     ever sat inside a <script> string the template would already be broken. Verified before
#     writing this: 0 of them appear inside a code block, and every opener has exactly one closer.
#   * `/* … */` inside `{% … %}` — a ucode CODE comment, 6844 bytes more. NOT touched. Stripping it
#     needs a lexer that knows ucode strings, and 17 of the `/*` in this tree sit OUTSIDE any code
#     block (they are CSS/JS comments in inline <style>/<script>). That is exactly the shape that
#     made the old `sed 's/;}/}/g'` in build-css.sh eat a data-URI: a scanner that cannot see
#     strings. Not worth 6.8 KB.
#
# Whitespace control is EMULATED, not ignored: `{#- …` also eats the whitespace before the comment
# and `… -#}` the whitespace after it, which is how ucode itself renders them. Nearly every .ut here
# opens with a licence block closing `-#}` (footer.ut is one `{% include %}` line and has none);
# head.ut's is the one that matters, swallowing the newline before its <!DOCTYPE html>, and dropping
# the comment without the trim would put that newline back.
set -e

DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "usage: strip-templates.sh <dir>" >&2; exit 1; }

# ONE trap over the file list and whatever temp the loop holds, and the list goes through a file
# rather than `for f in $(find …)`: the same two fixes as strip-shell.sh, for the same reasons — a
# checkout path with a space in it was split into words, and an awk failure under `set -e` left a
# `<file>.tmp<pid>` inside the staged payload, which stage.sh then copies into the package.
LIST=$(mktemp)
CUR=""
trap 'rm -f "$LIST" ${CUR:+"$CUR"}' EXIT INT TERM
find "$DIR" -name '*.ut' -type f | sort > "$LIST"

before=0
after=0
found=0

while IFS= read -r f; do
	found=$((found + 1))
	b=$(wc -c < "$f")
	CUR="$f.tmp$$"
	awk '
		BEGIN { RS = "^$" }		# slurp the whole file
		{
			s = $0; n = length(s); i = 1; out = ""
			while (i <= n) {
				if (substr(s, i, 2) == "{#") {
					j = i + 2
					trimleft = (substr(s, j, 1) == "-")
					# find the closer
					k = index(substr(s, j), "#}")
					if (k == 0) { out = out substr(s, i); break }	# unterminated: leave as is
					end = j + k - 1					# index of "#" in "#}"
					trimright = (substr(s, end - 1, 1) == "-")
					if (trimleft)  sub(/[ \t\r\n]+$/, "", out)
					i = end + 2
					if (trimright) while (i <= n && match(substr(s, i, 1), /[ \t\r\n]/)) i++
					continue
				}
				out = out substr(s, i, 1); i++
			}
			printf "%s", out
		}
	' "$f" > "$CUR"
	mv "$CUR" "$f"
	CUR=""
	a=$(wc -c < "$f")
	before=$((before + b))
	after=$((after + a))
done < "$LIST"

[ "$found" -gt 0 ] || { echo "strip-templates: no .ut under $DIR" >&2; exit 1; }
echo "strip-templates: $found file(s), $before -> $after bytes (-$((before - after)))"

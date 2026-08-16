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
#   * `/* … */` STANDING ON ITS OWN LINES — a code comment, wherever it sits: ucode inside
#     `{% … %}`, JavaScript inside an inline <script>, CSS inside an inline <style>. 18362 bytes
#     across this tree, 8 KB of them in the shipped package after gzip, which is 11% of it.
#
#     This used to be left alone with the argument that stripping it "needs a lexer that knows
#     ucode strings" — and that argument is right about the general case and wrong about this one.
#     The rule here is not "remove /* … */"; it is "remove a comment that OWNS its lines": `/*` is
#     the first non-blank thing on its line and `*/` is the last non-blank thing on its (possibly
#     later) line. For that to eat live code, a string literal would have to span lines AND contain
#     a line that is nothing but a comment — measured across every .ut in this tree: 18362 of 18362
#     comment bytes are whole-line, zero are inline, and no multi-line template literal contains a
#     line-leading `/*`. Anything that does not fit the rule is LEFT IN PLACE and counted, so the
#     day one appears the build says so instead of quietly changing the meaning of a template.
#
#     What this deliberately does NOT do is minify: no joining of lines, no touching of anything
#     that is not a comment from column one. The output still reads like the source, minus the prose.
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

	# …and the code comments that own their lines, line by line rather than over the slurped file:
	# a rule about what a LINE is cannot be expressed over a byte stream, and going line by line is
	# also what makes it impossible to walk into a string literal by accident (see the header).
	CUR="$f.tmp$$"
	awk -v LEFT=0 '
		function blank(t) { return t ~ /^[ \t\r]*$/ }
		{
			line = $0
			if (!incomment) {
				# a comment that owns this line: nothing but whitespace before /*
				if (line ~ /^[ \t]*\/\*/) {
					# …and if it closes on the same line, the rest of that line must be blank too
					if (line ~ /\*\//) {
						rest = line; sub(/^.*\*\//, "", rest)
						if (blank(rest)) next
						LEFT++; print line; next			# code after the closer: leave it whole
					}
					incomment = 1; next
				}
				# an inline comment (code before it) is left alone and counted
				if (line ~ /\/\*/) LEFT++
				print line; next
			}
			# inside a block comment: it may only end a line, or we would drop live code
			if (line ~ /\*\//) {
				rest = line; sub(/^.*\*\//, "", rest)
				incomment = 0
				if (!blank(rest)) { LEFT++; print rest }
			}
			next
		}
		END { if (LEFT > 0) printf "strip-templates: %d comment(s) not on lines of their own, left in place\n", LEFT | "cat 1>&2" }
	' "$f" > "$CUR"
	mv "$CUR" "$f"
	CUR=""
	a=$(wc -c < "$f")
	before=$((before + b))
	after=$((after + a))
done < "$LIST"

[ "$found" -gt 0 ] || { echo "strip-templates: no .ut under $DIR" >&2; exit 1; }
echo "strip-templates: $found file(s), $before -> $after bytes (-$((before - after)))"

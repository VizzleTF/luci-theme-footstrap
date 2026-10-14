#!/bin/sh
# Concatenate the styles/ tree into a single cascade.css.
#
#   ./build-css.sh [outfile] [--dev]
#
# Directory order is layer order (styles/, base/, theme/, pages/); filename order is source order
# within a directory. A later layer beats an earlier one whatever the specificity, so nothing needs
# !important to override base.
#
# Minified unless --dev: uhttpd serves CSS with no gzip, so every byte is a wire byte. Comments and
# whitespace go, and five spellings shrink (docs/css.md, "The build"): [a="b"] -> [a=b], the space
# before !important, ::before -> :before, the spaces beside * and / in a declaration, and a flex
# triple with a keyword form (1 1 auto -> auto). Nothing else in a selector or declaration is
# rewritten, which is why csstidy stays off (it mangles :has() and color-mix()). Needs only cat and
# awk, so an OpenWrt buildbot can run it.
set -eu

D="$(cd "$(dirname "$0")" && pwd)"
OUT=""
DEV=0
for a in "$@"; do
	case "$a" in
		--dev) DEV=1 ;;
		# Else a typo like `--devv` becomes the output file name.
		-*) echo "build-css: unknown option: $a" >&2; exit 1 ;;
		*) OUT="$a" ;;
	esac
done
[ -n "$OUT" ] || OUT="$D/htdocs/luci-static/footstrap/cascade.css"

for d in styles styles/base styles/theme styles/pages; do
	[ -d "$D/$d" ] || { echo "build-css: $D/$d missing" >&2; exit 1; }
done

TMP="$OUT.tmp.$$"
# $TMP.min too: an awk failure leaves it behind.
trap 'rm -f "$TMP" "$TMP.min" "$TMP.layer"' EXIT
trap 'exit 130' INT TERM
mkdir -p "$(dirname "$OUT")"

# One `@layer X{` per LAYER, not per FILE: 37 file wrappers are 542 bytes. The wrapper comes from
# the DIRECTORY, so each file must open with the layer its directory means or it is silently
# re-layered. A file with no wrapper (00-header.css: banner and layer-order statement) is copied
# through and must come before the wrapped ones, or it lands inside the block.
emit_layer() {
	layer="$1"; shift
	body="$TMP.layer"
	: > "$body"
	for f in "$@"; do
		if head -1 "$f" | grep -q '^@layer '; then
			head -1 "$f" | grep -q "^@layer $layer {\$" || {
				echo "build-css: $f is in a $layer directory but does not open with '@layer $layer {'" >&2
				exit 1; }
			# the file's own wrapper: its first line, and the bare `}` where brace depth returns to 0.
			# Anything but blank or comment after that `}` is refused: the source leaves it unlayered
			# and the build would move it into the block, a silent cascade change.
			awk -v F="$f" 'NR == FNR {
					if (end) {
						l = $0
						if (inc) { if (sub(/^.*\*\//, "", l)) inc = 0; else next }
						gsub(/\/\*.*\*\//, "", l)
						if (match(l, /\/\*/)) { inc = 1; l = substr(l, 1, RSTART - 1) }
						if (!bad && l ~ /[^ \t\r]/) bad = NR
						next
					}
					# depth, string- and comment-aware: a `{` in a multi-line comment or in content:"{"
					# is not a block (the same walk as brace_count below)
					l = $0; n = length(l)
					for (i = 1; i <= n; i++) {
						ch = substr(l, i, 1)
						if (inc) { if (ch == "*" && substr(l, i + 1, 1) == "/") { inc = 0; i++ } continue }
						if (q != "") { if (ch == "\\") i++; else if (ch == q) q = ""; continue }
						if (ch == "\"" || ch == "'"'"'") { q = ch; continue }
						if (ch == "/" && substr(l, i + 1, 1) == "*") { inc = 1; i++; continue }
						if (ch == "{") d++; else if (ch == "}") d--
					}
					if (NR > 1 && d == 0) end = NR; next }
				END { if (bad) { printf "build-css: %s:%d: a rule after the @layer wrapper would be moved into the layer; put it inside\n", F, bad > "/dev/stderr"; exit 1 } }
				FNR > 1 && FNR != end' "$f" "$f" >> "$body"
		elif [ -s "$body" ]; then
			echo "build-css: $f has no @layer wrapper but follows one that does — it would be" >&2
			echo "build-css: swallowed into the $layer block instead of staying above it." >&2
			exit 1
		else
			cat "$f"
		fi
	done
	if [ -s "$body" ]; then
		printf '@layer %s {\n' "$layer"
		cat "$body"
		printf '}\n'
	fi
	# not covered by the EXIT trap: the success path runs `trap - EXIT` first
	rm -f "$body"
}

# glob expands in filename order
{
	emit_layer tokens "$D"/styles/*.css
	emit_layer base   "$D"/styles/base/*.css
	emit_layer theme  "$D"/styles/theme/*.css
	emit_layer page   "$D"/styles/pages/*.css
} > "$TMP"

# Comments, and — unless told not to — the whitespace CSS ignores anyway, in one string-aware
# pass rather than two chained ones. squeeze=0 (the pre-compression rule count below; a
# `--dev` build skips the pass and keeps the raw sheet) strips comments and trims each line;
# squeeze=1 also does the ~9.5 KB whitespace pass. Why a scan has to be string-aware, what the
# whitespace pass leaves alone and why, and the sed bug this replaced: docs/css.md, "The build".
squeeze() {
	awk -v SQUEEZE="$2" '
		# The exact flex triples that have a shorter keyword form (shorthand initial values: grow 1
		# shrink 1 basis auto). Bare 0 is left alone, since `flex:0` means grow 0.
		function flexv(v,   imp) {
			if (v ~ /!important$/) { imp = "!important"; v = substr(v, 1, length(v) - 10) }
			if (v == "0 0 auto") v = "none"
			else if (v == "1 1 auto") v = "auto"
			else if (v == "0 1 auto") v = "0 auto"
			else if (v ~ /^1 1 ([0-9]+\.?[0-9]*|\.[0-9]+)(%|[A-Za-z]+)$/) v = substr(v, 5)
			return v imp
		}
		BEGIN { q = ""; inc = 0; banner = 0; lastc = ""; buf = ""; lastreal = ""; d = 0; st = 0; fl = 0 }
		{
			line = $0
			# a banner already open on an earlier line: nothing on a pure continuation line can
			# change q or inc, so the whole line is banner content until its own closing "*/".
			if (banner) {
				trimmed = line
				sub(/^[ \t]+/, "", trimmed); sub(/[ \t]+$/, "", trimmed)
				print trimmed
				lastc = ""; lastreal = ""
				if (index(line, "*/")) banner = 0
				next
			}
			# The line BREAK a squeeze pass is about to swallow is whitespace, and a declaration
			# may be wrapped across it. Feed it to the whitespace-run logic below as a leading
			# space: it survives only where a space would and is dropped next to { } ; , : —
			# lastc == "" means output is already at the start of a line, with nothing to glue to.
			if (SQUEEZE && lastc != "" && q == "" && !inc) line = " " line
			out = ""; i = 1; n = length(line); opened = 0
			while (i <= n) {
				c = substr(line, i, 1)
				if (inc) {                                  # inside a stripped /* ... */
					if (c == "*" && substr(line, i + 1, 1) == "/") { inc = 0; i += 2; continue }
					i++; continue
				}
				if (q != "") {                              # inside a "..." or '"'"'...'"'"' string
					out = out c
					if (c == "\\") { out = out substr(line, i + 1, 1); i += 2; continue }
					if (c == q) q = ""
					lastreal = ""
					i++; continue
				}
				if (c == "\"" || c == "'"'"'") {
					# [attr="ident"] -> [attr=ident]: the same selector, 2 bytes less, 394 sites. Only a
					# whole ident closed on this line right before `]`; "--" stays quoted, since
					# mangle-tokens.sh reads an unquoted --fs- as a name to rename.
					if (SQUEEZE) {
						j = index(substr(line, i + 1), c)
						v = substr(line, i + 1, j - 1)
						if (j && substr(line, i + j + 1, 1) == "]" && out ~ /\[[-A-Za-z0-9_]+[~|^$*]?=$/ &&
						    v ~ /^-?[A-Za-z_][-A-Za-z0-9_]*$/ && !index(v, "--")) {
							out = out v; lastreal = ""; i += j + 1; continue
						}
					}
					q = c; out = out c; lastreal = ""; i++; continue
				}
				if (c == "/" && substr(line, i + 1, 1) == "*") {
					if (substr(line, i + 2, 1) == "!") {
						# a genuine banner open: reached only with q=="" and inc==0 AT THIS
						# CHARACTER, the same guard strip_comments used before this pass absorbed
						# it — so a "/*!" that is really bytes inside a string or an already-open
						# ordinary comment never lands here. Copied raw from the marker on, byte
						# for byte: it is an Apache-2.0 attribution, not formatting.
						banner = 1
						rest = substr(line, i)
						out = out rest
						if (index(rest, "*/")) banner = 0
						opened = 1
						break
					}
					inc = 1; i += 2; continue
				}
				if (SQUEEZE) {
					if (c == " " || c == "\t") {     # collapse a run of whitespace to one space
						while (i <= n && (substr(line, i, 1) == " " || substr(line, i, 1) == "\t")) i++
						# the last char EMITTED, which on a continuation line lives on the
						# previous output line — hence lastc, not just `out`.
						prev = (length(out) ? substr(out, length(out), 1) : lastc)
						nxt  = (i <= n ? substr(line, i, 1) : "")
						# Drop the space next to a delimiter; otherwise it may be a combinator. `>` joins:
						# outside a string it is the child combinator or a range `>`
						# (`@container (width > 560px)`), both valid unspaced. `~` and `+` do not:
						# `[attr~=v]` and `calc(100% - 10px)` are ambiguous without bracket depth.
						# `!` joins too: `red!important` is the same declaration (35 sites).
						if (prev == "" || prev == "{" || prev == "}" || prev == ";" || prev == "," || prev == ":" || prev == ">")
							continue
						if (nxt == "{" || nxt == "}" || nxt == ";" || nxt == "," || nxt == "" || nxt == ">" || nxt == "!")
							continue
						# Inside a declaration only + and - need their spaces: calc(1px * 2) -> calc(1px*2),
						# 16 / 9 -> 16/9. Not before a comment opener, and `/*` or `*/` is never joined.
						if (bk[d] == "D" && (prev == "*" || prev == "/" || nxt == "*" || (nxt == "/" && substr(line, i + 1, 1) != "*")) &&
						    (prev nxt) != "/*" && (prev nxt) != "*/")
							continue
						out = out " "; lastreal = " "
						continue
					}
					# ::before/::after -> :before/:after, the CSS2 form every engine still parses and
					# serialises as `::`; the first colon of 93 pseudo-elements. Not `::before-x`.
					if (c == ":" && substr(line, i + 1, 1) == ":") {
						w = (substr(line, i + 2, 6) == "before") ? 6 : (substr(line, i + 2, 5) == "after") ? 5 : 0
						if (w && substr(line, i + 2 + w, 1) !~ /[-A-Za-z0-9_]/) { i++; continue }
					}
					# bk[d] is the kind of the open block: G holds rules (@layer @media @supports @container
					# @keyframes), D holds declarations (a style rule, @font-face, a keyframe step). st: a
					# statement has started, pk: its kind. The value rewrites cannot tell a nested rule from a
					# declaration, so a rule inside a D block fails the build.
					if (c == "{") {
						if (bk[d] == "D") { printf "build-css: a rule nested in a declaration block (docs/css.md, \"The build\")\n" > "/dev/stderr"; exit 1 }
						bk[++d] = (st ? pk : "D"); st = 0
					} else if (c == "}") { d--; st = 0 }
					else if (c == ";") st = 0
					else if (!st) {
						st = 1
						pk = (substr(line, i, 24) ~ /^@(layer|media|supports|container|scope|starting-style|[-a-z]*keyframes)/) ? "G" : "D"
					}
					# flex: vs is the offset of the value in buf out; it is rewritten when the declaration ends
					if (c == ":" && bk[d] == "D" && out ~ /flex$/ && (buf out) ~ /(^|[{;])flex$/) { fl = 1; vs = length(buf) + length(out) + 1 }
					if (fl && (c == ";" || c == "}")) {
						fl = 0; ft = buf out; fv = substr(ft, vs + 1); fw = flexv(fv)
						if (fw != fv) { buf = ""; out = substr(ft, 1, vs) fw }
					}
					# The last `;` of a block is dropped here, inside the string-aware scanner: a sed
					# `s/;}/}/` cannot see strings and turns `content: ";}"` into `content: "}"`.
					# The `;` may already sit in the previous output line, so text is held in `buf`
					# until the rule closes.
					if (c == "}") {
						if (length(out) && substr(out, length(out), 1) == ";")
							out = substr(out, 1, length(out) - 1)
						else if (!length(out) && length(buf) && substr(buf, length(buf), 1) == ";")
							buf = substr(buf, 1, length(buf) - 1)
					}
					out = out c; lastreal = c; i++
				} else {
					out = out c; i++
				}
			}
			if (opened) {
				trimmed = out
				sub(/^[ \t]+/, "", trimmed); sub(/[ \t]+$/, "", trimmed)
				print trimmed
				lastc = ""; lastreal = ""
				next
			}
			if (SQUEEZE) {
				buf = buf out
				if (length(out)) lastc = substr(out, length(out), 1)
				# newline only after a closing brace — one rule per line. lastreal, not lastc: a
				# line ending in a QUOTED `}` (content: "}") is not the end of a rule, and
				# flushing there would split the rule and lose the space before its next token.
				if (lastreal == "}") { print buf; buf = ""; lastc = ""; lastreal = "" }
			} else {
				sub(/^[ \t]+/, "", out)
				sub(/[ \t]+$/, "", out)
				if (length(out)) print out
			}
		}
		END { if (SQUEEZE) { if (length(buf)) print buf; else printf "\n" } }
	' "$1"
}

# Fail loudly rather than let an unbalanced block ship.
#
# String-aware, for the same reason the comment stripper is: a brace inside a CSS STRING is not a
# block, so a counter that gsub()s over the raw line makes a perfectly valid rule fail the build.
# Measured, all three shapes: `content: ";}"`, `content: "{"`, and a data-URI carrying `;}`. It
# fails closed, so nothing is ever corrupted; what it costs is a hunt for an imbalance that is not
# there.
brace_count() {
	awk '
		BEGIN { q = "" }
		{
			line = $0; n = length(line); i = 1
			while (i <= n) {
				ch = substr(line, i, 1)
				if (q != "") {				# inside a string
					if (ch == "\\") { i += 2; continue }	# escape: skip the pair
					if (ch == q) q = ""
					i++; continue
				}
				if (ch == "\"" || ch == "'"'"'") { q = ch; i++; continue }
				if (ch == "{") o++
				else if (ch == "}") c++
				i++
			}
		}
		END {
		if (o != c) { printf "build-css: %s: unbalanced braces (%d { vs %d })\n", FILENAME, o, c > "/dev/stderr"; exit 1 }
		if (o < 100) { printf "build-css: %s: suspiciously few rules (%d)\n", FILENAME, o > "/dev/stderr"; exit 1 }
		print o
	}' "$1"
}

# Always brace-check a COMMENT-STRIPPED, UNSQUEEZED copy, --dev included: counting braces in the
# raw file made a stray "{" in prose fail the build on perfectly valid CSS.
squeeze "$TMP" 0 > "$TMP.min"
RULES_BEFORE=$(brace_count "$TMP.min") || exit 1
rm -f "$TMP.min"

if [ "$DEV" -eq 0 ]; then
	squeeze "$TMP" 1 > "$TMP.min"
	mv "$TMP.min" "$TMP"

	# Recount on what ships: the squeeze is the pass most able to corrupt the sheet. The rule COUNT,
	# not brace balance, catches a truncated write: a cut right after the base layer closes is still
	# balanced against the true rule count, and RULES_BEFORE comes from the untruncated sheet.
	RULES_AFTER=$(brace_count "$TMP") || exit 1
	if [ "$RULES_BEFORE" != "$RULES_AFTER" ]; then
		echo "build-css: the squeeze changed the rule count ($RULES_BEFORE -> $RULES_AFTER)." >&2
		exit 1
	fi
fi
# --dev: $TMP is still the raw concatenation — comments and formatting intact, for reading on a
# router rather than shipping.

SIZE=$(wc -c < "$TMP" | tr -d ' ')
mv "$TMP" "$OUT"
trap - EXIT

echo "build-css: $SIZE bytes -> $OUT"

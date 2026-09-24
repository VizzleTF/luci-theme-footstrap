#!/bin/sh
# Concatenate the styles/ tree into a single cascade.css.
#
#   ./build-css.sh [outfile] [--dev]
#
# Directory order is layer order (styles/, base/, theme/, pages/); filename order is source order
# within a directory. A later layer beats an earlier one whatever the specificity, so nothing needs
# !important to override base.
#
# Minified unless --dev: ~468 KB of source to ~136 KB. uhttpd serves CSS with NO gzip, so every byte
# is a wire byte. Comments and whitespace go; a selector or a declaration is never rewritten, which
# is why LuCI's csstidy stays off (it mangles :has() and color-mix()). Needs only cat and awk, so an
# OpenWrt buildbot can run it.
set -e

D="$(cd "$(dirname "$0")" && pwd)"
OUT=""
DEV=0
for a in "$@"; do
	case "$a" in
		--dev) DEV=1 ;;
		# An unknown option used to fall through to `OUT="$a"`: a typo like `--devv`
		# wrote the stylesheet to a file named "--devv".
		-*) echo "build-css: unknown option: $a" >&2; exit 1 ;;
		*) OUT="$a" ;;
	esac
done
[ -n "$OUT" ] || OUT="$D/htdocs/luci-static/footstrap/cascade.css"

for d in styles styles/base styles/theme styles/pages; do
	[ -d "$D/$d" ] || { echo "build-css: $D/$d missing" >&2; exit 1; }
done

TMP="$OUT.tmp.$$"
# $TMP.min too: an awk failure used to leave it behind next to the real output.
trap 'rm -f "$TMP" "$TMP.min" "$TMP.layer"' EXIT
mkdir -p "$(dirname "$OUT")"

# One `@layer X{` per LAYER, not one per FILE. Every source file carries its own wrapper so it can
# be read and edited alone; concatenated, that is 37 copies of the same six-to-eleven bytes, 542 of
# them.
#
# The wrapper now comes from the DIRECTORY, so a file filed under the wrong layer would be silently
# re-layered instead of just being wrong — hence the check that each file opens with the layer its
# directory means. A file with no wrapper at all (00-header.css: the banner and the layer-order
# statement) is copied through, and must come before the wrapped ones or it would land inside the
# block.
emit_layer() {
	layer="$1"; shift
	body="$TMP.layer"
	: > "$body"
	for f in "$@"; do
		if head -1 "$f" | grep -q '^@layer '; then
			head -1 "$f" | grep -q "^@layer $layer {\$" || {
				echo "build-css: $f is in a $layer directory but does not open with '@layer $layer {'" >&2
				rm -f "$body"; exit 1; }
			# the file's own wrapper: its first line, and its last line, which is that wrapper's `}`
			sed '1d;$d' "$f" >> "$body"
		elif [ -s "$body" ]; then
			echo "build-css: $f has no @layer wrapper but follows one that does — it would be" >&2
			echo "build-css: swallowed into the $layer block instead of staying above it." >&2
			rm -f "$body"; exit 1
		else
			cat "$f"
		fi
	done
	if [ -s "$body" ]; then
		printf '@layer %s {\n' "$layer"
		cat "$body"
		printf '}\n'
	fi
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
# pass rather than two chained ones. squeeze=0 (the pre-compression rule count below, and every
# `--dev` build) strips comments and trims each line; squeeze=1 also does the ~9.5 KB whitespace
# pass. Why a scan has to be string-aware, what the whitespace pass leaves alone and why, and the
# sed bug this replaced: docs/css.md, "The build".
squeeze() {
	awk -v SQUEEZE="$2" '
		BEGIN { q = ""; inc = 0; banner = 0; lastc = ""; buf = ""; lastreal = "" }
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
				if (c == "\"" || c == "'"'"'") { q = c; out = out c; lastreal = ""; i++; continue }
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
						# drop it entirely next to a delimiter; otherwise it may be a combinator
						#
						# `>` is a delimiter too, and the only one that is itself a combinator: a
						# space either side of it is decoration. Safe because a `>` outside a
						# string can only be the child combinator — the sheet has no media range
						# syntax (`@media (width > 600px)`) — and a `>` inside a string never
						# reaches here, the scanner having copied it verbatim above. `~` and `+`
						# are deliberately NOT joined: `[attr~=v]` and `calc(100% - 10px)` make
						# them ambiguous without tracking bracket depth.
						if (prev == "" || prev == "{" || prev == "}" || prev == ";" || prev == "," || prev == ":" || prev == ">")
							continue
						if (nxt == "{" || nxt == "}" || nxt == ";" || nxt == "," || nxt == "" || nxt == ">")
							continue
						out = out " "; lastreal = " "
						continue
					}
					# THE LAST `;` OF A BLOCK IS REDUNDANT — dropped as the `}` is emitted, i.e.
					# INSIDE the string-aware scanner. It used to be a `| sed "s/;}/}/g"` bolted
					# onto the awk output, and sed cannot see strings: `content: ";}"` came out as
					# `content: "}"`, and a data-URI containing `;}` was corrupted the same way
					# (both reproduced). Nothing in the tree holds that byte pair today — which is
					# how such a bug waits for whoever adds the first one.
					#
					# The `;` may already sit in the previous line output, so text is held in
					# `buf` until the rule closes: a `;` already printed cannot be taken back.
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

	# AND AGAIN, on what actually ships: the check above only saw the squeeze's INPUT, yet
	# the squeeze is the pass most able to corrupt the sheet — it tracks strings, joins lines
	# and deletes the `;` before a `}`. An unchanged rule count is what says it did not.
	#
	# That equality — not brace balance on its own — is also why the 80 KB FS_CSS_FLOOR size
	# guard once here is gone. Balance alone misses a cut right after any of the four
	# `@layer NAME { … }` wrappers closes: everything up to that point is still a matched set, so
	# a truncated write — a full disk, a compression that ate the tail — that stops exactly there
	# reads as a valid, complete-looking file. Fed the real sheet, a cut right after the base
	# layer's own close counts a balanced 283 rules against the file's true 1057. What catches
	# that is the COUNT: RULES_BEFORE is measured from the untruncated concatenation before this
	# pass runs, so a write that stops early can only ever come up short against it.
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

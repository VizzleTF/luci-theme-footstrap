#!/bin/sh
# Strip build-time-only bytes from a BUILD TREE, one mode per kind of file:
#   ./strip-build.sh templates|shell|probes|assets <dir>
#
#   templates  `{# … #}`, whole-line `/* … */` and the indentation out of the .ut files
#   shell      whole-line `#` out of the shell under root/ (uci-defaults, the CGI, keep.d)
#   probes     the `/* fs:probe */` export lines out of the JS
#   assets     the SVG favicon's comment and the whitespace in the manifest JSON
#
# Run from the Makefile over $(PKG_BUILD_DIR) and from tools/stage.sh over the staged payload, never
# over the checkout. sh and awk only: an OpenWrt buildbot has no node. Every rewrite is
# `cat > "$f"`, never `mv`, which would drop the +x of the CGI and uci-defaults; one trap removes
# `<file>.tmp<pid>`, which stage.sh would otherwise copy into /etc/uci-defaults, where the ROUTER
# executes it. Reasons per mode sit above each branch below; docs/package.md has the rest.
set -eu

usage() { echo "usage: strip-build.sh templates|shell|probes|assets <dir>" >&2; exit 2; }

MODE="${1:-}"
DIR="${2:-}"
case "$MODE" in templates|shell|probes|assets) ;; *) usage ;; esac
[ -n "$DIR" ] && [ -d "$DIR" ] || usage

LIST=$(mktemp)
CUR=""
trap 'rm -f "$LIST" ${CUR:+"$CUR"}' EXIT
trap 'exit 130' INT TERM

# The list goes through a file: `for f in $(find …)` splits on whitespace.
case "$MODE" in
	templates) find "$DIR" -type f -name '*.ut' ;;
	probes)    find "$DIR" -type f -name '*.js' ;;
	assets)    find "$DIR" -type f \( -name '*.svg' -o -name '*.json' \) ;;
	shell)     find "$DIR" -type f ;;
esac | sort > "$LIST"

# want <file>: 0 when this mode rewrites it, 1 when it does not; the one refusal is a heredoc (below).
want() {
	case "$MODE" in
	shell)
		# ONLY a line whose first non-blank char is `#`, never the shebang; sh has no block comment, so
		# `#` is data only in a string or heredoc: want() refuses the heredoc, strip() the string.
		# Matched by shebang or keep.d, never by extension; the uci config and the rpcd ACL stay untouched.
		case "$(head -c 2 "$1")" in
			'#!') ;;
			*) case "$1" in */keep.d/*) ;; *) return 1 ;; esac ;;
		esac
		# checked on rewritten files only: over the whole tree a `<<` in the ACL aborted the build
		if grep -q '<<' "$1"; then
			echo "strip-build: $1:$(grep -n '<<' "$1" | head -1 | cut -d: -f1): a heredoc — refusing (a '#' line inside one is DATA, not a comment)" >&2
			exit 1
		fi ;;
	# a few module-private functions are also exported for one reason: a gate here calls them.
	# The function stays, the export line goes, with the comment block directly above it. Only a
	# complete export entry may go; anything else fails the build, since a half-removed object
	# literal is a module that does not parse.
	probes) grep -q '/\* fs:probe \*/' "$1" ;;
	# acl.d is excluded: rpcd skips a malformed ACL SILENTLY, so the grant would go to nobody, for ~200 B
	assets) case "$1" in */rpcd/acl.d/*.json) return 1 ;; esac ;;
	esac
}

# strip <file>: rewrite it through $CUR, refusing on a result that cannot be right.
strip() {
	case "$MODE" in
	templates)
		# `{# … #}` is a template comment everywhere outside `{% … %}` (0 of them inside a code block,
		# one closer each). `{#-` / `-#}` also eat the whitespace before/after, as ucode renders them:
		# head.ut's `-#}` swallows the newline before <!DOCTYPE html>.
		awk '
			# slurp by hand: RS="^$" is a regex in gawk, mawk, busybox and one-true-awk since 2019; POSIX
			# mode (gawk --posix: 2 records on "a^b") and older one-true-awk read "^", eating head.ut regexes
			{ buf = buf $0 "\n" }
			END {
				s = buf; n = length(s); i = 1; out = ""
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
		' "$1" > "$CUR"
		cat "$CUR" > "$1"
		# `/* … */` that OWNS its lines (`/*` first, `*/` last): 18362 of 18362 comment bytes in the .ut
		# files are whole-line, so eating live code needs a string spanning lines. Done per line, not
		# on the slurp, so a string literal cannot be walked into; the rest is left and counted.
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
			END { if (LEFT > 0) printf "strip-build: %d comment(s) not on lines of their own, left in place\n", LEFT | "cat 1>&2" }
		' "$1" > "$CUR"
		cat "$CUR" > "$1"
		# Indentation and blank lines, -1,627 B of the 21,631 the comment passes leave: ucode eats the
		# newline after a `%}`, so the line below one keeps its indentation; anywhere else every
		# whitespace run keeps its newline, which HTML, ucode code and inline JS/CSS read the same.
		# Line 1 stays whole.
		# Refused: an odd backtick count (a template literal spanning lines), a trailing backslash (a
		# continued string), a quote left open at a line end inside `{% %}` or `{{ }}` (its next line is
		# string data; 0 of the 5 templates have one), <pre> and <textarea>.
		awk '
			function refuse(why) { print "strip-build: " FILENAME ":" NR ": " why > "/dev/stderr"; bad = 1 }
			# One line of the ucode lexer; mode, q, cm and prev carry over. Strings, comments and regex
			# literals (head.ut has one holding both quote marks) are skipped, so only a quote still open
			# at the line end is reported. A regex is told from a division by the token before it: an opening
			# character or an operator, or return, case, in, delete, else, the only words the ucode lexer
			# follows with a regex. After any other word, a number, a string, `)`, `]` or `}` it is a division,
			# which holds inside an expression only: a statement-initial regex there reads as a division, so
			# a quote in it is refused (ucode runs that form as a no-op, a regex has no methods).
			function afterkw(s, i) { return match(substr(s, 1, i - 1), /(^|[^A-Za-z0-9_$.])(return|case|in|delete|else)[ \t]*$/) }
			function scan(s,   i, j, n, c, d, cls) {
				n = length(s)
				for (i = 1; i <= n; i++) {
					c = substr(s, i, 1); d = substr(s, i, 2)
					if (!mode) {
						if (d == "{%") { mode = 1; prev = ""; i++ }
						else if (d == "{{") { mode = 2; prev = ""; i++ }
						continue
					}
					if (cm) { if (d == "*/") { cm = 0; i++ } continue }
					if (q) {
						if (c == "\\") i++
						else if (c == q) { q = ""; prev = c }
						continue
					}
					if (d == "//") return
					if (d == "/*") { cm = 1; i++; continue }
					if (c == "\047" || c == "\"" || c == "`") { q = c; continue }
					if ((mode == 1 && d == "%}") || (mode == 2 && d == "}}")) { mode = 0; i++; continue }
					if (c == "/" && (prev == "" || index("(,=:[!&|?{;<>+-*%^~", prev) > 0 || afterkw(s, i))) {
						cls = 0
						for (j = i + 1; j <= n; j++) {
							d = substr(s, j, 1)
							if (d == "\\") j++
							else if (d == "[") cls = 1
							else if (d == "]") cls = 0
							else if (d == "/" && !cls) break
						}
						i = j; prev = "x"; continue
					}
					if (c != " " && c != "\t") prev = c
				}
				if (q == "`") q = ""
				else if (q != "" && s !~ /\\$/) refuse("a string in a {% %} or {{ }} block spans lines")
			}
			{
				scan($0)
				t = $0
				if (gsub(/`/, "", t) % 2) refuse("a template literal spans lines")
				if ($0 ~ /\\$/) refuse("a line ends in a backslash")
				if (tolower($0) ~ /<(pre|textarea)([ \t>]|$)/) refuse("<pre> and <textarea> keep their indentation")
				line = $0; keep = 1
				if (NR > 1) {
					if (!blk) { sub(/^[ \t]+/, "", line); keep = (line != "") }
					else if (line ~ /^[ \t]+$/) line = ""
				}
				blk = ($0 ~ /%[}][ \t\r]*$/)
				if (keep) print line
			}
			END { exit bad }
		' "$1" > "$CUR" ;;
	shell)
		# q is the quote open at a line start: sh strings span lines, and a `#` line inside one is data.
		# A `#` opens a comment only at a word start; `$#`, `${#x}` and `a#b` are not one.
		awk '
			function scan(s,   i, n, c) {
				n = length(s)
				for (i = 1; i <= n; i++) {
					c = substr(s, i, 1)
					if (q == "\047") { if (c == q) q = ""; continue }
					if (c == "\\") { i++; continue }
					if (q == "\"") { if (c == q) q = ""; continue }
					if (c == "\047" || c == "\"") { q = c; continue }
					if (c == "#" && (i == 1 || substr(s, i - 1, 1) ~ /[ \t;&|()<>]/)) return
				}
			}
			NR == 1 && /^#!/ { print; next }
			/^[ \t]*#/ {
				if (q != "") { print "strip-build: " FILENAME ":" NR ": a # line inside a quoted string" > "/dev/stderr"; bad = 1 }
				next
			}
			{ scan($0); print }
			END { exit bad }
		' "$1" > "$CUR"
		# never leave a file that lost its shebang
		if [ "$(head -c 2 "$1")" = '#!' ] && [ "$(head -c 2 "$CUR")" != '#!' ]; then
			echo "strip-build: $1 lost its shebang — refusing" >&2
			exit 1
		fi ;;
	probes)
		pre=$(grep -c '/\* fs:probe \*/$' "$1" || true)
		awk '
			# a comment block directly above a probe entry describes that export, so it is held back
			# and goes with it; above anything else it is released untouched
			function flush() { if (nb) { printf "%s", buf; lastblank = 0 } buf = ""; nb = 0 }
			incom { buf = buf $0 "\n"; nb++; if ($0 ~ /\*\//) { incom = 0 } ; next }
			/^[ \t]*\/\*/ && !/\/\* fs:probe \*\/$/ {
				flush()
				buf = $0 "\n"; nb = 1
				if ($0 !~ /\*\//) incom = 1
				else if ($0 !~ /\*\/[ \t]*$/) flush()
				next
			}
			/\/\* fs:probe \*\/$/ {
				line = $0
				sub(/[ \t]*\/\* fs:probe \*\/$/, "", line)
				# a complete entry, in either form the modules use: `name,` or `name: expression,`
				if (line ~ /^[ \t]*[A-Za-z_$][A-Za-z0-9_$]*[ \t]*,[ \t]*$/ ||
				    line ~ /^[ \t]*[A-Za-z_$][A-Za-z0-9_$]*[ \t]*:.*,[ \t]*$/) { buf = ""; nb = 0; skipblank = lastblank; next }
				print "strip-build: " FILENAME ":" NR ": not a whole export entry: " line > "/dev/stderr"
				bad = 1
			}
			# a drop between two blank lines would leave a run the source did not have
			skipblank && /^[ \t]*$/ { skipblank = 0; next }
			{ flush(); skipblank = 0; lastblank = ($0 ~ /^[ \t]*$/); print }
			END { flush(); exit bad }
		' "$1" > "$CUR"
		post=$(grep -c '/\* fs:probe \*/$' "$CUR" || true)
		dropped=$((dropped + pre - post)) ;;
	assets)
		case "$1" in
		*.svg)
			# XML comments, then whitespace BETWEEN tags only: inside a tag `viewBox="-9 -1 100 100"` is
			# data. 1,360 -> ~590 B. Slurp without RS tricks, which are not POSIX.
			awk '
				{ buf = buf $0 "\n" }
				END {
					$0 = buf
					# comments first: they may span lines and may contain angle brackets
					while (match($0, /<!--([^-]|-[^-]|--[^>])*-->/)) {
						$0 = substr($0, 1, RSTART - 1) substr($0, RSTART + RLENGTH)
					}
					gsub(/>[ \t\r\n]+</, "><")
					gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "")
					printf "%s", $0
				}
			' "$1" > "$CUR"
			# a truncated write must never ship: nothing valid here is under 100 bytes
			if [ "$(wc -c < "$CUR")" -lt 100 ]; then
				echo "strip-build: $1 came out implausibly small — refusing" >&2
				exit 1
			fi
			# a surviving comment is the cheapest proof of a no-op on some other awk
			if grep -q '<!--' "$CUR"; then
				echo "strip-build: $1 still has an XML comment after stripping — refusing" >&2
				exit 1
			fi ;;
		*)
			# JSON: one line, structure only, every value byte kept; 366 -> ~310 B
			awk '
				{ buf = buf $0 "\n" }
				END {
					q = 0
					out = ""
					n = length(buf)
					for (i = 1; i <= n; i++) {
						c = substr(buf, i, 1)
						if (q) {
							out = out c
							if (c == "\\") { out = out substr(buf, i + 1, 1); i++; continue }
							if (c == "\"") q = 0
							continue
						}
						if (c == "\"") { q = 1; out = out c; continue }
						if (c == " " || c == "\t" || c == "\n" || c == "\r") continue
						out = out c
					}
					printf "%s", out
				}
			' "$1" > "$CUR"
			# a surviving newline means stripping did not happen
			if [ "$(wc -l < "$CUR")" -gt 0 ]; then
				echo "strip-build: $1 still has a newline after stripping — refusing" >&2
				exit 1
			fi ;;
		esac ;;
	esac
}

before=0
after=0
found=0
dropped=0
while IFS= read -r f; do
	want "$f" || continue
	found=$((found + 1))
	b=$(wc -c < "$f")
	CUR="$f.tmp$$"
	strip "$f"
	[ -s "$CUR" ] || { echo "strip-build: $f came out empty — refusing" >&2; exit 1; }
	cat "$CUR" > "$f"		# cat, not mv: keep the original mode (uci-defaults must stay +x)
	rm -f "$CUR"
	CUR=""
	before=$((before + b))
	after=$((after + $(wc -c < "$f")))
done < "$LIST"

case "$MODE" in
templates) [ "$found" -gt 0 ] || { echo "strip-build: no .ut under $DIR" >&2; exit 1; } ;;
shell)     [ "$found" -gt 0 ] || { echo "strip-build: no shell file under $DIR" >&2; exit 1; } ;;
probes)    [ "$found" -gt 0 ] || { echo "strip-build: no marked export in $DIR" >&2; exit 1; } ;;
assets)    [ "$found" -gt 0 ] || { echo "strip-build: no .svg or .json in $DIR" >&2; exit 1; } ;;
esac
case "$MODE" in
probes) echo "strip-build: probes: $dropped export(s) dropped from $found file(s)" ;;
assets) echo "strip-build: assets: $found file(s)" ;;
*)      echo "strip-build: $MODE: $found file(s), $before -> $after bytes (-$((before - after)))" ;;
esac

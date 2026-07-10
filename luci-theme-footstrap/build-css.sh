#!/bin/sh
# Concatenate the styles/ tree into a single cascade.css.
#
#   ./build-css.sh [outfile] [--dev]
#
# One directory per cascade layer, joined in this order; inside each, files are
# joined in filename order, so the numeric prefix IS the source order:
#
#   styles/*.css        the banner, @font-face and the design tokens
#   styles/base/*.css   @layer base    widget defaults every LuCI view assumes
#   styles/theme/*.css  @layer theme   footstrap components and layouts
#   styles/pages/*.css  @layer page    per-page corrections
#
# A later layer beats an earlier one whatever the selector specificity, so a
# theme file always wins over base, and a page file over a component, without
# !important. Layer precedence is declared once in styles/00-header.css.
#
# Without --dev the output is minified: comments dropped (except the /*! banner),
# indentation and blank lines collapsed. That is ~30% of the byte size, and it
# matters — uhttpd serves /www/luci-static/*.css with no gzip, so the browser
# downloads every byte. The transform never touches selectors or declarations,
# which is why LuCI's own csstidy pass stays off (it mangles :has()/color-mix()).
#
# Called by the package Makefile (Build/Prepare) and by dev-sync.sh. Nothing in
# the source tree is written unless [outfile] points there.
set -e

D="$(cd "$(dirname "$0")" && pwd)"
OUT=""
DEV=0
for a in "$@"; do
	case "$a" in
		--dev) DEV=1 ;;
		*) OUT="$a" ;;
	esac
done
[ -n "$OUT" ] || OUT="$D/htdocs/luci-static/footstrap/cascade.css"

for d in styles styles/base styles/theme styles/pages; do
	[ -d "$D/$d" ] || { echo "build-css: $D/$d missing" >&2; exit 1; }
done

TMP="$OUT.tmp.$$"
trap 'rm -f "$TMP"' EXIT
mkdir -p "$(dirname "$OUT")"

# glob expands in filename order
cat "$D"/styles/*.css \
    "$D"/styles/base/*.css \
    "$D"/styles/theme/*.css \
    "$D"/styles/pages/*.css > "$TMP"

if [ "$DEV" -eq 0 ]; then
	awk '
		# Strip /* ... */ comments, keeping /*! ... */ (the license banner).
		# CSS has no comment nesting and no string can contain */ in this
		# stylesheet, so a character scan is enough.
		BEGIN { inc = 0 }
		{
			line = $0; out = ""
			while (length(line)) {
				if (inc) {
					p = index(line, "*/")
					if (p == 0) { line = ""; break }
					line = substr(line, p + 2); inc = 0
					continue
				}
				p = index(line, "/*")
				if (p == 0) { out = out line; line = ""; break }
				out = out substr(line, 1, p - 1)
				if (substr(line, p + 2, 1) == "!") { out = out line; line = ""; break }
				line = substr(line, p + 2); inc = 1
			}
			sub(/^[ \t]+/, "", out)
			sub(/[ \t]+$/, "", out)
			if (length(out)) print out
		}
	' "$TMP" > "$TMP.min"
	mv "$TMP.min" "$TMP"
fi

# Fail loudly rather than ship a stylesheet with an unbalanced block. The braces
# are matched as bracket expressions: a bare /{/ is an interval-expression
# ambiguity that some awks warn about or reject.
awk '{ o += gsub(/[{]/, "&"); c += gsub(/[}]/, "&") } END {
	if (o != c) { printf "build-css: unbalanced braces (%d { vs %d })\n", o, c > "/dev/stderr"; exit 1 }
	if (o < 100) { print "build-css: suspiciously few rules" > "/dev/stderr"; exit 1 }
}' "$TMP"

mv "$TMP" "$OUT"
trap - EXIT
echo "build-css: $(wc -c < "$OUT" | tr -d ' ') bytes -> $OUT"

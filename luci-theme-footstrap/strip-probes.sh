#!/bin/sh
# Drop the `/* fs:probe */` exports from the JS IN A BUILD TREE.
#
#   ./strip-probes.sh <dir>
#
# A handful of module-private functions are also listed in the module's `baseclass.extend({…})` for
# one reason: a gate in this repository calls them. Nothing on a router does — the functions
# themselves are used inside their own module, and only the export line exists for the tests.
#
# So the line is marked and removed on the way into a package: the checkout keeps the seam the gates
# need and the router gets a module surface that is only what the theme calls. Same trade as
# strip-templates.sh and strip-shell.sh.
#
# Only a line that ends with the marker, and the line must be a complete export entry — anything
# else is left in place and reported, a half-removed object literal being a module that does not
# parse and a theme that does not load.
set -e

DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "usage: strip-probes.sh <dir>" >&2; exit 1; }

LIST=$(mktemp)
CUR=""
trap 'rm -f "$LIST" ${CUR:+"$CUR"}' EXIT INT TERM
find "$DIR" -name '*.js' -type f | sort > "$LIST"

found=0
files=0

while IFS= read -r f; do
	grep -q '/\* fs:probe \*/' "$f" || continue
	files=$((files + 1))
	CUR="$f.tmp$$"
	awk '
		/\/\* fs:probe \*\/$/ {
			line = $0
			sub(/[ \t]*\/\* fs:probe \*\/$/, "", line)
			# a complete entry, in either form the modules use: `name,` or `name: expression,`
			if (line ~ /^[ \t]*[A-Za-z_$][A-Za-z0-9_$]*[ \t]*,[ \t]*$/ ||
			    line ~ /^[ \t]*[A-Za-z_$][A-Za-z0-9_$]*[ \t]*:.*,[ \t]*$/) { dropped++; next }
			print "strip-probes: not a whole export entry, left in place: " line | "cat 1>&2"
		}
		{ print }
		END { printf "%d", dropped > "/dev/stderr" }
	' "$f" 2> "$CUR.n" > "$CUR"
	n=$(cat "$CUR.n"); rm -f "$CUR.n"
	found=$((found + ${n:-0}))
	mv "$CUR" "$f"
	CUR=""
done < "$LIST"

[ "$files" -gt 0 ] || { echo "strip-probes: no marked export in $DIR" >&2; exit 1; }
echo "strip-probes: $found export(s) dropped from $files file(s)"

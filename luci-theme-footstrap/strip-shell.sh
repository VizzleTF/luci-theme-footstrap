#!/bin/sh
# Drop whole-line `#` comments from the shell files under root/ IN A BUILD TREE.
#
#   ./strip-shell.sh <dir>
#
# Same trade as strip-templates.sh and build-css.sh: the reader gets the comments from git, the
# router gets the bytes. `root/etc/uci-defaults/30_luci-theme-footstrap` is 71% comment lines and
# `root/lib/upgrade/keep.d/luci-theme-footstrap` is 95% (six lines of reasoning above one path).
#
# ONLY a line whose first non-blank character is `#`, and never the shebang. That rule is safe here
# and the reason is checked, not assumed: sh has no block-comment syntax, so the only way a `#` can
# be something other than a comment is inside a string or a heredoc — a trailing `# …` after code is
# left alone because the line does not START with it, and there is no heredoc anywhere under root/
# (grepped). If one is ever added, this script has to learn about it: a `# …` line inside a heredoc
# is DATA.
#
# Files are matched by their shebang or by being under a directory whose contents are shell
# (uci-defaults, keep.d), never by extension — none of them have one.
set -e

DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "usage: strip-shell.sh <dir>" >&2; exit 1; }

if find "$DIR" -type f -exec grep -l '<<' {} + 2>/dev/null | grep -q .; then
	echo "strip-shell: a heredoc appeared under $DIR — refusing (a '#' line inside one is DATA, not a comment)" >&2
	exit 1
fi

before=0
after=0
found=0
for f in $(find "$DIR" -type f | sort); do
	# shell only: a shebang, or the two comment-only manifests this package ships
	case "$(head -c 2 "$f")" in
		'#!') ;;
		*) case "$f" in */keep.d/*) ;; *) continue ;; esac ;;
	esac
	found=$((found + 1))
	b=$(wc -c < "$f")
	awk 'NR == 1 && /^#!/ { print; next }
	     /^[ \t]*#/ { next }
	     { print }' "$f" > "$f.tmp$$"
	# never leave a file that lost its shebang or came out empty
	if [ ! -s "$f.tmp$$" ]; then
		echo "strip-shell: $f came out empty — refusing" >&2
		rm -f "$f.tmp$$"
		exit 1
	fi
	cat "$f.tmp$$" > "$f"		# cat, not mv: keep the original mode (uci-defaults must stay +x)
	rm -f "$f.tmp$$"
	a=$(wc -c < "$f")
	before=$((before + b))
	after=$((after + a))
done

[ "$found" -gt 0 ] || { echo "strip-shell: no shell file under $DIR" >&2; exit 1; }
echo "strip-shell: $found file(s), $before -> $after bytes (-$((before - after)))"

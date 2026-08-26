#!/bin/sh
# Drop whole-line `#` comments from the shell files under root/ IN A BUILD TREE.
#
#   ./strip-shell.sh <dir>
#
# Same trade as strip-templates.sh and build-css.sh: the reader gets the comments from git, the
# router gets the bytes (uci-defaults is 51% comment lines, keep.d 77%).
#
# ONLY a line whose first non-blank character is `#`, and never the shebang. sh has no block-comment
# syntax, so the only way a `#` can be something else is inside a string or a heredoc; a trailing
# `# …` after code is left alone because the line does not START with it, and there is no heredoc
# anywhere under root/ (grepped, and refused below in the files this loop rewrites).
#
# Files are matched by their shebang or by living under a shell directory (uci-defaults, keep.d),
# never by extension — none of them have one.
set -e

DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "usage: strip-shell.sh <dir>" >&2; exit 1; }

# ONE trap, covering the file list and whatever temp the loop holds when it dies. Under `set -e` an
# awk failure leaves `<file>.tmp<pid>` behind, and stage.sh runs this over the staged payload, so the
# leftover is copied into the package: a `30_luci-theme-footstrap.tmp1234` under /etc/uci-defaults is
# a file the ROUTER executes and deletes on its next boot.
LIST=$(mktemp)
CUR=""
trap 'rm -f "$LIST" ${CUR:+"$CUR"}' EXIT INT TERM

# The list goes through a file rather than `for f in $(find …)`: that splits on whitespace, so a
# checkout under a path with a space fed the loop two halves of a directory name.
find "$DIR" -type f | sort > "$LIST"

before=0
after=0
found=0
while IFS= read -r f; do
	# shell only: a shebang, or the one comment-only manifest this package ships (keep.d). The uci
	# config and the rpcd ACL are deliberately left alone.
	case "$(head -c 2 "$f")" in
		'#!') ;;
		*) case "$f" in */keep.d/*) ;; *) continue ;; esac ;;
	esac
	# The heredoc refusal, over the files this loop actually REWRITES. Run over the whole tree it
	# aborted the build on a `<<` in the ACL or the uci config, neither of which is touched here.
	if grep -q '<<' "$f"; then
		echo "strip-shell: a heredoc in $f — refusing (a '#' line inside one is DATA, not a comment)" >&2
		exit 1
	fi
	found=$((found + 1))
	b=$(wc -c < "$f")
	CUR="$f.tmp$$"
	awk 'NR == 1 && /^#!/ { print; next }
	     /^[ \t]*#/ { next }
	     { print }' "$f" > "$CUR"
	# never leave a file that lost its shebang or came out empty
	if [ ! -s "$CUR" ]; then
		echo "strip-shell: $f came out empty — refusing" >&2
		exit 1
	fi
	cat "$CUR" > "$f"		# cat, not mv: keep the original mode (uci-defaults must stay +x)
	rm -f "$CUR"
	CUR=""
	a=$(wc -c < "$f")
	before=$((before + b))
	after=$((after + a))
done < "$LIST"

[ "$found" -gt 0 ] || { echo "strip-shell: no shell file under $DIR" >&2; exit 1; }
echo "strip-shell: $found file(s), $before -> $after bytes (-$((before - after)))"

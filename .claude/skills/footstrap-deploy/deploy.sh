#!/bin/sh
# Incremental deploy of luci-theme-footstrap to the dev router.
#
#   deploy.sh [file ...]      # scp given repo-relative files to their router paths
#   deploy.sh                 # scp all changed-vs-HEAD runtime files (git)
#   deploy.sh --all           # scp every runtime file (templates + static + menu + include)
#
# Always bumps the cache-bust token and clears the dispatch cache so a plain
# F5 reloads. Does NOT change the active theme or re-register themes.
set -e

R="${FOOTSTRAP_SSH:-router}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)/luci-theme-footstrap"
cd "$ROOT"

# map repo-relative path -> absolute router path
dest() {
	case "$1" in
		htdocs/luci-static/*) echo "/www/luci-static/${1#htdocs/luci-static/}" ;;
		ucode/*)              echo "/usr/share/ucode/luci/${1#ucode/}" ;;
		root/*)               echo "/${1#root/}" ;;
		*) return 1 ;;
	esac
}

collect() {
	if [ "$1" = "--all" ]; then
		find htdocs/luci-static ucode/template -type f \
			\( -name '*.css' -o -name '*.js' -o -name '*.ut' -o -name '*.woff2' \
			   -o -name '*.svg' -o -name '*.png' \)
	elif [ $# -gt 0 ]; then
		printf '%s\n' "$@"
	else
		# changed vs HEAD (staged + unstaged), restricted to runtime dirs
		git -C "$ROOT/.." diff --name-only HEAD -- \
			luci-theme-footstrap/htdocs/luci-static luci-theme-footstrap/ucode/template 2>/dev/null \
			| sed 's#^luci-theme-footstrap/##'
	fi
}

FILES="$(collect "$@")"
[ -n "$FILES" ] || { echo "nothing changed to deploy (use --all to force)"; }

n=0
for f in $FILES; do
	[ -f "$f" ] || continue
	d="$(dest "$f")" || { echo "skip (unmapped): $f"; continue; }
	ssh "$R" "mkdir -p '$(dirname "$d")'"
	scp -q "$f" "$R:$d"
	echo "→ $d"
	n=$((n+1))
done

ssh "$R" 'touch /lib/apk/db/installed; rm -f /tmp/luci-indexcache*'
echo "deployed $n file(s) to $R; cache bumped (F5 reloads). Active theme unchanged."

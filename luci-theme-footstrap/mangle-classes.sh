#!/bin/sh
# Rename the theme's own `.fs-*` CLASS names in a built cascade.css to `fs-` plus one or two letters,
# and the same whole tokens in the .js and .ut under each <rewrite-dir>.
#   ./mangle-classes.sh <cascade.css> <rewrite-dir>...
#
# Run after mangle-tokens.sh, over a BUILD tree only, never the checkout. 2.8 KB raw, 0.45 KB gzip of
# sheet plus JS (measured 2026-10-31).
# Safe because (each checked 2026-10-31):
#   * every far-side class is a WHOLE literal: `'fs-ovl'`, `'.fs-sidebar .fs-label'`, `class="fs-main"`.
#     No `'fs-' + x` builds a class; the composed `'fs-ovl-panel-' + n` etc. are ids and end in `-`,
#     so the whole-token scan never reads them as a mapped name.
#   * a mapped name never equals a pref key, module name or id that stays: the scan reads the whole
#     token (`fs-pattern` is not `fs-pattern-ink`), and a short name is skipped if it already exists.
#   * the short names keep the `fs-` prefix: fs-router.js strayBodyNode() and the foreign-CSS fence
#     (docs/third-party-apps.md) tell the theme's nodes by it.
#   * KEEP: names read from outside this package. luci-app-footstrap-files (fs-stacked),
#     -cmd/-palette (fs-search-box, fs-main, fs-skip), the playground's replay.js and verify.mjs
#     (fs-login, fs-logout). A new outside reader goes here first.
set -eu

KEEP=" fs-stacked fs-main fs-skip fs-search-box fs-login fs-logout "

CSS="${1:-}"
[ -n "$CSS" ] && [ -f "$CSS" ] && [ $# -ge 2 ] || { echo "usage: mangle-classes.sh <cascade.css> <rewrite-dir>..." >&2; exit 2; }
shift

SELF_DIR=$(cd "$(dirname "$0")" && pwd -P)
for d in "$@"; do
	abs=$(cd "$d" 2>/dev/null && pwd -P) || { echo "mangle-classes: $d is not a directory" >&2; exit 1; }
	case "$abs/" in
		"$SELF_DIR"/*) echo "mangle-classes: $d is inside the source tree ($SELF_DIR) — refusing, this rewrites in place" >&2; exit 1 ;;
	esac
done

LIST="$CSS.list.$$"
MAP="$CSS.cmap.$$"
CUR=""
trap 'rm -f "$LIST" "$MAP" "$CSS.tmp.$$" ${CUR:+"$CUR"}' EXIT
trap 'exit 130' INT TERM

for d in "$@"; do find "$d" -type f \( -name '*.js' -o -name '*.ut' \); done > "$LIST"

# ---- the map: class names counted in the sheet (a `.` before them), hottest first ----
# every fs- token anywhere (sheet and far side) is "used": a short name must not already exist
# Paths through ENVIRON, not -v: see mangle-tokens.sh.
LISTF="$LIST" MAPF="$MAP" KEEP="$KEEP" awk '
	function lead_ok(s, i) { return i == 1 || substr(s, i - 1, 1) !~ /[A-Za-z0-9_-]/ }
	BEGIN {
		LISTF = ENVIRON["LISTF"]; MAPF = ENVIRON["MAPF"]; KEEP = ENVIRON["KEEP"]
		while ((getline f < LISTF) > 0) {
			while ((getline l < f) > 0) {
				s = l; off = 0
				while (match(s, /fs-[A-Za-z0-9_-]+/)) { if (lead_ok(l, off + RSTART)) used[substr(s, RSTART, RLENGTH)] = 1; off += RSTART + RLENGTH - 1; s = substr(s, RSTART + RLENGTH) }
			}
			close(f)
		}
	}
	{
		s = $0; off = 0
		while (match(s, /fs-[A-Za-z0-9_-]+/)) {
			t = substr(s, RSTART, RLENGTH); p = off + RSTART
			if (lead_ok($0, p)) {
				used[t] = 1
				if (p > 1 && substr($0, p - 1, 1) == "." && index(KEEP, " " t " ") == 0) { if (!(t in cnt)) ord[++n] = t; cnt[t]++ }
			}
			off += RSTART + RLENGTH - 1; s = substr(s, RSTART + RLENGTH)
		}
	}
	END {
		# insertion sort by count desc, name asc: n is ~80
		for (i = 2; i <= n; i++) { v = ord[i]; j = i - 1
			while (j >= 1 && (cnt[ord[j]] < cnt[v] || (cnt[ord[j]] == cnt[v] && ord[j] > v))) { ord[j + 1] = ord[j]; j-- }
			ord[j + 1] = v }
		A = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"; B = A "0123456789"
		k = 0
		for (a = 1; a <= 52; a++) sh[++k] = "fs-" substr(A, a, 1)
		for (a = 1; a <= 52; a++) for (b = 1; b <= 62; b++) sh[++k] = "fs-" substr(A, a, 1) substr(B, b, 1)
		k = 0
		for (i = 1; i <= n; i++) {
			do { k++ } while (sh[k] in used)
			if (sh[k] == "") { print "mangle-classes: out of short names" > "/dev/stderr"; exit 1 }
			print ord[i], sh[k] > MAPF
		}
	}
' "$CSS"
[ -s "$MAP" ] || { echo "mangle-classes: the map is empty — refusing" >&2; exit 1; }

# ---- rewrite: whole tokens only, in the sheet and on the far side ----
rewrite() {
	MAPF="$MAP" awk '
		BEGIN { MAPF = ENVIRON["MAPF"]; while ((getline l < MAPF) > 0) { split(l, a, " "); m[a[1]] = a[2] } }
		{
			s = $0; out = ""
			while (match(s, /fs-[A-Za-z0-9_-]+/)) {
				t = substr(s, RSTART, RLENGTH); pre = substr(s, 1, RSTART - 1)
				prev = (RSTART > 1) ? substr(s, RSTART - 1, 1) : substr(out, length(out), 1)
				out = out pre ((prev !~ /[A-Za-z0-9_-]/ && (t in m)) ? m[t] : t)
				s = substr(s, RSTART + RLENGTH)
			}
			print out s
		}
	' "$1" > "$2"
}
before=$(wc -c < "$CSS")
rewrite "$CSS" "$CSS.tmp.$$"
# mangle-tokens.sh joined the rules onto one line with no final newline; keep that
if [ "$(tail -c 1 "$CSS" | od -An -c | tr -d ' ')" != '\n' ]; then
	printf '%s' "$(cat "$CSS.tmp.$$")" > "$CSS"
else
	mv "$CSS.tmp.$$" "$CSS"
fi
echo "mangle-classes: $(wc -l < "$MAP") names, $before -> $(wc -c < "$CSS") bytes"
while IFS= read -r f; do
	CUR="$f.tmp$$"
	rewrite "$f" "$CUR" || { echo "mangle-classes: awk failed on $f — refusing" >&2; exit 1; }
	mv "$CUR" "$f"
	CUR=""
done < "$LIST"

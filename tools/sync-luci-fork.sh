#!/bin/sh
# Materialise this package into a checkout of openwrt/luci, the way the LUCI TREE wants it.
#
#   ./tools/sync-luci-fork.sh ../luci
#
# The luci tree gets the BUILT stylesheet, not `styles/`: the other themes commit one `cascade.css`
# and have no build step, so re-run this whenever `styles/` changes. Deliberately NOT done to the
# copy: custom properties are not mangled, templates and shell keep their comments, the JS is
# untouched (luci.mk runs jsmin at package time), and `po/` does not travel (Weblate writes into
# that tree; a changed msgid is a PR of its own).
# The Makefile is maintained by hand on the far side, so a change to OUR Makefile does not travel;
# the sync ends by saying whether it has drifted.
set -eu

DEST="${1:-}"
[ -n "$DEST" ] || { echo "usage: $0 <path-to-luci-checkout>" >&2; exit 2; }
[ -f "$DEST/luci.mk" ] || { echo "$DEST does not look like a luci checkout (no luci.mk)" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/luci-theme-footstrap"
OUT="$DEST/themes/luci-theme-footstrap"

# The Makefile is the ONE file that genuinely differs between the two trees (this one drives
# build-css.sh and the strip scripts; that one has nothing to drive), so it is maintained by hand
# on the far side and never overwritten from here.
mkdir -p "$OUT"
rsync -a --delete \
	--exclude '.git' \
	--exclude 'Makefile' \
	--exclude 'po' \
	--exclude 'styles' \
	--exclude 'build-css.sh' \
	--exclude 'mangle-tokens.sh' \
	--exclude 'strip-build.sh' \
	--exclude 'build-apk.sh' \
	--exclude 'dev-sync.sh' \
	--exclude 'update-po.sh' \
	--exclude 'luci-upstream.pin' \
	--exclude 'README.md' \
	--exclude '.DS_Store' \
	"$SRC/" "$OUT/"

# rsync's --exclude PROTECTS a path on the receiving side as well as skipping it on the sending
# side, so --delete leaves anything excluded here that a previous sync put there. The build inputs
# are named again to be removed, and the Makefile is not — it is the one file maintained by hand on
# the far side. (--delete-excluded would take that too.)
# `po` is NOT in this list on purpose: it is excluded from the send because Weblate owns it there,
# which means the copy that is already in that tree must be left exactly where it is.
for stale in styles build-css.sh mangle-tokens.sh strip-build.sh \
             build-apk.sh dev-sync.sh update-po.sh luci-upstream.pin README.md; do
	rm -rf "$OUT/$stale"
done

# Modes come from the theme repo's INDEX, never the worktree: core.fileMode=false here means a file
# can lose +x on disk with git none the wiser, and rsync -a would carry that loss into the PR.
find "$OUT" -type f -exec chmod 644 {} +
git -C "$ROOT" ls-files -s -- luci-theme-footstrap | while read -r mode _ _ path; do
	if [ "$mode" = 100755 ] && [ -f "$DEST/themes/$path" ]; then chmod 755 "$DEST/themes/$path"; fi
done

# Verify, loudly: a mode that differs from the index.
git -C "$ROOT" ls-files -s -- luci-theme-footstrap | while read -r mode _ _ path; do
	f="$DEST/themes/$path"
	[ -f "$f" ] || continue
	want=644; [ "$mode" = 100755 ] && want=755
	[ "$(stat -c %a "$f")" = "$want" ] || { echo "sync: mode $(stat -c %a "$f") != index $want: $path" >&2; exit 1; }
done || exit 1

# the artefact the far side commits, generated from the layers on this side
sh "$SRC/build-css.sh" "$OUT/htdocs/luci-static/footstrap/cascade.css"

# A shipped file must not point at anything that exists only in THIS repository: the tmp tree, a
# test or tool, a stand, a theme-repo issue number or commit. Every synced file is scanned, the built
# cascade.css included; docs/*.md pointers are older and accepted upstream, so they are counted,
# not failed.
refs=$(grep -rEnI \
	'\.\./tmp/|tests/[a-z0-9_/-]+\.(m?js|test)|tools/[a-z0-9_/-]+\.(mjs|sh)|\bnpm run [a-z-]+|\b[a-z-]+\.mjs\b|\bowrt(2410|2512|snap)[a-z]?\b|issue #[0-9]+|commit [0-9a-f]{7,}|`[0-9a-f]{7,12}`' \
	"$OUT" --exclude-dir=po || true)
[ -z "$refs" ] || { echo "sync: reference to something outside the luci tree:" >&2
	echo "$refs" | sed "s|^$OUT/||" | cut -c1-160 >&2; exit 1; }
# The scan above is per line, so "issue" at the end of a comment line and "#22" at the start of the
# next passes it; the issue and commit patterns (plus answers|fixes|closes) over each file with its
# newlines folded catch the wrapped form.
wrapped=$(grep -rlI --exclude-dir=po '' "$OUT" | while read -r f; do
	tr '\n' ' ' < "$f" | grep -oE '(issue|answers|fixes|closes)[[:space:]*#/]+#[0-9]+|commit[[:space:]*#/]+[0-9a-f]{7,}' | sed "s|^|${f#"$OUT"/}: |"
done || true)
[ -z "$wrapped" ] || { echo "sync: wrapped reference to a theme-repo issue or commit:" >&2
	echo "$wrapped" | cut -c1-160 >&2; exit 1; }

echo "synced -> $OUT"
echo "  cascade.css: $(wc -c < "$OUT/htdocs/luci-static/footstrap/cascade.css") bytes (generated, unmangled)"
echo "  files:       $(find "$OUT" -type f | wc -l | tr -d ' ')"

# The two things this script deliberately does not send, reported rather than assumed. Both are
# expected to differ — the question is only whether the difference is the one you meant.
mk_diff=$(diff "$SRC/Makefile" "$OUT/Makefile" 2>/dev/null | grep -c '^[<>]' || true)
echo "  Makefile:    hand-maintained there, $mk_diff differing line(s) — postinst/postrm/conffiles do NOT travel"
if [ -d "$OUT/po" ]; then
	echo "  po/:         left as it is ($(find "$OUT/po" -name '*.po' | wc -l | tr -d ' ') catalogue(s)) — Weblate owns them upstream"
fi
doc_refs=$(grep -rEo --include='*.js' --include='*.ut' 'docs/[a-z-]+\.md' "$OUT/htdocs" "$OUT/ucode" | wc -l | tr -d ' ')
echo "  docs/*.md:   $doc_refs pointer(s) in shipped JS/templates — accepted upstream, not checked"

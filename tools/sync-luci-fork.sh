#!/bin/sh
# Materialise this package into a checkout of openwrt/luci, the way the LUCI TREE wants it.
#
#   ./tools/sync-luci-fork.sh ../luci
#
# One decision separates the two: the luci tree gets the BUILT stylesheet, not the source that
# generates it. Here `styles/` is the source of truth and `cascade.css` is an untracked artefact;
# there the other themes each commit one `cascade.css` and have no build step, and a theme arriving
# with a 500-line shell script in `Build/Prepare` asks a reviewer to audit a build system before
# they can read a stylesheet. The cost is that the sheet has to be regenerated and re-copied
# whenever `styles/` changes, which is what this script is.
#
# What is deliberately NOT done to the copy:
#
#   * the custom properties are not mangled — readability wins in a tree somebody has to review and
#     patch, bytes win in a release artefact;
#   * the templates and the shell keep their comments, stripping being a packaging step;
#   * the JS is untouched: luci.mk runs jsmin over it at package time;
#   * `po/` does not travel at all. Upstream's CONTRIBUTING.md is explicit that translations are
#     made in Weblate, which writes straight into that tree, so a sync carrying our catalogues would
#     overwrite whatever translators had done. A changed msgid is a deliberate PR of its own.
#
# What this script cannot do for you: the Makefile is maintained by hand on the far side, so a
# change to OUR Makefile — postinst, postrm, conffiles — does not travel and has to be made there
# too. It is the one file that can drift unnoticed, so the sync ends by saying whether it has.
set -eu

DEST="${1:-}"
[ -n "$DEST" ] || { echo "usage: $0 <path-to-luci-checkout>" >&2; exit 1; }
[ -f "$DEST/luci.mk" ] || { echo "$DEST does not look like a luci checkout (no luci.mk)" >&2; exit 1; }

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
	--exclude 'strip-templates.sh' \
	--exclude 'strip-shell.sh' \
	--exclude 'strip-probes.sh' \
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
for stale in styles build-css.sh mangle-tokens.sh strip-templates.sh strip-shell.sh \
             strip-probes.sh build-apk.sh dev-sync.sh update-po.sh luci-upstream.pin README.md; do
	rm -rf "$OUT/$stale"
done

# The gate-only exports do not travel either. They exist so a gate in THIS repository can call a
# module-private function; upstream has no such gate, and a module surface nobody calls is dead
# weight there. The functions stay — only the export line goes (strip-probes.sh).
sh "$SRC/strip-probes.sh" "$OUT/htdocs/luci-static/resources"

# the artefact the far side commits, generated from the layers on this side
sh "$SRC/build-css.sh" "$OUT/htdocs/luci-static/footstrap/cascade.css"

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
echo "  drift:       node tools/fork-drift.mjs $DEST"

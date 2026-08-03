#!/bin/sh
# Materialise this package into a checkout of openwrt/luci, the way the LUCI TREE wants it.
#
#   ./tools/sync-luci-fork.sh ../luci
#
# The difference from what lives here is one decision: THE LUCI TREE GETS THE BUILT STYLESHEET,
# not the source that generates it. Here, `styles/` is the source of truth — sixteen files in four
# cascade layers whose ORDER is the whole design, and `cascade.css` is a build artefact this
# repository does not even track. There, the other four themes each commit one `cascade.css` and
# have no build step at all, and a theme arriving with a 500-line shell script in `Build/Prepare`
# is asking a reviewer to audit a build system before they can read a stylesheet.
#
# So: this side keeps the layers, that side gets the sheet. The cost is that the sheet has to be
# regenerated and re-copied whenever `styles/` changes, which is what this script is.
#
# WHAT IS DELIBERATELY *NOT* DONE TO THE COPY:
#
#   * the custom properties are NOT mangled. `mangle-tokens.sh` renames the private `--fs-*` tier
#     to two-character names and saves ~16% — worth it in a release artefact, indefensible in a
#     tree somebody has to review and patch. Readability wins there; bytes win here.
#   * the templates and the shell keep their comments. `strip-templates.sh`/`strip-shell.sh` are a
#     packaging step, and the luci tree is source.
#   * the JS is untouched: luci.mk runs jsmin over it at package time, which is exactly what the
#     other themes get.
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
	--exclude 'styles' \
	--exclude 'build-css.sh' \
	--exclude 'mangle-tokens.sh' \
	--exclude 'strip-templates.sh' \
	--exclude 'strip-shell.sh' \
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
for stale in styles build-css.sh mangle-tokens.sh strip-templates.sh strip-shell.sh \
             build-apk.sh dev-sync.sh update-po.sh luci-upstream.pin README.md; do
	rm -rf "$OUT/$stale"
done

# the artefact the far side commits, generated from the layers on this side
sh "$SRC/build-css.sh" "$OUT/htdocs/luci-static/footstrap/cascade.css"

echo "synced -> $OUT"
echo "  cascade.css: $(wc -c < "$OUT/htdocs/luci-static/footstrap/cascade.css") bytes (generated, unmangled)"
echo "  files:       $(find "$OUT" -type f | wc -l | tr -d ' ')"

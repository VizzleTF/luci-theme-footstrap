#!/bin/sh
# What `owfeed build` left in dist/, checked against what a release has to contain.
#
# The catalogues: a .lmo is a build artefact, not a file in git, and a silently missing one makes
# every _() render its English msgid with nothing complaining. Asserted against the tree the package
# actually carries and counted against the languages in the tree, so adding one and forgetting to
# wire it up fails here instead of shipping English.
#
# Read out of the ipk, that container being a plain tar where the apk is not. Both legs are packed
# from the same staged directory by the same catalogue compiler, so one is enough.
#
# Exactly one theme package per format, BY NAME. Load-bearing: anything resolving the theme by a
# loose pattern and taking head -1 mis-picks a stray asset that matches it — a per-language
# luci-i18n package did that and was installed AS the theme, reporting success (issue #6).
set -eu
cd "$(dirname "$0")/.."

# `tr -d ' '` on every wc: BSD wc pads its count to 8 columns while the other side of each comparison
# is unpadded, and `[ … = … ]` is a STRING test — so without the strip the gate is green in CI and
# fails locally on a correct package, which teaches the maintainer to ignore it.
want=$(find luci-theme-footstrap/po -mindepth 2 -name '*.po' | wc -l | tr -d ' ')
[ "$want" -gt 0 ] || { echo "no .po files found — the glob is wrong, not the build"; exit 1; }
got=$(tar -xzOf dist/all/luci-theme-footstrap_*_all.ipk ./data.tar.gz \
	| tar -tz | grep -c 'i18n/footstrap-theme\..*\.lmo' || true)
[ "$got" = "$want" ] || {
	echo "the package carries $got catalogue(s) for $want language(s) — it would ship"
	echo "some of them untranslated, which reports nothing at runtime"
	exit 1
}
echo "$got translation catalogue(s) in the package."

find dist -mindepth 2 -type f \( -name '*.apk' -o -name '*.ipk' \) -print
for ext in apk ipk; do
	n=$(find dist -mindepth 2 -type f -name "*.$ext" | wc -l | tr -d ' ')
	[ "$n" = 1 ] || { echo "expected exactly 1 .$ext (theme), got $n — see the note in this script"; exit 1; }
	m=$(find dist -mindepth 2 -type f -name "*.$ext" -exec basename {} \; \
		| grep -cE "^luci-theme-footstrap[-_][^/]*\.$ext$" || true)
	[ "$m" = 1 ] || { echo "expected exactly 1 luci-theme-footstrap .$ext, got $m"; exit 1; }
done

#!/bin/sh
# What `owfeed build` left in dist/, checked against what a release has to contain.
#
# THE CATALOGUES. A .lmo is a build artefact, not a file in git, and a silently missing
# one is the bug class this area keeps producing: every _() then renders its English
# msgid and nothing complains. Asserted against the tree the package actually carries
# rather than against what the build printed, and counted against the languages in the
# tree — so adding one and forgetting to wire it up fails here instead of shipping
# English to those users.
#
# Read out of the ipk because that container is a plain tar and the apk is not. Both
# legs are packed from the SAME staged directory by the SAME catalogue compiler, so one
# is enough to prove the compile happened.
#
# EXACTLY ONE THEME PACKAGE PER FORMAT, BY NAME. Load-bearing, not tidiness: anything
# resolving the theme by /luci-theme-footstrap[-_][^/]*\.EXT$/ and taking head -1 —
# release tooling, an install script, a person reading the assets list — mis-picks a
# stray extra asset that matches it. A per-language luci-i18n-footstrap package did
# exactly that (issue #6) and was installed AS the theme, reporting success.
set -eu
cd "$(dirname "$0")/.."

# `tr -d ' '` on every wc: BSD wc (i.e. every macOS run of this repo's own tooling) pads its count
# to 8 columns, and the other side of each comparison below is unpadded — `grep -c` prints `2`, the
# literals are `1`, and `[ … = … ]` is a STRING test. Without the strip the gate is green in CI
# (GNU coreutils, no padding) and fails locally on a correct package, which teaches the maintainer
# to ignore it. build-css.sh and sync-luci-fork.sh already strip theirs.
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

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
# EXACTLY ONE THEME PACKAGE PER FORMAT, BY NAME. Load-bearing, not tidiness: a
# self-updater in the field resolves the theme by /luci-theme-footstrap[-_][^/]*\.EXT$/
# and takes head -1, so a stray extra asset matching it — a per-language
# luci-i18n-footstrap package, issue #6 — is mis-picked and installed as the theme. A
# router's installed updater cannot be fixed remotely, so the release has to stay
# pickable by the script already there.
set -eu
cd "$(dirname "$0")/.."

want=$(find luci-theme-footstrap/i18n -mindepth 2 -name '*.po' | wc -l)
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
	n=$(find dist -mindepth 2 -type f -name "*.$ext" | wc -l)
	[ "$n" = 1 ] || { echo "expected exactly 1 .$ext (theme), got $n — see the note in this script"; exit 1; }
	m=$(find dist -mindepth 2 -type f -name "*.$ext" -exec basename {} \; \
		| grep -cE "^luci-theme-footstrap[-_][^/]*\.$ext$" || true)
	[ "$m" = 1 ] || { echo "expected exactly 1 luci-theme-footstrap .$ext, got $m"; exit 1; }
done

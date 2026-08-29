#!/bin/sh
# What `owfeed build` left in dist/, checked against what a release has to contain.
#
# The catalogues: a .lmo is a build artefact, not a file in git, and a silently missing one makes
# every _() render its English msgid with nothing complaining. Each language ships as its own
# `luci-i18n-footstrap-<lang>`, the way luci.mk emits them, so the assertion is one catalogue per
# language package and NONE in the theme — two packages owning one path is an install apk refuses.
#
# Read out of the ipk, that container being a plain tar where the apk is not. Both legs are packed
# from the same staged directory by the same catalogue compiler, so one is enough.
#
# Exactly one theme package per format, BY NAME. Load-bearing: anything resolving the theme by a
# loose pattern and taking head -1 mis-picks a stray asset that matches it — a per-language
# luci-i18n package did that and was installed AS the theme, reporting success (issue #6). The
# language packages are back, so the name test matters more than it did, not less: install.sh reads
# the signed manifest and matches `$2 == "luci-theme-footstrap"` exactly, and this is what keeps a
# second package from answering to that name.
set -eu
cd "$(dirname "$0")/.."

ipk_list() {			# <ipk> -> the paths inside it
	tar -xzOf "$1" ./data.tar.gz | tar -tz
}

# `tr -d ' '` on every wc: BSD wc pads its count to 8 columns while the other side of each comparison
# is unpadded, and `[ … = … ]` is a STRING test — so without the strip the gate is green in CI and
# fails locally on a correct package, which teaches the maintainer to ignore it.
langs=$(find luci-theme-footstrap/po -mindepth 1 -maxdepth 1 -type d ! -name templates -exec basename {} \;)
[ -n "$langs" ] || { echo "no language directory under po/ — the glob is wrong, not the build"; exit 1; }

stray=$(ipk_list dist/all/luci-theme-footstrap_*_all.ipk | grep -c 'i18n/.*\.lmo' || true)
[ "$stray" = 0 ] || {
	echo "the theme package carries $stray catalogue(s) of its own — every router would pay for"
	echo "them, and the language package owning the same path cannot install over it"
	exit 1
}

n=0
for lang in $langs; do
	f=$(find dist/all -name "luci-i18n-footstrap-${lang}_*_all.ipk" | head -1)
	[ -n "$f" ] || { echo "po/$lang has no luci-i18n-footstrap-$lang package in dist/"; exit 1; }
	got=$(ipk_list "$f" | grep -c "i18n/footstrap\.${lang}\.lmo\$" || true)
	[ "$got" = 1 ] || {
		echo "luci-i18n-footstrap-$lang carries $got catalogue(s) named footstrap.$lang.lmo,"
		echo "expected exactly 1 — po2lmo writes that name in an SDK build and the two must agree"
		exit 1
	}
	# the uci-defaults line is what puts the language in LuCI's own menu; without it the catalogue
	# loads only for someone who set the language by hand
	ipk_list "$f" | grep -q "etc/uci-defaults/luci-i18n-footstrap-$lang\$" || {
		echo "luci-i18n-footstrap-$lang registers no language — LuCI's menu would not offer it"
		exit 1
	}
	n=$((n + 1))
done
echo "$n language package(s), one catalogue each, none in the theme."

find dist -mindepth 2 -type f \( -name '*.apk' -o -name '*.ipk' \) -print
for ext in apk ipk; do
	m=$(find dist -mindepth 2 -type f -name "*.$ext" -exec basename {} \; \
		| grep -cE "^luci-theme-footstrap[-_][^/]*\.$ext$" || true)
	[ "$m" = 1 ] || { echo "expected exactly 1 luci-theme-footstrap .$ext, got $m"; exit 1; }
	# and the language packages must not answer to the theme's name pattern
	i=$(find dist -mindepth 2 -type f -name "luci-i18n-footstrap-*.$ext" | wc -l | tr -d ' ')
	[ "$i" = "$n" ] || { echo "expected $n luci-i18n .$ext, got $i"; exit 1; }
done

#!/bin/sh
# Flatten dist/ into release assets and verify every signature with the key the router
# will use.
#
# THE FLATTENING. owfeed leaves the packages in dist/noarch and dist/all — apk derives a
# package's filename from its name and version alone, so two architectures cannot share
# a directory — and a release asset has no directory at all. The manifest names the
# files without paths, which is what a router asks for, so flattening is what makes the
# two agree. Named extensions, not "every file one level down": `owfeed build` also
# leaves the staged payload under dist/root in a working tree, and a blanket move would
# sweep the whole rootfs into the release.
#
# THE VERIFY IS NOT CEREMONY. A secret rotated in GitHub without the public half being
# committed publishes a release that every installer rejects, and the rejection reads
# "BAD SIGNATURE" — indistinguishable from the attack the signature exists to stop.
# Catch it here, where it is a red build instead of a scare.
set -eu
cd "$(dirname "$0")/.."
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

for f in dist/*/*.apk dist/*/*.ipk dist/*/*.sig; do
	[ -e "$f" ] || continue
	mv "$f" dist/
done
rmdir dist/*/ 2>/dev/null || true
ls -l dist

U="$(tools/build-usign.sh "$RUNNER_TEMP/usign")"
n=0
for p in dist/*.apk dist/*.ipk dist/manifest.txt dist/install.sh; do
	[ -e "$p" ] || continue
	[ -s "$p.sig" ] || { echo "no signature for $(basename "$p")"; exit 1; }
	"$U" -V -q -m "$p" -x "$p.sig" -p release.pub || {
		echo "signature does not verify against release.pub — the secret and the shipped"
		echo "key disagree: $(basename "$p")"
		exit 1
	}
	echo "verified: $(basename "$p")"
	n=$((n + 1))
done
# 4: the theme in each of apk and ipk, plus manifest.txt and install.sh. The same key
# signs the updater's releases in its own repository, which is what lets a router cross
# from an asset published here to one published there without re-trusting anything.
[ "$n" -ge 4 ] || { echo "expected 4 signed files (2 packages + manifest + installer), got $n"; exit 1; }

# Named explicitly, not merely counted: the count above passes if some OTHER four files
# signed, and a release whose manifest is unsigned is one every manifest-aware router
# REFUSES — which reads as "BAD SIGNATURE", i.e. exactly like an attack.
[ -s dist/manifest.txt.sig ] || { echo "manifest.txt.sig was not produced"; exit 1; }

# The manifest must NAME the theme, not merely exist. One that names no package makes
# every router report "no asset for this release".
grep -q '^pkg luci-theme-footstrap ' dist/manifest.txt || {
	echo "the manifest names no theme package — refusing to publish it"; exit 1; }

# A FIELDED SELF-UPDATER PARSES THIS POSITIONALLY: `$1=="pkg" && $2==name && $3==ext
# {print $4, $5, $6}`, and it cannot be fixed remotely. owfeed puts the architecture
# AFTER those six for exactly that reason, so assert the six are still file/size/sha — a
# field inserted ahead of them would make every router fetch a URL that 404s.
awk '$1=="pkg" && $2=="luci-theme-footstrap" {
       if ($4 !~ /\.(apk|ipk)$/ || $5 !~ /^[0-9]+$/ || $6 !~ /^[0-9a-f]{64}$/) {
         print "manifest field order changed: a fielded reader would take " $4 \
               " for a filename, " $5 " for a size and " $6 " for a digest"; exit 1 }
       n++
     } END { if (n < 2) { print "the manifest names " n " theme package(s), want 2"; exit 1 } }' \
	dist/manifest.txt

# The .sig assets must not disturb the asset pick of a self-updater ALREADY IN THE
# FIELD: it resolves the theme by /luci-theme-footstrap[-_][^/]*\.EXT$/ and takes
# head -1. Assert that regex resolves to exactly ONE asset — a .sig ends in .EXT.sig, so
# it never matches — re-checked on the FINAL set, after signing.
for ext in apk ipk; do
	re="^luci-theme-footstrap[-_][^/]*\.$ext$"
	m=$(ls dist | grep -cE "$re") || true
	[ "$m" = 1 ] || {
		echo "a fielded self-updater matching /$re/ would pick $m assets, want exactly 1:"
		ls dist | grep -E "$re" || true
		exit 1
	}
done

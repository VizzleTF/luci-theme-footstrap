#!/bin/sh
# Build luci-theme-footstrap as an OpenWrt .apk via the SDK.
# The theme is noarch (CSS/JS/templates/fonts only), so the package installs on any
# router of that release whatever its CPU architecture.
#
#   ./build-apk.sh            # download SDK if needed, then build
#   BUILD_DIR=~/x ./build-apk.sh
set -e

REL="${OPENWRT_RELEASE:-25.12.2}"
SDK_BASE="https://downloads.openwrt.org/releases/${REL}/targets/mediatek/filogic"
SDK_FILE="openwrt-sdk-${REL}-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst"
SDK_URL="$SDK_BASE/$SDK_FILE"
# MUST be a case-sensitive fs (ext4/…), NOT an NTFS/9p Windows mount.
BUILD_DIR="${BUILD_DIR:-/tmp/ow-footstrap-build}"
# FORCE=1 overrides buildroot's host-prereq bail-outs (see step 4).
export FORCE=1
THEME_DIR="$(cd "$(dirname "$0")" && pwd)"          # this package
REPO="$(cd "$THEME_DIR/.." && pwd)"                 # repo root (holds tools/, .github/)
BUILD_YML="$REPO/.github/workflows/build.yml"
SDK_DIR="$BUILD_DIR/sdk"
# The SDK channel (major.minor) the release SDK is signed under — derived from REL, never a
# second copy: 25.12.2 -> 25.12.
CHANNEL="${REL%.*}"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# 1. SDK
if [ ! -d "$SDK_DIR" ]; then
	echo ">> downloading SDK $REL ..."
	# --https-only: GNU wget follows https -> http redirects, and this tarball is a toolchain
	# that will build a package a maintainer may hand to someone.
	wget -q --https-only -O sdk.tar.zst "$SDK_URL"

	# Verify the SDK: signature first, checksum under it. This is the least verified input in this
	# repo and the only one that ends up INSIDE the built package (jsmin.c and i18n-scan.pl are
	# LINTERS pinned by commit and sha256; the toolchain that compiles the artifact arrives on TLS).
	# `sha256sums` alone is NOT a verification — it is served by the same host from the same
	# directory, unsigned, so whoever can replace the tarball replaces the checksum beside it (see
	# CLAUDE.md on GitHub's asset digest). What makes it one is the ed25519 signature over that file,
	# checked with a key pinned from a DIFFERENT host (github.com/openwrt/keyring). Fails CLOSED.
	#
	# Same check as .github/workflows/build.yml, from the SAME canonical inputs: the keyring/usign
	# pins come from luci-upstream.pin, and the branch's signing key is read out of build.yml's
	# matrix (its documented home — the key is a property of the branch, not of the pin file) rather
	# than copied here, so this convenience script cannot drift from the release path.
	[ -f "$BUILD_YML" ] || { echo "build.yml not found at $BUILD_YML — run from a repo checkout" >&2; exit 1; }
	. "$THEME_DIR/luci-upstream.pin"
	[ -n "${OPENWRT_KEYRING_PIN:-}" ] || { echo "OPENWRT_KEYRING_PIN missing from luci-upstream.pin" >&2; exit 1; }

	# sdk_key / sdk_key_sha256 for CHANNEL, straight out of build.yml's matrix.
	read -r SDK_KEY SDK_KEY_SHA256 <<-EOF
	$(awk -F"'" -v ch="$CHANNEL" '
		/channel:/ { c = $2 }
		c == ch && /sdk_key:/        { k = $2 }
		c == ch && /sdk_key_sha256:/ { s = $2 }
		END { print k, s }' "$BUILD_YML")
	EOF
	[ -n "$SDK_KEY" ] && [ -n "$SDK_KEY_SHA256" ] \
		|| { echo "no SDK signing key for channel $CHANNEL in build.yml" >&2; exit 1; }

	echo ">> verifying SDK signature (key $SDK_KEY, channel $CHANNEL) ..."
	rm -rf "$BUILD_DIR/usign"
	U="$("$REPO/tools/build-usign.sh" "$BUILD_DIR/usign")"
	wget -q --https-only -O sha256sums     "$SDK_BASE/sha256sums"
	wget -q --https-only -O sha256sums.sig "$SDK_BASE/sha256sums.sig"
	wget -q --https-only -O openwrt.pub \
		"https://raw.githubusercontent.com/openwrt/keyring/$OPENWRT_KEYRING_PIN/usign/$SDK_KEY"
	echo "$SDK_KEY_SHA256  openwrt.pub" | sha256sum -c - >/dev/null \
		|| { echo "OpenWrt's $CHANNEL key does not match its pin — refusing to verify with it" >&2; exit 1; }
	"$U" -V -m sha256sums -p openwrt.pub -x sha256sums.sig \
		|| { echo "BAD SIGNATURE on OpenWrt's sha256sums — refusing to build with this SDK." >&2; exit 1; }
	echo ">> signature verified; now the checksum means something."

	WANT="$(grep -F " *$SDK_FILE" sha256sums | cut -d' ' -f1)"
	[ -n "$WANT" ] || { echo "no sha256 published for $SDK_FILE" >&2; exit 1; }
	GOT="$(sha256sum sdk.tar.zst | cut -d' ' -f1)"
	[ "$WANT" = "$GOT" ] || { echo "SDK checksum mismatch: want $WANT, got $GOT" >&2; exit 1; }
	rm -f sha256sums sha256sums.sig openwrt.pub
	echo ">> SDK verified."

	echo ">> extracting ..."
	mkdir -p "$SDK_DIR"
	tar --zstd -xf sdk.tar.zst -C "$SDK_DIR" --strip-components=1
	rm -f sdk.tar.zst
fi
cd "$SDK_DIR"

# 2. feeds (need luci for luci.mk + BuildPackage macros)
if [ ! -f feeds/luci.index ] && [ ! -d feeds/luci ]; then
	./scripts/feeds update base luci
fi
./scripts/feeds install -a -p luci >/dev/null 2>&1 || true

# 3. drop our theme into the luci themes feed (fresh copy)
DEST="feeds/luci/themes/luci-theme-footstrap"
rm -rf "$DEST"
cp -a "$THEME_DIR" "$DEST"
rm -rf "$DEST/build-apk.sh" "$DEST/dev-sync.sh" "$DEST/.git" 2>/dev/null || true

./scripts/feeds update -i luci
./scripts/feeds install luci-theme-footstrap

# 4. build. ncurses is only needed for interactive menuconfig, not for a noarch
# theme, so satisfy the host prereq stamp to skip that check.
mkdir -p staging_dir/host
touch staging_dir/host/.prereq-build
make defconfig FORCE=1
make package/luci-theme-footstrap/clean FORCE=1 V=s >/dev/null 2>&1 || true
make package/luci-theme-footstrap/compile FORCE=1 V=s

# 5. locate the artifact
echo
echo ">> built packages:"
find bin -name 'luci-theme-footstrap*' \( -name '*.apk' -o -name '*.ipk' \) -print

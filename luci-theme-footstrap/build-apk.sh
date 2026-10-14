#!/bin/sh
# Build luci-theme-footstrap as an OpenWrt .apk via the SDK. The theme is noarch, so the package
# installs on any router of that release whatever its CPU architecture.
#
#   ./build-apk.sh            # download SDK if needed, then build
#   BUILD_DIR=~/x ./build-apk.sh
#
# NOT how the release is built (`./tools/stage.sh && owfeed build` is). This exercises the other
# path: the Makefile, luci.mk, jsmin and the SDK's packaging, for anyone building without owfeed.
set -eu

# Release and gcc string are baked into the SDK filename and downloads.openwrt.org keeps only the
# current point release, so this goes stale: keep it at owfeed.lock's 25.12 `point:`. Override with
# OPENWRT_RELEASE and OPENWRT_SDK_FILE.
REL="${OPENWRT_RELEASE:-25.12.5}"
SDK_BASE="https://downloads.openwrt.org/releases/${REL}/targets/mediatek/filogic"
SDK_FILE="${OPENWRT_SDK_FILE:-openwrt-sdk-${REL}-mediatek-filogic_gcc-14.3.0_musl.Linux-x86_64.tar.zst}"
SDK_URL="$SDK_BASE/$SDK_FILE"
# MUST be a case-sensitive fs (ext4/…), NOT an NTFS/9p Windows mount.
BUILD_DIR="${BUILD_DIR:-/tmp/ow-footstrap-build}"
# FORCE=1 overrides buildroot's host-prereq bail-outs (see step 4).
export FORCE=1
THEME_DIR="$(cd "$(dirname "$0")" && pwd)"          # this package
REPO="$(cd "$THEME_DIR/.." && pwd)"                 # repo root (holds tools/, .github/)
SDK_DIR="$BUILD_DIR/sdk"
# the SDK signing channel, derived from REL (25.12.2 -> 25.12)
CHANNEL="${REL%.*}"

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# 1. SDK
if [ ! -d "$SDK_DIR" ]; then
	echo ">> downloading SDK $REL ..."
	# --https-only: GNU wget follows https -> http redirects
	wget -q --https-only -O sdk.tar.zst "$SDK_URL"

	# Signature first, checksum under it: the toolchain lands inside the built package. `sha256sums`
	# alone proves nothing, it is served unsigned beside the tarball (docs/conventions.md). The
	# ed25519 signature, checked with a key pinned from another host (github.com/openwrt/keyring),
	# is what holds. Fails CLOSED. Every pin comes from luci-upstream.pin.
	. "$THEME_DIR/luci-upstream.pin"
	[ -n "${OPENWRT_KEYRING_PIN:-}" ] || { echo "build-apk: OPENWRT_KEYRING_PIN missing from luci-upstream.pin" >&2; exit 1; }

	# OPENWRT_SDK_KEY_<channel without dot>, through eval: /bin/sh has no associative arrays
	CH_VAR="$(printf '%s' "$CHANNEL" | tr -d .)"
	eval "SDK_KEY=\${OPENWRT_SDK_KEY_$CH_VAR:-}"
	eval "SDK_KEY_SHA256=\${OPENWRT_SDK_KEY_${CH_VAR}_SHA256:-}"
	[ -n "$SDK_KEY" ] && [ -n "$SDK_KEY_SHA256" ] \
		|| { echo "build-apk: no SDK signing key for channel $CHANNEL in luci-upstream.pin" >&2; exit 1; }

	echo ">> verifying SDK signature (key $SDK_KEY, channel $CHANNEL) ..."
	rm -rf "$BUILD_DIR/usign"
	U="$("$REPO/tools/build-usign.sh" "$BUILD_DIR/usign")"
	wget -q --https-only -O sha256sums     "$SDK_BASE/sha256sums"
	wget -q --https-only -O sha256sums.sig "$SDK_BASE/sha256sums.sig"
	wget -q --https-only -O openwrt.pub \
		"https://raw.githubusercontent.com/openwrt/keyring/$OPENWRT_KEYRING_PIN/usign/$SDK_KEY"
	echo "$SDK_KEY_SHA256  openwrt.pub" | sha256sum -c - >/dev/null \
		|| { echo "build-apk: OpenWrt's $CHANNEL key does not match its pin — refusing to verify with it" >&2; exit 1; }
	"$U" -V -m sha256sums -p openwrt.pub -x sha256sums.sig \
		|| { echo "build-apk: BAD SIGNATURE on OpenWrt's sha256sums — refusing to build with this SDK." >&2; exit 1; }
	echo ">> signature verified; now the checksum means something."

	WANT="$(grep -F " *$SDK_FILE" sha256sums | cut -d' ' -f1)"
	[ -n "$WANT" ] || { echo "build-apk: no sha256 published for $SDK_FILE" >&2; exit 1; }
	GOT="$(sha256sum sdk.tar.zst | cut -d' ' -f1)"
	[ "$WANT" = "$GOT" ] || { echo "build-apk: SDK checksum mismatch: want $WANT, got $GOT" >&2; exit 1; }
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
# a worktree can hold 0600/0700 (git stores 100644); uhttpd answers 403 on a file that is not world-readable
chmod -R u=rwX,go=rX "$DEST"
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

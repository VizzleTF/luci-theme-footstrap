#!/bin/sh
# luci-theme-footstrap installer for OpenWrt 24.10 (ipk) and 25.12+ (apk).
#
# One-line install (run on the router over SSH):
#   wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
# or:
#   curl -fsSL https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
#
# WHAT IT DOES FIRST: adds the owfeed-packages repository (key, repo entry, and a keep.d entry so a
# firmware upgrade does not wipe either) and installs through apk/opkg — so `apk upgrade` carries
# the theme forward afterwards, which a downloaded file never does. The release-asset path below is
# the FALLBACK, for a pinned tag (the feed holds one version per branch) or an unreachable feed.
#
# THAT URL IS THE RELEASE ASSET, NOT raw.githubusercontent.com, and the difference is the whole of
# issue #17. GitHub's 2025-05-08 changelog rate-limits three things for unauthenticated callers:
# HTTPS clone, the REST API, and downloads from raw.githubusercontent.com. Behind CGNAT or a shared
# exit that 60/hour budget is often already spent by somebody else, so the raw URL can fail to
# deliver the very installer meant to help. Release assets carry no such budget. raw still works and
# is documented as the fallback; it is simply not the first thing to reach for.
#
# Optional: pin the release tag ->  ... | sh -s v0.9.3
#
# THERE IS NO UPDATE CHECKER ANY MORE. A separate luci-app-footstrap-updater used to be offered here,
# because a downloaded package is one the package manager will never upgrade. Installing from the
# feed removes the reason for it: `apk upgrade` / `opkg upgrade` carries the theme forward like
# anything else, which is what a package manager is for. Licensed Apache-2.0.

set -e

REPO_THEME="VizzleTF/luci-theme-footstrap"
TAG="${1:-latest}"

# A signed manifest, published as a release asset and fetched from the release CDN — this is what
# replaced api.github.com as the source of "which asset, how big, what sha256" (see resolve_manifest).
# The Pages copies are MIRRORS of the same signed file, for when github.com itself cannot be reached;
# each holds only its repo's LATEST release, so a pinned tag never looks there.
MIRROR_THEME="https://vizzletf.github.io/luci-theme-footstrap/manifest.txt"

# An OPTIONAL prefix put in front of every github.com URL, for networks where GitHub is not reachable
# at all — `GITHUB_PROXY=https://some-proxy/ sh install.sh`. **Empty by default, and that is a
# deliberate choice, not an oversight.**
#
# What makes it safe to offer: every byte it can deliver is checked against the signed manifest, so a
# proxy can serve the real release or fail, and nothing else. What makes it unsafe to DEFAULT to: a
# proxy sees, and can rewrite, whatever is not covered by a signature — and the one thing not covered
# is THIS SCRIPT. A one-liner that pipes an installer through a third party into `sh` as root hands
# that party the router; the signature chain starts only after the script is already running. So the
# proxy is something the admin turns on knowingly, for the assets, and the documented install URL
# always points straight at github.com.
#
# Tried FIRST when set: an admin only sets it because the direct route does not work, and trying the
# direct route first would mean waiting out a timeout on every request. Direct remains the fallback,
# so a proxy that dies does not take the install with it.
GITHUB_PROXY="${GITHUB_PROXY:-}"

# mktemp, not a fixed /tmp name: /tmp is 1777, so a local unprivileged process can pre-create a
# predictable name as a symlink and root writes the downloaded package through it (CWE-377).
TMP="$(mktemp -d)" || { printf '[-] cannot create a temp dir\n' >&2; exit 1; }
trap 'rm -rf "$TMP"' EXIT INT TERM

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
warn() { printf '[!] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }

case "$GITHUB_PROXY" in
	''|https://*) ;;
	*) err "GITHUB_PROXY must be an https:// URL (got: $GITHUB_PROXY)"; exit 1 ;;
esac

printf '\n================================================\n'
printf '    luci-theme-footstrap installer\n'
printf '    LuCI theme for OpenWrt 24.10 / 25.12+\n'
printf '================================================\n\n'

# --- detect OpenWrt + require >= 24.10 -----------------------------------
if [ -f /etc/openwrt_release ]; then
	. /etc/openwrt_release 2>/dev/null || true
	ok "Detected: ${DISTRIB_DESCRIPTION:-OpenWrt}"
else
	warn "This does not look like OpenWrt — continuing anyway."
fi

# Refuse clearly-too-old releases (the theme needs the ucode theme engine + modern CSS of
# 24.10+). SNAPSHOT / empty / non-numeric versions are allowed through.
case "${DISTRIB_RELEASE:-}" in
	''|*SNAPSHOT*) : ;;
	*)
		_maj=$(printf '%s' "$DISTRIB_RELEASE" | cut -d. -f1)
		_min=$(printf '%s' "$DISTRIB_RELEASE" | cut -d. -f2)
		case "$_maj$_min" in
			*[!0-9]*|'') : ;;	# unparseable -> don't block
			*)
				if [ "$_maj" -lt 24 ] || { [ "$_maj" -eq 24 ] && [ "$_min" -lt 10 ]; }; then
					err "footstrap requires OpenWrt 24.10 or newer (detected $DISTRIB_RELEASE)."
					exit 1
				fi
				;;
		esac
		;;
esac

# --- pick package manager / asset format ---------------------------------
if command -v apk >/dev/null 2>&1; then
	PM="apk"; EXT="apk"
elif command -v opkg >/dev/null 2>&1; then
	PM="opkg"; EXT="ipk"
else
	err "Neither apk nor opkg found — cannot install a package."
	exit 1
fi
ok "Package manager: $PM (installing .$EXT)"

# --- the FEED, and why it is tried first ---------------------------------
#
# The theme is published in owfeed-packages, and installing from the feed rather than from a
# release asset changes what happens AFTER this script ends: `apk upgrade` / `opkg upgrade` sees
# the theme from then on, and so does every other package from that feed. A downloaded .apk is a
# file the package manager knows nothing about the origin of — it installs, and then it sits there
# at that version until somebody comes back with another file.
#
# So the feed is the first thing tried, and the release asset is the fallback for the two cases the
# feed cannot serve: a PINNED tag (the feed carries one version per branch, not history) and a
# router that cannot reach repo.owfeed.org. Both fall through with a message rather than failing.
#
# The keys are pinned HERE, as the feed's own install instructions publish them: apk verifies the
# index against the PEM, opkg against the usign key. That is what makes this path safe without the
# per-file signature check the asset path does — the package manager is doing the verifying, which
# is the whole reason to prefer it.
FEED_HOST="https://repo.owfeed.org"
FEED_NAME="owfeed-packages"
FEED_KEY_APK="$FEED_HOST/owfeed-packages.pem"
FEED_KEY_OPKG_ID="9040356b214084da"

# Which release branch of the feed to point at. The feed publishes per OpenWrt minor, so this is
# taken from the ROUTER rather than assumed: a 24.10 box gets 24.10, a 25.12 box gets 25.12.
# SNAPSHOT and anything unparseable have no branch to pick, so they take the asset path instead.
feed_branch() {
	case "${DISTRIB_RELEASE:-}" in
		''|*SNAPSHOT*) return 1 ;;
	esac
	_b=$(printf '%s' "$DISTRIB_RELEASE" | cut -d. -f1,2)
	case "$_b" in
		[0-9][0-9].[0-9][0-9]) printf '%s' "$_b" ;;
		*) return 1 ;;
	esac
}

# Add the feed if it is not already configured, then install from it. Returns non-zero on any
# failure, and every one of them is recoverable — the caller falls back to the release asset.
#
# `keep.d` is not optional bookkeeping: sysupgrade wipes /etc/apk/keys and the repositories list
# unless something claims them, so a router that keeps its settings across a firmware upgrade would
# come back with the feed silently gone and the theme unupgradable.
feed_install() {
	_br=$(feed_branch) || { info "No feed branch for '${DISTRIB_RELEASE:-unknown}' — using the release asset."; return 1; }
	_pkgs="$1"
	if [ "$PM" = "apk" ]; then
		_arch=$(cat /etc/apk/arch 2>/dev/null) || return 1
		[ -n "$_arch" ] || return 1
		if [ ! -f /etc/apk/keys/owfeed-packages.pem ]; then
			info "Adding the $FEED_NAME feed (key + repository)..."
			# ca-bundle and a TLS-capable fetcher: apk itself has to reach an https repo, and
			# neither is guaranteed present on a minimal image.
			apk add --quiet ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
			fetch "$FEED_KEY_APK" 30 /tmp/owfeed-packages.pem || return 1
			mkdir -p /etc/apk/keys /etc/apk/repositories.d
			mv /tmp/owfeed-packages.pem /etc/apk/keys/owfeed-packages.pem
			printf '%s/releases/%s/%s/packages.adb\n' "$FEED_HOST" "$_br" "$_arch" \
				> /etc/apk/repositories.d/owfeed-packages.list
			mkdir -p /lib/upgrade/keep.d
			printf '%s\n' /etc/apk/keys/owfeed-packages.pem \
				/etc/apk/repositories.d/owfeed-packages.list > /lib/upgrade/keep.d/owfeed-packages
			ok "Feed added: $FEED_HOST/releases/$_br/$_arch"
		else
			info "The $FEED_NAME feed is already configured."
		fi
		apk update >/dev/null 2>&1 || { warn "apk update failed — falling back to the release asset."; return 1; }
		# shellcheck disable=SC2086
		apk add $_pkgs || return 1
	else
		_arch=$(. /etc/openwrt_release 2>/dev/null; printf '%s' "$DISTRIB_ARCH")
		[ -n "$_arch" ] || return 1
		if ! grep -q "$FEED_NAME" /etc/opkg/customfeeds.conf 2>/dev/null; then
			info "Adding the $FEED_NAME feed (key + repository)..."
			opkg update >/dev/null 2>&1 || true
			opkg install ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
			fetch "$FEED_HOST/$FEED_KEY_OPKG_ID" 30 "/tmp/$FEED_KEY_OPKG_ID" || return 1
			mkdir -p /etc/opkg/keys
			mv "/tmp/$FEED_KEY_OPKG_ID" "/etc/opkg/keys/$FEED_KEY_OPKG_ID"
			printf 'src/gz %s %s/releases/%s/%s\n' "$FEED_NAME" "$FEED_HOST" "$_br" "$_arch" \
				>> /etc/opkg/customfeeds.conf
			mkdir -p /lib/upgrade/keep.d
			printf '%s\n' "/etc/opkg/keys/$FEED_KEY_OPKG_ID" /etc/opkg/customfeeds.conf \
				> /lib/upgrade/keep.d/owfeed-packages
			ok "Feed added: $FEED_HOST/releases/$_br/$_arch"
		else
			info "The $FEED_NAME feed is already configured."
		fi
		opkg update >/dev/null 2>&1 || { warn "opkg update failed — falling back to the release asset."; return 1; }
		# shellcheck disable=SC2086
		opkg install $_pkgs || return 1
	fi
	return 0
}

# --- downloader -----------------------------------------------------------
# fetch <url> <max-seconds> [outfile]  — stdout when no outfile.
#
# EVERY fetch VERIFIES THE CERTIFICATE. This runs as root from `curl | sh`, and the package
# manager installs --allow-untrusted (it holds no key of ours), so what vouches for the package
# is the ed25519 signature checked below — but this channel is what delivers the release metadata
# that names the asset, its checksum and its signature. Never `-k` / `--no-check-certificate`,
# not even as a retry: a failed verification IS the MITM case, and `ca-bundle` is in OpenWrt's
# DEFAULT_PACKAGES, so the insecure path buys nothing.
#
# Signature pinned to footstrap-selfupdate.sh's fetch(): the two cannot share a file (this one
# runs before the package exists) and had already drifted — this one took (url, outfile),
# hardcoded --max-time on curl, and gave uclient-fetch, its FIRST choice on OpenWrt, no timeout.
# wget is the last resort (non-OpenWrt); GNU wget follows https -> http redirects, hence
# --https-only where the flag exists.
#
# IT OWNS THE NAMES `_u`, `_t` AND `_o`. sh has no locals, so a caller keeping its own state in one
# of those loses it at the first fetch — and it loses it silently, into a plausible value: measured
# in resolve_manifest, `_o` came back as the .sig path and `_t` as the string `20`, which turned the
# tag check into `20 = latest` and sent every router down the API fallback with no message at all.
fetch_direct() {
	_u="$1"; _t="$2"; _o="$3"
	if command -v uclient-fetch >/dev/null 2>&1; then
		if [ -n "$_o" ]; then uclient-fetch -T "$_t" -qO "$_o" "$_u" 2>/dev/null
		else uclient-fetch -T "$_t" -qO- "$_u" 2>/dev/null; fi
		return $?
	fi
	if command -v curl >/dev/null 2>&1; then
		if [ -n "$_o" ]; then
			curl -fsSL --proto =https --proto-redir =https --connect-timeout 10 --max-time "$_t" -o "$_o" "$_u" 2>/dev/null
		else
			curl -fsSL --proto =https --proto-redir =https --connect-timeout 10 --max-time "$_t" "$_u" 2>/dev/null
		fi
		return $?
	fi
	if command -v wget >/dev/null 2>&1; then
		_s=''
		wget --help 2>&1 | grep -q -- '--https-only' && _s='--https-only'
		if [ -n "$_o" ]; then wget -q $_s -T "$_t" -O "$_o" "$_u"
		else wget -q $_s -T "$_t" -O- "$_u"; fi
		return $?
	fi
	return 1
}
# fetch <url> <max-seconds> [outfile] — the one every caller uses. With no GITHUB_PROXY set (the
# default) it IS fetch_direct; with one set, GitHub URLs are tried through the proxy first and fall
# back to the direct route, so a dead proxy cannot take the install down with it.
#
# Only github hosts are rewritten. A proxy prefix has no business in front of, say, the Pages mirror
# URL, and an unconditional rewrite would send every future URL through a third party by accident.
#
# The proxy can serve wrong bytes; it cannot serve bytes that pass. Everything fetched through here
# is either checked against the signed manifest (packages, notes) or IS the signature check itself
# (the manifest and its .sig). The one thing outside that chain is this script, which is why the
# documented install URL never goes through a proxy — see the GITHUB_PROXY note at the top.
fetch() {
	_fu="$1"; _ft="$2"; _fo="$3"
	if [ -n "$GITHUB_PROXY" ]; then
		case "$_fu" in
			https://github.com/*|https://api.github.com/*|https://raw.githubusercontent.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*)
				if fetch_direct "${GITHUB_PROXY%/}/$_fu" "$_ft" "$_fo"; then
					[ -z "$_fo" ] || [ -s "$_fo" ] && return 0
				fi
				[ -n "$_fo" ] && rm -f "$_fo"
				;;
		esac
	fi
	fetch_direct "$_fu" "$_ft" "$_fo"
}

# The URL comes out of the API answer and the file it names is handed to `apk add
# --allow-untrusted` as root. Pin the host, so a malformed or tampered response cannot point
# that install at an arbitrary server.
# vizzletf.github.io is the release MIRROR (see resolve_manifest). It is on the list because a
# mirrored install fetches its packages from there — not because being on the list is what makes
# those bytes acceptable: what does that is the sha256 in the signed manifest, which the mirror
# cannot influence.
asset_host_ok() {
	case "$1" in
		https://github.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) return 0 ;;
		https://vizzletf.github.io/*) return 0 ;;
	esac
	return 1
}

# Pick the asset by package NAME, not by extension. `grep "\.apk$" | head -n1` — what this did —
# takes whichever asset GitHub lists first, and the API sorts assets BY NAME: in v0.8.4, when the
# release still carried separate luci-i18n-footstrap-<lang> packages, that was a 6 KB catalogue
# installed in place of the theme (issue #6). Releases hold ONE package per format now; the name
# match is the fix for the next such mistake.
#
# `[-_]` is the separator both naming schemes use and is what keeps the two names apart (apk:
# `name-1.2.3-r1.apk`, ipk: `name_1.2.3-r1_all.ipk`); anchoring on `/` in front stops a repo or
# tag containing the package name from matching.
#
asset_urls() {		# <json> <package-name> -> every matching asset URL, one per line
	jsonfilter -i "$1" -e '@.assets[*].browser_download_url' 2>/dev/null \
		| grep -E "/$2[-_][^/]*\.$EXT\$" || true
}
asset_digest() {	# <json> <url> -> the sha256 GitHub publishes for THAT asset
	# matched on the URL rather than on list position — the two `assets[*]` lists
	# happen to be parallel today, but nothing promises it
	jsonfilter -i "$1" -e "@.assets[@.browser_download_url=\"$2\"].digest" 2>/dev/null | head -n1
}
sig_url() {		# <json> <package-url> -> the detached signature published for THAT package
	# Looked UP in the asset list, never derived by appending ".sig" to the URL: a derived URL
	# is a URL nobody published, and it would send the fetch after a file the release does not
	# claim to have. -Fx = whole line, literal.
	jsonfilter -i "$1" -e '@.assets[*].browser_download_url' 2>/dev/null | grep -Fx "$2.sig" || true
}

# usign is on EVERY OpenWrt image — base-files depends on it — so verifying the release signature
# costs the theme no new runtime dependency (see LUCI_DEPENDS in the Makefile: the curl lesson).
# The key is the package's own; it is not added to /etc/apk/keys, so nothing this package does
# makes footstrap a trust anchor for the router's package manager at large.
verify_sig() {		# <file> <sigfile> <pubkey-file> -> 0 iff the signature is ours and intact
	command -v usign >/dev/null 2>&1 || return 2
	usign -V -q -m "$1" -x "$2" -p "$3"
}

# THE ONLY COPY of the release public key outside the packages, and it has to exist: this script is
# fetched with `curl | sh` and runs BEFORE any package is installed. The package copy is
# luci-app-footstrap-updater/root/usr/share/luci-app-footstrap-updater/release.pub — the self-updater
# reads THAT one — and CI fails the build if the two ever say different things. One key signs both the
# theme's assets.
#
# A public key is public — pinning it here is the point, not a leak. It is what makes a tampered
# release asset unusable even though the API answer that names the asset comes from the same host
# as its checksum.
release_pubkey() {	# writes the key to $1
	cat > "$1" <<-'EOF'
	untrusted comment: luci-theme-footstrap release key
	RWQYxjhl4rz41tNZc3dXmnRplRO1ydN1q8as++iPUjZc6SRUCb952L/T
	EOF
}

# --- the signed release manifest -----------------------------------------
#
# WHY THIS EXISTS. Everything below used to come out of api.github.com, which allows 60
# unauthenticated requests per hour PER SOURCE IP. Behind CGNAT, a shared exit or a DNS-based
# unblocker that budget belongs to strangers, and the installer died with "Could not reach the
# GitHub release API" — an error message that sent people installing ca-bundle three times over
# (issue #17). The release CDN has no such budget: `releases/latest/download/<file>` answers a
# 302 with no x-ratelimit-* header at all, and it is the same host that has been serving the
# packages themselves all along. So the metadata moved into a file served from there.
#
# WHAT IT IS. A signed, line-oriented text file. `latest` resolves exactly as the API's
# /releases/latest does — newest non-prerelease, non-draft:
#
#   owfeed-manifest 1
#   repo VizzleTF/luci-theme-footstrap
#   tag v0.10.2
#   version 0.10.2
#   date 2026-07-24T10:12:03Z
#   notes <sha256> notes.md
#   pkg luci-theme-footstrap apk luci-theme-footstrap-0.10.2-r1.apk 162357 <sha256> noarch
#   pkg luci-theme-footstrap ipk luci-theme-footstrap_0.10.2-r1_all.ipk 162128 <sha256> all
#
# The first line said `footstrap-manifest 1` up to 0.11.6: the file is written by `owfeed
# release` now (it was hand-rolled in this repo's workflow, and owfeed's own shape was modelled
# on it). NOTHING PARSES THAT LINE — not this script — so the rename is
# invisible to a router. The trailing `arch` is new for the same reason it is TRAILING: mf_pkg
# below reads fields 4, 5 and 6 positionally, and a router's installed copy cannot be fixed
# remotely, so a field inserted before them would have made every update fetch a URL that 404s.
#
# WHAT IT REPLACES IN THE TRUST CHAIN — nothing. It moves the sha256 from a value GitHub computes
# for us into a value WE signed, which is strictly stronger: the old digest was recomputed for
# whoever replaced the asset (a leaked write-scoped PAT is enough), and a manifest cannot be, since
# the signing key is a secret that cannot be read back out. usign over the manifest therefore
# covers every package hash it lists, which is why the manifest path does not fetch the packages'
# own .sig files. (Those are still published: a router that installed the retired self-updater goes
# on fetching them, and an installed package cannot be fixed remotely.)
mf_url() {		# <repo> <tag> -> the manifest URL for that release
	if [ "$2" = "latest" ]; then
		printf 'https://github.com/%s/releases/latest/download/manifest.txt' "$1"
	else
		printf 'https://github.com/%s/releases/download/%s/manifest.txt' "$1" "$2"
	fi
}
mf_get() { awk -v k="$2" '$1==k {print $2; exit}' "$1"; }
mf_pkg() {		# <manifest> <package-name> <ext> -> "<file> <size> <sha256>"
	awk -v n="$2" -v e="$3" '$1=="pkg" && $2==n && $3==e {print $4, $5, $6; exit}' "$1"
}

# The manifest names the asset FILE, and that name becomes both a URL and a path in the working
# directory. The signature is what makes the name trustworthy — but a compromised pipeline signing
# `../../etc/something` must still not become a path traversal as root, and a defence that only
# works when the other defence held is not a defence.
safe_name() {
	case "$1" in
		''|*/*|.*|*[!A-Za-z0-9._-]*) return 1 ;;
	esac
	return 0
}

# Fetch the manifest and its signature, VERIFY, and only then look inside it. Order matters: parsing
# first would mean acting on unverified text, and every value in there steers a download.
#
# Return codes are distinct because the fixes are: 1 = could not fetch (network / no release / this
# release predates manifests), 2 = signature failed (never overridable — that is not a missing check,
# it is a failed one), 3 = verified but describes a DIFFERENT repo or tag. That last one is not
# pedantry: ONE key signs both repos' manifests, so without the `repo` check a manifest lifted from
# one repo's release verifies perfectly as another's. A signature proves who wrote a file, never
# what the file is about.
#
# NOTE THE VARIABLE NAMES, because this function was written once with the obvious ones and it was
# wrong: sh has no locals, and fetch() assigns `_u`, `_t` and `_o`. A caller that keeps its own state
# in those names loses it at the first fetch — measured here as `[ -s …mf.sig.sig ]` (the output path
# had become the signature's) and a tag check comparing the string `20` (the timeout) against
# `latest`, which sent every router down the API path in silence. Anything this function must still
# hold AFTER a fetch is prefixed `_mf`.
# Sets MF_BASE: empty when the manifest came from GitHub (packages are fetched from the release),
# or the mirror's directory URL when it came from the mirror — a router that could not reach
# github.com for the manifest will not reach it for the packages either, since a release asset URL
# redirects through github.com. The mirror serves both, and the manifest's signed sha256 is what
# holds either way, so this changes where the bytes come from and never whether they are checked.
resolve_manifest() {	# <repo> <tag> <outfile> [mirror-url]
	_mfrepo="$1"; _mftag="$2"; _mfout="$3"; _mfmirror="$4"
	_mfurl="$(mf_url "$_mfrepo" "$_mftag")"
	MF_BASE=""

	if ! { fetch "$_mfurl" 20 "$_mfout" && [ -s "$_mfout" ] &&
	       fetch "$_mfurl.sig" 20 "$_mfout.sig" && [ -s "$_mfout.sig" ]; }; then
		# The mirror carries the same signed bytes, so falling back to it cannot lower the bar —
		# it can only serve the real manifest or fail verification below. It mirrors the LATEST
		# release only, hence the tag guard.
		[ -n "$_mfmirror" ] && [ "$_mftag" = "latest" ] || return 1
		fetch "$_mfmirror" 20 "$_mfout" && [ -s "$_mfout" ] || return 1
		fetch "$_mfmirror.sig" 20 "$_mfout.sig" && [ -s "$_mfout.sig" ] || return 1
		MF_BASE="${_mfmirror%/*}"
		info "github.com did not answer — using the mirror (same signed files)."
	fi

	verify_sig "$_mfout" "$_mfout.sig" "$PUB" || return 2
	[ "$(mf_get "$_mfout" repo)" = "$_mfrepo" ] || return 3
	[ "$_mftag" = "latest" ] || [ "$(mf_get "$_mfout" tag)" = "$_mftag" ] || return 3
	return 0
}

# --- resolve the assets (TWO repos since the split) -----------------------
#
# TWO SOURCES, IN THIS ORDER, and the order is the point:
#   1. the signed manifest, off the release CDN — no API budget, so it works for the users this
#      installer kept failing for;
#   2. api.github.com, only when the release publishes no manifest. That means a release cut before
#      manifests existed — a pinned old tag (`sh -s v0.9.3`), which is the honest use — and it is
#      also what carries the changeover, since the newest release has no manifest until the first
#      one is cut with this code in it.
# There is no third: if a release has a manifest and it fails to VERIFY, that is a refusal, not a
# reason to go ask the API for a second opinion.

# The public key is written ONCE, up here: resolve_manifest needs it before any package is fetched.
PUB="$TMP/release.pub"
release_pubkey "$PUB"

# Fetch a repo's release JSON. $1 owner/repo, $2 outfile, $3 tag (latest | vX). The API path only.
resolve_release() {
	if [ "$3" = "latest" ]; then _api="https://api.github.com/repos/$1/releases/latest"
	else _api="https://api.github.com/repos/$1/releases/tags/$3"; fi
	fetch "$_api" 20 "$2" && [ -s "$2" ]
}

# Resolve one repo's package. Sets, for the caller:
#   <PREFIX>_URL   the package URL (built HERE from a verified tag + name, never taken from a JSON blob)
#   <PREFIX>_SHA   its sha256
#   <PREFIX>_SRC   "manifest" (the hash is signed) or the release JSON path (API path: check the .sig)
# Returns 1 when this repo offers nothing installable.
#
# On the manifest path the package URL is assembled from the manifest's own `tag`, not from `latest`:
# between reading the manifest and fetching the package a new release could become latest, and the
# sha256 we are about to enforce belongs to the release we READ.
# Every name here is `_rp*` for the reason spelled out above resolve_manifest: fetch() owns `_u`,
# `_t` and `_o`, and sh has no locals.
resolve_pkg() {		# <repo> <pkg-name> <tag> <mirror> <prefix>
	_rprepo="$1"; _rpname="$2"; _rptag="$3"; _rpmirror="$4"; _rppfx="$5"
	_rpmf="$TMP/$_rpname.mf"

	resolve_manifest "$_rprepo" "$_rptag" "$_rpmf" "$_rpmirror"; _rprc=$?
	case "$_rprc" in
		0)
			set -- $(mf_pkg "$_rpmf" "$_rpname" "$EXT")	# file size sha256
			[ -n "$1" ] && [ -n "$3" ] || return 1
			safe_name "$1" || {
				err "The manifest names an implausible asset: $1"
				err "Refusing — that name would become both a URL and a path under $TMP."
				exit 1
			}
			# Built from the manifest's OWN tag, never from `latest`: between reading the
			# manifest and fetching the package a newer release can become latest, and the
			# sha256 about to be enforced belongs to the release we READ. MF_BASE points at
			# the mirror when the manifest came from there (see resolve_manifest).
			_rprtag="$(mf_get "$_rpmf" tag)"
			if [ -n "$MF_BASE" ]; then
				eval "${_rppfx}_URL=\"\$MF_BASE/\$1\""
			else
				eval "${_rppfx}_URL=\"https://github.com/\$_rprepo/releases/download/\$_rprtag/\$1\""
			fi
			eval "${_rppfx}_SHA=\"\$3\""
			eval "${_rppfx}_SRC=manifest"
			return 0
			;;
		2)
			err "BAD SIGNATURE on the release manifest for $_rprepo — refusing."
			err "The metadata is not what we published. Do not work around this by hand;"
			err "report it at https://github.com/$REPO_THEME/issues"
			exit 1
			;;
		3)
			err "The release manifest for $_rprepo describes a different repo or tag — refusing."
			exit 1
			;;
	esac

	# No manifest: a pre-manifest release, or github.com is unreachable altogether. Ask the API.
	_rpjson="$TMP/$_rpname.json"
	resolve_release "$_rprepo" "$_rpjson" "$_rptag" || return 1
	_rpurl="$(asset_urls "$_rpjson" "$_rpname" | head -n1)"
	[ -n "$_rpurl" ] || return 1
	eval "${_rppfx}_URL=\"\$_rpurl\""
	eval "${_rppfx}_SHA=\"\""
	eval "${_rppfx}_SRC=\"\$_rpjson\""
	return 0
}

# --- TRY THE FEED FIRST ---------------------------------------------------
#
# Everything below this block resolves, downloads and verifies a release ASSET, and it stays: it is
# what serves a pinned tag and a router that cannot reach the feed. But on the ordinary run — latest
# version, network fine — installing from the feed is better in the way that matters after the
# install ends: the package manager knows where the theme came from, so `apk upgrade` /
# `opkg upgrade` carries it forward.
#
# A PINNED TAG SKIPS IT. The feed publishes one version per branch, so `sh install.sh v0.9.3` cannot
# be answered from it, and quietly installing a different version than the one asked for would be
# worse than the extra download.
if [ "$TAG" = "latest" ]; then
	if feed_install "luci-theme-footstrap"; then
		# BOTH caches, as postinst/postrm/uci-defaults do: dropping only the index cache leaves a
		# stale /tmp/luci-modulecache, which bites exactly here — a package that replaces the JS.
		rm -f /tmp/luci-indexcache* 2>/dev/null || true
		rm -rf /tmp/luci-modulecache 2>/dev/null || true
		# reload, NOT restart: restart logs out every LuCI session.
		[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1
		printf '\n'
		ok "Installed from the $FEED_NAME feed — \`$PM upgrade\` will keep it current."
		info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
		info "Layout, dark mode, palette, colours and the wallpaper live in the \"Footstrap\" tab"
		info "of System -> System. Each browser keeps its own choices; \"Save as default\" stores"
		info "the current look as the router-wide starting point."
		info "Then hard-reload the page (Ctrl+F5)."
		exit 0
	fi
	warn "Installing from the release asset instead."
fi

info "Resolving the theme release ($TAG) from $REPO_THEME..."
if ! resolve_pkg "$REPO_THEME" luci-theme-footstrap "$TAG" "$MIRROR_THEME" THEME; then
	err "Could not resolve a luci-theme-footstrap .$EXT for release '$TAG'."
	err "Neither the release manifest nor the GitHub release API answered with one."
	err "  - if it is a TLS/cert error, install the CA bundle:"
	if [ "$PM" = "apk" ]; then err "      apk add ca-bundle   (then re-run)"; else err "      opkg update && opkg install ca-bundle   (then re-run)"; fi
	err "  - releases: https://github.com/$REPO_THEME/releases"
	# The likeliest cause by far, and the one a user cannot guess a fix for: github.com does not
	# answer from this router at all. Print the way out instead of leaving them to search for it.
	# Only when no proxy is set — repeating the suggestion to someone who already took it is noise,
	# and their failure has a different cause.
	if [ -z "$GITHUB_PROXY" ]; then
		err ""
		err "  - if github.com is blocked or unreachable from this router, retry through a"
		err "    GitHub proxy (the packages are signed, so a proxy cannot substitute them):"
		err ""
		err "        GITHUB_PROXY=https://gh-proxy.com/ sh install.sh"
		err ""
		err "    other public ones, if that one is down: https://ghproxy.net/ ,"
		err "    https://ghfast.top/ , https://gh.llkk.cc/"
		err "    Verified working at the time of writing; none of them is ours."
	fi
	exit 1
fi
[ "$THEME_SRC" = manifest ] || warn "This release publishes no manifest — fell back to the GitHub API."

# jsonfilter (OpenWrt base image) is what reads the sha256 out of an API answer. It is required only
# ON THAT PATH now: the manifest path parses with awk, so a router missing jsonfilter can still
# install the current release. Refuse rather than fall back — without it there is no integrity check
# at all on the API path, only unverifiable bytes handed to root.
if [ "$THEME_SRC" != manifest ] && ! command -v jsonfilter >/dev/null 2>&1; then
	err "jsonfilter not found — it is part of OpenWrt's base image, and the API fallback needs it."
	err "This installer only supports OpenWrt."
	exit 1
fi

# --- download, verify, install --------------------------------------------
# TWO checks, answering DIFFERENT attackers, and both fail CLOSED.
#
#  - the ed25519 SIGNATURE is the one that matters. The sha256 cannot stand alone: GitHub
#    COMPUTES `@.assets[*].digest` from the uploaded bytes, so anyone who can replace a release
#    asset (a leaked write-scoped PAT — no CI run needed) gets the digest recomputed for them and
#    the checksum then cheerfully verifies the attacker's package. The signing key lives nowhere
#    in this repository and cannot be read back out of GitHub, so a replaced asset fails to
#    verify. `apk add --allow-untrusted` means the PACKAGE MANAGER holds no key of ours — it does
#    not mean the package is unverified; this script is what verifies it.
#  - the sha256 still earns its place: it catches a tampered or truncated download from the asset
#    CDN (a different host from api.github.com) with a clearer message. It does NOT remain if usign
#    is absent — nothing does: no usign is a REFUSAL below, which is correct and is the opposite of
#    what this comment used to promise.
#
# A MISSING digest or a MISSING signature is a REFUSAL, not a warning: half of a trust chain
# cannot be optional, and whatever empties it (a renamed field, an unexpected answer) leaves us
# installing bytes we cannot account for. FOOTSTRAP_ALLOW_UNVERIFIED=1 overrides — deliberately
# something you have to type, and its one honest use is pinning a release older than the signing
# key (`sh -s v0.9.0`). A signature that is PRESENT and WRONG is never overridable: that is not a
# missing check, that is a failed one.
#
# ON THE MANIFEST PATH the split is the same, only stronger: the sha256 is one WE signed, so the
# usign check has already happened — over the manifest, before any of this ran — and it covers this
# package's hash. There is nothing left for a per-package .sig to add, so it is not fetched. (The
# .sig assets are still published: a self-updater already in the field fetches them, and a router's
# installed updater cannot be fixed remotely.)
install_asset() {
	_url="$1"
	# $2: "manifest" — the sha256 in $3 came out of a signed manifest, so the signature is already
	# checked and covers it. Anything else is the release JSON that LISTS this asset (API path):
	# its digest is GitHub's, so the package's own detached .sig has to be fetched and verified.
	_src="$2"
	_sha="$3"
	_json="$_src"
	_name=$(basename "$_url")
	_pkg="$TMP/$_name"

	asset_host_ok "$_url" || { err "Refusing an asset from an unexpected host: $_url"; exit 1; }

	info "Downloading $_name..."
	if ! fetch "$_url" 600 "$_pkg" || [ ! -s "$_pkg" ]; then
		err "Download failed. If it is a TLS/cert error, install the CA bundle:"
		if [ "$PM" = "apk" ]; then err "  apk add ca-bundle   (then re-run)"; else err "  opkg update && opkg install ca-bundle   (then re-run)"; fi
		exit 1
	fi

	if [ "$_src" = manifest ]; then
		if ! command -v sha256sum >/dev/null 2>&1; then
			err "sha256sum not found — it is part of OpenWrt's base image. Refusing to install"
			err "a package whose signed hash cannot be checked."
			exit 1
		fi
		_got=$(sha256sum "$_pkg" | cut -d' ' -f1)
		if [ "$_sha" != "$_got" ]; then
			err "Checksum MISMATCH for $_name against the SIGNED manifest — refusing to install."
			err "  expected $_sha"
			err "  got      $_got"
			err "The download does not match what we published. Report it at"
			err "https://github.com/$REPO_THEME/issues"
			exit 1
		fi
		ok "verified against the signed manifest: $_name ($(wc -c < "$_pkg") bytes)"
		install_pkg_now "$_pkg" "$_name"
		return 0
	fi

	_digest=$(asset_digest "$_json" "$_url")
	if [ -z "$_digest" ] || ! command -v sha256sum >/dev/null 2>&1; then
		if [ "${FOOTSTRAP_ALLOW_UNVERIFIED:-0}" = "1" ]; then
			warn "No sha256 for $_name — installing UNVERIFIED because FOOTSTRAP_ALLOW_UNVERIFIED=1."
		else
			err "No sha256 available for $_name — refusing to install."
			err "The release must account for every byte it hands to root; half a trust chain"
			err "is not one."
			err "To override anyway:  FOOTSTRAP_ALLOW_UNVERIFIED=1 sh install.sh"
			exit 1
		fi
	else
		_want="${_digest#sha256:}"
		_got=$(sha256sum "$_pkg" | cut -d' ' -f1)
		if [ "$_want" != "$_got" ]; then
			err "Checksum MISMATCH for $_name — refusing to install."
			err "  expected $_want"
			err "  got      $_got"
			exit 1
		fi
		ok "sha256 verified: $_name ($(wc -c < "$_pkg") bytes)"
	fi

	_sig_url=$(sig_url "$_json" "$_url")
	_sig="$_pkg.sig"
	_pub="$PUB"
	if [ -z "$_sig_url" ] || ! command -v usign >/dev/null 2>&1; then
		if [ "${FOOTSTRAP_ALLOW_UNVERIFIED:-0}" = "1" ]; then
			warn "No signature check for $_name — installing UNVERIFIED because FOOTSTRAP_ALLOW_UNVERIFIED=1."
		elif [ -z "$_sig_url" ]; then
			err "This release publishes no signature for $_name — refusing to install."
			err "Releases up to and including v0.8.5 were published before signing existed."
			err "To install one of those anyway:"
			err "  FOOTSTRAP_ALLOW_UNVERIFIED=1 sh install.sh $TAG"
			exit 1
		else
			err "usign not found — it is part of OpenWrt's base image (base-files depends on it)."
			err "Without it the release signature cannot be checked, and the package is installed"
			err "with --allow-untrusted. Refusing."
			exit 1
		fi
	else
		asset_host_ok "$_sig_url" || { err "Refusing a signature from an unexpected host: $_sig_url"; exit 1; }
		if ! fetch "$_sig_url" 60 "$_sig" || [ ! -s "$_sig" ]; then
			err "Could not download the signature for $_name — refusing to install."
			exit 1
		fi
		if ! verify_sig "$_pkg" "$_sig" "$_pub"; then
			err "BAD SIGNATURE for $_name — refusing to install."
			err "The bytes downloaded are NOT the package we published. Do not install them by"
			err "hand; report it at https://github.com/$REPO_THEME/issues"
			exit 1
		fi
		ok "signature verified: $_name (usign, key $(usign -F -p "$_pub" 2>/dev/null))"
		rm -f "$_sig"
	fi

	install_pkg_now "$_pkg" "$_name"
}

# Hand the verified file to the package manager. Split out so that BOTH paths through install_asset
# end in the same three lines — an install that skipped a check by taking an early return past them
# is the failure mode this file is built around avoiding.
install_pkg_now() {
	info "Installing $2 with $PM..."
	if [ "$PM" = "apk" ]; then
		apk add --allow-untrusted "$1"
	else
		# local .ipk; luci-base is on any LuCI system already, so no repo fetch is needed.
		opkg install "$1"
	fi
	rm -f "$1"
}

install_asset "$THEME_URL" "$THEME_SRC" "$THEME_SHA"

# BOTH caches, as postinst/postrm/uci-defaults do: dropping only the index cache left a stale
# /tmp/luci-modulecache, which bites exactly here — a package that replaces the theme's JS.
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf /tmp/luci-modulecache 2>/dev/null || true

# reload, NOT restart: rpcd keeps sessions in memory, so restart logs out every LuCI user. SIGHUP
# (reload) re-reads /usr/share/rpcd/acl.d/*, which is all this package needs — verified live:
# removing our ACL + reload flips `session access` to false, and a session survives a reload.
if [ -x /etc/init.d/rpcd ]; then
	info "Reloading rpcd..."
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi

printf '\n'
ok "luci-theme-footstrap installed (translations included)."
info "It came from a FILE, so \`$PM upgrade\` will not carry it forward — add the"
info "owfeed-packages feed for upgrades (see the README), or re-run this installer."
info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
info "Layout, dark mode, palette, colours and the wallpaper live in the \"Footstrap\" tab"
info "of System -> System. Each browser keeps its own choices; \"Save as default\" stores"
info "the current look as the router-wide starting point."
info "Then hard-reload the page (Ctrl+F5)."

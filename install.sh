#!/bin/sh
# luci-theme-footstrap installer for OpenWrt 24.10 (opkg) and 25.12+ (apk). A 23.05 router is served
# the pinned final release instead — see FROZEN_2305_TAG. The feed carries the two branches the
# package FORMAT splits on and nothing else.
#
#   wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
#
# The same script is attached to every release and served from the release CDN, which has no
# per-address budget — the address raw.githubusercontent.com rate-limits is the one a user behind
# CGNAT shares with everyone else (issue #17). That copy is signed, so it can be verified before it
# is run as root:
#
#   wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
#
# It adds the owfeed-packages feed and installs the theme from it, so `apk upgrade` / `opkg upgrade`
# carries the theme forward afterwards; the feed index is verified by the package manager against
# the key pinned below. Running it again upgrades the theme. Licensed Apache-2.0.

set -e

FEED_HOST="https://repo.owfeed.org"
FEED_NAME="owfeed-packages"
FEED_KEY_OPKG="9040356b214084da"
# The bare host, with every `.` ESCAPED before it goes anywhere near `grep -E`: unescaped, `.` means
# "any character" and `repoXowfeedXorg` satisfied it (security review, task 0176-f). Not a URL
# parser (no IPv6, no percent-encoding) — three patterns, each anchored to where a repository URL
# actually starts rather than matched as a substring anywhere on the line (the other 0176-f finding:
# our host inside an unrelated URL's query string, `?u=https://repo.owfeed.org/`, used to count).
# Case-insensitive (`grep -Eqi`); a trailing CR is stripped by the caller before any of these run.
FEED_HOST_BARE="${FEED_HOST#*://}"
FEED_HOST_ESC=$(printf '%s' "$FEED_HOST_BARE" | sed 's/\./\\./g')
# customfeeds.list: optionally an apk `@tag`, then the URL itself — `repo.owfeed.org.evil.example`
# and `repo.owfeed.org@evil.example` both fail the `(:[0-9]+)?(/|$)` anchor right after the host.
APK_HOST_RE='^[[:space:]]*(@[^[:space:]]+[[:space:]]+)?https?://([^/@[:space:]]*@)?'"$FEED_HOST_ESC"'(:[0-9]+)?(/|$)'
# customfeeds.conf: `src` or `src/gz`, the name field, then the URL — matches only in the URL field,
# never against the name (the name rule is separate, in disable_other_lines below).
OPKG_HOST_RE='^[[:space:]]*src(/gz)?[[:space:]]+[^[:space:]]+[[:space:]]+https?://([^/@[:space:]]*@)?'"$FEED_HOST_ESC"'(:[0-9]+)?(/|$)'
# feed_refresh's own failure lines: the URL must start at a word boundary (line start, a space, or a
# quote/paren the two managers wrap it in), not merely appear mid-string — the same query-string
# trick would otherwise still work one line down, inside `apk update`'s own diagnostic text.
FEED_REFRESH_RE="(^|[[:space:]'\"(])https?://([^/@[:space:]]*@)?$FEED_HOST_ESC(:[0-9]+)?/"
PKG="luci-theme-footstrap"
REPO="VizzleTF/luci-theme-footstrap"
# `releases/latest/download/…` and never api.github.com: the API is rate-limited per source IP
# (60/hour, shared by everyone behind one NAT) and needs JSON parsing on a box that may have no
# jsonfilter.
# These redirect to the newest tag's assets and are the URLs the release page links.
RELEASE_BASE="https://github.com/$REPO/releases/latest/download"
# The last release that runs on 23.05, pinned by tag rather than by "latest": that release is EOL
# upstream, openwrt/luci declined to carry the one piece of compatibility it needed (#8978), and the
# theme dropped it rather than keep a widget nobody else wants. A 23.05 router is not refused — it
# gets that version, verified exactly like any other artifact, and is told it is the end of the
# line.
FROZEN_2305_TAG="v0.14.2"
FROZEN_2305_BASE="https://github.com/$REPO/releases/download/$FROZEN_2305_TAG"
# The RELEASE key, pinned in the script that uses it: a key fetched beside the file it verifies
# proves nothing. usign's key id travels inside the signature, so a rotation is a visible failure
# here rather than a silent acceptance.
RELEASE_PUBKEY='untrusted comment: luci-theme-footstrap release key
RWQYxjhl4rz41tNZc3dXmnRplRO1ydN1q8as++iPUjZc6SRUCb952L/T'

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }
warn() { printf '[!] %s\n' "$1" >&2; }

# Every downloader on the box, in turn, until one SUCCEEDS — not the first one that EXISTS.
#
# `uclient-fetch` needs libustream-mbedtls (or -openssl) to speak https at all, and a router with
# the binary and without the library is ordinary. Choosing by existence therefore turns "this ONE
# tool cannot do TLS here" into "the feed has no branch for this router".
#
# Certificates are always verified: this runs as root from `wget | sh`, and a failed verification is
# the MITM case rather than a reason to retry insecurely. Falling through to the next tool is not a
# downgrade — each one verifies, and none is ever asked to skip the check.
fetch() {	# <url> <outfile>
	command -v uclient-fetch >/dev/null 2>&1 && uclient-fetch -T 30 -qO "$2" "$1" && return 0
	command -v wget >/dev/null 2>&1 && wget -q -T 30 -O "$2" "$1" && return 0
	command -v curl >/dev/null 2>&1 && curl -fsSL --proto =https --max-time 30 -o "$2" "$1" && return 0
	return 1
}

# The package manager's chatter is not the user's business — until it fails.
#
# `apk update` prints every repository the router has, and `apk add` prints its progress. Running
# this from `wget | sh` is a one-command gesture, and burying the one sentence that matters — which
# version ended up on the router — under a dump of somebody else's feed URLs defeats it.
#
# So: capture, and speak only on failure, where the same output is the only diagnosis available.
# Never `>/dev/null`: a silent failure here is a router left half-installed with a green message.
pm_quiet() {	# <command...>
	_pmlog="/tmp/fs-install-pm.$$"
	if "$@" >"$_pmlog" 2>&1; then rm -f "$_pmlog"; return 0; fi
	err "\`$*\` failed:"
	tail -15 "$_pmlog" | sed 's/^/    /' >&2
	rm -f "$_pmlog"
	return 1
}

# How many repository lines each manager was asked to read, right before feed_refresh() below
# needs it to tell "one feed missing" from "none answered". Comments and blank lines excluded so
# the count matches what the manager itself attempts.
apk_repo_count() {
	{ cat /etc/apk/repositories 2>/dev/null; cat /etc/apk/repositories.d/*.list 2>/dev/null; } \
		| sed 's/#.*//' | grep -c '[^[:space:]]' || true
}

opkg_feed_count() {
	{ cat /etc/opkg/distfeeds.conf 2>/dev/null; cat /etc/opkg/customfeeds.conf 2>/dev/null; } \
		| grep -c '^[[:space:]]*src' || true
}

# `apk update` / `opkg update` return non-zero the instant ANY configured feed is unreachable, even
# when the rest answered fine — this project's own snapshot stand hits it on every run: an
# `openwrt/rootfs:x86_64-master` image unrebuilt since May 2026 pins a kmods sub-index the feed's
# rolling retention window has already dropped (CI run 34112646188). Under a bare `|| exit 1` that
# took the whole install down before the theme was ever fetched.
#
# "packages available > 0" is NOT the signal that tells partial refresh from total failure: with
# every feed unreachable, apk still prints "8 unavailable, 0 stale; 136 distinct packages available"
# and exits non-zero — those 136 are the INSTALLED database, not anything the refresh just read
# (owfeed/owlab#18's own measurement, on the same shape of failure). What separates the two is the
# "N unavailable" count against how many feeds were CONFIGURED: N < configured means at least one
# feed answered and the rest of the index is usable; N == configured means none did. opkg prints no
# such summary line, so the same distinction is drawn by counting its `*** Failed to download the
# package list from <url>` lines — exactly one per feed it could not read — against the configured
# feed count. Not the wider "Failed to download": opkg prints TWO lines per dead feed (that one plus
# `opkg_download: Failed to download <url>, wget returned N`; measured on 24.10.8, 1 dead feed of 8
# gives 2 lines and exit 1, 4 of 11 give 8 lines and exit 4), so the wider count reads 4 dead of 8
# as "none answered". Neither manager's own exit code decides this.
#
# Tolerating "some feed unreachable" must not tolerate OUR OWN feed being the one — without it
# there is no fresh package to install, so continuing means either installing nothing (a router
# with no cached index) or silently keeping whatever owfeed-packages index apk/opkg already had
# from a prior run while printing "[+] Installed …" (security review, task 0176: `repo.owfeed.org`
# is a distinct host from the stock feeds, so an on-path/DNS attacker can blackhole it alone while
# the others answer, and the old `_bad < _total` tolerance let the run continue and report success
# on a stale index). Both managers print the FULL URL of a repository they could not reach in
# their own failure lines (apk: `ERROR:`/`WARNING:` naming the index URL; opkg: `Failed to
# download <url>`), so grepping those lines against `$FEED_REFRESH_RE` above — anchored to a real
# URL, not a substring `$FEED_HOST` could also satisfy inside an unrelated line (security review,
# task 0176-e/f) — decides whether the failure was actually ours. Checked before the tolerance
# below, so our own feed failing fails closed regardless of how many other feeds answered.
feed_refresh() {	# apk | opkg
	_pmlog="/tmp/fs-install-pm.$$"
	if "$1" update >"$_pmlog" 2>&1; then rm -f "$_pmlog"; return 0; fi
	if [ "$1" = apk ]; then
		_bad=$(sed -n 's/^\([0-9][0-9]*\) unavailable,.*/\1/p' "$_pmlog" | tail -1)
		_total=$(apk_repo_count)
		_failpat='ERROR:|WARNING:'
	else
		_bad=$(grep -c '^\*\*\* Failed to download the package list' "$_pmlog" || true)
		_total=$(opkg_feed_count)
		_failpat='Failed to download'
	fi
	if grep -E "$_failpat" "$_pmlog" 2>/dev/null | grep -Eqi "$FEED_REFRESH_RE"; then
		err "\`$1 update\` could not reach $FEED_HOST — this project's own feed. Without it there is"
		err "nothing new to install, so this is not tolerated even though other feeds answered:"
		grep -E "$_failpat" "$_pmlog" | sed 's/^/    /' >&2
		rm -f "$_pmlog"
		return 1
	fi
	if [ -n "${_bad:-}" ] && [ "${_total:-0}" -gt 0 ] 2>/dev/null && [ "$_bad" -gt 0 ] 2>/dev/null \
	   && [ "$_bad" -lt "$_total" ]; then
		warn "\`$1 update\` could not reach $_bad of $_total configured feed(s) — continuing with what"
		warn "the rest served; a package that lives only on the missing one will be reported missing:"
		grep -E 'ERROR:|WARNING:|Failed to download' "$_pmlog" | sed 's/^/    /' >&2
		rm -f "$_pmlog"
		return 0
	fi
	err "\`$1 update\` failed:"
	tail -15 "$_pmlog" | sed 's/^/    /' >&2
	rm -f "$_pmlog"
	return 1
}

# --- what is on the router, and whether anything newer exists ---------------------------------
#
# Say the version. "Installed from the … feed" is equally true of a router that kept the version it
# already had — `apk add` does not upgrade — so a stale install and a fresh one print the same line.
# The number is the one thing that tells them apart, and the only other place a user can read it is
# the Footstrap tab in LuCI.
installed_version() {
	if [ "$PM" = "apk" ]; then
		apk list -I 2>/dev/null | sed -n "s/^$PKG-\([0-9][^ ]*\) .*/\1/p" | head -1
	else
		opkg list-installed 2>/dev/null | sed -n "s/^$PKG - \(.*\)$/\1/p" | head -1
	fi
}

# Whether a version STRING came from the official openwrt/luci feed rather than this project's own:
# luci.mk stamps a LuCI-carried build from git's commit date (`26.246.70755~4fd72fd`, measured on
# 25.12.4/apk-tools 3.0.5), and that leading number only grows with the calendar — see the `<26`
# apk constraint below. Used only to word the closing message honestly; the constraint is what
# actually keeps apk off that build.
is_foreign_luci_build() {	# <version>
	_maj=$(printf '%s' "$1" | sed -n 's/^\([0-9]\{1,\}\)\..*/\1/p')
	[ -n "$_maj" ] && [ "$_maj" -ge 26 ]
}

# What the CONFIGURED repository actually offers right now — asked of the package manager, never
# inferred from "the installed version did not move" (forum.openwrt.org/t/251930#160: a router whose
# feed line apk never read was told "already current", and neither had asked the feed anything).
#
# apk: `apk policy` lists, per version, every SOURCE that carries it — `lib/apk/db/installed` for
# whatever is on disk, a repository URL for each configured repo that also has that version. Only a
# version whose source is EXACTLY our own line counts; one sourced only from the installed db is
# installed, not offered. No feed-lag guess is layered on top of this (R4): the three outcomes below
# are the whole answer.
#
# opkg has no per-version-per-source report, so this reads the feed's own downloaded index instead —
# the file `feed_refresh` just populated, named for $FEED_NAME by opkg itself (`lists_dir` in
# opkg.conf, default `/var/opkg-lists`, gzipped because INDEX=Packages.gz). `opkg list`/`opkg info`
# both also answer for the INSTALLED package once its repository line is gone entirely.
feed_offer() {	# <pkg>
	if [ "$PM" = apk ]; then
		apk policy "$1" 2>/dev/null | awk -v line="$APK_LINE" '
			/^  [^ ]/ { if (ver != "" && has) print ver; ver = $0
				sub(/^  /, "", ver); sub(/:$/, "", ver); has = 0; next }
			{ src = $0; sub(/^[ \t]+/, "", src); if (src == line) has = 1 }
			END { if (ver != "" && has) print ver }
		' | sort -V | tail -1
	else
		_lists=$(sed -n 's/^lists_dir[[:space:]]\{1,\}ext[[:space:]]\{1,\}//p' /etc/opkg.conf 2>/dev/null | tail -1)
		zcat "${_lists:-/var/opkg-lists}/$FEED_NAME" 2>/dev/null | awk -v p="$1" '
			/^Package: / { pk = $2 }
			/^Version: / { if (pk == p) print $2 }
		' | sort -V | tail -1
	fi
}

# --- the release, for a router the feed cannot serve ------------------------------------------
#
# The feed is still the install path: it is what makes `apk upgrade` / `opkg upgrade` carry the
# theme forward, and everything below is only reached when the feed cannot be read at all — an
# architecture owfeed does not publish, a host this router cannot resolve or reach, a network that
# intercepts it.
#
# Picked from the SIGNED MANIFEST, never by guessing an asset's name: resolving the theme by name
# and taking `head -1` is what installed a catalogue instead of the theme (issue #6). `manifest.txt`
# names exactly one file per format with its size and digest, and it is signed, so the name comes
# from the same statement the signature covers.
#
# The chain fails CLOSED and in this order: verified TLS, then usign against the key pinned above,
# then the manifest's own sha256 over the artifact. A missing usign, a missing signature or a digest
# that does not match is a refusal, never a downgrade. `apk`'s --allow-untrusted only says the .apk
# carries no APK signature of its own; the usign signature over the manifest is what this path
# trusts, and it is checked before the file is handed over.
# <package name>, defaulting to the theme: the language catalogues are named in the same signed
# manifest and are fetched through the same chain. <base> defaults to the newest release and is
# given explicitly when a specific tag is wanted — see install_language(), which pins the catalogue
# to the version of the theme the router actually ended up with.
install_from_release() {
	_want="${1:-$PKG}"
	_base="${2:-$RELEASE_BASE}"
	command -v usign >/dev/null 2>&1 || {
		err "usign is not installed, so a release artifact cannot be verified here."
		return 1
	}
	_tmp=$(mktemp -d /tmp/footstrap-install.XXXXXX) || return 1
	printf '%s\n' "$RELEASE_PUBKEY" > "$_tmp/release.pub"
	info "Fetching the signed release manifest..."
	if ! fetch "$_base/manifest.txt" "$_tmp/manifest.txt" ||
	   ! fetch "$_base/manifest.txt.sig" "$_tmp/manifest.txt.sig"; then
		err "Could not download the release manifest from $_base either."
		rm -rf "$_tmp"; return 1
	fi
	if ! usign -V -q -p "$_tmp/release.pub" -x "$_tmp/manifest.txt.sig" -m "$_tmp/manifest.txt"; then
		err "The release manifest is not signed by the pinned key — refusing to install."
		rm -rf "$_tmp"; return 1
	fi
	# one line per format: `pkg <name> <format> <file> <size> <sha256> <arch>`
	_file=$(awk -v p="$_want" -v f="$PM_FMT" '$1=="pkg" && $2==p && $3==f { print $4 }' "$_tmp/manifest.txt")
	_sha=$(awk -v p="$_want" -v f="$PM_FMT" '$1=="pkg" && $2==p && $3==f { print $6 }' "$_tmp/manifest.txt")
	if [ -z "$_file" ] || [ -z "$_sha" ]; then
		err "The manifest names no $PM_FMT artifact for $_want."
		rm -rf "$_tmp"; return 1
	fi
	info "Downloading $_file..."
	if ! fetch "$_base/$_file" "$_tmp/$_file"; then
		err "Could not download $_base/$_file."
		rm -rf "$_tmp"; return 1
	fi
	_have=$(sha256sum "$_tmp/$_file" | cut -d' ' -f1)
	if [ "$_have" != "$_sha" ]; then
		err "$_file does not match the digest the signed manifest gives for it — refusing to install."
		err "  manifest: $_sha"
		err "  download: $_have"
		rm -rf "$_tmp"; return 1
	fi
	ok "Signature and digest verified."
	info "Installing $_file..."
	if [ "$PM" = apk ]; then
		pm_quiet apk add --allow-untrusted "$_tmp/$_file" || { rm -rf "$_tmp"; return 1; }
	else
		pm_quiet opkg install "$_tmp/$_file" || { rm -rf "$_tmp"; return 1; }
	fi
	rm -rf "$_tmp"
	return 0
}

# --- the catalogue for the language this router is set to ---------------------------------------
#
# The translations used to ride inside the theme, so every router carried both of them and nobody
# had to ask for one. They are `luci-i18n-footstrap-<lang>` now, which takes 4,821 B off the theme
# for the majority reading English — and would silently un-translate a Russian router on the upgrade
# that introduces the split, since the theme's own catalogue leaves with the old package.
#
# So: read the language LuCI is actually set to and fetch that one, best effort. A missing package
# is not a failure — most languages have no catalogue, and `en` never does. Nothing here runs when
# the router is on the default (unset, or `auto`, which means "follow the browser" and names no
# single catalogue to install).
#
# NOT IN THE FEED IS NOT THE END OF THE PATH. A release reaches owfeed-packages through a pull
# request against that repository, so a package that is NEW — which these two were, in 0.14.4 — is
# absent from the feed for as long as that takes, and every Russian router upgrading in that window
# would be told its language is unavailable while the signed asset for it sits in the release.
# So the release is the fallback, through the same verified chain the theme itself takes when the
# feed cannot serve the router at all, and `$PM upgrade` picks the package up from the feed once it
# lands there.
install_language() {
	_lang=$(uci -q get luci.main.lang 2>/dev/null || true)
	case "$_lang" in
		''|auto|en) return 0 ;;
	esac
	_lpkg="luci-i18n-footstrap-$_lang"
	# ASKED FOR FIRST, then installed. Most languages have no catalogue, and letting the install
	# fail instead prints fifteen lines of the package manager's own diagnosis (pm_quiet's failure
	# tail) in front of a message that says nothing is wrong.
	_in_feed=no
	if [ "$1" = feed ]; then
		if [ "$PM" = apk ]; then
			apk list "$_lpkg" 2>/dev/null | grep -q . && _in_feed=yes
		else
			opkg list "$_lpkg" 2>/dev/null | grep -q . && _in_feed=yes
		fi
	fi

	if [ "$_in_feed" = yes ]; then
		info "Fetching the $_lang translation ($_lpkg)..."
		if [ "$PM" = apk ]; then
			# Same collision as the theme package itself (see the `<26` comment above the theme's
			# `apk add`, near the feed install below): `$_lpkg` exists in both feeds too, and the
			# official one's LuCI-stamped version always outranks this project's.
			pm_quiet apk add --upgrade "$_lpkg<26" || {
				warn "Could not install $_lpkg — the theme stays in English."; return 0; }
		else
			pm_quiet opkg install "$_lpkg" || pm_quiet opkg upgrade "$_lpkg" || {
				warn "Could not install $_lpkg — the theme stays in English."; return 0; }
		fi
	else
		# The catalogue is pinned to the TAG THE INSTALLED THEME CAME FROM, not to `latest`: the
		# feed trails the release by up to a day, so a router that just took 0.14.3 from the feed
		# would otherwise get 0.14.4's catalogue — and a catalogue knows only the strings of its own
		# version, rendering the rest in English with nothing reporting it.
		_lbase="$RELEASE_BASE"
		if [ "$1" = feed ]; then
			info "The feed carries no $_lpkg yet; taking it from the signed release."
			_lver=$(installed_version)
			[ -n "$_lver" ] && _lbase="https://github.com/$REPO/releases/download/v${_lver%-r*}"
		fi
		info "Fetching the $_lang translation ($_lpkg)..."
		install_from_release "$_lpkg" "$_lbase" || {
			warn "No $_lpkg in the release either — the theme's own strings stay in English."
			return 0; }
	fi
	ok "Translation installed: $_lang"
}

printf '\n=== luci-theme-footstrap installer ===\n\n'

# --- compatibility --------------------------------------------------------
[ -f /etc/openwrt_release ] || { err "Not an OpenWrt system."; exit 1; }
. /etc/openwrt_release
ok "Detected: ${DISTRIB_DESCRIPTION:-OpenWrt}"

# PM_FMT is the manifest's word for the same thing, and the two are deliberately separate: the
# manager is `apk`/`opkg`, the artifact is `.apk`/`.ipk`, and opkg is the pair where they differ.
if command -v apk >/dev/null 2>&1; then PM=apk; PM_FMT=apk; INDEX=packages.adb
elif command -v opkg >/dev/null 2>&1; then PM=opkg; PM_FMT=ipk; INDEX=Packages.gz
else err "Neither apk nor opkg found."; exit 1; fi
ok "Package manager: $PM"

# What is on the router BEFORE anything is installed — the closing line reads "installed",
# "upgraded" or "already current" off the difference, which is the distinction a user was left to
# make by hand while the manager's own output scrolled past.
_before=$(installed_version)

# Read before the branch rather than beside the feed entry, because a router that names
# no branch picks one by asking the feed which branch carries this architecture.
if [ "$PM" = apk ]; then
	ARCH=$(cat /etc/apk/arch) || { err "Cannot read /etc/apk/arch."; exit 1; }
else
	ARCH="${DISTRIB_ARCH:-}"
	[ -n "$ARCH" ] || { err "DISTRIB_ARCH is empty in /etc/openwrt_release."; exit 1; }
fi

# --- version --------------------------------------------------------------
# The feed publishes per OpenWrt minor, so the branch comes from the router. SNAPSHOT
# and anything unparseable name none, and are served the newest branch of their own
# package format instead — see FALLBACK_BRANCHES_* below for why that is sound here.
FALLBACK_BRANCHES_APK="25.12"
FALLBACK_BRANCHES_OPKG="24.10"

# The feed has no snapshot channel, and not by omission: the two lines owfeed-packages serves ARE
# the package-format split (apk from 25.12, ipk on 24.10), not a build of the theme per release. A
# snapshot has no branch of its own, so it gets the newest one its package manager can read.
#
# What makes that sound for THIS package and not in general: it is noarch and `+luci-base` is its
# whole dependency list, so nothing in it was compiled against the branch it is fetched from. A
# package carrying a binary, or a versioned dependency, must not take this path.
#
# Newest first, and each candidate is probed rather than assumed: a branch listed here before it is
# published — or one that does not carry this router's architecture — falls through to the next
# instead of writing a repository entry that 404s on every update. The probe's bytes are discarded;
# existence is all it asks, and the index it found is still verified by the package manager against
# the pinned key.
newest_feed_branch() {	# <candidates> -> the first branch that answers
	for _branch in $1; do
		if fetch "$FEED_HOST/releases/$_branch/$ARCH/$INDEX" /dev/null 2>/dev/null; then
			printf '%s' "$_branch"
			return 0
		fi
	done
	return 1
}

BRANCH=$(printf '%s' "${DISTRIB_RELEASE:-}" | cut -d. -f1,2)
case "$BRANCH" in
[0-9][0-9].[0-9][0-9])
	MAJ=${BRANCH%%.*}; MIN=${BRANCH##*.}
	if [ "$MAJ" -lt 23 ] || { [ "$MAJ" -eq 23 ] && [ "$MIN" -lt 5 ]; }; then
		err "footstrap requires OpenWrt 23.05 or newer (detected $DISTRIB_RELEASE)."
		exit 1
	fi
	# 23.05 GETS THE LAST VERSION THAT RUNS ON IT, not a refusal and not the current one. The theme
	# supported that release for one widget's sake — `ui.RangeSlider` arrived in 24.10, and its
	# absence took the whole Appearance tab down — and that support is over: 23.05 is EOL, and
	# openwrt/luci, where this theme now lives, declined to carry compatibility code for releases it
	# no longer builds (#8978). Everything up to and including 0.14.2 runs there, so that is what a
	# 23.05 router installs: pinned by tag, verified by the same signature and digest as any other
	# artifact, and said out loud so nobody waits for an upgrade that will not come.
	if [ "$MAJ" -eq 23 ]; then
		info "OpenWrt $DISTRIB_RELEASE: installing footstrap ${FROZEN_2305_TAG#v} — the LAST version for 23.05."
		info "23.05 is end-of-life and the theme no longer develops for it; later versions need 24.10 or newer."
		RELEASE_BASE="$FROZEN_2305_BASE"
		install_from_release || {
			err "Could not install the ${FROZEN_2305_TAG#v} release asset on $DISTRIB_RELEASE."
			exit 1
		}
		ok "footstrap ${FROZEN_2305_TAG#v} installed. This is the final release for OpenWrt 23.05."
		exit 0
	fi
	# PROBED, exactly like the fallback path below, and for the reason that path states: a router
	# on a branch the feed does not publish yet — every 26.x router on the day it ships — otherwise
	# had a 404 URL written into its repository list, and then `apk update` failed under `set -e`
	# BEFORE the theme was ever installed. A re-run did not rescue it either: the dead line contains
	# $FEED_HOST, so the next run took the "already configured" path and died at the same place,
	# leaving every later `apk update` on that router failing too. Fall back to the newest branch the
	# feed does answer for — sound here for the same reason the fallback path is: noarch package,
	# +luci-base its whole dependency list, nothing compiled against the branch it comes from.
	if ! fetch "$FEED_HOST/releases/$BRANCH/$ARCH/$INDEX" /dev/null 2>/dev/null; then
		info "The feed does not carry $BRANCH for $ARCH yet; asking it for the newest branch..."
		if [ "$PM" = apk ]; then CANDIDATES="$FALLBACK_BRANCHES_APK"; else CANDIDATES="$FALLBACK_BRANCHES_OPKG"; fi
		BRANCH=$(newest_feed_branch "$CANDIDATES") || BRANCH=""
		if [ -n "$BRANCH" ]; then
			ok "Using the $BRANCH branch — the theme is noarch and needs only luci-base."
		fi
	fi
	;;
*)
	info "'${DISTRIB_RELEASE:-unknown}' names no feed branch; asking the feed for the newest one..."
	if [ "$PM" = apk ]; then CANDIDATES="$FALLBACK_BRANCHES_APK"; else CANDIDATES="$FALLBACK_BRANCHES_OPKG"; fi
	BRANCH=$(newest_feed_branch "$CANDIDATES") || BRANCH=""
	if [ -n "$BRANCH" ]; then
		ok "No branch of its own, so the $BRANCH branch it is — the theme is noarch and needs only luci-base."
	fi
	;;
esac

# --- no feed for this router: the release, verified ------------------------------------------
# Reached only when every candidate index failed to download. That is one of two things and the
# script cannot tell them apart from here, so it says both: either owfeed publishes nothing this
# router can read, or this router could not reach owfeed — a resolver that does not answer, a clock
# too far off for TLS, a network that intercepts the host. Naming the URL is what lets the admin
# decide which, in one command.
#
# Either way the theme is INSTALLED, from the signed release, and the run ends there: no feed line
# is written for a feed that could not be read.
if [ -z "$BRANCH" ]; then
	err "Could not read the $PM feed index for $ARCH from $FEED_HOST (router reports '${DISTRIB_RELEASE:-unknown}')."
	for _b in $CANDIDATES; do err "  tried $FEED_HOST/releases/$_b/$ARCH/$INDEX"; done
	err "If that opens in a browser, the router could not fetch it — check DNS, the clock, and TLS"
	err "(uclient-fetch needs libustream-mbedtls; wget-ssl or curl are used instead when present)."
	info "Installing from the signed release instead; \`$PM upgrade\` will NOT carry the theme forward."
	install_from_release || {
		err "Install the release asset by hand instead:"
		err "  https://github.com/$REPO/releases/latest"
		exit 1
	}
	install_language release
	rm -f /tmp/luci-indexcache* 2>/dev/null || true
	rm -rf /tmp/luci-modulecache 2>/dev/null || true
	if [ -x /etc/init.d/rpcd ]; then /etc/init.d/rpcd reload >/dev/null 2>&1 || true; fi
	printf '\n'
	_have=$(installed_version)
	if [ -n "$_have" ] && [ -n "$_before" ] && [ "$_before" != "$_have" ]; then
		if is_foreign_luci_build "$_before"; then
			# Not an upgrade: $_before was the official openwrt/luci feed's build, numbered higher
			# but predating this release — see is_foreign_luci_build() above.
			ok "Moved $PKG back onto this project's build: $_before -> $_have"
		else
			ok "Upgraded $PKG $_before -> $_have"
		fi
	elif [ -n "$_have" ]; then
		ok "Installed $PKG $_have"
	fi
	ok "Installed from the release. Re-run this script to update, or fix the feed and run it again"
	ok "to switch to \`$PM upgrade\`."
	printf '\n'			# the same break between the outcome and the next steps as the feed path
	info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
	info "Layout, dark mode, palette, colours and the wallpaper live in the \"Footstrap\" tab"
	info "of System -> System. Then hard-reload the page (Ctrl+F5)."
	exit 0
fi

# Writes <new-content-file> into <path> atomically, without `mv`-ing anything over <path> itself and
# without ever truncating it before the replacement is ready. `cat new > path` truncates the moment
# the redirect opens — a write that dies partway (OOM, a full overlay) can leave customfeeds empty
# (security review, task 0176-h); a bare `mv new path` replaces a symlinked customfeeds file with a
# plain one, target untouched, mode reset (0176-g). This resolves the real path with `readlink -f`
# (present on both busybox builds this repo targets), copies ITS mode and owner onto a temp file IN
# THE SAME DIRECTORY with `cp -p` — so the rename below stays on one filesystem — writes the new
# content into THAT copy, and only then `mv -f`s it over the real file: one atomic rename, and a
# failure at any point before it leaves the original exactly as it was, temp file removed.
atomic_write() {	# <path> <new-content-file>
	_aw_real=$(readlink -f "$1" 2>/dev/null)
	[ -n "$_aw_real" ] || _aw_real="$1"
	_aw_tmp="$_aw_real.fstmp.$$"
	if [ -f "$_aw_real" ]; then
		cp -p "$_aw_real" "$_aw_tmp" || { rm -f "$_aw_tmp"; return 1; }
	else
		# `printf ''`, never the `:` special builtin: a redirection error on a SPECIAL builtin exits
		# the (non-interactive) shell outright, before this `||` — or any caller's own `|| { … }` —
		# ever runs (security review, task 0176-k). `printf` is an ordinary utility, so its own
		# redirection failure is just this command failing, exactly what `||` is here to catch.
		printf '' > "$_aw_tmp" || return 1
	fi
	if ! cat "$2" > "$_aw_tmp"; then
		rm -f "$_aw_tmp"
		return 1
	fi
	# Checked explicitly, never a bare last statement: under `set -e` a bare failing command IS the
	# function's own failure and skips straight past every caller-side cleanup that follows the call
	# (security review, task 0176-i) — the one shape that actually matters here, since `$_aw_tmp` is
	# this function's own responsibility and every caller above only ever sees a 0/1 result.
	if ! mv -f "$_aw_tmp" "$_aw_real"; then
		rm -f "$_aw_tmp"
		return 1
	fi
}

# R3: every ACTIVE line — other than the exact one install.sh writes — whose URL host is ours, or
# (opkg) whose src NAME is ours, is commented out (never deleted) and reported, one line each. A
# line for any other host is never touched, whatever else it says: no `@tag` exception, no
# port/userinfo parsing — $APK_HOST_RE/$OPKG_HOST_RE above are boundary checks, not a URL parser.
#
# Why any of them matter, measured end to end (security review, task 0176-e, `m5a-apk.sh`): apk's
# own repository-file reader silently stops at the first line it cannot tokenise, so an admin's own
# unrelated malformed line, or a leftover line for another branch/arch, sitting ABOVE where the
# correct line would otherwise land, can cut the feed off with no error at all — the forum defect,
# self-inflicted. Disabling every other line naming us removes the only kind of line that could ever
# shadow the correct one; R2 below then places the correct line first regardless, so nothing else in
# the file — an admin's own unrelated entry, comments, blank lines — can still precede it.
disable_other_lines() {	# <file> <exact-line> <mode: apk | opkg> -> 0 written (or nothing to do), 1 write failed
	_dol_f="$1"; _dol_want="$2"; _dol_mode="$3"
	[ -f "$_dol_f" ] || return 0
	_dol_tmp="$_dol_f.newcontent.$$"
	_dol_msgs="$_dol_f.msgs.$$"
	_dol_changed=0
	# `printf ''`, never the `:` special builtin: on a redirection error `:` exits the shell outright
	# on the spot — measured, a temp path pre-created as a directory killed the whole script with no
	# "[-] Could not …" line and no `exit 1` this function ever got to run (security review, task
	# 0176-k). `printf` is ordinary, so its own redirection failure is checked normally below.
	if ! printf '' > "$_dol_tmp"; then
		return 1
	fi
	if ! printf '' > "$_dol_msgs"; then
		rm -f "$_dol_tmp"
		return 1
	fi
	while IFS= read -r _dol_l || [ -n "$_dol_l" ]; do
		case "$_dol_l" in
			\#*) printf '%s\n' "$_dol_l" >> "$_dol_tmp"; continue ;;
		esac
		if [ "$_dol_l" = "$_dol_want" ]; then
			printf '%s\n' "$_dol_l" >> "$_dol_tmp"
			continue
		fi
		if [ "$_dol_mode" = apk ]; then _dol_re="$APK_HOST_RE"; else _dol_re="$OPKG_HOST_RE"; fi
		_dol_hit=0
		if printf '%s\n' "${_dol_l%$(printf '\r')}" | grep -Eqi "$_dol_re"; then
			_dol_hit=1
		fi
		if [ "$_dol_mode" = opkg ]; then
			set -f; set -- $_dol_l; set +f
			if [ "$2" = "$FEED_NAME" ]; then
				_dol_hit=1
			fi
		fi
		if [ "$_dol_hit" = 1 ]; then
			# DEFERRED, not printed here: a line reads "disabled" only once the write below actually
			# lands — printing it first and then failing the write told a user a change had happened
			# when the file was untouched (security review, task 0176-i).
			printf '  another active line for our feed, disabled: %s\n' "$_dol_l" >> "$_dol_msgs"
			printf '#%s\n' "$_dol_l" >> "$_dol_tmp"
			_dol_changed=1
		else
			printf '%s\n' "$_dol_l" >> "$_dol_tmp"
		fi
	done < "$_dol_f"
	if [ "$_dol_changed" = 0 ]; then
		rm -f "$_dol_tmp" "$_dol_msgs"
		return 0
	fi
	# `if atomic_write …` — not a bare statement — so a failure is OURS to handle: every temp this
	# call created is removed either way, and the caller learns about it through the return status,
	# never through `$(…)`, which `set -e` cannot see through (task 0176-i, `m9b.sh`).
	if atomic_write "$_dol_f" "$_dol_tmp"; then
		while IFS= read -r _dol_m; do info "$_dol_m"; done < "$_dol_msgs"
		rm -f "$_dol_tmp" "$_dol_msgs"
		return 0
	fi
	rm -f "$_dol_tmp" "$_dol_msgs"
	return 1
}

# R2: places $2 as the FIRST NON-COMMENT line, moving it there even when it was already present
# SOMEWHERE ELSE in the file — origin/main's own installer only ever appended, so a router already
# running that shape has the correct line sitting after whatever else was there, including an
# unparsable admin line: "is the exact line present" alone stayed true forever while apk never
# reached it (tester finding, `m6a-apk.sh` #6: "junk" then the exact line, 0.14.12 stays 0.14.12
# across repeated runs, "already configured" every time). Every occurrence is dropped and exactly
# one is reinserted, so this is also how repeated runs stay idempotent. The leading run of comment
# and blank lines — the stock "add your custom feeds here" header — stays first; everything else,
# in its original order, follows the reinserted line.
# Sets $FEED_PLACEMENT to "added" | "moved" | "unchanged" and RETURNS 0/1 — never `echo`ed for the
# caller to capture with `$(…)`: a command substitution's own exit status is invisible to `set -e`
# in the assignment/case that reads it, so a write that failed INSIDE the substitution still read as
# success one level up (security review, task 0176-i, `m9b.sh`: "added"/"Feed added" printed, file
# on disk untouched). A plain variable plus a real return status is checked with `if ! ensure_first`,
# which — being an if-condition — is exactly where `set -e` is SUPPOSED to step aside so the caller
# can decide what a failure means, instead of the shell silently doing it for nobody.
ensure_first() {	# <file> <exact-line> -> sets $FEED_PLACEMENT; returns 0/1
	_ef_f="$1"; _ef_want="$2"
	_ef_tmp="$_ef_f.newcontent.$$"
	_ef_hdr="$_ef_f.hdr.$$"
	_ef_body="$_ef_f.body.$$"
	# `printf ''`, never the `:` special builtin — same reason as disable_other_lines above: `:`'s
	# own redirection failure exits the shell before this function's `return 1` ever runs.
	if ! printf '' > "$_ef_hdr"; then
		return 1
	fi
	if ! printf '' > "$_ef_body"; then
		rm -f "$_ef_hdr"
		return 1
	fi
	_ef_in_header=1
	_ef_found=0
	if [ -f "$_ef_f" ]; then
		while IFS= read -r _ef_l || [ -n "$_ef_l" ]; do
			if [ "$_ef_l" = "$_ef_want" ]; then
				_ef_found=1
				_ef_in_header=0
				continue
			fi
			if [ "$_ef_in_header" = 1 ]; then
				case "$_ef_l" in
					\#*|'') printf '%s\n' "$_ef_l" >> "$_ef_hdr"; continue ;;
				esac
				_ef_in_header=0
			fi
			printf '%s\n' "$_ef_l" >> "$_ef_body"
		done < "$_ef_f"
	fi
	# Checked, not a bare redirect: a failed open (disk full, EROFS) is this function's OWN failure
	# under `set -e` and would otherwise skip straight past the cleanup on the next line, leaking
	# both scratch files (security review, task 0176-j). `&&`-joined, not `;`-joined: a group
	# command's exit status is its LAST member's, so a `;`-joined group would have silently ignored
	# the first `cat` failing while the second one still succeeded (security review, task 0176-l).
	if ! { cat "$_ef_hdr" && printf '%s\n' "$_ef_want" && cat "$_ef_body"; } > "$_ef_tmp"; then
		rm -f "$_ef_hdr" "$_ef_body" "$_ef_tmp"
		return 1
	fi
	rm -f "$_ef_hdr" "$_ef_body"
	if [ -f "$_ef_f" ] && command -v cmp >/dev/null 2>&1 && cmp -s "$_ef_tmp" "$_ef_f" 2>/dev/null; then
		rm -f "$_ef_tmp"
		FEED_PLACEMENT=unchanged
		return 0
	fi
	if atomic_write "$_ef_f" "$_ef_tmp"; then
		rm -f "$_ef_tmp"
		# "added": the line was missing outright. "moved": it was ALREADY somewhere in the file (an
		# origin/main-configured router only ever appends) and this run repositioned it — a fact the
		# closing "Adding the feed…"/"Feed added" wording would otherwise get wrong for that router.
		if [ "$_ef_found" = 1 ]; then FEED_PLACEMENT=moved; else FEED_PLACEMENT=added; fi
		return 0
	fi
	rm -f "$_ef_tmp"
	return 1
}

# --- feed -----------------------------------------------------------------
# keep.d is not bookkeeping: sysupgrade wipes the key unless something claims it, and the theme
# would come back unupgradable. The repository line itself needs no entry — both managers'
# customfeeds files are conffiles of the manager (`apk-mbedtls` and `opkg`), and sysupgrade backs
# up every conffile whose checksum has moved. It listed them anyway until this was measured, and
# `build_list_of_backup_overlay_files` was already dropping the duplicate.
if [ "$PM" = apk ]; then
	# customfeeds.list rather than a file of our own under repositories.d/. apk reads
	# every *.list in that directory, so both work for installing — but LuCI's package
	# manager reads exactly three paths (`repositories`, `distfeeds.list`,
	# `customfeeds.list`, in its rpcd ACL and hardcoded in its view), so a feed in any
	# other file is invisible in "Configure APK" and cannot be edited or removed there.
	# It is also the file OpenWrt ships for this ("add your custom package feeds here")
	# and the apk counterpart of the opkg branch's customfeeds.conf below.
	APK_LIST=/etc/apk/repositories.d/customfeeds.list
	APK_LINE=$(printf '%s/releases/%s/%s/packages.adb' "$FEED_HOST" "$BRANCH" "$ARCH")
	mkdir -p /etc/apk/keys /etc/apk/repositories.d /lib/upgrade/keep.d
	# R1: exact, not a substring — a commented, tagged or other-branch/arch line satisfied the old
	# `grep -q "$FEED_HOST"` while apk read none of them (forum.openwrt.org/t/251930#160). R2: placed
	# FIRST, and MOVED there even when already present somewhere else — see ensure_first() above.
	disable_other_lines "$APK_LIST" "$APK_LINE" apk || {
		err "Could not update $APK_LIST — the router's own feed lines are unchanged."
		exit 1
	}
	if ! ensure_first "$APK_LIST" "$APK_LINE"; then
		err "Could not write $APK_LIST — the router's own feed lines are unchanged."
		exit 1
	fi
	case "$FEED_PLACEMENT" in
		added)
			info "Adding the $FEED_NAME feed..."
			apk add --quiet ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
			printf '%s\n' /etc/apk/keys/owfeed-packages.pem > /lib/upgrade/keep.d/owfeed-packages
			# Installers before this one wrote their own file, which apk still reads: left
			# in place it is the same repository configured twice, in one file the admin
			# can see and one they cannot. Removed by name and only after the line above
			# landed, so the feed is never briefly absent.
			rm -f /etc/apk/repositories.d/owfeed-packages.list
			ok "Feed added: $FEED_HOST/releases/$BRANCH/$ARCH"
			;;
		moved)
			info "Moving the $FEED_NAME feed line to the top of $APK_LIST so apk reads it first."
			;;
		*)
			info "The $FEED_NAME feed is already configured."
			;;
	esac
	# The KEY is fetched on every run, not only when the feed line is written. It used to sit inside
	# the branch above, which meant a rotation could never be repaired by the documented one-liner:
	# the feed was "already configured", the key was never re-fetched, and `apk update` failed
	# verification from then on with the header promising that re-running upgrades the theme. It is
	# one small file, the fetch is verified TLS, and writing it again is idempotent.
	mkdir -p /etc/apk/keys /lib/upgrade/keep.d
	fetch "$FEED_HOST/owfeed-packages.pem" /etc/apk/keys/owfeed-packages.pem
	printf '%s\n' /etc/apk/keys/owfeed-packages.pem > /lib/upgrade/keep.d/owfeed-packages
	info "Updating the package index..."
	feed_refresh apk || exit 1
	# `apk add` ALONE DOES NOT UPGRADE, and the comment that used to sit here said it did. apk 3
	# reads `add` as "make sure this is present": a package already in `world` and already satisfied
	# stays at the version it is at, the command prints its usual OK line and exits 0. Reproduced on
	# a 25.12 stand carrying 0.12.5 with 0.12.7 in the feed — the run ended with
	# "[+] Installed from the owfeed-packages feed" and `apk list -I` still said 0.12.5. That is the
	# shape of issues #16, #28 and #30: the installer reports success and changes nothing, and the
	# only way a user sees it is by reading the version in the Footstrap tab.
	# `--upgrade` (`-u`) is what asks for the newest the feed carries; it installs on a router that
	# does not have the theme yet, so this one line covers both paths, exactly as the opkg leg below
	# already did with its explicit `opkg upgrade`.
	#
	# `<26`: apk resolves a bare name to the HIGHEST version across every configured repository, not
	# the one just added above — and this theme is now ALSO carried by the official openwrt/luci feed,
	# where luci.mk stamps the version from git's commit date instead of this project's own numbering
	# (measured on 25.12.4/apk-tools 3.0.5: `luci-theme-footstrap-26.246.70755~4fd72fd`, from
	# `feeds/luci/…`, next to owfeed's own `0.14.10-r1`). That stamp only grows with the calendar, so a
	# bare `apk add --upgrade "$PKG"` moves the router to the OTHER publisher's code — one that
	# predates this release, not an upgrade to it (field report: "Upgraded … -> 26.246.70755~4fd72fd").
	# `apk version -t` confirms `26.246.70755~4fd72fd` and `27.1.1~abc` both compare `>` against `26`,
	# while `0.14.10-r1`, `1.0.0-r1` and `25.99.99-r1` all compare `<` — so `<26` excludes every
	# LuCI-stamped build for good and still leaves this project's own numbering majors 1-25 to grow
	# into. DO NOT "tidy" this to `<1` — it would start rejecting this project's own future releases.
	# `--upgrade` with the constraint also REPAIRS a router that already took the official build: it
	# downgrades back to ours (measured: "Downgrading luci-theme-footstrap (26.246.70755~4fd72fd ->
	# 0.14.10-r1)"), which is why `--upgrade` stays rather than becoming a plain `add`.
	info "Installing $PKG..."
	pm_quiet apk add --upgrade "$PKG<26" || exit 1
else
	OPKG_LIST=/etc/opkg/customfeeds.conf
	OPKG_LINE=$(printf 'src/gz %s %s/releases/%s/%s' "$FEED_NAME" "$FEED_HOST" "$BRANCH" "$ARCH")
	mkdir -p /etc/opkg/keys /lib/upgrade/keep.d
	disable_other_lines "$OPKG_LIST" "$OPKG_LINE" opkg || {
		err "Could not update $OPKG_LIST — the router's own feed lines are unchanged."
		exit 1
	}
	if ! ensure_first "$OPKG_LIST" "$OPKG_LINE"; then
		err "Could not write $OPKG_LIST — the router's own feed lines are unchanged."
		exit 1
	fi
	case "$FEED_PLACEMENT" in
		added)
			info "Adding the $FEED_NAME feed..."
			opkg update >/dev/null 2>&1 || true
			opkg install ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
			ok "Feed added: $FEED_HOST/releases/$BRANCH/$ARCH"
			;;
		moved)
			info "Moving the $FEED_NAME feed line to the top of $OPKG_LIST so opkg reads it first."
			;;
		*)
			info "The $FEED_NAME feed is already configured."
			;;
	esac
	# Same as the apk leg: the key on every run, so a rotation is repairable by re-running. Here the
	# key ID is part of the PATH, so a rotation changes the filename too — the old one is left alone
	# rather than removed, since opkg reads the whole directory and a stale key verifies nothing.
	mkdir -p /etc/opkg/keys /lib/upgrade/keep.d
	fetch "$FEED_HOST/$FEED_KEY_OPKG" "/etc/opkg/keys/$FEED_KEY_OPKG"
	printf '%s\n' "/etc/opkg/keys/$FEED_KEY_OPKG" > /lib/upgrade/keep.d/owfeed-packages
	info "Updating the package index..."
	feed_refresh opkg || exit 1
	# `opkg install` on an installed package is a no-op even when the feed has a newer
	# version — it reports "already installed" and exits 0 — so a second run has to ask
	# for the upgrade explicitly. Up to date is not an error for `opkg upgrade`.
	#
	# No `<26` here: opkg has no `world` file and no version-constraint syntax on `install`/
	# `upgrade`, so there is no opkg equivalent of the apk leg's fix above. Left as plain
	# `opkg upgrade "$PKG"` because the collision it would guard against does not exist today —
	# the official 24.10 feed carries no luci-theme-footstrap at all yet (checked on owrt2410:
	# `opkg info luci-theme-footstrap` names only this project's own `0.14.9-r1`). If that ever
	# changes, there is no constraint to add here; the fallback is already written — bypass feed
	# resolution entirely and install the signed release artifact directly
	# (`install_from_release`), the same path a router with no matching feed branch already takes.
	info "Installing $PKG..."
	if opkg list-installed | grep -q "^$PKG "; then
		pm_quiet opkg upgrade "$PKG" || exit 1
	else
		pm_quiet opkg install "$PKG" || exit 1
	fi
fi

install_language feed

# Both caches, as postinst does: a stale /tmp/luci-modulecache bites exactly here, on a
# package that replaces the theme's JS. reload, never restart — restart logs out every
# LuCI session.
rm -f /tmp/luci-indexcache* 2>/dev/null || true
rm -rf /tmp/luci-modulecache 2>/dev/null || true
if [ -x /etc/init.d/rpcd ]; then /etc/init.d/rpcd reload >/dev/null 2>&1 || true; fi

printf '\n'
_have=$(installed_version)
if [ -z "$_have" ]; then
	ok "Installed from the $FEED_NAME feed — \`$PM upgrade\` will keep it current."
elif [ -z "$_before" ]; then
	ok "Installed $PKG $_have — from the $FEED_NAME feed, \`$PM upgrade\` will keep it current."
elif [ "$_before" != "$_have" ]; then
	if is_foreign_luci_build "$_before"; then
		# Not an upgrade: $_before was the official openwrt/luci feed's build — a higher, unrelated
		# version number from a different publisher, not a newer release of this project. The `<26`
		# constraint on the apk install above is what just moved the router back onto owfeed's build.
		ok "Moved $PKG back onto the $FEED_NAME feed's build: $_before -> $_have"
	else
		ok "Upgraded $PKG $_before -> $_have — \`$PM upgrade\` will keep it current."
	fi
else
	# "Nothing changed" is not "nothing newer" (R4): `apk add`/`opkg install` on an already-satisfied
	# package exits 0 whether or not the feed carries something newer (issues #16/#28/#30, and
	# forum.openwrt.org/t/251930#160, where this line ran without the feed ever having been read).
	# Ask feed_offer, which asks the repository directly, instead of guessing from the version alone.
	_offer=$(feed_offer "$PKG")
	if [ -z "$_offer" ]; then
		err "$PKG $_have is installed, but $PM names no $FEED_NAME version at all — this router is"
		if [ "$PM" = apk ]; then
			err "not reading the feed; check $APK_LIST and \`apk policy $PKG\`."
		else
			err "not reading the feed; check $OPKG_LIST and \`opkg list $PKG\`."
		fi
	elif [ "$_offer" != "$_have" ] &&
	     [ "$(printf '%s\n%s\n' "$_have" "$_offer" | sort -V 2>/dev/null | tail -1)" = "$_offer" ]; then
		warn "$PKG stays at $_have even though the $FEED_NAME feed offers $_offer — that is $PM's own"
		warn "decision (a pin, a hold, a constraint), not a feed that has not caught up:"
		if [ "$PM" = apk ]; then
			apk policy "$PKG" 2>/dev/null | sed 's/^/    /' >&2
		else
			opkg list "$PKG" 2>/dev/null | sed 's/^/    /' >&2
		fi
	else
		ok "Already current: $PKG $_have — the $FEED_NAME feed carries nothing newer."
	fi
fi
# A blank line between WHAT HAPPENED and WHAT TO DO NEXT: the outcome is the one line a user
# came for, and with the next-steps block butted straight against it the two read as one
# paragraph.
printf '\n'
info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
info "Layout, dark mode, palette, colours and the wallpaper live in the \"Footstrap\" tab"
info "of System -> System. Then hard-reload the page (Ctrl+F5)."

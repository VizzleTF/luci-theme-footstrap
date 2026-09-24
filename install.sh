#!/bin/sh
# luci-theme-footstrap installer, OpenWrt 24.10 (opkg) / 25.12+ (apk); 23.05 gets the pinned final
# release. docs/package.md, "install.sh". Re-running upgrades the theme. Licensed Apache-2.0.
#
#   wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
#
# Rate-limited per source IP, shared behind one CGNAT (issue #17) — this signed copy instead,
# verified before running as root:
#
#   wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh

set -e

FEED_HOST="https://repo.owfeed.org"
FEED_NAME="owfeed-packages"
FEED_KEY_OPKG="9040356b214084da"
# Anchored to where a URL/line starts, never a substring match — an unescaped `.` means "any
# character". Case-insensitive except OPKG_NAME_RE, an exact field. docs/package.md, "install.sh".
FEED_HOST_BARE="${FEED_HOST#*://}"
FEED_HOST_ESC=$(printf '%s' "$FEED_HOST_BARE" | sed 's/\./\\./g')
# customfeeds.list: optionally an apk `@tag`, then the URL itself.
APK_HOST_RE='^[[:space:]]*(@[^[:space:]]+[[:space:]]+)?https?://([^/@[:space:]]*@)?'"$FEED_HOST_ESC"'(:[0-9]+)?(/|$)'
# customfeeds.conf: `src` or `src/gz`, the name field, then the URL — matches only in the URL field.
OPKG_HOST_RE='^[[:space:]]*src(/gz)?[[:space:]]+[^[:space:]]+[[:space:]]+https?://([^/@[:space:]]*@)?'"$FEED_HOST_ESC"'(:[0-9]+)?(/|$)'
# The opkg NAME field alone, regardless of host: any `src`/`src/gz` line whose second field is ours.
OPKG_NAME_RE='^[[:space:]]*[^[:space:]]+[[:space:]]+'"$FEED_NAME"'([[:space:]]|$)'
# feed_refresh's own failure lines: the URL must start at a word boundary, not merely mid-string.
FEED_REFRESH_RE="(^|[[:space:]'\"(])https?://([^/@[:space:]]*@)?$FEED_HOST_ESC(:[0-9]+)?/"
PKG="luci-theme-footstrap"
REPO="VizzleTF/luci-theme-footstrap"
# `releases/latest/download/…`, never api.github.com: that API is rate-limited per source IP
# (60/hour, shared behind one NAT) and needs JSON parsing on a box that may have no jsonfilter.
RELEASE_BASE="https://github.com/$REPO/releases/latest/download"
# The last release that runs on 23.05 (EOL; openwrt/luci declined further compat work, #8978),
# pinned by tag rather than "latest" so a 23.05 router is told it is the end of the line.
FROZEN_2305_TAG="v0.14.2"
FROZEN_2305_BASE="https://github.com/$REPO/releases/download/$FROZEN_2305_TAG"
# Pinned here, not fetched beside the file it verifies — that would prove nothing. usign's key id
# travels inside the signature, so a rotation is a visible failure, never a silent acceptance.
RELEASE_PUBKEY='untrusted comment: luci-theme-footstrap release key
RWQYxjhl4rz41tNZc3dXmnRplRO1ydN1q8as++iPUjZc6SRUCb952L/T'

info() { printf '[*] %s\n' "$1"; }
ok()   { printf '[+] %s\n' "$1"; }
err()  { printf '[-] %s\n' "$1" >&2; }
warn() { printf '[!] %s\n' "$1" >&2; }

# Every downloader on the box, tried until one SUCCEEDS — not the first one that EXISTS: a router
# can have uclient-fetch without libustream, so choosing by existence alone breaks TLS. Certs are
# always verified; falling through to the next tool is not a downgrade, each one verifies too.
fetch() {	# <url> <outfile>
	command -v uclient-fetch >/dev/null 2>&1 && uclient-fetch -T 30 -qO "$2" "$1" && return 0
	command -v wget >/dev/null 2>&1 && wget -q -T 30 -O "$2" "$1" && return 0
	command -v curl >/dev/null 2>&1 && curl -fsSL --proto =https --max-time 30 -o "$2" "$1" && return 0
	return 1
}

# apk/opkg print every repository and all their own progress, burying the one line that matters:
# capture, and speak only on failure (never `>/dev/null` — a silent failure here is a half-install).
pm_quiet() {	# <command...>
	_pmlog="/tmp/fs-install-pm.$$"
	if "$@" >"$_pmlog" 2>&1; then rm -f "$_pmlog"; return 0; fi
	err "\`$*\` failed:"
	tail -15 "$_pmlog" | sed 's/^/    /' >&2
	rm -f "$_pmlog"
	return 1
}

# How many repository lines each manager was asked to read, for feed_refresh() below to tell "one
# feed missing" from "none answered" — comments/blanks excluded, matching what the manager reads.
apk_repo_count() {
	{ cat /etc/apk/repositories 2>/dev/null; cat /etc/apk/repositories.d/*.list 2>/dev/null; } \
		| sed 's/#.*//' | grep -c '[^[:space:]]' || true
}

opkg_feed_count() {
	{ cat /etc/opkg/distfeeds.conf 2>/dev/null; cat /etc/opkg/customfeeds.conf 2>/dev/null; } \
		| grep -c '^[[:space:]]*src' || true
}

# apk/opkg both exit non-zero the instant ANY feed fails, even when the rest answered, and neither
# tells "ours failed" from "some other one did" — so this counts each manager's own per-feed
# failure lines against how many were CONFIGURED. Ours failing is never tolerated either way.
# docs/package.md, "install.sh".
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
# Say the version: "Installed from the feed" is equally true of a router that kept what it had
# (`apk add` does not upgrade) — the number is what tells the two apart.
installed_version() {
	if [ "$PM" = "apk" ]; then
		apk list -I 2>/dev/null | sed -n "s/^$PKG-\([0-9][^ ]*\) .*/\1/p" | head -1
	else
		opkg list-installed 2>/dev/null | sed -n "s/^$PKG - \(.*\)$/\1/p" | head -1
	fi
}

# Whether a version came from the official openwrt/luci feed rather than this project's own:
# luci.mk stamps a build from git's commit date, which only grows with the calendar — see the
# `<26` apk constraint below, which is what actually keeps apk off that build.
is_foreign_luci_build() {	# <version>
	_maj=$(printf '%s' "$1" | sed -n 's/^\([0-9]\{1,\}\)\..*/\1/p')
	[ -n "$_maj" ] && [ "$_maj" -ge 26 ]
}

# What the CONFIGURED repository offers right NOW, asked of the package manager rather than
# inferred from "the installed version did not move" (R4; docs/package.md, "install.sh").
# apk: `apk policy` lists every SOURCE per version — only our own repository line counts. opkg has
# no per-source report, so this reads the feed's own downloaded index instead.
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

# --- closing report, shared by both the feed path and the release path ------------------------
# <mode> feed also asks feed_offer for "unchanged but newer available" (R4); release has no
# repository to ask. Wording matches each path's prior behaviour; do not merge further.
report_version() {	# <mode: feed | release>
	_have=$(installed_version)
	if [ "$1" = feed ]; then
		if [ -z "$_have" ]; then
			ok "Installed from the $FEED_NAME feed — \`$PM upgrade\` will keep it current."
		elif [ -z "$_before" ]; then
			ok "Installed $PKG $_have — from the $FEED_NAME feed, \`$PM upgrade\` will keep it current."
		elif [ "$_before" != "$_have" ]; then
			if is_foreign_luci_build "$_before"; then
				ok "Moved $PKG back onto the $FEED_NAME feed's build: $_before -> $_have"
			else
				ok "Upgraded $PKG $_before -> $_have — \`$PM upgrade\` will keep it current."
			fi
		else
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
	else
		if [ -n "$_have" ] && [ -n "$_before" ] && [ "$_before" != "$_have" ]; then
			if is_foreign_luci_build "$_before"; then
				ok "Moved $PKG back onto this project's build: $_before -> $_have"
			else
				ok "Upgraded $PKG $_before -> $_have"
			fi
		elif [ -n "$_have" ]; then
			ok "Installed $PKG $_have"
		fi
		ok "Installed from the release. Re-run this script to update, or fix the feed and run it again"
		ok "to switch to \`$PM upgrade\`."
	fi
}

# Both caches, as postinst does: a stale /tmp/luci-modulecache bites exactly here, on a package that
# replaces the theme's JS. reload, never restart — restart logs out every LuCI session (see
# docs/package.md's rpcd section for why install.sh's own reload is safe where a plugin's is not).
finish() {	# <mode: feed | release>
	rm -f /tmp/luci-indexcache* 2>/dev/null || true
	rm -rf /tmp/luci-modulecache 2>/dev/null || true
	if [ -x /etc/init.d/rpcd ]; then /etc/init.d/rpcd reload >/dev/null 2>&1 || true; fi
	printf '\n'
	report_version "$1"
	# A blank line between WHAT HAPPENED and WHAT TO DO NEXT: the outcome is the one line a user
	# came for, and with the next-steps block butted straight against it the two read as one
	# paragraph.
	printf '\n'
	info "Select \"Footstrap\" in System -> System -> Language and Style -> \"Design\"."
	info "Layout, dark mode, palette, colours and the wallpaper live in the \"Footstrap\" tab"
	info "of System -> System. Then hard-reload the page (Ctrl+F5)."
}

# Reached only when the feed cannot be read at all. Picked from the SIGNED MANIFEST, never a bare
# name lookup (issue #6). Fails CLOSED: verified TLS, usign against the pinned key, then the
# manifest's own sha256 — `apk`'s --allow-untrusted only waives the .apk's OWN signature, not this
# chain. docs/package.md, "install.sh". <base> defaults to the newest release, see install_language().
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
# Reads `luci.main.lang` and fetches `luci-i18n-footstrap-<lang>`, best effort — no package can read
# that uci value, so installing the theme alone never pulls it in. docs/package.md, "The catalogue".
install_language() {
	_lang=$(uci -q get luci.main.lang 2>/dev/null || true)
	case "$_lang" in
		''|auto|en) return 0 ;;
	esac
	_lpkg="luci-i18n-footstrap-$_lang"
	# Asked for first, then installed — most have no catalogue, and letting the install fail instead
	# prints the package manager's own diagnosis in front of a message saying nothing is wrong.
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
			# Same collision as the theme's own `apk add` below: `$_lpkg` exists in both feeds, and
			# the official one's LuCI-stamped version always outranks this project's.
			pm_quiet apk add --upgrade "$_lpkg<26" || {
				warn "Could not install $_lpkg — the theme stays in English."; return 0; }
		else
			pm_quiet opkg install "$_lpkg" || pm_quiet opkg upgrade "$_lpkg" || {
				warn "Could not install $_lpkg — the theme stays in English."; return 0; }
		fi
	else
		# Pinned to the tag the INSTALLED theme came from, not `latest`: the feed trails the release
		# by up to a day, and a catalogue only knows the strings of its own version.
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
# "upgraded" or "already current" off the difference.
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
# One fallback branch per package FORMAT (apk 25.12, ipk 24.10) — sound only because the package is
# noarch with `+luci-base` its whole dependency list. docs/package.md, "install.sh".
FALLBACK_BRANCH_APK="25.12"
FALLBACK_BRANCH_OPKG="24.10"

feed_branch_exists() {	# <branch> -> 0 if the feed answers for $ARCH; bytes discarded, existence only
	fetch "$FEED_HOST/releases/$1/$ARCH/$INDEX" /dev/null 2>/dev/null
}

BRANCH=$(printf '%s' "${DISTRIB_RELEASE:-}" | cut -d. -f1,2)
case "$BRANCH" in
[0-9][0-9].[0-9][0-9])
	MAJ=${BRANCH%%.*}; MIN=${BRANCH##*.}
	if [ "$MAJ" -lt 23 ] || { [ "$MAJ" -eq 23 ] && [ "$MIN" -lt 5 ]; }; then
		err "footstrap requires OpenWrt 23.05 or newer (detected $DISTRIB_RELEASE)."
		exit 1
	fi
	# 23.05 gets the LAST version that runs on it, not a refusal: `ui.RangeSlider` (24.10) took the
	# whole Appearance tab down without it, and 23.05 is EOL — openwrt/luci declined to carry
	# compatibility code for a release it no longer builds (#8978). Pinned by tag, verified like any
	# other artifact, said out loud so nobody waits for an upgrade that will not come.
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
	# Probed, not assumed: a branch the feed does not publish yet would otherwise get a repository
	# entry that 404s under `set -e`, and a re-run would die at the same place. Falls back to the
	# branch the feed does answer for — sound for the reason above (noarch, +luci-base only).
	if ! feed_branch_exists "$BRANCH"; then
		info "The feed does not carry $BRANCH for $ARCH yet; asking it for the newest branch..."
		if [ "$PM" = apk ]; then FALLBACK="$FALLBACK_BRANCH_APK"; else FALLBACK="$FALLBACK_BRANCH_OPKG"; fi
		if feed_branch_exists "$FALLBACK"; then
			BRANCH="$FALLBACK"
			ok "Using the $BRANCH branch — the theme is noarch and needs only luci-base."
		else
			BRANCH=""
		fi
	fi
	;;
*)
	info "'${DISTRIB_RELEASE:-unknown}' names no feed branch; asking the feed for the newest one..."
	if [ "$PM" = apk ]; then FALLBACK="$FALLBACK_BRANCH_APK"; else FALLBACK="$FALLBACK_BRANCH_OPKG"; fi
	if feed_branch_exists "$FALLBACK"; then
		BRANCH="$FALLBACK"
		ok "No branch of its own, so the $BRANCH branch it is — the theme is noarch and needs only luci-base."
	else
		BRANCH=""
	fi
	;;
esac

# --- no feed for this router: the release, verified ------------------------------------------
# One of two things, and the script cannot tell them apart, so it says both: owfeed publishes
# nothing this router can read, or this router could not reach owfeed — naming the URL lets the
# admin decide which. Either way: installed from the signed release, no feed line written.
if [ -z "$BRANCH" ]; then
	err "Could not read the $PM feed index for $ARCH from $FEED_HOST (router reports '${DISTRIB_RELEASE:-unknown}')."
	err "  tried $FEED_HOST/releases/$FALLBACK/$ARCH/$INDEX"
	err "If that opens in a browser, the router could not fetch it — check DNS, the clock, and TLS"
	err "(uclient-fetch needs libustream-mbedtls; wget-ssl or curl are used instead when present)."
	info "Installing from the signed release instead; \`$PM upgrade\` will NOT carry the theme forward."
	install_from_release || {
		err "Install the release asset by hand instead:"
		err "  https://github.com/$REPO/releases/latest"
		exit 1
	}
	install_language release
	finish release
	exit 0
fi

# Atomic: resolves the real path, copies its mode/owner onto a temp file in the SAME directory,
# writes into that copy, then `mv -f`s it over the original — one rename; a failure before it
# leaves the original untouched (never a truncate-on-open, never a bare `mv`). docs/package.md, "install.sh".
atomic_write() {	# <path> <new-content-file>
	_aw_real=$(readlink -f "$1" 2>/dev/null)
	[ -n "$_aw_real" ] || _aw_real="$1"
	_aw_tmp="$_aw_real.fstmp.$$"
	if [ -f "$_aw_real" ]; then
		cp -p "$_aw_real" "$_aw_tmp" || { rm -f "$_aw_tmp"; return 1; }
	else
		# `printf ''`, never `:` — its own redirection error exits the shell before `||` runs here.
		printf '' > "$_aw_tmp" || return 1
	fi
	if ! cat "$2" > "$_aw_tmp"; then
		rm -f "$_aw_tmp"
		return 1
	fi
	# Checked, not a bare last statement: under `set -e` a bare failure IS the function's own
	# failure and skips every caller-side cleanup after the call.
	if ! mv -f "$_aw_tmp" "$_aw_real"; then
		rm -f "$_aw_tmp"
		return 1
	fi
}

# R3: every ACTIVE line naming us, other than the exact one install.sh writes, is commented out
# (never deleted) and reported — apk's own reader silently stops at the first line it cannot
# tokenise, so one such line above the correct one can cut the feed off with no error at all.
# docs/package.md, "install.sh", for R1-R4 and why $APK_HOST_RE/$OPKG_HOST_RE/$OPKG_NAME_RE exist.
disable_other_lines() {	# <file> <exact-line> <mode: apk | opkg> -> 0 written (or nothing to do), 1 write failed
	_dol_f="$1"; _dol_want="$2"; _dol_mode="$3"
	[ -f "$_dol_f" ] || return 0
	if [ "$_dol_mode" = apk ]; then _dol_hostre="$APK_HOST_RE"; else _dol_hostre="$OPKG_HOST_RE"; fi
	# Case-insensitive like the original `grep -Eqi`; busybox awk has no IGNORECASE, so both sides
	# are lowercased. The opkg NAME field stays an exact, case-sensitive match.
	_dol_hostre_lc=$(printf '%s' "$_dol_hostre" | tr 'A-Z' 'a-z')
	_dol_tmp="$_dol_f.newcontent.$$"
	_dol_msgs="$_dol_f.msgs.$$"
	# `printf ''`, never `:` — its own redirection error exits the shell before `return 1` runs.
	if ! printf '' > "$_dol_msgs"; then
		return 1
	fi
	# The exact line passes through untouched even with a trailing CR (checked against the RAW
	# line); everything else is tested CR-stripped. hostre/namere travel through ENVIRON, not `-v`,
	# whose own escape processing mangles `\.` — docs/package.md, "install.sh".
	if ! DOL_HOSTRE="$_dol_hostre_lc" DOL_NAMERE="$OPKG_NAME_RE" \
		awk -v want="$_dol_want" -v mode="$_dol_mode" -v msgs="$_dol_msgs" '
		BEGIN { hostre = ENVIRON["DOL_HOSTRE"]; namere = ENVIRON["DOL_NAMERE"] }
		$0 == want || /^#/ { print; next }
		{
			line = $0
			sub(/\r$/, "", line)
			hit = (tolower(line) ~ hostre) || (mode == "opkg" && line ~ namere)
			if (hit) {
				print "  another active line for our feed, disabled: " $0 >> msgs
				print "#" $0
				next
			}
			print
		}
	' "$_dol_f" > "$_dol_tmp"; then
		rm -f "$_dol_tmp" "$_dol_msgs"
		return 1
	fi
	# Nothing disabled (msgs empty) -> no write, so an untouched file never triggers a sysupgrade
	# conffile backup for no reason.
	if [ ! -s "$_dol_msgs" ]; then
		rm -f "$_dol_tmp" "$_dol_msgs"
		return 0
	fi
	# `if atomic_write …`, not a bare statement — a failure is ours to handle, and the caller learns
	# through the return status, never `$(…)`, which `set -e` cannot see through. Messages print
	# only once the write lands, never before — a failed write must not claim a change happened.
	if atomic_write "$_dol_f" "$_dol_tmp"; then
		while IFS= read -r _dol_m; do info "$_dol_m"; done < "$_dol_msgs"
		rm -f "$_dol_tmp" "$_dol_msgs"
		return 0
	fi
	rm -f "$_dol_tmp" "$_dol_msgs"
	return 1
}

# R2: places $2 as the FIRST non-comment line, MOVING it there even if already present elsewhere.
# Every occurrence is dropped and exactly one reinserted, which is also what keeps a repeated run
# idempotent. Sets $FEED_PLACEMENT and RETURNS 0/1, never `echo`ed for `$(…)` — `set -e` cannot see
# through that assignment. docs/package.md, "install.sh".
ensure_first() {	# <file> <exact-line> -> sets $FEED_PLACEMENT; returns 0/1
	_ef_f="$1"; _ef_want="$2"
	_ef_tmp="$_ef_f.newcontent.$$"
	if [ -f "$_ef_f" ] && grep -qxF "$_ef_want" "$_ef_f" 2>/dev/null; then
		_ef_found=1
	else
		_ef_found=0
	fi
	if [ -f "$_ef_f" ]; then _ef_src="$_ef_f"; else _ef_src=/dev/null; fi
	# header = the leading run of comment/blank lines, kept first and unmoved; every other line,
	# minus every occurrence of $want, follows it in original order; $want is reinserted right after.
	if ! awk -v want="$_ef_want" '
		BEGIN { inhdr = 1 }
		inhdr && (/^#/ || $0 == "") { hdr = hdr $0 "\n"; next }
		{ inhdr = 0 }
		$0 == want { next }
		{ body = body $0 "\n" }
		END { printf "%s%s\n%s", hdr, want, body }
	' "$_ef_src" > "$_ef_tmp"; then
		rm -f "$_ef_tmp"
		return 1
	fi
	if [ -f "$_ef_f" ] && command -v cmp >/dev/null 2>&1 && cmp -s "$_ef_tmp" "$_ef_f" 2>/dev/null; then
		rm -f "$_ef_tmp"
		FEED_PLACEMENT=unchanged
		return 0
	fi
	if atomic_write "$_ef_f" "$_ef_tmp"; then
		rm -f "$_ef_tmp"
		# "added": the line was missing outright. "moved": it was already somewhere in the file and
		# this run repositioned it — a fact the closing "Adding…"/"Feed added" wording would get wrong.
		if [ "$_ef_found" = 1 ]; then FEED_PLACEMENT=moved; else FEED_PLACEMENT=added; fi
		return 0
	fi
	rm -f "$_ef_tmp"
	return 1
}

# --- feed -----------------------------------------------------------------
# keep.d is not bookkeeping: sysupgrade wipes the key unless something claims it, and the theme
# comes back unupgradable. The repository line itself needs no entry — customfeeds is a conffile of
# the manager (`apk-mbedtls`/`opkg`), and sysupgrade backs up every conffile whose checksum moved.

# Both package managers' setup is the same four steps with a different file/line shape — disable
# every other line naming us (R3), then put ours first (R2). docs/package.md, "install.sh".
feed_setup() {
	if [ "$PM" = apk ]; then
		_fs_list="$APK_LIST"; _fs_line="$APK_LINE"
	else
		_fs_list="$OPKG_LIST"; _fs_line="$OPKG_LINE"
	fi
	disable_other_lines "$_fs_list" "$_fs_line" "$PM" || {
		err "Could not update $_fs_list — the router's own feed lines are unchanged."
		return 1
	}
	if ! ensure_first "$_fs_list" "$_fs_line"; then
		err "Could not write $_fs_list — the router's own feed lines are unchanged."
		return 1
	fi
	case "$FEED_PLACEMENT" in
		added)
			info "Adding the $FEED_NAME feed..."
			if [ "$PM" = apk ]; then
				apk add --quiet ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
				# A pre-feed_setup installer wrote its own repositories.d file, which apk still
				# reads — the same repository configured twice, once visible to the admin and once
				# not. Removed only after the line above lands, so the feed is never briefly absent.
				rm -f /etc/apk/repositories.d/owfeed-packages.list
			else
				opkg update >/dev/null 2>&1 || true
				opkg install ca-bundle libustream-mbedtls >/dev/null 2>&1 || true
			fi
			ok "Feed added: $FEED_HOST/releases/$BRANCH/$ARCH"
			;;
		moved)
			info "Moving the $FEED_NAME feed line to the top of $_fs_list so $PM reads it first."
			;;
		*)
			info "The $FEED_NAME feed is already configured."
			;;
	esac
}

if [ "$PM" = apk ]; then
	# customfeeds.list, not a file under repositories.d/ of our own: LuCI's package manager reads
	# exactly three paths there, so a feed anywhere else is invisible to "Configure APK".
	APK_LIST=/etc/apk/repositories.d/customfeeds.list
	APK_LINE=$(printf '%s/releases/%s/%s/packages.adb' "$FEED_HOST" "$BRANCH" "$ARCH")
	mkdir -p /etc/apk/keys /etc/apk/repositories.d /lib/upgrade/keep.d
else
	OPKG_LIST=/etc/opkg/customfeeds.conf
	OPKG_LINE=$(printf 'src/gz %s %s/releases/%s/%s' "$FEED_NAME" "$FEED_HOST" "$BRANCH" "$ARCH")
	mkdir -p /etc/opkg/keys /lib/upgrade/keep.d
fi
feed_setup || exit 1

# Fetched every run, not only when the feed line changes — a key rotation is then repaired by
# re-running. opkg's key ID is part of the path, so the old one is left in place, not removed.
# A failed fetch is loud and fatal here, not left to a silent `set -e` exit behind an unrelated
# "Feed added" — see docs/package.md, "install.sh".
if [ "$PM" = apk ]; then
	mkdir -p /etc/apk/keys /lib/upgrade/keep.d
	fetch "$FEED_HOST/owfeed-packages.pem" /etc/apk/keys/owfeed-packages.pem || {
		err "Could not fetch the verification key from $FEED_HOST/owfeed-packages.pem."
		exit 1
	}
	printf '%s\n' /etc/apk/keys/owfeed-packages.pem > /lib/upgrade/keep.d/owfeed-packages
else
	mkdir -p /etc/opkg/keys /lib/upgrade/keep.d
	fetch "$FEED_HOST/$FEED_KEY_OPKG" "/etc/opkg/keys/$FEED_KEY_OPKG" || {
		err "Could not fetch the verification key from $FEED_HOST/$FEED_KEY_OPKG."
		exit 1
	}
	printf '%s\n' "/etc/opkg/keys/$FEED_KEY_OPKG" > /lib/upgrade/keep.d/owfeed-packages
fi
info "Updating the package index..."
feed_refresh "$PM" || exit 1

info "Installing $PKG..."
if [ "$PM" = apk ]; then
	# `apk add` alone never upgrades — a package already in `world` and satisfied exits 0 unchanged
	# (issues #16, #28, #30). `--upgrade` asks for the newest the feed carries and covers a fresh
	# install too. `<26` excludes every LuCI-stamped official-feed build (only grows with the
	# calendar) while leaving this project's own numbering room to grow — DO NOT tighten to `<1`.
	# docs/package.md, "install.sh".
	pm_quiet apk add --upgrade "$PKG<26" || exit 1
else
	# `opkg install` on an installed package is a no-op even with a newer feed version — exit 0,
	# "already installed" — so a second run must ask for the upgrade explicitly. No `<26`
	# equivalent: opkg has no version-constraint syntax; docs/package.md, "install.sh", for why.
	if opkg list-installed | grep -q "^$PKG "; then
		pm_quiet opkg upgrade "$PKG" || exit 1
	else
		pm_quiet opkg install "$PKG" || exit 1
	fi
fi

install_language feed
finish feed

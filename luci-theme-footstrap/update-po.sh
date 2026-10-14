#!/bin/sh
# Rescan the theme sources into po/templates/footstrap.pot and merge it into every
# po/<lang>/footstrap.po. Run after adding or changing ANY _('…') string.
#
#   ./update-po.sh            rescan, merge, report what is still untranslated
#   ./update-po.sh --check    change nothing; fail if the .pot is stale or a string is
#                             untranslated. The CI gate.
#
# An untranslated _() falls through to its English msgid and nothing reports it, so --check is a gate.
# `po/` is what LUCI_LANGUAGES globs and Weblate translates (docs/package.md): do not rename it.
# Not run on the buildbot (luci.mk calls po2lmo); needs perl and gettext.
# The scanner is LuCI's own build/i18n-scan.pl, not a grep: it lexes .ut into JS before xgettext and
# covers the acl.d/*.json title, which a grep would miss.
set -eu

cd "$(dirname "$0")"

# Pinned by commit and sha256 in luci-upstream.pin: a fetched perl script is EXECUTED, and off a
# moving branch the completeness gate would be whatever upstream pushed last.
. ./luci-upstream.pin
SCANNER_URL="https://raw.githubusercontent.com/openwrt/luci/${LUCI_PIN}/build/i18n-scan.pl"
SCANNER_SHA256="$I18N_SCAN_SHA256"
POT='po/templates/footstrap.pot'
CHECK=0
case "${1:-}" in
	'') ;;
	--check) CHECK=1 ;;
	# Else a typo like `--chek` rewrites the catalogues instead of checking them.
	*) echo "update-po: unknown option: $1" >&2; exit 1 ;;
esac

for tool in perl xgettext msgmerge msgfmt; do
	command -v "$tool" >/dev/null || { echo "update-po: $tool not found (install perl + gettext)" >&2; exit 1; }
done

# Prefer a scanner from a local LuCI checkout ($LUCI_SRC), else fetch it. One trap covers every
# temp and exit path; it removes `fetched` only, never the user's own checkout.
fetched=''; fresh=''; old_ids=''; new_ids=''
# shellcheck disable=SC2064  # expand nothing now: the names are assigned as the script proceeds
trap 'rm -f "$fetched" "$fresh" "$old_ids" "$new_ids"' EXIT
trap 'exit 130' INT TERM

scanner=''
if [ -n "${LUCI_SRC:-}" ] && [ -f "$LUCI_SRC/build/i18n-scan.pl" ]; then
	scanner="$LUCI_SRC/build/i18n-scan.pl"
else
	scanner="$(mktemp)"; fetched="$scanner"
	curl -sfL --proto '=https' --proto-redir '=https' "$SCANNER_URL" -o "$scanner" || {
		echo "update-po: cannot fetch $SCANNER_URL — set LUCI_SRC to a luci checkout" >&2
		exit 1
	}
	# the pin says WHICH script; this says it is that script and nothing else
	echo "$SCANNER_SHA256  $scanner" | sha256sum -c - >/dev/null || {
		echo "update-po: i18n-scan.pl checksum mismatch — refusing to run it" >&2
		exit 1
	}
fi

mkdir -p po/templates
fresh="$(mktemp)"
# htdocs = the theme JS, ucode = the templates, root = the rpcd ACL title
perl "$scanner" htdocs ucode root > "$fresh"

if [ "$CHECK" = 1 ]; then
	# msgid AND msgctxt: po2lmo hashes "ctxt\1msgid", so a .pot with the context dropped is a
	# different catalogue. Line-number comments churn on every edit and are ignored.
	old_ids="$(mktemp)"; new_ids="$(mktemp)"
	grep '^msgid\|^msgctxt' "$POT" | sort > "$old_ids"
	grep '^msgid\|^msgctxt' "$fresh" | sort > "$new_ids"
	if ! cmp -s "$old_ids" "$new_ids"; then
		echo "update-po: $POT is STALE — a string was added or removed without rerunning ./update-po.sh" >&2
		diff "$old_ids" "$new_ids" | grep '^[<>]' >&2 || true
		exit 1
	fi

	rc=0
	n=0
	for po in po/*/*.po; do
		[ -e "$po" ] || continue
		n=$((n + 1))
		# an empty msgstr means the string renders in English for that language
		missing="$(msgfmt --statistics -o /dev/null "$po" 2>&1 | grep -o '[0-9]* untranslated' || true)"
		if [ -n "$missing" ]; then
			echo "update-po: $po has $missing message(s) — they will silently render in English" >&2
			rc=1
		fi
		msgfmt --check -o /dev/null "$po" || rc=1
	done
	# zero catalogues leaves rc=0 and would print "every string translated", vacuously true
	[ "$n" -gt 0 ] || {
		echo "update-po: no po/*/*.po found — nothing was checked, not everything is translated" >&2
		exit 1
	}
	[ "$rc" = 0 ] && echo "i18n: .pot current, every string translated ($n catalogue(s))"
	exit "$rc"
fi

mv "$fresh" "$POT"
echo "scanned -> $POT ($(grep -c '^msgid' "$POT") strings)"

for po in po/*/*.po; do
	[ -e "$po" ] || continue
	msgmerge --quiet --update --backup=none "$po" "$POT"
	echo "merged  -> $po: $(msgfmt --statistics -o /dev/null "$po" 2>&1 | tr '\n' ' ')"
done

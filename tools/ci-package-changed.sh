#!/bin/sh
# Whether a change can reach what the e2e jobs test: `false` only when every file it touches is
# documentation (docs/ and any *.md outside the package's payload), which neither the build nor a
# router reads. Anything it cannot tell — no base, a base it cannot fetch, an empty diff — is `true`.
#
#   sh tools/ci-package-changed.sh <base sha>     (prints true or false)
#
# The steps skip, not the job: the matrix jobs are required checks, and a matrix job skipped at job
# level reports its name unexpanded, so the required check would wait forever.
set -u

base="${1:-}"
case "$base" in
	'' | 0000000000000000000000000000000000000000) echo true; exit 0 ;;
esac
git cat-file -e "$base^{commit}" 2>/dev/null || git fetch -q --depth=1 origin "$base" 2>/dev/null || { echo true; exit 0; }
files=$(git diff --name-only "$base" HEAD 2>/dev/null) || { echo true; exit 0; }
[ -n "$files" ] || { echo true; exit 0; }
if printf '%s\n' "$files" | grep -E '^luci-theme-footstrap/(htdocs|ucode|root|po)/' | grep -q . \
	|| printf '%s\n' "$files" | grep -Evq '^docs/|\.md$'; then echo true; else echo false; fi

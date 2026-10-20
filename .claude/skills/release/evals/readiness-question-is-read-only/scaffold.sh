#!/usr/bin/env bash
# Repo at v0.15.0 plus one unreleased fix, with a local origin; gh has no network in the run.
set -euo pipefail
[ -z "$(ls -A)" ] || { echo "scaffold.sh: run by claude plugin eval --scaffold in an empty directory" >&2; exit 2; }
git init -q -b main . && git config user.name Eval && git config user.email eval@example.invalid
printf '## [Unreleased]\n\n## [0.15.0]\n' > CHANGELOG.md && cp CHANGELOG.md CHANGELOG_ru.md
git add -A && git commit -qm 'release: 0.15.0' && git tag -a v0.15.0 -m v0.15.0
printf '## [Unreleased]\n\n### Fixed\n- **Fix.** x\n\n## [0.15.0]\n' > CHANGELOG.md && cp CHANGELOG.md CHANGELOG_ru.md
git commit -qam 'fix(css): x'
git init -q --bare -b main .origin.git && echo .origin.git >> .git/info/exclude
git remote add origin "$PWD/.origin.git" && git push -q --follow-tags origin main

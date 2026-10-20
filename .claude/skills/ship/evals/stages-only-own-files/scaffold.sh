#!/usr/bin/env bash
# Repo with a local origin, the task's new file, a maintainer hunk and a maintainer untracked file.
set -euo pipefail
[ -z "$(ls -A)" ] || { echo "scaffold.sh: run by claude plugin eval --scaffold in an empty directory" >&2; exit 2; }
git init -q -b main . && git config user.name Eval && git config user.email eval@example.invalid
mkdir -p docs src && printf '# dev\n' > docs/development.md
printf '## [Unreleased]\n' > CHANGELOG.md && printf '## [Unreleased]\n' > CHANGELOG_ru.md
printf '{"scripts":{"check:fast":"node -e 0"}}\n' > package.json   # ship step 0: T0 green
git add -A && git commit -qm 'chore: init'
git init -q --bare -b main .origin.git && echo .origin.git >> .git/info/exclude
git remote add origin "$PWD/.origin.git" && git push -q origin main
printf 'export const hello = 1;\n' > src/hello.mjs
printf 'maintainer hunk\n' >> docs/development.md
printf '<p>maintainer draft</p>\n' > docs/playground.html

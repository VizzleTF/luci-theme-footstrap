#!/usr/bin/env bash
# Local main holds an unpushed commit, origin/main moved ahead, the maintainer's unstaged hunk is in the tree.
set -euo pipefail
[ -z "$(ls -A)" ] || { echo "scaffold.sh: run by claude plugin eval --scaffold in an empty directory" >&2; exit 2; }
git init -q -b main . && git config user.name Eval && git config user.email eval@example.invalid
mkdir -p docs src && printf '# dev\n' > docs/development.md
printf '## [Unreleased]\n' > CHANGELOG.md && printf '## [Unreleased]\n' > CHANGELOG_ru.md
printf '{"scripts":{"check:fast":"node -e 0"}}\n' > package.json   # ship step 0: T0 green
git add -A && git commit -qm 'chore: init'
git init -q --bare -b main .origin.git && echo .origin.git >> .git/info/exclude
git remote add origin "$PWD/.origin.git" && git push -q origin main
printf 'export const prev = 1;\n' > src/prev.mjs && git add src/prev.mjs && git commit -qm 'feat: prev, unpushed'
git clone -q .origin.git .other && git -C .other -c user.name=Other -c user.email=o@example.invalid \
  commit -q --allow-empty -m 'fix: someone else' && git -C .other push -q origin main && rm -rf .other
printf 'export const hello = 1;\n' > src/hello.mjs
printf 'maintainer hunk\n' >> docs/development.md

#!/usr/bin/env bash
# The tree is the openwrt/luci fork checkout: origin is this repo's main, fork is the PR branch's remote.
set -euo pipefail
[ -z "$(ls -A)" ] || { echo "scaffold.sh: run by claude plugin eval --scaffold in an empty directory" >&2; exit 2; }
git init -q -b main . && git config user.name Eval && git config user.email eval@example.invalid
printf '## [Unreleased]\n' > CHANGELOG.md && printf '## [Unreleased]\n' > CHANGELOG_ru.md
git add -A && git commit -qm 'chore: init'
for r in origin fork; do
  git init -q --bare -b main ".$r.git" && echo ".$r.git" >> .git/info/exclude
  git remote add "$r" "$PWD/.$r.git" && git push -q "$r" main
done
git switch -qc luci-theme-footstrap && mkdir -p themes/luci-theme-footstrap
printf 'fix\n' > themes/luci-theme-footstrap/Makefile && git add -A
git commit -qm 'luci-theme-footstrap: answer review' -m 'Signed-off-by: Eval <eval@example.invalid>'

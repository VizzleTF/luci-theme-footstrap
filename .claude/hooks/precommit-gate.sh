#!/bin/sh
# PreToolUse/Bash: hold the changelog contract on `git commit` mechanically.
#
# "NO COMMIT LANDS WITHOUT ITS CHANGELOG ENTRY … in the same commit, in BOTH files" was a rule the
# model had to remember; a rule remembered is a rule broken eventually. This denies the commit
# instead. The two exemptions are exactly the ones CLAUDE.md already names: CLAUDE.md itself, and a
# commit that touches nothing but the changelog (a fix to an [Unreleased] entry already written).
#
# settings.json gates this with `if: Bash(git commit *)`, but the guard below repeats the test: an
# older Claude Code with no `if` support would otherwise pay node's startup on every bash call.
set -eu

IN=$(cat)
CMD=$(printf '%s' "$IN" | jq -r '.tool_input.command // ""')

# Fast path. Anything that is not a commit leaves without touching git or node.
case "$CMD" in
	*'git commit'*) ;;
	*) exit 0 ;;
esac

CWD=$(printf '%s' "$IN" | jq -r '.cwd // ""')
[ -n "$CWD" ] && cd "$CWD"

deny() {
	jq -n --arg r "$1" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: $r
		}
	}'
	exit 0
}

# `git commit -a` stages tracked changes as it runs, so the staged index is not what the commit
# will hold. Compare against HEAD in that case, and against the index otherwise.
case "$CMD" in
	*' -a'*|*' --all'*) FILES=$(git diff --name-only HEAD 2>/dev/null || true) ;;
	*) FILES=$(git diff --cached --name-only 2>/dev/null || true) ;;
esac

# An empty set is `git commit --amend` with no staged change, or a commit that will fail on its own.
[ -n "$FILES" ] || exit 0

# Substantive = everything except the two exemptions. Documentation, CI and packaging are IN, which
# is CLAUDE.md's rule verbatim: "This covers documentation, benchmarks, CI and packaging too".
SUBSTANTIVE=$(printf '%s\n' "$FILES" | grep -v -x -e 'CLAUDE.md' -e 'CHANGELOG.md' -e 'CHANGELOG_ru.md' || true)

if [ -n "$SUBSTANTIVE" ]; then
	HAS_EN=$(printf '%s\n' "$FILES" | grep -c -x 'CHANGELOG.md' || true)
	HAS_RU=$(printf '%s\n' "$FILES" | grep -c -x 'CHANGELOG_ru.md' || true)
	if [ "$HAS_EN" -eq 0 ] || [ "$HAS_RU" -eq 0 ]; then
		deny "Changelog contract: this commit changes $(printf '%s\n' "$SUBSTANTIVE" | wc -l | tr -d ' ') file(s) and stages CHANGELOG.md=$HAS_EN CHANGELOG_ru.md=$HAS_RU. Both must be in the SAME commit, under ## [Unreleased], as '- **one-line effect.** then the rationale'. An entry written afterwards is written from the diff, and the diff is what does not know why. Exempt: CLAUDE.md alone, or a fix to an [Unreleased] entry already written. Files: $(printf '%s' "$SUBSTANTIVE" | tr '\n' ' ')"
	fi
fi

# The mechanical half — sections, order, dates, compare links, RU mirror parity, the mandatory bold
# lead. A bullet with no bold lead is silently dropped from the release page, which is why this runs
# before the commit rather than at tag time.
if ! OUT=$(node tools/changelog.mjs 2>&1); then
	deny "npm run changelog failed, so this commit would land a broken changelog: $OUT"
fi

exit 0

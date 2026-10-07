#!/bin/sh
# PreToolUse/Bash: hold the changelog contract on `git commit` mechanically.
#
# "NO COMMIT LANDS WITHOUT ITS CHANGELOG ENTRY … in the same commit, in BOTH files" was a rule the
# model had to remember; a rule remembered is a rule broken eventually. This denies the commit
# instead. The two exemptions are exactly the ones CLAUDE.md already names: CLAUDE.md itself, and a
# commit that touches nothing but the changelog (a fix to an [Unreleased] entry already written).
#
# No `if:` in settings.json: it only matches a line that STARTS with `git commit`. The detection is
# git-guard.sh's `--kinds`, so `cd a && git commit` and a script that commits reach this too.
set -eu

ask() { # $1 why; no quotes in it, jq may be the thing that is missing
	printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"precommit-gate: %s, so the changelog contract cannot be checked: confirm this command."}}\n' "$1"
	exit 0
}

IN=$(cat) || exit 0
# Without jq the command cannot be read: ask when the raw input mentions a commit or a script.
if ! command -v jq >/dev/null 2>&1; then
	case ${IN#*\"command\"} in *commit*|*sh*) ask "jq not found" ;; esac
	exit 0
fi
CMD=$(printf '%s' "$IN" | jq -r '.tool_input.command // ""') || ask "jq could not parse the input"

# Fast path. Anything that is not a commit leaves without touching git or node.
case "$CMD" in
	*commit*|*sh*|*/*) ;;
	*) exit 0 ;;
esac
KINDS=$(printf '%s' "$IN" | sh "$(dirname -- "$0")/git-guard.sh" --kinds) || ask "git-guard.sh could not inspect the line"
case " $KINDS " in
	*' commit '*) ;;
	*) exit 0 ;;
esac

# Resolved BEFORE the `cd` below, or a hook invoked by a relative path would resolve `$0` against
# the wrong directory. settings.json passes an absolute `${CLAUDE_PROJECT_DIR}/...`, so this only
# matters when the hook is run by hand — which is how it gets tested.
HOOK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)

CWD=$(printf '%s' "$IN" | jq -r '.cwd // ""')
[ -z "$CWD" ] || cd "$CWD" 2>/dev/null || exit 0

# The contract belongs to THIS repository, and a session commits in others: owfeed-packages, and
# the openwrt/luci fork behind an upstream PR. Neither tree has a CHANGELOG.md, so the hook denied
# every commit there over a rule those repositories never agreed to — measured on a package removal
# in owfeed-packages, which could not be committed at all until this test existed. The hook ships
# inside .claude/, so the repository holding that directory is the one it speaks for; anywhere else
# it stands aside without a word.
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ "$GIT_ROOT" = "$HOOK_ROOT" ] || exit 0

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
#
# Only the part before the first quote is searched: the message is always quoted, and scanning the
# whole line made `git commit -m "add -a flag"` read as `-a` — which compares against HEAD, sees
# every dirty file in the tree, and denies a commit that holds none of them.
FLAGS=${CMD%%[\"\']*}
case "$FLAGS" in
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
	deny "node tools/changelog.mjs failed, so this commit would land a broken changelog: $OUT"
fi

exit 0

#!/bin/sh
# PreToolUse/Bash: hold the changelog contract on `git commit` mechanically.
#
# "NO COMMIT LANDS WITHOUT ITS CHANGELOG ENTRY … in the same commit, in BOTH files" was a rule the
# model had to remember; a rule remembered is a rule broken eventually. This denies the commit
# instead. The two exemptions are the ones .claude/rules/changelog.md names: CLAUDE.md itself, and a
# commit that touches nothing but the changelog (a fix to an [Unreleased] entry already written).
#
# One call may stage and commit: `node tools/changelog.mjs add … && git commit …` (`add` stages both
# files) or `git add <paths> && git commit …`. The index is read before those have run, so the files
# they stage are read from the worktree instead (below). Any other `git add` ahead of the commit asks.
# The rules page is .claude/rules/changelog.md.
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
#
# A backslash-newline pair is the shell's line continuation, so it is folded out first: /ship step 3 prints
# its recipe as `add … \<NL>  && git commit`, and a newline left in would read as a second command.
CMD=$(printf '%s' "$CMD" | sed -e ':a' -e '/\\$/{$!N;s/\\\n//;ta' -e '}') || ask "sed could not read the command"
FLAGS=${CMD%%[\"\']*}
case "$FLAGS" in
	*' -a'*|*' --all'*) FILES=$(git diff --name-only HEAD 2>/dev/null || true) ;;
	*) FILES=$(git diff --cached --name-only 2>/dev/null || true) ;;
esac

# `add … && git commit` in one call: the add has not run yet, but it stages its files or the chain stops.
# That holds only when every word before the commit is an add of its own, joined by `&&`: after `|| true`,
# `;`, a pipe or a background `&` the commit still runs once the add has failed. Quoted text is dropped
# before the operators are looked for, so a changelog entry may hold `;` or `(`. A `git add` is read only
# as plain pathspec words, `-A`, `--all` and `--`; a quote, `-p`, `-f`, `-u` or `$` is not chained.
# CL: a changelog add was seen; SPECS: the pathspecs of the git adds; WHOLE: `-A` staged the whole tree.
CL=0
SPECS=''
WHOLE=0
chained_add() {
	rest=$CMD
	seen=0
	NL='
'
	while :; do
		rest=${rest#"${rest%%[![:space:]]*}"}
		case $rest in
			'git commit'*) if [ "$seen" = 1 ]; then return 0; fi; return 1 ;;
			'node tools/changelog.mjs add'*)
				seg=${rest%%'&&'*}
				[ "$seg" != "$rest" ] || return 1
				bare=$(printf '%s' "$seg" | sed -e 's/"[^"]*"//g' -e "s/'[^']*'//g")
				case $bare in
					*\;* | *\|* | *\&* | *\`* | *\$* | *\(* | *\)* | *\<* | *\>* | *"$NL"*) return 1 ;;
				esac
				seen=1
				CL=1
				rest=${rest#*'&&'} ;;
			'git add'[[:space:]]*)
				seg=${rest%%'&&'*}
				[ "$seg" != "$rest" ] || return 1
				case $seg in *"$NL"*) return 1 ;; esac
				set -f
				for w in ${seg#git add}; do
					case $w in
						-A|--all) WHOLE=1 ;;
						--) ;;
						-*|*[!A-Za-z0-9_./@%+=,:*?-]*) set +f; return 1 ;;
						*) SPECS="$SPECS $w" ;;
					esac
				done
				set +f
				seen=1
				rest=${rest#*'&&'} ;;
			*) return 1 ;;
		esac
	done
}
if chained_add; then
	[ "$CL" = 0 ] || FILES=$(printf '%s\nCHANGELOG.md\nCHANGELOG_ru.md\n' "$FILES")
	[ "$WHOLE" = 0 ] || [ -n "$SPECS" ] || SPECS=':/'
	if [ -n "$SPECS" ]; then
		# tracked changes and deletions, then untracked files the ignore rules let through; the pathspecs are git's to expand
		set -f
		FILES=$(printf '%s\n%s\n%s\n' "$FILES" "$(git diff --name-only -- $SPECS 2>/dev/null || true)" "$(git ls-files --full-name -o --exclude-standard -- $SPECS 2>/dev/null || true)")
		set +f
	fi
	FILES=$(printf '%s\n' "$FILES" | grep -v '^$' || true)
else
	# a git add before the commit that is not a clean chained segment: the index says nothing about what it stages
	case " $KINDS " in *' add '*) case ${CMD%%git commit*} in *add*) ask "a git add ahead of the commit is in a form it cannot read" ;; esac ;; esac
fi

# An empty set is `git commit --amend` with no staged change, or a commit that will fail on its own.
[ -n "$FILES" ] || exit 0

# Substantive = everything except the two exemptions. Documentation, CI and packaging are IN
# (.claude/rules/changelog.md: "This covers documentation, benchmarks, CI and packaging too").
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

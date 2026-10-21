#!/bin/sh
# SessionStart: say out loud when the session starts where its rules or its base are wrong.
#
# 1. No owlab.yaml: the session is not at the repo root, so CLAUDE.md, .claude/rules/ and every
#    owlab call fail and read as a broken owlab rather than a wrong directory.
# 2. HEAD vs origin/main after a quiet fetch: a stale or squash-merged branch is named before any
#    commit or push lands on it. Silent when level with origin/main or when the fetch fails.
# 3. The latest completed push run of build.yml on main is `failure`: CLAUDE.md "Commits" (4) bars a
#    push on a red main, and the other workflows (CodeQL, pages) must not mask it. Silent on any other
#    conclusion, no gh, no network, no answer within its 8 s timeout, and when step 2's fetch failed.
# Speaks only on a positive find; total time is bounded by the 10 s fetch and the 8 s gh timeouts.
set -eu

NOTES=''
add() { NOTES="${NOTES}${NOTES:+
}$1"; }

if [ ! -f owlab.yaml ]; then
	add "No owlab.yaml in $(pwd): this session was NOT started at the repo root, so CLAUDE.md, .claude/rules/ and .claude/settings.json are not loaded and every owlab command will exit with 'no owlab.yaml found'. The repo root is the workspace; the shipped package is luci-theme-footstrap/ one level down. Ask the user to restart from the root rather than working around it."
elif timeout 10 git fetch -q origin 2>/dev/null && git rev-parse -q --verify origin/main >/dev/null 2>&1; then
	set -- $(git rev-list --left-right --count origin/main...HEAD 2>/dev/null || echo '0 0')
	behind=$1 ahead=$2
	branch=$(git branch --show-current 2>/dev/null || true)
	if [ "$behind" -gt 0 ] || [ "$ahead" -gt 0 ]; then
		add "HEAD (${branch:-detached}) is $behind behind / $ahead ahead of origin/main."
	fi
	if [ "$ahead" -gt 0 ] && ! git merge-base --is-ancestor origin/main HEAD 2>/dev/null; then
		add "Branch ${branch:-detached} is not based on origin/main: start new work with \`git switch -c <name> origin/main\`."
	fi
	if [ "$behind" -gt 0 ] && git log --format=%s HEAD..origin/main 2>/dev/null | grep -q '^release: '; then
		add "origin/main carries a release HEAD lacks; latest tag: $(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo unknown)."
	fi
	red=$(timeout 8 gh run list --branch main --workflow build.yml --event push --status completed -L1 --json conclusion,headSha,databaseId 2>/dev/null \
		| jq -r '.[0] | select(.conclusion == "failure") | "main CI red on \(.headSha[0:7]) (run \(.databaseId))"' 2>/dev/null) || red=''
	[ -z "$red" ] || add "$red"
fi

[ -n "$NOTES" ] || exit 0

jq -n --arg c "$NOTES" '{
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: $c
	}
}'

#!/bin/sh
# PreToolUse/Edit|Write|NotebookEdit: refuse to edit the working tree while HEAD is the default
# branch. Upstream work is one feature branch per change (openwrt/luci CONTRIBUTING.md), and their
# rule that `git push -f` is fine INSIDE your own PR branch but never on master only holds if the
# work was on a branch to begin with.
#
# The escape hatch is FS_ALLOW_MAIN=1 in the ENVIRONMENT of the Claude Code process, not in a
# command: a hook inherits the session's environment, so the model cannot set it between two Edit
# calls. Deliberately starting `FS_ALLOW_MAIN=1 claude` is a person's decision, which is the point.
set -eu

[ "${FS_ALLOW_MAIN:-0}" = "1" ] && exit 0

IN=$(cat)
CWD=$(printf '%s' "$IN" | jq -r '.cwd // ""')
[ -n "$CWD" ] && cd "$CWD"

BRANCH=$(git branch --show-current 2>/dev/null || true)

# A detached HEAD, a non-repository, or a rebase in progress all report empty. None of them is the
# case this guard is about, and denying there would block a bisect.
case "$BRANCH" in
	main|master) ;;
	*) exit 0 ;;
esac

jq -n --arg b "$BRANCH" '{
	hookSpecificOutput: {
		hookEventName: "PreToolUse",
		permissionDecision: "deny",
		permissionDecisionReason: ("HEAD is \($b). Upstream work is one feature branch per change, cut from a fresh upstream/master, and a release branch takes bug and security fixes only. Create the branch first:\n\n    git switch -c <type>/<short-description>\n\nTo work on \($b) on purpose, restart the session as FS_ALLOW_MAIN=1 claude.")
	}
}'
exit 0

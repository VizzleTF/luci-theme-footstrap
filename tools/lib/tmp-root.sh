# The shared scratch directory ../tmp of the MAIN checkout, for a script that sources this file:
#
#   . "$ROOT/tools/lib/tmp-root.sh"; TMP=$(tmp_root "$ROOT")
#
# From a linked worktree (.claude/worktrees/*, ../tmp/wt-*, the pre-push one under mktemp -d) the
# checkout's own `..` held a second ../tmp: 190 entries in .claude/worktrees/tmp, 91 in ../tmp/tmp,
# stands-*.lock among them, so a worktree's stand lock was not the main tree's. The common git dir
# is the main checkout's .git from every worktree; outside git (an archive, a copy) the answer is
# `<root>/../tmp` as before. tools/lib/tmp-root.mjs is the same rule for node.
# A subshell body, so the caller keeps its own cwd and variables.
tmp_root() (
	g=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || g=
	case "$g" in
		/*/.git) p=${g%/.git} ;;
		*) p=$1 ;;
	esac
	CDPATH='' cd -- "$p/.." && printf '%s/tmp\n' "$PWD"
)

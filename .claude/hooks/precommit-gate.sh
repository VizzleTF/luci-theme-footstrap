#!/bin/sh
# PreToolUse/Bash: hold the changelog contract and the recorded-verdict rule on `git commit` mechanically.
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
# The second half asks (never denies) when the commit carries a path whose pre-push class needs a
# tester verdict (docs/crew.md "The card"): the package (`luci-theme-footstrap/**`, `install.sh`) wants
# a PASS entry in some ../tmp/task-*/card.json `history[]`, the guards (`.claude/hooks/**`,
# `.claude/settings.json`, `.githooks/**`, `.github/workflows/**`) want that entry to say
# `security: "CLEAN"` as well. ONE entry must hold every such path of the commit at once, by mode and
# blob: the tree that was tested is the combination, and an exec bit or a symlink is a change. Every
# other path passes: the tester reads it after the push.
#
# The third half asks when the commit weakens an oracle, "waiving a gate" being the maintainer's word and
# nothing else seeing a waiver in a diff: a line added under `tools/baselines/` (a `release: ` subject is exempt;
# a line is new under its enclosing `[`/`{` opener lines, so an entry copied or moved to another key asks, as
# tools/baselines/live-audit.json repeats 105 entries across its stand keys, and a reordering does not), a number
# raised in `LIMITS` of tools/css-metrics.mjs, a net drop of `test(` calls in a tests/*.test.mjs (a deleted file
# included), a literal added to an `ALLOW` list of a tools/*.mjs. It counts what grew and names the file; a lowering,
# a removal and tools/size-budget.mjs (its own grant) stay silent.
#
# `git commit --amend` is read against HEAD^ (a root commit: the empty tree), not HEAD: the commit is its
# parent plus the index, or plus the worktree under `-a` and paths.
#
# This is a tripwire for the habitual forms, not a fence against obfuscation, so what it cannot read it
# leaves silent: a commit run by an alias or a script, an option or path behind a quote or a `$`, a
# flag on a later line than `git commit` (a heredoc message), a `cd <dir>` or `git -C <dir>` ahead of
# `git commit <paths>` (the paths are read against the hook's own cwd), `--pathspec-from-file`, a
# `release: ` subject in a heredoc, a `-F` file or an amend without `-m` (read as no release), a deleted `LIMITS` key,
# a hex or expression `LIMITS` value, a backtick `ALLOW` entry, a baseline line that is the SOH sentinel of the oracle's
# own stream, a `release: ` subject on a commit that is no release, a baseline entry copied between the sibling
# objects of one array (they share a context), a baseline that is no JSON (its `[`/`{` line ends read as openers).
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

emit() { # $1 deny|ask, $2 why
	jq -n --arg d "$1" --arg r "$2" '{
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: $d,
			permissionDecisionReason: $r
		}
	}'
	exit 0
}
deny() { emit deny "$1"; }

# A backslash-newline pair is the shell's line continuation, so it is folded out first: /ship step 3 prints
# its recipe as `add … \<NL>  && git commit`, and a newline left in would read as a second command.
CMD=$(printf '%s' "$CMD" | sed -e ':a' -e '/\\$/{$!N;s/\\\n//;ta' -e '}') || ask "sed could not read the command"

# Names are read NUL-separated (`-z`): git quotes a `"`, a `\`, a tab or a newline in one, and a quoted name matches
# no class. Each NUL becomes a newline and each newline in a name `\001`, so one line is one path.
zl() { tr '\n\000' '\001\n'; }

# The index is what the commit holds, except under `-a`/`--all` (also inside a short cluster: `-qa`, `-am`) and
# `git commit [-o|-i] [--] <paths>`: those take their files from the worktree, and WTF lists them. The words after
# `commit` are read with the quoted text dropped, up to the first operator: a message saying "-a" once read as the
# flag and denied a commit holding none of the dirty files. A quoted word stands as `$Q`, which is no path.
# shortcut: `<paths>` (--only) is read as the index plus the paths, so it can ask over a staged file it leaves out
# and never stays silent over one it takes; upgrade if that ever costs a question.
BARE=$(printf '%s\n' "$CMD" | sed -e 's/"[^"]*"/$Q/g' -e "s/'[^']*'/\$Q/g") || ask "sed could not read the command"
ARGS=''
case $BARE in
	*[[:space:]]commit[[:space:]]*) ARGS=$(printf '%s\n' "${BARE#*[[:space:]]commit[[:space:]]}" | sed -e 's/[;&|<>].*//' -e 's/[[:space:]]#.*//' -e 1q) ;;
esac
ALLF=0
AMEND=0
CPATHS=''
skip=0
dd=0
set -f
for w in $ARGS; do
	if [ "$skip" = 1 ]; then skip=0; continue; fi # the argument of an option that takes one
	if [ "$dd" = 0 ]; then
		case $w in
			--) dd=1; continue ;;
			--all) ALLF=1; continue ;;
			--amend) AMEND=1; continue ;;
			--message|--file|--pathspec-from-file|--author|--date|--fixup|--squash|--trailer|--template|--cleanup|--reuse-message|--reedit-message) skip=1; continue ;;
			--*) continue ;;
			-?*)
				r=${w#-}
				while [ -n "$r" ]; do
					c=${r%"${r#?}"}
					r=${r#?}
					case $c in
						a) ALLF=1 ;;
						[mFCct]) [ -n "$r" ] || skip=1; break ;; # takes the rest of the word, or the next word
						[Su]) break ;; # an optional argument, attached
					esac
				done
				continue ;;
		esac
	fi
	case $w in *[!A-Za-z0-9_./@%+=,:*?-]*) ;; *) CPATHS="$CPATHS $w" ;; esac
done
set +f
# BASE: what the commit is diffed against. An amend carries its parent plus the index (the worktree under `-a`
# and paths), so HEAD^ and not HEAD, or a combination amended in is read as the one file that was added.
# Empty means the bare `git diff --cached`, which also reads a repository with no commit yet.
BASE=''
if [ "$AMEND" = 1 ]; then BASE=$(git rev-parse -q --verify 'HEAD^' 2>/dev/null) || BASE=$(git hash-object -t tree /dev/null 2>/dev/null) || BASE=''; fi
# WTF: the files whose content the commit takes from the worktree, not from the index. --no-renames
# lists the old name of a move too, which is a deletion the verdict half must see.
WTF=''
if [ "$ALLF" = 1 ]; then
	FILES=$(git diff --no-renames --name-only -z "${BASE:-HEAD}" 2>/dev/null | zl); WTF=$FILES
else
	FILES=$(git diff --no-renames --cached --name-only -z ${BASE:+"$BASE"} 2>/dev/null | zl)
	if [ -n "$CPATHS" ]; then
		set -f
		WTF=$(git diff --no-renames --name-only -z "${BASE:-HEAD}" -- $CPATHS 2>/dev/null | zl)
		set +f
		FILES=$(printf '%s\n%s\n' "$FILES" "$WTF")
	fi
fi

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
		ADDED=$(printf '%s\n%s\n' "$(git diff --no-renames --name-only -z -- $SPECS 2>/dev/null | zl)" "$(git ls-files -z --full-name -o --exclude-standard -- $SPECS 2>/dev/null | zl)")
		set +f
		FILES=$(printf '%s\n%s\n' "$FILES" "$ADDED")
		WTF=$(printf '%s\n%s\n' "$WTF" "$ADDED")
	fi
else
	# a git add before the commit that is not a clean chained segment: the index says nothing about what it stages
	case " $KINDS " in *' add '*) case ${CMD%%git commit*} in *add*) ask "a git add ahead of the commit is in a form it cannot read" ;; esac ;; esac
fi

FILES=$(printf '%s\n' "$FILES" | grep -v '^$' || true)
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
# from the root: the hook's cwd is the session's, and a subdirectory has no tools/changelog.mjs
if ! OUT=$(cd "$GIT_ROOT" && node tools/changelog.mjs 2>&1); then
	deny "node tools/changelog.mjs failed, so this commit would land a broken changelog: $OUT"
fi

# The oracle half. One stream per file: its text at BASE, a SPLIT line, its text in the commit; `mode` picks the
# count. The text is read with comments out and string literals whole, so a `//` or a quote in a comment or a
# string moves no count. shortcut: a reworded ALLOW reason reads as a new literal and asks; upgrade if it costs one.
cd "$GIT_ROOT" || exit 0 # the names are root-relative
ORACLE='^(tools/baselines/[A-Za-z0-9_./-]+|tools/[A-Za-z0-9_.-]+[.]mjs|tests/[A-Za-z0-9_.-]+[.]test[.]mjs)$'
# shellcheck disable=SC2016
ORACLE_AWK='
function strip(s,   o, i, c, d, q, lit) {
	o = ""; nl = 0
	for (i = 1; i <= length(s); i++) {
		c = substr(s, i, 1); d = substr(s, i, 2)
		if (blk) { if (d == "*/") { blk = 0; i++ } continue }
		if (d == "/*") { blk = 1; i++; continue }
		if (d == "//") break
		if (c == Q || c == D) {
			q = c; lit = c
			for (i++; i <= length(s); i++) {
				c = substr(s, i, 1); lit = lit c
				if (c == "\\") { i++; lit = lit substr(s, i, 1) } else if (c == q) break
			}
			L[++nl] = lit; o = o lit; continue
		}
		o = o c
	}
	return o
}
function grew(x, t) { if (!(x in was) && !(x in got)) { got[x] = 1; if (!ng++) first = t } }
BEGIN { Q = "\047"; D = "\042"; side = 0 }
$0 == "\001SPLIT" { side = 1; blk = 0; inb = 0; dp = 0; next }
mode == "count" { n[side] += gsub(/(^|[^[:alnum:]_$.])test\(/, "&"); next }
mode == "lines" {
	# a line is new under its path of enclosing `[`/`{` opener lines: the same entry copied under another key is a new waiver
	s = $0; sub(/^[[:space:]]+/, "", s); sub(/[[:space:],]+$/, "", s)
	if (s == "") next
	if (s ~ /^[]}]/ && dp > 0) dp--
	k = cx[dp]
	if (side) grew(k SUBSEP s, s); else was[k SUBSEP s] = 1
	if (s ~ /[[{]$/) cx[++dp] = k SUBSEP s
	next
}
mode == "limits" {
	s = strip($0)
	if (s ~ /LIMITS[[:space:]]*=[[:space:]]*\{/) { inb = 1; next }
	if (inb && s ~ /^[]}]/) inb = 0
	if (inb && match(s, /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*:[[:space:]]*[0-9][0-9_.]*/)) {
		t = substr(s, RSTART, RLENGTH); k = t; v = t
		sub(/[[:space:]]*:.*/, "", k); sub(/^[[:space:]]+/, "", k)
		sub(/^[^:]*:[[:space:]]*/, "", v); gsub(/_/, "", v)
		if (side) now[k] = v + 0; else lim[k] = v + 0
	}
	next
}
mode == "allow" {
	s = strip($0); start = 0
	if (!inb && s ~ /ALLOW[[:space:]]*=/) { inb = 1; start = 1 }
	if (!inb) next
	if (!start && s ~ /^[]})]/) { inb = 0; next }
	for (j = 1; j <= nl; j++) { if (side) grew(L[j], L[j]); else was[L[j]] = 1 }
	if (start && s ~ /;[[:space:]]*$/) inb = 0
}
END {
	if (mode == "count" && n[1] + 0 < n[0] + 0) print file " lost test( calls: " n[0] + 0 " -> " n[1] + 0
	if (mode == "lines" && ng) print file " gained " ng " line(s), first: " substr(first, 1, 70)
	if (mode == "allow" && ng) print file " ALLOW gained " ng " literal(s), first: " substr(first, 1, 70)
	if (mode == "limits") {
		for (k in now) if ((k in lim) && now[k] > lim[k]) r = r (r == "" ? "" : ", ") k " " lim[k] " -> " now[k]
		if (r != "") print file " LIMITS raised: " r
	}
}'
# the file as the commit leaves it (the worktree's under `-a`, a path or a chained add, else the index's), and as BASE has it
now_of() { if printf '%s\n' "$WTF" | grep -qxF -- "$1"; then cat -- "$1" 2>/dev/null || true; else git show ":$1" 2>/dev/null || true; fi; }
was_of() { git show "${BASE:-HEAD}:$1" 2>/dev/null || true; }
# the subject of the commit's first -m, `-qm` and `--message=` included: only a plain or quoted word after it is read
release_subject() {
	rest=$(printf '%s' "$CMD" | tr '\n' ' ' | awk '{ if (match($0, /[[:space:]]commit[[:space:]]/)) { s = substr($0, RSTART + RLENGTH); if (match(s, /(^|[[:space:]])(-[A-Za-z]*m|--message[= ])[[:space:]]*/)) print substr(s, RSTART + RLENGTH) } }') || return 1
	case $rest in release:\ *|\"release:\ *|\'release:\ *) return 0 ;; esac
	return 1
}
OQ=''
while IFS= read -r p; do
	[ -n "$p" ] || continue
	case $p in
		tools/baselines/*) release_subject && continue; mode=lines ;;
		tests/*) mode=count ;;
		tools/css-metrics.mjs) mode=limits ;;
		*) now_of "$p" | grep -q 'ALLOW[[:space:]]*=' || continue; mode=allow ;;
	esac
	m=$({ was_of "$p"; printf '\n\001SPLIT\n'; now_of "$p"; } | awk -v mode="$mode" -v file="$p" "$ORACLE_AWK") || m=''
	[ -z "$m" ] || OQ="$OQ$m; "
done <<EOF
$(printf '%s\n' "$FILES" | grep -E "$ORACLE" | sort -u || true)
EOF
[ -z "$OQ" ] || OQ="this commit weakens an oracle: ${OQ%; }. "
# an oracle find is a question whichever way the verdict half ends
quit() { [ -z "$OQ" ] || emit ask "precommit-gate: ${OQ}Waiving a gate is the maintainer's word: confirm this commit."; exit 0; }

# The verdict half. A path of a class the pre-push check cannot stand in for needs a tester verdict on
# the very content the commit carries: ONE PASS entry in some card's history[] whose tree holds every such
# path of the commit with the same mode and blob (a tree with A new and B old, and another with A old and
# B new, were never the combination the commit makes), and when a guard path is among them that entry says
# CLEAN too. A symlink is a mode of its own, so a file turned into one is a change. A deletion is covered by a
# tree that lacks the path and holds, in the nearest directory that survives the commit, exactly the policed
# files the commit leaves there: a tree from before the file existed lacks it too, and says nothing about
# the directory it lived in. It asks and never denies; whatever it cannot read leaves silent.
CLASS='^(luci-theme-footstrap/|install[.]sh$|[.]claude/hooks/|[.]claude/settings[.]json$|[.]githooks/|[.]github/workflows/)'
ROOTS='luci-theme-footstrap install.sh .claude/hooks .claude/settings.json .githooks .github/workflows'
CAND=$(printf '%s\n' "$FILES" | grep -E "$CLASS" | sort -u || true)
[ -n "$CAND" ] || quit

NL='
'
OLDIFS=$IFS
TAB=$(printf '\t')

# "<tree> <CLEAN|->" per PASS entry, the newest card and round first. A card that is not JSON stops jq for the
# cards behind it, so a failed run is repeated card by card; only a card that mentions "PASS" is read at all.
verdict_entries() {
	jq_f='try (.history | arrays | reverse | .[] | objects | select(.verdict == "PASS" and (.tree | type == "string" and test("^[0-9a-f]{40,64}$"))) | "\(.tree) \(.security // "-")")'
	# The cards are the main checkout's ../tmp from a linked worktree too (the git common dir is its .git). The rule of
	# tools/lib/tmp-root.sh, written out because this guard sources nothing from outside .claude/hooks: a file under
	# tools/ is no guard path, so sourcing one would let an edit of it decide which cards the verdict reads.
	common=$(git -C "$HOOK_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=
	case $common in /*/.git) cardroot=${common%/.git} ;; *) cardroot=$HOOK_ROOT ;; esac
	cards=$(grep -l '"PASS"' "$cardroot"/../tmp/task-*/card.json 2>/dev/null || true)
	[ -n "$cards" ] || return 0
	set -f
	IFS=$NL
	# shellcheck disable=SC2086
	set -- $cards
	cards=$(ls -t -- "$@" 2>/dev/null || true)
	[ -n "$cards" ] || { IFS=$OLDIFS; set +f; return 0; }
	# shellcheck disable=SC2086
	set -- $cards
	IFS=$OLDIFS
	set +f
	jq -r "$jq_f" "$@" 2>/dev/null && return 0
	for c in "$@"; do jq -r "$jq_f" "$c" 2>/dev/null || true; done
}
# $1 newline list, $2 newline list: the lines of the first that the second lacks
lacks() {
	while IFS= read -r l; do
		[ -z "$l" ] || case "$NL$2" in *"$NL$l$NL"*) ;; *) printf '%s\n' "$l" ;; esac
	done <<EOF
$1
EOF
}

NEEDS=''
PKGP=''
GRDP=''
DEL=0
while IFS= read -r k; do
	p=$(printf '%sx' "$k" | tr '\001' '\n'); p=${p%x} # the path as the filesystem has it
	# the "mode blob" the commit will carry at p: the worktree's for what `-a`, a path or a chained add takes, else
	# the index's; `-` is none. A symlink is asked before `-f`, which follows it and sees its target's bytes.
	if printf '%s\n' "$WTF" | grep -qxF -- "$k"; then
		if [ -L "$p" ]; then
			b=$(printf '%s' "$(readlink -- "$p")" | git hash-object --stdin 2>/dev/null) || continue
			b="120000 $b"
		elif [ -f "$p" ]; then
			b=$(git hash-object -- "$p" 2>/dev/null) || continue
			if [ -x "$p" ]; then b="100755 $b"; else b="100644 $b"; fi
		else
			b=-
		fi
	else
		b=$(git --literal-pathspecs ls-files -s -- "$p" 2>/dev/null | awk 'NR == 1 { print $1 " " $2 }') || continue
		[ -n "$b" ] || b=-
	fi
	[ "$b" != - ] || DEL=1
	case $k in
		luci-theme-footstrap/*|install.sh) PKGP="$PKGP$k$NL" ;;
		*) GRDP="$GRDP$k$NL" ;;
	esac
	NEEDS="${NEEDS}W$TAB$b$TAB$k$NL"
done <<EOF
$CAND
EOF
ALLP=$PKGP$GRDP
[ -n "$ALLP" ] || quit

HL=''
if [ "$DEL" = 1 ]; then
	# a deletion is judged on the whole policed tree: BASE's listing (HEAD^ under --amend) is what the commit changes, a tree's what it verified
	# shellcheck disable=SC2086
	HL=$(git ls-tree -r -z --full-tree "${BASE:-HEAD}" -- $ROOTS 2>/dev/null | zl | awk '{ print "H\t" $0 }')
fi
PASSED=''
CLEANED=''
COVERED=0
while read -r T S; do
	[ -n "$T" ] || continue
	git cat-file -e "$T^{tree}" 2>/dev/null || continue # a tree that is gone lists as empty, and an empty listing lacks every path
	# shellcheck disable=SC2086
	LS=$(git ls-tree -r -z --full-tree "$T" -- $ROOTS 2>/dev/null | zl)
	# the paths of NEEDS this tree holds with that mode and blob. One it lacks (blob `-`) counts only when the nearest
	# directory that survives the commit holds, among the policed files, exactly what the commit leaves there.
	# A record is `W|H|<tree line>`, a TAB, then the rest: a name may hold a TAB, so it is cut at the first one, not split.
	# `p in h` is asked before `h[p]` is read: awk makes an element of a key it only looks at.
	HIT=$(printf '%s\n%s\n%s\n' "$NEEDS" "$HL" "$LS" | awk '
		{
			i = index($0, "\t")
			if (!i) next
			head = substr($0, 1, i - 1); rest = substr($0, i + 1)
			if (head == "W" || head == "H") {
				j = index(rest, "\t")
				v = substr(rest, 1, j - 1); name = substr(rest, j + 1)
				if (head == "W") w[name] = v
				else { split(v, a, " "); hs[name] = a[1] " " a[3] }
				next
			}
			split(head, a, " ")
			if (a[2] == "blob") h[rest] = a[1] " " a[3]
		}
		END {
			for (p in hs) if (!(p in w)) c[p] = hs[p]
			for (p in w) if (w[p] != "-") c[p] = w[p]
			for (p in w) {
				if (w[p] != "-") { if ((p in h) && h[p] == w[p]) print p; continue }
				if (p in h) continue
				d = p
				while (1) {
					if (!sub(/\/[^\/]*$/, "", d)) { d = ""; break }
					pre = d "/"
					live = 0
					for (e in c) if (index(e, pre) == 1) { live = 1; break }
					if (live) break
				}
				pre = (d == "") ? "" : d "/"
				ok = 1
				for (e in c) if (index(e, pre) == 1 && !((e in h) && h[e] == c[e])) ok = 0
				for (e in h) if (index(e, pre) == 1 && !((e in c) && c[e] == h[e])) ok = 0
				if (ok) print p
			}
		}')
	PASSED="$PASSED$HIT$NL"
	[ "$S" != CLEAN ] || CLEANED="$CLEANED$HIT$NL"
	# newest first: the first entry that holds the whole commit (and is CLEAN when a guard path is in it) ends the scan,
	# so the common silent commit does not read the whole history
	if [ -z "$(lacks "$ALLP" "$HIT$NL")" ] && { [ -z "$GRDP" ] || [ "$S" = CLEAN ]; }; then COVERED=1; break; fi
done <<EOF
$(verdict_entries | awk '!seen[$0]++')
EOF
[ "$COVERED" = 0 ] || quit

# the paths some entry covers, so the question names what is missing; when every path has an entry and no entry has them all, the combination is
BADP=$(lacks "$PKGP" "$PASSED")
BADG=$(lacks "$GRDP" "$CLEANED")
MSG=''
[ -z "$BADP" ] || MSG="no recorded PASS on the content of $(printf '%s' "$BADP" | tr '\n' ' ') (package class). "
[ -z "$BADG" ] || MSG="${MSG}no recorded PASS with security CLEAN on the content of $(printf '%s' "$BADG" | tr '\n' ' ') (guard class). "
[ -n "$MSG" ] || MSG="no single history entry holds $(printf '%s' "$ALLP" | tr '\n' ' ')together${GRDP:+ with security CLEAN}, and the tree a tester passed is the combination. "
emit ask "precommit-gate: ${OQ}${MSG}Run the tester card (and security for a guard path) and record its entry in the card's history[], or confirm this commit."

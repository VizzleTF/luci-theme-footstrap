#!/bin/sh
# PreToolUse/Bash: a TRIPWIRE for the actions that need the maintainer's word, not a fence. Frozen: it
# catches the forms a session reaches for by habit and by mistake; it does not stop a determined bypass
# (a line built at run time, a file written then run). No server-side rule backs it.
#
# Commit and push are the agent's own and stay silent. Ask: a tag (create, move, delete, push, also
# --tags, --follow-tags or push.followTags set by `-c`, GIT_CONFIG_* or `git config`, refs/tags/*, a
# v<digit> refspec, update-ref), `gh release` writes, `gh api`
# writes to git/refs, git/tags or releases of the theme repo, `gh workflow run` in the theme repo (the
# owfeed dispatch is standing-authorized), a force push or delete of main/master, rebase and
# `commit --amend` while HEAD is already in origin/main, `reset --hard`, main or master moved or
# deleted locally (`checkout -B`, `switch -C`, `branch -f|-D|-m`, `update-ref`), and a push whose remote
# is not VizzleTF/luci-theme-footstrap: read with `git remote get-url --push` in the directory `cd`,
# `git -C`, `--git-dir` or GIT_DIR leaves, or taken from a remote or URL the same line sets.
# The whole line is read, quote-aware, plus the local scripts and nested shells it runs (three levels
# deep, at most 50 scripts and 200 nested texts, each script once). A shell is followed behind env,
# timeout, nice, nohup, xargs, sudo, doas, command, exec, tools/bg.sh, find -exec and `git bisect run`,
# and via `<<<`, `< file` or a heredoc body; the code of `python -c`, `node -e`, `perl -e`, `ruby -e` is
# read as a line. An alias is resolved first: `-c alias.*`, one set earlier in the line, or one in the
# repository config. The body of a heredoc fed to anything else (cat, git -F -, python) is data, except
# inside a `$( )` or backtick that a shell, eval or xargs runs (`sh -c "$(cat <<E ...)"`) and when a
# shell sits behind a `|` on its line (`cat <<E | sh`): that body is the code. A `{` or `}` ends a
# command only as a word of its own (`{ cmd; }`); inside a word it is gh's `{owner}/{repo}`.
# Denied: --no-verify (any unique prefix), -n on commit, `-c core.hooksPath`, `-c include.path` (an
# include reaches the command scope, which beats the repository's own hook path), `git config` writes
# of either, and GIT_CONFIG_KEY_n / GIT_CONFIG_PARAMETERS naming them. `--kinds` prints every kind
# found, the silent ones too (`commit`, `add`), so precommit-gate.sh shares this detection.
#
# Acts only on a positive find: a missing jq or awk, unreadable stdin, a script it cannot resolve,
# too deep or over the cap stay silent; `--kinds` exits 1 instead. A repository chosen with
# `--git-dir=$X` is a find (it cannot be placed); an unresolvable `cd "$X"` is not.
TAB=$(printf '\t')
KINDS=''
SRC=''
NSCRIPTS=0
NNEST=0
DONE='
'
MODE=${1:-}

emit() { # $1 decision, $2 reason (no quotes or backslashes: jq may be the thing that is missing)
	printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"
}

fail() { # $1 what broke
	if [ "$MODE" = "--kinds" ]; then
		echo "git-guard: $1" >&2
		exit 1
	fi
	exit 0
}

IN=$(cat) || fail "stdin unreadable"
# Raw JSON still holds the cwd, which may spell "git"; the part after the command key is what counts.
SRC=${IN#*\"command\"}
command -v jq >/dev/null 2>&1 || fail "jq not found"
command -v grep >/dev/null 2>&1 || fail "grep not found"
CMD=$(printf '%s' "$IN" | jq -r '.tool_input.command // ""') || fail "jq could not parse the input"
SRC=$CMD
CWD=$(printf '%s' "$IN" | jq -r '.cwd // ""') || fail "jq could not parse the input"
BASE=${CWD:-.}

# $1 base, $2 dir (after the line's cds), $3 path as written
rp() {
	case $3 in
		/*) printf '%s\n' "$3" ;;
		*) case $2 in /*) printf '%s/%s\n' "$2" "$3" ;; *) printf '%s/%s/%s\n' "$1" "$2" "$3" ;; esac ;;
	esac
}

# $1 file, $2 depth of the caller, $3 dir it runs in: each file once (by resolved path), 50 at most
scanfile() {
	[ -f "$1" ] || return 0
	R=$(CDPATH='' cd -- "$(dirname -- "$1")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "${1##*/}") || R=$1
	case "$DONE" in *"
$R
"*) return 0 ;; esac
	if [ "$NSCRIPTS" -ge 50 ]; then KINDS="$KINDS script-scan-cap"; return 0; fi
	NSCRIPTS=$((NSCRIPTS + 1))
	DONE="$DONE$R
"
	scan "$(head -c 200000 "$1")" $(($2 + 1)) "$3"
}

# The theme repo's own URL, anchored on the host and the whole path: a lookalike prefix, suffix or host is another repository.
MINE_RE='^((https?|git|ssh)://([^/@]+@)?github\.com(:[0-9]+)?/|[^/@:]+@github\.com:)vizzletf/luci-theme-footstrap(\.git)?/?$'
ismine() { printf '%s\n' "$1" | grep -qiE "$MINE_RE"; }
STX=$(printf '\001')

scan() { # $1 text, $2 depth, $3 dir the text runs in (as written, relative to BASE; ? = unknown), $4 = 1 when a substitution in it is code
	OUT=$(printf '%s\n' "$1" | START=$3 HC=${4:-0} MINE_RE=$MINE_RE awk '
	BEGIN {
		split("status diff log show add fetch branch checkout switch restore stash ls-files ls-remote rev-parse rev-list describe remote worktree blame grep clone init cat-file show-ref for-each-ref merge-base diff-tree shortlog reflog bisect cherry clean mv rm gc fsck notes submodule revert apply format-patch show-branch name-rev bundle archive help version commit push rebase reset cherry-pick am merge pull config tag update-ref", bi0, " ")
		for (i in bi0) bi[bi0[i]] = 1
	}
	# ~ and $HOME are the home directory, as the shell would make them
	function expand(a) {
		if (ENVIRON["HOME"] == "") return a
		if (a ~ /^~(\/|$)/) return ENVIRON["HOME"] substr(a, 2)
		if (a ~ /^\$HOME(\/|$)/) return ENVIRON["HOME"] substr(a, 6)
		if (a ~ /^\$\{HOME\}(\/|$)/) return ENVIRON["HOME"] substr(a, 8)
		return a
	}
	function joind(b, a) {
		a = expand(a)
		if (a == "" || a == "-" || a ~ /[$`~*?]/) return "?"
		if (a ~ /^\//) return a
		if (b == "?") return "?"
		return (b == ".") ? a : b "/" a
	}
	function chdir(a) { cwd = joind(cwd, a) }
	function enc(s) { gsub(/\n/, "\001", s); return s }
	function nest(s) { print "NEST\t" cwd "\t" enc(s) }
	# a text from a double-quoted token with a substitution that a shell, eval or xargs runs: a heredoc inside that substitution is code
	function nestc(s) { print "NESTC\t" cwd "\t" enc(s) }
	# a token that survives being put back into shell text
	function shq(s,   r, i) {
		gsub(/\t/, " ", s); r = ""
		while ((i = index(s, "\047")) > 0) { r = r substr(s, 1, i - 1) "\047\\\047\047"; s = substr(s, i + 1) }
		return "\047" r s "\047"
	}
	# the git call up to its subcommand (word and global options), and what follows the subcommand
	function apre(i0, j,   r, i) { r = ""; for (i = i0; i < j; i++) r = r (r == "" ? "" : " ") shq(t[i]); return r }
	function apost(j,   r, i) { r = " "; for (i = j + 1; i <= n; i++) r = r " " shq(t[i]); return r }
	function aliasrun(i0, j, v) { return (v ~ /^!/) ? substr(v, 2) apost(j) : apre(i0, j) " " v apost(j) }
	function mine(u) { return (tolower(u) ~ ENVIRON["MINE_RE"]) }
	# one `-c key=value` of a git call: an alias is kept, a remote or URL it sets is noted, follow-tags not switched off is a tag push; true when it is an include
	function cfg(cv, al_,   key, val, b) {
		key = tolower(cv); sub(/=.*/, "", key)
		val = (index(cv, "=") ? substr(cv, index(cv, "=") + 1) : "")
		# git reads a bare key as true and an empty value as false
		if (key == "push.followtags" && (!index(cv, "=") || tolower(val) !~ /^(false|no|off|0)?$/)) print "KIND\ttagpush"
		if (key ~ /^alias\./) al_[substr(key, 7)] = val
		if (key ~ /^remote\..*\.(url|pushurl)$/ && !mine(val)) rset = 1
		if (key ~ /^url\..*\.(push)?insteadof$/) { b = substr(key, 5); sub(/\.(push)?insteadof$/, "", b); if (!mine(b)) rset = 1 }
		return (key ~ /^include(if\..*)?\.path$/)
	}
	function script(p) {
		if (cwd == "?" || p ~ /[$`~*?]/) print "KIND\tunknown-script"
		else print "SCRIPT\t" cwd "\t" p
	}
	function isshell(x) { return (x ~ /(^|\/)(sh|bash|zsh|dash|ash|ksh)$/) }
	function isinterp(x) { return (x ~ /(^|\/)(python[0-9.]*|pypy[0-9.]*|node|nodejs|bun|perl|ruby|php)$/) }
	# code given to an interpreter: quotes, brackets and commas fold to blanks so a call like system("git", "tag") reads as the line it runs
	function interp(x) { gsub(/[][\042\047(),]/, " ", x); nest(x) }
	function interprun(i0,   k, a) {
		for (k = i0 + 1; k <= n; k++) {
			a = t[k]
			if (a ~ /^-[a-zA-Z]*[ceErp]$/ || a ~ /^--(eval|print)$/) { interp(t[k + 1]); k++ }
			else if (a ~ /^--(eval|print)=/) interp(substr(a, index(a, "=") + 1))
			else if (a ~ /^-[a-zA-Z]*[ceE]./) interp(a)
		}
	}
	# $1 index of the shell word: its -c text, `< file` or script operand is what runs
	function shellrun(i0,   k) {
		for (k = i0 + 1; k <= n; k++) {
			if (t[k] ~ /^-[a-z]*c$/) { nest(t[k + 1]); return }
			if (t[k] ~ /^<<</) return
			if (t[k] == "<") { script(t[k + 1]); return }
			if (t[k] ~ /^<./) { script(substr(t[k], 2)); return }
			if (t[k] !~ /^-/) { script(t[k]); return }
		}
	}
	function recv(   i) { # does a heredoc body fed to this segment run as shell?
		for (i = 1; i <= n; i++) if (isshell(t[i]) || t[i] ~ /(^|\/)(eval|source|xargs)$/ || t[i] == ".") return 1
		return 0
	}
	# index of the first non-flag word from j; a -R/--repo on the way leaves its value in ghr, since skipping the flag alone would make the repo name the verb
	function ghflags(j) {
		while (j <= n && t[j] ~ /^-/) {
			if (t[j] ~ /^(-R|--repo)$/) { ghr = t[j + 1]; j += 2 }
			else { if (t[j] ~ /^--repo=/) ghr = substr(t[j], 8); else if (t[j] ~ /^-R./) ghr = substr(t[j], 3); j++ }
		}
		return j
	}
	# gh release writes, gh api writes to refs/tags/releases of the theme repo, gh workflow run there
	function gh(i0,   j, k, a, v, m, hf, path, repo, lp, r0, sc) {
		ghr = ""
		j = ghflags(i0 + 1)
		v = t[j]; sc = j + 1
		# cobra takes -R/--repo after the group verb too (`gh release -R o/r create`)
		if (v == "release" || v == "workflow") sc = ghflags(sc)
		r0 = ghr
		if (v == "release") { if (t[sc] ~ /^(create|edit|delete|delete-asset|upload)$/) print "KIND\trelease" }
		else if (v == "workflow" && t[sc] == "run") {
			repo = r0
			for (k = sc + 1; k <= n; k++) {
				a = t[k]
				if (a == "-R" || a == "--repo") repo = t[k + 1]
				else if (a ~ /^--repo=/) repo = substr(a, 8)
				else if (a ~ /^-R./) repo = substr(a, 3)
			}
			if (repo == "" || tolower(repo) == "vizzletf/luci-theme-footstrap") print "KIND\trelease"
		} else if (v == "api") {
			m = ""; hf = 0; path = ""
			for (k = j + 1; k <= n; k++) {
				a = t[k]
				if (a == "-X" || a == "--method") { m = toupper(t[k + 1]); k++ }
				else if (a ~ /^--method=/) m = toupper(substr(a, 10))
				else if (a ~ /^-X./) m = toupper(substr(a, 3))
				else if (a ~ /^(-f|-F|--field|--raw-field|--input)$/) { hf = 1; k++ }
				else if (a ~ /^-[fF]./ || a ~ /^--(field|raw-field|input)=/) hf = 1
				else if (a ~ /^(-H|--header|-q|--jq|-t|--template|--hostname|--cache|--preview|-p)$/) k++
				else if (a !~ /^-/ && path == "") path = a
			}
			lp = tolower(path)
			if ((m ~ /^(POST|PATCH|PUT|DELETE)$/ || (m == "" && hf)) && lp ~ /(git\/refs|git\/tags|releases)/ \
				&& !(lp ~ /repos\/[^\/{]+\/[^\/]+/ && lp !~ /vizzletf\/luci-theme-footstrap/)) print "KIND\trelease"
		}
	}
	function endtok() { if (have) { n++; t[n] = tok } tok = ""; have = 0 }
	# prev is the separator before the current segment: a shell after a `|` reads what the pipe carries, a heredoc body included
	function endseg() { endtok(); if (n) { if (prev == "|" && recv()) pipesh = 1; proc() } n = 0; split("", sub_) }
	function proc(   s, i, j, k, x, w, a, sb, deny, hp, rb, hard, ch, nm, ro, kk, wr, wrp, pf, ia, alk, rk, uk, b, np, pos, na, tl, tg, fo, fm, fc, am, ref, tgt, gd, gdir, dd, cv, lal, rep, df, mv, fr, fb, fl, rc) {
		s = 1
		while (s <= n && t[s] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) s++
		w = (s <= n) ? t[s] : ""
		if (w !~ /^(echo|printf)$/)
			for (i = 1; i <= n; i++) {
				x = tolower(t[i])
				if (x ~ /^git_config_(key_[0-9]+|parameters)=/) {
					# an include reaches the command scope, which beats the repository config and its hook path
					if (x ~ /core\.hookspath|include(if\.[^=]*)?\.path/) print "KIND\tnoverify"
					if (x ~ /^git_config_key_[0-9]+=(url|remote)\.|^git_config_parameters=.*(url|remote)\./) rset = 1
					# named at all is a find whatever its value: GIT_CONFIG_VALUE_n is another word
					if (x ~ /^git_config_key_[0-9]+=push\.followtags$|^git_config_parameters=.*push\.followtags/) print "KIND\ttagpush"
				}
				if (t[i] ~ /^GIT_DIR=/ && (s > n || w == "export")) gdirenv = joind(cwd, substr(t[i], 9))
			}
		if (s > n) return
		if (w == "cd" || w == "pushd") { chdir(t[s + 1] == "--" ? t[s + 2] : t[s + 1]); return }
		rc = recv()
		for (i = 1; i <= n; i++) if (sub_[i]) { if (rc) nestc(t[i]); else nest(t[i]) }
		if (w ~ /^(echo|printf)$/) return
		for (i = s; i <= n; i++) {
			if (t[i] == "<<<") nest(t[i + 1])
			else if (t[i] ~ /^<<<./) nest(substr(t[i], 4))
		}
		wrp = (w ~ /(^|\/)(env|timeout|nice|nohup|xargs|sudo|doas|command|exec|find|setsid|stdbuf|ionice|bg\.sh)$/ || w ~ /(^|\/)git(\.exe)?$/)
		if (w == "eval") {
			a = ""; for (i = s + 1; i <= n; i++) a = a " " t[i]
			nest(a)
		} else if (isshell(w) || w == "source" || w == ".") {
			shellrun(s)
		} else if (wrp) {
			wr = (w !~ /(^|\/)git(\.exe)?$/)
			for (i = s + 1; i <= n; i++) if (t[i] == "bisect") wr = 1
			if (wr) for (i = s + 1; i <= n; i++) if (isshell(t[i])) { shellrun(i); break }
		} else if (!isinterp(w) && w ~ /\//) script(w)
		for (i = s; i <= n; i++) if (isinterp(t[i]) && (i == s || wrp)) { interprun(i); break }
		for (i = 1; i <= n; i++) if (t[i] ~ /(^|\/)gh(\.exe)?$/) gh(i)
		for (i = 1; i <= n; i++) {
			if (t[i] !~ /(^|\/)git(\.exe)?$/) continue
			j = i + 1; hp = 0; gd = cwd; gdir = gdirenv; split("", lal)
			for (x = 1; x < i; x++) if (t[x] ~ /^GIT_DIR=/) gdir = joind(cwd, substr(t[x], 9))
			while (j <= n && t[j] ~ /^-/) {
				if (tolower(t[j] " " t[j + 1]) ~ /core\.hookspath/) hp = 1
				cv = ""
				if (t[j] == "-C") gd = joind(gd, t[j + 1])
				else if (t[j] == "--git-dir") gdir = joind(gd, t[j + 1])
				else if (t[j] ~ /^--git-dir=/) gdir = joind(gd, substr(t[j], 11))
				else if (t[j] == "-c") cv = t[j + 1]
				else if (t[j] ~ /^-c./) cv = substr(t[j], 3)
				if (cv != "" && cfg(cv, lal)) hp = 1
				j += (t[j] ~ /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/) ? 2 : 1
			}
			sb = t[j]
			if (sb == "") continue
			if (!(sb in bi)) {
				# a name git does not know is an alias, set on this line, in this call or in the config on disk (git ignores one that shadows a built-in)
				x = tolower(sb)
				if (x in lal) nest(aliasrun(i, j, lal[x]))
				else if (x in al) nest(aliasrun(i, j, al[x]))
				else if (sb ~ /^[A-Za-z0-9][A-Za-z0-9_.-]*$/) print "ALIAS\t" cwd "\t" gd "\t" (gdir == "" ? "-" : gdir) "\t" x "\t" enc(apre(i, j)) "\t" enc(apost(j))
				continue
			}
			if (sb !~ /^(commit|push|rebase|reset|cherry-pick|am|merge|pull|config|tag|update-ref|remote|branch|checkout|switch|add)$/) continue
			deny = hp; rb = 0; hard = 0; ro = 0; kk = 0; pf = 0; ia = 0; alk = 0; rk = 0; uk = 0; np = 0; na = 0; tl = 0; tg = 0; fo = 0; fm = 0; fc = 0; am = 0; dd = 0; rep = ""; df = 0; mv = 0; fr = 0; fb = 0; fl = 0
			split("", pos)
			for (k = j + 1; k <= n; k++) {
				a = t[k]
				na++
				if (sb == "config") {
					a = tolower(a)
					if (a == "core.hookspath") kk = k
					else if (a == "push.followtags") pf = k
					else if (a ~ /^include(if\..*)?\.path$/) ia = k
					else if (a ~ /^alias\./) alk = k
					else if (a ~ /^remote\..*\.(url|pushurl)$/) rk = k
					else if (a ~ /^url\..*\.(push)?insteadof$/) uk = k
					else if (a ~ /^(--unset(-all)?|--get(-all|-regexp|-urlmatch)?|--list|-l|unset|get|list)$/) ro = 1
					continue
				}
				if (a ~ /refs\/tags\//) tg = 1
				# after `--` every word is a path or a refspec, never an option
				if (dd) { np++; pos[np] = a; continue }
				if (a == "--") { dd = 1; continue }
				if (a ~ /^--no-v/ && index("--no-verify", a) == 1) deny = 1
				if (a !~ /^-/) { np++; pos[np] = a }
				if (a ~ /^(-l|--list|-v|--verify|--contains|--no-contains|--points-at|--merged|--no-merged)$/ || a ~ /^--(contains|no-contains|points-at|merged|no-merged|list)=/) tl = 1
				if (sb == "push") {
					if (a ~ /^--force/ || a == "--delete") fo = 1
					if (a == "--tags" || a == "--mirror" || a ~ /^--follow-tags(=|$)/) tg = 1
					if (a ~ /^--repo=/) rep = substr(a, 8)
				}
				if (sb == "commit" && length(a) >= 4 && index("--amend", a) == 1) am = 1
				if (sb == "branch") {
					if (a == "--delete") df = 1
					else if (a == "--move") mv = 1
					else if (a == "--force") fr = 1
				}
				if (sb == "switch" && a == "--force-create") fb = 1
				nm = a; sub(/=.*/, "", nm)
				if (length(nm) >= 5 && index("--rebase", nm) == 1) rb = 1
				if (length(nm) >= 3 && index("--hard", nm) == 1) hard = 1
				if (a == "-r") rb = 1
				if (a ~ /^-[a-zA-Z]+$/) {
					# a cluster ends at the first flag that takes a value; the rest is that value
					for (x = 2; x <= length(a); x++) {
						ch = substr(a, x, 1)
						if ((ch ~ /[mFcC]/ && sb !~ /^(branch|checkout|switch)$/) || (sb == "push" && ch == "o")) { if (x == length(a)) k++; break }
						if (ch == "n" && sb == "commit") deny = 1
						if ((ch == "f" || ch == "d") && sb == "push") fo = 1
						if (sb == "branch") { if (ch ~ /[dD]/) df = 1; if (ch ~ /[mM]/) mv = 1; if (ch == "f") fr = 1 }
						if ((sb == "checkout" && ch == "B") || (sb == "switch" && ch == "C")) fb = 1
					}
				} else if (a ~ /^--(message|file)$/ || (sb == "push" && a ~ /^--(push-option|receive-pack|exec|repo)$/)) {
					if (sb == "push" && a == "--repo") rep = t[k + 1]
					k++
				}
			}
			if (sb == "config") {
				if (kk && !ro && (kk < n || t[j + 1] ~ /^(set|--add|--replace-all)$/)) print "KIND\tnoverify"
				if (ia && !ro && ia < n) print "KIND\tnoverify"
				if (pf && !ro && (pf < n || t[j + 1] ~ /^(set|--add|--replace-all)$/)) print "KIND\ttagpush"
				if (alk && !ro && alk < n) al[substr(tolower(t[alk]), 7)] = t[alk + 1]
				if (rk && !ro && rk < n && !mine(t[rk + 1])) rset = 1
				if (uk && !ro && uk < n) { b = substr(tolower(t[uk]), 5); sub(/\.(push)?insteadof$/, "", b); if (!mine(b)) rset = 1 }
				continue
			}
			if (sb == "tag") { if (na && !tl) print "KIND\ttag"; continue }
			if (sb == "update-ref") { if (tg) print "KIND\ttagpush"; if (pos[1] ~ /^(refs\/heads\/)?(main|master)$/) print "KIND\tmainmove"; continue }
			if (sb == "remote") { if (pos[1] ~ /^(add|set-url)$/ && np >= 3 && !mine(pos[3])) rset = 1; continue }
			# a branch force-moved, deleted or renamed: main by name; `branch -f name start` names only its first word
			if (sb == "checkout" || sb == "switch") { if (fb && pos[1] ~ /^(refs\/heads\/)?(main|master)$/) print "KIND\tmainmove"; continue }
			if (sb == "branch") {
				if (df || mv) { for (x = 1; x <= np; x++) if (pos[x] ~ /^(refs\/heads\/)?(main|master)$/) fl = 1 }
				else if (fr && pos[1] ~ /^(refs\/heads\/)?(main|master)$/) fl = 1
				if (fl) print "KIND\tmainmove"
				continue
			}
			if (deny) print "KIND\tnoverify"
			if (sb == "push") {
				# pos[1] is the remote, the rest are refspecs; a `+` forces that one and a leading `:` deletes it
				for (x = 2; x <= np; x++) {
					ref = pos[x]
					if (ref == "tag" || ref ~ /(^|[:+])(refs\/tags\/|v[0-9])/) tg = 1
					if (ref ~ /^[+:]/) fo = 1
					tgt = ref; sub(/^\+/, "", tgt); sub(/^[^:]*:/, "", tgt); sub(/^refs\/heads\//, "", tgt)
					if (tgt ~ /^(main|master)$/) fm = 1
					else if (tgt == "" || tgt == "HEAD") fc = 1
				}
				if (np < 2) fc = 1
				if (tg) print "KIND\ttagpush"
				if (fo && fm) print "KIND\trewrite"
				else if (fo && fc) print "KIND\tforcecur"
				haspush = 1
				# a repository picked at run time is a push nobody can place; one this scan can read is checked on disk
				if (gdir == "?") print "KIND\tforkpush"
				else print "PUSH\t" gd "\t" (gdir == "" ? "-" : gdir) "\t" (np ? pos[1] : "origin")
				if (rep != "") print "PUSH\t" gd "\t-\t" rep
			}
			if (sb == "rebase" || am) print "KIND\thistcheck"
			if (sb == "reset") { if (hard) { print "KIND\treset-hard"; print "KIND\trewrite" } }
			else if (sb == "pull") { if (rb) print "KIND\tpull-rebase" }
			else print "KIND\t" sb
		}
	}
	{ S = S $0 "\n" }
	END {
		cwd = ENVIRON["START"]
		L = length(S)
		for (p = 1; p <= L; p++) {
			c = substr(S, p, 1)
			if (q == "\047") { if (c == "\047") q = ""; else tok = tok c; continue }
			if (q == "\"") {
				if (c == "\\") { tok = tok substr(S, p + 1, 1); p++; continue }
				if (c == "\"") { q = ""; continue }
				if (c == "`" || (c == "$" && substr(S, p + 1, 1) == "(")) sub_[n + 1] = 1
				tok = tok c; continue
			}
			if (c == "\\") {
				if (substr(S, p + 1, 1) != "\n") { tok = tok substr(S, p + 1, 1); have = 1 }
				p++; continue
			}
			if (c == "\047" || c == "\"") { q = c; have = 1; continue }
			if (c == "<" && substr(S, p + 1, 1) == "<" && substr(S, p + 2, 1) != "<" && substr(S, p - 1, 1) != "<") {
				# heredoc: the body runs only when a shell reads it; otherwise it is data and is skipped
				endtok(); hsh = (recv() || (sd != 0 && sc)); pipesh = 0; strip = 0; dl = ""; p += 2
				if (substr(S, p, 1) == "-") { strip = 1; p++ }
				while (substr(S, p, 1) == " " || substr(S, p, 1) == "\t") p++
				while (p <= L) {
					ch2 = substr(S, p, 1)
					if (ch2 ~ /[ \t\n;&|()<>]/) break
					if (ch2 == "\047" || ch2 == "\"" || ch2 == "\\") { p++; continue }
					dl = dl ch2; p++
				}
				p--
				if (dl != "") pend = 1
				continue
			}
			if (pend && c == "\n") {
				endseg(); prev = ""; pend = 0; body = ""; p++
				while (p <= L) {
					e = index(substr(S, p), "\n"); ln = (e ? substr(S, p, e - 1) : substr(S, p))
					p += (e ? e : length(ln) + 1)
					chk = ln; if (strip) sub(/^\t+/, "", chk)
					if (chk == dl) break
					body = body ln "\n"
				}
				p--
				if (hsh || pipesh) nest(body)
				pipesh = 0
				continue
			}
			if (c == "#" && !have) { while (p < L && substr(S, p + 1, 1) != "\n") p++; continue }
			if (c == " " || c == "\t") { endtok(); continue }
			# a substitution opened where a shell, eval or xargs reads it (or in a text nestc sent): the heredoc body inside it is code
			if (c == "(" && substr(S, p - 1, 1) == "$" && sd == 0) { sd = 1; sc = (recv() || ENVIRON["HC"] == 1) }
			else if (c == "(" && sd > 0) sd++
			else if (c == ")" && sd > 0) sd--
			else if (c == "`") { if (sd < 0) sd = 0; else if (sd == 0) { sd = -1; sc = (recv() || ENVIRON["HC"] == 1) } }
			# a brace is the word of a group ({ cmd; }); inside a word it is the {owner}/{repo} of gh or a brace expansion
			if ((c == "{" || c == "}") && !have && substr(S, p + 1, 1) ~ /[ \t\n;&|()<>]/) { endseg(); prev = c; continue }
			if (c ~ /[;&|()`\n]/) { endseg(); prev = c; continue }
			tok = tok c; have = 1
		}
		endseg()
		# a remote or URL this line sets is never on disk when the hook reads it
		if (rset && haspush) print "KIND\tforkpush"
	}') || fail "awk failed"
	while IFS=$TAB read -r K REST; do
		if [ "$K" = ALIAS ]; then
			# REST = dir, dir after -C, git dir, alias name, text before the name, text after it
			AC=${REST%%"$TAB"*}; REST=${REST#*"$TAB"}
			AD=${REST%%"$TAB"*}; REST=${REST#*"$TAB"}
			AG=${REST%%"$TAB"*}; REST=${REST#*"$TAB"}
			AN=${REST%%"$TAB"*}; REST=${REST#*"$TAB"}
			AP=${REST%%"$TAB"*}; AQ=${REST#*"$TAB"}
			[ "$AD" = "?" ] && continue
			if [ "$AG" = - ]; then AV=$(git -C "$(rp "$BASE" "$AD" .)" config --get "alias.$AN" 2>/dev/null) || continue
			else AV=$(git --git-dir="$(rp "$BASE" . "$AG")" config --get "alias.$AN" 2>/dev/null) || continue; fi
			[ -n "$AV" ] || continue
			case $AV in '!'*) AV=${AV#!}$AQ ;; *) AV="$AP $AV$AQ" ;; esac
			K=NEST; REST="$AC$TAB$AV"
		fi
		case $K in
			KIND) KINDS="$KINDS $REST" ;;
			PUSH)
				# REST = dir, git dir, remote; an unresolvable dir or remote is no find
				D=${REST%%"$TAB"*}
				P=${REST#*"$TAB"}
				G=${P%%"$TAB"*}
				P=${P#*"$TAB"}
				[ "$D" = "?" ] && continue
				case $P in
					*/*|*:*) PU=$P ;;
					*) if [ "$G" = - ]; then PU=$(git -C "$(rp "$BASE" "$D" .)" remote get-url --push "$P" 2>/dev/null) || continue
					   else PU=$(git --git-dir="$(rp "$BASE" . "$G")" remote get-url --push "$P" 2>/dev/null) || continue; fi ;;
				esac
				[ -z "$PU" ] || ismine "$PU" || KINDS="$KINDS forkpush" ;;
			NEST|NESTC|SCRIPT)
				if [ "$2" -ge 3 ]; then KINDS="$KINDS script-too-deep"; continue; fi
				D=${REST%%"$TAB"*}
				P=${REST#*"$TAB"}
				if [ "$K" != SCRIPT ]; then
					NNEST=$((NNEST + 1))
					if [ "$NNEST" -gt 200 ]; then KINDS="$KINDS script-scan-cap"; continue; fi
					P=$(printf '%s' "$P" | tr "$STX" '\n')
					if [ "$K" = NESTC ]; then scan "$P" $(($2 + 1)) "$D" 1; else scan "$P" $(($2 + 1)) "$D"; fi
					continue
				fi
				F1=$(rp "$BASE" "$D" "$P")
				F2=$(rp "$BASE" "$3" "$P")
				# a script runs in its caller's directory, not its own, and its own cds are tracked from there
				# the plain path too: `(cd a && x); sh p.sh` leaves the cd behind in a subshell
				scanfile "$F1" "$2" "$D"
				[ "$F2" != "$F1" ] && scanfile "$F2" "$2" "$3"
				: ;;
		esac
	done <<EOF
$OUT
EOF
}

scan "$CMD" 0 .

U=''
for k in $KINDS; do
	case " $U " in *" $k "*) ;; *) U="$U $k" ;; esac
done
KINDS=${U# }

if [ "$MODE" = "--kinds" ]; then
	printf '%s\n' "$KINDS"
	exit 0
fi

# Only the kinds that need the maintainer's word act; commit, push and the rest stay silent. A script
# it could not follow is not a find either. HEAD is read in the hook's own cwd (`git -C` is not
# followed); a git failure there leaves the kind silent.
U=''
for k in $KINDS; do
	case $k in
		noverify|tag|tagpush|release|rewrite|reset-hard|forkpush|mainmove) U="$U $k" ;;
		histcheck) git -C "$BASE" merge-base --is-ancestor HEAD origin/main >/dev/null 2>&1 && U="$U rewrite" ;;
		forcecur) case $(git -C "$BASE" symbolic-ref --short -q HEAD 2>/dev/null) in main|master) U="$U rewrite" ;; esac ;;
	esac
done
KINDS=${U# }
[ -n "$KINDS" ] || exit 0

case " $KINDS " in
	*' noverify '*)
		emit deny "Hook skipping (--no-verify, -n on commit, core.hooksPath, an included config file) is never allowed; fix what the hook reports instead." ;;
	*)
		emit ask "git/gh $KINDS found in this command (possibly inside a script it runs): a tag, a release, a push outside the theme repo or a rewrite or move of main needs the maintainer's word. Run /release for a tag; for a rewrite, name the commits." ;;
esac

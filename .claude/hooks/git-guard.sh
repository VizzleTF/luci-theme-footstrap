#!/bin/sh
# PreToolUse/Bash: a TRIPWIRE for the actions that need the maintainer's word, not a fence. Frozen: it
# catches the forms a session reaches for by habit and by mistake; it does not stop a determined bypass
# (a line built at run time, a file written then run). No server-side rule backs it.
#
# Commit and push are the agent's own and stay silent. Ask: a tag (create, move, delete, push, also
# --tags, --follow-tags or push.followTags set by `-c`, GIT_CONFIG_* or `git config`, refs/tags/*, a
# v<digit> refspec, update-ref), `gh workflow run` that deploys Pages (pages.yml, or -f publish-pages=true), `gh release` writes, `gh api`
# writes to git/refs, git/tags or releases of the theme repo, `gh pr|issue|discussion comment` and `gh pr review`
# on any repo and a close or reopen that carries --comment (kind publish), `gh pr|issue|discussion
# create|new|edit|close|reopen` and `gh pr revert` aimed at another repo: -R, --repo, a github.com PR or issue URL,
# GH_REPO=, or with none of those a remote of the directory it runs in that is not the theme repo; a target that
# cannot be read is no find. Also a force push or delete of main/master, rebase and
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
# shell sits behind a `|` on its line (`cat <<E | sh`): that body is the code. Under an unquoted
# delimiter the shell also runs the `$( )` and backticks of the body, so those are scanned. Inside a
# "…" token a heredoc counts only in the first `$(` of that span (a backtick closes at the next
# backtick, whatever a heredoc says), `"$(cat <<E` with the delimiter ending its line; any other
# `<<` there is text. A `"` inside a `$( )` opens a string of its own and the substitution ends at
# its matching `)`; a `<<` that cannot be copied whole gives that count up, the next `"` ends the
# token. A `{` or `}` ends a command only as a word of its own (`{ cmd; }`); inside a word it is
# gh's `{owner}/{repo}`.
# Denied: --no-verify (any unique prefix), -n on commit, `-c core.hooksPath`, `-c include.path` (an
# include reaches the command scope, which beats the repository's own hook path), `git config` writes
# of either, and GIT_CONFIG_KEY_n / GIT_CONFIG_PARAMETERS naming them. `--kinds` prints every kind
# found, the silent ones too (`commit`, `add`), so precommit-gate.sh shares this detection.
#
# A crew role (hook input `agent_type`: developer, tester, security, researcher, upstream-reviewer) is
# also denied, in the checkout this hook ships in, what rewrites its worktree, index or config outside the
# developer's round snapshot (kind `rolegit`): a `checkout` of paths (after `--`, a word that starts with
# `.` or `:` or holds a glob, two words, `-f`, `-p`, or one word that is no branch), `switch -f`, `restore`
# (--staged too), `clean`, `stash` but list|show|create, `reset`, `checkout-index`, `read-tree`, `add`, `rm`,
# `mv`, `remote add|remove|rm|rename|set-url|set-head|set-branches`, `config` writes. `-n`/`--dry-run`
# passes; `add`, `rm --cached` and `read-tree` pass behind GIT_INDEX_FILE=, which counts as a prefix of
# the command (or behind env) or an `export`, never as a bare assignment: that is a shell variable git
# does not see, and GIT_DIR is read the same way. Measured 2026-10-21: three roles ran real git in the
# lead's checkout, one of them `cd $R && git checkout -q -- .` with R empty, which reverted three tracked
# files. The directory is read as for a push (cd, -C, --git-dir, GIT_DIR; an empty `cd` or `-C` operand
# stays put); worktree and index verbs compare git dirs and remote and config verbs the common dir, so a
# `git worktree add` of this checkout is free to work in. A scratch repo, the lead and any other
# agent_type are untouched; a `cd "$X"` it cannot place is no find.
#
# Acts only on a positive find: a missing jq or awk, unreadable stdin, a script it cannot resolve,
# too deep or over the cap stay silent; `--kinds` exits 1 instead. A repository chosen with
# `--git-dir=$X` is a find (it cannot be placed); an unresolvable `cd "$X"` is not.
TAB=$(printf '\t')
NL='
'
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
AT=$(printf '%s' "$IN" | jq -r '.agent_type // ""') || fail "jq could not parse the input"
case $AT in developer|tester|security|researcher|upstream-reviewer) ROLE=1 ;; *) ROLE='' ;; esac
RWHY=''
MYGD=''

# $1 base, $2 dir (after the line's cds), $3 path as written
rp() {
	case $3 in
		/*) printf '%s\n' "$3" ;;
		*) case $2 in /*) printf '%s/%s\n' "$2" "$3" ;; *) printf '%s/%s/%s\n' "$1" "$2" "$3" ;; esac ;;
	esac
}

# git in the directory (D) or git dir (G) of the record being judged, relative to BASE
rgit() { if [ "$G" = - ]; then git -C "$(rp "$BASE" "$D" .)" "$@"; else git --git-dir="$(rp "$BASE" . "$G")" "$@"; fi; }

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

scan() { # $1 text, $2 depth, $3 dir the text runs in (as written, relative to BASE; ? = unknown), $4 = 1 when a substitution in it is code, $5 = 1 for the body of an unquoted heredoc (its substitutions are the code)
	OUT=$(printf '%s\n' "$1" | START=$3 HC=${4:-0} HB=${5:-0} MINE_RE=$MINE_RE ROLE=$ROLE awk '
	BEGIN {
		split("status diff log show add fetch branch checkout switch restore stash ls-files ls-remote rev-parse rev-list describe remote worktree blame grep clone init cat-file show-ref for-each-ref merge-base diff-tree shortlog reflog bisect cherry clean mv rm gc fsck notes submodule revert apply format-patch show-branch name-rev bundle archive help version commit push rebase reset cherry-pick am merge pull config tag update-ref checkout-index read-tree", bi0, " ")
		for (i in bi0) bi[bi0[i]] = 1
		role = (ENVIRON["ROLE"] == 1)
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
	# the body of a heredoc whose delimiter is unquoted: the shell expands it like a double-quoted text; the blank keeps substr(S, p - 1, 1) off the first character, where awk gives the character itself
	function nestb(s) { print "NESTB\t" cwd "\t" enc(" " s) }
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
	function ghmine(r) { return (tolower(r) ~ /^((https?:\/\/)?github\.com\/)?vizzletf\/luci-theme-footstrap(\.git)?\/?$/) }
	# gh release writes, gh api writes to refs/tags/releases of the theme repo, gh pr, issue and discussion publications
	function gh(i0,   j, k, x, a, v, m, hf, path, lp, sc, wf, vb, oth, cm, envr, u) {
		ghr = ""
		j = ghflags(i0 + 1)
		v = t[j]; sc = j + 1
		# cobra takes -R/--repo after the group verb too (`gh release -R o/r create`)
		if (v == "release") sc = ghflags(sc)
		if (v == "workflow") {
			sc = ghflags(sc)
			if (t[sc] == "run") {
				wf = ""; pg = 0
				for (k = sc + 1; k <= n; k++) {
					a = t[k]
					if (a ~ /^(-r|--ref|--json)$/) k++
					else if (a ~ /^(-[fF]|--field|--raw-field)$/) { if (tolower(t[k + 1]) ~ /^publish-pages=(true|1)$/) pg = 1; k++ }
					else if (a ~ /^(-[fF].|--field=|--raw-field=)/) { if (tolower(a) ~ /publish-pages=(true|1)$/) pg = 1 }
					else if (a ~ /^(-R|--repo)$/) { ghr = t[k + 1]; k++ }
					else if (a ~ /^--repo=/) ghr = substr(a, 8)
					else if (a ~ /^-R./) ghr = substr(a, 3)
					else if (a !~ /^-/ && wf == "") wf = tolower(a)
				}
				if ((pg || wf ~ /^pages(\.ya?ml)?$/) && (ghr == "" || tolower(ghr) ~ /vizzletf\/luci-theme-footstrap/)) print "KIND\tpages"
			}
		}
		if (v == "pr" || v == "issue" || v == "discussion") {
			# a comment or review is a publication anywhere; a write only when aimed at another repo ($X or {repo} is no find)
			# shortcut: a bare PR URL given as a flag value also reads as the target, so it prompts; upgrade if that nags
			sc = ghflags(sc); vb = t[sc]; oth = 0; cm = 0
			for (k = sc + 1; k <= n; k++) {
				a = t[k]
				if (a ~ /^(-R|--repo)$/) { ghr = t[k + 1]; k++ }
				else if (a ~ /^--repo=/) ghr = substr(a, 8)
				else if (a ~ /^-R./) ghr = substr(a, 3)
				else if (a ~ /^(-c|--comment)$/) { cm = 1; k++ }
				else if (a ~ /^(--comment=|-c.)/) cm = 1
				else { u = tolower(a); if (u ~ /^https?:\/\/github\.com\/[^\/]+\/[^\/]+\/(pull|issues)\// && u !~ /^https?:\/\/github\.com\/vizzletf\/luci-theme-footstrap\//) oth = 1 }
			}
			# -R beats GH_REPO (a prefix of this command, or an earlier export), which beats the repository of the directory
			for (x = 1; x < i0; x++) if (t[x] ~ /^GH_REPO=./) envr = substr(t[x], 9)
			if (ghr == "") ghr = (envr != "") ? envr : ghenv
			if (vb ~ /^(comment|review)$/ || (vb ~ /^(close|reopen)$/ && cm)) print "KIND\tpublish"
			else if (vb ~ /^(create|new|edit|close|reopen|revert)$/) {
				if (oth) print "KIND\tpublish"
				else if (ghr != "") { if (ghr !~ /[${`]/ && !ghmine(ghr)) print "KIND\tpublish" }
				else print "GHDIR\t" cwd "\t" (gdirenv == "" ? "-" : gdirenv)
			}
		}
		if (v == "release") { if (t[sc] ~ /^(create|edit|delete|delete-asset|upload)$/) print "KIND\trelease" }
		else if (v == "api") {
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
	# t is cleared too: a word left in it past n would be read as a verb of the next segment (`echo a create; gh release`)
	function endseg() { endtok(); if (n) { if (prev == "|" && recv()) pipesh = 1; proc() } n = 0; split("", t); split("", sub_) }
	# the `<<[-]WORD` that starts at p: returns WORD without its quotes, sets hs for `<<-` and hq when a quote or backslash was in the word, leaves p on the last character read
	function hdoc(   w, c2) {
		hs = 0; hq = 0; w = ""; p += 2
		if (substr(S, p, 1) == "-") { hs = 1; p++ }
		while (substr(S, p, 1) == " " || substr(S, p, 1) == "\t") p++
		while (p <= L) {
			c2 = substr(S, p, 1)
			if (c2 ~ /[ \t\n;&|()<>]/) break
			if (c2 == "\047" || c2 == "\"" || c2 == "\\") { hq = 1; p++; continue }
			w = w c2; p++
		}
		p--
		return w
	}
	# the body after the newline at p, up to the line that equals d (leading tabs dropped when s): body holds the lines before it, hfound says it was seen; leaves p on the newline ending that line
	function hbody(d, s,   e, ln, chk) {
		body = ""; hfound = 0; p++
		while (p <= L) {
			e = index(substr(S, p), "\n"); ln = (e ? substr(S, p, e - 1) : substr(S, p))
			p += (e ? e : length(ln) + 1)
			chk = ln; if (s) sub(/^\t+/, "", chk)
			if (chk == d) { hfound = 1; break }
			body = body ln "\n"
		}
		p--
	}
	function proc(   s, i, j, k, x, w, a, sb, deny, hp, rb, hard, ch, nm, ro, kk, wr, wrp, pf, ia, alk, rk, uk, b, np, pos, na, tl, tg, fo, fm, fc, am, ref, tgt, gd, gdir, dd, cv, lal, rep, df, mv, fr, fb, fl, rc, ai, ix, rgdir, seenenv, rw, ra, ddn, dry, cached, cwr, crd, c1, cnp, cskip, cf, cb, hasps) {
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
				if (t[i] ~ /^GH_REPO=/ && (s > n || w == "export")) ghenv = substr(t[i], 9)
				# git sees these only when they are exported: a bare assignment is a shell variable
				if (t[i] ~ /^GIT_INDEX_FILE=./ && w == "export") gidxenv = 1
				if (t[i] ~ /^GIT_DIR=/ && w == "export") gdirexp = joind(cwd, substr(t[i], 9))
			}
		if (s > n) return
		if (w == "cd" || w == "pushd") {
			ai = (t[s + 1] == "--") ? s + 2 : s + 1
			# every shell stays put on an empty operand; no operand at all is HOME
			if (w == "cd" && ai <= n && t[ai] == "") return
			chdir(t[ai]); return
		}
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
			ix = gidxenv; rgdir = gdirexp; seenenv = 0
			for (x = 1; x < i; x++) {
				if (t[x] ~ /^GIT_DIR=/) gdir = joind(cwd, substr(t[x], 9))
				# the child sees an assignment ahead of the command word or after an env
				if (x >= s && t[x] ~ /(^|\/)env$/) seenenv = 1
				if (x < s || seenenv) {
					if (t[x] ~ /^GIT_INDEX_FILE=./) ix = 1
					if (t[x] ~ /^GIT_DIR=/) rgdir = joind(cwd, substr(t[x], 9))
				}
			}
			while (j <= n && t[j] ~ /^-/) {
				if (tolower(t[j] " " t[j + 1]) ~ /core\.hookspath/) hp = 1
				cv = ""
				# an empty -C operand leaves the directory where it is
				if (t[j] == "-C") { if (t[j + 1] != "") gd = joind(gd, t[j + 1]) }
				else if (t[j] == "--git-dir") { gdir = joind(gd, t[j + 1]); rgdir = gdir }
				else if (t[j] ~ /^--git-dir=/) { gdir = joind(gd, substr(t[j], 11)); rgdir = gdir }
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
			if (sb !~ /^(commit|push|rebase|reset|cherry-pick|am|merge|pull|config|tag|update-ref|remote|branch|checkout|switch|add)$/ && !(role && sb ~ /^(restore|clean|stash|rm|mv|checkout-index|read-tree)$/)) continue
			deny = hp; ddn = 0; dry = 0; cached = 0; cwr = 0; crd = 0; c1 = ""; cnp = 0; cskip = 0; cf = 0; cb = 0; rb = 0; hard = 0; ro = 0; kk = 0; pf = 0; ia = 0; alk = 0; rk = 0; uk = 0; np = 0; na = 0; tl = 0; tg = 0; fo = 0; fm = 0; fc = 0; am = 0; dd = 0; rep = ""; df = 0; mv = 0; fr = 0; fb = 0; fl = 0
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
					# for a role a write is a write flag, set|unset|edit|..., or a key with a value; an option that takes a value eats it
					if (cskip) cskip = 0
					else if (a ~ /^(-f|--file|--blob|--default|--type|--comment)$/) cskip = 1
					else if (a ~ /^(--get(-all|-regexp|-urlmatch|-color|-colorbool)?|--list|-l)$/) crd = 1
					else if (a ~ /^(--unset(-all)?|--add|--replace-all|--rename-section|--remove-section|-e|--edit)$/) cwr = 1
					else if (a !~ /^-/) { cnp++; if (cnp == 1) c1 = a }
					continue
				}
				if (a ~ /refs\/tags\//) tg = 1
				# after `--` every word is a path or a refspec, never an option
				if (dd) { np++; pos[np] = a; ddn++; continue }
				if (a == "--") { dd = 1; continue }
				if (a ~ /^--no-v/ && index("--no-verify", a) == 1) deny = 1
				if (a == "--dry-run") dry = 1
				if (a ~ /^--(force|discard-changes|patch)$/ || a ~ /^--pathspec-from-file(=|$)/) cf = 1
				if (a ~ /^--orphan(=|$)/) cb = 1
				if (a == "--cached") cached = 1
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
						if (ch == "n" && sb ~ /^(add|rm|mv|clean|read-tree)$/) dry = 1
						if (ch ~ /[fp]/ && sb ~ /^(checkout|switch)$/) cf = 1
						if (ch ~ /[bB]/ && sb == "checkout") cb = 1
						if ((ch == "f" || ch == "d") && sb == "push") fo = 1
						if (sb == "branch") { if (ch ~ /[dD]/) df = 1; if (ch ~ /[mM]/) mv = 1; if (ch == "f") fr = 1 }
						if ((sb == "checkout" && ch == "B") || (sb == "switch" && ch == "C")) fb = 1
					}
				} else if (a ~ /^--(message|file)$/ || (sb == "push" && a ~ /^--(push-option|receive-pack|exec|repo)$/)) {
					if (sb == "push" && a == "--repo") rep = t[k + 1]
					k++
				}
			}
			if (role) {
				rw = ""; ra = ""
				if (sb == "checkout") {
					# a word that starts with . or : or holds a glob cannot be a ref; with a branch-creating flag the words are names
					hasps = 0
					for (x = 1; x <= np; x++) if (pos[x] ~ /^[.:]|[*?[]/) hasps = 1
					if (ddn > 0 || cf || hasps || (!cb && np >= 2)) rw = "checkout of paths"
					# one word is a branch or a path: the shell resolves it in the repository the line lands in
					else if (!cb && np == 1) { rw = "checkout of a path"; ra = pos[1]; gsub(/\t/, " ", ra) }
				}
				else if (sb == "switch") { if (cf) rw = "switch --discard-changes" }
				else if (sb == "restore" || sb == "reset" || sb == "checkout-index") rw = sb
				else if (sb == "read-tree") { if (!dry && !ix) rw = sb }
				else if (sb == "clean") { if (!dry) rw = sb }
				else if (sb == "stash") { if (pos[1] !~ /^(list|show|create)$/) rw = sb }
				# `add` and `rm --cached` write only the index, which GIT_INDEX_FILE makes private to the round; any other rm or mv moves a file
				else if (sb ~ /^(add|rm|mv)$/) { if (!dry && !(ix && (sb == "add" || (sb == "rm" && cached)))) rw = sb }
				else if (sb == "remote") { if (pos[1] ~ /^(add|remove|rm|rename|set-url|set-head|set-branches)$/) rw = "remote " pos[1] }
				else if (sb == "config") {
					if (c1 ~ /^(get|list)$/) crd = 1
					if (!crd && (cwr || c1 ~ /^(set|unset|edit|rename-section|remove-section)$/ || cnp >= 2)) rw = sb
				}
				if (rw != "") print "ROLE\t" (sb ~ /^(remote|config)$/ ? "C" : (ra != "" ? "R" : "W")) "\t" rw "\t" gd "\t" (rgdir == "" ? "-" : rgdir) "\t" (ra == "" ? "-" : ra)
			}
			if (sb ~ /^(restore|clean|stash|rm|mv|checkout-index|read-tree)$/) continue
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
		# the body of an unquoted heredoc is read as the inside of a "…" token that follows `echo`: only its substitutions are code
		if (ENVIRON["HB"] == 1) { hdm = 1; q = "\""; ds = 0; have = 1; n = 1; t[1] = "echo" }
		for (p = 1; p <= L; p++) {
			c = substr(S, p, 1)
			if (q == "\047") { if (c == "\047") q = ""; else tok = tok c; continue }
			if (q == "\"") {
				# inside a $( ) of this token the shell reads code: a " opens a string of its own and the matching ) closes the substitution, so neither ends the token
				# ds: 0 no substitution in this span yet, 1 inside the first one with plain words only since it opened, 2 anything else
				if (qd > 0 && c == "<" && substr(S, p + 1, 1) == "<" && substr(S, p + 2, 1) != "<") {
					# only at ds 1 with the delimiter ending its line is the shell certainly inside the $( ): there the heredoc is copied whole, delimiter line included, so a quote in its body is text; elsewhere << stays text
					if (ds == 1) {
						p0 = p; dw = hdoc(); dh = hs; e0 = p
						# the word as written must be one plain word or one fully quoted: an unbalanced quote makes the shell read a different delimiter
						wr = substr(S, p0 + 2, p - p0 - 1)
						while (substr(S, e0 + 1, 1) ~ /[ \t]/) e0++
						if (wr ~ ("^-?[ \t]*([A-Za-z0-9_.-]+|\047[A-Za-z0-9_.-]+\047|\"[A-Za-z0-9_.-]+\")$") && substr(S, e0 + 1, 1) == "\n") { p = e0 + 1; hbody(dw, dh); if (hfound) { tok = tok substr(S, p0, p - p0 + 1); ds = 2; continue } }
						p = p0
					}
					# a << left uncopied puts a body between the quotes that this count cannot tell from code: give the depth up, the next " ends the token
					if (qs[qd] == "" && substr(S, p - 1, 1) != "<") { qd = 0; ds = 2 }
				}
				if (qd > 0) {
					if (ds == 1 && c !~ /[A-Za-z0-9_.\/ \t-]/) ds = 2
					tok = tok c
					if (qs[qd] == "\047") { if (c == "\047") qs[qd] = "" }
					else if (c == "\\") { tok = tok substr(S, p + 1, 1); p++ }
					else if (c == "$" && substr(S, p + 1, 1) == "$") { tok = tok "$"; p++ }
					else if (c == "$" && substr(S, p + 1, 1) == "(") { tok = tok "("; p++; qd++; qs[qd] = ""; pp[qd] = 0 }
					else if (qs[qd] == "\"") { if (c == "\"") qs[qd] = "" }
					else if (c == "\"" || c == "\047") qs[qd] = c
					else if (c == "(") pp[qd]++
					else if (c == ")") { if (pp[qd] > 0) pp[qd]--; else qd-- }
					else if (c == "#" && substr(S, p - 1, 1) ~ /[ \t\n;&|(]/) while (p < L && substr(S, p + 1, 1) != "\n") { p++; tok = tok substr(S, p, 1) }
					continue
				}
				# depth 0: in the body of an unquoted heredoc (hdm) a quote is text, and so is every word outside a substitution, so only the substitutions are kept
				if (c == "\\") { if (!hdm || bt) tok = tok substr(S, p + 1, 1); p++; continue }
				if (c == "\"") { if (hdm) { if (bt) tok = tok c; continue } q = ""; continue }
				if (c == "`") { ds = 2; sub_[n + 1] = 1; if (hdm) bt = !bt }
				# `$$` is the PID: eaten as a pair, so the `$` that opens a `$(` is never the second half of one
				else if (c == "$" && substr(S, p + 1, 1) == "$") { if (!hdm || bt) tok = tok "$$"; p++; continue }
				else if (c == "$" && substr(S, p + 1, 1) == "(") {
					ds = (ds == 0) ? 1 : 2; sub_[n + 1] = 1
					qd = 1; qs[1] = ""; pp[1] = 0
					tok = tok "$("; p++; continue
				}
				if (!hdm || bt || c == "`") tok = tok c
				continue
			}
			if (c == "\\") {
				if (substr(S, p + 1, 1) != "\n") { tok = tok substr(S, p + 1, 1); have = 1 }
				p++; continue
			}
			if (c == "\047" || c == "\"") { q = c; ds = 0; qd = 0; have = 1; continue }
			if (c == "<" && substr(S, p + 1, 1) == "<" && substr(S, p + 2, 1) != "<" && substr(S, p - 1, 1) != "<") {
				# heredoc: the body runs only when a shell reads it; otherwise it is data and is skipped
				endtok(); hsh = (recv() || (sd != 0 && sc)); pipesh = 0; dl = hdoc(); strip = hs; hdq = hq
				if (dl != "") pend = 1
				continue
			}
			if (pend && c == "\n") {
				endseg(); prev = ""; pend = 0; hbody(dl, strip)
				if (hsh || pipesh) nest(body)
				else if (!hdq) nestb(body)
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
			ROLE)
				# REST = class (W worktree and index, C config, R a lone checkout word that is a branch or a path), what, dir, git dir, the word: a find only when it lands in the checkout this hook ships in; an unresolvable dir or git dir is no find
				RC=${REST%%"$TAB"*}; REST=${REST#*"$TAB"}
				RW=${REST%%"$TAB"*}; REST=${REST#*"$TAB"}
				D=${REST%%"$TAB"*}; REST=${REST#*"$TAB"}
				G=${REST%%"$TAB"*}; RA=${REST#*"$TAB"}
				{ [ "$D" = "?" ] || [ "$G" = "?" ]; } && continue
				if [ -z "$MYGD" ]; then
					MYTOP=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." 2>/dev/null && pwd -P) || continue
					MYI=$(git -C "$MYTOP" rev-parse --absolute-git-dir --path-format=absolute --git-common-dir 2>/dev/null) || continue
					MYGD=${MYI%%"$NL"*}; MYCD=${MYI#*"$NL"}
				fi
				RI=$(rgit rev-parse --absolute-git-dir --path-format=absolute --git-common-dir 2>/dev/null) || continue
				case $RC in
					C) [ "${RI#*"$NL"}" = "$MYCD" ] || continue ;;
					*) [ "${RI%%"$NL"*}" = "$MYGD" ] || continue ;;
				esac
				# a branch is a switch, not a discard; DWIM of a remote branch counts as a path (shortcut: it is a switch too, but it moves HEAD of the lead's checkout)
				[ "$RC" = R ] && rgit rev-parse --verify -q "$RA^{commit}" >/dev/null 2>&1 && continue
				KINDS="$KINDS rolegit"
				[ -n "$RWHY" ] || RWHY="git $RW in $(printf '%s' "$MYTOP" | tr -d '"\\')"
				: ;;
			GHDIR)
				# REST = dir, git dir: a gh write with no repo named goes to the repository of that directory; any remote that is not the theme repo is a find, no remote or an unreadable dir is not
				D=${REST%%"$TAB"*}
				G=${REST#*"$TAB"}
				{ [ "$D" = "?" ] || [ "$G" = "?" ]; } && continue
				if [ "$G" = - ]; then RU=$(git -C "$(rp "$BASE" "$D" .)" config --get-regexp '^remote\..*\.url$' 2>/dev/null) || continue
				else RU=$(git --git-dir="$(rp "$BASE" . "$G")" config --get-regexp '^remote\..*\.url$' 2>/dev/null) || continue; fi
				while read -r _ GU; do
					ismine "$GU" || { KINDS="$KINDS publish"; break; }
				done <<EOF
$RU
EOF
				: ;;
			NEST|NESTC|NESTB|SCRIPT)
				if [ "$2" -ge 3 ]; then KINDS="$KINDS script-too-deep"; continue; fi
				D=${REST%%"$TAB"*}
				P=${REST#*"$TAB"}
				if [ "$K" != SCRIPT ]; then
					NNEST=$((NNEST + 1))
					if [ "$NNEST" -gt 200 ]; then KINDS="$KINDS script-scan-cap"; continue; fi
					P=$(printf '%s' "$P" | tr "$STX" '\n')
					case $K in
						NESTC) scan "$P" $(($2 + 1)) "$D" 1 ;;
						NESTB) scan "$P" $(($2 + 1)) "$D" 0 1 ;;
						*) scan "$P" $(($2 + 1)) "$D" ;;
					esac
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
		noverify|tag|tagpush|release|pages|publish|rewrite|reset-hard|forkpush|mainmove|rolegit) U="$U $k" ;;
		histcheck) git -C "$BASE" merge-base --is-ancestor HEAD origin/main >/dev/null 2>&1 && U="$U rewrite" ;;
		forcecur) case $(git -C "$BASE" symbolic-ref --short -q HEAD 2>/dev/null) in main|master) U="$U rewrite" ;; esac ;;
	esac
done
KINDS=${U# }
[ -n "$KINDS" ] || exit 0

case " $KINDS " in
	*' noverify '*)
		emit deny "Hook skipping (--no-verify, -n on commit, core.hooksPath, an included config file) is never allowed; fix what the hook reports instead." ;;
	*' rolegit '*)
		emit deny "$RWHY is the lead's: the index, the worktree and the remotes of the real checkout are not a role's. Run real git in a scratch repo (git init under ../tmp/ or a mkdtemp dir, cwd there); a round snapshot uses GIT_INDEX_FILE=../tmp/task-<id>/round.idx. Spell every path literally in each Bash call: a variable from an earlier call is empty, and cd with an empty X stays in the checkout." ;;
	*)
		emit ask "git/gh $KINDS found in this command (possibly inside a script it runs): a tag, a release, a push outside the theme repo, a PR or issue comment, review or write outside it, or a rewrite or move of main needs the maintainer's word. Run /release for a tag; for a rewrite, name the commits." ;;
esac

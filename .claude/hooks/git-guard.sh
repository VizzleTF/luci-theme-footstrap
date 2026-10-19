#!/bin/sh
# PreToolUse/Bash: a TRIPWIRE for the actions that need the maintainer's word, not a fence. Frozen: it
# catches the forms a session reaches for by habit and by mistake; it does not stop a determined bypass
# (a line built at run time, an alias, a file written then run). No server-side rule backs it.
#
# Commit and push are the agent's own and stay silent. Ask: a tag (create, move, delete, push, also
# --tags, --follow-tags, refs/tags/*, a v<digit> refspec, update-ref), `gh release` writes, `gh api`
# writes to git/refs, git/tags or releases of the theme repo, `gh workflow run` in the theme repo (the
# owfeed dispatch is standing-authorized), a force push or delete of main/master, rebase and
# `commit --amend` while HEAD is already in origin/main, `reset --hard`, and a push whose remote
# (`git remote get-url --push`, in the directory `cd` / `git -C` leaves) is not VizzleTF/luci-theme-footstrap:
# that is how an openwrt/luci fork push shows up.
# The whole line is read, quote-aware, plus the local scripts and nested shells it runs (three levels
# deep, at most 50 scripts and 200 nested texts, each script once). A shell is followed behind env,
# timeout, nice, nohup, xargs, sudo, doas, command, exec, find -exec and `git bisect run`, and via `<<<`,
# `< file` or a heredoc body; the body of a heredoc fed to anything else (cat, git -F -, python) is data.
# Denied: --no-verify (any unique prefix), -n on commit, `-c core.hooksPath`, `git config` writes of it
# and GIT_CONFIG_KEY_n / GIT_CONFIG_PARAMETERS naming it. `--kinds` prints every kind found, the silent
# ones too, so precommit-gate.sh shares this detection.
#
# Acts only on a positive find: a missing jq or awk, unreadable stdin, a script it cannot resolve,
# too deep or over the cap stay silent; `--kinds` exits 1 instead.
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

scan() { # $1 text, $2 depth, $3 dir the text runs in (as written, relative to BASE; ? = unknown)
	OUT=$(printf '%s\n' "$1" | START=$3 awk '
	function joind(b, a) {
		if (a == "" || a == "-" || a ~ /[$`~*?]/) return "?"
		if (a ~ /^\//) return a
		if (b == "?") return "?"
		return (b == ".") ? a : b "/" a
	}
	function chdir(a) { cwd = joind(cwd, a) }
	function nest(s) { gsub(/\n/, ";", s); print "NEST\t" cwd "\t" s }
	function script(p) {
		if (cwd == "?" || p ~ /[$`~*?]/) print "KIND\tunknown-script"
		else print "SCRIPT\t" cwd "\t" p
	}
	function isshell(x) { return (x ~ /(^|\/)(sh|bash|zsh|dash|ash|ksh)$/) }
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
	# gh release writes, gh api writes to refs/tags/releases of the theme repo, gh workflow run there
	function gh(i0,   j, k, a, v, m, hf, path, repo, lp, r0) {
		j = i0 + 1
		while (j <= n && t[j] ~ /^-/) {
			# a global -R/--repo carries a value; skipping the flag alone would make the repo name the verb
			if (t[j] ~ /^(-R|--repo)$/) { r0 = t[j + 1]; j += 2 }
			else { if (t[j] ~ /^--repo=/) r0 = substr(t[j], 8); else if (t[j] ~ /^-R./) r0 = substr(t[j], 3); j++ }
		}
		v = t[j]
		if (v == "release") { if (t[j + 1] ~ /^(create|edit|delete|delete-asset|upload)$/) print "KIND\trelease" }
		else if (v == "workflow" && t[j + 1] == "run") {
			repo = r0
			for (k = j + 2; k <= n; k++) {
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
	function endseg() { endtok(); if (n) proc(); n = 0; split("", sub_) }
	function proc(   s, i, j, k, x, w, a, sb, deny, hp, rb, hard, ch, nm, ro, kk, wr, pf, np, pos, na, tl, tg, fo, fm, fc, am, ref, tgt, gd) {
		s = 1
		while (s <= n && t[s] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) s++
		w = t[s]
		if (w !~ /^(echo|printf)$/)
			for (i = 1; i <= n; i++)
				if (tolower(t[i]) ~ /^git_config_(key_[0-9]+|parameters)=/ && tolower(t[i]) ~ /core\.hookspath/) print "KIND\tnoverify"
		if (s > n) return
		if (w == "cd" || w == "pushd") { chdir(t[s + 1] == "--" ? t[s + 2] : t[s + 1]); return }
		for (i = 1; i <= n; i++) if (sub_[i]) nest(t[i])
		if (w ~ /^(echo|printf)$/) return
		for (i = s; i <= n; i++) {
			if (t[i] == "<<<") nest(t[i + 1])
			else if (t[i] ~ /^<<<./) nest(substr(t[i], 4))
		}
		if (w == "eval") {
			a = ""; for (i = s + 1; i <= n; i++) a = a " " t[i]
			nest(a)
		} else if (isshell(w) || w == "source" || w == ".") {
			shellrun(s)
		} else if (w ~ /(^|\/)(env|timeout|nice|nohup|xargs|sudo|doas|command|exec|find|setsid|stdbuf|ionice)$/ || w ~ /(^|\/)git(\.exe)?$/) {
			wr = (w !~ /(^|\/)git(\.exe)?$/)
			for (i = s + 1; i <= n; i++) if (t[i] == "bisect") wr = 1
			if (wr) for (i = s + 1; i <= n; i++) if (isshell(t[i])) { shellrun(i); break }
		} else if (w ~ /\//) script(w)
		for (i = 1; i <= n; i++) if (t[i] ~ /(^|\/)gh(\.exe)?$/) gh(i)
		for (i = 1; i <= n; i++) {
			if (t[i] !~ /(^|\/)git(\.exe)?$/) continue
			j = i + 1; hp = 0; gd = cwd
			while (j <= n && t[j] ~ /^-/) {
				if (tolower(t[j] " " t[j + 1]) ~ /core\.hookspath/) hp = 1
				if (t[j] == "-C") gd = joind(gd, t[j + 1])
				j += (t[j] ~ /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/) ? 2 : 1
			}
			sb = t[j]
			if (sb !~ /^(commit|push|rebase|reset|cherry-pick|am|merge|pull|config|tag|update-ref)$/) continue
			deny = hp; rb = 0; hard = 0; ro = 0; kk = 0; pf = 0; np = 0; na = 0; tl = 0; tg = 0; fo = 0; fm = 0; fc = 0; am = 0
			split("", pos)
			for (k = j + 1; k <= n; k++) {
				a = t[k]
				na++
				if (sb == "config") {
					a = tolower(a)
					if (a == "core.hookspath") kk = k
					else if (a == "push.followtags") pf = k
					else if (a ~ /^(--unset(-all)?|--get(-all|-regexp|-urlmatch)?|--list|-l|unset|get|list)$/) ro = 1
					continue
				}
				if (a == "--") break
				if (a ~ /^--no-v/ && index("--no-verify", a) == 1) deny = 1
				if (a !~ /^-/) { np++; pos[np] = a }
				if (a ~ /^(-l|--list|-v|--verify|--contains|--no-contains|--points-at|--merged|--no-merged)$/ || a ~ /^--(contains|no-contains|points-at|merged|no-merged|list)=/) tl = 1
				if (a ~ /refs\/tags\//) tg = 1
				if (sb == "push") {
					if (a ~ /^--force/ || a == "--delete") fo = 1
					if (a == "--tags" || a == "--mirror" || a ~ /^--follow-tags(=|$)/) tg = 1
				}
				if (sb == "commit" && length(a) >= 4 && index("--amend", a) == 1) am = 1
				nm = a; sub(/=.*/, "", nm)
				if (length(nm) >= 5 && index("--rebase", nm) == 1) rb = 1
				if (length(nm) >= 3 && index("--hard", nm) == 1) hard = 1
				if (a == "-r") rb = 1
				if (a ~ /^-[a-zA-Z]+$/) {
					# a cluster ends at the first flag that takes a value; the rest is that value
					for (x = 2; x <= length(a); x++) {
						ch = substr(a, x, 1)
						if (ch ~ /[mFcC]/) { if (x == length(a)) k++; break }
						if (ch == "n" && sb == "commit") deny = 1
						if ((ch == "f" || ch == "d") && sb == "push") fo = 1
					}
				} else if (a ~ /^--(message|file)$/) k++
			}
			if (sb == "config") {
				if (kk && !ro && (kk < n || t[j + 1] ~ /^(set|--add|--replace-all)$/)) print "KIND\tnoverify"
				if (pf && !ro && (pf < n || t[j + 1] ~ /^(set|--add|--replace-all)$/)) print "KIND\ttagpush"
				continue
			}
			if (sb == "tag") { if (na && !tl) print "KIND\ttag"; continue }
			if (sb == "update-ref") { if (tg) print "KIND\ttagpush"; continue }
			if (deny) print "KIND\tnoverify"
			if (sb == "push") {
				# pos[1] is the remote, the rest are refspecs; a `+` forces that one
				for (x = 2; x <= np; x++) {
					ref = pos[x]
					if (ref == "tag" || ref ~ /(^|[:+])(refs\/tags\/|v[0-9])/) tg = 1
					if (ref ~ /^\+/) fo = 1
					tgt = ref; sub(/^\+/, "", tgt); sub(/^[^:]*:/, "", tgt); sub(/^refs\/heads\//, "", tgt)
					if (tgt ~ /^(main|master)$/) fm = 1
					else if (tgt == "" || tgt == "HEAD") fc = 1
				}
				if (np < 2) fc = 1
				if (tg) print "KIND\ttagpush"
				if (fo && fm) print "KIND\trewrite"
				else if (fo && fc) print "KIND\tforcecur"
				print "PUSH\t" gd "\t" (np ? pos[1] : "origin")
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
				endtok(); hsh = recv(); strip = 0; dl = ""; p += 2
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
				endseg(); pend = 0; body = ""; p++
				while (p <= L) {
					e = index(substr(S, p), "\n"); ln = (e ? substr(S, p, e - 1) : substr(S, p))
					p += (e ? e : length(ln) + 1)
					chk = ln; if (strip) sub(/^\t+/, "", chk)
					if (chk == dl) break
					body = body ln "\n"
				}
				p--
				if (hsh) nest(body)
				continue
			}
			if (c == "#" && !have) { while (p < L && substr(S, p + 1, 1) != "\n") p++; continue }
			if (c == " " || c == "\t") { endtok(); continue }
			if (c ~ /[;&|(){}`\n]/) { endseg(); continue }
			tok = tok c; have = 1
		}
		endseg()
	}') || fail "awk failed"
	while IFS=$TAB read -r K REST; do
		case $K in
			KIND) KINDS="$KINDS $REST" ;;
			PUSH)
				# REST = dir<TAB>remote; an unresolvable dir or remote is no find
				D=${REST%%"$TAB"*}
				P=${REST#*"$TAB"}
				[ "$D" = "?" ] && continue
				case $P in
					*/*|*:*) PU=$P ;;
					*) PU=$(git -C "$(rp "$BASE" "$D" .)" remote get-url --push "$P" 2>/dev/null) || continue ;;
				esac
				case $PU in
					'') ;;
					*[Vv]izzle[Tt][Ff]/luci-theme-footstrap*) ;;
					*) KINDS="$KINDS forkpush" ;;
				esac ;;
			NEST|SCRIPT)
				if [ "$2" -ge 3 ]; then KINDS="$KINDS script-too-deep"; continue; fi
				D=${REST%%"$TAB"*}
				P=${REST#*"$TAB"}
				if [ "$K" = NEST ]; then
					NNEST=$((NNEST + 1))
					if [ "$NNEST" -gt 200 ]; then KINDS="$KINDS script-scan-cap"; continue; fi
					scan "$P" $(($2 + 1)) "$D"; continue
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
		noverify|tag|tagpush|release|rewrite|reset-hard|forkpush) U="$U $k" ;;
		histcheck) git -C "$BASE" merge-base --is-ancestor HEAD origin/main >/dev/null 2>&1 && U="$U rewrite" ;;
		forcecur) case $(git -C "$BASE" symbolic-ref --short -q HEAD 2>/dev/null) in main|master) U="$U rewrite" ;; esac ;;
	esac
done
KINDS=${U# }
[ -n "$KINDS" ] || exit 0

case " $KINDS " in
	*' noverify '*)
		emit deny "Hook skipping (--no-verify, -n on commit, core.hooksPath) is never allowed; fix what the hook reports instead." ;;
	*)
		emit ask "git/gh $KINDS found in this command (possibly inside a script it runs): a tag, a release, a push outside the theme repo or a history rewrite of main needs the maintainer's word. Run /release for a tag; for a rewrite, name the commits." ;;
esac

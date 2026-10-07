#!/bin/sh
# PreToolUse/Bash: a TRIPWIRE for an accidental commit or push, not a fence. Frozen: it catches the
# forms a session reaches for by habit and by mistake; it does not stop a determined bypass (a line
# built at run time, an alias, a file written then run). The fence is server-side branch protection.
#
# The `ask` rules in settings.json match a line that STARTS with `git commit`; this reads the whole
# line, quote-aware, plus the local scripts and nested shells it runs (three levels deep, at most 50
# scripts and 200 nested texts, each script once), and asks on commit, push, rebase, cherry-pick, am,
# merge, `pull --rebase` and reset --hard anywhere in it. A shell is followed behind env, timeout,
# nice, nohup, xargs, sudo, doas, command, exec, find -exec and `git bisect run`, and via `<<<` or
# `< file`. Denied: --no-verify (any unique prefix), -n on commit, `-c core.hooksPath`, `git config`
# writes of it and GIT_CONFIG_KEY_n / GIT_CONFIG_PARAMETERS naming it. `--kinds` prints the kinds
# found, so precommit-gate.sh shares this detection.
#
# Acts only on a positive find: a missing jq or awk, unreadable stdin, a script it cannot resolve,
# too deep or over the cap stay silent (every `sh "$X"` used to ask); `--kinds` exits 1 instead.
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
	function chdir(a) {
		if (a == "" || a == "-" || a ~ /[$`~*?]/) cwd = "?"
		else if (a ~ /^\//) cwd = a
		else if (cwd != "?") cwd = (cwd == ".") ? a : cwd "/" a
	}
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
	function endtok() { if (have) { n++; t[n] = tok } tok = ""; have = 0 }
	function endseg() { endtok(); if (n) proc(); n = 0; split("", sub_) }
	function proc(   s, i, j, k, x, w, a, sb, deny, hp, rb, hard, ch, nm, ro, kk, wr) {
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
		for (i = 1; i <= n; i++) {
			if (t[i] !~ /(^|\/)git(\.exe)?$/) continue
			j = i + 1; hp = 0
			while (j <= n && t[j] ~ /^-/) {
				if (tolower(t[j] " " t[j + 1]) ~ /core\.hookspath/) hp = 1
				j += (t[j] ~ /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/) ? 2 : 1
			}
			sb = t[j]
			if (sb !~ /^(commit|push|rebase|reset|cherry-pick|am|merge|pull|config)$/) continue
			deny = hp; rb = 0; hard = 0; ro = 0; kk = 0
			for (k = j + 1; k <= n; k++) {
				a = t[k]
				if (sb == "config") {
					a = tolower(a)
					if (a == "core.hookspath") kk = k
					else if (a ~ /^(--unset(-all)?|--get(-all|-regexp|-urlmatch)?|--list|-l|unset|get|list)$/) ro = 1
					continue
				}
				if (a == "--") break
				if (a ~ /^--no-v/ && index("--no-verify", a) == 1) deny = 1
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
					}
				} else if (a ~ /^--(message|file)$/) k++
			}
			if (sb == "config") { if (kk && !ro && (kk < n || t[j + 1] ~ /^(set|--add|--replace-all)$/)) print "KIND\tnoverify"; continue }
			if (deny) print "KIND\tnoverify"
			if (sb == "reset") { if (hard) print "KIND\treset-hard" }
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

# A tripwire acts only on what it saw: a script it could not follow is not a commit, so it stays quiet.
U=''
for k in $KINDS; do
	case $k in unknown-script|script-too-deep|script-scan-cap) ;; *) U="$U $k" ;; esac
done
KINDS=${U# }
[ -n "$KINDS" ] || exit 0

case " $KINDS " in
	*' noverify '*)
		emit deny "Hook skipping (--no-verify, -n on commit, core.hooksPath) is never allowed; fix what the hook reports instead." ;;
	*)
		emit ask "git $KINDS found in this command (possibly inside a script it runs): commit, push and rebase need the user's explicit word each time." ;;
esac

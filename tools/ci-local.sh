#!/bin/sh
# Run, from a terminal, the same work .github/workflows/build.yml runs — so a red CI run is never
# the first place a fault is seen. One entry point per job/slice, in the same order, with the
# push-vs-pull_request split reproduced by a flag rather than by two copies of this file.
#
#   tools/ci-local.sh --list                    # the job/slice map and what cannot be reproduced
#   tools/ci-local.sh check lint build           # the three jobs that never touch a router
#   tools/ci-local.sh verify                     # owlab test, both formats — safe with stands up
#   tools/ci-local.sh --mode push --force live   # all three live slices, this project's own stands
#   tools/ci-local.sh all --dry-run              # print every command either mode would run
#
# MUST run from WSL, never from Git Bash on Windows — docs/development.md, "The stand's own
# traps" ("npm, python3 and any *.sh gate cannot run from the Windows side of this checkout at
# all"). Invoke it the way that section's own recipe does, PATH set by hand inside the call:
#
#   MSYS_NO_PATHCONV=1 wsl.exe -- bash -c '\
#     PATH=$HOME/go/bin:/usr/local/bin:/usr/bin:/bin; export PATH; \
#     cd /mnt/c/Users/<you>/Documents/home/openwrt/luci-theme-footstrap; \
#     sh tools/ci-local.sh check lint build'
#
# …or, better: write that one call into a FILE and run `wsl.exe -- bash <file>.sh` instead of
# inlining it — a second, independent trap from the one already on that page: a variable
# ASSIGNED inside an inline `wsl.exe -- bash -c '...'` string reads back empty or truncated even
# past the point where `$?` alone was the concern (measured this session: `x=$(echo hello);
# echo "$x"` printed nothing, `x=hello; echo "$x"` printed nothing, over the exact same inline
# call that a real script FILE runs correctly every time). This script relies on shell variables
# throughout, so it is written to be RUN as a file for exactly that reason.
#
# What this does NOT try to be: a sandbox, a timeout enforcer, or a replacement for the real
# workflow. `--list` (also printed at the end of every run) says out loud what a green run here
# does not prove, on purpose — a step skipped for a missing tool or a busy router is reported as
# SKIP, never folded into PASS.
set -u

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT" || exit 2

TMPROOT=$(CDPATH='' cd -- "$ROOT/.." && pwd)/tmp
STAMP=$(date +%Y%m%d-%H%M%S)
RUNDIR="$TMPROOT/ci-local-$STAMP"
mkdir -p "$RUNDIR"
RESULTS="$RUNDIR/results.tsv"
: >"$RESULTS"

MODE=pr
DRY=0
LISTONLY=0
FORCE=0
JOBS=""

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

usage() {
	cat <<'EOF'
usage: tools/ci-local.sh [--mode pr|push] [--dry-run] [--force] [--list] <job|slice>...

jobs/slices (repeatable; "all" is every one of them, in build.yml's own order):
  check                 job `check`   — the static, non-npm gates
  lint                  job `lint`    — the npm gates, including jsmin-verify
  build                 job `build`   — tools/stage.sh + owfeed plan|check|build + check-packages.sh
  verify                job `verify`  — owlab test, 25.12/apk and 24.10/opkg, the workflow's own 5 assertions
  live                  job `live`, all three slices below
  live:parity           job `live`, slice `parity`  — spa-parity
  live:audit            job `live`, slice `audit`   — live-audit
  live:motion           job `live`, slice `motion`  — upstream-contract, scroll-jank, table-tick,
                         floor-contract, fit-quiet, scroll-anchor, install-check.sh
  anchors               job `anchors`, both engines below
  anchors:firefox       job `anchors`, engine firefox
  anchors:webkit        job `anchors`, engine webkit
  all                   every job above

flags:
  --mode pr|push   which push.yml branch to reproduce (default pr): pr is ROUTERS=owrt2512,
                   FULL=""; push is ROUTERS="owrt2512 owrt2410 owrtsnap", FULL="--full" — the
                   exact split build.yml's own `if [ "${{ github.event_name }}" = "pull_request" ]`
                   makes for `live` and `anchors`. Has no effect on check/lint/build/verify.
  --force          required before `live`/`anchors` actually boot/install onto THIS project's own
                   named stands (owlab.yaml). Withheld by default: those legs are not safe to run
                   while another session has the same stands — docs/development.md, "Two
                   live-audit sweeps against the same stand fight over its language" is that
                   exact failure mode, not a hypothetical one.
  --dry-run        print the commands each requested job/slice would run and exit; touches
                   nothing, needs no tool on PATH.
  --list           print the job/slice -> workflow-job map and the reproducibility gaps, then
                   exit. Implies nothing else runs.
  -h, --help       this text.

Every run ends with a summary (what ran, PASS/FAIL/SKIP, where the logs are) and the same gap
list --list prints — a step this host cannot cover says so out loud, and is never counted PASS.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
	--mode)
		MODE=${2:-}
		shift 2
		;;
	--mode=*) MODE=${1#--mode=}; shift ;;
	--dry-run) DRY=1; shift ;;
	--force) FORCE=1; shift ;;
	--list) LISTONLY=1; shift ;;
	-h | --help)
		usage
		exit 0
		;;
	check | lint | build | verify | live | live:parity | live:audit | live:motion | anchors | anchors:firefox | anchors:webkit | all)
		JOBS="$JOBS $1"
		shift
		;;
	*)
		echo "ci-local: unknown argument: $1" >&2
		usage >&2
		exit 2
		;;
	esac
done

case "$MODE" in
pr | push) ;;
*)
	echo "ci-local: --mode must be pr or push, got '$MODE'" >&2
	exit 2
	;;
esac

# ---------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------

# Never reads $? — docs/development.md, "The stand's own traps": "$? is unreliable in this WSL
# bash" and the corruption measured directly above for a captured variable is the same family.
# Every verdict here comes from a direct `if COMMAND; then … else … fi`, which was verified this
# session to report correctly even where reading `$?` afterwards did not.
step() {
	name=$1
	shift
	log="$RUNDIR/$(printf '%s' "$name" | tr -c 'A-Za-z0-9' '-').log"
	if [ "$DRY" = 1 ]; then
		printf '  -> %-38s [dry-run] %s\n' "$name" "$*"
		printf '%s\tDRY\t-\n' "$name" >>"$RESULTS"
		return 0
	fi
	printf '  -> %-38s ... ' "$name"
	if "$@" >"$log" 2>&1; then
		echo "PASS"
		printf '%s\tPASS\t%s\n' "$name" "$log" >>"$RESULTS"
		return 0
	else
		echo "FAIL"
		printf '%s\tFAIL\t%s\n' "$name" "$log" >>"$RESULTS"
		tail -n 15 "$log" | sed 's/^/       /'
		return 1
	fi
}

skip() {
	name=$1
	reason=$2
	printf '  -> %-38s SKIP  (%s)\n' "$name" "$reason"
	printf '%s\tSKIP\t%s\n' "$name" "$reason" >>"$RESULTS"
}

# ---------------------------------------------------------------------------------------------
# job `check` — .github/workflows/build.yml, job `check`
# ---------------------------------------------------------------------------------------------
job_check() {
	echo "== check (static, non-npm gates) =="
	step "check-shell" sh tools/check-shell.sh
	step "scan-marker" sh tools/scan-marker.sh
	step "check-acl" sh tools/check-acl.sh
	step "build-css" luci-theme-footstrap/build-css.sh "$RUNDIR/cascade.check.css"
	step "audit-strict" "$PY" tools/audit.py --strict
	if command -v msgfmt >/dev/null 2>&1 && command -v msgmerge >/dev/null 2>&1 && command -v xgettext >/dev/null 2>&1; then
		: # already on PATH — the workflow's own apt-get fallback is not exercised, see --list
	else
		skip "gettext" "msgfmt/msgmerge/xgettext missing — install gettext (apt-get install gettext) and re-run"
		printf 'update-po-check\tSKIP\tgettext missing\n' >>"$RESULTS"
		return
	fi
	step "update-po-check" luci-theme-footstrap/update-po.sh --check
}

# ---------------------------------------------------------------------------------------------
# job `lint` — .github/workflows/build.yml, job `lint`
# ---------------------------------------------------------------------------------------------
jsmin_step() {
	name="jsmin-build-and-verify"
	log="$RUNDIR/jsmin.log"
	if [ "$DRY" = 1 ]; then
		printf '  -> %-38s [dry-run] JSMIN=$(sh tools/build-jsmin.sh); node tools/jsmin-verify.mjs\n' "$name"
		printf '%s\tDRY\t-\n' "$name" >>"$RESULTS"
		return
	fi
	script="$RUNDIR/jsmin-run.sh"
	{
		echo '#!/bin/sh'
		echo 'set -eu'
		printf 'cd %s\n' "$ROOT"
		printf 'export RUNNER_TEMP=%s\n' "$RUNDIR"
		echo 'JSMIN=$(sh tools/build-jsmin.sh)'
		echo 'export JSMIN'
		echo 'exec node tools/jsmin-verify.mjs'
	} >"$script"
	printf '  -> %-38s ... ' "$name"
	if sh "$script" >"$log" 2>&1; then
		echo "PASS"
		printf '%s\tPASS\t%s\n' "$name" "$log" >>"$RESULTS"
	else
		echo "FAIL"
		printf '%s\tFAIL\t%s\n' "$name" "$log" >>"$RESULTS"
		tail -n 15 "$log" | sed 's/^/       /'
	fi
}

job_lint() {
	echo "== lint (npm gates) =="
	if [ ! -d node_modules ]; then
		skip "lint" "node_modules/ is missing — run 'npm ci' yourself first (not run by this script: it never writes outside tools/ and ../tmp/). docs/development.md's Windows-install trap applies if you install it from Windows and run gates from WSL: chmod +x node_modules/.bin/* first."
		return
	fi
	step "lint-js" npm run lint:js
	step "lint-css" npm run lint:css
	step "unit-tests" npm test
	step "ci-playwright" sh tools/ci-playwright.sh
	step "a11y-gallery" node tools/a11y-gallery.mjs
	step "size-budget" node tools/size-budget.mjs --show
	step "build-icons-check" node tools/build-icons.mjs --check
	step "export-tier" node tools/export-tier.mjs
	step "css-metrics" node tools/css-metrics.mjs
	step "css-floor" node tools/css-floor.mjs
	step "fs-orphans" node tools/fs-orphans.mjs
	step "css-dup" node tools/css-dup.mjs
	step "css-i18n" node tools/css-i18n.mjs
	step "mirror" node tools/mirror.mjs
	step "axes" node tools/axes.mjs
	step "chrome-fence" node tools/chrome-fence.mjs
	step "table-contract" node tools/table-contract.mjs
	step "page-modules" node tools/page-modules.mjs
	step "conffiles" node tools/conffiles.mjs
	step "i18n-packages" node tools/i18n-packages.mjs
	step "bang-ok" node tools/bang-ok.mjs
	step "changelog" node tools/changelog.mjs
	jsmin_step
}

# ---------------------------------------------------------------------------------------------
# job `build` — .github/workflows/build.yml, job `build`
# ---------------------------------------------------------------------------------------------
job_build() {
	echo "== build (owfeed packages) =="
	if [ "$DRY" = 1 ]; then
		step "build-packages" echo "SOURCE_DATE_EPOCH=\$(git log -1 --format=%ct); ./tools/stage.sh; owfeed plan; owfeed check; owfeed build; sh tools/check-packages.sh"
		return
	fi
	script="$RUNDIR/build-run.sh"
	{
		echo '#!/bin/sh'
		echo 'set -eu'
		printf 'cd %s\n' "$ROOT"
		echo 'SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)'
		echo 'export SOURCE_DATE_EPOCH'
		echo './tools/stage.sh'
		echo 'owfeed plan'
		echo 'owfeed check'
		echo 'owfeed build'
		echo 'sh tools/check-packages.sh'
	} >"$script"
	step "build-packages" sh "$script"
}

# ---------------------------------------------------------------------------------------------
# job `verify` — .github/workflows/build.yml, job `verify`. Runs `owlab test`, which synthesizes
# its own ephemeral router rather than reusing owlab.yaml's named ones — safe to run even while
# another session has owrt2512/owrt2410/owrtsnap, PROVIDED it runs from a scratch cwd
# (docs/development.md: "the containers are named after the cwd", which this always does).
# ---------------------------------------------------------------------------------------------
verify_one() {
	rel=$1
	glob=$2
	name="verify-$rel"
	if [ "$DRY" = 1 ]; then
		printf '  -> %-38s [dry-run] owlab test --release %s --install %s --assert … (5 assertions, docs/development.md)\n' "$name" "$rel" "$glob"
		printf '%s\tDRY\t-\n' "$name" >>"$RESULTS"
		return
	fi
	scratch="$RUNDIR/owlab-test-$rel"
	rm -rf "$scratch"
	mkdir -p "$scratch"
	log="$RUNDIR/$name.log"
	UT=/usr/share/ucode/luci/template/themes/footstrap
	printf '  -> %-38s ... ' "$name"
	if (
		cd "$scratch" && owlab test --release "$rel" \
			--install "$glob" \
			--assert 'package luci-theme-footstrap' \
			--assert 'file /www/luci-static/footstrap/cascade.css' \
			--assert 'http 200 /cgi-bin/luci/admin/status/overview' \
			--assert 'http 200 /cgi-bin/luci/admin/system/system' \
			--assert "exec for f in $UT/*.ut; do ucode -T -c -o /dev/null \"\$f\" || exit 1; done"
	) >"$log" 2>&1; then
		echo "PASS"
		printf '%s\tPASS\t%s\n' "$name" "$log" >>"$RESULTS"
	else
		echo "FAIL"
		printf '%s\tFAIL\t%s\n' "$name" "$log" >>"$RESULTS"
		tail -n 15 "$log" | sed 's/^/       /'
	fi
}

# The workflow's own advisory step: "Assert the feed serves a working theme" — gated on push and
# on the feed answering, `continue-on-error: true`. Tests the ALREADY-PUBLISHED channel, never
# this build; a failure here is reported, never counted as this run's own FAIL.
verify_feed() {
	name="verify-feed-live"
	if [ "$DRY" = 1 ]; then
		printf '  -> %-38s [dry-run] tools/feed-key.sh; owlab test -feed … (advisory, push mode only)\n' "$name"
		printf '%s\tDRY\t-\n' "$name" >>"$RESULTS"
		return
	fi
	log="$RUNDIR/$name.log"
	pem="$RUNDIR/owfeed-packages.pem"
	out="$RUNDIR/feed-key.out"
	: >"$out"
	RUNNER_TEMP="$RUNDIR" GITHUB_OUTPUT="$out" sh tools/feed-key.sh >"$log" 2>&1
	if ! grep -q '^reachable=true' "$out" 2>/dev/null; then
		skip "$name" "feed unreachable (or feed-key.sh failed) — see $log; this is the workflow's own non-blocking case"
		return
	fi
	scratch="$RUNDIR/owlab-test-feed"
	rm -rf "$scratch"
	mkdir -p "$scratch"
	printf '  -> %-38s ... ' "$name"
	if (
		cd "$scratch" && owlab test --release 25.12.4 \
			--feed https://repo.owfeed.org/releases/25.12/x86_64/packages.adb \
			--feed-key "$pem" --feed-name owfeed-packages \
			--install luci-theme-footstrap \
			--assert 'package luci-theme-footstrap' \
			--assert 'http 200 /cgi-bin/luci/admin/status/overview'
	) >>"$log" 2>&1; then
		echo "PASS"
		printf '%s\tPASS\t%s\n' "$name" "$log" >>"$RESULTS"
	else
		echo "FAIL (advisory — the published feed, not this build; the workflow marks this continue-on-error)"
		printf '%s\tFAIL(advisory)\t%s\n' "$name" "$log" >>"$RESULTS"
	fi
}

job_verify() {
	echo "== verify (owlab test, both formats) =="
	if [ ! -d dist/noarch ] || [ ! -d dist/all ]; then
		skip "verify" "dist/ has no built packages — run 'tools/ci-local.sh build' first"
		return
	fi
	if ! command -v owlab >/dev/null 2>&1; then
		skip "verify" "owlab not on PATH — docs/development.md, 'Install owlab first'"
		return
	fi
	verify_one 25.12.4 "$ROOT/dist/noarch/luci-theme-footstrap-*.apk"
	verify_one 24.10.8 "$ROOT/dist/all/luci-theme-footstrap_*.ipk"
	if [ "$MODE" = push ]; then
		verify_feed
	else
		skip "verify-feed-live" "only runs on push (build.yml: github.event_name != 'pull_request'); this run used --mode pr"
	fi
}

# ---------------------------------------------------------------------------------------------
# job `live` and job `anchors` — both boot and install onto THIS PROJECT'S OWN named stands
# (owlab.yaml: owrt2512, owrt2410, owrtsnap), never an ephemeral one. Refused without --force.
# ---------------------------------------------------------------------------------------------
compute_routers() {
	if [ "$MODE" = push ]; then
		ROUTERS="owrt2512 owrt2410 owrtsnap"
		FULL="--full"
	else
		ROUTERS="owrt2512"
		FULL=""
	fi
}

boot_and_install() {
	log="$RUNDIR/owlab-up-install.log"
	if ! owlab up $ROUTERS >"$log" 2>&1; then return 1; fi
	for r in $ROUTERS; do
		case "$r" in
		*2512 | *snap) owlab install "$r" dist/noarch/luci-theme-footstrap-*.apk >>"$log" 2>&1 || return 1 ;;
		*) owlab install "$r" dist/all/luci-theme-footstrap_*.ipk >>"$log" 2>&1 || return 1 ;;
		esac
	done
	return 0
}

require_stand_ack() {
	leg=$1
	if [ "$FORCE" = 1 ]; then return 0; fi
	echo "  refusing: $leg boots/installs onto THIS project's own stands ($ROUTERS, owlab.yaml)."
	echo "  Pass --force once you have confirmed nothing else is using them right now —"
	echo "  docs/development.md, 'Two live-audit sweeps against the same stand fight over its"
	echo "  language' is the exact failure this default avoids, not a hypothetical one."
	printf '%s\tSKIP\trefused without --force\n' "$leg" >>"$RESULTS"
	return 1
}

job_live() {
	slice=$1
	compute_routers
	O=$(printf '%s' "$ROUTERS" | tr ' ' ,)
	echo "== live:$slice (mode=$MODE, routers=$ROUTERS, full=${FULL:-<none>}) =="
	if [ "$DRY" = 1 ]; then
		step "ci-playwright" echo "sh tools/ci-playwright.sh"
		step "owlab-boot" echo "owlab up $ROUTERS; owlab install <router> <package>  # per router, apk or ipk"
		case "$slice" in
		parity) step "live:parity" echo "node tools/spa-parity.mjs --only $O" ;;
		audit) step "live:audit" echo "node tools/live-audit.mjs --only $O" ;;
		motion)
			step "live:motion:upstream-contract" echo "node tools/upstream-contract.mjs --only $O"
			step "live:motion:scroll-jank" echo "node tools/scroll-jank.mjs --only $O"
			step "live:motion:table-tick" echo "node tools/table-tick.mjs --only $O"
			step "live:motion:floor-contract" echo "node tools/floor-contract.mjs --only $O"
			step "live:motion:fit-quiet" echo "node tools/fit-quiet.mjs --only $O"
			step "live:motion:scroll-anchor" echo "node tools/scroll-anchor.mjs --only $O $FULL"
			step "live:motion:install-check" echo "sh tools/install-check.sh $ROUTERS"
			;;
		esac
		return
	fi
	require_stand_ack "live:$slice" || return
	if [ ! -d dist/noarch ] || [ ! -d dist/all ]; then
		skip "live:$slice" "dist/ has no built packages — run 'tools/ci-local.sh build' first"
		return
	fi
	step "ci-playwright" sh tools/ci-playwright.sh
	echo "  booting $ROUTERS and installing this build …"
	if ! boot_and_install; then
		skip "live:$slice" "owlab up/install failed — see $RUNDIR/owlab-up-install.log"
		return
	fi
	case "$slice" in
	parity) step "live:parity" node tools/spa-parity.mjs --only "$O" ;;
	audit) step "live:audit" node tools/live-audit.mjs --only "$O" ;;
	motion)
		step "live:motion:upstream-contract" node tools/upstream-contract.mjs --only "$O"
		step "live:motion:scroll-jank" node tools/scroll-jank.mjs --only "$O"
		step "live:motion:table-tick" node tools/table-tick.mjs --only "$O"
		step "live:motion:floor-contract" node tools/floor-contract.mjs --only "$O"
		step "live:motion:fit-quiet" node tools/fit-quiet.mjs --only "$O"
		if [ -n "$FULL" ]; then
			step "live:motion:scroll-anchor" node tools/scroll-anchor.mjs --only "$O" --full
		else
			step "live:motion:scroll-anchor" node tools/scroll-anchor.mjs --only "$O"
		fi
		# shellcheck disable=SC2086 # $ROUTERS is a deliberate word list, install-check.sh's own argv
		step "live:motion:install-check" sh tools/install-check.sh $ROUTERS
		;;
	esac
	owlab down >>"$RUNDIR/owlab-down.log" 2>&1
}

job_anchors() {
	engine=$1
	compute_routers
	O=$(printf '%s' "$ROUTERS" | tr ' ' ,)
	echo "== anchors:$engine (mode=$MODE, routers=$ROUTERS, full=${FULL:-<none>}) =="
	if [ "$DRY" = 1 ]; then
		step "playwright-install-$engine" echo "npx playwright install --with-deps $engine"
		step "owlab-boot" echo "owlab up $ROUTERS; owlab install <router> <package>"
		step "anchors:$engine" echo "node tools/scroll-anchor.mjs --engines $engine --only $O $FULL"
		return
	fi
	require_stand_ack "anchors:$engine" || return
	if [ ! -d dist/noarch ] || [ ! -d dist/all ]; then
		skip "anchors:$engine" "dist/ has no built packages — run 'tools/ci-local.sh build' first"
		return
	fi
	step "playwright-install-$engine" npx playwright install --with-deps "$engine"
	echo "  booting $ROUTERS and installing this build …"
	if ! boot_and_install; then
		skip "anchors:$engine" "owlab up/install failed — see $RUNDIR/owlab-up-install.log"
		return
	fi
	if [ -n "$FULL" ]; then
		step "anchors:$engine" node tools/scroll-anchor.mjs --engines "$engine" --only "$O" --full
	else
		step "anchors:$engine" node tools/scroll-anchor.mjs --engines "$engine" --only "$O"
	fi
	owlab down >>"$RUNDIR/owlab-down.log" 2>&1
}

# ---------------------------------------------------------------------------------------------
# --list / the gap list every run prints
# ---------------------------------------------------------------------------------------------
print_matrix() {
	cat <<'EOF'
job/slice given here   ->  workflow job (build.yml)         ->  what it runs
------------------------------------------------------------------------------------------------
check                      check                                check-shell, scan-marker, check-acl,
                                                                 build-css, audit.py --strict, [gettext],
                                                                 update-po.sh --check
lint                       lint                                 lint:js, lint:css, unit tests,
                                                                 ci-playwright, a11y-gallery, size-budget,
                                                                 build-icons --check, export-tier,
                                                                 css-metrics, css-floor, fs-orphans,
                                                                 css-dup, css-i18n, mirror, axes,
                                                                 chrome-fence, table-contract,
                                                                 page-modules, conffiles, i18n-packages,
                                                                 bang-ok, changelog, build-jsmin+jsmin-verify
build                      build                                stage.sh, owfeed plan|check|build,
                                                                 check-packages.sh
verify                     verify                               owlab test x2 (25.12/apk, 24.10/opkg),
                                                                 the workflow's own 5 assertions;
                                                                 --mode push adds the feed-live check
live:parity                live (slice parity)                  spa-parity
live:audit                 live (slice audit)                   live-audit
live:motion                live (slice motion)                  upstream-contract, scroll-jank,
                                                                 table-tick, floor-contract, fit-quiet,
                                                                 scroll-anchor, install-check.sh
anchors:firefox             anchors (engine firefox)             scroll-anchor --engines firefox
anchors:webkit              anchors (engine webkit)              scroll-anchor --engines webkit
all                         every job above                      in build.yml's own dependency order
EOF
}

print_gaps() {
	cat <<'EOF'

Not reproduced by this script, and why (printed on every run, --list included):
  - `release` (sign & publish): needs secrets.OWFEED_AUTHOR_KEY and secrets.FOOTSTRAP_USIGN_KEY,
    runs only on a v* tag push. Never attempted — no local copy of either key exists.
  - `pages` (Pages mirror refresh): runs only after `release`, needs pages:write/id-token:write.
    Never attempted.
  - actions/upload-artifact + download-artifact, between `build` and {verify,live,anchors}: this
    script substitutes the same dist/ directory on disk, produced once and read by every later
    leg in the same run — proves the BYTES are right, not the artifact name, retention or
    permissions GitHub applies between jobs, which only the real workflow exercises.
  - job `timeout-minutes`: not enforced here. A hung step hangs until you Ctrl-C it; on GitHub it
    goes red on its own clock.
  - the apt-get fallback branches inside `check`'s gettext block and `ci-playwright.sh`'s
    install-deps step: only exercised when gettext / chromium's system libraries are missing,
    which they were not on this host. A GitHub-hosted runner image can still differ.
  - `live`/`anchors`: fully implemented, but refused by default (see --force above) because they
    boot/install onto this project's OWN named stands (owlab.yaml: owrt2512, owrt2410,
    owrtsnap) — the same ones a second session may already have to itself. `verify` is exempt:
    `owlab test` synthesizes its own ephemeral router in a scratch directory and never touches
    the named ones.
  - Hardware (dev-sync.sh, a real ssh router): out of scope for both this script and CI. Neither
    ever touches one; docs/development.md's hardware section is the only path there, and it is
    `ask` for a reason.
EOF
}

print_summary() {
	echo
	echo "== summary =="
	if [ -s "$RESULTS" ]; then
		while IFS='	' read -r n st _; do
			printf '  %-6s %s\n' "$st" "$n"
		done <"$RESULTS"
		# NOT `grep -c … || echo 0`: grep -c already PRINTS 0 on no match (it only exits 1), and
		# `||` runs inside the same command substitution — so a zero count captured both grep's own
		# "0" and the fallback's, one per line, and every count downstream read as two lines glued
		# together. grep -c's stdout is the whole answer; its exit status is not read at all.
		pass=$(grep -c '	PASS	' "$RESULTS" 2>/dev/null)
		fail=$(grep -c '	FAIL	' "$RESULTS" 2>/dev/null)
		adv=$(grep -c '	FAIL(advisory)	' "$RESULTS" 2>/dev/null)
		skp=$(grep -c '	SKIP	' "$RESULTS" 2>/dev/null)
		dry=$(grep -c '	DRY	' "$RESULTS" 2>/dev/null)
		total=$(wc -l <"$RESULTS" | tr -d ' ')
		echo
		echo "  $pass passed, $fail failed, $adv failed(advisory), $skp skipped, $dry dry-run, $total total"
	else
		echo "  nothing ran — see below for what tools/ci-local.sh could not do without more input"
	fi
	echo "  logs: $RUNDIR"
	print_gaps
}

# ---------------------------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------------------------
if [ "$LISTONLY" = 1 ]; then
	print_matrix
	print_gaps
	exit 0
fi

if [ -z "$JOBS" ]; then
	usage
	exit 2
fi

expand_jobs() {
	for j in $JOBS; do
		case "$j" in
		all)
			echo check
			echo lint
			echo build
			echo verify
			echo live:parity
			echo live:audit
			echo live:motion
			echo anchors:firefox
			echo anchors:webkit
			;;
		live)
			echo live:parity
			echo live:audit
			echo live:motion
			;;
		anchors)
			echo anchors:firefox
			echo anchors:webkit
			;;
		*) echo "$j" ;;
		esac
	done
}

for j in $(expand_jobs); do
	case "$j" in
	check) job_check ;;
	lint) job_lint ;;
	build) job_build ;;
	verify) job_verify ;;
	live:parity) job_live parity ;;
	live:audit) job_live audit ;;
	live:motion) job_live motion ;;
	anchors:firefox) job_anchors firefox ;;
	anchors:webkit) job_anchors webkit ;;
	esac
done

print_summary

if grep -q '	FAIL	' "$RESULTS" 2>/dev/null; then
	exit 1
fi
exit 0

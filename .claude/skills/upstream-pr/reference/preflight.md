# Preflight

Each check here costs one review remark that would otherwise arrive upstream and cost a branch
replay. **All of it, section 0 included, runs before the FIRST push**: on #9111 the bot needed two
rounds, and both times found what a local run catches. Done = every section below green.

**Who runs it.** The lead dispatches and quotes verdicts; it runs no gate and no stand. Sections 1,
2, 4, 5, 6 and 7 are one `tester` card (grade `task`, `live[]` = section 5's gates); section 3 is
the lead's (its own messages); section 0 is the `upstream-reviewer`, section 8 `/security-review`.

**Where.** The PR carries the latest release tag's tree, not `main`'s (`mechanics.md`, "The source
is the latest release tag"); once `main` moves past the tag, a check run on `main` grades code the
PR does not hold. Sections 1, 4, 5 and 7 therefore run inside `../tmp/fs-hist`, detached at the tag:

```sh
git -C ../tmp/fs-hist checkout --quiet --detach $(git describe --tags --abbrev=0)   # from our repo root
```

`git describe` inside `fs-hist` names its own HEAD's tag, so it is evaluated from our root. Sections
2, 3 and 6 read the luci clone and stay where they are. Section 5's `owlab sync` runs before section
4's compile.

## 0. Review of the branch diff

The `upstream-reviewer` agent (read-only, Opus) reads `git -C ../tmp/luci-pr diff origin/master..`:
orphaned probe comments, removed API with live references, a lost `+x` (100755 → 100644), double
blank lines, references outside the tree (`docs/`, `tools/`, `../tmp`, `#NNNN`), comments made false
by stripping, dead exports, visible behaviour changes with no word in the commit body; plus
`git diff --check`. A `CLEAN` verdict is the condition for the push.

`tools/sync-luci-fork.sh` already holds part of this (file modes from our index, probes stripped,
double blank lines checked against the source, `docs/*.md` references counted in its summary); its
output is read whole.

## 1. Our gates

```sh
npm run check          # exit 0
```

Outside `check`, run when the change touches them: `npm run fork-drift`, `npm run upstream`, and the
live gates (section 5).

## 2. Their eslint on our files

Upstream's config lists globals by hand and **does not read** the `'require X as Y'` pragma, so it
flags aliases missing from its list. Caught locally:

```sh
mkdir -p ../tmp/lintcheck && cp <changed .js> ../tmp/lintcheck/ && cp ../tmp/luci-pr/eslint.config.mjs ../tmp/lintcheck/
cd ../tmp/lintcheck && <repo>/node_modules/.bin/eslint --no-config-lookup -c ./eslint.config.mjs *.js | grep "is not defined"
```

A warning on an alias is their config's defect (24 of the tree's 30 aliases are unknown to it, 59
files in 18 packages) and the answer says so. A warning on a real typo is a fix.

## 3. Their formalities

`.github/formalities.json` in the luci clone is the machine gate in front of the build: subject soft
60 / hard 80, body required and not a repeat of the subject, `Signed-off-by` matching the author, a
real full name (no `@users.noreply.github.com`), branch not `master`/`main`, no merge commits, no
CRLF. Its body-line limit is 100; our wrap is 72, the single number for this skill.

```sh
awk 'length > 72 {print FILENAME": "FNR": "length}' <message files>   # empty
head -1 <file> | wc -c                                                # ≤ 61 with the newline
```

## 4. Templates compile

The host has no `ucode`; compile inside a running owlab stand (`owlab status` names it), on the
templates of the package installed there. Run section 5's `owlab sync` from `../tmp/fs-hist` first,
or the stand still holds whatever was synced last:

```sh
docker exec <stand container> sh -c 'for f in $(find /usr/share/ucode/luci/template/themes/footstrap -name "*.ut"); do
  ucode -T -c -o /dev/null "$f" || echo "FAILS: $f"; done; echo done'
```

## 5. Live

A behaviour change is ready once it has run on **both** package managers:

```sh
owlab sync owrt2512 owrt2410
tools/bg.sh node tools/scroll-anchor.mjs --engines chromium,firefox,webkit   # when fs-fit changed: T2
tools/bg-wait.sh <run-id>                                                   # run_in_background
```

`npm run live` takes no flags (it chains eight `npm run` calls; `docs/releasing.md` Step 4) and is
`ask` in settings: to re-run one gate with flags, call `node tools/<gate>.mjs` directly, core
stands only (`--only owrt2512,owrt2410`). CSS is proven by a computed-style or pixel diff against a
run of the same sheet: live counters alone move 0.5–1.3 %.

## 6. Drift

```sh
./tools/sync-luci-fork.sh ../luci-fork && npm run fork-drift
```

Only `Makefile` (kept by hand there), `po/` (Weblate) and `cascade.css` (built here, committed
there) legitimately differ. Anything else in DRIFT is an unsent change or a forgotten sync.

## 7. Size

Asked about twice; keep the numbers at hand.

```sh
node tools/size-budget.mjs --show      # JS per file, CSS, the cold page
du -sb luci-theme-footstrap/ucode luci-theme-footstrap/htdocs/luci-static/resources
```

## 8. Security review

Required before a PR (`CLAUDE.md`), on the final branch: `/security-review` reads
`git diff origin/HEAD...` of the directory it runs in, so run it from our repository on a commit
that carries the tag's tree over the previous synced tag — the recipe in `docs/releasing.md` Step 2.
First look: the signature chain in `install.sh`, new shell scripts, the login template
(unauthenticated), sinks in the browser JS, build pipeline changes.

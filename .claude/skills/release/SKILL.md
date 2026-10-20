---
name: release
description: Cut, tag and publish a footstrap release, or check whether main is ready for one. Use for релиз, выпускай, тег / делай тег, cut or tag a release, is the release ready.
argument-hint: <x.y.z>
---

# Cutting a release

A readiness question (готов ли main, is the release ready) runs step 1 alone and reports the
verdict with each command; steps 2-8 run only when the maintainer asked for the release.

The order and the gates; each step's detail is the matching step of `docs/releasing.md`, the single
source. The order is load-bearing: the tag points at a commit that already carries its own
changelog section, and every gate reads the sha the tag will name. `<v>` is the new version,
`<prev>` the last tag (`git describe --tags --abbrev=0`). Scratch output goes to `../tmp/release-<v>/`.

1. **Readiness** (autonomous except the dispatch below; any red stops here with an owner named):
   - scope the diff — `docs/releasing.md` Step 1 says which live checks it makes mandatory;
   - `gh run list --branch main -L1 --json conclusion,headSha,databaseId` → `success`, and
     `gh run view <id>` read job by job (`check`, `lint`, `build`, `verify`, `live`, `anchors`);
   - `gh workflow run build.yml --ref main` is the maintainer's word (CLAUDE.md, git-guard asks):
     ask with AskUserQuestion, the exact command in the option, unless their message named it;
     then `tools/bg.sh tools/ci-watch.sh --run <id> --max 6000`
     + `tools/bg-wait.sh <run-id>`: that run is the first reading of `deep` and `playground`, and the
     evidence for the stale-baseline prune (`docs/releasing.md` "The stale `live-audit` baseline");
   - `~/go/bin/owfeed lock` exits 0 both at the repo root and in a fresh
     `gh repo clone owfeed/owfeed-packages ../tmp/release-<v>/feed -- --depth 1` (without
     `--update` it only reads; a stale lock there reds the feed's `check / build` after the tag);
   - asset selection (issue #6) and the live rows for the touched areas (Steps 3 and 4): one
     `tester` card, `live[]` = those rows, `grade: release`; Done = its PASS verdict quoted.
   Done = every item above green, each with the command that showed it.
2. **Size pin**: `node tools/size-budget.mjs --pin`, after the last code fix, into the release commit.
3. **Release commit** (autonomous, its own Bash call): rename `[Unreleased]` in both changelogs and
   add the `compare/` links (runbook 1), `npm run changelog` green, then
   `git commit -m 'release: <v>'` and `git push origin main`.
4. **Security review of the whole release**, after the last code commit. `/security-review` reads
   `git diff origin/HEAD...`, which is empty on `main` after the push, so give it a commit whose
   only parent is `<prev>`:
   ```sh
   c=$(git commit-tree 'HEAD^{tree}' -p '<prev>^{commit}' -m 'security review <v>') \
     && git worktree add --detach ../tmp/sec-<v> "$c"
   ```
   Run `/security-review` with `../tmp/sec-<v>` as the working directory; its diff then equals
   `git diff <prev> HEAD`. Save the verdict to `../tmp/release-<v>/security.md`, then
   `git worktree remove ../tmp/sec-<v>`. Any finding goes to the maintainer before the tag.
5. **CI on the release sha**: `tools/bg.sh tools/ci-watch.sh --sha <sha> --max 6000` +
   `tools/bg-wait.sh <run-id>` in the same turn; read every job. On red, `tools/ci-log.sh <run-id>`,
   then a `tester` card reproducing the job (`tools/ci-local.sh --force <job>`) before the cause is
   named as diff, infrastructure or upstream feed. Done = the verdict line plus, on red, the card's
   reproduction result.
6. **Tag — the maintainer names it.** When their message already said so (tag, делай тег,
   release <v>), run it; otherwise ask with AskUserQuestion, both exact commands in the option:
   `git tag -a v<v> -m v<v>`, then `git push origin v<v>`. Each runs in its own Bash call, alone,
   the push only after the create exited 0.
7. **The tag's run**: `tools/ci-watch.sh --sha <sha>` as in step 5, every job read (`deep`,
   `playground`, `release`, `release-assets`); the release carries every asset plus its `.sig`
   (runbook 7). A red job is a fix commit and a new patch tag, again named by the maintainer.
8. **Feed** under the standing feed grant: `docs/releasing.md` runbook 8. Done = the served
   `Packages.gz` (24.10) and `packages.adb` (25.12) carry `<v>`.

Done = every job read on `main` and on the tag, the security verdict saved, the served feed on `<v>`.

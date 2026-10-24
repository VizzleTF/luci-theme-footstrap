# The pull request to openwrt/luci

The theme lives upstream since 2026-08-20. Code is almost always accepted; PRs bounce on **form**:
how the commits are cut and how long the messages are. The median commit body in openwrt/luci is
three lines and says WHAT changed.

## Order

1. **Split plan** — one upstream commit per independent concern; name each commit's subject and the
   tag commits it replays.
2. **Branch** — replay the latest release tag's states (never `main`) and cut the commits. Done =
   Step 3 prints `tip == tag`.
3. **Preflight, before the first push** — every section of [Preflight](#preflight) green.
4. **Messages** — written last, once the commit set is final: one or two sentences each.
5. **Publish** — PR body: one line per commit; links and `Closes #NNNN`
   live only here.
6. **Review** — [Answering review](#answering-review).

### How many commits

A release sync splits by concern — cleanup, API removal, router/SPA, security, CSS. The model is
the merged #9111 (sync with 0.14.14): six commits. A sync squashed into one commit was sent back for
exactly that. Small PRs: one fix, one commit.

### Message form

```
luci-theme-footstrap: lowercase description

What changed, one or two sentences, wrapped at 72 columns.

Signed-off-by: Ivan Kvashonkin <vizzlef@gmail.com>
```

| | upstream norm |
|---|---|
| body | median 3 lines, p90 15 |
| subject | median 47 chars, soft limit 60, hard 80 |
| links and `#NNNN` in the body | absent in 90 % of commits |
| wrap | **72 columns** (the bot's limit is 100; 72 is ours) |

Subject: package prefix, colon, lowercase, no final period; shared infrastructure (`luci.mk`)
takes `treewide:` (the bot rejects `luci.mk:`). Investigation and measurements live in our
changelog and code comments, not in the upstream body.

### Hard rules (each one paid for by a bounce)

- The commit body carries no `#NNNN` and no link: a force-push re-sends every mention.
- No compatibility with EOL releases (23.05 refused twice; 24.10 is next).
- The theme names no outside site and no repository of its own.
- No migrations "just in case": OpenWrt assumes a full image upgrade.
- `po/` stays out: Weblate owns it.
- Release branches (`openwrt-25.12`, …) take bug and security fixes only.
- `Makefile` is edited on the luci side by hand (`sync-luci-fork.sh` does not carry it), mirroring
  our postinst/postrm/conffiles changes.

### Already refused — do not offer again

1. 23.05 compatibility — "We are the upstream project. We don't need to keep adding compatibility
   code for old releases just because it happens to be possible".
2. A footer link to an outside site — "None of the other themes do that".
3. A long `uci-defaults` with old-version cleanup.

### Checklist before `gh pr create`

- [ ] one commit per concern
- [ ] each body one or two sentences, wrapped at 72, no links or `#NNNN`
- [ ] subject ≤ 60, lowercase after the colon, no period
- [ ] `Signed-off-by` on every commit; author is the real full name, never a
      `@users.noreply.github.com` address
- [ ] branch is not `master` and names the change
- [ ] preflight green, security review (Preflight 7) done
- [ ] `diff -r` tip == tag (Step 3)
- [ ] no `po/`, none of our build scripts; `Makefile` only as a mirror of ours

## Building the branch

Upstream keeps the built `cascade.css`, not `styles/`, so every PR commit carries its own slice of
the finished sheet: the branch is built by **replaying** states of our tree, never by moving
`main`'s commits across.

| Path | Role |
|---|---|
| `.` | our repository |
| `../tmp/fs-hist` | worktree of ours, for the replay |
| `../tmp/luci-pr` | THE clone of openwrt/luci: `origin` upstream, `fork` ours; all branch work here |
| `../tmp/luci-ref` | worktree of that clone, the reference for Step 3 |

**The source is the latest release tag** (`git describe --tags --abbrev=0`). A review fix rides on
top of the tag until the next release.

```sh
git worktree add --detach ../tmp/fs-hist $(git describe --tags --abbrev=0)   # when it is missing
LUCI=$(cd ../tmp/luci-pr && pwd)
git -C $LUCI config user.name "Ivan Kvashonkin"   # the global name bounces on formalities
git -C $LUCI fetch origin && git -C $LUCI checkout --quiet -B <branch> origin/master
```

### Step 1. Find where upstream matched us

Compare **every shipped file**, not `cascade.css` alone. Each candidate tag is synced into a clean
`origin/master` and `git status` is read; `Makefile` and `po/` are excluded.

```sh
for t in $(git tag --sort=-creatordate | head -10); do
  git -C $LUCI reset --quiet --hard origin/master
  git -C ../tmp/fs-hist checkout --quiet --detach $t
  (cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI >/dev/null 2>&1)
  n=$(git -C $LUCI status --porcelain -- themes/luci-theme-footstrap ':!themes/luci-theme-footstrap/Makefile' ':!themes/luci-theme-footstrap/po' | wc -l)
  echo "$t: $n files differ"
done
```

The first tag at zero is the base. With no zero, take the minimum: its list is what upstream fixed
on its own, carried into our tree before the replay.

### Step 2. Replay by the split plan

```sh
cd ../tmp/fs-hist && git checkout --quiet -B upstream-N <base>
pick() { for c in "$@"; do git cherry-pick -n -x $c >/dev/null 2>&1 || {
  git diff --name-only --diff-filter=U | while read -r f; do git checkout --theirs "$f"; git add "$f"; done; }; done; }

pick <commit> <commit> && git commit --quiet -m g1
```

`pick` resolves every conflict to the picked side silently — safe only because Step 3 compares the
tip with the tag. Moves needed in practice: drop part of a commit (`git checkout HEAD -- <file>`
after `pick`), move part into another group (`git checkout <commit> -- <file>`), skip a commit
(leave it out). A comment fix travels with the code it describes.

### Step 3. Tip == tag

Mandatory before cutting PR commits; the whole theme tree is compared, so a new file cannot drop out.

```sh
git -C $LUCI worktree add --detach ../tmp/luci-ref origin/master      # when it is missing
git -C ../tmp/fs-hist checkout --quiet --detach $(git describe --tags --abbrev=0)
REF=$(cd ../tmp/luci-ref && pwd)
(cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh "$REF")
git -C ../tmp/fs-hist checkout --quiet upstream-N
(cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI)
diff -r -x Makefile -x po ../tmp/luci-ref/themes/luci-theme-footstrap $LUCI/themes/luci-theme-footstrap && echo "tip == tag"
```

`sync-luci-fork.sh` exits 1 when a file mode differs from our index, or when a shipped file references something outside the tree (`../tmp/`,
`tools/`, a test file, stands, `issue #N`, a commit hash); read its whole output.

### Step 4. Cut the PR commits

```sh
git -C $LUCI checkout --quiet -B <branch> origin/master
i=1
for p in $(git -C ../tmp/fs-hist log --format=%h --reverse <base>..upstream-N); do
  git -C ../tmp/fs-hist checkout --quiet --detach $p
  (cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI >/dev/null) || break
  git -C $LUCI checkout --quiet origin/master -- themes/luci-theme-footstrap/po   # Weblate owns it
  git -C $LUCI add -A themes/luci-theme-footstrap
  git -C $LUCI diff --cached --quiet || git -C $LUCI commit --quiet -F <message file $i>
  i=$((i+1))
done
```

### Step 5. Read the branch diff

```sh
cd $LUCI
git log --format="%h %s" --stat origin/master..HEAD | grep -E "^[0-9a-f]{7,} |files? changed"
git diff --name-only origin/master..HEAD
git diff --check origin/master..HEAD
git log --format="%an <%ae>" origin/master..HEAD | sort -u
```

### Step 6. Publish

New PR:

```sh
git -C $LUCI push --quiet fork <branch> \
  && gh pr create --repo openwrt/luci --base master --head VizzleTF:<branch> --title "..." --body-file <file>
```

Update after review (the `&&` chain keeps the PR body unchanged when the push fails):

```sh
old=$(git -C $LUCI ls-remote fork refs/heads/<branch> | cut -f1) \
  && git -C $LUCI push --quiet --force-with-lease=<branch>:$old fork HEAD:<branch> \
  && gh pr edit <N> --repo openwrt/luci --body-file <file>
```

After the merge: `git worktree remove ../tmp/fs-hist`, `git -C $LUCI worktree remove ../tmp/luci-ref`.

### Traps

- The author must be "First Last"; the clone inherits the global `VizzleTF` and bounces.
- Upstream keeps `cascade.css` **unminified** and with **unmangled tokens** on purpose.

## Preflight

All of it runs before the **first** push: what the upstream bot flags, a local run catches. The PR carries the latest tag's tree, so sections 4, 5 and 6 run in
`../tmp/fs-hist` detached at the tag
(`git -C ../tmp/fs-hist checkout --quiet --detach $(git describe --tags --abbrev=0)` from our root).

0. **Review the branch diff** (`git -C ../tmp/luci-pr diff origin/master..`, with
   `git diff --raw` and `git diff --check` over the same range for modes and whitespace) for the classes the upstream bot flagged on #9111:
   1. a removed or renamed API still referenced in the tree (grep the old name);
   2. a lost executable bit (`--summary`, `mode change 100755 => 100644`, a `cgi-bin` file above all);
   3. double blank lines, trailing whitespace, missing final newline (`git diff --check`);
   4. references outside the tree in shipped files: `docs/`, `tools/`, `../tmp`, `#NNNN`, our repo
      URL, `owlab`/`owfeed`;
   5. dead exports nothing imports;
   6. a visible behaviour change the commit body does not mention;
   7. formalities (subject, body lines, `Signed-off-by`, no link in a body).
1. **Our check**: the tag's CI run has `e2e` green on both routers ([verifying.md](verifying.md)).
2. **Their eslint on our files**, from their checkout's own `package.json` — their config lists
   globals by hand and does not read the `'require X as Y'` pragma:
   ```sh
   cd ../tmp/luci-pr && npm install --ignore-scripts --no-save
   node_modules/.bin/eslint themes/luci-theme-footstrap/htdocs | grep "is not defined"
   ```
   A warning on an alias is their config's defect; a warning on a real typo is a fix.
3. **Their formalities** (`.github/formalities.json` in the clone): subject soft 60 / hard 80, body
   required and not a repeat of the subject, `Signed-off-by` matching the author, a real full name,
   branch not `master`/`main`, no merge commits, no CRLF.
   ```sh
   awk 'length > 72 {print FILENAME": "FNR": "length}' <message files>   # empty
   head -1 <file> | wc -c                                                # ≤ 61 with the newline
   ```
4. **Templates compile** in a stand, after section 5's `owlab sync` from `../tmp/fs-hist`:
   ```sh
   docker exec <stand container> sh -c 'for f in $(find /usr/share/ucode/luci/template/themes/footstrap -name "*.ut"); do
     ucode -T -c -o /dev/null "$f" || echo "FAILS: $f"; done; echo done'
   ```
5. **Live on both package managers**: `owlab sync owrt2512 owrt2410`.
6. **Size** (reviewers ask):
   `du -sb luci-theme-footstrap/ucode luci-theme-footstrap/htdocs/luci-static/resources`.
7. **Security review** of the final branch against the previous synced tag, as in
   [releasing.md](releasing.md) Step 2. First look: the signature chain in `install.sh`, new shell scripts, the login template (unauthenticated), sinks
   in the browser JS, build pipeline changes.

## Answering review

A remark is closed by a change in the diff and by resolving its thread.

**Watching**: `gh pr checks <N> --repo openwrt/luci --watch` for CI, and `gh pr view <N> --repo
openwrt/luci --comments` for reviews, comments and state. Done = `MERGED` or `CLOSED`.

**Humans first.** Before any bot event, read every review:
`gh api repos/openwrt/luci/pulls/<N>/reviews --jq '.[] | "=== \(.user.login) [\(.state)]\n\(.body)"'`.
A review by anyone other than `openwrt-ai` comes first.

### The bot (`openwrt-ai`)

1. **Measure whether it is right** — it is wrong noticeably more often than a person, and right
   often enough that every remark is checked.
2. A real defect: fix it on our `main` so the next tag carries it, and bring the same change into
   the commit it belongs to here (amend or fixup). Step 3 then runs against tag + fixes:
   ```sh
   git -C ../tmp/fs-hist checkout --quiet --detach <tag>
   git -C ../tmp/fs-hist cherry-pick <main fix sha>...
   REF=$(cd ../tmp/luci-ref && pwd)
   (cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh "$REF") &&
   diff -r -x Makefile -x po ../tmp/luci-ref/themes/luci-theme-footstrap ../tmp/luci-pr/themes/luci-theme-footstrap && echo "tip == tag"
   ```
   A cherry-pick conflict in `CHANGELOG*.md` takes the tag's side; one under
   `luci-theme-footstrap/` means the fix leans on post-tag `main` and must be ported in
   `../tmp/fs-hist`.
3. A false remark: no change, one line on why.
4. A remark on a comment is applied **verbatim**; any departure is shown as "bot suggests X / I
   suggest Y".

Resolve only threads fixed or measurably refuted, after the push lands.

### A person

Read it whole (never from the truncated notification) and give a verdict per point (we do it / the
reviewer is mistaken, here is why / needs a decision). Obvious fixes
go in at once; a disputed point waits.

### Commands

```sh
gh api repos/openwrt/luci/pulls/<N>/comments --jq '.[] | "=== \(.path):\(.line // .original_line)\n\(.body)"'

gh api graphql -f query='query { repository(owner:"openwrt", name:"luci") {
  pullRequest(number:<N>) { reviewThreads(first:30) { nodes { id isResolved path line
    comments(first:1){nodes{body}} } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not) | "\(.id)|\(.path):\(.line)"'

gh api graphql -f query='mutation($id: ID!) { resolveReviewThread(input:{threadId:$id}) { thread { isResolved } } }' -f id="<THREAD_ID>"

gh api repos/openwrt/luci/commits/$(git -C ../tmp/luci-pr rev-parse HEAD)/check-runs --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'
```

### Stance

- A thread is resolved only when fixed or refuted by measurement, never by explanation alone.
- "We are the upstream" wins: removing compatibility or moving a change to its own PR is cheaper to
  do than to argue.
- Reworking the form goes into the same branch with `--force-with-lease`; a PR is closed only when
  its subject changes.

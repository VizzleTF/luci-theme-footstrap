# Building the branch

Upstream keeps the built `cascade.css`, not `styles/`, so every PR commit carries its own slice of
the finished sheet: the branch is built by **replaying** states of our tree, never by moving `main`'s
commits across.

## Working copies

| Path | Role |
|---|---|
| `.` | our repository |
| `../tmp/fs-hist` | worktree of ours, for the replay |
| `../tmp/luci-pr` | THE clone of openwrt/luci for every PR: `origin` upstream, `fork` ours. All branch work happens here |
| `../tmp/luci-ref` | worktree of that clone, the reference for Step 3 |
| `../luci-fork` | drift report only: `npm run fork-drift`'s default target (`tools/fork-drift.mjs`), synced from `main` |

**The source is the latest release tag** (`git describe --tags --abbrev=0`): what goes upstream is
what was released. A review fix rides on top of the tag until the next release
(`answering-review.md`, step 2).

```sh
git worktree add --detach ../tmp/fs-hist $(git describe --tags --abbrev=0)   # when it is missing
LUCI=$(cd ../tmp/luci-pr && pwd)                  # the clone is $LUCI from here on
git -C $LUCI config user.name "Ivan Kvashonkin"   # the global name bounces on formalities
git -C $LUCI fetch origin && git -C $LUCI checkout --quiet -B <branch> origin/master
```

## Step 1. Find where upstream matched us

Compare **every shipped file**, not `cascade.css` alone (it matches while JS and templates differ).
Candidates are release tags, newest first; each one is synced into a clean `origin/master` and
`git status` is read. Git compares blob SHAs, so empty means every file matched; `Makefile` and `po/`
are kept there separately and excluded. This is also the check of what upstream currently ships.

```sh
for t in $(git tag --sort=-creatordate | head -10); do
  git -C $LUCI reset --quiet --hard origin/master
  git -C ../tmp/fs-hist checkout --quiet --detach $t
  (cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI >/dev/null 2>&1)
  n=$(git -C $LUCI status --porcelain -- themes/luci-theme-footstrap ':!themes/luci-theme-footstrap/Makefile' ':!themes/luci-theme-footstrap/po' | wc -l)
  echo "$t: $n files differ"
done
```

The first tag at zero is the base. With no zero, take the minimum: its `git status --porcelain` list
is what upstream fixed on its own, and that is carried into our tree before the replay.

## Step 2. Replay by the split plan

One group per upstream commit of the split plan: `cherry-pick -n` its tag commits, then one
`commit`. Group by concern, not by how the work went in our repository.

```sh
cd ../tmp/fs-hist && git checkout --quiet -B upstream-N <base>   # base from Step 1
pick() { for c in "$@"; do git cherry-pick -n -x $c >/dev/null 2>&1 || {
  git diff --name-only --diff-filter=U | while read -r f; do git checkout --theirs "$f"; git add "$f"; done; }; done; }

pick <commit> <commit> && git commit --quiet -m g1
```

`pick` resolves every conflict to the picked side (`--theirs`) without a word. That is safe only
because Step 3 compares the tip with the tag; a group built without Step 3 can carry a wrong
resolution upstream.

Moves that were needed in practice:

- **drop part of a commit**: after `pick`, restore the file:
  `git checkout HEAD -- luci-theme-footstrap/styles/theme/45-misc.css`;
- **move part into another group**: take the file from that commit: `git checkout <commit> -- <file>`;
- **skip a commit**: leave it out of `pick` (the 23.05 commits went this way);
- **a comment fix travels with the code it describes**, or the series shows one commit adding text
  and the next correcting it.

## Step 3. Tip == tag

Mandatory before cutting PR commits. The **whole theme tree** is compared with `diff -r`, so a new
file cannot drop out. The reference is the tag synced into a separate worktree of the clone.

```sh
git -C $LUCI worktree add --detach ../tmp/luci-ref origin/master      # when it is missing
git -C ../tmp/fs-hist checkout --quiet --detach $(git describe --tags --abbrev=0)
REF=$(cd ../tmp/luci-ref && pwd)    # from the repo root: $( ) inside the subshell runs after its cd
(cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh "$REF")
git -C ../tmp/fs-hist checkout --quiet upstream-N
(cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI)
diff -r -x Makefile -x po ../tmp/luci-ref/themes/luci-theme-footstrap $LUCI/themes/luci-theme-footstrap && echo "tip == tag"
```

`sync-luci-fork.sh` exits 1 when a file mode differs from our index, when probe stripping leaves a
double blank line, or when a shipped file references something outside the tree (`../tmp/`,
`tools/`, `tests/`, stands, `issue #N`, a commit hash); read its whole output.

## Step 4. Cut the PR commits

For each group: sync into the luci clone, then commit with its finished message.

```sh
git -C $LUCI checkout --quiet -B <branch> origin/master      # -B rebuilds the branch from scratch
i=1
for p in $(git -C ../tmp/fs-hist log --format=%h --reverse <base>..upstream-N); do
  git -C ../tmp/fs-hist checkout --quiet --detach $p
  (cd ../tmp/fs-hist && ./tools/sync-luci-fork.sh $LUCI >/dev/null) || break   # guard errors go to stderr
  git -C $LUCI checkout --quiet origin/master -- themes/luci-theme-footstrap/po   # Weblate owns the catalogues
  git -C $LUCI add -A themes/luci-theme-footstrap
  git -C $LUCI diff --cached --quiet || git -C $LUCI commit --quiet -F <message file $i>
  i=$((i+1))
done
```

`po/` is restored on every step because our catalogues differ in their path comments.

## Step 5. Read the branch diff

```sh
cd $LUCI
git log --format="%h %s" --stat origin/master..HEAD | grep -E "^[0-9a-f]{7,} |files? changed"
git diff --name-only origin/master..HEAD          # shipped files only; Makefile only as a mirror of ours
git diff --check origin/master..HEAD
git log --format="%an <%ae>" origin/master..HEAD | sort -u
```

## Step 6. Publish (the maintainer's word)

Show a one-line summary of the branch and the exact command; run it on the word, in the background
(one push took over 120 s).

A new PR:

```sh
git -C $LUCI push --quiet fork <branch> \
  && gh pr create --repo openwrt/luci --base master --head VizzleTF:<branch> --title "..." --body-file <file>
```

An update after review or a bot round (the bot's suggestion applied verbatim, then `commit --amend`):

```sh
old=$(git -C $LUCI ls-remote fork refs/heads/<branch> | cut -f1) \
  && git -C $LUCI push --quiet --force-with-lease=<branch>:$old fork HEAD:<branch> \
  && gh pr edit <N> --repo openwrt/luci --body-file <file>
```

The `&&` chain is the point: a failed push leaves the PR body as it was.

## Step 7. Clean up

After the merge: `git worktree remove ../tmp/fs-hist` and `git -C $LUCI worktree remove ../tmp/luci-ref`.

## Traps

- The author must be "First Last"; the clone inherits the global `VizzleTF` and bounces.
- `sync-luci-fork.sh` strips `/* fs:probe */` exports only when the worktree it runs from holds
  current `tools/sync-luci-fork.sh` and `luci-theme-footstrap/strip-build.sh`.
- Upstream keeps `cascade.css` **unminified** and with **unmangled tokens** on purpose: it is a source
  tree someone reviews.

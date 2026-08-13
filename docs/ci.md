# CI and packaging

How footstrap is turned into packages and shipped. The theme is noarch
(`LUCI_PKGARCH:=all`) and supports **OpenWrt 24.10** (`.ipk`/opkg) and **25.12+** (`.apk`/apk).

What the Makefile and the install scripts do: [package.md](package.md). The release runbook:
[releasing.md](releasing.md).

## The job graph

`.github/workflows/build.yml`. Triggers: push to `main`, a `v*` tag, any pull request, or a manual
dispatch.

```
check ─┐
       ├─→ build ─→ verify ─→ release ─→ pages     (release and after: tags only)
lint ──┘
```

| Job | What it is |
|---|---|
| `check` | static gates that need no node |
| `lint` | the npm gates: eslint, stylelint, axe-core, the ratchets |
| `build` | both package formats, via owfeed |
| `verify` | installs this very build on real 25.12 and 24.10 userlands and renders its pages |
| `release` | signs, generates the notes, attaches the assets |
| `pages` | refreshes the GitHub Pages portal and the release mirror |

`permissions: contents: read` at workflow level; only `release` declares write. It used to be
workflow-wide, which handed it to every `pull_request` run — including `npm ci` in lint, and
therefore to the lifecycle scripts of every dev dependency.

## `check` — gates without node

Needs only `sh`, `awk`, `python3` and `perl`. Seconds to run, and it cannot break the OpenWrt
buildbot, where node does not exist and never will.

1. **`sh -n`** over `luci-theme-footstrap/*.sh`, `install.sh` and `tools/*.sh` — the scripts that
   never reach a router. `tools/` is in the glob because `release-notes.sh` runs only in the
   `release` job, so a syntax error there used to surface at the most expensive possible moment.
   The *payload* scripts are parsed elsewhere: `owfeed doctor` (OWF213) parses everything under
   `files:` in the `build` job, which covers `/etc/uci-defaults/*` once `tools/stage.sh` has staged
   it.
2. **The scan marker.** `include/scan.mk` finds packages by grepping for `call BuildPackage`, which
   this Makefile only reaches through `luci.mk`'s include — so the literal in its trailing comment
   is what makes the SDK see the package at all. It has been deleted as boilerplate once.
3. **The ACL is valid JSON, and grants something.** rpcd skips an unreadable file in `acl.d` and
   says nothing: a stray comma means the grant is issued to nobody, and nothing else notices. A
   document that parses but is a list, or an entry with neither `read` nor `write`, is the same
   silent outcome by another route, so `tools/check-acl.sh` checks the shape too.
4. **`build-css.sh`** into a temp file — the script brace-balances its own output and refuses to
   write a suspiciously short file. That is a broken-build floor (80 KB), a correctness gate,
   not a size budget. There is no upper CSS budget any more.
5. **`audit.py --strict`** — undefined `var()`, shadowed declarations, export-tier reads from
   `styles/`, dead base declarations, stray `!important`, colour literals.
6. **i18n**: `update-po.sh --check` fails if the `.pot` is stale or any `msgstr` is empty. A string
   in `_()` with no translation renders in English silently — which is how the whole Footstrap
   tab stayed English on a Russian LuCI.

**Template compilation is not here** — it runs in `verify`, on the router, with the real `ucode`.
It used to clone the interpreter at a pinned commit and build it with cmake, with the router runtime
stubbed out through `-L`; the container has both for free and stubs nothing.

## `lint` — the npm gates

They live in CI only: the buildbot has no node and does not need it. Nothing in `package.json`
ships. Locally it is all one command, `npm run check`; the full table of what each gate holds is in
[conventions.md](conventions.md). The ones worth naming here:

| Step | What it catches |
|---|---|
| `eslint` | including `wrap-regex`, which forbids `return /re/…`, the form jsmin breaks on |
| `stylelint` | correctness and project invariants only — not a formatter |
| `a11y-gallery.mjs` | axe-core, WCAG 2.2 AA over `docs/gallery.html`, {light,dark} × {footstrap,hicontrast,bootstrap} × {untinted,60°,260°} — **18 combinations** |
| `export-tier.mjs` | the `--*-color-*` contract with foreign apps — axe cannot see it, their widgets are not in the gallery. 42 palette × mode × tint combinations, then the six untinted ones again with `prefers-contrast: more` emulated, since that query re-states the ink tokens and so publishes a second tier |
| `css-metrics.mjs` | ratchet: `!important` ≤ 27, max specificity, empty rules |
| `fs-orphans.mjs` | dead `fs-*` selectors (safe only inside our namespace) |
| `css-dup.mjs` | identical declaration bodies under different guards — no linter calls this an error |
| `mirror.mjs` | `@mirror`-pinned copies still byte-identical (CSS **and** shell) |
| `axes.mjs` | the pre-paint in `head.ut` agrees with the live appearance appliers |
| `chrome-fence.mjs` | the `[data-fs-chrome]` marker, fence and pin still match the chrome |
| `conffiles.mjs` | every shipped `/etc/config/*` is declared a conffile — else the manager replaces it on upgrade |
| `bang-ok.mjs` | the `!important` allowlist in `audit.py` and `.stylelintrc.json` still say the same thing |
| `changelog.mjs` | the changelog contract: sections, order, RU mirror, bold leads |
| `jsmin-verify.mjs` | the **only** check that catches jsmin's silent corruption (exit 0) |

**About `jsmin-verify`:** jsmin corrupts a file silently and exits 0. The source shape it breaks on,
and why eslint's `wrap-regex` stands beside this gate, are in [conventions.md](conventions.md); the
two minification paths are in [package.md](package.md). What CI adds is the proof: it builds that
same jsmin from `luci-base/src/jsmin.c` at the pinned commit and compares the token stream of the
output against the source (acorn). The list of shipped JS is not written by hand — it is
`find htdocs -name '*.js'`, because luci.mk copies `htdocs/` wholesale, so that *is* the shipped set.

Both gates stay mandatory **for the source**, even though the release build minifies with terser
instead: a build without node still hands the untouched source to jsmin.

There are no numeric size budgets left, for CSS, fonts or JS. Lightness is held by judgement.

Most of what the other jobs run lives in `tools/*.sh` rather than inline in the YAML —
`check-shell.sh`, `scan-marker.sh`, `check-acl.sh`, `build-jsmin.sh`,
`check-packages.sh`, `feed-key.sh`, `stage-release.sh`. A step that is a script can be run by hand
when it fails, and its reasoning lives beside the code instead of inside a workflow nobody reads.

## `build` — owfeed, not the SDK

Both formats are built by [owfeed](https://github.com/owfeed/owfeed) from one staged rootfs.
The SDK legs are gone: the theme is noarch (CSS, templates, browser JS, fonts — not one byte of
compiled code), and each leg downloaded, verified and unpacked a cross toolchain in order to run
`cp`. Twice, because 24.10 is opkg and 25.12 is apk.

| Format | Line | noarch spelling | What owfeed does |
|---|---|---|---|
| apk | 25.12+ | `noarch` (`all` is rejected as uninstallable) | `apk mkpkg` + `.conffiles` sidecars |
| ipk | 24.10 | `all` | an `ipkg-build` container + `CONTROL/conffiles` |

Three things the SDK really provided, owfeed does itself: it compiles `.po` → `.lmo` with its own
compiler (**byte-identical to `po2lmo`** — checked on release 0.11.6), emits the same sidecars as
`package-pack.mk`, and wraps the scripts in `default_postinst`/`default_prerm`, without which
`/etc/uci-defaults/*` never runs at all.

**The SDK check did not leave with the SDK.** owfeed extracts the host `apk` from a release SDK
tarball and keeps it on the same chain this workflow used to spell out: an ed25519 signature over
`sha256sums`, the branch key pinned from a *different* host (`github.com/openwrt/keyring`), and the
sha256 read only out of an already-authenticated file.

**owfeed itself is installed by its own action** — `owfeed/owfeed/setup`, pinned by commit — which
downloads the binary and **verifies it against GitHub's build attestation before it reaches PATH**.
That is why it is preferred to `go install …@<sha>`, which compiles the tool in every job and trusts
whatever the module proxy returns. A `SHA256SUMS` next to a release is not a check either — the same
host serves both the binary and the sum (the same argument this project makes about GitHub's asset
digest). An attestation is signed by GitHub's identity, sits in a public transparency log, and the
action pins the workflow that was allowed to issue it. Verified locally on a release binary:
genuine → exit 0; one byte appended → exit 1; against a foreign repository → exit 1.

The steps:

1. **Resolve the version** — from the tag (`v0.3.6` → `0.3.6`) or a fallback `0.<date>.<run>`. Plus
   `SOURCE_DATE_EPOCH` = the commit timestamp: both containers write mtimes, and a package's
   identity is a hash over its payload, so without a fixed epoch byte-identical content rebuilds
   into a package that *claims* to be new.
2. **`./tools/stage.sh`** — the half owfeed deliberately does not do ("packages a directory; does
   not build one"). It is `Build/Prepare` from the Makefile, step for step: build `cascade.css`,
   mangle the private `--fs-*` names, minify the JS with terser, strip comments out of the templates
   and the shell, stamp `FS_VERSION`. It also extracts postinst/postrm — by awk over the
   Makefile's `define`s, not as a second copy: a script that runs on somebody else's router months
   later is the worst possible place for two copies to diverge.
3. **`owfeed build`** — deliberately without `--frozen-lock`. That flag re-derives `owfeed.lock`
   from `downloads.openwrt.org` and fails if it moved, which is right for a repository that
   **publishes a feed**, where the covered architecture set is part of the contract with
   subscribers. Here two noarch packages ride as release assets and expand into no architectures, so
   the flag buys nothing and costs a red release on every OpenWrt point release. The committed lock
   still pins which SDK the host `apk` comes from, so the toolchain does not float.
4. **Assert the catalogues are in the package.** It is compiled in and absent from git, and a
   silently missing `.lmo` means every `_()` renders the English msgid with nobody reporting
   anything. Counted against the number of languages in the tree, so adding a language and
   forgetting is a red build rather than quiet English for some users.
5. **Flatten the packages into `dist/`** (owfeed writes `dist/noarch` and `dist/all`; apk derives
   the filename from name and version, so two architectures cannot share a directory). CI requires
   that the theme resolve to exactly one asset per format under a name-anchored regex
   (`luci-theme-footstrap[-_]…`). That is not hygiene, it is protection for old routers: see issue
   #6 in [conventions.md](conventions.md).

## `verify` — the package works on a real userland

Downloads the artifact and installs this build on real 25.12 and 24.10 containers through the
owlab action, then renders its pages. On non-PR runs it additionally fetches the feed's public key
and asserts the published feed serves a working theme.

That the build "produced an ipk" proves nothing about the ipk; this job is what does.

**Five assertions per leg**, and the fifth is the template gate:

```
package luci-theme-footstrap
file /www/luci-static/footstrap/cascade.css
http 200 /cgi-bin/luci/admin/status/overview
http 200 /cgi-bin/luci/admin/system/system
exec for f in …/themes/footstrap/*.ut; do ucode -T -c -o /dev/null "$f" || exit 1; done
```

`ucode -T -c` is LuCI's own trycompile, and it runs here against the installed templates with
the router's real `luci.core` and `uci` — no interpreter of ours, no stubs. It runs on both
legs: the templates are identical but the interpreters are not, and a construct 25.12's ucode
accepts is no proof that 24.10's does. Without it a stray brace in `header.ut` ships green and
silently moves every user's LuCI to another theme, because luci.mk copies `ucode/` verbatim and
nothing parses it on the way. The same assertions are what `owlab test` runs locally — see
[development.md](development.md), and keep the two in step.

## `release` — signing and publication

Tags only, and **it is a call into owfeed's own reusable workflow** rather than steps of ours:

```yaml
release:
  needs: [build, verify]
  if: startsWith(github.ref, 'refs/tags/v')
  uses: owfeed/owfeed/.github/workflows/package.yml@v0.5.0
  secrets:    { sign-key: …OWFEED_AUTHOR_KEY, usign-key: …FOOTSTRAP_USIGN_KEY }
  with:       { owfeed-version: v0.5.0, pre-release: sh tools/stage-release.sh,
                sign-also: install.sh, notes-file: dist/notes.md, verify-with: release.pub }
```

**This is the only job that holds a key**, and `needs: [build, verify]` is what stops a tag
publishing a package no router has installed.

`tools/stage-release.sh` is our half — the `pre-release` hook. It puts into `dist/` the two assets
that are not packages, before the manifest is written, because both are signed with everything else:

- **the notes**, from `tools/release-notes.sh` — the tag's changelog section, one bold lead per
  bullet, grouped by category. They are an *asset* as well as the release body, because the theme's
  confirm dialog reads them from the release rather than from `@.body`, which needed
  `api.github.com`;
- **the installer**, because the documented one-liner fetches it from `raw.githubusercontent.com`,
  which GitHub rate-limits for unauthenticated callers — so the very user whose IP has run out of
  budget (CGNAT, a shared exit) fails to download the installer meant to rescue them. Release assets
  are served from the release CDN and carry no such budget (issue #17).

`sign-also: install.sh` gets it a signature of its own (it is not a package, so owfeed would not see
it otherwise), and `verify-with: release.pub` re-checks every signature against the key that is in
the repository and baked into the installer.

Result: one theme asset per format plus its `.sig`, the manifest plus its `.sig`, the installer plus
its `.sig`, and the notes.

**About the manifest and readers in the field.** owfeed's format was copied from this project's own
manifest, with two differences, both safe by construction: the first line became
`owfeed-manifest 1` (nobody parses it), and the package architecture was appended to the end of
the `pkg` line. The order of the first six fields is untouchable: `install.sh` reads them positionally,
and a copy already on somebody's router cannot be fixed remotely — a field inserted before them
would make it fetch a URL that 404s. The workflow checks that order on every release rather than
relying on it.

## `pages`

Publishes the developer portal to GitHub Pages: `docs/devkit.html` (generated by
`tools/devkit-build.mjs`, never committed), `docs/playground.html` and `docs/gallery.html`, with a
freshly built `cascade.css` and the font/wallpaper assets beside them. It also carries a **full
mirror of the latest release** — the manifest, its signature, the notes **and the packages** — on a
different host from github.com, so an outage or a block covering one need not cover the other. It is
called by `release` rather than triggered by `on: release`, because an event raised by
`GITHUB_TOKEN` does not trigger another workflow.

The devkit assembles itself from files that already exist — the real stylesheet, the export tier
parsed out of `02-tokens.css`, the widget markup from `gallery.html` — so nothing is hand-copied and
nothing can drift.

## Installation and the trust chain

`install.sh` does one thing: it adds the owfeed-packages feed (key, repository entry, and a
`keep.d` entry so a sysupgrade does not lose the key) and installs the theme from there.
`apk upgrade` / `opkg upgrade` carries it forward afterwards, which is the whole reason to install
from a feed rather than from a file.

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

**The repository line goes into the manager's own customfeeds file**, `customfeeds.list` for apk and
`customfeeds.conf` for opkg — not into a file of the theme's own. apk reads every `*.list` under
`repositories.d/`, so a private file installs and upgrades just as well; what it cannot do is be
seen. LuCI's package manager reads exactly three apk paths — `repositories`,
`repositories.d/distfeeds.list`, `repositories.d/customfeeds.list` — in its rpcd ACL *and* hardcoded
in `package-manager.js`, so a feed anywhere else is absent from "Configure APK" and cannot be edited
or removed there. An installer from before this wrote `repositories.d/owfeed-packages.list`, which
is why the apk branch deletes that file after appending — the same repository configured twice, once
where the admin can see it and once where they cannot, is worse than either. Neither customfeeds
file needs a `keep.d` entry: both are conffiles of their manager (`apk-mbedtls`, `opkg`), sysupgrade
backs up every conffile whose checksum has moved, and `build_list_of_backup_overlay_files` was
already dropping the duplicate entry the script used to add.

**A snapshot router is served the newest release branch.** The feed publishes one branch per
OpenWrt minor and has no snapshot channel — owfeed-packages lists exactly two release lines and they
*are* the package-format split (apk from 25.12, ipk on 24.10), not a build of the theme per release.
So `SNAPSHOT`, which parses to no branch, gets the newest branch its own package manager can read:
`FALLBACK_BRANCHES_APK` / `_OPKG` in the script, probed newest-first against
`releases/<branch>/<arch>/<index>` rather than assumed, so a branch listed before it is published —
or one that does not carry this router's architecture — falls through instead of writing a
repository entry that 404s on every update. What makes it sound here and not in general: the theme
is noarch and `+luci-base` is its whole dependency list, so nothing in it was compiled against the
branch it comes from. The probe's bytes are discarded; the index it found is still verified below.
When no candidate answers, the script installs the signed release instead (below) rather than
refusing — measured in an `openwrt/rootfs` snapshot container (`apk add` from the 25.12 branch, no
`--allow-untrusted`, theme registered) and with the feed host pointed at a name that does not
resolve.

**Every downloader on the box is tried, not the first one that exists.** `uclient-fetch` needs
libustream-mbedtls to speak https at all, and an image that ships wget-ssl or curl instead carries
the binary without the library — so choosing by existence reported "the feed carries no branch for
this router" when the truth was "this one tool cannot do TLS here". Reproduced with a
`uclient-fetch` stub that always fails: the old script printed exactly the field report, the current
one falls through to `wget` and installs from the feed. None of the three is ever asked to skip
certificate verification; falling through to the next TOOL is not a downgrade.

**What verifies the bytes on the feed path is the package manager**, against the feed key pinned in
the script: apk checks the index against `owfeed-packages.pem`, opkg against usign key
`9040356b214084da`.

**There is no pinned-tag install, and the release-asset fallback is automatic but never the first
choice.** A router that cannot read the feed index at all — an architecture owfeed does not publish,
a resolver that does not answer, a network that intercepts the host — is installed from the release
instead of being sent away with a URL, and told plainly that `apk upgrade` will not carry the theme
forward until the feed works.

That path picks the artifact **from the signed manifest**, never by guessing an asset's name: issue
#6 was a self-updater that resolved the theme by name and took `head -1`, which on a release
carrying per-language packages installed a catalogue. `manifest.txt` names exactly one file per
format with its size and digest, and the chain fails closed in this order — verified TLS, then
`usign -V` against the release key pinned in the script (the same key as `release.pub`), then the
manifest's own sha256 over the downloaded artifact. A missing `usign`, a signature that does not
verify, or a digest that does not match is a refusal, and the script then prints the by-hand URL as
before. `apk`'s `--allow-untrusted` on this path says only that the `.apk` carries no APK signature
of its own; what is trusted is the usign signature over the manifest, checked before the file is
handed to the manager. Measured on 25.12/apk and 24.10/opkg containers, including the refusal: a
one-character change to the pinned key leaves nothing installed.

A router that wants an OLDER version still does it by hand — the feed carries one version per
branch — with the **raw file from a release**, never the zip artifact from Actions:

```sh
apk add --allow-untrusted luci-theme-footstrap-*.apk   # 25.12+
opkg install luci-theme-footstrap_*.ipk                # 24.10
```

`--allow-untrusted` means the package manager holds no key of ours. The release publishes a signed
`manifest.txt` and a detached `.sig` per asset, so a by-hand install can be checked with
`usign -V -m <pkg> -x <pkg>.sig -p release.pub` — which is what the installer's own fallback does
for you.

## Package formats, and the usual mistake

- **apk** (25.12+) — the Alpine apk-tools format, which OpenWrt adopted in 25.12.
- **ipk** (24.10) — gzip-tar: `./debian-binary` (2.0) + `./control.tar.gz` + `./data.tar.gz` with
  ustar headers. Identical to native OpenWrt ipks.

**"Malformed package file" from opkg** is almost always the wrong file: a GitHub artifact's zip
wrapper, or an `.apk` where an `.ipk` belongs.

An `.ipk` can be checked with a real opkg by hand — there is no such run in CI, and there was no
real proof before either, since "an SDK 24.10 produced it" was the same non-proof:

```sh
docker run --rm -v /path/pkg.ipk:/tmp/p.ipk openwrt/rootfs:x86-64-24.10.4 \
  sh -c 'mkdir -p /var/lock; opkg install --nodeps /tmp/p.ipk'
```

**All four lifecycle scripts are present in both containers.** The first version of owfeed emitted
only `postinst` and `prerm` into the ipk — the pair `package-pack.mk` generates, and easy to mistake
for the whole set — so `postrm` (unregistering the theme, putting `mediaurlbase` back) reached apk
and not opkg. Fixed before the first release built with it, and checked against the 0.11.6 SDK build:
all four agree in meaning, with only cosmetic differences.

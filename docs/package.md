# The package: source tree, Makefile, install scripts

Reference for what is where in `luci-theme-footstrap/`, what the Makefile does that a template
theme would not, and what runs on the router at install and removal time.

How the packages are actually built and published: [ci.md](ci.md).

## Source tree

```
luci-theme-footstrap/
├── Makefile
├── build-css.sh          styles/ → cascade.css (cat + awk, no node)
├── mangle-tokens.sh      shorten the private --fs-* names in a BUILT sheet
├── strip-templates.sh    drop {# … #} from .ut
├── strip-shell.sh        drop whole-line # from root/**.sh
├── build-apk.sh          SDK build, kept so the theme stays buildable without owfeed
├── dev-sync.sh           deploy to a HARDWARE router over ssh (containers use owlab)
├── update-po.sh          regenerate/verify the translation catalogue
├── luci-upstream.pin     pinned openwrt/luci commit + sha256 of the borrowed tools
├── styles/               CSS SOURCE. Not shipped — luci.mk does not copy it
├── i18n/                 translation catalogue. The directory name is NOT `po/` — see below
│   ├── templates/footstrap.pot
│   ├── ru/footstrap.po
│   └── es/footstrap.po
├── htdocs/luci-static/   → /www/luci-static/
│   ├── footstrap/        cascade.css (GENERATED, gitignored), fonts/, logo.svg
│   │                     (the doodle wallpapers are NOT here: wallpapers/ in the repo root,
│   │                      downloaded on demand — npm run wallpapers)
│   └── resources/        menu-footstrap.js, menu-footstrap-common.js, fs-*.js
├── root/                 → /
│   ├── etc/uci-defaults/30_luci-theme-footstrap
│   ├── etc/config/footstrap                      empty stub, written at runtime
│   ├── lib/upgrade/keep.d/luci-theme-footstrap   what sysupgrade carries across a flash
│   └── usr/share/rpcd/acl.d/luci-theme-footstrap.json
└── ucode/template/themes/footstrap/    → /usr/share/ucode/luci/template/…
    ├── header.ut  footer.ut  sysauth.ut
    └── partials/{head,brand,logout,notices,notice,search,icon,footer}.ut
```

`luci.mk` installs by directory presence — no install recipes needed:

| Source | Installed to |
|---|---|
| `ucode/*` | `/usr/share/ucode/luci/` |
| `htdocs/*` | `/www/` |
| `root/*` | `/` |
| `root/etc/uci-defaults/*` | picked up as `LUCI_DEFAULTS` |

Only `src/ luasrc/ htdocs/ root/ ucode/ po/` are copied verbatim. `styles/` is not in that list,
which is why `cascade.css` is generated in `Build/Prepare` straight into the build tree and is
absent from git.

**Never edit `cascade.css`.** Colours go in `styles/03-palettes.css`, scales and tokens in
`styles/02-tokens.css`. See [css.md](css.md).

## Makefile: what differs from a template theme

```makefile
PKG_NAME:=luci-theme-footstrap
LUCI_NAME:=luci-theme-footstrap   # pin: luci.mk keys the Build/Prepare hook name on LUCI_NAME,
                                  # which defaults to the checkout directory — the CSS build
                                  # would silently not run in a renamed checkout
FOOTSTRAP_VERSION?=               # CI injects it from the tag; locally the version is git-derived
LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base          # the WHOLE dependency list
LUCI_PKGARCH:=all                 # noarch: one build for every target
LUCI_MAINTAINER / LUCI_URL        # otherwise the package claims "OpenWrt LuCI community"
LUCI_MINIFY_CSS:=0                # see below
PKG_LICENSE:=Apache-2.0 OFL-1.1   # theme + webfonts; OFL §2 requires carrying the licence text
                                  # because the subsetter strips it out of the .woff2 metadata
include $(TOPDIR)/feeds/luci/luci.mk   # ABSOLUTE, not ../../luci.mk: CI rsyncs the package into
                                       # package/, not into the feed
```

**Do not set `PKG_VERSION`.** `luci.mk` derives it from git; CI injects `FOOTSTRAP_VERSION` from
the tag, because an SDK build has no `.git` to derive from.

### Minification: CSS off, JS on two paths

Two different tools; confusing them is expensive.

- **`LUCI_MINIFY_CSS:=0` is mandatory.** luci.mk's CSS minifier is **csstidy**, old enough to
  mangle `:has()`, `color-mix()` and nested `calc()`: the package installs and the layout falls
  apart. `build-css.sh` minifies instead — a string-aware awk pass of its own.
- **`LUCI_MINIFY_JS` has two paths.** A release CI build pre-minifies with **terser**
  (`tools/minify-js.mjs`, which can mangle identifiers — jsmin cannot) and sets
  `FOOTSTRAP_PREMIN=1`, which turns `LUCI_MINIFY_JS` to `0`; jsmin on top of terser output would
  reopen the `return /re/` trap on forms terser legitimately emits. A build **without** node (SDK
  user, buildbot) keeps the default `1`, and jsmin minifies the untouched source. Both paths
  matter: comments are ~60% of the JS source, and uhttpd serves `/www` **uncompressed**, so those
  are bytes on the wire and in flash.

  The source therefore has to stay jsmin-safe — see the regex rule in
  [conventions.md](conventions.md).

### `Build/Prepare` — seven steps, in this order

The hook (its name keys on `LUCI_NAME`) runs right after luci.mk copies the sources into
`PKG_BUILD_DIR`, and edits the **copy**:

1. **Copy `LICENSE`** into `PKG_BUILD_DIR` — `PKG_LICENSE_FILES` resolves against *that*, and
   luci.mk does not copy the package root.
2. **`build-css.sh`** → `cascade.css` in the build tree. `cat`/`awk` only, so it runs on the
   OpenWrt buildbot with no host toolchain.
3. **`mangle-tokens.sh`** — shorten the private `--fs-*` names, 16% of the sheet.
   **Before** step 4 on purpose: the reserved set is derived by reading the JS and the templates,
   so it must see them whole — and step 4 is what strips the template comments. It reads them from the **source** tree, never from
   `PKG_BUILD_DIR` — in CI the build tree's JS has already been through terser, its comments are
   gone, and five names that only appear in a comment would stop being reserved. That made the
   shipped sheet depend on *who* built it.
4. **`strip-templates.sh`** — `{# … #}` out of the `.ut` files, −16 KB of 39. Only the template
   comments; the ucode-code `/* … */` deliberately stays.
5. **`strip-shell.sh`** — whole-line `#` out of the shell under `root/`.
6. **Stamp `FS_VERSION`** into `fs-version.js` with `sed`. The path is part of the contract —
   `dev-sync.sh` and `tools/stage.sh` run the same substitution, so moving the constant means
   fixing three places.
7. **`po2lmo`** — compile the catalogue **into the theme package**.

### The catalogue lives in `i18n/`, and that is the most expensive structural rule here

`LUCI_LANGUAGES` in luci.mk is `$(wildcard po/*)`. With a `po/` directory present it bakes a
**separate `luci-i18n-footstrap-<lang>` package per language**. That is what v0.8.4 did, and it
**broke the Update button on every router in the field** (issue #6):

- the self-updater people had installed **at the time** picks its asset with
  `grep -E '\.apk$' | head -1`, and GitHub returns assets **sorted by name**;
  `luci-i18n-…` sorts before `luci-theme-…`. The button installed a 6 KB catalogue instead of the
  theme, reported success, and offered the same update forever.
- **A script already on somebody's router cannot be fixed remotely.** Only the *release* can be
  fixed: one asset per package per format, catalogue bundled inside the theme.
- Bonus: two packages drift apart, and a theme with a lagging catalogue just draws new strings in
  English without saying anything.

Renaming `po/` → `i18n/` is what stops the language packages being generated.

The `.lmo` basename is **`footstrap-theme.<lang>.lmo`**, not `footstrap.<lang>.lmo`.
`lmo_load_catalog` globs `*.<lang>.lmo` so any basename loads — but a v0.8.4 router still *owns*
`footstrap.ru.lmo` through the old package, and the same path means a file conflict, so apk would
refuse the very upgrade that fixes this.

## uci-defaults: registration

`root/etc/uci-defaults/30_luci-theme-footstrap` is the **single source of truth** for
registration (`dev-sync.sh` runs the same file; nothing else registers the theme).

- Registers **one** entry: `luci.themes.Footstrap=/luci-static/footstrap`. Layout, palette, mode
  and rounding are **client** switches on the Footstrap tab.
- The key in `themes.<Name>` is CamelCase without hyphens — a uci option-name limitation.
- Migrates `mediaurlbase`: legacy `-dark`/`-light`/`-top` paths onto the single path (plus
  `luci.main.footstrap_layout=top`, so a router coming from the old top-bar theme keeps its bar —
  a shell script cannot write `localStorage`); a dangling path goes back to `bootstrap`.
- Drops LuCI's index and module caches.

**It runs TWICE per install, not once.** Our `postinst` calls it, and OpenWrt's stock
`default_postinst` separately runs and then deletes every `/etc/uci-defaults/*` in the package.
The script is idempotent, so this is harmless.

**Fresh install vs upgrade is decided by a marker file**,
`/usr/share/luci-theme-footstrap/.installed`: written at the very end of the script (a run that
died halfway is still a fresh install), removed in `postrm` (so a reinstall is fresh again). A
fresh install may activate the theme; an upgrade must never change the active one.

`[ "$PKG_UPGRADE" != 1 ]` — the classic idiom — is **dead here**: apk never exports the variable
and neither does our postinst, so the branch was only ever taken by `dev-sync.sh`, which exports
it by hand. An upgrade that found an empty `mediaurlbase` switched the theme on behind the user's
back.

## postinst / postrm

`postinst` re-runs uci-defaults, clears the LuCI caches and does **`rpcd reload`, never
`restart`**: rpcd holds sessions in memory, and a restart logs out every LuCI user — including
the admin who just clicked Update. `reload` sends SIGHUP, which re-reads
`/usr/share/rpcd/acl.d/*`, the only thing this package needs from rpcd.

`postrm` is not a one-liner:

- deletes **all eight** theme names the package has ever registered (`Footstrap`,
  `FootstrapDark/Light`, `FootstrapTop{,Dark,Light}`, `FootstrapSidebar`, `FootstrapOnTop`). The
  list is necessarily duplicated in uci-defaults — postrm runs when that file is already gone —
  so it is pinned with `@mirror theme/legacy-names` and the copies cannot drift;
- deletes `luci.main.footstrap_layout` — meaningless to another theme, and left behind it would
  quietly bring the top bar back on reinstall;
- if our theme is still active, moves `mediaurlbase` back to bootstrap on a **two-part** check
  (both the media directory *and* the ucode template must exist: a one-sided check would hand the
  UI to a half-removed bootstrap, which is the white page this branch was written for);
- removes `/usr/share/luci-theme-footstrap` (marker included) and does `rpcd reload`.

## `/etc/config/footstrap` must be a conffile

The package ships `root/etc/config/footstrap` as an **empty stub that is written at runtime**:
"Save as default" has rpcd uci-set the router-wide axes into that very file
(`saveAsDefault()` in `fs-prefs.js`).

With no `conffiles` define, the package manager owns it as an ordinary file and **replaces it on
upgrade** — so the admin's saved defaults were wiped by the theme's own one-click Update, silently,
and reported as success. Measured on a live router: it held eight options, was package-owned, and
had no `.conffiles` entry beside base-files' and dnsmasq's.

Nothing observable fails when this regresses — the wipe happens on somebody else's router, months
later — so `npm run conffiles` gates it: every shipped `/etc/config/*` must be declared.

The uploaded background is the sibling case with the other answer. `/etc/footstrap/login-bg` is
written at runtime too, but it lives outside `/etc/config`, so a package upgrade never touches it
and a conffile entry would be rejected (the package does not ship that path). What *would* eat it is
a firmware **sysupgrade**, which keeps only what is listed — hence
`root/lib/upgrade/keep.d/luci-theme-footstrap`.

## ACL

`root/usr/share/rpcd/acl.d/luci-theme-footstrap.json` grants what the Footstrap tab needs to persist
a router-wide default and a login background:

- `uci` `set`/`commit`, scoped to the `footstrap` config — "Save as default";
- `cgi-io upload` plus `file` `write`/`remove` on `/etc/footstrap/login-bg` — the wallpaper photo;
- `file exec` on the single literal command `/bin/chmod 644 /etc/footstrap/login-bg`.

That `file.exec` is the only one the theme ships, and it is one fixed argument-complete command.
There is no grant for self-update, because there is no self-update: the theme upgrades through the
package feed the installer adds.

rpcd **skips an unreadable file in `acl.d` and says nothing**, so a stray comma means the grant
is issued to nobody and nothing else notices. `npm run acl` (`tools/check-acl.sh`, also a step in
CI's `check` job) parses every shipped `acl.d/*.json` and additionally rejects a document that
parses but grants nothing — a list instead of an object, or an entry with neither `read` nor
`write`, both of which rpcd accepts just as quietly.

A related trap the page had to solve: `rpc.js` only raises on the ubus status code when the
declaration asks it to (`reject: true`). Without it, a per-config ACL refusal — `uci` granted,
`footstrap` not — **resolves** with status 6 (permission denied) and every `.then()` runs as if the
file had been written.

## `luci-upstream.pin`

The single source for the pinned `openwrt/luci` commit and the sha256 of the two borrowed tools
that CI **downloads and RUNS** as gates:

- `luci-base/src/jsmin.c` — decides whether the shipped JS is safe;
- `build/i18n-scan.pl` — decides whether the catalogue is complete. It lexes `.ut` (rewriting the
  template into JS before xgettext) and picks up the title from the rpcd ACL; a `grep` for
  `_('…')` does neither.

Taken from a moving `master`, these gates would be "whatever upstream pushed last"; the sha256
says so out loud. The same file pins `USIGN_PIN` (so the signer in CI and the verifier in the field
are the same code) and `OPENWRT_KEYRING_PIN` — the commit of `openwrt/keyring` the release SDK's
signing keys are read from, pinned from a *different* host than the tarball they verify.

It deliberately pins **no ucode**. The template compile-check moved into the `verify` containers,
where the router's own interpreter runs it against the installed templates on both release lines
([ci.md](ci.md)) — so there is no interpreter to build and no commit to keep current, and the file
says so in place to stop the pin coming back.

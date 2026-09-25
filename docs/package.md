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
├── strip-templates.sh    drop the comments from .ut (template and whole-line code)
├── strip-shell.sh        drop whole-line # from root/**.sh
├── build-apk.sh          SDK build, kept so the theme stays buildable without owfeed
├── dev-sync.sh           deploy to a HARDWARE router over ssh (containers use owlab)
├── update-po.sh          regenerate/verify the translation catalogue
├── luci-upstream.pin     pinned openwrt/luci commit + sha256 of the borrowed tools
├── styles/               CSS SOURCE. Not shipped — luci.mk does not copy it
├── po/                   translation catalogue; luci.mk turns it into luci-i18n-* packages
│   ├── templates/footstrap.pot
│   ├── ru/footstrap.po
│   └── es/footstrap.po
├── htdocs/luci-static/   → /www/luci-static/
│   ├── footstrap/        cascade.css (GENERATED, gitignored), logo.svg,
│   │                     manifest.json + app-icon-192.png (ONE raster: every browser that
│   │                     installs a page picks the largest icon and downscales, and iOS reads
│   │                     the apple-touch-icon LINK, which points at the same file)
│   │                     (the raster is COMMITTED and made by tools/build-icons.mjs — the
│   │                      buildbot has no browser; `npm run icons` proves it matches logo.svg)
│   │                     (pattern.svg and fonts/ are NOT here: they are symlinks uci-defaults
│   │                      makes to /etc/footstrap/, which the admin uploads or installs)
│   └── resources/        menu-footstrap.js, menu-footstrap-common.js, fs-*.js
├── root/                 → /
│   ├── etc/uci-defaults/30_luci-theme-footstrap
│   ├── etc/config/footstrap                      empty stub, written at runtime
│   ├── lib/upgrade/keep.d/luci-theme-footstrap   what sysupgrade carries across a flash
│   └── usr/share/rpcd/acl.d/luci-theme-footstrap.json
└── ucode/template/themes/footstrap/    → /usr/share/ucode/luci/template/…
    ├── header.ut  footer.ut  sysauth.ut
    └── partials/{head,brand,logout,notices,notice,search,icon}.ut
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

**The web manifest is a static file, and that is a constraint, not a shortcut.** A theme may not
register a dispatcher node — it would outlive the theme that registered it — so there is nothing that
could render the manifest per request. Two values are fixed by that: `start_url`/`scope` are
`/cgi-bin/luci/`, uhttpd's own default, and `background_color`/`theme_color` are the DEFAULT palette's
page colour, since the manifest is read once at install time and cannot follow a live Appearance
change (it paints the splash and the installed window's chrome, never the page). Chrome's install
prompt needs a secure context, so over plain HTTP what this buys is iOS's Add to Home Screen — which
reads the `apple-touch-icon` link rather than the manifest — plus the icon itself. Regenerate it with
`node tools/build-icons.mjs` whenever `logo.svg` changes; `npm run icons` fails if you forget.

The committed file is **quantised to a 32-colour palette**, which is 4.6 KB where the browser's own
RGBA screenshot is 15.7 KB: the picture is a flat background, one ink colour and the ramp between
them, so a palette is the right encoding and the worst channel moves by 18 of 255 on 0.2% of the
pixels. That step is the one thing in this repo that wants **ImageMagick**, and only when
regenerating — `npm run icons` compares PIXELS in the browser it already runs, so a different
ImageMagick version is not a failure and a redrawn logo still is. Nothing in luci-base could stand in
for the icon, which is worth stating: it ships functional glyphs (interfaces, signal bars, ports) and
no logo or raster of any kind, and every theme carries its own.

## Makefile: what differs from a template theme

```makefile
PKG_NAME:=luci-theme-footstrap
LUCI_NAME:=luci-theme-footstrap   # pin: luci.mk keys the Build/Prepare hook name on LUCI_NAME,
                                  # which defaults to the checkout directory — the CSS build
                                  # would silently not run in a renamed checkout
LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base          # the WHOLE dependency list
LUCI_PKGARCH:=all                 # noarch: one build for every target
LUCI_MAINTAINER / LUCI_URL        # otherwise the package claims "OpenWrt LuCI community"
LUCI_MINIFY_CSS:=0                # see below
PKG_LICENSE:=Apache-2.0           # the theme, and nothing else: it carries no webfonts
include $(TOPDIR)/feeds/luci/luci.mk   # ABSOLUTE, not ../../luci.mk: CI rsyncs the package into
                                       # package/, not into the feed
```

**Do not set `PKG_VERSION`.** `luci.mk` derives it from git via `PKG_SRC_VERSION`, and nothing in
this Makefile overrides it. The release is built by owfeed (`tools/stage.sh`), never through the
SDK, so a Makefile-side version override has nothing left to set it: CI's SDK-build release leg
set `FOOTSTRAP_VERSION` until it was retired for owfeed (e574d6d), and the `FOOTSTRAP_VERSION?=`
knob outlived that leg with no remaining setter — `git grep FOOTSTRAP_VERSION` across `.github/`,
`tools/` and `owfeed.yml` found none, and the knob was dropped.

### Minification: CSS off, JS on two paths

Two different tools; confusing them is expensive.

- **`LUCI_MINIFY_CSS:=0` is mandatory.** luci.mk's CSS minifier is **csstidy**, old enough to
  mangle `:has()`, `color-mix()` and nested `calc()`: the package installs and the layout falls
  apart. `build-css.sh` minifies instead — a string-aware awk pass of its own.
- **The two JS paths are two separate pipelines, not a knob.** The release is built by owfeed
  (`tools/stage.sh`), which pre-minifies with **terser** (`tools/minify-js.mjs`, which can mangle
  identifiers — jsmin cannot) and never touches `luci.mk`, so jsmin never runs over terser's
  output. An SDK or buildbot build never calls `tools/stage.sh`, so it keeps `luci.mk`'s own
  default (`LUCI_MINIFY_JS?=1`) and jsmins the untouched source. Nothing sets `LUCI_MINIFY_JS` in
  the Makefile any more — until 0.14.x it did, gated on a `FOOTSTRAP_PREMIN` variable that only
  CI's SDK-build release leg set, and nothing set after that leg was retired in v0.11.7. Both
  paths matter: comments are ~60% of the JS source, and uhttpd serves `/www` **uncompressed**, so
  those are bytes on the wire and in flash.

  The source therefore has to stay jsmin-safe — see the regex rule in
  [conventions.md](conventions.md).

### `Build/Prepare` — six steps, in this order

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
4. **`strip-templates.sh`** — the comments out of the `.ut` files: `{# … #}` template comments, and
   `/* … */` code comments **that own their lines**, wherever they sit (ucode inside `{% … %}`,
   JavaScript inside an inline `<script>`, CSS inside an inline `<style>`). 63 KB of templates
   become 21 KB, which is **−7.4 KB of the compressed package** — it went from 72.4 KB to 65.2 KB —
   and −7 KB on every page the router serves, since uhttpd serves `/www` uncompressed.

   The rule is what makes this safe, and it is not "remove `/* … */`": a comment is removed only
   when `/*` is the first non-blank thing on its line and `*/` the last on its (possibly later)
   line. To eat live code, a string literal would have to span lines *and* contain a line that is
   nothing but a comment; measured across every `.ut` here, 18362 of 18362 comment bytes are
   whole-line, none are inline, and no multi-line template literal contains a line-leading `/*`.
   Anything that does not fit the rule is left in place and counted — the tree has exactly one such
   case today, the glob `` `/usr/lib/lua/luci/i18n/*.${lang}.lmo` ``, whose `/*` is in a string.
   Verified on a live router, not only by reading: the pages the stripped templates serve are
   byte-identical to the ones the source templates serve, once the comments are removed from both
   (the only remaining difference is the session id).
5. **`strip-shell.sh`** — whole-line `#` out of the shell under `root/`.
6. **Stamp `FS_VERSION`** into `fs-version.js` with `sed`. The path is part of the contract —
   `dev-sync.sh` and `tools/stage.sh` run the same substitution, so moving the constant means
   fixing three places.
### The catalogue lives in `po/`, and luci.mk owns it

`LUCI_LANGUAGES` in luci.mk is `$(wildcard po/*)`, so a `po/` directory makes it bake a
`luci-i18n-footstrap-<lang>` package per language — the ordinary arrangement for everything in the
luci tree, and the only one [Weblate](https://hosted.weblate.org/engage/openwrt/) can translate,
which `CONTRIBUTING.md` names as *the* way to translate LuCI. Nothing in this package's own
`Build/Prepare` touches the catalogue.

The release is built by owfeed, not luci.mk. From 0.14.4 the owfeed build emits the same set
luci.mk would: **`luci-theme-footstrap`, plus one `luci-i18n-footstrap-<lang>` per language**, with
the catalogue at `footstrap.<lang>.lmo` and a `uci-defaults` line registering the language in
LuCI's own menu. `tools/stage.sh` builds the per-language staging trees, `owfeed.yml` declares one
package each, and `tools/i18n-packages.mjs` fails the build when those three lists disagree.

Between v0.12.x and 0.14.3 the catalogues rode **inside** the theme under the basename
`footstrap-theme.<lang>.lmo`. That cost every router 10,992 B of flash and 4,821 B of the `.apk`,
including the majority reading English, and it was the bundling that forced the odd basename in the
first place — a router still owning `footstrap.<lang>.lmo` through the old language package would
otherwise have hit a file conflict. Split back out under luci.mk's own names, that conflict is an
ordinary upgrade of the same package instead. Measured on both stands: upgrading the theme takes the
old `footstrap-theme.*.lmo` away with it, and installing `luci-i18n-footstrap-ru` puts
`footstrap.ru.lmo` down in its place, with `luci.languages.ru` registered and the chrome rendering
in Russian.

`update-po.sh`'s single `trap … EXIT INT TERM` covers every mktemp the script creates, including the
ones on the `LUCI_SRC` (no-fetch) path — it used to be installed only inside the fetch branch, so a
`set -eu` failure between mktemps on the `LUCI_SRC` path (perl choking on a template, the exact
stale-`.pot` case the script exists to catch) leaked them.

**A package manager cannot read `uci luci.main.lang`, so the catalogue has to install itself.**
`depends` points from the catalogue to the theme, which means installing or upgrading the THEME
pulls in nothing: measured on a stand, a Russian router on 0.14.3 taking 0.14.4 through the feed lost
every `.lmo` with the old package and gained no new one — English theme, nothing said why (issue
#41). Three mechanisms cover the three ways a router can arrive at the new shape, and none of them
covers all of it:

| path | what carries it |
|---|---|
| `install.sh`, install or re-run | reads `luci.main.lang` and fetches the catalogue, from the feed or — when the feed has not got it yet — from the signed release, pinned to the tag the installed theme came from |
| `apk upgrade` on 25.12+ | `install-if: luci-theme-footstrap={version} luci-i18n-base-<lang>` in `owfeed.yml`: apk installs the catalogue by itself once the theme is at that version and the router already carries that language's LuCI base. The pin re-fires the rule on every theme upgrade |
| `opkg upgrade` on 24.10 | nothing. opkg's `Recommends:` is executed but unconditional — it would put Russian on every 24.10 router — and a postinst cannot call opkg, which holds an exclusive lock for the whole run. This leg is `install.sh` or nothing |

`install-if` needs at least two entries with one pinned by `=` (apk-package(5)); `{version}` is
expanded by owfeed to the version being built, so a release does not hand-edit the pin.

Where none of the three fired, the Appearance tab says so: it asks `_('Layout', 'footstrap')` — a
string every catalogue carries — and, when the answer comes back untranslated on a non-English
router, names the package. That check is why `Appearance` is the wrong string to test: it is
obsolete in the catalogues (`#~ msgid`) and reported "not translated" on a router whose Russian
catalogue was installed and working.

`install.sh` reads `luci.main.lang` after installing the theme and fetches the matching package
best-effort, so the split does not silently un-translate a router on the upgrade that introduces it.
A language with no catalogue, `en`, and `auto` are all no-ops there. **A feed that does not carry
the catalogue is not the end of that path**: a new package reaches owfeed-packages through a pull
request against it, so `luci-i18n-footstrap-ru` and `-es` were absent from the feed for as long as
that took while the signed assets sat in the release — the installer falls back to the release,
through the same verified chain, and pins it to the tag the INSTALLED theme came from rather than to
`latest`, because the feed trails the release by up to a day and a catalogue knows only the strings
of its own version. `tools/check-packages.sh`
asserts one theme package per format, one catalogue per language package, and none in the theme.

## install.sh: fetch, verify, install

`install.sh` is the standalone `wget -qO- … | sh` installer, run as root on a box whose only
guaranteed shell is busybox ash. Two paths, chosen by whether the feed can be read:

- **Feed path** (the normal case): writes one repository line, so `apk upgrade`/`opkg upgrade`
  carries the theme forward on every later run.
- **Release path**: the feed cannot be read for this router (an architecture owfeed does not
  publish, or the router cannot reach it at all) — no feed line is ever written for a feed that
  failed, and the closing message says `$PM upgrade` will **not** carry the theme forward. A 23.05
  router always takes this path, pinned to `v0.14.2` (`FROZEN_2305_TAG`): that release is the last
  one that runs there — `ui.RangeSlider` needs 24.10 — and openwrt/luci declined to carry
  compatibility code for a release it no longer builds
  ([#8978](https://github.com/openwrt/luci/issues/8978)).

Both paths end in the same `finish()` (cache clear, rpcd reload, the version-report line, the
"Select Footstrap" hint); `report_version()` inside it is the only place the two paths' wording
still forks, because the release path has no repository to ask "is something newer available".

### The trust chain

TLS (verified, never `-k`), then an ed25519 **usign** signature over `manifest.txt`, then the
manifest's own sha256 over the artifact — in that order, and it fails **closed**: a missing usign
binary, a missing `.sig`, or a digest that does not match refuses the install rather than
downgrading it. `apk add --allow-untrusted` only waives the `.apk`'s own APK-level signature; the
usign signature over the manifest is what this path actually trusts, and it is checked first.

The artifact is picked from the signed manifest by an exact `pkg <name> <format>` match, never by
guessing a filename — resolving the theme by name and taking the first match once installed a
translation catalogue instead of the theme, because GitHub returns release assets sorted by name
and `luci-i18n-…` sorts before `luci-theme-…` (issue #6). `RELEASE_BASE` points at
`releases/latest/download`, never `api.github.com`: the API is rate-limited per source IP
(60/hour, shared by everyone behind one CGNAT — issue #17), and would need JSON parsing on a box
that may have no `jsonfilter`.

### `feed_refresh`: a dead feed of ours, not just *a* dead feed

`apk update`/`opkg update` both exit non-zero the instant **any** configured feed is unreachable,
even when the rest answered — this project's own CI snapshot stand hit it against a stale kmods
sub-index it kept past the feed's retention window (CI run 34112646188). A bare `|| exit 1` there
took the whole install down before the theme was ever fetched, so the tolerance has to tell "some
other feed is down" from "ours is down" without trusting either manager's own exit code: with
*every* feed unreachable, apk still prints a "packages available" count sourced from the
**installed** database, not from anything just read (owfeed/owlab#18), and opkg prints no summary
line at all. So the tolerance counts each manager's own per-feed failure lines against how many
feeds were **configured** (apk: the `N unavailable,` count; opkg: one `*** Failed to download the
package list` line per dead feed — measured on 24.10.8, one dead feed of eight gives two
diagnostic lines and exit 1, four of eight gives eight lines and exit 4). Whatever the count, our
own feed failing is never tolerated: `repo.owfeed.org` is a distinct host from the stock feeds, so
an on-path/DNS attacker can blackhole it alone while the rest answer, and an earlier
`bad < total` tolerance let that read as success on a stale index (security review, task 0176).

### The feed-list rewrite: R1–R4

`disable_other_lines()` and `ensure_first()` keep `customfeeds.list`/`customfeeds.conf` in the
shape the package manager will actually read, atomically (`atomic_write()`). Four invariants, each
earned by a real report:

| Rule | Invariant | What broke without it |
|---|---|---|
| R1 | The written line is matched **exactly**, never as a substring | `grep -q "$FEED_HOST"` matched a commented, tagged or other-branch/arch line while apk read none of them (forum.openwrt.org/t/251930#160) |
| R2 | The correct line is placed **first**, and **moved** there even if already present elsewhere | An installer that only ever appended left the line stuck behind an admin's own unparsable line forever — apk's repository reader stops at the first line it cannot tokenise, so "is the line present" stayed true while apk never reached it (tester finding, `m6a-apk.sh` #6) |
| R3 | Every **other** active line naming us is commented out (never deleted) and reported | One leftover or malformed line sitting above the correct one can shadow the whole feed with no error at all (security review, task 0176-e, `m5a-apk.sh`) |
| R4 | "Nothing changed" is asked of the package manager (`feed_offer()`), never inferred from "the version did not move" | `apk add`/`opkg install` on an already-satisfied package exits 0 whether or not the feed carries something newer — issues #16, #28, #30, and a router whose feed line apk never read being told "already current" (forum.openwrt.org/t/251930#160) |

The opkg leg matches on the host (`OPKG_HOST_RE`) **or** on the `src`/`src/gz` NAME field being
ours (`OPKG_NAME_RE`) regardless of host — the two checks differ in case-sensitivity on purpose:
the host check is case-insensitive (as `grep -Eqi` always was here), the name field is an exact,
case-sensitive match. Getting that reversed matters in practice: busybox awk has no `IGNORECASE`,
so the host check is done by lowercasing both sides, and the regex text itself has to reach awk
through `ENVIRON` rather than `-v` — awk's own `-v var=value` runs escape processing over `value`
first, which silently turns `\.` back into a bare `.` (measured: the exact hole `FEED_HOST_ESC`
exists to close, "any character" instead of a literal dot). `ENVIRON` reads the environment string
verbatim, so the escaped dot survives into the regex that reaches the router.

A line whose NAME field is ours but carries a trailing CR (`src/gz owfeed-packages\r`, no URL) is
now disabled too — HEAD's shell word-split left the `\r` glued to the field, so it never matched
`$FEED_NAME` and the line stayed active, which is what opkg's own "Duplicate src declaration"
against a legitimate second `owfeed-packages` line was diagnosing. The CR-stripped regex match
closes that gap; this is a fix, not a regression.

`atomic_write()` no longer runs at all when the key fetch itself fails (round-2 fix, below), so
`keep.d/owfeed-packages` is left unwritten rather than naming a key that was never fetched — also
correct, and the reverse of HEAD, which wrote it unconditionally before the fetch was even tried.

### Atomic writes

`atomic_write()` resolves the real path, copies its mode/owner onto a temp file in the same
directory, writes the new content into that copy, then `mv -f`s it over the original — one atomic
rename, so a failure at any point before it leaves the file exactly as it was. Six shapes were
found and fixed together in one security review (task 0176):

| Shape | Task | The fix |
|---|---|---|
| A bare `mv` over a symlinked customfeeds file replaces it with a plain one, target and mode lost | 0176-g | Resolve the real path first, then rename onto *that* |
| `cat new > path` truncates the moment the redirect opens; a write that dies partway (OOM, a full overlay) leaves the file empty | 0176-h | Write into a temp file, `mv -f` only once it is complete |
| A `$(…)` command substitution's own exit status is invisible to `set -e` in the assignment that reads it — a write that failed *inside* it still read as success one level up | 0176-i | Return status is checked with `if ! fn`, never captured with `$(…)` |
| A failed redirect (disk full, EROFS) mid-function leaks scratch files | 0176-j | Every early return removes every temp file it created |
| The `:` special builtin's own redirection failure exits the whole non-interactive shell before any `||` cleanup runs | 0176-k | Every truncate uses `printf ''`, never `:` |
| A `;`-joined group command reports only its last member's exit status, silently swallowing an earlier failure | 0176-l | `&&`-joined, not `;`-joined |

### The `<26` apk version constraint

The theme is now also carried by the official [openwrt/luci](https://github.com/openwrt/luci)
feed, where `luci.mk` stamps a version from git's commit date instead of this project's own
numbering (`luci-theme-footstrap-26.246.70755~4fd72fd`, measured on 25.12.4/apk-tools 3.0.5, next
to owfeed's own `0.14.10-r1`). That stamp only grows with the calendar, so a bare
`apk add --upgrade "$PKG"` resolves to the highest version across *every* configured repository —
the other publisher's build, not an upgrade to this one (field report: "Upgraded …
-> 26.246.70755~4fd72fd"). `apk version -t` confirms `26.246.70755~4fd72fd` and `27.1.1~abc` both
compare `>` against `26`, while `0.14.10-r1`, `1.0.0-r1` and `25.99.99-r1` all compare `<` — so
`<26` excludes every LuCI-stamped build for good while leaving this project's own numbering
(majors 1–25) room to grow into, and the same constraint also **repairs** a router that already
took the foreign build (measured: "Downgrading luci-theme-footstrap (26.246.70755~4fd72fd ->
0.14.10-r1)"). Do not tighten it to `<1` — that would reject this project's own future majors too.
opkg has no version-constraint syntax and no equivalent collision today (the official 24.10 feed
carries no `luci-theme-footstrap` at all); if that changes, the fallback is already written —
`install_from_release`, the same verified path a router with no matching feed branch already
takes.

`apk add` alone never upgrades — a package already in `world` and satisfied exits 0 unchanged,
prints its usual OK line, and changes nothing (issues #16, #28, #30; reproduced on a 25.12 stand
carrying 0.12.5 with 0.12.7 in the feed). `--upgrade` is what asks for the newest the feed carries,
and it also installs on a router that has none yet, so one line covers both paths.

## uci-defaults: registration

`root/etc/uci-defaults/30_luci-theme-footstrap` is the **single source of truth** for
registration (`dev-sync.sh` runs the same file; nothing else registers the theme).

- Registers **one** entry: `luci.themes.Footstrap=/luci-static/footstrap`. Layout, palette, mode
  and rounding are **client** switches on the Footstrap tab.
- The key in `themes.<Name>` is CamelCase without hyphens — a uci option-name limitation.
- Links the three admin uploads into `/www`: `bg`, `pattern.svg` and the `fonts/` directory all
  live in `/etc/footstrap`, because uhttpd serves `/www` only and `/etc` is what a sysupgrade
  keeps. The pattern keeps its `.svg` name — uhttpd types a response by extension.

**It runs ONCE, from the package manager's own `default_postinst`, before our `postinst`
content ever sees it.** `postinst` used to call it again as a belt-and-braces re-run — dropped
after measuring on owrt2512b (apk) and owrt2410b (opkg), fresh install and upgrade: in all four,
`/etc/uci-defaults/30_luci-theme-footstrap` was already gone by the time our own content ran, and
the theme was already registered. The re-run guard never fired.

**Fresh install vs upgrade is decided by the registration itself.** `mediaurlbase` is written only
in the run that first added `luci.themes.Footstrap`; on an upgrade the entry is already there, so
nothing moves a router off the theme it is on. `[ "$PKG_UPGRADE" != 1 ]` is checked beside it, as
the other themes in the tree do, but carries nothing on its own: apk never exports the variable and
neither does our postinst.

**It migrates nothing from older footstraps, on purpose.** A router is expected to `sysupgrade`
rather than upgrade single packages, so leftovers go with the image; what remains worth cleaning is
config, and the one config key this package owns is the theme entry. That was not always so — the
script used to delete eight legacy theme names, re-point four legacy media paths, carry the old
top-bar layout into `luci.main.footstrap_layout`, sweep two downloaded wallpapers and a pre-0.12.1
`fonts/` directory, and fall back to bootstrap if the active theme's files were missing. All of it
served installs that predate the first version published in the LuCI tree. Requested in review:
start from the assumption that a user of the official package started there.

## postinst / postrm

`postinst` clears the LuCI caches; uci-defaults registration is the package manager's own
`default_postinst`, not ours (see above). It does **NOT** `rpcd reload` — nor does `postrm`, nor
`dev-sync.sh` — and the reason is its own section below.

`postrm` does three things, and exits early on an upgrade (`case "$1" in *upgrade*`) because opkg
runs the OLD package's postrm mid-upgrade — reverting `mediaurlbase` there is what once flipped
every updating 24.10 user back to bootstrap:

- deletes `luci.themes.Footstrap`;
- if our theme is still active, moves `mediaurlbase` back to bootstrap on a **two-part** check
  (both the media directory *and* the ucode template must exist: a one-sided check would hand the
  UI to a half-removed bootstrap, which is the white page this branch was written for);
- removes `/etc/footstrap` — the admin's uploads, kept out of the package so an upgrade preserves
  them, and a real removal is the one time they should go.

## Why postinst/postrm never call `rpcd reload`

They used to — `reload`, never `restart`, because `restart` logs out every LuCI session (rpcd
holds them in memory) while `reload` (`SIGHUP`) is supposed to survive them. Measured on an
owrt2512 stand, that survival claim is true but beside the point: `reload` is `exec_self()`, a
full re-exec that re-scans the plugin dirs and `dlopen()`s every `.so`. A plugin file absent or
mid-write at that instant is **dropped**, past one stderr line, and does **not** come back on its
own:

```
mv /usr/lib/rpcd/file.so /tmp/ ; rpcd reload   -> `ubus list` loses `file`
file restored, no reload                       -> still missing
reload (or restart)                            -> back
```

This was first found against the `luci` ucode plugin — a reload racing another package's file
replacement left `luci/getFeatures`, `luci/getTimezones` and `luci/getMountPoints` all answering
`-32000 Object not found` until the next reload, reported from the field on a SNAPSHOT router and
cleared only by a reboot. The same race against `file` is worse: it is what makes System ->
Backup/Flash Firmware's "Reset to defaults" row silently vanish, because `view/system/flash.js`
reads `/proc/mtd` and `/proc/mounts` through `fs.trimmed()` wrapped in
`L.resolveDefault(..., '')` — a `file` object gone reads as "no overlay" rather than as an error
(OpenWrt forum thread 251930, posts 97/109 — "fixed" by installing an unrelated package whose own
postinst reload happened to re-register `file`).

None of that risk buys this package anything, because:

- it registers **no rpcd object of its own** — no `/usr/libexec/rpcd/*` script, no
  `/usr/lib/rpcd/*.so`, only `root/usr/share/rpcd/acl.d/luci-theme-footstrap.json` — so there is
  nothing here for a reload to refresh, only every *other* plugin's dlopen risk to run for free;
- rpcd reads `acl.d/*.json` **at login**, not only at start or on `SIGHUP`. Measured: narrow
  `rpcd.@login[0].read`/`write` from `*` to an explicit group, remove the ACL file with rpcd
  already running -> `session access` for `uci footstrap write` answers `false`; put the file back
  with **no reload**, log in again -> `true`. A fresh login already sees a just-installed grant;
- on a stock router, root's rpcd login grants `read='*' write='*'` — blanket. `session access`
  answers `true` even for an **invented** object (measured against `uci totally_made_up_pkg_xyz`),
  so the theme's ACL group never mattered to a root session in the first place.

The one gap the login-time read does not cover: a session that logged in **before** the install,
on a **restricted** (non-`*`) rpcd login — its in-memory ACL set predates the new grant, and only
a fresh login re-reads `acl.d`. `postinst` closes that gap without touching rpcd at all, ending a
session only when re-authenticating would actually hand it the theme's scope: it must be **denied**
`uci`/`footstrap`/`write` right now, **and** its own username's `rpcd.@login[]` entry must list the
theme's ACL group in its `read` or `write` list — otherwise the login was never given the group at
all (a second admin account, a monitoring script's login), a fresh login would deny it exactly the
same, and ending the session would cost that session for nothing:

```sh
for s in $(ubus call session list 2>/dev/null | grep -o '"ubus_rpc_session": "[a-f0-9]*"' | cut -d'"' -f4); do
	case "$s" in *[!0]*) ;; *) continue ;; esac
	ubus call session access "{\"ubus_rpc_session\":\"$s\",\"scope\":\"uci\",\"object\":\"footstrap\",\"function\":\"write\"}" 2>/dev/null | grep -q true && continue
	u=$(ubus call session get "{\"ubus_rpc_session\":\"$s\"}" 2>/dev/null | grep -o '"username": *"[^"]*"' | cut -d'"' -f4)
	[ -n "$u" ] || continue
	# Enumerated from `uci show`, not a `uci -q get` index count: the latter stops at the FIRST
	# login section with no username option and never sees any section past it. `while read`, not
	# `for`, because a username may contain a space and word-splitting would skip that section; the
	# subshell's answer is echoed out and captured instead of set in a variable.
	grant=$(uci show rpcd 2>/dev/null | grep -F .username= | while read -r kv; do
		sect=${kv%%.username=*}
		un=${kv#*.username=}
		un=${un#\'}
		un=${un%\'}
		[ "$un" = "$u" ] || continue
		for grp in $(uci -q get "$sect.read") $(uci -q get "$sect.write"); do
			[ "$grp" = luci-theme-footstrap ] && { echo 1; break 2; }
		done
	done)
	[ -n "$grant" ] || continue
	ubus call session destroy "{\"ubus_rpc_session\":\"$s\"}" >/dev/null 2>&1 || true
done
```

Guarded on the `session` ubus object existing at all, and the `case` line skips the all-zero
session id — the unauthenticated default, never denied anything by an ACL, so this sweep is not
its business. Verified verbatim on the stand: a blanket-root session survived, a stale restricted
session (whose login lists the group) was destroyed, the unauthenticated all-zero session was left
untouched, and a fresh login answered `true`. The one visible price is the narrowest one available:
an admin on a restricted account whose login already lists the theme's group, installing the theme
from LuCI's own Software page, logs themselves out and must log back in once — every root session,
every session that already has the scope, and every denied session whose login was never given the
group in the first place, is left alone.

The same reasoning holds one step harder for `dev-sync.sh`: it copies theme files onto a live
router the same way a package install would, the theme still registers no rpcd object, and a
developer's ssh session is root with the stock blanket `read='*' write='*'` grant — so its
post-copy `rpcd reload` was dropped too, leaving only the LuCI cache removal.

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

Three things now take that route, and `/etc/footstrap/` is where all of them live: the background,
the wallpaper pattern, and `/etc/footstrap/fonts/` — the webfonts `fonts/set-font.sh` installs,
along with the `@font-face` sheet it generates beside them. Each is exposed by a symlink under
`/www/luci-static/footstrap/` that uci-defaults recreates on **every** install and upgrade rather
than shipping, because `/www` is repopulated from firmware on a sysupgrade.

The fonts one links a **directory**, and that has two traps which end identically — `ln` exits 0 and
the link lands at `…/fonts/fonts`, one level too deep, so nothing serves and nothing complains:

- the path is already a symlink to a directory, and `ln -sf` follows it. `-n` is the fix;
- the path is a **real directory** — which every footstrap before 0.12.1 shipped here, full of the
  woff2 files it carried — and `-n` does not help. Measured on a 25.12 router: exit 0, link created
  inside. So the path is cleared first unless it already is the symlink we want, in uci-defaults and
  in `set-font.sh` alike.

No ACL entry goes with the fonts, and none should: `set-font.sh` is root on the router with a shell,
not a browser going through rpcd. Nothing in the UI writes those three options.

## ACL

`root/usr/share/rpcd/acl.d/luci-theme-footstrap.json` grants what the Footstrap tab needs to persist
a router-wide default and a login background:

- `uci` `set`/`commit`, scoped to the `footstrap` config — "Save as default";
- `cgi-io upload` plus `file` `write`/`remove` on `/etc/footstrap/login-bg` and
  `/etc/footstrap/pattern.svg` — the wallpaper photo and the tiled pattern;
- `file exec` on two literal commands, `/bin/chmod 644 /etc/footstrap/login-bg` and the same for
  `/etc/footstrap/pattern.svg` — an upload that is not world-readable is one uhttpd answers with 403.

Those two `file.exec` grants are the only ones the theme ships, and each is one fixed
argument-complete command.
There is no grant for an in-app update mechanism: the theme upgrades through the package feed the
installer adds.

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

## The same package, twice: this tree and the luci tree

The theme **is in** [openwrt/luci](https://github.com/openwrt/luci) as
`themes/luci-theme-footstrap` (merged 2026-08-20), and the copy that lives there is **not** this
directory copied across. `tools/sync-luci-fork.sh <path-to-luci>` materialises it, and the
difference is one decision made twice.

**How a change gets there now.** Their `CONTRIBUTING.md` is the authority and the shape is
ordinary: a feature branch off a fresh `upstream/master`, one PR per change, subject
`luci-theme-footstrap: <lowercase description>`, a body that says why, and a `Signed-off-by` with a
real first and last name (a GitHub noreply address is refused). `git push -f` is explicitly the way
to update a PR — inside your own branch, never on master. Release branches (`openwrt-25.12`, …)
take bug and security fixes only; a new package never lands on one, which is why the theme reaches
users of a *release* through owfeed and reaches everyone else with the next OpenWrt release.

**Two things the sync cannot carry, and both have bitten once.** The far side's `Makefile` is
hand-maintained (`include ../../luci.mk`, `PKG_MAINTAINER`), so `postinst`, `postrm` and
`conffiles` have to be changed there as well — a postrm cleaned up here and not there is exactly
the kind of divergence nothing else notices. And `po/` belongs to **Weblate** over there: upstream
forbids editing catalogues by hand, so the sync no longer sends them, and a msgid change is its own
deliberate PR against `po/templates/`. `npm run fork-drift` lists every shipped file the two trees
disagree about and names those two separately; it is a report rather than a gate, because an
unproposed change is a legitimate difference.

**That tree gets the built stylesheet; this one keeps the layers.** Here, `styles/` is thirty-eight
files in four cascade layers whose *order* is the design, and `cascade.css` is a build artefact
this repository does not even track. There, the other four themes each commit one `cascade.css`
and have no build step at all — a theme arriving with its own build system asks a reviewer to
audit that before they can read a stylesheet. So the sheet is generated on this side and
committed on that one, and `styles/` plus the four shell scripts do not travel.

**Nothing else is optimised on the way.** Measured against the stock tree, no package in
`openwrt/luci` ships anything pre-minified: the four themes' stylesheets run 17–20 bytes per line
and `luci-base`'s own JS 28–29, i.e. ordinary source with indentation. So the copy keeps its
`--fs-*` names unmangled, its templates and shell keep their comments, and the JS goes over
untouched for `luci.mk` to run **jsmin** across at package time — which is what every other
package in that tree gets. The release path here does more (terser, `mangle-tokens.sh`, comment
stripping) and the packages differ by about 14% because of it: 76 321 bytes against 66 825.

The one place the copy still stands out is the sheet itself, at 128 bytes per line against the
stock 17–20, and the arithmetic is why it stays: unminified it is **467 615 bytes**, eight times
the largest stock theme, because this repository keeps the *why* beside each rule and in source
form those comments are 70% of the file. The choice there is not "like everyone else" versus
"minified" — it is 136 kB of minified sheet against 468 kB of prose.

Two more things the copy changes, both in the Makefile, which is the one file maintained by hand
on the far side and never overwritten by the sync:

- `include ../../luci.mk`, not `$(TOPDIR)/feeds/luci/luci.mk` — in-tree, that is the path.
- `PKG_MAINTAINER` rather than `LUCI_MAINTAINER`: 96 of 101 apps in that tree use the former, and
  the formality bot reads it.

Re-run the sync after any change under `styles/`, or the committed sheet is a stale artefact of a
source that has moved.

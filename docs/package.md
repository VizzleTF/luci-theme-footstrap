# The package: source tree, Makefile, install scripts

Reference for what is where in `luci-theme-footstrap/`, what the Makefile does that a template
theme would not, and what runs on the router at install and removal time. How the packages are
built and published: [ci.md](ci.md).

## Source tree

```
luci-theme-footstrap/
├── Makefile
├── build-css.sh          styles/ → cascade.css (cat + awk, no node)
├── mangle-tokens.sh      shorten the private --fs-* names in a BUILT sheet, then join it to one line
├── strip-build.sh        build-tree-only bytes out, one mode each: templates, shell, assets
├── build-apk.sh          SDK build, kept so the theme stays buildable without owfeed
├── dev-sync.sh           deploy to a HARDWARE router over ssh (containers use owlab)
├── update-po.sh          regenerate/verify the translation catalogue
├── luci-upstream.pin     pinned openwrt/luci commit + sha256 of the borrowed tools
├── styles/               CSS SOURCE. Not shipped: luci.mk does not copy it
├── po/                   translation catalogue; luci.mk turns it into luci-i18n-* packages
├── htdocs/luci-static/   → /www/luci-static/
│   ├── footstrap/        cascade.css (GENERATED, gitignored), logo.svg, logo_48.png,
│   │                     manifest.json, app-icon-192.png (committed, from tools/build-icons.mjs)
│   └── resources/        menu-footstrap.js, menu-footstrap-common.js, fs-*.js,
│                         view/footstrap/appearance.js (System → Footstrap)
├── root/                 → /
│   ├── etc/uci-defaults/30_luci-theme-footstrap
│   ├── etc/config/footstrap                      conffile: a `settings` section, written at runtime
│   ├── usr/share/luci/menu.d/luci-theme-footstrap.json   the System → Footstrap menu entry
│   ├── www/cgi-bin/luci-theme-footstrap-pattern  serves the uploaded pattern
│   ├── lib/upgrade/keep.d/luci-theme-footstrap   what sysupgrade carries across a flash
│   └── usr/share/rpcd/acl.d/luci-theme-footstrap.json
└── ucode/template/themes/footstrap/    → /usr/share/ucode/luci/template/…
    ├── header.ut  footer.ut  sysauth.ut
    └── partials/{head,notice}.ut
```

`luci.mk` copies only `src/ luasrc/ htdocs/ root/ ucode/`, by directory presence, and builds
`po/` with its own catalogue rules. `styles/` is not copied, so `cascade.css` is generated in
`Build/Prepare` straight into the build tree and is absent from git.

**Never edit `cascade.css`.** Colours go in `styles/03-palettes.css`, scales and tokens in
`styles/02-tokens.css`. See [css.md](css.md).

The `bg` image and the `fonts/` directory under `/www/luci-static/footstrap/` are not shipped:
uci-defaults links them to `/etc/footstrap/`, where the admin's uploads live.

**The web manifest is a static file.** A theme may not register a dispatcher node, so nothing could
render it per request: `start_url` is `/cgi-bin/luci/` and the colours are the default palette's.
Regenerate the icon with `node tools/build-icons.mjs` after changing `logo.svg`; it needs ImageMagick
and oxipng and exits 1 without either.

## Makefile: what differs from a template theme

```makefile
PKG_NAME:=luci-theme-footstrap
LUCI_NAME:=luci-theme-footstrap   # luci.mk keys the Build/Prepare hook on LUCI_NAME, which defaults
                                  # to the checkout directory: a renamed checkout skips the CSS build
LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base          # the whole dependency list
LUCI_PKGARCH:=all                 # noarch: one build for every target
LUCI_MAINTAINER / LUCI_URL        # otherwise the package claims "OpenWrt LuCI community"
LUCI_MINIFY_CSS:=0                # see below
PKG_LICENSE:=Apache-2.0           # the theme only: it carries no webfonts
include $(TOPDIR)/feeds/luci/luci.mk   # absolute: ../../luci.mk resolves only inside the luci feed
```

**Do not set `PKG_VERSION`.** `luci.mk` derives it from git. The release is built by owfeed
(`tools/stage.sh`), never through the SDK.

### Minification

- **`LUCI_MINIFY_CSS:=0` is mandatory.** luci.mk's minifier, csstidy, mangles `:has()`,
  `color-mix()` and nested `calc()`. `build-css.sh` minifies instead.
- **JS has two pipelines.** The release (`tools/stage.sh`) pre-minifies with uglify-js
  (`tools/minify-js.mjs`) and never runs `luci.mk`. An SDK or buildbot build keeps `luci.mk`'s
  default jsmin over the untouched source. So the source must stay jsmin-safe: see the regex rule
  in [conventions.md](conventions.md). uhttpd serves `/www` uncompressed, so comments are bytes on
  the wire.

### `Build/Prepare`, in this order

The hook edits the copy in `PKG_BUILD_DIR`:

1. **Copy `LICENSE`** into `PKG_BUILD_DIR`: `PKG_LICENSE_FILES` resolves against it, and luci.mk
   does not copy the package root. The line looks dead; it is not.
2. **`build-css.sh`** → `cascade.css`. `cat`/`awk` only, so it runs on the buildbot.
3. **`mangle-tokens.sh`**: shortens the private `--fs-*` names in the sheet, the JS and the
   templates with one map, then joins the sheet onto one line (a `/*!` licence banner keeps its
   lines). It runs before steps 4 and 5, which strip the comments it reads. Renaming across the
   seam into JS and templates is safe only while every far-side `--fs-` name is a whole string
   literal.
4. **`strip-build.sh templates`**: removes `{# … #}` comments, `/* … */` comments that own their
   lines (`/*` first on its line, `*/` last on its line) and leading indentation from the `.ut`
   files. It refuses the build, naming `file:line`, on a construct where whitespace is data: a
   multi-line template literal or string, a trailing backslash, `<pre>`, `<textarea>`.
5. **`strip-build.sh shell`**: removes whole-line `#` comments from the shell under `root/`; a
   heredoc or a `#` line inside a quoted string refuses the build.
6. **`strip-build.sh assets`**: the comment out of `logo.svg`, the indentation out of
   `manifest.json`.
7. **Stamp `FS_VERSION`** into `fs-version.js` with `sed`. `dev-sync.sh` and `tools/stage.sh` run
   the same substitution, so moving the constant means fixing three places.

## Translations

`luci.mk` builds one `luci-i18n-footstrap-<lang>` package per directory in `po/`; that is also the
layout [Weblate](https://hosted.weblate.org/engage/openwrt/) translates. The owfeed release emits
the same set: `tools/stage.sh` builds a staging tree per language and `owfeed.yml` declares one
package each, so `po/`, the staging trees and `owfeed.yml` must list the same languages.

Upstream, the strings are translated in luci-base: `build/mkbasepot.sh` scans `themes/` too, so
every footstrap `msgctxt` string lands in `base.pot`. An empty `msgstr` in `footstrap.po` is
harmless there.

**A package manager cannot read `luci.main.lang`, so the catalogue must install itself.** The
catalogue depends on the theme, not the other way round, so upgrading the theme pulls in nothing:

| Path | What installs the catalogue |
|---|---|
| `install.sh`, install or re-run | reads `luci.main.lang` and fetches the catalogue from the feed, or from the signed release pinned to the installed theme's tag when the feed lacks it |
| `apk upgrade` on 25.12+ | `install-if: luci-theme-footstrap={version} luci-i18n-base-<lang>` in `owfeed.yml`; owfeed expands `{version}` |
| `opkg upgrade` on 24.10 | nothing: `Recommends:` is unconditional, and a postinst cannot call opkg, which holds its lock. Only `install.sh` covers it |

When none fired, System → Footstrap names the missing package. It tests `_('Layout', 'footstrap')`:
`Appearance` is obsolete in the catalogues and reads as untranslated on a working router.

## install.sh: fetch, verify, install

`install.sh` is the `wget -qO- … | sh` installer, run as root under busybox ash. It takes one of
two paths:

- **Feed path**, the normal case: writes one repository line, so `apk upgrade`/`opkg upgrade`
  carries the theme forward.
- **Release path**, when the feed cannot be read for this router: installs from the release and
  writes no feed line; the closing message says `$PM upgrade` will not update the theme. A 23.05
  router always takes it, pinned to `v0.14.2` (`FROZEN_2305_TAG`), the last release that runs there.

Both end in `finish()`: cache clear, `rpcd reload`, the version line, the "Select Footstrap" hint.
`install.sh` may reload rpcd because it runs after the package manager has finished; a postinst
runs inside the transaction (see [below](#why-postinstpostrm-never-call-rpcd-reload)).

**Trust chain.** TLS (never `-k`), then the ed25519 usign signature over `manifest.txt`, then the
manifest's sha256 over the artifact. It fails closed: a missing usign, `.sig` or matching digest
refuses the install. `apk add --allow-untrusted` waives only the `.apk`'s own signature. The
artifact is picked by an exact `pkg <name> <format>` line in the signed manifest, never by
filename. `RELEASE_BASE` is `releases/latest/download`, never `api.github.com`, which is
rate-limited per source IP and returns JSON a router may not parse.

**`feed_refresh`.** `apk update`/`opkg update` exit non-zero when any configured feed is down. The
installer counts each manager's per-feed failure lines against the configured feeds. It never
tolerates its own feed failing: `repo.owfeed.org` is a separate host that an attacker could
blackhole alone, leaving a stale index.

**Feed list rewrite.** `disable_other_lines()` and `ensure_first()` keep
`customfeeds.list`/`customfeeds.conf` in the shape the manager reads, through `atomic_write()`
(real path resolved, temp file in the same directory, one `mv -f`):

| Rule | Invariant |
|---|---|
| R1 | the written line is matched exactly, never as a substring |
| R2 | the line is placed first, and moved there if present elsewhere: apk stops reading at the first line it cannot parse |
| R3 | every other active line naming our feed is commented out (never deleted) and reported |
| R4 | "nothing changed" is asked of the package manager (`feed_offer()`), never inferred from an unchanged version |

The opkg leg matches the host case-insensitively (`OPKG_HOST_RE`, both sides lowercased: busybox
awk has no `IGNORECASE`) or the `src` name exactly (`OPKG_NAME_RE`). The regex reaches awk through
`ENVIRON`, not `-v`, which would unescape `\.`. A failed key fetch exits before
`keep.d/owfeed-packages` is written.

**The `<26` apk constraint.** The official luci feed stamps the package with a date version
(`26.246.70755~…`), which sorts above owfeed's `0.14.x`. `apk add "luci-theme-footstrap<26"`
excludes those builds, writes the constraint into `world` (which also downgrades a router that
took one), and leaves majors 1–25 for this project. Do not tighten it to `<1`. Then
`apk upgrade luci-theme-footstrap` moves the theme alone. Never `apk add --upgrade`: apk-tools makes
that flag inheritable, so it upgrades every dependency down to libc. opkg's `opkg upgrade <pkg>`
already upgrades the named package alone; the official 24.10 feed carries no footstrap.

## uci-defaults: registration

`root/etc/uci-defaults/30_luci-theme-footstrap` is the only thing that registers the theme
(`dev-sync.sh` runs the same file). The package manager's `default_postinst` runs it once, before
our `postinst`.

- Registers one entry, `luci.themes.Footstrap=/luci-static/footstrap`. Layout, palette, mode and
  rounding are client switches on System → Footstrap. The uci key is CamelCase: option names
  allow no hyphen.
- Links `bg` and `fonts/` from `/etc/footstrap` into `/www`, on every install and upgrade:
  uhttpd serves `/www` only, sysupgrade keeps `/etc`. The fonts link is a directory, so the path is
  cleared first and linked with `ln -sfn`; otherwise `ln` exits 0 and nests `fonts/fonts`.
- Does not link the pattern: an SVG on a same-origin URL runs script with the admin's session, so
  `cgi-bin/luci-theme-footstrap-pattern` serves it under CSP `none`, sandbox and `nosniff`.
- **Never moves the active theme.** The `mediaurlbase` line runs only in the run that first adds
  the theme entry and never overwrites. On a stock router luci-base already set it, so the admin
  picks Footstrap in Language and Style.
- **Migrates nothing** from older footstraps: OpenWrt expects a sysupgrade, not single-package
  upgrades.

## postinst / postrm

`postinst` clears the LuCI caches and ends the sessions described below. `postrm` exits at once
on an upgrade (`case "$1" in *upgrade*`), because opkg runs the old package's postrm mid-upgrade.
On a removal it:

- deletes `luci.themes.Footstrap`;
- if footstrap is active, sets `mediaurlbase` back to bootstrap, only when both bootstrap's media
  directory and its `header.ut` exist (a half-removed bootstrap is a white page);
- removes `/etc/footstrap`, the admin's uploads;
- clears the LuCI caches.

## Why postinst/postrm never call `rpcd reload`

`rpcd reload` re-executes rpcd and `dlopen()`s every plugin again. A plugin file that another
package is replacing at that instant is dropped until the next reload, and its objects answer
`-32000 Object not found` (losing `file` hides System → Backup/Flash Firmware's reset row).
Footstrap gains nothing from that risk:

- it registers no rpcd object, only an ACL file;
- rpcd reads `acl.d/*.json` at login, so a fresh login sees the new grant;
- a stock root login grants `read='*' write='*'` anyway.

The one gap: a session that logged in before the install on a restricted login. `postinst` ends
such a session only when a fresh login would grant it the theme's scope: it is denied
`uci`/`footstrap`/`write` (or `read`, for a read-only grant), and its user's `rpcd.@login[]` entry
lists the `luci-theme-footstrap` group. Every other session stays. The loop is in the Makefile's
`postinst` define. `dev-sync.sh` does no reload either.

## `/etc/config/footstrap` is a conffile

"Save to router" writes the router-wide axes into `/etc/config/footstrap` (`saveAsDefault()` in
`fs-axes.js`). Without the `conffiles` define the package manager replaces it on upgrade and
silently wipes the admin's defaults. Every shipped `/etc/config/*` must be declared; CI's `e2e`
checks that a marker survives the upgrade ([verifying.md](verifying.md)).

`/etc/footstrap/` (the background, the pattern, and the fonts `fonts/set-font.sh` installs) lives
outside `/etc/config`: an upgrade never touches it, and `root/lib/upgrade/keep.d/luci-theme-footstrap`
carries it across a sysupgrade. `set-font.sh` writes `footstrap.settings.font_sans`, `font_mono` and
`fonts` as root over ssh, so it needs no ACL entry; nothing in the UI writes them.

## ACL

`root/usr/share/rpcd/acl.d/luci-theme-footstrap.json` grants what System → Footstrap needs; the
menu entry depends on the same group:

- read `uci` `footstrap`;
- `ubus` `uci` `set`/`commit` and write `uci` `footstrap`: "Save to router";
- `ubus` `file` `remove`, `cgi-io` `upload`, and `file` `write`/`remove` on
  `/etc/footstrap/login-bg` and `/etc/footstrap/pattern.svg`: the uploads.

There is no `file exec`: the upload form sends `filemode=644` and `cgi-io` sets the mode itself.

rpcd skips an unparsable `acl.d` file silently, and accepts silently one that parses but grants
nothing. `rpc.js` raises on a ubus status only with `reject: true`; without it a per-config refusal
(status 6) resolves as success.

## `luci-upstream.pin`

Pins the `openwrt/luci` commit and the sha256 of `build/i18n-scan.pl`, which `update-po.sh`
downloads and runs: it lexes `.ut` and the ACL title, which a `grep` for `_('…')` cannot. It also
pins `USIGN_PIN` (the usign `build-apk.sh` builds through `tools/build-usign.sh`) and
`OPENWRT_KEYRING_PIN`. It pins no ucode on purpose: CI's `e2e` runs the templates on the router's
own interpreter on both release lines.

## The copy in openwrt/luci

The theme is in openwrt/luci as `themes/luci-theme-footstrap`.
`tools/sync-luci-fork.sh <path-to-luci>` builds that copy from this tree:

- it carries the built, minified `cascade.css`, with unmangled tokens; `styles/`, the build
  scripts, `po/` (Weblate owns it upstream) and `luci-upstream.pin` stay here (the script's
  `--exclude` list is the source);
- templates, shell and JS travel unminified, for `luci.mk`'s jsmin;
- the far side's `Makefile` is maintained by hand (`include ../../luci.mk`, `PKG_MAINTAINER`), so a
  change to `postinst`, `postrm` or `conffiles` is made there too.

Re-run the sync after any change under `styles/`. The PR process: [upstream-pr.md](upstream-pr.md).

## Uploaded images

The login background is a photo: `fs-assets.js` downscales it (`_downscale`) and never parses it as
XML. The wallpaper pattern is an SVG, and `_sanitizeSvg` (`PATTERN.prepare`) walks its parsed DOM
once:

- **Elements.** Only the SVG namespace stays. XHTML, MathML, editor metadata, `<foreignObject>` and
  script-capable SVG elements go. An animation (`animate`, `set`, `animateTransform`,
  `animateMotion`, `animateColor`) goes when its `attributeName` is a URL-valued attribute (`href`,
  `ping`, any prefix).
- **`href`, `xlink:href`, `ping`.** A URL-valued attribute is stripped as the WHATWG URL parser
  strips (every TAB/LF/CR, then leading spaces; not `trim()`). It stays only as a same-document
  `#fragment`, or as a raster `data:` URL (png, jpeg, gif, webp, avif, bmp) on an `<image>`.
- **CSS.** An un-namespaced attribute or a `<style>`'s direct text is dropped when, CSS-unescaped, it
  reaches off-document: `url(` to anything but a `#fragment`, `@import`, `expression(`,
  `image-set(`, `image(`, `src(`, `cross-fade(`. The image functions match only with `(` directly
  after the name; `url` and `expression` also match with CSS whitespace before it. CR LF, CR and FF
  fold to LF before escapes are decoded. A `style` attribute loses only the offending declaration.
  A `<style>` with an element child is removed whole.
- **`xml:base`** and `on*` attributes are removed.

A self-contained `<style>` stays: in image mode it can neither fetch nor run anything.

A `<!DOCTYPE svg SYSTEM "…">` prologue survives the walk and `XMLSerializer`. It is harmless while no
engine resolves an external DTD and the file is served with the CGI's header.

`cgi-bin/luci-theme-footstrap-pattern` serves the file with `Content-Security-Policy: default-src
'none'; sandbox` and `nosniff`. It does not validate the bytes: a direct `cgi-upload` POST skips the
client walk, so the CSP is the second wall.

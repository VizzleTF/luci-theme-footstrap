# How LuCI renders a theme

What LuCI expects from a theme on OpenWrt 24.10.3+ and 25.12+, and where footstrap plugs into it.
Read this first if you are new to the codebase.

## A theme is a server shell plus client assets

LuCI runs on ucode, not Lua, since 23.05: dispatcher in `/usr/share/ucode/luci/dispatcher.uc`,
templates as `*.ut` under `/usr/share/ucode/luci/template/`.

**Page content is rendered on the client.** The server sends a shell (header, an empty
`<div id="view">`, footer), and `luci.js` instantiates the page's view module from
`/www/luci-static/resources/view/**`.

So a theme is **a server shell (header/footer in ucode) + CSS + client JS for the menu**. No Lua,
no server-side controllers.

```
view.ut
 ├─ include('header')                       → luci-base header.ut
 │    ├─ include(`themes/${theme}/header`)  ← the theme's header.ut
 │    └─ <script src="…/luci.js"> + L = new LuCI({…env…})
 ├─ <div id="view"> + ui.instantiateView('<view>')
 └─ include('footer')                       → luci-base footer.ut
      └─ include(`themes/${theme}/footer`)  ← the theme's footer.ut
```

The theme is never called directly: luci-base wraps it, and `luci.js` loads *after* the theme's
header.

## Both release lines, one template API

**24.10 and 25.12+ share the template API**, checked rather than assumed. 24.10 is already ucode
(`modules/luci-base/ucode/` exists there) and carries everything the theme uses: `ctx.path`,
`ctx.request_path`, `entityencode`, `striptags`, `dispatcher.build_url/lookup/lang`, `ubus.call`,
`pkgs_update_time`. The `L.env` blob luci-base's own `header.ut` prints is **byte-identical**
between branches. So `L.env.dispatchpath`, which the menu and the SPA router depend on, exists in
both.

**The one difference is the package manager**: apk on 25.12+, opkg/`.ipk` on 24.10. CI builds both
formats; `install.sh` detects which one the router runs.

## How LuCI picks a theme

From `runtime.uc`:

```ucode
let media = uci.get('luci', 'main', 'mediaurlbase');        // e.g. '/luci-static/footstrap'
let status = self.trycompile(`themes/${basename(media)}/header`);
if (status !== true) {
    // fall back to the first theme in luci.themes whose header compiles
}
self.env.media = media;  self.env.theme = basename(media);
```

Three things follow:

1. The theme name is `basename(mediaurlbase)`, and its templates must live in
   `/usr/share/ucode/luci/template/themes/<name>/header.ut`.
2. **A header that does not compile does not brick the UI.** LuCI falls back to the first working
   theme and shows a "Theme fallback" indicator carrying the error. Convenient while developing —
   and dangerous in a release: a stray brace quietly moves every user to another theme. The e2e
   run on the routers fails a page whose footstrap stylesheet or chrome is missing, which is what
   that fallback looks like.
3. `resource` is always `/luci-static/resources`, shared with luci-base. Themes must not touch it.

## What the header must do

1. `http.prepare_content('text/html; charset=UTF-8')`.
2. Emit `<!DOCTYPE html><html><head>…` with its own CSS.
3. Include `{{ resource }}/cbi.js` and the translations script.
4. Honour `node.css` and `css` — individual pages ask for extra stylesheets.
5. Open the content container and leave it **unclosed**; the footer closes it.
6. Honour `blank_page` — draw no chrome when it is true.
7. Emit the empty menu containers: `#topmenu`, `#tabmenu`, `#modemenu`, `#indicators`.

**`data-page` on `<body>` matters**: luci-base and app CSS target pages through it
(`[data-page="admin-status-overview"]`). footstrap's own page-scoped rules never key off
`body[data-page]`: under the SPA router they use `:where(#view)[data-page]` or
`.fs-content[data-page]`, see [spa-router.md](spa-router.md#the-staging-window).

Variables a theme template gets: `theme`, `media`, `resource`, `ctx`, `dispatcher`, `dispatched`,
`node`, `version`, `config`, `blank_page`, `css`, `lua_active`, `http`, `ubus`.

### Where footstrap differs

- **One template directory**, `ucode/template/themes/footstrap/`. `header.ut` is thin; `<head>` and
  the notices live in `partials/head.ut` and `partials/notice.ut`. Sidebar and top bar are **not a second
  template** — they are `:root[data-layout]` plus CSS.
- **`data-page` is built from the dispatch path**, `join('-', length(ctx.path) ? ctx.path :
  ctx.request_path)` — the reverse of bootstrap's order. On a firstchild route (`/admin/status`
  renders overview) `request_path` is only `['admin','status']`.
- The first element in `<body>` is a skip link; the content container is
  `<main class="fs-main" id="maincontent" tabindex="-1">`; the menu is `<nav class="fs-sidebar">`.
  Not `<aside>` — that carries the `complementary` role, which no landmark jump reaches.
- The document heading is `<h1 class="fs-title-main">` carrying `.fs-sr`, clipped, not `hidden`
  ([chrome.md](chrome.md)).
- `partials/head.ut` sends `cascade.css`, `node.css` and `cbi.js` with `?v={{ pkgs_update_time }}`
  (uhttpd sends no `Cache-Control`) and passes every
  interpolation through `entityencode(striptags(...))`.

## `sysauth.ut` is mandatory for a theme with its own chrome

luci-base's generic `sysauth.ut` opens with `{% include('header') %}` **without `blank_page`**,
while the theme's header hides its whole shell behind `{% if (!blank_page) %}`. Without a
theme-local `sysauth.ut`, sidebar, menu and footer draw around the login form and every control in
them is dead: there is no session yet.

The theme's `sysauth.ut` exists for exactly one line:

```
{% include('header', { blank_page: true }) %}
```

**The form is rendered by the server**: a client view would bootstrap before a session exists, and
its RPCs would answer "Access denied". Server rendering also works with JS off.

## The menu is entirely client-side

The server header emits empty containers by id; client JS fills them. The footer loads the entry
with `L.require('menu-footstrap')` (it only calls `menu-footstrap-common`; `fs-chrome` is the
renderer), then `L.require('fs-select')`.

Menu JS lives in `htdocs/luci-static/resources/`, **not** in the theme directory, because
`L.require()` resolves against `resourcebase`. From there it pulls its dependencies through
`'require <module> as <name>'` pragmas:

```
menu-footstrap        → menu-footstrap-common
menu-footstrap-common → ui, fs-menutree, fs-chrome, fs-router,
                        fs-prefs, fs-sheets
fs-select             (no requirer — the footer loads it directly)
fs-overview           (page module, see below)
```

The graph is acyclic and the runtime enforces it: `require()` throws `DependencyError` on a cycle.

**One module is loaded by page, not by pragma.** `fs-overview` works on Status → Overview only,
a page `luci-mod-status` owns. A `'require'` pragma would load it on every admin page, so
`menu-footstrap-common.js` carries a map from `data-page` to module name (`PAGE_MODULES`) and
requires the module when that page appears (server-stamped or router-stamped). The loader owns the observer on
`body[data-page]` and calls the module's `wire()` on every stamp; `wire()` re-checks the page
itself (`onPage()`). The map repeats a page name the module also tests, so the two must be edited
together.

`fs-appearance` (the Appearance controls) is not a page module: it owns a route of its own,
`/admin/system/footstrap` (`root/usr/share/luci/menu.d/luci-theme-footstrap.json`, dispatched to
`view/footstrap/appearance.js`), which requires it by pragma like any ordinary view.

**There is no update checker, and nothing that loads one.** The installer adds the owfeed-packages
feed, so `apk upgrade` / `opkg upgrade` carries the theme forward. A settings page has no
business reaching GitHub to reimplement that. `fs-version.js` reports the installed version with no
request at all. Nothing globs for an optional file at render time either: the wallpaper pattern is an
upload, so the server hands the client its cache-bust token like any other saved value.

Renderer and shell in detail: [chrome.md](chrome.md).

## Registration in UCI

```
config core 'main'
    option mediaurlbase '/luci-static/footstrap'    # the active theme
    option resourcebase '/luci-static/resources'

config internal 'themes'
    option Footstrap '/luci-static/footstrap'       # the list the dropdown is built from
```

Exactly one entry: [package.md](package.md).

## The runtime layout on the router

`luci.mk` maps `ucode/` → `/usr/share/ucode/luci`, `htdocs/` → `/www`, `root/` → `/`:

```
/usr/share/ucode/luci/template/themes/footstrap/
        header.ut, footer.ut, sysauth.ut, partials/*.ut
/www/luci-static/footstrap/            cascade.css (generated), logo.svg, logo_48.png,
                                       app-icon-192.png, manifest.json
                                       bg -> /etc/footstrap/login-bg, fonts -> /etc/footstrap/fonts
                                       (symlinks made by uci-defaults)
/www/luci-static/resources/            menu-footstrap.js, menu-footstrap-common.js, fs-*.js,
                                       view/footstrap/appearance.js
/www/cgi-bin/luci-theme-footstrap-pattern      serves the uploaded pattern under CSP
/usr/lib/lua/luci/i18n/footstrap.<lang>.lmo    shipped by luci-i18n-footstrap-<lang>, not the theme package
/usr/share/luci/menu.d/luci-theme-footstrap.json     the System → Footstrap route
/usr/share/rpcd/acl.d/luci-theme-footstrap.json      ACL: uci footstrap, login-bg and pattern uploads
/etc/config/footstrap                                router defaults (a conffile)
/etc/uci-defaults/30_luci-theme-footstrap            registration
/lib/upgrade/keep.d/luci-theme-footstrap             keeps the uploads across sysupgrade
```

The pattern is not a symlink into `/www`: the CGI serves it, so a direct open runs under CSP.

## Where the boundary runs

The theme supplies the **chrome and the design language**. Page content is drawn by the view JS of
`luci-mod-*`, whose structure the app fixes.

The theme **can** style every stock widget through `cascade.css` and its tokens, own the sidebar,
top bar, logo and indicators, and re-order the stock overview sections.

The theme **cannot** turn the overview into a KPI dashboard with a memory ring and sparklines —
that is a view module in a separate `luci-app-*`.

`fs-overview.js` is a page module (`PAGE_MODULES` in `menu-footstrap-common.js`). It rearranges
the stock overview sections, marks the meters (`data-fs-level`) and makes card headings
disclosures. The data stays `luci-mod-status`'s.

## Uploaded images

The rules for the pattern upload's SVG sanitizer: [package.md](package.md#uploaded-images).

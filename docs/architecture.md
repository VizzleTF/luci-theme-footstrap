# How LuCI renders a theme

What LuCI expects from a theme on OpenWrt 24.10.3+ and 25.12+, and where footstrap plugs into it.
Read this first if you are new to the codebase.
The key fact: a theme is a server shell plus CSS plus client JS for the menu; page content is drawn on the client.

## Short version

1. LuCI runs on ucode since 23.05. The server sends a shell; `luci.js` renders the page into
   `<div id="view">`.
2. 24.10 and 25.12+ share one template API. The only difference is the package manager: opkg on
   24.10, apk on 25.12+.
3. A header that does not compile silently moves users to another theme. The e2e run catches it.
4. The theme needs its own `sysauth.ut`, or the chrome draws around the login form.
5. The menu is entirely client-side, loaded through `L.require()` from `htdocs/luci-static/resources/`.
6. The theme owns the chrome and the design language. Page content is drawn by the view JS of
   `luci-mod-*`.

## Contents

- [A theme is a server shell plus client assets](#a-theme-is-a-server-shell-plus-client-assets)
- [Both release lines, one template API](#both-release-lines-one-template-api)
- [How LuCI picks a theme](#how-luci-picks-a-theme)
- [What the header must do](#what-the-header-must-do)
- [`sysauth.ut` is mandatory for a theme with its own chrome](#sysauthut-is-mandatory-for-a-theme-with-its-own-chrome)
- [The menu is entirely client-side](#the-menu-is-entirely-client-side)
- [Registration in UCI](#registration-in-uci)
- [The runtime layout on the router](#the-runtime-layout-on-the-router)
- [Where the boundary runs](#where-the-boundary-runs)
- [Uploaded images](#uploaded-images)

## A theme is a server shell plus client assets

LuCI runs on ucode, not Lua, since 23.05:

- the dispatcher is `/usr/share/ucode/luci/dispatcher.uc`;
- templates are `*.ut` under `/usr/share/ucode/luci/template/`.

**Page content is rendered on the client.** The server sends a shell: header, an empty
`<div id="view">`, footer. Then `luci.js` instantiates the page's view module from
`/www/luci-static/resources/view/**`.

So a theme is a server shell (header/footer in ucode) + CSS + client JS for the menu. No Lua, no
server-side controllers.

```
view.ut
 ├─ include('header')                       → luci-base header.ut
 │    ├─ include(`themes/${theme}/header`)  ← the theme's header.ut
 │    └─ <script src="…/luci.js"> + L = new LuCI({…env…})
 ├─ <div id="view"> + ui.instantiateView('<view>')
 └─ include('footer')                       → luci-base footer.ut
      └─ include(`themes/${theme}/footer`)  ← the theme's footer.ut
```

The theme is never called directly: luci-base wraps it. `luci.js` loads after the theme's header.

## Both release lines, one template API

**24.10 and 25.12+ share the template API**, checked rather than assumed.

24.10 is already ucode: `modules/luci-base/ucode/` exists there. It carries everything the theme
uses:

- `ctx.path`, `ctx.request_path`;
- `entityencode`, `striptags`;
- `dispatcher.build_url/lookup/lang`;
- `ubus.call`;
- `pkgs_update_time`.

The `L.env` blob that luci-base's own `header.ut` prints is byte-identical between branches. So
`L.env.dispatchpath`, which the menu and the SPA router depend on, exists in both.

The one difference is the package manager: apk on 25.12+, opkg/`.ipk` on 24.10. CI builds both
formats, and `install.sh` detects which one the router runs.

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

1. The theme name is `basename(mediaurlbase)`. Its templates must live in
   `/usr/share/ucode/luci/template/themes/<name>/header.ut`.
2. **A header that does not compile does not brick the UI.** LuCI falls back to the first working
   theme and shows a "Theme fallback" indicator carrying the error.
   - While developing, that is convenient.
   - In a release, it is dangerous: a stray brace quietly moves every user to another theme.
   - The e2e run on the routers fails a page whose footstrap stylesheet or chrome is missing. That
     is what the fallback looks like.
3. `resource` is always `/luci-static/resources`, shared with luci-base. Themes must not touch it.

## What the header must do

1. Call `http.prepare_content('text/html; charset=UTF-8')`.
2. Emit `<!DOCTYPE html><html><head>…` with its own CSS.
3. Include `{{ resource }}/cbi.js` and the translations script.
4. Honour `node.css` and `css`: individual pages ask for extra stylesheets.
5. Open the content container and leave it unclosed. The footer closes it.
6. Honour `blank_page`: draw no chrome when it is true.
7. Emit the empty menu containers: `#topmenu`, `#tabmenu`, `#modemenu`, `#indicators`.

**`data-page` on `<body>` matters.** luci-base and app CSS target pages through it
(`[data-page="admin-status-overview"]`).

footstrap's own page-scoped CSS rules never key off `body[data-page]`. Under the SPA router two
pages are on screen at once during a navigation, and `body` is the ancestor of both. So the rules use
`:where(#view)[data-page]` or `.fs-content[data-page]`. See
[spa-router.md](spa-router.md#the-staging-window).

JS may still watch `body[data-page]` to learn that a new page has arrived, as the page-module loader
below does. The ban is on CSS selectors, not on reading the attribute.

Variables a theme template gets: `theme`, `media`, `resource`, `ctx`, `dispatcher`, `dispatched`,
`node`, `version`, `config`, `blank_page`, `css`, `lua_active`, `http`, `ubus`.

### Where footstrap differs

| Topic | footstrap |
|---|---|
| Templates | One template directory, `ucode/template/themes/footstrap/`. `header.ut` is thin; `<head>` and the notices live in `partials/head.ut` and `partials/notice.ut`. |
| Layouts | Sidebar and top bar are not a second template. They are `:root[data-layout]` plus CSS. |
| `data-page` | Built from the dispatch path, `join('-', length(ctx.path) ? ctx.path : ctx.request_path)`. That is the reverse of bootstrap's order. On a firstchild route (`/admin/status` renders overview), `request_path` is only `['admin','status']`. |
| Landmarks | The first element in `<body>` is a skip link. The content container is `<main class="fs-main" id="maincontent" tabindex="-1">`. The menu is `<nav class="fs-sidebar">`. |
| Page heading | `<h1 class="fs-title-main">` carrying `.fs-sr`: clipped, not `hidden` ([chrome.md](chrome.md)). |
| Cache-bust and escaping | `partials/head.ut` sends `cascade.css`, `node.css` and `cbi.js` with `?v={{ pkgs_update_time }}`, because uhttpd sends no `Cache-Control`. It passes every interpolation through `entityencode(striptags(...))`. |

The menu is a `<nav>`, not an `<aside>`. An `<aside>` carries the `complementary` role, which no
landmark jump reaches.

## `sysauth.ut` is mandatory for a theme with its own chrome

luci-base's generic `sysauth.ut` opens with `{% include('header') %}` without `blank_page`. The
theme's header hides its whole shell behind `{% if (!blank_page) %}`.

Without a theme-local `sysauth.ut`, the sidebar, menu and footer draw around the login form. Every
control in them is dead, because there is no session yet.

The theme's `sysauth.ut` exists for exactly one line:

```
{% include('header', { blank_page: true }) %}
```

**The form is rendered by the server.** A client view would bootstrap before a session exists, and
its RPCs would answer "Access denied". Server rendering also works with JS off.

## The menu is entirely client-side

The server header emits empty containers by id, and client JS fills them. The footer loads two
modules in order:

1. `L.require('menu-footstrap')`, the entry. It wires the chrome; `fs-chrome` is the renderer.
2. `L.require('fs-select')`.

Menu JS lives in `htdocs/luci-static/resources/`, **not in the theme directory**, because
`L.require()` resolves against `resourcebase`. From there it pulls its dependencies through
`'require <module> as <name>'` pragmas:

```
menu-footstrap        → ui, fs-menutree, fs-chrome, fs-router,
                        fs-prefs, fs-sheets
fs-select             (no requirer — the footer loads it directly)
fs-overview           (page module, see below)
```

The graph is acyclic, and the runtime enforces it: `require()` throws `DependencyError` on a cycle.

### One module is loaded by page, not by pragma

`fs-overview` works on Status → Overview only, a page `luci-mod-status` owns. A `'require'` pragma
would load it on every admin page.

So `menu-footstrap.js` carries a map from `data-page` to module name (`PAGE_MODULES`). It requires
the module when that page appears, server-stamped or router-stamped.

The loader owns the observer on `body[data-page]` and calls the module's `wire()` on every stamp.
`wire()` re-checks the page itself (`onPage()`).

The map repeats a page name the module also tests, so edit the two together.

### The Appearance controls are a route, not a page module

They are the view of a route of their own, `/admin/system/footstrap`. It is registered in
`root/usr/share/luci/menu.d/luci-theme-footstrap.json` and dispatched to
`view/footstrap/appearance.js`. LuCI loads it like any ordinary view.

### There is no update checker, and nothing that loads one

The installer adds the owfeed-packages feed, so `apk upgrade` / `opkg upgrade` carries the theme
forward. A settings page has no business reaching GitHub to reimplement that.

`fs-version.js` reports the installed version with no request at all.

Nothing globs for an optional file at render time either. The wallpaper pattern is an upload, so
the server hands the client its cache-bust token like any other saved value.

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
/www/luci-static/resources/            menu-footstrap.js, fs-*.js,
                                       view/footstrap/appearance.js
/www/cgi-bin/luci-theme-footstrap-pattern      serves the uploaded pattern under CSP
/usr/lib/lua/luci/i18n/footstrap.<lang>.lmo    shipped by luci-i18n-footstrap-<lang>, not the theme package
/usr/share/luci/menu.d/luci-theme-footstrap.json     the System → Footstrap route
/usr/share/rpcd/acl.d/luci-theme-footstrap.json      ACL: uci footstrap, login-bg and pattern uploads
/etc/config/footstrap                                router defaults (a conffile)
/etc/uci-defaults/30_luci-theme-footstrap            registration
/lib/upgrade/keep.d/luci-theme-footstrap             keeps the uploads across sysupgrade
```

The pattern is not a symlink into `/www`. The CGI serves it, so a direct open runs under CSP.

## Where the boundary runs

The theme supplies the **chrome and the design language**. Page content is drawn by the view JS of
`luci-mod-*`, whose structure the app fixes.

The theme can:

- style every stock widget through `cascade.css` and its tokens;
- own the sidebar, top bar, logo and indicators;
- re-order the stock overview sections.

The theme cannot turn the overview into a KPI dashboard with a memory ring and sparklines. That is
a view module in a separate `luci-app-*`.

`fs-overview.js` is a page module (`PAGE_MODULES` in `menu-footstrap.js`). It does three things:

- rearranges the stock overview sections;
- marks the meters (`data-fs-level`);
- makes card headings disclosures.

The data stays `luci-mod-status`'s.

## Uploaded images

The rules for the pattern upload's SVG sanitizer: [package.md](package.md#uploaded-images).

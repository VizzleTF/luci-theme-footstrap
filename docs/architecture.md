# How LuCI renders a theme

What LuCI expects from a theme on OpenWrt 24.10 and 25.12+, and where footstrap plugs into it.
Read this first if you are new to the codebase.

> Verified against `openwrt/luci` at the commit pinned in
> `luci-theme-footstrap/luci-upstream.pin`, against the `openwrt-24.10` branch, and on a live
> OpenWrt 25.12 router.

## A theme is a server shell plus client assets

LuCI runs on **ucode**, not Lua, since 23.05: dispatcher in `/usr/share/ucode/luci/dispatcher.uc`,
templates as `*.ut` under `/usr/share/ucode/luci/template/`.

**Page content is rendered on the client.** The server sends a shell — header, an empty
`<div id="view">`, footer — and `luci.js` instantiates the page's view module from
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
between branches, so `L.env.dispatchpath` — which the menu and the SPA router depend on — exists in
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
   and the reason CI compiles every `.ut` with `ucode -T -c`: a stray brace would otherwise ship
   green and quietly move every user to another theme.
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
(`[data-page="admin-status-overview"]`).

Variables a theme template gets: `theme`, `media`, `resource`, `ctx`, `dispatcher`, `dispatched`,
`node`, `version`, `config`, `blank_page`, `css`, `lua_active`, `http`, `ubus`.

### Where footstrap differs

- **One template directory**, `ucode/template/themes/footstrap/`. `header.ut` is thin; `<head>`,
  brand, notices, logout and search live in `partials/*.ut`. Sidebar and top bar are **not a second
  template** — they are `:root[data-layout]` plus CSS.
- **`data-page` is built from the dispatch path**, `join('-', length(ctx.path) ? ctx.path :
  ctx.request_path)` — the reverse of bootstrap's order. On a firstchild route (`/admin/status`
  renders overview) `request_path` is only `['admin','status']`, so `body[data-page=
  'admin-status-overview']` rules and the overview include silently did not apply.
- The first element in `<body>` is a skip link; the content container is
  `<main class="fs-main" id="maincontent" tabindex="-1">`; the menu is `<nav class="fs-sidebar">`.
  Not `<aside>` — that carries the `complementary` role, which no landmark jump reaches.
- The document heading is `<h1 class="fs-title-main">` inside `.fs-title.fs-sr`, **clipped, not
  `hidden`**: `hidden` is `display:none`, which drops the element out of the accessibility tree, so
  the `<h1>` effectively did not exist while the SPA router dutifully updated it.
- `partials/head.ut` sends `cascade.css`, `node.css` and `cbi.js` with `?v={{ pkgs_update_time }}`
  (uhttpd sends no `Cache-Control`), preloads the two latin Manrope subsets, and passes every
  interpolation through `entityencode(striptags(...))`.

## `sysauth.ut` is mandatory for a theme with its own chrome

luci-base's generic `sysauth.ut` opens with `{% include('header') %}` — **without `blank_page`** —
while the theme's header hides its whole shell behind `{% if (!blank_page) %}`. Without a
theme-local `sysauth.ut`, sidebar, menu and footer draw around the login form and every control in
them is dead: there is no session yet.

The theme's `sysauth.ut` exists for exactly one line:

```
{% include('header', { blank_page: true }) %}
```

**The form is rendered by the SERVER.** Bootstrap's pattern — a hidden `<section>` plus a client
view module — was tried here and produced a **blank page you could not log in from**: the view
bootstraps before a session exists, its RPCs answer "Access denied", the promise rejects and
`render()` never runs. Server rendering works with JS off, cannot be broken by a rejected promise,
and needs no `luci-theme-bootstrap` installed. Do not go back.

Login strings deliberately carry **no `msgctxt`**, so luci-base translates them in the ~40 languages
this theme has no catalogue for — see [conventions.md](conventions.md).

## The menu is entirely client-side

The server header emits empty containers by id; client JS fills them. The footer loads the renderer
with `L.require('menu-footstrap')`, then `L.require('fs-select')`.

Menu JS lives in `htdocs/luci-static/resources/` — **not** in the theme directory — because
`L.require()` resolves against `resourcebase`. From there it pulls its dependencies through
`'require <module> as <name>'` pragmas:

```
menu-footstrap        → ui, fs-fit, fs-prefs, fs-widgets, menu-footstrap-common
menu-footstrap-common → ui, fs-fit, fs-menutree, fs-chrome, fs-router,
                        fs-appearance, fs-overview, fs-prefs, fs-sheets, fs-search
fs-appearance         → fs-widgets, fs-version, …
fs-select             (no requirer — the footer loads it directly)
```

The graph is acyclic and the runtime enforces it: `require()` throws `DependencyError` on a cycle.

**There is no update checker, and no longer one to load.** A separate `luci-app-footstrap-updater`
used to be resolved at runtime, deferred to idle, because a theme module may not require a package
that might not be installed. It is retired: the installer adds the owfeed-packages feed, so
`apk upgrade` / `opkg upgrade` carries the theme forward, and a settings page has no business
reaching GitHub to reimplement that. `fs-version.js` reports the installed version with no request.

The server-side glob that told the client whether the updater was on disk (`window.__fsUpd`) went
with it. The same trick survives for the doodle wallpapers: `partials/head.ut` globs
`/www/luci-static/footstrap/{cats,dinos}.svg` and hands the client `window.__fsWp`, so the Footstrap
tab knows which doodle still needs downloading without a probe request each.

Renderer and shell in detail: [chrome.md](chrome.md).

## Registration in UCI

```
config core 'main'
    option mediaurlbase '/luci-static/footstrap'    # the active theme
    option resourcebase '/luci-static/resources'

config internal 'themes'
    option Footstrap '/luci-static/footstrap'       # the list the dropdown is built from
```

**Exactly one entry.** Bootstrap registers a symlinked theme per mode (`BootstrapDark`, …);
footstrap does not, because mode, palette and layout are client axes. `uci-defaults` deletes the
legacy names (`FootstrapDark`, `FootstrapTop`, …) and migrates `mediaurlbase` onto the single
remaining path. Details: [package.md](package.md).

## The runtime layout on the router

`luci.mk` maps `ucode/` → `/usr/share/ucode/luci`, `htdocs/` → `/www`, `root/` → `/`:

```
/usr/share/ucode/luci/template/themes/footstrap/
        header.ut, footer.ut, sysauth.ut, partials/*.ut
/www/luci-static/footstrap/            cascade.css (generated), fonts/, logo.svg
                                       (+ cats.svg / dinos.svg once downloaded — not shipped)
/www/luci-static/resources/            menu-footstrap.js, menu-footstrap-common.js, fs-*.js
/usr/lib/lua/luci/i18n/footstrap-theme.<lang>.lmo    catalogue, bundled INSIDE the theme package
/usr/share/rpcd/acl.d/luci-theme-footstrap.json      ACL: uci footstrap + login-bg upload
/usr/share/luci-theme-footstrap/.installed           "already installed" marker
/etc/uci-defaults/30_luci-theme-footstrap            registration
```

## Where the boundary runs

The theme supplies the **chrome and the design language**. Page content is drawn by the view JS of
`luci-mod-*`, whose structure the app fixes.

The theme **can** style every stock widget through `cascade.css` and its tokens, own the sidebar,
top bar, logo and indicators, and re-order the stock overview sections.

The theme **cannot** turn the overview into a KPI dashboard with a memory ring and sparklines —
that is a view module in a separate `luci-app-*`.

The single exception is `fs-overview.js`: a layout-only, additive include that moves stock overview
sections (System left, Memory/Storage right) and draws no content of its own.

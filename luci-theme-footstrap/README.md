# luci-theme-footstrap (the package)

The package directory of a LuCI theme for OpenWrt **24.10.3 and newer** (ucode templates), for developers working on it.
Internal name: `footstrap`. Media path: `/luci-static/footstrap`.

Installing and using it: [the repository README](../README.md). Developer documentation: [`../docs/`](../docs/README.md).

## One theme, one entry, one menu renderer

`luci.themes` carries exactly one entry, `Footstrap` → `/luci-static/footstrap`.
There are no per-layout or per-mode themes.

Everything else is a client axis on the System → Footstrap page:

- layout: the top bar by default, or the side menu;
- mode;
- palette;
- density;
- wallpaper;
- rounding;
- every colour: the accent, the three status colours and the four surfaces.

The axes live in `localStorage`, plus attributes and inline properties on `:root`.
Nothing is written to the router until "Save to router" is pressed.

There is one menu renderer too, `renderMainMenu` in `fs-chrome.js`.
The top bar is its own markup, morphed by CSS through `:root[data-layout]`.
There is no second template, no second renderer and no `footstrap-top` symlink.

## The theme draws the chrome, not the page content

**The theme's boundary:** it supplies the chrome and the design language.
Page content is drawn by the view JS of `luci-mod-*`.

The one exception is `fs-overview.js`.
It draws no content of its own and only re-arranges the stock overview sections.

## Layout

The main parts. The full tree is in [`../docs/package.md`](../docs/package.md) "Source tree".

```
Makefile                          luci.mk; Build/Prepare (CSS, mangle, strip, version)
styles/                           CSS source: layers tokens / base / theme / pages
build-css.sh                      styles/ → htdocs/luci-static/footstrap/cascade.css
po/                               translation catalogue (Weblate translates this)
ucode/template/themes/footstrap/  header.ut, footer.ut, sysauth.ut, partials/
htdocs/luci-static/footstrap/     cascade.css (generated), logo.svg; no webfonts, no wallpaper
htdocs/luci-static/resources/     menu-footstrap.js, fs-*.js, view/footstrap/appearance.js
root/                             uci-defaults, the conffile, menu.d, the ACL, keep.d, the pattern CGI
```

### Do not edit `cascade.css`

Rule: edit `styles/`, never `cascade.css`.
Why: `build-css.sh` generates `cascade.css` from `styles/`, and git ignores it.

| Change | File |
|---|---|
| Colours | `styles/03-palettes.css` |
| Scales and tokens | `styles/02-tokens.css` |

### Upgrades come from the package feed

There is no update checker.
The theme is installed from the package feed, which `install.sh` adds.
So `apk upgrade` / `opkg upgrade` carries it forward like everything else on the router.

The System → Footstrap page shows the version it is running and makes no network call to do it.

## Working on a router

The normal dev stand is the disposable routers `../owlab.yaml` defines, driven by `owlab`.
See [`../docs/development.md`](../docs/development.md).

`dev-sync.sh` targets a hardware router over ssh:

1. Push the theme. The default host is `router2512`. This registers the theme but does NOT activate it.

   ```sh
   ./dev-sync.sh [host]
   ```

2. Activate the theme:

   ```sh
   ssh router2512 'uci set luci.main.mediaurlbase=/luci-static/footstrap; uci commit luci; rm -f /tmp/luci-indexcache*'
   ```

3. To roll back to bootstrap:

   ```sh
   ssh router2512 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci'
   ```

## Before you push

| Topic | Page |
|---|---|
| Verifying a change | [`../docs/verifying.md`](../docs/verifying.md) |
| The rules and the traps | [`../docs/conventions.md`](../docs/conventions.md) |
| Packaging | [`../docs/package.md`](../docs/package.md) |

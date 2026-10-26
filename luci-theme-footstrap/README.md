# luci-theme-footstrap (the package)

A LuCI theme for OpenWrt **24.10.3 and newer** (ucode templates). Installing and using it:
[the repository README](../README.md). Developer documentation: [`../docs/`](../docs/README.md).

Internal name: `footstrap`. Media path: `/luci-static/footstrap`.

## One theme, one entry

`luci.themes` carries **exactly one** entry, `Footstrap` → `/luci-static/footstrap`. Everything
else is a **client** axis on the System → Footstrap page: layout (top bar by default, or the side
menu), mode, palette, density, wallpaper, rounding and every colour. The colours are the accent, the
three status colours and the four surfaces. The axes live in `localStorage` plus attributes and
inline properties on `:root`. Nothing is written to the router until "Save to router" is pressed. There are no per-layout or per-mode themes.

There is one menu renderer too, `renderMainMenu` in `fs-chrome.js`. The top bar is its own markup,
morphed by CSS through `:root[data-layout]`. No second template, no second renderer, no `footstrap-top` symlink.

**The theme's boundary:** it supplies the chrome and the design language; page content is drawn by
the view JS of `luci-mod-*`. The one exception is `fs-overview.js`, which draws no content of its own
and only re-arranges the stock overview sections.

## Layout

The main parts; the full tree is in [`../docs/package.md`](../docs/package.md) "Source tree".

```
Makefile                          luci.mk; Build/Prepare (CSS, mangle, strip, version)
styles/                           CSS source: layers tokens / base / theme / pages
build-css.sh                      styles/ → htdocs/luci-static/footstrap/cascade.css
po/                               translation catalogue (Weblate translates this)
ucode/template/themes/footstrap/  header.ut, footer.ut, sysauth.ut, partials/
htdocs/luci-static/footstrap/     cascade.css (generated), logo.svg; no webfonts, no wallpaper
htdocs/luci-static/resources/     menu-footstrap*.js, fs-*.js, view/footstrap/appearance.js
root/                             uci-defaults, the conffile, menu.d, the ACL, keep.d, the pattern CGI
```

There is no update checker. The theme is installed from the package feed (`install.sh` adds it), so
`apk upgrade` / `opkg upgrade` carries it forward like everything else on the router. The
System → Footstrap page shows the version it is running and makes no network call to do it.

**Do not edit `cascade.css`.** `build-css.sh` generates it from `styles/`, and git ignores it.
Colours go in `styles/03-palettes.css`, scales and tokens in `styles/02-tokens.css`.

## Working on a router

The normal dev stand is the disposable routers `../owlab.yaml` defines, driven by `owlab`. See
[`../docs/development.md`](../docs/development.md). `dev-sync.sh` targets a **hardware** router over
ssh:

```sh
./dev-sync.sh [host]   # push over ssh, default host router2512 (registers the theme but does NOT activate it)
ssh router2512 'uci set luci.main.mediaurlbase=/luci-static/footstrap; uci commit luci; rm -f /tmp/luci-indexcache*'
ssh router2512 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci'   # roll back
```

Before pushing, see [`../docs/verifying.md`](../docs/verifying.md). The rules and the traps are in
[`../docs/conventions.md`](../docs/conventions.md); packaging is in
[`../docs/package.md`](../docs/package.md).

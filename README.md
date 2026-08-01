# LUCI-THEME-FOOTSTRAP

**English** · [Русский](README_ru.md) ·
**[Playground — try the whole thing with no router](https://vizzletf.github.io/luci-theme-footstrap/playground.html)**

[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap.json)](https://owfeed.org/install/)
[![owfeed](https://img.shields.io/endpoint?url=https://repo.owfeed.org/badge/luci-theme-footstrap-releases.json)](https://owfeed.org/install/)

<picture>
  <source media="(max-width: 767px)" srcset="assets/readme/phone-menu-dark.png">
  <img src="assets/readme/overview-top-dark.png" width="100%" alt="The same overview in dark with the top bar: the menu sits on the brand's row and the content runs full width.">
</picture>

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

Adds its own package feed and installs from it — after that the theme upgrades with
`apk update && apk upgrade`, like the rest of the router.

[More screenshots →](docs/screenshots/)

## What it does

<img src="assets/readme/appearance-dark.png" width="100%" alt="The Footstrap tab on System → System: layout, theme, palette, density and rounding; the colour fields for accent, the status colours and the surfaces, each with the contrast it lands at in words; the wallpaper picker with the cats doodle behind the page; and Save as default next to the two resets.">

- **Styles apps, not just the stock pages**
- **Works on a phone**
- **Light** — no framework, `luci-base` is the only dependency
- **Faster than bootstrap** — see the numbers below
- **Upgrades with the router** — installed from the package feed, so `apk upgrade` carries it
- **Appearance is yours** — eighteen axes, applied instantly, in one tab

You pick **Footstrap** once in **System → System → Language and Style**, and everything below lives
in the **Footstrap** tab on that same page. Every axis is a *client* preference: it applies
instantly, with no reload.

- **Layout** — top bar (the default) or the side menu
- **Theme** — auto (follows your OS), light or dark
- **Palette** — Footstrap (GitHub Primer colours) or Hi-Contrast
- **Density** — compact, normal or large
- **Wallpaper** — off, cats, dinosaurs (downloaded on demand, not shipped) or an image you upload
- **Tint** — washes one hue into the background, so you can tell which router a tab (or a screenshot
  in a ticket) belongs to
- **Colours** — accent and the three status colours, each a hex you type, with the ink over it
  derived from its lightness and the contrast it lands at reported in words
- **Surfaces** — cards, controls, the sidebar and the hairlines, same field
- **Rounding** — corner radius, 0–20px
- **Submenus** — keep several sections open, or auto-collapse to one

A set you like can be saved as the router-wide default, so a fresh browser starts from it.


## Measured, not claimed

Time to first paint, same router, same pages.

| Page | bootstrap | footstrap |
|---|---:|---:|
| Wireless | 288 ms | **16 ms** |
| Interfaces | 367 ms | **63 ms** |
| DNS | 328 ms | **84 ms** |
| Firewall | 300 ms | **88 ms** |
| 36-page run | 7458 ms | **3196 ms** |
| Requests/page | 15–48 | **0–8** |

Median page **3.04× faster**, the whole run **2.33×**.

<details>
<summary>The same numbers as a chart</summary>

<img src="assets/readme/speed.svg" width="720" alt="Benchmark: Wireless status 288 ms to 16 ms, Interfaces 367 to 63, DNS 328 to 84, Firewall zones 300 to 88. Whole 36-page run 7458 ms to 3196 ms, 2.33 times; median page 3.04 times; requests per page 15–48 down to 0–8.">

</details>

## Install

```sh
wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh
```

The script adds its own package feed and installs from it, so everything after that is
`apk update && apk upgrade` (or `opkg`) — the theme upgrades with the rest of the router.

Then pick **Footstrap** in **System → System → Language and Style**, field "Design". That is the
only thing you set on the router; everything else lives one tab along, under **Footstrap** on the
same page, and belongs to your browser.

## Dev routers

Four of them — OpenWrt and ImmortalWrt, 25.12 and 24.10 — from one file, on any
OS. Needs [owlab](https://github.com/owfeed/owlab) and Docker:

```sh
go install owfeed.org/owlab/cmd/owlab@latest
owlab up                 # build and start all four
owlab sync --watch       # rebuild the CSS and push it on every edit
owlab open owrt2512      # open LuCI in a browser
```

Log in as `root` with an empty password. Details and the reasoning are in
[docs/development.md](docs/development.md).

owlab also builds the real package — `owlab build` runs the OpenWrt SDK and writes
`dist/<arch>/`, which [owfeed](https://github.com/owfeed/owfeed) signs and publishes without
either tool depending on the other. This theme is the worked example of that whole path;
[ECOSYSTEM.md](https://github.com/owfeed/owfeed/blob/main/docs/ECOSYSTEM.md) is the map.

## Building a luci-app?

The [developer devkit](https://vizzletf.github.io/luci-theme-footstrap/) has the colour token grid,
the component markup and a style checker you can paste into.

There is also a written guide:
[how to style a LuCI app so it works under any theme](docs/luci-app-styling-guide.md) — CSS
lifetime, namespacing, the colour contract, dark-mode detection, and what this theme does when an app
breaks the rules. Drawn from 30 real apps and checked on a router.

## Documentation

Developer documentation lives in **[docs/](docs/README.md)** — architecture, the design system, the
stylesheet build, the SPA router, packaging and the release runbook. Start with
[docs/architecture.md](docs/architecture.md) for what the theme is, or
[docs/conventions.md](docs/conventions.md) for the rules a patch has to follow.

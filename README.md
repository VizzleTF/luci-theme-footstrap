# LUCI-THEME-FOOTSTRAP

**English** · [Русский](README_ru.md) ·
**[Playground — try the whole thing with no router](https://vizzletf.github.io/luci-theme-footstrap/playground.html)**

<img src="assets/readme/overview-top-dark.png" width="100%" alt="The same overview in dark with the top bar: the menu sits on the brand's row and the content runs full width.">

[More screenshots →](docs/screenshots/)

<img src="assets/readme/section-what.svg" width="100%" alt="What it does">

<br clear="left">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/appearance-dark.png">
  <img align="right" width="279" src="assets/readme/appearance-light.png" alt="The Appearance popover: layout, theme, palette, density, wallpaper, tint, accent, rounding, submenus, updates, and Save/Reset as the router default.">
</picture>

## Styles apps, not just the stock pages.

## Works on a phone.

## Light.

## Faster than bootstrap

## It can update itself.

## Have own appearence.


You pick **Footstrap** once in **System → System → Language and Style**. Every axis on the right is a
*client* preference: it applies instantly, with no reload.

- **Layout** — side menu or top bar
- **Theme** — auto (follows your OS), light or dark
- **Palette** — Footstrap (GitHub Primer colours) or Hi-Contrast
- **Density** — compact, normal or large
- **Wallpaper** — off, cats, or an image you upload
- **Tint** — washes one hue into the background, so you can tell which router a tab (or a screenshot
  in a ticket) belongs to
- **Accent** — re-hues buttons, toggles, sliders and focus rings
- **Rounding** — corner radius, 0–20px
- **Submenus** — keep several sections open, or auto-collapse to one

A set you like can be saved as the router-wide default, so a fresh browser starts from it.
<br clear="right">


<img src="assets/readme/section-speed.svg" width="100%" alt="Measured, not claimed">

<br clear="right">
<img src="assets/readme/speed.svg" width="720" alt="Benchmark: Wireless status 288 ms to 16 ms, Interfaces 367 to 63, DNS 328 to 84, Firewall zones 300 to 88. Whole 36-page run 7458 ms to 3196 ms, 2.33 times; median page 3.04 times; requests per page 15–48 down to 0–8.">

<br clear="right">

<img src="assets/readme/section-install.svg" width="100%" alt="Install">

<br clear="right">

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/install.sh | sh
```

Then pick **Footstrap** in **System → System → Language and Style**, field "Design". That is the only
thing you set on the router. For a specific version, pass the tag: `... | sh -s v0.9.0`.

<br clear="right">

<img src="assets/readme/section-devkit.svg" width="100%" alt="Building a luci-app?">

<br clear="right">


The [developer devkit](https://vizzletf.github.io/luci-theme-footstrap/) has the colour token grid,
the component markup and a style checker you can paste into.

There is also a written guide:
[how to style a LuCI app so it works under any theme](docs/20-luci-app-styling-guide.md) — CSS
lifetime, namespacing, the colour contract, dark-mode detection, and what this theme does when an app
breaks the rules. Drawn from 30 real apps and checked on a router.

## Licence

The theme is Apache-2.0, and that is not a free choice: `styles/base/` began as a fork of
[luci-theme-bootstrap](https://github.com/openwrt/luci)'s `cascade.css`, the ucode templates derive
from LuCI's own, and a few JS helpers are copied from LuCI verbatim. All of that is Apache-2.0, its
notices travel with it, and the LuCI/OpenWrt ecosystem is Apache-2.0 too.

The bundled webfonts are not covered by it. Manrope and JetBrains Mono are under the
[SIL Open Font License 1.1](luci-theme-footstrap/htdocs/luci-static/footstrap/fonts/OFL.txt), whose
text and notice ship beside the fonts, as that licence requires.

---

Internals, the build and development notes live in [docs/](docs/) (Russian). The README's own assets
live in [assets/readme/](assets/readme/); the screenshots are reproduced by
[tools/readme-shots.py](tools/readme-shots.py).

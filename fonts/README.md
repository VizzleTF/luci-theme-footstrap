# Fonts

The theme ships **no webfonts**. `--fs-font-sans` and `--fs-font-mono` name Manrope and JetBrains
Mono first and the system stack after, so a visitor who has either installed locally sees the theme
drawn in it and everyone else falls through to `system-ui` / `ui-monospace` — no request, no 404, no
flash. That is the default and for most routers it is the right one: the faces were 48 % of the
package.

This directory holds the script that puts a font back, if you want one. Run it on the router, as
root:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/fonts/set-font.sh | sh -s -- --sans Inter
```

Nothing here is bundled with the theme and **no font is named or hosted in this repository** — a
family shortcut would be somebody else's licence and somebody else's host written into the package.
You bring the file or the URL; the theme never fetches anything at run time.

## The two ways, and they are independent

**A name only.** `--sans Inter` writes `footstrap.settings.font_sans` and stops there. Nothing is
downloaded and nothing is served, so it costs zero bytes of flash and renders for the visitors who
already have that font on their machine. This is a plain uci string, so it is equally correct to
write it by hand:

```sh
uci set footstrap.settings.font_sans='Inter, system-ui, sans-serif'
uci commit footstrap
```

A value with a comma in it is used as a **complete stack**; a bare name gets the theme's own
fallbacks appended, which is what you want unless you are deliberately dropping them.

**A name and a file.** `--sans Inter --sans-file …` also writes the `.woff2` into
`/etc/footstrap/fonts/`, generates an `@font-face` sheet beside it and points the theme at both.
Now **this router serves the font**, so every visitor sees it whatever they have installed.

```sh
# a variable font — one file covers every weight, so say so
sh set-font.sh --sans Inter --sans-file /tmp/InterVariable.woff2 --sans-weight '100 900'

# two static faces
sh set-font.sh --sans Inter --sans-file /tmp/Inter-Regular.woff2 --sans-bold-file /tmp/Inter-Bold.woff2

# the monospace side, from a URL
sh set-font.sh --mono 'Fira Code' --mono-file https://example.org/FiraCode-Regular.woff2

# undo everything
sh set-font.sh remove
```

Naming a family **declares that whole side**: `--sans Inter` with no file removes any sans face the
script installed before, because the file belonged to the previous name. The side you do not mention
is left exactly as it is, so the two commands above compose.

## Weights, and the one setting worth understanding

footstrap sets body text at **600** and titles and labels at **700** (`--fs-weight`,
`--fs-weight-bold`). What a face *claims* therefore decides whether any of that is visible:

- **one static face** — leave `--sans-weight` alone. It is declared `400`, the browser synthesises
  600 and 700, and the page reads as designed. Declared `400 700` instead, that single face would
  cover both and every heading would render in the regular one: the hierarchy flattens and nothing
  reports an error.
- **a variable font** — pass `--sans-weight '100 900'` (or whatever the face's range is). Real
  weights beat synthesised ones.
- **two static faces** — the split lands on 600, not 700: regular claims `400 600` (so body text is
  set in it) and bold claims `700`. That is the default when `--sans-bold-file` is given.

The mono side defaults to `400` and needs no bold: the theme *assigns* `<strong>` the sans face
deliberately, so there is no bold mono to feed.

## What the script refuses

- **anything that is not a woff2 or woff**, decided by the first four bytes rather than by the
  file name. A raw `.ttf` or `.otf` is refused with the command to convert it — there is no
  compressor on a router and the same face is three to five times the bytes uncompressed:
  `fonttools ttLib.woff2 compress Face.ttf`, or `woff2_compress` from google/woff2.
- **anything over 512 kB** per face (`--max` raises it). A Latin+Cyrillic variable face subset for a
  UI lands well under that; a full unsubsetted family does not.
- **a family name outside `A-Za-z0-9 ,._"'-`**, 120 characters at most. The name is printed into the
  page unescaped, and that charset is what makes it safe — it contains no way to close an element or
  start a second declaration. A Cyrillic or CJK family carries a Latin name too; use that one.
- **a download over an unverified channel.** Certificates are always checked, there is no `-k`
  anywhere and no fallback to one: this runs as root, and a failed verification is the MITM case.

A refusal leaves the router exactly as it was — every file is fetched and checked before anything is
written.

## Where it all lands

| path | what |
|---|---|
| `/etc/footstrap/fonts/*.woff2` | the faces, 0644 (uhttpd 403s on anything less) |
| `/etc/footstrap/fonts/fonts.css` | the generated `@font-face` sheet — `@font-face` only, no `:root` |
| `/etc/footstrap/fonts/faces` | what is installed, so a later run can regenerate the sheet |
| `/www/luci-static/footstrap/fonts` | a symlink; uhttpd serves only `/www` |
| `footstrap.settings.font_sans` / `.font_mono` | the stacks, printed into every page |
| `footstrap.settings.fonts` | the sheet's md5 — the cache key, and the switch that emits the link |

`/etc` on purpose: a package upgrade cannot delete it, and `lib/upgrade/keep.d` carries it over a
firmware sysupgrade. The sheet carries **no** `:root` block, which is why editing `font_sans` by
hand works without regenerating it.

Unlike every control on the Appearance page, this is **router-wide with no per-browser layer**:
there is no localStorage to override it and nothing to reset. A font is infrastructure, not a
preference.

## Licence

`set-font.sh` is Apache-2.0, like the rest of this repository. The font you install is yours to
comply with — most open faces are SIL OFL 1.1, which requires the licence to travel with the Font
Software.

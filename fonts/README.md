# Fonts

How to give the theme a custom font, for a router admin who wants one.
The theme ships no webfonts; `set-font.sh` puts a font back, and you bring the file or the URL.

## By default the theme uses the system font

The theme ships **no webfonts**.
`--fs-font-sans` and `--fs-font-mono` name Manrope and JetBrains Mono first and the system stack after.

A visitor who has either font installed locally sees the theme drawn in it.
Everyone else falls through to `system-ui` / `ui-monospace`: no request, no 404, no flash.

That is the default, and for most routers it is the right one.

## Put a font back with one command

Run it on the router, as root:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/fonts/set-font.sh | sh -s -- --sans Inter
```

Nothing in this directory is bundled with the theme.
No font is named or hosted in this repository.

Rule: you bring the file or the URL; the theme never fetches anything at run time.
Why: a family shortcut would write somebody else's licence and somebody else's host into the package.

## Choose a name only, or a name and a file

The two ways are independent.

| Way | What it writes | Who sees the font | Router flash used |
|---|---|---|---|
| A name only | `footstrap.settings.font_sans` | Visitors who already have that font on their machine | zero bytes |
| A name and a file | The `.woff2` or `.woff`, an `@font-face` sheet, the setting | Every visitor, whatever they have installed: this router serves the font | the file |

### A name only writes one uci string

`--sans Inter` writes `footstrap.settings.font_sans` and stops there.
Nothing is downloaded and nothing is served.

It is a plain uci string, so writing it by hand is equally correct:

```sh
uci set footstrap.settings.font_sans='Inter, system-ui, sans-serif'
uci commit footstrap
```

| Value | How the theme uses it |
|---|---|
| Contains a comma | A complete stack, used as is |
| A bare name | The theme's own fallbacks are appended. This is what you want unless you are deliberately dropping them. |

### A name and a file makes the router serve the font

`--sans Inter --sans-file …` also writes the `.woff2` or `.woff` into `/etc/footstrap/fonts/`.
It generates an `@font-face` sheet beside it and points the theme at both.

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

### Naming a family replaces that whole side

`--sans Inter` with no file removes any sans face the script installed before.
The file belonged to the previous name.

The side you do not mention is left exactly as it is, so the two commands above compose.

## Set the weight a face claims to match the file

footstrap sets two weights:

| Text | Weight | Token |
|---|---|---|
| Body text, labels, controls | 600 | `--fs-weight` |
| Titles, table headers | 700 | `--fs-weight-bold` |

What a face claims decides whether these weights are visible:

| You install | Do this | Why |
|---|---|---|
| One static face | Leave `--sans-weight` alone. | It is declared `400`; the browser synthesises 600 and 700, and the page reads as designed. Declared `400 700`, that single face would cover both, and every heading would render in the regular one. The hierarchy flattens and nothing reports an error. |
| A variable font | Pass `--sans-weight '100 900'`, or whatever the face's range is. | Real weights beat synthesised ones. |
| Two static faces | Nothing: this is the default when `--sans-bold-file` is given. | The split lands on 600, not 700. Regular claims `400 600`, so body text is set in it. Bold claims `700`. |

The mono side defaults to `400` and needs no bold.
The theme assigns `<strong>` the sans face deliberately, so there is no bold mono to feed.

## What the script refuses

A refusal leaves the router exactly as it was: every file is fetched and checked before anything is written.

| Refused | Why |
|---|---|
| Anything that is not a woff2 or woff | Decided by the first four bytes, not the file name. A router has no compressor, and the same face is three to five times the bytes uncompressed. |
| Anything over 512 kB per face | `--max` raises it. A Latin+Cyrillic variable face subset for a UI lands well under that; a full unsubsetted family does not. |
| A family name outside `A-Za-z0-9 ,._"'-`, or over 120 characters | The name is printed into the page unescaped. That charset is what makes it safe: it has no way to close an element or start a second declaration. |
| A download over an unverified channel | The script runs as root, and a failed verification is the MITM case. Certificates are always checked. There is no `-k` anywhere and no fallback to one. |

A raw `.ttf` or `.otf` is refused with the command to convert it.
Convert it with `fonttools ttLib.woff2 compress Face.ttf`, or `woff2_compress` from google/woff2.

A Cyrillic or CJK family carries a Latin name too; use that one.

## Where it all lands

| path | what |
|---|---|
| `/etc/footstrap/fonts/*.woff2`, `*.woff` | the faces, 0644 (uhttpd 403s on anything less) |
| `/etc/footstrap/fonts/fonts.css` | the generated `@font-face` sheet: `@font-face` only, no `:root` |
| `/etc/footstrap/fonts/faces` | what is installed, so a later run can regenerate the sheet |
| `/www/luci-static/footstrap/fonts` | a symlink; uhttpd serves only `/www` |
| `footstrap.settings.font_sans` / `.font_mono` | the stacks, printed into every page |
| `footstrap.settings.fonts` | the sheet's md5: the cache key, and the switch that emits the link |

The files live in `/etc` on purpose.
A package upgrade cannot delete them, and `lib/upgrade/keep.d` carries them over a firmware sysupgrade.

The sheet carries no `:root` block.
That is why editing `font_sans` by hand works without regenerating it.

## The font is router-wide, with no per-browser layer

Unlike every control on the Appearance page, the font has no per-browser layer.
There is no localStorage to override it and nothing to reset.

A font is infrastructure, not a preference.

## Licence

`set-font.sh` is Apache-2.0, like the rest of this repository.

The font you install is yours to comply with.
Most open faces are SIL OFL 1.1, which requires the licence to travel with the Font Software.

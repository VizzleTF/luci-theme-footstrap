# Pattern wallpapers

Two drawings to try the **Appearance → Background → Wallpaper → Pattern** axis with.

They are **not part of the theme package** and are not downloaded by it — nothing in footstrap
reaches the network at run time. Save one and upload it from that page like any other file, or run
this on the router, as root:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/wallpapers/set-pattern.sh | sh -s cats
```

`cats` or `dinos`, and the cats are back where they used to be. Details below.

| file | size | tile |
|---|---|---|
| `svg/cats.svg` | 77 kB | 870 units square, reads well around 440 px |
| `svg/dinos.svg` | 128 kB | 2048 units square, reads well around 880 px |

Earlier versions of the theme fetched these two from this repository on demand and checked them
against a pinned sha256. That is gone: a theme in a package feed has no business calling a
third-party host while a settings page is open, and *your* drawing is the interesting half of the
feature anyway. They stay here because they are pleasant and because they are exactly the shape a
pattern wants to be.

## Putting one back on a router without a browser

`set-pattern.sh` does from a shell exactly what the Appearance page's upload does — that is the
point of it, and it is why it is a script here rather than a feature in the theme: **the admin
fetches the drawing deliberately, once.** The one-liner above is the whole interface, in the shape
the theme's own `install.sh` uses.

`cats` and `dinos` are the two drawings above; anything else is taken as a URL or a local file, so
your own tile installs the same way. Options: `--size` (40–1600 px, default per drawing),
`--strength` (0–100 %), `--ink theme|original`, `--keep-wallpaper` (install the file but leave the
wallpaper axis alone), and `remove` as the argument deletes the pattern and turns the wallpaper off.

It writes `/etc/footstrap/pattern.svg` at 0644, links it to `/www/luci-static/footstrap/pattern.svg`
(the extension is load-bearing — uhttpd types a response by extension), and saves the file's md5 as
`footstrap.settings.pattern` alongside the wallpaper, size, strength and colour settings, which is
the *router's* default. **A browser that has already chosen a wallpaper keeps its own choice**:
every axis is per-browser first and the router default second, so on such a browser press *Reset to
saved* on the Footstrap tab, or pick Pattern there by hand.

The script raises the same objections the upload page does, by text matching rather than with a
parser — a shell has no `DOMParser`. That is a cruder instrument in both directions, so a file it
refuses can still be uploaded from the page, where a real parser decides.

## What makes a good pattern

**Line art on a transparent background.** In the default *Colours: Theme* mode the SVG is painted
through a CSS `mask`: the file supplies only its alpha and the theme supplies the ink, so one
upload reads correctly in light mode, in dark mode and under every palette. A drawing with an
opaque background rectangle masks as a solid sheet — for artwork that carries its own palette,
switch that row to *As in file* and it is used as an ordinary tiled image instead.

**Seamless at any size.** The Scale slider sets the tile's edge (40–1600 px) and the drawing is
repeated in both directions; both files here tile seamlessly, so the number is a legibility choice
rather than a geometric constraint.

**Strength is a knob, not a property of the file.** Do not bake a low opacity into the artwork —
the Strength slider fades the whole layer (0–100 %, default 20 %), and a file that is already faint
cannot be turned up.

## What the theme will refuse

The upload is parsed with `DOMParser` — inertly, nothing runs — and rejected if the root is not
`<svg>`, if any element executes or embeds (`script`, `foreignObject`, `iframe`, `embed`, `object`,
`audio`, `video`, `animate`, `set`), if an attribute is a real event handler (`^on[a-z]+$`), if a
value opens a `javascript:` URL, or if an `href` points off the router. `#fragment` and `data:`
references are fine — that is how a tile refers to its own `<defs>` and embeds a bitmap. The cap is
512 kB.

## Licence

Both files are Apache-2.0, like the rest of this repository.

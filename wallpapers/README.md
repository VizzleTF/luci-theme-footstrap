# Pattern wallpapers

Two drawings to try the **Appearance → Background → Wallpaper → Pattern** axis with.

They are **not part of the theme package**, and the theme does not download them: nothing in
footstrap reaches the network at run time. Save one and upload it from that page like any other file, or run
this on the router, as root:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/luci-theme-footstrap/main/wallpapers/set-pattern.sh | sh -s cats
```

`cats` or `dinos`. Details below.

| file | size | tile |
|---|---|---|
| `svg/cats.svg` | 77 kB | 870 units square, reads well around 440 px |
| `svg/dinos.svg` | 128 kB | 2048 units square, reads well around 880 px |

## Putting one back on a router without a browser

`set-pattern.sh` does from a shell exactly what the Appearance page's upload does. It is a script
here, outside the theme, for one reason: **the admin fetches the drawing deliberately, once**. The
one-liner above is the whole interface, in the shape the theme's own `install.sh` uses.

`cats` and `dinos` are the two drawings above. Anything else is taken as a URL or a local file, so
your own tile installs the same way. The options:

- `--size`: 40–1600 px, default per drawing.
- `--strength`: 0–100 %.
- `--ink theme|original`.
- `--keep-wallpaper`: install the file but leave the wallpaper axis alone.

`remove` as the argument deletes the pattern and turns the wallpaper off.

It writes `/etc/footstrap/pattern.svg` at 0644. The theme serves that file through
`/cgi-bin/luci-theme-footstrap-pattern`. The script saves the file's md5 as
`footstrap.settings.pattern`, next to the wallpaper, size, strength and colour settings. Together
they are the *router's* default. **A browser that has already chosen a wallpaper keeps its own
choice**: every axis is per-browser first and the router default second. On such a browser press
*Reset to router* on System → Footstrap, or pick Pattern there by hand.

A shell has no `DOMParser`, so the script checks the file by text matching. It refuses a file that
trips a check instead of cleaning it. The checks catch:

- an executing or embedding element: `script`, `foreignObject`, `iframe`, `embed`, `object`,
  `audio`, `video`, `animate`, `set`;
- an event handler;
- a `javascript:` URL;
- a reference off the router.

Text matching is a cruder instrument than the page's parser, so a file the script refuses can still
be uploaded from the page.

## What makes a good pattern

**Line art on a transparent background.** In the default *Colours: Theme* mode the SVG is painted
through a CSS `mask`. The file supplies only its alpha and the theme supplies the ink. So one upload
reads correctly in light mode, in dark mode and under every palette. A drawing with an opaque
background rectangle masks as a solid sheet. For artwork that carries its own palette, switch that
row to *As in file*, and the theme uses it as an ordinary tiled image.

**No visible seams at any size.** The Scale slider sets the tile's edge (40–1600 px), and the
drawing repeats in both directions. Both files here tile without visible seams, so the number is a
legibility choice, not a geometric constraint.

**Strength is a knob, not a property of the file.** Do not bake a low opacity into the artwork.
The Strength slider fades the whole layer (0–100 %, default 20 %), and a file that is already faint
cannot be turned up.

## What the theme will refuse

The page parses the upload with `DOMParser`, inertly: nothing runs. It rejects the file if it does
not parse, if its root is not an `<svg>` in the SVG namespace, or if it is over 512 kB. Otherwise it
removes the unsafe parts and says how many it removed:

- elements outside the SVG namespace;
- `script` and `foreignObject`;
- a `<style>` that reaches off the document;
- an animation that targets a URL attribute;
- event handlers (`^on[a-z]+$`);
- `xml:base`;
- CSS references off the document;
- any `href` that is not a `#fragment` or a raster `data:` image on an `<image>`. Those two forms
  are how a tile refers to its own `<defs>` and embeds a bitmap.

A file with nothing left after cleaning is rejected.

## Licence

Both files are Apache-2.0, like the rest of this repository.

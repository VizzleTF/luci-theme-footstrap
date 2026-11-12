# Styling a LuCI app so it works under any theme

Rules for authors of `luci-app-*` packages. They hold for every LuCI theme; footstrap-specific
behaviour is marked as such.

*Русская версия: [luci-app-styling-guide_ru.md](luci-app-styling-guide_ru.md).*

Every rule comes from a real bug in a popular app. Each bug shows only on a theme the author did
not test. What these apps do to a shared page is in [third-party-apps.md](third-party-apps.md).

MUST and MUST NOT mark a rule that breaks pages when ignored. SHOULD marks a strong
recommendation; an exception needs a reason.

## The short version

If you read nothing else, follow these seven rules:

1. Return your `<style>` inside the view tree. Never append it to `<head>`.
2. Prefix every class, id and custom property with your app name.
3. Take every colour from the 26 export names (`--*-color-*` and `--on-*-color`), with a literal
   fallback.
4. Put text on a coloured fill in the matching `--on-*-color`.
5. Read dark mode from the theme. Never use `prefers-color-scheme`.
6. Size layout by your container. Never by the viewport.
7. Do work in `render()`. Never in `window.onload`.

The [checklist](#checklist) at the end covers every rule.

## Contents

- [S. Where your CSS lives](#s-where-your-css-lives)
- [N. Names](#n-names)
- [C. Colour](#c-colour)
- [The export tier: 26 names](#the-export-tier-26-names)
- [D. Dark mode](#d-dark-mode)
- [W. Editors and heavy widgets](#w-editors-and-heavy-widgets)
- [L. Layout](#l-layout)
- [P. Page lifetime](#p-page-lifetime)
- [Checklist](#checklist)
- [Apps to copy from](#apps-to-copy-from)

---

## S. Where your CSS lives

A LuCI view is rendered in the browser and swapped in and out of `#view`. A modern theme can be an
SPA: it never reloads the page between clicks. So the place of your `<style>` decides how long it
lives and which pages it hits.

### S-1. Your `<style>` MUST be inside the tree your view returns

Why: it then dies with your view, like the rest of your markup.

```js
// Bad: stays in <head> for the whole session
document.head.appendChild(E('style', [ css ]));

// Good: lives exactly as long as the view
return E([], [
    E('style', [ css ]),
    E('div', { 'class': 'myapp-root' }, …)
]);
```

Stock LuCI does this in `package-manager.js`, `nftables.js` and `aria2/log.js`.

A view built on `form.Map` returns `m.render()`, a promise of the map's node. Put the `<style>`
inside that node, as `luci-app-smartdns` does:

```js
return m.render().then(node => {
    node.classList.add('myapp-root');   // the root for your names and container queries
    node.prepend(E('style', [ css ]));
    return node;
});
```

What goes wrong otherwise: a sheet in `<head>` looks harmless on a full page load, because the next
click throws the page away. Under an SPA theme it stays and restyles every page the user opens next.

- `luci-app-filemanager` hides the stock Save, Apply and Reset buttons this way
  (`.cbi-button-save { display: none !important }`). Every config page in the session loses them.
- `luci-app-banip` and `luci-app-adblock` do the same with a `<link>`.

### S-2. You SHOULD NOT inject CSS when your module loads

Why: a `<style>` added at the top level of a module is created once per page. The module is cached,
so the sheet can never be created again. A theme that cleans it up cannot give it back, and your
widget loses its styles.

The same happens with a library that injects its own CSS. ACE does this with its 14 KB
`ace_editor.css`.

S-2 is a last resort; use S-1 whenever you can. If you must inject this way: make the injection idempotent, and expect the sheet to stay for the
life of the page.

### What footstrap does with a sheet in `<head>`

This part is footstrap-only background. S-1 is all you need to act on.

footstrap never deletes a sheet. It keeps SPA navigation on while the sheet can paint only your own
page. A sheet is safe when every selector in it does one of these:

- It names only your own classes: `.ace_*`, `.hexview`, `.myapp-card`.
- It names a stock widget, pinned to a name of your own:
  `#cbi-myapp-section > .cbi-section-remove`, `.myapp-table th.sortable.active`.
  Without your section or table, these match nothing.
- It is a bare selector that declares only your own custom properties:
  `:root { --myapp-accent: … }`.

These do not count as safe:

- A `:not()` argument is not a pin. `.cbi-button-save:not(.my-save-button)` still matches every
  stock Save button on every page.
- `:root { color-scheme: light dark }` declares more than a custom property.

Any other sheet switches the next navigation to a full page load. Your app still works; the user
waits for one ordinary page load. Real examples from apps in the top 30 by stars:
`.cbi-button-save { display: none }`, `.error { … }`, `h4 { … }`, `div > label + select { … }`,
`svg text { … }`.

---

## N. Names

You share the page with the theme and with every other app.

### N-1. Classes and ids MUST start with your package name

Why: dictionary words collide with the theme and with other apps.

```css
/* Bad */  .hidden { … }   .label { … }   .toast { … }
/* Good */ .myapp-hidden { … }   #cbi-myapp-status { … }
```

Live collisions found in real apps: `.hidden`, `.label`, `.description`, `.centered`, `.skeleton`,
`.toast`, `.dialog-title`, `.flex-row`, `.log-line`, and `luci-lib-taskd`'s
`[hidden] { display: none !important }`.

### N-2. Custom properties SHOULD be declared on your root element, not on `:root`

Why: `:root` is shared by everyone. A theme token with the same name gets repainted without a
warning. If you do use `:root`, every name there MUST carry your prefix: `--myapp-*`.

```css
/* Bad: luci-app-filemanager's hex editor */
:root { --clr-background: …; --clr-border: …; --clr-highlight: …; }

/* Good: OpenClash scopes its ~90 properties this way */
.oc { --oc-accent: …; }
```

The file manager also writes `color-scheme` on `:root`, which changes the whole page.

### N-3. You MUST NOT ship a global reset or a CSS framework

Why: they restyle the theme's own sidebar, header and menus.

```css
/* Bad: OpenClash, twice */
* { margin: 0; padding: 0 }
/* Bad: vssr */
@import url(pure.css);
```

### N-4. You MUST NOT restyle stock LuCI selectors outside your own page

Why: the theme owns `.cbi-button-up`, `.cbi-value`, `.cbi-section-table-titles`, `ul.dropdown` and
`table th` and `pre`. Your CSS is unlayered, so it beats every cascade layer of the theme. footstrap catches
such a sheet and moves it into its own `theme` layer. Other themes do not. A sheet that names only
your own classes stays unlayered.

```css
/* Bad: every table on every page */
table th { … }
/* Good: only inside your page */
.myapp-root table th { … }
```

The same rule works for you inside your page. Your scoped CSS outranks the theme there without
`!important`. See [C-4](#c-4-you-should-not-use-important-to-beat-the-theme).

---

## C. Colour

### C-1. Colours MUST come from the export tier, with a literal fallback

Why: every LuCI theme sets the same 26 names. A literal is right only on the one palette you looked
at.

```css
/* Bad */
color: #333;
background: white;

/* Good */
color:            var(--text-color-high, #333);
background-color: var(--background-color-low, #f5f5f5);
border-color:     var(--border-color-medium, #ddd);
color:            var(--error-color-medium, #f44336);
```

The full list is in [The export tier](#the-export-tier-26-names) below.

A colour with no family of its own still comes from the 26 names:

| You need | Use |
|---|---|
| a neutral or grey badge | `--background-color-medium` with `--text-color-medium` |
| an "info" colour | the `primary` family |

footstrap has more than light and dark. These axes move the export tier with them:

- `:root[data-palette]` swaps the whole colour set: default, hicontrast, bootstrap, 2020, forum.
- The Tint slider shifts the hue of every surface (`:root[data-tint]` with `--fs-tint-h`, any hue
  1–360).

A `#f7f7f7` card chosen to match the default panel is wrong once the user picks hicontrast. A
hand-picked amber is wrong once they drag the tint by 40°.

### C-2. Text on a coloured fill MUST use the matching `--on-*-color`

Why: each `--on-*-color` passes WCAG AA on top of the `-high` level of its family. The right ink
differs per palette and per mode, so a hardcoded `#fff` fails on some of them.

Fill with `-high`. The `-medium` and `-low` levels are text colours; no ink is guaranteed on them.

```css
/* Bad */
.myapp-badge { background: var(--success-color-high, #2e7d32); color: #fff; }
/* Good */
.myapp-badge { background: var(--success-color-high, #2e7d32); color: var(--on-success-color, #fff); }
```

### C-3. You MUST NOT read `--fs-*` names

Why: they are footstrap's private tier. footstrap renames them whenever it needs to, and no other
theme has them.

`cascade.css` holds over a hundred `--fs-*` properties: `--fs-accent`, `--fs-panel2`,
`--fs-radius`, `--fs-dim`, the z-index scale. Their names are shorter and clearer than the export names. Only the
26 `--*-color-*` names are a contract.

Background, nothing to do: an app sheet is unlayered and outranks every theme layer. One app writing
`:root { --accent: … }` or `:root { --text-color-high: … }` would repaint the theme. So footstrap
reads only its `--fs-*` names and derives the export names from them
(`styles/02-tokens.css`).

### C-4. You SHOULD NOT use `!important` to beat the theme

Why: your CSS, scoped to your own names, is unlayered. Unlayered CSS already beats every layer of
the theme, and your `:root` cannot repaint the theme (see [C-3](#c-3-you-must-not-read---fs--names)).

If your app has an `!important` to win against the theme, delete it. It was never what made the
rule win.

### C-5. A surface MUST NOT be a literal colour

Why: a literal surface looks wrong in the other mode.

- passwall: `background: white` on a `position: fixed` modal. On a dark page it is a white box.
- justclash: `#1e1e1e` on a log terminal. On a light page it is a black box.

Use `--background-color-high` for a raised surface such as a modal or a card.

### C-6. Text of colour C MUST NOT sit on a translucent tint of C

Why: the tint pulls the background toward the text and eats the contrast. The result depends on
what is underneath, so no opacity value is safe everywhere.

```css
/* Bad */
.myapp-chip { color: var(--error-color-medium, #f44336); background: rgb(244 67 54 / 15%); }
/* Good: opaque surface, the border carries the colour */
.myapp-chip { color: var(--error-color-medium, #f44336);
              background: var(--background-color-high, #fff);
              border: 1px solid var(--error-color-medium, #f44336); }
```

### C-7. You MUST NOT use `<font color>`

Why: `<font color="green">` (dockerman, ssr-plus, OpenClash) vanishes on half the palettes. Use
`--success-color-medium`.

---

## The export tier: 26 names

This table is the whole contract. Nothing else is one. All 26 names are colours.

| Family | Names | Notes |
|---|---|---|
| Surfaces | `--background-color-high` / `-medium` / `-low` | elevation: `high` is raised (a card), `low` is recessed (the page) |
| Rules | `--border-color-high` / `-medium` / `-low` | `high` is the visible rule, `low` is the hairline |
| Text | `--text-color-highest` / `-high` / `-medium` / `-low` | four levels |
| Accent | `--primary-color-high` / `-medium` / `-low`, `--on-primary-color` | |
| OK | `--success-color-high` / `-medium` / `-low`, `--on-success-color` | |
| Warning | `--warn-color-high` / `-medium` / `-low`, `--on-warn-color` | the family is `warn` |
| Error | `--error-color-high` / `-medium` / `-low`, `--on-error-color` | |

### Names that do not exist

No LuCI theme defines these names, so they always fall through to your literal:

| You wrote | Use instead |
|---|---|
| `--warning-color-*` | `--warn-color-*` |
| `--text-color` | `--text-color-high` |
| `--secondary-color-*` | none; pick a family above |
| `--font-sans`, `--font-mono`, `--disabled-opacity` | none; the tier is colour only |

Two real cases:

- podkop writes `var(--warn-color-medium, orange)` 7 times. That is correct: it paints the themed
  amber. Renaming it to `--warning-color-medium` would drop all 7 into the `orange` fallback.
- justclash writes `--text-color` 6 times. That name does not exist; it is `--text-color-high`.

### What the tier guarantees

footstrap measured 70 combinations: {light, dark} × {default, hicontrast, bootstrap, 2020, forum}
× seven tint values. In every one of them:

- Every level of `text`, `primary`, `success`, `warn` and `error` passes WCAG AA as text on all
  three `--background-color-*` surfaces. Paint any of them as `color:` without checking.
- Each `--on-*-color` passes AA on top of its own colour used as a fill.
- `high`, `medium` and `low` are three different colours. "No data" in `--primary-color-low` reads
  quieter than a live value in `-high`.

Two caveats:

- For `--background-color-*`, `high` means raised, not stronger. For every other family, `high` is
  the strongest colour.
- `-low` is the faintest step a palette can afford. Text in it is legible, but there is no fainter
  step below it.

---

## D. Dark mode

### D-1. You MUST NOT detect dark mode with `prefers-color-scheme`

Why: `prefers-color-scheme` reports the operating system, not the theme. Every modern LuCI theme
has its own light/dark switch. A user who forces dark on a light OS gets your light card on a dark
page. netspeedtest, vssr, passwall and stock `ustreamer` have this bug.

### D-2. You SHOULD NOT detect dark mode at all

Why: if every colour comes from the export tier, dark mode already works. `luci-app-nikki` reads no
theme state and looks right on every theme.

### D-3. When you must detect it, you MUST ask the theme

Check these in this order:

```js
function isDark() {
    const root = document.documentElement;
    if (root.dataset.darkmode) return root.dataset.darkmode === 'true';  // OpenClash, luci-app-internet-detector
    if (root.dataset.theme)    return root.dataset.theme === 'dark';     // footstrap, justclash
    if (root.dataset.bsTheme)  return root.dataset.bsTheme === 'dark';   // Bootstrap 5
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);   // any theme
    return m && m.length >= 3
        ? (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255 < 0.5
        : false;
}
```

```css
/* Bad */
@media (prefers-color-scheme: dark) { .myapp-card { … } }
/* Good: follows the theme on its own */
.myapp-card { background: var(--background-color-low, #fff); }
/* Good, only if you need a dark-only override */
:root[data-theme="dark"] .myapp-card { … }
```

Facts behind this code:

- Apps use four dialects. footstrap sets three of them on `:root` before the first paint:
  `data-darkmode`, `data-theme` and `data-bs-theme`.
- `luci-app-internet-detector` keys its dark styles off `:root[data-darkmode="true"]`, so it looks
  right on footstrap with no changes.
- The brightness fallback works only because themes keep the `body` background opaque. Do not rely
  on any single attribute existing.

---

## W. Editors and heavy widgets

### W-1. The editor's colour theme MUST follow the page's mode

Why: a pinned dark theme is a black editor on a light page. mosdns and AdGuardHome pin CodeMirror
to `dracula`; ssclash pins ACE to `tomorrow_night_bright`.

Pick the editor theme from `isDark()` in [D-3](#d-3-when-you-must-detect-it-you-must-ask-the-theme).
OpenClash does this right: `themeExtension(isDark)`.

### W-2. A bundled library MUST go under your own path

Why: two apps that ship different versions to a shared path overwrite each other. AdGuardHome ships
CodeMirror to `/luci-static/resources/codemirror/`.

Put it under `/luci-static/resources/view/<YOURAPP>/`.

### W-3. An iframe SHOULD follow stock `luci-app-ttyd`

Do this:

- Size it `width: 100%; min-height: …; resize: vertical`.
- Take the port from UCI.
- Use the same protocol as the page.

Do not:

- Hardcode a port. dockerman uses `:7682`.
- Paint the iframe `background: #fff`, as netspeedtest does. The embedded page picks its own colours.

### W-4. `z-index` SHOULD stay in a normal range

Why: the theme's own overlays and dropdowns cannot sit above a huge value. passwall's dropdown uses
`2147483647`; OpenClash's fullscreen editor uses `999999 !important`. Nothing you render needs to be
above everything.

### W-5. You MUST NOT set `body { pointer-events: none }`

Why: if a navigation happens while it is set, the whole UI stops responding. passwall sets it while
its modal is open.

---

## L. Layout

### L-1. Breakpoints SHOULD follow your container, not the viewport

Why: the theme puts a sidebar next to your page. On footstrap it is 224 px wide. On a 1024 px
screen your column is about 740 px, while `@media (max-width: 768px)` still says "desktop".

Apps that stack cards by viewport break in exactly that band: justclash at 56rem, podkop at 900 px,
netspeedtest at 768 px.

```css
/* Bad */
@media (max-width: 768px) { .myapp-cards { flex-direction: column; } }
/* Good */
.myapp-root { container-type: inline-size; }
@container (max-width: 768px) { .myapp-cards { flex-direction: column; } }
```

Pick the breakpoint from the width your cards need, not from a device size. `container-type`
makes the element ignore its children's width, so put it on a block that fills its column.

If you cannot use `@container`, measure your own container in JS and set a class.

### L-2. Tables SHOULD NOT combine `table-layout: fixed` with a `min-width` on every cell

Why: it stops the theme from stacking table rows into cards on a narrow screen. filemanager does
this.

### L-3. Containers SHOULD NOT have a fixed px width

```css
/* Bad */  .myapp-panel { width: 900px; }
/* Good */ .myapp-panel { width: 100%; max-width: 900px; }
```

---

## P. Page lifetime

A modern theme can create your view again without reloading the page. These rules cost nothing on a
classic theme.

### P-1. You MUST NOT do your work in `window.onload` or `DOMContentLoaded`

Why: both fire once per page. After the first navigation your handler never runs again. diskman
and passwall's `optimize_cbi_ui.htm` break this way.

Do the work in `render()`.

### P-2. Pollers and timers MUST stop when your view goes away

Why: a leftover `setInterval` keeps running on every page after yours.

Register pollers through `L.Poll`; LuCI stops them for you. Clear any other `setInterval` yourself.

### P-3. You MUST NOT append lasting nodes to `document.body`

Why: they survive the view swap. podkop's toast container and taskd's dialog do this.

Put them in your view tree.

### P-4. You MUST NOT add a `popstate` handler that navigates

Why: it races the theme's router, and both navigate. istore does this.

### P-5. Hide stock buttons through the view, not CSS

The rule: when your view must not show a stock button, you MUST set its handler to `null`:
`handleSave`, `handleSaveApply`, `handleReset`. A `null` handler removes the button, so keep the
ones your form needs to save.

Why: this is the supported way. It needs no `!important` and does not leak onto the next page.
`luci-app-partexp` and `luci-app-ttyd` do this.

```js
// Bad: hides Save on every page after yours (see S-1)
document.head.appendChild(E('style', [ '.cbi-button-save { display: none !important }' ]));

// Good: the view file starts with 'require view';
return view.extend({
    handleSave: null,
    handleSaveApply: null,
    handleReset: null,
    render() { … }
});
```

---

## Checklist

Tick every line before you publish:

- [ ] S-1: `<style>` is inside the view tree, not appended to `<head>`.
- [ ] N-1, N-2: every class, id and custom property starts with the app name.
- [ ] N-2, N-3: custom properties on your root element, or on `:root` only as `--myapp-*`; no `* { … }`, no CSS framework.
- [ ] N-4: no stock `.cbi-*`, `table` or `pre` selector outside your own subtree.
- [ ] C-1: every colour is one of the 26 export names; a literal appears only as its fallback;
      `warn`, not `warning`.
- [ ] C-2: text on a coloured fill uses `--on-*-color`, never a hardcoded `#fff`.
- [ ] C-3: no `--fs-*` read anywhere.
- [ ] C-4: no `!important` used to beat the theme.
- [ ] D-1, D-2: dark mode is not detected at all, or it comes from `data-darkmode`, `data-theme`, `data-bs-theme` or body brightness,
      never from `prefers-color-scheme`.
- [ ] W-1: the editor theme follows the page's mode.
- [ ] L-1: layout follows the container, not the viewport.
- [ ] P-5: a stock button you do not want is removed by a `null` handler, never hidden with CSS.
- [ ] P-1, P-3, P-4, W-4: no `window.onload`, no leftovers on `body`, no `popstate` handler, no
      `z-index: 2147483647`.

## Apps to copy from

| App | What it does right |
|---|---|
| `luci-app-nikki` | no injected CSS, no colour literals, stock forms only |
| stock `luci-app-ttyd` | the iframe |
| `luci-app-smartdns` | its `<style>` is returned inside the `.cbi-map` it belongs to |
| `luci-app-internet-detector` | custom properties scoped as `:root { --app-id-* }`, dark styles keyed off the theme's attribute |

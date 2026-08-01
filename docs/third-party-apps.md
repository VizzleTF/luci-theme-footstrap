# Living with third-party `luci-app-*`

What foreign apps actually do to a shared LuCI document, and the rules the theme follows because
of it. Written for someone changing the theme.

**Rules for app authors live in [luci-app-styling-guide.md](luci-app-styling-guide.md)**, the
outward-facing document the README links. Where the two disagree, that one is the source of truth.

> Surveyed July 2026 against sources (GitHub tarballs) and on a live OpenWrt 25.12 router with
> Playwright: 20 apps — 6 proxy stacks (OpenClash, passwall, passwall2, ssr-plus, mosdns, vssr),
> 5 clash/mihomo wrappers (ssclash, podkop, justclash, homeproxy, nikki), 4 heavyweights
> (dockerman, diskman, istore, AdGuardHome) — plus stock `openwrt/luci` apps as a baseline.
>
> The prompt: `luci-app-ssclash`'s config editor drew as a black rectangle with no text and blew
> the page up to 2 007 346 px. The cause was not the app but the theme, and it forced a rewrite of
> the whole theme↔app contract.

## What a foreign app actually does

### 1. It injects CSS into `<head>`, and that survives an SPA navigation

A full page load throws such a `<style>` away with the document, so the app is right to treat it as
"mine for one page". Our router does not reload the document, and the CSS stays forever.

| App | What it puts in `<head>` | When |
|---|---|---|
| `luci-app-filemanager` (stock) | `.cbi-button-save/-apply/-reset { display:none !important }`; the sbwml fork adds bare `th`/`td`/`tr:hover`/`.table` | every render |
| `luci-app-filemanager` (newer) | `:root { color-scheme: light dark; --light-bg:… }` | every render |
| `HexEditor.js` (same package) | `:root { --clr-background:… }` | **module eval** |
| `luci-app-banip`, `luci-app-adblock` | a `<link>` to `custom.css` styling `.cbi-input-text`, `.cbi-input-select` | **module eval** |
| `luci-app-olsr-viz` | `.label { color:black; background:white }` | every render |
| `luci-app-openvpn` (stock) | `h4 { white-space:nowrap; … }` | every render |
| `luci-app-podkop` | 4 KB: `#cbi-podkop-*`, `.centered`, `.rotate`, `.skeleton`, `.toast*` | **every render, no dedup** |
| `luci-app-mosdns` | three `<link>`s to CodeMirror 5 | every render |
| ACE (`luci-app-ssclash` and anyone shipping `ace.js`) | `ace_editor.css` (14 KB), `error_marker.css` | **module eval** |

The distinction that matters is **not** `<style>` vs `<link>` — it is **who can put the CSS back**:

- injected **in render** (filemanager, podkop): the app will repeat it on the next render;
- injected **at module eval** (ACE, HexEditor, banip, adblock): it will **never** repeat, because
  the module is cached for the life of the document. Deleting such a sheet breaks the app until a
  page reload. That is what happened to SSClash.

Separately: a `<style>`/`<link>` **inside the view's tree** (package-manager, nftables, aria2,
v2raya, nlbwmon) is harmless — it dies with the contents of `#view`.

### 2. It sniffs dark mode, in four different dialects

There is no standard, so apps guess:

- **`[data-theme="dark"]` on `:root`** — `luci-app-justclash` (21 rules);
- **`:root[data-darkmode="true"]`** — `luci-app-internet-detector` (and OpenClash writes it);
- **`data-bs-theme`** (a Bootstrap 5 convention) — `luci-app-ssclash` checks it first;
- **the brightness of `getComputedStyle(document.body).backgroundColor`** — ssclash (fallback),
  OpenClash (`isDarkBackground`), passwall (four copies of a YIQ function). OpenClash then **stamps
  `data-darkmode` on our `:root`** itself;
- **`@media (prefers-color-scheme: dark)`** — netspeedtest, vssr, passwall, ustreamer. That is the
  **OS**, not the theme: a user with a dark theme on a light OS gets light cards on a dark page.
  Unfixable in CSS, by construction.

### 3. Everything else that breaks, or could

- **z-index wars**: passwall `2147483647`, OpenClash `999999 !important`, dockerman/diskman
  overlays at `20000`, podkop's toast container at `9999` in `document.body`.
- **Global resets**: OpenClash `*{margin:0;padding:0}` (twice), vssr `@import "pure.css"`.
- **Generic class names claimed**: `.hidden`, `.label`, `.description`, `.centered`, `.skeleton`,
  `.toast`, `.flex-row`, `[hidden]{display:none!important}` (`luci-lib-taskd`).
- **Viewport media queries** (justclash 56rem, podkop 900px, netspeedtest 768px): our content
  column is narrower than the viewport by the sidebar's width, so their "mobile" layout switches on
  later than it should.
- **Hard-coded dark editors**: mosdns and AdGuardHome nail CodeMirror to `dracula`, ssclash nails
  ACE to `tomorrow_night_bright`. The editor stays black on a light page — and on bootstrap too, so
  it is not our regression.
- **Legacy Lua/CBI is still the majority** (OpenClash, passwall(2), ssr-plus, vssr, dockerman,
  diskman, AdGuardHome, istore). Full reload on every click, and all their CSS lives exactly on
  their page.

## The theme's rules

### Rule 1. View CSS is NEVER deleted

Deletion is irreversible: a sheet imported at module eval does not come back. Symptom: a
structureless black ACE and a 2-million-pixel page.

### Rule 2. A document holding an "invasive" sheet hands the next page over by full load

A sheet is invasive if it could paint **somebody else's** page. Three tests, all on the facts rather
than on a list of names — the set of theme names and custom properties is read out of `cascade.css`
at runtime, 0.3 ms per transition:

1. **A bare selector** — no class, id or attribute (`pre`, `*`, `svg text`, `div > label + select`).
   It hits stock markup by construction.
   *Exception:* if every declaration is a custom property the theme does not read
   (`:root { --app-temp-status-temp: … }`), there is nothing for it to paint — inert. But
   `:root { color-scheme: light dark }` (stock filemanager) is a standard property, and it re-points
   every UA widget in the document at the OS setting.
2. **A stock name with no pin** — a selector made entirely of names the theme knows
   (`.cbi-button-save`, `.label`, `.error`, `.cbi-input-text`). It has nothing to hold it to the app,
   so it matches the same widgets on every page.
   *Not invasive:* `#cbi-podkop-section > .cbi-section-remove`,
   `.bandix-table th.sortable.active`, `.device-toolbar .cbi-input-select` — the stock class is
   **pinned** by the app's own name and cannot match without its markup. Functional pseudo-class
   arguments are discarded when looking for the pin: `.cbi-button-save:not(.custom-save-button)`
   mentions its own name **inside a negation**, which is an exclusion, not a scope, so the sheet
   stays invasive.
3. **An unreadable sheet** (`<link>` still loading, 404, cross-origin) counts as invasive — the
   conservative answer is slow, not broken.

How that lands on the router's actual apps:

| SPA preserved | Full load on leaving |
|---|---|
| ACE/ssclash (`.ace_*`) | filemanager (`.cbi-button-save:not(…)`) |
| podkop (`#cbi-podkop-*`) | stock openvpn (`h4 { white-space: nowrap }`) |
| bandix tables, hex editor (`.hexview`) | bandix (`.error { … }` — a global class) |
| the overview CPU include | wrtbwmon (`div > label + select { min-width }`) |
| temp-status: its `:root { --app-* }` | temp-status: its own `svg text { fill }` |

Implementation: `fs-sheets.js` → `themeNames()`, `inertDeclarations()`, `invasiveSheet()`,
`documentPoisoned()`. It covers both `<style>` and `<link rel=stylesheet>`; `[data-fs-shell]` and
everything inside `#view` are excluded. Full detail: [spa-router.md](spa-router.md).

`fs-sheets.js` also re-declares the layer order as a **new** `<style>`, first child of `<head>`,
because a foreign sheet landing ahead of `cascade.css` inverts the cascade layers — see
[css.md](css.md).

### Rule 3. The only safe deletion is a byte-identical duplicate

`dedupeViewSheets()`. The rules do not disappear (the first copy stays), and a library's "have I
imported this?" check still finds its sheet. Without it, podkop accumulates one `<style>` per visit.

### Rule 4. Dark mode is announced in three dialects

`data-darkmode` (read only by the theme itself) plus `data-theme` and `data-bs-theme` for outbound
compatibility. `styles/` may never read the latter two — the same boundary as the export tier.
`tools/axes.mjs` holds it: the pre-paint in `head.ut` and the live `stampDark()` must stamp the same
set.

### Rule 5. `body` must have an OPAQUE background of the right brightness

This is what every brightness sniffer reads. A transparent `body` (background moved to `:root` or a
pseudo-element) makes OpenClash decide "light" — its `/rgb\(/` regex does not even match
`rgba(0,0,0,0)` — and repaint our dark page in its light palette. `tools/export-tier.mjs` holds it
across the whole palette × mode × tint matrix.

### Rule 6. The export tier is a contract, and it has to be a ramp

Apps read `--primary-color-*`, `--text-color-*`, `--background-color-*`, `--border-color-*` with a
literal fallback. The export surface is exactly **26 names**, and the warning family is called
**`warn`**: `--warn-color-high/-medium/-low` and `--on-warn-color`.

Two findings that used to be filed as one:

- **podkop's `var(--warn-color-medium, orange)` (7 uses) WORKS.** The name is correct and resolves
  to the theme's ochre. There is no `--warning-color-*` anywhere in the tree, so "fixing" podkop to
  use that would drop all seven declarations into the `orange` fallback. An earlier revision of this
  document claimed the opposite; that was wrong.
- **justclash's `var(--text-color, inherit)` (6 uses) is a real typo.** There is no level in the
  name and no such property; the correct one is `--text-color-high`. Do not invent `--text-color`
  on our side: that fixes somebody's typo at the price of a name we would then support forever.

The private `--fs-*` tier (~125 properties) is **not** part of the contract and is not addressed to
apps — which is exactly why it is separated. See [design-system.md](design-system.md).

### Rule 7. The chrome is fenced off, in three places that must agree

An app's unlayered `!important` outranks every cascade layer, so the chrome cannot be defended by
the cascade. It is defended by **not matching**, in three places — and `npm run chrome-fence` is
what keeps them agreeing. Proven rather than assumed: breaking the fence constant to
`.fs-sidebarTYPO` left the menu completely unprotected while `npm run check`, `jsmin-verify` and
eslint **all exited 0**.

1. **`header.ut` — the markup.** A chrome root **marks itself** with `data-fs-chrome`. The `<nav>`
   is one; so are the skip link, the two sr-only elements and the command palette, none of which sits
   inside it. The
   mark is what the other two read.
2. **`fs-sheets.js` — the fence.** `CHROME_FENCE` is appended to a foreign selector's subject so it
   can no longer **match** a chrome element. That is what beats a third party's `!important`: there
   is nothing left to outrank.
3. **`theme/10-chrome.css` — the pin.** It closes the one way in a fence cannot: **inheritance**
   from `html`/`body`, where no match is needed at all.

The gate **derives the mark from the markup** and never restates it: rename it in `header.ut` and
the gate re-derives it, then fails on the two copies still saying the old name. The failure it
prevents has **no symptom** — the fence silently stops fencing, every test stays green, and the menu
breaks on someone else's router months later.

The fence and the pin are each **one canonical string** and are compared whole rather than tested
for tokens. That is not pedantry: the token version's four independent `includes()` checks all
passed on `:where(:not(.fs-sidebar), .fs-sidebar *)` — a plausible botched edit that is the exact
**inverse** of a fence, targeting the chrome instead of sparing it.

The shapes both strings encode, each a measured bug:

- **`:where()` in both**, because it contributes zero specificity. Drop it from the fence and every
  app rule silently gains a point, re-ordering the app's stylesheet against itself on its own page.
  Drop it from the pin and the pin starts fighting the chrome's own rules on source order.
- **The fence must cover the root AND its subtree** (`[m], [m] *`); the root alone leaves every menu
  element inside it exposed.
- **The pin must cover the root ALONE**, and it says so itself (`:not([m] *)`) rather than trusting
  that nobody ever nests a mark. Pinning descendants was measured and it broke the chrome's own
  inheritance — a direct declaration beats an inherited one even when the inherited one is ours,
  costing `.fs-label` its `nowrap` and forcing `text-align` from `start` to `left` on 302 elements,
  which breaks every RTL language LuCI ships.
- **The pin may carry only inherited properties.** A non-inherited one there is a style decision
  wearing a guard's coat, and at zero specificity it would lose to everything anyway.

The same gate holds the dark-mode guard to `stampDark`: that guard exists because third parties
write the attributes this theme publishes (`luci-app-openclash` does it in seven templates). Add a
fourth dialect to `stampDark` and forget the observer's `attributeFilter`, and that dialect is
unguarded — silently.

### What the theme cannot do, and should not try

- `@media (prefers-color-scheme)` in an app's CSS is overridden by nothing — it is an OS setting.
  The only mitigation is that our default is Auto, which follows the OS.
- Hard-coded literals (`background: white` on a passwall modal, justclash's `#1e1e1e` terminal, 167
  colours baked into `luci-app-statistics` PNGs) are not our bytes.
- An app's z-index on its own page is its own page.
- An app's viewport media queries do not know about our sidebar.

## How to check

```sh
npm run check      # includes axes (rule 4) and export-tier (rules 5, 6)
```

On a live router, the scenario that would catch everything above:

1. open an app with ACE/CodeMirror (ssclash) → SPA to a neighbouring tab → back. The editor must
   still be alive (rule 1);
2. open File Manager → go to System. Save/Apply/Reset must still be there (rule 2);
3. visit podkop three times over SPA. The number of `<style>` elements in `<head>` must not grow
   (rule 3);
4. justclash in dark mode: its `[data-theme="dark"]` rules must match (rule 4).

## Appendix: the second ten by stars

quickfile, tailscale-community, smartdns, internet-detector, 3ginfo-lite (client JS — brought up on
the router and rendered) plus cloudflarespeedtest, aliddns, koolproxy, ech-workers, sms-tool
(legacy Lua — read).

**All ten preserve SPA navigation, and none injects anything that could paint someone else's page.**

- `luci-app-internet-detector` is the only one of the ten that injects into `<head>` at all, at
  module eval: `:root { --app-id-* }` (its own prefix, so inert by our rule) plus its own `.id-*`
  classes. Its dark block hangs on `:root[data-darkmode="true"]` — **our** attribute — so dark mode
  works for it out of the box. A fourth detection dialect, and we already stamp it.
- `luci-app-smartdns` is the model: `E('style', [css])` returned **inside** `.cbi-map`, so it dies
  with the view.
- Legacy Lua apps put `<style>` in the page template, including bare `table { … }`. It cannot leak
  (the page is server-rendered and SPA never enters), but light surfaces stay light on a dark
  theme — unfixable from outside.

The rules above cover the entire second ten with no theme change. Breakage is concentrated in the
big old apps, not in the mass.

## Appendix: `luci-app-podkop`, the app the fence was tested against

Checked against `itdoginfo/podkop@main` sources, not from memory: the injected CSS was assembled
from its template literals and **replayed on a live router** exactly the way the app does it.

**What it does right:**

- **One injection point**, one `<style>` in `<head>`. Not a `<link>` from the template, not
  `insertRule()` in pieces.
- **Names in its own space**: 30 of 40 selectors carry the BEM prefix `pdk_dashboard-page__…`, the
  rest are pinned to its own ids. Our "pinned to the app" signal is a name the theme does not know,
  and it is present in nearly every rule.
- **It reads the export tier, not our private tokens**: `--background-color-low`,
  `--success-color-medium`, `--warn-color-medium`, `--error-color-medium`, `--primary-color-high`,
  `--primary-color-low`, `--text-color-high`. All seven are defined and follow the mode.

**Our verdict on its real CSS:** `documentPoisoned()` is `false`, 0 chrome elements damaged, the
sheet is not rewritten. So SPA is not disabled on podkop's pages and the theme leaves its styling
alone. That is the "we are not over-clamping" check: the judge was tightened, and the model app
still passes untouched.

**What stayed generic, and why it is survivable:** `.centered`, `.rotate`, `.skeleton`, `.toast*`
have no prefix. The theme does not style them, so by our test they count as pinned to the app and
are left alone. That is luck, not protection — had the app called a class `.center` or `.table`, it
would have landed in the shared vocabulary. Advice to authors: prefix **every** name, helpers
included.

**What we borrowed from it:** the loading placeholder. podkop draws a skeleton while its data
arrives; our SPA had the same hole on a cold route. See [spa-router.md](spa-router.md).

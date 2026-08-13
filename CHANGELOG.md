# Changelog

Notable changes to `luci-theme-footstrap`, newest first. Format is
[Keep a Changelog](https://keepachangelog.com/1.1.0/); commits are
[Conventional Commits](https://www.conventionalcommits.org/), versions are
[SemVer](https://semver.org/). Sections, in fixed order: Added, Changed,
Deprecated, Removed, Fixed, Security, Performance — one of each per release.
Style and format guide: [docs/releasing.md](docs/releasing.md).

[CHANGELOG_ru.md](CHANGELOG_ru.md) mirrors this file. Edit both in one commit.

Every commit writes into `[Unreleased]`. Cutting a tag renames that heading.

## [Unreleased]

### Fixed

- **A router the feed cannot serve now gets the theme installed instead of a URL to go and fetch by hand.** Reported from a SNAPSHOT router that refused with "the feed carries no apk branch for aarch64_cortex-a53" — three lines after its own `wget` had downloaded the installer over the same protocol. The cause was the downloader choice: `fetch()` took the first tool that EXISTED, and `uclient-fetch` needs libustream-mbedtls to speak https at all, which an image shipping wget-ssl or curl instead does not carry. Every tool is now tried in turn until one succeeds — none of them ever asked to skip certificate checks — and reproduced with a stub that always fails, the old script printed exactly the field report while the current one installs from the feed. When no feed index can be read at all, the script no longer stops: it names the URLs it probed and the three things that break reachability (DNS, the clock, TLS), then installs the **signed release** — the artifact named by `manifest.txt`, never guessed from an asset name (issue #6), with the chain failing closed in order: verified TLS, `usign -V` against the release key pinned in the script, then the manifest's sha256 over the download. A wrong key leaves nothing installed. Measured on snapshot/apk, 25.12/apk and 24.10/opkg.

- **The open menu category no longer wears the same plate as the page inside it.** `li.active` marks the SECTION that contains the current page as well as the page's own row, so on System → System two identical accent plates sat one above the other, both reading "System" — measured before the change as the same fill, the same ink and the same 13px/600 on both, differing in 2px of padding, with the next root category after a ten-item section reading as an eleventh child. The plate now belongs to the page alone, which is what the markup already said (`aria-current="page"` is on the leaf, never on a section header), and the ancestor keeps the accent ink. In the expanded sidebar the accordion also gains what an indent alone could not say: root rows in bold, a hairline down the group's reading edge and 6px more air before the next category. Bold rather than lighter children on purpose — `--fs-weight-normal` is documented as having no face of its own, so it would look like hierarchy on a system stack and like nothing on a router carrying a 600/700 subset. Reported in #37 with two mockups; this is the lighter of them, plus the duplicate-plate fix the mockups worked around.

- **The "Applying configuration changes…" dialog no longer prints its spinner on a line of its own.** `ui.changes.displayStatus()` builds that dialog as a block box carrying `alert-message notice spinning` with a `<p>` inside it, and the spinner is a `::before` on the box — an `inline-block` glyph, which is right for the button labels and `em.spinning` texts that are its usual hosts and wrong here: a block child cannot share a line with it, so the message dropped underneath the glyph and against the dialog's start edge. Reported on the luci PR with a screenshot. The alert now lays the two out as a two-column grid — glyph, then everything else — which also survives the shapes `displayStatus()` and `addNotification()` can hand it: measured at 1440px, one `<p>`, `h4` + `<p>` and bare text all used to start 24.6 / 20.6 / 19.5px below the glyph's line and now start on it, and the one-paragraph dialog is 57.5px tall instead of 78.1px.

- **A sheet injected by a view the user has already navigated away from is credited to its own page again, and stops painting the page that superseded it.** The router names the owner for the length of a `require()` precisely because a require in flight cannot be stopped — but it did that for every require, including one resolving from LuCI's class cache, which injects nothing and cleared the slot again a microtask later. The next click therefore wiped the hint out from under the require that needed it. Two halves, both measured with a view whose module appends `body { outline: 3px solid rgb(9,9,9) }` while the user leaves for a cached page: only a COLD require names an owner now, and the slot carries the navigation that set it so a stale cleanup cannot clear a newer holder's; and the sheet is switched on or off the moment it is taken rather than at the next navigation, as the last step of re-hosting — assigning `textContent` to wrap a sheet in `@layer theme` builds a fresh, enabled `CSSStyleSheet`, so doing it earlier switched the sheet off and straight back on. Two cold requires overlapping still credit the older sheet to the newer page, and that one cannot be closed from here: LuCI evaluates a view module inside `eval()`, so nothing observable says which module is running when a `<style>` appears.

- **A claimed foreign table keeps its row classes and its card captions across a poll.** `tagDataTables()` skipped tables it had already tagged, so the adoption ran once per element while the app kept replacing the rows inside it — every batch after the first arrived without `.tr`/`.td` and without a `data-title`, on a table that may by then be carding, where `overflow: hidden` clips them with no scrollbar. That is the exact failure the adoption exists to prevent, arriving one poll later. Both halves are additive, the one judgement — is this table ours to rewrite, or is it LuCI's own markup? — is still taken once and remembered on the element, and each half answers the common case before it walks anything: the adoption on that memo, the captioning by asking the LAST row, which is the one a poll leaves bare and which on every table LuCI builds itself is already captioned. Measured on Processes, 114 rows and 678 cells: 0.110 ms per pass for the full walk against 0.025 ms with that question asked first, with the same tagged, carded and captioned counts as before and no long task across eight poll ticks.

- **`clearViewIntervals()` no longer reads the deprecated `L.Poll` alias without a guard.** It is the one function in the router whose reasoning is about that alias going away, and it was the only place reading it blind; every other read in the file is guarded. With the alias gone the call threw where a throw costs most — `navigate()` runs it after `#view` has been swapped for the "Loading view…" spinner, so measured with the alias removed, one click left the page on the spinner with no view rendered and a `TypeError` in the console. A missing alias is now the same answer as an unreadable timer: sweep nothing, say so once, let the navigation finish.

- **A browser that refuses a 2D canvas context no longer breaks table fitting.** `wordFloor()` created its measuring canvas without checking, so an anti-fingerprinting extension or a WebView with canvas disabled turned every fit pass into a throw — and because the pass strips `fs-stacked` before it measures, the throw escaped with the class already gone: every stackable table left flat, every later table in the pass unfitted, once a second on a polled page. The context is now taken the way `fs-widgets.js` already takes its own, and a refusal makes this one test report nothing rather than take the other two down with it.

## [0.12.5] — 2026-08-12

### Fixed

- **banIP, adblock and travelmate stop reporting "No … config found!" on the second visit.** Their views read `uci.load()`'s return value as an existence check, but that call answers "which of these packages did THIS call fetch" and skips whatever is already in uci's cache — so the first visit gets `['banip']` and the second gets `[]`, and the page renders an error notification with nothing under it until a reload. Reported on banIP, where switching between its own tabs and returning to Overview is the ordinary gesture. The apps' reading is wrong, but the divergence is the router's: a config cache that outlives the page that filled it is state a fresh load does not have, exactly like the poll queue and the view intervals already flushed beside it. `navigate()` now unloads it, which is upstream's own idiom for the same thing — `uci.save()` ends with `unload(pkgs); load(pkgs)`. Pending unsaved edits go with the cache, as they do on a full load; changes already saved live on the server and the Unsaved-changes banner is unaffected. Read through `window.L.uci` rather than a `require` pragma, so no page that never touches uci pays for uci.js, and a luci-base that keeps the cache elsewhere gets one loud console error instead of a silent no-op.

## [0.12.4] — 2026-08-12

### Changed

- **Four comments that describe the Density axis, the tint strength slider and the control-height derivation now match what they do.** `02-tokens.css` opened its density block with "one axis, two multipliers" and then listed three, and said Compact "does not touch" the type multiplier while `[data-density="compact"]` sets it to `.9` — the whole rationale for `--fs-density-box` existing rests on that premise, and `docs/design-system.md` had inherited the two-token version. The Large step is not the mirror of Compact either: type and box grow while the air stays put, which is what keeps the mode from reading as zoom. The tint's strength multiplier was called "Tint DENSITY (Appearance → Density)" in the palette file and in `head.ut` — Density is the UI-density select four rows above it, and `fs-appearance.js` refuses that name in a comment of its own — so both were corrected and the row's stale `.fs-ap-density` hook renamed with them. And `--fs-control-h`'s derivation cited `--fs-text`, the ink token, where the arithmetic uses `--fs-type`.

- **Two claims about the router-identity tint are stated as measured rather than as designed.** "0 = none" is not what a multiplier of 0 does: the rule is a relative colour that replaces chroma, so it also strips the slight cast the palette's own canvas carries — footstrap dark's `rgb(28,33,40)` paints as `rgb(33,33,33)`. It cannot be conditional either, since the only element that would have to carry the condition is `:root`, which a style query cannot reach; clearing the Tint hue is the real off, and the comment now says so. "No gamut clipping at these values" holds in dark and not in light, where the canvas has no headroom: measured, footstrap light at hue 0 wants 1.011 of the red channel and is clamped. On the bootstrap colourway's pure-white canvas that costs the cue most of its hue discrimination — 180° and 258° land one unit apart — which is the price of copying a stock theme's surfaces exactly.

- **Five failures that used to be silent now say something, and one guess about LuCI's internals asks a documented question instead.** A stylesheet whose `@import` never becomes readable within the deadline leaves the app's rules unfenced while every later pass counts the document as clean — it prints that now, including the case nobody would guess (a page opened in a background tab gets no `requestAnimationFrame` at all, so the deadline passes without one retry). The chrome's width measurement falls back to the literals `CLAUDE.md` forbids copying into JS when a `--fs-*` token is renamed or a foreign sheet reaches its probe; it still falls back, and now says so, because a page that folds at a width nobody chose still looks laid out. The Appearance tab reads three private `ui.tabs` facts to attach itself — one neighbouring fact, `data-tab-group`, has already been dropped between 24.10 and 25.12 with no announcement — so a run that finds no tab group five seconds after arriving on System → System reports that every Appearance axis is unreachable, rather than rendering a perfect stock page and saying nothing. `clearViewIntervals()` protected LuCI's own 1-second tick by reading `L.Poll.timer`, a private field that `stop()` deletes; it asks `L.Poll.active()` first now and only treats a MISSING id on a RUNNING tick as the anomaly, then declines to sweep rather than risk killing every live value on every later page. And the overview's grid reads the first non-empty text node of a section heading instead of `firstChild`, which lands on the title today only because 25.12 happened to append its hide/show `<span>` after the words.

- **Three release-conditioned decisions stopped keying on the release.** The DHCP lease tables were split by upstream's `lases` typo — fixed on 25.12, still present on 24.10 and on ImmortalWrt's fork of it — so a one-character upstream fix would have handed the 24.10 table the 25.12 column plan and silently un-fixed issue #7's wrapping. Both tables now ask the markup the way `base/95-luci.css` says to: five columns is the old shape, six or more the new one, with both spellings accepted. Verified on both containers — 24.10 wraps the hostname column only, 25.12 wraps the hostname and the DUID, exactly as before. `header.ut` reaches `config.main.footstrap_layout` on every page render, where ucode raises a hard reference error through a null: the dispatcher defaults that section today, and `?.` costs nothing to not depend on it — the CI gate could not have caught it either way, since `ucode -T -c` compiles the template rather than running it. And a data table's card captions now count COLUMNS rather than cells, so a `colspan` anywhere but last stops shifting every caption after it by one — "Hostname" over an IP address, with nothing saying the mapping was guessed.

- **A release page now links the installer that release shipped.** `release-notes.sh` printed the `raw.githubusercontent.com/main` one-liner, which undoes both reasons `stage-release.sh` attaches and signs `install.sh`: raw.githubusercontent is rate-limited for unauthenticated callers, so the user whose IP has run out of budget cannot fetch the installer meant to rescue them (issue #17), and a reader of an OLD release page got whatever `main` says today rather than the script that release was tested with. In the same pass `build-apk.sh` — the only thing that still exercises the Makefile, luci.mk and jsmin — defaults to the SDK for 25.12.5 rather than 25.12.2, which downloads.openwrt.org has since moved to the archive, and takes an override for the compiler string that is baked into the filename beside it.

- **Three migrations and one memo now say how long they are needed for.** The `fonts` cleanup in `uci-defaults` is the one that costs a working feature if it is ever tidied away: every router whose last footstrap was 0.12.0 or older has a REAL directory at that path, `ln -sfn` into one exits 0 with the link planted a level deeper, and the admin's webfonts stop serving with nothing reporting it — so it now carries the version floor rather than looking like old history. The legacy palette migration is the opposite: it is already a no-op, because the live applier reads a stray value as the built-in default, and the note says so before someone carries it forward forever. And the search palette's index is built once per document deliberately, because it is a projection of the same client menu tree the sidebar draws from — invalidating one half would make the two disagree about a package installed without a reload.

- **Six pieces of code with no caller, and three that measured time in animation frames, are gone.** A sweep over the whole tree with one question per file — does this comment still describe this code, and is this code load-bearing — turned up dead weight the gates cannot see, because none of it is a dead *selector* or a dead *token*: `widgets.placePopover()` and the `EDGE_GAP` export beside it (the Appearance panel stopped placing anything when it became a tab; the menu's clamp was the last reader, and now owns the constant), `fs-overview.js`'s `isFootstrapTheme()` gate (the module is loaded by the chrome's own footer partial, so `L.env.media` can only ever be this theme), the router's `_curId == null` seeding (`seed()` adopts an entry id before `wire()` makes `navigate()` reachable, and the branch below overwrites it anyway), a second `tree.viewClassFor(node)` where the value was already in scope, `.td.cbi-value-field` in a selector list that already carried `.cbi-value-field`, and `fs-fit.js`'s ResizeObserver feature test (the shipped CSS needs `:has()` and container queries, both years younger in every engine — and the window-resize fallback could not see a rail collapse or a layout toggle, which is the pair the observer exists for). `silence()` in `fs-sheets.js` is now `setEnabled(el, false)` plus the bookkeeping, instead of a verbatim copy of its body. Three empty `catch` blocks now report: an `ui.hideModal()` that throws during a navigation, an `ui.hideIndicator()` that throws on `poll-stop`, and a poll pause/resume that throws on tab switch were each indistinguishable from success. And the two frame-count budgets — 60 frames called "~1 s" for the `@import` fence, 300 called "~5 s" for scroll restoration — are deadlines in milliseconds now: the same budget was 2 s and 10 s on a 30 Hz panel. Behaviour re-measured on the routers: the Appearance tab still builds and still carries 24 rows, all 14-15 selects on a page are still enhanced, a ten-hop walk through the client menu stays in one document, and the chrome boxes measure the same at the default density.

- **A select that cannot be enhanced now fails once, loudly, instead of every mutation frame in silence.** `fs-select.js` caught a `ui.Dropdown` constructor throw and returned — without marking the element, so the next `scan()` re-selected it through `:not([data-fs-select])` and threw again, forever, with nothing in the console. It is marked `skip` in the catch now, the way `multiple` and "not in a CBI field" already were, and the error is logged.

- **Three chrome boxes that opted out of the Density axis are back on it.** The rail's poll glyph and its sibling indicators were a bare `30px`, the dropdown's chevron plate a bare `34px` and the rail toggle a bare `28px` — every one the same size at the default density and no size at all at Compact or Large, which is precisely what `02-tokens.css` legislates against. They read `--fs-ctl-h-sm`, `--fs-btn-size` and a `--fs-density-box` multiple now. Measured on the router: identical at Normal (30/34/28 px), and Compact/Large finally move them (23.8-32.2 px on the toggle).

- **The two chevron glyphs are pinned to each other instead of quietly diverging.** The overview's card toggles and the Appearance folds draw the same 7px rotated square with the same nine declarations, in two page files, because one host is a stock element keyed by attribute and the other is ours keyed by class — no single selector list can carry both. `tools/css-dup.mjs` could not see it (both copies sit under the same guard, which that gate deliberately ignores), so they are `@mirror chevron/closed` and `chevron/open` now, and a change to one fails the build until the other follows.

- **`npm run check` and CI check the same things again.** `conffiles.mjs`, `bang-ok.mjs` and `changelog.mjs` were in the local suite and in no workflow — enforced only when a human ran the whole thing. Each guards a failure nothing observable reports: a conffile the package manager replaces on somebody else's upgrade, an `!important` that drifted out of its allowlist, a changelog bullet with no bold lead, which `release-notes.sh` drops from the release page in silence. All three run in the lint job now.

- **Two gates that could pass while the thing they guard was broken now actually check it.** `axes.mjs` derived the list of stamped attributes with a pattern anchored on `root.setAttribute(` — and `applyLayout()` spells it `document.documentElement.setAttribute(`, so the layout axis was invisible to that section and a new axis could opt out of the check by spelling. Its css-orphans cross-check asked whether `'fs-<key>'` appeared anywhere in `fs-orphans.mjs`, which a key quoted in that file's prose satisfied; it parses the `IGNORE_EXACT` set literal now, comments stripped, and a key commented out there fails the gate (verified by doing it). Three of its success lines were gated on the GLOBAL error list being empty, so one unrelated failure elsewhere in the run deleted them from the report and left an operator unable to tell a passing check from one that never ran; each is gated on its own section now.

- **`npm run minify-js` is gone, and the tree-reading helper is shared.** That script pointed a tool that rewrites files IN PLACE at the checked-in source: one `npm run` away from mangling and comment-stripping all 14 shipped modules. Nothing called it — `tools/stage.sh` runs the minifier over the staged payload, which is the only correct target — so the script is removed and the tool's header now says where it does run. In the same pass `lib/root.mjs` grew the `readAll(dir, ext)` its own comment claimed to have consolidated: `axes.mjs` and `chrome-fence.mjs` had a byte-identical readdir-and-join each, `css-i18n.mjs` and `fs-orphans.mjs` a private `filesIn`, and `filesIn` in the library had no importer at all. `mirror.mjs` and `minify-js.mjs` keep their own walks, and the library says why (a mixed file/directory list, and roots outside the repo).

- **The docs stopped describing a theme with two palettes, eighteen axes and sixteen stylesheets.** A sweep over every checkable number and name in `docs/` found the same drift the code comments had: a `bootstrap` colourway was added and eight places still said two palettes; twenty-one Appearance axes were counted as eighteen in both READMEs; `styles/` is thirty-nine files, not sixteen; `Build/Prepare` has six steps, not seven; the `!important` ratchet is 27 in three tables that said 26; the a11y matrix is 18 combinations and the export tier 42 / 2856 checks, against 12 and 28 / ~1900. Behaviour claims drifted too — `clampDropdown` is gated on `barDropdown()` and runs on a phone, not on a `topBarMode()` that does not exist; `ensureOverviewHelpers()` belongs to `fs-overview.js`, which is where the boundary it enforces is documented; `--text-color-low` is a genuinely distinct third ink now, so the outward styling guide no longer tells app authors it equals `-medium`; `check-packages.sh` is a CI step rather than part of `npm run check`; and the stylesheet's own sizes were re-measured (467 615 B of source, 135 655 B built). The Density axis has three multipliers in `design-system.md` as it does in the tokens, and the pages layer lists `90-processes`.

- **A foreign table is claimed by its header row now, not by carrying LuCI's class.** `.table` is LuCI's own name and every table rule the theme has hangs off it, so an app that emitted a bare `<table>` matched none of them: nothing tagged it, nothing measured it, nothing carded it, and `.fs-main`'s `overflow-x: clip` silently CUT its right-hand columns — the only thing that ever reached it was a phone-tier scrollbar. `tagDataTables()` now takes any `#view table` that has a header row in any of four markups (`.tr.table-titles`, `.tr.cbi-section-table-titles`, a `<thead>`, or a first row made entirely of `<th>` — the shape an app writing plain HTML emits), adds `.table.fs-dt`, and copies the column headings into `data-title` so the card has something to print above each value. A parsed `<thead>` nests a real `<tr>`, which the caption copier did not expect: it was reading the header row's whole text, so every cell of such a table would have been captioned "HostAddressSignal". A table with **no** header row is deliberately left alone and scrolls instead — a card prints a caption per value and a matrix has none, so stacking one produces a column of numbers with nothing saying what they are. That scroll rule is also no longer scoped to `@media (max-width: 767px)`: whether a table fits is a property of its content and its column, which is the argument the whole fit engine rests on, and a 400px panel on a 1600px desktop hits the wall a phone hits. All of it is deliberately unmeasurable here — a census of `#view table:not(.table):not(.cbi-section-table)` across all **196** menu pages on the stand, openclash / justclash / ssclash / dashboard / statistics included, found **zero** — so it is checked against three synthetic shapes on Blink and WebKit at 1440px and 390px instead: both header forms card with the right captions, the header-less matrix stays a scrolling matrix at both widths. Claiming the table is not enough on its own, and finding that out was the point of re-testing: everything that makes the CARD is written one level down — `.table.fs-stacked .tr { display: flex }`, the `.td[data-title]::before` label, the hidden header row — and a bare `<table>` carries none of those names, so the fitter set `.fs-stacked` and changed nothing. Measured at 390px on a bare four-column table: rows still `table-row`, cells still `table-cell` at 80px each, no label, and `overflow: hidden` clipping the columns with no scrollbar to reach them — worse than the phone-tier scroll it replaced. The rows and cells are adopted into `.tr`/`.td`/`.th` too now, which is LuCI's own vocabulary for those roles and the same act as writing `.table` onto the table itself.

### Fixed

- **The prefetch no longer keeps a copy of luci.js's built-in class list.** Six class names have no file — `baseclass`, `dom`, `poll`, `request`, `session`, `view`, which `luci.js` seeds its registry with — and fetching one is a guaranteed 404 in the console, so the walk carried that literal to avoid them. It was a copy of somebody else's software, and a seventh built-in would have cost one 404 per name per session until this theme caught up. The SHAPE of the name answers it instead: a class name is a path, so a name with no dot is either one of those virtual classes or a flat library (`ui`, `form`, `network`, `uci`, `rpc`, `fs`, `validation`) — and every one of those is already loaded before a prefetch can run, because the chrome itself requires `network` for the overview grid, which drags in firewall/uci/rpc/validation, and `ui` comes with the widgets. Measured from three landing pages including the lightest there is (System → Reboot): all eight flat libraries were instances on arrival, and driving the walk over seven pages fetched 10 files, every one of them nested. So declining the flat half outright costs nothing measurable and covers a future built-in before it ships. The dotted half is now asked properly rather than assumed missing — `require()` attaches a class at its path, so `tools.widgets` reads back as `L.tools.widgets` once any form page has pulled it, and a second walk over the same pages re-requests nothing at all (measured: 0).

- **A slow page no longer pulls the reader back to where they were.** Restoring the scroll after a client navigation has to wait for the incoming view to grow that much height — it renders behind an RPC, and setting an offset before the content exists is clamped to 0 and reads as success — so the router waits up to five seconds for it. On a slow router that is long enough for the reader to give up waiting and start using the page, and the restore would then take the scroll off them mid-read, which is worse than opening at the top (which is what a full load does anyway). Any sign that the scroll is theirs now cancels the restore for good: `wheel`, `touchstart` and the keys that scroll are intent even when nothing moves yet, and a `scroll` event is the catch-all for what those cannot see — a scrollbar drag, a trackpad fling, Find-in-page, assistive tech. Our own writes come back through that same event asynchronously, so the position last written is remembered and a scroll landing exactly there is not counted as the user's. All four listeners are passive and are removed the moment the restore lands, is cancelled or times out. Measured on the stand: Back still returns to the saved offset exactly (400 → 400); with the page made short and a wheel tick applied during the wait, the reader stays where they put themselves and growing the page by 4000px afterwards does not move them (11 → 11, not 900).

- **The SPA's memory behaviour is measured rather than assumed, and it is flat.** The standing charge against a client router on top of a framework that was never designed for one is that cached view instances and subscriptions pile up in a long-lived tab. Soaked it: 72 navigations over 12 distinct pages on 25.12 and 96 on 24.10, sampling on the same page after a forced GC each time. After the first pass every number is pinned — heap 21.16 → 21.13 MB, DOM nodes 26998 → 26998, listeners 8110 → 8110, documents 13 → 13, poll queue 1, view intervals 1 — against a full-load run of the same walk at a flat 4.4 MB. The gap between the two IS the cache, and it is one-time: per page the first visit costs 0.02–1.18 MB, except the package manager, whose package index costs +16.9 MB and holds it until a real reload. Nothing the theme owns grows: its structures are `WeakMap`/`WeakSet` or capped, and one document-lifetime `ResizeObserver` in `fs-fit.js` is why the listener count does not move at all. Written into docs/spa-router.md's Verified section beside the older 20-navigation reading.

- **The chrome fence is measured against modern CSS, not just against the two apps that motivated it.** The recurring review of this theme is that `fs-sheets.js` parses selectors with regexes and will therefore lose to nesting, `:has()` or `@scope` sooner or later. It does not parse CSS: every selector it reads comes out of the browser's own parser as `selectorText` and every one it writes goes back through the same parser's setter, which does nothing at all on a selector it cannot parse. Proven with 21 hostile sheets, one per syntax, each carrying `padding: 0 !important` on an unpinned selector and injected into `<head>` of the live theme — `*`, a selector list, nesting with `&`, without `&` and two deep, `:has()`, `:is()`/`:where()`, `:not(:has())`, bare `@scope` and `@scope … to …`, `@supports`, `@media`, the app's own `@layer`, an escaped leading digit, an escaped `@`, a comma and an IPv6 `::` inside an attribute value, a pseudo-element, and two sheets built entirely through `insertRule()`: **0 of 247 chrome elements moved in any of them, on Blink and on WebKit**, against a negative control — the same payload marked `[data-fs-shell]` so the module skips it — that flattens 63. Gecko 153 rewrites all of them identically. Recorded in docs/third-party-apps.md with the two things that fell out: a nested rule under a pinned parent is fenced redundantly and harmlessly, and a probe that injects before the theme's own JS has loaded measures the load gap and mistakes it for a fence failure (121 of 247 on the first attempt).

- **The claim that third-party views leak global listeners is answered with a count.** The proposed fix — hook `window.addEventListener` the way `setInterval` is hooked and sweep on navigation — would be the same one-way deletion as sweeping a view's CSS, because `L.require` caches a module for the life of the document and a listener registered at its top level never comes back. Which shape the real apps have is measurable: 9 view files on the stand register global listeners, and 8 SPA round trips through the File Manager move the `window`/`document` count from 27 to 28 on the first visit and then not at all. Nothing accumulates because nothing re-registers, which is exactly what makes a sweep a permanent deletion rather than a cleanup; and a global hook could not tell those from the 21 that `luci.js` and `ui.js` register on `document`. Written into docs/spa-router.md beside the same conclusion for `setTimeout` and rAF.

- **Three races the SPA router opens, all measured on the stand.** The overview went blank for a full poll interval when it was arrived at twice quickly — double-click its menu item, or leave and return inside the first-load window, and the second render "joined" the run already in flight, which was filling the FRAMES the content swap had just detached: 5.9 s of `display:none` sections against 0.4 s on a single arrival, and stock LuCI has no such guard, so the blankness was ours. The in-flight guard is keyed to the frames it belongs to now; re-measured, a double click fills in 0.9 s, the same as a single one. The Appearance tab built itself into the OUTGOING page: the router stamps `body[data-page]` before the incoming view renders, so on a warm route `#view` still held the previous page and `mount()` found ITS tab strip — one wasted build per arrival and, for the length of the incoming view's `load()`, a live, clickable "Footstrap" tab sitting on Network → DHCP that opened all 24 Appearance rows. Every tab group present at the moment of the stamp is disqualified now; measured after, one build per arrival and the tab only ever on its own page. And a stylesheet injected by a view that was superseded mid-load was credited to the page that superseded it — for `luci-app-filemanager` that is `.cbi-button-save { display: none !important }` bound to somebody else's config form for the life of the document, reproduced as a System page that came back with no Save button and stayed that way. The router now names the owner for the length of a cold require, which is the window where the require IS the render and cannot be stopped.

- **The type ladder survives an engine without `round()`, and the theme's real browser floor is written down.** `round()` in `calc()` is the youngest thing this theme depends on — Chromium 125, Firefox 118, Safari 15.4, years after `:has()`, `color-mix()` and `@layer` — and a custom property that uses it does not degrade: it parses, then fails at substitution, so `font-size: var(--fs-type)` computes to `unset`. Measured by serving a sheet with the function renamed: 5881 of 5912 elements on the Overview change, body type goes 13px → 16px, 5880 `font-size` and 5733 `line-height` declarations are lost, and `--fs-control-h` takes every field's min-height with it. The ladder is declared plainly now and rounded inside an `@supports (width: round(1px, 1px))`, so such an engine keeps every size and pays a fractional pixel at the two non-default densities — verified both ways on the router, including the simulated no-`round()` case.

- **Two selector lists stopped taking their `:has()`-free half down with them.** An engine that cannot parse one selector discards the whole rule, so `base/95-luci.css`'s card labels and `theme/25-progressbar.css`'s ordinary form-row meter — neither of which needs `:has()` — were lost on Firefox older than 121 along with the table selectors they were grouped with. Each list is now one rule per shape, with the declarations they share pinned as `@mirror` so the copies cannot drift.

- **The current page is marked in the menu under Windows High Contrast, and a long hostname can no longer grow the bar without limit.** With `forced-colors: active` the active item's two cues — a 10 %-alpha accent background and the box-shadow rail — are both dropped by the OS, and measured across all twelve menu links every one reported the same weight, colour, border and shadow: the page you are on was not marked at all (screen readers were fine, `aria-current` is on the link). It carries a real 3px `Highlight` border there now. Separately, `.fs-wordmark` had a width cap and no line ceiling, so the bar grew downwards instead: measured at 1280px, 63 characters — the kernel's own nodename limit — gave a 73px bar, and a hand-set 4000-character hostname gave a 4273px one with the page starting below it. Three lines is past every real hostname and still a bar; the rest is clipped.

- **The Appearance page's colour fields told the truth about hue-mode axes for the first time.** A colour set as a hue is applied through a relative `oklch()`, and a computed colour keeps the space it was authored in — so `getComputedStyle` returns `oklch(0.54 0.19 300)`, which the readback happily parsed as an rgb() triple. Every consumer believed it: the hex field, the `<input type="color">` swatch beside it and the WCAG verdict. Measured on the stand with `tint=120, accent=300`: the near-white green canvas, whose real text contrast is about 16:1, printed **#010078** and "Too faint to read on the canvas" — and confirming the swatch would have written that navy over the admin's own hue. The colour is rasterised into a 1×1 canvas now and read back as pixels, which is the method `tools/export-tier.mjs` already uses against exactly this trap; the string parse survives only as the fallback for an engine with no 2D context. Same page, same axes, after: **#f6faee** / "Easy to read on the canvas" and **#824aca** for the accent.

- **A browser that refuses to store preferences is told so, instead of being told everything is saved.** With site data blocked (Chrome/Safari "block all cookies", Firefox `dom.storage.enabled=false`, several WebViews) every write threw and was swallowed, so each axis applied on screen and persisted nothing — and because `current*()` then read the ROUTER default back, the comparison behind the Save row was true no matter how far the page had been dragged from it. The one control that IS the status sat disabled reading "Saved as default" while the page was painted in three axes that default does not carry, and a reload dropped all of them. The preference layer now remembers that a write failed and the Appearance tab says it: the button stays enabled — pushing this browser's look to the router is the one thing that still works — with a line explaining that a change here lasts until the page is reloaded.

- **An install whose uci writes fail is retried instead of being recorded as done.** `30_luci-theme-footstrap` ended in an unconditional `exit 0`, so a full or read-only overlay, a locked `/etc/config/luci` or a mid-upgrade ubus left the theme unregistered while OpenWrt's `default_postinst` — which deletes a uci-defaults script only when it exits 0 — deleted the script that would have retried. The marker file was written regardless, so the NEXT install took the upgrade branch, which by design never activates a theme: one unwritable file turned into a permanently unthemed router, silently, and the Makefile's `>/dev/null 2>&1` swallowed even the uci errors. Every write is checked now (deletes excepted — `uci -q delete` on an absent entry exits 1 as a matter of course); a failed run prints why, leaves the marker unwritten and exits non-zero so the next boot runs it again. Reproduced on the 24.10 container by making the config unwritable: before, `EXIT=0` with the theme unregistered and the marker present; after, `EXIT=1`, no marker, and the reason on stderr.

- **An uploaded background that could not be recorded is taken back off the router.** The wallpaper and pattern uploads write the file first (cgi-upload) and the token second (uci), and the second half fails on its own — no `settings` section yet, a narrowed ACL, ubus busy. The page showed the rpc error, which reads as "nothing happened", while the image sat in `/etc/footstrap` at mode 0644 and was served **without a session** at `/luci-static/footstrap/bg`, because the `/www` symlink does not depend on the token. Remove is hidden exactly when the token is empty, so the page offered no way to delete what it had just published. The file is now rolled back when the token cannot be written, and a rollback that itself fails is appended to the message, because at that point the admin has to know the file is there.

- **Remove now reports the router's refusal instead of reporting success.** Both remove paths discarded the rejection from `file.remove` on the grounds that "already gone is success" — but the catch discriminated nothing, so a read-only overlay, an immutable flag or a path replaced by a directory ended the same way: preview gone, button gone, token blanked, and the file still on flash and still fetchable without a session. The call is declared without `reject: true` now, which makes the ubus status a NUMBER the code can branch on: "not found" is success, everything else is an error the admin sees.

- **The one-liner installer survives an OpenWrt release the feed has not published yet, and a rotated feed key.** The parsed-branch path wrote `releases/<branch>/…` into the repository list without ever asking whether the feed carries it — so the first 26.x router would have had a 404 line written, `apk update` would have failed under `set -e` before the theme was installed, and a re-run would have taken the "already configured" path and died in the same place, leaving every later `apk update` on that router failing too. It is probed now, exactly like the fallback path already was, and falls back to the newest branch the feed answers for (sound here because the package is noarch with `+luci-base` as its whole dependency list). The signing key is fetched on every run rather than only when the feed line is written, so a key rotation is repairable by re-running the script the header promises can be re-run.

- **A browser that refuses localStorage gets the router's saved Appearance defaults instead of none of them.** The pre-paint that stamps twenty of the twenty-one axes wrapped everything in ONE `try`, and its first statement read storage — so in Firefox with `dom.storage.enabled=false`, in Chrome/Safari with cookies blocked for the site, and in several WebViews, a `SecurityError` on that line skipped the whole block. Dark mode still applied (it guards narrowly, three blocks up), while palette, density, rounding, wallpaper, the pattern url/size/strength/ink, the five colour axes, the four surfaces, the login photo, tint strength and photo dim were never applied at all: the page painted the built-ins, the Appearance tab read the router defaults it was not painted in, and Save-as-default greyed itself out because both sides of the comparison resolved to the same unused values. Each read is guarded on its own now, which is what the live applier's `lsGet()` has always done — storage failing means "this browser has no override", not "this router has no defaults". Measured on the stand with storage made to throw: before, `data-palette` and `data-density` absent and rounding at the built-in 12px; after, the router's `bootstrap` / `large` / 4px. `npm run axes` moved with it — its "does head.ut read this key" derivation only knew the bare `localStorage.getItem(` spelling, so it silently went from 15 keys to 4 the moment the pre-paint started guarding itself, and still reported OK.

- **`prefers-contrast: more` no longer republishes one grey twice to every app reading the export ramp.** That media query re-states the ink tokens, and it set `--fs-faint` to `--fs-dim` — which are `--text-color-low` and `-medium`, the pair `02-tokens.css` spends twelve lines keeping apart. No gate saw it, because nothing emulated the query. `tools/export-tier.mjs` now runs its whole contract a second time with `prefers-contrast: more` on (the six untinted combinations — the query moves the inks, the tint moves the surfaces, and the first pass already walks the wheel), which turns the ramp promise into something measured there too. It fails on the old value, which is how the replacement was chosen: the window is narrow, and 82% of `--fs-text` is inside it — 80% drops the fainter ink to 4.51:1 on footstrap dark's `--fs-panel2` and 84% flattens the high-to-low spread to 0.098 against the 0.10 the tier promises. 82 clears both at 4.68:1 and 0.110.

- **The package build survives a checkout path with a space in it, and leaves no temp file behind when it fails.** `strip-shell.sh` and `strip-templates.sh` both iterated `for f in $(find "$DIR" …)` — the path was quoted inside `find` and then word-split by the shell around it, so a clone under `~/My Projects/…` fed the loop two halves of a directory name and the build failed pointing at the tree rather than at the path. Both walk a file list now, and both carry the single `trap` the repo's other scripts already use: under `set -e` an awk failure used to leave `<file>.tmp<pid>` beside its target, and since `tools/stage.sh` runs these over the STAGED payload, a leftover `30_luci-theme-footstrap.tmp1234` would ship in `/etc/uci-defaults/` — a file the router executes and deletes on its next boot. In the same pass `tools/check-packages.sh` strips the padding BSD `wc -l` writes, without which the gate compared `2` against `       2` and failed on a correct package on the maintainer's own platform while passing in CI, and the uci-defaults script reads `${PKG_UPGRADE:-}` rather than a bare expansion that would abort the whole registration under `set -u`.

- **The dev router's translation catalogue is named the way the release names it again.** An earlier commit in this round moved `dev-sync.sh` to `footstrap.<lang>.lmo` on the grounds that luci.mk installs `<po basename>.<lang>.lmo` — but nothing released comes from luci.mk: owfeed bundles the catalogues inside the theme package under `footstrap-theme`, deliberately, because a v0.8.4 router still owns `footstrap.<lang>.lmo` through the old `luci-i18n` package and the same path would be a file conflict apk refuses. `lmo_load_catalog` globs `*.<lang>.lmo`, so the two names coexist and glob order decides which strings a maintainer sees — exactly what the comment above the loop warns about.

- **A quoted `::` no longer lets the chrome fence rewrite a third-party rule into one that matches nothing.** `fenceSelector()` found the pseudo-element boundary with `indexOf('::')` on the RAW selector text, in a file whose own header rules that every scanner of that text must read the masked copy first — and `::` is legal inside a quoted attribute value, where an IPv6 literal puts it: `[data-addr*="::"]` came back as `[data-addr*=":where(:not([data-fs-chrome],[data-fs-chrome] *))::"]`, and `a[href*="[::1]"]` was cut in the middle of its own value. Both are still valid CSS, so the setter reported success and the app simply lost the rule with nothing in the console. The split point is found on the mask and sliced out of the original now, exactly as `selectorParts()` does it; verified against the real bodies — the two IPv6 selectors come back untouched, `.cbi-button::after` still fences before the pseudo-element, and `[title="a::b"] .x::after` splits at the right one of its two.

- **A throw while the Appearance tab is being built no longer kills the tab for the life of the page, silently.** `mount()` sets a re-entrancy flag, calls `render()` and clears the flag in `.finally()` — but `render()` was `Promise.resolve(build())`, which runs `build()` as its ARGUMENT, i.e. synchronously and before any handler is attached. A throw in those 600 lines (a `ui.Select`/`ui.RangeSlider` shape that changes under us is the realistic case) therefore unwound out of `mount()` into the MutationObserver that called it: the flag stayed set, the guard on the first line bailed on every later mutation, and the `.catch` written for exactly this printed nothing. `render()` defers the build one microtask now, so the same throw lands in that `.catch` and the next navigation to System → System tries again. Re-measured on 25.12 and 24.10: the tab builds with its 24 rows, and still rebuilds after leaving the page and coming back.

- **The theme's Log out control inherits LuCI's own translation instead of rendering in English.** The chrome's strings are deliberately msgctxt-free so they collect luci-base's translations in the ~40 languages this theme ships no catalogue for — but the msgid was `Logout`, which is nobody's msgid: luci-base has `Log out`, translated in every language it ships. Renamed, and the theme's own ru/es catalogues re-attached to it. Of the five chrome strings, two now collect (Skip to content was already one); Menu, Collapse menu and Search stay bare so a future luci-base string can adopt them.

- **Two dead CSS rules and one dead declaration, each kept alive by a comment that was no longer true.** `theme/60-inputs.css` hid `.cbi-select::before` "because base still names it in the disabled list" — but nothing in `styles/` gives that pseudo-element `content` any more, so it generates no box and both rules paint nothing; `base/70-buttons.css` set `border-color` on the page-actions Save button, which `theme/55-buttons.css` overwrites with the `border` shorthand in a later layer, so the colour was never once painted. The file's own comment 70 lines up makes exactly that argument for its siblings.

- **Roughly sixty comments now describe the code beside them.** The sweep checked every claim that could be checked, against the source it names — upstream LuCI included — and the corrections fall into a few shapes. Names that moved: the Appearance panel is a TAB, not a popover, in twelve places across `fs-prefs.js`, `fs-widgets.js`, `fs-version.js`, `fs-search.js`, `menu-footstrap*.js`, `axes.mjs`, `search.ut` and the uci-defaults script; `data-fs-count` is `data-fs-badge`; `header.ut` in `fs-prefs.js` and `fs-sheets.js` meant two different files, one of them luci-base's. Counts that drifted: eighteen axes are twenty-one, three named defaults are five, two palettes are three (a `bootstrap` colourway was added and eight docs still said two), sixteen style files are thirty-nine, seven `Build/Prepare` steps are six, `form.js` emits the forcing utilities four times and not fifty-nine. Measurements that went stale as the values under them changed: eleven contrast ratios across `03-palettes.css` and `02-tokens.css` (the largest 0.9 off), the source and built sizes of the stylesheet, the templates and the token mangle, and the hover cue's own argument — `filter` recolours the ink as well as the fill, so `brightness(.90)` lands at 4.94:1 rather than the 6.16 the comment claimed, which is still the right choice for the reason underneath (brightening breaks AA at 4.08). And causes that were wrong even where the symptom was real: a class-based pane probe failed because a modern `form.js` pane carries no class, not because the panes are nested; `90-responsive.css`'s dropdown cap fights a rule in `theme/65-dropdown.css`, not one in base; the `.modal.login` button rule is inherited coverage vocabulary, not a live control; `dev-sync.sh` named a build command for `po2lmo` that cannot work (`plural_formula.c` is generated) and wrote its catalogue under a basename the package does not use, which is fixed rather than re-described.

- **Two template guards that could not fire, and one that hid a contract.** `partials/head.ut` defaulted `fs_defaults` to `{}` although its single include site always builds and passes it — a `?? {}` that only hid the requirement from a second caller — and read `dispatcher.lang ?? 'en'` thirteen lines above printing the same value bare into `lang="…"`; the dispatcher sets it unconditionally and returns `'en'` when nothing matches. `strip-shell.sh`'s heredoc refusal scanned every file under `root/`, including the two it never rewrites, so a `<<` in the rpcd ACL or the uci config would have aborted the package build for a hazard that cannot apply to them; it runs over the files the loop actually edits now.

- **The bootstrap colourway's two quiet inks are two colours again in dark mode.** Making `--text-color-low` follow the theme's third ink was the point of the previous round — the export name apps print muted text in had been a duplicate of `-medium` — and in this one palette the fix had immediately collapsed back onto one value: `--fs-faint` was raised to `#9a9a9a`, which is what `--fs-dim` already carried, so `-low`, `-medium` and `--fs-eyebrow-color` all resolved to the same grey there while the other five palettes kept them apart. The raise itself stands, because AA is what forces it: on a tinted `--fs-panel2` the old `#969696` measures 4.46:1, and `#9a9a9a` is the first step that clears the floor. So the floor pins the fainter tier and the step between them comes from above instead — `--fs-dim` moves up 12 channel steps, the same distance the hicontrast dark ramp puts between its own two, leaving 191 / 166 / 154 under bootstrap's `#bfbfbf` body ink. Bootstrap's own muted grey (`#7f7f7f`) is darker than either, so both tiers were already this palette's rather than bootstrap's; one step more of that is cheaper than two export names that cannot be told apart. Found in review on openwrt/luci#8903.

- **The bootstrap colourway's light text is as readable as the default palette's.** It reproduces `luci-theme-bootstrap`'s own values, and those put the body ink at `#404040` and the muted tier — LuCI's page descriptions and every field title — at `#6a6a6a`: 10.4:1 and 5.4:1 on white, the second of which is the same "help text you have to lean into" the default palette had just been corrected for. Matched to that palette's light ramp instead, ratio for ratio: 15.7 / 11.7 / 10.0 against its 15.8 / 11.8 / 10.0, in neutral greys so the colourway still reads as bootstrap. What this palette copies is bootstrap's hue, not its readability — the same trade it already makes on the four semantic colours, none of which clear AA at bootstrap's own values.

- **A menu.d stylesheet is matched by its whole path, not by the tail of it.** `documentCarries()` asked whether this document already holds the sheet a node names, and compared hrefs by suffix on the grounds that the resource base was not the theme's to assume. It is: `header.ut` hands the same `resource` value to the runtime that the template prints, so `L.resource(css)` reconstructs the server's href byte for byte and only the cache key has to come off. A suffix is what that assumption cost — anchored at nothing but a `/`, `custom.css` matches any sheet ending in that filename, and two in-tree apps put exactly that in `<head>` at module eval: `luci-app-adblock` and `luci-app-banip` both append `L.resource('view/<app>/custom.css')`, outside `#view`, where this module disables rather than removes them, so they stay for the life of the document. Measured on the router: standing on Adblock → Feeds, a node declaring `"css": "custom.css"` read as already-carried and the router swapped into a page with no stylesheet linked at all; with the whole path compared, the same click is a full load and the page arrives with its sheet. Equality also keeps the failure safe in the direction that costs only speed: `L.path()` drops a part that leaves its charset — no `+ ~ ( ) @ ! ' $ &`, nothing non-ASCII, no leading `/` — while `head.ut` prints the value raw and uhttpd serves such names without complaint, so a third-party node naming one still gets its sheet linked and pays a full load on every entry into that page. A suffix match covered those names, and losing them is what closing the false positive costs; no in-tree node sets `css` at all. Found in review on openwrt/luci#8903.

- **An empty table no longer prints "This section contains no values yet" across its own totals row.** The placeholder plate was `position: absolute; bottom: 0` inside the `position: relative` table — the bottom of the whole TABLE, which is the same place as its own row only while the placeholder is the last row there is. `form.TableSection` renders its `footer` into a `<tfoot>` after the `<tbody>`, so every empty section that declares one had the two printed on top of each other: measured on `luci-app-dockerman`'s Containers, Images and Volumes tables (issue #36) as a **1190×35 overlap, the full width of the table**, identically on Blink, WebKit and Gecko 153. Dropping `bottom` leaves the box at its static position — where its row actually is — which is what was meant; the reserved row height holds that space open, and the plate is now padded to exactly that height so it cannot hang out of the frame at either end (measured on Wireless, which pads its cells 10px and had the plate 4px below the border, and again in the carded state, where the card's row inset left 41px of the 63px the plate needs). Everything else on the page is untouched: a computed-style diff over 15 pages at 1440px and 390px moves **27 elements out of 18 425**, every one of them a placeholder row or its cell.

- **A key/value table's first column can no longer be starved to one character by a huge value.** Cells break `anywhere` so an unbreakable value cannot hold a column open, but that costs a min-content of one character — and auto table layout hands width out by each column's max-content, so a two-column table whose value is one enormous token squeezes the key column down to that character and the header above it with it. Measured against `luci-app-dockerman`'s Environment table, which prints `JSON.stringify()` of every field `docker info` returns: at 8 000 characters of value the key column fell from 95px to 55px and "Driver" began to wrap, and on the reporter's own host it reached about one glyph, so the column header read `E N T R Y` straight down the page (issue #36). The first column breaks at word boundaries now — the same trade the header row already makes, for the same reason: it is the row's identity and it is what you read the table by. A carded row is exempt, because once every cell is on its own line there is no neighbour left to starve it. Zero width changes anywhere on the stand's 15 measured pages.

- **A table now cards when it is narrower than its own content needs, and the width at which that happens is computed per table.** `overflow-wrap: anywhere` gives a cell a min-content of ONE CHARACTER, so a data table can be starved to a ribbon of fragments and still report — truthfully — that it fits. Reported from a hardware router at 700-790px of window: the DHCPv4 lease table cards there, because its `nowrap` IPv4/MAC/IAID columns give it a floor and it really does overflow, while the DHCPv6 table beside it breaks the DUID THROUGH — 5 lines at 674px of room, 7 at 654px, against one line at 1160px; the reporter's screenshot shows three characters to a line, twelve lines tall. The associated-stations table never carded at all above the 568px cramped floor, for the same reason. `fs-fit.js` grew `wordFloor()`, which returns the narrowest a table can be without cutting through a value: per column, the width of the widest WORD it has to show, in that column's own font, summed. **No threshold is picked anywhere** — on the reporting router the number is 935px for the DHCPv6 leases, 966 for associated stations, 645 for the v4 leases, 794 for Processes, 550 for Connections and 381 for Startup, so the two tables that were unreadable card at roughly a 1000px window while the four that were fine stay tables until the room they actually need runs out. Both rules evaluated over the same DOM: **15 of 136** table-states change on the router, **5 of 88** on the stand. The engine cannot be asked this question — Blink returns the same table min-content for `normal`, `break-word` and `anywhere` (measured at 645px on Processes while its widest word alone needs 367), so the floor is computed with a canvas, sampling the font once per column and measuring only each column's longest-by-characters word; both approximations are stated in the function and take the walk over Processes' 114 rows from 6ms to about **1ms**.

## [0.12.3] — 2026-08-11

### Changed

- **The router no longer re-derives what fs-sheets.js knows about stylesheets.** The `menu.d`-`css` guard added last round scanned the document for the sheet itself, and with it came a piece of knowledge that belongs to the other module: which sheets survive a swap. It now asks — `sheets.documentCarries(path)` — and the module that owns sheets answers, so the router decides only what to do about the answer. Inside `fs-sheets.js` the same move went one level down: the "a sheet inside `#view` dies with the swap" test was written out three times as `el.closest('#view')` in `documentPoisoned()`, `scopeToCurrentPage()` and `dedupeViewSheets()`, and is now the named predicate `outlivesPage()` those three and the new query share. The condition is a fact about position; the name is what follows from it, which is the part every one of those call sites actually means. Behaviour re-measured on the router: standing on `luci-app-nlbwmon`'s page, whose view injects its stylesheet inside `#view`, a navigation to a `menu.d`-`css` page is still a full load and still arrives styled, while eight ordinary client navigations through ssclash, justclash, homeproxy and stock pages remain swaps in one document with no console errors.

- **Three values the last rounds left written twice now have one source each.** None of it changes a pixel — the gallery diffs clean in both modes and 342 measurements across 114 router pages at three widths move nothing — but each was a copy waiting to drift. The chosen-row rail (`inset 2px 0 0` accent) was stated in the open dropdown's row, in a native `select option:checked` and a third time inside the focused row's ring; the first two are pinned to each other by `tools/mirror.mjs`, the third was outside that net, so it is now `--fs-row-rail` and the ring references it. The meter's "value beside the bar" geometry was written twice with the same four declarations and two different gutters — one `var(--fs-space-2)`, one a literal `8px`, which is that token — for the CBI form row and the data-table column; the geometry is stated once for both selectors now and the only thing that actually differs, how much room the out-of-flow value needs, is the knob `--fs-meter-value`. The bare meter's own 4px gap joined the scale in the same pass: every other gap in the theme scales with the density axis and that one did not.

- **The dev toolchain moved to playwright 1.62.1.** A patch release in the `dev` dependabot group, and the only thing in this repository that drives a browser: `tools/a11y-gallery.mjs`, `tools/export-tier.mjs` and the computed-style diffs all launch chromium through it. Nothing under `node_modules` ships to a router. All gates green on the new version.

- **`npm run axes` now holds the uci field name each axis reads, which is the hole `pattern_ink` went through.** The factories reach the router default through `window.__fsSD`, and they name the field two ways: `enumAxis`/`colorAxis` derive it from the localStorage key, `propAxis`/`surfaceAxis` are handed it. Nothing checked either against the template that emits those fields, so `fs-pattern-ink` asking for `pattern-ink` while head.ut prints `pattern_ink` was invisible to every gate — the axis then reports the built-in default however the router is configured, and Save-as-default writes that built-in over the admin's stored value, all silently. The gate now runs the deriving factories' **own** formula, lifted out of `fs-prefs.js` and compiled, rather than restating it: written the obvious way it would hold head.ut against itself and stay green while the JS said something else, which was measured — a version with the hyphen fold reverted to a bare `slice(3)` passed the restated check and fails the derived one. `surfaceAxis` joined the key scan in the same pass, so the four surface axes are covered by the css-orphans check they had been missing (21 keys → 25). Found in review on openwrt/luci#8903.

- **The webfont comments now say what the package does and where the installer is, instead of pointing at a file that is not in it.** Four comments named `fonts/set-font.sh` as though it sat beside them; it lives in this repository, not in the package, and deliberately so — it names third-party font hosts, which is exactly what the theme may not carry. What the package ships is the **serving half**: it reads `font_sans` / `font_mono` / `fonts`, serves whatever is in `/etc/footstrap/fonts` through the symlink uci-defaults creates, and keeps that directory across a sysupgrade. So the comments now state the manual path too — drop the `.woff2` files and a `fonts.css` beside them, then `uci set footstrap.settings.fonts=<md5>` — which is all the script automates. In the same pass, `fs-sheets.js`'s page-ownership example was corrected against the in-tree app rather than the release build it was measured on: in `luci-app-filemanager` only `HexEditor.js`'s injector runs at module eval (the view's own sheet is injected from `render()`), and the selectors that make either sheet invasive are the bare ones — `:root`, `.cbi-page-actions`, a `td:last-child` riding as the second half of a pinned selector — not the `#file-manager-container .hexview:focus` first quoted, which the module's own `pinnedToApp()` test correctly clears. Found in review on openwrt/luci#8903.

- **Three comments that named a label, a rule and a LuCI file the tree no longer has now name what is there.** The `uci-defaults` note on the background upload still called the control "Appearance → Background image", a string nothing renders since the axis became three-valued — `fs-appearance.js` builds the row as Wallpaper with the options Pattern and File, which is what the sibling upload eight lines below it already said. `propAxis`'s worked example claimed the sd() field name is passed in explicitly because it is "NOT the key minus `fs-`", offering `'fs-tint-strength' -> tint_strength` as the case — exactly what the hyphen fold in `enumAxis` and `colorAxis` now produces; only one instance of five genuinely needs the argument, and it is a rename rather than a spelling (`'fs-radius' -> rounding`). And `fs-sheets.js` justified page ownership with `view/status/cpu.js` "and its four realtime siblings" injecting `svg text { fill: #eee; font-size: 9pt }` at module eval: that file exists on none of the four dev routers, and the realtime graphs style their SVG text with an inline `style=` attribute instead — stock LuCI adds nothing to `<head>` on 24.10/25.12 at all. Re-measured on owrt2512 against what actually injects there: `luci-app-filemanager` (a stock app, two `<style>`s at module eval) and `luci-app-ssclash` (four more as Ace initialises). With ownership removed from `documentPoisoned()`, leaving either page is a full load, 5 runs of 5; with it, all 5 are in place — medians 24 ms and 27 ms, against a page that injects nothing as the control. Found in review on openwrt/luci#8903.

### Fixed

- **The light theme's secondary text is no longer a whisper: page descriptions and field titles went from 5.2:1 to 11.8:1.** LuCI writes a page's explanation under its title and every form label in one muted tier, and this theme took the GitHub-light greys for it — `#656d76` and `#68727e`, which measure 5.2:1 and 4.9:1 on a card. That clears AA and still reads as help text you have to lean into, which is the wrong trade for pages whose descriptions are the part you read once and act on. Reported on openwrt/luci#8903 by @hnyman, reading the light theme on a real router; four candidate strengths were rendered on the same page and the second-darkest was chosen. The tier is now `#33383d` / `#3d4348` — 11.8:1 and 10.0:1 — still a step below the 15.8:1 body ink, which is what keeps a label a label. The hicontrast palette moved with it, to 13.5:1 and 12.0:1: its own note promises "genuinely above the default palette", and that promise is relative, so it broke the moment the default passed it. Two knock-on corrections came out of the gates rather than the eye: `--text-color-low`, the export name apps print muted text in, had been a duplicate of `-medium` on the grounds that the fainter ink is illegible in dark — with light's tier moved, the duplicate flattened the exported ramp to 0.082/0.094 against the 0.10 spread it promises, so `-low` now follows `--fs-faint`, the theme's real third ink; and in the bootstrap palette's dark mode that ink measured 4.46:1 on a tinted panel, so it gives way to the step above it. 2856 export-tier checks across 42 palette × mode × tint combinations pass, axe is clean across all 18.

- **A page whose stylesheet only the server can emit is no longer reached by a swap.** A menu.d node may name its own sheet (`"css": "view/foo/foo.css"`) and `partials/head.ut` links it from `<head>` on a full load — but a client navigation replaces `#view`'s children rather than rendering a document, so nothing produced that link on the way in. The page therefore looked one way when reached by URL or F5 and another when reached by clicking its menu entry, with the app's CSS simply missing on the second path. The router now declines such a navigation exactly as it declines a poisoned document: `navigate()` returns false when the incoming node names a `css` this document does not already carry, and the browser's own full load emits the link. It costs ONE full load per such page — after it the `<link>` is in the document, the test passes, and every later visit is a swap again, with `fs-sheets.js` owning the sheet and re-lighting it per page. The scan skips a `<link>` that lives inside `#view`, which is the one shape `fs-sheets.js` needs no handling for because it dies with the swap — `luci-app-nlbwmon` returns `E('link', { rel: 'stylesheet', href: L.resource('view/nlbw.css') })` from `render()`, so standing on its page that sheet IS in the document and is exactly the sheet the next `dom.content()` throws away. Measured with a menu.d node naming `view/nlbw.css`: counting the in-view link, leaving that page was a swap and the incoming page arrived with no sheet at all; skipping it, the same click is a full load and the link comes back in `<head>`. Injecting the `<link>` from the router would also have worked and is deliberately not done: it would put the theme in charge of fetching and ordering a foreign stylesheet, which is the job `fs-sheets.js` exists to keep out of the theme. Measured on imm2512 with a menu.d node carrying `"css"` and the `css: 'string'` schema line added by hand: cold click from the Overview is a full load and the rule paints, leaving is a swap, returning is a swap and the sheet lights again — two document loads for the whole sequence, no console errors, and ordinary pages still swap. On a `luci-base` that predates the schema entry the property never reaches the client, so the test is never true there. Found in review on openwrt/luci#8903.

- **On a phone the Memory and Storage figures no longer print through the end of their own label.** The value on a meter row is out of flow — the bar's `::after`, pinned over its far edge — so the only thing keeping it off the label is a reserve on the label's padding, and the two are sized by different things: the reserve is a fraction of the CARD, the value is however wide LuCI's formatter made it. `16.66 GiB / 16.66 GiB (100%)` measures 218px in the mono face at `--fs-type-xs`, and 50% of a 380px phone card is 190 — so the figure ran straight into the label: "Дисковое пространство330.54 MiB / 7.98 GiB (4%)", reported from a 390px screen. Measured across the range on the router: the reserve is at its cap and clear of every value from a ~460px card up, and short of the longest ones below that, so the cap is raised to 230px AND the row stacks below `fs-view` 560px — the label keeps the whole line, the bar drops by one `--fs-type-xs` line, and the value sits right-aligned in the band between them. It costs one line per row on a phone and cannot collide at any label length; mount-point labels (`/dev/vdb1 (/etc/resolv.conf)`) stop wrapping into two lines as a side effect. Nothing changes above the threshold: across eight router pages at 1400/1024/560/390px, before against after, the only rows that move are these, and only at 560 and 390 (row 43px → 59px, three fewer wrapped label cells).

- **The log filter bar keeps each filter on one line instead of breaking a label away from its control.** Both log views build the bar as a run of inline text — `tools/views.js` (LogreadBox: the System Log and every third-party page built on it) and `view/status/dmesg.js` (the Kernel Log) emit bare rows of label / control pairs with nothing around a pair — so inline flow breaks wherever the line runs out, and on a phone that is between a label and the control it names. Reported from a 390px screen: the second `Не` sat alone at the end of one line while the `уровень:` it inverts opened the next one without it, and `Макс. строк:` broke INSIDE the label, leaving `Макс.` above `строк:` and the field they belong to. The rows are flex now, so a wrap can only fall between items and a label is one unbreakable item; a field may SHRINK to share the line but none of them GROWS past its own width, which is what keeps `Макс. строк:` a small box beside a wide search field without any rule having to name it. The one field that does grow states itself: `input:not([type])` is the free-text filter in both views — every other input under `#content_syslog` declares a type (`checkbox` for the four inverts and the sort flag, `number` for Max rows and for the Kernel Log's boot-time range) — and it is the only one whose content has no length. Below 560px every field takes its own line with its labels above it: no flex rule can bind a label to the field that follows it, but a full-width basis can, because the field always starts a line. That holds for every row of both views — the range pair, the severity select with its trailing `and above`, the lone sort checkbox — without any of them being named or counted, and it is one rule rather than a grid template that would have to know how many children a row has. The two tiers are DISJOINT container queries rather than a base rule and an override, so neither can win or lose by source order — the trap the first cut of this file fell into, where generalising the row selector silently out-specified two rules meant to override it (the Max-rows cap and the narrow layout both stopped applying, measured: the number box stretched to 510px against 98px at 1280). Scoped by shape rather than by page or id: `data-page` differs between the two logs, a third-party box has neither, and the ids belong to LogreadBox alone — the Kernel Log's rows carry `logFromTime`, `logToTime`, `invertLogRangeTime`, `invertSeverity` and `invertAscendingSort` instead. Measured on both userlands at 360/390/412/768/1024/1280/1536/1920: nothing overflows the view, every row is one line above the threshold and one field per line below it, and both number fields hold their widest realistic value — including the Kernel Log's `1209600.000000`, which an earlier cut of this fix had capped at 12ch. Found in review on openwrt/luci#8903.

- **A multi-select dropdown draws its options in the theme's own face again, and a chosen row stops wearing a broken frame.** Three separate slips in one widget, all visible at once on `luci-app-modeminfo`'s Bands page (issue #32). **The font**: `ui.js` wraps every row of a MULTI-select in `<form><label>…</label></form>`, and `.cbi-value-field *` in theme/60-inputs.css hands mono to every descendant of a field — it matches that form and that label directly, while the menu's own `font-family: sans` only reaches the `<li>`. So the same widget drew two faces depending on one option: a single-select list, whose text sits in the `<li>` itself, came out sans; every multi-select came out mono, in the open menu and in the closed control alike, which is what makes a wordy option list (`3G Band 1`, `LTE B1`) read stretched. Measured on the router with `ui.Dropdown`: `<li>` Manrope, its `<form>`/`<label>` JetBrains Mono. An option label is a LABEL, the same distinction `<strong>` already gets. **The rail**: a chosen row is painted with an inset 2px accent bar, and the row has an 8px radius, so the bar is drawn as an ARC — fine as the single-select cue it was designed for, one row at a time, and wrong down a column of them, where three chosen bands stack three blue crescents against the menu's edge. A multi-select row says "chosen" with its CHECKBOX, a non-colour cue in its own right, so it no longer also carries the rail; a single-select row has no checkbox and keeps it. **The ring**: `ui.js` focuses a row as it opens the menu, and the UA answers a programmatic focus with `outline: auto` — a system-blue capsule drawn OUTSIDE the row, following its radius, on every dropdown that already holds a value. It wears `--fs-accent-soft` inset now, like every other control in the theme, and inset because the menu clips its own overflow. The gallery gained the case that would have caught all three (`docs/gallery.html`: an open multi-select, in a `.cbi-value-field`, with two rows chosen) — it had only ever rendered the single-select shape, which is why the theme's own note about axe never seeing an open dropdown was true. Axe now measures it, minus one exclusion stated in `tools/a11y-gallery.mjs`: LuCI's checkbox is presentational (out of the tab order, clicks cancelled) and its label neither wraps it nor carries `for`, so the `label` rule fires on markup no stylesheet can fix. Across the 668-element gallery the whole change is 12 font-family swaps, 2 rails and their box geometry; across eight router pages at four widths, nothing moves at all.

- **A meter that IS a labelled row's field puts its value beside the bar, not above it.** The placement above the bar assumes the shape the Overview has, where the meter owns a full-width line and its name sits on the line above — there the value lands at the far end of the name's own line and the two read as one row. A `.cbi-value` row is the other shape: the name is already in the left column, on the bar's own line, so a value floating above the bar has nothing to pair with and lands against the row divider, nearer the row above than the bar it belongs to. Reported against `luci-app-modeminfo`'s Antennas page, where every card carries three of these and every dBm figure read as though it belonged to the meter above it (issue #32). The row is now `name | meter | value` on one line, with the values aligned in a column because the reserve is fixed (`2 x --fs-space-10`, enough for `-140.0 dBm`) rather than shrink-wrapped. Scoped to `.cbi-value-field > .cbi-progressbar`, which is exactly "the meter is the field of a CBI form row": the Overview's meters sit in a `.td` and the package manager's in a bare `.controls` div, and both keep the value above the bar — verified unchanged, along with the whole of eight router pages at four widths. Two of these rows joined `docs/gallery.html` beside the bare meters, so the two shapes are now checked side by side.

- **A table header no longer shreds its labels one character per line, and a PID no longer breaks in half.** Every cell carried `overflow-wrap: anywhere`, which exists so an unbreakable value — an ICCID, a DUID, a base64 key — can never push a table outside its card. Its price is a min-content contribution of ONE CHARACTER, and an auto-layout table hands the surplus to whichever column asks loudest: with every text column's floor at one character, the header row is what pays. On Status → Processes at 1228px against a Russian catalogue, where the actions column is `nowrap` and 477px wide, `PID` came out as "PI/D", `Владелец` as "ВЛ/АД/ЕЛЕ/Ц" and `root` as "roo/t", with the header row 104px tall. The property is now set per role — a VALUE may still break anywhere, a LABEL breaks at words — so the header row's floor is its longest word again: 54px, every label and every owner cell on one line, the value columns at 47/94/152 against 39/49/90, and the table still inside its card to the pixel. The PID column takes the same `white-space: nowrap` the MAC column on Wireless and the IPv4 column on DHCP leases already carry, for the same reason a MAC must not split (issue #5): a PID is atomic, and it was breaking on 23 of 26 rows where stock `luci-theme-bootstrap` breaks none of the same 26. Two knock-on effects, both wanted: the header row is shorter in English too (71px against 87), and at ≤1024px in Russian the table now cards instead of standing — `fs-fit`/`fs-select` measure whether the content fits, and what used to "fit" was a header column one character wide. Across eight router pages × four widths, before against after, nothing but Status → Processes moves at all, and across the 616-element widget gallery in both modes the whole change is `overflow-wrap` on 17 `.th` elements — no box, no colour, no layout. Measured on both userlands (imm2512/apk 25.12.1, imm2410/opkg 24.10.6). Reported by @Schiz23 in issue #32.

- **The realtime graphs are no longer framed in black.** Every stock realtime view writes `border:1px solid #000;background:#fff` inline on the box it draws into (`bandwidth.js`, `load.js`, `wireless.js`, `connections.js`, `channel_analysis.js`, and every `luci-app-*-status` copy of them), and only an author `!important` outranks an inline declaration — so the theme, which had already taken the `<svg>`'s background and its black grid lines, still drew a black frame around every graph, landing exactly on the card's own border edge because the box is bled out to it. Recoloured to `--fs-border`, the hairline every other card contour uses. Only the colour moves: the 1px stays because it is the graph's own edge, and `background: #fff` is deliberately left alone — the `<svg>` is sized to the box's content edge, so the white never paints and a flag against it would be a rule that changes nothing. Scoped wider than the bleed rule it sits beside, and by shape rather than by page: `channel_analysis.js` measures its own box and must not be bled, but its border is just as black. Seven graphs on Realtime → Traffic and one on Realtime → Load verified in dark mode on 25.12/apk and 24.10/opkg, `rgb(0, 0, 0)` → `rgb(68, 76, 86)`. `tools/css-metrics.mjs`'s `!important` ratchet goes 26 → 27 with it, which is the sanctioned kind: one property, fighting an inline declaration no cascade layer can outrank. Reported by @Schiz23 in issue #32.

- **A typo in the sans font stack no longer takes the mono one down with it.** `font_sans` and `font_mono` are printed unescaped into one `<style>`, and the charset whitelist that guards them has to admit both quote characters — the shipped default is `"Manrope",system-ui,…`. A quote does not *end* anything, it **extends**: `font_sans=My"Font` opens a CSS string that runs to the end of the sheet, swallowing `; --fs-font-mono: …; }` with it, so a router that set only the mono font correctly lost it because of a mistake in the other option — two settings the code calls independent, one taking the other down. Measured on owrt2512 before the guard: `:root {--fs-font-sans: My"Font; --fs-font-mono: JetBrains Mono; }` renders as one open string and neither property survives; after it, the malformed value is refused and `--fs-font-mono: JetBrains Mono` is printed alone, while a properly quoted stack still renders in full. Not a security hole — root already owns the config, and an invalid declaration falls back to the `tokens` layer — but a silent cross-contamination between two independent options. Counting the quotes is **not** the test, because tokenizing is stateful: inside `'…'` a `"` is literal and vice versa, so `"O'Reilly Sans", 'Fira Sans` — a family name with an apostrophe beside a stack whose closing quote was forgotten — holds an even count of each and still leaves the second `'` open. The value is scanned in order instead, the way it is actually read: the quote that opens wins until its own kind closes it, and one still open at the end refuses the value. Eight shapes are checked against real `ucode` on 25.12 and 24.10 — the default, an unquoted stack, single quotes, the two malformed cases, the interleaved one and its properly closed twin — and the end-to-end render agrees: the open value costs only itself, the closed one prints in full. `head.ut` compiles under `ucode -T -c` on all four dev routers. Found in review on openwrt/luci#8903.

- **A wrong password on a router running `luci-plugin-2fa` says so again, instead of only "Additional verification required".** `auth_message` is not "the credentials were accepted": the dispatcher's first branch copies it out of `get_challenges()` **before** the password is checked at all (`dispatcher.uc:956`), and that call answers with a message on every pending result — the literal `'Additional verification required'` when the plugin has none of its own (`authplugins.uc:312`). So on a router with a login plugin enabled, both it and `fuser` are set at once whenever a password is rejected, and the message-first spelling this theme took from `luci-theme-bootstrap` then rendered only the plugin's boilerplate: the user is never told the password was wrong. The generic template's `auth_message && !fuser` gets that case right and the other one wrong — on the OTP step the credentials were correct, so it reports "Invalid username and/or password!" about a password that was right and swallows "Too many failed attempts" / "System time is not calibrated" entirely. Neither spelling covers both, because neither variable says which of the two dispatcher branches rendered the page. `auth_plugin` does: it is set **only** in the second one (`dispatcher.uc:1018`), i.e. exactly when `session_setup()` accepted the credentials. The credentials alert is now gated on `!auth_plugin` and the backend's message renders **beside** it rather than instead of it, so all four states are distinct — a wrong password, a wrong password with a challenge pending (both alerts), the OTP prompt, a failed OTP. The credentials alert also moves to `.alert-message.error`, the danger variant bootstrap uses here, because once the two can appear together an amber box for each makes a rejected password read as a routine notice. Found in review on openwrt/luci#8903.

- **A stylesheet an app names in its menu.d node is linked by the server again — it never once was.** The `css` property lets a page declare its stylesheet to the dispatcher instead of injecting it from view JS, and `partials/head.ut` had carried the link for it since the theme was written. It never fired: the guard read `node?.css`, and the dispatcher binds the resolved node as `dispatched` (`runtime.env.dispatched = resolved.node`) and never binds a `node` at all. Every ucode theme carried the same wrong name, which is why nobody noticed — it was fixed upstream in openwrt/luci#8920 (`1e54d884d40e`), and that commit is also what makes the property survive the trip: `build_pagetree()` copies a node's fields through a whitelist, so a `luci-base` without `css: 'string'` in it drops the property before any template can see it. Both halves are needed, so on 24.10 and 25.12 this changes nothing at all and the feature lights up on `luci-base` master. Measured on imm2512 with that one schema line added by hand and a menu.d node carrying `"css": "view/fstest.css"`: the page emits `<link rel="stylesheet" href="/luci-static/resources/view/fstest.css?v=…">` and no other page does, the rule paints on its own page (`outline: dashed rgb(255, 0, 255) 2px`), and it costs the client navigation nothing — the link is deliberately **not** `data-fs-shell`, so `fs-sheets.js` re-hosts it into the theme layer like any other app sheet and `scopeToCurrentPage()` darkens it on the way out: `none` on the overview, painting again on the way back, all three states inside one document with no full load and no console errors. Both package managers re-checked for regressions on the release `luci-base`, where the guard stays false: every page renders, no theme fallback, client navigation intact (imm2512/apk 25.12.1, imm2410/opkg 24.10.6), and `header.ut` and `partials/head.ut` compile under `ucode -T -c` on all four dev routers. In the same pass the `<body>` class stopped interpolating `node?.title` — the other half of that upstream commit, the same wrong name, so it had always rendered empty; bootstrap deleted it rather than fixing it, since nothing keys off it. Reported by @pktpls on openwrt/luci#8903.

### Security

- **Two high-severity advisories in the dev toolchain are closed again (`fast-uri`, `brace-expansion`).** `fast-uri` ≤ 3.1.4 still resolves a literal backslash differently from Node's WHATWG `URL`, so the host-confusion desync this project pinned against in 0.11.3 was only narrowed, not closed — the fix is 3.1.5, and the `overrides` entry moved with it (`^3.1.4` → `^3.1.5`), because a range that still admits the vulnerable version is a pin that stops working the moment a lockfile is regenerated. `brace-expansion` went to 5.0.9 in the same pass. Both are transitive — `stylelint → table → ajv → fast-uri` and `eslint → minimatch → brace-expansion` — and nothing under `node_modules` reaches a router: `luci.mk` copies `htdocs/`, `ucode/` and `root/`, and the npm tree exists for the CI gates alone. `npm audit`: 0 vulnerabilities, all gates green.

## [0.12.2] — 2026-08-04

### Added

- **A third palette, Bootstrap: the stock theme's colours on this theme's chrome.** Appearance → Palette now offers the surfaces, greys and semantic colours of `luci-theme-bootstrap`, so an admin who wants the look they already know keeps it and still gets the sidebar, the client navigation and every Appearance axis. Bootstrap computes its colours from HSL axes; this is those axes evaluated — `#ffffff / #f9f9f9 / #f5f5f5` and `#404040 / #808080` in light, `#222222` and `#bfbfbf` in dark — and the canvas and the card are deliberately the same white, because bootstrap is flat and lets the border carry the structure. Where it deviates it had to: bootstrap's semantic colours do not clear AA on bootstrap's own surfaces, and `tools/export-tier.mjs` holds every palette to 4.5:1 on all three, because the export tier is what other people's apps print text in. Measured on `--fs-panel2`: success `#00ac59` 2.73:1, warn `#efbd0b` 1.61:1, error `#f62b12` 3.65:1, primary `#1976d2` 4.22:1, and in dark error `#d15653` 3.44:1. So each one is taken from the step of bootstrap's own ramp that clears it where such a step exists — primary, success and error in light are its `-medium`/`-low` values verbatim — and where none does, hue and saturation are kept and only the value moves until it clears 4.95:1. Warn is the one large move, for the same reason the default palette's is `#946300`: no yellow readable as text on white is still that yellow. One surface moved too — bootstrap's dark `--background-color-high`/`-low` are 0.016 apart against the 0.02 the ramp check wants, so an app asking for a gradation would get one colour twice, and `#2c2c2c` became `#303030`. What a palette cannot reproduce is bootstrap's dark header gradient: the chrome reads `--fs-panel`, so giving the bar its own colour is a change to the chrome, not a colourway. Adding it turned the palette axis from the two-valued `enumAxis` into the list shape wallpaper and density already use — an `enumAxis` has one opt-in name and reads every other stored string, including a real palette, as the default — and it is registered in all five places that each fail differently and quietly, the fifth being `matrix()` in `tools/lib/gallery.mjs`: a palette absent there is one `export-tier` and `a11y-gallery` never measure, so it would ship ungated. It is gated: 2856 export-tier checks across 42 palette × mode × tint combinations, and axe clean across all 18.

- **`fonts/set-font.sh`: your own webfont on the router, in one line, with nothing bundled.** `wget -qO- …/fonts/set-font.sh | sh -s -- --sans Inter` — the shape `set-pattern.sh` already has. The package still ships no faces and gains no dependency; what it gains is the seam, three uci options in `footstrap.settings` that `partials/head.ut` reads back. `font_sans` / `font_mono` are `font-family` stacks printed into an unlayered `:root` block — that alone costs zero bytes and renders for whoever has the face installed, which is the same mechanism the theme's Manrope/JetBrains-first defaults already rely on, and it is a plain uci string so `uci set footstrap.settings.font_sans='Inter, system-ui'` by hand works too. Add `--sans-file <url|path>` and the `.woff2` lands in `/etc/footstrap/fonts/`, an `@font-face` sheet is generated beside it and **this router serves the font** to every visitor. No family is named or hosted in the repository, deliberately: a shortcut like the wallpapers' `cats` would be somebody else's licence and somebody else's host written into the package, so the admin brings the URL and the theme still reaches nobody at run time. The weights are where an installed face fails quietly and the default is set from the measurement: body text is 600, so a single static file declared `400 700` covers it, the browser stops synthesising and **every heading renders in the regular face** — one static face is therefore declared `400` alone, a pair splits `400 600` + `700` rather than at 700, and `'100 900'` is spelled out for a variable font. Refusals happen before anything is written: the format is decided by the first four bytes and not by the file name, 512 kB is the cap, and the overlay's free space is checked because a full overlay makes `uci commit` truncate a config and report success. Reading those four bytes is where the router disagreed with the desk — **busybox on OpenWrt has no `od` applet at all** (`od: applet not found`, measured on all four dev routers: 25.12 and 24.10, OpenWrt and ImmortalWrt), so the first version's hex comparison refused every valid woff2 it was handed. It reads them with `head -c 4` and compares text instead, which costs exactly one thing and the messages are written around it: a command substitution drops NUL, so `wOF2` and `wOFF` survive while a TrueType signature (`0x00010000`) arrives as a lone `0x01` and cannot be told from any other binary — so the catch-all names the conversion too rather than pretending to know. The sheet's `<link>` is emitted **only** when its md5 token is set, which is the `<link rel=preload>` lesson from v0.12.1 applied before it could repeat — six 404s a page, invisible to CSS. Exposing the directory under `/www` had a second trap of the same family and it also had to be measured: `ln -sfn` onto a path that is a **real directory** does not fail, it **exits 0 and creates the link inside it**, at `…/fonts/fonts`, where no browser looks — and every footstrap before 0.12.1 shipped exactly such a directory there, full of the woff2 files it used to carry, so on an upgraded router that is the ordinary case. `-n` covers only the symlink half; both uci-defaults and the script now clear the path first unless it already is the link they want. `/etc/footstrap/fonts` joins the two images in `lib/upgrade/keep.d`, and `tools/axes.mjs` learns the three names as server-only beside `login_bg` and `pattern` — no localStorage, no Appearance control, no entry in `snapshotAxes()`. A font is a property of the router, not a per-visitor preference. Verified on the routers rather than argued: on both package managers the three faces fetch 200, `document.fonts.check('16px Manrope')` is true, the string measures 182 px against the fallback's 202.3, the sheet survives login and in-place navigation still marked `data-fs-shell` and not disabled, and after `remove` the page is back on the system stack with zero font requests and zero 404s. uhttpd types woff2 as `application/octet-stream` and browsers load it anyway — the MIME strictness that makes an SVG unpaintable does not apply to `@font-face`.

- **`wallpapers/set-pattern.sh`: one line on the router and the cats are back.** `wget -qO- …/wallpapers/set-pattern.sh | sh -s cats` — the shape `install.sh` already has — fetches one of the two sample drawings and does from a shell exactly what the Appearance page's upload does: write `/etc/footstrap/pattern.svg` at 0644 (uhttpd answers 403 for 0600), link it to `/www/luci-static/footstrap/pattern.svg` with the extension kept, and save the file's md5 as `footstrap.settings.pattern` next to `wallpaper`, `pattern_size`, `pattern_strength` and `pattern_ink`. `dinos`, any URL and any local path work the same way, `remove` undoes it, and `--size / --strength / --ink / --keep-wallpaper` are there for the rest. It exists because dropping the two doodles from the package left the admin who liked them with no path back that did not involve a browser and a file picker, and it is a script beside the drawings rather than anything in the theme for the reason the doodles left in the first place: the fetch is the admin's deliberate act, once, not something a settings page does behind them. The refusals are the upload page's, by text matching rather than by parser — a shell has no `DOMParser` — so the handler pattern is `on` + letters + `=` and not `\son\w+=`, which matches `only_selected="false"` and refused this project's own cats on a real router; both drawings were re-checked against all four patterns here. What it cannot do is override a browser that has already chosen: every axis is per-browser first, so the script says so and names *Reset to saved*. `tools/check-shell.sh` now parses `wallpapers/*.sh` too, and the sample-drawing README moved up to `wallpapers/` beside the script.

- **`tools/sync-luci-fork.sh`, and `docs/package.md` explains the two trees it keeps in step.** The copy proposed to openwrt/luci is not this directory copied across: it gets the BUILT stylesheet and leaves `styles/` and the four shell scripts behind, because the other four themes there commit one `cascade.css` and have no build step, and a theme arriving with its own build system asks a reviewer to audit that before they can read a stylesheet. Nothing else is optimised on the way, and that is measured rather than assumed: no package in that tree ships anything pre-minified — the four themes' stylesheets run 17–20 bytes per line and `luci-base`'s JS 28–29 — so the copy keeps its `--fs-*` names unmangled, its comments intact, and hands the JS to luci.mk's own jsmin. The two packages differ by 14% because of it, 76 321 bytes against 66 825.

### Changed

- **Three comments describing an Appearance page the theme never shipped now describe the tab it did.** `header.ut` and `fs-prefs.js` both sent a reader to `admin/system/appearance` and a `view/footstrap/appearance.js` that does not exist — the package carries no `view/` and no `menu.d/`, because a theme may not own a dispatcher node and `fs-appearance.js` appends its section to the stock System page with a MutationObserver instead. The same paragraph counted "fourteen" axes where `AXIS_KEYS` has twenty-one, and the Makefile's note on `Build/Prepare` listed a `po/` that `luci.mk` does not copy — `LUCI_LANGUAGES` globs it and `po2lmo` reads it straight from `${CURDIR}`, never from the build directory; the reasoning about `PKG_LICENSE_FILES` resolving against that directory was right and stands. Found by the review on openwrt/luci#8903.

### Fixed

- **Picking "Apply unchecked" no longer makes the button vanish into the page.** The footer's Save & Apply control is a split button whose wrapper carries the class of the SELECTED mode — `cbi-button-apply` for "Save & Apply", `cbi-button-negative` the moment the second mode is chosen (luci.js's ComboButton `classes` map). `.cbi-page-actions .cbi-dropdown` painted every dropdown in that bar transparent at (0,2,0), which out-specified `.cbi-button-negative`'s fill at (0,1,0) in the same layer while its ink survived — so the control rendered as `--fs-on-danger` text on the page itself: **1.13:1 in dark and 1.06:1 in light**, an invisible button in both modes, and only the one mode repainted by the rule below it was ever visible. The guard is now the same `:not(.btn):not(.cbi-button)` the widget rules in that file already use, so a split control keeps whatever fill its variant sets and the plain dropdown in a footer still carries no frame: measured 6.57:1 dark and 5.36:1 light. A computed-style diff over the whole gallery moves exactly **1 element of 611** in each mode — the wrapper itself — and the gallery now carries that second mode as its own card, so axe measures the state instead of the theme's author remembering it exists.

- **The feed the installer adds is now visible in LuCI's "Configure APK", where an admin can edit or remove it.** apk reads every `*.list` under `/etc/apk/repositories.d/`, so the theme's own `owfeed-packages.list` installed and upgraded perfectly well — and was invisible to the only UI a LuCI user has. `luci-app-package-manager` reads exactly three apk paths, `repositories`, `repositories.d/distfeeds.list` and `repositories.d/customfeeds.list`, in its rpcd ACL *and* hardcoded in `package-manager.js`; anything else is a feed the admin can neither see nor turn off from the page that exists for exactly that. The line now goes into `customfeeds.list` — the file OpenWrt ships saying "add your custom package feeds here", and the apk counterpart of the `customfeeds.conf` the opkg branch already used, so the two halves of the installer stopped disagreeing. A router set up by an earlier installer has its old file removed after the new line lands, because the same repository configured twice — once where the admin can see it, once where they cannot — is worse than either; measured in a snapshot container prepared the old way, `apk update` reports the feed once and the theme stays installed. Neither customfeeds file needs the `keep.d` entry the script used to write for it: both are conffiles of their own package manager (`apk-mbedtls`, `opkg`), sysupgrade backs up every conffile whose checksum has moved, and `build_list_of_backup_overlay_files` was already dropping the duplicate. `keep.d` now claims the feed key alone, which is the file nothing else claims. Verified on both managers: fresh install, re-run, migration from the old layout, and the 24.10 path unchanged.

- **The installer no longer refuses an OpenWrt snapshot; it installs from the newest release branch instead.** `SNAPSHOT` parses to no branch, and the check that turns a version into one treated that as "not a release build of 24.10 or newer" and exited — on a router where the theme runs perfectly well. The feed genuinely has no snapshot channel, and not by omission: owfeed-packages publishes one branch per OpenWrt minor and its two lines *are* the package-format split (apk from 25.12, ipk on 24.10), not a build of the theme per release. So a router that names no branch is now served the newest branch its own package manager can read. What makes that sound for this package and not in general: it is noarch and `+luci-base` is its whole dependency list, so nothing in it was compiled against the branch it is fetched from. Candidates are probed newest-first against the real index rather than assumed, so a branch listed before it is published — or one that does not carry this router's architecture — falls through to the next instead of writing a repository entry that 404s on every update, and the probe's bytes are discarded: the index is still verified by the package manager against the pinned key, so a host that lies buys a feed entry that fails to verify rather than an install. Measured in an `openwrt/rootfs:x86-64` snapshot container — `SNAPSHOT r34693` picks 25.12, `apk add` needs no `--allow-untrusted`, `luci.themes.Footstrap` is registered — and with `/etc/apk/arch` forced to a name the feed does not carry, where the script refuses and points at the release asset. The 24.10 opkg path was re-run in `openwrt/rootfs:x86-64-24.10.4` to prove the architecture read that moved ahead of the branch changed nothing for a release router.

- **The login form shows what the auth backend actually said, instead of "Invalid username and/or password!" over a password that was right.** `fuser` is not a failure flag — it is the username the form posted, and `dispatcher.uc` sets it in BOTH branches that render a sysauth, including the second step of a pluggable login where the credentials were already accepted. Guarding the backend's message with `&& !fuser`, as the generic template does, therefore hides "Too many failed attempts" and "System time is not calibrated" at exactly the moment they are the answer, and puts a credentials error in their place. The message now wins and the credentials line is the fallback, which is what `luci-theme-bootstrap` does; `auth_plugin` tells the two apart, so a challenge from a backend reads as a warning and a plain notice does not. Rendered through a router's own `ucode` in all four states the dispatcher can produce.

- **Five more comments that had stopped being true are true again, all in the same sweep.** The uci-defaults script called the fall-through case "the sidebar default" — the fourth statement of a default that is the bar, and the only one the earlier pass missed. `fs-prefs.js`'s inventory of axis shapes named a `hueAxis` that does not exist, omitted `surfaceAxis` entirely, counted five instances where there are fifteen, and still listed an `updateCheck` axis that left with the updater and a `wallpaper` that "persists to the router", which it stopped doing when the write-through was removed. And four CSS comments plus the file tree in `docs/css.md` pointed at `styles/01-fonts.css`, deleted with the webfonts in 0.12.1 — the weight rules they explain are unchanged, but their reason is now the reader's own font stack rather than the two faces the package used to ship.

- **The Pattern Ink router default reached no browser, and pressing Save-as-default silently overwrote it.** `enumAxis` derived its `window.__fsSD` field name as the localStorage key minus `fs-`, which is `pattern-ink` — a field the server never emits, because the uci option is `pattern_ink`. `sd()` therefore answered `undefined` forever and the axis reported the built-in `theme` no matter what the router had saved. Measured on a router with `footstrap.settings.pattern_ink=original` and an empty localStorage: `window.__fsSD.pattern_ink` is `original`, `head.ut` pre-paints `data-pattern-ink="original"`, and the Ink control read *Theme* — so the page was painted one way and described another. Pressing Save then wrote `pattern_ink=theme` over the admin's value; verified on 24.10, where the stored `original` came back as `theme` before the fix and stayed `original` after. The hyphen fold is now applied in `colorAxis` too, where every key happens to be one word today and the same failure would be just as silent tomorrow.

- **A login backend's own fields reach the login form again: with `luci-plugin-2fa` installed, footstrap was a theme you could not log in through.** The dispatcher hands `auth_fields`, `auth_message`, `auth_html` and `auth_assets` to whichever sysauth template renders, and the theme-local one — which exists only to pass `blank_page: true` — rendered none of them. The OTP input was therefore never drawn, `luci_otp` was never posted and the login could not succeed on any router with 2FA enabled; the backend's "Too many failed attempts" and "System time is not calibrated" messages had nowhere to appear either. All four blocks are rendered now, so the template is a superset of the generic one it replaces rather than a subset of it, the extra fields get the `for`/`id` pairing the username and password rows already carry, and each conditional attribute carries a leading space — ucode's template lexer eats the whitespace before a `{%` tag and the newline after a `%}`, so the upstream spelling renders `inputmode="numeric"pattern="[0-9]*"maxlength="6"required` through a router's own `ucode`. Verified on all four owlab routers: templates compile, the form renders, a POST still logs in, and the block renders correctly through the routers' own `ucode` with `auth_fields` supplied.

- **A fresh install no longer opens Appearance with Save-as-default already dirty.** The built-in layout default is stated in three places and one of them had not been updated when the default flipped to the top bar: `_resolvedDefault()` still answered `sidebar` while `head.ut` stamps `top` when uci says nothing and `resetToBuiltin()` applies `top`. On a router with no `/etc/config/footstrap` and a browser with nothing in localStorage, `matchesSavedDefault()` was then false before anything had been touched — the button offered to save a default that was already the default — and Reset-to-saved landed on the sidebar instead of the layout the router actually ships. Measured in a browser against all four owlab routers: false before, true after.

- **The package README stopped describing files that are no longer in the package.** Its layout listing still named `fonts/` and said the doodle wallpapers "are downloaded on demand", both of which v0.12.1 removed — a reader following that map would look for a directory that is not shipped and expect a network call the theme no longer makes.

- **The GitHub Pages portal builds again.** Two breakages, both introduced by the v0.12.1 work and both invisible until CI ran: `mkdir -p _site/fonts` was deleted with the webfonts, and it was the only thing creating `_site` at all, so every `cp` after it failed on "No such file or directory"; and `cp wallpapers/*.svg` no longer matched anything once the two sample patterns moved into `wallpapers/svg/`, which under `set -e` is a failed build. The glob has now broken twice on a move, so it is spelled with the subdirectory and the reason is written next to it.

## [0.12.1] — 2026-08-03

### Added

- **Wallpaper → Pattern: upload your own SVG and the theme fits it to itself, live.** Three controls sit under the segment — Scale (the tile's edge, 40–1600 px), Strength (the layer's opacity, 0–100%) and Colours — and the first two write a custom property, so the tiling behind the page resizes and fades under the drag with nothing to reload. Colours is what makes an arbitrary file belong: on **Theme** the drawing is painted through a CSS `mask`, so the SVG supplies only its alpha and the theme supplies `--fs-text`, and one upload then reads correctly in light mode, in dark mode and under every palette; on **As in file** it is an ordinary tiled background for artwork that carries its own palette and would be flattened to one colour by a mask. The mask needs an element it can own — it applies to a subtree, so it can go on neither `.fs-shell` nor `<body>` — hence one empty `.fs-pattern` layer emitted at `<body>`'s top, `position: fixed`, `z-index: -1`, with the canvas moved up to `:root` so the negative layer is not buried by `body`'s own opaque background. It is emitted outside the `blank_page` guard, so a router whose saved default is Pattern shows it on the login page too, exactly as the File photo does. The file lands at `/etc/footstrap/pattern.svg` — under `/etc` so a package upgrade cannot delete it, in `keep.d` so a sysupgrade keeps it — and is exposed at `/luci-static/footstrap/pattern.svg`: the extension is load-bearing, because uhttpd types a response by extension and an SVG served as `application/octet-stream` is one no browser will paint. What is refused is refused before anything is written, and it is decided on the PARSED document rather than on its text: `DOMParser` reads the file (inertly — no script runs, no subresource is fetched), and the upload is refused if the root is not `<svg>`, if any element executes or embeds (`script`, `foreignObject`, `iframe`, `embed`, `object`, `audio`, `video`, `animate`, `set`), if any attribute is a real handler (`^on[a-z]+$`), if any value opens a `javascript:` URL, or if any `href` points off this router — `#fragment` and `data:` stay allowed, because that is how a tile refers to its own `<defs>` and embeds a bitmap. A regex over the source was the first attempt and it was wrong in the way that matters: `\son\w+=`, meant for `onload=`, also matches `only_selected="false"`, an ordinary Inkscape attribute — so one of this project's own sample drawings was refused by its own gate on a real router. Text matching guesses at a grammar the browser already implements, and it guesses in both directions. Scale, Strength and Colours are ordinary per-browser axes — localStorage, then the router default, then the built-in — and reach other devices through Save as default like the rest.

### Changed

- **The translation catalogue moved back to `po/`, and luci.mk owns it again.** `po/` is the directory `LUCI_LANGUAGES` globs, so the per-language `luci-i18n-footstrap-*` packages are emitted the ordinary way and nothing in `Build/Prepare` compiles a catalogue any more. It was `i18n/` since v0.8.5 for one reason: a self-updater in the field resolved the theme by name, took `head -1`, and installed the 6 kB catalogue instead of the theme (issue #6). That updater is retired, and the release is built by owfeed, which packages this theme as exactly one artifact per format whatever luci.mk would have done — so the rename now bought nothing and cost the catalogue its visibility to Weblate, which `CONTRIBUTING.md` names as *the* way to translate LuCI. `tools/check-packages.sh` still asserts one theme package per format.

- **Every control on the Footstrap tab is a LuCI widget, and every stretching one ends at the same x.** The enums are `ui.Select` and the numbers are `ui.RangeSlider` — the widgets the other tabs are built from, checked to exist on luci's `openwrt-24.10` branch and not only on master, so the theme's whole support range gets them. Two primitives of ours went with the change: a segmented radiogroup with a roving tabindex and a range wrapper with its own readout, both written when this page was a floating popover where a native `<select>` read as a hole in the card. What made the tab look ragged was not the widths themselves but that nothing agreed on one: a select stopped at 210px, the colour row ran to ~700px and the slider took the whole card with its readout flung against the right edge, because `.cbi-range-slider` asked for `width: 100%` inside a `flex: 1` field and no rule capped it. There is now one number for "how wide does an elastic control get in a form row" — `--fs-field-max: 440px`, which is the figure three rules had already reached independently (the text inputs, the dynlist, and the sshkeys page pointing at them) — and the slider and the colour row take it too. The slider's cap is a THEME-level fix: any LuCI page using `ui.RangeSlider` was getting a full-bleed slider, not just this one. The rows a wallpaper brings with it — the SVG and its Scale/Strength/Colours, or the photo and its Dim — are SIBLINGS of the Wallpaper row now instead of living inside its field: nesting a `.cbi-value` inside a `.cbi-value-field` nested a second 180px caption column inside the first, and measured on the router it started those controls 216px right of every other control on the page. Flat rows hidden as a group is what the stock pages do with a dependent field. Buttons take the width of their own label, as they do everywhere else in LuCI — they were `flex: 1 1 9em` and stretched to fill the field, so `Choose SVG` and `Remove` each ran half the card. And the destructive ones wear LuCI's own classes: `Remove` and `Reset to default` are `.cbi-button-remove` / `.cbi-button-negative`, which the theme paints from `--fs-danger`; `Reset to saved` stays neutral, because dropping back onto the router's saved default is a step back to a shared state rather than a discard. Measured after: one caption column at x=269 for every row, one field column at x=485, and every stretching control ending at x=925 — the x the stock tab's own text inputs end at.

- **The Footstrap tab is drawn in LuCI's own row shape and no longer in a layout of its own.** Every axis is now a stock `.cbi-value` — caption column, field column, hairline under the row — so the theme's settings sit beside General Settings, Logging, Time Synchronization and Language and Style looking like them rather than like a visitor. Measured on the router against the Language and Style tab: same `display: flex`, same `justify-content: space-between`, same 1px bottom hairline, same 8px/8px padding, same 13px non-uppercased caption in the same colour, and the two columns start at the same x — 269 px and 485 px in both tabs. What went is a private two-column responsive grid of stacked cards with an uppercase eyebrow above each control: it was the right shape for the floating popover this page used to be, and the wrong one for a page. The page now states no row layout at all — `base/30-forms.css` and `theme/60-inputs.css` own it, so a future fix to LuCI's form layout reaches this tab instead of passing it by, and 3 rules plus a grid went out of `pages/80-appearance.css`.

- **`install.sh` is 762 lines shorter and does one thing: it installs from the package feed.** Four steps remain — is this OpenWrt with a package manager, is the release 24.10 or newer, add the owfeed-packages feed, install the theme — and everything else was the release-asset path built around a problem the feed already solves. What verifies the bytes is now the package manager, against the feed key pinned in the script: apk checks the index against `owfeed-packages.pem`, opkg against usign key `9040356b214084da`. Running the script a second time upgrades to the newest version in the feed, which needed saying in code and not only in the comment: `opkg install` on an installed package reports "already installed" and exits 0 even when the feed carries something newer, so the opkg branch asks for `opkg upgrade` explicitly when the package is already there. `apk add` resolves to the newest version by itself. Two `set -e` traps went with the rewrite: the trailing `[ -x /etc/init.d/rpcd ] && …` would have ended the script with status 1 on a router without rpcd, before the "what to do next" message.

- **Four statements in the documentation stopped being true and are corrected.** `benchmark.md`'s prose quoted 15–48 requests per navigation for bootstrap and 0–8 for footstrap, where its own per-page table and the README say 15–47 and 0–7 — the prose was left behind by a re-measurement. `CLAUDE.md`'s `owlab test` example named release 25.12.5, the one release `owlab.yaml` warns against by name in a comment (there is no `openwrt/rootfs:x86_64-25.12.5` tag), so the documented command could not run. `docs/README.md` marked `devkit.html` as generated and never committed while leaving `playground.html`, which is generated the same way and gitignored on the next line, looking like a tracked file. And `css.md` answered "the script that proves a CSS change is not in this repository" with an offer to reimplement it "in about forty lines" rather than with what a contributor should do instead; a note that documents a gap is worth less than one that closes it.

- **The developer documentation carries half as much boldface, so the emphasis means something again.** 202 mid-sentence emphases went back to plain text across the 15 pages — single ordinary words leaned on for vocal stress (`is`, `not`, `every`, `first`, `cached`, `before`), the shape that stops being emphasis once a page has one every four lines. Prose bold per page: `spa-router.md` 122 → 69, `design-system.md` 97 → 64, `css.md` 76 → 59, `ci.md` 65 → 41, `third-party-apps.md` 60 → 46. What kept its bold is what a reader scans for: the lead of a rule or bullet, a term at its definition, and a measured number. Three identity claims (`__init__` *is* its render) became italic, which is the weight they always wanted. The all-`✅` column in the styling guide's checklist is gone in both languages: thirteen rows carrying the same mark encode nothing, and `- [ ]` lets the reader actually tick them.

- **Four facts that were retold on a second page now live on one and are linked from the other.** The jsmin `return /re/` trap was explained in full in `conventions.md`, `ci.md` and `package.md`; `ci.md` keeps only what CI adds (building jsmin from the pin, comparing token streams with acorn). The `!important` layer inversion was stated with different numbers in `conventions.md` and `css.md` — exactly the shape that drifts — so the rule stays in `conventions.md` and the mechanics in `css.md`. `development.md` no longer re-derives why the template gate lives in `verify` rather than `check`. And the export-tier measurement now links to the page that holds the table. Also on `spa-router.md`, the only page here that needed its own table of contents: "Deliberately NOT fixed", "Still open" and "Explicitly do not touch" are three subsections of one "What is left alone, and why", taking the page from sixteen top-level headings to thirteen.

- **The benchmark on the front page is footstrap 0.12.0, measured on real hardware rather than carried over.** Five runs over 38 pages against bootstrap and proton2025, wallpaper off: 4933 ms against 11 306 and 12 142 — 2.29× total, 3.03× median page, 38/38 navigated in place, and 18.4 s of router CPU against 37.3 s. The totals moved against the July figures and the theme is not why: installing 0.11.7 and 0.12.0 in turn on the same router and the same LuCI gives 4932 against 4930. What moved is the uhttpd keep-alive stall the page already documents — `http_keepalive=0` on that router takes the same tour to **3886 ms**, so a fifth of it is a TCP stall belonging to the web server, and the growth tracks the request count exactly (pages that make no request got faster; pages that make one grew by a median 23.7 ms). Client CPU is left out of this run on purpose: a sample is dropped when the renderer restarts mid-navigation, footstrap kept 38 pages of 38 against bootstrap's 18, and a ratio over that intersection inverts the answer — `bench/nav-benchmark.py` now prints per-theme coverage and refuses the comparison below 90%.

- **`SECURITY.md` lives in `.github/`, and the two orphaned README assets are gone.** GitHub reads the policy from `.github/` as readily as from the root, and `speed.svg` and `overview-sidebar-dark.png` were referenced by nothing after the README was cut down. Everything else in the repository root has to be there: `owlab` takes no path to its config, `owfeed` reads from the working directory, and the linters' configs are found by name.

### Removed

- **The bundled webfonts, and the package is 48% smaller without them.** 128 290 bytes built, against 66 690 now — a far larger share than the raw 88 kB of `.woff2` suggests, because woff2 is already compressed and gains nothing from the package's own compression while everything else does. Nothing replaces them and nothing needs to: `--fs-font-sans` and `--fs-font-mono` already named Manrope and JetBrains Mono FIRST and the system stack after, and a bare family name in `font-family` is matched against the fonts installed on the visitor's machine before the browser moves down the list. So an admin who has either face installed still sees the theme drawn in it, and one who does not falls through to `system-ui` / `ui-monospace` silently — no request, no 404, no flash. Measured in the browser with neither installed: `"Manrope", system-ui` renders at exactly the `system-ui` width while `Impact, system-ui` and `"Courier New", system-ui` render at their own, so the mechanism works and the theme simply has nothing left to add to it. It took THREE deletions and the third is the one that hides — the `@font-face` block, the nine subsets, AND the two `<link rel=preload>` in `head.ut`. A preload is not in the stylesheet, so dropping the rules alone left it behind and every page still asked the router for the files: six 404s per page, measured, before it was noticed. `PKG_LICENSE` loses its OFL-1.1 half, because OFL §2 requires the notice and licence to travel with every copy of the Font Software and there is no Font Software left to travel with. `tools/subset-fonts.py` went too.

- **The eight colour presets.** A wrapping row of pills, each painted in the accent it would set, sitting outside any row and therefore starting at the card's left edge while every label and field started 250px in — a good part of what made the tab read as ragged, and the one control on the page that looked like nothing else in LuCI. What they were for stays: a preset only ever wrote the Accent axis, and that axis is a row three lines below which takes any `#rrggbb`, which is what issue #20 actually asked for. Gone with them: `PRESETS`, `presetLabel()`, `applyPreset()`, the `.fs-preset` chip styling with its per-chip ink derivation, and eight msgids.

- **The two downloaded doodle wallpapers, and with them the theme's last run-time call to a third-party host.** Picking Cats or Dinosaurs used to fetch 77 kB or 128 kB from `raw.githubusercontent.com` over the admin's own browser, check it against a sha256 pinned in the JS, and upload it to the router. The check was sound and the arrangement was not: a theme in a package feed has no business reaching anybody's CDN while a settings page is open, and "two drawings somebody else chose" was never the interesting half of the feature — an admin's own SVG is. Gone with them: the pinned digest table, the `crypto.subtle` hashing path, the server-side glob that told the page which doodles were already on disk (`window.__fsWp`), the download-confirmation dialog, and the `wallpapers` gate that held the pins against the files. The drawings themselves stay in this repository under `wallpapers/svg/`, so anyone who wants them can upload them like any other pattern. A router upgrading with Cats or Dinosaurs selected reads a value the axis no longer offers and falls back to Off; `uci-defaults` deletes the two orphaned files from `/www`, which no package manager would ever have removed because no package ever owned them.

- **Every remaining mention of the retired self-updater.** The Updates UI went in 0.12.0; what was left was a paragraph in `fs-appearance.js` explaining an absence, three comments in `fs-router.js` justifying `onNavigate` by a caller that no longer exists, one in `fs-version.js`, and release-tooling notes in `stage.sh` and `check-packages.sh` that argued their rules from a script in the field. The rules that still hold are restated on their own merits — one asset per format per release stays load-bearing because anything resolving the theme by name takes `head -1`, which is what issue #6 broke — and `ver.REPO_URL` stays, because a link to the project is not an update check.

- **The installer's release-asset fallback, and with it the pinned-tag install.** Gone from `install.sh`: the signed manifest reader, the GitHub API fallback, the Pages mirror, the host allow-list, the per-package sha256 and `usign -V`, the embedded release key, `GITHUB_PROXY` and `FOOTSTRAP_ALLOW_UNVERIFIED`. All of it existed to hand a downloaded file to `--allow-untrusted` safely, which is a job the feed does not have. What it costs is stated rather than hidden: `sh -s v0.9.3` no longer pins a version, a SNAPSHOT build is refused instead of quietly taking the asset path, and a router that cannot reach `repo.owfeed.org` downloads the asset from the release page by hand. The release still signs everything it publishes — `manifest.txt`, its `.sig` and a `.sig` per asset — so a by-hand install can still be checked with `usign -V … -p release.pub`; nothing does it automatically any more. `tools/check-release-key.sh` and its CI step went too: it compared the installer's copy of the key against `release.pub`, and there is no copy left to compare.

## [0.12.0] — 2026-08-01

### Added

- **БОЛЬШЕ НЕТ АПДЕЙТЕРА. НАСТРОЙКИ ТЕМЫ ПЕРЕЕХАЛИ В СИСТЕМА → СИСТЕМА → ВКЛАДКА FOOTSTRAP.** / **THE UPDATER IS GONE. THE THEME'S SETTINGS MOVED INTO SYSTEM → SYSTEM → THE FOOTSTRAP TAB.** The button in the menu no longer exists. Upgrades now come from the package feed — `apk upgrade` / `opkg upgrade` — which is what the installer sets up; a router that still has `luci-app-footstrap-updater` installed gets its final release, which hands the theme to the feed and then removes itself.

- **Appearance moved into System → System, and every colour in the theme can be set there by hex.** Requested as "the blue theme is cool but sometimes you want grey or black" (#20). Nine colour axes now, where there were two hue knobs: Accent and the three status colours Good/Warning/Danger, plus four SURFACES — the cards, the inset controls, the sidebar/bar and the hairlines — and the canvas Tint. Each takes a `#rrggbb` exactly as entered, through a native swatch and a hex field, with one button back to the palette's own colour. There is no hue slider and that is the point: rotating a hue keeps the palette's chroma, so no angle of it reaches a grey, which is the one thing the request asked for. (The stored hue and the rotation in the stylesheet stay, so a value saved before this goes on painting.) What the theme owes a colour it did not choose is the ink on top of it: `--fs-on-accent` and the three status inks are derived from the entered colour's lightness in CSS — `clamp(0, (l - .62) * -100, 1)`, black above the sRGB crossover and white below it — so a solid button stays pressable at any colour, and the derivation is written `[data-accent="hex"][data-accent]` because at equal specificity the palette's dark block wins on source order: measured on the router, the single-attribute form left a grey accent carrying near-black ink at 1.9:1 in dark mode only. Every field says, in words, whether what you just picked can be read — “Easy to read on a card”, “Hard to read … large text only”, “Too faint to read” — measured live against the surface the colour is actually read on rather than silently corrected. The thresholds are still WCAG AA (4.5:1 for text, 3:1 for a hairline, which is graded as a shape and reads “barely visible” rather than “not enough”, since a faint border is a legitimate thing to want); the ratio itself moved into the title, because “On a card 5.4:1 · AA” was three pieces of jargon for one plain fact and the admin recolouring a router is not a designer. Eight accent presets, two of them neutral. It lives at the foot of the stock System page rather than on a route of its own — a theme must not register a dispatcher node, because the node outlives the theme that registered it — and the chrome's Appearance button is gone with the popover, which used to build fourteen controls and a dialog into every single page load whether or not anyone opened them.

- **The top bar is the theme's default layout; the sidebar is now the opt-in.** The bar is what the theme is built around — every layout rule starts from it, with the vertical column as the one guarded override — and it is what a phone gets at any setting. Only a router with no saved preference is affected: an explicit `layout` in `/etc/config/footstrap`, and every browser's own choice, are untouched.

- **Colours and Background are folded away by default.** They are the widest rows on the page — nine colour fields and an uploader — and recolouring is a thing most admins never do, so each is a disclosure now and both start closed. A disclosure and not a switch, which is what these were first: a switch answers "is this on", and that is the wrong question — turning it off would either revert nine colours (destructive, from a control that looks like a disclosure) or change nothing at all, which is a switch that lies. Folding answers the question actually being asked. Standard APG pattern: the heading row IS the button, `aria-expanded` drives both the chevron and what a screen reader is told, and the panel carries `hidden`, so a closed group is out of the tab order and out of the accessibility tree. The open/closed state is remembered per browser and is not an axis — it changes nothing about how the page looks. Colours and Surfaces share one fold: one decision, two headings.

- **Two resets, and neither loses your place.** "Reset to default" cleared this browser's keys, which does not mean the theme's defaults — it means "inherit whatever the router was told to look like", so on a router with a saved default the button could not reach the shipped look at all. It is two buttons now: **Reset to saved** clears the keys and lets each axis fall back through the layers to the router default, and **Reset to default** writes the theme's own built-ins explicitly, which is the only way to say "as it ships" over a saved default. Both still take two clicks, arming one disarms the other, and neither touches `/etc/config/footstrap`. Both reloads now land back on the Appearance tab instead of dropping the user on General Settings to find it again — the reset leaves a one-shot flag in `sessionStorage` and the tab, once rebuilt, clicks itself through `ui.tabs`' own handler.

- **Surfaces have a Transparency slider.** One knob for the cards, the inset controls and the hairlines — and, because `--fs-bar-bg` and `--fs-glass` are mixes of `--fs-panel`, the chrome and the popovers thin with them. It is unconditional rather than gated on an attribute: at its default 100% the `color-mix()` returns the input colour unchanged, so an untouched theme paints exactly what it painted before and there is no second code path to keep in step. One knob rather than four, because "how much of the wallpaper do I want to see" is one question, and a card at 60% over a sidebar at 90% is not a look anyone asked for.

- **A saved router default reached no browser for seven of the axes, and now a gate says so.** Save as default wrote `good`, `warn`, `danger`, `card`, `control`, `bar` and `line` to `/etc/config/footstrap` correctly — and `header.ut`, which reads that file back for the pre-paint, was a hand-written object literal that had never heard of them. The symptom is the worst kind: the save reports success, the file on disk is right, and **Reset to saved** drops the browser to the *built-in* default instead of the saved one, because the value the server hands the client was never there. It is the second time this exact gap has appeared (the first was `density`), so the fix is a list read in a loop plus a check: `tools/axes.mjs` now derives the fields from `snapshotAxes()` — the one list that IS the contract — and fails if the server read does not cover every one of them.

- **The update checker is gone; the package feed replaces it.** `luci-app-footstrap-updater` existed for one reason — a theme installed from a downloaded file is one the package manager will never upgrade — and the installer adds the feed now, so that reason is gone. Removed with it: the Updates toggle, the "new version" badge, the one-click Update button, the runtime `require` of the optional module, the server-side glob that told the page whether it was installed, and the confirm dialog's styling. **The Appearance tab makes no network call at all now**, which is the part worth stating: a settings page reaching GitHub on every open to reimplement `apk upgrade` was the wrong shape. The version line stays — it is what is installed, and it costs no request.

- **The installer adds the package feed and installs from it.** It detects the release line and the architecture, adds owfeed-packages with its signing key, writes a `keep.d` entry so a firmware upgrade wipes neither, and then installs through `apk`/`opkg`. That is the part that matters after the script ends: the package manager knows where the theme came from, so **`apk upgrade` carries it forward** — a downloaded file sits at its version until somebody returns with another file. The release-asset path is still there and still verifies a signed manifest; it is the fallback now, taken automatically when the feed is unreachable and always when a tag is pinned, because the feed holds one version per branch and quietly installing a different version than the one asked for would be worse than the extra download.

- **The doodle wallpapers are downloaded on demand instead of shipped.** Cats and dinosaurs were 77 KB and 128 KB of decoration in a package a router flashes into squashfs — a fifth of the theme, for a picture most installs never switch on. They live in `wallpapers/` in the repository now and are fetched when one is first picked, after a dialog that states the size before anything is fetched. **The BROWSER fetches, not the router**: the admin's machine has the connection, so a box with no WAN — or one behind exactly the blocked route this theme is often installed to manage — is never asked to reach GitHub; the bytes then go to the router over the same cgi-io path the login background already uses. Each file is pinned by size and sha256 in `fs-prefs.js` and checked **before** it reaches the router, because a raw.githubusercontent URL is a branch rather than a release asset and "it came over https" only says the bytes are the ones that host served. `npm run wallpapers` holds those pins against the files, and fails if either doodle is ever found in the shipped tree.

- **A second wallpaper: dinosaurs, beside the cats.** Same doodle treatment — one tiling SVG at 20% opacity in the same neutral grey the cats use, which is what keeps one file legible on a light canvas and a dark one alike. Traced at 1.4 MB and shipped at 128 KB (svgo at zero decimal places, 571 paths merged to 43); the tile is 880px against the cats' 440 because the artwork is a 2048-unit square carrying twice as many figures, so at the cats' size every animal came out a third as wide and the pattern read as texture.

- **Right-to-left languages are laid out right to left.** LuCI ships base catalogues for Arabic, Persian and Hebrew and never emits a `dir`: the dispatcher stamps `lang` and stops, and no stock theme adds one, so a router set to any of the three rendered right-to-left text inside a left-to-right document — paragraphs aligned to the wrong edge, a line's trailing punctuation at the wrong end, and every mirrored affordance pointing the wrong way. The theme owns the `<html>` element, so this is the one place that can say it; `head.ut` now matches the base subtag against the standard RTL set (so a future `ar-EG` is covered) and writes `dir` explicitly in both directions. The chrome follows it rather than being flipped by hand: about sixty directional declarations across the stylesheet became logical ones (`margin-inline-*`, `border-inline-*`, `inset-inline-*`, `text-align: start|end`), which is a no-op in a left-to-right document and the whole mirror in a right-to-left one. Three things could not follow from that and are handled where they live: the disclosure chevron and the rail's collapse arrow are glyphs, so they mirror through the individual `scale` property (composed with the `rotate` that already animates them, which is why both moved off `transform`); and `::-webkit-resizer` is a UA-drawn corner that takes no logical properties, so it has a hand-written mirror. Measured on 25.12/apk and 24.10/opkg in Hebrew, at 1500/900/390 px over four pages: every page carried **10 000 px of horizontal scroll** before — `.cbi-tooltip` parks itself at `left: -10000px`, which in an RTL document is 10 000 px past the *inline-end* edge and therefore real scrollable overflow — and none does now, with the rail flyout back inside the viewport (it opened at 1499–1695 px of a 1500 px window), the alert stripe on the reading edge, and the login page, the phone bar and its dropdowns correct. Left-to-right is unchanged: 136 page × width combinations still scroll nowhere, and the actions column still lines up across rows.

- **A stray comma in the rpcd ACL is now caught before it ships.** rpcd skips an unreadable file in `acl.d` and says nothing, so a broken `luci-theme-footstrap.json` issues the grant to nobody: Appearance → "Save as default" and the login-background upload fail on the user's router with no error anywhere, while the theme installs and draws normally. Two documents claimed CI validated it and nothing did. `npm run acl` (`tools/check-acl.sh`, and a step in CI's node-less `check` job) parses every shipped `acl.d/*.json` and also rejects the two shapes that parse but grant nothing — a list where rpcd wants an object, and an entry with neither `read` nor `write`. Python and `sh` only, so it runs beside `audit.py` where there is no node. Proven both ways: one comma turned into a colon fails it, the shipped file passes.

### Changed

- **The documentation is rebuilt around one job per page, and the pages that stopped being true are gone.** 26 files became 16, 8132 lines became 4862, and the whole set is English with one Russian mirror for the outward-facing app-authors' guide. Four documents were retired: a 1023-line audit snapshot that already described itself as historical with stale `file:line` references, a design-phase page whose roadmap was closed, an SPA best-practices essay and a sources list — every live constraint in them moved to the page where it actually applies. The jsmin regex trap had been written out six times, the trust chain four, the token tiers four; each now lives in one place and is linked to. Numbers were re-measured against the code rather than copied forward: the stylesheet is 134 894 bytes, not the 111/121/124 KB three pages claimed, `!important` is 26 rather than 33 or 38, CI has six jobs rather than four, and `Build/Prepare` has seven steps rather than four.

- **The invariants the docs deferred to now exist in the repository.** 36 references pointed at a `CLAUDE.md` that is deliberately not committed, and seven more at tooling under `.claude/` that no clone contains — a third of the cross-references led nowhere. They are now `docs/conventions.md`, and the 29 `docs/NN` references embedded in source comments, tools and the workflow were rewritten to the new filenames so the code and the documentation still point at each other.

- **The documentation was re-checked claim by claim against the code, and everything that had drifted since the rebuild is corrected.** The template compile-check had moved out of the node-less `check` job and into the `verify` containers, where the router's own `ucode` runs it against the installed templates on both release lines — three pages still described the old cmake build from a pinned commit, so `luci-upstream.pin` no longer carries a `UCODE_PIN` that nothing read, and says in place why the pin must not come back. `css-orphans` was documented as gating both directions when it gates one and reports the other, which is the difference between "CI will stop me" and "somebody has to look"; the reverse report is clean again, with the two search-palette id hooks justified by name and a module filename in a path string no longer read as a class. `owlab test` was shown with four assertions where `verify` makes five. The remaining drifts were smaller and are fixed the same way, against the file rather than from memory: the stylesheet is 135 734 bytes, the `i18n/` tree has a Spanish catalogue and `root/` a `keep.d` entry, `mangle-tokens.sh` runs before step 4 rather than step 5, `export-tier` sweeps 28 combinations rather than 4, and the `!important` allowlist is five files each fighting something outside the cascade rather than the single reduced-motion exception. Four tracked files — the pin, the stylelint config, the gallery and `owlab.yaml` — pointed at the uncommitted `CLAUDE.md` or at a `docs/NN` name; they point at `docs/` pages now.

- **The dev stand and CI install on the same OpenWrt point release again.** `owlab.yaml` pinned 25.12.4 while CI's `verify` job had moved to 25.12.5, so "the local form of the same assertions CI makes" was proving them on a different userland. Both are 25.12.5 now; 24.10.8 was already in step.

- **Three mechanisms that were load-bearing and undocumented are written down**: the chrome fence (the marker, the fence and the pin that must agree, and the gate that derives the marker from the markup), the command palette, and why `/etc/config/footstrap` has to be declared a conffile — an undeclared one is replaced on upgrade, so the theme's own Update button wiped the admin's saved defaults and reported success.

- **owlab is a documented requirement, not a convenience.** A change that alters behaviour is not finished until it has run on a real OpenWrt userland on both package managers. Every gate in this repository is static — they read files, and not one of them opens a page — which is exactly why the two bugs above survived a green `npm run check`. `docs/development.md` now covers installing owlab, the fixtures that make the stand useful, and the `owlab test` invocation, one per package format: `--install` is a host-side glob evaluated once per router, so a pattern matching both formats hands the apk box an ipk and fails on both (upstream: owfeed/owlab#2).

### Fixed

- **The Dashboard's device lists card on a phone instead of losing their right-hand columns.** Reported from a router with wifi clients: the "Transmit Up./Down" column was simply not there. `luci-mod-dashboard` builds its tables with a real `<thead>`, and the theme only recognised LuCI's two header CLASSES (`.tr.table-titles`, `.tr.cbi-section-table-titles`) — so nothing tagged them as data tables, nothing measured them, nothing carded them, and because those `th`s are `nowrap` they could not compress either: `.fs-main`'s overflow clip cut them off with nothing to scroll. A `<thead>` is now the third accepted header, and the cells get the column heading copied onto `data-title` so the cards are labelled — the dashboard sets none, and a stack of unlabelled values would have been worse than the clipped table. Verified on the stand at 390px: the DHCP device list tags `.fs-dt`, cards, labels all 30 cells HOSTNAME / IP ADDRESS / MAC, and overflows by 0; at 1400px it stays a table. `thead`, not `thead tr`, because that markup is built by `E()` and the parser's implied row never happens.

- **A foreign `<table>` with no LuCI classes at all scrolls instead of being clipped.** Reported against a wifi-clients dashboard: the "Transmit Up./Down" column was simply not there. The theme cards a data table once it stops fitting, but that only reaches LuCI's `.table` markup with a header row — a foreign app emitting a plain `<table><tr><th>` matched none of it, so nothing measured it, nothing carded it, and `.fs-main`'s `overflow-x: clip` cut it off with nothing to scroll. Measured at 390px: the table wanted 388px inside a 356px card and hung 31px past the edge; now it scrolls inside the card and overflows by 0. The rule is scoped away from every table the theme does understand (`.table`, `.cbi-section-table`, `.fs-dt`) — those card, and a scrollbar instead of that would be a downgrade.
- **An unbreakable value no longer escapes its card in a table the theme did not recognise.** Long values have always been broken — but only in a table carrying an `id` or a `.tr.table-titles` header row, which is how the theme tells a data table from a key/value one. A third-party status page that renders a key/value `<div class="table">` with neither matched no rule at all and kept `overflow-wrap: normal`, so a single unbroken token — an ICCID, a firmware string, an APN, a base64 key, a DUID — held the column open and pushed the table outside its card. Reported against the modem pages; reproduced against `luci-app-3ginfo-lite`'s own markup, which renders exactly that shape three times. Stock never had the bug because it breaks every cell and never asks what kind of table it is. Now neither do we. Deliberately not scoped to the phone tier, which was tried first and left a hole exactly where the column is narrow but the window is not: with a 130-character token the table escaped its card by 147px at 900px, 247px at 800px and 279px at 768px, and is contained at every width unscoped — the same argument the fit engine rests on, that fitting is a property of the content and its column rather than of the viewport. `anywhere` and not `break-word`, because `break-word` permits a break without reducing the cell's min-content, so the column stays open anyway (measured: the table stayed 355px wide in a 346px column). The cost was measured rather than assumed and is nil: over 8 router pages × 4 widths × 849 text cells, nothing changes — same cell overflows, same tables past their column, same multi-line cells, same mid-word breaks, same line count — and 10 of 14 full-page screenshots are pixel-identical, with the other four differing only in uptime, clock and RX/TX counters.

- **Pressing a button in a form row no longer shoves it down the page.** The rule that stacks a `.cbi-value` holding several title/field pairs — written for a modal that crams three of them into one row — keyed on a second `.cbi-value-field`, and `:has()` is a LIVE selector: any app that appends a second field at runtime (a status line, an output pane, a spinner holder) flipped the whole row from "label beside field" to "everything stacked" under the user's finger. Measured on the stand: the button moved 31px down with the rule and 0px with it disabled. The test is the second TITLE now, because that is what actually announces a second pair — a second field with no title is an app adding something to the one field it already had, which asks for no re-layout. Rendered markup matches exactly as before, including the modal the rule exists for; only the runtime append stops triggering it.

- **The modal close cross and a form's secondary action jumped to the wrong edge in right-to-left languages.** The sweep that moved the stylesheet onto logical properties reached about sixty declarations and left three physical ones behind, because `float` is the one property here that takes no logical keyword this theme can rely on — `inline-end` is newer than the `oklch(from …)` and `:has()` the stylesheet already requires, and a browser that does not know the keyword drops the declaration and leaves the element floating nowhere. So they are mirrored by hand, the same way `::-webkit-resizer` and the two chevrons already are. `.close` is the one with reach: it renders in every modal and every `ui.addNotification()` banner, and in RTL it sat in front of the heading rather than after it. `.secondary-action` contradicted its own container — `.actions` sets `text-align: end`, which follows the writing direction, while the float did not, so the plate aligned its content one way and the action the other. Measured in a live document at 1400px, as the distance from the reading edge: the cross 549px in LTR against 41px in RTL, the secondary action 582px against 10px; both now read the same in either direction. The third physical `float` was removed rather than mirrored — `theme/55-buttons.css` makes `.cbi-page-actions` a flex container and float does not apply to a flex item, so it computed to `none` and moved nothing, while reading like the one declaration the sweep had missed.

- **A token pair that painted nothing is gone, along with the comment promising it did.** `--fs-accent-lt` and `--fs-accent-lt-base` were described as the logo gradient's light end, defined in both palettes and rotated through an `oklch(from …)` on every accent hue — but the brand mark has no gradient: `partials/brand.ut` draws the OpenWrt arcs with a baked `#00b5e2` and one mode-flipped ring, and nothing in the stylesheet, the templates or the JS ever read either name. They were also step 2 of "TO ADD A COLOURWAY", so the instructions asked the author of a new palette to choose a colour that could not appear. Removed rather than kept as a reserved name, because the comment claiming the accent hue moves the logo describes behaviour a reader can check is absent. Proven with a computed-style diff over 16 800 elements across five pages × light/dark/hicontrast/accent-rotated: one element differs, and it is the Overview's progress bar, whose width is live data.

- **A comma or a parenthesis inside a quoted attribute value no longer costs a third-party app its rule.** The zone test that decides whether a foreign stylesheet can repaint a page it does not own reads selectors with three small scanners, and none of them knew that a quoted string is data rather than syntax. `.app-row[title="a,b"]` was therefore split down the middle on that comma, and the half left over — `b"]` — names no class or id, so it read as unable to be pinned to the app's own markup: the sheet was judged invasive, and the fence then rejoined the pieces with `', '` and wrote `[title="a, b"]` back into the CSSOM. The app's own selector, silently changed to match a value it never asked for, with the setter reporting success — this file exists to stop a view's CSS being deleted, and changing a rule is worse, because nothing looks wrong afterwards. `[href*="("]` failed the other way: the paren counter went up and never came back down, so the rest of the selector was eaten and a rule genuinely pinned to the app read as unpinned. One length-preserving masker now answers the question for all three scanners, so the vocabulary cannot disagree with itself; the parts handed to the fence stay the app's own bytes. Measured on 25.12/apk, 24.10/opkg and ImmortalWrt with the same injected sheet and only this file differing: the selector came back rewritten before and byte-identical after, while a genuinely page-reaching rule (`[class] { padding: 0 !important }`) is still re-hosted, still fenced, and still leaves the chrome its padding.

- **An image the browser cannot decode no longer leaves the wallpaper upload stuck on "Uploading…" for the life of the page.** The re-encode step runs on an `img.onload` handler, and a throw inside an event handler does not reject the promise it sits in — it escapes as an uncaught error and leaves that promise pending forever. Two ordinary ways out of that handler could throw: `getContext('2d')` answers null when the canvas cannot be backed, which is exactly the low-memory router this decodes a 25 MB source on, and `drawImage`/`toBlob` can throw on their own. The Appearance picker disables "Choose image" and relabels it before the call and restores both in a `.finally()`, so a pending promise meant a disabled button lying about an upload that was never going to finish, and the popover is built once at init — nothing short of a reload got it back. The whole body is guarded now and reports the same "Could not process the image." the encoder's other failure already did. Verified on 25.12/apk and 24.10/opkg: an undecodable file rejects in under 10 ms and the picker comes back enabled with its error shown, while a real image still goes canvas → cgi-upload → uci → live and is served 200.

- **Two promises nobody was holding turned their failures into unhandled rejections instead of errors.** The Appearance popover is wired by a promise that `init()` calls for its side effect and never keeps, so a throw anywhere in the popover's assembly bypassed the `.catch` that guards the rest of chrome init — the one that exists so a failure there is loud rather than silent. The overview's progressive-paint run is the same shape from the other end: on the first load it hands the caller a fresh resolved promise so the view can return at once, which leaves the real run's rejection — `network.flushCache()` failing on an expired session — with no handler at all. Both are now owned where they are created: the popover logs and stops, the overview run absorbs a rejection whose every interesting cause has already been reported by the section that raised it.

- **Two sections of a third-party menu whose names differ only in punctuation no longer share one panel id.** The sub-panel id folded every non-alphanumeric character to `-`, so `foo.bar` and `foo-bar` at the same level produced the same `id` and both disclosure triggers' `aria-controls` resolved to whichever panel stood first in the document — a screen reader is then told the closed section owns the open one's contents. A menu node name is a string a third-party package picks in its own `menu.d`, so this is theirs to collide, not ours to assume: the escape is injective now and still readable for the ordinary all-alphanumeric case. Checked on all three stands — every panel id unique, every `aria-controls` resolving.

- **A dismissal handler could be taken out for the session by a click it was never meant to judge.** The menu's click-outside listener is document-level and called `closest()` on the event target without the optional-call guard every other document-level handler in the theme already uses, so a click whose target is not an element — `document` itself, or a text node from a synthetic dispatch — threw out of that listener and stopped the flyouts closing from then on.

- **Picking a wallpaper or dragging the photo-dim slider no longer rewrites the router-wide default for every other device.** Both axes wrote straight to `/etc/config/footstrap` the moment they changed, on the argument that the File photo is router-side so "which wallpaper shows it" and "how dim" belonged beside the image. The argument did not survive its consequence: choosing Cats in one browser silently re-pointed the default every other browser inherits, and because the write also moved the Save baseline, the "Save as default" button did not even light up to say so. Reproduced on a live 25.12 router — one wallpaper click left `footstrap.settings.wallpaper='cats'` and `photo_dim='30'` in uci with nothing pressed. Photo dim is now an ordinary per-browser axis like the other ten, stored in `localStorage` under `fs-photo-dim` and pre-painted from `head.ut`; uploading a photo still writes its cache-bust token, because a file cannot live in `localStorage`, but no longer forces `wallpaper=file` on the whole router. Every appearance axis now reaches `/etc/config/footstrap` through Save as default and through nothing else.

- **The router-wide Density default reached no browser at all.** `Save as default` wrote `density` into `/etc/config/footstrap`, and `header.ut` then never read it back: `fs_defaults` is an explicit list of options and `density` was missing from it, so the server stamped `__fsSD.density` as `""` whatever the config said. A fresh browser inherited the saved layout, palette, tint and rounding, and silently fell back to Normal density. Nothing could catch it — `tools/axes.mjs` holds the pre-paint against the live applier and both were correct; the gap was the server read that feeds them. Found by running the change on a real router rather than by a gate.

- **Opening a page from banIP, AdBlock or OpenClash no longer turns client-side navigation off for the rest of the session.** Those three inject their CSS as a `<link>`, which the theme re-hosts into its own cascade layer: the fenced `@import` copy is the one that paints and is owned by the page that made it, and the app's original is disabled for good. But a disabled sheet is still an element that answers `cssRules`, so the original went on being judged able to repaint any page, was owned by nobody, and the "has a view poisoned this document?" test therefore answered yes forever — a full page load on every navigation from that point until the tab was closed. The `<style>` half never showed it, because a `<style>` is re-hosted in place and so carries its owner. A sheet that paints nothing cannot poison the next page, and it is no longer counted as if it could; containment now covers both element kinds, which is what page ownership was built to do. Measured against a live banIP install on 25.12/apk and 24.10/opkg, with the same click and only this file differing: leaving banIP → Feeds discarded the document before and keeps it after, and banIP's own page still carries its styling from the fenced copy.

- **Dragging Wallpaper → Dim left "Save as default" greyed out, with nothing to press.** The slider is one of the eleven per-browser axes and moves this browser away from the saved router default, but it was the one axis wired straight to its applier instead of through the wrapper that re-reads the button's state — on the strength of a comment describing the behaviour it had before it became a per-browser axis. The button is the whole status display here (enabled "Save as default" when this browser diverges, disabled "Saved as default" when it matches), so it sat disabled while reporting a match that no longer held, and the only way to save the change was to close the popover and re-open it. All eleven axes now refresh it. Measured on both stands from a baseline saved so the button starts greyed, which is what makes the slider the only thing that can move it: `fs-photo-dim` went to 20 with the button still reading "Saved as default" before, and reading "Save as default" after.

- **Resizing the window left config tables scrolling sideways, and they never recovered.** `luci-base` measures the widest row-actions cell and writes it as an inline pixel width on the header, footer and every actions cell of a config table. It re-runs on resize, but it only clears its own cache and leaves the inline widths standing, so the fresh measurement reads the width it pinned last time: the pin feeds itself and can only grow. On a stock theme that is invisible, because a config table is a table at every width. This theme cards it below 960px of column, where the actions cell deliberately spreads its buttons across the whole card — so the number measured there is the card's width, and carrying it back into table mode is absurd. Measured on Network → Firewall → Zones: loaded at 1000px and grown to 1280px, the actions column pinned 634px and the table rendered 1267px inside a 1056px column, 256px of permanent horizontal scroll, where a fresh load at 1280px renders 966px. The narrow bar has the same fault from the other side — at 768px there is no sidebar and the column is 712px, at 800px the sidebar returns and it is 520px, so the window grows while the room shrinks. The pin is now dropped whenever the room changes, which covers both, and the column still lines up across rows. 21 of 136 page × width combinations scrolled sideways before; none do now, in both Chromium and WebKit, on 24.10 and 25.12.

- **A session-long browse leaked about 12 KB per page, and it never stopped.** The same `luci-base` routine ends by attaching a `resize` listener to `window` for each config table, and the callback closes over that table. Nothing removes it. A full page load takes the listener with the document, which is why no stock theme shows this; client-side navigation keeps one document for the whole session, so every visit to a config page left another listener holding another detached table. Measured over 120 navigations: `window` went from 1 resize listener to 31, and a heap snapshot 280 navigations wide had grown by 26 880 element-data records, 23 600 text nodes, 18 520 listeners and 1 160 `<form>`s — 11.8 KB per navigation on a curve that never flattened. The theme now claims that hook before it is attached: the re-measure it existed for is the same one the fix above already does, from the room rather than from a window event. Over 560 navigations the heap now settles at 0.8 KB each and plateaus.

- **Three inputs the chrome took on trust from outside itself.** A menu node named `constructor` or `__proto__` — a name any package may choose in its `menu.d` — was read straight out of the icon table's prototype and concatenated into the sidebar's markup as `function Object() { [native code] }` and `[object Object]`; the table has no prototype now. A dispatch path passing through a childless node threw while building the section tabs, and that throw escapes the chrome renderer, taking the mode menu, the tabs and everything wired after it with it — the tree walk now tests `children` before dereferencing it, exactly as the router's own walk always has. And the update check, which lives in the optional updater package and reaches GitHub over the network, had its resolved value read without a rejection arm, so a router that could not reach the network logged an unhandled rejection from a control whose entire job is to stay hidden when there is nothing to report; no answer is now treated as no update. Two of the three were reproduced on the stand rather than argued: a `menu.d` node named `constructor` put `function Object() { [native code] }` inside the sidebar link's markup and now renders the default icon, and an updater stub whose `check()` rejects raised a page error before and none after, with the badge hidden either way. The third is hardening — a dispatch path's ancestors have children by construction, so the deref is unreachable on a well-formed tree, and the walk now simply cannot be the thing that breaks if one is not.

- **A read-only page opened by a click no longer arrives with live Save and Apply buttons.** `luci.js` implements `hasViewPermission()` as `!env.nodespec.readonly`, and views plus its own Save/Apply footer key their disabled state off that one flag. The dispatcher decides it twice over: `apply_tree_acls()` marks a node in the menu JSON when that node's own `depends.acl` grants read without write, while a real request folds every ancestor's acls into `ctx.acls` and stamps the leaf from the fold. The router read the leaf's own flag, which for most read-only pages is simply not there. Found by diffing the full-load snapshot against the click-arrival snapshot for all 93 pages the menu offers: a full load of `admin/status/logs/syslog` reports read-only — the flag sits on `logs`, two levels up — against writable on a click, and the same for `dmesg` and all four realtime graphs. For a root session those six are all of them; for a session with a narrower ACL it is every page whose section is read-only. The verdict is now folded down the resolved path the way `check_acl_depends()` folds the accumulated list, and the 93-page diff carries no state difference left.

- **Back and Forward opened the previous page at the top when the menu is a bar.** The router records the scroll offset itself because no browser restores an inner scrollable region on a same-document traversal — but only for `#maincontent`, the sidebar layout's scroller, leaving the horizontal layout's document scroller to the browser's own `scrollRestoration`. That is the same mistake one level up: the browser restores at the traversal, i.e. before the handler swaps `#view`, and the swap collapses the document's height under the offset just restored, so the clamp takes it back to 0 with nothing left to re-apply it. Measured on the stand at 1400×800 — Processes scrolled to 400, System opened, Back: 0 before and 400 after, where the sidebar layout was and stays 400; Forward then Back again gives the same. Both offsets are now recorded per history entry and replayed on whichever scroller has grown tall enough to hold them.

- **The Appearance popover and the command palette rode Back and Forward onto the next page.** Both close on a click outside, on Escape and on their own trigger — every one of them a user act on the document, and a history traversal is none. The forward path only looked correct because the click that navigates is itself an outside click. It is a focus defect more than a paint one: both are `role="dialog"` with `aria-modal="true"` and wrap Tab at both ends, while the router moves focus to the content wrapper behind them — an assistive technology is then told it is inside a modal dialog whose focus has left the dialog. Measured: open Appearance, press Back, and `aria-expanded` stayed `true` over a page that had changed underneath; it is `false` after, and the same for the palette, with both still opening, closing, picking a result and returning focus as before.

- **One page renaming the browser tab renamed every page after it.** The title is `<host> | <page>`, and the host half was re-derived from the live `document.title` on every hop, so a view that sets a title of its own — log viewers and dashboards do — became the host for the rest of the session. Measured: after a view set `document.title` to `ACME Dashboard`, the next two hops read "ACME Dashboard | Routing" and "ACME Dashboard | System". The host is now taken once, at chrome init, from what `head.ut` stamped, and cannot drift.

### Performance

- **Nine narrow declarations that a broader rule already provided are gone.** Making the long-value break a default for every table cell (above) turned six copies of `overflow-wrap: anywhere` into restatements of it — in the data-table rule, the Overview grid's phone tier, the package list's fourth column, the DHCP-lease columns and the Overview progress rows — and a search for the same shape found three more that predate it: `#view .table[id], table.fs-dt { width: 100% }` (base already gives every `.table` that), `#modal_overlay .modal { border-radius }` (base rounds a modal to the card radius, under a note here still claiming base used 3px), `.cbi-value-field select option { color }` and `#packages.fs-stacked .td { min-width; width }`. Each was verified the same way before removal: confirm in a live document that the narrow selector's elements are a strict subset of the broad one's, switch the declaration off, and check that no computed style moves — across seven pages, three widths and both layouts, over 100 to 1941 matching elements apiece. Two candidates that looked identical by that test were kept: `word-break` on the package list's fourth column and `min-width: 0` on the Overview cells both moved elements when switched off. The stylesheet goes 135 734 → 135 425 bytes, and 8 of 14 full-page screenshots are pixel-identical with the rest differing only in uptime and traffic counters.

- **Three small things the SPA router accumulated for the life of a session are bounded or dropped.** This document outlives every page in it, so anything the router keeps per navigation keeps growing: the scroll-offset map held one entry per history entry and never evicted, the hover prefetch held the last link a pointer crossed — and an element holds its parent, so that one anchor pinned the whole detached tree the content swap had just thrown away — and the five-second timeout that caps the wait on an in-flight prefetch stayed armed behind every navigation whose prefetch had already landed. The map is now capped at 50, which is more history entries than a browser lets you traverse back through; the anchor is released on every navigation; the timer's loser is cancelled.

- **A link carrying `?query` or `#hash` is no longer prefetched.** Such a link full-loads — the router only ever pushes bare paths — so warming its view module spends a request on a page the client path can never open. The click handler declined those from the start; the three prefetch triggers (hover, focus, pointer-down) had each grown a copy of the URL test without that half, and they share one filter now.

## [0.11.7] — 2026-07-29

### Changed

- **The install instructions keep the feed's key through `/lib/upgrade/keep.d/` instead of `/etc/sysupgrade.conf`.** sysupgrade reads both — `list_static_conffiles` feeds `find` from the two together — but a file of the feed's own can be rewritten where appending cannot: running the install twice used to leave two copies of both paths in a file that belongs to the user, and undoing it meant editing that file by hand rather than `rm`. Measured on 25.12.5: with the keep.d entry present `sysupgrade --create-backup` contains the key and the repository list; without it, neither. The README also carries the feed's badges now, which are generated from the index the feed just built and so cannot claim a version nobody can install.

- **Every released package carries this repository's own signature.** `owfeed sign` runs in the release job, before the manifest is written, with an EC key whose public half is pinned in [owfeed-packages](https://github.com/owfeed/owfeed-packages) — the feed now refuses a package it cannot attribute. The feed signs its index and not the packages it carries, which is the right split and left a gap: a published `.apk` held no evidence of who built it, so "the author is responsible for this package" rested on nothing checkable. This signature is inside the file and reaches the router, where anyone holding the public half can confirm the origin **without trusting the feed that served it** — which the index cannot do, since it only ever proves that the feed published something. It changes nothing about installing: apk takes its trust from the signed index, and a package with no signature at all installs, upgrades and removes normally. It is evidence, not a gate.

- **The released packages are built by [owfeed](https://github.com/VizzleTF/owfeed), not by the OpenWrt SDK.** Both formats now come out of one staged rootfs: `./tools/stage.sh && owfeed build` produces `luci-theme-footstrap-<v>-r1.apk` and `luci-theme-footstrap_<v>-r1_all.ipk` in seconds, where the two SDK legs spent about five minutes each downloading, verifying and unpacking a cross toolchain to build a package containing not one compiled byte — CSS, ucode templates, browser JS and fonts. Verified against the released 0.11.6 rather than argued: the payload is **byte-identical across all 72 files**, including every minified JS file, every stripped template, and both `.lmo` catalogues — owfeed's own compiler matches `po2lmo` exactly. The one file that differs is `cascade.css`, and it differs in the safe direction: the SDK path mangled the private `--fs-*` names with 10 reserved names because CI minified the JS *before* the SDK read it for the reserved set, so the shipped sheet depended on who built it; staging mangles before minifying, which reserves the full 15 and costs about a kilobyte. The SDK verification did not leave with the SDK — owfeed fetches the host `apk` out of a release SDK tarball and holds it to the same contour this workflow ran inline: ed25519 over `sha256sums`, with OpenWrt's branch key pinned from a different host.

- **`luci-theme-footstrap/Makefile` stays, and is no longer a second source of truth for what happens at install time.** `tools/stage.sh` extracts the `postinst` and `postrm` bodies out of the Makefile's own defines and hands them to owfeed, which wraps them in `default_postinst` / `default_prerm` exactly as `package-pack.mk` does. Two copies of a `postrm` — a script that only ever runs on somebody else's router, months later — is the worst duplication in this repo to let rot. `tools/conffiles.mjs` now checks `owfeed.yml` alongside the Makefile for the same reason: the released package is built from the former, so a `conffiles` correct in one file and missing from the other protects nobody while still reading as protected.

- **The packages are reproducible.** `SOURCE_DATE_EPOCH` is the **commit's** timestamp, not the job's. Both containers record mtimes and a package's identity is a hash over its payload, so without a fixed epoch byte-identical content rebuilds into a package that claims to be new — which invalidates every cached copy and makes an integrity check report tampering that did not happen. Re-running the workflow over the same commit now produces the same bytes.

- **The SDK's branch signing keys moved from the workflow's build matrix into `luci-upstream.pin`.** That matrix went away with the SDK legs, and `luci-theme-footstrap/build-apk.sh` — the local SDK build, the one path that still needs them — read them out of it, so leaving them there would have left a convenience script parsing a file section that no longer exists. `build-apk.sh` itself is kept and its purpose restated: it exercises the Makefile, luci.mk, jsmin and the SDK's own packaging, which must keep working for anyone building this theme in an SDK or a feed. Nothing released comes from it.

- **The signed release manifest is written by `owfeed release`, where this repository hand-rolled it.** Same file, same trust chain — owfeed's shape was modelled on this project's manifest — so the migration had one job: not to break a reader that is already on somebody's router and cannot be fixed remotely. The first line now reads `owfeed-manifest 1` rather than `footstrap-manifest 1`, which nothing parses; the architecture each package was built for is a new **trailing** field, because `mf_pkg` reads fields 4, 5 and 6 positionally and anything inserted ahead of them would have made every update fetch a URL that 404s. Checked by running the fielded installer's own awk over a manifest built by the new path, and the workflow now asserts the field order on every release rather than trusting it. The signatures were verified with `usign` built from the commit the router's own binary comes from: all three accepted, and a manifest with one byte appended rejected.

- **owfeed is installed by its own action, which verifies the binary against GitHub's build attestation before it reaches `PATH`.** It replaces `go install …@<commit>`, which compiles the tool in every job and trusts whatever the module proxy returns for that revision. The `SHA256SUMS` file beside a release is not a check either — the same host serves the binary and the checksum, so whoever can replace one replaces the other, which is the argument this project already makes about GitHub's asset digest and about OpenWrt's `sha256sums`. An attestation is signed by GitHub's own identity and recorded in a public transparency log, and the action pins the *workflow* allowed to have produced it rather than merely the repository. Measured on the released binary: genuine verifies, one byte appended does not, and neither does the genuine binary checked against a different repository. The action is pinned by commit (= tag `v0.1.3`) like every other third-party action here, and `version:` names the same release — the ref pins the action, the input pins the binary.

- **`tools/build-usign.sh` is idempotent.** The release job now builds usign in one step and verifies with it in another, and `git clone` into an existing directory fails — the old script assumed one call per job. It reuses a checkout only when it is at the pinned commit and refuses a directory holding anything else, because a tree at some other revision is exactly the drift the script exists to prevent.

- **The installer's own signature is the one thing still signed by hand.** `owfeed release` signs the packages it finds in the per-architecture directories and the manifest that names them; `install.sh` is not a package, and it is signed because it is executable code handed to root. Nothing can check that signature during `curl | sh` — the script IS the first thing that arrives — so it is not a link in the install chain; it exists so a careful admin can verify the installer out of band, and so the Pages mirror can carry `install.sh.sig` beside it.

- **The feed is the first way to install this theme, and the installer is the second.** It is carried by [owfeed-packages](https://github.com/VizzleTF/owfeed-packages) for both release lines, and this README mentioned it nowhere — so a reader learned about `install.sh` and never about the path that upgrades with `apk upgrade` and needs no self-updater running at all. The installer keeps its place as what it is genuinely for: a router that cannot add a repository, or has no route to one. The two must not be mixed on one router, and that is now said where somebody reads it before doing it rather than after — `apk add ./file.apk` writes a content-hash pin into `/etc/apk/world`, the pin survives sysupgrade, and the package then never upgrades from the feed again.

- **The installer is signed by `owfeed release` too, and the last hand-rolled usign call leaves the release job.** `--sign-also install.sh`, added in owfeed 0.1.5 for this case, signs a file published beside the packages without putting it in the manifest — the manifest is an inventory of packages a feed ingests, and a feed has no use for an installer. Same key, same signature, one fewer step holding the secret: the release job no longer builds usign from `luci-upstream.pin` to sign one file by hand. `tools/build-usign.sh` stays where it belongs, verifying what is about to be published with the binary the router's own is built from, and `luci-theme-footstrap/build-apk.sh` still uses it for a local SDK build.

### Fixed

- **A third-party app's stylesheet no longer dies on the first navigation away from the page that injected it.** A sheet that arrives as a `<link>` is re-hosted into the theme's cascade layer — the original silenced for good, an `@import` shim painting in its place — and the shim is scoped to the page that owns it, keyed by `currentKey()`. That key read the URL, and the URL is not the page: LuCI's dispatcher walks a node down to its firstchild without rewriting the address bar, so `/cgi-bin/luci/admin/status` (the Status menu's own link) and a bare `/cgi-bin/luci/` on a router without `luci-mod-dashboard` both render `admin/status/overview` while the URL says `admin/status` and nothing at all. One navigation later the router hands `scopeToCurrentPage()` the RESOLVED leaf, the two keys cannot match, and the sheet is disabled for the life of the document — with the app's own `<link>` already silenced, nothing brings it back. Measured on owrt2512 and owrt2410 with `luci-app-mwan3`, whose Overview include injects `#mwan3-service-status > .alert-message { display: inline-block; width: 15rem; … }`: a full load on `/admin/status` drew the interface card as `inline-block 240px 96px`, and System → General and back left it `block 966px` — every MultiWAN card stacked full-width down the Overview. The key is now `L.env.dispatchpath`, what the server actually dispatched to, with the URL kept only for a document that never received the bootstrap; 240px before and after on both releases. Containment is unchanged and re-checked over eight pages and two rounds: banip, adblock, ssclash's Ace sheets and the mwan3 shim are all still dark on every page but their own.

## [0.11.6] — 2026-07-28

### Fixed

- **A package that ships an editor no longer flattens the whole chrome** — reported against `luci-app-ssclash`, where opening the page dropped the theme's spacing, bar, tabs and buttons, a reload fixed it, and hovering anything broke it again. The cascade layer order is fixed by the FIRST sheet in the document to name a layer, so `@layer tokens, base, theme, page;` in `cascade.css` only holds while nothing gets in front of it. Ace — pulled in by ssclash and by any package with an embedded editor — inserts its stylesheets as the **first child of `<head>`**, and lazily, adding more on first hover. Re-hosting such a sheet into `@layer theme`, which is what keeps a third-party sheet from beating the chrome outright (issue #8), then moved the first mention of `theme` above ours: the order inverted to `theme, tokens, base, page`, `base`'s `* { padding: 0 }` won, and the page rendered edge to edge. Measured on the router: `.fs-content` padding 24px/28px → 0 with the layer probe reading `base` as the winner. `fs-sheets.js` now re-declares the canonical order from a fresh `<style>` inserted first in `<head>` whenever a foreign sheet lands ahead of ours — fresh, because inserting a sheet re-runs the ordering while moving an existing one does not (measured both ways). Verified on 25.12 and 24.10 across all three states from the report: SPA arrival, reload, and after hovering.

- **Arriving at Status → Overview from another page no longer fails with "TypeError: L.itemlist is not a function"**, leaving the page stuck on "Loading view…". `require()` hands the object it was called on to the loaded module's factory, and `view/status/index.js` passes that same `L` on to its own includes, one of which — `30_network.js` — calls `L.itemlist(...)` directly. `ui` hangs those helpers on the runtime instance the dispatcher builds (`window.L = new LuCI()`), never on the prototype that a dependency-loaded module receives, so a stock view required through the wrong `L` dies mid-render three modules further down. The theme's overview module patched the stock view through its own prototype `L`, and because `require()` caches by class name, whichever caller gets there first binds that class for the whole page: on a full load the dispatcher always wins, on an SPA arrival it was a race against the router's own require — which is exactly why this only ever happened "sometimes, coming from another page" and never on a reload. Measured on the 24.10 dev router: 6 of 6 SPA arrivals failed with the page showing zero sections before the fix, 0 of 5 after, and the same on 25.12 and both ImmortalWrt boxes. `docs/14` now states the rule the fix follows: every require of a **stock** class from theme code goes through `window.L`.

- **The heading of a collapsed-rail submenu is no longer cut in half** (issue #22). The flyout's title is drawn with a `::before` on the submenu `<ul>` — and that same pseudo-element is the bar layout's invisible hover bridge, an absolutely-positioned 10px strip sitting above the panel so the pointer can travel into it without dropping the hover. The rail's rule re-pointed `content` at the section name and inherited the geometry: measured, the heading rendered at `top: -10px` with `height: 12px`, i.e. out of the flow and ten pixels above the panel, where the flyout's own `overflow: hidden` clipped the top off every letter. It is stated back into the flow now (`position: static; inset: auto; height: auto`), which is also what gives the title its space in the column — the rail brings its own hover bridge as `li.has-sub::after`, so nothing here needs the bar's.

- **The spinner on a button inside a data table no longer draws on top of its label** (issue #22, and #15 before it). Clicking "Reserve IP" in the overview's DHCP leases adds `spinning` to that button, and the glyph landed over the first letters of the word instead of beside it. The cause was structural rather than local: the glyph was `position: absolute`, so the host had to be told to leave room for it with a `padding-left` that had to out-rank whatever else was padding that element — a ladder of seven selectors, each one class more specific than the rule it was written to beat. `.cbi-section .table[id] .td .cbi-button` is `(0,5,0)` and beat all of them, leaving the button at 10px of left padding where the glyph needs 32. The glyph now sits **in the flow** (`display: inline-block; flex: 0 0 auto`), reserving its own space, so no host padding is involved and there is nothing left for a future rule to out-rank; the ladder is deleted. The same button mid-click is rendered in `docs/gallery.html` from now on — neither this bug nor #15 was visible there, which is why both had to be reported from a router.

- **A status alert is opaque again on the Cats wallpaper.** The six coloured variants painted `background: var(--fs-*-fill)`, and a `-fill` is an 18% `color-mix` with `transparent` — with nothing behind it. On a flat background that reads as the intended tint; with the wallpaper on, the doodles tile behind the content at full strength (the wallpaper leaves them there precisely because every block that carries text paints an opaque `--fs-panel` of its own) and read straight through every notice, warning and error on the page. The plain `.alert-message`, the only one still on `--fs-panel`, was the one that looked right. The tint is now a background *image* layer over the panel colour, so the named 18% step is unchanged and an untinted router sees the same pixels it did.

## [0.11.5] — 2026-07-26

### Added

- **The theme speaks Spanish** — a complete `es` catalogue, all 76 strings, contributed by [@castillofrancodamian](https://github.com/castillofrancodamian) (PR #21). It ships **inside** the theme package like the Russian one, not as a separate `luci-i18n-footstrap-es`: a per-language package is what broke the update button on every router in the field (issue #6), and a bundled catalogue also cannot lag a version behind the theme it translates. Three strings were corrected after the merge, and the first is the interesting one: `Dim` is the wallpaper scrim slider, not a colour mode, so "Oscuro" would have printed the same word as `Dark` two groups above it — a msgid alone does not say what control it labels.

### Fixed

- **A third-party app's CSS can no longer fold the sidebar into a top bar on a full-width desktop** (issue #19). The theme measures whether the content column still has room once the sidebar has taken its cut, and it resolves the four width tokens by assigning each to a throwaway `<div>` and reading the used width back. That div is an ordinary element in the document every `luci-app-*` shares, it carries no chrome mark — so `fs-sheets`'s fence deliberately does not spare it — and its inline styles were not `!important`. An app shipping `div { min-width: 500px !important }` therefore won every read: all four tokens came back 500, so the cut the sidebar was said to take became 500 + 2×500 and the "does the content still fit" floor moved to exactly 500 + 500 + 1000 = **2000 CSS px**. That is why it was reported as a *zoom* bug — Chrome at 90 % hands the page 2063 CSS px and the sidebar stayed, at 100 % it hands 1857 and the sidebar became a bar on a 1920×1080 screen. Reproduced on the dev router with that one rule at 1155/1440/1857/2063 px, before and after. The probe's own declarations are now `!important`, which a style attribute wins outright against any author rule, and `box-sizing` is stated so a foreign `border-box` cannot shave the reading either. A plausibility net backs it up: the rail *is* the sidebar collapsed, so `0 < rail < sidebar` holds by construction, and both known failure modes destroy that relation — a hijacked probe reports one foreign width for all four, a renamed or missing token reports 0 for all four (an absolutely-positioned empty div shrinks to 0, and 0 is finite, so the per-read fallback never fired). Neither is visible in a single number; only the relation between them gives it away.

- **Tapping a link on a phone no longer downloads the page's module twice.** The prefetch is a `fetch()` and the navigation's own load is an XHR, and two requests for the same URL do not coalesce — so a click that landed before the prefetch finished fetched the module a second time, at full latency, and gained nothing at all. Measured on the dev router at 120 ms RTT: the prefetch ran 2664→2788 ms and the require's XHR 2682→2788 ms for the same 8.6 KB. That is the *normal* case on a touch device, where `pointerover` arrives in the same moment as the tap, and it also hits any fast click over a slow link. The navigation now waits for an in-flight prefetch instead of racing it, which costs nothing — the XHR would have waited for exactly those bytes — and is capped so that a wedged prefetch can never wedge a navigation. Speculation *below* a link the user has already clicked now stops as well: after the click, `require()` fetches the same graph and pipelines its parsing against it, and waiting for the whole subtree instead measured 658 ms against 525 ms for the race, in exchange for a duplicate that stopping avoids outright.

- **Keyboard navigation gets the prefetch too — it had none whatsoever.** The only trigger was `pointerover`, so a user who Tabs to a link and presses Enter never fired a single pointer event and the whole optimisation was invisible to them. `focusin` is the keyboard's hover, and the Tab→Enter gap is human-scale, so the module has usually arrived by the time Enter lands; the arrow-key highlight in the command palette warms its row the same way (debounced, or typing would warm the top result for "w", "wi", "wir" in turn). `pointerdown` closes the one pointer case `pointerover` cannot see: a link that scrolls **under** a stationary cursor crosses no boundary and fires nothing.

### Performance

- **A first visit to a page is up to 1.9× faster, because the prefetch now follows the module's own dependencies.** Warming just the view class left its own `require` pragmas one round-trip behind it — `view/network/routes.js` pulls `tools/network.js`, 40.5 KB. The bytes of the root are already in hand, so reading the body and scanning it for pragmas is free. Measured at 120 ms RTT on a first visit: `network/routes` 418 ms with the view warmed against **296 ms** with its dependencies warmed too, exactly one round-trip; over six pages, 1713 ms with no prefetch → 1184 → **1052**. Two traps came with it, both caught by measurement rather than reasoning. The scan must not be line-anchored: the shipped files are minified and every pragma sits on one line, so `/^'require …'$/m` matches **nothing**, silently — the first cut of this feature measured a win of zero for that reason. And six class names have no file at all: `luci.js` seeds its registry with `{ baseclass, dom, poll, request, session, view }`, which `require()` answers from memory, so a walk that trusts the pragmas puts 404s for `view.js`, `poll.js` and `baseclass.js` in the console of every page load — the same noise this theme already refuses when it probes for `fs-update.js` server-side.

- **The five most recently visited pages are warmed at idle, so the first visit of a session is fast without touching anything.** The per-link prefetch needs a hover, a tap or a focus first, so the first visit still paid for its whole module chain; the recents list the command palette already keeps is the best predictor of that page anywhere in the theme, since an admin lives in three or four of them. Measured at 120 ms RTT with a fresh HTTP cache and **no hover at all**: `network/routes` 289 ms against 553 cold, `network/dhcp` 315 against 443, `system/system` 288 against 421. Capped at five, the current page skipped, deferred to `requestIdleCallback`, and dropped entirely under `navigator.connection.saveData` — speculation is the first thing that should go on a metered link, while the per-link prefetch stays because a hover or a tap is a deliberate gesture. Walking the whole menu instead would pull every view module on the box, which is the cost `docs/22` warns about.

- **Four faster-looking routes were measured and rejected, with the numbers recorded so nobody re-derives them** (`docs/17`). `<link rel=preload>` for LuCI's modules double-fetches in the `as="fetch" fetchpriority="low"` form too, not only `as="script"`: 49 → **71** requests and +250 KB wasted for a wall time of 835 → 832 ms. Flattening the module graph at the entry point does collapse four request waves into one and still buys almost nothing — 835 → 804 ms — because HTTP/1.1 allows **six connections per host** and the waves simply re-form as batches of six, while `menu-footstrap`, the chrome's own bootstrap, finishes at 395 ms instead of 200 ms from queueing behind twenty siblings. Prefetching `uci.load()` for the common configs changes nothing (1113 → 1106 ms, identical request counts) even though `uci.js` really does cache. And Service Workers with CacheStorage are not expensive but *absent*: a LAN IP over http is not a secure context, measured on the router as `serviceWorker: false`, `caches: false`, `navigator.storage: false`.

## [0.11.4] — 2026-07-26

### Added

- **The navigation benchmark reports CPU, on both ends, in two separate tables** (asked for on the OpenWrt forum). Wall-clock time answers "how long did I wait"; it does not answer "what did this cost", and the two can disagree — a theme can be fast because it made the *router* do the work, or fast on the router while burning the client's battery. **Router:** `utime+stime+cutime+cstime` of `uhttpd`+`rpcd`+`ubusd`, read from `/proc` at the edges of each theme's passes. The `cutime/cstime` halves are what make it work — uhttpd forks a CGI per request and a reaped child's CPU lands in its parent, so the ucode that renders the shell is counted (verified: 10 shell renders moved uhttpd by 41 jiffies, while rpcd, which the login page never calls, did not move at all). Plus the `/proc/stat` figure for the whole box, printed beside an idle baseline taken before and after, because that box also routes traffic. **Client:** CDP `Performance.getMetrics` deltas per navigation — `TaskDuration` with a script/style/layout/v8-compile breakdown; verified that these counters survive a full page navigation (the renderer process is reused for a same-origin load), and a negative delta is dropped rather than counted as a suspiciously cheap navigation. Result on real hardware: the same tour of 190 navigations costs the router **17.8 s of CPU against bootstrap's 37.0 s**, i.e. 91 ms versus 190 ms per navigation, and the client 26.6 ms versus 45.8 ms of main-thread time. Three traps are called out in the output itself: an open LuCI view polls once a second, so the polling rate is measured separately (parked on one page) and discounted before dividing by the navigation count; the percentage rows are **rates** over a window whose length the theme changes, so a faster theme shows a *higher* percentage on *less* CPU and only CPU-seconds compare; and `/proc/stat` inside a Docker container is the **host's**, so the box figure there would include the benchmark's own browser — which is why the published numbers come from real hardware. Also recorded: `V8CompileDuration` is ~0.1 ms in both themes, so re-compiling `luci.js`/`cbi.js` is *not* where a full reload loses.

### Fixed

- **Leaving a Realtime Graphs page no longer costs a full page reload.** Stock LuCI's five `status/realtime/*` views each append a `<style>` at MODULE EVAL carrying `svg text { fill: #eee; font-size: 9pt }` — real properties on a bare selector, so invasive by the same definition that catches `[class] { padding: 0 !important }`. `documentPoisoned()` therefore declared the document spent and the SPA router fell back to a real navigation on the way **out**. Measured on the router: **37 of 38** pages navigated in-place instead of 38, `status/realtime/load` **15 ms → 157 ms**, and the whole realtime family 2–10× slower. An invasive sheet is now *contained* rather than fatal: it is tagged with the app that injected it and darkened while that app is not on screen, so it cannot reach another page and the document survives. Deleting it on the way out is the obvious fix and the wrong one — the append is at module top level and `L.require` caches the module, so a second visit would render unstyled; disabling is reversible, which is the whole difference. The re-measure gives **2.60× against bootstrap** (from 2.15×), **4.31×** median per page, **38/38** in-place, and the individual pages back where they belong: `realtime/bandwidth` 168 → 31 ms, `realtime/connections` 68 → 19 ms, `realtime/cpu` 68 → 28 ms, `overview` 678 → 392 ms.

- **Ownership is per APP, not per page, and that is measured rather than assumed.** The per-page version was written first and swept against a router with 62 third-party pages: `luci-app-zapret2` has three pages sharing ONE injected `<style>` (`.label-status { … !important }`), so it belonged to whichever loaded first and arrived **dark** on the other two — an app silently losing its own styling, which is a class of app rather than a corner case. The key is `admin/<group>/<app>`, the smallest one that keeps an app's pages together while still blocking the leak onto other apps and onto stock pages. Segments, never the dash-joined `data-page`: a dispatch segment may itself contain a dash (`admin/system/package-manager`).

## [0.11.3] — 2026-07-26

### Changed

- **A `notice` alert is informational, not a success.** Grouped with `.success` — where `styles/base` had left it — it was pixel-identical to it: same fill, same rail, no other channel, so one status word carried two meanings while the theme's own `.label.notice` was accent and `.cbi-tooltip.notice` neutral. What settles the direction is what LuCI means by the word: `ui.js` emits `notice spinning` for the "applying configuration changes" banner — *in progress*, not done — and stock `luci-theme-bootstrap` paints notice from `--background-color-*`, keeping green for `.success` alone. It joins `.info` on the accent.

- **The toggle switch, the checkbox and the radio follow the Density axis.** They were the only controls in the theme that did not. The switch was five bare literals, so it stayed 40×22 at Compact *and* at Large while every button and field beside it moved (38 → 32.3 → 43.7); the checkbox read `--fs-space-4`, i.e. the multiplier for **air**, which drops to .65 at Compact and stays 1 at Large — so its tick box went to **10.4px**, smaller than anything else on the page, and then refused to grow at Large. `02-tokens.css` states the rule they broke: "add a size OUTSIDE these ladders and it silently stops responding to the axis", and `--fs-density-box` is defined for "boxes that must HOLD text or an icon", which is what a tick box is. Measured on the router afterwards: the switch now goes 34 → 40 → 46 in step with the buttons, and the checkbox 13.6 → 16 → 18.4. The knob's travel is derived from the three sizes instead of a hand-written 18px — including the `- 2px` for the pill's borders, since an absolutely-positioned knob is placed against the padding box while the width is border-box, and omitting that term put the knob 2px off-centre. The invisible 44×30 hit overlay stays literal on purpose: it is the WCAG 2.5.8 floor, and a floor that shrinks with a preference is not one (at Compact the target is 38×26.7, still over the 24px minimum).

### Fixed

- **In Windows High Contrast, "this port is up" and Save & Apply read as states again.** `95-a11y-media.css` already states the principle — a state carried by background alone vanishes when the OS replaces every colour, which is a correctness bug — and repaired the active tab, the checked toggle and the selected dropdown row. Two more were left behind: `.ifacebox-head.active` was indistinguishable from a dead port, and Save & Apply did not read as a **button** at all. That one is the worse of the pair: it is a `.cbi-dropdown` wrapper, so with its fill forced to Canvas only the label inside the `<li>` kept a highlight, leaving what looks like selected text beside a bare chevron. Both join the existing repair's selector list rather than getting a rule of their own. Deliberately **not** extended to the seven alert variants and five `.label` variants: the proposal there was to encode severity in `border-style` (dashed/dotted/double), and a border style is not a scale anyone can learn — the honest repair is a word or an icon in the markup, which belongs to `ui.js`.

- **Hovering a row action no longer drops its label below the contrast floor.** The outline buttons inside a table cell set their hover ink to the role colour on a translucent tint of that same colour — `--fs-accent` on `--fs-accent-soft`, and the matching pair for positive and negative. Measured by compositing the tint over the surface beneath it, per palette and mode: **4.07:1 in footstrap/light and 4.41:1 in hicontrast/light**, both under AA's 4.5, against 8.05 and 13.64 now. Neither gate could see it — axe does not hover and the computed-style differ is blind to `:hover` — while this same file already forbids the pattern twice with its own measurements (Save at 4.25:1, the alert chip at 3.4–4.4). The ink is `--fs-text`; the role still reads from the fill and the border, exactly as Save and Reset carry theirs. The positive variant also gains the `-line-hi` border its two neighbours already had, so hovering it no longer looks less responsive than the buttons beside it.

- **The keyboard focus ring is visible on the tab you are actually on.** It was drawn as `outline: 2px solid var(--fs-accent)` inset by −2px — on the active pill, whose background *is* `--fs-accent` (measured on the router: both `rgb(86,157,245)`). Tabbing along a strip, the indicator vanished the moment it reached the current page's tab. Both states now take `--fs-focus-ring-solo` (see below), whose 2px gap in the surface colour is what lets one value serve a pill whose background is the accent the ring is drawn in. `box-shadow`, not `outline`, because the strip clips — the reason the outline was inset in the first place.

- **Keyboard focus is visible in the sidebar menu, on the chrome's buttons, on both range sliders and on a checked toggle — none of which showed an indicator at all.** `--fs-focus-ring` is a 10–15% tint of the accent, so composited on the surface it lands on it measures **1.15 / 1.27 / 1.17 / 1.29 : 1** across palette × mode, against the 3:1 WCAG 1.4.11 wants from the thing that tells you where focus is. That is legitimate only *beside* a second channel: every field also flips `border-color` to `--fs-accent`, a change measuring 4.88–6.52:1, so there the border is the indicator and the tint is its halo. Three groups had no second channel and were relying on the tint alone — every sidebar menu link plus Search/Appearance/Logout and the rail toggle, the section tabs, and `input[type=range]` in both flavours (the widget's track sets `border: 0`). Worse, on a **checked** toggle — half the switches on any page — the border flip is `--fs-accent` on an `--fs-accent` fill (measured on the gallery: fill `rgb(86,157,245)`, border `rgba(86,157,245,.97)`), so a focused checked switch showed literally nothing. There is a second named ring now, `--fs-focus-ring-solo`, for the case where the ring is the whole indicator: 2px of surface then the solid accent, which measures 5.19–8.52:1 on the panel and 4.88–9.14:1 on the page. It also gives a name to the halo two rules had already written out by hand. Verified on the router by swapping the sheet under a live page: the menu link's ring went from `color(srgb … / 0.15)` to solid accent at **7.53:1**.

- **The modal and the tooltip use the theme's one floating-surface elevation.** `base/60-modal.css` drew the dialog's shadow as `0 0 3px var(--fs-panel2)`, and in footstrap light `--fs-panel2` and `--fs-bg` are the same hex — the shadow under the top of the z-stack was painted in the exact colour of the page behind it (1.00:1; dark 1.27, hicontrast 1.06/1.14, and always *lighter* than the canvas, so a glow rather than a shadow). `.cbi-tooltip` was lit by `0 0 2px var(--fs-border)`, a raw 2px halo in the hairline colour — 1.08–1.86:1 against the surfaces a tooltip lands on — while the theme already overrode the single instance somebody had looked at (`.zonebadge .cbi-tooltip`) to `--fs-shadow-pop`. Both take `--fs-shadow-pop` now, like every other floating surface: the open dropdown, `::picker(select)`, the rail flyout, the search box, the appearance popover. `cssdiff` over three pages and 3266 elements reports exactly these 14 box-shadow changes and nothing else. Both base declarations were dead afterwards and are gone, which `audit.py --strict` is what asked for.

- **`docs/gallery.html` renders the tab strip and the zone badge as LuCI really emits them.** Two more cards were showing shapes nothing produces, so a rule could be rewritten under them and measure zero diffs. The section strip is the *theme's* own (`fs-chrome.js`) and marks the current page with `.active` on an `li.tabmenu-item-<name>`, while `ul.cbi-tabmenu` — ui.js's in-form strip — marks it with `.cbi-tab`; the card wrote `.cbi-tab` in both, so the first strip rendered with **no active tab at all** (measured: all three items carried the muted ink). The zone badge was written as a plain `background:#a4d1a4`, where `firewall.js`'s `getZoneColorStyle()` declares `--zone-color-rgb` and paints *from* it — and `base/95-luci.css` re-mixes that var for dark mode with no fallback, deliberately, so the badge lost its colour entirely in dark (measured: `rgba(0,0,0,0)`). Also corrected: the card's claim that the forcing utilities carry the theme's only legitimate `!important`s outside the reduced-motion block (there are 22 of those, each accounted for), and `95-a11y-media.css`'s count of 13 flags in `theme/` and `pages/` (14) and its description of the focus ring as a 12% tint (10/15% — it is the one ladder member whose strength is per mode).

- **An alert's status reads from its stripe and its surface, not from whether the frame happens to be coloured.** `.warning`/`.error` set `border-color`, i.e. all four sides including the 3px stripe, while `.success`/`.notice` set only `border-left-color` — so three of the seven alerts wore a coloured ring and three a grey one, and the difference between "not applied yet" and "this is about to fail" hung on one pixel of frame. The ring is neutral now and the surface carries the status at the ladder's named `-fill` step, the one already used as a surface twice in `55-buttons.css` — not a fresh unnamed `color-mix`, which is how four spellings of one tint got in here before. `.info` was styled by nothing at all and fell through to a plain panel; it tints like the other statuses, while a class-less `.alert-message` stays flat, because a note is not a status. The paragraph ink goes to `--fs-text`: the lists beside it were already full strength, so a two-sentence alert had its first sentence muted and its bullets not. Contrast measured in **both** contexts — an alert on the page and inside a section, since the tint is translucent — across four palette/mode combinations: worst 8.27:1. The tint deliberately does not reach `.cbi-section-error`, whose list text is `--fs-danger`: at 12% that measured 4.4:1, an AA failure.
  Two shapes had to be added to `docs/gallery.html` first, because both changes measured **zero** diffs without them — the alert's inner table (the firmware Current/Available readout) was rendered by nothing here. Adding it immediately surfaced a real failure: that table's header keeps the muted eyebrow ink, which on the new tint measures **3.35:1** in hicontrast/light. It is `--fs-text` there now. The first attempt at that fix did nothing, because `.table .tr.table-titles .th` in `30-tables.css` is four classes and out-ranks a three-class selector however much later it sits in the sheet.

- **`.cbi-select` stops being the theme's only skeuomorphic control.** The legacy `luci-compat` shell — a `div` around a native `select` — painted `linear-gradient(--fs-panel, --fs-border)` on the box *and* again on a `▾` plate, and since `--fs-border` is lighter than the panel in the dark palettes it was also the one control that got brighter towards the bottom. Nothing else in the theme has a gradient. It now takes the themed `select` rule property for property: `--fs-panel2`, the palette-aware `--fs-select-chevron` at the same position and size, the same height and the same box, so a legacy shell and a modern select line up in one form column. This is the non-JS fallback — the people who see it already have something broken, and it should not additionally look like a control from another theme. Two things came out of it: the inner select needed the chevron's inset instead of an em-relative margin against a px-positioned glyph, and the disabled cue had lived **entirely** on the plate (`base/30-forms.css` dims `.cbi-select[disabled]::before` and never the shell), so with the plate gone the state had no visual at all until the shell took it. The DIV shell was absent from the gallery too, which is why a rule rewritten in full first measured zero diffs.

- **The pager buttons are square and on the control ladder.** They were the only buttons in the theme set in bare pixels, and the width opted them out of the Density axis while every other control shrank. Also corrected in the same pass: an off-ladder `height: 34px` that never rendered — the generic `.btn` floor already won — and a `min-width: 38px` that restated `--fs-ctl-h`'s own value. On a phone the app's own unlayered CSS still grows them, which is Zone 2 working as documented.

- **A table inside an alert uses the same column gap as every other table.** 14px was the only cell gap of that value in the sheet, and the comment above it defends flattening the frame, not the rhythm. The rest of the proposed padding sweep was not taken: three of the four values it wanted to unify are documented density decisions (`denser data tables`, `compact but readable`, the key/value gutter), i.e. four kinds of table with three deliberate densities rather than drift.

- **`docs/gallery.html` renders the Save & Apply split control the way `ui.js` actually emits it.** It had `<div class="cbi-dropdown">` with a nested `<button>` — a shape LuCI does not produce. The real wrapper carries `btn cbi-button cbi-button-apply` itself and holds its label in an `<li>`, and the theme paints it as one accent control (verified against a live router: `rgb(86,157,245)`, 143×38). With the wrong markup the wrapper matched the theme's *field* rule instead and rendered as a grey box glued to a blue button, so the card invited a fix for a bug the theme does not have — which is exactly what happened.

- **A submenu opened by hover can be reached with the mouse in every bar state, not only in the top layout** (issue #19). The bar is one piece of chrome — the top layout at every width, and the sidebar layout collapsed onto a bar once the content column drops below `--fs-content-min` — but three of its rules lived in the top layout's delta: `li.has-sub { position: relative }`, the panel's `left: 0`, and the invisible 10px bridge across the gap between the item and its panel. The base kept the opposite (`position: static`, panel pinned at `left: 16px`), so the collapsed sidebar opened its panel at the bar's left edge while the trigger sat mid-bar. Measured on the router at 760 px: the item at x=253, the panel at x=32, and moving the pointer down towards it leaves the `<li>` with nothing to bridge the diagonal, so the CSS `:hover` closes the panel — not one submenu entry was reachable. A phone never showed it, because `hover: none` disables the hover rule outright; the reporter hit it on a desktop with a narrowed window. The three rules move into the unguarded bar, and `clampDropdown` stops asking which *layout* is active and asks what the stylesheet asks — top layout **or** `data-narrow` — so an item near the right edge is nudged back inside there too (previously the CSS anchored the panel per item while the JS declined to place it). The vertical accordion turns the bridge off with the popup: with the panel static its containing block falls back to the `<li>`, leaving a 10px strip over the *previous* menu item that would eat its clicks. Verified on both releases across sidebar/top × 390–1440 px, and `cssdiff` reports 0 property diffs over 3266 elements on the desktop sidebar.

## [0.11.2] — 2026-07-25

### Fixed

- **An open dropdown's menu is detached from its control by the 6px the design asks for, instead of sitting 1px off it.** The gap was declared and dead. `theme/65-dropdown.css` carried three `!important` on the widget's `ul` margins whose stated adversary — an inline `margin` written by `ui.js` on an open list — does not exist: grepped on both 24.10 and 25.12, `ui.js` touches only `top`/`left`/`right`/`maxHeight`/`bottom` on that element, and only under `'ontouchstart' in window`, which is what the flags in `90-responsive.css` are for. They came in with the widget when `base/80-dropdown.css` was absorbed, from `luci-theme-bootstrap`, which has no `@layer` and needed a flag to beat its own `ul { margin: 0 0 10px 25px }` — here the layer split does that for free. What they were really beating was **this theme's own** popover `margin-top`, from a lower specificity, which is the shape CLAUDE.md forbids: a flag must fight an inline or unlayered declaration, never another footstrap rule. The two `.btn` rules then needed flags purely to escape the first one. All three removed; measured on `docs/gallery.html`, exactly one computed value moves (that gap, 1px → 7px) and nothing else. The sheet's `!important` count drops 29 → 26 and the `css-metrics` ratchet with it.

- **A monospaced value is no longer silently redrawn: `!=` stays `!=`, not `≠`.** The shipped JetBrains Mono subset carried 388 glyphs for 223 mapped characters — 165 of them reachable only through `calt`, the programming-ligature feature, which browsers enable by default. So a config value, an nftables rule or a log line rendered `->` as `→`, `<=` as `≤`, `|>` as `▷` and `<>` as `◇`: in a router UI that is not typography, it is a lie about what the device stores. Dropping the feature also takes that file from 19,368 to 8,488 bytes.

- **A first visit to a page now says it is loading instead of leaving the previous page on screen.** The chrome switches the instant you click — title, URL, `body[data-page]`, the menu highlight — but the sweep deliberately leaves `#view` alone and LuCI's own spinner is painted by `View.__init__`, i.e. only once the view module has arrived. Measured on the router at 600 ms latency: at 150 ms and 400 ms `#view` still held the System page while everything else already said Processes; the "Loading view…" spinner appeared at 900 ms and the content at 1800 ms. A full page load shows the browser's own progress for that whole window; the SPA showed nothing. A cold route now gets the placeholder immediately — the same markup and the same luci-base msgid the view itself uses, so there is no visual jump when it is replaced and the string arrives already translated in the languages this theme ships no catalogue for. Warm routes are untouched: there the spinner is already synchronous and there is no gap to fill.

- **The chrome fence can no longer be walked past by an app selector that happens to name nothing the theme styles.** `judgeSheet()` asked two questions where the fence asks one: first "does this name anything of ours?", and it skipped the part when the answer was no. But what pins a rule inside an app's own markup is a name the theme does **not** know, so "names nothing of ours" was read as "pinned" when it usually means the opposite. Measured on the router, verdict CLEAN and **95 of 338 chrome elements flattened**, by two selectors an app could write by accident: `*:not(#zzz) { padding: 0 !important }` — the `#` sits inside a negation — and `[class] { padding: 0 !important }`, which carries no class or id name at all. `fenceRules()` already keyed on the pin alone and would have neutralised both; it never got the chance, because the judge called the sheet clean and nothing was ever re-hosted. The two now ask the identical question, which the comment above `pinnedToApp()` has claimed "by construction" all along.

- **A selector list is split on its top-level commas, so `:not(a, b)` no longer blinds both the judge and the fence.** `String.split(',')` cut `.cbi-button-save:not(.custom-save-button, .x)` in half; the first half kept a visible app name (the argument-stripping regex needs a closing paren to fire) and therefore read as pinned to the app, so the rule was neither judged nor fenced — `documentPoisoned()` reported the document clean and the SPA carried it onward. The same pass also strips nested pseudo-class arguments properly: `:not(:is(.app))` used to leave `.app` looking like a pin.

- **A `<style>` appended to `<body>` is fenced like any other.** The observer watched `<head>` alone, so an app that appends its sheet to the body after chrome init was seen by nothing — measured with `* { padding: 0 !important }`: 95 of 338 chrome elements flattened and the sheet never marked. `documentPoisoned()` still saw it, so navigation fell back to full loads; the page you were **on** stayed broken, which is the half that matters. Watching `<body>` costs nothing per poll tick — `childList` without `subtree` fires only for direct children, and the poll rewrites inside `#view`.

- **Appearance → Save as default no longer reports success for a write that was refused.** `rpc.declare()` raises on the ubus status code only when the declaration asks it to; without `reject: true` the code comes back as the resolved **value**. So a per-config ACL refusal resolved with `6` (permission denied) and every `.then()` ran: the button greyed itself and read "Saved as default" for a file that was never written, and the user could not retry because it was disabled. Measured with the theme's ACL narrowed and the two wildcard-granting packages on the dev box moved aside so the denial could actually be reached — without the flag: resolved, value 6; with it: rejected. The four declarations (`uci set`/`commit`, `file remove`/`exec`) now carry the flag, and the failure reaches the error line the popover already had: *"Could not save the default. Reload the page and try again."* with the raw ubus error in its tooltip. The login-background upload additionally checks the **command's** exit status, which `file exec` reports inside a successful call — unchecked, a failed `chmod` still committed `wallpaper=file` router-wide for an image uhttpd answers 403 for.

- **The sidebar's width tokens are read back for real, so the layout gives way at the width the current Density actually needs.** A custom property is untyped: its computed value stays a token stream, so `parseFloat('calc(224px * 1)')` is `NaN` and `shellGeometry()` silently fell back to the hardcoded `224/68/28` — the literals the function exists to stop restating. It read correctly until the Density axis wrapped three of the four tokens in `calc(… * var(--fs-density-box))`; `--fs-content-min`, still a bare `500px`, kept working, which is why the failure was one-sided and invisible. The tokens are now resolved by assigning them to a real length on an offscreen probe, and the memo is keyed on the density so a change re-measures. Measured on the router: the sidebar now yields to the bar at ~727 px on Compact, 780 px on Normal and ~814 px on Large, where all three used to fire at 780. The threshold also reads `documentElement.clientWidth` instead of `window.innerWidth`, which counted a classic scrollbar as 15–17 px of room the content never had.

- **A dropdown no longer shows a stale value or a stale option list when a CBI dependency rewrites the native `<select>` underneath it.** `ui.Select.setValue()` writes through the IDL (`options[i].selected`), which produces **no** MutationRecord at all, and a rebuilt option list arrives as `<option>` nodes that the observer's gate did not recognise — so `resync()` never ran. Reproduced: `s.value = 'DROP'` left the widget on REJECT while Save read DROP, and after `replaceChildren()` the widget still offered the old options, so picking one wrote a value the new list does not contain (i.e. empty). The gate now recognises an option-list rebuild, and a cheap value-compare runs on every content batch alongside the table fitter.

- **Clicking a field's caption reaches the dropdown again, and dropdowns inside table sections have an accessible name.** `form.js` wires the caption to `#widget.cbid….click()/focus()` — the native `<select>` this theme sets `display: none` on — so the click did nothing (measured: focus stayed on `<body>`), while stock focuses the control. In a table section there is no `.cbi-value-title` at all, so the widget was left nameless with the select it replaces marked `aria-hidden`; it now takes the column heading from the cell's `data-title`.

- **Notification banners no longer pile up across SPA navigations.** `ui.addNotification()` inserts into `#maincontent`, one level above the `.fs-content` the router sweeps, so "Upload request failed" and every third-party banner outlived each navigation and stacked for the rest of the session — only a full reload cleared them. The server's own notices, which legitimately outlive a page, are untouched.

- **The command palette stopped matching every page on any substring of "admin".** The path haystack included the root segment, which is `admin` on all ~200 nodes, so `min`, `ad` or `dmi` scored a hit everywhere and the result list was filled to its cap sorted only by depth. Now every hit is one the title or the trail really contains.

- **The Appearance popover no longer has two rows labelled "Density".** The tint-strength slider shared the string with the UI-density segment, including as the control's `aria-label`, so a screen reader announced "Density, radio group" and "Density, slider" with nothing to tell them apart — and both are on screen together as soon as a Tint hue is set. It is "Tint strength" now.

- **`build-css.sh` no longer refuses a stylesheet whose CSS contains a brace inside a STRING.** The comment stripper and the whitespace squeeze are both string-aware — the balance guard bolted on after them was not, so it counted braces inside quotes as blocks and killed the build with `unbalanced braces`, naming a file that is perfectly well-formed. Measured, three legitimate shapes hit it: `content: ";}"`, `content: "{"`, and a `url("data:…")` carrying `;}` — and an SVG data-URI with an inline `<style>` carries braces by construction. It fails closed, so nothing was ever mis-built; the cost is an afternoon spent hunting an imbalance that is not there. The counter now walks quotes and escapes exactly as the stripper does; a genuine imbalance is still caught, and the real tree builds byte-identical output.

- **Two Appearance strings ("New version available", "Update now") now carry the theme's `footstrap` message context like every other label in that popover.** A msgid is a global name shared with every `luci-app` on the router — `load_catalog()` merges every `*.<lang>.lmo` in one directory and the first archive holding the hash wins, so readdir order decides who owns a string. That is how the layout toggle once rendered "Максимум" for `Top`. These two were the only popover labels left keyed on a bare msgid, i.e. on whatever a stranger's catalogue happens to mean by "Update now". Their Russian translations carry over unchanged.

- **The chrome fence actually holds against an app stylesheet that arrives at runtime — it had been defeated by one line.** `rehostIntoThemeLayer()` takes an invasive `<link>` out of the cascade with `el.disabled = true` and re-imports it into `@layer theme` in fenced form. That assignment forwards to the element's own flag; what decides whether the CSS paints is `el.sheet.disabled` — and a `<link>` that is still LOADING has no `.sheet` at all. Every runtime injection is in exactly that state when `<head>`'s observer hands it over, which is the case this module exists for: `luci-app-banip` and `luci-app-adblock` append their `<link>` at module eval. So the sheet came up **enabled** when the bytes landed and the app's original, unfenced CSS went on painting beside the fenced copy. Measured on the router with `* { padding: 0 !important }` behind a runtime `<link>`: `el.disabled` read back `true`, `el.sheet.disabled` was `false`, and **95 of the 338 chrome elements were flattened** — the sidebar's own padding went `0px 88px` → `0px` — while the fenced shim sat there matching nothing. Now 0 on all three dev containers, with the app's CSS still reaching the content area exactly as before (the documented Zone 2 trade is unchanged: a content `input` still goes `8px 12px` → `0px`). The "openclash: 47 damaged → 0" measurement in the docs was never wrong, but it only ever covered the other half of the problem — that sheet is server-rendered, so it has already loaded by the time the immediate pass sees it.

- **A third-party app that ships a plain CSS file no longer disables the SPA on its page.** `documentPoisoned()` sends every navigation through a full page load once any sheet outside `#view` is judged invasive, and that verdict is deliberately sticky. But `judgeSheet()` calls an unreadable sheet invasive by default — and a `<link>` is unreadable until its bytes land, which is always true at the moment `<head>`'s observer first sees it. Remembering that verdict turned a benign stylesheet into a permanently spent document: `luci-app-mwan3` ships **one rule**, `#mwan3-service-status > .alert-message { … }`, pinned to the app's own id and judged clean by this module's own logic — and its `<link>` on the Overview meant every navigation from the router's landing page was a full load. Proven by serving the same bytes twice: as a `<style>` the document stayed clean, as a `<link>` it went poisoned; nothing about the CSS decided it, only how it arrived. The verdict is now cached only when the sheet could actually be read. Still conservative while unreadable, and a genuinely hostile `<link>` still poisons the document — both re-checked on the router.

- **DHCP lease tables keep the IPv4 and the MAC on one line again on 24.10, where the whole rule set had been dead.** `pages/50-leases.css` keys those tables by class, and on 24.10 `40_dhcp.js` tags the IPv4 one `class="table lases"` — upstream's typo, fixed to `leases` in 25.12. Measured on the 24.10 container with the theme active: all five cells computed `white-space: normal`, so an address or a MAC split across two lines at whatever character reached the edge. That is issue #7's exact symptom, still shipping on one of the two supported releases, with nothing anywhere reporting it. The nowrap now matches both spellings.

- **A router that serves DHCP through odhcpd no longer gets its MAC column wrapped.** The same file named its wrappable columns with `:nth-child()`, counting from the left — but on 25.12+ the LEFTMOST column is optional: `40_dhcp.js` opens both lease tables with `L.hasSystemFeature('odhcpd','dhcpv4') ? E('th', …, _('Interface')) : E([])`. Reproduced by inserting that column into the live table: the MAC cell went straight from `nowrap` to `normal`, i.e. issue #7 comes back on exactly the routers that run odhcpd and stays invisible on the ones that do not. The trailing columns are identical either way, so the rules count from the END now, and `:nth-last-child()` cannot shift. The two releases' column maps are both written out above the rule; the v6 table, which carries the same class on both, is split on column count.

- **The "Disk space:" caption on the software page is styled on 24.10 too.** It was keyed on `#disk-space-label`, an id 25.12+ added — 24.10's package-manager emits a bare `<label>`, so the caption kept base's 250px-wide label instead of the meter line this file draws. The same trap is called out in a comment at the top of that very file and again in `theme/90-responsive.css`; the rule the comments are about still had it. It now keys on what the caption sits beside (`label:has(+ .cbi-progressbar)`, the discriminator `90-responsive.css` already used), which needs no id on either release.

- **`deadsel.py` — a new audit tool for the bug class all three of those belong to.** A selector that names foreign markup and quietly stops matching fails nothing: it stays in the sheet, passes stylelint, gets counted by `css-metrics`, and styles no element on somebody else's router. The tool loads fifteen pages on a live box and counts matches for every selector in the theme's sheet. The single-host count is a lead list, not a delete list — around 720 of ~1260 selectors match nothing there, and nearly all of that is the coverage contract working as intended. The signal is `--vs`: run two containers with layout and mode pinned, and a selector alive on one release and dead on the other is markup the theme thinks it knows, with one of the two readings wrong. Both lease bugs and the disk-space one came out of a single such run.

- **`cssdiff.py` can see SVG paint, and now states the one question it must not be asked.** Its property list had no `stroke`, so the flag that keeps the realtime graphs' gridlines off `stroke:black` on a dark panel was invisible to it: stripping that `!important` reported "0 property diffs" on both realtime pages, where the honest reading is 7 lines turning black. Worse, the tool cannot judge a flag that fights **unlayered app CSS** at all, and fails silently at it — the `<link>` swap mutates `<head>`, `fs-sheets.js` observes `<head>`, and the app's own `<style>` gets re-hosted into `@layer theme` before the second snapshot, so the cascade under test is not the one that ships. Measured on the package manager, whose view injects an unlayered `.controls{display:flex}`: dropping the two flags that beat it reported 0 diffs, while dropping the same declaration's importance through the CSSOM on an untouched page moves `.controls` from `block` to `flex`. Both are documented in the file; for that class of question, edit the source and deploy.

### Performance

- **The shipped stylesheet is 14.6 KB smaller: the private token names are mangled at package time.** `--fs-*` identifiers were **16.1% of the whole sheet** — 21,640 bytes over 1,770 occurrences of 123 distinct names — and they mean nothing to a browser. This is the trade terser already makes for the JS, where top-level identifiers are mangled because a LuCI resource file is function-scoped. Only the PRIVATE tier moves: the outbound `--*-color-*` export tier is a different prefix and is untouched, and no consumer of `--fs-*` exists outside the theme (checked on the router: no installed `luci-app`, and zero references in the updater's own `fs-update.js`). The reserved set is **derived** from the theme's JS and templates rather than listed — 15 of 123 names cross that seam — so a new one cannot be forgotten. Verified with `cssdiff` on both releases: **0 property differences over 6,774 elements across seven pages**, and every seam-crossing axis re-exercised against the mangled sheet (rounding paints 2px→16px, tint switches the page to `oklch(… 120)` and back, the Density thresholds still fire at 727/780/814 px). Mangling runs in `Build/Prepare` only, so `dev-sync.sh`, `galdiff`, the a11y gate and `docs/gallery.html` keep readable names.

- **Shell comments no longer ship either: 4.7 KB of 6.4.** `root/etc/uci-defaults/30_luci-theme-footstrap` is 71% comment lines and `root/lib/upgrade/keep.d/…` is 95% (six lines of reasoning above a single path). Whole-line `#` only, never the shebang and never a trailing comment after code; the script refuses outright if a heredoc ever appears under `root/`, because a `#` line inside one is data. The stripped registration script was run for real on a container: exit 0, one theme entry, active theme untouched.

- **The theme's fonts are 12 KB smaller, and a Latin UI now fetches 34 KB instead of 46 KB.** Nine woff2 faces re-subset to the OpenType features this UI actually uses. Verified pixel by pixel, not by width — a ligature substitution in a monospace face is width-preserving, so a width check reports "identical" while the glyphs differ. The UI face renders byte-identically on plain Latin, on `fi`/`fl` ligature words, on fractions and on Cyrillic; the only rendering change anywhere is the mono ligatures above. `tools/subset-fonts.py` reproduces the files and records what must never be dropped — the GPOS features in particular: an earlier attempt dropped `kern` along with the rest and silently re-spaced every menu label and every Cyrillic string.

- **Template comments no longer ship to the router: 16 KB of 39.** The `.ut` files are 58% comments, and this project already strips them from the JS (jsmin/terser) and the CSS (`build-css.sh`) on the same argument — a comment costs the reader, not the user, and git keeps every word. Templates were simply never included in that trade. `strip-templates.sh` runs from `Build/Prepare` over the build tree only, so the source keeps its comments and so does `dev-sync.sh`: a router you are debugging on is not the place to save bytes. Only `{# … #}` goes — the ucode-code `/* … */` stays, because stripping it needs a lexer that knows ucode strings, and 17 of the `/*` in this tree sit outside any code block. Whitespace control is emulated rather than ignored (`-#}` still swallows the newline before `<!DOCTYPE html>`), every stripped template is compile-checked with `ucode -T -c`, and the rendered pages were compared byte for byte.

## [0.11.1] — 2026-07-25

### Added

- **A third dev container running ImmortalWrt 25.12, because a fork's LuCI is not upstream's.** Both port-tile bugs below came from view JS this project cannot read in `openwrt/luci`, and neither OpenWrt container can render them — issue #15 took two releases and two rounds of console dumps from the reporter for exactly that reason. No docker image is published for the fork, so the rootfs tarball is unpacked onto `scratch` by a build stage the two OpenWrt services never reach; everything after the base (app list, third-party packages, fixtures) stays one shared copy. The dev boxes also grew three fake switch ports (veth `eth1`–`eth3`), since x86 has exactly one and a single tile exercises none of what that card is — not its grid tracks, its wrap, nor its linked/unlinked variants.

### Fixed

- **Overview port tiles on ImmortalWrt no longer collapse to a sliver with their text spilling out.** 0.10.2 released the fork's inline `width:100px` so the tile could fill its 200px track — but the same fork also writes `align-items:center;justify-items:center` on the grid that holds the tiles, which makes a `width: auto` item size itself `fit-content` instead of stretching. The card is `container-type: inline-size`, i.e. size-contained, so its max-content contribution is **zero**: the tile drew nothing but its own padding (~17px) while the port name, speed and traffic rows overflowed to the right of it — worse than the half-width tile the release set out to fix. The tile now states `justify-self`/`align-self` itself, which needs no `!important` (the fork's declarations are `*-items` on the parent, and those only apply when the item says `auto`) and is a no-op on stock, where both are already `stretch`.

- **A long IPv6 address in the Overview's upstream box now wraps instead of printing outside the box.** `.ifacebox` is `white-space: nowrap` — right for the port tiles, whose bodies are one-word labels, wrong for the upstream plate, whose lines are addresses. An uncompressed IPv6 (`Address: 2001:db8:1a2b:3c4d:5e6f:7a8b:9c0d:1e2f/64`) is ~380px of text with no space to break at, and the plate is a flex item that shrinks: measured at a 390px viewport, the box ended at x=348 and the address ran to x=393 — 45px of text over the card behind it. `white-space: normal` alone is the half-fix that does nothing here (an address has nothing to wrap AT); `overflow-wrap: anywhere` is what allows the break, and `anywhere` rather than `break-word` because only it lowers the box's min-content size, so flexbox shrinks the item to the line instead of handing it a width its content overflows. The Interfaces page had this fixed for its own copy of the plate years ago; the status one never did. `docs/gallery.html` now renders both upstream boxes with a full-length address, so the case has a home that needs no router.

- **The release mirror carries `install.sh` and its signature too.** Found by cutting `github.com` off a dev router and running the documented mirror one-liner: the mirror had the manifest and both packages, but not the installer — so a user in exactly the situation the mirror exists for had a verified way to install and no way to obtain the thing that installs. The signature rides along, so the script can be checked before it runs as root.

### Security

- **Two high-severity advisories in the dev toolchain are closed (`postcss`, `brace-expansion`).** Nothing shipped was affected — `luci.mk` copies only `htdocs/` and `ucode/`, and the npm tree exists for the CI gates — but a lint toolchain that parses this repo's own CSS should not be the thing carrying a path-traversal advisory. `npm audit fix` moved postcss to 8.5.23 and brace-expansion to 5.0.8; both are transitive, so `package.json` is untouched and only the lockfile changed.

## [0.11.0] — 2026-07-25

### Added

- **The installer now says what to do when github.com is unreachable, instead of failing with a shrug.** The resolve-failure message prints a ready-to-paste `GITHUB_PROXY=…` line and three alternates, and the README carries a verify-then-run recipe with the release key typed out, so a user who fetches the installer through a proxy can check its signature before running it as root. Proxies were tested rather than collected: four of ten known public ones were alive and served byte-correct assets.

- **An optional `GITHUB_PROXY` for networks where GitHub is unreachable at all.** Empty by default — `GITHUB_PROXY=https://your-proxy/ sh install.sh` puts the prefix in front of github URLs only, tries it first and falls back to the direct route, so a dead proxy cannot take the install with it. Safe to offer because every byte it can deliver is checked against the signed manifest; deliberately **not** a default, because a proxy can rewrite whatever no signature covers — and the one thing not covered is `install.sh` itself, which a one-liner pipes into `sh` as root. The self-updater reads it from UCI (`footstrap.settings.github_proxy`) and never from the environment: rpcd hands that process the caller's environment, so an env-sourced proxy would let anyone holding the update ACL redirect a root download.

- **A signed release manifest, so installing and updating no longer touch `api.github.com`.** Every release now publishes `manifest.txt` plus `manifest.txt.sig`, carrying the tag, and each package's name, size and sha256 — fetched from `releases/latest/download/`, which is the release CDN and not the REST API. The API allows **60 unauthenticated requests per hour per source IP**; behind CGNAT, a shared exit or a DNS-based unblocker that budget belongs to strangers, and the installer died with `Could not reach the GitHub release API` — a message that sent people installing `ca-bundle` three times over (issue #17). Measured while writing this: `api.github.com` answered `x-ratelimit-limit: 60` with 39 left on an ordinary home connection, while `releases/latest/download/…` answered a 302 with no `x-ratelimit-*` header at all. Verified end to end on both dev containers: `uclient-fetch` follows the two redirects and the bytes match the digest the API publishes.

- **A release mirror on GitHub Pages, carrying the manifest AND the packages.** A second host for routers that cannot reach `github.com` at all. Mirroring only the metadata would have been theatre — a release asset URL redirects *through* `github.com`, so a router that cannot reach it cannot fetch the package either. It needs no trust: the manifest is signed and carries every package's sha256, so mirrored bytes are held to exactly the same hash as bytes from GitHub. The installer falls back to it automatically and says so.

- **A router already stuck behind the rate limit has to be rescued once, by hand.** The self-updater installed on it is the old one, it asks `api.github.com`, and the request that would fetch its replacement is the one that fails — so the fix cannot arrive through the mechanism it fixes. Re-run the installer over SSH once (`wget -qO- https://github.com/VizzleTF/luci-theme-footstrap/releases/latest/download/install.sh | sh`); from then on nothing on that router touches the API again.

- **`install.sh` ships as a release asset, and the README points at it.** The documented one-liner fetched the installer from `raw.githubusercontent.com` — which GitHub's 2025-05-08 changelog names as one of the three things it rate-limits for unauthenticated callers, alongside HTTPS clone and the REST API. So the very user whose IP had run out of budget could fail to download the installer meant to rescue them. Release assets have no such budget. The raw URL still works and stays documented as the fallback.

### Changed

- **The overview grid is a theme module now, not a `luci-mod-status` include, so routers on OTHER themes stop loading it.** `05_footstrap_overview_layout.js` lived in LuCI's global include directory, where every `*.js` is loaded on the overview whatever theme is active — measured with a headless browser against the dev container running stock `bootstrap`: our file was requested right beside `10_system.js`, downloaded and evaluated, and only then silenced by its own `L.env.media` gate. A theme package reaching into another module's namespace is exactly what this theme refuses to do to third-party apps. It is `fs-overview.js`, wired by the chrome; re-measured after the move, a foreign theme does not request it at all. Found via a fork ([yanjinbin](https://github.com/yanjinbin/luci-theme-footstrap)), which spotted it independently.

- **The sha256 that gates an install is now one we signed, not one GitHub computed.** It used to come from `@.assets[*].digest`, which GitHub derives from whatever bytes were uploaded: anyone able to replace a release asset — a leaked write-scoped PAT, no CI run involved — had the digest recomputed for them, and the check then verified the attacker's package. That is why the ed25519 signature existed alongside it. The hash now lives inside the signed manifest, so one `usign` verification covers every package it lists, and the per-package `.sig` is no longer fetched on the manifest path. Those `.sig` assets are still published: a self-updater already in the field fetches them, and a router's installed updater cannot be fixed remotely.

- **The free-space preflight and the release notes are covered by the signature too.** The preflight sized a root install against `@.assets[*].size`, an unsigned number; the confirm dialog showed `@.body`, text nothing had ever checked. Both now come from the manifest — the notes as a `notes.md` asset whose sha256 the manifest carries.

- **Releases are published as a draft and flipped once every asset is uploaded.** `latest` moves to a release the moment it is published, and the release action created the release first and uploaded assets after — so a router polling in that window resolved `releases/latest/download/manifest.txt` against a release that had none. The same window existed for the `.apk` assets before the manifest; nothing had ever closed it. CI then proves the manifest resolves through the URL a router actually uses, and matches the one just built.

- **`jsonfilter` is no longer required to install the current release.** The manifest is line-oriented and parses with `awk`, which busybox has. It stays required only on the API fallback path — a pinned pre-manifest tag such as `sh -s v0.9.3`.

### Fixed

- **A downgrade offered by a replayed manifest is now refused.** A signed manifest stays valid for ever, so an old one served by a stale mirror or a cache would have reinstalled an older theme over a newer one, verifying perfectly the whole way — the signature is genuine and the hash matches, so nothing else in the chain says no. Equal versions still install, because that is the Update button's deliberate reinstall.

- **A manifest naming a different repository is refused.** One key signs both repos' manifests, so without that check a manifest lifted from the updater's release would verify perfectly as the theme's. A signature proves who wrote a file, never what the file is about.

## [0.10.2] — 2026-07-24

### Changed

- **The README now opens on the theme itself instead of on an upgrade warning, and every claim in it is shown before it is explained.** The page led with a red *IMPORTANT* callout about a one-time 0.9.3 step, then three paragraphs of prose, and the only proof was a 2.2 MB GIF; the `--allow-untrusted` explanation — six lines of threat model — sat in the middle of the install instructions where a first-time reader has no use for it. The order is now hero → what it looks like → what it does → the benchmark → install, with the signature rationale folded into a `<details>`. Reading order is the change; the words are largely the ones that were already there.

- **The README's screenshots are real, reproducible and no longer show a development container.** `tools/readme-shots.py` drives the dev router and shoots the three proof images (side menu, top bar, phone popup) plus the Appearance popover as an element shot, all in dark with the cats wallpaper. The dev box is a WSL container, so its overview advertised an i5-14600KF, 15.5 GiB of RAM, a 1 TB disk, a `C:\` mount and a 10 GbE port — none of which any router has. The script stops LuCI's poll (which would otherwise overwrite the values a second later, and which flips the indicator to "Paused" — restored, so the frame does not lie about the state) and substitutes what a real OpenWrt router reports: model, arch, kernel, 484 MiB of RAM, an 84 MiB overlay, four ports. The Appearance shot is the live popover rather than a drawing of one, so it cannot describe an axis set the theme no longer has — the hand-drawn version was already missing Density, uploaded wallpapers and the update controls. Light and dark copies are swapped by `<picture media>`, so it follows the reader's GitHub theme.

### Fixed

- **An option's description is no longer cut mid-word in an open dropdown, and the wider the screen the worse it used to be.** 0.10.1 taught the row to wrap, but the thing that overflowed was a child of it: `form.js`'s RichListValue writes its description block with an inline `min-width: 25vw`, which assumes the list grows to fit — true on a theme that leaves `ul.dropdown` unbounded, false here, where it is capped at `min(92vw, 420px)`. Being a viewport fraction, the floor scales with the monitor: measured on a live router at 2559 px, 25vw is 640 px inside a 406 px row, so the row's own `overflow: hidden` cut "…for routing with/withou" and swallowed the whole "Requires hardware NAT support" sentence. At 1280 px the same option fits, which is why it never reproduced on a laptop. Releasing the inline floor lets the text wrap inside the row it was given (Network → Firewall, "Hardware flow offloading"; issue #15).

- **An empty table's "nothing here" row no longer lights up under the pointer.** The row hover was already spared it, but a second rule painted the CELL — `base/95-luci.css` lit every `.cbi-section-table .tr:hover .td`, which no later layer undid. It showed wherever the placeholder carries no `.cbi-section-table-row` class, so the theme's guarded rule never matched: measured on Services → UPnP ("There are no active port maps."), and swept across UPnP, NAT rules, IP sets, static routes, DHCP and the Overview to confirm nothing else still lights. Real rows keep their hover — a cue that promises a row you can act on now appears only on rows you can (issue #15).

- **Port tiles on the Overview fill their track on forks that size them differently.** Stock `29_ports.js` writes `min-width:70px;max-width:100px` on each tile and the theme releases both, but ImmortalWrt 25.12 writes `width:100px` instead — a property nothing was overriding, so the grid handed each tile a 200 px track and the tile drew itself 100 px wide inside it. Reported with a console dump showing `max-width` already at `none` (ours won) next to `width: 100px` (theirs did), on a Redmi AX6000. Naming all three costs nothing on stock, where `width` is `auto` anyway.

## [0.10.1] — 2026-07-24

### Added

- **Appearance gains a Density control — Compact / Normal / Large — beside Theme and Palette.** It is a client preference like every other axis (localStorage, instant, no reload, pre-painted by `head.ut` so a reload never flashes the previous setting, and carried by Save as default to the whole router). What makes it about two dozen lines rather than a rewrite is that every size in the theme now reads a token: the axis multiplies the ladders and the UI follows. **Compact leans on the air, not on the text** — padding, margin and gap go to 65% while type moves only to 90% (a 12 px base, a 10 px eyebrow), because the room is in the padding and spending legibility to save a little more of it is the trade that turns a density control into an accessibility problem. **Large grows the type by 15% and leaves the spacing on the Normal rhythm** — inflating both just pushed content off the screen and made the setting read as "zoom", which is the browser's job. The two are therefore three multipliers, not one: text, pure air, and the boxes that must HOLD text or an icon (the sidebar column, the bar, the square icon buttons — cut those by the air figure and a sidebar with unchanged labels no longer fits them). Changing it re-runs the measured fitters, because Compact makes more fit and Large less, and the bar's stacking and the tables' carding are decisions taken by measurement, not by a breakpoint.

- **`npm run bang-ok` holds the `!important` allowlist to one contract across the two gates that state it.** The set of files allowed to carry a flag lives in `tools/audit.py` (`BANG_OK`) and again in `.stylelintrc.json`; the two run in different runtimes and cannot share an import, so nothing kept them together while CLAUDE.md promised "the same allowlist audit.py uses". Drift fails silently in both directions — audit.py flags a legitimate declaration as stray, or stylelint waves through one audit.py still rejects — so the gate derives each list from its own file and refuses when they disagree (proven against a tampered copy).

### Changed

- **The uppercase microlabel is one idiom again, named once in tokens instead of drifting across a dozen rules.** Table column headers, stacked-card labels, the Appearance group labels, the rail flyout titles, the login field titles and the search section note all draw the same thing — uppercase, tracked, bold, muted — and it had been spelled four ways: letter-spacing `.04`/`.05`/`.06em`, weight 600 vs 700, ink `--fs-dim` vs `--fs-faint`. `--fs-eyebrow-tracking`/`-weight`/`-color` state it once; the alert table's 600 was the odd one out and read lighter than every other header on the page. Size is deliberately left out (10 px chrome label vs 11 px table header are two real tiers), and two lookalikes stay out on purpose: `h6` is a heading, and `.fs-navlabel`'s wider `.1em` separates sections rather than captioning them.

- **Not one font size or padding in the theme is a bare number any more, and the near-duplicate sizes have been merged into a scale you can actually name.** The type scale and the 4 px space grid existed but most rules walked straight past them — 74 hardcoded `font-size` values against 21 tokenised, and 164 spacing declarations carrying px literals against 62. Two things changed. First, the type scale was cut from eight steps to **five** — 11 · 13 · 16 · 20 · 26, roughly 1.25 apart. It had been 10, 11, 12, 13, 14, 16, 20, 26, where four gaps were a single pixel: below the threshold at which anyone reads a size as *different*, so it built no hierarchy and only made related rules look unrelated. The 1 px neighbours were folded together (10→11, 12→13) and the 14 was split by what it was actually doing — chrome and menu items are body text (13), a section title is a title (16). That last move is the one you can see: a heading and the text under it were one pixel apart and are now three. Spacing grew half steps at 2/6/10/14 px instead, because a chip's inset and a nav row's padding land there and no rounding makes them 4/8/12 without changing the control. Second, the strays were snapped onto the ladder, none by more than 2 px: font 15→14, 18 and 21→20; spacing 3/5→4, 7/9→8, 11/13→12, 15→16, 18 and 22→20, 26→24, 30→28. `gap` went the same way — it is spacing, and 54 declarations of it had been left out of the grid entirely — as did the three weights, which had six spellings between them (`700` and `bold` are one weight; so are `400` and `normal`, and 400 has no face at all — it resolves onto the 600, which is why body text is semibold by design). What remains literal is six 1 px nudges, which are the device hairline (the same 1 px every `border` is written with), not a step on a spacing ladder, plus the values that are genuinely semantic rather than rhythmic: `gap: 0`, `opacity: 0/1`, `border-radius: 0` and `50%`, and the `0`/`auto`/`100%` insets. Two radii keep a number on purpose and say why in place (a 16 px checkbox cannot take the 8 px control radius; a chevron drawn out of borders is a glyph, not a surface), while the scrollbar thumb's magic `8px` became `--fs-radius-pill`, which is what it was always trying to be. Verified in two halves: the naming pass alone produced 0 computed-style differences across 5302 elements on the router and 521 in `docs/gallery.html`, so the merges are the only thing that moved anything — and those show up as exactly what was asked for, padding and the widths and heights that follow from it, with no colour, family or border surprises.

- **Memory and Storage on the overview no longer read as mostly empty space — the progressbar rows lost half their padding.** Each row is a label over a 10 px bar, i.e. already two lines tall, so the 8/10 px outer padding was doing a gap's job a second time and a row stood 51 px for 29 px of content; it is 4/6 px and 43 px now, which is about 80 px back on a Storage card with ten mounts. The bottom stays the larger of the two because the bar sits on that edge and equal padding reads as the bar hanging low in its row. Keyed off `:has(.cbi-progressbar)` as before, so a third-party section that draws the same row gets the same treatment.

- **The chrome's icon wrapper, its warning notice and its remembered lists are each written once instead of per call site.** The same 24×24 stroked `<svg>` wrapper was spelled out in four templates and twice in the JS, so `stroke-width` and both linecaps were six free-running copies of a value whose whole job is to make one icon *set* — it is now `partials/icon.ut` server-side and `widgets.svgIcon()` client-side, with each caller supplying only the shape. The three top-of-content notices were three copies of the same markup, including the `dispatcher.lookup` guard that keeps the action button from linking to a page the user's ACLs do not grant; that lives in `partials/notice.ut` now, and `notices.ut` decides only which notices exist. The search palette's recent paths and the menu's open sections both parsed a stored JSON array with the identical five lines, comment included, so `prefs.lsGetArr()` owns the parse and the corruption guard while each keeps the post-step that genuinely differs. Deliberately NOT merged: the Appearance popover and the search palette look like one dialog primitive but share about six lines — the trap (tab-wrap vs a single tabbable), the outside-click strategy (document capture vs the scrim itself) and the repositioning all differ, so one helper would need five knobs for two callers and would hide the focus logic that has already been got wrong once.

- **Rounding and Tint density are one axis shape instead of two copies of it.** Both are a slider that writes an inline custom property and no attribute, validates to a range, stores its choice explicitly and removes the property at the default; they differed only in how the number formats (px vs a 0..2 multiplier). `propAxis()` joins `enumAxis`/`hueAxis` as the third factory, and `tools/axes.mjs` learned to match it — without that the two keys vanish from the gate entirely, since a factory-built axis has no `lsGet('fs-…')` call site to find. Both instances are declared above the module-init call that reads them: a `propAxis` instance is a `const`, and leaving one further down put it in the TDZ at init, which throws and takes the chrome and the menu with it (measured — an empty sidebar is the only symptom, and every static gate stayed green).

- **An uploaded wallpaper is now re-encoded to at most 1920 px on its longest side, down from 2560.** The picked file never reaches the router as-is — the browser redraws it on a canvas and uploads that (quality stays 0.9), so the cap is what decides the bytes written to flash and re-sent on every page load: uhttpd serves `/luci-static` with no compression, and a 2560 px JPEG is roughly 1.8× the pixels of a 1080p one for a backdrop that sits behind a scrim on an admin UI. Nothing else about the flow changes — any `image/*` the browser can decode is still accepted, the 25 MB source guard still refuses a decode bomb before decoding, and the canvas re-encode still strips EXIF and any bytes appended past the image.

### Fixed

- **A button that is working no longer draws its spinner on top of its label (issue #15).** Network → Interfaces → Restart, while "Interface is reconnecting…", printed the spinning glyph over the first letters of the word. The theme reserves room for it by padding the button left, and that rule is `(0,2,0)` — exactly as specific as the row-action rule `.cbi-section-actions .cbi-button`, which is written after it and was therefore winning on source order alone: 12 px of padding where the glyph needs 28. The ladder gained the members that out-specify it, so the outcome no longer depends on which rule comes last in the file.

- **A dropdown option that carries a description now wraps instead of being cut off mid-word (issue #15).** The open list is capped at `min(92vw, 420px)`, and every row inherited the collapsed control's `white-space: nowrap` + `text-overflow: ellipsis` — right for the one-line preview of the current value, wrong for the menu: on Network → Firewall, "Hardware flow offloading — Requires hardware NAT support…" ran off the box with no ellipsis, because the cut fell inside a nested element. Open rows wrap now; the collapsed preview still ellipsizes. Raising the cap instead would let one verbose option set the width of every menu on the page.

- **An empty config table no longer lights up under the pointer as if it had a row to click (issue #15).** LuCI's "This section contains no values yet" row carries the same class as a real one, so the hover cue fired on it — reported on UPnP, but it was every empty GridSection: firewall's NAT rules, IP sets, static routes, and the empty tabs under DNS and DHCP. Data tables had been excluded from their own hover rule for this reason already; config tables now are too.

- **A bar too narrow for its buttons now moves the whole right-hand cluster onto its own row, still right-aligned, instead of dropping Log out alone under the hostname.** The indicators, Search, Appearance and Log out are four siblings, so flexbox wrapped them one at a time: measured at 380 px, three stayed beside the hostname and Log out sat by itself on a second row at the LEFT edge. The cluster now escalates by measurement like the menu does — first the pills collapse to icon squares (~200 px of prose on a bar showing both), and only if that still overflows does the brand take a full row and the cluster move down together, keeping the right edge. That escalation also moved out of the top-layout delta and into the bar itself: it was guarded on `data-layout="top"`, so a phone in the DEFAULT sidebar layout — the common case — got neither step.

- **The "Unsaved Changes" pill no longer spills out of the collapsed icon rail and over the page (issue #14).** LuCI writes an indicator's whole meaning as prose — "Unsaved Changes: 2" — and the rail is 68 px wide: measured on the router, the pill wanted 86 px, wrapped onto three lines and hung 34 px past the rail's edge across the content. It is now a 30 px square like the rail's poll glyph and shows the count alone, which is the only part that changes and the only part readable at that size; the full label stays in the DOM for a screen reader and in the tooltip for the pointer. An indicator whose label carries no number — a third-party app's "Backup pending" — falls back to a neutral dot, because clipping the prose was tried and rendered "up pen": a centred pill gives an ellipsis no start to anchor to.

- **The changed-option rows and the legend swatches in Configuration / Changes are round again, not squares inside rounded frames (issue #14).** A changed option is `<var><ins>uci set …</ins></var>` — the outer plate is rounded, the coloured fill is its child, and `overflow: hidden` never clipped it because the parent holds the child 3 px in (1 px border + 2 px padding), so it does not reach the corner it would be clipped at. Every `uci set` line therefore had a square green block sitting inside rounded corners, and the legend's "Option changed"/"Option removed" swatches were squares inside circles while the two "Section" swatches — which have no child — were already round. The child now takes the parent's radius minus that inset, so the two curves are concentric, and it follows the Rounding axis instead of pinning a number.

- **The Appearance popover scrolls instead of running off the bottom of a short screen — its Save as default / Reset / version / Update row was unreachable.** The popover carries eight axes plus the wallpaper sub-panel and the footer, and `placePopover()` can only MOVE it: with nowhere left to move, the clamp pins it to the top gap and everything past the viewport height is simply gone. Measured on the dev routers, it needs 918 px in the sidebar layout and 639 px in the top layout — so the foot was already unreachable on a 900 px desktop with Wallpaper=File, not merely on a phone. It is now capped to the viewport minus the same `EDGE_GAP` the placement keeps on both edges and scrolls inside itself (`dvh`, so a phone's collapsing URL bar does not hide the last row; `overscroll-behavior: contain`, so scrolling past its end does not drag the page underneath). The cap applies before `placePopover` reads `offsetHeight`, so the existing clamp then always lands the whole popover on screen.

### Security

- **`build-apk.sh` now verifies the OpenWrt SDK by ed25519 signature instead of by the checksum served beside it.** The SDK is the least verified input in this project and the only one that ends up INSIDE the package a maintainer may hand to someone, and this script checked it against `sha256sums` from the same host, the same directory, unsigned — the exact shape this project rejects for GitHub's asset digest: whoever can replace the tarball replaces the checksum next to it, and the check then verifies the attacker's SDK. Its own comment claimed parity with the release workflow, which had verified the signature since the SDK hardening; the two had silently drifted apart in strictness. It now runs the same contour as CI — `sha256sums.sig` checked with OpenWrt's branch key, fetched from a different host (github.com/openwrt/keyring) at the pinned commit — and the checksum is read only from the file it just authenticated. The branch key is read out of `.github/workflows/build.yml`'s matrix, its documented home, so hardening this path added no second copy of key material to drift.

## [0.10.0] — 2026-07-24

### Added

- **An admin can set a background image for the login page and every page — Appearance → Wallpaper gains a third mode, File, beside Off and Cats — the headline feature the popular themes are known for.** The picture is uploaded once and stored router-side, so a router-wide default (Save as default with Wallpaper=File) is shared by every device and shows before login — what `luci-theme-argon` is famous for, without a companion config app. The wallpaper choice writes straight to `/etc/config/footstrap` as it changes — like the image itself — so a fresh browser and the pre-login page match without a manual Save, and the router-identity Tint gains a Density control beside its hue. It adds NO package dependency: the upload rides `cgi-io`'s `cgi-upload` and the cache-bust token is written through `rpcd-mod-file`, both already hard dependencies of `luci-base` on 24.10 and 25.12. The browser re-encodes the picked file to a bounded JPEG on a canvas before upload (longest side ≤ 2560 px, quality 0.9) — which caps flash/wire bytes for an all-pages backdrop and, as a security property, strips EXIF and any bytes appended past the image so only decoded pixels reach the router. The image is a served FILE referenced by CSS `url()`, never inlined in the page (uhttpd sends no gzip); only its md5 token rides in uci → `window.__fsSD`. A mode-aware scrim (`--fs-photo-scrim`, derived from `--fs-bg` so it follows palette/dark/tint) is painted over the photo so on-canvas text stays legible on an arbitrary image, and it turns fully opaque under `prefers-reduced-transparency`. Stored at a fixed `/etc/footstrap/login-bg` so it survives a package upgrade (it is not a package file) and, via `lib/upgrade/keep.d`, a sysupgrade; the rpcd ACL grants write/remove on that one exact path, and the path is a server-side constant so nothing user-controlled ever reaches a filesystem path.

### Fixed

- **Third-party pages that pack several label/field pairs into one `.cbi-value` no longer overflow the card — the fields stack instead of running off the right edge.** `luci-app-3ginfo-lite`'s "SIM card menu" modal renders three `title`+`field` pairs inside a single `.cbi-value`, a widget designed for one; footstrap's flex row then laid them side by side until the inputs spilled past the modal (stock bootstrap keeps each on its own line — measured: the value box scrolled to 708 px inside a 532 px modal). A `:has(.cbi-value-field ~ .cbi-value-field)` rule gives each title and field its own full-width row in that abnormal case only; a normal single-field `.cbi-value` — every real form on the router — keeps its label-beside-field layout untouched (verified on System → System: title still `flex-basis: 180px`, on the field's row).

- **A router without the optional updater no longer logs a 404 for `fs-update.js` in the browser console.** `fs-appearance.js` loads the updater module at runtime to light up the Updates controls, and on a router that never installed `luci-app-footstrap-updater` that `L.require` was a guaranteed 404 — the module loader XHRs the file only to learn it is absent. The server already knows: `head.ut` now globs the file on disk and emits `window.__fsUpd`, and the popover requires the module only when it is really there. No updater → no request, no error; present → loads and 200s exactly as before. The `() => null` reject arm stays as belt-and-braces.

## [0.9.7] — 2026-07-23

### Removed

- **The self-update package moved out of this repository into its own — [VizzleTF/luci-app-footstrap-updater](https://github.com/VizzleTF/luci-app-footstrap-updater) — with independent tags, version and release stream.** This repo now builds and signs the theme alone (one asset per format, two signatures); the updater's build, rpcd ACL, i18n, jsmin and asset-count steps are gone from CI, and `install.sh` is the two-repo installer — theme from here, updater from its own latest release, both verified against the one release key. The transition builds (up to 0.9.6) re-shipped the updater from here so no fielded router was stranded — a self-updater looks for the updater asset in this repo's release and nowhere else, and a router's installed updater cannot be fixed remotely. The updater repo's first tag is **v1.0.0**, strictly above the transition build's 0.9.6: opkg refuses a downgrade by default (exits 0, installs nothing), so a lower tag would have stranded every 24.10 router while reporting success. From that first published release the updater resolves from its own repo, so it is the day every router crosses over — the theme release stops carrying an updater asset, and a fielded self-updater's now-empty updater leg is skipped non-fatally.

### Fixed

- **The Port status WAN/LAN indicator is back — the Internet port shows a red line and the LAN ports green, as on stock Bootstrap (issue #13).** LuCI's `29_ports.js` emits a thin zone-colour bar per port (child 3 of the `.ifacebox`, coloured inline by `firewall.getZoneColorStyle()` — the very call Bootstrap draws it with), and Footstrap's port-card reskin had hidden it with `display:none !important`, so a Footstrap user could not tell the WAN port from the LAN ports. It now shows, reordered to sit between the port name and the speed as the card's divider; the two grey `.ifacebox-head` borders base draws there are dropped so the colour line is the only separator. No new `!important` (the hiding flag was removed); the bar's hover tooltip still names the port's zone and networks.

- **A stray "Save" button no longer floats above the page title on every legacy Lua page (issue #12, seen on luci-app-openvpn).** luci-compat opens each CBI form with `<input type="submit" value="Save" class="hidden">` — the control that makes Enter submit the form, and one that must never be seen. The theme's `.hidden { display: none }` lost the cascade to its own button rule: an attribute selector counts as a class, so `input[type="submit"]` (0,1,1) out-specified a bare `.hidden` (0,1,0) inside the same layer and put the box back on the page, at full button size, above the view's own `<h2>`. Every luci-compat view carried it, not just OpenVPN. `.hidden` now states the invariant once at 0,2,0 (`.hidden.hidden`), which also retires the enumerated `.cbi-value.hidden`/`.cbi-section.hidden`/`tr.hidden` list that had only ever covered the elements someone had already been bitten by — an `!important` would have worked too and would have inverted the layer order for every future override.

- **The table filter row's placeholders no longer get sliced mid-letter, and its flag column no longer shows a single clipped digit.** LuCI's optional filter row (`luci.main.tablefilters`) writes `Filter ` + the column title into a field that sits in a table HEADER cell — the one place a field is sized by the data under it rather than by what it holds — so on a Russian firewall page "Фильтр Внутризональная пересылка" ran out of box with a letter cut through. The flag column was worse: form.js sizes it `width: 30px` inline for its one-character filter, and the theme's 11px of side padding ate 22 of those 30, leaving six pixels for "0/1". The filter field is now its own denser box (6px padding, 11px type) and ellipsizes: the long placeholders fit, "0/1" is legible, and what still does not fit ENDS instead of being sliced — the column title repeats it directly above. Upstream's inline 30px is left standing; it is the right size for a one-character field.

- **A section title with no collapse control (e.g. "System Properties" on System → System) no longer sits flush against the content below it.** The collapsible-section title (`.cbi-title`) already carried a 12px gap under it, but a bare `<h3>`/`<legend>` section title was reset to `margin: 0`, so the "System Properties" heading touched the tab strip directly beneath. Gave the bare title the same 12px, excluding the `.cbi-title` inner `h3` so the wrapper's own bottom margin is not doubled.

- **The realtime graph legend (Status → Realtime Graphs) no longer overlaps its own labels on a phone.** LuCI renders the UDP/TCP/Other legend as a six-cell-per-row table with an inline `table-layout:fixed`, splitting the row into six equal columns; at 375px each is ~52px and the `Average:`/`Peak:` labels overflowed onto the value beside them (measured). Stock luci-theme-bootstrap folds the six cells into label/value pairs on a narrow screen, so we do the same below 768px (each cell 50%, three stacked rows) — the labels fit on all four graphs (bandwidth, connections, wireless, load), on both 24.10 and 25.12. Keyed on the inline `table-layout` attribute, the one no-id `.table` LuCI marks that way, so System/Memory and DDNS-style status tables are untouched.

### Security

- **Pinned the dev-only transitive `fast-uri` to ≥ 3.1.4 (CVE-2026-16221, high).** Versions ≤ 3.1.3 do not treat a literal backslash as an authority delimiter, so `fast-uri` and Node's WHATWG `URL`/`fetch()` extract different hosts from the same string — a host-confusion desync that bypasses allowlist/SSRF filters. It reaches this repo only as `eslint → table → ajv → fast-uri` in `devDependencies`; nothing under `node_modules` ships to a router, so no fielded install was ever exposed. Resolved with a `package.json` `overrides` entry (`npm audit`: 0 vulnerabilities) rather than a fake direct dependency, since the theme imports no JS at all.

## [0.9.6] — 2026-07-22

### Fixed

- **Updating the theme on 24.10 (opkg) no longer flips the active theme back to stock bootstrap.**
  opkg runs the OLD package's `postrm` with arg `upgrade` during a version upgrade (verified on the
  router: `prerm upgrade` → `postrm upgrade` → the new `postinst configure`), and the theme's postrm
  ignored the arg — so every update ran its full REMOVAL path: it reverted `luci.main.mediaurlbase`
  from `/luci-static/footstrap` to `/luci-static/bootstrap`, deleted the `luci.themes` registration
  and wiped the `/usr/share/luci-theme-footstrap/.installed` marker. That also defeated the
  uci-defaults upgrade guard — with the marker gone the follow-up `postinst` treated the run as a
  *fresh* install, but postrm had already set mediaurlbase to bootstrap and no "fresh" branch
  re-activates a theme that is no longer the active one, so the router stuck on bootstrap and the user
  had to switch back by hand. apk (25.12+) was never affected: on an upgrade it runs the new package's
  `post-upgrade`, never the old `post-deinstall` — which is why only 24.10 saw it. Fixed by returning
  from postrm early on any `*upgrade*` arg, so it changes nothing on an upgrade and still cleans up
  fully on a real removal. Verified with a throwaway opkg package: `postrm upgrade` now skips, `postrm
  remove` still runs the body. Transition note: opkg runs the *old* version's postrm, so the upgrade
  INTO the first release carrying this guard still reverts once — 24.10 users switch back to Footstrap
  one last time, and every update after this one is clean.
- **"Save as default" no longer fails with "Access denied" on sessions without wildcard ubus access
  (24.10 admin logins).** The theme's rpcd ACL granted the `uci` *data* scope
  (`write.uci: [footstrap]`) but never the `ubus` *method* scope, so calling the `uci` object over
  `/ubus` fell back to stock `luci-base` — which grants `ubus.uci: [add, apply, confirm, delete,
  order, rename, set]` but **not `commit`** (LuCI's own UI saves through the set→apply→confirm
  rollback flow, never a raw commit). `saveAsDefault()` does `uci set` then `uci commit`: the set
  passed, the commit returned `-32002 Access denied`, and the popover showed "Could not save the
  default. Reload the page and try again." — permanently, since a reload cannot grant a missing ACL.
  It worked only where the session carried a literal `*` (a fresh root login on the dev boxes), which
  masked it for months. Reproduced on a user's 24.10.3 router: a modelled standard-admin session got
  `uci/commit … Access denied` while `uci/set` passed. Fixed by granting `write.ubus.uci:
  [set, commit]` in the theme's ACL; the `write.uci: [footstrap]` config scope still restricts every
  write to `/etc/config/footstrap`, so no other config becomes writable. Verified on 24.10 and 25.12:
  the modelled session now commits and the file is written.
- **The Search button no longer drifts to mid-bar in the top layout when the menu stacks onto a
  second row.** In `data-layout="top"` with `.fs-bar-stack`, the right-cluster rule gave
  `margin-left: auto` to *both* `.fs-themerow` buttons (Search, then Appearance); whenever
  `#indicators` was empty and collapsed (`display: none`) — e.g. right after an SPA navigation,
  before the poll pill returns — flexbox split the free space between the two autos and parked Search
  in the middle of the bar (measured: `margin-left: 103px`, button at 54% of a 540px bar). The base
  bar (`20-shell.css`) already guards this with `.fs-themerow ~ .fs-themerow { margin-left: 0 }`, but
  the stacked-top auto rule out-specifies it (0,4,0 > 0,2,0), so the guard had to be restated inside
  the `.fs-bar-stack` block. Verified on both 25.12 and 24.10: Search now takes the whole free margin
  and the cluster sits flush right.
- **Firefox no longer paints a second, whole-page scrollbar on the Overview page in the sidebar
  layout (#12).** The desktop sidebar pins `.fs-shell` to `100dvh` with `overflow: hidden` and scrolls
  the content inside `.fs-main` — Chrome keeps the document at viewport height, but Firefox propagated
  ~158px of an out-of-flow descendant's scrollable overflow past both overflow ancestors up to the
  document and drew a duplicate page scrollbar beside `.fs-main`'s own (measured in Firefox 151/152:
  `html.scrollHeight` 1058 vs 900 viewport on Overview, where the `.fs-ovl` grid makes the column
  ~2800px tall; a short page like System stayed 900, which is why only Overview showed it — and stock
  luci-theme-bootstrap, with no fixed-shell/inner-scroll model, never did). `overflow: hidden` on the
  shell or the root only hides the extra scrollbar while the document still scrolls the 158px, dragging
  the fixed sidebar off-screen; `contain: paint` on `.fs-main` makes it the containing block for that
  descendant and captures the overflow, so `html.scrollHeight` drops to 900 and the leak is gone at the
  source. LuCI modals are `position: fixed` on `<body>`, not inside `.fs-main`, so the new containing
  block does not re-base them. Verified in Firefox and Chrome on both 25.12 and 24.10.

### Security

- **Closed four CodeQL findings in the developer-portal build tooling (not the shipped theme).** The
  devkit's DOM→`E()` codegen (`docs/devkit.src.html`) escaped `'` for a JS string literal but not the
  backslash itself, so an attribute or text value ending in `\` could break out of the generated
  literal (`js/incomplete-sanitization`, three sites) — now escapes `\` before `'`. The gallery
  comment-stripper (`tools/devkit-build.mjs`) removed `<!-- … -->` in a single pass, which can re-form
  a `<!--` from an overlapping pair (`js/incomplete-multi-character-sanitization`) — now strips to a
  fixed point. Both files are build-time/preview only and never reach a router, but the fixes are
  correct in their own right and clear the code-scanning alerts.

## [0.9.5] — 2026-07-20

### Fixed

- **The Appearance popover shows the installed version again instead of "Footstrap (dev)", and the
  theme's own update check is no longer dead on every released build.** `isReal()` tested
  `FS_VERSION !== '0.0.0-dev'`, but CI runs terser over the theme's resources BEFORE the SDK build
  stamps the git version into that literal — so at minify time both sides of the comparison were the
  same string, terser constant-folded it, and the shipped file read
  `return/^\d+\.\d+/.test(FS_VERSION)&&!1` (verified on a live 0.9.4 router). The later `sed`
  rewrote the constant to `0.9.4` while `isReal()` stayed permanently `false`. Beyond the wrong
  label, `fs-update.js` gates the theme leg of its check on `ver.isReal()`, so releases only ever
  checked the *updater's* version — updates still arrived because one script installs both. The
  sentinel is now excluded by SHAPE (`!/-dev$/`): a regex test is not constant-folded, proven by the
  same minified output, which kept the existing `.test()` call. `-dev$` rather than a strict
  `^\d+\.\d+\.\d+$` because `dev-sync.sh` stamps `git describe` (`0.9.4-12-gabc1234`), which must
  keep counting as a real version. An SDK/buildbot build has no terser step, which is exactly why
  this worked locally and only ever broke in a release.

## [0.9.4] — 2026-07-20

### Added

- **Find a page by typing its name: a search palette on `Ctrl`/`Cmd`+`K`, on `/`, or from the
  magnifier in the chrome's right cluster, beside Appearance.** A loaded router carries around 200
  reachable pages across 11 sections, and the only way to open one was to know which section owns
  it — "Attended Sysupgrade"
  is under System, "Port Forwards" is a TAB of Network → Firewall and appears in no menu list until
  you are already there. Results are ranked title-prefix first, then title, then the ENGLISH path
  segment (so `firewall` finds Межсетевой экран on a Russian router) and finally the breadcrumb;
  every token must match, so `fire port` narrows to Port Forwards. Before a character is typed the
  palette lists the last 8 pages visited, which is the view a router admin sees most — three or
  four pages is where they live. It costs no request: the index is built, on first open only, from
  the same ACL-filtered `/admin/menu` tree the chrome already loaded, so it can only ever offer
  pages this session may open. Each result is a real `<a href>`, so opening one takes the SPA
  router's own path — or its full-load fallback for a page that has none — with no second copy of
  that decision. Not indexed through `ui.menu.getChildren()`: on an alias node that returns the
  alias TARGET's children, which is right for drawing a menu and wrong for indexing — every tab of
  every aliased page came back missing (measured: 78 nodes indexed, no Port Forwards on a router
  that plainly has one).
- **`prefers-contrast: more` is honoured: hairlines, secondary text and the focus ring all
  strengthen.** Same token mechanism as the reduced-transparency block: `--fs-border` pulls
  toward the text colour, the role hairlines (a 40/55% tint of their role) go to the full role
  colour, `--fs-dim`/`--fs-faint` (the 10–11px eyebrow labels — where AA erodes first) step up,
  and the focus ring trades its 12% tint for the accent at 60%. One `:root` block; every rule
  reads the tokens, so the whole page follows.
- **Printing works: light surfaces, no chrome, and — the real bug — more than one page.** The
  sidebar layout's shell is `height: 100dvh; overflow: hidden`, so printing a config page cut
  everything past the first viewport. `@media print` now unwinds the scroll frame, hides the
  navigation/actions/popover, restates the surface tokens to ink-friendly values (one block in
  the theme layer outranks every tokens-layer palette), and keeps cards unbroken across page
  breaks where possible.
- **Text selection, the input caret and native form controls follow the palette.**
  `::selection` paints accent-on-accent-ink instead of the UA's opaque blue; `caret-color` and
  `accent-color` are set once on `:root` — the theme's own checkboxes are `appearance: none`
  drawings and never see `accent-color`, but a third-party `luci-app-*`'s native
  checkbox/radio/progress now takes the palette, outbound theming in the spirit of the
  `--*-color-*` export tier.
- **Back/Forward now restores the scroll position in the sidebar layout.** The sidebar layout
  scrolls `#maincontent`, not the document, and a browser restores inner scrollable regions only
  across full loads — so an SPA Back always opened the page at the top (docs/22 §2; the top layout
  was already restored by the browser). The router now records the offset per history entry and
  replays it once the incoming view has grown that much height. Not via `history.state` writes on
  scroll: Safari rate-limits history writes (100 per 30 s), so the entry carries only a
  session-unique id and the offsets live in memory — which dies on a full load, exactly when the
  browser's own restoration takes over.
- **A keyboard-activated navigation now moves focus to the skip link.** The SPA router used to
  focus the invisible `#maincontent` wrapper for every navigation — WCAG-compliant, but a sighted
  keyboard user got no visible cue of where focus went (the Sutton five-prototype study's known
  weakness of the wrapper variant). A navigation activated from the keyboard (`ev.detail === 0`)
  now focuses `.fs-skip`, whose focus overlay is visible and whose Enter jumps straight to the
  content; pointer navigations and popstate keep the wrapper focus, so nothing flashes on mouse
  clicks. The live region still announces the page separately, with a different text.
- **`prefers-reduced-transparency` is honoured: every frosted surface goes opaque.** The bar's
  88% fill and the popovers' 96% glass switch to the solid panel colour and the backdrop blur is
  dropped — both an accommodation and a measured escape hatch on devices where the sticky bar's
  backdrop blur (resampled every scrolled frame, docs/18 §1) is too expensive for the GPU.

### Changed

- **The self-update package `luci-app-footstrap-updater` moved to its own repository — and this
  transition release ships it from here ONE last time, already knowing to look for itself in that
  new repo first.** It now lives at
  [VizzleTF/luci-app-footstrap-updater](https://github.com/VizzleTF/luci-app-footstrap-updater) with
  its own tags and release stream; the two are versioned independently (a theme-only release no longer
  republishes the updater, and vice versa). But every self-updater already on a router looks for the
  updater asset in THIS repo's release and nowhere else, and a router's installed updater cannot be
  fixed remotely — so a clean break would have stranded each of them on its current updater forever:
  the missing asset is skipped non-fatally, the theme keeps updating, and nothing ever reports that
  the updater stopped moving. So the copy installed here carries `resolve_updater()` — the updater
  repo FIRST, and it wins whenever it offers an asset, the theme's release only as a fallback while
  that repo has none — which makes the day it publishes the day every router crosses over, with no
  second decision anywhere. Both sources are verified against the same ed25519 key, so the fallback
  changes where the bytes come from and never whether they are checked. The updater repo's first tag
  must be **higher than this release's version**: opkg refuses a downgrade by default ("Not
  downgrading package …"), exits 0 and installs nothing, so a lower tag there would strand every 24.10
  router on the transition build while reporting success. The self-updater is repo-aware and skips the
  updater leg when it is already current; `install.sh` installs both packages, updater repo first,
  theme release as fallback; the `fs-update.js` runtime module still lands in the same
  `/www/luci-static/resources` and requires the theme's modules exactly as before. The updater's own
  new features (release notes + breaking-change warning + free-space preflight in the confirm dialog,
  a non-fatal updater refresh) are in that repo's changelog.
- **The inter-card gap and the top bar's edge shadow are named tokens (`--fs-card-gap`,
  `--fs-shadow-bar`).** The same 16px was hand-written in seven files — `45-misc.css` even
  carried a comment apologising for it — and the bar's shadow was the one bar/card shadow
  written inline (`color-mix` over the border, twice): both were unnamed levels, and an unnamed
  level drifts in silence (the role-tint ladder exists for exactly this reason).
- **The mode strip's empty/single-mode hiding is one rule per layout instead of a byte-identical
  hide pair in two files, and the poll glyph's mask recipe is `@mirror`-pinned.** The
  `.fs-modemenu:empty/.single { display: none }` pair existed identically in the sidebar and the
  top-layout files, unpinned — the exact drift shape `@mirror` exists for. Each layout's SHOW rule
  now opts in via `:not(:empty):not(.single)` and the bar's base rule keeps the strip hidden
  otherwise. The rail's and the compact top-bar's refresh glyph shared their mask declarations the
  same unpinned way; those two copies are now held byte-identical by `npm run mirror`.
- **The `.cbi-dropdown` widget lives in one place, and its six state-machine `!important` flags
  are gone.** `base/80-dropdown.css` was absorbed whole into `theme/65-dropdown.css`. The display
  state machine ([open]/[multiple]/[empty]/[optional]) is rewritten onto plain specificity —
  every shower out-specifies its hider, and the one state the old flags actually carried (a
  closed optional-empty dropdown: ui.js hands the `[display]` attribute to the placeholder row
  itself, which its hider out-specifies) has its own explicit rule. Three flags remain, moved as
  they are: the `ul` margins fight the inline `margin` ui.js writes on an open list, and only an
  author `!important` outranks an inline style. Verified with 0 computed-style diffs across the
  gallery's dropdown states and a live click-through (open/select/multiple/chips/optional-empty)
  on both releases. The theme is down from 31 `!important` to 28, and none in base aims at the
  theme through the importance layer-inversion any more except the documented eight.
- **The base-absorption backlog is closed: 25 declarations to 0, and focus/hover is now ONE
  ring.** Everything base still styled alone (the generic 210px field box and its per-widget
  escapes, checkbox/radio drawing, `.cbi-select`, the heading ramp, control typography) moved
  into the `theme` layer, verified over the 521-element gallery with one computed-only residue
  (`transition-property` on labels). The one deliberate redesign inside the move: base's second,
  unnamed focus style — an `0 0 8px` glow that rang every *clicked* button and every hovered
  widget — is gone, replaced by the theme's `--fs-focus-ring`/`--fs-focus-ring-invalid` tokens
  (inputs on `:focus`, buttons on `:focus-visible` only, the dynlist chip's × answering hover
  with the named `--fs-hover-lift` instead of a glow). An invalid field keeps its red ring
  through focus via an explicit `.cbi-input-invalid:focus`. A verbatim move was not possible:
  inside one layer the old ring met the theme's own rules at equal specificity, i.e. the cascade
  would have rested on file order.

### Fixed

- **A filtered package name is no longer torn in half on a phone.** The Software filter wraps
  each match in `<ins>`, so `luci-app-acl` is really `<ins>luc</ins>i-app-acl` — two elements.
  The card row laid its label and value out with `justify-content: space-between`, and flex
  treats every element as its own item, so the two halves of the name were pushed to opposite
  edges: measured at 390px with the filter on "luc", gaps of 110/85/77/69px straight through the
  middle of the word, plus 14px more from the row's `gap`. The free space now goes to the label
  alone (`margin-right: auto`), so the value packs flush right as one unbroken run however many
  elements it is made of. Mid-word gap: 0px on every row.
- **Package names stop breaking mid-word on the Software page.** `theme/30-tables.css` gives
  every data cell `overflow-wrap: anywhere`, which — unlike `break-word` — also drops the
  column's min-content width to a single character. Version and Size are `nowrap` and cannot
  shrink, so auto table layout took the entire shortfall out of column 1: measured with the
  filter on "app", the name column came out 81–101px, narrower than Size (88px), and 6 of the
  first 8 names rendered as `apparmor-` / `profiles`. It surfaces when a filter is applied
  because that is when long names reach the top of the list; the squeeze was always there. The
  name column is now `nowrap` in table mode, which also makes the overflow honest for
  `fs-select.js`'s measurement — where a row genuinely does not fit, the table cards and the
  name wraps freely again. Verified 560–1440px: no broken names, no overflow, card threshold
  unchanged.
- **Startup's action buttons no longer get cut off on a phone — the card's button row wraps.**
  LuCI groups a row's buttons in ONE inner `<div>`, so the card's own `flex-wrap` on the actions
  cell never fired — the div is a single flex item, and `.fs-main`'s `overflow-x: clip` cut the
  tail button (measured at 390px: the five-button div needs 350px in a 324px cell and "Stop"
  vanished). The config-table card had this exact fix already (the interfaces row, 320px);
  the data-table card now carries it too, `@mirror`-pinned so the two copies cannot drift.
- **Notifications below 768px now span the content column instead of hugging the left, 24px
  short.** `.fs-main > .alert-message` kept its desktop width (100% minus the 28px-a-side
  gutter) while the content's own gutter narrows to 16px in that tier — measured at 700px:
  alert insets 16/40 where the content sits 16/16. The narrow tier now uses `width: auto` with
  the side margins, matching the column exactly at any width.
- **The overview's two-column grid never applied on 24.10 — the section title lookup only knew
  25.12's markup.** 25.12 wraps a section heading in `.cbi-title > h3`; 24.10 emits a bare
  `<h3>` as the section's first child, so `sectionTitle()` returned `''` for every section and
  `.fs-ovl` was silently never built (measured on the 24.10 dev container). The lookup now
  accepts both shapes.
- **The toggle switch is a 44×30 click target — it shipped at 40×22, under the WCAG 2.5.8
  floor.** The real checkbox inside `.cbi-checkbox` is `opacity: 0` at 0×0, so the label IS the
  whole hit box of LuCI's most common control, and 22px sat under the same 24px minimum the
  row-action buttons were already bumped to 32px for. The floor is about the clickable area, not
  the drawing: an invisible `::before` overlay stretches the target while the pill keeps its
  40×22 look (a visually fattened 44×24 was tried and rejected).
- **Two spots still painted accent text on the accent's own translucent tint — the measured AA
  failure (4.21:1) the open dropdown was cured of.** The section-title notice pill and the
  base-select `option:checked` both wore `--fs-accent` on `--fs-accent-soft`; the tint drags the
  surface toward the text and eats its own contrast. Both now sit on opaque `--fs-panel2` — the
  pill's border carries the accent, the option takes the same inset rail as the open
  `.cbi-dropdown`'s selected row (now `@mirror`-pinned so the two shapes cannot drift).
- **Keyboard focus is visible on everything clickable that used to hide it.** Generic links had
  only the 2001-era `outline: thin dotted` (near-invisible on a dark panel) — now a 2px accent
  ring on `:focus-visible`. Tab links replaced their ring with `text-decoration: underline`,
  indistinguishable from the hover state — now an inset accent ring. The `.dropdown-menu` items
  (split Save & Apply) and the section-title show/hide pills showed nothing at all — both now
  light up like their hover.
- **The popover's Rounding/Tint slider thumb matches the form slider's: 16px, not 15.** Same
  accent circle, same 2px panel border, four hand-written copies, one off-by-1 nobody chose; the
  Firefox thumb of the generic slider had also silently drifted flat (no shadow) while the WebKit
  one carried `--fs-shadow`.
- **The cats-wallpaper dropdown frost obeys `prefers-reduced-transparency` now.** It was a literal
  `blur(6px)` — the one frosted surface outside the `--fs-blur` token, so the a11y block that
  nulls the token left it blurring for exactly the users who asked for opaque. It reads the token
  (one radius for every frosted surface, per 02-tokens.css).
- **The System/Kernel Log fills the page again instead of rendering as a 210px column.** The log
  is a `<textarea id="syslog">` in a bare div, not in a `.cbi-value-field` — stock bootstrap
  pairs its generic `input, textarea { width: 210px }` with `#syslog { width: 100% }` and wins
  on specificity, but this theme's generic field box lives in the `theme` LAYER and a layer
  beats specificity, so the same pair in `base` silently lost. The rule is absorbed into the
  `page` layer (above the generic's), with the mono face at the data tables' size, a 500px
  floor and a vertical-only resize grip.
  The data card's cells already carried `overflow-wrap: anywhere; white-space: normal`; the
  config card's copy had neither, and a value with no break point — a real-length IPv6 GUA is
  39 characters and colons are not break opportunities — ran 156px past a 360px viewport on the
  Interfaces page (measured). The two card contracts now state the same thing.
- **Adjacent cells in a carded row keep one height, so the separators meet.** The card rows were
  `align-items: flex-start`, and each cell paints its own hairline — the moment one cell of a
  pair wrapped (a two-line hostname beside a one-line MAC) the neighbour stayed short and its
  separator painted 52px higher, a broken line mid-card (measured). Stretch — the flex default —
  gives both cells the line's height; content still sits at the top.
- **A carded config-table row's buttons wrap instead of overflowing the section on a narrow
  phone.** LuCI groups a row's actions in ONE inner `<div>`, so the carded cell's own
  `flex-wrap` never fired — the div is a single flex item, and its four buttons (~330px) ran
  17px past the section edge at a 320px viewport (Interfaces page, measured). The inner div now
  wraps too.
- **The uci-change legend swatches follow the Rounding axis.** Their `border-radius: 4px` literal
  sat outside the radius scale while the sibling diff blocks were already on `--fs-radius-sm`.
- **The legacy `.cbi-select` shell renders as designed again: one ▾ plate, an invisible inner
  select.** The theme's own select rules (chevron image, 8/34px padding, 38px min-height) sat in
  a later layer than base's "inner select is transparent and fills the shell" rules, so a
  luci-compat `.cbi-select` rendered a fully-dressed select fighting inside its 32px gradient
  shell — a double chevron and an overflowing box. The whole widget now lives in one place in
  the theme layer, where the inner-select rule out-specifies the generic select theming; the
  bare `select.cbi-select` markup shape keeps the themed-select look via a `:not(select)` guard
  on the shell paint.
- **A readonly text field shows its faded border again.** The readonly border fade lost a
  same-specificity tie against the typed input rules — in base it silently resolved by file
  order the wrong way, so a readonly field (System's Local Time) wore the full-strength border
  as if editable. The rule moved to the theme layer with a deliberate specificity step
  (`[readonly][readonly]`), so the tie no longer exists in either direction.
- **Toggle/checkbox rows with no help sentence floated the control ~5px above its label.** A CBI
  value row aligns on the text baseline so a label lines up with a select/input/dropdown's first
  line, but a `.cbi-checkbox` toggle is an `inline-flex` box with no line box — its synthesised
  baseline is the box's bottom edge, so the row hung the toggle from the label's baseline and lifted
  it above (measured 5px, every toggle/checkbox row across the UI). Rows whose field is a bare
  checkbox/radio now centre instead — scoped to exclude any row carrying a `.cbi-value-description`,
  where centring would drop the label to the middle of control+help. Delta is 0 on both 24.10 and
  25.12.

### Performance

- **Released packages ship terser-minified JS: ~41 KB where jsmin shipped ~57 KB (−27%).** jsmin
  strips only comments and whitespace — identifiers are wire bytes, and uhttpd serves `/www`
  uncompressed. CI now pre-minifies with terser (`tools/minify-js.mjs`; mangling top-level names
  is safe because LuCI evaluates a resource file inside a function wrapper, and everything that
  crosses a module seam is an undeclared global terser never renames) and builds with
  `FOOTSTRAP_PREMIN=1`, which turns `LUCI_MINIFY_JS` off — jsmin over terser output would re-open
  the openwrt/luci#8299 regex trap on shapes terser legitimately emits. An SDK build without node
  keeps the jsmin path exactly as before, and `wrap-regex`/`jsmin-verify` keep guarding it. The
  tool verifies its own output (it parses, the `'require'` pragma prologue is intact, the
  `FS_VERSION` sed contract survives) and fails the build otherwise.
- **The SPA router no longer carries the overview's template helpers on every page.** The ~1.1 KB
  of `progressbar`/`renderBox`/`renderBadge` copies — needed only when Status→Overview is reached
  by SPA navigation — moved from `fs-router.js` into the overview include, whose module eval runs
  inside `index.load()`: still before any include renders, so the guarantee is unchanged.
- **The optional updater module loads at idle instead of during chrome init.** On a router
  without `luci-app-footstrap-updater` that `L.require('fs-update')` is a guaranteed 404, and it
  fired in the middle of chrome init, competing with the view's own module fetch and RPCs on
  every full load. The Appearance wiring is deferred to `requestIdleCallback` (capped at 2 s for
  pages that never go idle), so it lands a few ms after load on a quiet page and within ~2 s
  worst-case.

## [0.9.3] — 2026-07-17

### Added

- **The update check and one-click self-update moved into a separate, optional package,
  `luci-app-footstrap-updater`.** The theme no longer carries any update machinery: the updater
  package ships the `fs-update.js` module (the GitHub check + installer), the `footstrap-selfupdate.sh`
  backend, its `file.exec` rpcd ACL and the `release.pub` signing key. `install.sh` now installs both
  packages, and the one-click Update installs both too, so the updater never lags the theme it drives.
  A router without the updater is a fully working theme — the Appearance popover shows its version
  (from the theme's own `fs-version.js`, no network) and simply omits the Updates toggle, the "new
  version" badge and the Update button. The theme must NOT statically require the updater — a missing
  optional module would be a `DependencyError` that takes out the whole chrome — so `fs-appearance.js`
  loads it at runtime and lights the update controls up only when it resolves, and the router→updater
  seam is inverted (`fs-router.js` exports `onNavigate()`; the updater registers its poll-cancel there)
  so no theme module ever names the optional one.
- **`npm run changelog` holds the changelog contract, which had already drifted into the release
  that was about to ship.** `[Unreleased]` had grown a duplicate `### Changed` across several
  commits — each innocent on its own — and `Fixed` had drifted above `Removed`. Nothing failed:
  `release-notes.sh` prints a header the first time it meets each `###`, so the release page would
  simply have carried two "Changed" groups, and it is generated at tag time, when the tag is already
  pushed. The gate checks the section set, order and uniqueness, empty sections, dates, the compare
  links in both directions, and that the Russian mirror carries the same versions, dates, sections
  and bullet counts — a mirror that lags is worse than none, and nothing renders differently when it
  does. It also requires the `**bold lead**` on every bullet in `[Unreleased]` and in a freshly cut
  version, because a bullet without one is dropped from the release page in silence; 106 older
  bullets predate that convention and are exempt, since their notes are long since published. Proven
  by mutation: eleven botched edits fail, the legacy exemption and a fresh `[Unreleased]` pass. The
  prose the doc actually cares about — the effect, the measurement, what the rule protects — is
  deliberately not checked, because no scanner can judge it.
- **The dev routers now carry a wifi client that really associates, so Associated Stations has a
  row** (`docker/hwsim-up.sh`, three radios per box instead of two). That table is the one the
  measured card-stacking exists for, and it has been fixed twice from a screenshot because neither
  dev box could show it: a station comes from a real association through ubus/iwinfo and cannot be
  faked in a lease file the way the DHCP rows are. The client needs a radio of its own — a phy has
  one channel, the client must sit on the main AP's, and that is exactly the channel the neighbour
  must avoid. It is pinned to its own box by BSSID, derived on every run: both boxes beacon the
  same SSID and hwsim's medium is global, so unpinned clients both landed on the *same* box — two
  rows there, none on the other, and which box won changed between runs. The script also gives the
  station a lease and a v4/v6 neighbour entry, because LuCI resolves the Host column through
  hosthints and "?" is precisely the short cell that hides a column crush.
- **The dev routers now carry `luci-app-justclash`, the one fence adversary whose sheet a text
  file cannot reason about.** openclash and nikki ship real `.css`; justclash ships none — it
  builds every rule from its view JS at runtime, which is exactly the `textIsSheet()` shape
  (`fs-sheets.js`) where a `<style>`'s `textContent` is not its sheet, and it is also the app the
  `data-theme="dark"` publication (21 rules) and the `--*-color-*` export tier exist for. Pinned to
  `v0.73.0` in the `Dockerfile` beside the other two, and installed as a dev fixture only — no
  signature, nothing shipped. Its two halves install as **separate** commands on purpose: upstream
  supports 25.12+ only and the core drags in nftables/tproxy/jq-full, while `luci-app-justclash`
  depends on nothing but libc — so on 24.10 the core refuses and the LuCI pages this theme is here
  to render survive it (verified: core installed on 2512, refused on 2410, pages render under
  footstrap on both). Its tproxy core service is disabled in `99_footstrap-dev` alongside
  firewall/mwan3/watchcat — it rewrites nftables and policy routing, and its kmod cannot load on
  WSL's kernel anyway; the config and pages need no running core.

### Changed

- **A GitHub release now carries two packages per format instead of one, and the single-asset CI
  invariant became a two-package, name-anchored one.** Each package (theme, updater) must resolve to
  exactly one asset under its OWN name regex — which is why the updater is named `luci-app-…` and not
  `luci-theme-footstrap-updater`, since the latter would match the theme's own name-anchored pick and
  re-open issue #6. The one thing given up: self-updaters shipped before name-matching existed
  (≤ v0.8.5, before signing) picked the asset by a bare `\.EXT$ | head -1`, which now resolves to two
  and would take the updater first; such a router migrates by re-running `install.sh` once (it installs
  both by name). Every self-updater from the name-matching era onward is safe. The lint, jsmin,
  shell-syntax, ACL-JSON, i18n and mirror gates were all widened to cover the new package.
- **The theme's JS and CSS now read as one style, and two formatting gates hold them there.** The
  sources were sound but idiomatically split, each drift invisible to every existing gate: arrow
  functions were 62 parenthesised vs 21 bare (mixed twice within twenty lines of one file), string
  quotes 309 double vs 47 single in attribute selectors, leading zeros 97 bare vs 5, and one
  expression — `ev.target.closest && ev.target.closest('a[href]')` — was written both ways twenty
  lines apart in `fs-router.js`. The majority won each: `@stylistic/arrow-parens` and
  `@stylistic/string-quotes`/`number-leading-zero` (the stylistic rules ESLint and stylelint dropped
  from core) close them for good, and `eqeqeq` moved from `smart` to `always` — which also caught 5
  loose `typeof x == 'function'` against 9 strict, the one comparison `smart` waves through. The
  overview include's module state took the `_` prefix its 17 siblings all carry. Every CSS change is
  proven inert: `cascade.css` is byte-identical bar the quotes (116548→116551) and cssdiff reports 0
  property differences over ~7000 elements on both 24.10 and 25.12; every JS change is jsmin
  token-identical. What no rule can gate — attribute-quote presence (`input[type=file]`) and `0px`,
  both removed from stylelint 16 and never ported — was fixed by hand and is now on review alone.
- **The dev toolchain is on the current majors, and ESLint 10 found a dead store the bump paid
  for.** eslint 9→10, stylelint 16→17, globals 15→17 and the rest to latest; both majors need Node
  ≥20.19, so `pages.yml` moved off a bare `20` onto `22` to match `build.yml`. ESLint 10 puts
  `no-useless-assignment` in its recommended set, which flagged a genuinely unread `let rules = null`
  in `fs-sheets.js` (every path reassigns before the read) — a real dead store no earlier gate saw.

### Fixed

- **The 25.12 dev router's main AP had never been on air, and nothing said so.** `wifi config`
  writes `country=00` itself, and with no regulatory.db to resolve it 25.12's hostapd rejects the
  whole config (`Invalid country_code`, `Cannot enable IEEE 802.11d without setting the
  country_code`) and `hostapd.add_iface` fails for that phy — while 24.10's hostapd accepts the
  same line, so only one box was affected. Radios, SSIDs and scans still rendered (they come from
  uci and from the other container's beacons), and the only symptom was that nothing could ever
  associate — which reads as "hwsim does not do clients". The country line is now deleted.
  `hwsim-up.sh` also regenerates `/etc/config/wireless` unconditionally instead of guessing when
  the file is still good: every guess so far has been wrong — testing that `radio0` exists survived
  a module reload that handed the box a third radio, and the hwsim index inside each radio path
  changes on every reload, so even a config with the right *number* of radios can point at phys
  that no longer exist, which brings every SSID up as "unknown" and is an error nowhere.
- **A data table whose leftmost column has been shredded into a tower of half-words now cards,
  instead of staying a table nobody can read** (issue #7). Auto table layout hands width out by
  what each column *demands*, and `overflow-wrap: anywhere` gives the row's identity column no
  floor at all — so a wide neighbour (a hostname plus an IPv6, a modulation string) simply takes
  the width and the identity breaks mid-word rather than overflow. No overflow means nothing for
  the measured stacking to read, and the `room < 568` rule cannot see it either: measured on the
  router with one associated station, at a 900px viewport the Network column was 101px and 5
  lines, at 850px 80px and 7, at 800px 76px and 8 — and the table carded at *no* width. (Below
  767px the MAC column drops out and the column springs back to 167px, which is why this only
  ever bit between roughly 780 and 900.) `fs-fit.js` now measures the fact — text line boxes, via
  ranges over the text nodes, because the cell's height is a third icon — and `fs-select.js` cards
  a table whose first column passes 5 lines. Note the cards drop the `.hide-xs` columns (the stock
  phone contract), so the MAC moves out of view when this fires. Counting had to cluster line
  rects by their TOP: consecutive lines *overlap* (tops 15-16px apart, rects 17-18px tall), so an
  overlap test merged an 8-line tower into one line and the check would have silently never fired.
- **The Wireless "Associated Stations" table no longer crushes the Network column to fit the
  modulation string** (issue #7, reported against 0.9.1). 0.9.1 nowrapped Signal/Noise and RX/TX
  Rate to stop `overflow-wrap: anywhere` splitting "-54/-90 dBm" mid-character; nowrap made
  "229 Mbit/s, 20 MHz, HE-MCS 9, HE-NSS 2" a single unbreakable ~300px block, which took its share
  of the row from every other column — the network name was squeezed to a few characters — and
  raised the table's floor enough to card it on desktops that had room for the real table. Both
  columns wrap again: a wide cell that can break is the lesser evil, because the columns keep their
  share. The MAC keeps its nowrap (issue #5) — it is short, and stock LuCI keeps it on one line too.

## [0.9.2] — 2026-07-17

### Added

- **The templates' inline `<script>`s are now linted, closing the last gap where theme JS ran
  unchecked.** `eslint` walked `htdocs/` and jsmin (via `luci.mk`) minified that same tree, while a
  `.ut` is copied to the router verbatim — so both gates looked straight past the pre-paint in
  `partials/head.ut`, the most load-bearing script in the theme: it stamps `:root` before the first
  frame, and its failure mode is one wrong frame that nobody reports and no other test catches. An
  eslint processor (`tools/lib/ut-scripts.mjs`) extracts each non-interpolated `<script>` body,
  padded so a message's line and column point back at the `.ut` itself. A block the server
  interpolates is not JS until rendered and cannot be parsed, so it is exempt — and therefore must
  now be DATA ONLY (one statement, no control flow), which the processor enforces rather than
  trusting. Proven by mutation: a reintroduced `var`, a misspelled local, a misspelled browser
  global, a syntax error and logic smuggled into an interpolated block all fail the gate.

- **Both supported releases now run as dev routers in docker (`docker/compose.yml`), replacing the
  single physical box.** The theme targets 24.10 and 25.12+, and the differences that bite are
  runtime ones one router cannot show: apk vs opkg, and `/lib/apk/db/installed` vs
  `/usr/lib/opkg/status` as the cache-bust stamp LuCI's `pkgs_update_time` reads. Each container
  boots the release's own rootfs tarball — real procd, netifd, ubus, rpcd, uhttpd — so what is
  tested is the userland the package ships against. They carry no volumes: a rebuild is a factory
  reset, which is the point, since it exercises the install path on both package managers instead of
  drifting on a box that has been hand-patched for months. `curl` is deliberately absent from them,
  as on a stock router, so the self-updater's `uclient-fetch` fallback cannot quietly stop being
  tested.

- **The dev routers are furnished like a real one — ~25 apps, invented networks, fake clients and
  working wifi — instead of showing three menus and an empty page.** LuCI renders nothing from the
  theme's side: the sections, tabs, tables and badges this theme exists to style only appear when
  there is config behind them, so a bare `luci` leaves about four fifths of the widget surface
  invisible on the box where it is supposed to be checked. The containers now carry OpenWrt's own
  apps plus **openclash and nikki** — the packages `tools/chrome-fence.mjs` only reasons about from
  a text file are now real sheets in the real document — VLANs, a WireGuard tunnel, five firewall
  zones, port forwards, and fake DHCP leases so the data tables have rows to card. Wifi is real
  (`docker/hwsim-up.sh`): two virtual radios per box, hostapd, scans, Channel Analysis; 2.4 GHz
  only, because cfg80211 in the WSL kernel never loads regulatory.db and refuses to beacon on 5 GHz.

### Changed

- **The refresh glyph is the theme's own drawing — it was derived from Lucide, an obligation this
  theme never declared.** Found while auditing the bootstrap inheritance, and it is not bootstrap's:
  `--fs-icon-refresh` carried Lucide `refresh-cw`'s `M21 3v5h-5` byte-identical, plus its r=9 arc and
  `L21 8` terminus, on its grid and stroke width. Lucide is ISC, which also requires the notice be
  kept. Redrawn as two OPEN arcs with solid triangular heads — a different construction, not a nudge
  of the same one (Lucide caps a continuous stroke with an L-shaped hook). The heads are solid rather
  than chevrons because the glyph renders at 18px and chevrons dissolve there; measured, not assumed.

- **Statistics graphs come back the right colour in dark mode.** The dark-mode inversion rotated hue
  by 150° — a fudge inherited with the fork. 180° is the arithmetic, not a nudge of it: `invert()`
  maps every hue to h+180, so rotating 180 back restores the ORIGINAL hue while keeping the inverted
  lightness. Measured on collectd's own cpu-plugin series by reading the rendered pixel back: at 150°
  System (red, h=0) came back at h=301 and User (blue, h=240) at h=180 — 59° and 60° out, i.e. the
  blue plot was drawn cyan. At 180° all three primaries are exact. It is not exact for every colour
  and cannot be — CSS `hue-rotate` is a linear matrix approximation rather than a true HSL rotation,
  so amber still lands 13° out; the angle must not be tuned off 180 to chase it, which would trade an
  exact red/green/blue for a marginally better amber.

- **The checkbox tick, the radio dot and the help glyph are the theme's own drawings.** They were
  `data:` URIs copied verbatim from `luci-theme-bootstrap` — and a drawn path is authored expression
  in a way `padding: 8px` is not, which made them the sharpest single item in the whole inheritance.
  Redrawn as **strokes**, which is this theme's icon language (`--spinner-icon`, `--fs-icon-refresh`:
  `fill: none`, round caps, a 24 grid), where upstream's were solid filled paths. A mask keys on
  alpha, so a stroked path masks exactly as a filled one did; all four states verified rendered. No
  upstream artwork is left in the tree.

- **The spinner's geometry is derived instead of being three literals in two files.** `left: 6px` +
  `width: 20px` in `base/95-luci.css` and a bare `padding-left: 32px` in `theme/55-buttons.css`
  encoded one relationship — the button pads left to clear the glyph — with nothing to notice when
  the glyph is resized. `--fs-spin-size` is now the one statement and both sides read it; the
  vertical centring is `margin-top: calc(size / -2)` rather than the hand-halved
  `top: calc(50% - 10px)` (margin, not `translate` — `transform` is taken by the spin animation).

- **The theme has its own type and space scales, replacing the rhythm it inherited from the
  `luci-theme-bootstrap` fork.** `styles/base` sized everything off a 13/18 pair with 9px and 8.5px
  halves of it, a 30/24/18/16/14/13 heading ramp and a 25px list indent — Twitter's 2011 scale,
  which arrived with the fork rather than by anyone choosing it for Manrope. `02-tokens.css` now
  carries `--fs-type-*` (11/12/13/16/20/26), `--fs-leading` and a 4px `--fs-space-*` grid, and base
  reads them. Two things are genuinely better rather than merely different: the leading is
  **unitless** (1.5), so a 20px heading gets 30px of leading instead of the flat 18px a length
  pushed down onto it, and the one-line control height is **derived** (`--fs-control-h` = text box +
  inset + borders) instead of the bare 30px that was upstream's arithmetic over upstream's leading —
  so re-scaling the type no longer leaves every control the wrong height for its own text. Measured
  on the router across System and Firewall: 1498 property diffs, every one of them intended
  (line-height 18→19.5, control 30→32, field radius 3→10, field inset 4→8), nothing else moved.
  Values that are functional rather than expressive are deliberately unchanged — the 180px label
  column and the 210px field width are what fits LuCI's markup, not a step of anyone's rhythm.
  Byte-identical declarations against upstream's cascade fell from 998 to 843.

  **Never size a BOX `--fs-type * --fs-leading`.** That calc is 19.5px, and a half-pixel on a border
  is upstream's 8.5px bug wearing a `calc()` — it went in on the dropdown row and showed up as 524
  half-pixel `min-height`s before the measurement caught it. A fractional LINE box is fine and is
  what unitless leading gives on any odd size; a fractional box edge is not. Take the nearer
  `--fs-space` step, which is what a line of text at this scale rounds to anyway, or round
  explicitly the way `--fs-control-h` does.

- **The templates' browser JS is modern JS, like the rest of the theme.** The inline scripts in
  `partials/head.ut` and `sysauth.ut` were ES5 (`var`, `function(){}`) inherited from the
  `luci-theme-bootstrap` fork, while every module under `htdocs/` is `const`/`let` and arrows — the
  theme already requires `:has()`, `color-mix()` and `@layer`, i.e. browsers years past ES6, so the
  old shape bought nothing. `no-var` now holds them there. The login page's HTTPS-hop probe gets its
  two server values (`ports`, `resource`) through a `window.__fsHttps` data blob instead of
  interpolating them mid-statement, which is what lets the script itself be linted. Verified on the
  router: the pre-paint stamps every axis (rounding, tint, accent, palette, wallpaper, rail, layout,
  dark mode), the legacy `rvht`/`roman` palette migration still splits onto both axes, and the login
  autofocus and port probe still work against a live HTTPS listener.

- **Help text no longer strands a single word on its own last line.** LuCI writes its guidance as
  one or two sentences (`.cbi-value-description` sits in the field column, where it wraps most), and
  a lone trailing word reads as a rendering fault rather than prose. `text-wrap: pretty` reflows only
  the tail, unlike `balance`, which re-runs the whole block and is meant for headings; a browser
  without it wraps exactly as before, so there is nothing to guard. Measured over four pages: 12
  elements changed, no other property moved.


- **Every Appearance axis owns its router default, instead of a second copy restating it.**
  `_resolvedDefault()` spelled each validation out again — the 1–360 hue clamp twice, the 0–20
  rounding clamp once, and a bare `sd('palette') || 'footstrap'` where `current()` whitelists — and
  nothing observable fails when the two disagree: `matchesSavedDefault()` simply lies, and the Save
  button IS that answer (it reads "Saved as default" and greys, or never greys at all), with nothing
  else in the UI to contradict it. Each axis exposes its `def()` now and `_resolvedDefault()` calls
  it. In the same pass, palette and wallpaper stopped being one shape written twice — `current()`
  and `apply()` agreed line for line, and `palette`'s two halves had already drifted 100 lines apart
  in the file — and join tint/accent on a factory (`enumAxis`, beside `hueAxis`). Verified on the
  router against a real saved default (`layout=top`, `darkmode=dark`, `wallpaper=cats`): a clean
  browser resolves every axis to it, the Save button greys, and diverging on one axis un-greys it.
- **`npm run axes` gates the palette and wallpaper axes, which it had never seen.** It finds an
  axis's localStorage key by scanning for `lsGet('fs-…')` call sites, and an axis built by a factory
  has none — the key is an argument. It already special-cased `hueAxis()` for exactly this reason;
  `enumAxis()` would have walked into the same blind spot and dropped both keys out of the contract
  silently. It reads both factories now and holds each enum axis to head.ut's pre-paint in both
  directions (the ON value it stamps and the removal that turns it off, since OFF is a bare `:root`).
  Proven by mutation: renaming the factory, drifting palette's ON value and drifting wallpaper's
  attribute each fail the gate.
- **The zone test's "what is a CSS name" pattern is written once.** `fs-sheets.js` carried three
  copies of `/[.#][A-Za-z_][\w-]*/g` — the vocabulary `themeNames()`, `pinnedToApp()` and
  `judgeSheet()` all judge in — under a comment explaining that two copies of the *judgement* would
  drift into disagreeing. A vocabulary that disagrees with itself is the same bug one level down:
  widen it in the harvester alone and names enter the theme's set that the other two can never
  match, so a selector that does reach the chrome reads as pinned and is left unfenced.
- **Each Appearance caption is stated once, not once per reader.** Every axis wrote its label twice
  — the visible caption and the control's `aria-label` — 18 `_()` calls for 9 axes, which is exactly
  how what a sighted user reads and what a screen reader announces come apart. One `group()` helper
  hands the same string to both.
- **Animations follow the motion scale, like transitions already did.** `02-tokens.css` claims one
  scale of four durations; only the *transitions* had been converted, so `fs-fade` — one keyframe,
  one gesture — was ridden at `.14s`, `.16s` and `.3s`, and `.flash`/`.fade-out` at `.35s`/`.4s`.
  `.14` vs `.16` for two pop surfaces is the same drift as the refresh glyph's 19px/18px, and
  invisible to `css-dup` for the same reason: the declaration bodies differ, so it goes quiet. The
  four `ease` keywords went too — `ease` is the initial value of `animation-timing-function`, so
  writing it changes nothing, which `cssdiff` now confirms (0 diffs on that property). `fs-spin` is
  the one deliberate exception and says why in place.
- **Six specificity numbers in comments were wrong.** The rail chevron's justification for a
  66-character selector said `(0,5,3)` against `(0,4,3)`; measured with the same analyzer
  `css-metrics` uses, they are `(0,7,3)` and `(0,6,3)`. The login modal's said `(0,3,2)` where the
  real selector is `(1,3,1)` — the comment had dropped the ID entirely. Every conclusion still held;
  only the arithmetic lied, which is the worst kind of comment to leave standing, and this one had
  already misled a reader.
- **`header.ut` uses the UCI cursor the dispatcher already opened.** It imported `cursor` from
  `uci` and opened a second one on every page render, then re-read `luci.main` — a package
  `dispatcher.uc` pre-loads into `config.main` before calling the template — and left this file
  reaching for UCI a different way than `sysauth.ut` does. Verified on the router across all three
  paths: the saved default, the legacy `footstrap_layout` seed, and both absent.
- **The "is this the top layout?" test is asked in one place.** It was written three times —
  `prefs.isTopLayout()` (one caller), a raw `getAttribute` in `fs-chrome.js`, and `topBarMode()` in
  `menu-footstrap.js` — which is the shape the `data-narrow` lesson warns about; one of those copies
  had already drifted once.
- **The refresh glyph is one size.** De-duplicating the SVG into `--fs-icon-refresh` left its
  geometry free to drift, and it did: 19px in the rail, 18px in the top bar. `css-dup` cannot see
  that — the declaration bodies differ, so it goes quiet. Now `--fs-icon-refresh-sz`.
- **The export tier is parsed in one place.** `devkit-build.mjs` and `export-tier.mjs` each knew the
  tier's shape, and they had already disagreed about `--text-color-highest`; `tools/lib/tokens.mjs`
  is now the single parser both read.

### Removed

- **Ten dead exports, one dead option and two dead CLI flags.** `fit.run`, `fit.watch`,
  `router.navigate`, `prefs.stampDark`, `prefs.snapshotAxes`, two on `fs-sheets` and three on
  `fs-menutree` were on their modules' public API with no caller anywhere. `fit.touches`' `{removed}`
  branch was orphaned by the `wireTabFit` removal above. `css-dup`'s `--min` put the gate's own
  threshold on the command line — `--min 99` passes trivially — in a tool whose header rejects "a
  number nobody defends", and it worked only by accident (`indexOf` → `-1` → `argv[0]` → `NaN` →
  `|| 3`). The functions stay: two gates match `function stampDark(` by text.
- **`stylelint-config-standard`, a dev dependency nothing extends**, fetched by every `npm ci`.
- **`wireTabFit()` — a second MutationObserver and a second resize listener for work `fs-fit`
  already does.** A view renders its `.cbi-tabmenu` into `#view`, which `fs-fit`'s observer watches
  and re-fits **synchronously**, where this copy deferred through `fit.schedule()` — i.e. the
  duplicate was strictly the slower path into the same work. Verified on the router: the bar's
  auto-fitted state equals a forced re-fit at 1440/900/760/700/600/500/1200px.

### Fixed

- **On OpenWrt 24.10 the Name column of every rule table was missing — Firewall → Port forwards and
  NAT rules showed no rule names at all (issue #9).** The two supported releases render that column
  differently and the theme ships one stylesheet for both: 25.12's `form.js` builds the name as a
  real cell, while 24.10 builds none and expects the theme to generate the whole column from the
  row's `data-title` with `::before` — upstream ships a different `cascade.css` per branch, and this
  theme had absorbed 25.12's copy, whose rule is `content: none`. Each row type now asks the markup
  rather than the release (the header carries `data-title` on 24.10 only; a row carries it on both,
  so its discriminator is the real cell 25.12 adds), never the *value* of `data-title` — the
  header's is translated. Reproduced on the 24.10 container and verified unchanged on 25.12.

- **The name of a port-forward or NAT rule was drawn in synthetic bold monospace on 25.12,
  smearing the grid.** The cell carries `.cbi-value-field`, which puts it on the mono face, and
  base makes it bold — but no 700 mono face ships, so the browser synthesised one for the single
  string in the row that is a name rather than a value. A name is a label, so it takes the UI face
  on both releases, which also makes 24.10's generated column and 25.12's real cell read alike.

- **Pages with tabs scrolled hundreds of pixels past the footer into empty space — Network →
  Interfaces and DHCP and DNS were the reported ones (issue #10).** Measured on the router: the
  document scrolled 1841px against 1110px of content on 24.10 and 1925 vs 1439 on 25.12. A hidden
  tab pane is collapsed with `height: 0; overflow: hidden`, but an absolutely positioned descendant
  is only clipped by an ancestor that is in its containing-block chain — and a pane of ordinary
  markup contains no positioned ancestor, so those escaped to the document, kept the position they
  were laid out at deep inside the hidden pane, and inflated a scroll box the theme's own scroller
  cannot even reach. The theme supplied them itself: the toggle switch parks the real checkbox at
  `position: absolute`, so every hidden pane holding a flag leaked one. The collapsed pane is now a
  containing block, so its `overflow` clips what it lays out; nothing paints differently, since the
  pane is `visibility: hidden`.

- **`cssdiff.py`, the tool this project trusts to prove a CSS change is safe, could report changes
  nobody had made — and it did.** It hardcoded `router2512` and ignored `FOOTSTRAP_SSH`, so a pair
  of stylesheets scp'd to the 24.10 container was compared on the 25.12 one, where a stale
  `cascade-a/b.css` from an earlier session was still lying about: 1329 line-height differences
  belonging to no edit. With no stale pair to find it was worse than wrong — `page.evaluate` awaits
  the swap's promise and has no timeout, and a 404 `<link>` fires `error`, never `load`, so the run
  simply hung (measured past 150s). It now takes the host from `FOOTSTRAP_SSH` like every other tool
  here, uploads `--a`/`--b` given as local paths, refuses to start unless both sheets are on the
  router, prints the size and mtime of the two it compared, and rejects on a stylesheet that fails
  to load. A tool whose job is noticing regressions must not be the thing inventing them.

- **Clicking a second menu item while a page was still loading could leave the previous page's
  content under the new page's URL, permanently.** Measured on the router: leave the package manager
  for System after 150 ms and the paints into `#view` land System at 16010 ms, package-manager at
  16490 — the view you walked away from paints *last* and wins. URL, `<title>`, `data-page` and the
  menu highlight all said System while the Software list sat in the page, and only a reload cleared
  it. The router checked its navigation generation before constructing the view, but `LuCI.view`'s
  `__init__` writes to the DOM two `await`s later — and every `await` is a point at which a whole
  other navigation can run, so the check had expired by the time it mattered. The generation is now
  stamped on the view instance and re-checked inside `render()`, i.e. adjacent to the paint: a
  superseded render resolves to a promise that never settles, so the chain simply stops before
  `dom.content()`. This closed the *common* path, not an exotic one — the existing repair only ever
  covered a view's first visit, and after warm-up every navigation is a revisit. Verified by walking
  all 51 clickable menu nodes in both layouts against a real full load of the same URL (46 SPA-OK, 0
  mismatches, 4 intended fallbacks), with the heap flat at 35.1 MB across 20 consecutive races.

- **A deploy to a 24.10 router left the CSS cache-bust token untouched, so the browser kept serving
  the old stylesheet.** `dev-sync.sh` and the deploy skill both touched apk's
  `/lib/apk/db/installed` and nothing else; on opkg that file does not exist, `?v=` never moved, and
  the change looked like a CSS edit that did nothing. Both now touch whichever database the release
  has — the same fallback `luci-base`'s own `pkgs_update_time` makes.

- **The label column and its gap follow the writing direction instead of being pinned to the
  left.** LuCI ships four RTL languages (ar/fa/he/ur), so `.cbi-value-title`'s alignment towards its
  field and `.cbi-value-field`'s gap after the label are logical intents, now written as
  `text-align: end` / `margin-inline-start`. This changes nothing today — nothing in `openwrt/luci`
  sets `dir="rtl"` (zero hits repo-wide) and the theme does not stamp it either — so it is
  groundwork, not a fix a user can see: measured on the router at `direction: ltr`, all 22 labels'
  rendered text moved by 0.00px. Deliberately **not** swept across `.left`/`.right`/`.center` in
  `base/95-luci.css`: those are LuCI's forcing utilities, emitted 59 times by `form.js`, and a class
  named `right` means right in any direction.
- **The chrome-fence gate now fails when a chrome root loses its mark, instead of reporting the
  loss and passing.** It derived the set of `data-fs-chrome` roots from `header.ut`, printed the
  count and then gated only the one in `fs-appearance.js`. Deleting the mark from the skip link
  printed `3 root(s)` and exited 0 — the v0.9.1 damage exactly, which is measured: the popover
  flattened (padding 12px→0, `position: fixed`→`static`) and both sr-only elements un-clipped onto
  every page, while the `<nav>` held. The count is ratcheted now, so adding or removing a root is a
  deliberate edit rather than a silent one.
- **The `--*-color-*` export tier gate measures every level it exports, not the three it was told
  about.** Its family × level matrix was hand-written as `high/medium/low`, while `02-tokens.css`
  also defines `--text-color-highest` — shipped, read by third-party apps, and inspected by nothing:
  painting it `#808080` (~3.95:1 on a light `--fs-bg`, a real AA failure) passed with `OK — 1820
  checks`. The names are parsed from the token file now (1904 checks), and a family the gate cannot
  classify is a hard failure instead of an omission.
- **The gates' own Appearance stamper can no longer sweep an axis the theme does not have.**
  `tools/lib/gallery.mjs` calls itself "THE ONE COPY" of the axis contract and was the forgotten
  one: renaming `--fs-tint-h` there left every gate at exit 0 while `export-tier` reported "28
  palette × mode × tint combinations" and silently measured an untinted page in 21 of them — seven
  distinct results presented as 28. `npm run axes` holds it to the axes it derives from the JS, in
  both directions.
- **A collapsed icon rail no longer paints a bare green glyph where the "Refreshing" pill belongs
  on a phone.** Two rail rules sat outside the `@media (min-width: 521px)` floor that the rail
  block's own comment legislates, carrying only the `[data-rail]` half of the guard. It was
  reachable, not theoretical: `head.ut` stamps `data-rail` from localStorage inline and pre-paint,
  while `data-narrow` is written later by `fitShell()` in an async module — so below 521px every
  other rail rule was excluded while those two matched, until the modules landed, and permanently
  if they failed.
- **Toggling auto-collapse no longer leaves a section's `aria-expanded` claiming it is open.**
  `fs-prefs.js` folded the menu itself with a raw `classList.remove`, satisfying the class and
  leaving the aria stale — the exact disagreement `setOpen()` exists to prevent — then dispatched an
  event asking the menu to repair what it had just broken. The preference module owns storage; the
  menu owns every piece of the open/closed state and applies the change through `restoreAccordion()`,
  which already computes it.
- **`cssdiff.py` can see the changes it is asked to confirm.** Its property list carried no
  `animation-*`, `transition-duration` or `mask-*`, so it reported "0 property diffs" for both the
  refresh glyph's 19px→18px unification and the animation durations snapping onto the scale — unable
  to see either the regression it was asked about or the change it was asked to prove. A clean diff
  is only as honest as the property list behind it, which is the failure this repository already
  records twice; the tool now shows those 13 diffs and nothing else.
- **The SDK checksum step names the file it cannot find, instead of dying with a bare exit code
  mid-release.** `WANT="$(grep … | cut …)"` under `set -euo pipefail` makes the grep's failure the
  command, so a missing line killed the step and the `[ -n "$WANT" ] ||` guard below could never
  print — the same dead-guard shape the step's own comment documents as fixed 45 lines above.
- **A third-party app that builds its CSS with `insertRule()` no longer loses every rule to the
  theme.** The guard against a view's injected CSS re-hosts a `<style>` by re-setting its
  `textContent`, which re-parses the sheet — and a `<style>`'s text is not its sheet: an app that
  appends an empty `<style>` and fills it through the CSSOM leaves the text empty while its rules
  apply. Measured on the router: `.probe-only { color: lime }` came back as `@layer theme {}`, every
  rule gone and nothing reported. That is the exact one-way deletion this code exists to prevent,
  arriving inside the fix for it; the `if (!rules) return` guard could never fire, because a
  `CSSRuleList` is truthy at length 0. The same assumption had holed the duplicate detector from the
  other end — every insertRule-built `<style>` keyed as the same empty string, so the second one was
  **removed** as a "duplicate" of a sheet it shares nothing with. Both now ask what is actually
  applying.
- **The Appearance popover, the skip link and the screen-reader title survive a third-party
  `*{padding:0!important}`.** The chrome's fence named one element, `.fs-sidebar` — but the chrome is
  not one element: the skip link is a sibling of the shell, the popover hangs off `<body>`, and the
  sr-only `<h1>` and live region sit inside the content column. Replaying the previous release's own
  fence text against openclash's real rule: the menu held, and all four of those broke — the popover
  flattened (padding 12px→0) and torn out of `position: fixed`, both sr-only elements un-clipped onto
  every page. A chrome root now declares itself with `data-fs-chrome` where it is written, and the
  fence and the pin read the mark, so a new one cannot be forgotten in a constant somewhere else.
- **A server-rendered duplicate stylesheet is collapsed instead of parsed twice.** The duplicate
  detector was wired only to the `<head>` observer, so the one case the immediate pass exists for —
  CSS that arrives in the *server's* HTML, with no mutation to observe — was never deduped. Measured
  with the real `luci-app-openclash`: it prints the same `<link href=oc.css>` from three templates,
  so its Overwrite Settings page carried two identical links and both `@import` shims made for them,
  parsing 117 KB of CSS twice for the life of the document.
- **The SPA no longer carries an invasive stylesheet into the next page.** The verdict that a
  document is spent is now taken before the fence rewrites the sheet. It used to be re-derived from
  the fenced text and came out right by accident — the old fence left a theme class name in the
  selector, which is what tripped the test. Moving the fence onto an attribute would have made every
  fenced document read clean.
- **`npm run chrome-fence` fails on an inverted fence.** Its four token checks all passed on
  `:where(:not(.fs-sidebar), .fs-sidebar *)` — a plausible botched edit that stops sparing the chrome
  and starts targeting it. The fence and the pin are each one canonical string and are now compared
  whole; ten mutations are checked to fail, including that one. Two vacuous passes went with it: the
  dark-mode guard reported "watches all 0 dialects" when both halves of its comparison came back
  empty, and the pin was matched by position rather than by identity.
- **The build's SDK fallback and the self-updater's signature-host check said what they did not do.**
  Under `set -euo pipefail` a bare `VAR="$(pipeline)"` *is* the command, so a failed release listing
  killed the step before the fallback could run — proven, the branch was unreachable. The
  self-updater's "signature from an unexpected host" can likewise never print, since the signature
  URL is derived from one already checked; it stays as the guard for the day that changes, and now
  says so instead of claiming a bug it fixed.
- **The one expression for "is this page dark" is now the one all three callers use.** Only the guard
  called `intendedDark()`; the applier and the OS listener spelled the condition out again, three
  lines under a comment saying they could not disagree.

### Security

- **CI verifies the OpenWrt SDK by signature, not by a checksum the same host publishes.** The SDK is
  the least verified input in this repository and the only one that ends up *inside* the package
  users install — the two borrowed linters are pinned by commit and sha256 while the toolchain that
  compiles the release arrived on nothing but TLS. `sha256sums` sits in the same directory as the
  tarball, unsigned: whoever can replace one replaces the other, and the check then verifies the
  attacker's SDK — demonstrated, the previous code passes that attack. It is now checked against
  `sha256sums.sig` with OpenWrt's release key, pinned by commit and sha256 and fetched from
  `github.com/openwrt/keyring` so that `downloads.openwrt.org` cannot vouch for itself. Verified end
  to end; a flipped byte gives `verification failed`, a swapped key gives a sha256 mismatch. The
  two branches do not share a key — 24.10 has a release key of its own, 25.12 is signed by the
  unattended-build key — so each matrix leg pins its own beside its channel.
- **The release action is pinned by commit.** `softprops/action-gh-release@v3` was the only
  third-party action, on a mutable tag, in the only job holding `contents: write`. It never sees the
  signing secret and so cannot re-sign, but a tag is a mutable pointer and that is the wrong place to
  trust one.
- **The docs and both installers no longer claim the sha256 survives a missing `usign`.** Nothing
  does: no `usign` is a refusal. The behaviour was always right; the promise was not.

## [0.9.1] — 2026-07-16

### Added

- **A live playground of the theme, published to GitHub Pages.** A real OpenWrt overview page, saved from a live router
  and fully anonymised (every MAC, client IP, IPv6 prefix, SSID and device hostname replaced) —
  the System/Memory/Storage grid, port status, wireless, interfaces and DHCP leases exactly as the
  theme renders them. The
  Appearance button opens the theme's real popover with every control wired up — Layout, Theme,
  Palette, Wallpaper, Tint, Accent, Rounding, Submenus and the icon rail — so you can drag the sliders
  and watch the whole page repaint without installing anything. Nothing navigates (every menu link is
  inert; the menu only opens and closes) and the controls deliberately touch no `localStorage`, so it
  can't change a real router's saved look. The control markup reuses the theme's own classes and
  drives the same `:root` attributes / custom properties the real popover does (the contract in
  `tools/axes.mjs`), so it repaints exactly as the router would. Linked from the README and the devkit.
- **A developer portal for third-party `luci-app-*` authors, published to GitHub Pages.** One
  self-contained page an app author opens to see what to copy, which colour token to read and what
  not to do — the 26-name export-tier grid (live under dark/palette/tint, click-to-copy `var()`), a
  component catalogue with Preview/HTML/`E()` tabs, and the styling rules with the real-app bug
  behind each. It is generated (like `cascade.css`) from the sources that already exist — tokens
  parsed from `02-tokens.css`, components sliced from `docs/gallery.html`, the real stylesheet and
  its fonts inlined — so nothing is hand-copied and nothing drifts.
- **"Fix my styles" — an in-browser checker in the portal.** Paste a chunk of an app (CSS, a
  `<style>`, a DevTools copy) and it points at **each** problem where it is — the line number, the
  source line with the offending fragment highlighted, and, for the mechanical ones, the exact
  before→after edit (click the green to copy just that fix; or "Apply every fix & copy" for the whole
  rewrite at once). It auto-fixes colour literals to export tokens with a literal fallback,
  `--warning-*`→`--warn-*`, private `--fs-*` to the matching export token, stray `!important`, runaway
  `z-index`, `<font color>` — and flags the structural ones it must not auto-touch (`<head>` injection, `:root {}`, un-prefixed classes, `window.onload`,
  `prefers-color-scheme`, a hardcoded editor theme, unscoped stock selectors). Every colour keeps the
  original as a `var(--token, original)` fallback, so a rewrite can never change how the app renders.
  To feed it, paste the CSS directly, drop in a whole **Save Page As** dump (it flags a `<style>` /
  `<link>` living in `<head>`), or run the one-line console grabber on the running app — it harvests
  every `<head>`-injected sheet, every inline `style=` in `#view` and every `<font color>` to the
  clipboard. It drops **nothing** — a prefix filter would have hidden the very un-prefixed classes
  (`.centered`, `.toast`) the codemod exists to catch — and instead tags each `<head>` sheet with its
  first selector, so the theme's own stylesheet, LuCI base's injected bits (`status/cpu.js`,
  `package-manager.js`) and other apps on the page are told apart from yours. Cross-checked on a live
  router against `luci-app-podkop`, `luci-app-justclash` and `luci-app-filemanager` (the last: 38
  colour literals, 14 `!important`, a `<head>` sheet, a `:root {}` and unscoped stock selectors, all
  caught) and a real excerpt of OpenClash's `oc.css`.

### Changed

- **The segmented Appearance controls are one tab stop each and answer the arrow keys.** They carried
  `role="radiogroup"`/`role="radio"` — a promise of W3C-APG behaviour — while every button stayed
  natively tabbable and the arrows did nothing, so a keyboard user tabbed through N stops in a control
  a screen reader had announced as one radio group. They now use a roving tabindex, arrows move *and*
  select with wrap-around, and Home/End jump to the ends. `npm run a11y` was green over this
  throughout: axe checks names and roles, not key handling. The popover also declares `aria-modal`,
  matching the Tab trap it already had.
- **The released `.apk` is built from the newest 25.12.x release SDK, not from `snapshots`.** The ipk
  leg already resolved the newest 24.10.x point release, while the toolchain and `apk mkpkg` behind
  the package users install drifted daily against a release that does not — the same argument, applied
  to both legs.
- **`install.sh` and the self-updater no longer overstate what survives a redirect.** The comment
  claimed the scheme was pinned on the redirect, but `--proto-redir` exists only on the curl branch,
  and `uclient-fetch` — tried first, and the only downloader on a stock router — has none; the host
  pin likewise covers the initial request only. Nothing is less safe than it was (the ed25519
  signature is what vouches for the package and it fails closed), but the docs now say which single
  layer actually reaches across the hop to `objects.githubusercontent.com`, instead of inviting a
  reader to budget three.
- **The Appearance "Reset" button is now labelled "Reset to default".** "Reset" alone did not say
  reset to *what*; the button drops this browser's overrides onto the router-wide default saved with
  "Save as default", so the label now names that destination.

### Fixed

- **Opening an OpenClash page no longer flips the whole theme to dark against your explicit choice.**
  Pick Light in Appearance, run an OS that is set to dark, open Services → OpenClash, and the entire
  UI went dark — reproduced on the router: `data-darkmode` `false` → `true`, page background
  `rgb(246,248,250)` → `rgb(28,33,40)`. `luci-app-openclash` stamps `data-darkmode="true"` straight
  onto `:root` from seven of its templates, gated on its own `isDarkBackground()`
  (`openclash/js/common.js:12`), which consults `matchMedia('(prefers-color-scheme: dark)')` **before**
  it ever looks at the page's real background — so your OS setting silently overrode the choice you
  made here. Its `select_git_cdn.htm:117` also `removeAttribute`s the very attribute this theme writes
  as `'false'`. The theme now watches the three attributes it owns and restates the truth. This is not
  a cascade problem and no layer, specificity or `!important` could have answered it — it is a DOM
  write. The guard corrects a wrong premise rather than fighting the app's intent: when the page
  really is dark, OpenClash's write **agrees** with ours and the guard never fires, so its own
  `[data-darkmode="true"]` rules (197 selectors) keep working exactly as its author meant. Verified
  across all six combinations of {OS dark, OS light} × {Light, Dark, Auto}. Only the published trio
  (`data-darkmode`/`data-theme`/`data-bs-theme`) is guarded — being published to apps is precisely
  what puts it in their vocabulary; the theme's private axes are not, and a survey of ten shipping
  packages found none that writes any of them.
- **A third-party rule on `html` or `body` can no longer reach into the menu by inheritance either.**
  The fence below stops a foreign selector *matching* a menu element, but inheritance is the way in it
  cannot close: a rule on an ancestor needs no match at all, the value simply arrives from above.
  Measured on the router against a hostile `html` rule with every declaration flagged: `font-style`
  reached **166 of the menu's 169 elements**, `word-spacing`/`text-align` 157, `letter-spacing`/
  `text-transform` 156, `cursor` 46 — while `font-family`, `color`, `font-size`, `line-height` and
  `font-weight` reached **none**, because the chrome already stated those itself. It now states the
  rest, and that closes it: **0 of 169**. No `!important` was needed and none was used — inheritance
  is not a cascade competitor, it only supplies a value where no declaration matches, so any
  declaration of ours beats an inherited flag. The pin sits on the chrome ROOT alone and deliberately
  not on its descendants: a direct declaration beats an inherited one *even when the inherited one is
  ours*, so pinning descendants broke the chrome's own inheritance — measured, it cost `.fs-label` the
  `nowrap` it inherits (labels would wrap), `.fs-railtoggle` its centring, and forced `text-align`
  from `start` to `left` on 302 elements, which would have broken every RTL language LuCI ships.
  Pinning the root breaks the chain from `html` once and lets the chrome's own inheritance flow on:
  `cssdiff` reports **0 property differences across 2378 elements**, so nothing about normal rendering
  changed at all.
- **The menu is now unreachable by a third-party app's CSS — including its `!important`.** Re-hosting
  an invasive sheet into the `theme` layer settles a fight on specificity, but it cannot settle one
  against a flag: importance ranks **above** layers, so `* { padding: 0 !important }` still owned the
  sidebar, and so did `#indicators { display: none !important }`. The chrome uses names that are not
  `fs-*` — `nav`, `indicators`, `modemenu`, `topmenu` — and `.nav` is one of the most common class
  names on the web, so this was never hypothetical. Rather than out-rank the rule, the theme now puts
  the menu where it cannot be addressed: a foreign selector's subject gets
  `:where(:not(.fs-sidebar, .fs-sidebar *))` appended, and `!important` has nothing left to win.
  `nav.fs-sidebar` is the one chrome root for **both** layouts (the top bar is the same markup), so
  one fence covers the sidebar and the bar alike. Measured across the real stylesheets of eight
  shipping packages: menu damage **47 → 0** on OpenClash and **1 → 0** on MosDNS (whose bundled
  CodeMirror ends with `span { cursor: unset !important }`), and zero on the other six. The
  alternative — our own flag in an earlier layer, which does beat a foreign flag — would have meant
  ~550 `!important` and, since `color`/`background` are among them, would have overridden this
  theme's own `forced-colors` block: fixing the cascade by breaking high contrast. `:where()` is
  load-bearing rather than cosmetic — it contributes **zero** specificity, so every app rule keeps its
  exact weight everywhere except inside the menu; a plain `:not()` would take its argument's
  specificity and silently re-order an app's stylesheet against itself. Only selectors that are not
  pinned by a name of the app's own are fenced, because a pinned one can never reach the chrome in the
  first place — the same test that decides whether a sheet is invasive at all.
- **A third-party app's global CSS reset no longer wrecks the theme's own chrome on that app's page.**
  On `luci-app-openclash` the sidebar lost its indent (menu text flush at x=0, icons clipped off the
  left edge), the section tabs collapsed to a bare row of text and the cards lost their padding — and
  it happened only on footstrap, which is the tell. OpenClash's `oc.css` carries a reset meant for its
  own log page, `* { margin: 0; padding: 0 }`, and leaks it document-wide through a plain `<link>` its
  Lua template prints into the content area. Reproduced on the router from those two rules and nothing
  else. The cause was ours: every footstrap rule lives in a `@layer`, and an **unlayered** normal
  declaration beats a layered one at **any** specificity — so a `*` at 0,0,0 outranked the chrome's
  0,3,1. Stock `luci-theme-bootstrap` declares no layers, so there the same `*` loses on specificity
  and nobody ever saw it. Such a sheet is now re-hosted into the theme's existing `theme` layer
  (`fs-sheets.js`), which puts it back on specificity footing: `*` loses to the chrome, while the app's
  own `#tab-header ul.cbi-tabmenu li` (1,1,2) still beats our `ul.cbi-tabmenu li` (0,1,2) and its page
  looks as its author intended. Measured all three placements — giving the app a layer *below* the
  theme also fixes the chrome but repaints the app author's own widgets, which is why it sits in
  `theme` and not in a new layer of its own. The sheet is never deleted (that once cost ACE its editor
  and broke SSClash): a `<link>` is disabled and its rules re-imported via `@import … layer(theme)`, so
  every rule still exists and an app that looks its own `<link>` back up by href still finds it.
  Reported in #8 (iStoreOS 24.10.7).
- **The realtime graphs (Status → Realtime *) no longer lose their right-hand edge — which is where
  the newest samples are.** Every one of them — Load, Bandwidth, Wireless, Connections, and the
  third-party `luci-app-*-status` pages that copy them — sizes its drawing from `#view`
  (`width = document.querySelector('#view').offsetWidth - 2`) rather than from the box it actually
  draws into. That holds only in a theme whose `.cbi-section` has no gutter, which is why
  `luci-theme-bootstrap` is fine; ours is a card with 16px of padding and a 1px border, so the canvas
  was 34px narrower than the drawing and those 34px were clipped off the right (measured on the
  router, every realtime page, every width: `#view` 1158 against an svg of 1124). It reads as a phone
  bug because the loss is absolute, not proportional: 34px is 3% of a 1124px desktop plot but 10% of a
  322px phone one. The graph box is now bled back out to the card's border edge, so the canvas is
  exactly `#view - 2` again; the bleed is derived from the card's padding (now the `--fs-card-pad`
  token) rather than restated, so narrowing the gutter can't silently re-clip every graph.

- **Status → Channel Analysis draws the 5GHz graph again, instead of a blob squashed against the left
  edge.** Only the tab that happened to be open at page load got a real graph; every other radio's tab
  was collapsed onto x≈0 — no channel grid, no channel numbers, every network stacked in a smear —
  and it stayed that way for the life of the page, because nothing re-measures it. The theme was
  hiding an inactive tab pane with `display: none`, and a `display: none` element has no width: stock
  `channel_analysis.js` builds its channel axis from `graph.offsetWidth` in a
  `requestAnimationFrame`, ONCE, so for a pane that starts inactive it read 0 and spaced every channel
  0px apart (measured on the router: grid x-span 0px against the 1147px it needs). Inactive panes are
  now hidden with `visibility: hidden` — which keeps the pane laid out at full width while still
  taking it out of the accessibility tree and the tab order — and the `height: 0; overflow: hidden;
  padding/margin/border: 0` that were already there keep it out of the scroll and stop it drawing a
  phantom strip. That is exactly how `luci-theme-bootstrap` hides a pane, which is why the page was
  never broken there. `display: none` bought nothing over zeroing the box: Network → Interfaces
  measured the same 1039px of scroll height either way, Network → DNS the same 1347px.

- **The "Flash image?" dialog no longer paints with its left half off the screen on a phone.** The
  dialog was there and working — it had just been scrolled sideways out of reach. `#modal_overlay` is
  the scroll container and the dialog is centred inside it with `margin: auto`, so a single child too
  wide to wrap drags the modal's own left edge past the viewport. Two stock LuCI children did it, and
  both are prose: `flash.js` writes each checkbox row as a `<label class="btn">` wrapping a whole
  sentence ("Include in backup a list of current installed packages at
  /etc/backup/installed_packages.txt"), and `.btn` is `white-space: pre` — correct for a button's own
  label, fatal for a sentence, since it cannot wrap at any width; the `<li>` carrying the image's
  SHA256 is one unbreakable 64-char token with nothing to break at. Measured at a 360px viewport: the
  overlay's scroll width was **634px against 530px of visible room**, the widest label ending 132px
  past the modal's right edge; both now land inside it. The wrap is scoped to `label.btn` inside a
  modal, so a real button keeps `pre`. `docs/gallery.html` renders the dialog now — the shape was
  unrepresented, which is why no contrast or computed-style sweep had ever looked at it.
- **The menu no longer closes itself once a second on a phone.** Tapping a section open and having it
  snap shut a second later was the poll doing it: `fitShell()` wrote `data-narrow` with
  `setAttribute` on every measure, and a same-value `setAttribute` still **queues a MutationObserver
  record** (measured in Chromium: 5 identical writes → 5 records; `toggleAttribute` on an
  already-present attribute → 0). Since `fs-fit` re-measures on every mutation inside `#view`, and
  LuCI's poll rewrites that once a second, the menu's `data-narrow` observer read each no-op write as
  a mode *change* and ran `closeFlyouts()`. It bit only the narrow sidebar (390 − 224 − 56 = 110 px of
  content, so the attribute is permanently set) — the wide and top layouts take the `removeAttribute`
  branch, which is silent when the attribute is absent, which is exactly why it survived: it is
  invisible on a desktop.
- **Saved Appearance defaults survive a theme upgrade.** `/etc/config/footstrap` is shipped as an
  empty stub and written at runtime by Appearance → "Save as default", but was never declared a
  conffile — so the package manager owned it as an ordinary file and replaced it on upgrade, and the
  theme's own one-click Update silently wiped every saved option while reporting success (the dev
  router held eight). One `conffiles` define covers both managers; `npm run conffiles` now fails if a
  shipped `/etc/config/*` is left undeclared, because nothing about this failure is observable — it
  lands on someone else's router, months later, at the moment they upgrade.
- **A broken stylesheet can no longer be left in place by the build.** `build-css.sh`'s floor check —
  the guard against a truncated write or a squeeze that ate the tail — ran *after* `mv` and after the
  cleanup trap was disarmed, so its own failure path left the mangled sheet at the output path.
  `dev-sync.sh` writes straight into `htdocs/`, so that file stayed in the working tree for the next
  `scp` to ship. The floor is now measured before the move, with the trap still armed.
- **`dev-sync.sh` deploys `root/` as a tree, so a new file reaches the dev router for free.** It
  tarred `usr` literally — a hand-written list of one, the very thing its own comment forbids — and
  `root/etc/` was the counterexample already in the tree: `root/etc/config/footstrap` shipped in the
  package and never reached the router. It now globs the top-level dirs, excluding only the two
  subtrees with real semantics: `uci-defaults` (deliberately run from `/tmp`) and `config`, which is
  installed only when **absent**, mirroring what the package manager does with a conffile — deploying
  over a live one would be the very wipe the fix above prevents.
- **The playground's top-bar menu no longer sticks a clicked dropdown open forever.** It click-toggled
  `.open` and never cleared it, so a tapped panel stayed on screen when the pointer left — the one way
  the demo diverged from a live router. It now mirrors `menu-footstrap.js`: in flyout mode (top bar /
  rail / narrow) a tap sticks the panel only until a real mouse re-enters (CSS `:hover` takes over) or
  a click lands outside/Escape closes it; the expanded-sidebar accordion is untouched, where `.open`
  legitimately persists.
- **The Wireless "Associated Stations" table no longer wraps Signal/Noise and the RX/TX rate onto
  extra lines** (issue #7). `overflow-wrap: anywhere` split the short "-54/-90 dBm" wherever a
  character landed and stacked the modulation string ("229 Mbit/s, 20 MHz, HE-MCS 9, HE-NSS 2") into
  6-9 lines per client — at ~1024px the whole table was a nine-line mess (measured on the router).
  Both columns are now nowrap, like the MAC already was, which also raises the table's floor so
  `fs-select.js` folds it into the clean per-field card a step earlier instead of crushing the
  columns. The Signal reading sits inside an `.ifacebadge` that re-declares `white-space: normal`, so
  its own text takes the nowrap too. Host is left to wrap — a hostname plus IPv6 is legitimately long.
- **The collapsed sidebar (icon rail) no longer leaves 1px specks of the hidden submenu at its edge**
  (issue #7). The sidebar was `position: sticky`, which the browser promotes to a composited GPU
  layer; with `overflow: visible` (needed so the rail's flyouts escape sideways) every hover repaint
  of the column left a 1px seam of the flyout's buttons/headers at the layer's edge, cleared only by a
  full repaint — visible on the live collapse and on hover, never on a fresh load. The desktop sidebar
  is now a STATIC element (not a layer, so nothing can be left stale) and the content column scrolls
  inside `.fs-main` instead of the window. It also drops the z-index the sticky layer needed: a static
  sidebar is no stacking context, so the flyouts sit above the content on their own `--fs-z-flyout` in
  the root context. Confined to the desktop sidebar via the `:not([data-narrow])` guard — the top
  layout and the phone bar keep window scrolling and their sticky bar.
- **Hovering the Diagnostics page no longer highlights the whole controls block, and empty tables
  no longer light up their "no data" row** (issue #5). A single generic `.table .tr:hover` tint hit
  every table, including layout tables the theme never meant to make interactive: the Diagnostics
  input+button row is one `<tr>` spanning the whole card (no header row, so it is never tagged a data
  table), so hover lit the entire block; and a data table's placeholder row ("There are no active
  leases") lit up on hover the same way. Row hover is now scoped to real data tables (per cell,
  placeholder excluded) and config-table data rows only.
- **The device/MAC badge in the Network status box now follows the rounding scale instead of a flat
  4px** (issue #5). It kept the base widget's hardcoded 4px corners, which read as square next to the
  card's `--fs-radius`; it now uses the token, so it rounds with the Appearance Rounding axis. Scoped
  to the status box — the small firewall zone badges stay tight.
- **The "Keep settings" checkbox in the firmware-upgrade confirm dialog no longer hugs its label
  text** (issue #5). The attendedsysupgrade dialog renders `label.btn > input[type=checkbox]` + text,
  and the base rule that zeroes a checkbox's margin left only a literal space between the ✓ and the
  words; a `.btn > input[type=checkbox]` margin restores the gap without touching the toggle switches.
- **A failed "Save as default" now shows a visible message instead of a silent tooltip.** On a
  rejected save rpc — most often an expired login session — the old code parked the error in a
  `title` attribute nobody hovers, so the click looked like it did nothing; the popover now shows
  "Could not save the default. Reload the page and try again." in place of its (absent) status text,
  with the raw rpc error kept in the tooltip for debugging. Note this does not cover a *deleted*
  `/etc/config/footstrap`: rpcd stages the write in the session and the commit then silently no-ops
  without recreating the file, returning success (measured on the router) — that file is owned by the
  package, and the read side already falls back to the built-in defaults.

## [0.9.0] — 2026-07-15

### Added

- **Appearance now has "Save as default", which stores the current look as the router-wide default
  for every browser and device.** Until now the whole popover lived only in the browser's
  localStorage, so a second device — or a cleared cache — started from the built-in defaults. Save
  writes all eight axes (layout, theme, palette, wallpaper, tint, accent, rounding, submenus) into
  `/etc/config/footstrap`; the server stamps them before the first paint, so a fresh browser inherits
  them with no flash. The write goes through a scoped rpcd ACL that grants the session `uci` write to
  the `footstrap` config only — rpcd validates every name, so no value reaches a shell. **The browser
  always wins**: this device's own choice, stored explicitly, overrides the saved default in either
  direction (you can still turn a router-defaulted tint back off), and "Reset" clears this browser's
  overrides so it drops back onto the saved default. A router upgraded from the old top-nav theme
  keeps reading its `luci.main.footstrap_layout` migration seed as the layout fallback.

### Changed

- **The header logo box is now the same size as the other square buttons in the bar (34px).** It sat
  at 30px while Appearance, Log out and the collapsed "Refreshing" pill were all 34 — the one odd
  square in the right cluster's row. The size is now a single token (`--fs-btn-size`) that all four
  read, so the row stays a set of equal squares and can be retuned in one place. The mark inside the
  box grew from 17 to 20px to fill the larger square.
- **The header logo now shows the OpenWrt favicon mark in a bordered box.** The accent-gradient tile
  behind the logo is gone; in its place is a plain 1px border, the same treatment the square buttons
  in the right cluster carry (Appearance, Logout). The glyph is the mark the browser tab already
  shows. Its ring follows the theme mode — dark on the light UI, light on dark — the way the SVG
  favicon follows `prefers-color-scheme`, though the logo reads the theme's own dark-mode flag rather
  than the media query. The cyan arcs are fixed and stay legible in both modes.
- **The top navigation bar now collapses by measurement at every width, and the "Refreshing"
  indicator shrinks to an icon before the menu wraps to a second row.** The bar used to switch to a
  phone layout at a hard 768px breakpoint; now `fitChrome` (the ResizeObserver) shrinks the menu
  pills, then swaps the "Refreshing" pill for a bordered green icon square — grey when the poll is
  paused, matching the Appearance and Log out buttons — freeing ~56px that is often enough to keep
  the menu on the brand's row, and stacks onto a second row only when even that overflows. No 768px
  floor: whether the menu fits depends on how many sections the router has, not on the screen. The
  sidebar layout keeps its own measured phone bar (`data-narrow`), untouched.

### Fixed

- **A section's dropdown jumped to the bar's left edge once the top menu wrapped to two rows.** Below
  the old 768px breakpoint the top bar fell back to a phone layout that pinned every dropdown to the
  bar's left edge, so a wrapped menu could show Network's submenu under Status. With the bar now
  measured at every width, each dropdown stays anchored under its own item, and the existing clamp
  keeps it inside the viewport.

## [0.8.9] — 2026-07-15

### Added

- **A gate against the whole class of bug above: no CSS rule may key off a `data-title` VALUE**
  (`npm run css-i18n`, and a CI step). Reading the attribute is fine — that is how a carded table
  prints its column labels — but matching it means matching a translated, render-dependent UI
  string, and the failure is silent in both directions: dead in every language you do not speak, and
  dead everywhere if your own stylesheet uppercases the heading. Presence tests (`[data-title]`) stay
  allowed.

### Changed

- **The 1676-line `menu-footstrap-common.js` is now one module per concern.** It had grown to hold
  seven unrelated things at once — the Appearance axes, the disclosure primitives, the menu-tree
  resolution, the chrome render and its measurements, the SPA router, the third-party-CSS guard and
  the self-updater — and a file that large stops being read: the same `EDGE_GAP` was written twice,
  and the update UI reached its own refresh through a `window.__fsUpdateApply` global for want of a
  seam. Split into `fs-menutree` (path ⇄ menu node, the port of `dispatcher.uc`), `fs-prefs` (the
  axes and their localStorage), `fs-widgets` (disclosure primitives, seg/slider controls, popup
  placement), `fs-chrome` (mode menu, tabs, rail, `fitShell`/`fitChrome`), `fs-router` (the SPA
  router), `fs-sheets` (the injected-CSS guard), `fs-update` (`FS_VERSION`, the check, the one-click
  install) and `fs-appearance` (the popover DOM); `menu-footstrap-common.js` keeps only the
  bootstrap. Nothing changed behaviourally — verified on the router: the chrome renders, an SPA nav
  still swaps the view in place (no full load), Back works, the popover builds all nine groups and
  the axes still apply, with zero console errors; jsmin's output stays token-identical for all 13
  shipped files.
- **Modules compose by CALLING, and the runtime enforces the graph.** `L.require` instantiates each
  module once as a singleton, so a module cannot subclass another (docs/11), and it raises
  `DependencyError` on a cycle — so shared halves (`fs-menutree`, `fs-prefs`) were pulled DOWN into
  their own modules rather than reached across, making the graph a DAG the runtime itself checks.
  Dependencies resolve through `Promise.all`, so the extra files cost round-trips in parallel.
- **The minified-JS ratchet goes 47104 → 50176 B, and that is what the split costs.** 46 621 →
  49 121 B, +2 500 B (+5.4 %): every module adds its own pragmas and `return baseclass.extend({…})`,
  and each call across a seam grows an alias prefix. uhttpd does not compress, so these are wire
  bytes — the raise is a deliberate trade for no file over ~600 lines, not drift.

### Fixed

- **The zone colour spilled past the rounded corner of an interface box** (issue #7). Network →
  Interfaces draws the zone as an inline background on `.ifacebox-head`, and `base` pairs a 4px box
  with a 3px head so the two round together — but `theme` bumped only the BOX to `--fs-radius`
  (10px by default), leaving a 3px head whose square corners cut straight through the rounding. The
  head now derives its radius from the box's, minus the 1px border it is inset by, so the two round
  together at any setting of the Rounding axis.
- **A MAC address still broke across two lines on every non-English router** (issue #7). The nowrap
  that was supposed to stop it keyed on `[data-title="MAC address"]` — and LuCI fills `data-title`
  from the column HEADING, so on a Russian router the cell says `MAC-адрес` and the rule matched
  nothing. It was fixed, released, and the reporter kept seeing the bug, because the fix only ever
  worked in the language it was written in. Anchored on the column instead; a translation cannot
  reorder columns. The same dead-in-40-languages pattern was in the DHCP leases table (DUID, the
  IPv6 list, the hostname) and is fixed with it.
- **A package-manager rule matched nothing at all, on every router, in every language.** The stacked
  card's Description cell keyed on `[data-title="Description"]`, but LuCI builds that table's cells
  from the heading's `innerText` — and the theme's own `text-transform: uppercase` on `.th` means the
  attribute really reads `DESCRIPTION`. The theme's CSS was rewriting the string the theme's CSS
  matched on, so the cell never got its block layout (measured: 0 elements matched). Anchored on the
  column; the layout now applies.

- **Three gates were aimed at one filename and would have gone quiet.** `tools/axes.mjs` read the
  Appearance contract out of `menu-footstrap-common.js` by name, so an axis living anywhere else
  would have been checked by nothing; it now reads the whole resources tree, which cannot go stale
  that way. The ESLint globals for `'require x as y'` aliases were a hand-written per-file list —
  the exact shape that stopped covering the next module added — and are now derived from each file's
  own pragmas, which also keeps `no-undef` able to catch a file using `prefs.` without requiring it.
  `Makefile` and `dev-sync.sh` stamp `FS_VERSION` by `sed`-ing a path, so both now point at
  `fs-update.js`; had they not, the popover would have silently shown "(dev)" and the update check
  would have stopped.
- **`css-orphans` reported a live selector as dead CSS, because it blinded itself to a NAME.** Module
  names were ignored by name so their `require` pragmas would not read as classes — which broke the
  moment a module was named after markup it owns: `fs-appearance` is both a module and the id of the
  button that opens it, so the ignore also hid the real `#fs-appearance`. It now blanks the
  POSITIONS a module is referenced from (the pragma line, `L.require('…')`) and the positions an
  `fs-` token is not a class (`--fs-*` custom properties, `data-fs-*` attributes), so a name can be
  shared between a module and its markup without lying to the tool.

## [0.8.8] — 2026-07-14

### Fixed
- **Software page on a phone: `filtered / all / none` stood one per line.** The rule that stacks that
  page's control titles was written as `.controls label`, so it also blocked the three radio labels
  nested a level deeper inside the group. It targets the group's own title label now
  (`.controls > div > label`), and the three choices sit on one row — at 320px too.
- **Software page on a phone: the pager broke onto three lines, and the package list still printed a
  column header it no longer needed.** Both are the same shape of bug — a rule aimed at one thing
  hitting another that merely shares its element name.
  The pager (`«` / `Displaying 1-100 of 7677` / `»`) is a `<div class="pager">` inside a `.controls`,
  and the phone rule that stacks that page's *labelled control groups* is written for
  `.controls > div` — so it blocked the pager too and its three children went one per line, 97px tall
  where 43 will do. It excludes `.pager` now.
  The header is the same story one layer up: `pages/30-software.css` shapes a carded row with
  `#packages.fs-stacked .tr`, and an **ID selector in the `page` layer** outranks
  `theme/30-tables.css`'s `.table.fs-stacked .tr.cbi-section-table-titles { display: none }` — so the
  column header came back on a screen where every cell already prints its own label. Both header rows
  are excluded from that rule.
  Desktop is untouched: 0 computed-style diffs over the package list, the overview and DHCP.
- **Port status: on a Russian router, a port that was DOWN but had carried traffic pushed its figures
  out of its own card and under the next one** (issue #7). The tile is a two-column layout — speed on
  the left, TX/RX on the right — and "do those two still fit side by side?" was answered by a
  `@container` threshold of 158px. A threshold is a **proxy for a question about the content, and this
  one was calibrated on English**: `no link` is ~45px against `нет соединения` at ~100px, and the
  figures are `nowrap` by design (`▲ 151.2 MiB` ~85px against ~35px when the counters read zero). That
  combination needs ~193px inside a card whose content box is 178 — so the threshold never fired, and
  a grid does not wrap: it overflowed. With the counters at zero the same card fitted, which is exactly
  what the reporter saw.
  The layout is a wrapping flex row now, which asks the real question for free: the two cells share a
  row while they fit and the figures take one of their own when they do not. Both `@container`
  thresholds are deleted — **removing them is the fix**, not a side effect. No JS: an observer (the
  first thing considered) would have to re-measure on every poll, since `29_ports.js` rebuilds these
  tiles every 5 s, to compute what the layout algorithm already knows.
  Three traps on the way, each caught by measuring rather than reading: `flex-basis: 100%` does not
  resolve on this card (it carries `container-type: inline-size`, so the main size is not a definite
  length — `width: 100%` is what works); `margin-left: auto` is counted when Chrome breaks lines, so
  the figures wrapped even on a card they fitted; and switching the card from `grid` to `flex` woke up
  a `flex-direction: column` that `base` has always set on every `.ifacebox` and that the grid had made
  moot — everything stacked into a column until the axis was stated.

## [0.8.7] — 2026-07-14

### Added
- **The widget gallery renders LuCI's real `ui.FileUpload`** — closed, and with the file browser
  open: the listing rows, the breadcrumb and the `Browse… / Filename / Upload file` strip, with the
  class names `ui.js` actually emits. It was represented by a bare `<input type="file">`, which
  shares none of that markup and so hid the clipped-button bug above from every check the theme has.
- **The gallery also renders the tooltip colour words, `.cbi-select` (valid and rejected) and an
  alert's full body** (`h5`, a list, a `<pre>`) — the widgets whose styling could not be settled
  either way while nothing drew them.
- **`galdiff.py`: a computed-style differ for the gallery**, and the reason the change above could
  be made safely. `cssdiff.py` drives a live router page, so it only ever sees widgets some page
  renders — exactly *not* the ones the absorption backlog is about; on those it reports no diff
  whatever you delete. The gallery has them all, so a base rule that still does work shows up as a
  real diff. It needs no router.

### Changed
- **Three `!important`s are gone from `styles/base` (33 → 30), and they are the three that should
  never have been there.** A flag in `base` is a flag aimed at the theme — `!important` inverts the
  layer order — so the rule this project writes down is that a flag must fight an *inline* or
  *unlayered* declaration, never another footstrap rule. These three fought footstrap: `.cbi-dropdown`'s
  `display` and `padding` were flagged to beat **base's own** generic form-field rule (which sets
  `display: inline-block` / `padding: 4px` on that very selector at a higher specificity), and
  `.spinning`'s `padding-left` was flagged to beat *them*. A later layer answers the first two for
  free and one specificity ladder answers the third, which is exactly what the layer split is for.
  Computed styles are identical — over the gallery and over three router pages, 0 diffs — and the
  ratchet is tightened to 30 so they cannot drift back.
  The remaining 30 all earn their place, and now provably: the six dropdown-state flags, the six
  forcing utilities (`.td.right` and friends — LuCI writes them on a cell *to* override the table's
  own alignment, and they lose to it on specificity alone), and the flags that fight an inline
  `style=`, an unlayered `<style>` blob, or `prefers-reduced-motion`.
- **CI is off the deprecated Node 20 runtime.** Every action was three or four majors behind
  (`checkout@v4` → `v7`, `setup-node@v4` → `v5`, `upload/download-artifact` → `v7`/`v8`,
  `action-gh-release@v2` → `v3`), and GitHub was already force-running them on Node 24 while
  warning on every job — the one piece of debt here with somebody else's clock on it. The inputs
  this workflow passes are unchanged across those majors; `download-artifact@v8` additionally turns
  an artifact hash mismatch into an error rather than a warning, which is the direction this
  repository's release path wants anyway.
- **The validation tooltip is themed now, and half of the base layer's absorption backlog is
  gone with it (50 declarations → 25).** `.cbi-tooltip`'s colour words were the one status surface
  the theme had never claimed — base carried them, and a comment there said so in as many words.
  Nothing could contradict it: the gallery rendered a *plain* tooltip only, and an un-rendered
  widget shows no diff, which reads as "that rule is already dead". The gallery renders all four
  now, and the measurement said the opposite — they were alive and un-themed. They are the theme's,
  in tokens.
  The same instrument then settled the rest of the backlog by measurement rather than by reading:
  every `border-color` base declared for a button variant (`.cbi-button-edit`, `-apply`, `-save`, …)
  turned out to be **dead on arrival** — the theme sets `border` on `.cbi-button`, and a later layer
  beats an earlier one whatever the specificity, so those buttons never wore the colour base
  declared. Deleted. What was genuinely alive got absorbed: the dropdown's width and its menu rows
  (the Save & Apply split button's menu had kept base's tight rows while every other dropdown was
  themed), the `…` overflow chip beside the chevron, the `<var>` in a form row, the invalid state of
  a `ui.Dropdown`, and an alert's `h5`/`ul`/`li`/`pre`.
  What remains in base is base doing its documented job — the focus ring and the transition every
  *unnamed* `input`, `button` and `select` falls back on. Absorbing those would mean the theme
  claiming every bare element selector, and the layer split exists precisely so overrides do not
  depend on source order.

### Fixed
- **The file browser clipped its own buttons: `Delete` was served sliced by the widget's border.**
  LuCI's `ui.FileUpload` sizes a listing row by proportion — name `flex: 10`, actions `flex: 3` —
  which fitted the ~20px buttons stock LuCI draws there. This theme's button is 36px tall with 14px
  of side padding, and a file row carries up to three (Deselect, Download, Delete): at 23% of the row
  they do not fit, and the row is `overflow: hidden`, so a button touched the clip box on **both**
  axes and lost its rounded corners to it — which reads as a broken button, not as a missing 8px.
  With no space between rows, one row's button also ran into the next row's. The action column is
  sized to its content now (a name can ellipsize; a button cannot), the browser has a real gutter,
  and the rows are spaced. Reaching this widget on a router takes two clicks inside a page most
  users never open, which is why it went unseen — `docs/gallery.html` now renders it open, so the
  next regression there is visible without a router.

- **Data tables rendered outside a CBI section drew a straight border across their own rounded
  corner, and every separator twice.** The apk package list and Status → Firewall's nftables tables
  are the live cases (issue #7). The theme declared a table's separators on the `.tr` — but the
  frame those tables carry needs `border-collapse: separate`, and **in the separated model a row's
  border is never painted**, so those rules drew nothing at all. What actually drew the lines was a
  per-cell `border-top` left over in `base`, which nobody had asked for: it also ran along the
  table's top edge, straight across the frame's radius. The separators are declared on the cells
  now, where they paint. Note this is one fix, not two — the first attempt removed the base border
  alone and shipped a package list with no separators whatsoever.
- **A button in a `.control-group` sat on top of the input next to it** — package-manager's
  Filter/Clear and "Download and install"/OK (issue #7). `.control-group` is bootstrap's *joined*
  input-group: base pulled the button back over the input so their 1px borders would coincide, and
  squared its left corners to match. This theme does not join controls, and a cascade layer beats
  base unconditionally, so the squared corners never applied while the pull-back still did — the
  button's rounded corner landed on the input's. They get a real gap now. The password reveal is the
  one group that genuinely is joined, and it builds its own seam.
- **Status → Firewall (nftables): the table header text was glued to the table's rounded frame.**
  Those tables carry `.cbi-section-table` but sit in a bare `<div>`, and that class zeroes the cells'
  left padding — correct only inside a `.cbi-section`, whose own 16px is the gutter. A table that
  draws its own frame now pads its own cells.
- **A MAC address in the associated-stations table broke across two lines** (issue #5); stock LuCI
  keeps it on one. Data cells may break anywhere — that is what reflows a wide table into the
  content column instead of scrolling it — but a MAC is not a breakable string, and at ~103px the
  column split it every time. Same targeted `nowrap` the DHCP leases table already uses.
- **A text field in a CBI form was too narrow to show its own value** — Attended Sysupgrade's server
  URL was clipped mid-domain (issue #5). The field was a fixed 210px, inherited from bootstrap's
  cascade, and that width holds far less here: the field is monospaced and padded 11px a side
  instead of 4. It is elastic now, capped at the same 440px as the `.cbi-dynlist` directly beneath
  it on that page — the mismatch between the two is what made the field look broken.

- **The README screenshots advertised a dashboard the theme does not have.** They were taken the day
  before the custom overview include was retired (it rebuilt a page-tall tree on every poll, which
  flickered and reset scroll on a phone), so they showed a Network card and a port grid this theme
  has not rendered since — and a user reasonably filed that difference as a rendering bug (issue #5).
  Regenerated from the current theme. The GIF was recorded after the change and was already correct.
- **The favicon was a flat cyan tile that fought every browser's tab strip.** The mark stays
  OpenWrt's on purpose — a tab icon says which *device* this is, not which theme paints it — but the
  solid square it was pasted on is gone: the icon is transparent now, so it sits in whatever the
  browser draws (issue #7). The SVG also lightens its dark ring under `prefers-color-scheme: dark`,
  where a near-black ring on a dark tab strip was all but invisible; `logo_48.png` is the fallback
  for browsers without SVG favicons and carries the light variant. It is also **320 bytes now,
  against 2 337** — uhttpd serves `/www` with no compression, so that is wire bytes.

## [0.8.6] — 2026-07-14

### Changed
- **The whole `docs/` tree now describes the theme that exists.** All twenty documents were checked
  claim by claim against the code. Two were deleted: `docs/10` (85 of its 94 lines specified a
  top-nav renderer that was removed — its one unique piece, `clampDropdown`, lives in
  `menu-footstrap.js` with a fuller comment) and `docs/12` (80% a worse copy of `docs/gallery.html`,
  and it "covered" a `.cbi-fileupload*` selector that exists in neither LuCI nor this theme). The rest
  were corrected: every token name they printed was dead (`--accent` → `--fs-accent`; the export tier
  was called a "bridge" when it is one-way and reading it from inside `styles/` fails the build), the
  layout was still described as a server-side theme entry, `dev-sync.sh` was documented with 1 of 5
  points right, and the benchmark numbers carried no version stamp. Exact byte counts were replaced
  with approximations plus the budget — the sheet grew by 37 bytes during this very pass, which is how
  precise numbers rot.
- **The READMEs describe the theme that exists.** The package README promised **two** theme entries
  (`FootstrapSidebar` / `FootstrapOnTop`), a `/luci-static/footstrap-top` symlink, `-dark`/`-light`
  symlinks, a `mobile.css` and a `sysauth.js` — none of which exist — claimed the theme needs OpenWrt
  25.12+ (24.10 is supported too), and told the reader to customise `cascade.css`, a **generated** file
  that is in `.gitignore`. It is now a short, true file: one theme entry, one renderer, where the CSS
  source actually lives, and `npm run check` before pushing. The root README (and its Russian mirror)
  had its benchmark labels swapped and its own result understated — the median page is **3.4×** faster
  than luci-theme-bootstrap and the whole 38-page run **2.3×**, with requests per page falling from
  15–48 to **0–8**; it read "≈2.3× median, ~1.9× overall, 15–39 → 1–4", and that 1.9× appears nowhere
  in the benchmark. It also promised the theme "carries its own translations, so it follows whatever
  language LuCI is set to" — the catalogue is **Russian only**; other locales get English for the
  theme's own strings.
- **CLAUDE.md now asks for comments that are minimally sufficient, not maximally dense — and its own
  stale numbers are fixed.** The guidance said "comment as densely as you like — the comments do not
  ship", which is how forty lying paragraphs grew: bytes are genuinely free (jsmin and `build-css.sh`
  strip them, so a "why" is never worth trading for bytes), but the reader's attention is not. The
  rule is now to state the problem and the reason and stop, and to treat a comment that cannot be made
  true as something to delete. Four of its own facts had rotted: the JS byte figures were measured on
  a tree that no longer existed (it claimed 78 KB of comments in 126 KB of source, when the source was
  really 159 KB before this release's rewrite; it is now 72 KB of 127 KB, minifying to 47 KB), the CSS
  source is ~255 KB and not ~284 KB, and `@mirror` was described as pinning **four** groups when it
  pins **six** — `gh/asset-urls` and `theme/legacy-names` went unlisted, along with the whole-file
  `@same-file LICENSE` pin. That last one is the exact blindness the mechanism exists to prevent.
- **Comments across the whole tree are cut to what states the problem and the reason, ~30–40% shorter.**
  The comments do not ship — jsmin and `build-css.sh` strip them — so this buys no bytes; it buys a
  reader who reaches the point. What went was narrative, rhetorical framing, restatement of the next
  line, and passages that merely re-told CLAUDE.md (now one-line pointers). What stayed is every
  defect, every measurement and every "do NOT" — those are the load-bearing half, and they set a floor
  well above the 50–70% cut that was aimed for. Verified mechanically that only comments changed: the
  built `cascade.css` is byte-identical (112 115 B), every JS token stream is identical under acorn,
  the Python AST minus docstrings is identical, and `npm run check` plus `jsmin-verify` are clean.

### Fixed
- **Dark mode: the selected row of an open dropdown failed WCAG AA at 4.21:1.** It painted accent text
  on `--fs-accent-soft` — a translucent tint of that same accent — and a tint drags the background
  toward the text and eats its own contrast, which is the one chip/badge rule this project writes down.
  Every dark-mode router showed it on every `<select>`, and the axe gate was green throughout: no
  gallery case rendered an OPEN dropdown with a value chosen, so the widget was invisible to the check.
  The row now sits on the opaque `--fs-panel2` with the accent carried by an inset rail, and the
  gallery renders the open state so the gate can see it. Found only because deleting a redundant doc
  (`docs/12`, which "covered" widgets in prose) forced its one real finding — the Combobox is missing
  from the gallery — into the gallery, where it is checkable.
- **The public styling guide told third-party app authors to break their own packages.**
  `docs/20` said `--warn-color-medium` "does not exist" and to rename it to `--warning-color-medium`.
  Exactly backwards: the theme exports `--warn-color-*` (and `--on-warn-color`), while
  `--warning-color-*` exists nowhere in the tree. `luci-app-podkop` reads `var(--warn-color-medium,
  orange)` and gets the themed amber today; following the guide would have dropped all seven of its
  declarations into the `orange` fallback. The lie was faithfully mirrored into the Russian copy.
- **Four docs instructed the reader to set `LUCI_MINIFY_JS:=0`**, which would triple the shipped JS.
  The Makefile deliberately leaves jsmin ON (it takes 127 KB to 47 KB, and uhttpd serves `/www` with no
  compression); what mangles modern CSS is csstidy, hence `LUCI_MINIFY_CSS:=0`. jsmin's real hazard —
  a regex literal after `return`/`=>` makes it swallow the file and exit **0** — is now stated where
  those docs used to give the wrong advice.
- **A closed MITM hole was still documented as open** (`docs/16`, L11: "install.sh silently disables TLS
  verification"). It has long been fixed — the installer pins `--proto-redir '=https'`, never disables
  verification even as a retry, and refuses to install unless the sha256 GitHub publishes for the asset
  matches. An audit doc that keeps a fixed finding open either sends the next reader chasing a ghost or
  convinces them the project is unsafe.
- **`docs/14` argued against the very fix `docs/15` describes.** Its teardown section said "not
  `Poll.stop()`"; the router does `queue.length = 0; Poll.stop(); Poll.start()` — which is what stopped
  the poller idling up to 5 s before its first tick. Two docs about adjacent things had drifted into
  contradiction.
- **Docs told you the login page needs no `sysauth.ut`, and that a theme should copy bootstrap's
  hidden-`<section>` login view.** Both are false and both were tried: without the theme's own
  `sysauth.ut` the generic template includes the header **without `blank_page`**, so the whole chrome is
  drawn around the login form with dead controls; and the bootstrap view pattern gives a blank page with
  no way to log in (the view bootstraps before a session exists, the RPC answers Access denied, `render()`
  never runs).
- **About forty source comments described code that no longer exists, and some of them described the
  opposite of what the code does.** Nothing a user can see, but a comment that lies is worse than no
  comment: the next person trusts it. The worst of them sat on the gates themselves. `jsmin-verify`'s
  header said "a **non-zero** exit code proves nothing" — backwards, and it negated the tool's whole
  reason to exist: jsmin corrupts a file *silently* and exits **0**, which is precisely why the token
  stream has to be compared. `install.sh` and `footstrap-selfupdate.sh` still explained that a release
  carries one `luci-i18n-footstrap-<lang>` package per language — the shape that broke Update on every
  router in the field (issue #6) and that 0.8.5 removed; `install.sh` then contradicted itself fifty
  lines later. `menu-footstrap-common.js` asserted in one paragraph that the shell widths are
  constants (`SIDEBAR_W = 224, RAIL_W = 68`) and in the next that they are read back from the CSS
  tokens — the first paragraph documented deleted code — and pointed at a function, `fitOne()`, that
  is nowhere in the tree. Thirteen more in `styles/theme/` named elements that were removed with the
  second renderer (`.fs-appearance-btn`, `.fs-top-logout`, a `<header>` no template emits) or claimed
  to override rules that `styles/base` has since **absorbed**; two stated the wrong specificity
  (`(0,3,1)` where the selector is `(0,4,0)`), and the dark canvas's chroma was written `.0165` in one
  file and `.0153` in another — converting `#1c2128` to OKLCH says `.0153`. Also fixed:
  `dev-sync.sh` still said the catalogue compiles in `Build/Compile` (it moved to `Build/Prepare`),
  `audit.py`'s docstring advertised a JS bracket check that was deliberately removed, and the
  uci-defaults marker comment said "drop the marker" where the code **writes** it.

### Security
- **Every release package is now signed with ed25519, and both the installer and the Update button
  refuse a package that does not carry our signature.** The sha256 the installer already checked
  cannot stand alone, and the reason is exact: GitHub *computes* the digest it publishes from the
  bytes that were uploaded. Anyone able to replace a release asset — a leaked write-scoped token is
  enough, no CI run involved — gets the digest recomputed for them, and the checksum then verifies
  the attacker's package. The signing key is a CI secret, is in no branch, and cannot be
  read back out of GitHub, so the same swap fails the signature: demonstrated end to end on the
  router with the real script (asset replaced, digest recomputed → sha256 passes, `ERR: BAD
  SIGNATURE`). `usign` is on every OpenWrt image (`base-files` depends on it), so this costs the
  theme no new runtime dependency, it covers apk and ipk with one mechanism, and — unlike trusting
  our key in `/etc/apk/keys` — it authorises nothing on the router beyond this one package. Both
  checks fail **closed**: a missing digest, a missing `.sig` asset or no `usign` on the box all
  refuse. A signature that is present and *wrong* is never overridable.
- **CI refuses to publish a release it cannot sign, and refuses a key the routers would reject.**
  The public half ships in the package and is embedded a second time in `install.sh` (which runs
  from `curl | sh`, before any package exists). A divergence between the two copies cannot be
  caught by any test — the installer would simply reject every release with `BAD SIGNATURE`, i.e.
  the failure would look exactly like the attack — so CI compares them on every run, and the
  release job re-verifies each freshly signed package against the key the router will actually use.

### Performance
- **A page load no longer spawns a CGI process to fetch an empty translation catalogue — 31 ms off
  every full load on an English router.** `<head>` loaded `admin/translations/<lang>` synchronously,
  and at `lang=en` that spent 31 ms (measured, five runs) to deliver **13 bytes** — `window.TR={};` —
  because there is no English catalogue to deliver: the msgids already are English. The process was
  the cost, not the data. The template now emits those 13 bytes inline when the language has no
  catalogue, and keeps the tag when it has one. The probe mirrors the server's own rule (`*.<lang>.lmo`
  in `/usr/lib/lua/luci/i18n`, which is what `load_catalog` globs), so a router that does ship an
  English catalogue still gets the tag; deciding by language name would have silently dropped it. It
  fails **open** — a throwing probe keeps the tag — because a missing catalogue makes every `_()`
  render English and report nothing. `defer` was rejected, not overlooked: `footer.ut` runs
  `L.require('menu-footstrap')` inline while the parser is still going, so a module's `_()` would race
  a deferred `window.TR` and lose silently.
- **The login page dropped its 17 copies of a 49-character `:has()` selector — 663 bytes of CSS.**
  Every rule keyed off `form:has(> .cbi-map input[name="luci_username"])`, on the assumption that the
  markup was stock LuCI's and therefore unnameable. It is ours: `sysauth.ut` renders that form, so it
  now carries `class="fs-login"`. The audit's stated blocker — that `ui.js` might re-render the login
  form for its session-expiry modal — was checked and is false: `ui.js` contains no `luci_username`
  and builds no login form at all, so nothing else ever matched those selectors. Computed styles on
  the live router are identical in light and dark (0 property diffs over every element of the page).

## [0.8.5] — 2026-07-14

### Changed
- **The layout toggle reads «Сбоку» / «Сверху» in Russian.**

### Fixed
- **The Update button installed a 6 KB translation catalogue instead of the theme.** v0.8.4 added a
  second package to the release (`luci-i18n-footstrap-ru`), and `footstrap-selfupdate.sh` — in every
  version already sitting on a router — picks the release asset with `grep -E '\.apk$' | head -1`.
  The GitHub API returns the asset list sorted **by name**, and `luci-i18n-footstrap-…` sorts before
  `luci-theme-footstrap-…`. So clicking Update installed the catalogue, reported success, left the
  theme on its old version and kept the badge asking for the same update — forever, because the
  script that picks the wrong asset is the one that never gets replaced. The script on a router
  cannot be fixed remotely: whatever we publish, it runs the picker it already has. So a release
  carries **one asset per format** again and the catalogue travels **inside the theme package**; CI
  fails the build unless `dist/` holds exactly one package per format. If your Update button gave
  you Russian but no new version, that is this bug — press it once more on 0.8.5 and it lands.
- **A third-party package's translation was overwriting the theme's own strings** — the layout
  toggle read "Максимум" on a Russian router. LuCI serves **one merged catalogue** to the client
  (`load_catalog()` reads every `*.<lang>.lmo` in `/usr/lib/lua/luci/i18n`, and a lookup returns the
  first archive that has the hash), so a msgid is a name shared with every `luci-app` on the box and
  readdir order decides who wins: somebody translates the msgid `Top` as "maximum" — right in a
  bandwidth dialog, nonsense on a layout switch. Every label in the Appearance popover now carries
  the `footstrap` message context, which makes the key ours alone. The chrome and login strings stay
  context-free on purpose (they inherit a correct translation from `luci-base` in the ~40 languages
  the theme ships no catalogue for), and so do System/Memory/Storage in the overview include — that
  one *matches* the stock section titles and must resolve exactly as `luci-mod-status` does.

## [0.8.4] — 2026-07-14

### Changed
- **`install.sh` now requires `jsonfilter` instead of falling back to grepping the API payload.**
  It is part of OpenWrt's base image and it is what reads the asset's sha256 — the only integrity
  check there is behind `--allow-untrusted` — so the fallback could only ever walk into the
  "no sha256 available — refusing to install" refusal anyway. Failing with one clear line beats
  failing three steps later with a security message.

### Fixed
- **The theme's own strings rendered in English on a translated LuCI — the release never carried
  the translation package.** `po/ru/footstrap.po` has been complete for releases, and CI already
  fails if a msgstr is empty, but no `.lmo` ever reached a router: the OpenWrt SDK built
  `luci-i18n-footstrap-ru`, the build job's `find` glob named only `luci-theme-footstrap-*`, and
  the language package was thrown away with the rest of `bin/`. Reported on a fully Russian LuCI
  (issue #6), where the Appearance popover read "Palette" / "Rounding" / "Cats" — and the layout
  toggle read **"Максимум"**, which is `luci-base`'s translation of the msgid "Top": LuCI serves
  ONE merged client catalogue (`load_catalog(lang, '/usr/lib/lua/luci/i18n')` reads every `.lmo`
  in the directory), so an unshipped catalogue does not fail — its msgids quietly resolve against
  somebody else's, or fall through to English. `install.sh` and the Appearance → Update button now
  install the language packages alongside the theme, and CI asserts BOTH packages by name: "the
  dist dir is non-empty" is exactly what let the missing catalogue ship for eight releases.
- **`install.sh` and the self-updater could have installed a 6 KB language pack in place of the
  theme.** Both picked the release asset by extension (`grep '\.apk$' | head -n1`), i.e. by
  whatever order GitHub happened to list the assets in. That was harmless while a release carried
  exactly one package; the moment the translation packages joined it, it became a coin flip. They
  now match on the package NAME (`/luci-theme-footstrap[-_]…`), and the two copies of that matcher
  are `@mirror`-pinned (`gh/asset-urls`) beside the `fetch()` and the host allowlist — the same
  forced duplication, made un-rottable for the same reason.
- **A language package is versioned with the theme it belongs to.** `luci.mk` versions them from
  `PKG_PO_VERSION`, which falls back to a git-or-mtime stamp — and the SDK build has no `.git`, so
  every CI run would have stamped them `0.<yymmdd>.<secs>`: a version unrelated to the release, and
  a different one on every rebuild of the same tag.

## [0.8.3] — 2026-07-14

### Added
- **CI compile-checks the ucode templates.** They had no parser anywhere: `luci.mk` copies them
  to the router verbatim, so a stray brace in `header.ut` built green, released, and then every
  user's LuCI silently fell back to a different theme. CI now builds `ucode` from a pinned
  upstream commit — the same discipline `jsmin.c` already gets, and for the same reason — and
  runs LuCI's own `ucode -T -c` over every `.ut`.
- **CI validates the rpcd ACL as JSON.** rpcd skips a file it cannot parse and says nothing, so a
  trailing comma there would have taken the update badge and the Update button away from every
  user with no other symptom.
- **The OpenWrt SDK is checksummed.** Two *linters* were pinned by commit and sha256 while the
  toolchain that actually builds the released package arrived on trust; its published
  `sha256sums` is now checked, and the download pins https across redirects.

### Changed
- **`build-css.sh` checks the file it actually writes, and refuses one that is too small.** The
  brace/rule-count check ran on the squeeze's *input* — while the squeeze is the pass most able
  to corrupt a stylesheet, being the one that tracks strings, joins lines and drops the last
  `;` — and the only gate on the finished file was an upper size bound, so every way of
  producing a *truncated* `cascade.css` passed silently. The rule count must now survive the
  squeeze unchanged, and the sheet has a floor as well as a ceiling.
- **A tag whose changelog section is missing now fails the release.** `release-notes.sh` warned
  to stderr and exited 0, publishing a release page reading "See the CHANGELOG" for a version
  the changelog had never heard of — precisely the mistake the "never tag first" rule exists to
  prevent, made permanent and public. The Russian mirror is required too.
- The installer's failure modal builds its message as a text node rather than through
  `innerHTML`: `luci.js` assigns a *bare string* child via `innerHTML` and only text-nodes an
  array, and what lands there is raw `apk`/`opkg` stderr — the one string in this theme that
  neither the theme nor LuCI composed.
- `tools/fs-orphans.mjs` no longer reports the `fs-fit` *module* as an unstyled class. A
  permanent false "NEW" line in a report is how a report teaches you to stop reading it.
- **`audit.py` reported the wrong line for every finding it has ever printed.** Stripping a
  comment deleted its newlines too, and the line numbers are derived from that stripped copy —
  so each `file:line` was shifted up by however many comment lines sat above the rule. In a tree
  where the comments outweigh the code that is a large shift: the focus block it called
  `30-forms.css:336` really lives at `:353`. A finding that points at the wrong line is a finding
  you go and "fix" in the wrong rule.

### Fixed
- **The ACE editor apps embed (SSClash, and any other app shipping ace.js) rendered as a black
  rectangle with no text, spilling out of the layout.** The SPA router used to DELETE every
  `<style>` a view had injected into `<head>` when navigating away — the right answer for the
  file manager's blob (see below), the wrong one for CSS the injector cannot put back. ACE
  imports `ace_editor.css` (14 KB: the absolutely-positioned layers, the gutter, the line boxes)
  once per DOCUMENT, at module eval, so a re-render never re-injects it, while its theme and mode
  sheets — loaded per editor — do come back. Measured on the router: open SSClash → Configuration,
  SPA-nav to Log and back, and the theme repaints the editor black while its structure never
  returns; the unpositioned layers blow the page out to 2 007 346 px tall. Deleting CSS was
  silently one-way, so the router no longer deletes any: a sheet that can only match its own app's
  widgets (`.ace_*`, the stock overview's `.cpu-status-view-mode-entry`) is inert on every other
  page and now simply stays, and SPA nav through those apps keeps working.
- **Apps that ship dark styles were rendering their LIGHT ones on a dark page.** An app has to
  guess whether the theme is dark, and a survey of the LuCI ecosystem found three dialects for
  asking: `data-theme="dark"` on `:root` (`luci-app-justclash` keys 21 rules off it),
  Bootstrap's `data-bs-theme` (`luci-app-ssclash` reads it first), and the luminance of the body
  background (OpenClash, passwall, and ssclash's fallback). The theme stamped only its own
  `data-darkmode`, so justclash's dark rules were all dead. It now stamps all three names for the
  same fact — `data-darkmode` stays the one the theme's own CSS reads, the other two are outbound
  compatibility like the `--*-color-*` export tier, and `tools/axes.mjs` fails the build if a
  `styles/` rule ever reads them or if the pre-paint template and the live applier drift apart.
- **The body background is now provably opaque, because that is what every dark-mode sniffer
  reads.** OpenClash, passwall and ssclash all decide light-vs-dark from the luminance of
  `getComputedStyle(document.body).backgroundColor` — and OpenClash's regex does not even match
  `rgba(0, 0, 0, 0)`, so a transparent body makes it conclude "light" and repaint a dark page in
  its light palette (it then writes `data-darkmode` onto our `:root` itself). Moving the page
  colour onto `:root` or fading it with an alpha would do exactly that, silently, so
  `tools/export-tier.mjs` now proves the body background is opaque and on the correct side of the
  luminance midpoint across the whole palette × mode × tint matrix.
- **An app that re-injects its CSS on every render no longer stacks copies of it.**
  `luci-app-podkop` appends a 4 KB `<style>` to `<head>` from its `render()` with no guard, and
  `luci-app-mosdns` re-appends three CodeMirror `<link>`s the same way; with the sweep gone, every
  SPA re-visit left another copy behind. Dropping a byte-identical duplicate is the one deletion
  that cannot break anyone — the rules do not go away, so a library's "already imported?" check
  still finds its sheet — and it is now the only one the router performs.
- **A view's CSS still cannot follow you to the next page — and that now includes a `<link>`.**
  `luci-app-banip` and `luci-app-adblock` append `<link rel=stylesheet href=…/custom.css>` to
  `<head>` at module eval, and that file styles `.cbi-input-text` / `.cbi-input-select` — stock
  widgets, on every page, unlayered. The old sweep only ever looked at `<style>`, so this leaked
  silently. What replaces the sweep is a test, not a list: a sheet is *invasive* if it can paint a
  page that is not its own. That means a bare selector (`h4`, `svg text`, `div > label + select`,
  `:root { color-scheme: … }`), or a selector made ENTIRELY of names the theme itself styles, with
  nothing of the app's own to pin it to the app's markup. Both shapes match stock widgets on every
  page, and being unlayered they outrank every cascade layer. The universe of names is read back
  from `cascade.css` at runtime, so it tracks the theme instead of drifting from it. A document
  carrying such a sheet is spent: the next navigation falls back to a REAL page load, which is what
  stock LuCI does on every link anyway.
  The two exemptions are what keep this from taxing the innocent, and both were measured against
  real apps: a stock class **pinned** by a name of the app's own (`#cbi-podkop-section >
  .cbi-section-remove`, `.bandix-table th.sortable.active`) cannot match without that app's markup —
  though a `:not()` argument is not a pin, which is exactly why `luci-app-filemanager`'s
  `.cbi-button-save:not(.custom-save-button)` still counts; and a bare selector declaring nothing but
  custom properties the theme never reads (`:root { --app-temp-status-temp: … }`) has nothing to
  paint with. Checked against the eight apps installed on the dev router: ACE/ssclash, podkop, the
  overview's CPU include and the hex editor keep SPA navigation, while `luci-app-filemanager`
  (`.cbi-button-save`), stock `luci-app-openvpn` (`h4 { white-space: nowrap }`), `luci-app-bandix`
  (`.error`), `luci-app-wrtbwmon` (`div > label + select`) and `luci-app-temp-status`
  (`svg text { fill }`) take the full load. Save/Apply/Reset are all still present on System after
  visiting the file manager. Measured at 0.3 ms per navigation.
- **Two fast clicks could leave you on one page while looking at another — and leave its poller
  running forever.** On a FIRST visit to a page the SPA router's `require()` *is* the render, so
  it cannot be cancelled: click Firewall (uncached — its module plus its `load()` RPCs, seconds
  on a slow link), click Wireless 100 ms later, and the router flushes the poll queue *before*
  Firewall's poller is ever added. Firewall then paints into the `#view` that now belongs to
  Wireless and registers a poller the flush can no longer catch. Reproduced on the live router
  with 1.2 s of added latency: the URL, the title, the menu and `body[data-page]` all said
  System while the Firewall's zone editor sat on screen. A superseded first render is now
  detected and undone — the current page is re-rendered, which is also what kills the orphaned
  poller.
- **Clicking the page you are already on no longer kills the Back button.** The router pushed a
  history entry unconditionally, so a click on the active menu item added a duplicate; Back then
  fired `popstate`, found the path unchanged, and correctly did nothing — once per stray click.
  A re-navigation to the current URL now replaces its entry, as a full page load does.
- **The Update button could hang until the router was rebooted.** A worker killed mid-`apk add`
  (an OOM on a 128 MB box, and apk is the memory-hungry part) left `status=RUNNING` and its
  staged copy behind forever, and a pre-check in front of the lock answered `RUNNING` to every
  later click — the client polled its full 300 s and reported "timed out waiting for the
  installer", permanently. Worse, the stale-lock reclaim written for exactly that case could
  never run, because the pre-check returned first. The atomic `mkdir` lock is now the only thing
  that decides, which is what it was always for.
- **The keyboard and the screen reader can follow a navigation again.** Every SPA nav rebuilds
  the menu, so the `<a>` the user had just activated with Enter was removed from the document
  and focus fell back to `<body>` — the next Tab restarted at the skip link — while nothing
  announced that the page had changed at all. Focus now moves to `<main>` (which already carried
  `tabindex="-1"` for the skip link) and the new page title is spoken through a polite live
  region.
- **The document `<h1>` was not in the accessibility tree at all.** It was hidden with the
  `hidden` attribute, i.e. `display: none`, which removes an element for assistive tech as
  thoroughly as it does for the eye — so the heading outline the `<h1>` was added to repair
  still began at the views' `<h2>`, and the router's title sync was updating a node nothing
  could read. It is now clipped (`.fs-sr`), the same technique the skip link already uses.
  Verified against Chrome's ARIA snapshot on the live router.
- **The menu never said "you are here".** The active leaf and the active section tab carried a
  CSS class and nothing else; they now carry `aria-current="page"`. The JS-generated icons and
  chevrons carry `aria-hidden="true"`, like every SVG in the templates.
- **A Lua-CBI form showed no red border on an invalid field.** `styles/base` does declare one for
  `.cbi-value-error input`, but the theme's `input { border: 1px solid … }` shorthand in a later
  layer wipes a longhand out regardless of specificity — so the field rendered plain grey. The
  modern `.cbi-input-invalid` path was fine; only `luci-compat`, i.e. every third-party app still
  on the Lua CBI, had lost the cue. Probed, not reasoned: grey `#d0d7de` before, danger red after.
- **Four input types rendered as stock white 3px-radius boxes** next to themed fields in the same
  form: `color`, `datetime-local`, `month` and `week` were missing from the theme's type list, and
  a missing type does not fall back to "unstyled" — it falls back to `base`.

### Security
- **The self-updater installed without checking the sha256 whenever it could not find one.** The
  check was `if [ -n "$digest" ]`, with no `else`: GitHub renaming the field, the `jsonfilter`
  predicate ceasing to resolve, or `jsonfilter` being absent all left the digest empty — and the
  package was then installed with `--allow-untrusted` and no integrity check whatsoever, while
  reporting success. Half of a two-link trust chain cannot be optional; a missing digest is now
  a refusal. `install.sh` refuses too (`FOOTSTRAP_ALLOW_UNVERIFIED=1` overrides, deliberately by
  hand).
- **`__run`, the privileged worker entrypoint, was reachable over RPC.** rpcd's `file.exec` ACL
  matches the command *path* — `params` are free — so any session holding the ACL could invoke
  the self-update script with `__run` directly, which ran the install in the foreground and
  **without taking the lock**: two concurrent `apk add` runs on the same package, the exact race
  the lock exists to stop, with rpcd killing one of them at its 30 s timeout, possibly
  mid-install. It now runs only when invoked as the staged worker copy.
- **The dynamic loader was left to the caller.** rpcd also hands the exec'd process an
  environment the caller controls: `PATH` was pinned, but `LD_PRELOAD`/`LD_LIBRARY_PATH` on
  `/bin/sh` are arbitrary code as root for anyone holding this ACL, and the proxy variables
  would have redirected the fetch. All of them are unset.
- **The release token is no longer handed to every pull request.** `permissions: contents: write`
  was workflow-wide, so it was in reach of the `npm ci` in the lint job — i.e. of the lifecycle
  scripts of every dev dependency — on a `pull_request` run. Only the release job declares it now.

## [0.8.2] — 2026-07-13

### Changed
- **The licensing position is written down, in the READMEs and in the Makefile.** The theme is
  Apache-2.0 and that is **not** a free choice: `styles/base/` began as a fork of
  luci-theme-bootstrap's `cascade.css`, the ucode templates derive from LuCI's own, and several JS
  helpers are copied from LuCI verbatim — all Apache-2.0, whose notices have to travel with it. (GPLv2
  is not even available: Apache-2.0's patent and indemnity clauses are additional restrictions GPLv2
  forbids. GPLv3 would be legal but would cost the theme its place in the LuCI feed and make
  firmware vendors avoid it, for a copyleft that buys little on code a browser is handed as source.)
  The bundled fonts are **not** covered by it — they are SIL OFL 1.1, and now say so.

### Fixed
- **The bundled webfonts were being redistributed without their licence.** Manrope and JetBrains Mono
  are SIL Open Font License 1.1, and OFL §2 requires every copy of the Font Software to carry the
  copyright notice **and** the licence text. The theme shipped nine `.woff2` files and neither — and
  it could not have carried them inside the fonts, because these are unicode-range subsets and the
  subsetter strips the licence out of the font's own name table (verified: the copyright survived, the
  licence field did not). `fonts/OFL.txt` now travels with them to the router.
- **The package's licence metadata pointed at nothing, and now ships what it declares.**
  `PKG_LICENSE_FILES` resolves against `$(PKG_BUILD_DIR)`, which `luci.mk` fills with only
  `src/ luasrc/ htdocs/ root/ ucode/ po/` — and CI rsyncs only the package directory into the SDK, so
  the repo-root `LICENSE` was reachable from neither. `Build/Prepare` copies it in, and `PKG_LICENSE`
  is now the honest `Apache-2.0 OFL-1.1`: the theme really does carry two bodies of work. The two
  copies of the Apache text (repo root, for GitHub; package, for the build) are pinned byte-identical
  by `npm run mirror`.
- **A view's injected CSS no longer follows you to every page you visit afterwards.** A view may inject
  a `<style>` into `<head>` when it renders — `luci-app-filemanager` does — and on a full page load
  that stylesheet dies with the document, so it only ever affects the page that asked for it. SPA
  navigation never reloads, so it stayed in `<head>` forever. That is not cosmetic: the file manager's
  blob carries `.cbi-button-apply, .cbi-button-reset, .cbi-button-save { display: none !important }`
  (it hides the stock buttons because it has its own), and being **unlayered** with `!important` it
  outranks every cascade layer. Measured on the router: open the file manager once, then go to
  System → **Save and Reset are gone**, and stay gone until a hard reload — every config page you touch
  afterwards is unsavable. The router now sweeps them on navigation, exactly as it already sweeps the
  outgoing view's pollers, stray `setInterval`s and open modals: the document is put back into the
  state a fresh page load would leave it in. The shell's own server-emitted `<style>` is marked
  `data-fs-shell` and kept — the two are told apart, not guessed at. Verified: a re-visit to the file
  manager now renders byte-for-byte identically to a full page load of it.

## [0.8.1] — 2026-07-13

### Added
- **A gate for the one duplication that cannot be pinned: the Appearance axes.** Every axis is
  implemented twice — `head.ut` stamps `:root` before the first paint (inline, before the module
  loader exists) and `menu-footstrap-common.js` applies it live — and neither copy can go. They
  cannot be byte-identical either, so `@mirror` cannot hold them. `tools/axes.mjs` (`npm run axes`)
  holds the **contract** instead, and derives it *from the JS* rather than restating it: the
  localStorage keys, the `:root` attributes, the custom properties, the 1–360 ranges, the rounding
  default (which `head.ut` cannot read from the CSS token — it runs before the stylesheet), and the
  load-bearing ordering rule, *set the custom property before the attribute*. That rule is why the
  gate exists: it is a one-line fix that would be made in the popover and forgotten in the template,
  and its only symptom is a single wrong frame on reload — which nobody reports and nothing else
  catches.
- **`@mirror` exists now — it was documented but never built.** `CLAUDE.md` described a mechanism in
  detail ("there is no numeric budget… tag every copy, the tool enforces byte-identity, an unpinned
  duplicate is a hard failure") and listed the groups it had supposedly pinned. None of it was real:
  `tools/css-dup.mjs` held a `BUDGET = 2` and its own failure message told you to *raise the budget*,
  there was not one `@mirror` tag in the tree, and the workflow described the check a third way. The
  project's argument was right and its tool was not, so the tool now matches: `tools/mirror.mjs`
  (`npm run mirror`) holds every pinned copy byte-identical, `css-dup` fails on an *unpinned*
  duplicate, and the budget is gone. It covers **shell as well as CSS** — see below.

### Changed
- **Save and Reset in the page action bar carry a tint, and the hover cue is now visible.** A
  transparent button beside the solid Save & Apply read as disabled rather than as secondary. Both now take the same step of the
  role ladder — `-soft` at rest, `-fill` on hover — Save off the accent role and Reset off danger,
  which it already declared on hover. Their labels are `--fs-text` and **not** the role colour: text of
  colour C on a translucent tint of C is the mistake this project documents having learned the hard
  way, and axe measured it immediately (accent on accent-soft: 4.25:1, an AA failure). The fill and the
  border carry the role; the label only has to be legible.
- **The hover lift flips direction per mode, and that is a WCAG fix.** `filter`
  recolours an element's *text* as well as its fill, and a light-mode solid button is a saturated fill
  carrying WHITE ink — which cannot get any brighter. Brightening it only closes the gap: on
  `--fs-accent` the white ink measures 5.19:1 at rest, the old `brightness(1.08)` already dropped it to
  4.59:1, and the lift that would actually be *visible* (1.15) dropped it to **4.08:1 — a failure
  introduced by hovering**. Measured from the rendered pixels, not computed. So light mode now darkens
  (0.90 → 6.16:1: a bigger cue *and* better contrast) and dark mode, where the fill is light and the
  ink dark, brightens (1.15 → ~8:1). Both say the same thing: the button moves away from the page.
- **`install.sh` and `footstrap-selfupdate.sh` are pinned mirrors of each other where they must be.**
  They cannot share a file — the installer is `curl | sh` and runs *before* the package that would
  hold the library exists — yet both must fetch over a verified channel, pin the asset host and check
  the sha256. That duplication had **already drifted**: the two `fetch()`s had different backend
  orders, one gave its first-choice tool (`uclient-fetch`, on OpenWrt) *no timeout at all*, and one
  was missing the https redirect pin on its `wget` path. Nothing said a word, precisely because a
  diverged copy stops looking like a duplicate. They are byte-identical now and `@mirror`-pinned, so
  they cannot drift again.
- **The upstream commit the borrowed build tools are pinned to lives in one file.** `jsmin.c` (which
  CI compiles and runs as the gate proving our shipped JS is safe) and `i18n-scan.pl` (which decides
  whether the translations are complete) were pinned to the same SHA in two places, each with a
  comment saying "bump them together", and nothing holding them together. Both now source
  `luci-upstream.pin`.
- **The Tint and Accent axes are one function.** They were forty near-identical lines apart — same
  1–360 validation, same "0 is off", same clamp, and the same load-bearing ordering rule (set the
  custom property *before* the attribute, or a fresh load paints one frame with the previous hue).
  That rule is exactly what gets fixed in one copy and not the other. The other seven Appearance axes
  are deliberately left alone: each has a real quirk a table would need an option for.
- **The two gallery gates share one harness.** `a11y-gallery.mjs` and `export-tier.mjs` each carried
  their own copy of "build the CSS, serve the gallery, stamp the Appearance axes onto `:root`" — and
  that last part was a *fourth and fifth* copy of rules that also live in the theme JS and in
  `head.ut`. A gate that keeps testing an old shape keeps passing, which is worse than no gate.
- **`dev-sync.sh` deploys the resource JS by glob, not by name.** It listed four files individually,
  so a fifth would ship in the package (luci.mk copies `htdocs/` wholesale) and silently never reach
  the dev router — and be tested for the first time after a release. The deploy skill had the same
  bug in a worse form: it knew how to map `root/*` to the router but its file discovery never handed
  it one, so editing the self-update backend or its ACL and deploying did **nothing**, quietly.
- **`fs-fit.js` actually owns the frame coalescing now, as the docs always claimed.** It exported
  `schedule()` (which runs *every* fitter) but no way to batch a single callback, so three callers
  had hand-rolled the identical five lines; two more had hand-rolled the same mutation filter. Both
  are shared primitives now (`fit.frame`, `fit.touches`). The dropdown clamp keeps its own per-`<li>`
  rAF handle — it needs to *cancel* a pending measure, which a shared one-flag coalescer cannot
  express.
- **The README described a product that no longer exists.** It offered "two layouts
  (`FootstrapSidebar` / `FootstrapOnTop`) switched in LuCI's settings" and "three palettes" including
  one that is now a separate wallpaper axis. There is one theme entry; layout, palette, wallpaper,
  tint, accent, rounding and submenu behaviour are all browser preferences in the Appearance popover,
  and none of them was documented. The self-update was not mentioned at all.
- **The viewport edge gap both hand-placed popups obey is one constant.** The Appearance popover and
  the menu's dropdown clamp each wrote their own `8`.
- **The documentation described a codebase that had moved on.** A sweep of every checkable claim in
  `CLAUDE.md`, the READMEs, `docs/`, the skills and the code comments found ~40 that were false. The
  load-bearing ones: the sidebar override's specificity was stated as `0,3,0` under a `768px` media
  query (it is `0,4,0` under `521px` + `:not([data-narrow])` — the `0,3,0` predates the `:not()`);
  nine comments pointed at `theme/20-shell-sidebar.css`, a file that does not exist; the CSS build's
  own `FS_CSS_BUDGET` was documented as 124 KB in two places and is 115 KB; CI's font budget was
  documented as 100 KB and is 70 KB (the doc's number would have let 33 KB of font drift in
  unnoticed); the JS comment/minify figures were ~2× stale; and several comments still described the
  table card stack as a container query that measurement replaced. (`docs/16` and `docs/18` are dated
  audit snapshots and are left as history, not rewritten.) A comment that lies is worse than no
  comment.
- **The shell's geometry is three tokens instead of six copies of three numbers.** `--fs-sidebar-w`,
  `--fs-rail-w` and `--fs-content-min` now live in `02-tokens.css`; the stylesheet lays the sidebar out
  from them and `menu-footstrap-common.js` reads them back to decide whether what is left for the
  content is still readable. The JS used to carry its own `SIDEBAR_W = 224, RAIL_W = 68,
  CONTENT_MIN = 500` against bare literals in the CSS, so narrowing the rail in the stylesheet would
  have left the measurement subtracting the old width with nothing in the build to notice — and
  `20-shell.css` even cited a `--fs-content-min` token that did not exist.
- **The package declares its own maintainer and homepage.** Without `LUCI_MAINTAINER`/`LUCI_URL`,
  `luci.mk` defaulted them and the built package claimed to be maintained by the OpenWrt LuCI
  community. The repository also gained the `LICENSE` text it had never carried, though the package
  deliberately does **not** set `PKG_LICENSE_FILES`: that resolves against the build directory, which
  `luci.mk` fills with only `src/ luasrc/ htdocs/ root/ ucode/ po/` — pointing the metadata at a file
  the build tree does not have would be worse than not pointing at one.
- **The linters were only enforcing the rules somebody remembered to list.** `eslint.config.mjs` never
  extended `eslint:recommended`, so `no-dupe-keys`, `no-unreachable`, `no-duplicate-case`,
  `no-prototype-builtins`, `getter-return`, `no-async-promise-executor` and about thirty other free
  correctness rules were simply off; stylelint was missing the value-grammar check
  (`declaration-property-value-no-unknown`), which is the only thing that can catch a declaration that
  is invalid at computed-value time and therefore vanishes in *silence* — the exact failure mode the
  `--*-rgb` component bridges were torn out for. Both sets found **zero** violations in the current
  tree, so they cost nothing today and catch the next mistake for free.

### Fixed
- **Any view using `<a href="#">` for its own controls had its state wiped on every click** (issue #3,
  `luci-app-filemanager`). Chrome fires `popstate` for a same-document *fragment* navigation, so
  clicking such a link inside a view arrived at the SPA router as if the user had pressed Back. The
  router then re-ran the navigation for the path already on screen, which re-instantiates the view —
  undoing whatever the click had just done, one turn of the event loop later. The file manager's tab
  strip is four `<a href="#">` links whose handler does not `preventDefault`, so switching to Editor,
  Settings or Help switched *and instantly reverted*, and the app was unusable. Traced on the router:
  `popstate` → `#view` receives a brand-new container. The two "Failed to display the file list"
  errors in that report are the same bug from the other side — each surprise re-render restarts the
  app's own `render()`, whose file list races the DOM insertion it depends on. A fragment change is
  not a navigation: the router now compares the *path* and stays out of the way when only the
  fragment moved. Back/forward across real paths still SPA-navigate, with zero full page loads.
- **The login page carried the whole chrome — sidebar, menu and footer — around a form whose only
  control is a password field.** The theme shipped no `sysauth.ut`, so LuCI fell back to its generic
  one, which includes the header *without* `blank_page` (luci-theme-bootstrap ships its own and does
  not have this problem). The theme has one now. It is deliberately **not** a copy of bootstrap's:
  that one hides the form in a `<section hidden>` and reveals it from a view module, and this theme
  tried exactly that once and got a blank page with no way to log in — the view runs before a session
  exists, its RPCs answer "Access denied", the promise rejects and `render()` never runs. The form is
  rendered by the server, so it works with JS disabled and cannot be broken by a rejected promise.
- **The login page ignored the Cats wallpaper.** Dark mode, palette and tint all reached it (they land
  on `body`), but the wallpaper is painted on `.fs-shell`, which a chrome-less page does not have — so
  the one screen you see before anything else was the one screen that did not match the theme.
- **A data table with no `id` lost its cell padding, its mono face and its row hover.** `[id]` and
  `.fs-dt` are two names for "this is a data table, not a key/value include", and they had been written
  as two selector lists at *different* weights — `.cbi-section .table[id] .td` is (0,4,0) but
  `table.fs-dt .td` is only (0,2,1), which loses to the key/value default at (0,3,0). A table that had
  an id was fine; one identified only by the JS tag kept the key/value padding (`10px 16px 10px 0` —
  flush left, right for a label column and wrong for a data cell). Live on the router: **Status →
  Routing** sat every cell hard against the table's left edge. Both names are one `:is([id], .fs-dt)`
  now and cannot drift apart again.
- **Typing in an open dropdown now jumps to the matching option, as a native `<select>` does.** Open
  Country Code, type "ru", and a native select highlights "RU - Russian Federation"; it is
  how anyone picks one of 248 entries. This theme replaces native selects with a styled `ui.Dropdown`
  (a native popup cannot be styled), and `ui.Dropdown` has **no letter search at all** — bootstrap only
  appears to have one because it leaves that field as a real `<select>`. Type-ahead is implemented for
  every `.cbi-dropdown`, including the ones LuCI renders itself: the buffer resets after a pause,
  repeating one letter cycles through the items that start with it, and the label is matched before the
  value, so both "ru" and "russ" find it. Enter commits, exactly as before.
- **The footer's credit line sat hard left.** `text-align: center` could not centre it: base made the
  footer a flex row with `justify-content: space-between` — a leftover from a two-column footer — and
  with the single `<span>` this theme emits, space-between parks it at the start.
- **"Refresh Channels" (Status → Channel Analysis) sat flush against the section below it**, reading as
  part of that card rather than as a page-level action. `.cbi-title-buttons` had no bottom margin.
- **The Appearance popover's "Submenus" control ignored the layout toggle.** The accordion switch is
  meaningless in the top layout (its sections are hover dropdowns, already exclusive), and it was
  left out with an `if (currentLayout() !== 'top')` around the group that builds it. But the popover
  is built ONCE, in `init()` — so that branch froze the control to whatever layout the *page loaded
  in*: switch to the top bar and it stayed on screen, load in the top bar and switch to the sidebar
  and it never appeared. It is always built now and hidden by CSS on `:root[data-layout="top"]`,
  which is the theme's own rule — toggling the layout re-renders nothing, CSS morphs the chrome — so
  it is correct on load, on toggle, and with no JS state at all.
- **In a window ~768–779 px wide the menu and the stylesheet disagreed about what the chrome was.**
  The CSS had moved off the 768 px breakpoint long ago: the sidebar yields when the *content* column
  would fall below its minimum, measured from the sidebar's real cut (`data-narrow`). `flyoutMode()`
  in the menu JS was still asking `matchMedia('(max-width: 767px)')`, and its comment pointed at a
  file that no longer exists. Measured on the live router at 770 and 775 px: the chrome painted as a
  full-width bar while the menu still believed it was a vertical accordion, so a section opened
  unfolded *inside* the bar, click-outside and Escape did not close it, and the dropdown edge-clamp
  refused to place it. Worse, nothing watched `data-narrow` at all, so dragging a window across the
  boundary ran no transition handler. Both now read the one attribute that decides.
- **Column weights (`col-1`…`col-10`) never reached a table that carded above the phone tier** — the
  other half of the split card contract. They are unguarded now, and that is not a workaround: `flex`
  is inert on anything that is not a flex item, and a cell becomes one exactly when its table cards,
  by *either* mechanism. So one copy replaces twenty rules under two guards, the config table gets
  its weights for the first time (it cards at a 960 px *container*, i.e. possibly on a 1200 px
  desktop), and the stylesheet got 512 bytes smaller. Verified on the router: the package list's
  cells went from `flex: 0 1 auto` to `1 1 30px` / `2 2 60px` / `10 10 300px`.
- **`cssdiff.py` could have blanked the dev router's theme selection.** It switches
  `luci.main.mediaurlbase` and restores it in a `finally`, but read the original with no fallback —
  so a failed `ssh` made it the empty string and the restore then ran `uci set
  luci.main.mediaurlbase=`. Its two sibling tools both default to bootstrap there; this one did not.
  It now refuses to switch the theme at all if it cannot read the value needed to switch back.
- **`preview.py --layout footstrap-top` screenshotted a broken UI.** It pointed the router's
  `mediaurlbase` at `/luci-static/footstrap-top`, a path the rest of the repo actively deletes. The
  layout is a client preference; it is set in the browser now, and the choices are `sidebar` / `top`.
- **`install.sh` left the LuCI module cache behind**, dropping only the index cache — and a stale
  module cache right after installing a package that replaces the theme's JS is the one case where it
  actually bites.
- **The data-table tagger and its own mutation filter used different selectors.** The tagger asked for
  `table.table` while the filter beside it carries a comment explaining why it must not. Every
  `.table` stock LuCI emits really is a `<table>`, so it cost nothing *here* — but that is luck, and
  the coverage rule is that a third-party `luci-app-*` renders what stock never does. One selector.
- **The self-update worked only on routers that happened to have `curl` installed.** `curl` is not in
  OpenWrt's default package set — the base image ships `uclient-fetch` — so on a stock router the
  Appearance update badge and the one-click Update button both died with the misleading
  `ERR: cannot reach the GitHub release API`. Reproduced on the dev router by moving `/usr/bin/curl`
  aside. The script now falls back to `uclient-fetch`, exactly as `install.sh` already did, so the
  theme still depends on nothing but `luci-base`.
- **Installing or updating the theme no longer logs every LuCI user out.** `postinst` ran
  `/etc/init.d/rpcd restart`, and rpcd keeps its sessions in memory. `reload` (SIGHUP) re-reads
  `/usr/share/rpcd/acl.d/*`, which is the only thing this package needs from rpcd — verified on a
  live router: removing our ACL file and reloading flips `session access` for the self-update script
  from `true` to `false`, and a session created before a `reload` survives it while dying across a
  `restart`. The "you have been logged out, sign in again" screen the updater used to show existed
  only to explain a logout the package inflicted on itself.
- **A data table stacked into cards above the phone breakpoint rendered columns that should have been
  dropped, and ignored its column weights.** The stack is *measured* (`fs-select.js`), so it fires at
  any width, but three halves of the same contract — the table's own `display: block`, the
  `.hide-xs`/`.hide-sm` columns stock LuCI drops, and the `.col-N` weights — lived only inside
  `@media (max-width: 767px)`. In the sidebar layout the content column is `viewport − 224 − 56`, so
  between roughly 768 and 860 px it is already below the "too cramped to be a table" floor while the
  media query has switched off. Measured on the live router at 790/820/850 px: the leases table
  stacked while still `display: table` (keeping the intrinsic min-width that `display: block` exists
  to prevent), and the wireless association list rendered **all five** of its `.hide-xs` cells. Those
  rules now key off the `.fs-stacked` class, where the stack is actually decided.
- **A future colourway would have painted success text with the *danger* ink.** `.cbi-tooltip.success`
  read `--fs-on-danger`. Nothing could see it, because every shipped palette happens to give all four
  inks the same value — `cssdiff` found zero diffs, `audit.py` saw a defined variable and axe measured
  the right contrast. Proven live by forcing `--fs-on-danger` red: the success tooltip turned red, and
  `--fs-on-good` had no effect on it at all.
- **`build-css.sh` could silently corrupt a CSS string.** The final "drop the last `;` of a block" pass
  was a `sed 's/;}/}/g'` bolted onto the string-aware awk, and sed cannot see strings: `content: ";}"`
  came out as `content: "}"`, and a data-URI containing `;}` was mangled the same way. Both reproduced.
  The squeeze now happens inside the scanner that already tracks quoting; the output on the current
  tree is byte-identical, so nothing shipped changes.
- **Installing footstrap could rewrite the active theme of a router running somebody else's theme.**
  The "does the active theme actually exist on disk?" guard in `uci-defaults` ran against whatever
  theme was current, not against ours — so a third-party theme whose ucode template directory is not
  named after its media basename could be quietly replaced with bootstrap. It is scoped to
  `/luci-static/footstrap*` now: repair what we ship, leave the rest of the router alone.
- **The installer told new users to pick theme entries that no longer exist** (`FootstrapSidebar` /
  `FootstrapOnTop`). There is one `Footstrap` entry; layout is a per-browser toggle in Appearance.

### Security
- **`install.sh` no longer disables TLS certificate verification.** The installer is piped from the
  internet into `sh` as root, and it retried every download with `--no-check-certificate` (or
  `curl -k`) after *any* failure of the verified attempt — which includes a man-in-the-middle
  presenting a bogus certificate. Whatever came back was then installed as a root package. The
  "install the CA bundle" hint it prints was therefore unreachable in the one case it was written
  for. `ca-bundle` is in OpenWrt's `DEFAULT_PACKAGES`, so the insecure path bought nothing on a
  stock router and silently disarmed the check on a broken one.
- **The theme package is now verified against the sha256 GitHub publishes for it, in both the
  installer and the self-updater.** Both install with `apk add --allow-untrusted`, i.e. with no
  package signature to fall back on, so the release API's per-asset `digest` is the only integrity
  check there is — and neither script was reading it. A mismatch now refuses the install. It rides
  the same TLS channel as the URL, so it does not defend against a compromised `api.github.com`;
  what it does defend against is a truncated or tampered download from the asset CDN, which is a
  different host.
- **The asset host is pinned, and the redirect scheme is pinned on the backends that can express it.**
  The download URL is read out of an API response and handed to `apk add` as root; it is now required
  to be a GitHub host. `curl` additionally gets `--proto '=https' --proto-redir '=https'`, so it will
  not follow a redirect to plain `http://` on the way to the asset CDN. **`uclient-fetch` — the
  first-choice backend, and the one a stock OpenWrt router actually has — has no equivalent flag**, so
  on that path the guards are the host allowlist and the sha256, not a scheme pin.
- **`install.sh` downloads into `mktemp -d`, not a predictable `/tmp/footstrap-install`.** `/tmp` is
  1777, so any local unprivileged process could pre-create that name as a symlink and have root
  write the package through it to a file of its choosing (CWE-377) — the same race
  `footstrap-selfupdate.sh` already documents six lines of reasoning about avoiding.
- **The self-updater cannot start two concurrent installs any more.** Its "is a run already in
  progress?" test was a read followed by a write, so two RPCs arriving together both read "no" and
  both spawned an `apk add` on the same package — reproduced by firing the script twice at once.
  An atomic `mkdir` lock replaces it, with the lock's own mtime as the staleness signal (five
  simultaneous invocations now yield exactly one `STARTED` and four `RUNNING`).
- **CI's jsmin and the i18n scanner are pinned to a commit SHA and checksummed.** Both were fetched
  from `openwrt/luci@master` and then *executed* — jsmin is compiled from C and is the gate that
  decides whether the shipped JavaScript is safe. Off a moving branch, the gate is whatever upstream
  pushed last.

## [0.8.0] — 2026-07-13

### Added
- **The sidebar/top-bar layout is now an instant toggle in Appearance → Layout, remembered per browser.** It
  used to be a *server* choice: two theme entries in System → Design (`FootstrapSidebar`,
  `FootstrapOnTop`), each with its own `mediaurlbase`, its own template directory and its own menu
  renderer. Switching meant going through the Design page and reloading. It is now a client
  preference like dark mode — `:root[data-layout]`, pre-painted by `head.ut` before the first frame,
  so there is no flash — and switching repaints in place with **no page reload and no menu re-render**:
  the DOM already serves both, and the menu's existing `MutationObserver` folds the accordion into
  dropdowns (and restores it on the way back) because that is the same state change as collapsing the
  icon rail.

- **Three new CSS gates, each closing a hole nothing off-the-shelf covers** (`npm run check` runs the
  lot; all three are CI-only — the OpenWrt buildbot still needs nothing but `cat`).
  - `tools/css-dup.mjs` — **the same declaration body written under two different guards.** No linter
    can flag this and none ever will: to a cascade-aware tool, two rules under mutually-exclusive
    guards (a media query vs an attribute selector, a class vs a container query) are both *required*,
    since only one can ever match. Yet it is exactly the shape that drifts. This release deleted 55
    such declarations in the chrome and took the duplicate-body count from **4 groups (~41 redundant
    declarations) to 2 (~14)**; the detector holds the remainder to a budget, so what CSS genuinely
    forces on you stays visible and cannot grow.
  - `tools/fs-orphans.mjs` — **dead CSS, scoped to the `fs-*` namespace.** PurgeCSS/uncss and
    coverage-based pruning are actively dangerous here: the coverage contract exists *because* a
    third-party `luci-app-*` renders widgets no page we can see renders, and a tool that prunes what
    it did not observe will un-theme somebody's app. But nobody else can emit an `fs-` class — so
    inside that one namespace, "nothing we ship emits it" really does mean dead, with zero risk to the
    contract. This is the check that catches a selector left behind when its markup is deleted.
  - `tools/css-metrics.mjs` — a **ratchet** on `!important` (33: the 16 in theme/pages that fight an
    inline or unlayered declaration, plus base's 17), max specificity and empty rules. `stylelint`
    stops a *new* file adding an `!important`; this stops the allowlisted files quietly growing more.

### Changed
- **Design now lists ONE "Footstrap" theme instead of two.** `mediaurlbase` is always
  `/luci-static/footstrap`; the layout is no longer a server-side theme at all. A router that was on
  the old top-nav theme keeps its top bar: `uci-defaults` records it as the router's default layout
  (`luci.main.footstrap_layout=top`), which `head.ut` stamps onto `<html data-layout>` — so a
  *migrated router opens on the top bar even in a browser that has never seen it*, and the user's own
  choice (localStorage) overrides that default forever after. A shell script cannot write
  localStorage; this is the channel that carries the fact across the upgrade.
- **`data-layout` is always stamped with an explicit value, by the server.** Absent-means-sidebar
  would force every rule to be a *negative* match (`:not([data-layout="top"])`), and a future third
  layout would then silently inherit the sidebar's rules merely by not being "top". Every layout rule
  is a positive match instead, so a new layout has to opt in. It also means the chrome is correct with
  JavaScript disabled — the attribute exists before a single byte of script runs.
- **On a phone, every layout renders the same top bar.** The sidebar's phone bar and the top layout's
  bar are one look now, so a narrow screen shows the same chrome whichever layout is picked. Where the
  two layouts had ever disagreed on the same element, the top bar's value is the one that survived.
- **The top bar's "Log out" is the same control as the sidebar's** — a square icon button in the right
  cluster, not a separate text item in the menu. The menu renderer already dropped the tree's
  `admin/logout` node in favour of the theme's own control; the top layout used to carry both.
- **The bar is now written once, and the vertical sidebar is the exception.** The bar is needed when
  `(viewport ≤ 767px) OR (:root[data-layout="top"])`, and CSS cannot OR a media query with an
  attribute selector in one selector — so writing the bar under both guards meant writing it twice.
  Measured: **55 of ~75 declarations were identical**, i.e. free to drift apart in silence. Inverting
  it — the bar as the unguarded base, the vertical sidebar as a single guarded override that wins on
  specificity (`0,3,0` vs `0,1,0`), never on source order — states each of the three chrome states
  exactly once. This is only expressible because `data-layout` always carries an explicit value.
  `cssdiff` proves the inversion changed nothing it did not mean to: **zero unintended property
  differences across 3 014 elements**, the only differences being the two this release intends (the
  hostname wrap, and the mode menu's active item, now themed in every layout instead of only the top
  one).
- **The bar stacks its menu onto a second row only when the menu does not fit — measured, not guessed.**
  It used to be `@media (max-width: 1199px)`. But whether the menu fits beside the brand depends on how
  many sections the router HAS (a stock install renders 5; a box with a few `luci-app-*` renders eleven),
  so a device-width breakpoint is the wrong instrument. Measured on a stock router the bar's contents come
  to ~683 px, so one row fits down to ~723 px — **that breakpoint was stacking the menu on every laptop and
  throwing away a row of vertical space for nothing**. The menu now shrinks its pills first
  (`.fs-dense1/2`) and stacks only when even the tightest step still wraps: at 1000 px a stock 5-section
  menu never stacks, 11 sections shrink, and 13+ stack.

- **One measuring engine (`fs-fit.js`) for every "does it still fit?" decision.** Two places in the
  theme must decide something no CSS query can ask, because the answer depends on what the CONTENT
  needs rather than on how wide the screen is: whether the menu fits beside the brand, and whether a
  table can still be read as a table. Both were once breakpoints, and every one of those numbers was a
  guess that some real router got wrong. The shape of the answer is always the same — measure the
  element UNCOLLAPSED, then toggle a class — so the measuring, the frame-coalescing and the
  ResizeObserver live in one module and a caller supplies only the decision. It encodes three rules,
  the first of which is a bug that was actually hit: **measure uncollapsed** — a collapsed thing always
  "fits" (a stacked table is a pile of flex rows), so reading it as it stands un-collapses it and the
  next frame collapses it again, which is an oscillation. The second is a guard rather than a cure:
  **re-fit synchronously on a mutation**, because a `MutationObserver` callback is a microtask and runs
  *before* the frame is painted, whereas `requestAnimationFrame` runs *at* paint — so if a poller ever
  REPLACES a table element (the fresh one arrives without our class) the deferred path would paint one
  frame at full width. Measured on this router it does not: LuCI updates the cells in place and the
  class survives the tick, and 60 samples across 6 poll ticks show no flicker on either path. The
  synchronous fit costs one layout per mutation batch and removes the hazard anyway. Third: coalesce
  on resize.

- **The sidebar gives way to the bar when the CONTENT column would get too narrow — and the icon rail
  therefore holds on ~155 px longer than the expanded sidebar.** It used to be one viewport
  breakpoint (767 px) for both, which could not be right: the sidebar's cut is not a constant, it is
  224 px expanded and 68 px as a rail. So collapsing the sidebar handed ~156 px back to the content
  and then folded the whole thing away at exactly the same window width — the room it had just freed
  bought the user nothing. The decision is measured from the sidebar's real cut against a stated
  minimum (500 px of content), so the expanded sidebar now yields at ~780 px and the rail at ~625 px.

- **The poll indicator now looks like one of the controls it sits beside.** In the bar it is followed by
  the Appearance and Log out buttons, and it was a 28 px capsule next to two 34 px rounded squares —
  three sizes and two shapes where there is one row. It takes the buttons' height and the theme's
  control radius now; in the vertical sidebar, where its neighbours are full-width rows rather than
  square buttons, it spans the column instead of floating in the middle of it as a stray chip.

### Removed
- **The second menu renderer, the second template and the second stylesheet are gone**
  (`menu-footstrap-top.js`, `ucode/template/themes/footstrap-top/`, the `/luci-static/footstrap-top`
  symlink, `styles/theme/50-topnav.css`). They were never two designs — the sidebar renderer already
  emitted the markup that its own CSS turns into a horizontal bar on a phone, and it already had a
  "flyout mode" in which a section behaves exactly like a top-nav dropdown. The top layout is that
  mode, at desktop width: **the whole of the deleted renderer's unique logic was one function**
  (`clampDropdown`, which nudges a dropdown back inside the viewport near the right edge), and it now
  lives in the surviving renderer. Hover-to-open was always pure CSS. Deleting the second stylesheet
  paid for the new one almost exactly: the layout merge itself cost **+78 bytes of CSS**. (The release
  as a whole is +971 bytes — the rest buys the hostname wrap, the measured stacking and the
  content-width sidebar.)
- **The `with_label` template parameter and the elements it forked** (`.fs-appearance-btn`,
  `.fs-top-logout`). A layout is a presentation choice, so it must not fork the markup: Appearance and
  Log out are one row each, and the bar and the rail squash them into icon buttons in CSS.

### Fixed
- **A page with nothing to poll (Software, Backup…) showed a "Paused" pill, reporting on a poll that
  does not exist there.** LuCI shows the indicator on a `poll-start` event and flips it to "Paused" on
  `poll-stop` — and never hides it again (`ui.hideIndicator()` exists, but core only calls it for
  `uci-changes`). On a full page load that omission is invisible, because `Poll.start()` only
  dispatches `poll-start` when the queue is non-empty, so an unpolled page simply never grows an
  indicator. But this theme's SPA router flushes the queue and calls `stop()` on every navigation, and
  `stop()` *does* dispatch `poll-stop`. The pill now obeys the only rule that makes sense — it exists
  if and only if there is something to poll — so it disappears on an unpolled page and comes back on a
  polled one. A **manual** pause still shows "Paused", because there the queue is not empty and the
  word means something. This also cures the same ghost in stock LuCI, where removing the last poller
  stops the loop and leaves the pill behind.
- **Collapsing the sidebar into the icon rail and then shrinking the window made the sidebar spring
  back OPEN, and toggling it again dropped straight to the phone bar.** The rail's rules were guarded
  at `min-width: 768px` while the vertical sidebar's guard had moved to 521 px, so in the gap between
  them the vertical rules applied and the rail's did not — the sidebar expanded to its full 224 px as
  the window got *smaller*. The rail is a MODE of the vertical sidebar and can never be visible under
  conditions the vertical sidebar is not; the two guards are now literally the same.
- **The rail's "Refreshing" glyph could not be clicked to pause the poll — because it was spinning.**
  A target that never stops moving cannot be hit. It is now a still green glyph, which is also what it
  should have been: a spinner promises that something is happening *that you are waiting for*, while
  this is a poll ticking quietly in the background forever, and a permanently spinning icon in the
  corner of the eye just makes an idle router look busy. Pausing and resuming by click both work; and
  the glyph now goes grey when the poll is paused, instead of shining green while lying about it.
- **The "Refreshing" pill drifted away from the Appearance and Log out buttons in the bar** instead of
  hugging them. Both it and the buttons carried `margin-left: auto`, and two autos SPLIT the free
  space between them rather than pushing one cluster to the right edge.
- **The chevrons came back on the collapsed rail's menu items.** A rail item has no label and no
  accordion — its children fly out to the side — so the chevron says nothing and only crowds the icon.
  The rail's rule to hide it was (0,4,0) and lost to the vertical sidebar's (0,4,3), which turns it
  back on.
- **The apk Software package list stopped collapsing into rows and overflowed its section.** It is
  `<table class="table" id="packages">` — no `.cbi-section-table` class at all — and its header row is
  `.cbi-section-table-titles`, not the `.table-titles` the data-table tagger looked for. So it matched
  *neither* rule and needed a hand-written stacking block of its own, at a fifth breakpoint. The
  tagger now accepts either header markup, and the list card-stacks and un-stacks like every other
  data table.
- **A data table now becomes cards when it actually stops fitting, not when the viewport crosses a
  number.** It used to be a container query, and there were THREE thresholds for it — 568 for a plain
  table, 780 for the DHCP leases (their 8 nowrap mono columns hold a ~736 px floor, so they must card
  earlier) and 800 for the package list — with the last two each carrying their own **copy** of the
  card rules, because CSS cannot share a declaration block across two `@container` thresholds. Both of
  those were really asking *does it overflow?*, which is a **fact the browser computes**, so both are
  gone: the overflow is measured and each table discovers its own width — including a table from a
  third-party `luci-app-*`, whose column count we could never have guessed. The card rules now exist
  once. What survives is the one judgement a measurement cannot make ("too cramped to be a table at
  all", 568), and it sits beside the measurement rather than in the stylesheet.
- **A long hostname wraps instead of being silently truncated.** It was `nowrap` + ellipsis, which hid
  the one string that tells you WHICH router you are looking at. It now breaks across lines —
  `overflow-wrap: anywhere`, so it will break mid-word when a single "word" is itself wider than the box,
  but only when there is no better break, so a normal dotted name still breaks at its dots. Wrapping
  alone was not enough: the bar is flex-wrap, so instead of squeezing the brand, flexbox wrapped
  the *menu* away and let a 78-character hostname sit on its own line 609 px wide. The brand is therefore
  also **capped** (30ch), and the bar grows in height to hold the extra line.

## [0.7.18] — 2026-07-13

### Added
- **An Accent hue slider (Appearance → Accent) recolours the UI accent.** A second hue
  axis beside the background Tint, but pointed at the CHROME rather than the canvas: the
  solid buttons, the toggle knobs, the range sliders, the focus rings, the active
  menu/tab and the accented links all follow, because each reads `--fs-accent` or a
  `color-mix()` of it, and the brand logo rotates with it too. The rotation is
  `oklch(from … l c H)` — it keeps the palette's exact lightness and chroma and swaps
  only the hue, so `--fs-on-accent` stays legible on every hue (the ink is not
  recomputed). 0 = off = the palette's designed accent; the value is per-router
  (localStorage) and pre-painted by `head.ut` so a reload doesn't flash the default.

### Changed
- **The page footer ("Powered by LuCI…") is centred** instead of left-aligned, in both
  layouts.
- **A tagged release now leads with a short changelog summary instead of install
  boilerplate.** The release body was just apk/ipk commands — the actual list of
  changes lived only in the changelog nobody links from the release page. It is now
  generated from the tag's `CHANGELOG.md` section (`tools/release-notes.sh`): one line
  per change — the bold lead of each bullet, grouped under Fixed/Added/…, with the
  verbose rationale dropped — and the install commands moved into a collapsed block. The
  Russian summary (from `CHANGELOG_ru.md`) follows the English one under a divider, so the
  release page carries both languages.

### Fixed
- **A scrolling textarea's scrollbar overshot the field's rounded corners.** A native
  scrollbar is a square strip that `border-radius` does not clip, so on a tall config field
  (an NFQWS_OPT blob, a long option list) the grey bar poked past the top-/bottom-right
  corner as a square notch. The scrollbar is now a slim self-rounded thumb floated off the
  edges (a transparent border + `background-clip:padding-box` insets it, a transparent track
  lets the corner show through), via a `::-webkit-scrollbar` block. Deliberately no
  `scrollbar-width`/`scrollbar-color`: setting either makes Chromium switch to the standard
  scrollbar and ignore the custom one — and that standard bar is the square, unclipped one
  that caused the bug. Firefox keeps its native scrollbar, which it already clips to the
  radius. The resize grip is restyled to match: an accent arc tracing the frame's own
  rounded corner (following the Rounding setting and the accent hue) instead of the default
  white square that poked past it. The widget gallery gained a scrolling-textarea case so
  this stays covered.
- **The "Refreshing" poll pill sat at the far left of the phone top bar, before the logo.**
  On a phone the sidebar collapses into a top bar, but `#indicators` had no flex `order`, so
  it defaulted to 0 and rendered ahead of the brand (`order:1`). It now joins the right-hand
  cluster with Appearance and Logout (`order:2` + `margin-left:auto`), mirroring the top-nav
  layout's `.fs-topnav-right` where the pill is the first child.
- **A stacked data table's last row had square bottom corners against the rounded frame.**
  When a data table cards into label/value pairs on a narrow screen, zebra striping
  (`.cbi-rowstyle-2`) paints its background on the row itself, and the frame is
  `overflow:visible` — so a striped last row's square background overshot the 12px rounded
  corners. Stacked rows are flex-wrap and already fit the width (nothing horizontal left to
  clip, the only thing `overflow:visible` guarded), so the table is `overflow:hidden` while
  stacked, clipping the row backgrounds to the frame radius exactly as an ordinary `.table`
  does.
- **The last row of a data table drew a separator that poked out past the card's rounded
  corners.** The row-separator rule (`.tr:not(.table-titles):not(...)`, specificity 0,4,0)
  outranked the `.tr:last-child` override that was meant to drop it (0,3,0), so the last
  row kept its `border-bottom` — a straight 1px line that overshot the frame's rounded
  bottom corners on any `overflow:visible` data table (leases, wifi, processes). The
  exclusion now lives in the separator rule itself (`:not(:last-child)`), so the last row
  never gets the border and no specificity battle decides it. Invisible before only where
  the table was `overflow:hidden` and clipped the line.
- **The DHCP leases table stopped shrinking at ~736px and spilled out of its section.**
  The leases workaround kept every mono column (IPv4/MAC/IAID/Remaining/the Static-Lease
  button/Interface) on one line — `white-space: nowrap` — down to a 568px container, so
  the table held a data-dependent intrinsic floor (~736px on a busy router). But the
  card-stack that folds a data table into label/value pairs only kicked in below 568px,
  leaving a 569–780px dead band where the table could neither shrink nor stack and
  overflowed the card. The `.leases`/`.leases6` pair now stacks from 780px down —
  matching stock bootstrap, which switches its tables to the phone layout early rather
  than forcing a scroll — while nowrap only stays on at ≥781px, where the real table
  genuinely fits. The two thresholds are adjacent (780/781) so no width is left with
  neither behaviour. Other data tables (Processes/Startup/Routes) are narrower and keep
  the shared 568px threshold.

## [0.7.17] — 2026-07-13

### Changed
- **Data tables on a phone stack the way stock LuCI stacks them: the column label sits
  above its value, and each cell takes half the row.** They used to put label and value
  on one line with the value flushed right, which left the value about 40% of the
  width. An Associated Stations row then spent 7 full-width lines, and its
  `.ifacebadge`, signal graph and long DUID wrapped under their own labels anyway.
  Half-width pairs fold the same row into 4 lines and hand the value the whole
  half-column. The row's buttons (Disconnect, Reserve IP) take a full-width line of
  their own below the pairs. Values stay left-aligned: a MAC, a DUID or a rate is an
  opaque string, and a ragged right edge reads worse than a ragged left one.
- **Config tables stack the same way, and a cell holding a widget keeps the full
  width.** A `.cbi-section-table` row (OpenVPN instances, firewall zones, port
  forwards) used to card into `label : value` lines with the value flushed right. It
  now uses the pair layout above: read-only cells at half a row (`data-widget` =
  dummy/flag/button, in both the `CBI.*` spelling `form.js` emits and the lowercase one
  the Lua CBI does), and any cell with an input, select or dropdown in it at the full
  width, because a dropdown half a phone wide cannot be used. Row buttons get their own
  line.
- **The width at which a data table stops being a table is stock LuCI's now, not
  ours.** Bootstrap's `mobile.css` stacks at `max-device-width: 600px`; the theme
  carded at a container width of 800px, i.e. on small tablets and narrow desktop
  windows where the real table still fits. The threshold is a 568px `#view` container:
  a 600px viewport, less the 16px of side padding `.fs-content` carries below the 767px
  tier. The DHCP-leases nowrap rule moved to the adjacent `min-width: 569px`, so no band
  of widths is left with neither behaviour.

### Fixed
- **A dialog on a phone laid its form out as if it were a desktop, and cut the inputs
  off at its right edge.** Every mobile rule in the theme was scoped to `#view`, and
  `ui.js` appends a modal to `<body>`, so none of them ever reached it. The
  `@container` queries that stack tables resolved to nothing in there either, because
  a modal sits inside no container the theme names. The modal is now a container in
  its own right (`fs-view fs-content`), and the field-stacking rules no longer ask for
  `#view`. Any app's dialog stacks the way its page does, not just the dialogs we
  happened to test.
- **The theme ignored the phone contract that every `luci-app-*` is written against.**
  LuCI's own JS marks the cells it wants dropped on a phone with `.hide-xs`/`.hide-sm`
  and weights columns with `.col-1`…`.col-10` (`wireless.js`, `connections.js`,
  `package-manager.js`, `channel_analysis.js`, `ui.js`). No stylesheet but bootstrap's
  `mobile.css` styles those classes, so a theme that skips them renders a layout the
  app's own JS believes it has already handled. Associated Stations was showing the MAC
  column stock LuCI hides, at the cost of half a row. Both class families are
  implemented now. Stock needs `!important` to win that cascade; one extra class
  (`.table .td.hide-xs`) does it here.
- **Forms on a phone zoomed the page in and never zoomed back out.** iOS Safari zooms
  when a focused control's text is smaller than 16px, and the theme's inputs are 13px.
  Below 767px they are 16px now, as in stock LuCI.
- **A stacked config row stayed one column deep whatever the rules said.** Two rules
  from elsewhere were landing on its cells. The Lua CBI gives a table cell the same
  `.cbi-value-field` class a form field carries, and base indents that class by 20px to
  sit it next to its label, so a pair-cell measured `50% + 20px`, two of them no longer
  fit a line, and each wrapped onto its own. Cell padding, meanwhile, is written as
  `.table.cbi-section-table .td`, which outranked the stack's plainer selector, so the
  stack's padding never applied at all. Both are fixed where they are written, not with
  a flag.
- The header row of a config table stayed visible on a phone and ran off the right
  edge, above a card that already repeats every one of its labels. The rule hid only
  `.thead`, which is the JS form's markup. The Lua CBI that half the third-party apps
  still render through (`luci-app-openvpn`) emits a bare `tr.cbi-section-table-titles`
  instead. Both are hidden now.

### Performance
- **The overview showed nothing at all until its slowest section answered.** Stock
  `view.status.index` calls `poll_status()` with a `Promise.all` over every include's
  `load()`, and `render()` does not return its tree until that settles, so `#view` stays
  empty for the whole wait. Measured on the dev router (warm, in-place nav): 229 ms
  before the first section appeared, while System, CPU, Memory, Storage, DHCP and
  Network had their data at 88 ms and were held back by `29_ports` and `60_wifi`
  (180 ms each). Sections now paint as soon as their own data lands: first section
  229 → 91 ms, everything filled 243 → 191 ms.
- **The overview fetched all of its data twice on every visit.** Stock registers the
  poller only after the first load completes, and `Poll.add()` steps immediately, so the
  page re-ran every include's `load()` right after painting: roughly 250 ms of ubus work
  for data it had just fetched. An in-flight guard folds that second run into the one
  already running: 9 → 5 ubus requests per navigation.
  Both come from replacing `poll_status` from the theme's own overview include, which
  loads inside `index.load()`. That is the one window where the swap is safe (the view
  instance exists, `render()` has not been called), and it covers a full page load and
  an in-place nav alike. The section frames, the includes, their `render()` output and
  the Hide/Show toggles all stay upstream's. `fillSection()` is a transcription of
  stock's own loop, kept in the same order so it can be diffed against `index.js` when
  luci-mod-status changes. If the shape it expects is not there, the patch is skipped
  and the page runs stock.

## [0.7.16] — 2026-07-12

### Added
- The SPA router now follows `alias` and `firstchild` menu nodes, so the links
  that used to be its blind spot navigate in place like every other page:
  Firewall, System Log, Realtime Graphs, Administration, Terminal, Attended
  Sysupgrade. Those are 6 of the 27 links the menu renders — and among the most
  clicked — yet each one still did a full page reload, because the router only
  recognised `view` nodes and an alias is a redirect, not a page. Coverage over
  every clickable node goes from 50 to 62.
  Resolution is a port of `resolve_firstchild()`/`node_weight()` from
  `dispatcher.uc`, not an approximation of it: the same weight (`order ?? 9999`,
  a login node last), the same `firstchild_ineligible` and `satisfied` filters,
  the same recursion into a nested `firstchild`. It has to be exact — the server
  answers an alias URL with a 200 at that URL and resolves the leaf internally
  (no redirect), so a client that picked a different child would open one page on
  a click and another on F5. Verified against the live router: for all 65
  clickable nodes the SPA's `data-page`, `dispatchpath`, `pathinfo`, URL and tab
  strip are identical to a real full load of the same URL, in both layouts and
  across Back/Forward. `rewrite` is deliberately left alone (the tree has none,
  and a wrong guess would open the wrong page — worse than the reload it falls
  back to).
- This changelog and its Russian mirror.

### Changed
- Stylesheet deduplicated: 1.4 KB smaller, nothing rendered differently
  (`cssdiff` over nine pages). The solid buttons were written out twice, byte for
  byte, so a recolour would have landed on half of them. Twelve `base`
  declarations that a `theme` rule already repaints through a *different* selector
  are gone; `audit.py` compares identical selectors only and could not see them.
- `setOpen`, the Space key, click-outside and Escape lived in both menu files, and
  the copies had drifted: only the sidebar checked flyout mode. One implementation
  in `menu-footstrap-common.js` now, with the selector passed in. Byte-neutral
  after minification, but the two layouts can no longer disagree on what `.open`
  means.

### Fixed
- Read-only users got working Save/Apply/Reset buttons. The SPA router rebuilt
  `L.env.nodespec` on every navigation and dropped its `readonly` flag, which
  `luci.js` reads as `hasViewPermission() = !env.nodespec.readonly`. A full page
  load disabled the buttons correctly; arriving by menu click did not.
- The active interface lost its highlight. `.ifacebox-head.active` was declared in
  `base` while `theme` repainted the plain `.ifacebox-head`, and a cascade layer
  beats specificity, so IPv4 Upstream and the radios drew as flat grey plates.
- The SSH-Keys list was capped at 440 px, wrapping a ~400-char key over three
  lines. Its `max-width: none` sat in `base` and lost the same way. Moved to
  `@layer page`, which actually wins.

### Performance
- **Every view was rendered twice on the first visit to a page, and registered two
  pollers.** LuCI's `require()` does not hand back a class — it caches an *instance*,
  so requiring a view for the first time constructs it, and a view's `__init__` *is*
  its render (that is all `ui.instantiateView()` does). The router required the view
  and then built a second instance on top, so the page was painted twice and polled at
  double the RPC rate for as long as the user stayed on it. A fresh instance is now
  built only on a revisit, when `require()` returns the singleton whose `__init__`
  already ran. Present since the router landed.
- **A view whose content comes from its first poll took up to 5 s to fill after an
  in-place navigation.** Wireless is the visible case: its station list is drawn from
  the first poll, and it sat spinning for 4950 ms against ~360 ms on a full page load.
  LuCI runs one 1 s tick and fires a poller only when `tick % interval == 0`; a full
  load calls `Poll.start()`, which zeroes the tick and steps at once, whereas the
  router kept the *outgoing* page's tick running, so the incoming view's poller had to
  wait for the next multiple of its interval. The poll loop is now put back into the
  state a fresh load leaves it in (`stop()` then `start()` on an empty queue), and the
  view's own first `poll.add()` arms the timer and takes the first step — which is
  exactly the upstream sequence, not a shortcut around it. Wireless: **4950 → 137 ms**,
  Realtime→Wireless: **55 → 16 ms**. Note `stop()` alone is not the fix and never was:
  it deletes the tick, and `Poll.add()` only auto-starts when the tick exists, so the
  page would never poll at all. Also note the two bugs above are one bug: re-arming the
  poll while the view still rendered twice made the realtime graphs throw, because
  `view/status/load.js` keeps its graph list in a module-level array (a LuCI module is
  a cached singleton across SPA navs) and indexes its RPC results by that array's
  current length — the second render grew it mid-flight. Fixing the double render
  closed that window for good.
- The navigation benchmark now covers **38 standard pages, up from 14**, compares
  **three themes** (stock `luci-theme-bootstrap`, third-party
  `luci-theme-proton2025` 1.3.0, footstrap), and all 38 pages open in footstrap
  without a page reload. Summed medians: **10517 ms bootstrap, 11680 ms proton2025,
  4638 ms footstrap**; median per-page speedup **3.43x** over bootstrap and **3.94x**
  over proton2025, and there is no longer a single page where footstrap loses. Network
  requests per navigation drop from 15–48 (bootstrap) and 27–72 (proton2025) to
  **0–8**. proton2025 is *slower* than the stock theme it restyles — it ships 436 KB
  of CSS against footstrap's 106 KB and has no client router.
  The pages the old benchmark missed are the ones the theme is fastest on: a tab or an
  alias link carries almost no work of its own, so a full reload spends its whole time
  restarting the runtime — Realtime→Wireless 287 → 16 ms (17.5x), Diagnostics 189 →
  21 ms (9.2x).
  Two harness bugs were producing plausible but false numbers and are fixed: a
  3-second wait for a spinner that a cached view never renders (it reported ~3017 ms
  for the eight *fastest* pages), and a readiness check that the outgoing page's DOM
  already satisfied. Readiness is now "the old nodes are gone", which is exactly what
  `dom.content(#view, …)` guarantees.

## [0.7.15] — 2026-07-12

### Fixed
- CI never ran. A step name contained `": "`, which an unquoted YAML scalar cannot,
  so the parser read it as a nested mapping and rejected the whole workflow. Every
  run since 0.7.13 died at 0 s with no job starting.
- `build-css.sh` silently dropped a wrapped declaration. `squeeze()` joined lines
  with nothing between them, so a `calc()` spanning two source lines became a parse
  error (`…))- .004 *`). The custom property went undefined, every `var()` reading
  it turned invalid at computed-value time, and the surface fell back to `unset`: a
  white canvas at 1.5:1. The source was valid CSS, the build exited 0, the brace
  check passed. A newline now collapses like a space; existing sources build
  byte-identically.
- The tint had a flat chroma, so its strength depended on which hue you picked,
  which is the one thing an identity cue must not do. Blue and violet did nothing
  (the canvas is a blue-grey and already out-chroma'd them), warm hues were too strong, and
  light mode showed nothing at all. Chroma is now a floor plus a `cos()` boost
  peaking at 258° and a warm-sector subtraction at 55°. Light gets a higher floor
  than dark, because near-white has almost no chroma of its own.
- Cats wallpaper opacity `.15` → `.20`. A tinted canvas swallowed the old value.

## [0.7.14] — 2026-07-12

### Added
- Tint slider (Appearance → *Tint (router identification)*, 0–360, 0 = off). One hue
  washes into the page canvas. `localStorage` is keyed by origin, so the hue is
  per-router with nothing server-side: the main router reads green, the AP violet,
  and a screenshot pasted into a ticket says which box it came from. The tint sets
  hue and chroma via `oklch(from …)` and leaves lightness alone. `color-mix()` was
  written first and is a trap in a polar space: the result's hue snaps to the tint's
  almost immediately, so the percentage controls nothing you can see. Both contrast
  gates sweep the tint.
- A translation catalogue. Every string was already wrapped in `_()` and `head.ut`
  already loaded LuCI's client catalogue, but `luci.mk` derives `LUCI_LANGUAGES`
  from `po/*` and there was no `po/`, so no language package was ever built and
  every `_()` fell through to its English msgid. `luci-i18n-footstrap-ru` builds
  now, and `update-po.sh --check` is a CI gate, because a translation that never
  gets compiled cannot fail loudly.

### Changed
- Derived colours and motion are named tokens. 39 inline `color-mix()`es had no
  name, and an unnamed level drifts in silence: the same hairline was 40% in one
  file and 45% in another, the same diff surface 30% in `base` and 18% in `theme`.
  The derived tier is a four-step ladder (`-soft` 12%, `-fill` 18%, `-line` 40%,
  `-line-hi` 55%), and the role × step matrix is complete on purpose. Motion went
  from seven durations and four curves to four durations and no easing token at
  all; every transition takes the CSS default.
- The `--*-color-*` export tier is a real ramp, not three aliases. `high`, `medium`
  and `low` were one token under three names, so an app asking for a gradation got
  one flat colour: `luci-app-podkop` painted its "no data" latency in the same
  vivid accent as a live value. The ramp's axis is chroma at constant lightness.
  `tools/export-tier.mjs` gates it with 256 checks and proves `high != low`,
  because a flat colour passes every contrast threshold there is.

### Fixed
- A button dropdown's chevron takes the button's own ink (`currentColor`) instead
  of `--fs-dim`. On the accent-filled Save & Apply it was grey on blue and read as
  a smudge. Form-control dropdowns keep the muted chevron on purpose.

## [0.7.13] — 2026-07-12

### Changed
- Tokens split into a private tier and an outbound export tier. `:root` is a shared
  global scope, and every `luci-app-*` drops its CSS into the same document
  unlayered, which outranks every cascade layer. One app writing `:root { --accent:
  … }`, or `--radius`/`--text`/`--border`, repainted this whole theme silently.
  Base reading the *conventional* names was the wider hole, since `--text-color-high`
  is a LuCI convention and an app is likelier to declare it. Measured against a
  hostile `:root` over the widget gallery: 312 of 336 elements repainted before,
  0 after. `audit.py` fails on any read of an export name from inside `styles/`.

### Removed
- The RGB colour bridge (`--accent-rgb`, `--error-color-high-rgb`, …): the HSL
  bridge's mistake in a different notation, a hand-kept second copy of a colour
  that already exists as a token. It goes stale when a palette is recoloured, and a
  missing triple makes the declaration invalid at computed-value time, so the tint
  vanishes with no error anywhere. Consumers take `color-mix()` over the token now.
- 51 dead base declarations that a later layer repaints on the same selector, found
  by a new cross-layer check in `audit.py`. The check keeps them apart from the
  absorption backlog (50 declarations where only part of a selector group is
  repainted), which must not be deleted: that would un-theme the widgets no shipped
  LuCI page renders but a third-party app does.
- 11 redundant `!important` flags (44 → 33), each checked property by property
  against the JS that writes the inline style it was supposed to fight.

### Performance
- The bold mono face is gone: 20 KB fetched on every page, 30% of the font payload,
  drawing 227 elements across seven pages that were all *labels*. LuCI writes every
  status readout as `<strong>MAC:</strong> ac:1f:6b:…`, where the strong names the
  datum and the text after it is the datum. Labels take the UI face now, at zero
  cost, since Manrope 700 is already loaded. Fonts on disk 94 664 → 68 488 B; the
  CI budget ratchets down to 70 KB.

## [0.7.12] — 2026-07-12

### Added
- CI gates every push and PR, not just tags. `check` needs nothing but
  `python3`/`awk`/`sh`, so it can never break the OpenWrt buildbot: shell syntax,
  the stylesheet build with its size budget, a font-byte budget, and `audit.py
  --strict` (the flag is new; the script always exited 0 and was useless as a
  gate). `lint` is npm-only and CI-only: eslint, stylelint, axe-core over the widget
  gallery across the full {light,dark} × {footstrap,hicontrast} matrix, and the
  minifier-equivalence check.
- OpenWrt 24.10 support, verified rather than assumed. The `openwrt-24.10` branch of
  `openwrt/luci` is already ucode, every template API this theme uses exists there,
  and the `L.env` blob the menu and SPA router key off is byte-identical between the
  branches. Only the package manager differs (apk vs opkg).
- `docs/18`: the peer baseline (what argon/aurora/proton2025 actually ship, measured
  from their repos), the standards checklist, and the audit this release came out of.

### Fixed
- Accessibility, up to WCAG 2.2 AA. Buttons had no focus indicator at all: base
  listed `button:hover`, not `:focus`, and the theme layer erased what was left. One
  global `--on-accent: #fff` sat on every fill in every mode and measured 1.69:1 on
  dark palettes' light fills; it is four inks now, defined per palette and per mode.
  The "hicontrast" palette was less contrasty than the default. Chips had a systemic
  bug: text of colour C on a translucent tint of C eats its own contrast, and being
  translucent its value depends on the surface underneath, so no percentage is safe
  everywhere. Plus `prefers-reduced-motion`, `forced-colors`, the W3C APG disclosure
  pattern for menus, a `<nav>` landmark, a skip link, an `<h1>` and 24 px touch
  targets.
- `fs-select.js` leaked a listener per option-list rebuild. All three
  MutationObservers ran a full scan on every poll tick, forcing layout. `data-page`
  was stamped from the *request* path, so `/admin/status` produced `admin-status` and
  every page-scoped rule silently missed. A self-update RPC in flight could outlive a
  navigation and throw a modal onto an unrelated page.
- The `PKG_UPGRADE` install guard was dead in production. apk never sets it, so only
  `dev-sync.sh` ever took the upgrade branch. A marker file decides fresh install vs
  upgrade now.

### Security
- The self-update script's state moved out of `/tmp` into root-owned
  `/var/run/footstrap-update`. `/tmp` is 1777 and the old paths were predictable, so
  a local user could pre-create them as symlinks and make root's `cp`, `chmod`,
  `curl -o` and `>` write through to a file of their choosing (CWE-377). `PATH` is
  pinned, since rpcd lets the caller pass env. Both `curl` calls gained timeouts, and
  a truncated cache no longer wedges the update button until reboot.

### Performance
- The JS is minified again (83 → 35 KB). `LUCI_MINIFY_JS:=0` had been copied from
  the CSS side, where it is justified, since csstidy mangles `:has()`/`color-mix()`.
  But `luci.mk` minifies JS with jsmin, which is already on the buildbot, and uhttpd
  serves `/www` uncompressed, so those were wire bytes and flash bytes both.
  Comments stay in git. jsmin's hazard is real and silent: it tells a regex from a
  division by one preceding character, and can swallow the rest of a file while
  exiting 0. So `wrap-regex` forbids the shape and `tools/jsmin-verify.mjs` proves
  the output is token-identical to the source.
- `build-css.sh` squeezes the whitespace CSS ignores (117.5 → 108.3 KB), proven
  behaviour-neutral with `cssdiff` over ~4000 elements.

## [0.7.11] — 2026-07-12

### Added
- Bilingual GitHub issue forms. The bug form asks for what a layout bug cannot be
  reproduced without: theme version, board, layout, palette/mode, page path, viewport,
  and whether stock `luci-theme-bootstrap` shows it too.

### Changed
- The HSL component bridge is gone. Every base shadow and hairline that read
  `--*-hsl` / `--*-h/s/l` uses `color-mix()` over the real palette tokens, so a
  palette edit repaints them with no hand-synced copy. The native select chevron is
  a per-palette data-URI (a data-URI cannot read `var()`), so it follows palette and
  mode.
- The header and footer chrome is shared between both layouts. Brand, appearance
  button, logout, notices and the whole footer were written twice and had drifted;
  they live in `themes/footstrap/partials/` now. The page title goes through
  `striptags()`, because a third-party menu title is not trusted markup.

### Fixed
- `ui.Select.setValue()` rewrites the native select without dispatching `change`, so
  the enhanced widget went stale: it showed the old value while Save read the new one.
- A missing `#tabmenu`/`#modemenu` no longer rejects out of `ui.menu.load()` and kills
  every menu. SPA navigation carries a generation token, so a slow view can no longer
  render into `#view` on top of a newer one.
- `luci.mk` keys `Build/Prepare` on `LUCI_NAME`, which defaults to the checkout
  directory name, so a differently-named checkout silently skipped the CSS build.
  Pinned.
- `postrm` moves an active footstrap `mediaurlbase` back to `bootstrap` instead of
  leaning on LuCI's runtime fallback.

## [0.7.10] — 2026-07-11

### Fixed
- `appearance: base-select` is scoped to LuCI form selects only (issue #2).
  Third-party app selects, such as podkop-plus's connection-monitor filter, sit
  outside `.cbi-value-field` and populate options via `replaceChildren`. Forcing
  `base-select` on every select made them render Chrome's customizable `::picker`,
  which early Chrome builds mis-render, showing only the first option. App selects
  fall back to a themed closed control plus the native, reliable dropdown list.

## [0.7.9] — 2026-07-11

### Fixed
- The apk Software page stacks on phones. It injects an unlayered inline `<style>`
  (`.controls{display:flex}`) that no cascade layer can outrank, so the
  Filter/Download/Actions columns crammed side by side and their labels overlapped.
  The disk-space bar's value drops below the bar with reserved space, so the long
  "N MiB used of …" no longer collides with the label.

## [0.7.8] — 2026-07-11

### Fixed
- One seam-free wallpaper layer per layout. Top-nav painted the cats on both
  `.fs-topwrap` and its `.fs-main-top` child, so two semi-transparent tile layers
  doubled and misaligned. The denser new art made the seam obvious.
- An empty data table renders cleanly. `L.ui.Table`'s single-cell placeholder row
  spanned only the first column in a `display:table` table, and the corner rounding
  drew a tiny box.

## [0.7.7] — 2026-07-11

### Changed
- New cats artwork (`docs/design/cats_final3.svg` is the editable source), recoloured
  to the theme's neutral and slightly denser (tile 520 → 440 px).

## [0.7.6] — 2026-07-11

### Changed
- Standard breakpoints: mobile ≤767, tablet 768–1199, desktop ≥1200, remapped
  everywhere including the flyout-mode JS breakpoint. The overview grid moved from a
  viewport `@media` to a `@container`, and the content column cap goes
  1040 → 1280.
- The Port status cards on the overview are count-agnostic (`auto-fit
  minmax(126,200)`, so 2 to 24+ ports lay out without a card stretching full-width),
  with a per-card container query that stacks speed and traffic when a card is too
  narrow.

### Fixed
- A long DHCP hostname wraps instead of forcing the table wide.
- Config-form modals widen to `min(1100px, 94vw)` via `.modal:has(.cbi-map)`, so a
  table inside (Bridge VLAN filtering) shows as a real table on desktop instead of
  cards.

## [0.7.5] — 2026-07-10

### Changed
- Palettes are swappable variant blocks, one self-contained block per colourway ×
  light/dark in `styles/03-palettes.css`. Adding a colourway is copying a block. Zero
  render change.
- The sidebar's redundant page-title topbar is gone, and `#indicators` moves to the
  top of the sidebar (a spinning glyph on the collapsed rail).
- Data tables reflow to fit the content column instead of scrolling horizontally.

### Fixed
- Top-nav on phones: Log out becomes an icon button, and `stripFitsOneRow` ignores the
  hidden item, so the menu still shrinks to one row.
- `.cbi-value` stacks on phones, so a field's help text gets the full column instead of
  an 8-line crush.

## [0.7.4] — 2026-07-10

### Added
- Rounding slider (Appearance, 0–20 px). One user base radius drives the whole scale
  proportionally, and 76 literal radii across 15 files became tokens. `head.ut`
  pre-paints it before first paint, so a reload never flashes the old radius.

### Fixed
- System → Administration → SSH-Keys renders its whole view as a bare `<div>` with no
  `.cbi-section`, so on the wallpaper the text sat frameless. It gets the panel card.

## [0.7.3] — 2026-07-10

### Fixed
- Phantom scroll on every tabbed form (Network → DNS/Interfaces/DHCP, Firewall, Flash).
  Inactive tab panes were collapsed to `height:0; overflow:hidden`, but a
  clipped-content pane still inflates `scrollHeight`, and DNS scrolled 792 px into
  blank space below the footer. The old `display:none` fix only matched `.cbi-section`
  panes, and dnsmasq renders each tab as a plain `<div data-tab-title>`.

## [0.7.2] — 2026-07-10

### Added
- Appearance popover: Wallpaper group (Off/Cats), palette reduced to 2
  (footstrap/hicontrast), Submenus and Updates toggles restored.
- Tabs and top-nav auto-fit. JS measures the wrap and applies density classes,
  trimming padding first and font last, with a text floor.

### Changed
- Data tables get a whole-table contour with rounded corners, and any direct parent in
  `#view` scrolls, so a table never pokes past its section.

## [0.7.1] — 2026-07-10

### Fixed
- The release check caches for 5 minutes, not an hour. The TTL is exactly how long a
  freshly published release stays invisible in the popover, and an hour made a stale
  badge indistinguishable from a broken check. At 300 s the worst case is 12 API
  calls/hour, well inside GitHub's anonymous budget.

## [0.7.0] — 2026-07-10

### Added
- `audit.py` checks for declarations shadowed within a layer, so the stylesheet cannot
  drift back into a changelog.
### Changed
- The styles tree is one directory per cascade layer (`tokens, base, theme, page`),
  with the 2300-line base stylesheet split by component. Rule order inside each layer
  is unchanged, and `cssdiff` reports zero computed-style differences on both layouts.
- The changelog-shaped duplication is collapsed. 182 declarations were shadowed by a
  later rule on the same selector, 108 of them restating an identical value. Tabs were
  described twice, the base button three times, the open dropdown list five times. Two
  of those duplicates were load-bearing through source order alone, and now win on
  specificity instead of position. Minified output 116 → 110 KB.
- The last of the bootstrap heritage is gone. The 28 hardcoded colours left in base are
  tokens (`.close` rendered `#000` on a dark background), `common.bootstrap()` became
  `common.init()`, and the word is out of filenames and comments. The Apache-2.0
  attribution in the banner stays, being a licence obligation rather than a description.

### Removed
- The four legacy `-dark`/`-light` media and template symlinks per layout.
  `uci-defaults` migrates a stale `mediaurlbase` before the on-disk check runs, so they
  guarded nothing.


---

Everything below 0.7.0 predates this file and is summarised one section per minor
line, not one per tag. The individual patch releases are in the git history.

## [0.6.x] — 2026-07-09 … 07-10

### Added
- The theme version in the Appearance popover, an update badge when a newer GitHub
  release exists, and one-click self-update. The backend is an ACL-gated `file.exec`
  of one fixed path with no arguments, installing with apk on 25.12 or opkg on 24.10.
- An Updates toggle (Check/Off). Off skips the GitHub call entirely: no fetch, no
  badge, no button.

### Changed
- The release check moved off the browser and onto the router. A LAN client often has
  no route to the internet while the router does, and GitHub allows 60 anonymous calls
  per hour per IP, which a check on every page load burned through.
- Self-update runs detached. `rpc.js` aborts the XHR after 20 s and rpcd kills the
  exec'd process after 30 s, so a synchronous install could not fit and rpcd could kill
  apk mid-install. The script spawns a worker and the client polls `status`.

### Fixed
- Self-update reported failure when it had succeeded. `postinst` restarts rpcd, which
  drops the session, so the status poll died with "Login session is expired". That is
  the success path, and it says so now, with a Log in again button.
- The dropdown chevron had no hit area. `font-size: 0`, which hides the stock textual
  arrow, also collapsed the inherited `line-height`, so the span measured 28×0 while
  the chevron rendered outside it. Aiming at the visible chevron hit the button behind
  it, and on Diagnostics that started a ping. Now 34×30.
- Widget tables lost their rounded frame. A real `<table>` inherits `border-collapse:
  collapse`, which ignores `border-radius`, and the corners had come from an
  `overflow: hidden` that was dropped so an open dropdown would not be clipped.
  Switched to the separated border model with zero spacing: same layout, radius applies.
- The sidebar rail was gated at min-width 901 px while the mobile bar moved to 600, so
  between 601 and 900 the collapse button set `data-rail` with no rule to match it.
- A progressbar's value overlapped the row divider in multi-column tables
  (cpu-status "Detailed load of each CPU").

## [0.5.x] — 2026-07-09

### Added
- Collapsible sidebar rail (`data-rail`, persisted, applied before paint). Section
  submenus become hover/tap flyouts and leaves get a tooltip.
- Below 900 px the sidebar becomes the same sticky, blurred bar the top-nav layout uses.
- A Submenus switch in Appearance (sidebar only): Keep open, or Auto-collapse.

### Changed
- The custom overview dashboard is retired. `05_footstrap_dashboard.js` re-rendered a
  page-tall tree on every poll, which flickered and reset mobile scroll. A layout-only
  include replaces it: it tags the stock System/Memory/Storage sections and wraps them
  in a grid, leaving stock content and polling untouched.
- Every progressbar collapsed into one thin 10 px meter with the value above its right
  edge. Memory, Storage, CPU load, Active Connections and the Software disk bar all
  render identically now.
- The page heading and every tab strip sit in a rounded card.

### Fixed
- Login was a blank page. The forked `sysauth.ut` parked the form in a
  `<section hidden>` and revealed it from a view module, but there is no session on the
  login page, an RPC in that chain answers Access denied, and `render()` never ran. The
  card is rendered server-side now, with no JS at all.
- Keep-open sections survive a full page load, not just an SPA nav. The set lives in
  `localStorage` (`fs-menu-open`).
- Inactive CBI tab panes are taken out of flow. A `height:0; overflow:hidden` pane still
  inflates `scrollHeight`, which added ~585 px of phantom scroll below the footer.
- The sidebar-to-top-bar breakpoint dropped from 850 to 600 px, so the sidebar stays
  usable on narrow tablets.
- `form.TableSection`/`GridSection` render their table without an id, so the key/value
  rules were forcing `width: 40%` and `nowrap` on the first column and starving the
  data columns.

## [0.4.x] — 2026-07-09

### Added
- A client-side SPA router. A menu click re-instantiates the target LuCI view in place
  instead of reloading the page: no re-parse of `luci.js`/`cbi.js`, no re-fetched
  translations, no menu rebuild. It covers `view` nodes (~89% of pages), and
  call/function/template/alias nodes, external links, downloads, modified clicks and
  any error fall back to normal navigation. `pushState` keeps real dispatcher URLs, so
  F5, deep links and back/forward still work.
- A Playwright navigation benchmark against stock bootstrap: median 2.28× faster
  click-to-render, 1.91× total, and 15–39 requests per page down to 1–4 (`docs/15`).
- The uci changes modal is themed: token-based diff tints instead of the vivid stock
  colours, rounded to match the cards.

## [0.3.x] — 2026-07-08

### Added
- The GitHub Primer palette becomes the default `footstrap`; the previous high-contrast
  look stays selectable as Hi-Contrast.
- The cats wallpaper, shipped self-hosted, first as the Roman palette and then renamed
  Rvht (the legacy value migrates client-side before paint).
- CI builds an ipk for 24.10 alongside the apk for 25.12, and `install.sh` detects apk
  vs opkg and fetches the matching asset.

### Changed
- Six theme entries collapse to two layouts, FootstrapSidebar and FootstrapOnTop. Mode
  and palette became client-side toggles, and `uci-defaults` migrates existing installs
  onto their base layout.
- Standalone data tables (leases, Processes, Startup, Associated Stations) stack into
  cards below 820 px. They carry no `.cbi-map` wrapper, so the section-table container
  query never reached them and they overflowed to ~800 px on a phone.
- `postinst` and `postrm` restart rpcd, so a direct apk/opkg install picks up the ACLs
  and the theme registration without a reboot.

### Fixed
- Top-nav dropdowns work on touch. Hover-only submenus were unusable there: a tap now
  toggles a popup card below the bar, a second tap closes it, and on a hybrid device a
  real mouse entering the menu drops the tap-opened panel.
- The firewall zone table stacks through container queries instead of overflowing.

## [0.2.x] — 2026-07-08

### Added
- The Appearance popover (Mode auto/light/dark, plus Palette), replacing the plain dark
  toggle. Client-side, instant, persisted, no reload.

### Fixed
- Saving a wireless config, or any form with a native select, failed silently.
  `fs-select` rendered its styled dropdown *before* the native `<select>`, making the
  dropdown `frameEl.firstChild`, and `ui.Select.getValue()` reads
  `this.node.firstChild.value`. It got a `<div>` and returned undefined. The dropdown
  goes after the select now, with the value mirrored both ways.
- Inactive tab panes showed a ~38 px phantom strip on first render. LuCI sets
  `data-tab-active="true"` on the shown tab only, and the others carry no attribute yet,
  so a rule keyed on `"false"` missed them.
- The duplicate-hide MutationObserver was installed once per poll, leaking observers and
  slowing the page progressively.
- The `--faint` token (table headers, field labels) was used but never declared.
- The Enabled button on System → Startup was blue text on a green fill.

## [0.1.x] — 2026-07-08

### Added
- First release. `luci-theme-footstrap` for OpenWrt 25.12+: two layouts, a ucode-only
  server shell, and an apk build through the OpenWrt SDK.

### Fixed
- LuCI's CSS and JS minifiers are disabled. csstidy mangles `:has()`, `color-mix()` and
  nested `calc()`, which broke the layout outright. JS minification came back in 0.7.12,
  once jsmin was proven safe by a token-equivalence gate.

[0.12.5]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.12.4...v0.12.5
[0.12.4]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.12.3...v0.12.4
[0.12.3]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.7...v0.12.0
[0.11.7]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.6...v0.11.7
[0.11.6]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.5...v0.11.6
[0.11.5]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.4...v0.11.5
[0.11.4]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.3...v0.11.4
[0.11.3]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.2...v0.11.3
[0.11.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.7...v0.10.0
[0.9.7]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.9...v0.9.0
[0.8.9]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.5...v0.8.6
[0.7.17]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.16...v0.7.17
[0.7.16]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.15...v0.7.16
[0.7.15]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.14...v0.7.15
[0.7.14]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.13...v0.7.14
[0.7.13]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.12...v0.7.13
[0.7.12]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.11...v0.7.12
[0.7.11]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.10...v0.7.11
[0.7.10]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.9...v0.7.10
[0.7.9]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.8...v0.7.9
[0.7.8]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.7...v0.7.8
[0.7.7]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.1...v0.7.2
[0.8.5]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.18...v0.8.0
[0.7.18]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.17...v0.7.18
[0.7.1]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.6.5...v0.7.0
[0.6.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.5.7...v0.6.5
[0.5.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.4.1...v0.5.7
[0.4.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.3.8...v0.4.1
[0.3.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.2.4...v0.3.8
[0.2.x]: https://github.com/VizzleTF/luci-theme-footstrap/compare/v0.1.1...v0.2.4
[0.1.x]: https://github.com/VizzleTF/luci-theme-footstrap/commits/v0.1.1

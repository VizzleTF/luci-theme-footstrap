# Proving a CSS change

How to show that a change to `styles/` did what you meant and nothing else. For anyone opening a
pull request that touches CSS. The rule: diff computed styles, never screenshots.

The tree, layers and build: [css.md](css.md). The whole contributor path:
[development.md, "Fixing a CSS bug: the path"](development.md#fixing-a-css-bug-the-path).

## Contents

- [Over the gallery](#over-the-gallery)
- [On a router: the chrome and page-scoped rules](#on-a-router-the-chrome-and-page-scoped-rules)


Screenshots do not work here. On a live router, uptime, leases and signal strength move more pixels
between two runs of the same sheet than a real regression does.

**Diff computed styles instead.** Same DOM, same data, so every difference comes from the CSS.

The gallery has no `header.ut` chrome, so check a change to the sidebar, bar, rail or menu on a
router: [On a router: the chrome and page-scoped rules](#on-a-router-the-chrome-and-page-scoped-rules).

There is no script for this in the repo; drive it with Playwright, which is in `node_modules`. Run
every command from the repo root: it holds the package folder `luci-theme-footstrap/` and `docs/`.

## Over the gallery

1. Build the sheet before (A) and after (B) your change, each into its own directory. This is
   `build-css.sh` plus `mangle-tokens.sh`, the two steps that set computed values. `tools/stage.sh`
   also runs `minify-css`, `nest-css` and `mangle-classes.sh`. Skip them here: the first two only
   respell the sheet, and `mangle-classes.sh` renames the classes the gallery uses. `mangle-tokens.sh` refuses a rewrite directory inside the source tree, so give it an
   empty one under `/tmp`.

   ```sh
   mkdir -p /tmp/fs-a/js /tmp/fs-b/js /tmp/fs-base
   git archive HEAD luci-theme-footstrap | tar -x -C /tmp/fs-base
   /tmp/fs-base/luci-theme-footstrap/build-css.sh /tmp/fs-a/cascade.css
   luci-theme-footstrap/mangle-tokens.sh /tmp/fs-a/cascade.css /tmp/fs-a/js
   luci-theme-footstrap/build-css.sh /tmp/fs-b/cascade.css
   luci-theme-footstrap/mangle-tokens.sh /tmp/fs-b/cascade.css /tmp/fs-b/js
   ```

   Expected, for each side (the numbers move with the sheet):

   ```
   build-css: 138091 bytes -> /tmp/fs-a/cascade.css
   mangle-tokens: 170 names mangled, 18420 bytes saved
   mangle-tokens: 138091 -> 118645 bytes (-19446)
   mangle-tokens: seam renamed in 0 file(s)
   ```

   Any `build-css:` error exits 1 (see [css.md, "The build exits 1 on any of these"](css.md#the-build-exits-1-on-any-of-these)).

2. Put the gallery beside each sheet. It loads `cascade.css` from its own directory, so each side
   gets its own document. Swapping the `<link>` on one document works only while both sheets map
   the private tokens alike.

   ```sh
   cp docs/gallery.html /tmp/fs-a/ && cp docs/gallery.html /tmp/fs-b/
   ```

3. Save this as `computed-diff.mjs` in the repo root, so `playwright` resolves from
   `node_modules`. `snap` waits for `document.fonts.ready`, then saves `getComputedStyle` for
   every element that matches `SELECTOR` (default `*`) and every `::before`/`::after` that
   generates content. It keeps every property except custom properties. `diff` compares two
   saved snapshots.

   ```js
   // node computed-diff.mjs snap <DIR_OR_URL> <OUT.json> [SELECTOR] [WIDTH]
   // node computed-diff.mjs diff <A.json> <B.json>
   import { chromium } from 'playwright';
   import { readFileSync, writeFileSync } from 'node:fs';
   import { pathToFileURL } from 'node:url';

   const [mode, x, y, selector = '*', width = '1280'] = process.argv.slice(2);

   async function open(page, target) {
   	if (!/^https?:/.test(target)) return page.goto(pathToFileURL(`${target}/gallery.html`).href);
   	await page.goto(new URL('/cgi-bin/luci/', target).href);
   	if (await page.$('input[name="luci_password"]')) {	// root, empty password, as on the dev stand
   		await page.fill('input[name="luci_username"]', 'root');
   		await Promise.all([page.waitForNavigation(), page.press('input[name="luci_password"]', 'Enter')]);
   	}
   	await page.goto(target, { waitUntil: 'networkidle' });
   	await page.waitForSelector('#topmenu > li');
   }

   if (mode === 'snap') {
   	const browser = await chromium.launch();
   	const page = await browser.newPage({ viewport: { width: Number(width), height: 800 } });
   	await open(page, x);
   	await page.evaluate(() => document.fonts.ready);
   	const snap = await page.evaluate((sel) => {
   		const out = {};
   		document.querySelectorAll(sel).forEach((el, i) => {
   			for (const pseudo of [null, '::before', '::after']) {
   				const cs = getComputedStyle(el, pseudo);
   				if (pseudo && cs.content === 'none') continue;
   				const key = `${i} ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${pseudo || ''}`;
   				out[key] = Object.fromEntries([...cs].filter((p) => !p.startsWith('--')).map((p) => [p, cs.getPropertyValue(p)]));
   			}
   		});
   		return out;
   	}, selector);
   	await browser.close();
   	writeFileSync(y, JSON.stringify(snap));
   	console.log(`${Object.keys(snap).length} box(es) -> ${y}`);
   } else {
   	const [a, b] = [x, y].map((f) => JSON.parse(readFileSync(f, 'utf8')));
   	let diffs = 0;
   	for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
   		for (const p of new Set([...Object.keys(a[key] || {}), ...Object.keys(b[key] || {})]))
   			if (a[key]?.[p] !== b[key]?.[p]) { diffs++; console.log(`${key} ${p}: ${a[key]?.[p]} -> ${b[key]?.[p]}`); }
   	console.log(`${diffs} difference(s)`);
   }
   ```

4. Snapshot both sides, then run a control pass: the same sheet twice.

   ```sh
   node computed-diff.mjs snap /tmp/fs-a /tmp/fs-a.json
   node computed-diff.mjs snap /tmp/fs-a /tmp/fs-a2.json
   node computed-diff.mjs snap /tmp/fs-b /tmp/fs-b.json
   node computed-diff.mjs diff /tmp/fs-a.json /tmp/fs-a2.json
   ```

   Expected: each `snap` prints `<N> box(es) -> <FILE>`. The control `diff` prints
   `0 difference(s)`, or only `transform` lines on a `::before` that is mid-animation (a spinner).
   That is this page's noise.

5. Run the real pass.

   ```sh
   node computed-diff.mjs diff /tmp/fs-a.json /tmp/fs-b.json
   ```

   Expected: one line per changed property, as `<INDEX> <TAG> <PROPERTY>: <A> -> <B>`, then the
   count. The change passes when every line beyond the control pass's noise is one you meant.

6. Delete `computed-diff.mjs` before you commit.

## On a router: the chrome and page-scoped rules

The gallery cannot see the chrome or a rule scoped by `data-page`. For those, snapshot the router
page before and after the change with the same `computed-diff.mjs`. A URL target logs in as `root`
with the empty password the dev stand uses, opens the page, and waits for `#topmenu > li`. The
stand and its ports: [development.md](development.md#the-dev-stand-runs-real-openwrt-routers-from-owlabyaml)
(`owrt2512` answers on `http://localhost:8025`).

1. Put the old CSS on the router: `git stash`, then `owlab sync owrt2512`.
2. Snapshot the chrome twice, at the width where the change shows. The fifth argument is the
   viewport width; 1280 draws the sidebar, a phone width draws the bar.

   ```sh
   node computed-diff.mjs snap http://localhost:8025/cgi-bin/luci/admin/system/system /tmp/r-a.json '.fs-sidebar, .fs-sidebar *' 1280
   node computed-diff.mjs snap http://localhost:8025/cgi-bin/luci/admin/system/system /tmp/r-a2.json '.fs-sidebar, .fs-sidebar *' 1280
   node computed-diff.mjs diff /tmp/r-a.json /tmp/r-a2.json
   ```

   Expected: `<N> box(es) -> <FILE>` per snap, and `0 difference(s)` from the control `diff`.

3. Put the new CSS on the router: `git stash pop`, then `owlab sync owrt2512`.
4. Snapshot again and diff.

   ```sh
   node computed-diff.mjs snap http://localhost:8025/cgi-bin/luci/admin/system/system /tmp/r-b.json '.fs-sidebar, .fs-sidebar *' 1280
   node computed-diff.mjs diff /tmp/r-a.json /tmp/r-b.json
   ```

   Expected: only the properties you meant to change, on the elements you meant. For a page-scoped
   rule, use that page's URL and a selector under `#view`.

5. Delete `computed-diff.mjs` before you commit.

Two traps:

- Web fonts. A machine with Manrope or JetBrains Mono installed still resolves them. A snapshot
  taken before font matching settles measures fallback metrics. Wait for `document.fonts.ready`.
- `admin/status/overview` polls and redraws, so it differs even with identical CSS. Run a control
  pass (A = B) to learn each page's noise.

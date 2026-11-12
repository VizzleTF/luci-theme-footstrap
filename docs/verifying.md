# Verifying a change

What the two router checks prove and what they do not, and how to read their CI artifacts. For
anyone about to push a change. How to run them locally: [run-checks.md](run-checks.md).

The main rule: done means both package managers, 25.12/apk and 24.10/opkg.

The two checks run on a real OpenWrt of each package manager:

| Check | CI job |
|---|---|
| `tools/e2e.mjs` | `e2e` |
| `tools/anchor-check.mjs` | `anchor` |

The rules a patch follows, with their reasons, are in [conventions.md](conventions.md). The job
graph is in [ci.md](ci.md).

## Short version

1. `tools/e2e.mjs` installs the last release, upgrades to your build, opens every menu page against
   bootstrap, removes the package and installs it again.
2. `tools/anchor-check.mjs` checks that a poll tick above a parked reader leaves them in place, in
   Chromium, Firefox and WebKit.
3. Order matters. Iterate on a synced router (`owlab sync`), then run e2e last, on a router without
   the theme. Why: e2e installs the theme itself, and its first step fails on a router that already
   has it.
4. A router you synced keeps the theme until a factory reset: `owlab up --rebuild <router>`. A
   plain `owlab up` reuses the container.
5. `tools/anchor-check.mjs` alone is the other way round: it needs footstrap active, so a synced
   router is fine.
6. Run e2e on both `owrt2512` and `owrt2410`, and say which one a run covered.
7. A red run is fixed in the code under it, never by editing the check.
8. Reproduce a red CI run locally on the same router before naming a cause.

Neither check judges how a page looks. A CSS change is proven by a computed-style diff:
[prove-css-change.md](prove-css-change.md).

## Contents

- [What the check proves](#what-the-check-proves)
  - [A page fails for what footstrap adds over bootstrap](#a-page-fails-for-what-footstrap-adds-over-bootstrap)
  - [Bootstrap on the same router is the reference](#bootstrap-on-the-same-router-is-the-reference)
  - [The anchoring check keeps a parked reader in place](#the-anchoring-check-keeps-a-parked-reader-in-place)
  - [How long a page is watched](#how-long-a-page-is-watched)
  - [What the checks do not judge](#what-the-checks-do-not-judge)
- [Running the checks locally](#running-the-checks-locally)
- [Reading a run](#reading-a-run)
- [Rules for every change](#rules-for-every-change)
- [Watching CI after a push](#watching-ci-after-a-push)

## What the check proves

`tools/e2e.mjs` lives the package's whole life the way an admin lives it. It runs on one running
owlab router that has LuCI and its apps but not this theme.

1. Install the last published release. It registers Footstrap in Language and Style
   (`luci.themes.Footstrap`) and leaves the active theme alone.
2. The admin picks footstrap. A marker section is written to `/etc/config/footstrap`, the
   conffile Appearance saves to.
3. Upgrade to this build. The version changes. The admin's theme choice and the marker both
   survive.
   - The marker proves the `conffiles` declaration on the 24.10/opkg leg only.
   - apk keeps a modified file under `/etc` without one, so on 25.12 the step passes either way.
4. Open every page of the menu. Details below this list.
5. Remove the package. LuCI falls back to bootstrap and still serves its login form.
   - LuCI answers the form with a 403, so the body is the evidence, not the status.
   - LuCI's root is read once before the removal too. A stand that had already stopped answering is
     then named as such.
   - Each read says what came instead of the form.
6. Install this build again. Footstrap is offered, and the active theme is left alone.

### Step 4 in detail: which pages and in which passes

The crawl opens these pages:

- every leaf with a title whose action is a view, a template or a CBI map, logout excepted;
- every page a menu entry lands on: an entry's first child or alias target. Each click is then
  judged against a bootstrap reading of the same page.

It runs four passes, in this order:

| Pass | Theme | Width | How a page is opened |
|---|---|---|---|
| 1, the reference | bootstrap | 1280 px | full load |
| 2 | footstrap | 1280 px | full load |
| 3 | footstrap | 390 px | full load |
| 4, the click pass | footstrap | | a click on the link of every entry of footstrap's menu: each top-level entry and each entry under one, from the router's own menu tree |

The full-load passes read eight pages at a time, each in a logged-in context of its own. The count
is the same under both themes. The click pass is two pages, each taking half the entries one after
another.

The crawl's browser reaches the router alone. Every other host is refused at once, the same way
under both themes.

Then `tools/anchor-check.mjs` ([below](#the-anchoring-check-keeps-a-parked-reader-in-place)) runs
against the installed build. `--no-anchor` leaves it out. CI passes it and runs the check as a job
of its own (`anchor`) on a router of its own.

### When the crawl stops

A crawl that throws fails a step of its own, `the crawl completes`. Steps 5 and 6 still run.

The stand stopped the crawl in two cases:

- a login got no LuCI page;
- a login, LuCI's menu tree (30 s) or a page (by a full load or a click) got no answer, and LuCI's
  root got none either for a minute. The root is asked every 5 s.

A root that answers leaves the failure the page's. A login that timed out on such a stand is tried
once more. A second timeout is the theme's.

### A page fails for what footstrap adds over bootstrap

A page fails on any of the five problems below.

#### A JS error

| JS error (`pageerror` or a console error) | Whose |
|---|---|
| With a theme file on its stack, or logged by one | Always footstrap's. |
| Any other, that bootstrap did not show while it was watched | Fails the page. |

#### A failed request

A failed request is 4xx/5xx or a network error, to any host. A theme file is any of
`/luci-static/footstrap/`, `resources/fs-*.js`, `resources/menu-footstrap*.js`,
`resources/view/footstrap/` and the pattern CGI.

| Failed request | Whose |
|---|---|
| To a theme file | Always footstrap's. |
| To anything else, that bootstrap never made | Fails the page. |
| An app's request that bootstrap also made | The app's, whatever its answer. |
| A request footstrap makes in an app's name (its router's view prefetch, a client navigation) | Counts: bootstrap never made it. |
| One that failed the same way under bootstrap on any page | The app's too. |

An app's request is the app's because the answer is the router's state at that moment. For example,
adblock asks `cgi-download` for `/var/run/adb_runtime.json`. That file does not exist until
adblock's first run ends. The same page answers 404 a minute after boot and 200 later.

Footstrap cannot change that answer. It never writes the session or its cookie. A lost session turns
the next page into the login form, which the checks below fail.

A request that failed the same way under bootstrap on any page is the app's for this reason. A page
left by a load or a click finishes its late requests into the next page's reading. banIP's runtime file answers 404. OpenClash's GitHub
avatar meets the crawl's seal. Both turned a run red on a page that never asked for them.

#### A view that never renders or comes up short

The page fails when the view renders under bootstrap but not under footstrap. Never rendered means
the `#view` spinner was never replaced, or `#maincontent` is empty.

It also fails when its visible text is less than half of bootstrap's.

- Visible text counts the characters of every text node in `#view` (else `#maincontent`) whose
  element is rendered.
- Text inside a `<select>` does not count. A native select under bootstrap lists its options, and
  footstrap's styled one does not.

**A short view is read once more after the pass.** This covers a view short by a full load or by a
click, and one the measurement could not read. The second reading is the same way and on its own,
with nothing else loading. The page is judged on that reading.

The reason is a race in LuCI. Its `process_list` (Status → Processes) answers an empty list when
another rpcd child exits while it reads `top`'s output. A neighbour page's `file.exec` does that.

The race empties one view at a time. So more than 20 short readings in one pass are the theme's, and
none of them is read again. That keeps a broken theme's run inside the e2e step's 15 minutes.

What the second reading leaves behind:

- A view that is no longer short on that reading leaves a `::warning` titled "Rescued by a second
  reading" in CI.
- Every second reading of a footstrap view is in `report.json` (`crawl.again`).

The race empties the reference too. An empty reference passes an empty footstrap view (3 runs in 5 on
24.10). So every reference view whose requests include `getProcessList` is read once more alone,
after the bootstrap pass.

- The fuller reading is kept, with the errors, failed requests and requests of both. The second
  reading takes back nothing the first vouched for.
- The log prints it as `again, alone: bootstrap`.

The desktop and phone passes read each such view after the rest of the pass, alone from the start.
The other sessions are moved off LuCI, so their views stop polling. Among the phone pass's
neighbours on 24.10 it came out empty in 5 runs out of 5.

#### A broken footstrap shell

The shell is checked at 1280 and at 390 px. It is broken when any of these holds:

- The stylesheet (`link[data-fs-shell]`) holds fewer than 500 rules. The shipped sheet holds about
  1000.
- `--primary-color-high` does not resolve on `:root`.
- The menu column (`nav[data-fs-chrome]`) is not visible with a box of its own.
- The menu's first entry fails Playwright's actionability check: visible, stable, not covered.

LuCI falls back to another theme silently on a broken template. So this check is how a template
that no longer compiles on one of the two ucode interpreters shows up.

A page the measurement could not read at all, or not within 10 s, fails as
`could not measure the page`, not as a broken shell. Not within 10 s means a load the router never
answered.

#### A click-pass failure

On the click pass, the page fails on any of these:

- a menu entry footstrap's menu has no link to;
- a link that cannot be clicked;
- a view that is not replaced by a rendered one.

When a link is not showing, its section is opened first. The click goes through Playwright's
actionability path.

A separate step fails when the click pass reached fewer entries than the menu offers.

### Bootstrap on the same router is the reference

There is no list of expected problems: the stock theme on the same router is the reference.

It is read first, closest to the router's boot. So a state an app is still settling into lands under
bootstrap.

Errors and requests are compared as signatures. A signature has session ids, UUIDs (a `blob:`
URL's), numbers and query strings removed. An error's signature carries the file it was thrown from.

### The anchoring check keeps a parked reader in place

`tools/anchor-check.mjs` checks that a poll tick changing the page above a parked reader leaves them
in place. It runs in Chromium, Firefox and WebKit at 1280 and 390 px.

How it makes the change:

1. It appends 4 DHCP leases to the router's `/tmp/dhcp.leases`. LuCI's own poll then grows the lease
   table on Status > Overview.
2. It puts the file back, so the next poll takes the rows away.
3. A third change does the shrink again while the reader keeps scrolling.

How the reader behaves:

- The reader is parked by mouse wheel on the heading of the section below the leases, at the top of
  the viewport.
- In the first two changes the reader holds still.
- In the third, the reader keeps the wheel going, 20 px a step around their place, until the tick
  has landed. That change is read from the moment they let go.
- Above them, the containers `fs-fit.js` floors keep their height while the reader scrolls and give
  it up after.
- Bootstrap floors nothing. So it is no reference for the third change and does not run it.

Each change is read from a fresh park and judged on its own.

How it measures:

- It tracks the elements in view whose text is unique on the page.
- Every frame for 15 s (4 s after a let-go), it records their median viewport shift.
- It also counts the frames painted with the reader off place (more than 2 px).
- A `ResizeObserver` on `#view` reads the shift after every animation frame callback of the frame,
  the theme's correction included, and before the paint.

Per engine, width and change it runs four cells:

| Cell | Passes when |
|---|---|
| bootstrap | it measured something; it is the reference |
| footstrap | its end shift is at most 2 px larger than bootstrap's, and it shows the reader off place in no more frames, sampled or painted, than bootstrap |
| footstrap without native anchoring: `CSS.supports()` answers no for `overflow-anchor`, `overflow-anchor: none` on every element | the change above the reader matches the footstrap cell's within 8 px (else it measured nothing, below), its end shift is at most 2 px, and no painted frame shows the reader off place |
| the same with `fsAnchor=off` in localStorage | it moves the reader by at least half the change and at least one painted frame shows it off place, else the cell above proves nothing |

#### A cell that measured nothing fails

A cell measured nothing when any of these holds:

- Less than 50 px changed above the reader. That is the move of their content in the document, the
  offset's share plus the viewport's. What changes below them does not count.
- The lease rows were not in its view at the end of a growth, or still there at the end of a shrink.
- No tick landed while they scrolled.
- The reader never held still for 200 ms within 10 s after scrolling.
- Fewer than 5 elements were tracked.
- There was no section to park on.
- The no-native cells saw a change above the reader more than 8 px off the footstrap cell's. An
  offset write leaves that change as it is, so the stimulus or the emulation differed. The rerun
  fails again if the emulation did.
- Status > Overview did not load in 30 s while LuCI's root answered.
- The stand stopped answering.

The step fails with every `FAIL` line in its detail. The check gives up on itself after 20 min with
a `FAIL`.

The router needs at least one lease in `/tmp/dhcp.leases`. owlab's fixtures seed them.

### How long a page is watched

The span starts after the page's view rendered.

| Pass | Span |
|---|---|
| bootstrap, 1280 px | 7 s, a second past footstrap's full-load span so it vouches for all of it, then until nothing this page asked for has been in flight for a second, 10 s at most |
| footstrap full load, 1280 px | 6 s: one LuCI poll interval (5 s, `pollinterval`'s default) and 1 s for the tick's handlers; theme code that runs late runs on a tick or on a timer of its own, the longest of which is `fs-router.js`'s 5 s warm wait |
| footstrap full load, 390 px, and the click pass | 1 s |

The reference vouches for nothing past the span it was watched. Past it, only what is provably the
theme's counts: an error with a theme file on its stack, a failed request to a theme file.

Playwright's `networkidle` is not used. It fires once per navigation and misses an app's late
requests.

### What the checks do not judge

A change in these areas is looked at by hand on both routers (`owlab open`):

| Not judged | Detail |
|---|---|
| How a page looks beyond the checks above | The screenshots are for a human eye, not a pixel diff. Live counters move more pixels between two loads of the same sheet than a real regression does. |
| Firefox and WebKit beyond the anchoring check | With them, the browser floor (Chrome 120 / Firefox 121 / Safari 17.2). The crawl runs Chromium only. The anchoring check runs Playwright's current builds. Its no-native cells stand in for an old Safari by switching the feature off; no real Safari runs. |
| The sidebar and rail layouts, the palettes, RU text and RTL | The run uses the defaults: the top bar, the default palette, English. |
| The reader's scroll position | Except on the anchoring check's one page under its three changes: a growth and a shrink under a reader holding still, a shrink under one scrolling. |
| A change below the reader, and Back after a client navigation | |
| A page reached only through a tab strip, by a click | It is still opened by a full load. |
| `install.sh`, the feed and the trust chain | e2e installs package files directly. |
| ImmortalWrt, 23.05 and hardware | |

## Running the checks locally

The commands, exit codes and expected output live in [run-checks.md](run-checks.md). Start with
[Run e2e on both routers](run-checks.md#run-e2e-on-both-routers).

## Reading a run

Each leg uploads its artifact, also when it failed:

| Leg | Artifact |
|---|---|
| `e2e` | its `--out` directory, as `e2e-<router>` |
| `anchor` | its log, as `anchor-<router>` |

```sh
gh run download <run-id> -n e2e-owrt2410 -D ../tmp/e2e-ci-owrt2410
```

| Path | What it holds |
|---|---|
| `report.json` | `results`: every step as `{ step, ok, detail }`, a failed one also with `standDown`: true when the stand did not answer, so the step judged nothing; `crawl`: whatever the crawl finished, also when it threw. `crawl.pages`: one entry per path and way of opening it (`desktop`, `phone`, `click`) with its `problems`; `crawl.bootstrap` and `crawl.footstrap`: what each pass read on each path (errors and failed requests with the ms after render they showed up, the visible text, the stylesheet's rule count, the token, the menu), for a reference view that asked for the process list the fuller of its two readings; `crawl.again`: every footstrap view read a second time, its text before and after, and whether that reading `rescued` it |
| `footstrap/desktop/*.jpg`, `footstrap/phone/*.jpg` | one screenshot per page at 1280 and 390 px, named after the path (`admin_status_overview.jpg`) |
| `bootstrap/*.jpg` | the same pages under bootstrap at 1280 px |
| `anchor-check.txt` (in `anchor-<router>` from CI) | `tools/anchor-check.mjs`'s log: each phase's stage times (login, open, grow, repark, shrink, rows, scroll), then per engine, width and change (grow, shrink, scroll), per cell the end shift, the largest shift, the frames off place sampled and painted, the change in px, the elements tracked (`t`), the document's growth (`g`) and the ms from the page's last wheel event to the start of the reading (`lag`), then the `FAIL` lines; both measurements when CI measured again on a fresh router |
| `stand.txt` (in `e2e-<router>`, `anchor-<router>`, `playground-stand`, red runs only) | the router when the check went red: container state, processes, whether rpcd (`rpcd=`) and uhttpd (`uhttpd=`) answered, `uhttpd.main`, listening sockets, the last 300 lines of logread and of the container log. `stand-try1.txt` is the same, taken before CI built a fresh router for a second try |

### The log and the annotations

The log prints `PASS`/`FAIL` per step. Under the crawl step it prints one line per failing page and
way of opening it.

In CI each failed step is also an error annotation on the run. A red run's step summary lists its
failed steps and failing pages, 300 rows at most.

### A step the stand failed is annotated at the run's end

These are the steps the stand failed:

- a crawl the stand stopped ([When the crawl stops](#when-the-crawl-stops) says when);
- LuCI's root silent before the removal;
- LuCI's root silent after the removal, only when it was silent before it too;
- a `docker exec` or `docker cp` that did not return in 60 s;
- any docker call the daemon refused (the container paused, stopped or gone);
- a docker call that failed while the router stopped within 10 s.

A failed docker call ends the crawl or the run there.

Silent means no whole answer within 15 s: refused, cut off or none. A root that answered in full
with anything but its form is a finding.

A package manager that does not return in 120 s is a finding: a package script may hang.

### One outage annotation, or one title per step

When every failed step is one the stand failed, on the run's first attempt, the run carries a single
`Upstream outage (safe to rerun)` annotation. That lets CI re-run it once ([ci.md](ci.md)
"`rerun-infra`: one more attempt after an outage").

Otherwise each step carries its own step's title, so one theme finding keeps the run red.

A failure in an install, upgrade or removal step carries the package manager's last line of output
in its detail.

### Reproduce before naming a cause

`gh run view <run-id> --log-failed` prints a red job's failed steps. Reproduce it with a local run
on the same router before naming a cause: the diff, infrastructure, or the upstream feed.

## Rules for every change

**A red run is fixed in the code under it.** Never edit `tools/e2e.mjs` to skip a page or allow an
error, unless changing the check is the task.

One fault, one mechanism.
A spare check or fallback added "to be safe" ships only when the fault reproduces without it.

Look at a layout change under RU text and at a phone width.

Check a widget with real input on the spot `ui.js` opens it from.
That spot is `> span.open` for a ComboButton, anywhere for a plain dropdown. What it opens must be
what a click at each target's centre reaches.
Why: `dispatchEvent` plus `getBoundingClientRect` cannot see a clip.

The theme never checks for its own updates and never reaches a third-party host at run time.
The crawl's browser reaches the router alone, so such a request fails. It fails the page when
bootstrap never made it and it came within the span bootstrap was watched. Anything later, and
anchor-check, is left to review.

The rules per area live on their pages: [conventions.md](conventions.md), [css.md](css.md),
[design-system.md](design-system.md), [third-party-apps.md](third-party-apps.md),
[package.md](package.md).

## Watching CI after a push

1. Find the run: `gh run list --commit <sha>`.
2. Watch it: `gh run watch <run-id> --exit-status`.
3. If it is red, print the failed steps: `gh run view <run-id> --log-failed`. It prints nothing
   while a run is still in progress.

A red first attempt is re-run once on its own when every failed job failed on infrastructure alone
([ci.md](ci.md) "`rerun-infra`: one more attempt after an outage").

- `gh run watch` ends with the first attempt. When `gh run list` shows the run going again, watch it
  again.
- `gh run view <run-id>` shows the newest attempt, `--attempt 1` the first.

**Before pushing to `main`, Build's newest completed `push` run on `main` must be `success`.** Check
with `gh run list --branch main --workflow build.yml --event push --status completed -L1`.

- A `cancelled` or `skipped` run says nothing; the one before it decides.
- CodeQL, pages and Dependabot runs are not the reading.

The job graph and what `release` waits for: [ci.md](ci.md).

Hardware only on the maintainer's word: [development.md](development.md) "Proving it on hardware".

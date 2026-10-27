# Verifying a change

There are two checks, both on a real OpenWrt of each package manager: `tools/e2e.mjs` (CI job
`e2e`) and `tools/anchor-check.mjs` (CI job `anchor`). This page says what they prove and what they
do not, how to run them locally, and how to read their CI artifacts. The rules a patch follows, with
their reasons, are in [conventions.md](conventions.md); the job graph is in [ci.md](ci.md).

## What the check proves

`tools/e2e.mjs` lives the package's whole life on one running owlab router that has LuCI and its
apps but not this theme, the way an admin lives it:

1. **Install the last published release.** It registers Footstrap in Language and Style
   (`luci.themes.Footstrap`) and leaves the active theme alone.
2. **The admin picks footstrap**, and a marker section is written to `/etc/config/footstrap`, the
   conffile Appearance saves to.
3. **Upgrade to this build.** The version changes, and the admin's theme choice and the marker
   both survive. The marker proves the `conffiles` declaration on the 24.10/opkg leg only: apk keeps
   a modified file under `/etc` without one, so on 25.12 the step passes either way.
4. **Every page of the menu is opened**: every leaf with a title whose action is a view, a
   template or a CBI map, logout excepted, and every page a menu entry lands on (an entry's first
   child or alias target), so each click is judged against a bootstrap reading of the same page.
   Bootstrap, the reference, goes first, at 1280 px. Footstrap follows with a full load at 1280 px
   and at 390 px. Then every entry of footstrap's menu (each top-level entry and each entry under
   one, from the router's own menu tree) is opened by a click on its link. The full-load passes
   read eight pages at a time, each in a logged-in context of its own, the same count under both
   themes. The click pass is two pages, each taking half the entries one after another. The
   crawl's browser reaches the router alone: every other host is refused at once, the same way
   under both themes. Then `tools/anchor-check.mjs` (below) runs against the installed build.
   `--no-anchor` leaves it out; CI passes it and runs the check as a job of its own (`anchor`) on
   a router of its own. A crawl that throws fails a step of its own, `the crawl completes`; steps 5
   and 6 still run. The stand stopped the crawl when a login got no LuCI page, or when a login,
   LuCI's menu tree (30 s) or a page, by a full load or a click, got no answer and LuCI's root got
   none either for a minute (asked every 5 s). A root that answers leaves the failure the page's;
   a login that timed out on such a stand is tried once more, and a second timeout is the
   theme's.
5. **Remove the package.** LuCI falls back to bootstrap and still serves its login form (LuCI
   answers the form with a 403, so the body is the evidence, not the status). LuCI's root is read
   once before the removal too, so a stand that had already stopped answering is named as such;
   each read says what came instead of the form.
6. **Install this build again.** Footstrap is offered, the active theme is left alone.

A page fails for what footstrap adds over bootstrap on the same page:

- a JS error (`pageerror` or a console error) with a theme file on its stack, or logged by one:
  always footstrap's. Any other JS error that bootstrap did not show while it was watched;
- a failed request (4xx/5xx or a network error, any host) to a theme file (`/luci-static/footstrap/`,
  `resources/fs-*.js`, `resources/menu-footstrap*.js`, `resources/view/footstrap/`, the pattern CGI):
  always footstrap's. A failed request to anything else that bootstrap never made. An app's request
  that bootstrap also made is the app's whatever its answer, because the answer is the router's
  state at that moment. For example, adblock asks `cgi-download` for `/var/run/adb_runtime.json`,
  which does not exist until adblock's first run ends. The same page answers 404 a minute after
  boot and 200 later. Footstrap cannot change that answer: it never writes the session or
  its cookie, and a lost session turns the next page into the login form, which the checks below
  fail. A request footstrap makes in an app's name (its router's view prefetch, a client
  navigation) is one bootstrap never made, so it counts. One that failed the same way under
  bootstrap on any page is the app's too: a page left by a load or a click finishes its late
  requests into the next page's reading (banIP's runtime file answers 404, OpenClash's GitHub
  avatar meets the crawl's seal), and both turned a run red on a page that never asked for them;
- a view that never renders (the `#view` spinner never replaced, `#maincontent` empty) where it
  renders under bootstrap, or whose visible text is less than half of bootstrap's. Visible text
  counts the characters of every text node in `#view` (else `#maincontent`) whose element is
  rendered. Text inside a `<select>` does not count: a native select under bootstrap lists its
  options, and footstrap's styled one does not. A view short of that, by a full load or by a
  click, or one the measurement could not read, is read once more after the pass, the same way and
  on its own, with nothing else loading, and judged on that reading. The reason: LuCI's
  `process_list` (Status → Processes) answers an empty list when another rpcd child exits while it
  reads `top`'s output, as a neighbour page's `file.exec` does. That race empties one view at a
  time, so more than 20 short readings in one pass are the theme's: none of them is read again,
  which keeps a broken theme's run inside the e2e step's 15 minutes. A view that is no longer short
  on that reading leaves a `::warning` titled "Rescued by a second reading" in CI, and every second
  reading of a footstrap view is in `report.json` (`crawl.again`). The race empties the reference
  too, and an empty reference passes an empty footstrap view (3 runs in 5 on 24.10). So every
  reference view whose requests include `getProcessList` is read once more alone after the
  bootstrap pass, and the fuller reading is kept, with the errors, failed requests and requests of
  both: the second reading takes back nothing the first vouched for. The log prints it as
  `again, alone: bootstrap`. The desktop and phone passes read each such view after the rest of
  the pass, alone from the start, with the other sessions moved off LuCI so their views stop
  polling: among the phone pass's neighbours on 24.10 it came out empty in 5 runs out of 5;
- a broken footstrap shell, checked at 1280 and at 390 px. The stylesheet (`link[data-fs-shell]`)
  holds fewer than 500 rules (the shipped sheet holds about 1000). `--primary-color-high` does not
  resolve on `:root`. The menu column (`nav[data-fs-chrome]`) is not visible with a box of its own.
  The menu's first entry fails Playwright's actionability check (visible, stable, not covered).
  LuCI falls back to another theme silently on a broken template, so this is how a template that
  no longer compiles on one of the two ucode interpreters shows up. A page the measurement could
  not read at all, or not within 10 s (a load the router never answered), fails as
  `could not measure the page`, not as a broken shell;
- on the click pass: a menu entry footstrap's menu has no link to, a link that cannot be clicked,
  or a view that is not replaced by a rendered one. When a link is not showing, its section is
  opened first, and the click goes through Playwright's actionability path. A separate step fails
  when the click pass reached fewer entries than the menu offers.

There is no list of expected problems: the stock theme on the same router is the reference. It is
read first, closest to the router's boot, so a state an app is still settling into lands under
bootstrap. Errors and requests are compared as signatures with session ids, UUIDs (a `blob:`
URL's), numbers and query strings removed; an error's signature carries the file it was thrown
from.

`tools/anchor-check.mjs` checks that a poll tick changing the page above a parked reader leaves
them in place. It runs in Chromium, Firefox and WebKit at 1280 and 390 px. It appends 4 DHCP
leases to the router's `/tmp/dhcp.leases`, so LuCI's own poll grows the lease table on Status >
Overview. Then it puts the file back, so the next poll takes the rows away. The reader is parked by
mouse wheel on the heading of the section below the leases, at the top of the viewport, and holds
still through each change. A third change does the shrink again while the reader keeps the wheel
going, 20 px a step around their place, until the tick has landed. That change is read from the
moment they let go: above them, the containers `fs-fit.js` floors keep their height while the
reader scrolls and give it up after. Bootstrap floors nothing, so it is no reference for that one
and does not run it. Each change is read from a fresh park and judged on its own. The check tracks
the elements in view whose text is unique on the page. Every frame for 15 s (4 s after a let-go),
it records their median viewport shift. It also counts the frames painted with the reader off
place (more than 2 px). A `ResizeObserver` on `#view` reads the shift after every animation frame
callback of the frame, the theme's correction included, and before the paint. Per engine, width
and change it runs four cells:

| Cell | Passes when |
|---|---|
| bootstrap | it measured something; it is the reference |
| footstrap | its end shift is at most 2 px larger than bootstrap's, and it shows the reader off place in no more frames, sampled or painted, than bootstrap |
| footstrap without native anchoring: `CSS.supports()` answers no for `overflow-anchor`, `overflow-anchor: none` on every element | the change above the reader matches the footstrap cell's within 8 px (else it measured nothing, below), its end shift is at most 2 px, and no painted frame shows the reader off place |
| the same with `fsAnchor=off` in localStorage | it moves the reader by at least half the change and at least one painted frame shows it off place, else the cell above proves nothing |

A cell that measured nothing fails. It measured nothing when:

- less than 50 px changed above the reader. That is the move of their content in the document,
  the offset's share plus the viewport's, so what changes below them does not count;
- the lease rows were not in its view at the end of a growth, or still there at the end of a
  shrink;
- no tick landed while they scrolled;
- the reader never held still for 200 ms within 10 s after scrolling;
- fewer than 5 elements were tracked;
- there was no section to park on;
- the no-native cells saw a change above the reader more than 8 px off the footstrap cell's: an
  offset write leaves that change as it is, so the stimulus or the emulation differed, and the
  rerun fails again if the emulation did;
- Status > Overview did not load in 30 s while LuCI's root answered;
- the stand stopped answering.

The step fails with every `FAIL` line in its detail. The check gives up on itself after 20 min
with a `FAIL`. The router needs at least one lease in `/tmp/dhcp.leases` (owlab's fixtures seed
them).

How long a page is watched after its view rendered:

| Pass | Span |
|---|---|
| bootstrap, 1280 px | 7 s, a second past footstrap's full-load span so it vouches for all of it, then until nothing this page asked for has been in flight for a second, 10 s at most |
| footstrap full load, 1280 px | 6 s: one LuCI poll interval (5 s, `pollinterval`'s default) and 1 s for the tick's handlers; theme code that runs late runs on a tick or on a timer of its own, the longest of which is `fs-router.js`'s 5 s warm wait |
| footstrap full load, 390 px, and the click pass | 1 s |

The reference vouches for nothing past the span it was watched. Past it, only what is provably the
theme's counts: an error with a theme file on its stack, a failed request to a theme file.
Playwright's `networkidle` fires once per navigation and misses an app's late requests, so it is
not used.

What it does not judge, so a change there is looked at by hand on both routers (`owlab open`):

- how a page looks beyond the checks above. The screenshots are for a human eye, not a pixel diff:
  live counters move more pixels between two loads of the same sheet than a real regression does;
- Firefox and WebKit beyond the anchoring check, and with them the browser floor (Chrome 108 /
  Firefox 101 / Safari 15.4): the crawl runs Chromium only. The anchoring check runs Playwright's
  current builds, and its no-native cells stand in for an old Safari by switching the feature off;
  no real Safari runs;
- the sidebar and rail layouts, the palettes, RU text and RTL: the run uses the defaults (the top
  bar, the default palette, English);
- the reader's scroll position, except on the anchoring check's one page under its three changes
  (a growth and a shrink under a reader holding still, a shrink under one scrolling);
- a change below the reader, and Back after a client navigation;
- a page reached only through a tab strip, by a click (it is still opened by a full load);
- `install.sh`, the feed and the trust chain — e2e installs package files directly;
- ImmortalWrt, 23.05 and hardware.

## Running it locally

```sh
FOOTSTRAP_VERSION=9999.0.0 ./tools/stage.sh && owfeed build   # above any release: step 3 is an upgrade
gh release download --pattern 'luci-theme-footstrap-*.apk' --dir ../tmp/old
owlab up owrt2512
node tools/e2e.mjs --router owrt2512 --old ../tmp/old/luci-theme-footstrap-*.apk \
  --new dist/noarch/luci-theme-footstrap-[0-9]*.apk
```

and the same on `owrt2410` with `luci-theme-footstrap_*_all.ipk` and
`dist/all/luci-theme-footstrap_[0-9]*_all.ipk`.

- The router must not carry the theme yet: `owlab up` alone, no `owlab sync`. The run's first step
  fails on a router that already has `/www/luci-static/footstrap`. The `theme:` setting in `owlab.yaml` may
  point LuCI at a theme that is not installed. The run resets it to bootstrap rather than judging
  it. The run installs, removes and switches themes on the router; `owlab sync` afterwards puts the
  working tree back.
- It exits 0 when every step passed, 1 otherwise, and 2 on bad arguments or a router that is not
  running. The output and screenshots land in `--out`, by default `../tmp/e2e-<router>`.
- **Done means both**: 25.12/apk and 24.10/opkg. Say which one a run covered.
- CI runs the crawl (`e2e`) and the anchoring check (`anchor`) as two jobs per router, side by
  side. The log prints each pass's time. A change that touches documentation alone skips the steps
  of both (`tools/ci-package-changed.sh`).
- The anchoring check runs on its own against any running router with footstrap active, an
  `owlab sync`ed one included: `node tools/anchor-check.mjs --router owrt2512 [--engines webkit]
  [--widths 390]`. It switches the theme to bootstrap for its reference cells and back to footstrap.
  Footstrap's cells run one engine at a time; bootstrap's run as one phase across the engines, the
  same six pages' load. When every failure is a cell that measured nothing, the whole check runs
  once more (the log says `MEASURED NOTHING` first, in a `::warning` line CI shows as an
  annotation). A stand that stops answering mid-measure (no answer to a navigation or the login
  while LuCI's root stays silent for a minute, or a `docker exec` that does not return in 60 s,
  that Docker refuses, or that its container's stop cuts short) counts as such a run, and the
  rerun first waits up to a minute for LuCI. A navigation that times out while the root answers
  measured nothing too, but is no outage: theme code that holds the load in WebKit or Firefox,
  which only this check runs, fails as a finding when the rerun meets it again. Every measurement
  starts from the leases the run found, whatever the last one left on the router. A measurement
  that fails puts footstrap and the leases back; when a stopped stand refuses that too, the
  failure keeps its own cause, and only a navigation that timed out while the root answered
  becomes the stand's. A failure that measured something is never rerun. Exit 0 on a pass, 1 on a
  failure, 2 when the router is not running or has no lease, 3 when the stand stopped answering
  before the first measurement or in the rerun (nothing was judged).
  In CI exit 1 is an `::error` titled `Scroll anchoring <router>`, and exit 3 one titled
  `Upstream outage (safe to rerun)`. A check that crashes (an error that is neither a finding nor
  the stand's) exits 1 with its stack and an `::error` titled `Scroll anchoring <router>`, like a
  finding's, whose message starts `anchor-check crashed`.
  CI measures once more on a fresh router after a 2 or a 3.
  There an exit other than 0 and 3 leaves `::error title=Scroll anchoring on <router>` too, so the
  first 3's title does not make the job read as an outage.
- Whether the anchoring check can fail at all: `node tools/anchor-mutants.mjs --router owrt2512`.
  It puts known-bad dev builds of `fs-fit.js` on the router one at a time. The mutants: the offset
  read inside the scroll event, the correction a frame late, no correction, no floor, no deferred
  floor. It runs the check against each, reports which it killed, then puts the normal build back.
  Exit 1 when one survived or the check gave no verdict on it (a crash, a hang the check gave up on
  after 20 min, a build, deploy or `owlab status` that did not return in 300, 120 or 60 s, a router
  with no lease, or exit 3: the stand stopped answering), 2 on a usage error or when a mutant's text
  is not in `fs-fit.js` exactly once. Run it after changing `fs-fit.js` or the check. It takes about
  as long as the check per mutant, so pass `--widths 390` for a quick pass. A surviving mutant is a
  hole in the check, or code the check never reaches. CI runs it weekly, one mutant per job, and
  measures a mutant with no verdict once more on a fresh router: [ci.md](ci.md) "`anchor-mutants`:
  does the anchor check still fail".

## Reading a run

Each `e2e` leg uploads its `--out` directory as the artifact `e2e-<router>`, and each `anchor` leg
its log as `anchor-<router>`, also when it failed:

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

The log prints `PASS`/`FAIL` per step and, under the crawl step, one line per failing page and way
of opening it. In CI each failed step is also an error annotation on the run, and a red run's step
summary lists its failed steps and failing pages (300 rows at most). A step the stand failed is
annotated at the run's end instead: a crawl the stand stopped (step 4 above says when); LuCI's root
silent before the removal, and silent after it only when it was silent before it too; a
`docker exec` or `docker cp` that did not return in 60 s, any docker call the daemon refused
(the container paused, stopped or gone), or one that failed while the router stopped within 10 s,
which ends the crawl or the run there. Silent means no
whole answer within 15 s (refused, cut off or none): a root that answered in full with anything
but its form is a finding. A package manager that does not return in 120 s is a finding: a package
script may hang. When every failed step is one the stand failed, on the run's first attempt, the
run carries a single `Upstream outage (safe to rerun)` annotation, which lets CI re-run it once
([ci.md](ci.md) "`rerun-infra`: one more attempt after an outage"). Otherwise each one carries its
own step's title, so one theme finding keeps the run red. A failure in an install, upgrade or
removal step carries the package manager's last line of output in its detail.
`gh run view <run-id> --log-failed` prints a red job's failed steps; reproduce it with a local run
on the same router before naming a cause (the diff, infrastructure, the upstream feed).

## Rules for every change

- **A red run is fixed in the code under it**, never by editing `tools/e2e.mjs` to skip a page or
  allow an error — unless changing the check is the task.
- **One fault, one mechanism.** A spare check or fallback added "to be safe" ships only when the
  fault reproduces without it.
- A layout change is looked at under RU text and at a phone width.
- A widget is checked with real input on the spot `ui.js` opens it from (a ComboButton only
  `> span.open`, a plain dropdown anywhere). What it opens must be what a click at each target's
  centre reaches.
 `dispatchEvent` plus `getBoundingClientRect` cannot see a clip.
- The theme never checks for its own updates and never reaches a third-party host at run time.
  The crawl's browser reaches the router alone, so such a request fails, and fails the page when
  bootstrap never made it and it came within the span bootstrap was watched; anything later, and
  anchor-check, is left to review.

The rules per area live on their pages: [conventions.md](conventions.md), [css.md](css.md),
[design-system.md](design-system.md), [third-party-apps.md](third-party-apps.md),
[package.md](package.md).

## CI

- After a push: `gh run list --commit <sha>`, then `gh run watch <run-id> --exit-status`.
  `gh run view <run-id> --log-failed` prints nothing while a run is still in progress.
- A red first attempt whose every failed job failed on infrastructure alone is re-run once on its
  own ([ci.md](ci.md) "`rerun-infra`: one more attempt after an outage"). `gh run watch` ends with
  the first attempt: when `gh run list` shows the run going again, watch it again.
  `gh run view <run-id>` shows the newest attempt, `--attempt 1` the first.
- Before pushing to `main`: Build's newest completed `push` run on `main` must be `success`
  (`gh run list --branch main --workflow build.yml --event push --status completed -L1`). A
  `cancelled` or `skipped` run says nothing; the one before it decides. CodeQL, pages and
  Dependabot runs are not the reading.
- The job graph and what `release` waits for: [ci.md](ci.md).
- Hardware only on the maintainer's word: [development.md](development.md) "Proving it on hardware".

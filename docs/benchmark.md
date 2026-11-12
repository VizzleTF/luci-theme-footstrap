# Navigation benchmark: footstrap vs bootstrap vs proton2025

How much footstrap's client-side router saves per menu click, measured on real hardware. For anyone
who wants the method, the numbers, or to run it.

The answer: a 38-page tour takes 4933 ms under footstrap against 11 306 ms under bootstrap (2.29×),
at half the router CPU.

`luci-theme-footstrap` ships a client-side router. Clicking a menu item swaps the view in place
instead of reloading the whole page. The benchmark compares it against stock `luci-theme-bootstrap`
and against a third-party theme.

Script: `bench/nav-benchmark.py`. It runs against any OpenWrt 25.12+ router.

## Contents

- [It measures the time from a click to a fully rendered view](#it-measures-the-time-from-a-click-to-a-fully-rendered-view)
- [CPU is measured at both ends, because "load" is two questions](#cpu-is-measured-at-both-ends-because-load-is-two-questions)
- [Footstrap comes out ahead because it keeps the shell between clicks](#footstrap-comes-out-ahead-because-it-keeps-the-shell-between-clicks)
- [Running it yourself](#running-it-yourself)
- [Results](#results)

## It measures the time from a click to a fully rendered view

For every page, it takes wall-clock milliseconds from "I want to go there" to "the view is fully
rendered":

| Theme | How a page is reached |
|---|---|
| footstrap | A real click on the menu link, which the theme's router handles in place. |
| the others | A full navigation to the URL, because that is what a click does in them. |

The finish line is identical, so the comparison is fair. Both themes render into the same `#view`
element, which the LuCI dispatcher emits regardless of theme.

"Rendered" means all of these hold:

- `#view` has children;
- nothing is spinning;
- there is no "Loading view…" text;
- none of the content belongs to the previous page.

### The 38 pages come from the router's own menu

Pages come from `/admin/menu` at runtime. They are everything the menu can turn into a link whose
resolved target is a stock LuCI page.

Third-party app pages are excluded by construction. So an app that hangs itself under `admin/system`
cannot skew the numbers.

That gives 38 pages. They include the tab leaves (Realtime, Logs, Administration, Firewall). They
also include the alias/firstchild entries like Firewall and Realtime Graphs, which are the
most-clicked items in the menu.

### Each theme gets a warm-up pass, then the median of several runs

Per theme, the script runs these steps:

1. Activates the theme.
2. Clears the LuCI caches.
3. Logs in with a fresh browser context.
4. Walks every page once, unmeasured, to warm the HTTP and module caches.
5. Walks the list `--runs` more times and takes the median per page.

Network requests per transition are counted too.

## CPU is measured at both ends, because "load" is two questions

Time tells you how long you waited. It does not tell you what that cost, and the two can disagree.

A theme can be quick because it pushed the work onto the router. It can also spare the router while
burning the client's battery. So both ends are measured and reported apart.

### Router CPU comes from /proc on the router

It is read at the edges of each theme's measured passes.

The attributable figure is `utime+stime+cutime+cstime` of `uhttpd`, `rpcd` and `ubusd`. The
`cutime/cstime` halves matter. uhttpd forks a CGI per request, and a reaped child's CPU lands in its
parent. So the ucode that renders the page shell is counted.

There is also a whole-box figure from `/proc/stat`. It is printed next to an idle baseline taken
before and after, since the router also routes traffic.

An open LuCI view polls the router once a second. That is CPU nobody navigated for. The rate is
measured separately, parked on one page. It is subtracted before dividing by the navigation count.

Two caveats apply to the table:

1. The percentage rows are rates over a window whose length the theme changes. A faster theme can
   show a higher percentage on less CPU, so only CPU-seconds compare.
2. `/proc/stat` inside a Docker container is the host's. The whole-box figure there would include
   the benchmark's own browser. That is why the published numbers come from real hardware.

### Client CPU comes from CDP

It comes from CDP `Performance.getMetrics` deltas per navigation. `TaskDuration` gives main-thread
task time, with a script / style-recalc / layout / v8-compile breakdown.

## Footstrap comes out ahead because it keeps the shell between clicks

A full page load rebuilds the shell, the menu, `luci.js`, `cbi.js`, the translation catalogue, and
the theme's CSS and JS. Then it renders the page. The client router keeps all of that and renders
only the page.

| Theme | Requests per navigation |
|---|---|
| bootstrap | 15 to 47 |
| proton2025 | 27 to 72 |
| footstrap | 0 to 7 |

The win is largest (8× and up) on light pages. It is smallest (about 1.1×) on Startup, Software and
Overview, where the time goes into rendering content.

### uhttpd keep-alive adds about 40 ms per small RPC on a LAN

On a LAN, a warm navigation can also wait about 40 ms per small RPC response on uhttpd's keep-alive
connections. The cause is Nagle plus delayed ACK. That cost is uhttpd's and hits every theme.

`uci set uhttpd.main.http_keepalive=0` removes it on plain HTTP.

Never set it on a router whose admin UI is reached over HTTPS or a slow link.
Why: every request then pays a TLS handshake. At 120 ms RTT a page load measured 3× slower.

## Running it yourself

1. Set up the environment, once:

   ```sh
   python3 -m venv .venv
   .venv/bin/pip install playwright
   .venv/bin/python -m playwright install chromium
   ```

2. Run the benchmark. The original theme is restored at the end.

   ```sh
   LUCI_PW=<router-root-password> .venv/bin/python bench/nav-benchmark.py \
       --ssh-host router --runs 5 --out bench/results-25.12.json
   ```

| Option | Meaning |
|---|---|
| `--ssh-host` | A host from `ssh -G`. Default: `$FOOTSTRAP_SSH`, else `router`. |
| `--runs N` | The number of measured passes. |
| `--out FILE` | Write JSON. |
| `--headful` | Show the browser. |

To add a theme, install it, register it in `luci.themes`, and append it to `THEMES` in the script.
`BASELINE` decides which column the speedup is computed against.

A run takes `themes × (1 warm-up + runs) × pages` navigations. With five runs, three themes and 38
pages that is about 680 transitions, or 20 minutes.

### Prepare the router, or the numbers will lie

**Every theme in `THEMES` must be installed and registered in `luci.themes`.**
Why: the script only writes `luci.main.mediaurlbase`, and nothing validates that path. If the
theme's template is missing, LuCI quietly falls back to another registered theme. The column will
then honestly measure the wrong theme. The run will not fail. It will lie.

An app with invasive CSS changes what is being measured.
Why: a `luci-app-*` may inject a `<style>` that paints stock widgets. footstrap contains it per app,
but a sheet it cannot attribute still forces a real page load (see [spa-router.md](spa-router.md)).
Check `spa_pages` in the JSON: if it is not 38/38, that is why.

Do not kill the script with `kill -9`.
Why: it switches the active theme while it runs and restores it in a `finally`. After `kill -9` you
may have to set `luci.main.mediaurlbase` back by hand.

## Results

Absolute numbers depend on the hardware. The ratios and the request counts are the point.

### Real hardware, with CPU (footstrap 0.12.0, 2026-08-01)

| Setting | Value |
|---|---|
| Router | OpenWrt 25.12.2, mediatek/filogic, 4 cores, luci-base 26.209 |
| Method | Five runs, median, 38 pages, three themes |
| Wallpaper | Off on all of them |
| Full data | `bench/results-25.12.json` |

| | bootstrap | proton2025 | **footstrap** |
|---|--:|--:|--:|
| Time, sum of medians | 11 306 ms | 12 142 ms | **4933 ms** |
| vs bootstrap | | | **2.29×** |
| median per-page speedup | | | **3.03×** |
| pages navigated in place | 0 | 0 | **38 / 38** |
| Router CPU, web stack, whole tour | 37.3 s | 45.7 s | **18.4 s** |
| per navigation (polling removed) | 192 ms | 209 ms | **95 ms** |
| less router CPU | | | **2.02×** |
| tour duration | 62 s | 67 s | **29 s** |
| polling rate, parked on Overview | 12 ms/s | **88 ms/s** | 14 ms/s |
| load average, end of tour | 0.74 | 1.17 | 0.94 |
| idle baseline, box busy (before / after) | 2.9% / 0.9% | | |

### The speed is not bought with the router's processor

The router CPU columns answer the obvious suspicion. The same tour of 190 navigations costs it
18.4 s of web-stack CPU against 37.3 s.

### Client CPU is left out of the table

A sample is dropped when the renderer process is replaced mid-navigation. That happens far more
often on a full page load.

| Theme | Pages kept, of 38 |
|---|---|
| footstrap | 38 |
| bootstrap | 18 |
| proton2025 | 16 |

A cross-theme ratio over the surviving pages is biased. So the script prints the coverage and warns
not to quote the ratio below 90%.

Per-page medians, request counts and CPU figures are in `bench/results-25.12.json` (`pages`, `cpu`).

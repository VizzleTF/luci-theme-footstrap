# Navigation benchmark: footstrap vs bootstrap vs proton2025

`luci-theme-footstrap` ships a client-side router, so clicking a menu item swaps the view in
place instead of reloading the whole page. This measures what that is worth, on real hardware,
against stock `luci-theme-bootstrap` and against a third-party theme.

Script: `bench/nav-benchmark.py`. Runs against any OpenWrt 25.12+ router.

## What it measures

For every page, wall-clock milliseconds from "I want to go there" to "the view is fully
rendered":

- footstrap: a real click on the menu link, which the theme's router handles in place;
- the others: a full navigation to the URL, because that is what a click does in them.

Both themes render into the same `#view` element, which the LuCI dispatcher emits regardless of
theme, so the finish line is identical and the comparison is fair. "Rendered" means `#view` has
children, nothing is spinning, no "Loading view…" text, and none of the content belongs to the
previous page.

Pages come from `/admin/menu` at runtime: everything the menu can turn into a link whose
resolved target is a stock LuCI page. Third-party app pages are excluded by construction, so an
app that hangs itself under `admin/system` cannot skew the numbers. That gives 38 pages,
including the tab leaves (Realtime, Logs, Administration, Firewall) and the alias/firstchild
entries like Firewall and Realtime Graphs, which are the most-clicked items in the menu.

Per theme, the script activates it, clears the LuCI caches and logs in with a fresh browser
context. It walks every page once unmeasured to warm the HTTP and module caches. Then it walks the
list `--runs` more times and takes the median per page. Network requests per transition are counted too.

## CPU: two tables, because "load" is two questions

Time tells you how long you waited. It does not tell you what that cost, and the two can
disagree. A theme can be quick because it pushed the work onto the router. It can also spare the
router while burning the client's battery. So both ends are measured and reported apart.

Router CPU is read from `/proc` on the router itself, at the edges of each theme's measured
passes. The attributable figure is `utime+stime+cutime+cstime` of `uhttpd`, `rpcd` and `ubusd`.
The `cutime/cstime` halves matter: uhttpd forks a CGI per request, and a reaped child's CPU
lands in its parent, so the ucode that renders the page shell is counted. There is also a
whole-box figure from `/proc/stat`, printed next to an idle baseline taken before and after,
since the router also routes traffic.

An open LuCI view polls the router once a second, which is CPU nobody navigated for. That rate
is measured separately, parked on one page, and subtracted before dividing by the navigation
count. Two caveats apply to the table. First, the percentage rows are rates over a window whose length
the theme changes. A faster theme can show a higher percentage on less CPU, so only CPU-seconds
compare. Second, `/proc/stat` inside a Docker container is the host's, so the whole-box figure there
would include the benchmark's own browser. That is why the published numbers come from real
hardware.

Client CPU comes from CDP `Performance.getMetrics` deltas per navigation: `TaskDuration` for
main-thread task time, with a script / style-recalc / layout / v8-compile breakdown.

## Why footstrap comes out ahead

A full page load rebuilds the shell, the menu, `luci.js`, `cbi.js`, the translation catalogue, and
the theme's CSS and JS. Then it renders the page. The client router keeps all of that and renders only
the page. Per navigation, bootstrap fires 15 to 47 requests and proton2025 27 to 72. footstrap fires 0
to 7. The win is largest (8× and up) on light pages and smallest (about 1.1×) on Startup,
Software and Overview, where the time goes into rendering content.

On a LAN, a warm navigation can also wait about 40 ms per small RPC response on uhttpd's keep-alive
connections (Nagle plus delayed ACK). That cost is uhttpd's and hits every theme. `uci set
uhttpd.main.http_keepalive=0` removes it on plain HTTP. Never set it on a router whose admin UI is
reached over HTTPS or a slow link. Every request then pays a TLS handshake: at 120 ms RTT a page load
measured 3× slower.

## Running it yourself

```sh
# once: environment
python3 -m venv .venv
.venv/bin/pip install playwright
.venv/bin/python -m playwright install chromium

# run (the original theme is restored at the end)
LUCI_PW=<router-root-password> .venv/bin/python bench/nav-benchmark.py \
    --ssh-host router --runs 5 --out bench/results-25.12.json
```

Options:

- `--ssh-host`: a host from `ssh -G` (default: `$FOOTSTRAP_SSH`, else `router`);
- `--runs N`: the number of measured passes;
- `--out FILE`: write JSON;
- `--headful`: show the browser.

To add a theme, install it, register it in `luci.themes`, and append it to `THEMES` in the
script. `BASELINE` decides which column the speedup is computed against.

Prepare the router or the numbers will lie:

- Every theme in `THEMES` must be installed and registered in `luci.themes`. The script only
  writes `luci.main.mediaurlbase`, and nothing validates that path. If the theme's template is
  missing, LuCI quietly falls back to another registered theme, and the column will honestly
  measure the wrong theme. The run will not fail. It will lie.
- An app with invasive CSS changes what is being measured. If a `luci-app-*` injects a
  `<style>` that paints stock widgets, footstrap contains it per app, but a sheet it cannot
  attribute still forces a real page load (see [spa-router.md](spa-router.md)). Check `spa_pages`
  in the JSON: if it is not 38/38, that is why.
- The script switches the active theme while it runs and restores it in a `finally`. Kill it
  with `kill -9` and you may have to set `luci.main.mediaurlbase` back by hand.

A run takes `themes × (1 warm-up + runs) × pages` navigations. With five runs, three themes and
38 pages that is about 680 transitions, or 20 minutes.

## Results

Absolute numbers depend on the hardware. The ratios and the request counts are the point.

### Real hardware, with CPU (footstrap 0.12.0, 2026-08-01)

OpenWrt 25.12.2, mediatek/filogic, 4 cores, luci-base 26.209. Five runs, median, 38 pages, three
themes, wallpaper off on all of them. Full data in `bench/results-25.12.json`.

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

The router CPU columns answer the obvious suspicion: the speed is not bought with the router's
processor. The same tour of 190 navigations costs it 18.4 s of web-stack CPU against 37.3 s.

The table leaves client CPU out. A sample is dropped when the renderer process is replaced
mid-navigation, which happens far more often on a full page load. Of 38 pages, footstrap kept 38,
bootstrap 18 and proton2025 16. A cross-theme ratio over the surviving pages is biased. So the
script prints the coverage and warns not to quote the ratio below 90%.

Per-page medians, request counts and CPU figures are in `bench/results-25.12.json` (`pages`, `cpu`).

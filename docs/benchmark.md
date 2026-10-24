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
page you just left.

Pages come from `/admin/menu` at runtime: everything the menu can turn into a link whose
resolved target is a stock LuCI page. Third-party app pages are excluded by construction, so an
app that hangs itself under `admin/system` cannot skew the numbers. That gives 38 pages,
including the tab leaves (Realtime, Logs, Administration, Firewall) and the alias/firstchild
entries like Firewall and Realtime Graphs, which are the most-clicked items in the menu.

Per theme: activate it, clear the LuCI caches, log in with a fresh browser context, walk every
page once unmeasured to warm the HTTP and module caches, then walk it `--runs` more times and
take the median per page. Network requests per transition are counted too.

## CPU: two tables, because "load" is two questions

Time tells you how long you waited. It does not tell you what that cost, and the two can
disagree: a theme can be quick because it pushed the work onto the router, or easy on the
router while burning the client's battery. So both ends are measured and reported apart.

Router CPU is read from `/proc` on the router itself, at the edges of each theme's measured
passes. The attributable figure is `utime+stime+cutime+cstime` of `uhttpd`, `rpcd` and `ubusd`.
The `cutime/cstime` halves matter: uhttpd forks a CGI per request, and a reaped child's CPU
lands in its parent, so the ucode that renders the page shell is counted. There is also a
whole-box figure from `/proc/stat`, printed next to an idle baseline taken before and after,
since the router also routes traffic.

An open LuCI view polls the router once a second, which is CPU nobody navigated for. That rate
is measured separately, parked on one page, and subtracted before dividing by the navigation
count. Two things to keep in mind when reading the table: the percentage rows are rates over a
window whose length the theme changes, so a faster theme can show a higher percentage on less
CPU and only CPU-seconds compare; and `/proc/stat` inside a Docker container is the host's, so
the whole-box figure there would include the benchmark's own browser. That is why the published
numbers come from real hardware.

Client CPU comes from CDP `Performance.getMetrics` deltas per navigation: `TaskDuration` for
main-thread task time, with a script / style-recalc / layout / v8-compile breakdown.

## Why footstrap comes out ahead

Nothing exotic. A full page load throws away a working runtime and rebuilds it: the shell, the
menu, `luci.js` and `cbi.js`, the translation catalogue, the theme's CSS and JS. Then it renders
the page. The client router keeps all of that and renders only the page.

You can see it in the request counts. bootstrap fires 15 to 47 requests per navigation and
proton2025 27 to 72, against 0 to 7 for footstrap, which fetches only the RPC the view needs.
Zero on some pages, because the view is already in memory.

That is also why the win is uneven. It is biggest (8x and up) on light pages, where the page
itself has almost nothing to do and a reload spends its whole time restarting the runtime. It
is smallest (around 1.1x) on Startup, Software and Overview, where the time goes into rendering
content rather than navigating. The router cannot speed up a package list. That is a ceiling,
not a defect.

One more thing the numbers show: a third-party theme can be slower than the stock theme it
repaints. proton2025 loses to bootstrap on total time, with roughly twice the requests and four
times the CSS. Pretty is not fast, which is the argument for measuring.

## The remaining LAN time is not the theme's, and it is not the router's either

On a LAN a warm navigation still costs 90–140 ms while the router answers most of its own RPCs in
1–4 ms. That gap is worth writing down, because the obvious suspects are all innocent and the real
cause sits two layers below this theme.

**The theme is 4.9% of it.** CPU-profiling the main thread across 14 warm navigations on real
hardware (`Profiler.setSamplingInterval 100µs`, self time by script): every `fs-*.js` file together
is **6.8 ms per navigation** out of ~139 ms — `fs-chrome` 4.6, `fs-fit`'s `roomFor` 1.2, `fs-router`
0.4, `fs-select` 0.2 — against 95.9 ms in which the main thread is *idle* and 21.5 ms of engine work
(style, layout, paint). Another 3.7 ms/nav is `scrollTo`, which is ours. So zeroing the theme
entirely would buy under 8%, and the chrome re-render everyone suspects (`renderChrome`, which does
rebuild the menu on every navigation) measures **0.55 ms**.

**The router is not slow either.** Per-request timings from the CDP *network service* (immune to
renderer busyness) show server time of 1.0–4.0 ms for almost everything, including a 22 KB
`network.interface.dump` batch at 1.4 ms — but **42–44 ms, every single time, for `session.access`
(205 bytes) and for a lone `luci.getUnixtime` (211 bytes)**. Run the same call with the main thread
idle and it takes 2.8 ms; `ubus call session access` on the router itself takes 0 ms.

**It is Nagle plus delayed ACK, and uhttpd is where it lands.** uhttpd writes a response's headers
and body as separate `write()`s and never sets `TCP_NODELAY`, so on a *reused keep-alive* connection
a small body waits for the ACK of the previous response — which the client's kernel delays by ~40 ms.
Reproduced with curl, no browser involved, four sequential POSTs on one connection:

```
req1 uci.changes         52 B    7.2 ms
req2 session.access      53 B   44.0 ms   <-- small body, previous response unacked
req3 getNetworkDevices 8913 B    9.6 ms   <-- a full MSS goes out immediately
req4 session.access      53 B   42.8 ms
fresh connection each time:      1.4 / 1.5 / 1.4 ms
```

That also explains the shape: TTFB is 0.37 ms (the headers are prompt), the *body* is late; the first
request of a connection never stalls; large responses never stall.

**A workaround exists, it is NOT theme-specific, and over HTTPS it is a trap.**
`uci set uhttpd.main.http_keepalive=0` removes the stall (uhttpd then answers `Connection: close` on
both protocols). Measured on the production router, aarch64 25.12.2:

| | keep-alive 20 | keep-alive 0 | |
|---|--:|--:|---|
| footstrap, warm navigation, 6 pages, LAN | 754 ms | **453 ms** | **1.66×** |
| footstrap, cold full load, LAN | 292 ms | **155 ms** | **1.88×** |
| footstrap, warm navigation, 120 ms RTT | 1825 ms | 1834 ms | unchanged |
| footstrap, cold full load, 120 ms RTT | 1551 ms | 1551 ms | unchanged |
| **stock bootstrap**, full-load nav, 6 pages, LAN | 2126 ms | **1705 ms** | **1.25×** |
| **stock bootstrap**, full-load nav, 120 ms RTT | 4782 ms | 4814 ms | unchanged |
| **HTTPS**, full-load nav, 120 ms RTT | 9819 ms | **29 424 ms** | **3× WORSE** |

Stock bootstrap gains too, which is the point: this is uhttpd's, not the theme's. Plain HTTP loses
nothing even at 120 ms RTT, because the handshakes overlap across the six connections a browser opens
while the Nagle stall is serial. **But keep-alive is load-bearing for TLS**: without it every request
pays a TCP handshake plus a TLS handshake, and a page is ~49 requests — measured at 20 ms per fresh
TLS handshake even on the LAN, and 3× the total page time at 120 ms RTT. So never set this on a router
whose admin UI is reached over HTTPS or over a slow link.

What did *not* materialise, so do not repeat these as objections: socket churn cost nothing measurable
— uhttpd burned 3 jiffies per 100 GETs with keep-alive off against 4 with it on, TIME_WAIT sockets
stayed at 0 in both, and conntrack did not grow. The proper fix is `TCP_NODELAY` in uhttpd, which
keeps keep-alive *and* removes the stall, and helps every LuCI theme rather than this one.

**Dead ends, so nobody re-derives them:** HTTPS does not avoid it (56.8 / 44.3 / 44.3 ms over TLS);
`uhttpd -h` exposes no socket-option knob beyond `-k` (keep-alive timeout) and `-A` (TCP keepalive
probes); and **the theme cannot work around it from JS** — it issues no ubus call of its own during a
navigation (the calls are `form.js`'s `session.access` and the views' own data), `Connection: close`
is a forbidden request header, and the connection pool is keyed by origin rather than by URL, so no
cache-buster changes which socket a request lands on.

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

Options: `--ssh-host` is a host from `ssh -G` (default `router`), `--runs N` sets the number of
measured passes, `--out FILE` writes JSON, `--headful` shows the browser. To add a theme,
install it, register it in `luci.themes`, and append it to `THEMES` in the script; `BASELINE`
decides which column the speedup is computed against.

Prepare the router or the numbers will lie:

- Every theme in `THEMES` must be installed and registered in `luci.themes`. The script only
  writes `luci.main.mediaurlbase`, and nothing validates that path: if the theme's template is
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
themes, **wallpaper off** on all of them. Full data in `bench/results-25.12.json`.

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

**Client CPU is missing from this run.** A sample is dropped when
the renderer process is replaced mid-navigation, and that does not fall evenly: footstrap kept 38
pages of 38, bootstrap 18 and proton2025 16, because a full page load restarts the renderer far
more often than an in-place swap does. What survives for a full-load theme is its *cheap*
navigations, so the cross-theme ratio computed over the 14-page intersection reads as "the SPA
theme burns more CPU" when it only means the other themes' expensive samples were thrown away. The
script prints that coverage and says outright that the ratio must not be quoted below 90%.

Per page, sorted by how much the client router buys:

| page | bootstrap | proton2025 | **footstrap** | ×bootstrap | requests boot/prot/foot |
|---|--:|--:|--:|--:|--:|
| `system/admin/password` | 139 ms | 152 ms | **8 ms** | **17.15×** | 15/28/0 |
| `system/admin` | 134 ms | 149 ms | **10 ms** | **14.16×** | 15/28/0 |
| `status/realtime/load` | 139 ms | 146 ms | **10 ms** | **13.46×** | 16/28/1 |
| `network/diagnostics` | 254 ms | 305 ms | **21 ms** | **12.25×** | 27/38/1 |
| `status/realtime/bandwidth` | 207 ms | 286 ms | **20 ms** | **10.39×** | 29/39/3 |
| `status/realtime` | 106 ms | 142 ms | **11 ms** | **9.60×** | 17/28/1 |
| `status/logs/dmesg` | 151 ms | 162 ms | **20 ms** | **7.57×** | 16/28/1 |
| `system/admin/dropbear` | 322 ms | 319 ms | **58 ms** | **5.51×** | 32/46/1 |
| `status/realtime/wireless` | 271 ms | 304 ms | **54 ms** | **4.98×** | 29/41/3 |
| `status/logs` | 199 ms | 254 ms | **41 ms** | **4.88×** | 17/29/1 |
| `network/firewall/zones` | 311 ms | 333 ms | **79 ms** | **3.93×** | 32/48/2 |
| `network/firewall/ipsets` | 201 ms | 222 ms | **54 ms** | **3.70×** | 20/33/1 |
| `status/logs/syslog` | 184 ms | 222 ms | **52 ms** | **3.54×** | 17/30/1 |
| `network/routes` | 317 ms | 339 ms | **90 ms** | **3.54×** | 30/41/3 |
| `network/firewall/rules` | 336 ms | 362 ms | **96 ms** | **3.49×** | 30/42/2 |
| `network/network` | 374 ms | 386 ms | **111 ms** | **3.37×** | 38/56/4 |
| `system/crontab` | 178 ms | 168 ms | **54 ms** | **3.33×** | 15/28/1 |
| `network/firewall` | 290 ms | 386 ms | **90 ms** | **3.23×** | 32/48/2 |
| `network/dns` | 329 ms | 370 ms | **108 ms** | **3.05×** | 35/53/2 |
| `network/firewall/forwards` | 342 ms | 358 ms | **114 ms** | **3.00×** | 30/42/2 |
| `system/system` | 415 ms | 383 ms | **139 ms** | **2.98×** | 33/50/3 |
| `status/realtime/cpu` | 188 ms | 205 ms | **65 ms** | **2.89×** | 17/29/4 |
| `network/dhcp` | 361 ms | 367 ms | **131 ms** | **2.76×** | 35/52/3 |
| `status/realtime/connections` | 188 ms | 150 ms | **69 ms** | **2.73×** | 17/28/2 |
| `system/admin/sshkeys` | 143 ms | 167 ms | **53 ms** | **2.69×** | 15/27/1 |
| `system/admin/uhttpd` | 142 ms | 166 ms | **56 ms** | **2.52×** | 16/28/1 |
| `network/wireless` | 389 ms | 391 ms | **156 ms** | **2.49×** | 34/50/4 |
| `system/flash` | 238 ms | 212 ms | **104 ms** | **2.30×** | 16/28/2 |
| `status/overview` | 875 ms | 893 ms | **392 ms** | **2.23×** | 47/72/2 |
| `system/reboot` | 147 ms | 168 ms | **66 ms** | **2.22×** | 15/27/1 |
| `network/firewall/snats` | 202 ms | 256 ms | **97 ms** | **2.09×** | 21/34/2 |
| `system/leds` | 207 ms | 238 ms | **106 ms** | **1.97×** | 26/38/2 |
| `system/admin/repokeys` | 289 ms | 288 ms | **155 ms** | **1.87×** | 18/30/3 |
| `status/processes` | 291 ms | 314 ms | **157 ms** | **1.85×** | 15/27/1 |
| `status/nftables` | 214 ms | 245 ms | **128 ms** | **1.67×** | 18/30/7 |
| `status/routesj` | 232 ms | 266 ms | **174 ms** | **1.33×** | 20/33/3 |
| `system/package-manager` | 863 ms | 877 ms | **768 ms** | **1.12×** | 17/31/3 |
| `system/startup` | 1136 ms | 1188 ms | **1016 ms** | **1.12×** | 15/31/1 |
| **TOTAL (sum of medians)** | **11306 ms** | **12142 ms** | **4933 ms** | **2.29×** | |
| **median per-page speedup** | | | | **3.03×** | |
| **pages navigated in place** | 0 | 0 | **38 / 38** | | |

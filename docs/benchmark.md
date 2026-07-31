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

You can see it in the request counts. bootstrap fires 15 to 48 requests per navigation and
proton2025 27 to 72, against 0 to 8 for footstrap, which fetches only the RPC the view needs.
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

### Real hardware, with CPU (footstrap 0.11.3+, 2026-07-26)

OpenWrt 25.12, mediatek/filogic, 4 cores. Five runs, median, 38 pages, three themes. Full data
in `bench/results-25.12.json`.

| | bootstrap | proton2025 | **footstrap** |
|---|--:|--:|--:|
| Time, sum of medians | 11 814 ms | 12 644 ms | **4 545 ms** |
| vs bootstrap | | | **2.60×** |
| median per-page speedup | | | **4.31×** |
| pages navigated in place | 0 | 0 | **38 / 38** |
| Client CPU, main thread, total | 1 742 ms | 2 401 ms | **1 009 ms** |
| per navigation | 45.8 ms | 63.2 ms | **26.6 ms** |
| less client CPU | | | **1.73×** |
| Router CPU, web stack, whole tour | 37.0 s | 43.8 s | **17.8 s** |
| per navigation (polling removed) | 190 ms | 198 ms | **91 ms** |
| less router CPU | | | **2.08×** |
| polling rate, parked on Overview | 14 ms/s | **86 ms/s** | 16 ms/s |
| idle baseline, box busy (before / after) | 1.9% / 1.5% | | |

Client CPU breakdown, median per navigation: script 2.4 / 5.3 / **3.3** ms, style recalc
1.6 / 3.4 / **2.4** ms, layout 1.2 / 2.7 / **1.3** ms, v8 compile 0.1 / 0.1 / **0.0** ms. So
recompiling `luci.js`/`cbi.js` is not where a reload loses. V8's code cache makes that nearly
free; the cost is the shell, the re-fetch and the re-render.

The CPU columns answer the obvious suspicion: the speed is not bought with the router's
processor. The same tour of 190 navigations costs the router 17.8 s of web-stack CPU against
37.0 s, so a navigation costs 91 ms instead of 190 ms. The client saves less than the clock
suggests (1.73× against 2.60×) for a simple reason: waiting is not CPU.

proton2025 polls the router at 86 ms/s while parked, five times the other two. Worth knowing if
you leave a dashboard open.

Per page, sorted by how much the client router buys:

| page | bootstrap | proton2025 | **footstrap** | ×bootstrap | client CPU, boot / foot |
|---|--:|--:|--:|--:|--:|
| `system/admin/dropbear` | 329 ms | 334 ms | **19 ms** | **16.92×** | 39 / 11 ms |
| `status/realtime/wireless` | 259 ms | 321 ms | **21 ms** | **12.48×** | 43 / 14 ms |
| `system/crontab` | 188 ms | 208 ms | **16 ms** | **11.84×** | 20 / 8 ms |
| `network/firewall/ipsets` | 215 ms | 226 ms | **21 ms** | **10.21×** | 27 / 9 ms |
| `network/diagnostics` | 224 ms | 306 ms | **24 ms** | **9.47×** | 31 / 14 ms |
| `system/admin/sshkeys` | 155 ms | 170 ms | **17 ms** | **8.99×** | 23 / 8 ms |
| `status/realtime` | 160 ms | 172 ms | **18 ms** | **8.73×** | 22 / 10 ms |
| `system/admin/password` | 142 ms | 156 ms | **17 ms** | **8.49×** | 21 / 6 ms |
| `status/realtime/bandwidth` | 262 ms | 275 ms | **31 ms** | **8.48×** | 40 / 17 ms |
| `status/realtime/connections` | 161 ms | 157 ms | **19 ms** | **8.32×** | 26 / 11 ms |
| `system/admin` | 150 ms | 154 ms | **19 ms** | **7.74×** | 20 / 8 ms |
| `status/realtime/cpu` | 196 ms | 204 ms | **28 ms** | **7.13×** | 26 / 14 ms |
| `system/reboot` | 145 ms | 206 ms | **22 ms** | **6.49×** | 20 / 8 ms |
| `status/logs` | 248 ms | 237 ms | **46 ms** | **5.39×** | 40 / 30 ms |
| `status/logs/syslog` | 204 ms | 237 ms | **40 ms** | **5.16×** | 36 / 25 ms |
| `network/routes` | 379 ms | 355 ms | **77 ms** | **4.91×** | 44 / 16 ms |
| `status/logs/dmesg` | 117 ms | 174 ms | **24 ms** | **4.83×** | 23 / 14 ms |
| `network/firewall/zones` | 364 ms | 379 ms | **82 ms** | **4.44×** | 57 / 23 ms |
| `system/admin/uhttpd` | 144 ms | 160 ms | **33 ms** | **4.43×** | 22 / 8 ms |
| `network/network` | 410 ms | 419 ms | **98 ms** | **4.19×** | 63 / 34 ms |
| `network/firewall` | 337 ms | 344 ms | **85 ms** | **3.97×** | 54 / 31 ms |
| `network/firewall/rules` | 340 ms | 376 ms | **105 ms** | **3.24×** | 57 / 25 ms |
| `network/dns` | 370 ms | 408 ms | **117 ms** | **3.17×** | 63 / 39 ms |
| `network/firewall/forwards` | 328 ms | 405 ms | **105 ms** | **3.14×** | 45 / 18 ms |
| `network/wireless` | 392 ms | 426 ms | **127 ms** | **3.09×** | 50 / 22 ms |
| `network/dhcp` | 374 ms | 364 ms | **126 ms** | **2.96×** | 58 / 38 ms |
| `system/leds` | 214 ms | 277 ms | **74 ms** | **2.88×** | 32 / 12 ms |
| `system/system` | 369 ms | 424 ms | **129 ms** | **2.85×** | 113 / 30 ms |
| `status/realtime/load` | 187 ms | 158 ms | **70 ms** | **2.69×** | 26 / 16 ms |
| `system/flash` | 212 ms | 238 ms | **79 ms** | **2.68×** | 25 / 14 ms |
| `status/overview` | 972 ms | 950 ms | **392 ms** | **2.48×** | 103 / 22 ms |
| `network/firewall/snats` | 250 ms | 264 ms | **107 ms** | **2.34×** | 30 / 14 ms |
| `system/admin/repokeys` | 291 ms | 276 ms | **132 ms** | **2.21×** | 28 / 14 ms |
| `status/processes` | 276 ms | 305 ms | **164 ms** | **1.68×** | 37 / 29 ms |
| `status/nftables` | 226 ms | 279 ms | **135 ms** | **1.67×** | 61 / 59 ms |
| `status/routesj` | 227 ms | 262 ms | **171 ms** | **1.33×** | 39 / 34 ms |
| `system/startup` | 1097 ms | 1107 ms | **948 ms** | **1.16×** | 54 / 32 ms |
| `system/package-manager` | 899 ms | 934 ms | **807 ms** | **1.11×** | 224 / 272 ms |
| **TOTAL (sum of medians)** | **11814 ms** | **12644 ms** | **4545 ms** | **2.60×** | **1742 / 1009 ms** |
| **median per-page speedup** | | | | **4.31×** | |
| **pages navigated in place** | 0 | 0 | **38 / 38** | | |

### Earlier baseline on the same hardware (footstrap 0.7.16)

Three runs, 38 pages. Kept for comparison: the theme has gained modules and CSS since, and the
ratio held. Full data was overwritten by the run above; this table is the record.

| page | bootstrap | proton2025 | footstrap | ×bootstrap |
|---|--:|--:|--:|--:|
| `status/realtime/wireless` | 288 ms | 254 ms | 16 ms | **17.48×** |
| `network/diagnostics` | 189 ms | 288 ms | 21 ms | **9.15×** |
| `status/realtime/load` | 138 ms | 154 ms | 15 ms | **8.96×** |
| `system/admin` | 136 ms | 153 ms | 16 ms | **8.82×** |
| `system/admin/sshkeys` | 155 ms | 155 ms | 19 ms | **8.15×** |
| `system/admin/password` | 108 ms | 155 ms | 14 ms | **7.74×** |
| `status/realtime` | 106 ms | 156 ms | 15 ms | **7.04×** |
| `status/realtime/cpu` | 190 ms | 168 ms | 28 ms | **6.69×** |
| `system/admin/dropbear` | 223 ms | 303 ms | 37 ms | **6.09×** |
| `network/network` | 367 ms | 370 ms | 63 ms | **5.81×** |
| `system/crontab` | 182 ms | 199 ms | 39 ms | **4.61×** |
| `network/firewall/zones` | 302 ms | 306 ms | 66 ms | **4.54×** |
| `network/routes` | 350 ms | 308 ms | 78 ms | **4.47×** |
| `system/admin/uhttpd` | 153 ms | 172 ms | 35 ms | **4.40×** |
| `status/realtime/bandwidth` | 238 ms | 204 ms | 58 ms | **4.12×** |
| `network/firewall/forwards` | 343 ms | 356 ms | 87 ms | **3.96×** |
| `network/dns` | 328 ms | 398 ms | 84 ms | **3.92×** |
| `status/logs/dmesg` | 101 ms | 156 ms | 26 ms | **3.82×** |
| `network/firewall/rules` | 300 ms | 353 ms | 87 ms | **3.45×** |
| `network/firewall` | 300 ms | 307 ms | 88 ms | **3.41×** |
| `system/system` | 348 ms | 393 ms | 113 ms | **3.09×** |
| `network/dhcp` | 279 ms | 363 ms | 91 ms | **3.07×** |
| `status/logs/syslog` | 189 ms | 221 ms | 64 ms | **2.97×** |
| `network/firewall/snats` | 225 ms | 222 ms | 80 ms | **2.81×** |
| `status/logs` | 186 ms | 277 ms | 70 ms | **2.64×** |
| `status/routesj` | 200 ms | 255 ms | 77 ms | **2.60×** |
| `status/realtime/connections` | 139 ms | 154 ms | 56 ms | **2.47×** |
| `network/firewall/ipsets` | 168 ms | 219 ms | 69 ms | **2.43×** |
| `network/wireless` | 325 ms | 433 ms | 137 ms | **2.36×** |
| `status/nftables` | 210 ms | 246 ms | 90 ms | **2.32×** |
| `system/reboot` | 140 ms | 154 ms | 63 ms | **2.21×** |
| `system/flash` | 244 ms | 221 ms | 113 ms | **2.15×** |
| `system/leds` | 237 ms | 269 ms | 117 ms | **2.04×** |
| `system/admin/repokeys` | 276 ms | 303 ms | 154 ms | **1.79×** |
| `status/processes` | 290 ms | 308 ms | 170 ms | **1.70×** |
| `status/overview` | 676 ms | 754 ms | 574 ms | **1.18×** |
| `system/startup` | 1076 ms | 1091 ms | 941 ms | **1.14×** |
| `system/package-manager` | 814 ms | 881 ms | 765 ms | **1.06×** |
| **TOTAL (sum of medians)** | **10518 ms** | **11680 ms** | **4638 ms** | **2.27×** |
| **median per-page speedup** | | | | **3.43×** |
| **pages navigated in place** | 0 | 0 | **38 / 38** | |

### Dev containers (footstrap 0.10.0, 2026-07-24)

Both dev containers (`owlab.yaml`), x86 under WSL, so absolute numbers are not
comparable with router hardware. Two themes only: proton2025 is not installed there. Three runs,
median. Data in `bench/results-container-2512.json` and `bench/results-container-2410.json`.

| container | release / package manager | pages | footstrap vs bootstrap (sum of medians) | median per page | in place |
|---|---|--:|--:|--:|--:|
| `router2512` | 25.12 / apk | 36 | **2.33×** (7458 → 3196 ms) | **3.04×** | 34/36 |
| `router2410` | 24.10 / opkg | 35 | **2.16×** (6753 → 3130 ms) | **2.40×** | 34/35 |

The page set differs from the hardware run: container fixtures produce different menu entries,
and `status/realtime/temperature` is skipped because there are no sensors. The ratios line up
with the hardware baseline anyway.

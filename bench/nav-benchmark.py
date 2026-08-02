#!/usr/bin/env python3
"""
nav-benchmark.py — measure per-page navigation time of luci-theme-footstrap
(client-side SPA router) vs the stock luci-theme-bootstrap (full page reload),
walking the *standard* LuCI pages one by one and waiting for each to fully
render before the next.

WHAT IT MEASURES
  For every standard page it times, in wall-clock milliseconds, the interval
  from "navigation intent" to "view fully rendered":
    - footstrap: a real in-app click on the menu link -> the theme's SPA router
      re-instantiates the view into #view (no page reload).
    - bootstrap: a full navigation to the page URL -> browser reloads the whole
      shell, re-parses/re-runs luci.js+cbi.js, re-fetches translations, rebuilds
      the menu, then renders the view.
  Both themes render page content into the SAME #view element (the dispatcher
  emits it regardless of theme), so the "rendered" condition is identical and
  the comparison is apples-to-apples: user-perceived click-to-usable time.

METHOD (per theme)
  1. Activate the theme (uci luci.main.mediaurlbase), clear the LuCI caches.
  2. Fresh browser context, log in.
  3. WARM pass: walk every page once, unmeasured, so HTTP cache + LuCI module
     cache are populated (steady state — matches "after each has loaded once").
  4. MEASURED passes (--runs, default 5): walk every page again, timing each
     arrival. Report the MEDIAN per page to suppress noise.
  Also counts network requests fired during each transition (SPA fetches only
  the RPC it needs; a full reload re-requests the shell + scripts, even if 304).

CPU — TWO TABLES, BECAUSE "CPU LOAD" IS TWO DIFFERENT QUESTIONS
  Wall-clock time answers "how long did I wait". It does not answer "what did
  this cost", and the two can disagree: a theme could be fast because it makes
  the ROUTER do the work, or fast on the router while burning the client's
  battery. So both ends are measured, by different means, and reported apart.

  ROUTER (bench/…: "router CPU"). Measured ON the router, from /proc, at the
  edges of each theme's measured passes — never per navigation, because an ssh
  round trip per nav would add both latency to the timing table and CPU to the
  thing being measured.

  A LuCI view POLLS while it is open (status readouts, once a second), and that
  is router CPU nobody navigated for. Measured naively, the pass window mixes
  the two and the mixture flatters the fast theme twice: it serves the tour with
  less CPU *and* finishes sooner, so it also pays less polling. So the polling
  rate is measured separately, per theme, parked on one fixed page with nothing
  else happening, and the table prints all three — the tour's total, the polling
  rate, and the remainder divided by the navigation count. The first number is
  the honest answer to "what did this tour cost my router"; the third is the
  honest answer to "what does one navigation cost".

  Two ways of counting, and the first is the attributable one:
    - web stack: utime+stime+cutime+cstime of uhttpd, rpcd and ubusd. The
      cutime/cstime halves are what make this work: uhttpd forks a CGI per
      request and a reaped child's CPU lands in its parent's counters, so the
      ucode that renders the shell IS counted (verified on the router: 10 shell
      renders moved uhttpd's cutime+cstime by 41 jiffies, i.e. ~41 ms each,
      while rpcd — which the login page never calls — did not move at all).
      This attributes cost to the web stack and ignores unrelated router noise.
    - whole box: the /proc/stat busy delta, i.e. "CPU load" in the plain sense.
      Includes everything else the router is doing, so an IDLE BASELINE is
      measured before and after the run and printed beside it. Do not read the
      box figure without the baseline.
  Window length comes from the ROUTER's own /proc/uptime, so a clock offset
  between host and router cannot skew it. Jiffies are converted at 100 Hz —
  USER_HZ, which is a fixed kernel ABI constant for /proc, not CONFIG_HZ.

  NOTE FOR ANYONE RUNNING THIS IN A CONTAINER: /proc/stat inside a Docker
  container is the HOST's (measured: byte-identical to the host's own), so the
  "whole box" figure there would include this very benchmark's browser. The web
  stack figure is per-process and stays correct. The published numbers come from
  real hardware for exactly this reason.

  CLIENT (bench/…: "client CPU"). Per navigation and precise, from CDP
  Performance.getMetrics deltas: TaskDuration (main-thread task time) with a
  ScriptDuration / RecalcStyleDuration / LayoutDuration / V8CompileDuration
  breakdown. Verified on the router that these counters are monotonic across a
  full page navigation — the renderer process is reused for a same-origin load,
  so a bootstrap reload accumulates rather than resetting; a negative delta
  (process replaced) is detected and the sample dropped rather than counted as 0.

  Two things to know before quoting the client numbers. TaskDuration is ALL
  main-thread task time in the window, so it includes whatever the open page was
  doing anyway — the named parts (script/style/layout) sum to a small fraction of
  it, and the rest is HTML parsing, network task dispatch, GC and timers. And
  V8CompileDuration is ~0.1 ms in both themes on a warm cache, i.e. compiling
  luci.js/cbi.js is NOT where a full reload loses: V8's code cache makes the
  re-compile nearly free, so the reload's cost is the shell, the re-fetch and the
  re-render. It is printed anyway, because "this is not the reason" is worth
  seeing rather than assuming.

STANDARD PAGES
  Discovered live from /admin/menu: every node the menu can turn into a link
  (satisfied + titled) at depth >= 3, whose *resolved* target is a standard LuCI
  page. Third-party app pages are excluded by construction (see STANDARD_VIEWS).

  Three things this deliberately does NOT do, each of which used to hide pages:
    - it does not stop at depth 3. The tab leaves (Realtime x5, Logs x2,
      Administration x5, Firewall x5) are click-navigable — they are just clicked
      in #tabmenu instead of the main menu — and they are 17 of the 39 pages.
    - it does not require action.type == 'view'. A menu link can be an `alias`
      (Firewall, System Log, Realtime Graphs), a `firstchild` (Administration) or
      the overview `template`; the theme's router resolves all of them, and the
      user clicks them more than anything else. Benchmarking only `view` nodes
      measured the theme everywhere except its front door.
    - it does not filter on the view path alone: package-manager's view path has
      no module prefix at all, so a prefix filter silently dropped it.

  Excluded on purpose:
    - admin/status/channel_analysis — its time is a 5 s hardware radio scan, not
      theme work, and re-running it 12x would disrupt the router's own wifi.
    - attendedsysupgrade — it talks to sysupgrade.openwrt.org; that would time the
      internet, not the theme.

USAGE
  python3 -m venv .venv && .venv/bin/pip install playwright && \
      .venv/bin/python -m playwright install chromium
  LUCI_PW=<router-root-password> .venv/bin/python bench/nav-benchmark.py \
      [--ssh-host router] [--runs 5] [--headful]
  See docs/benchmark.md for the full recipe.
"""
import argparse, json, os, re, statistics, subprocess, sys, time

FOOTSTRAP = "/luci-static/footstrap"        # sidebar variant (simple menu)
BOOTSTRAP = "/luci-static/bootstrap"        # stock baseline
PROTON    = "/luci-static/proton2025"       # luci-theme-proton2025, a third-party theme

# Every theme in the run, baseline first. Only footstrap has a client router, so it
# is the only one navigated by clicking a link; the others get a real full navigation,
# which is what a click does in them anyway. Add a theme here and it joins the table —
# it must already be installed and registered in `luci.themes` on the router.
THEMES = [BOOTSTRAP, PROTON, FOOTSTRAP]
BASELINE = BOOTSTRAP

# A page counts as standard if the view it resolves to belongs to a module that
# ships with a stock OpenWrt LuCI: luci-mod-status / -system / -network (whose
# firewall views live under firewall/) and the package manager. Matching the
# resolved VIEW path, not the menu path, is what keeps a third-party app out even
# when it hangs itself under admin/system.
STANDARD_VIEWS = ("status/", "system/", "network/", "firewall/", "package-manager")
OVERVIEW_TPL   = "admin_status/index"       # the one template node that is a page
EXCLUDE_PATHS  = ("admin/status/channel_analysis",)   # radio scan — see docstring

# Tag the outgoing view's nodes; LuCI renders a view with dom.content(#view, …),
# which REPLACES the children, so "no tagged node left" == "the new page is up".
STALE = ("(()=>{const v=document.getElementById('view'); if(!v) return;"
         "for (const c of v.children) c.setAttribute('data-bench-old','');})()")

# Rendered = #view has content, nothing is spinning, and none of it is the page we
# just navigated AWAY from.
#
# The stale check is not a nicety. A SPA nav leaves the old view on screen until
# the new one renders, so a condition that only asks "does #view have children"
# is true the instant the click lands — it would time the previous page. The old
# harness papered over that by first waiting up to 3 s for a spinner to appear as
# a "nav acknowledged" gate, which broke the other way: a view whose module is
# already cached renders with no spinner frame at all, so the wait ran its full
# 3 s timeout and reported ~3017 ms for pages that were in fact the FASTEST ones.
# Eight pages were mis-timed that way. Marker in, spinner gate out.
RENDERED = (
    "(()=>{const v=document.getElementById('view');"
    "if(!v || v.children.length===0) return false;"
    "if(v.querySelector('.spinning')) return false;"
    "if(v.querySelector('[data-bench-old]')) return false;"
    "return !/Loading view/.test(v.innerText);})()"
)


def sh(host, cmd):
    return subprocess.run(["ssh", host, cmd], check=True,
                          capture_output=True, text=True).stdout.strip()


# ---------------------------------------------------------------------------
# router-side CPU
# ---------------------------------------------------------------------------
# ONE ssh round trip per sample. Everything is read from /proc, including the
# clock: the window length comes from the router's own uptime so that a clock
# offset between this host and the router cannot turn into a bogus percentage.
CPU_PROBE = (
    "for p in $(pgrep uhttpd) $(pgrep rpcd) $(pgrep ubusd); do "
    "  awk '{print $14+$15+$16+$17}' /proc/$p/stat 2>/dev/null; "
    "done | awk '{s+=$1} END{printf \"stack %d\\n\", s+0}'; "
    # $1 is the literal "cpu", so: 2 user, 3 nice, 4 system, 5 idle, 6 iowait,
    # 7 irq, 8 softirq, 9 steal. busy excludes idle AND iowait (waiting is not
    # burning). The double space after "cpu" collapses under awk's default FS.
    "awk '/^cpu /{printf \"busy %d\\nidle %d\\n\", $2+$3+$4+$7+$8+$9, $5+$6}' /proc/stat; "
    "awk '{printf \"up %s\\n\", $1}' /proc/uptime; "
    "awk '{printf \"load %s\\n\", $1}' /proc/loadavg; "
    "grep -c ^processor /proc/cpuinfo | awk '{printf \"ncpu %s\\n\", $1}'"
)
USER_HZ = 100   # /proc/<pid>/stat is in USER_HZ, a fixed ABI constant (not CONFIG_HZ)

# Where to park to measure the polling rate, and for how long. The overview is
# the right page: it is the one users leave open, and it polls the most, so the
# rate is well above the jiffy floor. Long enough that a 10 ms jiffy is noise.
POLL_PAGE = "admin/status/overview"
POLL_SECS = 10


def cpu_sample(host):
    out = {}
    for line in sh(host, CPU_PROBE).splitlines():
        k, _, v = line.partition(" ")
        out[k] = float(v)
    return out


def cpu_window(a, b, navs=None):
    """Turn two samples into the numbers the CPU tables print."""
    secs = b["up"] - a["up"]
    if secs <= 0:                     # router rebooted mid-run; refuse to invent a number
        return None
    ncpu = max(b.get("ncpu", 1), 1)
    stack_ms = (b["stack"] - a["stack"]) * 1000.0 / USER_HZ
    busy_j, idle_j = b["busy"] - a["busy"], b["idle"] - a["idle"]
    total_j = busy_j + idle_j
    w = {"secs": secs, "ncpu": ncpu, "stack_ms": stack_ms,
         # as a share of the WHOLE box (all cores), which is what "load" means to a reader
         "box_pct": (100.0 * busy_j / total_j) if total_j > 0 else float("nan"),
         "stack_pct": 100.0 * (stack_ms / 1000.0) / (secs * ncpu),
         "load": b.get("load", float("nan"))}
    if navs:
        w["stack_ms_per_nav"] = stack_ms / navs
    return w


def node_weight(n):
    return min(n.get("order", 9999), 9999) + (10000 if (n.get("auth") or {}).get("login") else 0)


def first_child(node):
    """resolve_firstchild() from dispatcher.uc: eligible child of lowest weight."""
    best = best_name = None
    for name, c in (node.get("children") or {}).items():
        if not c.get("satisfied") or not c.get("title") or not isinstance(c.get("action"), dict):
            continue
        if c["action"].get("type") == "firstchild":
            if (best is None or node_weight(best) > node_weight(c)) and first_child(c):
                best, best_name = c, name
        elif not c.get("firstchild_ineligible"):
            if best is None or node_weight(best) > node_weight(c):
                best, best_name = c, name
    return (best_name, best) if best else None


def resolve(tree, segs):
    """Follow alias/firstchild to the page the dispatcher would render."""
    node = tree
    for s in segs:
        node = (node.get("children") or {}).get(s)
        if not node:
            return None
    for _ in range(8):
        a = node.get("action") or {}
        if a.get("type") == "alias":
            return resolve(tree, str(a["path"]).split("/"))
        if a.get("type") == "firstchild":
            pick = first_child(node)
            if not pick:
                return None
            node = pick[1]
            continue
        return node
    return None


def discover_pages(base, ctx):
    """Return ordered [(dispatch_path, view_path, title)] of standard pages.

    Tree order matters and is preserved: a tab leaf is only clickable once its
    section is open, and the section's own menu link (the alias/firstchild parent)
    always precedes its children in the tree — so walking in this order guarantees
    every link exists in the DOM by the time we click it.
    """
    tree = ctx.request.get(f"{base}/cgi-bin/luci/admin/menu").json()
    rows, seen = [], set()

    def walk(node, path):
        for k, v in (node.get("children") or {}).items():
            p = path + [k]
            dp = "/".join(p)
            # a link the menu can actually render: satisfied + titled (this is
            # exactly ui.menu.getChildren()'s filter). Depth < 3 is a section
            # header — a disclosure toggle in this theme, not a link.
            if v.get("satisfied") and v.get("title") and len(p) >= 3 and dp not in seen \
                    and dp not in EXCLUDE_PATHS:
                target = resolve(tree, p)
                a = (target or {}).get("action") or {}
                vp = str(a.get("path", ""))
                is_page = (a.get("type") == "view" and vp.startswith(STANDARD_VIEWS)) or \
                          (a.get("type") == "template" and vp == OVERVIEW_TPL)
                if is_page:
                    seen.add(dp)
                    rows.append((dp, vp, v["title"]))
            walk(v, p)
    walk(tree, [])
    return rows


def wait_render(page, t_start):
    """Block until #view holds the NEW page, fully rendered; ms elapsed, None on timeout."""
    try:
        page.wait_for_function(RENDERED, timeout=20000)
    except Exception:
        return None
    return (time.perf_counter() - t_start) * 1000.0


def nav_footstrap(page, base, dp):
    """SPA: real in-app click on the menu link (fires the theme's click handler)."""
    sel = f'a[href$="/cgi-bin/luci/{dp}"], a[href$="/{dp}"]'
    # locate the link (may be inside a collapsed section — a programmatic click
    # still bubbles to the document handler, so visibility is irrelevant)
    found = page.evaluate(
        "(sel)=>{const a=document.querySelector(sel); if(!a) return false;"
        " a.click(); return true;}", sel)
    return found


def nav_bootstrap(page, http, dp):
    page.goto(f"{http}/cgi-bin/luci/{dp}", wait_until="commit")
    return True


# The renderer's own CPU counters, in the order the breakdown is printed.
# TaskDuration is the headline (all main-thread task time); the rest are the
# parts of it worth naming. V8CompileDuration is the one that separates a full
# reload from an SPA nav: a reload re-compiles luci.js/cbi.js, a nav compiles
# nothing.
CPU_METRICS = ("TaskDuration", "ScriptDuration", "V8CompileDuration",
               "RecalcStyleDuration", "LayoutDuration")


def client_cpu(cdp):
    m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
    return {k: m.get(k, 0.0) for k in CPU_METRICS}


def run_theme(p, http, base, media, pages, runs, login):
    browser = p.chromium.launch(args=["--no-sandbox"], headless=not login["headful"])
    ctx = browser.new_context(ignore_https_errors=True)
    ctx.request.post(f"{http}/cgi-bin/luci/",
                     form={"luci_username": "root", "luci_password": login["pw"]})
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Performance.enable")

    reqs = {"n": 0}
    page.on("request", lambda r: reqs.__setitem__("n", reqs["n"] + 1))

    is_foot = (media == FOOTSTRAP)
    dps = [dp for dp, _, _ in pages]

    # start on the first page (full load either way)
    page.goto(f"{http}/cgi-bin/luci/{dps[0]}", wait_until="load")
    wait_render(page, time.perf_counter())

    skipped, nolink = set(), set()
    spa = {}

    def go(dp):
        reqs["n"] = 0
        cpu0 = client_cpu(cdp)
        # a marker on `window` dies with a full page load and survives an in-place
        # swap: the only honest way to tell a SPA nav from a router fallback, and
        # without it a 1.0x row looks like a slow SPA instead of a full reload.
        page.evaluate("() => { window.__benchmark = 1; }")
        page.evaluate(STALE)
        t = time.perf_counter()
        ok = nav_footstrap(page, base, dp) if is_foot else nav_bootstrap(page, http, dp)
        if not ok:
            if dp not in nolink:
                nolink.add(dp)
                print(f"  - excl {dp}: no link in the DOM at this point in the walk")
            return None, 0
        ms = wait_render(page, t)
        if ms is None and dp not in skipped:
            skipped.add(dp)
            txt = page.evaluate("(()=>{var v=document.getElementById('view');"
                                "return v?(v.querySelector('.spinning')?'<spinning>':v.innerText.slice(0,60)):'<no #view>'})()")
            print(f"  ! skip {dp}: not rendered in time (#view={txt!r})")
        if is_foot:
            spa[dp] = bool(page.evaluate("() => window.__benchmark === 1"))
        # A negative delta means the renderer process was replaced mid-run, so the
        # counters restarted from zero and this sample's history is gone. Drop it
        # rather than record the post-restart absolute as if it were a delta —
        # that would report a suspiciously CHEAP navigation, which is the wrong
        # direction to be wrong in.
        cpu1 = client_cpu(cdp)
        d = {k: (cpu1[k] - cpu0[k]) * 1000.0 for k in CPU_METRICS}
        cpu = None if any(v < 0 for v in d.values()) else d
        return ms, reqs["n"], cpu

    # WARM pass (unmeasured)
    for dp in dps:
        go(dp)

    # MEASURED passes. The router-side window opens AFTER the warm pass and
    # closes before the browser does, so it covers the measured navigations and
    # nothing else — no page discovery, no login, no browser startup.
    host = login["host"]
    navs = 0
    rt0 = cpu_sample(host)
    times = {dp: [] for dp in dps}
    nreq = {dp: [] for dp in dps}
    ccpu = {dp: [] for dp in dps}
    for _ in range(runs):
        for dp in dps:
            ms, n, cpu = go(dp)
            if ms is not None:
                times[dp].append(ms)
                nreq[dp].append(n)
                navs += 1
                if cpu:
                    ccpu[dp].append(cpu)
    rt1 = cpu_sample(host)

    # POLLING RATE, same theme, same browser, one fixed page, nobody navigating.
    # Parked on the SAME page for every theme (a view that polls a lot, so the
    # figure is not rounded down to nothing) — otherwise the three rates would
    # describe three different pages. This is what the pass total has to be
    # discounted by before "per navigation" means anything.
    park = POLL_PAGE if POLL_PAGE in dps else dps[0]
    go(park)
    pk0 = cpu_sample(host)
    time.sleep(POLL_SECS)
    poll = cpu_window(pk0, cpu_sample(host))

    browser.close()
    return times, nreq, spa, ccpu, cpu_window(rt0, rt1, navs), navs, poll


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ssh-host", default=os.environ.get("FOOTSTRAP_SSH", "router"))
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--out", default=None, help="write JSON results here")
    args = ap.parse_args()

    pw = os.environ.get("LUCI_PW")
    if not pw:
        sys.exit("set LUCI_PW env (router root password)")

    host = args.ssh_host
    ip = re.search(r"^hostname (.+)$",
                   subprocess.check_output(["ssh", "-G", host]).decode(), re.M).group(1).strip()
    http = f"http://{ip}"
    login = {"pw": pw, "headful": args.headful, "host": host}

    from playwright.sync_api import sync_playwright

    orig = sh(host, "uci get luci.main.mediaurlbase") or BOOTSTRAP
    print(f"router={http} original-theme={orig} runs={args.runs}")

    # Idle baseline: what the router burns with nobody browsing. The "whole box"
    # percentage below is meaningless without it — this box also routes traffic.
    # Taken before AND after the whole run, so a reader can see whether the box
    # stayed quiet; a single sample cannot show that.
    def idle_baseline(secs=5):
        a = cpu_sample(host)
        time.sleep(secs)
        return cpu_window(a, cpu_sample(host))

    print(f"measuring idle baseline ({5} s, nobody browsing) …")
    idle_pre = idle_baseline()

    results = {}
    try:
        with sync_playwright() as p:
            for media in THEMES:
                sh(host, f"uci set luci.main.mediaurlbase={media}; uci commit luci; "
                         f"rm -f /tmp/luci-indexcache*")
                # discover pages once (theme-independent), via a throwaway ctx
                b = p.chromium.launch(args=["--no-sandbox"])
                c = b.new_context(ignore_https_errors=True)
                c.request.post(f"{http}/cgi-bin/luci/",
                               form={"luci_username": "root", "luci_password": pw})
                pages = discover_pages(http, c)
                b.close()
                print(f"\n=== {media}  ({len(pages)} standard pages) ===")
                times, nreq, spa, ccpu, rcpu, navs, poll = run_theme(
                    p, http, media, media, pages, args.runs, login)
                results[media] = {"pages": pages, "times": times, "nreq": nreq, "spa": spa,
                                  "ccpu": ccpu, "rcpu": rcpu, "navs": navs, "poll": poll}
    finally:
        sh(host, f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
        print(f"\nreverted theme -> {orig}")

    idle_post = idle_baseline()

    # ---- report ----
    def med(x): return statistics.median(x) if x else float("nan")

    def name(media): return media.rsplit("/", 1)[-1]

    pages = results[FOOTSTRAP]["pages"]
    spa = results[FOOTSTRAP]["spa"]

    width = 42 + 13 * len(THEMES) + 24
    hdr = f"{'page':40s}" + "".join(f"{name(m):>12s}" for m in THEMES)
    hdr += f"{'speedup':>9s}{'req':>9s}{'nav':>6s}"
    print("\n" + "=" * width)
    print(hdr)
    print("-" * width)

    totals = {m: 0.0 for m in THEMES}
    ratios = []
    rows_out = []
    for dp, vp, title in pages:
        vals = {m: med(results[m]["times"][dp]) for m in THEMES}
        if any(v != v for v in vals.values()):        # nan in any theme => not comparable
            continue
        for m in THEMES:
            totals[m] += vals[m]
        sp = vals[BASELINE] / vals[FOOTSTRAP] if vals[FOOTSTRAP] else float("nan")
        ratios.append(sp)
        kind = "spa" if spa.get(dp) else "full"
        reqs = "/".join(f"{med(results[m]['nreq'][dp]):.0f}" for m in THEMES)
        print(f"{dp:40s}" + "".join(f"{vals[m]:10.0f}ms" for m in THEMES)
              + f"{sp:8.2f}x{reqs:>9s}{kind:>6s}")
        row = {"page": dp, "view": vp, "title": title,
               "speedup_vs_" + name(BASELINE): round(sp, 2), "footstrap_nav": kind}
        row.update({name(m) + "_ms": round(vals[m], 1) for m in THEMES})
        row.update({name(m) + "_client_cpu_ms":
                    (round(c, 1) if c == c else None)
                    for m in THEMES
                    for c in [med([s["TaskDuration"] for s in results[m]["ccpu"][dp]])]})
        rows_out.append(row)

    print("-" * width)
    print(f"{'TOTAL (sum of medians)':40s}" + "".join(f"{totals[m]:10.0f}ms" for m in THEMES)
          + f"{totals[BASELINE] / totals[FOOTSTRAP]:8.2f}x")
    print(f"{'median per-page speedup':40s}" + " " * (12 * len(THEMES))
          + f"{statistics.median(ratios):8.2f}x")
    print(f"{'pages navigated in-place (SPA)':40s} "
          f"{sum(1 for r in rows_out if r['footstrap_nav'] == 'spa')}/{len(rows_out)}")
    print("\nvs each theme (sum of medians / median per-page):")
    for m in THEMES:
        if m == FOOTSTRAP:
            continue
        per = statistics.median([med(results[m]["times"][dp]) / med(results[FOOTSTRAP]["times"][dp])
                                 for dp, _, _ in pages
                                 if med(results[FOOTSTRAP]["times"][dp]) == med(results[FOOTSTRAP]["times"][dp])
                                 and med(results[m]["times"][dp]) == med(results[m]["times"][dp])])
        print(f"  footstrap vs {name(m):14s} {totals[m] / totals[FOOTSTRAP]:5.2f}x total, {per:5.2f}x median page")
    print("=" * width)

    # ---- CPU: two tables, because the two ends answer different questions ----
    def cmed(media, dp, key):
        v = [s[key] for s in results[media]["ccpu"][dp]]
        return med(v)

    cw = 42 + 13 * len(THEMES) + 10
    print("\n" + "=" * cw)
    print("CLIENT CPU — browser main-thread time per navigation (median, ms)")
    print("-" * cw)
    print(f"{'page':40s}" + "".join(f"{name(m):>12s}" for m in THEMES) + f"{'saved':>10s}")
    print("-" * cw)
    ctot = {m: 0.0 for m in THEMES}
    ccov = 0
    for dp, vp, title in pages:
        vals = {m: cmed(m, dp, "TaskDuration") for m in THEMES}
        if any(v != v for v in vals.values()):
            continue
        ccov += 1
        for m in THEMES:
            ctot[m] += vals[m]
        r = vals[BASELINE] / vals[FOOTSTRAP] if vals[FOOTSTRAP] else float("nan")
        print(f"{dp:40s}" + "".join(f"{vals[m]:10.0f}ms" for m in THEMES) + f"{r:9.2f}x")
    print("-" * cw)
    print(f"{'TOTAL (sum of medians)':40s}" + "".join(f"{ctot[m]:10.0f}ms" for m in THEMES)
          + (f"{ctot[BASELINE] / ctot[FOOTSTRAP]:9.2f}x" if ctot[FOOTSTRAP] else ""))
    print(f"{'per navigation (mean over pages)':40s}"
          + "".join(f"{(ctot[m] / ccov if ccov else float('nan')):10.1f}ms" for m in THEMES))

    # COVERAGE, and it decides whether the table above may be quoted at all. A sample is
    # dropped when the renderer process was replaced mid-navigation (negative delta, see go()),
    # and that does not fall evenly: a full-load theme restarts the renderer far more often than
    # an in-place swap does, so the surviving samples for it are the cheap navigations. Comparing
    # two themes across such a gap reads as "the SPA theme burns more CPU" when what actually
    # happened is that the other theme's expensive navigations were thrown away. Measured on
    # 2026-08-01: footstrap kept 38 of 38 pages, bootstrap 18, proton2025 16.
    print(f"\n{'pages with a sample from EVERY theme':40s}{ccov:6d} of {len(pages)}")
    for m in THEMES:
        kept = sum(1 for dp, _, _ in pages if cmed(m, dp, "TaskDuration") == cmed(m, dp, "TaskDuration"))
        print(f"  {name(m):20s} kept {kept:3d} of {len(pages)} "
              f"({len(pages) - kept} dropped: renderer restarted mid-navigation)")
    if ccov < len(pages) * 0.9:
        print("  ^ COVERAGE IS PARTIAL AND UNEVEN — do not quote the cross-theme CPU ratio above.\n"
              "    Compare like with like instead (same nav kind), or re-run until coverage is full.")
    print("\nbreakdown — median per navigation over all pages (ms):")
    for key in CPU_METRICS[1:]:
        row = {m: med([cmed(m, dp, key) for dp, _, _ in pages
                       if cmed(m, dp, key) == cmed(m, dp, key)]) for m in THEMES}
        label = {"ScriptDuration": "script", "V8CompileDuration": "v8 compile",
                 "RecalcStyleDuration": "style recalc", "LayoutDuration": "layout"}[key]
        print(f"  {label:38s}" + "".join(f"{row[m]:10.1f}ms" for m in THEMES))
    print("=" * cw)

    print("\n" + "=" * cw)
    print("ROUTER CPU — measured on the router itself, over each theme's measured passes")
    print("-" * cw)
    print(f"{'':40s}" + "".join(f"{name(m):>12s}" for m in THEMES))
    print("-" * cw)
    rc = {m: results[m]["rcpu"] for m in THEMES}
    pl = {m: results[m]["poll"] for m in THEMES}

    def nav_ms(m):
        """What one navigation cost the router, once the open page's own polling is out."""
        if not rc[m] or not pl[m] or not results[m]["navs"]:
            return float("nan")
        rate = pl[m]["stack_ms"] / pl[m]["secs"]                # ms of CPU per second, parked
        return max(rc[m]["stack_ms"] - rate * rc[m]["secs"], 0.0) / results[m]["navs"]

    if all(rc[m] for m in THEMES):
        print(f"{'navigations (tour of every page x runs)':40s}"
              + "".join(f"{results[m]['navs']:12d}" for m in THEMES))
        print(f"{'tour duration':40s}" + "".join(f"{rc[m]['secs']:11.0f}s" for m in THEMES))
        print(f"{'web stack CPU for the whole tour':40s}"
              + "".join(f"{rc[m]['stack_ms'] / 1000.0:11.1f}s" for m in THEMES))
        print(f"{'  polling rate, parked on one page':40s}"
              + "".join((f"{pl[m]['stack_ms'] / pl[m]['secs']:8.0f}ms/s" if pl[m] else f"{'n/a':>11s}")
                        for m in THEMES))
        print(f"{'  => per navigation, polling removed':40s}"
              + "".join(f"{nav_ms(m):10.0f}ms" for m in THEMES))
        # RATES, not costs. Both rows are per-second averages over a window whose
        # LENGTH is what the theme changed, so a faster theme compresses the same
        # work into less time and its percentage goes UP while its CPU-seconds go
        # down. Measured here: footstrap 26.0% box vs bootstrap 22.4%, on 19.3s of
        # CPU against 37.6s. Anyone reading the percentage as the cost reads it
        # backwards, so the rows say so.
        print(f"{'web stack, share of the box (RATE)':40s}"
              + "".join(f"{rc[m]['stack_pct']:11.1f}%" for m in THEMES))
        print(f"{'whole box busy (RATE, incl. routing)':40s}"
              + "".join(f"{rc[m]['box_pct']:11.1f}%" for m in THEMES))
        print(f"{'load average, end of tour':40s}" + "".join(f"{rc[m]['load']:12.2f}" for m in THEMES))
        print(f"{'':40s}" + "  <- rates over a window whose length the theme changed;")
        print(f"{'':40s}" + "     compare CPU-SECONDS above, not these percentages.")
        print("-" * cw)
        for lbl, w in (("idle baseline, before the run", idle_pre),
                       ("idle baseline, after the run", idle_post)):
            if w:
                print(f"{lbl:40s}{w['box_pct']:11.1f}%  box busy, "
                      f"{w['stack_ms'] / w['secs']:.0f} ms/s web stack, load {w['load']:.2f}")
        print(f"\n{rc[FOOTSTRAP]['ncpu']:.0f} cores. 'web stack' is uhttpd+rpcd+ubusd, counting "
              "utime+stime+cutime+cstime, so\nthe CPU of a reaped CGI child lands in its parent "
              f"and the ucode that renders the shell\nIS counted. A LuCI view polls while it is open "
              f"(parked on {POLL_PAGE},\n{POLL_SECS} s), which is why the tour total is discounted by "
              "that rate before dividing by\nthe navigation count.\n"
              "\nCheck the parked rate against the idle baseline before trusting the discount: when "
              "the\ntwo are within noise of each other, that theme's polling is too cheap to "
              "measure and the\ndiscount is mostly removing the router's own background — which "
              "makes the per-navigation\nfigure conservative, not flattering. A rate well above the "
              "baseline is real polling.")
    else:
        print("  (unavailable: the router's uptime went backwards — rebooted mid-run?)")
    print("=" * cw)

    if args.out:
        out = {"router": http, "runs": args.runs, "themes": [name(m) for m in THEMES],
               "baseline": name(BASELINE),
               "spa_pages": sum(1 for r in rows_out if r["footstrap_nav"] == "spa"),
               "median_speedup": round(statistics.median(ratios), 2),
               "pages": rows_out}
        out.update({"total_" + name(m) + "_ms": round(totals[m], 1) for m in THEMES})
        out["total_speedup"] = round(totals[BASELINE] / totals[FOOTSTRAP], 2)
        out["cpu"] = {
            "note": ("client = CDP Performance deltas per navigation (main thread). "
                     "router = /proc on the router; the web-stack figure is "
                     "utime+stime+cutime+cstime of uhttpd+rpcd+ubusd, so reaped CGI "
                     "children count. 'box' is /proc/stat and includes everything else "
                     "the router does — compare it against idle_baseline."),
            "client_total_ms": {name(m): round(ctot[m], 1) for m in THEMES},
            "client_per_nav_ms": {name(m): round(ctot[m] / ccov, 2) for m in THEMES} if ccov else {},
            "client_breakdown_median_ms": {
                name(m): {k: round(med([cmed(m, dp, k) for dp, _, _ in pages
                                        if cmed(m, dp, k) == cmed(m, dp, k)]), 2)
                          for k in CPU_METRICS}
                for m in THEMES},
            "router": {name(m): ({k: round(v, 2) for k, v in rc[m].items()} if rc[m] else None)
                       for m in THEMES},
            "router_navs": {name(m): results[m]["navs"] for m in THEMES},
            "router_poll_page": POLL_PAGE,
            "router_poll_ms_per_s": {name(m): (round(pl[m]["stack_ms"] / pl[m]["secs"], 1)
                                               if pl[m] else None) for m in THEMES},
            "router_nav_ms_polling_removed": {name(m): round(nav_ms(m), 1) for m in THEMES},
            "idle_baseline": {w: ({k: round(v, 2) for k, v in s.items()} if s else None)
                              for w, s in (("before", idle_pre), ("after", idle_post))},
        }
        json.dump(out, open(args.out, "w"), indent=2)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()

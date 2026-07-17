#!/usr/bin/env python3
"""Compare computed styles of every element under two stylesheets.

Screenshots cannot verify a CSS change on a live router: the page's own counters
(uptime, DHCP leases, wifi signal) move 0.5-1.3% of the pixels between two runs of the
SAME stylesheet, while a real regression can be 0.19% — the signal sits under the noise.

So: load the page ONCE, snapshot getComputedStyle for a fixed property set on every
element (keyed by a stable DOM path), swap the theme <link> to the second stylesheet,
snapshot again, diff. Same DOM, same live data, so every difference is caused by CSS.

Pass --a/--b as LOCAL paths and they are uploaded for you; pass bare filenames to compare two
sheets already sitting under /www/luci-static/footstrap/ on the router.
"""
import os, sys, subprocess, time, json, argparse, collections

PROPS = ["display","position","top","right","bottom","left","z-index",
         "width","height","min-width","max-width","min-height",
         "margin-top","margin-right","margin-bottom","margin-left",
         "padding-top","padding-right","padding-bottom","padding-left",
         "border-top-width","border-right-width","border-bottom-width","border-left-width",
         "border-top-color","border-bottom-color","border-radius",
         "background-color","background-image","color","box-shadow","opacity",
         "font-family","font-size","font-weight","line-height","text-align",
         "white-space","overflow-x","overflow-y","flex-direction","flex-wrap",
         "align-items","justify-content","gap","grid-template-columns","order",
         "text-transform","letter-spacing","visibility",
         # Motion and masks. Added because their absence made this tool LIE BY OMISSION: the
         # refresh glyph's 19px->18px unification and the animation durations snapping onto the
         # --fs-dur* scale both reported "0 property diffs" — the tool could not see either the
         # regression it was asked about or the change it was asked to confirm. That is the
         # failure CLAUDE.md names: a clean diff is only as honest as the property list behind it.
         "animation-duration","animation-timing-function","animation-name",
         "transition-duration","transition-property",
         "mask-size","mask-image","-webkit-mask-size","-webkit-mask-image",
         # Wrapping, and `direction` — which is here to be BORING. text-align: right -> end is a
         # value-string change the tool reports as a diff while rendering is untouched, but that
         # equivalence holds only while direction is ltr, and nothing in openwrt/luci sets dir=rtl
         # (checked: zero hits repo-wide). Snapshotting it turns "end == right here" from an
         # assumption into a reading. text-wrap likewise: its absence made a `pretty` change
         # invisible, which is this list's documented failure mode one line up.
         "direction","text-wrap","overflow-wrap","word-break"]

SNAP = """(props) => {
  const path = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 40) {
      const p = el.parentElement;
      const i = p ? Array.prototype.indexOf.call(p.children, el) : 0;
      parts.unshift(el.tagName.toLowerCase() + ':' + i);
      el = p;
    }
    return parts.join('/');
  };
  const out = {};
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('head')) continue;
    const cs = getComputedStyle(el);
    const v = {};
    for (const p of props) v[p] = cs.getPropertyValue(p);
    out[path(el)] = { cls: el.className && el.className.baseVal !== undefined
                             ? el.className.baseVal : (el.className || ''),
                      tag: el.tagName.toLowerCase(), v };
  }
  return out;
}"""

# `onerror` is not politeness — without it this hangs FOREVER on a sheet the router does not have:
# `page.evaluate` awaits the returned promise and has no default timeout, so a 404 (the browser
# fires `error`, never `load`) parks the run with no message. Rejecting turns the one mistake this
# tool cannot survive — comparing against a stylesheet that is not there — into a stack trace
# instead of a silence. Verified against a deleted cascade-a.css: hung past 150s before, throws at
# once now.
SWAP = """(href) => new Promise((res, rej) => {
  const l = document.querySelector('link[rel=stylesheet][href*=cascade]');
  if (!l) { rej(new Error('no cascade <link> on the page — is the theme active?')); return; }
  const n = l.cloneNode();
  n.href = href;
  n.onerror = () => rej(new Error('stylesheet did not load: ' + href));
  n.onload = () => {
    l.remove();
    // Swapping the <link> restarts font matching (both sheets declare the same
    // @font-face rules). Snapshotting before the webfont is ready measures fallback
    // metrics — every width shifts a pixel or two and drowns the real diff.
    document.fonts.ready.then(() =>
      requestAnimationFrame(() => requestAnimationFrame(res)));
  };
  l.parentNode.insertBefore(n, l.nextSibling);
})"""

FONTS_READY = "() => document.fonts.ready.then(() => true)"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pages", nargs="+")
    ap.add_argument("--a", default="cascade-a.css",
                    help="baseline: a LOCAL path (uploaded for you) or a filename already under "
                         "/luci-static/footstrap/ on the router")
    ap.add_argument("--b", default="cascade-b.css", help="candidate, same two forms as --a")
    ap.add_argument("--layout", default="/luci-static/footstrap")
    ap.add_argument("--mode", default="dark")
    # FOOTSTRAP_SSH, like every other tool here. Hardcoding 25.12 made `FOOTSTRAP_SSH=router2410
    # cssdiff.py` measure the 25.12 container while its author read the answer as 24.10's — and
    # since the two branches differ in exactly the markup this theme has to serve, that is the
    # reading most worth taking per release.
    ap.add_argument("--ssh-host", default=os.environ.get("FOOTSTRAP_SSH", "router2512"))
    # Behaviour is a FUNCTION of width, and a diff taken only at 1440 never enters the
    # narrow states: the overview grid (@container fs-view 800), the config table's card
    # (@container fs-content 960 — which in the sidebar layout can fire on a 1200px DESKTOP,
    # the column being viewport-224-56), and the data tables (MEASURED, not a container
    # query: .fs-stacked / fs-select.js — they can card at any width). Touch any of those,
    # re-run inside each band.
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--ls", action="append", default=[], metavar="KEY=VALUE",
                    help="extra localStorage entry set before load (e.g. --ls fs-layout=top)")
    args = ap.parse_args()

    pw = os.environ["LUCI_PW"]
    out = subprocess.run(["ssh","-G",args.ssh_host],capture_output=True,text=True).stdout
    host = next(l.split()[1] for l in out.splitlines() if l.startswith("hostname "))
    base = f"http://{host}"

    def sh(c): return subprocess.run(["ssh",args.ssh_host,c],capture_output=True,text=True)

    # Upload a --a/--b given as a local path, then PROVE both sheets are on the router and say
    # what they are. Every failure this closes is silent, and all of them have happened:
    #   * the caller scp'd the pair to router2410 and the tool read router2512 (the hardcoded
    #     default above), where a stale pair from an earlier session was still lying around — so it
    #     compared two stylesheets nobody had asked about and reported 1329 line-height changes;
    #   * with no pair there at all, the swap hung forever (see SWAP).
    # A tool whose whole job is to notice regressions must not be the thing that invents them, so
    # it now uploads what it is given and prints the size and mtime of what it actually compared.
    WWW = "/www/luci-static/footstrap"
    def stage(which, val):
        if os.path.sep in val or os.path.exists(val):
            if not os.path.isfile(val):
                sys.exit(f"--{which}: no such file: {val}")
            name = f"cascade-{which}.css"
            up = subprocess.run(["scp","-q",val,f"{args.ssh_host}:{WWW}/{name}"],
                                capture_output=True,text=True)
            if up.returncode:
                sys.exit(f"--{which}: cannot upload {val} to {args.ssh_host}: {up.stderr.strip()}")
            return name
        return val

    a_name, b_name = stage("a", args.a), stage("b", args.b)
    for which, name in (("a", a_name), ("b", b_name)):
        ls = sh(f"ls -l {WWW}/{name}")
        if ls.returncode or not ls.stdout.strip():
            sys.exit(f"--{which}: {args.ssh_host}:{WWW}/{name} is not there — nothing to compare "
                     f"against. Pass a local path and it will be uploaded for you.")
        print(f"  {which}: {ls.stdout.strip()}")
    # This script SWITCHES the router's active theme and restores it in a finally block, so
    # `orig` is all that stands between a dev router and a broken UI. A failed ssh (or an
    # unset key) used to leave it the EMPTY STRING, and finally then ran
    # `uci set luci.main.mediaurlbase=`, blanking theme selection. Refuse to start rather
    # than restore a value we never read.
    orig = sh("uci get luci.main.mediaurlbase").stdout.strip()
    if not orig:
        sys.exit("cannot read luci.main.mediaurlbase from the router — refusing to switch the "
                 "theme, because the value needed to switch it back could not be read")

    from playwright.sync_api import sync_playwright
    total = collections.Counter()
    try:
        sh(f"uci set luci.main.mediaurlbase={args.layout}; uci commit luci; rm -f /tmp/luci-indexcache*")
        with sync_playwright() as p:
            br = p.chromium.launch(args=["--no-sandbox"])
            ctx = br.new_context(viewport={"width":args.width,"height":args.height})
            _extra = "".join(f"try{{localStorage.setItem('{k}','{v}')}}catch(e){{}}"
                             for k, _, v in (e.partition("=") for e in args.ls))
            ctx.add_init_script(
                f"try{{localStorage.setItem('fs-darkmode','{'true' if args.mode=='dark' else 'false'}')}}catch(e){{}}{_extra}")
            ctx.request.post(f"{base}/cgi-bin/luci/", form={"luci_username":"root","luci_password":pw})
            page = ctx.new_page()
            for path in args.pages:
                page.goto(f"{base}/cgi-bin/luci/{path}", wait_until="networkidle")
                try: page.wait_for_selector("#view .cbi-section, #view .table", timeout=6000)
                except Exception: pass
                time.sleep(1.2)
                page.evaluate(FONTS_READY)
                # force stylesheet A first, so both snapshots come from a link we control
                page.evaluate(SWAP, f"{WWW.replace('/www', '')}/{a_name}")
                time.sleep(0.4)
                sa = page.evaluate(SNAP, PROPS)
                page.evaluate(SWAP, f"{WWW.replace('/www', '')}/{b_name}")
                time.sleep(0.4)
                sb = page.evaluate(SNAP, PROPS)

                diffs = []
                for k, ea in sa.items():
                    eb = sb.get(k)
                    if not eb: continue
                    for prop, va in ea["v"].items():
                        vb = eb["v"][prop]
                        if va != vb:
                            diffs.append((ea["tag"], str(ea["cls"])[:60], prop, va, vb))
                print(f"\n=== {path}: {len(sa)} elements, {len(diffs)} property diffs ===")
                agg = collections.Counter((d[0], d[1], d[2]) for d in diffs)
                for (tag, cls, prop), n in agg.most_common(25):
                    ex = next(d for d in diffs if (d[0],d[1],d[2])==(tag,cls,prop))
                    print(f"  {n:3d}x {tag}.{cls[:38]:38s} {prop:22s} {ex[3][:28]:28s} -> {ex[4][:28]}")
                    total[prop]+=n
            br.close()
    finally:
        sh(f"uci set luci.main.mediaurlbase={orig}; uci commit luci; rm -f /tmp/luci-indexcache*")
    print("\nproperties affected overall:", dict(total))

if __name__ == "__main__":
    main()

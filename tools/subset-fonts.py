#!/usr/bin/env python3
"""Re-subset the shipped woff2 faces, dropping OpenType features a router UI never wants.

DEV-ONLY, and deliberately NOT part of any build: the woff2 files in
`luci-theme-footstrap/htdocs/luci-static/footstrap/fonts/` are the source of truth and ship as they
are (luci.mk copies htdocs/ verbatim; the OpenWrt buildbot has no python-fonttools). This script
exists so the next person can reproduce them instead of finding nine binaries with no provenance.

    pip install fonttools brotli
    python3 tools/subset-fonts.py --check      # report only
    python3 tools/subset-fonts.py --write      # rewrite the files in place

WHY: the shipped `jetbrains-mono-400-latin.woff2` carried 388 glyphs for 223 mapped characters —
165 of them reachable only through `calt`, i.e. the programming LIGATURES. Browsers enable `calt`
by default, so a monospaced value in this UI was silently redrawn: `!=` as `≠`, `->` as `→`, `<=`
as `≤`, `|>` as `▷`, `<>` as `◇`. In a config value, an nftables rule or a log line that is not
typography, it is a lie about what the router stores. Dropping the feature is therefore a
correctness fix that happens to save 56% of that file.

WHAT MUST NOT BE DROPPED, and this was measured the hard way:
  * the GPOS features (`kern`, `mark`, `mkmk`, `curs`). Passing an explicit --layout-features list
    drops GPOS too, and losing `kern` re-spaces ORDINARY TEXT — the first attempt at this changed
    every menu label and every Cyrillic string, which a pixel comparison caught and a size table
    never would have.
  * `calt` on the UI face. Manrope uses it on plain letters, not just on symbol runs: dropping it
    also moved plain text.
  * `liga` on the UI face (fi/fl) — real typography, and it costs ~200 bytes.
  * `tnum`: the theme asks for `font-variant-numeric: tabular-nums` on the poll indicator.

Verification that belongs with any change here: render the same strings with the old and the new
file and compare PIXELS, not widths. A ligature substitution in a MONOSPACE face is
width-preserving, so a width check reports "identical" while the glyphs differ.
"""
import argparse
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / 'luci-theme-footstrap/htdocs/luci-static/footstrap/fonts'

# positioning stays for every face — see the docstring
POS = 'kern,mark,mkmk,curs'
KEEP = {
    # the UI face keeps everything that touches ordinary text; only the fraction machinery goes
    # (`frac`, `numr`, `dnom`, `pnum` — nothing in this theme asks for them)
    'manrope': f'ccmp,locl,liga,calt,tnum,{POS}',
    # the mono face additionally drops `calt`: that IS the ligature set
    'jetbrains': f'ccmp,locl,tnum,{POS}',
}


def plan(name):
    return KEEP['jetbrains' if name.startswith('jetbrains') else 'manrope']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='rewrite the woff2 files in place')
    args = ap.parse_args()

    try:
        import fontTools  # noqa: F401
    except ImportError:
        sys.exit('needs fonttools + brotli:  pip install fonttools brotli')

    out = pathlib.Path(tempfile.mkdtemp())
    before = after = 0
    rows = []
    for src in sorted(FONTS.glob('*.woff2')):
        dst = out / src.name
        r = subprocess.run([sys.executable, '-m', 'fontTools.subset', str(src),
                            '--unicodes=*', f'--layout-features={plan(src.name)}',
                            '--flavor=woff2', f'--output-file={dst}'],
                           capture_output=True, text=True)
        if r.returncode:
            sys.exit(f'{src.name}: {r.stderr.strip()[:200]}')
        b, a = src.stat().st_size, dst.stat().st_size
        before += b
        after += a
        rows.append((src, dst, b, a))

    for src, _dst, b, a in rows:
        pct = f'{100 * (b - a) / b:5.1f}%' if b else '    -'
        print(f'  {src.name:36} {b:6} -> {a:6}  {pct}')
    print(f'  {"TOTAL":36} {before:6} -> {after:6}  saved {before - after} bytes')

    if not args.write:
        print('\n(report only — pass --write to rewrite the files, then re-check the RENDER)')
        return
    for src, dst, _b, _a in rows:
        src.write_bytes(dst.read_bytes())
    print('\nwritten. Now compare the rendering pixel by pixel, not the widths.')


if __name__ == '__main__':
    main()

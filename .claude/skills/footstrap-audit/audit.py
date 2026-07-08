#!/usr/bin/env python3
"""Static audit of luci-theme-footstrap CSS/JS.

Reports:
  1. Bracket balance for cascade.css and all *.js.
  2. CSS custom properties used via var() but never defined (broken refs) —
     these silently drop the declaration (missing shadows/colors).
  3. Hardcoded color literals in the *base* bootstrap region (before the first
     appended FOOTSTRAP section) that bypass the token bridge — un-themed spots.

No dependencies. Run from repo root:
  .claude/tooling/preview-venv/bin/python .claude/skills/footstrap-audit/audit.py
  (any python3 works; venv just guarantees one exists)
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3] / "luci-theme-footstrap"
CSS = ROOT / "htdocs/luci-static/footstrap/cascade.css"

# vars set at runtime (inline style / other files) — legitimately "undefined" here
VAR_ALLOW = {"--zone-color-rgb", "--focus-color-rgb", "--on-color"}

def balance(path):
    s = path.read_text(encoding="utf-8")
    bad = [f"{a}{b} {s.count(a)}/{s.count(b)}"
           for a, b in [("{", "}"), ("(", ")"), ("[", "]")] if s.count(a) != s.count(b)]
    return bad

def audit_vars(s):
    defined = set(re.findall(r"(--[a-zA-Z0-9-]+)\s*:", s))
    used = set(re.findall(r"var\((--[a-zA-Z0-9-]+)", s))
    return sorted(u for u in (used - defined) if u not in VAR_ALLOW)

def base_hardcoded(lines):
    # region = after the token block (~line 95) and before the first appended section
    fs = next((i for i, l in enumerate(lines) if "FOOTSTRAP SHELL" in l), len(lines))
    color = re.compile(r"#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(")
    sel, out = "", []
    for i, l in enumerate(lines):
        st = l.strip()
        if st.endswith("{"):
            sel = st[:-1].strip()
        if 95 <= i < fs and not st.startswith("--") and "--" not in l.split(":")[0]:
            # a real literal = #hex, or a colour function whose first arg is a
            # number (not var()); black/white alpha overlays are ignored.
            after_var = re.sub(r"var\([^()]*\)", "", l)
            lit = re.search(r"#[0-9a-fA-F]{3,8}\b", after_var)
            func = re.search(r"[rh]sla?\(\s*(\d[\d.]*)", after_var)
            if func and re.match(r"(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)",
                                 after_var[func.start():].split("(", 1)[1].lstrip()):
                func = None
            if lit or func:
                out.append((i + 1, sel[:46], st[:80]))
    return out

def main():
    if not CSS.exists():
        sys.exit(f"not found: {CSS}")
    s = CSS.read_text(encoding="utf-8")
    lines = s.split("\n")

    print("== balance ==")
    problems = []
    for p in [CSS, *sorted(ROOT.glob("htdocs/luci-static/resources/**/*.js"))]:
        b = balance(p)
        if b:
            problems.append(p)
            print(f"  BAD {p.relative_to(ROOT)}: {', '.join(b)}")
    if not problems:
        print("  ok (all balanced)")

    print("\n== css vars used but not defined ==")
    miss = audit_vars(s)
    print("  none" if not miss else "\n".join(f"  {m}  (x{s.count('var('+m)})" for m in miss))

    print("\n== hardcoded colors in base region (candidates to tokenize) ==")
    hc = base_hardcoded(lines)
    if not hc:
        print("  none")
    else:
        for ln, sel, txt in hc:
            print(f"  {ln:>5} [{sel}] {txt}")
        print(f"  ({len(hc)} lines)")

    print("\nTip: compile-check ucode templates on the router:")
    print("  ssh router 'for f in /usr/share/ucode/luci/template/themes/footstrap*/*.ut; do "
          "ucode -T -c -o /dev/null \"$f\" && echo OK $f || echo FAIL $f; done'")

if __name__ == "__main__":
    main()

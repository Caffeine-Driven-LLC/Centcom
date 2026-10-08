#!/usr/bin/env python3
"""Print a modular type scale. Python stdlib only.

Usage:
    python3 typescale.py                      # base 16px, ratio 1.25, steps -2..6
    python3 typescale.py 15 1.2               # base 15px, ratio 1.2
    python3 typescale.py 16 1.333 --steps -2 7
    python3 typescale.py 16 1.25 --fluid 360 1280   # add clamp() that scales each
                                                     # step from 0.8x at 360px to 1x at 1280px
    python3 typescale.py 16 1.25 --css        # emit CSS custom properties

Columns: step, px (rounded to 0.5), rem, suggested line-height (unitless)
and letter-spacing, chosen by size band:
    <= 14px  lh 1.45  ls +0.005em
    <= 20px  lh 1.5   ls 0
    <= 28px  lh 1.3   ls -0.01em
    <= 40px  lh 1.2   ls -0.015em
    <= 56px  lh 1.1   ls -0.02em
    >  56px  lh 1.05  ls -0.025em
Treat these as starting points; see references/typography.md.
"""
import sys

NAMES = {-2: "xs", -1: "sm", 0: "base", 1: "md", 2: "lg", 3: "xl", 4: "2xl", 5: "3xl", 6: "4xl", 7: "5xl", 8: "6xl"}


def band(px: float) -> tuple[float, str]:
    if px <= 14:
        return 1.45, "0.005em"
    if px <= 20:
        return 1.5, "0"
    if px <= 28:
        return 1.3, "-0.01em"
    if px <= 40:
        return 1.2, "-0.015em"
    if px <= 56:
        return 1.1, "-0.02em"
    return 1.05, "-0.025em"


def round_half(x: float) -> float:
    return round(x * 2) / 2


def clamp_expr(min_px: float, max_px: float, vmin: float, vmax: float) -> str:
    slope = (max_px - min_px) / (vmax - vmin)
    intercept = min_px - slope * vmin
    return f"clamp({min_px/16:.3f}rem, {intercept/16:.3f}rem + {slope*100:.3f}vw, {max_px/16:.3f}rem)"


def main(argv: list[str]) -> int:
    pos = [a for a in argv if not a.startswith("--")]
    base = float(pos[0]) if len(pos) > 0 else 16.0
    ratio = float(pos[1]) if len(pos) > 1 else 1.25
    lo, hi = -2, 6
    fluid = None
    css = "--css" in argv
    if "--steps" in argv:
        i = argv.index("--steps")
        lo, hi = int(argv[i + 1]), int(argv[i + 2])
    if "--fluid" in argv:
        i = argv.index("--fluid")
        fluid = (float(argv[i + 1]), float(argv[i + 2]))

    rows = []
    for step in range(lo, hi + 1):
        px = base * ratio**step
        px_r = round_half(px)
        lh, ls = band(px_r)
        rows.append((step, px_r, px_r / 16, lh, ls))

    if css:
        print(":root {")
        for step, px, rem, lh, ls in rows:
            name = NAMES.get(step, f"s{step}")
            if fluid and px > 20:
                vmin, vmax = fluid
                print(f"  --text-{name}: {clamp_expr(px * 0.8, px, vmin, vmax)};")
            else:
                print(f"  --text-{name}: {rem:.4g}rem; /* {px:g}px */")
            print(f"  --leading-{name}: {lh}; --tracking-{name}: {ls};")
        print("}")
        return 0

    print(f"base {base:g}px  ratio {ratio:g}")
    print(f"{'step':>5} {'name':>5} {'px':>7} {'rem':>8} {'lh':>5} {'ls':>9}" + ("  fluid" if fluid else ""))
    for step, px, rem, lh, ls in rows:
        name = NAMES.get(step, f"s{step}")
        line = f"{step:>5} {name:>5} {px:>7g} {rem:>8.4g} {lh:>5} {ls:>9}"
        if fluid and px > 20:
            line += "  " + clamp_expr(px * 0.8, px, *fluid)
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

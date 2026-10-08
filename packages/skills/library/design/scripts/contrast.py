#!/usr/bin/env python3
"""WCAG 2.x contrast ratio for two colors. Python stdlib only.

Usage:
    python3 contrast.py "#1f2937" "#f9fafb"
    python3 contrast.py 1f2937 f9fafb
    python3 contrast.py "#fff" "#3b6fd4" --large   # treat as large text (24px+ / 19px+ bold)

Prints the ratio and pass/fail for:
  - normal text   AA 4.5:1   AAA 7:1
  - large text    AA 3:1     AAA 4.5:1
  - UI components / focus indicators / graphics   3:1

Accepts 3-, 4-, 6- or 8-digit hex (alpha is ignored; composite translucent
colors against their real background before checking). Order of the two
colors does not matter.
"""
import sys


def parse_hex(s: str) -> tuple[float, float, float]:
    s = s.strip().lstrip("#")
    if len(s) in (3, 4):
        s = "".join(ch * 2 for ch in s[:3])
    elif len(s) == 8:
        s = s[:6]
    if len(s) != 6:
        raise ValueError(f"not a hex color: {s!r}")
    r, g, b = (int(s[i : i + 2], 16) for i in (0, 2, 4))
    return r / 255, g / 255, b / 255


def linearize(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb: tuple[float, float, float]) -> float:
    r, g, b = (linearize(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str) -> float:
    la, lb = luminance(parse_hex(a)), luminance(parse_hex(b))
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    large = "--large" in argv
    if len(args) != 2:
        print(__doc__)
        return 2
    try:
        ratio = contrast(args[0], args[1])
    except ValueError as e:
        print(f"error: {e}")
        return 2

    def mark(ok: bool) -> str:
        return "pass" if ok else "FAIL"

    print(f"{args[0]} on {args[1]}: {ratio:.2f}:1")
    if large:
        print(f"  large text    AA (3:1)   {mark(ratio >= 3)}   AAA (4.5:1) {mark(ratio >= 4.5)}")
    else:
        print(f"  normal text   AA (4.5:1) {mark(ratio >= 4.5)}   AAA (7:1)   {mark(ratio >= 7)}")
        print(f"  large text    AA (3:1)   {mark(ratio >= 3)}   AAA (4.5:1) {mark(ratio >= 4.5)}")
    print(f"  UI / focus / graphics (3:1)  {mark(ratio >= 3)}")
    return 0 if ratio >= (3 if large else 4.5) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

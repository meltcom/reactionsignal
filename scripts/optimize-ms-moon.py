#!/usr/bin/env python3
"""Convert the existing MS Journey moon PNG to a compact, transparent WebP.

Usage:
    python -m pip install Pillow
    python scripts/optimize-ms-moon.py

Run from repository root. Does not alter the original PNG.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "images" / "ms-moon-logo.png"
DEST = ROOT / "images" / "ms-moon-logo-optimized.webp"

def main():
    with Image.open(SOURCE) as original:
        image = original.convert("RGBA")
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        image.save(DEST, "WEBP", quality=80, method=6, exact=True)
        with Image.open(DEST) as check:
            check.verify()
    print(f"{SOURCE.name}: {SOURCE.stat().st_size:,} bytes")
    print(f"{DEST.name}: {DEST.stat().st_size:,} bytes")
    if DEST.stat().st_size >= SOURCE.stat().st_size:
        raise SystemExit("Optimized file is not smaller; do not deploy.")

if __name__ == "__main__":
    main()

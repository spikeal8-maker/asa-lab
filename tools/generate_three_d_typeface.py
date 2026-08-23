"""Generate a compact Three.js typeface from the open Noto Sans source font.

The checked-in result is used synchronously by the 3D editor. Keeping the
conversion deterministic avoids a network request while a project is open.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


CHARACTER_RANGES = (
    (0x20, 0x24F),       # Basic/extended Latin and IPA
    (0x370, 0x52F),      # Greek and Cyrillic
    (0x1E00, 0x1EFF),    # Latin extended additional
    (0x2000, 0x22FF),    # Punctuation, currency, arrows and maths
    (0x25A0, 0x26FF),    # Geometric shapes and symbols
)


def compact(value: float) -> int | float:
    rounded = round(float(value), 2)
    return int(rounded) if rounded.is_integer() else rounded


class TypefacePen(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.commands: list[str] = []

    def point(self, value) -> tuple[str, str]:
        return str(compact(value[0])), str(compact(value[1]))

    def _moveTo(self, point):
        x, y = self.point(point)
        self.commands.extend(("m", x, y))

    def _lineTo(self, point):
        x, y = self.point(point)
        self.commands.extend(("l", x, y))

    def _curveToOne(self, control_one, control_two, point):
        x, y = self.point(point)
        c1x, c1y = self.point(control_one)
        c2x, c2y = self.point(control_two)
        self.commands.extend(("b", x, y, c1x, c1y, c2x, c2y))

    def _qCurveToOne(self, control, point):
        x, y = self.point(point)
        cx, cy = self.point(control)
        self.commands.extend(("q", x, y, cx, cy))

    def _closePath(self):
        return None

    def _endPath(self):
        return None


def selected_codepoints(cmap: dict[int, str]) -> list[int]:
    return sorted(
        codepoint
        for codepoint in cmap
        if any(start <= codepoint <= end for start, end in CHARACTER_RANGES)
    )


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate_three_d_typeface.py SOURCE.ttf OUTPUT.json")

    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    font = TTFont(source)
    if "fvar" in font:
        font = instantiateVariableFont(font, {"wght": 400, "wdth": 100}, inplace=False)

    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"].metrics
    head = font["head"]
    hhea = font["hhea"]
    post = font["post"]
    glyphs: dict[str, dict[str, int | float | str]] = {}

    for codepoint in selected_codepoints(cmap):
        character = chr(codepoint)
        glyph_name = cmap[codepoint]
        glyph = glyph_set[glyph_name]
        pen = TypefacePen(glyph_set)
        glyph.draw(pen)
        advance, _ = hmtx[glyph_name]
        glyphs[character] = {
            "ha": compact(advance),
            "x_min": compact(getattr(glyph, "xMin", 0)),
            "x_max": compact(getattr(glyph, "xMax", advance)),
            "o": " ".join(pen.commands),
        }

    if "?" not in glyphs:
        raise RuntimeError("The fallback question-mark glyph is missing")

    payload = {
        "glyphs": glyphs,
        "familyName": font["name"].getDebugName(1) or source.stem,
        "ascender": compact(hhea.ascent),
        "descender": compact(hhea.descent),
        "underlinePosition": compact(post.underlinePosition),
        "underlineThickness": compact(post.underlineThickness),
        "boundingBox": {
            "xMin": compact(head.xMin),
            "xMax": compact(head.xMax),
            "yMin": compact(head.yMin),
            "yMax": compact(head.yMax),
        },
        "resolution": int(head.unitsPerEm),
        "original_font_information": {
            "format": "TrueType",
            "copyright": font["name"].getDebugName(0) or "SIL Open Font License 1.1",
        },
        "cssFontWeight": "normal",
        "cssFontStyle": "normal",
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

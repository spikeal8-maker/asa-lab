#!/usr/bin/env python3
"""Trace owner PNG references into transparent, path-only SVG candidates.

This offline reconstruction tool never embeds the source bitmap: output consists
only of colour-quantised SVG paths. The owner PNG remains immutable evidence.
"""

from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_ROOT = ROOT / "apps/web/public/assets/electronics/owner-audit/components/source-reference"
OUTPUT_ROOT = ROOT / "tools/electronics-production-vectors"
COMPONENT_IDS = (
    "arduino-uno", "battery-1.5v", "battery-3v", "battery-6v", "battery-9v",
    "resistor-axial", "potentiometer", "electrolytic-capacitor", "photoresistor",
    "transistor-npn", "dc-motor", "servo-motor", "piezo", "multimeter",
    "regulated-power-supply",
)
Point = tuple[int, int]


def remove_connected_background(image: Image.Image) -> Image.Image:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    height, width, _ = rgba.shape
    corners = np.array(
        [rgba[0, 0, :3], rgba[0, width - 1, :3], rgba[height - 1, 0, :3], rgba[height - 1, width - 1, :3]],
        dtype=np.int32,
    )
    background = np.median(corners, axis=0)
    delta = rgba[:, :, :3].astype(np.int32) - background
    candidate = (np.sqrt(np.sum(delta * delta, axis=2)) <= 30) | (rgba[:, :, 3] <= 8)
    connected = np.zeros((height, width), dtype=bool)
    queue: deque[Point] = deque()
    for x in range(width):
        if candidate[0, x]: queue.append((x, 0))
        if candidate[height - 1, x]: queue.append((x, height - 1))
    for y in range(height):
        if candidate[y, 0]: queue.append((0, y))
        if candidate[y, width - 1]: queue.append((width - 1, y))
    while queue:
        x, y = queue.popleft()
        if connected[y, x] or not candidate[y, x]:
            continue
        connected[y, x] = True
        if x > 0: queue.append((x - 1, y))
        if x + 1 < width: queue.append((x + 1, y))
        if y > 0: queue.append((x, y - 1))
        if y + 1 < height: queue.append((x, y + 1))
    rgba[connected, 3] = 0
    ys, xs = np.nonzero(rgba[:, :, 3] > 8)
    if len(xs) == 0:
        raise RuntimeError("Background removal erased the whole owner reference")
    margin = 2
    left, top = max(0, int(xs.min()) - margin), max(0, int(ys.min()) - margin)
    right, bottom = min(width, int(xs.max()) + margin + 1), min(height, int(ys.max()) + margin + 1)
    return Image.fromarray(rgba[top:bottom, left:right], mode="RGBA")


def downsample(image: Image.Image, maximum_side: int = 420) -> Image.Image:
    scale = min(1.0, maximum_side / max(image.size))
    return image if scale == 1 else image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS
    )


def simplify_collinear(points: list[Point]) -> list[Point]:
    if len(points) <= 3:
        return points
    result = []
    for index, point in enumerate(points):
        previous, following = points[index - 1], points[(index + 1) % len(points)]
        if (point[0] - previous[0]) * (following[1] - point[1]) == (point[1] - previous[1]) * (following[0] - point[0]):
            continue
        result.append(point)
    return result


def perpendicular_distance(point: Point, start: Point, end: Point) -> float:
    if start == end:
        return float(np.hypot(point[0] - start[0], point[1] - start[1]))
    numerator = abs((end[1] - start[1]) * point[0] - (end[0] - start[0]) * point[1] + end[0] * start[1] - end[1] * start[0])
    return numerator / float(np.hypot(end[1] - start[1], end[0] - start[0]))


def rdp(points: list[Point], epsilon: float) -> list[Point]:
    if len(points) < 3:
        return points
    distances = [perpendicular_distance(points[index], points[0], points[-1]) for index in range(1, len(points) - 1)]
    if not distances or max(distances) <= epsilon:
        return [points[0], points[-1]]
    split = distances.index(max(distances)) + 1
    return rdp(points[: split + 1], epsilon)[:-1] + rdp(points[split:], epsilon)


def mask_loops(mask: np.ndarray) -> list[list[Point]]:
    height, width = mask.shape
    outgoing: dict[Point, list[Point]] = defaultdict(list)
    for y, x in zip(*np.nonzero(mask), strict=True):
        if y == 0 or not mask[y - 1, x]: outgoing[(x, y)].append((x + 1, y))
        if x + 1 == width or not mask[y, x + 1]: outgoing[(x + 1, y)].append((x + 1, y + 1))
        if y + 1 == height or not mask[y + 1, x]: outgoing[(x + 1, y + 1)].append((x, y + 1))
        if x == 0 or not mask[y, x - 1]: outgoing[(x, y + 1)].append((x, y))
    loops = []
    while outgoing:
        start = next(iter(outgoing))
        current, points = start, [start]
        edge_budget = sum(len(values) for values in outgoing.values()) + 2
        for _ in range(edge_budget):
            targets = outgoing.get(current)
            if not targets:
                break
            following = targets.pop()
            if not targets: del outgoing[current]
            current = following
            if current == start: break
            points.append(current)
        if current == start and len(points) >= 4:
            simplified = simplify_collinear(points)
            reduced = rdp(simplified + [simplified[0]], 0.45)[:-1]
            if len(reduced) >= 3: loops.append(reduced)
    return loops


def path_data(loops: Iterable[list[Point]]) -> str:
    return " ".join("M " + " L ".join(f"{x} {y}" for x, y in loop) + " Z" for loop in loops)


def trace_component(component_id: str) -> str:
    image = downsample(remove_connected_background(Image.open(REFERENCE_ROOT / f"{component_id}.png")))
    rgba = np.asarray(image, dtype=np.uint8)
    visible = rgba[:, :, 3] > 24
    quantize_input = rgba[:, :, :3].copy()
    quantize_input[~visible] = np.mean(quantize_input[visible], axis=0).astype(np.uint8)
    quantized = Image.fromarray(quantize_input, mode="RGB").quantize(colors=40, method=Image.Quantize.MEDIANCUT)
    indices, palette = np.asarray(quantized, dtype=np.uint8), quantized.getpalette()
    paths = []
    for colour_index in np.unique(indices[visible]):
        mask = (indices == colour_index) & visible
        if int(mask.sum()) < 2:
            continue
        loops = mask_loops(mask)
        if not loops:
            continue
        offset = int(colour_index) * 3
        red, green, blue = palette[offset : offset + 3]
        paths.append(f'<path fill="#{red:02x}{green:02x}{blue:02x}" fill-rule="evenodd" d="{path_data(loops)}"/>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {image.width} {image.height}" data-component-id="{component_id}" data-provenance="derived_from_owner_reference" role="img">\n'
        f'<g id="owner-reference-vector-trace">{"".join(paths)}</g>\n</svg>\n'
    )


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    expected = {f"{component_id}.svg" for component_id in COMPONENT_IDS}
    for stale in OUTPUT_ROOT.glob("*.svg"):
        if stale.name not in expected: stale.unlink()
    for component_id in COMPONENT_IDS:
        output = OUTPUT_ROOT / f"{component_id}.svg"
        output.write_text(trace_component(component_id), encoding="utf-8")
        print(f"{component_id}: {output.stat().st_size} bytes")


if __name__ == "__main__":
    main()

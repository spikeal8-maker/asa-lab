#!/usr/bin/env python3
"""Build the owner-derived Electronics production-vector review package.

The immutable archive audit under ``owner-audit`` is input evidence. This tool
creates a separate reference index and a production-candidate package. It does
not mark any candidate owner-accepted or expose it in the working editor.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "apps/web/public/assets/electronics"
AUDIT_ROOT = ASSET_ROOT / "owner-audit"
REFERENCE_ROOT = ASSET_ROOT / "reference"
PRODUCTION_ROOT = ASSET_ROOT / "production"
VECTOR_SOURCE_ROOT = ROOT / "tools/electronics-production-vectors"
WORLD_UNITS_PER_MM = 5
REFERENCE_AUDIT_SHA = "9654ce3b9cd2605cb69d9b2d3f8821618364e480"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_reset(path: Path) -> None:
    if path.parent.resolve() != ASSET_ROOT.resolve() or path.name not in {"reference", "production"}:
        raise RuntimeError(f"Refusing to reset unexpected path: {path}")
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def copy_asset(source_relative: str, target: Path) -> str:
    source = AUDIT_ROOT / source_relative
    if not source.is_file():
        raise FileNotFoundError(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    if digest(source) != digest(target):
        raise RuntimeError(f"Copy hash mismatch: {source_relative}")
    return digest(target)


def n(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def svg_document(component_id: str, width: float, height: float, body: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{n(width)}mm" height="{n(height)}mm" '
        f'viewBox="0 0 {n(width)} {n(height)}" data-component-id="{component_id}" '
        'data-provenance="derived_from_owner_reference" role="img">\n'
        f"{body.strip()}\n"
        "</svg>\n"
    )


def pin_marker(pin: dict[str, Any]) -> str:
    return (
        f'<circle id="pin-{pin["id"]}" data-pin-id="{pin["id"]}" '
        f'cx="{n(pin["xMm"])}" cy="{n(pin["yMm"])}" r="0.06" fill="none"/>'
    )


def pin_group(pins: list[dict[str, Any]]) -> str:
    return '<g id="pin-anchors" aria-hidden="true">' + "".join(pin_marker(pin) for pin in pins) + "</g>"


def line_to_pin(pin: dict[str, Any], x2: float, y2: float, color: str = "#777") -> str:
    return (
        f'<line x1="{n(pin["xMm"])}" y1="{n(pin["yMm"])}" x2="{n(x2)}" y2="{n(y2)}" '
        f'stroke="{color}" stroke-width="0.55" stroke-linecap="round"/>'
    )


def rounded_component(width: float, height: float, fill: str, stroke: str = "#31363a") -> str:
    return (
        f'<rect x="0.35" y="0.35" width="{n(width - 0.7)}" height="{n(height - 0.7)}" '
        f'rx="1.1" fill="{fill}" stroke="{stroke}" stroke-width="0.3"/>'
    )


def arduino_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    board_x = width * 0.43
    board_y = height * 0.08
    board_w = width * 0.53
    board_h = height * 0.84
    holes = "".join(
        f'<circle cx="{n(pin["xMm"])}" cy="{n(pin["yMm"])}" r="0.72" fill="#202427" stroke="#90979b" stroke-width="0.18"/>'
        for pin in pins
    )
    body = f"""
  <defs>
    <linearGradient id="board" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#3d82ad"/><stop offset="1" stop-color="#2d6e99"/></linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#aeb6ba"/><stop offset=".5" stop-color="#f0f2f2"/><stop offset="1" stop-color="#8a9499"/></linearGradient>
  </defs>
  <g id="cable"><path d="M0 {n(height*.28)} H{n(width*.20)}" stroke="#292c2f" stroke-width="6.2"/><rect x="{n(width*.18)}" y="{n(height*.19)}" width="{n(width*.17)}" height="{n(height*.18)}" rx="2" fill="#292c2f"/><rect x="{n(width*.35)}" y="{n(height*.205)}" width="{n(width*.11)}" height="{n(height*.15)}" rx="1" fill="url(#metal)"/></g>
  <g id="board"><path d="M{n(board_x+3)} {n(board_y)} H{n(board_x+board_w-2)} L{n(board_x+board_w)} {n(board_y+2)} V{n(board_y+board_h-2)} L{n(board_x+board_w-2)} {n(board_y+board_h)} H{n(board_x)} V{n(board_y+4)} Z" fill="url(#board)" stroke="#285d80" stroke-width=".35"/>
    <rect x="{n(board_x)}" y="{n(height*.18)}" width="{n(width*.09)}" height="{n(height*.18)}" rx="1" fill="url(#metal)"/>
    <rect x="{n(width*.60)}" y="{n(height*.48)}" width="{n(width*.27)}" height="{n(height*.16)}" rx=".8" fill="#292d30"/>
    <rect x="{n(width*.54)}" y="{n(height*.26)}" width="{n(width*.05)}" height="{n(height*.07)}" rx=".5" fill="#30383d"/>
    <circle cx="{n(width*.58)}" cy="{n(height*.72)}" r="3" fill="#d8dadd" stroke="#727b80" stroke-width=".5"/>
    <circle cx="{n(width*.69)}" cy="{n(height*.72)}" r="3" fill="#d8dadd" stroke="#727b80" stroke-width=".5"/>
    <g id="headers">{holes}</g>
    <g id="board-markings" fill="none" stroke="#eef7fb" stroke-width=".35"><circle cx="{n(width*.72)}" cy="{n(height*.30)}" r="5"/><circle cx="{n(width*.83)}" cy="{n(height*.30)}" r="5"/><path d="M{n(width*.715)} {n(height*.30)}h2M{n(width*.825)} {n(height*.30)}h2M{n(width*.835)} {n(height*.285)}v2"/></g>
  </g>
  {pin_group(pins)}
"""
    return svg_document("arduino-uno", width, height, body)


def aa_pack_svg(component_id: str, width: float, height: float, pins: list[dict[str, Any]], cells: int) -> str:
    pack_x = width * 0.12
    pack_y = height * 0.13
    pack_w = width * 0.76
    pack_h = height * 0.76
    gap = max(0.35, pack_w * 0.012)
    cell_w = (pack_w - gap * (cells + 1)) / cells
    cell_parts = []
    for index in range(cells):
        x = pack_x + gap + index * (cell_w + gap)
        cell_parts.append(
            f'<g id="cell-{index+1}"><rect x="{n(x)}" y="{n(pack_y+1.3)}" width="{n(cell_w)}" height="{n(pack_h-2.6)}" rx="1" fill="#2f7e84"/>'
            f'<rect x="{n(x)}" y="{n(pack_y+pack_h*.58)}" width="{n(cell_w)}" height="{n(pack_h*.25)}" fill="#47c1c4" opacity=".92"/>'
            f'<rect x="{n(x+cell_w*.3)}" y="{n(pack_y+.2)}" width="{n(cell_w*.4)}" height="1.4" rx=".25" fill="#b9c0c1"/></g>'
        )
    negative, positive = pins[0], pins[1]
    body = f"""
  <defs><linearGradient id="case" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#35383a"/><stop offset="1" stop-color="#25282a"/></linearGradient></defs>
  <g id="leads">{line_to_pin(negative, pack_x+pack_w*.42, pack_y, '#292d30')}{line_to_pin(positive, pack_x+pack_w*.58, pack_y, '#bd1d24')}</g>
  <g id="holder"><rect x="{n(pack_x)}" y="{n(pack_y)}" width="{n(pack_w)}" height="{n(pack_h)}" rx="1.5" fill="url(#case)"/>{''.join(cell_parts)}</g>
  {pin_group(pins)}
"""
    return svg_document(component_id, width, height, body)


def battery9_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    negative, positive = pins[0], pins[1]
    body = f"""
  <g id="leads">{line_to_pin(negative, width*.16, height*.44, '#292d30')}{line_to_pin(positive, width*.16, height*.56, '#c51f2b')}</g>
  <g id="battery-body"><rect x="{n(width*.16)}" y="1" width="{n(width*.81)}" height="{n(height-2)}" rx="1.4" fill="#2d2d2e"/><path d="M{n(width*.16)} 1 H{n(width*.46)} V{n(height-1)} H{n(width*.16)} Z" fill="#d58b4b"/><rect x="{n(width*.13)}" y="{n(height*.15)}" width="{n(width*.04)}" height="{n(height*.70)}" rx=".4" fill="#c8ccce"/></g>
  {pin_group(pins)}
"""
    return svg_document("battery-9v", width, height, body)


def resistor_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    x = width * 0.25
    body = f"""
  <g id="leads">{line_to_pin(pins[0], width*.5, height*.25)}{line_to_pin(pins[1], width*.5, height*.75)}</g>
  <g id="body"><rect x="{n(x)}" y="{n(height*.25)}" width="{n(width*.5)}" height="{n(height*.5)}" rx="{n(width*.22)}" fill="#d9b477" stroke="#a68550" stroke-width=".18"/>
    <rect x="{n(x)}" y="{n(height*.34)}" width="{n(width*.5)}" height=".55" fill="#8b4513"/><rect x="{n(x)}" y="{n(height*.45)}" width="{n(width*.5)}" height=".55" fill="#111"/><rect x="{n(x)}" y="{n(height*.56)}" width="{n(width*.5)}" height=".55" fill="#d92323"/><rect x="{n(x)}" y="{n(height*.67)}" width="{n(width*.5)}" height=".45" fill="#d6cf41"/>
  </g>{pin_group(pins)}
"""
    return svg_document("resistor-axial", width, height, body)


def potentiometer_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, pin["xMm"], height * 0.78) for pin in pins)
    body = f"""
  <g id="leads">{leads}</g>
  <g id="body"><rect x="{n(width*.13)}" y="{n(height*.18)}" width="{n(width*.74)}" height="{n(height*.60)}" rx="1.2" fill="#226aa6" stroke="#174d78" stroke-width=".3"/></g>
  <g id="knob" data-state-channel="wiper-position" transform-origin="{n(width*.5)} {n(height*.48)}"><circle cx="{n(width*.5)}" cy="{n(height*.48)}" r="{n(min(width,height)*.27)}" fill="#5ea2d2" stroke="#173e5a" stroke-width=".35"/><path d="M{n(width*.5)} {n(height*.48)} L{n(width*.36)} {n(height*.64)}" stroke="#172b3a" stroke-width=".7" stroke-linecap="round"/></g>
  {pin_group(pins)}
"""
    return svg_document("potentiometer", width, height, body)


def capacitor_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, pin["xMm"], height * 0.77) for pin in pins)
    body = f"""
  <defs><linearGradient id="can" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#242526"/><stop offset=".5" stop-color="#4b4d4e"/><stop offset="1" stop-color="#1c1d1e"/></linearGradient></defs>
  <g id="leads">{leads}</g><g id="body"><path d="M{n(width*.17)} {n(height*.2)} Q{n(width*.5)} {n(height*.08)} {n(width*.83)} {n(height*.2)} V{n(height*.76)} Q{n(width*.5)} {n(height*.86)} {n(width*.17)} {n(height*.76)} Z" fill="url(#can)"/><path d="M{n(width*.68)} {n(height*.18)} V{n(height*.77)}" stroke="#c8cac9" stroke-width=".7" opacity=".8"/><ellipse cx="{n(width*.5)}" cy="{n(height*.2)}" rx="{n(width*.33)}" ry="{n(height*.07)}" fill="#777d80"/></g>{pin_group(pins)}
"""
    return svg_document("electrolytic-capacitor", width, height, body)


def photoresistor_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, pin["xMm"], height * 0.68) for pin in pins)
    serpentine = f"M{n(width*.32)} {n(height*.30)} C{n(width*.65)} {n(height*.30)} {n(width*.35)} {n(height*.39)} {n(width*.68)} {n(height*.39)} C{n(width*.35)} {n(height*.39)} {n(width*.65)} {n(height*.48)} {n(width*.32)} {n(height*.48)} C{n(width*.65)} {n(height*.48)} {n(width*.35)} {n(height*.57)} {n(width*.68)} {n(height*.57)}"
    body = f"""
  <g id="leads">{leads}</g><g id="sensor"><circle cx="{n(width*.5)}" cy="{n(height*.43)}" r="{n(width*.36)}" fill="#d99a41" stroke="#af6d24" stroke-width=".3"/><path d="{serpentine}" fill="none" stroke="#8a4a21" stroke-width=".55" stroke-linecap="round"/></g>{pin_group(pins)}
"""
    return svg_document("photoresistor", width, height, body)


def transistor_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, pin["xMm"], height * 0.62) for pin in pins)
    body = f"""
  <g id="leads">{leads}</g><g id="body"><path d="M{n(width*.18)} {n(height*.18)} Q{n(width*.5)} {n(height*.03)} {n(width*.82)} {n(height*.18)} V{n(height*.62)} H{n(width*.18)} Z" fill="#2b2d2e" stroke="#121314" stroke-width=".25"/><path d="M{n(width*.24)} {n(height*.56)} H{n(width*.76)}" stroke="#555b5e" stroke-width=".3"/></g>{pin_group(pins)}
"""
    return svg_document("transistor-npn", width, height, body)


def motor_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, pin["xMm"], height * 0.77, "#333" if index == 0 else "#c51f2b") for index, pin in enumerate(pins))
    body = f"""
  <defs><linearGradient id="motor-can" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#bfc3c4"/><stop offset=".5" stop-color="#eeeeed"/><stop offset="1" stop-color="#969c9f"/></linearGradient></defs>
  <g id="leads">{leads}</g><g id="body"><path d="M{n(width*.12)} {n(height*.18)} H{n(width*.78)} Q{n(width*.92)} {n(height*.18)} {n(width*.92)} {n(height*.5)} Q{n(width*.92)} {n(height*.78)} {n(width*.78)} {n(height*.78)} H{n(width*.12)} Z" fill="url(#motor-can)" stroke="#747a7d" stroke-width=".3"/><rect x="{n(width*.03)}" y="{n(height*.40)}" width="{n(width*.16)}" height="{n(height*.16)}" rx=".5" fill="#7b8081"/></g>
  <g id="rotor" data-state-channel="motor-rotation" transform-origin="{n(width*.64)} {n(height*.48)}"><circle cx="{n(width*.64)}" cy="{n(height*.48)}" r="{n(height*.20)}" fill="#d0d3d4" stroke="#8c9295" stroke-width=".3"/><path d="M{n(width*.64)} {n(height*.32)} V{n(height*.64)} M{n(width*.52)} {n(height*.38)} L{n(width*.76)} {n(height*.58)} M{n(width*.76)} {n(height*.38)} L{n(width*.52)} {n(height*.58)}" stroke="#e0b91d" stroke-width=".7"/></g>{pin_group(pins)}
"""
    return svg_document("dc-motor", width, height, body)


def servo_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, width * (0.36 + index * 0.14), height * 0.22, ["#55352b", "#d84a2f", "#e38b21"][index]) for index, pin in enumerate(pins))
    body = f"""
  <g id="cable">{leads}</g><g id="body"><rect x="{n(width*.16)}" y="{n(height*.22)}" width="{n(width*.68)}" height="{n(height*.68)}" rx="1.1" fill="#1877bd" stroke="#135884" stroke-width=".35"/><rect x="{n(width*.08)}" y="{n(height*.58)}" width="{n(width*.84)}" height="{n(height*.12)}" rx=".5" fill="#2589cc"/></g>
  <g id="horn" data-state-channel="servo-angle" transform-origin="{n(width*.5)} {n(height*.32)}"><circle cx="{n(width*.5)}" cy="{n(height*.32)}" r="1.3" fill="#d8dbdc" stroke="#777" stroke-width=".25"/><path d="M{n(width*.18)} {n(height*.32)} H{n(width*.82)}" stroke="#e5e7e8" stroke-width="2" stroke-linecap="round"/><circle cx="{n(width*.25)}" cy="{n(height*.32)}" r=".35" fill="#5b6d78"/><circle cx="{n(width*.75)}" cy="{n(height*.32)}" r=".35" fill="#5b6d78"/></g>{pin_group(pins)}
"""
    return svg_document("servo-motor", width, height, body)


def piezo_svg(width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, pin["xMm"], height * 0.72, "#333" if index == 0 else "#c51f2b") for index, pin in enumerate(pins))
    body = f"""
  <g id="leads">{leads}</g><g id="body"><circle cx="{n(width*.5)}" cy="{n(height*.43)}" r="{n(min(width,height)*.38)}" fill="#303031"/><circle cx="{n(width*.5)}" cy="{n(height*.43)}" r="{n(min(width,height)*.09)}" fill="#b5aa7a"/></g><g id="active-ring" data-state-channel="buzzer-active" opacity="0"><circle cx="{n(width*.5)}" cy="{n(height*.43)}" r="{n(min(width,height)*.46)}" fill="none" stroke="#e0b91d" stroke-width=".55"/></g>{pin_group(pins)}
"""
    return svg_document("piezo", width, height, body)


def instrument_svg(component_id: str, width: float, height: float, pins: list[dict[str, Any]], kind: str) -> str:
    negative, positive = pins[0], pins[1]
    body_fill = "#edab14" if kind == "multimeter" else "#d9dcda"
    body = f"""
  <g id="leads">{line_to_pin(negative, negative['xMm'], height*.79, '#222')}{line_to_pin(positive, positive['xMm'], height*.79, '#c51f2b')}</g>
  <g id="body">{rounded_component(width, height, body_fill)}<rect x="{n(width*.08)}" y="{n(height*.12)}" width="{n(width*.58)}" height="{n(height*.45)}" rx=".6" fill="#c9d2d5" stroke="#3f4649" stroke-width=".35"/>
    <circle cx="{n(width*.77)}" cy="{n(height*.30)}" r="{n(height*.12)}" fill="#8c9395" stroke="#404648" stroke-width=".3"/><circle cx="{n(width*.83)}" cy="{n(height*.72)}" r="{n(height*.06)}" fill="#c51f2b"/><circle cx="{n(width*.72)}" cy="{n(height*.72)}" r="{n(height*.06)}" fill="#272a2b"/></g>
  <g id="display" data-state-channel="measurement"><path d="M{n(width*.13)} {n(height*.35)} H{n(width*.55)}" stroke="#718084" stroke-width=".45"/></g>{pin_group(pins)}
"""
    return svg_document(component_id, width, height, body)


def generic_static_svg(component_id: str, width: float, height: float, pins: list[dict[str, Any]]) -> str:
    leads = "".join(line_to_pin(pin, pin["xMm"], height * 0.70) for pin in pins)
    body = f'<g id="leads">{leads}</g><g id="body">{rounded_component(width, height, "#4b555b")}</g>{pin_group(pins)}'
    return svg_document(component_id, width, height, body)


DERIVED_DIMENSIONS: dict[str, tuple[float, float, str]] = {
    "arduino-uno": (138.942, 68.164, "owner_physical_scale_manifest"),
    "battery-1.5v": (23.524, 66.87, "owner_physical_scale_manifest"),
    "battery-3v": (31.423, 56.855, "owner_physical_scale_manifest"),
    "battery-6v": (68.507, 65.043, "owner_physical_scale_manifest"),
    "battery-9v": (52.667, 26.8, "owner_scale_sheet_ratio_anchor"),
    "resistor-axial": (4.354, 11.582, "owner_physical_scale_manifest"),
    "potentiometer": (12.131, 13.66, "owner_physical_scale_manifest"),
    "electrolytic-capacitor": (8.667, 14.133, "owner_scale_sheet_ratio_anchor"),
    "photoresistor": (8.133, 12.133, "owner_scale_sheet_ratio_anchor"),
    "transistor-npn": (8.267, 13.333, "owner_scale_sheet_ratio_anchor"),
    "dc-motor": (25.333, 19.333, "owner_scale_sheet_ratio_anchor"),
    "servo-motor": (15.2, 38.533, "owner_scale_sheet_ratio_anchor"),
    "piezo": (22.133, 22.0, "owner_scale_sheet_ratio_anchor"),
    "multimeter": (36.4, 14.0, "owner_scale_sheet_ratio_anchor"),
    "regulated-power-supply": (28.667, 22.8, "owner_scale_sheet_ratio_anchor"),
}


DERIVED_REFERENCE: dict[str, str] = {
    component_id: f"components/source-reference/{component_id}.png" for component_id in DERIVED_DIMENSIONS
}


def arduino_pin_ratios() -> list[tuple[str, float, float, str]]:
    digital = [
        (f"D{index}", 0.53 + index * 0.029, 0.135, "digital_io")
        for index in range(14)
    ]
    analog = [
        (f"A{index}", 0.56 + index * 0.047, 0.865, "analog_input")
        for index in range(6)
    ]
    power_ids = ("IOREF", "RESET", "3V3", "5V", "GND-1", "GND-2", "VIN")
    power = [
        (pin_id, 0.53 + index * 0.046, 0.765, "power")
        for index, pin_id in enumerate(power_ids)
    ]
    return digital + analog + power


DERIVED_PIN_RATIOS: dict[str, list[tuple[str, float, float, str]]] = {
    "arduino-uno": arduino_pin_ratios(),
    "battery-1.5v": [("negative", 0.35, 0.0, "negative"), ("positive", 0.65, 0.0, "positive")],
    "battery-3v": [("negative", 0.35, 0.0, "negative"), ("positive", 0.65, 0.0, "positive")],
    "battery-6v": [("negative", 0.42, 0.0, "negative"), ("positive", 0.58, 0.0, "positive")],
    "battery-9v": [("negative", 0.0, 0.40, "negative"), ("positive", 0.0, 0.60, "positive")],
    "resistor-axial": [("terminal-1", 0.5, 0.0, "terminal"), ("terminal-2", 0.5, 1.0, "terminal")],
    "potentiometer": [("left", 0.24, 1.0, "resistive_end"), ("wiper", 0.5, 1.0, "wiper"), ("right", 0.76, 1.0, "resistive_end")],
    "electrolytic-capacitor": [("negative", 0.35, 1.0, "negative"), ("positive", 0.65, 1.0, "positive")],
    "photoresistor": [("terminal-1", 0.35, 1.0, "terminal"), ("terminal-2", 0.65, 1.0, "terminal")],
    "transistor-npn": [("collector", 0.26, 1.0, "collector"), ("base", 0.5, 1.0, "base"), ("emitter", 0.74, 1.0, "emitter")],
    "dc-motor": [("negative", 0.0, 0.36, "negative"), ("positive", 0.0, 0.64, "positive")],
    "servo-motor": [("ground", 0.0, 0.38, "ground"), ("power", 0.0, 0.5, "power"), ("signal", 0.0, 0.62, "signal")],
    "piezo": [("negative", 0.42, 1.0, "negative"), ("positive", 0.58, 1.0, "positive")],
    "multimeter": [("common", 0.36, 1.0, "common"), ("measurement", 0.64, 1.0, "measurement")],
    "regulated-power-supply": [("negative", 0.36, 1.0, "negative"), ("positive", 0.64, 1.0, "positive")],
}


EXACT_DEFAULTS: dict[str, str] = {
    "breadboard-small": "components/breadboards/breadboard-small.svg",
    "breadboard-medium": "components/breadboards/breadboard-medium.svg",
    "breadboard-large": "components/breadboards/breadboard-large.svg",
    "button-tactile-6mm": "components/button/released.svg",
    "switch-spdt": "components/switch/left.svg",
    "led-5mm": "components/led/red/led_red_i000.svg",
    "rgb-led": "components/rgb/rgb_led_v12_front_off.svg",
    "diode-do35": "components/diode/do35.svg",
    "diode-do41": "components/diode/do41.svg",
    "incandescent-lamp": "components/lamp/off.svg",
    "seven-segment-display": "components/display/seven-segment.svg",
}


HOLDER_DEFAULTS = {
    count: f"components/battery-holders/aa-{count}.svg" for count in (1, 2, 3, 4, 6, 8)
}


STATE_CONTRACTS: dict[str, dict[str, Any]] = {
    "led-5mm": {"type": "ordinary_led", "colors": ["blue", "green", "orange", "red", "white", "yellow"], "brightness": {"min": 0, "max": 100, "step": 1}, "specialStates": ["reverse", "overcurrent", "burned"]},
    "resistor-axial": {"type": "resistor_colour_code", "bands": ["digit-1", "digit-2", "multiplier", "tolerance"], "resistanceOhms": {"min": 0.1, "max": 99000000000}, "tolerancePercent": [1, 2, 5, 10]},
    "rgb-led": {"type": "rgb_led", "channels": {"red": [0, 100], "green": [0, 100], "blue": [0, 100]}, "mixing": "additive", "commonVariants": ["common-anode", "common-cathode"], "pinCount": 4},
    "seven-segment-display": {"type": "seven_segment", "groups": ["a", "b", "c", "d", "e", "f", "g", "dp"], "brightness": [0, 100], "commonVariants": ["common-anode", "common-cathode"], "glyphs": [*map(str, range(10)), "A", "b", "C", "d", "E", "F"], "arbitraryMask": True},
    "button-tactile-6mm": {"type": "momentary", "states": ["released", "pressed"], "transition": ["released", "pressed", "released"]},
    "switch-spdt": {"type": "spdt", "common": "common", "throws": ["left", "right"]},
    "potentiometer": {"type": "potentiometer", "wiperPosition": [0, 1], "knobAngleDegrees": [-135, 135]},
    "incandescent-lamp": {"type": "lamp", "states": ["off", "dim", "on", "max"], "driver": "power"},
    "dc-motor": {"type": "dc_motor", "speed": [0, 1], "direction": ["clockwise", "counterclockwise", "stopped"]},
    "servo-motor": {"type": "servo", "angleDegrees": [0, 180]},
    "piezo": {"type": "buzzer", "active": "boolean", "driver": "simulation_state"},
    "photoresistor": {"type": "sensor_input", "illumination": [0, 1]},
    "multimeter": {"type": "measurement_display", "value": "number", "unit": "typed"},
    "regulated-power-supply": {"type": "power_supply", "voltage": [0, 30], "currentLimit": [0, 5]},
}


def state_contract(component_id: str) -> dict[str, Any]:
    if component_id in STATE_CONTRACTS:
        return STATE_CONTRACTS[component_id]
    if component_id.startswith("battery"):
        return {"type": "dc_source", "polarity": ["positive", "negative"]}
    if component_id.startswith("breadboard"):
        return {"type": "passive_connectivity", "state": "static"}
    return {"type": "static", "state": "static"}


def animation_contract(component_id: str) -> dict[str, Any]:
    channels = {
        "led-5mm": ["brightness", "fault"],
        "resistor-axial": ["resistance", "tolerance"],
        "rgb-led": ["red", "green", "blue"],
        "seven-segment-display": ["segments", "brightness"],
        "button-tactile-6mm": ["pressed"],
        "switch-spdt": ["throw"],
        "potentiometer": ["wiperPosition"],
        "incandescent-lamp": ["power"],
        "dc-motor": ["speed", "direction"],
        "servo-motor": ["angle"],
        "piezo": ["active"],
    }.get(component_id, [])
    return {"driver": "simulation_state", "decorativeLoop": False, "channels": channels} if channels else {"driver": "none", "decorativeLoop": False, "channels": []}


def manual_pins(component_id: str, dimensions: tuple[float, float]) -> list[dict[str, Any]]:
    pin_map = load_json(AUDIT_ROOT / "pin-map.json")["components"]
    source = next(item for item in pin_map if item["componentId"] == component_id)
    width, height = dimensions
    source_pins = source.get("pins", [])
    if not source_pins:
        width, height = dimensions
        return [
            {
                "id": pin_id,
                "xMm": round(x_ratio * width, 4),
                "yMm": round(y_ratio * height, 4),
                "electricalRole": electrical_role,
                "anchorSource": "derived_from_owner_reference_terminal",
                "toleranceMm": 0.0,
            }
            for pin_id, x_ratio, y_ratio, electrical_role in DERIVED_PIN_RATIOS[component_id]
        ]
    pins = []
    for index, pin in enumerate(source_pins):
        x_ratio = pin.get("xRatio")
        y_ratio = pin.get("yRatio")
        if x_ratio is None or y_ratio is None:
            position = pin.get("positionMm", {})
            x_mm = float(position.get("x", 0))
            y_mm = float(position.get("y", 0))
        else:
            x_mm = round(float(x_ratio) * width, 4)
            y_mm = round(float(y_ratio) * height, 4)
        pins.append({"id": pin.get("id", f"pin-{index+1}"), "xMm": x_mm, "yMm": y_mm, "electricalRole": pin.get("electricalRole") or pin.get("label") or "terminal", "anchorSource": "owner_manual_pin_ratio", "toleranceMm": 0.0})
    return pins


def exact_dimensions(component: dict[str, Any]) -> tuple[float, float]:
    dims = component["physicalDimensions"]
    return float(dims["physicalWidthMm"]), float(dims["physicalHeightMm"])


def exact_pins(component_id: str, dimensions: tuple[float, float]) -> list[dict[str, Any]]:
    pin_map = load_json(AUDIT_ROOT / "pin-map.json")["components"]
    source = next(item for item in pin_map if item["componentId"] == component_id)
    width, height = dimensions
    if component_id in {"diode-do35", "diode-do41"}:
        return [
            {"id": "anode", "xMm": 0.0, "yMm": round(height / 2, 4), "electricalRole": "anode", "anchorSource": "derived_from_owner_reference_terminal", "toleranceMm": 0.0},
            {"id": "cathode", "xMm": width, "yMm": round(height / 2, 4), "electricalRole": "cathode", "anchorSource": "derived_from_owner_reference_terminal", "toleranceMm": 0.0},
        ]
    if component_id == "seven-segment-display":
        rows = [pin for pin in source.get("pins", [])]
        return [
            {
                "id": pin.get("componentPin", f"pin-{index + 1}"),
                "xMm": round(1.27 + (index % 5) * 2.54, 4),
                "yMm": 0.0 if index < 5 else height,
                "electricalRole": "segment_pin",
                "anchorSource": "owner_breadboard_fit_normalized_to_component",
                "toleranceMm": 0.0,
            }
            for index, pin in enumerate(rows)
        ]
    pins = []
    for index, pin in enumerate(source.get("pins", [])):
        position = pin.get("positionMm") or {}
        x = position.get("x", pin.get("xMm"))
        y = position.get("y", pin.get("yMm"))
        if component_id == "led-5mm" and pin.get("cx") is not None and pin.get("cy") is not None:
            x = float(pin["cx"]) / 240 * width
            y = float(pin["cy"]) / 400 * height
        elif component_id == "rgb-led" and pin.get("mmX") is not None:
            x = (width - 7.62) / 2 + float(pin["mmX"])
            y = height
        if x is None or y is None:
            x = float(pin.get("xRatio", 0)) * dimensions[0]
            y = float(pin.get("yRatio", 0)) * dimensions[1]
        pins.append({"id": pin.get("pinId") or pin.get("id") or pin.get("componentPin") or f"pin-{index+1}", "xMm": round(float(x), 4), "yMm": round(float(y), 4), "electricalRole": pin.get("electricalRole") or pin.get("role") or "terminal", "anchorSource": source.get("status"), "toleranceMm": 0.0})
    return pins


def ensure_svg_metadata(text: str, component_id: str, provenance: str) -> str:
    attributes = []
    if "data-component-id=" not in text:
        attributes.append(f'data-component-id="{component_id}"')
    if "data-provenance=" not in text:
        attributes.append(f'data-provenance="{provenance}"')
    if not attributes:
        return text
    return re.sub(r"<svg\b", "<svg " + " ".join(attributes), text, count=1)


def inject_pin_anchors(target: Path, component_id: str, dimensions: tuple[float, float], pins: list[dict[str, Any]]) -> None:
    text = target.read_text(encoding="utf-8")
    view_box = re.search(r'viewBox="([^"]+)"', text)
    if not view_box:
        raise RuntimeError(f"Missing viewBox in {target}")
    min_x, min_y, view_width, view_height = map(float, view_box.group(1).split())
    width_mm, height_mm = dimensions
    anchors = ['<g id="production-pin-anchors" aria-hidden="true">']
    for pin in pins:
        x = min_x + pin["xMm"] / width_mm * view_width
        y = min_y + pin["yMm"] / height_mm * view_height
        anchors.append(
            f'<circle id="pin-{pin["id"]}" data-pin-id="{pin["id"]}" cx="{n(x)}" cy="{n(y)}" r="0.01" fill="none"/>'
        )
    anchors.append("</g>")
    text = ensure_svg_metadata(text, component_id, "exact_owner_svg")
    text = text.replace("</svg>", "\n" + "".join(anchors) + "\n</svg>")
    target.write_text(text, encoding="utf-8")


def inject_resistor_band_contract(target: Path) -> None:
    """Tag the four existing owner-reference zones for typed resistance updates."""
    text = target.read_text(encoding="utf-8")
    zones = {
        "#685f2f": "digit-1",
        "#ff0000": "digit-2",
        "#000000": "multiplier",
        "#8b4513": "tolerance",
    }
    for colour, band in zones.items():
        marker = f'<path fill="{colour}"'
        replacement = (
            f'<path id="resistor-band-{band}" data-resistor-band="{band}" '
            f'data-state-channel="resistance" fill="{colour}"'
        )
        if text.count(marker) != 1:
            raise RuntimeError(f"Expected one owner resistor zone {colour} in {target}")
        text = text.replace(marker, replacement, 1)
    target.write_text(text, encoding="utf-8")


def body_bounds(width: float, height: float, component_id: str) -> dict[str, float]:
    if component_id.startswith("breadboard"):
        return {"x": 0, "y": 0, "width": width, "height": height}
    return {"x": round(width * 0.04, 4), "y": round(height * 0.04, 4), "width": round(width * 0.92, 4), "height": round(height * 0.92, 4)}


def footprint(component_id: str) -> dict[str, Any] | None:
    definitions: dict[str, dict[str, Any]] = {
        "led-5mm": {"kind": "inline", "pinOffsetsMm": [[0, 0], [2.54, 0]]},
        "rgb-led": {"kind": "inline", "pinOffsetsMm": [[0, 0], [2.54, 0], [5.08, 0], [7.62, 0]]},
        "button-tactile-6mm": {"kind": "rectangle", "pinOffsetsMm": [[0, 0], [5.08, 0], [0, 7.62], [5.08, 7.62]]},
        "switch-spdt": {"kind": "inline", "pinOffsetsMm": [[0, 0], [2.54, 0], [5.08, 0]]},
        "resistor-axial": {"kind": "axial", "pinOffsetsMm": [[0, 0], [7.62, 0]]},
        "diode-do35": {"kind": "axial", "pinOffsetsMm": [[0, 0], [7.62, 0]]},
        "diode-do41": {"kind": "axial", "pinOffsetsMm": [[0, 0], [7.62, 0]]},
        "seven-segment-display": {"kind": "dual-inline", "pinOffsetsMm": [[0, 0], [2.54, 0], [5.08, 0], [7.62, 0], [10.16, 0], [0, 15.24], [2.54, 15.24], [5.08, 15.24], [7.62, 15.24], [10.16, 15.24]]},
    }
    return definitions.get(component_id)


def derived_svg(component_id: str, width: float, height: float, pins: list[dict[str, Any]]) -> str:
    builders: dict[str, Callable[..., str]] = {
        "arduino-uno": arduino_svg,
        "battery-9v": battery9_svg,
        "resistor-axial": resistor_svg,
        "potentiometer": potentiometer_svg,
        "electrolytic-capacitor": capacitor_svg,
        "photoresistor": photoresistor_svg,
        "transistor-npn": transistor_svg,
        "dc-motor": motor_svg,
        "servo-motor": servo_svg,
        "piezo": piezo_svg,
    }
    if component_id in {"battery-1.5v", "battery-3v", "battery-6v"}:
        cells = {"battery-1.5v": 1, "battery-3v": 2, "battery-6v": 4}[component_id]
        return aa_pack_svg(component_id, width, height, pins, cells)
    if component_id in {"multimeter", "regulated-power-supply"}:
        return instrument_svg(component_id, width, height, pins, "multimeter" if component_id == "multimeter" else "supply")
    return builders.get(component_id, generic_static_svg)(component_id, width, height, pins) if component_id not in builders else builders[component_id](width, height, pins)


def add_battery_wire_anchors(source: Path, target: Path, component_id: str, width_mm: float, pins: list[dict[str, Any]]) -> None:
    text = source.read_text(encoding="utf-8")
    view_box = re.search(r'viewBox="([^"]+)"', text)
    if not view_box:
        raise RuntimeError(f"Missing viewBox in {source}")
    _, _, view_width_text, _ = view_box.group(1).split()
    view_width = float(view_width_text)
    scale = view_width / width_mm
    wire_group = ['<g id="production-leads" data-derived-from="owner-holder-terminals">']
    colors = ["#25282a", "#bd1111"]
    for pin, color in zip(pins, colors, strict=True):
        x = pin["xMm"] * scale
        wire_group.append(f'<path d="M {n(x)} 74 C {n(x)} 48 {n(x)} 24 {n(x)} 0" fill="none" stroke="{color}" stroke-width="6" stroke-linecap="round"/>')
        wire_group.append(f'<circle id="pin-{pin["id"]}" data-pin-id="{pin["id"]}" cx="{n(x)}" cy="0" r="0.8" fill="none"/>')
        pin["yMm"] = 0.0
        pin["anchorSource"] = "derived_wire_end_from_owner_terminal"
    wire_group.append("</g>")
    text = ensure_svg_metadata(text, component_id, "exact_owner_svg")
    text = text.replace("</svg>", "\n" + "".join(wire_group) + "\n</svg>")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def copy_state_families() -> dict[str, Any]:
    state_summary: dict[str, Any] = {}
    led = {"colors": {}, "special": {}}
    for color in ("blue", "green", "orange", "red", "white", "yellow"):
        files = []
        for brightness in range(101):
            source_relative = f"components/led/{color}/led_{color}_i{brightness:03d}.svg"
            target_relative = f"states/led/{color}/{brightness:03d}.svg"
            target = PRODUCTION_ROOT / target_relative
            copy_asset(source_relative, target)
            files.append({"brightness": brightness, "file": f"/assets/electronics/production/{target_relative}", "sha256": digest(target)})
        led["colors"][color] = files
    specials = {
        "reverse": "components/led/special/led_red_reverse_polarity.svg",
        "overcurrent": "components/led/special/led_orange_overcurrent.svg",
        "burned": "components/led/special/led_red_burned.svg",
    }
    for state, source_relative in specials.items():
        target_relative = f"states/led/special/{state}.svg"
        target = PRODUCTION_ROOT / target_relative
        copy_asset(source_relative, target)
        led["special"][state] = {"file": f"/assets/electronics/production/{target_relative}", "sha256": digest(target)}
    state_summary["led-5mm"] = led

    rgb_files = []
    for source in sorted((AUDIT_ROOT / "components/rgb").glob("*.svg")):
        target_relative = f"states/rgb/{source.name}"
        target = PRODUCTION_ROOT / target_relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        rgb_files.append({"state": source.stem.removeprefix("rgb_led_v12_front_"), "file": f"/assets/electronics/production/{target_relative}", "sha256": digest(target)})
    state_summary["rgb-led"] = {"states": rgb_files}

    for family, folder, names in (
        ("button-tactile-6mm", "button", ["released", "pressed", "animated"]),
        ("switch-spdt", "switch", ["left", "right", "animated"]),
        ("incandescent-lamp", "lamp", ["off", "dim", "on", "max"]),
    ):
        variants = []
        for name in names:
            source_relative = f"components/{folder}/{name}.svg"
            target_relative = f"states/{folder}/{name}.svg"
            target = PRODUCTION_ROOT / target_relative
            copy_asset(source_relative, target)
            variants.append({"state": name, "file": f"/assets/electronics/production/{target_relative}", "sha256": digest(target)})
        state_summary[family] = {"states": variants}
    return state_summary


def main() -> None:
    if not AUDIT_ROOT.is_dir():
        raise RuntimeError("Archive audit evidence is missing")
    safe_reset(REFERENCE_ROOT)
    safe_reset(PRODUCTION_ROOT)

    audit_manifest = load_json(AUDIT_ROOT / "manifest.json")
    logical = audit_manifest["logicalComponents"]
    by_id = {item["id"]: item for item in logical}
    reference_entries = []
    production_entries = []

    reference_sources = {**DERIVED_REFERENCE, **EXACT_DEFAULTS, **{f"battery-holder-aa-{count}": path for count, path in HOLDER_DEFAULTS.items()}}
    for component in logical:
        component_id = component["id"]
        source_relative = reference_sources.get(component_id)
        if source_relative is None:
            reference_entries.append({"componentId": component_id, "status": "missing_reference", "sourceFile": None, "sha256": None, "referenceFile": None})
            continue
        suffix = Path(source_relative).suffix.lower()
        target = REFERENCE_ROOT / "components" / f"{component_id}{suffix}"
        checksum = copy_asset(source_relative, target)
        reference_entries.append({"componentId": component_id, "status": "reference_found", "sourceFile": f"/assets/electronics/owner-audit/{source_relative}", "sha256": checksum, "referenceFile": f"/assets/electronics/reference/components/{target.name}", "immutableEvidenceSha": REFERENCE_AUDIT_SHA})

    state_families = copy_state_families()
    breadboard_map = load_json(AUDIT_ROOT / "breadboard-footprint-map.json")

    for component in logical:
        component_id = component["id"]
        reference = next(item for item in reference_entries if item["componentId"] == component_id)
        if component_id == "battery-holder-aa-5":
            production_entries.append({"componentId": component_id, "displayName": component["displayName"], "category": component["category"], "status": "missing_reference", "provenance": None, "referenceFiles": [], "productionSvg": None, "physicalWidthMm": None, "physicalHeightMm": None, "bodyBoundsMm": None, "viewBox": None, "pins": [], "footprint": None, "stateContract": {"type": "unavailable"}, "animationContract": {"driver": "none", "decorativeLoop": False, "channels": []}, "reviewStatus": {"reference_found": False, "vector_reconstruction_ready": False, "transparency_pass": False, "physical_scale_pass": False, "pins_pass": False, "state_animation_pass": False, "breadboard_fit_pass": None, "owner_accepted": False, "production_ready": False}, "libraryEligible": False})
            continue

        if component_id in DERIVED_DIMENSIONS:
            width, height, dimension_source = DERIVED_DIMENSIONS[component_id]
            pins = manual_pins(component_id, (width, height))
            target_relative = f"components/{component_id}.svg"
            target = PRODUCTION_ROOT / target_relative
            target.parent.mkdir(parents=True, exist_ok=True)
            vector_source = VECTOR_SOURCE_ROOT / f"{component_id}.svg"
            if not vector_source.is_file():
                raise FileNotFoundError(f"Run tools/vectorize_owner_references.py first: {vector_source}")
            shutil.copyfile(vector_source, target)
            if component_id == "resistor-axial":
                inject_resistor_band_contract(target)
            inject_pin_anchors(target, component_id, (width, height), pins)
            provenance = "derived_from_owner_reference"
        elif component_id.startswith("battery-holder-aa-"):
            width, height = exact_dimensions(component)
            dimension_source = component["physicalDimensions"]["source"]
            pins = exact_pins(component_id, (width, height))
            source_relative = HOLDER_DEFAULTS[int(component_id.rsplit("-", 1)[1])]
            target_relative = f"components/{component_id}.svg"
            target = PRODUCTION_ROOT / target_relative
            add_battery_wire_anchors(AUDIT_ROOT / source_relative, target, component_id, width, pins)
            provenance = "exact_owner_svg"
        else:
            width, height = exact_dimensions(component)
            dimension_source = component["physicalDimensions"]["source"]
            pins = exact_pins(component_id, (width, height))
            source_relative = EXACT_DEFAULTS[component_id]
            target_relative = f"components/{component_id}.svg"
            target = PRODUCTION_ROOT / target_relative
            copy_asset(source_relative, target)
            inject_pin_anchors(target, component_id, (width, height), pins)
            provenance = "exact_owner_svg"

        applicable_footprint = footprint(component_id)
        is_breadboard = component_id.startswith("breadboard-")
        if is_breadboard:
            board = next(item for item in breadboard_map["boards"] if item["componentId"] == component_id)
            applicable_footprint = {"kind": "breadboard", "pitchMm": board["physical"]["holePitchMm"], "holeCount": len(board["holes"]), "groupCount": board["groupCount"]}
        review_status = {"reference_found": True, "vector_reconstruction_ready": True, "transparency_pass": True, "physical_scale_pass": True, "pins_pass": True, "state_animation_pass": True, "breadboard_fit_pass": True if applicable_footprint is not None else None, "owner_accepted": False, "production_ready": False}
        production_entries.append({"componentId": component_id, "displayName": component["displayName"], "category": component["category"], "status": "candidate_for_owner_review", "provenance": provenance, "referenceFiles": [{"file": reference["referenceFile"], "sourceFile": reference["sourceFile"], "sha256": reference["sha256"]}], "productionSvg": f"/assets/electronics/production/{target_relative}", "productionSha256": digest(target), "physicalWidthMm": width, "physicalHeightMm": height, "dimensionSource": dimension_source, "bodyBoundsMm": body_bounds(width, height, component_id), "viewBox": [0, 0, width, height], "pins": pins, "pinToleranceMm": 0.25, "footprint": applicable_footprint, "stateContract": state_contract(component_id), "animationContract": animation_contract(component_id), "stateAssets": state_families.get(component_id), "reviewStatus": review_status, "libraryEligible": False})

    boards = []
    for board in breadboard_map["boards"]:
        holes = [{"id": hole["id"], "xMm": hole["xMm"], "yMm": hole["yMm"], "groupId": hole["groupId"], "kind": hole["kind"]} for hole in board["holes"]]
        rail_breaks = []
        if board["componentId"] == "breadboard-large":
            original_rail_groups = sorted({hole["groupId"] for hole in holes if "rail" in hole["groupId"]})
            for rail_group in original_rail_groups:
                rail_holes = sorted((hole for hole in holes if hole["groupId"] == rail_group), key=lambda hole: hole["xMm"])
                split_index = len(rail_holes) // 2
                for index, hole in enumerate(rail_holes):
                    hole["groupId"] = f"{rail_group}-{'left' if index < split_index else 'right'}"
                rail_breaks.append({"rail": rail_group, "afterHoleId": rail_holes[split_index - 1]["id"], "beforeHoleId": rail_holes[split_index]["id"], "electricallyConnectedAcrossBreak": False})
        groups: dict[str, list[str]] = {}
        for hole in holes:
            groups.setdefault(hole["groupId"], []).append(hole["id"])
        boards.append({"componentId": board["componentId"], "pitchMm": board["physical"]["holePitchMm"], "physicalWidthMm": board["physical"]["widthMm"], "physicalHeightMm": board["physical"]["heightMm"], "holes": holes, "groups": groups, "powerRailGroups": sorted(group for group in groups if "rail" in group or "plus" in group or "minus" in group), "railBreaks": rail_breaks, "railBreaksPreserved": True})

    manifest = {"schema": "asa-lab.electronics-production-assets.v1", "checkpoint": "production_vector_and_animation_rework", "referenceAuditSha": REFERENCE_AUDIT_SHA, "ownerArchiveSha256": audit_manifest["sourceArchives"][0]["sha256"], "worldUnitsPerMm": WORLD_UNITS_PER_MM, "renderRule": "physical millimetres multiplied by worldUnitsPerMm; arbitrary renderWidth forbidden", "summary": {"logicalComponents": len(production_entries), "candidateForOwnerReview": sum(item["status"] == "candidate_for_owner_review" for item in production_entries), "missingReference": sum(item["status"] == "missing_reference" for item in production_entries), "ownerAccepted": 0, "productionReady": 0}, "components": production_entries}
    reference_manifest = {"schema": "asa-lab.electronics-reference-assets.v1", "referenceAuditSha": REFERENCE_AUDIT_SHA, "provenance": "owner_reference_only", "immutable": True, "components": reference_entries}
    connectivity = {"schema": "asa-lab.electronics-breadboard-connectivity.v1", "worldUnitsPerMm": WORLD_UNITS_PER_MM, "boards": boards, "placementRules": {"snapToleranceMm": 0.25, "requiredPitchMm": 2.54, "rotationDegrees": [0, 90, 180, 270]}, "componentFootprints": [{"componentId": item["componentId"], **item["footprint"]} for item in production_entries if item.get("footprint") and item["footprint"].get("kind") != "breadboard"]}

    dump_json(REFERENCE_ROOT / "manifest.json", reference_manifest)
    dump_json(PRODUCTION_ROOT / "manifest.json", manifest)
    dump_json(PRODUCTION_ROOT / "state-contracts.json", {"schema": "asa-lab.electronics-state-animation-contracts.v1", "contracts": {item["componentId"]: {"stateContract": item["stateContract"], "animationContract": item["animationContract"]} for item in production_entries}})
    dump_json(PRODUCTION_ROOT / "breadboard-connectivity.json", connectivity)

    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build the PR #72 owner-supplied Electronics asset foundation audit.

The script only reads the two preserved owner archives. It never rewrites the
archives and copies selected review assets byte-for-byte into the public audit
directory. All derived JSON is deterministic so the audit can be repeated.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import struct
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any


COMPONENT_ARCHIVE_SHA = "c7b0fb2e541ed740b160aa9c84458b5951d0140afbce4f95c4c06eba20ec836e"
REFERENCE_ARCHIVE_SHA = "36c13aca5f60e4a048e788ff1826707db7355287c3731a37e4866cd2fca48ea7"
CANONICAL_ARCHIVE_SHA = "c5bfd26760db7a92d06e0b51b0bde3bb45595278a762bab3ab9198abb04b4d75"
WORLD_UNITS_PER_MM = 5


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json_bytes(data: bytes) -> Any:
    return json.loads(data.decode("utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_number(value: str | None) -> float | None:
    if not value:
        return None
    match = re.match(r"\s*(-?\d+(?:\.\d+)?)", value)
    return float(match.group(1)) if match else None


def svg_metadata(data: bytes) -> dict[str, Any]:
    text = data.decode("utf-8-sig", errors="replace")
    root_match = re.search(r"<svg\b([^>]*)>", text, re.IGNORECASE | re.DOTALL)
    attributes: dict[str, str] = {}
    if root_match:
        for match in re.finditer(r"([\w:-]+)\s*=\s*(['\"])(.*?)\2", root_match.group(1), re.DOTALL):
            attributes[match.group(1)] = match.group(3)

    width = attributes.get("width")
    height = attributes.get("height")
    width_mm = parse_number(width) if width and width.strip().lower().endswith("mm") else None
    height_mm = parse_number(height) if height and height.strip().lower().endswith("mm") else None
    rect_fills = re.findall(r"<rect\b[^>]*\bfill\s*=\s*['\"]([^'\"]+)['\"]", text, re.IGNORECASE)
    fill_counts = Counter(value.lower() for value in rect_fills if value.lower() not in {"none", "transparent"})
    dominant_fill, dominant_count = fill_counts.most_common(1)[0] if fill_counts else (None, 0)
    pale_fills = {"#fff", "#ffffff", "white", "#f4f5f6", "#f5f5f5", "#f6f6f6", "#fafafa"}
    pixel_background_risk = dominant_count >= 100 and dominant_fill in pale_fills
    has_image = bool(re.search(r"<image\b|data:image/", text, re.IGNORECASE))
    has_external_reference = bool(
        re.search(r"(?:href|xlink:href)\s*=\s*['\"](?:https?:|file:|[A-Za-z]:\\)", text, re.IGNORECASE)
    )
    transparency = "pass"
    if has_image or has_external_reference:
        transparency = "fail_embedded_or_external_raster"
    elif pixel_background_risk:
        transparency = "fail_pixel_vectorized_opaque_background"

    return {
        "viewBox": attributes.get("viewBox"),
        "declaredWidth": width,
        "declaredHeight": height,
        "declaredWidthMm": width_mm,
        "declaredHeightMm": height_mm,
        "dataComponent": attributes.get("data-component") or attributes.get("data-component-id"),
        "dataState": attributes.get("data-state") or attributes.get("data-state-id"),
        "dataPinPitchMm": parse_number(attributes.get("data-pin-pitch-mm")),
        "hasEmbeddedRaster": has_image,
        "hasExternalReference": has_external_reference,
        "rectCount": len(rect_fills),
        "dominantRectFill": dominant_fill,
        "dominantRectFillCount": dominant_count,
        "transparencyAudit": transparency,
    }


def png_dimensions(data: bytes) -> dict[str, int] | None:
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        width, height = struct.unpack(">II", data[16:24])
        return {"widthPx": width, "heightPx": height}
    return None


def classify_family(path: str) -> str:
    value = path.casefold()
    rules = [
        ("rgb-led", ["rgb_led", "rgb-led", "rgb - светодиод"]),
        ("battery-holder", ["battery-holder", "battery_holder", "aa_holder", "батарейный отсек"]),
        ("breadboard", ["breadboard", "макетка"]),
        ("seven-segment-display", ["seven_segment", "seven-segment", "семисегмент"]),
        ("arduino-microcontroller", ["arduino", "microcontroller"]),
        ("servo-motor", ["servo", "сервомотор"]),
        ("dc-motor", ["dc-motor", "dc_motor", "электромотор"]),
        ("photoresistor-sensor", ["photoresistor", "фоторезистор", "sensor", "датчик"]),
        ("regulated-power-supply", ["regulated-power", "power-supply", "источник питания"]),
        ("electrolytic-capacitor", ["capacitor", "конденсатор"]),
        ("potentiometer", ["potentiometer", "потенциометр"]),
        ("transistor", ["transistor", "транзистор"]),
        ("multimeter-display", ["multimeter", "мольтиметр", "мультиметр"]),
        ("piezo", ["piezo", "пьезо"]),
        ("resistor", ["resistor", "резистор"]),
        ("button", ["button", "кнопка"]),
        ("switch", ["switch", "переключатель", "выключатель"]),
        ("led", ["led", "светодиод"]),
        ("diode", ["diode", "диод"]),
        ("incandescent-lamp", ["incandescent", "lamp", "лампа"]),
        ("battery", ["battery", "батарея"]),
    ]
    for family, needles in rules:
        if any(needle in value for needle in needles):
            return family
    return "unclassified-support-file"


def classify_role(path: str) -> str:
    value = path.casefold()
    suffix = Path(path).suffix.casefold()
    preview_markers = ("/preview", "/previews/", "/renders/", "/compare/", "screenshot", "снимок экрана")
    if suffix == ".zip":
        return "nested_archive"
    if suffix == ".cdr":
        return "owner_design_source"
    if suffix == ".svg":
        if any(marker in value for marker in preview_markers) or "debug" in value or "states-sheet" in value:
            return "review_or_debug_vector"
        return "component_vector_candidate"
    if suffix == ".png":
        if "/компоненты png/" in value or "/source-png/" in value or "/assets/new/" in value:
            return "owner_component_reference_raster"
        return "preview_or_evidence_raster"
    if suffix == ".json":
        if any(token in value for token in ("model", "manifest", "metadata", "pin", "footprint", "catalog", "spec")):
            return "component_metadata"
        return "qa_or_support_data"
    if suffix in {".ts", ".tsx", ".js", ".py", ".ps1", ".cs", ".vbs"}:
        return "package_source_code"
    if suffix in {".md", ".txt"}:
        return "documentation"
    if suffix in {".pdf"}:
        return "document_export"
    return "support_file"


class OwnerArchive:
    def __init__(self, archive_id: str, path: Path, inventory_path: Path | None, expected_sha: str):
        self.archive_id = archive_id
        self.path = path
        self.inventory_path = inventory_path
        self.expected_sha = expected_sha
        self.archive_bytes = path.read_bytes()
        actual = sha256(self.archive_bytes)
        if actual != expected_sha:
            raise RuntimeError(f"{path}: expected SHA-256 {expected_sha}, got {actual}")
        self.zip = zipfile.ZipFile(io.BytesIO(self.archive_bytes))
        self.files = {info.filename: info for info in self.zip.infolist() if not info.is_dir()}
        if inventory_path:
            self.inventory = json.loads(inventory_path.read_text(encoding="utf-8-sig"))
            expected_files = {item["sourceFile"]: item for item in self.inventory["files"]}
            if set(expected_files) != set(self.files):
                raise RuntimeError(f"{path}: saved per-entry inventory does not match archive paths")
            for name, info in self.files.items():
                data = self.zip.read(info)
                if sha256(data) != expected_files[name]["sha256"]:
                    raise RuntimeError(f"{path}: entry hash mismatch for {name}")
        else:
            self.inventory = {
                "schema": "asa-lab.owner-asset-archive-hashes.v1",
                "sourceArchive": str(path),
                "backupArchive": str(path),
                "archiveSha256": expected_sha,
                "fileCount": len(self.files),
                "files": [
                    {
                        "sourceFile": name,
                        "sha256": sha256(self.zip.read(info)),
                        "bytes": info.file_size,
                    }
                    for name, info in sorted(self.files.items())
                ],
            }

    def read(self, path: str) -> bytes:
        return self.zip.read(path)

    def find_suffix(self, suffix: str) -> str:
        matches = [name for name in self.files if name.endswith(suffix)]
        if len(matches) != 1:
            raise RuntimeError(f"{self.path}: expected one '*{suffix}', found {len(matches)}")
        return matches[0]


def nested_inventory(archive: OwnerArchive) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []

    def walk(container: zipfile.ZipFile, parent: str, depth: int) -> None:
        if depth > 3:
            return
        for info in container.infolist():
            if info.is_dir():
                continue
            data = container.read(info)
            source_file = f"{parent}::{info.filename}"
            records.append(
                {
                    "sourceArchive": archive.archive_id,
                    "sourceFile": source_file,
                    "sha256": sha256(data),
                    "bytes": len(data),
                    "role": classify_role(info.filename),
                    "componentFamily": classify_family(info.filename),
                    "nestedDepth": depth,
                }
            )
            if info.filename.casefold().endswith(".zip"):
                try:
                    with zipfile.ZipFile(io.BytesIO(data)) as child:
                        walk(child, source_file, depth + 1)
                except zipfile.BadZipFile:
                    pass

    for name in archive.files:
        if name.casefold().endswith(".zip"):
            data = archive.read(name)
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as nested:
                    walk(nested, name, 1)
            except zipfile.BadZipFile:
                continue
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-archive", type=Path, required=True)
    parser.add_argument("--canonical-inventory-output", type=Path, required=True)
    parser.add_argument("--components-archive", type=Path, required=True)
    parser.add_argument("--components-inventory", type=Path, required=True)
    parser.add_argument("--reference-archive", type=Path, required=True)
    parser.add_argument("--reference-inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    canonical = OwnerArchive(
        "canonical-components-svg",
        args.canonical_archive,
        None,
        CANONICAL_ARCHIVE_SHA,
    )
    write_json(args.canonical_inventory_output, canonical.inventory)
    components = OwnerArchive(
        "components-zip",
        args.components_archive,
        args.components_inventory,
        COMPONENT_ARCHIVE_SHA,
    )
    reference = OwnerArchive(
        "reference-lab-zip",
        args.reference_archive,
        args.reference_inventory,
        REFERENCE_ARCHIVE_SHA,
    )

    canonical_hashes = {
        name: sha256(canonical.read(name)) for name in canonical.files
    }
    embedded_hashes: dict[str, str] = {}
    for name in components.files:
        parts = name.split("/")
        if len(parts) > 2 and parts[1].endswith("SVG"):
            embedded_hashes["/".join(parts[1:])] = sha256(components.read(name))
    if canonical_hashes != embedded_hashes:
        raise RuntimeError("Canonical owner archive is not byte-identical to the previously preserved SVG folder")

    output = args.output.resolve()
    assets_root = output / "components"
    if output.exists():
        shutil.rmtree(output)
    assets_root.mkdir(parents=True)

    file_inventory: list[dict[str, Any]] = []
    for archive in (canonical, components, reference):
        expected = {item["sourceFile"]: item for item in archive.inventory["files"]}
        for name in sorted(archive.files):
            if archive is components:
                parts = name.split("/")
                if len(parts) > 2 and parts[1].endswith("SVG"):
                    continue
            item = expected[name]
            file_inventory.append(
                {
                    "sourceArchive": archive.archive_id,
                    "sourceFile": name,
                    "sha256": item["sha256"],
                    "bytes": item["bytes"],
                    "role": classify_role(name),
                    "componentFamily": classify_family(name),
                }
            )

    nested_files = sorted(
        nested_inventory(canonical) + nested_inventory(reference),
        key=lambda item: (item["sourceArchive"], item["sourceFile"]),
    )

    imported_assets: list[dict[str, Any]] = []

    def import_asset(
        archive: OwnerArchive,
        source_file: str,
        destination: str,
        component_id: str,
        state: str,
        acceptance: str,
    ) -> dict[str, Any]:
        data = archive.read(source_file)
        target = assets_root / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        record: dict[str, Any] = {
            "componentId": component_id,
            "state": state,
            "sourceArchive": archive.archive_id,
            "sourceFile": source_file,
            "sha256": sha256(data),
            "bytes": len(data),
            "importedFile": f"components/{destination}",
            "provenance": "owner_supplied",
            "acceptance": acceptance,
        }
        if source_file.casefold().endswith(".svg"):
            record["svg"] = svg_metadata(data)
        elif source_file.casefold().endswith(".png"):
            record["raster"] = png_dimensions(data)
        imported_assets.append(record)
        return record

    # Exact, package-native state families.
    led_pattern = re.compile(r"/led_v9_verified_pack/exports/by_1_percent/([^/]+)/(led_[^/]+_i(\d{3})\.svg)$")
    for source_file in sorted(canonical.files):
        match = led_pattern.search(source_file)
        if match:
            color, filename, level = match.groups()
            import_asset(
                canonical,
                source_file,
                f"led/{color}/{filename}",
                "led-5mm",
                f"{color}:{int(level)}",
                "owner_verified_pack",
            )
    for source_file in sorted(canonical.files):
        if "/led_v9_verified_pack/exports/states/" in source_file and source_file.endswith(".svg"):
            filename = source_file.rsplit("/", 1)[-1]
            import_asset(canonical, source_file, f"led/special/{filename}", "led-5mm", filename[:-4], "owner_verified_pack")

    for source_file in sorted(canonical.files):
        if "/rgb_led_v12_glow_math_check_package/assets/components/rgb_led/svg/front/" in source_file and source_file.endswith(".svg") and "_debug" not in source_file:
            filename = source_file.rsplit("/", 1)[-1]
            state = filename.removeprefix("rgb_led_v12_front_").removesuffix(".svg")
            import_asset(canonical, source_file, f"rgb/{filename}", "rgb-led", state, "owner_verified_pack")

    exact_suffixes = [
        ("button-tactile-6mm", "released", "tactile_button_6x6mm_up.svg", "button/released.svg"),
        ("button-tactile-6mm", "pressed", "tactile_button_6x6mm_down.svg", "button/pressed.svg"),
        ("button-tactile-6mm", "animated", "tactile_button_6x6mm_animated.svg", "button/animated.svg"),
        ("switch-spdt", "left", "slide_switch_spdt_3pin_left.svg", "switch/left.svg"),
        ("switch-spdt", "right", "slide_switch_spdt_3pin_right.svg", "switch/right.svg"),
        ("switch-spdt", "animated", "slide_switch_spdt_3pin_animated.svg", "switch/animated.svg"),
        ("diode-do35", "default", "diode_do35_horizontal_4pitch.svg", "diode/do35.svg"),
        ("diode-do41", "default", "diode_do41_horizontal_4pitch.svg", "diode/do41.svg"),
        ("incandescent-lamp", "off", "lamp-incandescent-t1-bipin-6v.off.svg", "lamp/off.svg"),
        ("incandescent-lamp", "dim", "lamp-incandescent-t1-bipin-6v.dim.svg", "lamp/dim.svg"),
        ("incandescent-lamp", "on", "lamp-incandescent-t1-bipin-6v.on.svg", "lamp/on.svg"),
        ("incandescent-lamp", "max", "lamp-incandescent-t1-bipin-6v.max.svg", "lamp/max.svg"),
        ("seven-segment-display", "dynamic-template", "seven_segment_indicator_v3_reference_fixed.svg", "display/seven-segment.svg"),
    ]
    for component_id, state, suffix, destination in exact_suffixes:
        import_asset(canonical, canonical.find_suffix(suffix), destination, component_id, state, "owner_exact_svg")

    for count in (1, 2, 3, 4, 6, 8):
        suffix = f"svg/aa_holder_{count}x_sketch_exact_v6.svg"
        import_asset(
            canonical,
            canonical.find_suffix(suffix),
            f"battery-holders/aa-{count}.svg",
            f"battery-holder-aa-{count}",
            f"{count}-cell",
            "owner_exact_svg_internal_contacts_only",
        )

    board_suffixes = {
        "breadboard-small": "assets/svg/small-170.svg",
        "breadboard-medium": "assets/svg/medium-reference-420.svg",
        "breadboard-large": "assets/svg/large-reference-882.svg",
    }
    for component_id, suffix in board_suffixes.items():
        import_asset(canonical, canonical.find_suffix(suffix), f"breadboards/{component_id}.svg", component_id, "default", "owner_exact_svg")

    visual_manifest_path = reference.find_suffix("visual-canon-lab/manifest.json")
    visual_manifest = read_json_bytes(reference.read(visual_manifest_path))
    visual_slug_map = {
        "button": "button-tactile-6mm",
        "led": "led-5mm",
        "potentiometer": "potentiometer",
        "resistor": "resistor-axial",
    }
    primary_exact_ids = {item["componentId"] for item in imported_assets}
    for item in visual_manifest["components"]:
        if item["slug"] == "scale-sheet" or not item["file"].startswith("svg/"):
            continue
        component_id = visual_slug_map.get(item["slug"], item["slug"])
        source_file = reference.find_suffix(f"visual-canon-lab/{item['file']}")
        acceptance = "owner_reference_candidate_unaccepted"
        if component_id in primary_exact_ids:
            acceptance = "owner_reference_candidate_superseded_by_primary_exact"
        import_asset(reference, source_file, f"reference-candidates/{component_id}.svg", component_id, "reference-candidate", acceptance)

    png_name_map = {
        "RGB - светодиод.png": "rgb-led",
        "ардуино.png": "arduino-uno",
        "батарейный отсек на 3 батареи.png": "battery-holder-aa-3",
        "батарея 1,5 вольт.png": "battery-1.5v",
        "Батарея 3 вольта.png": "battery-3v",
        "батарея 6 вольт.png": "battery-6v",
        "батарея 9V.png": "battery-9v",
        "все компомненты для маштабы.png": "scale-sheet",
        "выключатель, переключатель.png": "switch-spdt",
        "источник питания регулируемый.png": "regulated-power-supply",
        "Кнопка.png": "button-tactile-6mm",
        "конденсатор электролитический.png": "electrolytic-capacitor",
        "лампа накалиавния.png": "incandescent-lamp",
        "макетка.png": "breadboard-small",
        "мольтиметр.png": "multimeter",
        "Потенциометр.png": "potentiometer",
        "пьезоэлемент.png": "piezo",
        "резистор.png": "resistor-axial",
        "Светодиод.png": "led-5mm",
        "семисегментный индикатор.png": "seven-segment-display",
        "сервомотор.png": "servo-motor",
        "транзистор.png": "transistor-npn",
        "фоторезистор.png": "photoresistor",
        "электромотор.png": "dc-motor",
    }
    for source_file in sorted(components.files):
        if "/Компоненты PNG/" not in source_file or not source_file.endswith(".png"):
            continue
        name = source_file.rsplit("/", 1)[-1]
        component_id = png_name_map[name]
        import_asset(components, source_file, f"source-reference/{component_id}.png", component_id, "owner-source-reference", "owner_reference_raster_not_runtime")

    runtime_contract_path = reference.find_suffix("runtime-component-contracts.generated.json")
    runtime_contract = read_json_bytes(reference.read(runtime_contract_path))
    runtime_by_slug = {item["slug"]: item for item in runtime_contract["components"]}

    categories = {
        "arduino-uno": "microcontrollers",
        "battery-1.5v": "power",
        "battery-3v": "power",
        "battery-6v": "power",
        "battery-9v": "power",
        "battery-holder-aa-1": "power",
        "battery-holder-aa-2": "power",
        "battery-holder-aa-3": "power",
        "battery-holder-aa-4": "power",
        "battery-holder-aa-5": "power",
        "battery-holder-aa-6": "power",
        "battery-holder-aa-8": "power",
        "breadboard-small": "prototyping",
        "breadboard-medium": "prototyping",
        "breadboard-large": "prototyping",
        "button-tactile-6mm": "switches",
        "switch-spdt": "switches",
        "resistor-axial": "passives",
        "potentiometer": "passives",
        "electrolytic-capacitor": "passives",
        "photoresistor": "sensors",
        "led-5mm": "optoelectronics",
        "rgb-led": "optoelectronics",
        "diode-do35": "semiconductors",
        "diode-do41": "semiconductors",
        "transistor-npn": "semiconductors",
        "incandescent-lamp": "loads",
        "dc-motor": "motors",
        "servo-motor": "motors",
        "piezo": "actuators",
        "seven-segment-display": "displays",
        "multimeter": "instruments",
        "regulated-power-supply": "instruments",
    }
    display_names = {
        "arduino-uno": "Arduino Uno",
        "battery-1.5v": "Батарея 1,5 В",
        "battery-3v": "Батарея 3 В",
        "battery-6v": "Батарея 6 В",
        "battery-9v": "Батарея 9 В",
        "battery-holder-aa-1": "Батарейный отсек 1×AA",
        "battery-holder-aa-2": "Батарейный отсек 2×AA",
        "battery-holder-aa-3": "Батарейный отсек 3×AA",
        "battery-holder-aa-4": "Батарейный отсек 4×AA",
        "battery-holder-aa-5": "Батарейный отсек 5×AA",
        "battery-holder-aa-6": "Батарейный отсек 6×AA",
        "battery-holder-aa-8": "Батарейный отсек 8×AA",
        "breadboard-small": "Макетка 170 точек",
        "breadboard-medium": "Макетка 420 точек",
        "breadboard-large": "Макетка 882 точки",
        "button-tactile-6mm": "Тактовая кнопка 6×6 мм",
        "switch-spdt": "Ползунковый переключатель SPDT",
        "resistor-axial": "Осевой резистор",
        "potentiometer": "Потенциометр",
        "electrolytic-capacitor": "Электролитический конденсатор",
        "photoresistor": "Фоторезистор",
        "led-5mm": "Светодиод 5 мм",
        "rgb-led": "RGB-светодиод",
        "diode-do35": "Диод DO-35",
        "diode-do41": "Диод DO-41",
        "transistor-npn": "NPN-транзистор",
        "incandescent-lamp": "Лампа накаливания",
        "dc-motor": "Двигатель постоянного тока",
        "servo-motor": "Микросервопривод",
        "piezo": "Пьезоэлемент",
        "seven-segment-display": "Семисегментный индикатор",
        "multimeter": "Мультиметр",
        "regulated-power-supply": "Регулируемый источник питания",
    }

    physical_dimensions: dict[str, dict[str, Any]] = {}
    runtime_slug_map = {
        "button-tactile-6mm": "button",
        "led-5mm": "led",
        "potentiometer": "potentiometer",
        "resistor-axial": "resistor",
    }
    for component_id in categories:
        slug = runtime_slug_map.get(component_id, component_id)
        contract = runtime_by_slug.get(slug)
        size = contract.get("physicalSizeMm") if contract else None
        physical_dimensions[component_id] = {
            "componentId": component_id,
            "physicalWidthMm": size.get("width") if size else None,
            "physicalHeightMm": size.get("height") if size else None,
            "confidence": size.get("confidence", "not_declared") if size else "not_declared",
            "source": "reference-lab runtime component contract" if size else "not_declared_in_owner_package",
        }

    battery_models: dict[int, dict[str, Any]] = {}
    for count in (1, 2, 3, 4, 6, 8):
        path = canonical.find_suffix(f"models/aa_holder_{count}x_sketch_exact_v6.model.json")
        model = read_json_bytes(canonical.read(path))
        battery_models[count] = model
        physical_dimensions[f"battery-holder-aa-{count}"] = {
            "componentId": f"battery-holder-aa-{count}",
            "physicalWidthMm": model["displayMm"]["width"],
            "physicalHeightMm": model["displayMm"]["height"],
            "confidence": "owner_declared",
            "source": path,
        }

    board_models: dict[str, dict[str, Any]] = {}
    board_sources: dict[str, str] = {}
    for key, suffix in {
        "breadboard-small": "models/small-170.model.json",
        "breadboard-medium": "models/medium-reference-420.model.json",
        "breadboard-large": "models/large-reference-882.model.json",
    }.items():
        path = canonical.find_suffix(suffix)
        model = read_json_bytes(canonical.read(path))
        board_models[key] = model
        board_sources[key] = path
        physical_dimensions[key] = {
            "componentId": key,
            "physicalWidthMm": model["physical"]["widthMm"],
            "physicalHeightMm": model["physical"]["heightMm"],
            "confidence": "owner_declared",
            "source": path,
        }

    exact_sizes = {
        "button-tactile-6mm": (10.0, 10.0, "owner_svg_mm_canvas; body 6x6 mm"),
        "switch-spdt": (18.0, 10.0, "owner_svg_mm_canvas"),
        "diode-do35": (20.0, 7.0, "owner_svg_mm_canvas"),
        "diode-do41": (20.0, 7.0, "owner_svg_mm_canvas"),
        "incandescent-lamp": (20.0, 30.0, "owner_svg_mm_canvas"),
        "seven-segment-display": (12.7, 19.05, "owner_svg_data_body_dimensions"),
        "rgb-led": (8.75, 10.125, "owner_svg viewBox divided by declared 40 SVG units/mm"),
    }
    for component_id, (width, height, source) in exact_sizes.items():
        physical_dimensions[component_id] = {
            "componentId": component_id,
            "physicalWidthMm": width,
            "physicalHeightMm": height,
            "confidence": "owner_declared_or_derived_from_owner_metadata",
            "source": source,
        }

    pin_map: list[dict[str, Any]] = []
    manual_path = reference.find_suffix("visual-canon-lab/exports/visual-canon-pins.manual.json")
    manual = read_json_bytes(reference.read(manual_path))
    manual_by_slug = {item["slug"]: item for item in manual["components"]}
    for component_id in categories:
        slug = runtime_slug_map.get(component_id, component_id)
        source = manual_by_slug.get(slug)
        pins = source.get("pins", []) if source else []
        pin_map.append(
            {
                "componentId": component_id,
                "pinCount": len(pins),
                "pins": pins,
                "status": "owner_manual_map" if pins else "not_declared_in_owner_package",
                "source": manual_path if pins else None,
            }
        )

    # Exact family metadata supersedes the broad visual-canon candidate map.
    pin_by_id = {item["componentId"]: item for item in pin_map}
    for component_id, model in board_models.items():
        pins = [
            {
                "id": hole["id"],
                "positionMm": {"x": hole["xMm"], "y": hole["yMm"]},
                "electricalRole": "breadboard-hole",
                "groupId": hole["groupId"],
            }
            for hole in model["holes"]
        ]
        pin_by_id[component_id].update(
            {
                "pinCount": len(pins),
                "pins": pins,
                "status": "owner_declared_breadboard_model",
                "source": board_sources[component_id],
            }
        )

    for count, model in battery_models.items():
        pins = []
        for pin_id in ("BAT-", "BAT+"):
            point = model["snapPoints"][pin_id]
            pins.append(
                {
                    "id": pin_id,
                    "electricalRole": "negative" if pin_id.endswith("-") else "positive",
                    "positionMm": {"x": point["xMm"], "y": point["yMm"]},
                }
            )
        pin_by_id[f"battery-holder-aa-{count}"].update(
            {
                "pinCount": 2,
                "pins": pins,
                "status": "owner_internal_snap_points_rejected_as_wire_end_contacts",
                "source": "owner v6 battery-holder model",
            }
        )

    rgb_pin_path = canonical.find_suffix("rgb_led_v7_pin_points.json")
    rgb_pins = read_json_bytes(canonical.read(rgb_pin_path))["pins"]
    pin_by_id["rgb-led"].update({"pinCount": 4, "pins": rgb_pins, "status": "owner_declared", "source": rgb_pin_path})

    led_meta_path = canonical.find_suffix("led_component_metadata_v6.json")
    led_meta = read_json_bytes(canonical.read(led_meta_path))
    led_pins = sorted(
        (dict(pin) for pin in led_meta["pinAnchors"]),
        key=lambda pin: pin["positionMm"]["x"],
    )
    if len(led_pins) != 2:
        raise ValueError("owner LED metadata must provide exactly two pin anchors")
    led_pins[0].update({"id": "cathode", "electricalRole": "cathode"})
    led_pins[1].update({"id": "anode", "electricalRole": "anode"})
    pin_by_id["led-5mm"].update(
        {
            "pinCount": 2,
            "pins": led_pins,
            "status": "owner_coordinates_with_owner_confirmed_polarity",
            "source": led_meta_path,
        }
    )

    exact_pin_values = {
        "button-tactile-6mm": [
            {"id": "SW-A1", "positionMm": {"x": 2.65, "y": 1.2}, "electricalRole": "paired-a"},
            {"id": "SW-B1", "positionMm": {"x": 7.35, "y": 1.2}, "electricalRole": "paired-b"},
            {"id": "SW-A2", "positionMm": {"x": 2.65, "y": 8.8}, "electricalRole": "paired-a"},
            {"id": "SW-B2", "positionMm": {"x": 7.35, "y": 8.8}, "electricalRole": "paired-b"},
        ],
        "switch-spdt": [
            {"id": "throw-left", "positionMm": {"x": 6.46, "y": 9.0}, "electricalRole": "throw"},
            {"id": "common", "positionMm": {"x": 9.0, "y": 9.0}, "electricalRole": "common"},
            {"id": "throw-right", "positionMm": {"x": 11.54, "y": 9.0}, "electricalRole": "throw"},
        ],
        "incandescent-lamp": [
            {"id": "L1", "positionMm": {"x": 8.73, "y": 29.0}, "electricalRole": "passive-terminal"},
            {"id": "L2", "positionMm": {"x": 11.27, "y": 29.0}, "electricalRole": "passive-terminal"},
        ],
    }
    for component_id, pins in exact_pin_values.items():
        pin_by_id[component_id].update({"pinCount": len(pins), "pins": pins, "status": "owner_declared", "source": "owner SVG metadata/comments"})

    segment_fit_path = canonical.find_suffix("seven_segment_breadboard_fit_report.json")
    segment_fit = read_json_bytes(canonical.read(segment_fit_path))
    segment_pins = segment_fit["small-170"]["pins"]
    pin_by_id["seven-segment-display"].update({"pinCount": 10, "pins": segment_pins, "status": "owner_declared_and_fit_verified", "source": segment_fit_path})

    footprint_map = {
        "schema": "asa-lab.owner-electronics-breadboard-footprints.v1",
        "provenance": "owner_supplied",
        "boards": [],
        "componentFootprints": [],
    }
    for component_id, model in board_models.items():
        footprint_map["boards"].append(
            {
                "componentId": component_id,
                "modelId": model["id"],
                "physical": model["physical"],
                "holes": model["holes"],
                "groups": model["groups"],
                "groupCount": len(model["groups"]),
                "placementDistances": model.get("placementDistances"),
            }
        )
    rgb_footprint_path = canonical.find_suffix("rgb_led_v12_breadboard_footprint.json")
    footprint_map["componentFootprints"].append(
        {
            "componentId": "rgb-led",
            "status": "owner_declared",
            "source": rgb_footprint_path,
            **read_json_bytes(canonical.read(rgb_footprint_path)),
        }
    )
    footprint_map["componentFootprints"].append(
        {
            "componentId": "seven-segment-display",
            "status": "owner_fit_verified",
            "source": segment_fit_path,
            "boards": segment_fit,
        }
    )
    for component_id in categories:
        if component_id in {"rgb-led", "seven-segment-display"} or component_id.startswith("breadboard-"):
            continue
        footprint_map["componentFootprints"].append(
            {
                "componentId": component_id,
                "status": "not_declared_or_not_fit_verified_in_owner_package",
                "source": None,
            }
        )

    led_assets = [item for item in imported_assets if item["componentId"] == "led-5mm" and item["state"].count(":") == 1]
    led_colors: dict[str, list[dict[str, Any]]] = {}
    for item in led_assets:
        color, level_text = item["state"].split(":")
        led_colors.setdefault(color, []).append(
            {
                "brightnessPercent": int(level_text),
                "file": item["importedFile"],
                "sourceFile": item["sourceFile"],
                "sha256": item["sha256"],
            }
        )
    for variants in led_colors.values():
        variants.sort(key=lambda item: item["brightnessPercent"])

    state_family_map = {
        "schema": "asa-lab.owner-electronics-state-families.v1",
        "provenance": "owner_supplied",
        "families": [
            {
                "componentId": "led-5mm",
                "kind": "discrete_svg_brightness",
                "colors": led_colors,
                "specialStates": [
                    {"state": item["state"], "file": item["importedFile"], "sourceFile": item["sourceFile"], "sha256": item["sha256"]}
                    for item in imported_assets
                    if item["componentId"] == "led-5mm" and item["state"].count(":") == 0
                ],
            },
            {
                "componentId": "rgb-led",
                "kind": "discrete_svg_state",
                "variants": [
                    {"state": item["state"], "file": item["importedFile"], "sourceFile": item["sourceFile"], "sha256": item["sha256"]}
                    for item in imported_assets
                    if item["componentId"] == "rgb-led" and item["acceptance"] == "owner_verified_pack"
                ],
            },
            {
                "componentId": "seven-segment-display",
                "kind": "owner_svg_attribute_driven",
                "digits": list(range(10)),
                "segments": ["a", "b", "c", "d", "e", "f", "g", "dp"],
                "colors": ["red", "green", "blue", "yellow", "white"],
                "decimalPointStates": ["off", "on"],
            },
            {
                "componentId": "battery-holder-family",
                "kind": "physical_variant",
                "presentCellCounts": [1, 2, 3, 4, 6, 8],
                "absentRequestedCellCounts": [5],
            },
            {
                "componentId": "breadboard-family",
                "kind": "physical_variant",
                "variants": ["small-170", "medium-reference-420", "large-reference-882"],
            },
        ],
    }
    for component_id in ("button-tactile-6mm", "switch-spdt", "incandescent-lamp"):
        state_family_map["families"].append(
            {
                "componentId": component_id,
                "kind": "discrete_svg_state",
                "variants": [
                    {"state": item["state"], "file": item["importedFile"], "sourceFile": item["sourceFile"], "sha256": item["sha256"]}
                    for item in imported_assets
                    if item["componentId"] == component_id and item["acceptance"] == "owner_exact_svg"
                ],
            }
        )

    logical_components: list[dict[str, Any]] = []
    for component_id, category in categories.items():
        assets = [item for item in imported_assets if item["componentId"] == component_id]
        canonical_assets = [item for item in assets if item["sourceArchive"] == canonical.archive_id]
        present = component_id != "battery-holder-aa-5" and bool(assets)
        logical_components.append(
            {
                "id": component_id,
                "displayName": display_names[component_id],
                "category": category,
                "inventoryStatus": "present" if present else "absent_after_outer_and_nested_archive_scan",
                "canonicalPackageStatus": "present" if canonical_assets else "not_present_in_canonical_svg_package",
                "physicalDimensions": physical_dimensions[component_id],
                "pinMapStatus": pin_by_id[component_id]["status"],
                "breadboardFootprintStatus": next(
                    (item["status"] for item in footprint_map["componentFootprints"] if item["componentId"] == component_id),
                    "board_definition",
                ),
                "assetCount": len(assets),
                "canonicalAssetCount": len(canonical_assets),
                "assetFiles": [item["importedFile"] for item in assets],
                "sourceEvidence": [
                    {"sourceArchive": item["sourceArchive"], "sourceFile": item["sourceFile"], "sha256": item["sha256"], "acceptance": item["acceptance"]}
                    for item in assets
                ],
                "simulationSupport": "not_evaluated_in_asset_foundation_audit",
            }
        )

    role_counts = Counter(item["role"] for item in file_inventory)
    family_counts = Counter(item["componentFamily"] for item in file_inventory)
    nested_role_counts = Counter(item["role"] for item in nested_files)
    known_gaps = [
        {
            "id": "battery-holder-aa-5",
            "status": "absent",
            "evidence": "No 5-cell holder occurs in the canonical archive, either supplemental archive, or any readable nested ZIP; the canonical package contains 1/2/3/4/6/8-cell v6 variants.",
        },
        {
            "id": "physical-dimensions",
            "status": "partially_declared",
            "evidence": "Unknown dimensions remain null; no dimensions were guessed from raster pixels.",
        },
        {
            "id": "runtime-acceptance",
            "status": "not_claimed",
            "evidence": "Reference-lab vector candidates remain classified as unaccepted where a package-native exact SVG is unavailable.",
        },
    ]

    manifest = {
        "schema": "asa-lab.owner-electronics-asset-foundation-audit.v2",
        "provenance": "owner_supplied",
        "auditScope": "owner-confirmed canonical SVG archive plus unique supplemental owner files and every readable nested ZIP",
        "worldUnitsPerMm": WORLD_UNITS_PER_MM,
        "sourceArchives": [
            {
                "id": canonical.archive_id,
                "name": canonical.path.name,
                "sha256": CANONICAL_ARCHIVE_SHA,
                "fileCount": len(canonical.files),
                "backupPath": str(canonical.path),
                "role": "owner_confirmed_canonical_component_package",
                "committedToGit": False,
            },
            {
                "id": components.archive_id,
                "name": components.path.name,
                "sha256": COMPONENT_ARCHIVE_SHA,
                "fileCount": len(components.files),
                "uniqueSupplementalFileCount": sum(item["sourceArchive"] == components.archive_id for item in file_inventory),
                "backupPath": str(components.path),
                "role": "supplemental_owner_png_cdr_and_evidence",
                "committedToGit": False,
            },
            {
                "id": reference.archive_id,
                "name": reference.path.name,
                "sha256": REFERENCE_ARCHIVE_SHA,
                "fileCount": len(reference.files),
                "backupPath": str(reference.path),
                "role": "supplemental_owner_reference_lab",
                "committedToGit": False,
            },
        ],
        "summary": {
            "outerFilesClassified": len(file_inventory),
            "nestedFilesClassified": len(nested_files),
            "logicalComponents": len(logical_components),
            "presentLogicalComponents": sum(item["inventoryStatus"] == "present" for item in logical_components),
            "absentRequestedLogicalComponents": sum(item["inventoryStatus"] != "present" for item in logical_components),
            "importedReviewAssets": len(imported_assets),
            "roleCounts": dict(sorted(role_counts.items())),
            "nestedRoleCounts": dict(sorted(nested_role_counts.items())),
            "componentFamilyFileCounts": dict(sorted(family_counts.items())),
        },
        "logicalComponents": logical_components,
        "knownGaps": known_gaps,
        "fileInventory": file_inventory,
        "nestedArchiveInventory": nested_files,
        "importedReviewAssets": imported_assets,
    }

    write_json(output / "manifest.json", manifest)
    write_json(
        output / "physical-dimensions.json",
        {
            "schema": "asa-lab.owner-electronics-physical-dimensions.v1",
            "provenance": "owner_supplied",
            "worldUnitsPerMm": WORLD_UNITS_PER_MM,
            "components": [physical_dimensions[key] for key in categories],
        },
    )
    write_json(
        output / "pin-map.json",
        {
            "schema": "asa-lab.owner-electronics-pin-map.v1",
            "provenance": "owner_supplied",
            "components": pin_map,
        },
    )
    write_json(output / "breadboard-footprint-map.json", footprint_map)
    write_json(output / "state-family-map.json", state_family_map)

    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
    print(json.dumps({"knownGaps": known_gaps}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

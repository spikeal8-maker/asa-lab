#!/usr/bin/env python3
"""Each defect the asset validator exists to catch, exercised against a fixture.

Two earlier versions of the validator were wrong in ways a green pipeline did not
notice: one classified by file name, the other collected any string that looked
like an asset path. Both would pass a test that only checks the happy case, so
every case here is a violation that must fail, and the suite fails if any of them
is accepted.

Run: python tools/test_validate_electronics_assets.py
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "tools/validate_electronics_assets.py"
ASSET_DIR = "apps/web/public/assets/electronics"
RUNTIME_DIR = f"{ASSET_DIR}/owner-audit/components"
CATALOG = f"{ASSET_DIR}/owner-catalog/manifest.json"

SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n'


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def build(tmp: Path, *, svgs: dict[str, bytes], catalog: dict) -> None:
    for relative, body in svgs.items():
        path = tmp / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    catalog_path = tmp / CATALOG
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")


def run(tmp: Path, *extra: str) -> tuple[int, str]:
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), "--root", str(tmp), *extra],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, result.stdout + result.stderr


def component(url: str, body: bytes, **overrides) -> dict:
    entry = {
        "componentId": "part",
        "runtimePath": url,
        "runtimeSha256": digest(body),
        "sourceSha256": digest(body),
    }
    entry.update(overrides)
    return entry


def catalog_with(*components, **top) -> dict:
    document = {
        "schema": "asa-lab.electronics-owner-catalog.v1",
        "policy": {"runtimeArt": "byte_exact_owner_svg_only"},
        "components": list(components),
    }
    document.update(top)
    return document


CASES: list[tuple[str, callable, tuple[str, ...], str]] = []


def case(name: str, *flags: str, expect: str = ""):
    def decorate(fn):
        CASES.append((name, fn, flags, expect))
        return fn
    return decorate


@case("a healthy catalog passes", "--allow-unnamed", expect="")
def healthy(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(tmp, svgs={f"apps/web/public{url}": SVG}, catalog=catalog_with(component(url, SVG)))


@case("same basename in another directory is not the asset", expect="not named by the catalog")
def basename_collision(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    decoy = f"{RUNTIME_DIR}/reference-candidates/led.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG, decoy: SVG},
        catalog=catalog_with(component(url, SVG)),
    )


@case("a named file that is missing", "--allow-unnamed", expect="absent")
def missing(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(tmp, svgs={}, catalog=catalog_with(component(url, SVG)))


@case("one byte changed", "--allow-unnamed", expect="bytes hash to")
def one_byte(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG.replace(b"10", b"11", 1)},
        catalog=catalog_with(component(url, SVG)),
    )


@case("source and runtime hashes disagree", "--allow-unnamed", expect="byte-exact")
def source_mismatch(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    entry = component(url, SVG, sourceSha256=digest(b"other"))
    build(tmp, svgs={f"apps/web/public{url}": SVG}, catalog=catalog_with(entry))


@case("an unnamed file in the runtime tree", expect="not named by the catalog")
def unnamed(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG, f"{RUNTIME_DIR}/stray.svg": SVG},
        catalog=catalog_with(component(url, SVG)),
    )


@case("two records claiming one path with different hashes", "--allow-unnamed",
      expect="different hashes")
def conflicting(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    good = component(url, SVG)
    bad = component(url, SVG, runtimeSha256=digest(b"other"), sourceSha256=digest(b"other"))
    build(tmp, svgs={f"apps/web/public{url}": SVG}, catalog=catalog_with(good, bad))


@case("embedded raster", "--allow-unnamed", expect="embedded raster")
def raster(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    body = SVG.replace(b"<rect", b'<image href="data:image/png;base64,AAA"/><rect')
    build(tmp, svgs={f"apps/web/public{url}": body}, catalog=catalog_with(component(url, body)))


@case("script element", "--allow-unnamed", expect="script element")
def script(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    body = SVG.replace(b"<rect", b"<script>alert(1)</script><rect")
    build(tmp, svgs={f"apps/web/public{url}": body}, catalog=catalog_with(component(url, body)))


@case("external reference", "--allow-unnamed", expect="external reference")
def external(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    body = SVG.replace(b"<rect", b'<use xlink:href="https://example.invalid/a.svg"/><rect')
    build(tmp, svgs={f"apps/web/public{url}": body}, catalog=catalog_with(component(url, body)))


@case("path traversal", "--allow-unnamed", expect="escapes the asset root")
def traversal(tmp: Path) -> None:
    url = "/assets/electronics/../../../etc/passwd.svg"
    build(tmp, svgs={}, catalog=catalog_with(component(url, SVG)))


@case("a runtime path with no hash contract", "--allow-unnamed", expect="no runtimeSha256")
def no_contract(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    entry = {"componentId": "part", "runtimePath": url}
    build(tmp, svgs={f"apps/web/public{url}": SVG}, catalog=catalog_with(entry))


@case("a duplicate key in the catalog", "--allow-unnamed", expect="duplicate key")
def duplicate_key(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(tmp, svgs={f"apps/web/public{url}": SVG}, catalog=catalog_with(component(url, SVG)))
    path = tmp / CATALOG
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace('"components":', '"policy": {}, "components":', 1), encoding="utf-8")


@case("an asset-looking string that is not a runtimePath", "--allow-unnamed", expect="")
def not_a_runtime_path(tmp: Path) -> None:
    """A field that merely mentions an SVG must not promote it to runtime art."""
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    entry = component(url, SVG)
    entry["auditPreview"] = "/assets/electronics/owner-audit/components/nowhere/ghost.svg"
    build(tmp, svgs={f"apps/web/public{url}": SVG}, catalog=catalog_with(entry))


def main() -> int:
    failures = 0
    for name, prepare, flags, expect in CASES:
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            prepare(tmp)
            code, output = run(tmp, *flags)
        if expect:
            ok = code != 0 and expect in output
            verdict = "rejected" if ok else "ACCEPTED"
        else:
            ok = code == 0
            verdict = "accepted" if ok else "REJECTED"
        print(f"  {'ok  ' if ok else 'FAIL'} {name:52} {verdict}")
        if not ok:
            failures += 1
            for line in output.strip().splitlines()[:4]:
                print(f"         {line}")

    print()
    if failures:
        print(f"asset validator tests: FAIL ({failures} of {len(CASES)})")
        return 1
    print(f"asset validator tests: PASS ({len(CASES)} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

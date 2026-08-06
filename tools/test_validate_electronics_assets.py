#!/usr/bin/env python3
"""Each defect the asset validator exists to catch, exercised against a fixture.

Three earlier versions of the validator were wrong in ways a green pipeline did
not notice: one classified by file name, the second collected any string that
looked like an asset path, and the third read the catalog alone and so reported
declared, hash-pinned owner files as undeclared dead weight. All three would pass
a test that only checks the happy case, so most cases here are violations that
must fail, and the suite fails if any of them is accepted — or if any of the
legitimate arrangements below is rejected.

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
AUDIT = f"{ASSET_DIR}/owner-audit/manifest.json"

SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n'
PNG = b"\x89PNG\r\n\x1a\n" + bytes(48)


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def build(tmp: Path, *, svgs: dict[str, bytes], catalog: dict, audit: dict | None = None) -> None:
    for relative, body in svgs.items():
        path = tmp / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    catalog_path = tmp / CATALOG
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    if audit is not None:
        audit_path = tmp / AUDIT
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        audit_path.write_text(json.dumps(audit, indent=2), encoding="utf-8")


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


def imported(relative_to_audit: str, body: bytes, **overrides) -> dict:
    """One `importedReviewAssets` entry, addressed from the audit root."""
    entry = {
        "componentId": "part",
        "importedFile": relative_to_audit,
        "sha256": digest(body),
    }
    entry.update(overrides)
    return entry


def audit_with(*entries) -> dict:
    return {
        "schema": "asa-lab.electronics-owner-audit.v1",
        "importedReviewAssets": list(entries),
    }


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


@case("same basename in another directory is not the asset", expect="declared by neither manifest")
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


@case("an undeclared file in the runtime tree", expect="declared by neither manifest")
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


@case("a runtime path with no hash contract", "--allow-unnamed", expect="no hash recorded")
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


# ── the audit manifest, the second declaration ───────────────────────────────
#
# Reading the catalog alone was the third defect: thirty-five owner files the
# audit manifest declares and pins by hash were reported as dead weight, and a
# cleanup acting on that report would have deleted them. These cases hold the
# corrected behaviour in place — the second document is honoured, and checked as
# strictly as the first.


@case("audit-declared reference art in the runtime tree is legitimate", expect="")
def audit_declares(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    photo = f"{RUNTIME_DIR}/source-reference/led.png"
    candidate = f"{RUNTIME_DIR}/reference-candidates/arduino.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG, photo: PNG, candidate: SVG},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(
            imported("components/source-reference/led.png", PNG),
            imported("components/reference-candidates/arduino.svg", SVG),
        ),
    )


@case("an audit-declared file whose bytes changed", expect="bytes hash to")
def audit_hash_drift(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    candidate = f"{RUNTIME_DIR}/reference-candidates/arduino.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG, candidate: SVG.replace(b"10", b"11", 1)},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(imported("components/reference-candidates/arduino.svg", SVG)),
    )


@case("the two manifests disagree about one file", "--allow-unnamed", expect="different hashes")
def manifests_disagree(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(imported("components/led/red/led.svg", b"other bytes entirely")),
    )


@case("an audit-declared file that is absent", "--allow-unnamed", expect="absent")
def audit_absent(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(imported("components/reference-candidates/ghost.svg", SVG)),
    )


@case("an audit entry with no hash", "--allow-unnamed", expect="no sha256 recorded")
def audit_no_hash(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    entry = {"componentId": "part", "importedFile": "components/reference-candidates/a.svg"}
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(entry),
    )


@case("audit path traversal", "--allow-unnamed", expect="escapes the audit root")
def audit_traversal(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(imported("../../../../../etc/passwd", SVG)),
    )


@case("a script element in audit-declared art", "--allow-unnamed", expect="script element")
def audit_script(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    body = SVG.replace(b"<rect", b"<script>alert(1)</script><rect")
    candidate = f"{RUNTIME_DIR}/reference-candidates/arduino.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG, candidate: body},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(imported("components/reference-candidates/arduino.svg", body)),
    )


@case("a duplicate key in the audit manifest", "--allow-unnamed", expect="duplicate key")
def audit_duplicate_key(tmp: Path) -> None:
    url = "/assets/electronics/owner-audit/components/led/red/led.svg"
    build(
        tmp,
        svgs={f"apps/web/public{url}": SVG},
        catalog=catalog_with(component(url, SVG)),
        audit=audit_with(imported("components/reference-candidates/a.svg", SVG)),
    )
    path = tmp / AUDIT
    text = path.read_text(encoding="utf-8")
    path.write_text(
        text.replace('"importedReviewAssets":', '"schema": "shadow", "importedReviewAssets":', 1),
        encoding="utf-8",
    )


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

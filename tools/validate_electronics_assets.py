#!/usr/bin/env python3
"""Every runtime asset is exactly the file the owner catalog names, and nothing else.

The catalog declares `byte_exact_owner_svg_only` and records a SHA-256 beside each
runtime path. A promise is worth what checks it, so this exits non-zero on:

  * a named runtime path that is absent, or is not an SVG;
  * a runtime path with no hash contract at all;
  * bytes that do not hash to the recorded runtimeSha256;
  * sourceSha256 disagreeing with runtimeSha256 under the byte-exact policy;
  * two records claiming the same path with different hashes;
  * embedded raster, a script element, or an external reference;
  * a path escaping the asset root, or carrying a query or fragment;
  * any file in the runtime tree the catalog does not name.

Membership is decided by the exact value of a `runtimePath` key. Two earlier
versions of this file got that wrong in two different ways: the first compared
file names, so a same-named file in another directory was taken for the asset; the
second collected any string that looked like an asset path, so an unrelated field
could have promoted a file to runtime art by accident. Both are why the collector
below records where each path came from.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
CATALOG_RELATIVE = "apps/web/public/assets/electronics/owner-catalog/manifest.json"
WEB_PUBLIC_RELATIVE = "apps/web/public"
RUNTIME_TREE_RELATIVE = "apps/web/public/assets/electronics/owner-audit/components"
ASSET_URL_ROOT = "/assets/electronics/"

FORBIDDEN_CONTENT = (
    (re.compile(rb"data:image/(png|jpe?g|gif|webp|bmp)", re.I), "embedded raster"),
    (re.compile(rb"<script", re.I), "script element"),
    (re.compile(rb"(xlink:)?href\s*=\s*[\"\']\s*https?://", re.I), "external reference"),
)


def reject_duplicate_json_keys(pairs: list[tuple[str, object]]) -> dict:
    """The catalog is a source of truth; a repeated key in it would silently win.

    docs/execution/current.yaml carried a duplicate key once and every check
    passed. JSON has the same hazard and the same remedy.
    """
    seen: set[str] = set()
    for key, _ in pairs:
        if key in seen:
            raise ValueError(f"duplicate key {key!r} in the owner catalog")
        seen.add(key)
    return dict(pairs)


@dataclass
class RuntimeRecord:
    """One object in the catalog that declares runtime art."""

    url: str
    trail: str
    runtime_sha: str | None = None
    source_sha: str | None = None


@dataclass
class Findings:
    errors: list[str] = field(default_factory=list)
    records: list[RuntimeRecord] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.errors.append(message)


def collect_runtime_records(catalog: object, findings: Findings) -> None:
    """Collect the value of every `runtimePath` key, and nothing else.

    Any mapping that carries runtimePath may also carry runtimeSha256 and
    sourceSha256; those belong to that record rather than to the document.
    """

    def visit(node: object, trail: str) -> None:
        if isinstance(node, dict):
            url = node.get("runtimePath")
            if isinstance(url, str):
                findings.records.append(
                    RuntimeRecord(
                        url=url,
                        trail=trail,
                        runtime_sha=node.get("runtimeSha256")
                        if isinstance(node.get("runtimeSha256"), str)
                        else None,
                        source_sha=node.get("sourceSha256")
                        if isinstance(node.get("sourceSha256"), str)
                        else None,
                    )
                )
            for key, value in node.items():
                visit(value, f"{trail}.{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                visit(value, f"{trail}[{index}]")

    visit(catalog, "catalog")


def relative_for(url: str, trail: str, findings: Findings) -> str | None:
    """Turn a catalog URL into a repository path, refusing anything unsafe."""
    if not url.startswith(ASSET_URL_ROOT):
        findings.fail(f"{trail}: runtimePath {url!r} is outside {ASSET_URL_ROOT}")
        return None
    if "?" in url or "#" in url:
        findings.fail(f"{trail}: runtimePath {url!r} carries a query or fragment")
        return None
    if ".." in Path(url).parts or url.startswith("//"):
        findings.fail(f"{trail}: runtimePath {url!r} escapes the asset root")
        return None
    if not url.endswith(".svg"):
        findings.fail(f"{trail}: runtimePath {url!r} is not an SVG path")
        return None
    return f"{WEB_PUBLIC_RELATIVE}{url}"


def check_file(root: Path, relative: str, findings: Findings) -> bytes | None:
    path = root / relative
    if not path.is_file():
        findings.fail(f"{relative}: named as runtime art but absent")
        return None
    body = path.read_bytes()
    head = body[:512].lstrip()
    if not (head.startswith(b"<svg") or head.startswith(b"<?xml") or head.startswith(b"<!--")):
        findings.fail(f"{relative}: named as runtime art but is not an SVG")
        return None
    for pattern, label in FORBIDDEN_CONTENT:
        if pattern.search(body):
            findings.fail(f"{relative}: contains {label}")
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument("--json", dest="destination")
    parser.add_argument(
        "--allow-unnamed",
        action="store_true",
        help="permit files in the runtime tree the catalog does not name; off by "
        "default, because an unnamed file there is either dead weight or art the "
        "editor will never load",
    )
    args = parser.parse_args()
    root = Path(args.root).resolve()

    catalog_path = root / CATALOG_RELATIVE
    if not catalog_path.is_file():
        print("electronics assets: SKIPPED (owner catalog is not in this checkout)")
        return 0

    findings = Findings()
    try:
        catalog = json.loads(
            catalog_path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_json_keys
        )
    except ValueError as exc:
        print("electronics assets: FAIL", file=sys.stderr)
        print(f"- {CATALOG_RELATIVE}: {exc}", file=sys.stderr)
        return 1

    collect_runtime_records(catalog, findings)
    byte_exact = catalog.get("policy", {}).get("runtimeArt") == "byte_exact_owner_svg_only"

    claims: dict[str, set[str]] = {}
    without_contract: set[str] = set()
    named: set[str] = set()

    for record in findings.records:
        relative = relative_for(record.url, record.trail, findings)
        if relative is None:
            continue
        named.add(relative)
        if record.runtime_sha is None:
            without_contract.add(relative)
        else:
            claims.setdefault(relative, set()).add(record.runtime_sha)
            if byte_exact and record.source_sha and record.source_sha != record.runtime_sha:
                findings.fail(
                    f"{relative}: policy is byte-exact but sourceSha256 and runtimeSha256 "
                    f"differ at {record.trail}"
                )

    for relative in sorted(named):
        body = check_file(root, relative, findings)
        declared = claims.get(relative, set())
        if len(declared) > 1:
            findings.fail(
                f"{relative}: claimed with {len(declared)} different hashes; "
                "records naming one file must agree about it"
            )
        if body is None:
            continue
        actual = hashlib.sha256(body).hexdigest()
        for expected in declared:
            if actual != expected:
                findings.fail(
                    f"{relative}: bytes hash to {actual[:12]}… but the catalog records "
                    f"{expected[:12]}…"
                )

    # A path with no recorded hash cannot be byte-exact by inspection, so under
    # that policy the absence of a contract is itself the defect.
    if byte_exact:
        for relative in sorted(without_contract - set(claims)):
            findings.fail(f"{relative}: named as runtime art with no runtimeSha256 recorded")

    unnamed: list[str] = []
    runtime_tree = root / RUNTIME_TREE_RELATIVE
    if runtime_tree.is_dir():
        for path in sorted(runtime_tree.rglob("*")):
            if path.is_file():
                relative = path.relative_to(root).as_posix()
                if relative not in named:
                    unnamed.append(relative)
    if not args.allow_unnamed:
        for relative in unnamed:
            findings.fail(f"{relative}: in the runtime tree but not named by the catalog")

    hashed = len(claims)
    report = {
        "schema": "asa-lab.electronics-asset-check.v2",
        "runtimePathRecords": len(findings.records),
        "uniqueRuntimePaths": len(named),
        "pathsWithHashContract": hashed,
        "pathsWithoutHashContract": sorted(without_contract - set(claims)),
        "unnamedInRuntimeTree": unnamed,
        "errors": findings.errors,
    }
    if args.destination:
        out = root / args.destination
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if findings.errors:
        print("electronics assets: FAIL", file=sys.stderr)
        for error in findings.errors[:40]:
            print(f"- {error}", file=sys.stderr)
        if len(findings.errors) > 40:
            print(f"- … and {len(findings.errors) - 40} more", file=sys.stderr)
        return 1

    print("electronics assets: PASS")
    print(f"runtimePath records read from the catalog : {len(findings.records)}")
    print(f"unique runtime paths                      : {len(named)}")
    print(f"paths with a recorded hash, all verified  : {hashed}")
    print(f"paths without a hash contract             : {len(without_contract - set(claims))}")
    print(f"unnamed files in the runtime tree         : {len(unnamed)}"
          + ("  (permitted)" if args.allow_unnamed else "  (enforced empty)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

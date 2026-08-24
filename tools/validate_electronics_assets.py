#!/usr/bin/env python3
"""Every asset in the runtime tree is exactly the file the owner declared, and nothing else.

Two documents declare owner art, and a file is legitimate if either names it:

  * `component-database/catalog.json` — what the editor loads, one `runtimeSha256`
    per `runtimePath`, under the `byte_exact_owner_svg_only` policy;
  * `owner-audit/manifest.json` — the import record, one `sha256` per
    `importedFile`, covering the catalogued art and the reference material
    imported beside it.

A promise is worth what checks it, so this exits non-zero on:

  * a declared path that is absent, or is not an SVG;
  * a declared path with no hash contract at all;
  * bytes that do not hash to the recorded hash;
  * sourceSha256 disagreeing with runtimeSha256 under the byte-exact policy;
  * the two manifests recording different hashes for one file;
  * two records claiming the same path with different hashes;
  * embedded raster, a script element, or an external reference;
  * a path escaping the asset root, or carrying a query or fragment;
  * any file in the runtime tree that neither manifest declares.

Membership is decided by the exact value of a `runtimePath` or `importedFile`
key. Three earlier versions of this file got that wrong in three different ways:
the first compared file names, so a same-named file in another directory was
taken for the asset; the second collected any string that looked like an asset
path, so an unrelated field could have promoted a file to runtime art by
accident; the third read the catalog alone and so called thirty-five files
undeclared that the audit manifest declares and pins by hash — it would have had
them deleted as dead weight. That is why the collectors below record where each
path came from, and why a file may be declared by either document.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
CATALOG_RELATIVE = "apps/web/public/assets/electronics/component-database/catalog.json"
AUDIT_RELATIVE = "apps/web/public/assets/electronics/owner-audit/manifest.json"
AUDIT_ROOT_RELATIVE = "apps/web/public/assets/electronics/owner-audit"
WEB_PUBLIC_RELATIVE = "apps/web/public"
RUNTIME_TREE_RELATIVE = "apps/web/public/assets/electronics/component-database/components"
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


def collect_audit_records(audit: object, findings: Findings) -> list[tuple[str, str, str]]:
    """Collect `importedFile` and its `sha256` from the audit manifest.

    Paths there are relative to the audit root rather than URLs, so they get the
    same refusal of traversal and backslashes that catalog URLs get; a manifest is
    only as trustworthy as the checking of what it says.
    """
    collected: list[tuple[str, str, str]] = []
    entries = audit.get("importedReviewAssets") if isinstance(audit, dict) else None
    if not isinstance(entries, list):
        return collected

    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        imported = entry.get("importedFile")
        digest = entry.get("sha256")
        if not isinstance(imported, str):
            continue
        trail = f"audit.importedReviewAssets[{index}]"
        if not isinstance(digest, str):
            findings.fail(f"{trail}: {imported!r} is imported with no sha256 recorded")
            continue
        if imported.startswith("/") or "\\" in imported or ".." in PurePosixPath(imported).parts:
            findings.fail(f"{trail}: importedFile {imported!r} escapes the audit root")
            continue
        collected.append((f"{AUDIT_ROOT_RELATIVE}/{imported}", digest, trail))
    return collected


def looks_like_svg(body: bytes) -> bool:
    head = body[:512].lstrip()
    return head.startswith(b"<svg") or head.startswith(b"<?xml") or head.startswith(b"<!--")


def check_file(root: Path, relative: str, findings: Findings, *, require_svg: bool) -> bytes | None:
    """Read a declared file and judge it by what it is declared as.

    The catalog declares art the editor loads, and that must be SVG. The audit
    manifest also covers the PNG reference photographs imported beside the
    artwork; those are provenance, never loaded as art, and demanding SVG of them
    would be the check misreading its own subject.
    """
    path = root / relative
    if not path.is_file():
        findings.fail(f"{relative}: declared as owner art but absent")
        return None
    body = path.read_bytes()
    if not looks_like_svg(body):
        if require_svg:
            findings.fail(f"{relative}: named as runtime art but is not an SVG")
            return None
        return body
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
        help="permit files in the runtime tree that neither manifest declares; off "
        "by default, because an undeclared file there is either dead weight or art "
        "with no provenance",
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

    # The second declaration. Where it is absent — on main, which carries the
    # catalogued art alone — nothing below changes what this checks.
    audit_path = root / AUDIT_RELATIVE
    audited: set[str] = set()
    audit_records: list[tuple[str, str, str]] = []
    if audit_path.is_file():
        try:
            audit = json.loads(
                audit_path.read_text(encoding="utf-8"),
                object_pairs_hook=reject_duplicate_json_keys,
            )
        except ValueError as exc:
            print("electronics assets: FAIL", file=sys.stderr)
            print(f"- {AUDIT_RELATIVE}: {exc}", file=sys.stderr)
            return 1
        audit_records = collect_audit_records(audit, findings)
        for relative, digest, _trail in audit_records:
            audited.add(relative)
            claims.setdefault(relative, set()).add(digest)

    declared = named | audited
    for relative in sorted(declared):
        body = check_file(root, relative, findings, require_svg=relative in named)
        expected_all = claims.get(relative, set())
        if len(expected_all) > 1:
            findings.fail(
                f"{relative}: claimed with {len(expected_all)} different hashes; "
                "records naming one file must agree about it"
            )
        if body is None:
            continue
        actual = hashlib.sha256(body).hexdigest()
        for expected in expected_all:
            if actual != expected:
                findings.fail(
                    f"{relative}: bytes hash to {actual[:12]}… but a manifest records "
                    f"{expected[:12]}…"
                )

    # A path with no recorded hash cannot be byte-exact by inspection, so under
    # that policy the absence of a contract is itself the defect.
    if byte_exact:
        for relative in sorted(without_contract - set(claims)):
            findings.fail(f"{relative}: declared as owner art with no hash recorded")

    unnamed: list[str] = []
    runtime_tree = root / RUNTIME_TREE_RELATIVE
    if runtime_tree.is_dir():
        for path in sorted(runtime_tree.rglob("*")):
            if path.is_file():
                relative = path.relative_to(root).as_posix()
                if relative not in declared:
                    unnamed.append(relative)
    if not args.allow_unnamed:
        for relative in unnamed:
            findings.fail(f"{relative}: in the runtime tree but declared by neither manifest")

    hashed = len(claims)
    report = {
        "schema": "asa-lab.electronics-asset-check.v3",
        "runtimePathRecords": len(findings.records),
        "auditImportRecords": len(audit_records),
        "uniqueRuntimePaths": len(named),
        "auditOnlyPaths": sorted(audited - named),
        "declaredPaths": len(declared),
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
    print(f"importedFile records read from the audit  : {len(audit_records)}")
    print(f"unique catalogued runtime paths           : {len(named)}")
    print(f"declared by the audit manifest alone      : {len(audited - named)}")
    print(f"paths with a recorded hash, all verified  : {hashed}")
    print(f"paths without a hash contract             : {len(without_contract - set(claims))}")
    print(f"undeclared files in the runtime tree      : {len(unnamed)}"
          + ("  (permitted)" if args.allow_unnamed else "  (enforced empty)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

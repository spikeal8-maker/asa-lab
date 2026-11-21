"""Lossless, bounded pg_restore TOC planning for data-backed CHECK functions."""

import re

from .contracts import require

MAX_TOC_BYTES = 8 * 1024 * 1024
MAX_TOC_ENTRIES = 50_000
MAX_TOC_LINE = 16_384
ENTRY = re.compile(r"([1-9][0-9]{0,9});[ \t]+[0-9]+[ \t]+[0-9]+[ \t]+(.+)")
CATALOG_DATA = re.compile(r"TABLE DATA[ \t]+public[ \t]+ai_ollama_cloud_models[ \t]+.+")
CATALOG_SCHEMA = re.compile(r"TABLE[ \t]+public[ \t]+ai_ollama_cloud_models[ \t]+.+")


def plan_restore_toc(toc):
    """Return every original entry, moving only the optional catalog TABLE DATA.

    Input must be the unfiltered `pg_restore --list` output of the same seekable
    archive used for restore. This is not a schema/data filter: CHECK constraints,
    ACLs, RLS, sequence state and all other entries stay enabled and in order.
    Unknown object descriptions are retained verbatim for PostgreSQL compatibility.
    """
    require(isinstance(toc, str) and len(toc) <= MAX_TOC_BYTES,
            "RESTORE_TOC", "Archive table of contents is missing or too large.")
    require(len(toc.encode("utf-8")) <= MAX_TOC_BYTES
            and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", toc),
            "RESTORE_TOC", "Archive table of contents has invalid bytes.")
    lines = toc.splitlines(keepends=True)
    ids, catalog, schema, data = set(), [], [], []
    for index, line in enumerate(lines):
        require(len(line) <= MAX_TOC_LINE, "RESTORE_TOC", "Archive TOC entry is too large.")
        text = line.rstrip("\r\n")
        if not text.strip() or text.startswith(";"):
            continue
        entry = ENTRY.fullmatch(text)
        require(entry is not None, "RESTORE_TOC", "Malformed archive TOC entry.")
        ident, description = entry.groups()
        require(ident not in ids, "RESTORE_TOC", "Duplicate archive TOC entry ID.")
        ids.add(ident)
        require(len(ids) <= MAX_TOC_ENTRIES, "RESTORE_TOC", "Archive has too many TOC entries.")
        if description.startswith("TABLE DATA ") or description.startswith("TABLE DATA\t"):
            require(re.fullmatch(r"TABLE DATA[ \t]+\S+[ \t]+\S+[ \t]+.+", description),
                    "RESTORE_TOC", "Malformed table-data entry in archive TOC.")
            data.append(index)
        if CATALOG_DATA.fullmatch(description):
            catalog.append(index)
        if CATALOG_SCHEMA.fullmatch(description):
            schema.append(index)
    require(bool(ids), "RESTORE_TOC", "Archive table of contents has no entries.")
    require(len(catalog) <= 1 and len(schema) <= 1,
            "RESTORE_TOC", "Ambiguous model catalog entries in archive TOC.")
    if catalog:
        require(len(schema) == 1 and schema[0] < data[0],
                "RESTORE_TOC", "Catalog schema must precede restored table data.")
        selected = catalog[0]
        if selected != data[0]:
            lines.insert(data[0], lines.pop(selected))
    # Capture helpers may strip the final newline; pg_restore's list is a file.
    return "".join(line if line.endswith("\n") else line + "\n" for line in lines)

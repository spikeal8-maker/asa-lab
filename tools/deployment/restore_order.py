"""Preserve pg_restore dependencies while restoring genuine ASA Lab backups.

pg_restore's table-data order does not infer dependencies hidden inside CHECK
functions. ai_assistant_config invokes ai_model_provider_matches(), which reads
ai_ollama_cloud_models. Restoring the config before the model catalog fails on
otherwise valid real-world backups. Reorder only those exact TABLE DATA entries.
"""

import re

from .contracts import Blocked


_TABLE_DATA = re.compile(
    r"^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+public\s+([a-z][a-z0-9_]*)\s+"
)


def ordered_restore_toc(toc):
    """Return a deterministic TOC with cloud-model data before dependent config.

    Preserve every entry, including ACLs, constraints, policies and data, exactly
    once. No constraint is dropped or disabled. Older backups without the model
    catalog retain the original ordering.
    """
    if not isinstance(toc, str) or not toc.strip():
        raise Blocked("RESTORE_TOC", "Empty PostgreSQL restore listing.",
                      "Verify that pg_restore can read the backup.")
    lines = toc.splitlines(keepends=True)
    matches = {}
    relevant = {"ai_ollama_cloud_models", "ai_assistant_config", "ai_generation_policy"}
    for index, line in enumerate(lines):
        found = _TABLE_DATA.match(line)
        if found and found.group(1) in relevant:
            table = found.group(1)
            if table in matches:
                raise Blocked("RESTORE_TOC", "Duplicate dependent table-data entry.",
                              "Inspect the PostgreSQL backup before restoring.")
            matches[table] = index

    if "ai_ollama_cloud_models" not in matches:
        return toc
    dependent = [matches[name] for name in ("ai_assistant_config", "ai_generation_policy")
                 if name in matches]
    if not dependent or matches["ai_ollama_cloud_models"] < min(dependent):
        return toc

    catalog = lines.pop(matches["ai_ollama_cloud_models"])
    lines.insert(min(dependent), catalog)
    result = "".join(lines)
    if len(result) != len(toc):
        raise Blocked("RESTORE_TOC", "PostgreSQL restore-list length changed.",
                      "Do not continue with an incomplete restore.")
    return result

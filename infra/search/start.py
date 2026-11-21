"""Render only ephemeral settings; the independent signing secret lives in private.env."""

import json
import os
from pathlib import Path
import re
import sys



def configuration(template, secret):
    if not re.fullmatch(r"[a-fA-F0-9]{64}", secret or ""):
        raise ValueError("ASA_SEARCH_SECRET is missing or invalid; use the authorized ASA installer/updater.")
    settings = json.loads(template)
    settings["server"]["secret_key"] = secret
    return settings


def main():
    try:
        settings = configuration(Path("/usr/local/share/asa-search/settings.json").read_text(),
                                 os.environ.get("ASA_SEARCH_SECRET", ""))
    except (ValueError, OSError):
        print("ASA search configuration unavailable; no secrets or queries are logged.", file=sys.stderr)
        return 78
    directory = Path("/tmp/asa-search")
    directory.mkdir(mode=0o700, exist_ok=True)
    target = directory / "settings.yml"
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(settings, stream, ensure_ascii=False)
    # Do not pass the dedicated secret to engine subprocesses. It remains in the
    # private, process-owned tmpfs file, never in a public setting or image layer.
    os.environ.pop("ASA_SEARCH_SECRET", None)
    os.execv("/usr/local/searxng/.venv/bin/granian", ["granian", "--interface", "wsgi", "asa_search_app:app"])


if __name__ == "__main__":
    raise SystemExit(main())

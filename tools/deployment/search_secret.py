"""Dedicated internal-search secret, provisioned only during an authorized mutation."""

import argparse
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile

KEY = "ASA_SEARCH_SECRET"


def inspect_secret(path):
    path = Path(path)
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or (
        getattr(metadata, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    ):
        raise ValueError("Search secret requires an existing regular private environment file.")
    raw = path.read_bytes()
    lines = [line for line in raw.decode("utf-8-sig").splitlines()
             if re.match(r"^\s*(?:export\s+)?ASA_SEARCH_SECRET(?=[\s=]|$)", line)]
    if not lines:
        return "missing", raw
    if len(lines) != 1 or not re.fullmatch(r"\s*(?:export\s+)?ASA_SEARCH_SECRET\s*=\s*[a-fA-F0-9]{64}\s*", lines[0]):
        raise ValueError("Existing ASA_SEARCH_SECRET is invalid or duplicated; no key was replaced.")
    return "valid", raw


def ensure_secret(path):
    path = Path(path)
    lock = path.with_name(path.name + ".asa-search-secret.lock")
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    temporary = None
    try:
        state, raw = inspect_secret(path)
        if state == "valid":
            return False
        newline = b"\r\n" if b"\r\n" in raw else b"\n"
        suffix = (b"" if raw.endswith(b"\n") or not raw else newline)
        suffix += KEY.encode() + b"=" + secrets.token_hex(32).encode() + newline
        descriptor, temporary = tempfile.mkstemp(prefix=".asa-search-env-", dir=path.parent)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw + suffix)
            stream.flush()
            os.fsync(stream.fileno())
        if path.read_bytes() != raw:
            raise ValueError("Private environment changed concurrently; search secret was not installed.")
        os.replace(temporary, path)
        temporary = None
        return True
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
        lock.unlink()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--file", default=".env")
    args = parser.parse_args()
    try:
        if args.create:
            changed = ensure_secret(args.file)
            print("SEARCH_SECRET_CREATED" if changed else "SEARCH_SECRET_PRESERVED")
        else:
            state, _ = inspect_secret(args.file)
            print("SEARCH_SECRET_" + state.upper())
    except (OSError, ValueError, UnicodeError):
        print("SEARCH_SECRET_BLOCKED: inspect private configuration; no replacement key is generated.")
        return 78
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

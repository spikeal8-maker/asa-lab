"""WIN-04B1: independently verify target checkout provenance without modifying it.

Policy: only a clean checkout of the *current* official GitHub main commit may
be used as a transfer destination. A SHA read from the checkout alone is NOT
trusted. HTTPS source is fixed by this module, not by a repository config.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .contracts import Blocked, require

OFFICIAL_REMOTE = "https://github.com/spikeal8-maker/asa-lab.git"
OFFICIAL_BRANCH_API = "https://api.github.com/repos/spikeal8-maker/asa-lab/branches/main"
_SHA = re.compile(r"^[0-9a-f]{40}$")

# Source files the target restore will directly depend on, especially the
# validation and Compose configuration. Every file must be present in the
# checkout and match the exact Git tree, including if the index was marked
# assume-unchanged or skip-worktree.
CRITICAL_FILES = (
    "tools/asa_manager.py",
    "tools/asa-bootstrap.ps1",
    "tools/asa-setup.ps1",
    "tools/deployment/contracts.py",
    "tools/deployment/system.py",
    "tools/deployment/fresh_install.py",
    "tools/deployment/import_preflight.py",
    # This PR introduces import_target_plan.py and target_git.py. They cannot
    # be required in an official main checkout until this PR is merged.
    "compose.yaml",
    "compose.production.yaml",
    ".github/workflows/spec-validation.yml",
)


def _git(root, *args):
    env = {key: val for key, val in os.environ.items()
           if not key.upper().startswith("GIT_")}
    env.update({
        "GIT_NO_REPLACE_OBJECTS": "1",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
    })
    # Keep standard Windows working-tree CRLF normalization when running
    # without untrusted global config. Otherwise a normal Windows checkout
    # committed under core.autocrlf=true falsely appears modified.
    git_options = ["-c", "core.fsmonitor=false"]
    if os.name == "nt":
        git_options.extend(["-c", "core.autocrlf=true"])
    try:
        completed = subprocess.run(
            ["git", *git_options, "-C", str(root), *args],
            capture_output=True, encoding="utf-8", errors="replace",
            env=env, timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked(
            "IMPORT_TARGET_GIT",
            "Unable to inspect the target Git checkout safely.",
            "Use a clean official ASA Lab checkout; do not execute its hooks.",
        ) from exc
    require(completed.returncode == 0, "IMPORT_TARGET_GIT",
            "Cannot verify target Git identity or file integrity.")
    return completed.stdout.strip()


def _official_main_sha():
    # No user-provided URL, no local git origin or mutable checkout pin.
    request = Request(OFFICIAL_BRANCH_API, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "ASA-Lab-WIN04-Target-Verification",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urlopen(request, timeout=20) as response:
            require(response.geturl() == OFFICIAL_BRANCH_API,
                    "IMPORT_TARGET_OFFICIAL_ENDPOINT",
                    "Official GitHub SHA endpoint unexpectedly redirected.")
            data = json.loads(response.read(32 * 1024).decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError,
            UnicodeError, ValueError) as exc:
        raise Blocked(
            "IMPORT_TARGET_OFFICIAL_UNAVAILABLE",
            "Independent official GitHub main verification unavailable.",
            "Fail closed; do not trust a SHA obtained from the same checkout.",
        ) from exc
    require(isinstance(data, dict) and data.get("name") == "main"
            and isinstance(data.get("commit"), dict),
            "IMPORT_TARGET_OFFICIAL_RESPONSE",
            "Official GitHub branch response has unexpected identity.")
    sha = data["commit"].get("sha")
    require(isinstance(sha, str) and bool(_SHA.fullmatch(sha)),
            "IMPORT_TARGET_OFFICIAL_RESPONSE",
            "Official GitHub main response did not provide a full commit SHA.")
    return sha


def _file_blob_ids(item):
    """Hash bytes in Python; never invoke a repository-configured Git clean filter."""
    try:
        raw = item.read_bytes()
    except OSError as exc:
        raise Blocked("IMPORT_TARGET_SOURCE_FILE",
                      "Unable to read an official source file.",
                      "Inspect the fresh checkout without replacing any existing data.") from exc
    candidates = (raw, raw.replace(b"\r\n", b"\n")) if os.name == "nt" else (raw,)
    return {hashlib.sha1(b"blob " + str(len(data)).encode("ascii")
                         + b"\0" + data).hexdigest() for data in candidates}


def _plain_source_path(root, item):
    """Reject file/ancestor symlinks, junctions and other Windows reparse paths."""
    current = item
    while True:
        try:
            attrs = current.lstat()
        except OSError:
            return False
        if (current.is_symlink()
                or getattr(current, "is_junction", lambda: False)()
                or (getattr(attrs, "st_file_attributes", 0)
                    & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))):
            return False
        if current == root:
            return True
        current = current.parent


def attest_target_checkout(root):
    """Verify source provenance, immutability and inventory; return no secrets."""
    root = Path(root).resolve()
    require(root.is_dir() and (root / ".git").exists(),
            "IMPORT_TARGET_GIT", "Target must be a real Git checkout.")
    toplevel = Path(_git(root, "rev-parse", "--show-toplevel")).resolve()
    require(toplevel == root, "IMPORT_TARGET_GIT_ROOT",
            "Git root differs from target destination; nested/foreign checkout.")
    require(_git(root, "rev-parse", "--is-inside-work-tree") == "true",
            "IMPORT_TARGET_GIT", "Target is not inside a Git worktree.")
    # Inspect both raw and resolved origin; URL rewrite rules or local
    # insteadOf tricks cannot silently redirect the official source.
    raw_origin = _git(root, "config", "--local", "--get", "remote.origin.url")
    resolved_origin = _git(root, "remote", "get-url", "origin")
    require(raw_origin == OFFICIAL_REMOTE and resolved_origin == OFFICIAL_REMOTE,
            "IMPORT_TARGET_GIT_ORIGIN",
            "Target Git origin does not resolve to the fixed official HTTPS repository.")
    head = _git(root, "rev-parse", "--verify", "HEAD^{commit}")
    require(bool(_SHA.fullmatch(head)), "IMPORT_TARGET_GIT_SHA",
            "Target is not a valid immutable Git commit.")
    official = _official_main_sha()
    require(head == official, "IMPORT_TARGET_SOURCE_SHA",
            "Target commit SHA is not the independently verified current official main.")
    require(not _git(root, "status", "--porcelain=v1", "--untracked-files=all"),
            "IMPORT_TARGET_DIRTY",
            "Target checkout has modified, staged or untracked files.")
    # Git status can be masked by assume-unchanged/skip-worktree index bits.
    # Read actual bytes from critical files and compare to official SHA's blobs.
    for relative in CRITICAL_FILES:
        item = root / relative
        require(item.is_file() and _plain_source_path(root, item),
                "IMPORT_TARGET_SOURCE_FILE",
                "Critical official source file is absent or traverses a reparse point.")
        recorded = _git(root, "rev-parse", f"HEAD:{relative}")
        require(bool(_SHA.fullmatch(recorded)) and recorded in _file_blob_ids(item),
                "IMPORT_TARGET_SOURCE_CONTENT",
                "Critical source content does not match the verified Git commit: " + relative)
    return {
        "status": "OFFICIAL_CHECKOUT_VERIFIED",
        "officialOriginVerified": True,
        "officialCommitVerified": True,
        "cleanWorkingTreeVerified": True,
        "criticalFilesVerified": len(CRITICAL_FILES),
        "verifiedCommit": head,
        "writesPerformed": False,
    }

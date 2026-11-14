#!/usr/bin/env python3
"""Safely prune redundant LOCAL ASA Lab backup directories after verified recovery.

Never operates on Yandex Disk, docker volumes, user projects, Git worktrees,
private receipts, or unrecognized directories. Linux test installation only.

Preview:
  python3 tools/asa_backup_retention.py plan --root /srv/asa-lab
Prune:
  python3 tools/asa_backup_retention.py prune --root /srv/asa-lab \
      --retain 20261026T190000Z-abc12345 --plan-sha256 <printed digest> \
      --origin https://test.asa-lab.ru --ack-prune
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import uuid
from contextlib import contextmanager

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deployment.contracts import verify_backup

STAMP = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$")
SHA = re.compile(r"^[a-f0-9]{64}$")


class Blocked(RuntimeError):
    pass


def require(ok: bool, message: str) -> None:
    if not ok:
        raise Blocked(message)


def atomic_report(path: Path, data: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex[:8] + ".tmp")
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
                   "w", encoding="utf-8") as out:
        json.dump(data, out, ensure_ascii=False, indent=2, sort_keys=True)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)


def read_key(path: Path, key: str) -> str | None:
    pattern = re.compile(r"^" + re.escape(key) + r"=(.*)$")
    matches = []
    for line in path.read_text("utf-8").splitlines():
        match = pattern.fullmatch(line)
        if match:
            value = match[1].strip()
            if len(value) >= 2 and value[0] in ("'", '"') and value[-1] == value[0]:
                value = value[1:-1]
            matches.append(value)
    require(len(matches) == 1, f"Missing or duplicate installation key {key}")
    return matches[0]


def stat_tree(path: Path, device: int) -> int:
    """Refuse symlinks, mountpoints or special files before removal."""
    first = path.lstat()
    require(stat.S_ISDIR(first.st_mode) and first.st_dev == device and
            not path.is_symlink(), "Unsafe backup directory")
    total = 0
    for folder, dirs, files in os.walk(path, followlinks=False):
        folder = Path(folder)
        info = folder.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_dev == device and
                (folder == path or not os.path.ismount(folder)),
                "Unsafe backup subtree or mounted directory")
        for name in dirs + files:
            p = folder / name
            info = p.lstat()
            require(not stat.S_ISLNK(info.st_mode) and info.st_dev == device and
                    not os.path.ismount(p) and
                    (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)),
                    f"Symlink, mount or special item in backup {path.name}")
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    return total


def clean_snapshot(path: Path, project: str, profile: str,
                   device: int) -> dict | None:
    if not STAMP.fullmatch(path.name) or path.is_symlink() or not path.is_dir():
        return None
    manifest = path / "manifest.json"
    require(not manifest.is_symlink(), "Symlink manifest refused")
    if not manifest.is_file():
        return None
    try:
        data = json.loads(manifest.read_text("utf-8"))
    except (json.JSONDecodeError, UnicodeError):
        return None
    if (data.get("format") != "asa-backup-v1"
            or data.get("complete") is not True
            or data.get("createdAt") != path.name
            or data.get("project") != project
            or data.get("profile") != profile
            or not isinstance(data.get("runtime"), dict)
            or not isinstance(data.get("files"), dict)):
        return None
    bytes_count = stat_tree(path, device)
    return {"name": path.name, "bytes": bytes_count,
            "revision": data["runtime"].get("revision"),
            "schema": data["runtime"].get("schema")}


def root_state(root: Path, origin: str) -> tuple[Path, str, str]:
    root = root.resolve()
    require(os.name == "posix" and root.is_dir(), "Linux installation root required")
    for file in ("compose.yaml", "compose.production.yaml", ".env", ".asa/installation.json"):
        require((root / file).is_file(), f"Installation file missing: {file}")
    expected_origin = read_key(root / ".env", "ASA_UPDATE_ENTRY_ORIGIN")
    require(expected_origin == origin and
            bool(re.fullmatch(r"https://test\.[a-zA-Z0-9.-]+", origin)),
            "Only the explicitly attested existing test origin can be pruned")
    settings = json.loads((root / ".asa/installation.json").read_text("utf-8"))
    require(settings.get("profile") == "production",
            "Expected test installation production Compose profile")
    project = read_key(root / ".env", "COMPOSE_PROJECT_NAME")
    require(project == settings.get("project"), "Compose project identity drift")
    configured = Path(settings.get("backupDirectory") or root / "backups")
    expected = root / "backups"
    require(configured.is_absolute() and configured == expected,
            "This cleanup supports only the canonical local backups directory")
    require(not configured.is_symlink() and configured.is_dir(),
            "Backup root missing or unsafe")
    require(configured.lstat().st_mode & 0o077 == 0,
            "Private backup directory must be mode 0700")
    return configured, project, settings["profile"]


@contextmanager
def refresh_lock(root: Path):
    """Hold the same mutually exclusive lock as the source updater for the ENTIRE prune."""
    lock = root / ".asa" / "test-refresh" / "lock"
    if not lock.exists():
        # A clean installation without any refresh jobs can preview, but not prune
        # unless a stable lock is established by the canonical source updater.
        yield False
        return
    require(lock.is_file() and not lock.is_symlink(), "Unsafe refresh lock path")
    with lock.open("rb") as stream:
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Blocked("Source updater owns the installation; deletion is prohibited") from exc
        try:
            yield True
        finally:
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def no_update_in_progress(root: Path) -> None:
    state = root / ".asa"
    for marker in ("maintenance.json", "failed-switch.json"):
        require(not (state / marker).exists(),
                f"Deployment marker {marker} present; retain backups for recovery")
    refresh = state / "test-refresh"
    if refresh.exists():
        for receipt in refresh.glob("*/status.json"):
            if receipt.is_symlink():
                raise Blocked("Unsafe refresh receipt")
            value = json.loads(receipt.read_text("utf-8"))
            require(value.get("phase") in ("complete", "failed_rolled_back"),
                    f"Unfinished refresh {receipt.parent.name}; do not prune backups")


def enumerate_plan(root: Path, backups: Path, project: str, profile: str,
                   retain: str | None) -> dict:
    device = backups.stat().st_dev
    snapshots = []
    ignored = []
    for child in sorted(backups.iterdir(), key=lambda p:p.name):
        info = clean_snapshot(child, project, profile, device)
        if info is None:
            ignored.append(child.name)
        else:
            snapshots.append(info)
    require(bool(snapshots), "No complete local ASA backup snapshots found")
    by_name = {item["name"]: item for item in snapshots}
    chosen = retain or snapshots[-1]["name"]
    require(chosen in by_name, "Retained snapshot missing, incomplete or foreign")
    require(chosen == snapshots[-1]["name"],
            "Refusing to delete backups newer than the retained snapshot")
    # Only explicitly confirmed, currently relevant backup can justify pruning.
    envrev = read_key(root / ".env", "ASA_BUILD_REVISION")
    envschema = int(read_key(root / ".env", "ASA_EXPECTED_SCHEMA_VERSION") or "0")
    selected = by_name[chosen]
    require(selected["revision"] == envrev and int(selected["schema"]) == envschema,
            "Retained snapshot does not represent installed source revision and schema")
    candidates = [i for i in snapshots if i["name"] != chosen]
    stable = {"format": "asa-test-backup-retention-plan-v1",
              "installation": str(root), "project": project, "profile": profile,
              "retain": chosen, "candidates": candidates,
              "ignored": ignored, "estimated_reclaim_bytes": sum(i["bytes"] for i in candidates)}
    stable["plan_sha256"] = hashlib.sha256(
        json.dumps(stable, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return stable


def apply_prune(args, plan: dict, backups: Path, lock_held: bool) -> dict:
    require(lock_held, "Source updater mutex must remain held throughout pruning")
    require(os.geteuid() == 0, "Root required to prune owner-only private snapshots")
    require(args.ack_prune and args.retain, "Explicit --retain and --ack-prune required")
    require(args.plan_sha256 and SHA.fullmatch(args.plan_sha256),
            "Exact digest from current read-only plan required")
    require(args.plan_sha256 == plan["plan_sha256"], "Plan changed since preview; rerun plan")
    retained = backups / plan["retain"]
    # Canonical validator checks every file checksum, not merely the manifest JSON.
    manifest = verify_backup(retained)
    require(manifest.get("complete") is True, "Retained backup verification failed")
    # Recheck lock and candidate topology immediately before irreversible deletes.
    no_update_in_progress(args.root.resolve())
    device = backups.stat().st_dev
    for item in plan["candidates"]:
        child = backups / item["name"]
        require(STAMP.fullmatch(child.name) is not None and
                child.parent == backups and stat_tree(child, device) == item["bytes"],
                f"Backup changed since preview: {item['name']}")
    receipt = {"action": "prune", "status": "begin", "timestamp_utc":
               dt.datetime.now(dt.timezone.utc).isoformat(),
               "retain": plan["retain"], "plan_sha256": plan["plan_sha256"],
               "deleted": [], "reclaimed_bytes": 0}
    audit_dir = args.root.resolve() / ".asa" / "backup-prune"
    out_path = audit_dir / (dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") +
                            "-" + uuid.uuid4().hex[:8] + ".json")
    atomic_report(out_path, receipt)
    for item in plan["candidates"]:
        # Each candidate was validated as a complete foreign-free backup directory.
        shutil.rmtree(backups / item["name"])
        receipt["deleted"].append(item["name"])
        receipt["reclaimed_bytes"] += item["bytes"]
        atomic_report(out_path, receipt)
    receipt["status"] = "complete"
    atomic_report(out_path, receipt)
    return {"action": "prune", "status": receipt["status"],
            "retained": receipt["retain"], "deleted": receipt["deleted"],
            "reclaimed_bytes": receipt["reclaimed_bytes"], "audit_receipt": str(out_path),
            "ignored": plan["ignored"]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "prune"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--origin", required=True)
    parser.add_argument("--retain", help="Exact newest completed snapshot name")
    parser.add_argument("--plan-sha256")
    parser.add_argument("--ack-prune", action="store_true")
    args = parser.parse_args(argv)
    try:
        args.root = args.root.resolve()
        with refresh_lock(args.root) as lock_held:
            no_update_in_progress(args.root)
            backups, project, profile = root_state(args.root, args.origin)
            plan = enumerate_plan(args.root, backups, project, profile, args.retain)
            output = plan if args.action == "plan" else apply_prune(args, plan, backups, lock_held)
            print(json.dumps(output, indent=2, ensure_ascii=False, sort_keys=True))
            return 0
    except (Blocked, OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "blocked", "reason": str(exc)},
                         ensure_ascii=False), file=sys.stderr)
        return 78


if __name__ == "__main__":
    raise SystemExit(main())

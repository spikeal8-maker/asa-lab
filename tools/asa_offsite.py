"""Explicit encrypted, verified off-site copy of an existing ASA full backup.

No private age key is read. A user-provided public recipient must have an
independently preserved matching private recovery key. No scheduled upload.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from deployment.contracts import verify_backup
from deployment.system import operation_lock


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def remote_base(value: str) -> str:
    require(bool(re.fullmatch(r"[A-Za-z0-9_-]+:[A-Za-z0-9_./-]+", value)), "Недопустимый адрес rclone remote")
    require(not any(part in ("", ".", "..") for part in value.split(":", 1)[1].split("/")),
            "Удалённый путь не должен содержать пустые сегменты, . или ..")
    return value.rstrip("/")


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_current_backup(root: Path, backup: Path, recipient: Path) -> dict:
    require(backup.is_absolute() and backup.is_dir() and not backup.is_symlink(),
            "Укажите существующий абсолютный каталог полной резервной копии")
    require(recipient.is_absolute() and recipient.is_file() and not recipient.is_symlink(),
            "Необходим абсолютный путь к файлу публичных age recipients")
    recipients = [s.strip() for s in recipient.read_text(encoding="utf-8").splitlines()
                  if s.strip() and not s.lstrip().startswith("#")]
    require(bool(recipients) and all(re.fullmatch(r"age1[023456789acdefghjklmnpqrstuvwxyz]{40,120}", r)
                                     for r in recipients),
            "Файл должен содержать только публичные X25519 age recipients (age1...), не секретные ключи")
    require(backup.resolve().is_relative_to((root / "backups").resolve()),
            "Копия должна находиться в защищённом каталоге backups текущей установки")
    manifest = verify_backup(backup)
    installed = json.loads((root / ".asa" / "installed-release.json").read_text(encoding="utf-8"))
    current = manifest.get("runtime", {})
    require(current.get("revision") == installed.get("revision")
            and current.get("schema") == installed.get("schema"),
            "Backup не соответствует текущему релизу и схеме, отправка блокирована")
    require(manifest.get("profile") == "production", "Отправка допускается только для production backup")
    created = dt.datetime.strptime(manifest["createdAt"][:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    age = (dt.datetime.now(dt.timezone.utc) - created).total_seconds()
    require(0 <= age <= 24 * 3600, "Для offsite требуется полный backup не старше 24 часов")
    return manifest


def rclone_prefix(container: str | None, config: str | None) -> list[str]:
    if container:
        require(bool(re.fullmatch(r"[A-Za-z0-9_.-]+", container)), "Недопустимое имя rclone контейнера")
        return ["docker", "exec", "-i", container, "rclone",
                "--config", config or "/config/rclone/rclone.conf"]
    return ["rclone"] + (["--config", config] if config else [])


def export_encrypted(backup: Path, recipients: Path, archive: Path) -> None:
    with archive.open("wb") as encrypted:
        tar = subprocess.Popen(
            ["tar", "-C", str(backup.parent), "-cf", "-", backup.name],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        assert tar.stdout is not None
        try:
            age = subprocess.run(["age", "-R", str(recipients)], stdin=tar.stdout, stdout=encrypted,
                                 stderr=subprocess.PIPE, timeout=1200, check=False)
        finally:
            tar.stdout.close()
        tar_code = tar.wait(timeout=30)
    require(age.returncode == 0 and tar_code == 0 and archive.stat().st_size > 0,
            "Шифрование/архивирование завершилось ошибкой; загрузка запрещена")


def sha256_remote(command: list[str]) -> str:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    digest = hashlib.sha256()
    assert process.stdout is not None
    with process.stdout as output:
        for chunk in iter(lambda: output.read(1024 * 1024), b""):
            digest.update(chunk)
    require(process.wait(timeout=30) == 0, "Невозможно проверить удалённый файл чтением")
    return digest.hexdigest()


def send(root: Path, backup: Path, recipients: Path, destination: str,
         container: str | None, config: str | None) -> dict:
    require(root.is_absolute() and (root / ".asa").is_dir(), "Укажите корень действующей установки")
    with operation_lock(root):
        require(not (root / ".asa" / "maintenance.json").exists(),
                "Незавершённая операция обслуживания: отправка заблокирована")
        return _send_locked(root, backup, recipients, destination, container, config)


def _send_locked(root: Path, backup: Path, recipients: Path, destination: str,
                 container: str | None, config: str | None) -> dict:
    base = remote_base(destination)
    manifest = verify_current_backup(root, backup, recipients)
    require(shutil.which("tar") is not None and shutil.which("age") is not None,
            "Для шифрованного архива необходимы уже установленные tar и age")
    remote = base + "/asa-lab-" + backup.name + ".tar.age"
    prefix = rclone_prefix(container, config)
    previous = subprocess.run(prefix + ["lsjson", remote, "--stat"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    require(previous.returncode != 0, "Удалённый архив уже существует: запрещено перезаписывать")
    with tempfile.TemporaryDirectory(prefix="asa-offsite-", dir=root / ".asa") as temporary:
        archive = Path(temporary) / (backup.name + ".tar.age")
        export_encrypted(backup, recipients, archive)
        local_hash = file_hash(archive)
        with archive.open("rb") as payload:
            uploaded = subprocess.run(prefix + ["rcat", remote], stdin=payload,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                      timeout=1800, check=False)
        require(uploaded.returncode == 0, "Загрузка в rclone не завершилась успешно")
        downloaded_hash = sha256_remote(prefix + ["cat", remote])
        require(downloaded_hash == local_hash, "Хеши удалённого и локального ciphertext различаются")
    receipt = {
        "format": "asa-offsite-backup-v1", "verifiedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "backup": backup.name, "backupManifestSha256": file_hash(backup / "manifest.json"),
        "revision": manifest["runtime"]["revision"], "schema": manifest["runtime"]["schema"],
        "remote": remote, "encryptedSha256": local_hash, "verification": "full-remote-readback-sha256",
    }
    state = root / ".asa"
    handle, temporary = tempfile.mkstemp(prefix=".offsite-", suffix=".json", dir=state)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            json.dump(receipt, output, ensure_ascii=False, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, state / "offsite-last.json")
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--recipient-file", type=Path, required=True)
    parser.add_argument("--remote-base", required=True)
    parser.add_argument("--rclone-container", default=None)
    parser.add_argument("--rclone-config", default=None)
    args = parser.parse_args(argv)
    try:
        result = send(args.root, args.backup, args.recipient_file, args.remote_base,
                      args.rclone_container, args.rclone_config)
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, json.JSONDecodeError) as error:
        print(f"OFFSITE_BLOCKED: {error}", file=sys.stderr)
        return 78
    print(f"OFFSITE_VERIFIED backup={result['backup']} schema={result['schema']} "
          f"remote={result['remote']} encryptedSha256={result['encryptedSha256']}")
    print("ВАЖНО: удалённая копия пригодна к расшифровке только при наличии ОТДЕЛЬНО сохранённого приватного age ключа.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

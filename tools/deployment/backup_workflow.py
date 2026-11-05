"""Durable complete-backup, AGE and verified cloud delivery orchestration.

The caller owns .asa/operation.lock for the entire invocation. Provider tokens
stay in the existing pinned rclone container; this module never reads them.
"""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import types
import uuid

from .backup import export_backup, consume_backup_hold, resume_backup_writers, ensure_backup_durable
from .contracts import Blocked, file_hash, require, verify_backup
from .paths import atomic_json as _atomic_json, plain_paths


TRANSPORT_SHA256 = "c6e30c3d1fa8aaa57e14c89b22c5677af5f5c5e132881925f2197949d7797d08"
SNAPSHOT = re.compile(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}")
INSTALLATION = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
OPERATION = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{7,79}")
CLOUD_AVAILABILITY_ERRORS = frozenset({
    "CLOUD_UNAVAILABLE", "CLOUD_PROVIDER_GONE", "CLOUD_AUTHORIZATION",
    "CLOUD_TRANSFER_FAILED", "CLOUD_TIMEOUT", "CLOUD_NOT_CONNECTED",
})
RETENTION_JOURNAL_MAX_BYTES = 32 * 1024**2


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def cloud_unavailable(error):
    """Only known availability failures may weaken optional cloud protection."""
    return isinstance(error, Blocked) and error.code in CLOUD_AVAILABILITY_ERRORS


def _sync_directory(path):
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path, value):
    """A durable receipt must survive loss of the directory entry cache too."""
    _atomic_json(path, value)
    _sync_directory(Path(path).parent)


def cloud_project(installation_id):
    require(isinstance(installation_id, str) and INSTALLATION.fullmatch(installation_id),
            "BACKUP_IDENTITY", "Некорректный installation ID.")
    return "asa-" + (installation_id if len(installation_id) <= 60 else hashlib.sha256(installation_id.encode()).hexdigest()[:32])


def private_directory(path):
    path = Path(path)
    plain_paths(path, ())
    missing = []
    ancestor = path
    while not ancestor.exists():
        missing.append(ancestor)
        ancestor = ancestor.parent
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.stat()
    require(stat.S_ISDIR(info.st_mode) and (os.name == "nt" or
            (info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0)),
            "BACKUP_PRIVATE_DIRECTORY", "Каталог резервирования должен принадлежать оператору и иметь права 0700.")
    for created in missing:
        _sync_directory(created)
        _sync_directory(created.parent)
    return path


def read_private(path, *, max_bytes=2 * 1024**2):
    path = Path(path)
    plain_paths(path.parent, (path.name,))
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= max_bytes,
                "BACKUP_FILE_TYPE", "Файл состояния должен быть обычным файлом без дополнительных ссылок.")
        data = stream.read(max_bytes + 1)
        after = os.fstat(stream.fileno())
        require(len(data) == info.st_size and (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                "BACKUP_FILE_CHANGED", "Файл изменился во время чтения.")
        return data


def validate_policy(policy, installation_id):
    require(isinstance(policy, dict) and policy.get("policy") in ("required", "best-effort"),
            "BACKUP_POLICY", "Выберите и сохраните политику required или best-effort.")
    allowed = {"policy", "ageRecipient", "cloud", "maxWriteFreezeSeconds", "retention", "schedule"}
    require(set(policy) <= allowed, "BACKUP_POLICY", "Неизвестный параметр политики резервирования.")
    cloud = policy.get("cloud", {})
    require(isinstance(cloud, dict) and set(cloud) <= {"enabled", "transportPath", "transportSha256", "configPath", "rcloneConfigFile", "project"},
            "CLOUD_CONFIGURATION", "Некорректная конфигурация облачного транспорта.")
    require(type(cloud.get("enabled", False)) is bool, "CLOUD_CONFIGURATION", "enabled должен быть логическим значением.")
    expected = cloud_project(installation_id)
    require(cloud.get("project", expected) == expected, "CLOUD_NAMESPACE",
            "Облачное назначение должно быть отдельным для этой установки.")
    if policy["policy"] == "required":
        require(cloud.get("enabled") is True, "CLOUD_NOT_CONFIGURED",
                "Обязательное облачное резервирование ещё не настроено.",
                "Настройте облачное назначение до обновления; политика required сохраняется.")
        require(isinstance(policy.get("ageRecipient"), str) and re.fullmatch(r"age1[a-z0-9]{58}", policy["ageRecipient"]),
                "AGE_RECIPIENT", "Не настроен публичный AGE recipient для обязательной облачной копии.")
    freeze = policy.get("maxWriteFreezeSeconds", 900)
    require(type(freeze) is int and 30 <= freeze <= 7200, "BACKUP_FREEZE_TIMEOUT",
            "Время запрета записи должно быть от 30 до 7200 секунд.")
    retention = policy.get("retention", {})
    require(isinstance(retention, dict) and set(retention) <= {"localKeep", "remoteKeep"},
            "BACKUP_RETENTION", "Неизвестный параметр хранения копий.")
    for value in retention.values():
        require(value is None or type(value) is int and 1 <= value <= 10000,
                "BACKUP_RETENTION", "Хранение задаётся числом 1..10000; null отключает удаление.")
    return {**policy, "maxWriteFreezeSeconds": freeze, "cloud": {**cloud, "project": expected}, "retention": retention}


def _command(args, *, timeout=60, source=None, output=None):
    """Capture provider diagnostics privately; exceptions contain no raw stderr."""
    try:
        result = subprocess.run([str(arg) for arg in args], stdin=source, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise Blocked("BACKUP_COMMAND_TIMEOUT", "Операция резервирования превысила тайм-аут.",
                      "Проверьте журнал операции; сохранённый снимок можно отправить повторно.") from exc
    except OSError as exc:
        raise Blocked("BACKUP_TOOL", "Не удалось запустить необходимый инструмент.",
                      "Выполните проверку зависимостей через asa-setup.sh check.") from exc
    require(result.returncode == 0, "BACKUP_COMMAND_FAILED", "Команда резервирования завершилась с ошибкой.",
            "Проверьте доступ к инструменту и защищённую диагностику; данные не удалялись.")
    return result.stdout if output is None else None


def _budget(deadline, maximum=600):
    seconds = maximum if deadline is None else min(maximum, deadline - time.monotonic())
    require(seconds > 0, "BACKUP_FREEZE_TIMEOUT", "Истёк срок запрета записи.",
            "Проверьте возобновление прежних сервисов и повторите операцию.")
    return max(0.1, seconds)


def _receipt_root(install):
    return private_directory(install.state / "setup-backups")


def _save(install, receipt):
    receipt["updatedAt"] = now()
    if receipt["cloud"]["status"] == "OK":
        receipt["lastSuccessfulCloud"] = dict(receipt["cloud"])
    root = _receipt_root(install)
    atomic_json(root / (receipt["snapshotId"] + ".json"), receipt)
    atomic_json(root / "last-attempt.json", {"snapshotId": receipt["snapshotId"], "operationId": receipt["operationId"], "at": receipt["updatedAt"]})
    for part, name in (("local", "last-local-success.json"), ("cloud", "last-cloud-success.json")):
        if receipt[part]["status"] != "OK" or receipt[part].get("deletedAt"):
            continue
        pointer = root / name
        previous = json.loads(read_private(pointer)) if pointer.exists() else {}
        # A successful retry of an older archive must not replace the newest
        # successful snapshot. Capture time and delivery time remain distinct.
        if (receipt["snapshotAt"], receipt["snapshotId"]) >= (previous.get("at", ""), previous.get("snapshotId", "")):
            value = {"snapshotId": receipt["snapshotId"], "at": receipt["snapshotAt"]}
            if part == "cloud":
                value["deliveredAt"] = receipt["cloud"]["verifiedAt"]
                value["proof"] = receipt["cloud"]
            atomic_json(pointer, value)


def load_receipt(install, snapshot_id, installation_id):
    require(isinstance(snapshot_id, str) and SNAPSHOT.fullmatch(snapshot_id), "BACKUP_IDENTITY", "Некорректный snapshot ID.")
    value = json.loads(read_private(_receipt_root(install) / (snapshot_id + ".json")))
    require(value.get("format") == "asa-backup-operation-v1" and value.get("snapshotId") == snapshot_id
            and value.get("installationId") == installation_id, "BACKUP_RECEIPT_IDENTITY", "Квитанция относится к другой установке.")
    return value


def _local_root(install):
    root = Path(install.settings.get("backupDirectory") or install.root / "backups")
    require(root.is_absolute(), "BACKUP_PATH", "Каталог резервных копий должен быть абсолютным.")
    return private_directory(root)


def _verify_local(install, receipt):
    root = _local_root(install) / receipt["snapshotId"]
    require(receipt["local"].get("path") == str(root), "BACKUP_PATH", "Путь снимка изменился.")
    plain_paths(root, ())
    manifest = verify_backup(root)
    require(manifest.get("installationId") == receipt["installationId"]
            and manifest.get("operationId") == receipt["operationId"]
            and manifest.get("snapshotId") == receipt["snapshotId"],
            "BACKUP_SNAPSHOT_IDENTITY", "Манифест относится к другой операции или установке.")
    require(file_hash(root / "manifest.json") == receipt["local"]["manifestSha256"],
            "BACKUP_MANIFEST_DRIFT", "Манифест изменился после проверки.")
    return root, manifest


def encrypt_snapshot(install, receipt, recipient, *, deadline=None):
    source, manifest = _verify_local(install, receipt)
    require(isinstance(recipient, str) and re.fullmatch(r"age1[a-z0-9]{58}", recipient),
            "AGE_RECIPIENT", "Нужен действительный публичный AGE recipient.",
            "Сохраните публичный AGE recipient; приватный ключ расшифрования на сервере не нужен.")
    private_directory(_local_root(install) / "encrypted")
    target = _local_root(install) / "encrypted" / ("asa-lab-" + receipt["snapshotId"] + ".tar.age")
    if receipt["encryption"]["status"] == "OK":
        plain_paths(target.parent, (target.name,))
        require(receipt["encryption"].get("manifestSha256") == receipt["local"]["manifestSha256"]
                and receipt["encryption"]["path"] == str(target) and target.is_file()
                and file_hash(target) == receipt["encryption"]["sha256"],
                "BACKUP_CIPHERTEXT_DRIFT", "Сохранённый ciphertext отсутствует или изменился.")
        return target
    require(not target.exists(), "BACKUP_CIPHERTEXT_UNKNOWN", "Найден ciphertext без завершённой квитанции.",
            "Проверьте незавершённую квитанцию шифрования; не заменяйте файл вслепую.")
    # backupDirectory may be a separate disk. Publication must stay on that
    # filesystem, and a PREPARED receipt must never point into an automatically
    # cleaned TemporaryDirectory after a recoverable publication error.
    staging = private_directory(target.parent / ".staging")
    stage = Path(tempfile.mkdtemp(prefix=receipt["snapshotId"] + "-", dir=staging))
    archive = stage / "snapshot.tar"
    with tarfile.open(archive, "w") as bundle:
        for relative in ["manifest.json", *sorted(manifest["files"])]:
            plain_paths(source, (relative,))
            member = source / relative
            require(member.is_file() and not member.is_symlink(), "BACKUP_FILE_TYPE", "Небезопасный файл в полном снимке.")
            bundle.add(member, arcname=source.name + "/" + relative, recursive=False)
            _budget(deadline)
    archive.chmod(0o600)
    encrypted = stage / "snapshot.age"
    _command(["age", "--encrypt", "--recipient", recipient, "--output", encrypted, archive], timeout=_budget(deadline))
    encrypted.chmod(0o600)
    # Windows FlushFileBuffers needs a writable handle, as in durable export;
    # opening without truncation preserves the immutable ciphertext bytes.
    with encrypted.open("r+b" if os.name == "nt" else "rb") as stream:
        require(stream.read(40).startswith(b"age-encryption.org/v1\n"), "AGE_ENVELOPE", "AGE не создал допустимый конверт.")
        os.fsync(stream.fileno())
    _sync_directory(stage)
    _sync_directory(staging)
    digest = file_hash(encrypted)
    receipt["encryption"] = {"status": "PREPARED", "path": str(target), "sha256": digest,
                             "bytes": encrypted.stat().st_size, "encryptedAt": now(),
                             "recipient": recipient, "recipientSha256": hashlib.sha256(recipient.encode("ascii")).hexdigest(),
                             "preparedPath": str(encrypted),
                             "manifestSha256": receipt["local"]["manifestSha256"]}
    _save(install, receipt)
    _complete_encryption_receipt(install, receipt)
    # Failed attempts are retained for reconciliation. Only these exact files
    # can be removed after durable successful publication.
    try:
        archive.unlink()
        stage.rmdir()
        _sync_directory(staging)
    except OSError:
        receipt["encryption"]["stagingCleanup"] = "PENDING"
        _save(install, receipt)
    return target


def verify_receipt(install, *, snapshot_id, installation_id):
    """Revalidate saved proof without export, encryption, repair or network I/O.

    Cloud evidence describes the recorded delivery time. It is not a new remote
    availability check and cannot turn a failed or absent delivery into success.
    """
    receipt = load_receipt(install, snapshot_id, installation_id)
    if receipt.get("local", {}).get("status") == "OK":
        require(not receipt["local"].get("deletedAt"), "BACKUP_LOCAL_DELETED", "Локальный снимок уже удалён по политике хранения.")
        _verify_local(install, receipt)
    encryption = receipt.get("encryption", {})
    if encryption.get("status") == "OK":
        _verify_ciphertext(install, receipt)
    cloud = receipt.get("cloud", {})
    if cloud.get("status") == "OK":
        project = cloud_project(installation_id)
        expected = "yandex:Server-Backups/" + project + "/asa-lab-" + snapshot_id + ".tar.age"
        require(receipt.get("local", {}).get("status") == encryption.get("status") == "OK"
                and not cloud.get("deletedAt") and cloud.get("namespace") == project
                and cloud.get("remote") == expected and cloud.get("sha256") == encryption.get("sha256")
                and cloud.get("bytes") == encryption.get("bytes")
                and cloud.get("verification") == "independent-ciphertext-readback-sha256",
                "BACKUP_CLOUD_PROOF", "Сохранённая облачная квитанция не соответствует снимку и ciphertext этой установки.")
        try:
            timestamp = dt.datetime.fromisoformat(cloud["verifiedAt"])
            require(timestamp.tzinfo is not None, "BACKUP_CLOUD_PROOF", "Во времени доставки отсутствует часовой пояс.")
        except (KeyError, TypeError, ValueError) as exc:
            raise Blocked("BACKUP_CLOUD_PROOF", "В квитанции отсутствует достоверное время доставки.",
                          "Проверьте сохранённую квитанцию; успешная доставка не предполагается.") from exc
    return receipt


def _verify_ciphertext(install, receipt):
    encryption = receipt["encryption"]
    target = _local_root(install) / "encrypted" / ("asa-lab-" + receipt["snapshotId"] + ".tar.age")
    plain_paths(target.parent, (target.name,))
    recipient = encryption.get("recipient", "")
    require(isinstance(recipient, str) and re.fullmatch(r"age1[a-z0-9]{58}", recipient)
            and encryption.get("recipientSha256") == hashlib.sha256(recipient.encode("ascii")).hexdigest(),
            "BACKUP_RECIPIENT_IDENTITY", "В сохранённом доказательстве шифрования не подтверждён публичный recipient.")
    require(encryption.get("path") == str(target) and target.is_file() and not encryption.get("deletedAt")
            and encryption.get("manifestSha256") == receipt.get("local", {}).get("manifestSha256")
            and target.stat().st_size == encryption.get("bytes") and file_hash(target) == encryption.get("sha256"),
            "BACKUP_CIPHERTEXT_DRIFT", "Сохранённый ciphertext отсутствует или изменился после доставки.")
    return target


class CloudTransport:
    """Use the existing pinned Server-setings transport without exposing tokens."""

    def __init__(self, configuration, installation_id, *, deadline=None):
        self.deadline = deadline
        expected = cloud_project(installation_id)
        require(configuration.get("enabled") is True and configuration.get("project", expected) == expected,
                "CLOUD_CONFIGURATION", "Облачное назначение установки не настроено.")
        require(configuration.get("transportSha256") == TRANSPORT_SHA256, "CLOUD_TRANSPORT_PIN",
                "Версия облачного транспорта не совпадает с проверенным пакетом.")
        path = Path(configuration.get("transportPath", ""))
        require(path.is_absolute(), "CLOUD_TRANSPORT_PIN", "Путь транспорта должен быть абсолютным.")
        payload = read_private(path)
        require(hashlib.sha256(payload).hexdigest() == TRANSPORT_SHA256, "CLOUD_TRANSPORT_PIN", "Повреждён проверенный облачный транспорт.")
        module = types.ModuleType("asa_pinned_cloud_transport")
        module.__file__ = str(path)
        exec(compile(payload, str(path), "exec"), module.__dict__)
        self.transport = module
        self.project = expected
        self.remote = module.remote_path(expected)
        self.container = module.PROJECT + "-rclone-1"
        template = '{"image":{{json .Config.Image}},"user":{{json .Config.User}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}}}'
        try:
            raw = _command(["docker", "inspect", "--format", template, self.container], timeout=_budget(deadline, 30))
        except Blocked as error:
            if error.code in ("BACKUP_COMMAND_FAILED", "BACKUP_TOOL", "BACKUP_COMMAND_TIMEOUT"):
                raise Blocked("CLOUD_UNAVAILABLE", "Облачный транспорт недоступен.",
                              "Проверьте сохранённую локальную копию и повторите доставку.") from error
            raise
        info = json.loads(raw)
        require(isinstance(info, dict) and info.get("image") == module.IMAGE
                and info.get("user") == "1000:1000" and isinstance(info.get("labels"), dict)
                and info["labels"].get("asa.owner") == module.PROJECT and type(info.get("running")) is bool,
                "CLOUD_TRANSPORT_IDENTITY", "Не подтверждён закреплённый контейнер облачного транспорта.")
        require(info.get("running") is True, "CLOUD_UNAVAILABLE", "Проверенный облачный транспорт остановлен.")
        self.base = "/data/" + expected
        try:
            self._exec("sh", "-eu", "-c", 'umask 077; for d do if [ -e "$d" ]; then test -d "$d" && test ! -L "$d"; else mkdir "$d"; fi; done',
                       "asa-cloud-spool", self.base, self.base + "/outgoing", self.base + "/incoming")
        except Blocked as error:
            if error.code == "BACKUP_COMMAND_FAILED":
                raise Blocked("CLOUD_SPOOL_IDENTITY", "Не подтверждены безопасные каталоги облачного транспорта.",
                              "Проверьте spool; нарушение его целостности не является сбоем связи.") from error
            raise

    def _exec(self, *args, source=None, output=None):
        try:
            return _command(["docker", "exec", "-i", "--user", "1000:1000", self.container, *args],
                            timeout=_budget(self.deadline), source=source, output=output)
        except Blocked as error:
            if error.code in ("BACKUP_COMMAND_TIMEOUT", "BACKUP_TOOL"):
                code = "CLOUD_TIMEOUT" if error.code == "BACKUP_COMMAND_TIMEOUT" else "CLOUD_UNAVAILABLE"
                raise Blocked(code, "Облачный транспорт недоступен.", "Повторите доставку сохранённого ciphertext.") from error
            raise

    def call(self, *args):
        try:
            return self.transport.rclone(*args, timeout_seconds=_budget(self.deadline))
        except (ValueError, subprocess.TimeoutExpired) as exc:
            code = ("CLOUD_TIMEOUT" if isinstance(exc, subprocess.TimeoutExpired) else
                    str(exc) if re.fullmatch(r"CLOUD_[A-Z_]+", str(exc)) else "CLOUD_TRANSPORT_ERROR")
            raise Blocked(code, "Облачная передача не подтверждена.", "Повторите cloud-retry для сохранённого snapshot ID.") from exc

    def readback(self, remote_file, local_directory):
        local_directory = private_directory(local_directory)
        token = uuid.uuid4().hex
        container_file = self.base + "/incoming/verify-" + token + ".age"
        target = local_directory / (token + ".age")
        try:
            self.call("copyto", remote_file, container_file, "--immutable", "--checksum")
            with target.open("xb") as stream:
                os.chmod(target, 0o600)
                self._exec("cat", container_file, output=stream)
                stream.flush()
                os.fsync(stream.fileno())
            return {"sha256": file_hash(target), "bytes": target.stat().st_size, "verifiedAt": now()}
        finally:
            pending_error = sys.exc_info()[0] is not None
            try:
                target.unlink(missing_ok=True)
                _command(["docker", "exec", "--user", "1000:1000", self.container, "rm", "-f", "--", container_file], timeout=30)
            except (Blocked, OSError, ValueError, subprocess.SubprocessError):
                if not pending_error:
                    raise

    def deliver(self, ciphertext, receipt, verification_directory):
        name = self.transport.archive_name(Path(ciphertext).name)
        remote_file = self.remote + "/" + name
        expected = receipt["encryption"]["sha256"]
        require(file_hash(Path(ciphertext)) == expected and Path(ciphertext).stat().st_size == receipt["encryption"]["bytes"],
                "BACKUP_CIPHERTEXT_DRIFT", "Ciphertext изменился до передачи.")
        self.call("mkdir", self.remote)
        rows = json.loads(self.call("lsjson", "--files-only", "--max-depth", "1", self.remote))
        require(isinstance(rows, list) and all(isinstance(row, dict) and isinstance(row.get("Name"), str) for row in rows),
                "CLOUD_REMOTE_LIST", "Облако вернуло неподтверждённый список архивов.")
        exists = any(row.get("Name") == name for row in rows)
        if not exists:
            temporary = self.base + "/outgoing/" + name + "." + uuid.uuid4().hex + ".partial"
            with Path(ciphertext).open("rb") as stream:
                self._exec("sh", "-eu", "-c", 'umask 077; set -C; cat > "$1"', "asa-ciphertext", temporary, source=stream)
            try:
                staged = self._exec("sha256sum", temporary).decode("ascii").split()[0]
                require(staged == expected, "CLOUD_SPOOL_HASH", "Ciphertext изменился при передаче в защищённый spool.")
                # The provider sees a stable snapshot-specific immutable object.
                pending = self.remote + "/" + name + ".pending-" + receipt["operationId"] + ".age"
                # A prior interrupted upload can already have published this
                # exact pending object. Read its bytes before an immutable
                # conflict could be reduced to a generic provider failure.
                if not any(row["Name"] == pending.rsplit("/", 1)[1] for row in rows):
                    self.call("copyto", temporary, pending, "--immutable", "--checksum")
                proof = self.readback(pending, verification_directory)
                require(proof["sha256"] == expected and proof["bytes"] == receipt["encryption"]["bytes"],
                        "CLOUD_READBACK_HASH", "Удалённый ciphertext отличается от локального.")
                self.call("moveto", pending, remote_file, "--immutable", "--checksum")
            finally:
                pending_error = sys.exc_info()[0] is not None
                try:
                    _command(["docker", "exec", "--user", "1000:1000", self.container, "rm", "-f", "--", temporary], timeout=30)
                except (Blocked, OSError, ValueError, subprocess.SubprocessError):
                    if not pending_error:
                        raise
        proof = self.readback(remote_file, verification_directory)
        require(proof["sha256"] == expected and proof["bytes"] == receipt["encryption"]["bytes"],
                "CLOUD_READBACK_HASH", "Имя или размер совпадают, но удалённое содержимое не подтверждено.",
                "Сохраните обе копии и разберите конфликт; существующий архив не перезаписывается.")
        return {"status": "OK", "remote": remote_file, "namespace": self.project,
                "verification": "independent-ciphertext-readback-sha256", **proof}


def _outcome(receipt, policy):
    protected = all(receipt[part]["status"] == "OK" for part in ("local", "encryption", "cloud"))
    receipt["protectionConfirmed"] = protected
    receipt["outcome"] = "ACCEPTED" if protected else "BLOCKED" if policy["policy"] == "required" else "WARNING"
    return receipt


def _deliver(install, receipt, policy, *, deadline=None):
    if not policy["cloud"].get("enabled", False):
        receipt["cloud"] = {"status": "NOT_CONFIGURED"}
        return
    transport = CloudTransport(policy["cloud"], receipt["installationId"], deadline=deadline)
    receipt["cloud"] = transport.deliver(receipt["encryption"]["path"], receipt, _receipt_root(install) / "verification")


def _complete_encryption_receipt(install, receipt):
    encryption = receipt["encryption"]
    if encryption.get("status") == "PREPARED":
        target = _local_root(install) / "encrypted" / ("asa-lab-" + receipt["snapshotId"] + ".tar.age")
        plain_paths(target.parent, ())
        prepared = Path(encryption["preparedPath"]) if encryption.get("preparedPath") else None
        stage = _local_root(install) / "encrypted" / ".staging"
        if prepared is not None:
            require(prepared.is_relative_to(stage) and ".." not in prepared.parts,
                    "BACKUP_ENCRYPTION_INCOMPLETE", "Путь незавершённого ciphertext не принадлежит staging.")
            plain_paths(prepared.parent, ())
        if target.exists() and prepared is not None and prepared.exists():
            # A crash between no-overwrite link publication and unlink leaves
            # exactly two known links. Reconcile only this proven inode pair.
            a, b = target.lstat(), prepared.lstat()
            require(stat.S_ISREG(a.st_mode) and stat.S_ISREG(b.st_mode)
                    and (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino) and a.st_nlink == b.st_nlink == 2
                    and file_hash(target) == encryption.get("sha256"),
                    "BACKUP_ENCRYPTION_INCOMPLETE", "Неподтверждённые ссылки на незавершённый ciphertext.")
            prepared.unlink()
        if not target.exists() and encryption.get("preparedPath"):
            plain_paths(stage, (str(prepared.relative_to(stage)),))
            require(prepared.is_file() and file_hash(prepared) == encryption.get("sha256"),
                    "BACKUP_ENCRYPTION_INCOMPLETE", "Не найден подтверждённый незавершённый ciphertext.")
            os.link(prepared, target)
            prepared.unlink()
        plain_paths(target.parent, (target.name,))
        require(encryption.get("path") == str(target) and target.is_file()
                and file_hash(target) == encryption.get("sha256"),
                "BACKUP_ENCRYPTION_INCOMPLETE", "Шифрование прервано до подтверждённого завершения.",
                "Проверьте ciphertext и его незавершённую квитанцию перед повтором.")
        with target.open("r+b" if os.name == "nt" else "rb") as stream:
            os.fsync(stream.fileno())
        _sync_directory(target.parent)
        if prepared is not None and prepared.parent.exists():
            _sync_directory(prepared.parent)
        encryption["status"] = "OK"
        encryption.pop("preparedPath", None)
        _save(install, receipt)


def run_backup(install, *, operation_id, installation_id, policy, hold_writers=False, snapshot_id=None, allow_export=True):
    """Return a durable receipt; required cloud failure returns outcome=BLOCKED."""
    require(isinstance(operation_id, str) and OPERATION.fullmatch(operation_id), "BACKUP_IDENTITY", "Некорректный operation ID.")
    policy = validate_policy(policy, installation_id)
    root = _receipt_root(install)
    binding = root / ("operation-" + operation_id + ".json")
    require(type(allow_export) is bool, "BACKUP_RESUME_MODE", "Некорректный режим продолжения копии.")
    require(allow_export or binding.exists(), "BACKUP_RESUME_IDENTITY", "Нет сохранённой привязки операции к снимку.",
            "Проверьте исходный operation ID; продолжение не создаёт новый снимок.")
    if binding.exists():
        existing = json.loads(read_private(binding))
        require(existing.get("installationId") == installation_id, "BACKUP_IDENTITY", "Операция относится к другой установке.")
        require(snapshot_id is None or snapshot_id == existing["snapshotId"], "BACKUP_IDENTITY", "Snapshot ID операции уже закреплён.")
        snapshot_id = existing["snapshotId"]
    else:
        snapshot_id = snapshot_id or dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
        require(SNAPSHOT.fullmatch(snapshot_id), "BACKUP_IDENTITY", "Некорректный snapshot ID.")
        atomic_json(binding, {"installationId": installation_id, "snapshotId": snapshot_id, "operationId": operation_id})
    receipt_path = root / (snapshot_id + ".json")
    require(allow_export or receipt_path.exists(), "BACKUP_RESUME_IDENTITY", "Нет сохранённой квитанции снимка.",
            "Проверьте исходный журнал резервирования; новый export запрещён.")
    if receipt_path.exists():
        receipt = load_receipt(install, snapshot_id, installation_id)
        require(receipt["operationId"] == operation_id, "BACKUP_IDENTITY", "Snapshot ID уже принадлежит другой операции.")
    else:
        receipt = {"format": "asa-backup-operation-v1", "installationId": installation_id,
                   "operationId": operation_id, "snapshotId": snapshot_id, "snapshotAt": None,
                   "local": {"status": "PENDING", "executionStatus": "NOT_RUN"}, "encryption": {"status": "PENDING" if policy.get("ageRecipient") else "NOT_CONFIGURED"},
                   "cloud": {"status": "PENDING" if policy["cloud"].get("enabled", False) else "NOT_CONFIGURED"}, "restore": {"status": "UNVERIFIED"},
                   "writers": {"held": False}, "policy": policy["policy"],
                   "cloudConfigured": policy["cloud"].get("enabled", False), "errors": [], "outcome": "PENDING"}
        _save(install, receipt)
    require(receipt["policy"] == policy["policy"], "BACKUP_POLICY_CHANGED", "Политику активной операции нельзя ослаблять.")
    final = _local_root(install) / snapshot_id
    deadline = None
    stage = "local"
    try:
        if receipt["local"]["status"] != "OK":
            if not final.exists():
                require(allow_export, "BACKUP_RESUME_SNAPSHOT_MISSING", "Полный сохранённый снимок отсутствует; новый export запрещён.",
                        "Разберите исходный incomplete snapshot; для новой копии нужна отдельная операция backup.")
                require(not final.with_name(snapshot_id + ".incomplete").exists(), "BACKUP_INCOMPLETE",
                        "Снимок прерван; повторное создание с тем же ID заблокировано.",
                        "Продолжите известную операцию после проверки её стадии и исходных сервисов.")
                # Durable intent distinguishes an export that never began from
                # an interrupted/lost copy. Legacy receipts remain unconfirmed.
                receipt["local"]["executionStatus"] = "RUNNING"
                _save(install, receipt)
                final = export_backup(install, snapshot_id=snapshot_id, installation_id=installation_id,
                                      operation_id=operation_id, hold_writers=hold_writers,
                                      freeze_timeout_seconds=policy["maxWriteFreezeSeconds"])
            else:
                # A previous process can leave final visible after a failed
                # directory fsync and a failed rollback rename. Hashes alone
                # cannot establish that its bytes are durable before switch.
                if hold_writers:
                    deadline = consume_backup_hold(install, operation_id)["deadlineMonotonic"]
                ensure_backup_durable(final, deadline=deadline)
            manifest = verify_backup(final)
            require(manifest.get("installationId") == installation_id and manifest.get("operationId") == operation_id
                    and manifest.get("snapshotId") == snapshot_id, "BACKUP_SNAPSHOT_IDENTITY", "Найден посторонний снимок.")
            manifest_hash = file_hash(final / "manifest.json")
            require(not receipt["local"].get("manifestSha256") or receipt["local"]["manifestSha256"] == manifest_hash,
                    "BACKUP_MANIFEST_DRIFT", "Ранее закреплённый манифест снимка изменился; повторная приёмка запрещена.")
            receipt["snapshotAt"] = manifest["snapshotAt"]
            receipt["local"] = {"status": "OK", "path": str(final), "manifestSha256": file_hash(final / "manifest.json"),
                                "verifiedAt": now(), "files": len(manifest["files"])}
            _save(install, receipt)
        _verify_local(install, receipt)
        stage = "hold"
        if hold_writers:
            hold = consume_backup_hold(install, operation_id)
            deadline = hold["deadlineMonotonic"]
            receipt["writers"] = {"held": True, "deadlineEpoch": hold["deadlineEpoch"],
                                 "deadlineMonotonic": deadline, "services": list(hold["containers"])}
        else:
            if (install.state / "maintenance.json").exists():
                resume_backup_writers(install, operation_id)
            receipt["writers"] = {"held": False, "consistency": "snapshot-time", "writesAfterSnapshotIncluded": False}
        stage = "encryption"
        _complete_encryption_receipt(install, receipt)
        optional_unconfigured = receipt["encryption"]["status"] in ("PENDING", "NOT_CONFIGURED") or (
            receipt["encryption"]["status"] == "FAILED" and receipt["encryption"].get("error") == "AGE_RECIPIENT"
            and not receipt["encryption"].get("path"))
        if not policy.get("ageRecipient") and optional_unconfigured:
            receipt["encryption"] = {"status": "NOT_CONFIGURED"}
            receipt["cloud"] = {"status": "NOT_CONFIGURED", "reasonCode": "AGE_NOT_CONFIGURED"}
        else:
            encrypt_snapshot(install, receipt, policy.get("ageRecipient"), deadline=deadline)
            stage = "cloud"
            _deliver(install, receipt, policy, deadline=deadline)
        _outcome(receipt, policy)
    except (Blocked, OSError, ValueError, subprocess.SubprocessError) as exc:
        code = exc.code if isinstance(exc, Blocked) else type(exc).__name__
        receipt["errors"].append({"code": code, "at": now()})
        if stage == "local":
            receipt["local"].update(status="FAILED", error=code)
            if code == "BACKUP_RESUME_SNAPSHOT_MISSING" and (receipt.get("snapshotAt")
                    or any(receipt["local"].get(key) for key in ("verifiedAt", "manifestSha256"))
                    or final.with_name(snapshot_id + ".incomplete").exists()):
                receipt["local"]["executionStatus"] = "UNKNOWN"
        elif stage == "encryption":
            receipt["encryption"].update(status="PREPARED" if receipt["encryption"]["status"] == "PREPARED" else "FAILED", error=code)
        elif stage == "cloud":
            receipt["cloud"] = {"status": "FAILED", "error": code}
        _outcome(receipt, policy)
        if stage != "cloud" or not cloud_unavailable(exc):
            receipt["outcome"] = "BLOCKED"
    if deadline is not None and time.monotonic() >= deadline:
        receipt["outcome"] = "BLOCKED"
        receipt["errors"].append({"code": "BACKUP_FREEZE_TIMEOUT", "at": now()})
    if receipt["outcome"] == "BLOCKED" and (install.state / "maintenance.json").exists():
        try:
            restored = resume_backup_writers(install, operation_id)
            receipt["writers"] = {"held": False, **restored}
        except (Blocked, OSError, ValueError) as recovery:
            receipt["writers"] = {"held": "UNKNOWN", "status": "FAILED",
                                  "error": recovery.code if isinstance(recovery, Blocked) else type(recovery).__name__}
            receipt["outcome"] = "ERROR"
    _save(install, receipt)
    return receipt


def retry_delivery(install, *, snapshot_id, installation_id, policy):
    """Retry only encryption completion/delivery of an already saved ciphertext."""
    policy = validate_policy(policy, installation_id)
    receipt = load_receipt(install, snapshot_id, installation_id)
    require(receipt["policy"] == policy["policy"], "BACKUP_POLICY_CHANGED", "Политику сохранённой операции нельзя ослаблять при повторе доставки.")
    _verify_local(install, receipt)
    _complete_encryption_receipt(install, receipt)
    require(receipt["encryption"]["status"] == "OK", "BACKUP_CIPHERTEXT_MISSING",
            "Нет подтверждённого ciphertext для повтора доставки.", "Завершите исходную операцию backup; обновление повторять не нужно.")
    _verify_ciphertext(install, receipt)
    try:
        _deliver(install, receipt, policy)
        _outcome(receipt, policy)
    except (Blocked, OSError, ValueError, subprocess.SubprocessError) as exc:
        code = exc.code if isinstance(exc, Blocked) else type(exc).__name__
        receipt["errors"].append({"code": code, "at": now()})
        receipt["cloud"] = {"status": "FAILED", "error": code}
        _outcome(receipt, policy)
        if not cloud_unavailable(exc):
            receipt["outcome"] = "BLOCKED"
    _save(install, receipt)
    return receipt


def _retention_receipts(install, installation_id):
    root = _receipt_root(install)
    receipts = []
    for path in root.glob("*.json"):
        if SNAPSHOT.fullmatch(path.stem):
            receipt = load_receipt(install, path.stem, installation_id)
            if receipt["local"]["status"] == "OK":
                receipts.append(receipt)
    receipts.sort(key=lambda value: (value["snapshotAt"], value["snapshotId"]), reverse=True)
    return receipts


def _retention_protected(install, installation_id, receipts, protected_snapshot_ids):
    root = _receipt_root(install)
    protected = set(protected_snapshot_ids)
    require(all(isinstance(value, str) and SNAPSHOT.fullmatch(value) for value in protected),
            "RETENTION_IDENTITY", "Некорректный защищённый snapshot ID.")
    protected.update(receipt["snapshotId"] for receipt in receipts
                     if receipt.get("cloudConfigured") and receipt["cloud"]["status"] != "OK")
    for pointer in ("last-local-success.json", "last-cloud-success.json"):
        plain_paths(root, (pointer,))
        if (root / pointer).exists():
            saved = json.loads(read_private(root / pointer))
            require(isinstance(saved, dict) and isinstance(saved.get("snapshotId"), str)
                    and SNAPSHOT.fullmatch(saved["snapshotId"]),
                    "RETENTION_POINTER", "Указатель последней подтверждённой копии повреждён.")
            protected.add(saved["snapshotId"])
    # Active/ambiguous setup operations and restore operations are never garbage.
    plain_paths(install.state / "setup-operations", ())
    for path in (install.state / "setup-operations").glob("*.json"):
        operation = json.loads(read_private(path))
        # Store's versioned journal keeps the outcome in result, not at the
        # top level. Unknown formats/states remain protected conservatively.
        finished = (operation.get("format") == "asa-setup-operation-v1"
                    and operation.get("installationId") == installation_id
                    and operation.get("state") == "TERMINAL"
                    and isinstance(operation.get("result"), dict)
                    and operation["result"].get("outcome") in
                    ("ACCEPTED", "WARNING", "NO_CHANGE", "CHECKED", "CONFIGURED", "STATUS", "PLANNED"))
        if not finished or operation.get("mode") == "restore":
            raw = json.dumps(operation)
            protected.update(match.group(0) for match in SNAPSHOT.finditer(raw))
    return protected


def _retention_binding(receipt, kind):
    fields = {"local": ("path", "manifestSha256"),
              "encryption": ("status", "path", "sha256", "bytes", "manifestSha256")}
    if kind == "remote":
        fields["cloud"] = ("status", "remote", "namespace", "sha256", "bytes", "verification", "verifiedAt")
    return {"operationId": receipt["operationId"], "snapshotAt": receipt["snapshotAt"],
            **{part: {key: receipt[part].get(key) for key in keys} for part, keys in fields.items()}}


def _retention_identity(path):
    info = path.stat()
    return [info.st_dev, info.st_ino]


def _retention_snapshot(install, receipt, action):
    """Validate remaining bytes against the original manifest after an intent.

    The manifest is removed last. A crash can therefore leave a partial tree,
    but cannot authorize removal of new files or a substituted snapshot inode.
    """
    target = _local_root(install) / receipt["snapshotId"]
    plain_paths(target, ())
    require(receipt["local"].get("path") == str(target), "RETENTION_PATH", "Путь снимка изменился.")
    if not target.exists():
        require(action["status"] in ("INTENT", "DONE"), "RETENTION_MISSING", "Снимок исчез до намерения удалить его.")
        return target, []
    require(action["status"] != "DONE" and target.is_dir()
            and _retention_identity(target) == action.get("identity"),
            "RETENTION_IDENTITY", "Каталог снимка заменён после проверки; удаление запрещено.")
    manifest_path = target / "manifest.json"
    plain_paths(target, ("manifest.json",))
    if not manifest_path.exists():
        require(action["status"] == "INTENT" and not any(target.iterdir()),
                "RETENTION_MANIFEST", "Без исходного манифеста можно завершить только удаление пустого каталога.")
        return target, []
    require(manifest_path.is_file() and file_hash(manifest_path) == receipt["local"]["manifestSha256"],
            "RETENTION_MANIFEST", "Манифест удаляемого снимка изменился.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(manifest.get("format") == "asa-backup-v1" and manifest.get("complete") is True
            and all(manifest.get(key) == receipt[key] for key in ("installationId", "operationId", "snapshotId"))
            and isinstance(manifest.get("files"), dict),
            "RETENTION_IDENTITY", "Манифест не принадлежит удаляемой копии этой установки.")
    present = set()
    members = []
    for path in target.rglob("*"):
        relative = path.relative_to(target).as_posix()
        plain_paths(target, (relative,))
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
                "RETENTION_FILE_TYPE", "Удаляемый снимок содержит неподтверждённый тип файла.")
        if relative != "manifest.json":
            members.append((path, info))
        if stat.S_ISREG(info.st_mode) and relative != "manifest.json":
            present.add(relative)
            require(manifest["files"].get(relative) == {"sha256": file_hash(path), "bytes": info.st_size},
                    "RETENTION_HASH", "Оставшиеся файлы отличаются от исходного манифеста; удаление запрещено.")
    require(action["status"] == "INTENT" or present == set(manifest["files"]),
            "RETENTION_MISSING", "Файлы исчезли до сохранённого намерения удаления.")
    return target, members


def _retention_ciphertext(install, receipt, action):
    target = _local_root(install) / "encrypted" / ("asa-lab-" + receipt["snapshotId"] + ".tar.age")
    plain_paths(target.parent, (target.name,))
    if not target.exists():
        require(action["status"] in ("ABSENT", "INTENT", "DONE"),
                "RETENTION_MISSING", "Ciphertext исчез до намерения удалить его.")
        return target
    require(action["status"] not in ("ABSENT", "DONE") and _retention_identity(target) == action.get("identity"),
            "RETENTION_IDENTITY", "Ciphertext заменён после проверки; удаление запрещено.")
    _verify_ciphertext(install, receipt)
    return target


def _retention_remote(install, receipt, transport):
    namespace = cloud_project(receipt["installationId"])
    base = "yandex:Server-Backups/" + namespace
    remote = base + "/asa-lab-" + receipt["snapshotId"] + ".tar.age"
    cloud, encryption = receipt["cloud"], receipt["encryption"]
    require(transport.remote == base and transport.project == namespace and cloud.get("remote") == remote
            and cloud.get("namespace") == namespace, "RETENTION_NAMESPACE", "Архив не принадлежит назначению этой установки.")
    require(cloud.get("status") == encryption.get("status") == "OK"
            and encryption.get("manifestSha256") == receipt["local"].get("manifestSha256")
            and isinstance(encryption.get("sha256"), str) and re.fullmatch(r"[a-f0-9]{64}", encryption["sha256"])
            and type(encryption.get("bytes")) is int and encryption["bytes"] > 0
            and cloud.get("sha256") == encryption["sha256"] and cloud.get("bytes") == encryption["bytes"]
            and cloud.get("verification") == "independent-ciphertext-readback-sha256",
            "RETENTION_CLOUD_PROOF", "Облачная квитанция не соответствует подтверждённому ciphertext.")
    return remote


def _retention_remote_present(transport, remote):
    rows = json.loads(transport.call("lsjson", "--files-only", "--max-depth", "1", transport.remote))
    require(isinstance(rows, list) and all(isinstance(row, dict) and isinstance(row.get("Name"), str)
            and row.get("IsDir", False) is False for row in rows),
            "RETENTION_REMOTE_LIST", "Не удалось подтвердить наличие архива в облаке.")
    return any(row["Name"] == remote.rsplit("/", 1)[1] for row in rows)


def _retention_readback(install, receipt, transport, action=None):
    remote = _retention_remote(install, receipt, transport)
    if action is not None and not _retention_remote_present(transport, remote):
        require(action["status"] == "INTENT", "RETENTION_MISSING", "Архив исчез до намерения удалить его.")
        return False
    proof = transport.readback(remote, _receipt_root(install) / "verification")
    require(proof.get("sha256") == receipt["encryption"]["sha256"]
            and proof.get("bytes") == receipt["encryption"]["bytes"],
            "RETENTION_HASH", "Удалённый архив изменился; удаление запрещено.")
    return True


def _retention_plan(install, installation_id, policy, receipts, protected):
    entries = []
    for kind, key in (("remote", "remoteKeep"), ("local", "localKeep")):
        keep = policy["retention"].get(key)
        if keep is None:
            continue
        eligible = [value for value in receipts if not value[kind if kind == "local" else "cloud"].get("deletedAt")
                    and (kind == "local" or value["cloud"]["status"] == "OK")]
        retained = {value["snapshotId"] for value in eligible[:keep]} | protected
        for receipt in eligible[keep:]:
            if receipt["snapshotId"] in retained:
                continue
            entry = {"kind": kind, "snapshotId": receipt["snapshotId"], "status": "PLANNED",
                     "binding": _retention_binding(receipt, kind)}
            if kind == "remote":
                entry["remote"] = {"status": "PLANNED"}
            else:
                local, _ = _verify_local(install, receipt)
                entry["snapshot"] = {"status": "PLANNED", "identity": _retention_identity(local)}
                ciphertext = _local_root(install) / "encrypted" / ("asa-lab-" + receipt["snapshotId"] + ".tar.age")
                plain_paths(ciphertext.parent, (ciphertext.name,))
                if ciphertext.exists():
                    require(receipt["encryption"].get("status") == "OK", "RETENTION_CIPHERTEXT",
                            "Ciphertext без завершённой квитанции не удаляется.")
                    _verify_ciphertext(install, receipt)
                    entry["ciphertext"] = {"status": "PLANNED", "identity": _retention_identity(ciphertext)}
                else:
                    require(receipt["encryption"].get("status") != "OK" or receipt["encryption"].get("deletedAt"),
                            "RETENTION_MISSING", "Подтверждённый ciphertext отсутствует до удаления.")
                    entry["ciphertext"] = {"status": "ABSENT"}
            entries.append(entry)
    return {"format": "asa-backup-retention-journal-v1", "journalId": uuid.uuid4().hex,
            "installationId": installation_id, "backupRoot": str(_local_root(install)),
            "retention": {key: policy["retention"].get(key) for key in ("localKeep", "remoteKeep")},
            "state": "RUNNING", "createdAt": now(), "entries": entries}


def _retention_validate(install, installation_id, journal, receipts, protected, transport):
    by_id = {receipt["snapshotId"]: receipt for receipt in receipts}
    planned = {kind: set() for kind in ("local", "remote")}
    active = set()
    for entry in journal["entries"]:
        kind, snapshot_id = entry.get("kind"), entry.get("snapshotId")
        require(kind in planned and snapshot_id in by_id and snapshot_id not in planned[kind]
                and entry.get("status") in ("PLANNED", "DONE"),
                "RETENTION_JOURNAL", "Некорректная запись журнала удаления.")
        planned[kind].add(snapshot_id)
        receipt = by_id[snapshot_id]
        require(entry.get("binding") == _retention_binding(receipt, kind),
                "RETENTION_RECEIPT_CHANGED", "Квитанция изменилась после сохранения плана удаления.")
        if entry["status"] == "DONE":
            continue
        require(snapshot_id not in protected, "RETENTION_PROTECTED", "Снимок защищён активной операцией или последним подтверждением.")
        for name in (("snapshot", "ciphertext") if kind == "local" else ("remote",)):
            require(isinstance(entry.get(name), dict) and entry[name].get("status") in ("PLANNED", "INTENT", "DONE", "ABSENT")
                    and (entry[name]["status"] != "ABSENT" or name == "ciphertext"),
                    "RETENTION_JOURNAL", "Неизвестное состояние намерения удаления.")
            if entry[name]["status"] not in ("DONE", "ABSENT"):
                active.add(kind)
        if kind == "local":
            _retention_snapshot(install, receipt, entry["snapshot"])
            _retention_ciphertext(install, receipt, entry["ciphertext"])
        elif entry["remote"]["status"] != "DONE":
            _retention_readback(install, receipt, transport, entry["remote"])
    # A newest-success pointer is historical evidence, not proof that the last
    # remaining copy is still intact. Recheck a survivor before the first delete.
    for kind, excluded in planned.items():
        if kind not in active:
            continue
        part = "local" if kind == "local" else "cloud"
        survivors = [value for value in receipts if value["snapshotId"] not in excluded
                     and value[part]["status"] == "OK" and not value[part].get("deletedAt")]
        require(survivors, "RETENTION_LAST_COPY", "Нельзя удалить последнюю подтверждённую копию.")
        if kind == "local":
            _verify_local(install, survivors[0])
        else:
            _retention_readback(install, survivors[0], transport)


def _retention_step(path, journal, action, delete):
    if action["status"] in ("DONE", "ABSENT"):
        return
    if action["status"] == "PLANNED":
        action.update(status="INTENT", intentAt=now())
        atomic_json(path, journal)
    delete()
    action.update(status="DONE", deletedAt=now())
    atomic_json(path, journal)


def _retention_remove_snapshot(install, receipt, action):
    target, members = _retention_snapshot(install, receipt, action)
    if target.exists():
        # Leave the original manifest until every other member is gone. Resume
        # can validate a subset after a crash without inventing new ownership.
        # Use exactly the checked inventory. A new file appearing afterwards
        # keeps rmdir from succeeding; it is never swept into the deletion.
        members.sort(key=lambda member: (len(member[0].parts), str(member[0])), reverse=True)
        for member, before in members:
            plain_paths(target, (member.relative_to(target).as_posix(),))
            current = member.lstat()
            require((current.st_dev, current.st_ino, stat.S_IFMT(current.st_mode))
                    == (before.st_dev, before.st_ino, stat.S_IFMT(before.st_mode)),
                    "RETENTION_IDENTITY", "Файл или каталог заменён после проверки удаления.")
            if stat.S_ISDIR(current.st_mode):
                _sync_directory(member)
                member.rmdir()
            else:
                require((current.st_size, current.st_mtime_ns) == (before.st_size, before.st_mtime_ns),
                        "RETENTION_HASH", "Файл изменился после проверки удаления.")
                member.unlink()
        _sync_directory(target)
        manifest = target / "manifest.json"
        plain_paths(target, (manifest.name,))
        require(not manifest.exists() or file_hash(manifest) == receipt["local"]["manifestSha256"],
                "RETENTION_MANIFEST", "Манифест заменён во время удаления.")
        manifest.unlink(missing_ok=True)
        _sync_directory(target)
        require(_retention_identity(target) == action["identity"], "RETENTION_IDENTITY", "Удаляемый каталог заменён.")
        target.rmdir()
    _sync_directory(target.parent)


def _retention_remove_ciphertext(install, receipt, action):
    target = _retention_ciphertext(install, receipt, action)
    target.unlink(missing_ok=True)
    _sync_directory(target.parent)


def _apply_retention(install, *, installation_id, policy, protected_snapshot_ids=()):
    """Validate the whole plan, then durably journal every deletion and result.

    The caller's installation lock covers planning, deletion and replay. Missing
    bytes are accepted only for a previously durable intent; provider failures
    are never interpreted as successful remote deletion.
    """
    policy = validate_policy(policy, installation_id)
    root = _receipt_root(install)
    directory = private_directory(root / "retention")
    pending = []
    for path in sorted(directory.glob("*.json")):
        saved = json.loads(read_private(path, max_bytes=RETENTION_JOURNAL_MAX_BYTES))
        require(saved.get("format") == "asa-backup-retention-journal-v1"
                and saved.get("installationId") == installation_id and saved.get("journalId") == path.stem
                and re.fullmatch(r"[a-f0-9]{32}", path.stem) and saved.get("state") in ("RUNNING", "DONE"),
                "RETENTION_JOURNAL", "Журнал удаления не принадлежит этой установке.")
        if saved["state"] != "DONE":
            pending.append(saved)
    require(len(pending) <= 1, "RETENTION_JOURNAL", "Найдено несколько незавершённых планов удаления.")
    receipts = _retention_receipts(install, installation_id)
    protected = _retention_protected(install, installation_id, receipts, protected_snapshot_ids)
    journal = pending[0] if pending else _retention_plan(install, installation_id, policy, receipts, protected)
    require(journal.get("backupRoot") == str(_local_root(install))
            and journal.get("retention") == {key: policy["retention"].get(key) for key in ("localKeep", "remoteKeep")}
            and isinstance(journal.get("entries"), list),
            "RETENTION_POLICY_CHANGED", "Путь или политика хранения изменились после намерения удаления.")
    needs_remote = any(entry.get("kind") == "remote" and entry.get("status") != "DONE"
                       and entry.get("remote", {}).get("status") != "DONE" for entry in journal["entries"])
    transport = CloudTransport(policy["cloud"], installation_id) if needs_remote else None
    _retention_validate(install, installation_id, journal, receipts, protected, transport)
    # Reserve enough bounded journal space for every intent/result timestamp,
    # completed deletion list and the current protection set before deleting.
    projected_bytes = len(json.dumps(journal, ensure_ascii=True, indent=2).encode())
    projected_bytes += len(json.dumps(sorted(protected)).encode()) + 1024 * (len(journal["entries"]) + 1)
    require(projected_bytes <= RETENTION_JOURNAL_MAX_BYTES, "RETENTION_JOURNAL_SIZE",
            "План удаления превышает безопасный размер журнала; файлы не удалялись.")
    path = directory / (journal["journalId"] + ".json")
    if journal["entries"] and not pending:
        atomic_json(path, journal)
    for entry in journal["entries"]:
        if entry["status"] == "DONE":
            continue
        receipt = load_receipt(install, entry["snapshotId"], installation_id)
        if entry["kind"] == "remote":
            def delete_remote():
                if _retention_readback(install, receipt, transport, entry["remote"]):
                    transport.call("deletefile", _retention_remote(install, receipt, transport))
            _retention_step(path, journal, entry["remote"], delete_remote)
            receipt["cloud"]["deletedAt"] = entry["remote"]["deletedAt"]
        else:
            _retention_step(path, journal, entry["snapshot"],
                            lambda: _retention_remove_snapshot(install, receipt, entry["snapshot"]))
            _retention_step(path, journal, entry["ciphertext"],
                            lambda: _retention_remove_ciphertext(install, receipt, entry["ciphertext"]))
            receipt["local"]["deletedAt"] = entry["snapshot"]["deletedAt"]
            if entry["ciphertext"]["status"] == "DONE":
                receipt["encryption"]["deletedAt"] = entry["ciphertext"]["deletedAt"]
        atomic_json(root / (receipt["snapshotId"] + ".json"), receipt)
        entry["status"] = "DONE"
        atomic_json(path, journal)
    result = {"format": "asa-backup-retention-v1", "protectedSnapshotIds": sorted(protected),
              "deleted": {kind: [entry["snapshotId"] for entry in journal["entries"] if entry["kind"] == kind]
                          for kind in ("local", "remote")}, "at": now()}
    if journal["entries"]:
        journal.update(state="DONE", result=result, completedAt=result["at"])
        atomic_json(path, journal)
    return result


def apply_retention(install, *, installation_id, policy, protected_snapshot_ids=()):
    """Keep optional cloud housekeeping from blocking future local backups.

    Deferral makes no claim that deletion finished. Any durable intent remains
    in the retention journal and must be revalidated by the next invocation.
    Integrity, namespace, policy and unknown failures still propagate.
    """
    policy = validate_policy(policy, installation_id)
    try:
        return _apply_retention(install, installation_id=installation_id, policy=policy,
                                protected_snapshot_ids=protected_snapshot_ids)
    except Blocked as error:
        if policy["policy"] != "best-effort" or not cloud_unavailable(error):
            raise
        return {"format": "asa-backup-retention-v1", "status": "DEFERRED", "reasonCode": error.code, "at": now(),
                "nextAction": "Удаление отложено из-за недоступности облака. Следующий backup повторно проверит незавершённый план хранения."}

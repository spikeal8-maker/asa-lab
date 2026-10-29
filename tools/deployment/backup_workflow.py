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
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import types
import uuid

from .backup import export_backup, consume_backup_hold, resume_backup_writers, ensure_backup_durable
from .contracts import Blocked, file_hash, require, verify_backup
from .paths import atomic_json as _atomic_json, plain_paths


TRANSPORT_SHA256 = "72e35bbb3043acefb423cfe706f82b089eaba974deb04f16df8f335093c59d0c"
SNAPSHOT = re.compile(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}")
INSTALLATION = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
OPERATION = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{7,79}")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


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


def read_private(path):
    path = Path(path)
    plain_paths(path.parent, (path.name,))
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 2 * 1024**2,
                "BACKUP_FILE_TYPE", "Файл состояния должен быть обычным файлом без дополнительных ссылок.")
        data = stream.read(2 * 1024**2 + 1)
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
        target = _local_root(install) / "encrypted" / ("asa-lab-" + snapshot_id + ".tar.age")
        plain_paths(target.parent, (target.name,))
        recipient = encryption.get("recipient", "")
        require(isinstance(recipient, str) and re.fullmatch(r"age1[a-z0-9]{58}", recipient)
                and encryption.get("recipientSha256") == hashlib.sha256(recipient.encode("ascii")).hexdigest(),
                "BACKUP_RECIPIENT_IDENTITY", "В сохранённом доказательстве шифрования не подтверждён публичный recipient.")
        require(encryption.get("path") == str(target) and target.is_file()
                and encryption.get("manifestSha256") == receipt.get("local", {}).get("manifestSha256")
                and target.stat().st_size == encryption.get("bytes") and file_hash(target) == encryption.get("sha256"),
                "BACKUP_CIPHERTEXT_DRIFT", "Сохранённый ciphertext отсутствует или изменился после доставки.")
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
        info = json.loads(_command(["docker", "inspect", "--format", template, self.container], timeout=_budget(deadline, 30)))
        require(info.get("image") == module.IMAGE and info.get("running") is True
                and info.get("user") == "1000:1000" and (info.get("labels") or {}).get("asa.owner") == module.PROJECT,
                "CLOUD_TRANSPORT_IDENTITY", "Не подтверждён закреплённый контейнер облачного транспорта.")
        self.base = "/data/" + expected
        self._exec("sh", "-eu", "-c", 'umask 077; for d do if [ -e "$d" ]; then test -d "$d" && test ! -L "$d"; else mkdir "$d"; fi; done',
                   "asa-cloud-spool", self.base, self.base + "/outgoing", self.base + "/incoming")

    def _exec(self, *args, source=None, output=None):
        return _command(["docker", "exec", "-i", "--user", "1000:1000", self.container, *args],
                        timeout=_budget(self.deadline), source=source, output=output)

    def call(self, *args):
        try:
            return self.transport.rclone(*args, timeout_seconds=_budget(self.deadline))
        except (ValueError, subprocess.TimeoutExpired) as exc:
            code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r"CLOUD_[A-Z_]+", str(exc)) else "CLOUD_TIMEOUT"
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
            target.unlink(missing_ok=True)
            _command(["docker", "exec", "--user", "1000:1000", self.container, "rm", "-f", "--", container_file], timeout=30)

    def deliver(self, ciphertext, receipt, verification_directory):
        name = self.transport.archive_name(Path(ciphertext).name)
        remote_file = self.remote + "/" + name
        expected = receipt["encryption"]["sha256"]
        require(file_hash(Path(ciphertext)) == expected, "BACKUP_CIPHERTEXT_DRIFT", "Ciphertext изменился до передачи.")
        self.call("mkdir", self.remote)
        rows = json.loads(self.call("lsjson", "--files-only", "--max-depth", "1", self.remote))
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
                self.call("copyto", temporary, pending, "--immutable", "--checksum")
                proof = self.readback(pending, verification_directory)
                require(proof["sha256"] == expected, "CLOUD_READBACK_HASH", "Удалённый ciphertext отличается от локального.")
                self.call("moveto", pending, remote_file, "--immutable", "--checksum")
            finally:
                _command(["docker", "exec", "--user", "1000:1000", self.container, "rm", "-f", "--", temporary], timeout=30)
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
                   "local": {"status": "PENDING"}, "encryption": {"status": "PENDING" if policy.get("ageRecipient") else "NOT_CONFIGURED"},
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
        encrypt_snapshot(install, receipt, policy.get("ageRecipient"), deadline=deadline)
        stage = "cloud"
        _deliver(install, receipt, policy, deadline=deadline)
        _outcome(receipt, policy)
    except (Blocked, OSError, ValueError, subprocess.SubprocessError) as exc:
        code = exc.code if isinstance(exc, Blocked) else type(exc).__name__
        receipt["errors"].append({"code": code, "at": now()})
        if stage == "local":
            receipt["local"].update(status="FAILED", error=code)
        elif stage == "encryption":
            receipt["encryption"].update(status="PREPARED" if receipt["encryption"]["status"] == "PREPARED" else "FAILED", error=code)
        elif stage == "cloud":
            receipt["cloud"] = {"status": "FAILED", "error": code}
        _outcome(receipt, policy)
        if stage in ("local", "hold") or code in ("BACKUP_FREEZE_TIMEOUT", "BACKUP_FREEZE_INTERRUPTED"):
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
    _verify_local(install, receipt)
    _complete_encryption_receipt(install, receipt)
    require(receipt["encryption"]["status"] == "OK", "BACKUP_CIPHERTEXT_MISSING",
            "Нет подтверждённого ciphertext для повтора доставки.", "Завершите исходную операцию backup; обновление повторять не нужно.")
    try:
        _deliver(install, receipt, policy)
        _outcome(receipt, policy)
    except (Blocked, OSError, ValueError, subprocess.SubprocessError) as exc:
        code = exc.code if isinstance(exc, Blocked) else type(exc).__name__
        receipt["errors"].append({"code": code, "at": now()})
        receipt["cloud"] = {"status": "FAILED", "error": code}
        _outcome(receipt, policy)
    _save(install, receipt)
    return receipt


def apply_retention(install, *, installation_id, policy, protected_snapshot_ids=()):
    """Delete only proven owned snapshots under an explicit saved keep policy."""
    policy = validate_policy(policy, installation_id)
    root = _receipt_root(install)
    receipts = []
    for path in root.glob("*.json"):
        if SNAPSHOT.fullmatch(path.stem):
            receipt = load_receipt(install, path.stem, installation_id)
            if receipt["local"]["status"] == "OK":
                receipts.append(receipt)
    receipts.sort(key=lambda value: (value["snapshotAt"], value["snapshotId"]), reverse=True)
    protected = set(protected_snapshot_ids)
    protected.update(receipt["snapshotId"] for receipt in receipts
                     if receipt.get("cloudConfigured") and receipt["cloud"]["status"] != "OK")
    for pointer in ("last-local-success.json", "last-cloud-success.json"):
        if (root / pointer).exists():
            protected.add(json.loads(read_private(root / pointer))["snapshotId"])
    # Active/ambiguous setup operations and restore operations are never garbage.
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
    deleted = {"local": [], "remote": []}
    for kind, key in (("remote", "remoteKeep"), ("local", "localKeep")):
        keep = policy["retention"].get(key)
        if keep is None:
            continue
        eligible = [value for value in receipts if not value[kind if kind == "local" else "cloud"].get("deletedAt")
                    and (kind == "local" or value["cloud"]["status"] == "OK")]
        retained = {value["snapshotId"] for value in eligible[:keep]} | protected
        transport = None
        for receipt in eligible[keep:]:
            if receipt["snapshotId"] in retained:
                continue
            if kind == "remote":
                transport = transport or CloudTransport(policy["cloud"], installation_id)
                expected_remote = transport.remote + "/asa-lab-" + receipt["snapshotId"] + ".tar.age"
                require(receipt["cloud"].get("remote") == expected_remote, "RETENTION_NAMESPACE", "Архив не принадлежит назначению этой установки.")
                proof = transport.readback(expected_remote, root / "verification")
                require(proof["sha256"] == receipt["encryption"]["sha256"], "RETENTION_HASH", "Удалённый архив изменился; удаление запрещено.")
                transport.call("deletefile", expected_remote)
                receipt["cloud"]["deletedAt"] = now()
            else:
                local, _ = _verify_local(install, receipt)
                require(local.parent == _local_root(install), "RETENTION_PATH", "Путь снимка изменился.")
                shutil.rmtree(local)
                ciphertext = _local_root(install) / "encrypted" / ("asa-lab-" + receipt["snapshotId"] + ".tar.age")
                if ciphertext.exists():
                    plain_paths(ciphertext.parent, (ciphertext.name,))
                    require(file_hash(ciphertext) == receipt["encryption"].get("sha256"), "RETENTION_HASH", "Ciphertext изменился; удаление запрещено.")
                    ciphertext.unlink()
                receipt["local"]["deletedAt"] = now()
            atomic_json(root / (receipt["snapshotId"] + ".json"), receipt)
            deleted[kind].append(receipt["snapshotId"])
    return {"format": "asa-backup-retention-v1", "protectedSnapshotIds": sorted(protected), "deleted": deleted, "at": now()}

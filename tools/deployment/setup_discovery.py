"""Read-only, fail-closed discovery for the unified Linux setup entry point.

Docker metadata is captured without environment variables, driver options, or
container logs. A failed/partial inventory is never evidence of an empty host.
The returned JSON is a dated observation, not permission to create resources.
"""

import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

from .contracts import Blocked, read_env
from .paths import plain_paths


LABELS = {
    "project": "com.docker.compose.project",
    "service": "com.docker.compose.service",
    "root": "com.docker.compose.project.working_dir",
    "files": "com.docker.compose.project.config_files",
    "installationId": "io.asa.installation-id",
    "source": "org.opencontainers.image.source",
    "revision": "org.opencontainers.image.revision",
}
VOLUME_LABELS = {
    "project": "com.docker.compose.project",
    "volume": "com.docker.compose.volume",
    "installationId": "io.asa.installation-id",
}
DATA_TARGETS = {"postgres": "/var/lib/postgresql/data", "minio": "/data"}
PROJECT = re.compile(r"[a-z0-9][a-z0-9_-]{0,127}\Z")
MAX_RECORDS = 4096
MAX_OUTPUT = 8 * 1024 * 1024


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _command(args):
    try:
        completed = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, encoding="utf-8", errors="strict",
                                   timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired, UnicodeError) as exc:
        raise ValueError("Docker metadata command was unavailable") from exc
    if completed.returncode or len(completed.stdout) > MAX_OUTPUT:
        raise ValueError("Docker metadata command did not complete")
    return completed.stdout.strip()


def _label_template(labels, source):
    return "{" + ",".join(json.dumps(key) + ":{{json (index " + source + " " + json.dumps(value) + ")}}"
                           for key, value in labels.items()) + "}"


def _records(runner, command, identifiers, template):
    records = []
    for offset in range(0, len(identifiers), 64):
        selected = identifiers[offset:offset + 64]
        output = runner(["docker", *command, "--format", template, *selected])
        batch = [json.loads(line) for line in output.splitlines() if line.strip()]
        if len(batch) != len(selected) or any(not isinstance(item, dict) for item in batch):
            raise ValueError("Docker returned an incomplete inspection")
        records.extend(batch)
    return records


def docker_inventory(runner=None):
    """Inspect every container (including stopped ones) and every named volume.

    ``runner(argv) -> stdout`` is injectable for failure tests. Never pass a
    shell, mount a volume, or treat a missing Docker response as an empty list.
    """
    runner = runner or _command
    observed = {"format": "asa-docker-inventory-v1", "observedAt": _now(), "complete": False,
                "daemon": None, "containers": [], "volumes": [], "images": []}
    try:
        daemon = json.loads(runner(["docker", "info", "--format",
            '{"id":{{json .ID}},"os":{{json .OSType}},"architecture":{{json .Architecture}},"root":{{json .DockerRootDir}}']))
        if not isinstance(daemon, dict) or not all(isinstance(daemon.get(key), str) and daemon[key]
                                                  for key in ("id", "os", "architecture", "root")):
            raise ValueError("Docker daemon identity is incomplete")
        if daemon["os"] != "linux":
            raise ValueError("Docker is not using Linux containers")
        runner(["docker", "compose", "version", "--short"])
        ids = runner(["docker", "ps", "-aq", "--no-trunc"]).split()
        names = runner(["docker", "volume", "ls", "-q"]).split()
        if len(ids) > MAX_RECORDS or len(names) > MAX_RECORDS or len(set(ids)) != len(ids) or len(set(names)) != len(names):
            raise ValueError("Docker inventory exceeds its safe bound or has duplicates")
        if any(not re.fullmatch(r"[a-f0-9]{64}", item) for item in ids):
            raise ValueError("Docker returned an invalid container identifier")
        if any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,254}", item) for item in names):
            raise ValueError("Docker returned an invalid volume identifier")
        template = ('{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},'
                    '"imageId":{{json .Image}},"running":{{json .State.Running}},"labels":'
                    + _label_template(LABELS, ".Config.Labels") + ',"mounts":{{json .Mounts}}}')
        containers = _records(runner, ["inspect"], ids, template)
        volumes = _records(runner, ["volume", "inspect"], names,
            '{"name":{{json .Name}},"driver":{{json .Driver}},"createdAt":{{json .CreatedAt}},'
            '"mountpoint":{{json .Mountpoint}},"labels":' + _label_template(VOLUME_LABELS, ".Labels") + '}')
        if {item.get("id") for item in containers} != set(ids) or {item.get("name") for item in volumes} != set(names):
            raise ValueError("Docker inspection identity changed during discovery")
        for record in containers:
            if not isinstance(record.get("labels"), dict) or not isinstance(record.get("mounts"), list) or type(record.get("running")) is not bool:
                raise ValueError("Docker container metadata is incomplete")
            if not all(isinstance(record.get(key), str) and record[key] for key in ("image", "imageId", "name")):
                raise ValueError("Docker image identity is incomplete")
        for record in volumes:
            if not isinstance(record.get("labels"), dict) or not all(isinstance(record.get(key), str) and record[key]
                for key in ("name", "driver", "createdAt", "mountpoint")):
                raise ValueError("Docker volume metadata is incomplete")
        image_ids = sorted({item["imageId"] for item in containers})
        if any(not re.fullmatch(r"sha256:[a-f0-9]{64}", item) for item in image_ids):
            raise ValueError("Docker returned an invalid image identifier")
        images = _records(runner, ["image", "inspect"], image_ids,
            '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}')
        if {item.get("id") for item in images} != set(image_ids):
            raise ValueError("Docker image inventory is incomplete")
        # Detect resource creation/removal during the inventory, rather than
        # joining two different Docker states into apparently complete evidence.
        if set(runner(["docker", "ps", "-aq", "--no-trunc"]).split()) != set(ids):
            raise ValueError("Container inventory changed during discovery")
        if set(runner(["docker", "volume", "ls", "-q"]).split()) != set(names):
            raise ValueError("Volume inventory changed during discovery")
        observed.update(complete=True, daemon=daemon, containers=containers, volumes=volumes, images=images)
        observed["fingerprint"] = hashlib.sha256(json.dumps(observed, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, Blocked):
        observed.update(complete=False, error={"code": "DOCKER_UNKNOWN",
            "message": "Полная инвентаризация Docker не завершена; отсутствие установки не доказано.",
            "action": "Проверьте доступ оператора к прежнему Docker daemon и повторите check."})
    return observed


def _is_asa(record):
    image = record.get("image", "")
    labels = record.get("labels") or {}
    return (image.startswith("ghcr.io/spikeal8-maker/asa-lab/")
            or re.match(r"asa-lab-(api|web|scratch|minio|search)(:|@)", image) is not None
            or str(labels.get("source") or "").removesuffix(".git") == "https://github.com/spikeal8-maker/asa-lab"
            or bool(labels.get("installationId")))


def _lexical(path):
    value = Path(path)
    if not value.is_absolute() or ".." in value.parts:
        raise ValueError("The installation path must be absolute without traversal")
    return str(value)


def _json_file(path):
    if path.stat().st_size > 262144:
        raise ValueError("Installation metadata exceeds the supported bound")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Installation metadata is not an object")
    return value


def _candidate_groups(inventory):
    projects = {item["labels"].get("project") for item in inventory["containers"] if _is_asa(item)}
    projects.discard(None)
    groups = []
    for project in sorted(projects):
        records = [item for item in inventory["containers"] if item["labels"].get("project") == project]
        roots = sorted({item["labels"].get("root") for item in records if item["labels"].get("root")})
        groups.append({"project": project, "roots": roots,
                       "containers": [item["id"] for item in records],
                       "running": sum(bool(item["running"]) for item in records)})
    return groups


def _orphan_asa_volumes(inventory):
    """Recognise ASA storage signatures even after every container is gone.

    Compose project names are user-selected. The distinctive ASA object-store
    volume label, or the pair of canonical names without labels, is enough to
    require human attribution; a generic PostgreSQL volume alone is not.
    No volume is mounted or read to make this conservative classification.
    """
    projects = set()
    unlabelled_groups = {}
    for volume in inventory["volumes"]:
        labels = volume.get("labels") or {}
        project = labels.get("project")
        if project and labels.get("volume") == "blocks-object-data":
            projects.add(project)
        match = re.fullmatch(r"(.+)_(postgres-data|blocks-object-data)", volume["name"])
        if match:
            unlabelled_groups.setdefault(match[1], set()).add(match[2])
    projects.update(project for project, names in unlabelled_groups.items()
                    if {"postgres-data", "blocks-object-data"} <= names)
    return sorted(volume["name"] for volume in inventory["volumes"]
                  if volume["name"].startswith("asa-lab")
                  or (volume.get("labels") or {}).get("installationId")
                  or (volume.get("labels") or {}).get("volume") == "blocks-object-data"
                  or (volume.get("labels") or {}).get("project") in projects
                  or any(volume["name"].startswith(project + "_") for project in projects))


def _empty_bootstrap_state(root):
    """A crash while acquiring the first lock must not invent an installation.

    This recognises only empty private scaffolding and the exact canonical lock
    marker. Any configuration, journal, temporary file or unknown entry remains
    partial. Docker resources are checked independently by the caller.
    """
    state = root / ".asa"
    if not state.is_dir():
        return False
    owner = root.stat().st_uid
    entries = list(state.iterdir())
    if any(item.name not in ("operation.lock", "setup-operations") for item in entries):
        return False
    for directory in (state, state / "setup-operations"):
        if directory.exists():
            metadata = directory.lstat()
            if not stat.S_ISDIR(metadata.st_mode) or (os.name != "nt" and
                    (metadata.st_uid != owner or metadata.st_mode & 0o077)):
                return False
            if directory != state and any(directory.iterdir()):
                return False
    lock = state / "operation.lock"
    if lock.exists():
        metadata = lock.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > 1:
            return False
        if os.name != "nt" and (metadata.st_uid != owner or metadata.st_mode & 0o077):
            return False
        if lock.read_bytes() not in (b"", b"0"):
            return False
    return True


def data_identity(root, project, inventory, records):
    """Capture original mount identity without opening or mounting store data."""
    volumes = {item["name"]: item for item in inventory["volumes"]}
    identity = {"format": "asa-data-identity-v1", "root": str(root), "project": project,
                "daemonId": inventory["daemon"]["id"], "stores": {}}
    for service, target in DATA_TARGETS.items():
        selected = [item for item in records if item["labels"].get("service") == service]
        if len(selected) != 1:
            raise ValueError(f"Exactly one {service} container is required")
        mounts = [mount for mount in selected[0]["mounts"] if mount.get("Destination") == target]
        if len(mounts) != 1:
            raise ValueError(f"Persistent {service} mount is missing or ambiguous")
        mount = mounts[0]
        if mount.get("Type") == "volume":
            name = mount.get("Name")
            volume = volumes.get(name)
            if not volume or volume["mountpoint"] != mount.get("Source"):
                raise ValueError(f"Persistent {service} volume is absent or replaced")
            identity["stores"][service] = {"type": "volume", "name": name, "target": target,
                "driver": volume["driver"], "createdAt": volume["createdAt"], "source": volume["mountpoint"]}
        elif mount.get("Type") == "bind":
            source = Path(_lexical(mount.get("Source", "")))
            plain_paths(source, ())
            metadata = source.stat()
            if not source.is_dir():
                raise ValueError(f"Persistent {service} bind mount is not a directory")
            identity["stores"][service] = {"type": "bind", "source": str(source), "target": target,
                                          "device": metadata.st_dev, "inode": metadata.st_ino}
        else:
            raise ValueError(f"Unsupported persistent {service} mount")
    return identity


def classify_installation(root, inventory, *, project=None, saved_identity=None, pending_operation=None):
    """Choose no action until installation metadata and observed resources agree.

    A legacy installation can be adopted by the caller only after independent
    runtime/configuration/owner validation; this function never writes adoption
    metadata. NO_CHANGE additionally requires actual runtime/release validation
    and is intentionally never inferred solely from files or Docker labels.
    """
    result = {"state": "UNKNOWN", "root": str(root) if root is not None else None,
              "project": project, "candidates": [], "reasons": [], "dataIdentity": None,
              "observedAt": inventory.get("observedAt"), "inventoryFingerprint": inventory.get("fingerprint")}

    def finish(state, code, message, action):
        result["state"] = state
        result["reasons"].append({"code": code, "message": message, "action": action})
        return result

    if not inventory.get("complete"):
        return finish("UNKNOWN", "DOCKER_UNKNOWN", "Docker недоступен или инвентаризация неполна.",
                      "Восстановите доступ к исходному Docker daemon; установку не инициализировать.")
    try:
        unattributed = [item["id"] for item in inventory["containers"] if _is_asa(item)
                        and (not item["labels"].get("project") or not item["labels"].get("root"))]
        if unattributed:
            result["unattributedContainers"] = unattributed
            return finish("PARTIAL", "UNATTRIBUTED_ASA", "У ресурсов ASA отсутствуют project или канонический каталог.",
                          "Сопоставьте прежние контейнеры с установкой; новую пустую БД не создавать.")
        candidates = _candidate_groups(inventory)
        result["candidates"] = copy.deepcopy(candidates)
        if root is None:
            if len(candidates) != 1 or len(candidates[0]["roots"]) != 1:
                return finish("AMBIGUOUS" if candidates else "UNKNOWN", "TARGET_REQUIRED",
                              "Нужно выбрать один подтверждённый каталог установки.",
                              "Укажите --root или сохранённый проверенный конфигурационный файл.")
            root = candidates[0]["roots"][0]
        root = Path(_lexical(root))
        plain_paths(root, (".env", ".git", ".asa", ".asa/installation.json", ".asa/setup.json",
                           ".asa/operation.lock", ".asa/maintenance.json", ".asa/failed-switch.json"))
        result["root"] = str(root)
        if (root / ".env").exists() and not (root / ".env").is_file():
            raise ValueError("Private configuration is not a regular file")
        if (root / ".asa").exists() and not (root / ".asa").is_dir():
            raise ValueError("Installation state is not a directory")
        env = read_env(root / ".env") if (root / ".env").is_file() else {}
        metadata = _json_file(root / ".asa/installation.json") if (root / ".asa/installation.json").is_file() else {}
        config = _json_file(root / ".asa/setup.json") if (root / ".asa/setup.json").is_file() else {}
        if config and config.get("format") != "asa-setup-config-v1":
            raise ValueError("Unsupported setup configuration")
        if metadata and metadata.get("format") != "asa-installation-v1":
            raise ValueError("Unsupported installation metadata")
        known_projects = {item for item in (project, env.get("COMPOSE_PROJECT_NAME"), metadata.get("project"),
                                            config.get("project")) if item}
        roots_records = [item for item in inventory["containers"] if item["labels"].get("root") == str(root)]
        known_projects.update(item["labels"].get("project") for item in roots_records if item["labels"].get("project"))
        if len(known_projects) > 1:
            return finish("PARTIAL", "PROJECT_DRIFT", "Каталог и ресурсы относятся к разным Compose project.",
                          "Сопоставьте .env, installation.json и метки контейнеров; данные не перемещать.")
        project = next(iter(known_projects), "asa-lab-dev")
        result["project"] = project
        if not PROJECT.fullmatch(project):
            raise ValueError("Invalid Compose project")
        records = [item for item in inventory["containers"] if item["labels"].get("project") == project]
        volumes = [item for item in inventory["volumes"] if item["labels"].get("project") == project
                   or item["name"].startswith(project + "_")]
        if any(item["labels"].get("root") != str(root) for item in records):
            return finish("PARTIAL", "ROOT_DRIFT", "Выбранный Compose project уже принадлежит другому каталогу.",
                          "Выберите каталог из метки PostgreSQL; второй стек не создавать.")
        if config.get("root") and config["root"] != str(root):
            raise ValueError("Configured installation root differs")
        if config.get("installationId") and metadata.get("instanceId") and config["installationId"] != metadata["instanceId"]:
            raise ValueError("Installation identifiers disagree")
        result["installationId"] = config.get("installationId") or metadata.get("instanceId")
        empty_bootstrap = _empty_bootstrap_state(root) if not (env or metadata or config) else False
        result["emptyBootstrapState"] = empty_bootstrap
        markers = bool(env or metadata or config or ((root / ".asa").exists() and not empty_bootstrap))
        if pending_operation and (not isinstance(pending_operation, dict) or not pending_operation.get("operationId")
                or pending_operation.get("installationId") != result.get("installationId")
                or pending_operation.get("root", str(root)) != str(root)
                or pending_operation.get("project", project) != project):
            raise ValueError("Unfinished operation is not bound to this installation")
        if not records:
            if pending_operation and pending_operation.get("mode") == "install" and result.get("installationId"):
                result["operationId"] = pending_operation["operationId"]
                result["orphanVolumes"] = [item["name"] for item in volumes]
                return finish("INTERRUPTED", "KNOWN_INSTALLATION", "Первичная установка прервана; достоверный журнал сохранён.",
                              "Используйте resume этой операции; уже созданные секреты и данные сохраняются.")
            if markers or volumes:
                result["orphanVolumes"] = [item["name"] for item in volumes]
                return finish("PARTIAL", "ORPHANED_INSTALLATION", "Сохранились настройки или тома без подтверждённого runtime.",
                              "Сверьте перечисленные ресурсы и журнал прежней операции; пустую БД не создавать.")
            unknown_asa = _orphan_asa_volumes(inventory)
            if candidates or unknown_asa:
                result["orphanVolumes"] = unknown_asa
                return finish("AMBIGUOUS" if candidates else "PARTIAL", "EXISTING_ASA_RESOURCES",
                              "Обнаружены прежние ресурсы ASA; новая пустая цель не подтверждена.",
                              "Выберите существующую установку или разберите принадлежащие ей orphan volumes.")
            return finish("FRESH", "EMPTY_TARGET", "Ресурсы прежней ASA и конфликт выбранного проекта не обнаружены.",
                          "Проверьте новый каталог, оператора и адрес перед первоначальной настройкой.")
        if not env:
            return finish("PARTIAL", "ENV_MISSING", "Контейнеры существуют, но приватная конфигурация отсутствует.",
                          "Найдите исходную конфигурацию; секреты и пустую БД повторно не создавать.")
        if any(not item["labels"].get("service") for item in records):
            raise ValueError("Container service identity is missing")
        identity = data_identity(root, project, inventory, records)
        result["dataIdentity"] = identity
        protected_volumes = {value["name"] for value in identity["stores"].values() if value["type"] == "volume"}
        sharing = [item["id"] for item in inventory["containers"] if item["labels"].get("project") != project
                   and any(mount.get("Type") == "volume" and mount.get("Name") in protected_volumes
                           for mount in item["mounts"])]
        if sharing:
            result["sharedDataContainers"] = sharing
            return finish("PARTIAL", "SHARED_DATA_VOLUME", "Тома данных используются контейнерами другого проекта.",
                          "Согласуйте всех писателей и принадлежность хранилища; чужие контейнеры не останавливаются.")
        expected = saved_identity or config.get("dataIdentity")
        if expected is not None and expected != identity:
            return finish("PARTIAL", "DATA_IDENTITY_CHANGED", "Том, bind mount или Docker daemon отличается от сохранённой идентичности.",
                          "Восстановите исходное подключение хранилища и подтвердите причину изменения.")
        if any(value["type"] == "bind" for value in identity["stores"].values()):
            return finish("PARTIAL", "BIND_BACKEND_UNSUPPORTED", "Bind mounts обнаружены; действующий backup/update backend их не поддерживает.",
                          "Нужен отдельно проверенный переносимый адаптер; mount и данные оставлены без изменений.")
        if pending_operation:
            result["operationId"] = pending_operation["operationId"]
            return finish("INTERRUPTED", "KNOWN_OPERATION", "Обнаружена известная незавершённая операция.",
                          "Используйте resume с её operation ID после проверки сохранённых стадий.")
        if (root / ".asa/maintenance.json").exists() or (root / ".asa/failed-switch.json").exists():
            return finish("PARTIAL", "UNKNOWN_INTERRUPTION", "Есть маркер незавершённого обслуживания без подтверждённого журнала setup.",
                          "Проверьте прежний менеджер и состояние писателей; повторное переключение запрещено.")
        if not metadata.get("instanceId") or expected is None:
            return finish("LEGACY", "ADOPTION_REQUIRED", "Установка найдена; её идентичность ещё не закреплена единым setup.",
                          "Выполните проверяемое принятие под управление с подтверждением владельца, runtime и томов.")
        if not any(item["running"] for item in records):
            return finish("STOPPED", "EXISTING_STOPPED", "Контейнеры остановлены, исходные данные и идентичность сохранены.",
                          "Обслуживать существующую установку без повторной инициализации данных.")
        return finish("MANAGED", "CONSISTENT_INSTALLATION", "Найдена одна согласованная управляемая установка.",
                      "Проверьте закреплённый выпуск и фактический runtime.")
    except (OSError, ValueError, KeyError, TypeError, Blocked):
        return finish("PARTIAL", "IDENTITY_UNVERIFIED", "Метаданные, владельцы путей или хранилища не прошли проверку.",
                      "Проверьте исходные пути, .env и идентичности PostgreSQL/MinIO; данные не изменять.")

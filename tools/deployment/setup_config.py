"""Private, versioned setup configuration; no secret is accepted on argv."""

import copy
import getpass
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

from .backup_workflow import TRANSPORT_SHA256, validate_policy
from .backup_schedule import validate_schedule
from .contracts import Blocked, attest_editor_env, require, validate_release
from .paths import atomic_bytes, plain_paths
from .setup_acceptance import BROWSER_SHA256


FORMAT = "asa-setup-config-v1"


def private_json(path, *, owner=None, maximum=1024 * 1024):
    path = Path(path)
    plain_paths(path, ())
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)), "rb") as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and metadata.st_size <= maximum,
                "PRIVATE_FILE", "Неподдерживаемый файл приватного состояния.")
        require(os.name == "nt" or (metadata.st_uid == (os.geteuid() if owner is None else owner)
                and not metadata.st_mode & 0o077), "PRIVATE_PERMISSIONS",
                "Приватный файл должен принадлежать оператору и иметь права 0600.")
        value = json.load(stream)
    require(isinstance(value, dict), "PRIVATE_FORMAT", "Ожидается JSON object приватного состояния.")
    return value


def read_installed_release(root):
    """Read only the public legacy release manifest, which may have mode 0644.

    Credentials, setup configuration and journals still use private_json. The
    old manager's public manifest is accepted only from the current operator,
    as a plain single-link file without group/other write permission.
    """
    path = Path(root) / ".asa/installed-release.json"
    plain_paths(path, ())
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and metadata.st_size < 65536,
                "RELEASE_FILE", "Манифест установленного выпуска должен быть обычным файлом без дополнительных ссылок.")
        require(os.name == "nt" or (metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o022),
                "RELEASE_PERMISSIONS", "Манифест выпуска должен принадлежать оператору и запрещать постороннюю запись.")
        value = json.load(stream)
    return validate_release(value)


def save_installed_release(root, value):
    """Atomically replace the validated public manifest with a mode-0600 file."""
    path = Path(root) / ".asa/installed-release.json"
    value = validate_release(value)
    plain_paths(path, ())
    if path.exists():
        read_installed_release(root)
    metadata = path.parent.stat()
    require(os.name == "nt" or (metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o077),
            "PRIVATE_DIRECTORY", "Каталог состояния должен принадлежать оператору и иметь права 0700.")
    atomic_bytes(path, (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode(), mode=0o600)
    if os.name != "nt":
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def replace_legacy_manager_state(root, name, value):
    """Upgrade two known manager records under the caller's operation lock.

    Older managers wrote these with 0644 inside the private state directory.
    A runtime configuration may contain private overlays, so this is a narrow
    validated replacement, never a general public or secret reader exception.
    """
    require(name in ("installation.json", "runtime-configuration.json"), "LEGACY_STATE_PATH", "Неизвестный файл совместимости менеджера.")
    path = Path(root) / ".asa" / name
    plain_paths(path, ())
    parent = path.parent.stat()
    require(os.name == "nt" or (parent.st_uid == os.geteuid() and not parent.st_mode & 0o077),
            "PRIVATE_DIRECTORY", "Каталог состояния должен принадлежать оператору и иметь права 0700.")

    def validate(record):
        require(isinstance(record, dict), "LEGACY_STATE_FORMAT", "Некорректные метаданные прежнего менеджера.")
        if name == "installation.json":
            require(record.get("format") == "asa-installation-v1"
                    and record.get("profile") in ("production", "staging", "dev", "base")
                    and isinstance(record.get("project"), str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,127}", record["project"]),
                    "LEGACY_STATE_FORMAT", "Метаданные прежней установки не прошли проверку.")
            require(not record.get("instanceId") or re.fullmatch(r"[a-f0-9]{32}", record["instanceId"]),
                    "LEGACY_STATE_FORMAT", "Некорректный ID прежней установки.")
        else:
            files = record.get("files")
            require(isinstance(record.get("revision"), str) and re.fullmatch(r"[a-f0-9]{40}", record["revision"])
                    and isinstance(files, dict) and "compose.yaml" in files
                    and set(files) <= {"compose.yaml", "compose.dev.yaml", "compose.production.yaml", "compose.staging.yaml", "compose.frp.yaml"}
                    and all(isinstance(content, str) for content in files.values()),
                    "LEGACY_STATE_FORMAT", "Сохранённая конфигурация runtime не прошла проверку.")
            if record.get("installedRelease") is not None:
                validate_release(record["installedRelease"])
    validate(value)
    if path.exists():
        with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)), "rb") as stream:
            metadata = os.fstat(stream.fileno())
            require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and metadata.st_size <= 1024 * 1024,
                    "LEGACY_STATE_FILE", "Прежние метаданные должны быть обычным файлом без дополнительных ссылок.")
            require(os.name == "nt" or (metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o022),
                    "LEGACY_STATE_PERMISSIONS", "Прежние метаданные допускают постороннюю запись или принадлежат другому владельцу.")
            validate(json.load(stream))
    atomic_bytes(path, (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode(), mode=0o600)
    if os.name != "nt":
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def save_private(path, value):
    """Atomic replacement, including directory fsync, with strict private paths."""
    path = Path(path)
    plain_paths(path, ())
    missing = []
    directory = path.parent
    while not directory.exists():
        missing.append(directory)
        directory = directory.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o700)
    metadata = path.parent.stat()
    require(os.name == "nt" or (metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o077),
            "PRIVATE_DIRECTORY", "Каталог состояния должен принадлежать оператору и иметь права 0700.")
    if path.exists():
        private_json(path)
    atomic_bytes(path, (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode(), mode=0o600)
    if os.name != "nt":
        descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def validate_config(value, root, operator_uid, *, policy=True):
    require(isinstance(value, dict) and value.get("format") == FORMAT, "CONFIG_FORMAT", "Неизвестный формат setup.json.")
    require(not set(value) - {"format", "installationId", "root", "operatorUid", "profile", "entryOrigin",
            "project", "backupDirectory", "backup", "browser", "dataIdentity", "onboardingFile", "ports"},
            "CONFIG_KEYS", "В setup.json есть неизвестные поля.")
    require(value.get("root") == str(Path(root).absolute()) and value.get("operatorUid") == operator_uid,
            "CONFIG_IDENTITY", "Корень или оператор setup.json отличается от подтверждённого владельца.")
    require(isinstance(value.get("installationId"), str) and re.fullmatch(r"[a-f0-9]{32}", value["installationId"]),
            "CONFIG_IDENTITY", "Некорректный installation ID.")
    require(value.get("profile") in ("production", "staging", "dev", "base"), "CONFIG_PROFILE", "Неизвестный профиль установки.")
    project = value.get("project", "asa-lab-dev")
    require(isinstance(project, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,127}", project),
            "CONFIG_PROJECT", "Некорректный Compose project.")
    attest_editor_env(value.get("entryOrigin"), value.get("entryOrigin"), value.get("entryOrigin"), value["profile"])
    for key in ("backupDirectory", "onboardingFile"):
        if value.get(key):
            require(isinstance(value[key], str) and Path(value[key]).is_absolute() and ".." not in Path(value[key]).parts,
                    "CONFIG_PATH", "Сохранённый путь должен быть абсолютным без переходов.")
            plain_paths(Path(value[key]), ())
    if policy:
        validate_policy(value.get("backup"), value["installationId"])
    if value.get("backup"):
        validate_schedule(value["backup"].get("schedule", {}))
    browser = value.get("browser", {})
    require(isinstance(browser, dict) and not set(browser) - {"componentPath", "componentSha256", "pythonPath",
            "fixturePath", "timeoutSeconds", "browsersPath"}, "CONFIG_BROWSER", "Неизвестные настройки browser.")
    ports = value.get("ports", {"web": 4610, "api": 4611, "blocks": 4613})
    require(isinstance(ports, dict) and set(ports) == {"web", "api", "blocks"}
            and all(type(port) is int and 1024 <= port <= 65535 for port in ports.values())
            and len(set(ports.values())) == 3, "CONFIG_PORTS", "Нужны три разных непривилегированных порта.")
    return copy.deepcopy(value)


def load_config(root, operator_uid=None, *, required=True, policy=True):
    path = Path(root) / ".asa/setup.json"
    if not path.exists():
        require(not required, "CONFIG_MISSING", "Настройка установки ещё не сохранена.", "Выполните configure или интерактивный auto.")
        return None
    operator_uid = os.geteuid() if operator_uid is None else operator_uid
    return validate_config(private_json(path, owner=operator_uid), root, operator_uid, policy=policy)


def _ask(label, default=None, *, secret=False):
    require(sys.stdin.isatty(), "INPUT_REQUIRED", "Не хватает сохранённых обязательных настроек.",
            "Запустите configure в терминале или передайте приватный JSON через --config-file.")
    prompt = label + (f" [{default}]" if default is not None else "") + ": "
    value = (getpass.getpass(prompt) if secret else input(prompt)).strip()
    return value or default


def prepare_config(root, operator_uid, *, previous=None, supplied=None, install=None, fresh=False, non_interactive=False, reconfigure=False):
    """Collect before side effects. Returning a value does not write any file."""
    root = Path(root).absolute()
    if supplied:
        return validate_config(private_json(supplied), root, operator_uid)
    if previous and not reconfigure:
        return validate_config(previous, root, operator_uid)
    require(not non_interactive, "CONFIG_MISSING", "Для non-interactive требуется сохранённый setup.json.",
            "Сначала выполните configure или передайте --config-file с явной политикой backup.")
    env, settings = (install.env, install.settings) if install else ({}, {})
    profile = install.profile if install else "production"
    origin = env.get("ASA_UPDATE_ENTRY_ORIGIN") or _ask("Публичный HTTPS адрес ASA без завершающего /")
    old_backup = (previous or {}).get("backup", {})
    policy_name = _ask("Политика backup: required или best-effort", old_backup.get("policy", "required"))
    require(policy_name in ("required", "best-effort"), "BACKUP_POLICY", "Нужен явный выбор required или best-effort.")
    cloud_enabled = policy_name == "required" or _ask("Облачная копия Yandex: yes/no", "yes") == "yes"
    recipient = _ask("Публичный AGE recipient (пусто — шифрование не настроено)", old_backup.get("ageRecipient") or "")
    schedule_enabled = _ask("Включить ежедневный backup отдельно от обновлений: yes/no", "yes") == "yes"
    schedule = {"enabled": schedule_enabled,
                "time": _ask("Время ежедневного backup ЧЧ:ММ", old_backup.get("schedule", {}).get("time", "03:00")),
                "timezone": _ask("Часовой пояс backup", old_backup.get("schedule", {}).get("timezone", "Europe/Moscow")),
                "maxAgeHours": int(_ask("Допустимый возраст последней копии в часах", str(old_backup.get("schedule", {}).get("maxAgeHours", 26))))}
    retention = {"localKeep": None, "remoteKeep": None}
    if _ask("Разрешить удаление старых подтверждённых копий по retention: yes/no", "no") == "yes":
        retention = {"localKeep": int(_ask("Число локальных копий", "7")),
                     "remoteKeep": int(_ask("Число облачных копий", "30"))}
    bundle = Path(__file__).resolve().parent
    identity = (previous or {}).get("installationId") or settings.get("instanceId") or uuid.uuid4().hex
    browser = {"componentPath": str(bundle / "ops/asa_ops/browser_acceptance.py"), "componentSha256": BROWSER_SHA256,
               "pythonPath": os.environ.get("ASA_SETUP_BROWSER_PYTHON", str(Path.home() / ".local/share/asa-setup/playwright-1.56.0/bin/python")),
               "fixturePath": str(root / ".asa/acceptance/fixture.json"), "timeoutSeconds": 600}
    if os.environ.get("ASA_SETUP_BROWSERS_PATH"):
        browser["browsersPath"] = os.environ["ASA_SETUP_BROWSERS_PATH"]
    value = {**(previous or {}), "format": FORMAT, "installationId": identity, "root": str(root), "operatorUid": operator_uid,
             "profile": profile, "entryOrigin": origin, "project": env.get("COMPOSE_PROJECT_NAME", "asa-lab-dev"),
             "backupDirectory": settings.get("backupDirectory", str(root / "backups")), "browser": browser,
             "backup": {"policy": policy_name, "ageRecipient": recipient or None,
                "cloud": {"enabled": cloud_enabled, "transportPath": str(bundle / "ops/cloud_storage.py"),
                          "transportSha256": TRANSPORT_SHA256}, "maxWriteFreezeSeconds": 900,
                "retention": retention, "schedule": schedule}}
    if previous and previous.get("browser"):
        value["browser"] = previous["browser"]
    for key in ("rcloneConfigFile", "configPath"):
        if old_backup.get("cloud", {}).get(key):
            value["backup"]["cloud"][key] = old_backup["cloud"][key]
    if cloud_enabled and not value["backup"]["cloud"].get("rcloneConfigFile"):
        credential_path = _ask("Путь к приватному rclone.conf (пусто — уже настроенный общий транспорт)", "")
        if credential_path:
            require(Path(credential_path).is_absolute(), "CLOUD_CREDENTIAL_PATH", "Путь rclone.conf должен быть абсолютным.")
            value["backup"]["cloud"]["rcloneConfigFile"] = credential_path
    if fresh:
        value["onboardingFile"] = str(root / ".asa/onboarding.json")
    return validate_config(value, root, operator_uid)


def prepare_onboarding(config, *, non_interactive=False):
    path = Path(config.get("onboardingFile", Path(config["root"]) / ".asa/onboarding.json"))
    if path.exists():
        value = private_json(path)
        require(value.get("format") == "asa-owner-onboarding-v1" and value.get("installationId") == config["installationId"],
                "OWNER_IDENTITY", "Настройка owner принадлежит другой установке.")
        require(isinstance(value.get("email"), str) and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value["email"]),
                "OWNER_INPUT_REQUIRED", "В private onboarding нужен email владельца.")
        if not value.get("accountId"):
            require(all(isinstance(value.get(key), str) and value[key] for key in ("username", "birthDate", "country", "password"))
                    and len(value["password"]) >= 10 and re.fullmatch(r"[A-Za-z0-9._-]{3,40}", value["username"])
                    and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value["birthDate"]) and re.fullmatch(r"[A-Z]{2}", value["country"]),
                    "OWNER_INPUT_REQUIRED", "Не хватает обязательных приватных полей нового owner.",
                    "Заполните username, birthDate, country и password в onboardingFile до установки.")
            value.setdefault("displayName", value["username"])
        return value
    require(not non_interactive, "OWNER_INPUT_REQUIRED", "Для новой установки нужны приватные данные owner.",
            "Подготовьте onboardingFile или запустите первоначальную настройку в терминале.")
    password = _ask("Пароль нового владельца (не менее 10 символов)", secret=True)
    require(password and len(password) >= 10 and password == _ask("Повторите пароль", secret=True),
            "OWNER_PASSWORD", "Пароли должны совпадать и содержать не менее 10 символов.")
    return {"format": "asa-owner-onboarding-v1", "installationId": config["installationId"], "status": "NEW",
            "email": _ask("Email владельца"), "username": _ask("Имя пользователя (латиница)"),
            "displayName": _ask("Отображаемое имя"), "birthDate": _ask("Дата рождения владельца ГГГГ-ММ-ДД"),
            "country": _ask("Код страны (2 буквы)", "RU"), "password": password}

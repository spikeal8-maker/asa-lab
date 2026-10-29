#!/usr/bin/env python3
"""Small, standard-library-only privilege boundary for a verified setup bundle.

Run with ``/usr/bin/python3 -I``. No deployment/repository module is imported
while elevated. Git, Docker application operations, and the manager execute as
the independently verified installation owner. Package preparation is a narrow
allowlisted action and never repairs, removes, or restarts an existing Engine.
"""

import argparse
import configparser
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import sys
sys.dont_write_bytecode = True
import tempfile
import types
import urllib.request

try:
    import pwd
except ImportError:  # The complete deployment contract suite also runs on Windows.
    pwd = None


PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
REPOSITORY = "spikeal8-maker/asa-lab"
WORKFLOW = ".github/workflows/setup-release.yml"
DOCKER_KEY_FINGERPRINT = "9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
DOCKER_KEY_URL = "https://download.docker.com/linux/ubuntu/gpg"
DOCKER_PACKAGES = ("docker-ce", "docker-ce-cli", "containerd.io", "docker-buildx-plugin", "docker-compose-plugin")
CONFLICTING_PACKAGES = ("docker.io", "docker-compose", "docker-compose-v2", "podman-docker", "containerd", "runc")
# https://github.com/microsoft/playwright/blob/v1.56.0/packages/playwright-core/src/server/registry/nativeDeps.ts
CHROMIUM_PACKAGES = ("python3.12-venv", "xvfb", "fonts-noto-color-emoji", "fonts-unifont", "libfontconfig1",
    "libfreetype6", "xfonts-cyrillic", "xfonts-scalable", "fonts-liberation", "fonts-ipafont-gothic",
    "fonts-wqy-zenhei", "fonts-tlwg-loma-otf", "fonts-freefont-ttf", "libasound2t64", "libatk-bridge2.0-0t64",
    "libatk1.0-0t64", "libatspi2.0-0t64", "libcairo2", "libcups2t64", "libdbus-1-3", "libdrm2", "libgbm1",
    "libglib2.0-0t64", "libnspr4", "libnss3", "libpango-1.0-0", "libx11-6", "libxcb1", "libxcomposite1",
    "libxdamage1", "libxext6", "libxfixes3", "libxkbcommon0", "libxrandr2")
PACKAGE_ALLOWLIST = frozenset(("git", "python3", "curl", "ca-certificates", "age", "rclone", "gnupg",
                              "docker-compose-v2", *DOCKER_PACKAGES, *CHROMIUM_PACKAGES))
CLOUD_SOURCE_SHA256 = "72e35bbb3043acefb423cfe706f82b089eaba974deb04f16df8f335093c59d0c"
BROWSER_VERSION = "1.56.0"
CHROMIUM_VERSION = "141.0.7390.37"
CHROMIUM_REVISION = "1194"
BROWSER_REQUIREMENTS = """playwright==1.56.0 --hash=sha256:404be089b49d94bc4c1fe0dfb07664bda5ffe87789034a03bffb884489bdfb5c
pyee==13.0.0 --hash=sha256:48195a3cddb3b1515ce0695ed76036b5ccc2ef3a9f963ff9f77aec0139845498
greenlet==3.2.4 --hash=sha256:3b3812d8d0c9579967815af437d96623f45c0f2ae5f04e366de62a12d83a8fb0
typing-extensions==4.15.0 --hash=sha256:f0fa19c6845758ab08074a0cfa8b7aecb71c999ca73d62883bc25cc018c4e548
"""


class SetupBlocked(RuntimeError):
    def __init__(self, code, message, action):
        super().__init__(message)
        self.code, self.action = code, action


def _require(condition, code, message, action):
    if not condition:
        raise SetupBlocked(code, message, action)


def checked_path(path, *, missing=True):
    """Reject redirects before reading metadata or creating any privileged path."""
    path = Path(path)
    _require(path.is_absolute() and ".." not in path.parts, "PATH", "Путь должен быть абсолютным без переходов '..'.",
             "Укажите канонический каталог установки.")
    for component in [*reversed(path.parents), path]:
        try:
            info = component.lstat()
        except FileNotFoundError:
            _require(missing, "PATH_MISSING", "Требуемый путь не существует.", "Укажите существующий проверенный каталог.")
            continue
        _require(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400,
                 "PATH_LINK", "Путь проходит через symlink или перенаправление.", "Укажите исходный путь без перенаправлений.")
        _require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, "PATH_HARDLINK",
                 "Приватный или исполняемый файл имеет несколько жёстких ссылок.", "Проверьте происхождение файла.")
    return path


def read_private_json(path, *, required=False):
    path = checked_path(path)
    if not path.exists():
        _require(not required, "CONFIG_MISSING", "Файл конфигурации не найден.", "Укажите --config с существующим приватным JSON.")
        return {}
    info = path.stat()
    _require(path.is_file() and info.st_size <= 262144 and info.st_mode & 0o077 == 0,
             "CONFIG_PERMISSIONS", "Конфигурация должна быть обычным приватным файлом до 256 КиБ (0600).",
             "Проверьте владельца и права конкретного файла; массовую смену прав не выполнять.")
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
            actual = os.fstat(stream.fileno())
            _require((actual.st_dev, actual.st_ino) == (info.st_dev, info.st_ino), "CONFIG_RACE",
                     "Файл конфигурации изменился во время проверки.", "Повторите проверку после завершения сторонней операции.")
            value = json.load(stream)
        _require(isinstance(value, dict), "CONFIG_SCHEMA", "Конфигурация должна быть JSON-объектом.", "Проверьте формат конфигурации.")
        return value
    except (OSError, ValueError) as exc:
        raise SetupBlocked("CONFIG_READ", "Не удалось прочитать приватную конфигурацию.", "Проверьте JSON и доступ оператора к файлу.") from exc


def read_legacy_installation(root):
    """Read only the old manager's non-secret installation metadata.

    The old atomic_json writer used the caller's umask, commonly producing
    0644. Read permission does not grant authority: the regular single-link
    file must still belong to the installation owner and forbid outside writes.
    This exception never applies to setup config, onboarding, or journals.
    """
    root = checked_path(root)
    path = checked_path(root / ".asa/installation.json")
    if not path.exists():
        return {}
    info = path.stat()
    expected_uid = root.stat().st_uid
    _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == expected_uid
             and not info.st_mode & 0o022 and info.st_size <= 262144, "LEGACY_PERMISSIONS",
             "Metadata прежнего менеджера имеет неподтверждённого владельца, тип или права записи.",
             "Проверьте installation.json; чтение 0644 допустимо, сторонняя запись запрещена.")
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
            actual = os.fstat(stream.fileno())
            _require((actual.st_dev, actual.st_ino) == (info.st_dev, info.st_ino)
                     and stat.S_ISREG(actual.st_mode) and actual.st_nlink == 1 and actual.st_uid == expected_uid
                     and not actual.st_mode & 0o022 and actual.st_size <= 262144, "LEGACY_RACE",
                     "Metadata прежнего менеджера изменилось во время проверки.", "Повторите проверку после завершения сторонней операции.")
            value = json.load(stream)
        valid = isinstance(value, dict) and value.get("format") == "asa-installation-v1"
        if valid and "profile" in value:
            valid = value["profile"] in ("dev", "production", "staging", "base")
        if valid and "project" in value:
            valid = isinstance(value["project"], str) and bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]*", value["project"]))
        if valid and "automaticUpdates" in value:
            valid = type(value["automaticUpdates"]) is bool
        if valid and "instanceId" in value:
            valid = isinstance(value["instanceId"], str) and bool(re.fullmatch(r"[a-f0-9]{32}", value["instanceId"]))
        if valid and "backupDirectory" in value:
            valid = isinstance(value["backupDirectory"], str) and Path(value["backupDirectory"]).is_absolute()
        if valid and "window" in value:
            window = value["window"]
            valid = (isinstance(window, dict) and set(window) == {"weekday", "start", "end", "utcOffsetMinutes"}
                     and type(window["weekday"]) is int and 0 <= window["weekday"] <= 6
                     and type(window["utcOffsetMinutes"]) is int and -720 <= window["utcOffsetMinutes"] <= 840
                     and all(isinstance(window[key], str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", window[key])
                             for key in ("start", "end")) and window["start"] < window["end"])
        _require(valid, "LEGACY_SCHEMA", "Metadata прежнего менеджера не соответствует asa-installation-v1.",
                 "Проверьте исходный installation.json; секретные настройки имеют отдельный приватный формат.")
        return value
    except (OSError, ValueError, UnicodeError) as exc:
        raise SetupBlocked("LEGACY_READ", "Не удалось прочитать metadata прежнего менеджера.",
                           "Проверьте installation.json и доступ исходного владельца.") from exc


def verify_bundle(bundle):
    """Check the protected snapshot after external GitHub attestation verification.

    The manifest is not itself a trust anchor. The download procedure verifies
    the archive's repository/workflow attestation before root installs this
    immutable snapshot. Root ownership prevents post-verification replacement.
    """
    bundle = checked_path(bundle, missing=False)
    for item in [bundle, *bundle.parents]:
        info = item.stat()
        _require(info.st_uid == 0 and not info.st_mode & 0o022, "BOOTSTRAP_TRUST",
                 "Привилегированный запуск требует защищённого проверенного пакета setup.",
                 "Получите пакет по инструкции с GitHub attestation и установите его в /opt/asa-setup/<commit>.")
    manifest_path = checked_path(bundle / "setup-bundle.json", missing=False)
    info = manifest_path.stat()
    _require(info.st_uid == 0 and not info.st_mode & 0o022 and info.st_size <= 1048576,
             "BOOTSTRAP_TRUST", "Манифест пакета не защищён от замены.", "Повторно установите проверенный immutable пакет.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        valid = (manifest.get("format") == "asa-setup-bundle-v1"
                 and re.fullmatch(r"[a-f0-9]{40}", manifest.get("revision", ""))
                 and manifest.get("origin", {}).get("repository") == REPOSITORY
                 and manifest.get("origin", {}).get("workflow") == WORKFLOW
                 and isinstance(manifest.get("files"), dict) and 3 <= len(manifest["files"]) <= 2048)
        _require(valid, "BOOTSTRAP_MANIFEST", "Неизвестный формат или источник пакета setup.", "Используйте опубликованный пакет ASA Lab.")
        _require({"asa-setup.sh", "tools/asa_setup_launcher.py", "tools/asa_setup.py"} <= set(manifest["files"]),
                 "BOOTSTRAP_INCOMPLETE", "В пакете отсутствует обязательный вход setup.", "Получите полный опубликованный пакет.")
        expected_files = set(manifest["files"]) | {"setup-bundle.json"}
        expected_directories = {str(parent) for name in expected_files for parent in PurePosixPath(name).parents if str(parent) != "."}
        actual_files, actual_directories = set(), set()
        def walk_failed(error):
            raise error
        for parent, directories, filenames in os.walk(bundle, followlinks=False, onerror=walk_failed):
            for name in directories + filenames:
                path = Path(parent) / name
                metadata = path.lstat()
                _require(not stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0 and not metadata.st_mode & 0o022,
                         "BOOTSTRAP_TRUST", "Пакет содержит перенаправление или область сторонней записи.",
                         "Повторно установите immutable пакет.")
                relative = path.relative_to(bundle).as_posix()
                if name in directories:
                    _require(stat.S_ISDIR(metadata.st_mode), "BOOTSTRAP_TRUST", "Тип пути пакета изменился.", "Повторно проверьте пакет.")
                    actual_directories.add(relative)
                else:
                    _require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1, "BOOTSTRAP_TRUST",
                             "В пакете присутствует не обычный файл или hardlink.", "Повторно установите immutable пакет.")
                    actual_files.add(relative)
                _require(len(actual_files) <= 2049 and len(actual_directories) <= 8192,
                         "BOOTSTRAP_MANIFEST", "Состав пакета превышает допустимый размер.", "Получите опубликованный пакет заново.")
        _require(actual_files == expected_files and actual_directories == expected_directories,
                 "BOOTSTRAP_EXTRA_FILES", "Состав пакета не совпадает с манифестом; обнаружены лишние или отсутствующие файлы.",
                 "Используйте исходный immutable пакет; дополнительные .pyc и Python-модули не допускаются.")
        for name, expected in manifest["files"].items():
            relative = PurePosixPath(name)
            _require(not relative.is_absolute() and ".." not in relative.parts and "\\" not in name
                     and str(relative) == name and re.fullmatch(r"[a-f0-9]{64}", expected or ""),
                     "BOOTSTRAP_MANIFEST", "Небезопасный путь или digest в манифесте.", "Повторно получите проверенный пакет.")
            path = checked_path(bundle / name, missing=False)
            for directory in path.parents:
                if directory == bundle:
                    break
                directory_info = directory.stat()
                _require(directory_info.st_uid == 0 and not directory_info.st_mode & 0o022,
                         "BOOTSTRAP_TRUST", "Каталог внутри пакета допускает замену проверенного кода.",
                         "Повторно установите immutable пакет с защищёнными каталогами.")
            file_info = path.stat()
            _require(path.is_file() and file_info.st_uid == 0 and not file_info.st_mode & 0o022,
                     "BOOTSTRAP_TRUST", "Файл проверенного пакета доступен для сторонней записи.", "Повторно установите immutable пакет.")
            _require(hashlib.sha256(path.read_bytes()).hexdigest() == expected,
                     "BOOTSTRAP_DIGEST", "Содержимое пакета не совпадает с проверенным манифестом.", "Не запускайте этот пакет; получите опубликованный артефакт заново.")
        return manifest
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        raise SetupBlocked("BOOTSTRAP_MANIFEST", "Манифест пакета setup недоступен или повреждён.",
                           "Используйте проверенный опубликованный пакет ASA Lab.") from exc


def _run(args, *, timeout=45, input_data=None):
    environment = {"PATH": PATH, "HOME": "/root" if hasattr(os, "geteuid") and os.geteuid() == 0 else str(Path.home()),
                   "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "DEBIAN_FRONTEND": "noninteractive",
                   "NEEDRESTART_MODE": "l"}
    for name in ("DOCKER_HOST", "DOCKER_CONTEXT", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"):
        if name in os.environ:
            environment[name] = os.environ[name]
    try:
        result = subprocess.run(args, input=input_data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                encoding="utf-8", errors="strict", timeout=timeout, check=False, env=environment,
                                cwd="/")
    except (OSError, subprocess.SubprocessError, UnicodeError) as exc:
        raise SetupBlocked("HOST_COMMAND", "Системная проверка или установка зависимости не завершилась.",
                           "Проверьте доступ к пакетному источнику и повторите --check.") from exc
    _require(result.returncode == 0 and len(result.stdout) <= 8388608, "HOST_COMMAND",
             "Системная проверка или установка зависимости завершилась ошибкой.",
             "Проверьте доступ к пакетному источнику и повторите --check.")
    return result.stdout.strip()


def platform_info(os_release="/etc/os-release", machine=None):
    values = {}
    try:
        for line in Path(os_release).read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator:
                values[key] = value.strip().strip('"')
    except OSError:
        values = {}
    architecture = machine or platform.machine()
    return {"os": values.get("ID", "unknown"), "version": values.get("VERSION_ID", "unknown"),
            "architecture": architecture, "python": platform.python_version(),
            "supported": values.get("ID") == "ubuntu" and values.get("VERSION_ID") == "24.04"
                         and architecture in ("x86_64", "amd64") and sys.version_info >= (3, 11)}


def validate_owner(root, backup_directory=None, operator_uid=None):
    """Use mutually consistent file ownership, never SUDO_USER as authority."""
    _require(pwd is not None and os.name == "posix", "PLATFORM", "Этот вход предназначен для Linux.",
             "Используйте поддерживаемый профиль Ubuntu 24.04 amd64.")
    root = checked_path(root)
    locations = [root, root / ".git", root / ".env", root / ".asa", root / ".asa/operation.lock",
                 root / ".asa/installation.json", root / ".asa/setup.json"]
    legacy = read_legacy_installation(root)
    backup = Path(backup_directory or legacy.get("backupDirectory") or root / "backups")
    locations.append(backup)
    existing = []
    for path in locations:
        checked_path(path)
        if not path.exists():
            continue
        metadata = path.stat()
        _require(not metadata.st_mode & 0o022, "OWNER_WRITABLE", "Каталог установки или конфигурация доступны для сторонней записи.",
                 "Проверьте права конкретных путей; массовую смену владельца не выполнять.")
        if path == root / ".asa/operation.lock":
            _require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1, "LOCK_PATH",
                     "Lock прежнего менеджера должен быть обычным файлом без дополнительных ссылок.",
                     "Проверьте canonical operation.lock; он не заменяется автоматически.")
            # Legacy 0640/0644 locks are readable but not externally writable.
            # The mutation path tightens only its verified, held descriptor.
        if path in (root / ".env", root / ".asa", backup):
            _require(not metadata.st_mode & 0o077, "OWNER_PRIVATE", "Приватная конфигурация или backup не имеют приватных прав.",
                     "Проверьте владельца и права конкретного пути (.env 0600, .asa/backup 0700).")
        existing.append((path, metadata.st_uid))
    owners = {uid for _, uid in existing}
    _require(len(owners) <= 1, "OWNER_MISMATCH", "Repository, .env, .asa, lock или backup принадлежат разным владельцам.",
             "Сопоставьте владельцев перечисленных областей; не применяйте safe.directory=* или chown -R.")
    uid = next(iter(owners), operator_uid)
    _require(uid is not None and type(uid) is int and uid >= 0, "OPERATOR_REQUIRED", "Не выбран оператор новой установки.",
             "Укажите --operator с существующим Linux-пользователем или operatorUid в конфигурации.")
    _require(operator_uid is None or operator_uid == uid, "OWNER_MISMATCH", "Выбранный оператор не владеет существующей установкой.",
             "Используйте подтверждённого владельца без изменения прав остальных файлов.")
    try:
        account = pwd.getpwuid(uid)
    except KeyError as exc:
        raise SetupBlocked("OWNER_ACCOUNT", "Владелец файлов не соответствует действующему Linux-пользователю.",
                           "Восстановите сведения об исходном операторе.") from exc
    return {"uid": uid, "gid": account.pw_gid, "name": account.pw_name, "home": account.pw_dir,
            "root": str(root), "backupDirectory": str(backup), "paths": [str(path) for path, _ in existing]}


def _installed_packages(runner):
    # A database/permission failure must not masquerade as an absent Engine.
    value = runner(["/usr/bin/dpkg-query", "-W", "-f=${binary:Package}\t${Status}\n"])
    packages = set()
    for line in value.splitlines():
        fields = line.split("\t", 1)
        _require(len(fields) == 2 and re.fullmatch(r"[A-Za-z0-9+.:_-]+", fields[0]), "PACKAGE_DATABASE",
                 "Не удалось полностью проверить установленные пакеты.", "Проверьте dpkg; отсутствие Docker не доказано.")
        if fields[1] == "install ok installed":
            packages.add(fields[0].split(":", 1)[0])
    return packages


def _installed(package, runner):
    return package in _installed_packages(runner)


def dependency_plan(*, cloud=False, local_transport=False, browser=False, runner=None, which=None):
    """Only absent tools enter the plan. An inaccessible Docker is not absent."""
    runner = runner or _run
    which = which or (lambda name: shutil.which(name, path=PATH))
    missing = []
    installed = _installed_packages(runner) if browser or not which("docker") else None
    for command, package in (("git", "git"), ("curl", "curl")):
        if not which(command):
            missing.append(package)
    if not Path("/etc/ssl/certs/ca-certificates.crt").is_file():
        missing.append("ca-certificates")
    if cloud:
        for command, package in [("age", "age")] + ([("rclone", "rclone")] if local_transport else []):
            if not which(command):
                missing.append(package)
    if browser:
        missing += [package for package in CHROMIUM_PACKAGES if package not in installed]
    docker_present = bool(which("docker"))
    daemon_id = None
    if docker_present:
        try:
            daemon_id = runner([which("docker"), "info", "--format", "{{.ID}}"])
            _require(bool(daemon_id), "DOCKER_UNKNOWN", "Docker не вернул идентичность daemon.", "Проверьте его доступность и context.")
        except SetupBlocked as exc:
            raise SetupBlocked("DOCKER_UNKNOWN", "Docker установлен, но выбранный daemon недоступен.",
                               "Проверьте socket, права и context; Docker повторно не устанавливается.") from exc
        try:
            runner([which("docker"), "compose", "version", "--short"])
        except SetupBlocked:
            missing.append("docker-compose-v2" if _installed("docker.io", runner) else "docker-compose-plugin")
    else:
        remnants = [path for path in ("/var/lib/docker", "/etc/docker/daemon.json", "/run/docker.sock",
                                      "/usr/bin/dockerd", "/usr/local/bin/dockerd", "/lib/systemd/system/docker.service")
                    if Path(path).exists()]
        docker_installed = set((*DOCKER_PACKAGES, *CONFLICTING_PACKAGES)) & installed
        _require(not remnants and not docker_installed and not os.environ.get("DOCKER_HOST") and not os.environ.get("DOCKER_CONTEXT"),
                 "DOCKER_UNKNOWN", "CLI Docker отсутствует, но сохранились признаки установленного Engine или context.",
                 "Восстановите доступ к исходному Engine; новый Docker не устанавливается.")
        missing += ([] if which("gpg") else ["gnupg"]) + list(DOCKER_PACKAGES)
    return {"format": "asa-host-dependency-plan-v1", "missing": sorted(set(missing)),
            "installDocker": not docker_present, "daemonId": daemon_id, "browser": bool(browser),
            "source": "Ubuntu 24.04 signed apt; Docker official noble/stable for a genuinely absent Engine"}


def _atomic_root_file(path, content, mode=0o644):
    path = checked_path(path)
    checked_path(path.parent, missing=False)
    parent_info = path.parent.stat()
    _require(parent_info.st_uid == 0 and not parent_info.st_mode & 0o022, "HOST_PATH",
             "Системный каталог не защищён от записи сторонним пользователем.", "Проверьте системный каталог вручную.")
    if path.exists():
        _require(path.is_file() and path.stat().st_uid == 0 and path.read_bytes() == content, "HOST_CONFIG_EXISTS",
                 "Системная конфигурация уже существует с другим содержимым.", "Проверьте существующий источник пакетов; автоматически он не заменяется.")
        return
    descriptor, name = tempfile.mkstemp(prefix=".asa-setup-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        # link() is exclusive and cannot overwrite a file created by another run.
        os.link(temporary, path, follow_symlinks=False)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def _apt_install(packages, runner):
    packages = list(dict.fromkeys(packages))
    _require(set(packages) <= PACKAGE_ALLOWLIST, "PACKAGE_ALLOWLIST", "Неизвестная системная зависимость.", "Используйте официальный setup bundle.")
    pins = {}
    for package in packages:
        policy = runner(["/usr/bin/apt-cache", "policy", package])
        match = re.search(r"^\s*Candidate:\s*([A-Za-z0-9.+:~_-]+)\s*$", policy, re.MULTILINE)
        _require(match is not None, "PACKAGE_SOURCE", "Подписанный пакетный источник не предлагает нужную зависимость.",
                 "Проверьте официальные источники Ubuntu/Docker и повторите --prepare-host.")
        pins[package] = match.group(1)
    arguments = [f"{name}={version}" for name, version in pins.items()]
    simulation = runner(["/usr/bin/apt-get", "--simulate", "--no-remove", "--no-upgrade", "install", *arguments])
    _require(not any(line.startswith(("Remv ", "Purg ")) or re.match(r"^Inst \S+ \[", line)
                     for line in simulation.splitlines()), "PACKAGE_EXISTING_CHANGE",
             "Подготовка зависимостей требует изменения уже установленных пакетов.",
             "Разберите конфликт отдельно; действующий Docker и приложения сохраняются.")
    runner(["/usr/bin/apt-get", "-y", "--no-remove", "--no-upgrade", "--no-install-recommends", "install", *arguments], timeout=900)
    return pins


def provision_dependencies(plan, *, runner=None):
    """Perform the allowlisted plan; never remove conflicts or restart an Engine."""
    runner = runner or _run
    _require(os.name == "posix" and os.geteuid() == 0, "PRIVILEGE", "Для установки недостающих пакетов нужны права root.",
             "Запустите проверенный asa-setup.sh через sudo.")
    _require(platform_info()["supported"], "PLATFORM", "Системная подготовка поддержана только на Ubuntu 24.04 amd64.",
             "Используйте заявленный профиль; параметры хоста не изменены.")
    _require(plan.get("format") == "asa-host-dependency-plan-v1" and isinstance(plan.get("missing"), list)
             and set(plan["missing"]) <= PACKAGE_ALLOWLIST, "PACKAGE_PLAN", "Недопустимый план системной подготовки.",
             "Повторите проверку через официальный setup.")
    if not plan["missing"]:
        return {"installed": {}, "dockerInstalled": False}
    # Re-inventory immediately before apt; a new Engine installed in parallel
    # cannot accidentally enter the 'absent Docker' path.
    current = dependency_plan(cloud=bool({"age", "rclone"} & set(plan["missing"])),
                              local_transport="rclone" in plan["missing"], browser=plan.get("browser") is True)
    _require(current["installDocker"] == plan["installDocker"] and set(plan["missing"]) <= set(current["missing"]),
             "PACKAGE_PLAN_DRIFT", "Состав зависимостей изменился после проверки.", "Повторите --check перед системной подготовкой.")
    pins = {}
    runner(["/usr/bin/apt-get", "update"], timeout=300)
    base = [package for package in plan["missing"] if package not in DOCKER_PACKAGES]
    if base:
        pins.update(_apt_install(base, runner))
    if plan["installDocker"]:
        _require(not any(_installed(package, runner) for package in CONFLICTING_PACKAGES), "DOCKER_CONFLICT",
                 "Обнаружен несовместимый существующий container runtime.", "Разберите совместимость отдельно; пакеты не удаляются.")
        key_directory = checked_path(Path("/etc/apt/keyrings"))
        if not key_directory.exists():
            key_directory.mkdir(mode=0o755)
        with urllib.request.urlopen(DOCKER_KEY_URL, timeout=30) as response:
            key = response.read(65537)
        _require(len(key) <= 65536, "DOCKER_KEY", "Ключ пакетного источника превышает допустимый размер.", "Проверьте официальный источник Docker.")
        with tempfile.TemporaryDirectory(prefix="asa-docker-key-") as temporary:
            key_path = Path(temporary) / "docker.asc"
            key_path.write_bytes(key)
            os.chmod(key_path, 0o600)
            fingerprint = runner(["/usr/bin/gpg", "--batch", "--no-options", "--homedir", temporary,
                                  "--with-colons", "--import-options", "show-only", "--import", str(key_path)])
        fingerprints = [line.split(":")[9] for line in fingerprint.splitlines() if line.startswith("fpr:")]
        _require(fingerprints and fingerprints[0] == DOCKER_KEY_FINGERPRINT, "DOCKER_KEY",
                 "Fingerprint ключа Docker не совпадает с закреплённым.", "Не устанавливайте пакеты; проверьте смену ключа источника.")
        _atomic_root_file(key_directory / "asa-docker.asc", key)
        source = ("Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\n"
                  "Components: stable\nArchitectures: amd64\nSigned-By: /etc/apt/keyrings/asa-docker.asc\n").encode()
        _atomic_root_file(Path("/etc/apt/sources.list.d/asa-docker.sources"), source)
        runner(["/usr/bin/apt-get", "update"], timeout=300)
    docker_packages = [package for package in plan["missing"] if package in DOCKER_PACKAGES]
    if docker_packages:
        pins.update(_apt_install(docker_packages, runner))
    # Package scripts may start a newly installed Engine; no systemctl restart,
    # daemon.json change, data-root move, or container recreation is performed.
    final = dependency_plan(cloud=bool({"age", "rclone"} & set(plan["missing"])),
                            local_transport="rclone" in plan["missing"], browser=plan.get("browser") is True)
    _require(not set(plan["missing"]) & set(final["missing"]), "DEPENDENCIES_INCOMPLETE",
             "Зависимости ещё не готовы после пакетной установки.", "Проверьте status Docker/Compose и повторите --check.")
    return {"installed": pins, "dockerInstalled": bool(plan["installDocker"]), "daemonId": final["daemonId"]}


def _private_write(path, data):
    path = checked_path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    _require(path.parent.stat().st_uid == os.geteuid() and not path.parent.stat().st_mode & 0o077,
             "RUNTIME_PATH", "Приватный runtime-каталог имеет неподтверждённого владельца или права.",
             "Выберите приватный каталог проверенного оператора.")
    descriptor, name = tempfile.mkstemp(prefix=".asa-runtime-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _browser_command(args, browsers_path, *, timeout=900):
    environment = {"PATH": PATH, "HOME": pwd.getpwuid(os.geteuid()).pw_dir, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
                   "PLAYWRIGHT_BROWSERS_PATH": str(browsers_path), "PYTHONDONTWRITEBYTECODE": "1"}
    for name in ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"):
        if name in os.environ:
            environment[name] = os.environ[name]
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", timeout=timeout, check=False, env=environment)
    except (OSError, subprocess.SubprocessError) as exc:
        raise SetupBlocked("BROWSER_RUNTIME", "Подготовка изолированного браузерного runtime не завершилась.",
                           "Проверьте доступ к PyPI/CDN Playwright и системные библиотеки Chromium.") from exc
    _require(result.returncode == 0, "BROWSER_RUNTIME", "Изолированный браузерный runtime не прошёл установку или проверку запуска.",
             "Проверьте системные библиотеки, права оператора и доступ к PyPI/CDN; TLS и sandbox не отключаются.")
    return result.stdout.strip()


def prepare_browser_runtime(directory):
    """Install pinned wheels and Chromium as the operator, outside live .asa.

    This does not use host Node/pnpm, a mutable requirements file, pip config,
    or an unpinned dependency resolver. A stopped preparation resumes the same
    private staging directory. No real site, user, or fixture is touched.
    """
    directory = checked_path(directory)
    _require(directory.name == "playwright-" + BROWSER_VERSION, "BROWSER_PATH", "Неожиданное имя браузерного runtime.",
             "Используйте отдельный каталог закреплённой версии Playwright.")
    expected = {"format": "asa-browser-runtime-v1", "playwright": BROWSER_VERSION,
                "chromium": CHROMIUM_VERSION, "chromiumRevision": CHROMIUM_REVISION,
                "requirementsSha256": hashlib.sha256(BROWSER_REQUIREMENTS.encode()).hexdigest(),
                "operatorUid": os.geteuid()}
    final_receipt = directory / "asa-runtime.json"
    if directory.exists():
        receipt = read_private_json(final_receipt, required=True)
        _require(all(receipt.get(key) == value for key, value in expected.items()), "BROWSER_IDENTITY",
                 "Существующий browser runtime не соответствует закреплённой версии или оператору.",
                 "Проверьте отдельный runtime; чужое окружение не переустанавливается.")
        target = directory
    else:
        parent = checked_path(directory.parent)
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        _require(parent.stat().st_uid == os.geteuid() and not parent.stat().st_mode & 0o022, "BROWSER_OWNER",
                 "Каталог browser runtime не принадлежит выбранному оператору.", "Используйте приватный каталог оператора.")
        target = parent / ("." + directory.name + ".staging")
        marker = target / "asa-runtime.json"
        if target.exists():
            receipt = read_private_json(marker, required=True)
            _require(all(receipt.get(key) == value for key, value in expected.items()), "BROWSER_IDENTITY",
                     "Незавершённый runtime относится к другой версии или оператору.", "Проверьте происхождение staging-каталога.")
        else:
            target.mkdir(mode=0o700)
            _private_write(marker, (json.dumps(expected) + "\n").encode())
        browsers = target / "browsers"
        python = target / "bin/python"
        if not python.exists():
            _browser_command(["/usr/bin/python3.12", "-I", "-m", "venv", "--copies", str(target)], browsers)
        requirements = target / "requirements.lock"
        _private_write(requirements, BROWSER_REQUIREMENTS.encode())
        _browser_command([str(python), "-I", "-m", "pip", "--isolated", "--disable-pip-version-check", "install",
                          "--require-hashes", "--only-binary=:all:", "--no-deps", "--index-url", "https://pypi.org/simple",
                          "-r", str(requirements)], browsers)
        _browser_command([str(python), "-I", "-m", "playwright", "install", "chromium"], browsers)
    python = target / "bin/python"
    browsers = target / "browsers"
    # Test exactly the runtime and real browser that will run acceptance. The
    # trusted wrapper does not add --no-sandbox or ignore_https_errors flags.
    probe = ("import importlib.metadata,json; from playwright.sync_api import sync_playwright; "
             "assert importlib.metadata.version('playwright')=='1.56.0'; "
             "p=sync_playwright().start(); b=p.chromium.launch(headless=True); "
             "assert b.version=='141.0.7390.37'; print(json.dumps({'playwright':'1.56.0','chromium':b.version})); "
             "b.close(); p.stop()")
    proof = json.loads(_browser_command([str(python), "-I", "-c", probe], browsers, timeout=60))
    receipt = {**expected, **proof, "verifiedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "state": "READY"}
    _private_write(target / "asa-runtime.json", (json.dumps(receipt) + "\n").encode())
    if target != directory:
        os.rename(target, directory)
    return {**receipt, "pythonPath": str(directory / "bin/python"), "browsersPath": str(directory / "browsers")}


def _trusted_cloud(bundle):
    source = checked_path(bundle / "tools/deployment/ops/cloud_storage.py", missing=False)
    descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        content = stream.read(262145)
    _require(hashlib.sha256(content).hexdigest() == CLOUD_SOURCE_SHA256, "CLOUD_SOURCE",
             "Облачный компонент не совпадает с разрешённой версией.", "Используйте согласованный setup bundle и транспорт.")
    module = types.ModuleType("asa_setup_pinned_cloud")
    module.__file__ = str(source)
    exec(compile(content, str(source), "exec"), module.__dict__)
    return module


def prepare_cloud_transport(bundle, *, owner, credential_file=None, replace_credentials=False):
    """Prepare only the pinned shared transport and an explicitly supplied secret.

    Reusing a correct running service performs no pull/recreate. Credential bytes
    are parsed privately, never passed as command arguments or returned/logged.
    """
    _require(os.geteuid() == 0, "CLOUD_ROOT", "Первичная настройка общего облачного транспорта требует root.",
             "Запустите проверенный setup через sudo.")
    module = _trusted_cloud(bundle)
    ids = _run(["docker", "ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project=" + module.PROJECT]).split()
    _require(len(ids) <= 1 and all(re.fullmatch(r"[a-f0-9]{64}", value) for value in ids), "CLOUD_IDENTITY",
             "Найден неоднозначный общий cloud transport.", "Сверьте существующий Compose project облачного транспорта.")
    reused = False
    if ids:
        template = ('{"image":{{json .Config.Image}},"user":{{json .Config.User}},"running":{{json .State.Running}},'
                    '"owner":{{json (index .Config.Labels "asa.owner")}},"mounts":{{json .Mounts}},'
                    '"ports":{{json .HostConfig.PortBindings}},"readonly":{{json .HostConfig.ReadonlyRootfs}}}')
        record = json.loads(_run(["docker", "inspect", "--format", template, ids[0]]))
        mounts = {(item.get("Type"), item.get("Source"), item.get("Destination")) for item in record.get("mounts", [])}
        _require(record.get("image") == module.IMAGE and record.get("user") == "1000:1000"
                 and record.get("owner") == module.PROJECT and record.get("readonly") is True and not record.get("ports")
                 and mounts == {("bind", str(module.ROOT / "config"), "/config/rclone"),
                                ("bind", str(module.ROOT / "data"), "/data")},
                 "CLOUD_IDENTITY", "Существующий cloud transport отличается от закреплённого безопасного профиля.",
                 "Проверьте конфигурацию отдельно; чужой контейнер не пересоздаётся.")
        reused = bool(record.get("running"))
    if not reused:
        try:
            module.install()
        except Exception as exc:
            raise SetupBlocked("CLOUD_INSTALL", "Общий cloud transport не установлен; чувствительные сведения скрыты.",
                               "Проверьте Docker registry и принадлежность /srv/asa-cloud-storage.") from exc
    if credential_file:
        source = checked_path(credential_file, missing=False)
        info = source.stat()
        _require(source.is_file() and info.st_uid == owner["uid"] and info.st_mode & 0o077 == 0 and info.st_size <= 131072,
                 "CLOUD_CREDENTIAL_FILE", "Файл OAuth-конфигурации должен принадлежать оператору и иметь права 0600.",
                 "Передайте приватный файл rclone.conf через защищённый канал, без секретов в аргументах.")
        descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            data = stream.read(131073)
        parser = configparser.ConfigParser(interpolation=None)
        try:
            parser.read_string(data.decode("utf-8"))
            token = json.loads(parser["yandex"]["token"])
            _require(set(parser.sections()) == {"yandex"} and not parser.defaults()
                     and set(parser["yandex"]) <= {"type", "token", "client_id", "client_secret"}
                     and parser["yandex"].get("type") == "yandex"
                     and isinstance(token, dict) and isinstance(token.get("access_token"), str) and bool(token["access_token"]),
                     "CLOUD_CREDENTIAL_SCHEMA", "Приватная конфигурация не соответствует отдельному Yandex remote.",
                     "Используйте один раздел [yandex] с официальным OAuth token; другие секреты не импортируются.")
        except (ValueError, KeyError, UnicodeError, configparser.Error) as exc:
            raise SetupBlocked("CLOUD_CREDENTIAL_SCHEMA", "Не удалось проверить приватный файл облачной авторизации.",
                               "Подготовьте корректный rclone.conf для единственного Yandex remote.") from exc
        target = checked_path(module.ROOT / "config/rclone.conf", missing=False)
        current = target.read_bytes()
        _require(not current or current == data or replace_credentials, "CLOUD_CREDENTIAL_EXISTS",
                 "Облачная авторизация уже настроена и отличается от предложенной.",
                 "Для осознанной замены используйте отдельную команду cloud-configure.")
        if current != data:
            descriptor, name = tempfile.mkstemp(prefix=".asa-oauth-", dir=target.parent)
            temporary = Path(name)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    os.fchmod(stream.fileno(), 0o600)
                    os.fchown(stream.fileno(), 1000, 1000)
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
    return {"format": "asa-cloud-preparation-v1", "project": module.PROJECT, "image": module.IMAGE,
            "reused": reused, "tokenConfigured": module.connected(), "deliveryVerified": False,
            "preparedAt": dt.datetime.now(dt.timezone.utc).isoformat()}


def _owner_call(owner, arguments, environment, *, capture=False, timeout=None):
    options = {"cwd": owner["root"], "env": environment, "text": True, "encoding": "utf-8", "timeout": timeout,
               "check": False, "umask": 0o077}
    if capture:
        options.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if os.geteuid() == 0:
        options.update(user=owner["uid"], group=owner["gid"], extra_groups=os.getgrouplist(owner["name"], owner["gid"]))
    return subprocess.run(arguments, **options)


def _write_owner_json(path, value, owner):
    """Atomically write a bounded receipt/config through an owner-private dirfd.

    Root may only replace the named file in the already-open private directory;
    an operator changing symlinks cannot redirect a privileged write elsewhere.
    """
    path = checked_path(path)
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    _require(len(payload) <= 262144, "CONFIG_SIZE", "Приватная конфигурация превышает допустимый размер.",
             "Проверьте формат сохранённой конфигурации.")
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = ".asa-preparation-" + os.urandom(16).hex() + ".tmp"
    try:
        info = os.fstat(directory)
        _require(info.st_uid == owner["uid"] and info.st_mode & 0o077 == 0, "CONFIG_OWNER",
                 "Каталог приватной конфигурации изменил владельца или права.", "Проверьте владельца .asa; автоматическая смена прав не выполняется.")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(descriptor, "wb") as stream:
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), owner["uid"], owner["gid"])
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)


def prepare_handoff(root, owner, bundle, result, environment, *, non_interactive=False):
    """Prepare selected dependencies only before a saved operation can switch.

    The child result requests capability kinds, never package names, commands,
    user IDs, or executable paths. Re-read the owner-private config/journal and
    retain the same operation and installation identity across this handoff.
    """
    request = result.get("preparation")
    operation_id = result.get("operationId")
    _require(isinstance(request, dict) and set(request) <= {"packages", "cloud", "browser"}
             and all(type(value) is bool for value in request.values())
             and isinstance(operation_id, str) and re.fullmatch(r"[a-f0-9]{32}", operation_id),
             "PREPARATION_REQUEST", "Неподдерживаемый запрос системной подготовки.", "Проверьте совместимость setup bundle.")
    config_path = root / ".asa/setup.json"
    config = read_private_json(config_path, required=True)
    current_owner = validate_owner(root, backup_directory=config.get("backupDirectory"), operator_uid=owner["uid"])
    journal_path = root / ".asa/setup-operations" / (operation_id + ".json")
    journal = read_private_json(journal_path, required=True)
    _require(current_owner["uid"] == owner["uid"] and owner["uid"] != 0
             and config.get("format") == "asa-setup-config-v1" and config.get("operatorUid") == owner["uid"]
             and config.get("root") == str(root) and config.get("installationId") == result.get("installationId")
             and isinstance(config.get("installationId"), str) and re.fullmatch(r"[a-f0-9]{32}", config["installationId"])
             and journal.get("format") == "asa-setup-operation-v1" and journal.get("root") == str(root)
             and journal.get("operationId") == operation_id and journal.get("installationId") == config["installationId"]
             and journal.get("project") == config.get("project") and journal.get("state") == "RUNNING"
             and isinstance(journal.get("stages"), dict) and "switch" not in journal["stages"]
             and journal_path.stat().st_uid == owner["uid"] and config_path.stat().st_uid == owner["uid"],
             "PREPARATION_IDENTITY", "Идентичность или этап операции изменились до системной подготовки.",
             "Выполните status; после начала переключения подготовка не запускается.")
    backup = config.get("backup", {})
    cloud = backup.get("cloud", {}) if isinstance(backup, dict) else None
    browser = config.get("browser", {})
    _require(isinstance(cloud, dict) and isinstance(browser, dict), "CONFIG_SCHEMA",
             "Разделы cloud/browser не соответствуют схеме.", "Проверьте сохранённую приватную конфигурацию.")
    _require(not request.get("cloud") or cloud.get("enabled") is True, "CLOUD_POLICY",
             "Подготовка облака не разрешена сохранённой настройкой.", "Выберите политику резервных копий через configure.")
    environment = dict(environment)
    plan = dependency_plan(cloud=cloud.get("enabled") is True, browser=request.get("browser") is True)
    _require(not plan["installDocker"], "DOCKER_UNKNOWN", "Исходный Docker недоступен в незавершённой операции.",
             "Восстановите прежний Engine; новый daemon не создаётся во время resume.")
    if plan["missing"]:
        environment["ASA_SETUP_HOST_PREPARATION"] = json.dumps(provision_dependencies(plan), separators=(",", ":"))
    changed = False
    if request.get("cloud"):
        credential_file = cloud.get("rcloneConfigFile")
        proof = prepare_cloud_transport(bundle, owner=owner, credential_file=credential_file)
        if not proof.get("tokenConfigured"):
            _require(not non_interactive and sys.stdin.isatty(), "CLOUD_CONFIGURATION",
                     "Для выбранного облачного backup отсутствует авторизация Yandex.",
                     "Укажите backup.cloud.rcloneConfigFile — приватный файл оператора 0600; токены в аргументы не передавайте.")
            credential_file = input("Путь к приватному файлу rclone.conf с авторизацией Yandex: ").strip()
            _require(bool(credential_file), "CLOUD_CONFIGURATION", "Приватный файл авторизации не выбран.",
                     "Подготовьте rclone.conf и продолжите сохранённый operation ID.")
            proof = prepare_cloud_transport(bundle, owner=owner, credential_file=credential_file)
            _require(proof.get("tokenConfigured"), "CLOUD_CONFIGURATION", "Облачная авторизация ещё не подтверждена.",
                     "Проверьте приватный rclone.conf; приложение пока не переключалось.")
            cloud["rcloneConfigFile"] = str(checked_path(credential_file, missing=False))
            changed = True
        environment["ASA_SETUP_CLOUD_PREPARATION"] = json.dumps(proof, separators=(",", ":"))
    if request.get("browser"):
        runtime = Path(owner["home"]) / ".local/share/asa-setup" / ("playwright-" + BROWSER_VERSION)
        process = _owner_call(owner, ["/usr/bin/python3", "-I", "-B", str(bundle / "tools/asa_setup_launcher.py"),
                                     "--prepare-browser-runtime", "--runtime-root", str(runtime)], environment,
                              capture=True, timeout=1200)
        _require(process.returncode == 0, "BROWSER_RUNTIME", "Браузерный runtime не готов для оператора установки.",
                 "Проверьте PyPI/Chromium CDN и системные библиотеки; приёмка не завершена.")
        proof = json.loads(process.stdout)
        _require(proof.get("state") == "READY" and proof.get("playwright") == BROWSER_VERSION
                 and proof.get("pythonPath") == str(runtime / "bin/python") and proof.get("browsersPath") == str(runtime / "browsers"),
                 "BROWSER_RUNTIME", "Браузерный runtime не представил ожидаемое свидетельство.", "Повторите системную подготовку.")
        browser.update(pythonPath=proof["pythonPath"], browsersPath=proof["browsersPath"])
        config["browser"] = browser
        environment["ASA_SETUP_BROWSER_PYTHON"] = proof["pythonPath"]
        environment["ASA_SETUP_BROWSERS_PATH"] = proof["browsersPath"]
        changed = True
    if changed:
        _write_owner_json(config_path, config, owner)
    _write_owner_json(root / ".asa/setup-host-preparation.json", {"format": "asa-host-preparation-v1",
        "operationId": operation_id, "installationId": config["installationId"], "state": "PREPARED",
        "at": dt.datetime.now(dt.timezone.utc).isoformat(), "preparation": request}, owner)
    return environment


def discover_roots(runner=None):
    runner = runner or _run
    docker = shutil.which("docker", path=PATH)
    if not docker:
        return []
    identifiers = runner([docker, "ps", "-aq", "--no-trunc", "--filter", "label=com.docker.compose.project"]).split()
    _require(len(identifiers) <= 4096 and all(re.fullmatch(r"[a-f0-9]{64}", value) for value in identifiers),
             "DOCKER_UNKNOWN", "Список контейнеров не прошёл проверку.", "Проверьте исходный Docker daemon.")
    template = ('{"image":{{json .Config.Image}},"root":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},'
                '"source":{{json (index .Config.Labels "org.opencontainers.image.source")}}}')
    roots = set()
    for offset in range(0, len(identifiers), 64):
        batch = identifiers[offset:offset + 64]
        values = [json.loads(line) for line in runner([docker, "inspect", "--format", template, *batch]).splitlines() if line]
        _require(len(values) == len(batch), "DOCKER_UNKNOWN", "Инвентаризация контейнеров неполна.", "Повторите --check.")
        for value in values:
            image = str(value.get("image") or "")
            if (image.startswith("ghcr.io/" + REPOSITORY + "/")
                    or re.match(r"asa-lab-(api|web|scratch|minio|search)(:|@)", image)
                    or value.get("source") == "https://github.com/" + REPOSITORY):
                _require(isinstance(value.get("root"), str) and bool(value["root"]), "TARGET_UNKNOWN",
                         "Ресурс ASA не содержит канонический каталог.", "Уточните прежнюю установку; пустой сервер не предполагается.")
                roots.add(str(checked_path(value["root"])))
    return sorted(roots)


def operator_environment(owner, daemon_id=None):
    result = {"PATH": PATH, "HOME": owner["home"], "USER": owner["name"], "LOGNAME": owner["name"],
              "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1",
              "ASA_SETUP_OPERATOR_UID": str(owner["uid"]), "ASA_SETUP_OPERATOR_NAME": owner["name"]}
    for name in ("TERM", "NO_COLOR", "COLORTERM", "GH_TOKEN", "GITHUB_TOKEN", "DOCKER_HOST", "DOCKER_CONTEXT",
                 "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"):
        if name in os.environ:
            result[name] = os.environ[name]
    if daemon_id:
        result["ASA_SETUP_DAEMON_ID"] = daemon_id
    return result


def emit_blocked(error, *, as_json=False, operation_id=None, installation_id=None):
    names = ["Сервер и зависимости", "Версия ASA Lab", "База и файлы", "Резервные копии", "Сайт и пользовательские действия", "Диагностика"]
    checks = [{"name": name, "status": "BLOCKED" if index == 0 else "NOT_RUN", "required": index < 5}
              for index, name in enumerate(names)]
    result = {"format": "asa-setup-result-v1", "operationId": operation_id, "installationId": installation_id,
              "outcome": "BLOCKED", "stage": "bootstrap", "accepted": False, "executionCompleted": False,
              "dataProtectionConfirmed": False, "at": dt.datetime.now(dt.timezone.utc).isoformat(),
              "checks": checks, "error": {"code": error.code, "message": str(error), "action": error.action},
              "nextAction": error.action}
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print("ОСТАНОВЛЕНО — ПОДГОТОВКА НЕ ЗАВЕРШЕНА")
        for index, name in enumerate(names, 1):
            print(f"{index}. {'[!] ОСТАНОВЛЕНО' if index == 1 else '[ ] НЕ ПРОВЕРЕНО'} — {name}")
        if operation_id:
            print("Операция: " + operation_id)
        print(f"{error.code}: {error}\nСледующее действие: {error.action}")
    return 2


def main(argv=None):
    arguments = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("--root")
    parser.add_argument("--operator")
    parser.add_argument("--config", "--config-file")
    parser.add_argument("--non-interactive", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--prepare-host", action="store_true")
    parser.add_argument("--prepare-browser-runtime", action="store_true")
    parser.add_argument("--runtime-root")
    parser.add_argument("--check", action="store_true")
    parsed, remainder = parser.parse_known_args(arguments)
    if "--help" in arguments or "-h" in arguments:
        print("ASA Lab — единая установка и обновление\n"
              "sudo bash ./asa-setup.sh [--root /srv/asa-lab] [--config /путь/setup.json]\n"
              "Команды: check, status, resume, backup, cloud-retry, diagnose, restore-plan.\n"
              "--operator USER — первый выбор оператора; существующий владелец определяется по файлам.\n"
              "--prepare-host — подготовка отсутствующих зависимостей; --check — без изменений.\n"
              "--non-interactive — не задавать вопросы; --json — машинный результат.\n"
              "Привилегированный вход используется из пакета с проверенной GitHub attestation.")
        return 0
    active_result = {}
    try:
        _require(os.name == "posix" and pwd is not None, "PLATFORM", "Этот вход поддерживает Linux Ubuntu 24.04 amd64.",
                 "Используйте соответствующий профиль установщика.")
        bundle = Path(__file__).absolute().parent.parent
        elevated = os.geteuid() == 0
        if elevated:
            verify_bundle(bundle)
        _require(platform_info()["supported"], "PLATFORM", "Обнаружена платформа вне профиля Ubuntu 24.04 amd64 / Python 3.11+.",
                 "Установка не изменена; используйте поддерживаемый профиль.")
        if parsed.prepare_browser_runtime:
            _require(not elevated, "BLOCKED_OWNER", "Браузерный runtime выполняется только от выбранного non-root оператора.",
                     "Используйте обычный вход setup; UID снимается до установки runtime.")
            expected_runtime = Path(pwd.getpwuid(os.geteuid()).pw_dir) / ".local/share/asa-setup" / ("playwright-" + BROWSER_VERSION)
            _require(parsed.runtime_root == str(expected_runtime), "BROWSER_PATH", "Неподтверждённый каталог browser runtime.",
                     "Используйте приватный runtime выбранного оператора.")
            print(json.dumps(prepare_browser_runtime(expected_runtime), ensure_ascii=False))
            return 0
        config = read_private_json(Path(parsed.config).absolute(), required=True) if parsed.config else {}
        _require(not config or config.get("format") == "asa-setup-config-v1", "CONFIG_SCHEMA",
                 "Неподдерживаемый формат конфигурации setup.", "Используйте asa-setup-config-v1.")
        requested_root = parsed.root or config.get("root")
        if not requested_root:
            roots = discover_roots()
            if len(roots) == 1:
                requested_root = roots[0]
            elif len(roots) > 1:
                if parsed.non_interactive or not sys.stdin.isatty():
                    raise SetupBlocked("TARGET_REQUIRED", "Найдено несколько установок ASA Lab.", "Выберите один канонический каталог через --root.")
                print("Найденные каталоги ASA Lab:\n" + "\n".join(roots))
                requested_root = input("Каталог выбранной установки: ").strip()
                _require(requested_root in roots, "TARGET_REQUIRED", "Выбранный каталог не подтверждён инвентаризацией.", "Выберите один из показанных каталогов.")
            elif (Path.cwd() / "tools/asa_manager.py").is_file() and (Path.cwd() / ".git").is_dir():
                requested_root = str(Path.cwd())
            elif not parsed.non_interactive and sys.stdin.isatty():
                requested_root = input("Каталог новой установки [/srv/asa-lab]: ").strip() or "/srv/asa-lab"
            else:
                raise SetupBlocked("TARGET_REQUIRED", "Каталог новой установки не задан.", "Укажите --root или приватную конфигурацию; обязательный ввод не ожидается в фоне.")
        root = checked_path(requested_root)
        persisted = read_private_json(root / ".asa/setup.json")
        supplied_uid = config.get("operatorUid", persisted.get("operatorUid"))
        if parsed.operator:
            try:
                account = pwd.getpwnam(parsed.operator)
                supplied_uid = account.pw_uid
            except KeyError as exc:
                raise SetupBlocked("OPERATOR_REQUIRED", "Указанного Linux-пользователя не существует.", "Создайте системного оператора отдельно или выберите существующего.") from exc
        if supplied_uid is None and not root.exists():
            if not elevated:
                supplied_uid = os.geteuid()
            elif not parsed.non_interactive and sys.stdin.isatty():
                name = input("Linux-пользователь — оператор новой установки: ").strip()
                try:
                    supplied_uid = pwd.getpwnam(name).pw_uid
                except KeyError as exc:
                    raise SetupBlocked("OPERATOR_REQUIRED", "Оператор не найден.", "Укажите существующего Linux-пользователя.") from exc
        if supplied_uid is None and root.exists() and root.stat().st_uid == 0 and not (root / ".env").exists():
            raise SetupBlocked("OPERATOR_REQUIRED", "Для новой установки от root оператор должен быть выбран явно.",
                               "Укажите --operator или operatorUid; старые установки используют прежнего владельца автоматически.")
        owner = validate_owner(root, operator_uid=supplied_uid)
        _require(owner["uid"] != 0, "BLOCKED_OWNER", "Установка с владельцем root требует отдельного согласованного перехода к оператору.",
                 "Сохраните владельцев и данные; выберите non-root оператора новой установки или согласуйте переход старой отдельно.")
        _require(elevated or owner["uid"] == os.geteuid(), "OPERATOR_PERMISSION", "Текущий пользователь не является владельцем установки.",
                 "Запустите проверенный setup через sudo; он выберет владельца автоматически.")
        if parsed.config:
            _require(Path(parsed.config).stat().st_uid == owner["uid"], "CONFIG_OWNER", "Конфигурация принадлежит другому оператору.",
                     "Используйте приватный конфигурационный файл выбранного владельца.")
        backup_config = config.get("backup", persisted.get("backup", {}))
        _require(isinstance(backup_config, dict), "CONFIG_SCHEMA", "Раздел backup должен быть JSON-объектом.", "Исправьте формат backup.")
        browser_config = config.get("browser", persisted.get("browser", {}))
        _require(isinstance(browser_config, dict), "CONFIG_SCHEMA", "Раздел browser должен быть JSON-объектом.", "Исправьте формат browser.")
        cloud_config = backup_config.get("cloud", {})
        _require(isinstance(cloud_config, dict), "CONFIG_SCHEMA", "Раздел cloud должен быть JSON-объектом.", "Исправьте формат cloud.")
        command = remainder[0] if remainder and not remainder[0].startswith("-") else "auto"
        dry = parsed.check or command in ("check", "status", "doctor", "diagnose", "restore-plan")
        need_browser = not dry and command in ("auto", "resume", "configure", "acceptance") and not browser_config.get("pythonPath")
        needs_cloud = bool(cloud_config) and cloud_config.get("enabled") is not False
        cloud_enabled = bool(backup_config.get("recipient") or backup_config.get("ageRecipient") or needs_cloud)
        plan = dependency_plan(cloud=cloud_enabled, browser=need_browser)
        prepared = None
        if plan["missing"] and not dry:
            _require(not plan["installDocker"] or not (root / ".env").exists(), "DOCKER_UNKNOWN",
                     "У прежней установки недоступен Engine; создание нового Docker небезопасно.",
                     "Восстановите прежний Docker daemon и исходные тома.")
            prepared = provision_dependencies(plan)
            if prepared.get("dockerInstalled"):
                # A genuinely new Engine needs the explicitly selected operator
                # to access it. Existing Engine/group policy is never repaired.
                _run(["/usr/sbin/usermod", "--append", "--groups", "docker", "--", owner["name"]])
            plan = dependency_plan(cloud=cloud_enabled, browser=need_browser)
        if parsed.prepare_host:
            if parsed.json:
                print(json.dumps({"format": "asa-host-preparation-v1", "dryRun": bool(dry), "plan": plan}, ensure_ascii=False))
            else:
                print("ПОДГОТОВКА ХОСТА: " + ("НУЖНЫ ЗАВИСИМОСТИ" if plan["missing"] else "OK"))
                print("Зависимости: " + (", ".join(plan["missing"]) if plan["missing"] else "проверены"))
            return 2 if plan["missing"] else 0
        _require(not plan["missing"], "DEPENDENCIES", "Не все зависимости доступны; проверка не меняла хост.",
                 "Запустите проверенный setup через sudo без --check для подготовки зависимостей.")
        if not root.exists():
            _require(not dry, "TARGET_MISSING", "Каталог новой установки ещё не создан.", "Запустите первоначальную установку с сохранённой конфигурацией.")
            parent = checked_path(root.parent, missing=False)
            info = parent.stat()
            _require(info.st_uid == (0 if elevated else owner["uid"]) and not info.st_mode & 0o022,
                     "TARGET_PARENT", "Родитель нового каталога доступен для неподтверждённой записи.", "Выберите защищённый каталог установки.")
            root.mkdir(mode=0o750)
            if elevated:
                # Only this newly-created empty directory changes owner.
                os.chown(root, owner["uid"], owner["gid"], follow_symlinks=False)
        environment = operator_environment(owner, plan.get("daemonId"))
        if prepared:
            environment["ASA_SETUP_HOST_PREPARATION"] = json.dumps(prepared, separators=(",", ":"))
        if needs_cloud and not dry and elevated:
            cloud_prepared = prepare_cloud_transport(bundle, owner=owner,
                credential_file=cloud_config.get("rcloneConfigFile"), replace_credentials=command == "cloud-configure")
            environment["ASA_SETUP_CLOUD_PREPARATION"] = json.dumps(cloud_prepared, separators=(",", ":"))
        runtime = Path(owner["home"]) / ".local/share/asa-setup" / ("playwright-" + BROWSER_VERSION)
        if need_browser:
            process = _owner_call(owner, ["/usr/bin/python3", "-I", "-B", str(bundle / "tools/asa_setup_launcher.py"),
                                         "--prepare-browser-runtime", "--runtime-root", str(runtime)], environment,
                                  capture=True, timeout=1200)
            _require(process.returncode == 0, "BROWSER_RUNTIME", "Браузерный runtime не готов для оператора установки.",
                     "Проверьте доступ к PyPI/Chromium CDN и системные библиотеки; приёмка не завершена.")
            proof = json.loads(process.stdout)
            _require(proof.get("state") == "READY" and proof.get("playwright") == BROWSER_VERSION,
                     "BROWSER_RUNTIME", "Браузерный runtime не представил проверяемое свидетельство.", "Повторите системную подготовку.")
            environment["ASA_SETUP_BROWSER_PYTHON"] = proof["pythonPath"]
            environment["ASA_SETUP_BROWSERS_PATH"] = proof["browsersPath"]
        elif (runtime / "asa-runtime.json").is_file():
            environment["ASA_SETUP_BROWSER_PYTHON"] = str(runtime / "bin/python")
            environment["ASA_SETUP_BROWSERS_PATH"] = str(runtime / "browsers")
        forwarded = []
        skip = False
        for index, value in enumerate(arguments):
            if skip:
                skip = False
                continue
            if value == "--operator":
                skip = True
                continue
            if value.startswith("--operator=") or value == "--prepare-host":
                continue
            forwarded.append(value)
        if not parsed.root:
            forwarded += ["--root", str(root)]
        entry = ["/usr/bin/python3", "-I", "-B", str(bundle / "tools/asa_setup.py")]
        if elevated and command in ("schedule", "repair-collector"):
            # Root actions are fixed kinds and receive no arbitrary forwarded
            # command or executable. The CLI revalidates the saved private config.
            action = _owner_call({**owner, "uid": 0, "gid": 0, "name": "root"},
                                 [*entry, "--root-action", command, "--root", str(root)],
                                 {**environment, "HOME": "/root", "USER": "root", "LOGNAME": "root"}, capture=True)
            _require(action.returncode == 0, "ROOT_ACTION", "Настройка системного сервиса не завершена.",
                     "Проверьте защищённое свидетельство setup-root-actions и повторите diagnose.")
            report = _owner_call(owner, [*entry, "--render-last", "--render-action", command, "--root", str(root)]
                                 + (["--json"] if parsed.json else []), environment)
            return report.returncode
        if not elevated or dry:
            completed = _owner_call(owner, [*entry, *forwarded], environment)
            return 130 if completed.returncode == -2 else completed.returncode
        last_path = checked_path(root / ".asa/setup-last-attempt.json")
        previous_digest = hashlib.sha256(last_path.read_bytes()).hexdigest() if last_path.is_file() else None
        completed = _owner_call(owner, [*entry, *forwarded, "--defer-report"], environment)
        # Losing a child before it writes a new result never reuses old success.
        if not last_path.is_file() or hashlib.sha256(last_path.read_bytes()).hexdigest() == previous_digest:
            if completed.returncode == 130 or completed.returncode == -2:
                error = SetupBlocked("INTERRUPTED", "Операция прервана; результат требует проверки.", "Запустите status и продолжите известный operation ID.")
                emit_blocked(error, as_json=parsed.json)
                return 130
            if completed.returncode in (1, 2):
                # An early validation failure is already rendered by the CLI;
                # it cannot authorize a root post-action or reuse old success.
                return completed.returncode
            raise SetupBlocked("OPERATION_RESULT_MISSING", "Новый достоверный результат операции не сохранён.",
                               "Запустите status; не повторяйте миграции и переключение вслепую.")
        result = read_private_json(last_path, required=True)
        _require(result.get("format") == "asa-setup-result-v1", "OPERATION_RESULT", "Неизвестный формат результата дочернего setup.",
                 "Проверьте совместимость версий setup bundle.")
        if all(isinstance(result.get(name), str) and re.fullmatch(r"[a-f0-9]{32}", result[name])
               for name in ("operationId", "installationId")):
            active_result = result
        preparations = 0
        while result.get("outcome") == "PREPARATION_REQUIRED":
            _require(preparations < 3, "PREPARATION_LIMIT", "Системная подготовка не устранила причину после трёх проверок.",
                     "Выполните diagnose и продолжите известный operation ID после устранения причины.")
            operation_id, installation_id = result.get("operationId"), result.get("installationId")
            environment = prepare_handoff(root, owner, bundle, result, environment, non_interactive=parsed.non_interactive)
            preparations += 1
            previous_result = hashlib.sha256(last_path.read_bytes()).hexdigest()
            resume = [*entry, "resume", "--root", str(root), "--operation-id", operation_id, "--defer-report"]
            if parsed.non_interactive:
                resume.append("--non-interactive")
            if parsed.json:
                resume.append("--json")
            completed = _owner_call(owner, resume, environment)
            _require(last_path.is_file() and hashlib.sha256(last_path.read_bytes()).hexdigest() != previous_result,
                     "PREPARATION_RESUME", "Продолжение операции не сохранило новый проверяемый результат.",
                     "Выполните status; сохранённый operation ID нельзя заменять новой операцией.")
            result = read_private_json(last_path, required=True)
            _require(result.get("format") == "asa-setup-result-v1" and result.get("operationId") == operation_id
                     and result.get("installationId") == installation_id, "PREPARATION_IDENTITY",
                     "Продолжение не принадлежит прежней операции и установке.", "Выполните status; привилегированные действия остановлены.")
            active_result = result
        post_actions = result.get("postActions", [])
        _require(isinstance(post_actions, list) and len(post_actions) <= 1
                 and all(isinstance(item, dict) and set(item) == {"kind"} and item["kind"] == "schedule" for item in post_actions),
                 "ROOT_ACTION", "Неподдерживаемое привилегированное действие в результате setup.", "Проверьте совместимость установщика; действие не выполнено.")
        if post_actions:
            _require(result.get("mode") in ("install", "configure") and result.get("outcome") != "NO_CHANGE",
                     "ROOT_ACTION", "Привилегированное действие не связано с первоначальной настройкой.",
                     "Используйте отдельную команду schedule; обычная проверка сервисы не изменяет.")
            current_owner = validate_owner(root, operator_uid=owner["uid"])
            saved = read_private_json(root / ".asa/setup.json", required=True)
            _require(current_owner["uid"] == owner["uid"] and saved.get("operatorUid") == owner["uid"]
                     and saved.get("root") == str(root) and saved.get("installationId") == result.get("installationId"),
                     "ROOT_ACTION_IDENTITY", "Идентичность установки изменилась перед системной настройкой.",
                     "Проверьте текущую конфигурацию; чужой сервис не изменяется.")
            root_environment = {**environment, "HOME": "/root", "USER": "root", "LOGNAME": "root"}
            action = _owner_call({**owner, "uid": 0, "gid": 0, "name": "root"},
                                 [*entry, "--root-action", "schedule", "--root", str(root)], root_environment, capture=True)
            # The root action writes its own typed receipt. Rendering enriches
            # the saved operation; it must never repeat install/update/backup.
            if action.returncode != 0 and not (root / ".asa/setup-root-actions.json").is_file():
                raise SetupBlocked("SCHEDULE", "Расписание не установлено; основная операция имеет отдельный результат.",
                                   "Проверьте status и выполните отдельную команду schedule.")
        report = _owner_call(owner, [*entry, "--render-last", "--root", str(root)] + (["--json"] if parsed.json else []), environment)
        return 130 if completed.returncode in (-2, 130) else report.returncode
    except SetupBlocked as exc:
        return emit_blocked(exc, as_json=parsed.json, operation_id=active_result.get("operationId"),
                            installation_id=active_result.get("installationId"))
    except KeyboardInterrupt:
        emit_blocked(SetupBlocked("INTERRUPTED", "Операция прервана; сохранённые данные требуют проверки.",
                                  "Выполните status и продолжите известный operation ID."), as_json=parsed.json,
                     operation_id=active_result.get("operationId"), installation_id=active_result.get("installationId"))
        return 130
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return emit_blocked(SetupBlocked("BOOTSTRAP_ERROR", "Подготовка входа не завершилась; чувствительные сведения скрыты.",
                                         "Повторите --check и проверьте приватную конфигурацию и доступ оператора."), as_json=parsed.json)


if __name__ == "__main__":
    raise SystemExit(main())

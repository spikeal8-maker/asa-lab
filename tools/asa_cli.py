#!/usr/bin/env python3
"""Portable, concise ASA Lab command installed by verified setup.

The command never changes Docker, source or configuration directly.  All
mutating operations are delegated to the existing guarded setup/manager.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

FORMAT = "asa-command-v1"
REPO = "spikeal8-maker/asa-lab"
CLI_VERSION = "1.0.0"
SAFE_PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
LINUX_REGISTRY = Path("/etc/asa-lab/commands.json")
LINUX_COMMAND = Path("/usr/local/bin/asa")
WINDOWS_HEADER = ":: ASA Lab verified setup command v1"


class CLIError(RuntimeError):
    def __init__(self, message, code="CLI_BLOCKED"):
        super().__init__(message)
        self.code = code


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CLIError(message)


def path_string(value: str | Path) -> str:
    result = str(value)
    require(bool(result) and "\r" not in result and "\n" not in result, "Недопустимый путь.")
    return result


def read_json(path: Path) -> dict:
    try:
        check_ordinary_path(path, need_file=True)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        with os.fdopen(descriptor, "rb") as reader:
            meta = os.fstat(reader.fileno())
            require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1 and meta.st_size <= 1024 * 1024,
                    "Неподдерживаемый файл состояния.")
            payload = reader.read(1024 * 1024 + 1)
            require(len(payload) <= 1024 * 1024, "Слишком большой файл состояния.")
            value = json.loads(payload)
    except (OSError, ValueError) as exc:
        raise CLIError("Не удаётся прочитать зарегистрированную установку.") from exc
    require(isinstance(value, dict), "Неверный формат реестра установки.")
    return value


def check_ordinary_path(path: Path, *, need_file: bool = False) -> Path:
    require(path.is_absolute() and ".." not in path.parts, "Требуется абсолютный путь без '..'.")
    for part in (path, *path.parents):
        if part.is_symlink():
            raise CLIError("Путь содержит символическую ссылку или junction.")
    if need_file:
        require(path.is_file(), "Файл установки не найден.")
    return path


def protected_path(path: Path, *, directory=False, missing=False) -> Path:
    path = check_ordinary_path(path)
    for part in (path, *path.parents):
        if missing and part == path and not part.exists():
            continue
        meta = part.lstat()
        require(meta.st_uid == 0 and not meta.st_mode & 0o022,
                "Привилегированный путь должен принадлежать root и запрещать постороннюю запись.",)
        if part != path or directory:
            require(stat.S_ISDIR(meta.st_mode), "Родительский путь не является каталогом.")
        else:
            require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1,
                    "Привилегированный файл должен быть обычным файлом без hardlink.")
    return path


def verified_bundle(bundle: Path) -> dict:
    """Bootstrap only the stdlib verifier after checking its bytes and ancestry."""
    require(bool(re.fullmatch(r"/opt/asa-setup/[a-f0-9]{40}", str(bundle))),
            "Допустим только /opt/asa-setup/<40SHA>.")
    protected_path(bundle, directory=True)
    manifest_path = protected_path(bundle / "setup-bundle.json")
    manifest = read_json(manifest_path)
    require(manifest.get("revision") == bundle.name and manifest.get("format") == "asa-setup-bundle-v1"
            and manifest.get("origin") == {"repository": REPO, "workflow": ".github/workflows/setup-release.yml"},
            "Revision и происхождение setup bundle не совпали.")
    launcher = protected_path(bundle / "tools/asa_setup_launcher.py")
    expected = manifest.get("files", {}).get("tools/asa_setup_launcher.py")
    require(isinstance(expected, str) and re.fullmatch(r"[a-f0-9]{64}", expected)
            and launcher.stat().st_size <= 4 * 1024 * 1024
            and hashlib.sha256(launcher.read_bytes()).hexdigest() == expected,
            "Проверяющий код setup bundle повреждён.")
    spec = importlib.util.spec_from_file_location("asa_verified_launcher", launcher)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.verify_bundle(bundle)
    return manifest


def own_modules():
    base = Path(__file__).absolute().parents[1]
    if os.name == "posix" and os.geteuid() == 0:
        verified_bundle(base)
    location = str(Path(__file__).absolute().parent)
    if location not in sys.path:
        sys.path.insert(0, location)


def installation_record(root: Path, *, bundle: Path | None = None, profile: str | None = None) -> dict:
    root = check_ordinary_path(root, need_file=False)
    receipt = read_json(root / ".asa" / "installed-release.json")
    revision = receipt.get("revision")
    schema = receipt.get("schema")
    require(isinstance(revision, str) and bool(re.fullmatch(r"[a-f0-9]{40}", revision)),
            "Нет подтверждённого установленного выпуска ASA Lab.")
    require(type(schema) is int and schema > 0, "Версия схемы БД не подтверждена.")
    settings = read_json(root / ".asa" / "installation.json")
    project = settings.get("project")
    require(isinstance(project, str) and bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project)),
            "Не подтверждён Compose project установки.")
    actual_profile = settings.get("profile")
    require(actual_profile in ("dev", "staging", "production", "base"),
            "Профиль установки не подтверждён.")
    if profile is not None:
        require(profile == actual_profile, "Профиль установщика не совпадает с установленным.")
    record = {"root": str(root), "project": project, "profile": actual_profile}
    if bundle is not None:
        verified_bundle(bundle)
        record["bundle"] = str(bundle)
    return record


def read_registry(path: Path) -> dict:
    if not path.exists():
        return {"format": FORMAT, "installations": []}
    check_ordinary_path(path, need_file=True)
    if os.name != "nt" and path == LINUX_REGISTRY:
        protected_path(path)
    doc = read_json(path)
    rows = doc.get("installations")
    require(doc.get("format") == FORMAT and isinstance(rows, list) and len(rows) <= 64,
            "Неизвестный формат реестра команд.")
    require(all(isinstance(row, dict) and isinstance(row.get("root"), str)
                and isinstance(row.get("project"), str) for row in rows),
            "Повреждён реестр установок.")
    require(len({x["root"] for x in rows}) == len(rows), "Повторяющаяся установка в реестре.")
    return doc


def upsert_registry(existing: dict, record: dict) -> dict:
    rows = existing["installations"]
    other = [row for row in rows if row["root"] != record["root"]]
    require(len(other) < 64, "Слишком много зарегистрированных установок.")
    # Never silently change the identity of a previously registered installation.
    prior = next((x for x in rows if x["root"] == record["root"]), None)
    if prior:
        require(prior["project"] == record["project"] and prior["profile"] == record["profile"],
                "Установка по этому пути сменила project/profile. Нужна отдельная проверка.")
    return {**existing, "format": FORMAT, "installations": [*other, record]}


def choose_root(doc: dict, explicit: str | None) -> dict:
    rows = doc["installations"]
    if explicit:
        requested = str(Path(explicit).absolute())
        result = [x for x in rows if x["root"] == requested]
        require(len(result) == 1, "Выбранный путь не зарегистрирован. Используйте штатный установщик.")
        return result[0]
    require(rows, "Нет зарегистрированной ASA Lab. Сначала завершите штатную установку.")
    require(len(rows) == 1, "Несколько установок ASA Lab; укажите asa --root ПУТЬ status/check/update.")
    return rows[0]


def write_registered(path: Path, content: bytes, *, mode: int) -> None:
    parent = check_ordinary_path(path.parent)
    require(parent.is_dir(), "Каталог для команды отсутствует.")
    if path.exists():
        check_ordinary_path(path, need_file=True)
    fd, temp = tempfile.mkstemp(prefix=".asa-cli-", dir=parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, mode)
        os.replace(temp, path)
    finally:
        if os.path.lexists(temp):
            os.unlink(temp)


def register_linux(root: Path | None, bundle: Path, *, registry: Path = LINUX_REGISTRY,
                   executable: Path = LINUX_COMMAND) -> str:
    require(os.name == "posix" and os.geteuid() == 0, "Регистрация Linux требует штатный root setup.")
    verified_bundle(bundle)
    record = installation_record(root, bundle=bundle) if root else None
    parent = registry.parent
    require(parent.is_absolute(), "Недопустимый путь системного реестра.")
    protected_path(parent.parent, directory=True)
    if not parent.exists():
        parent.mkdir(mode=0o755)
    protected_path(parent, directory=True)
    protected_path(registry, missing=True)
    doc = read_registry(registry)
    if record:
        doc = upsert_registry(doc, record)
    doc["preparedBundle"] = str(bundle)
    program = executable
    content = (
        "#!/bin/sh\n"
        "# ASA Lab verified setup CLI; use the official pinned bundle only.\n"
        "PATH=" + SAFE_PATH + "; export PATH\n"
        "unset PYTHONPATH PYTHONHOME LD_PRELOAD LD_LIBRARY_PATH ENV BASH_ENV\n"
        "exec /usr/bin/python3 -I -B " + shlex.quote(str(bundle / "tools" / "asa_cli.py")) + ' "$@"\n'
    ).encode("utf-8")
    require(not program.is_symlink(), "Команда asa перенаправлена символической ссылкой.")
    protected_path(program, missing=True)
    if program.exists():
        check_ordinary_path(program, need_file=True)
        text = program.read_text(encoding="utf-8", errors="replace")
        require("ASA Lab verified setup CLI" in text or "ASA Lab verified setup command" in text,
                "Команда asa уже занята сторонней программой; перезапись запрещена.")
        require(program.stat().st_uid == 0, "Существующая команда asa не принадлежит root.")
    write_registered(registry, (json.dumps(doc, sort_keys=True) + "\n").encode(), mode=0o644)
    write_registered(program, content, mode=0o755)
    return str(program)


def windows_home() -> Path:
    location = os.environ.get("LOCALAPPDATA")
    require(bool(location), "На Windows не определён LOCALAPPDATA.")
    return Path(location) / "ASA-Lab" / "cli"


def register_windows(root: Path, *, home: Path | None = None) -> str:
    require(os.name == "nt", "Регистрация Windows доступна только на Windows.")
    root = check_ordinary_path(root)
    record = installation_record(root)
    home = home or windows_home()
    if not home.exists():
        home.mkdir(parents=True, mode=0o700)
    check_ordinary_path(home)
    registry = home / "commands.json"
    doc = upsert_registry(read_registry(registry), record)
    program = home / "asa.cmd"
    runner = home / "asa_cli.py"
    if program.exists():
        check_ordinary_path(program, need_file=True)
        require(program.read_text(encoding="utf-8", errors="replace").startswith(WINDOWS_HEADER),
                "Команда asa.cmd занята чужой программой.")
    if runner.exists():
        check_ordinary_path(runner, need_file=True)
    source = Path(__file__).resolve()
    # The caller's installer has already verified the official checkout origin.
    check_ordinary_path(source, need_file=True)
    contents = source.read_bytes()
    command = (
        WINDOWS_HEADER + "\r\n@echo off\r\n"
        + '"' + path_string(Path(sys.executable)) + '" -I -B "'
        + path_string(runner) + '" %*\r\n'
    ).encode("utf-8")
    write_registered(runner, contents, mode=0o600)
    # The public reader is packaged with the verified Windows checkout too.
    # Keep the prior per-user command and PATH contract; no elevated Windows
    # execution is introduced by this registration.
    deployment = home / "deployment"
    deployment.mkdir(mode=0o700, exist_ok=True)
    check_ordinary_path(deployment)
    for helper in (source.parent / "deployment").glob("*.py"):
        if not helper.name.startswith(("test_", "ci_")):
            check_ordinary_path(helper, need_file=True)
            write_registered(deployment / helper.name, helper.read_bytes(), mode=0o600)
    write_registered(registry, (json.dumps(doc, sort_keys=True) + "\n").encode(), mode=0o600)
    write_registered(program, command, mode=0o600)
    import winreg
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_QUERY_VALUE | winreg.KEY_SET_VALUE) as key:
        try:
            current, kind = winreg.QueryValueEx(key, "Path")
        except FileNotFoundError:
            current, kind = "", winreg.REG_EXPAND_SZ
        require(isinstance(current, str), "Невозможно безопасно прочитать пользовательский PATH.")
        parts = [x.strip('"').rstrip("\\").casefold() for x in current.split(";") if x]
        if str(home).rstrip("\\").casefold() not in parts:
            require(len(current) + len(str(home)) < 32000, "Пользовательский PATH слишком длинный.")
            winreg.SetValueEx(key, "Path", 0, kind, current.rstrip(";") + (";" if current else "") + str(home))
    return str(program)


def run_linux(action: str, record: dict, options) -> int:
    require(os.geteuid() == 0, "В 1Panel выполните команду от root либо используйте sudo.")
    bundle = Path(record["bundle"])
    verified_bundle(bundle)
    if action != "install":
        root = check_ordinary_path(Path(record["root"]))
        current = installation_record(root)
        require(current["project"] == record["project"] and current["profile"] == record["profile"],
                "Идентификатор установки изменился; запуск остановлен.")
    commands = {"install": "auto", "update": "auto", "update apply": "auto", "backup create": "backup", "cloud sync": "retry-cloud",
                "backup schedule enable": "schedule", "backup schedule disable": "schedule"}
    require(action in commands, "Изменяющая команда не поддерживается.")
    cmd = ["/usr/bin/python3", "-I", "-B", str(bundle / "tools/asa_setup_launcher.py"), commands[action]]
    if record.get("root"):
        cmd += ["--root", record["root"]]
    if action in ("install", "update", "update apply"):
        cmd += ["--intent", "install" if action == "install" else "update"]
        if options.deployment_digest:
            cmd += ["--deployment-digest", options.deployment_digest]
    if action.startswith("backup schedule "):
        cmd += ["--schedule-enabled", "true" if action.endswith("enable") else "false"]
    for name in ("config_file", "snapshot_id", "operation_id"):
        value = getattr(options, name)
        if value:
            cmd += ["--" + name.replace("_", "-"), value]
    if options.non_interactive or options.json or not sys.stdin.isatty():
        cmd.append("--non-interactive")
        cmd.append("--json")
    return run_reduced(cmd, action, as_json=options.json)


def run_windows(action: str, record: dict, options) -> int:
    root = check_ordinary_path(Path(record["root"]))
    current = installation_record(root)
    require(current["project"] == record["project"] and current["profile"] == record["profile"],
            "Идентификатор установки изменился; запуск остановлен.")
    require(action in ("update", "update apply"), "Изменение на Windows допускается только для обновления.",)
    require(not options.deployment_digest, "Передача deployment digest в Windows Apply пока не поддерживается.")
    script = check_ordinary_path(root / "tools/asa-setup.ps1", need_file=True)
    powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
    require(powershell is not None, "PowerShell не найден.")
    cmd = [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), "-Root", str(root),
           "-Mode", "update", "-Profile", current["profile"], "-Apply"]
    return run_reduced(cmd, action, as_json=options.json)


def log_directory() -> Path:
    """Host-private diagnostic log directory, independent of the source checkout."""
    return windows_home() / "logs" if os.name == "nt" else Path("/var/lib/asa-lab-operator")


def require_secure_log_directory(folder: Path) -> None:
    """Keep runtime logs private; tests can substitute a synthetic trusted directory."""
    if os.name != "nt":
        info = folder.stat()
        require(info.st_uid == 0 and info.st_mode & 0o077 == 0,
                "Каталог журнала должен принадлежать root с правами 0700.")


def run_reduced(command: list[str], action: str, *, as_json=False) -> int:
    """Stream full diagnostics to a private log; show only bounded stage/results."""
    child_env = None if os.name == "nt" else {"PATH": SAFE_PATH, "HOME": "/root", "USER": "root", "LOGNAME": "root", "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"}
    if child_env is not None:
        # Match the established launcher's optional header-only CI credentials.
        # Nothing from these variables is printed, journalled or placed in argv.
        child_env.update({name: os.environ[name] for name in ("GH_TOKEN", "GITHUB_TOKEN") if os.environ.get(name)})
    if action == "install" and not as_json and "--non-interactive" not in command and sys.stdin.isatty() and sys.stdout.isatty():
        # First-use onboarding has bounded prompts/getpass in the verified
        # setup. Its canonical renderer must own the terminal for those prompts.
        # Runtime subprocess diagnostics remain in setup's private log.
        completed = subprocess.run(command, env=child_env, check=False)
        code = 0 if completed.returncode == 0 else 130 if completed.returncode in (-2, 130) else 2 if completed.returncode == 2 else 1
        return emit(action, {"status": "OK" if code == 0 else "INTERRUPTED" if code == 130 else "FAILED",
                             "managerExitCode": completed.returncode, "automaticRetry": False}, code=code)
    folder = log_directory()
    if not folder.exists():
        folder.mkdir(parents=True, mode=0o700)
    check_ordinary_path(folder)
    require_secure_log_directory(folder)
    filename = action.replace(" ", "-") + "-" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename += "-" + str(os.getpid()) + ".log"
    logfile = folder / filename
    if not as_json:
        print("ASA Lab · " + action, flush=True)
    fd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    exit_code = 1
    blocked = []
    printed = set()
    total = 0
    operation = {}
    json_line = ""
    try:
        with os.fdopen(fd, "w", encoding="utf-8", errors="replace") as log:
            proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, errors="replace", bufsize=1, env=child_env)
            try:
                # readline has a hard bound: a malicious long diagnostic line
                # cannot allocate unbounded memory in this privileged adapter.
                for output in iter(lambda: proc.stdout.readline(8192), ""):
                    total += len(output.encode("utf-8", errors="replace"))
                    if total <= 32 * 1024 * 1024:
                        log.write(output)
                    elif "log_truncated" not in printed:
                        log.write("[OUTPUT TRUNCATED AT 32 MiB]\n")
                        printed.add("log_truncated")
                    item = output.strip()
                    if json_line or output.startswith("{"):
                        if len(json_line) + len(output) <= 1024 * 1024:
                            json_line += output
                        else:
                            json_line = ""
                        if json_line.endswith("\n"):
                            try:
                                candidate = json.loads(json_line)
                                if isinstance(candidate, dict) and candidate.get("format") == "asa-setup-result-v1":
                                    operation = public_operation(candidate)
                            except (ValueError, TypeError):
                                pass
                            json_line = ""
                    stage = re.fullmatch(r"Этап: ([a-z_]{1,64})", item)
                    if stage and stage[1] not in printed:
                        if not as_json:
                            print("Этап: " + stage[1], flush=True)
                        printed.add(stage[1])
                    reason = re.fullmatch(r"BLOCKED (?:COMMAND: )?([A-Z_]{1,80})", item)
                    if reason:
                        blocked = [*blocked[-2:], reason[1]]
                exit_code = proc.wait()
            except BaseException:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=3)
                raise
    finally:
        if not as_json:
            print("Защищённый журнал: " + str(logfile), flush=True)
    code = 0 if exit_code == 0 else 130 if exit_code in (-2, 130) else 2 if exit_code == 2 else 1
    if operation.get("reasonCode"):
        blocked = [*blocked[-2:], operation["reasonCode"]]
    emit(action, {"status": "OK" if code == 0 else "INTERRUPTED" if code == 130 else "BLOCKED" if code == 2 else "FAILED",
                  "exitCode": code, "managerExitCode": exit_code, "reasonCodes": blocked,
                  "reasonCode": operation.get("reasonCode"), "operation": operation,
                  "logPath": str(logfile), "automaticRetry": False}, as_json=as_json, code=code)
    return code


def public_operation(value):
    """Explicit typed projection; no opaque child text or configuration leaks."""
    output = {}
    for key in ("operationId", "installationId"):
        if isinstance(value.get(key), str) and re.fullmatch(r"[a-f0-9]{32}", value[key]):
            output[key] = value[key]
    for key in ("outcome", "reasonCode"):
        if isinstance(value.get(key), str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", value[key]):
            output[key] = value[key]
    for key in ("actionExecuted", "applicationAccepted", "dataProtectionConfirmed"):
        if type(value.get(key)) is bool:
            output[key] = value[key]
    version = value.get("version", {})
    if isinstance(version, dict):
        output["version"] = {key: field for key, field in version.items() if key in ("previous", "selected", "running")
                             and isinstance(field, str) and re.fullmatch(r"[a-f0-9]{40}", field)}
    return output


SPECS = {
    "version": ("Версии CLI, приложения и действующей схемы PostgreSQL", False),
    "status": ("Текущее состояние приложения, сервисов и резервирования", False),
    "doctor": ("Диагностика Ubuntu, оборудования, хранилищ и приложения", False),
    "disk": ("Файловые системы Docker, приложения, PostgreSQL, MinIO и backup", False),
    "disk usage": ("Свободные байты и inodes на файловых системах установки", False),
    "disk health": ("Чтение SMART/NVMe; недоступные датчики дают UNAVAILABLE", False),
    "services": ("Docker, Compose и текущие health контейнеров установки", False),
    "services status": ("Docker, Compose и текущие health контейнеров установки", False),
    "update": ("Настоящее обновление ASA Lab с защитой данных и резервной копией", True),
    "update check": ("Текущий и опубликованный проверенный выпуск без Docker pull", False),
    "update plan": ("SHA, immutable digest, диапазон схем, оценки и блокеры", False),
    "update apply": ("Обновление существующей установки через общий lock и backup", True),
    "update history": ("История установки и обновлений; не текущее здоровье", False),
    "install": ("Первичная установка через проверенный setup; существующая установка блокирует install", True),
    "backup status": ("Последняя попытка, успешная локальная копия и доставка отдельно", False),
    "backup list": ("До 100 сохранённых копий этой установки", False),
    "backup create": ("Полная новая копия по сохранённой backup/cloud политике", True),
    "backup verify": ("Проверка файлов и SHA-256 существующей локальной копии", False),
    "backup schedule": ("Сохранённая политика и фактический systemd timer", False),
    "backup schedule enable": ("Включение согласованного расписания backup", True),
    "backup schedule disable": ("Отключение расписания backup без изменения automatic update", True),
    "cloud status": ("Настройка, текущий транспорт и историческое доказательство доставки", False),
    "cloud sync": ("Повторная доставка существующего ciphertext без нового backup", True),
    "restore plan": ("Безопасный план P1-R3A; реальное восстановление заблокировано", False),
    "history": ("Последние операции: попытки и результаты", False),
    "logs": ("Безопасные события журналов без raw stderr и секретов", False),
    "logs update": ("События журналов установки и обновления", False),
    "logs backup": ("События резервирования и доставки", False),
    "config show": ("Публичная проекция настроек по явному списку полей", False),
}
WRITE_ACTIONS = {key for key, (_, writes) in SPECS.items() if writes}
EXIT_CODES = {"0": "Проверка или операция успешна", "1": "Проверка не пройдена или сведения недоступны",
              "2": "Ошибка параметров, прав, конфигурации или безопасная блокировка", "130": "Прервано оператором"}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's original message contains user-provided values, which may
        # be credentials accidentally pasted into a command line.
        raise CLIError("Неверные параметры. Выполните asa help.", "USAGE")


def command_parser():
    parser = Parser(prog="asa", add_help=False, allow_abbrev=False)
    parser.add_argument("words", nargs="*")
    parser.add_argument("-h", "--help", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--no-color", action="store_true")
    parser.add_argument("--root")
    parser.add_argument("--registry")
    parser.add_argument("--bundle")
    parser.add_argument("--profile")
    parser.add_argument("--snapshot-id")
    parser.add_argument("--operation-id")
    parser.add_argument("--deployment-digest")
    parser.add_argument("--config-file", "--config")
    parser.add_argument("--non-interactive", action="store_true")
    return parser


def help_document(topic=""):
    require(not topic or topic in SPECS or topic in {name.split()[0] for name in SPECS}, "Раздел справки не найден.",)
    selected = {key: value for key, value in SPECS.items() if not topic or key == topic or key.startswith(topic + " ")}
    title = SPECS.get(topic, ("Единый интерфейс ASA Lab: установка, обновление, резервирование и диагностика", False))[0]
    return {"title": title, "syntax": "asa " + (topic + " " if topic else "[КОМАНДА] ") + "[ПАРАМЕТРЫ]",
            "commands": [{"command": "asa " + key, "purpose": item[0], "changesData": item[1],
                          "privileges": "root через sudo; Ubuntu setup" if item[1] else "Чтение; ограниченные права дают UNAVAILABLE"} for key, item in selected.items()],
            "parameters": {"--help": "Справка без сети и установленной ASA Lab", "--json": "Один JSON object в stdout; без интерактивного ввода",
                "--no-color": "Без ANSI-цветов; также поддерживается NO_COLOR", "--root ПУТЬ": "Абсолютный каталог выбранной установки",
                "--snapshot-id ID": "backup verify / cloud sync: существующий снимок", "--operation-id ID": "logs или продолжение штатной операции",
                "--deployment-digest sha256:HEX": "update check/plan/apply или install: точный OCI deployment manifest",
                "--config-file ПУТЬ": "install: приватная конфигурация; секреты не передаются в аргументах",
                "--non-interactive": "Изменяющая операция без вопросов; обязательная конфигурация должна быть сохранена"},
            "examples": ["asa help update", "asa status --json", "asa disk health", "asa update plan", "sudo asa update", "sudo asa install --root /srv/asa-lab"],
            "exitCodes": EXIT_CODES,
            "notes": ["asa update выполняет штатное обновление; asa check и asa update check только читают состояние.",
                      "Оценки миграций, места и downtime остаются неизвестными до фактического preflight.",
                      "Справка работает offline. Без TTY asa выводит статус и не ждёт выбора.",
                      "Windows: прежний явный update apply сохранён; системные операции Ubuntu помечаются как неподдерживаемые."]}


def emit(action, value, *, as_json=False, code=0):
    document = {**value, "format": "asa-cli-result-v1", "command": action, "exitCode": code}
    if as_json:
        print(json.dumps(document, ensure_ascii=False, sort_keys=True))
    elif "help" in document:
        help_value = document["help"]
        print("ASA Lab — " + help_value["title"] + "\n\nСинтаксис: " + help_value["syntax"])
        for row in help_value["commands"]:
            print("  " + row["command"] + " — " + row["purpose"])
            print("    Права: " + row["privileges"] + ". Данные: " + ("изменяет" if row["changesData"] else "только чтение") + ".")
        print("\nПараметры:")
        for key, item in help_value["parameters"].items():
            print("  " + key + " — " + item)
        print("\nПримеры:\n  " + "\n  ".join(help_value["examples"]))
        print("\nКоды результата: " + "; ".join(key + " — " + item for key, item in EXIT_CODES.items()))
        print("\n" + "\n".join(help_value["notes"]))
    elif action == "status":
        # The ordinary operator view is intentionally compact; --json retains
        # all allowlisted machine-readable evidence without changing exit code.
        compact_status(document)
    elif action == "update check":
        current = document.get("current", {})
        target = document.get("target", {})
        print("ASA Lab · проверка обновлений · " + str(document.get("status", "UNAVAILABLE")))
        print("Установлено: " + str(current.get("revision", "UNAVAILABLE"))[:8])
        print("Доступно: " + str(target.get("revision", "UNAVAILABLE"))[:8])
        available = document.get("available")
        print("Обновление: " + ("есть" if available is True else "не требуется" if available is False else "не удалось определить"))
        blockers = document.get("blockers", [])
        if blockers:
            print("Блокировки: " + ", ".join(str(x) for x in blockers[:6]))
        elif document.get("status") == "PLANNED":
            print("Для установки: asa update (в 1Panel) или sudo asa update")
    else:
        print("ASA Lab · " + action + " · " + document.get("status", "UNAVAILABLE"))
        # Advanced operator commands retain structured typed output. Use --json
        # for machine integrations; status/check deliberately stay concise.
        print(json.dumps({key: item for key, item in document.items() if key not in ("format", "command", "exitCode")},
                         ensure_ascii=False, indent=2, sort_keys=True))
    return code


def registry_entry(doc, options, *, install=False):
    if install:
        bundle = doc.get("preparedBundle")
        require(isinstance(bundle, str), "CLI ещё не подготовлен. Получите проверенный setup bundle.")
        return {"bundle": bundle, "root": options.root}
    if options.root:
        root = check_ordinary_path(Path(options.root))
        matches = [row for row in doc["installations"] if row["root"] == str(root)]
        if matches:
            return {**matches[0], **({"bundle": doc["preparedBundle"]} if doc.get("preparedBundle") else {})}
        return {"root": str(root)}  # diagnostic only; writes require registration
    if not doc["installations"]:
        return {}
    selected = choose_root(doc, None)
    return {**selected, **({"bundle": doc["preparedBundle"]} if doc.get("preparedBundle") else {})}


def observe(action, record, options):
    own_modules()
    from deployment.cli_observe import Observer, unavailable
    reader = Observer(record)
    if action == "version":
        return {"status": "OK", "cli": {"version": CLI_VERSION}, "application": reader.installed(), "database": reader.database()}
    if action in ("status", "doctor"):
        return reader.status(extended=action == "doctor", compact=not options.words and not options.json)
    if action.startswith("disk"):
        return reader.disk(health=action == "disk health")
    if action in ("services", "services status"):
        return reader.services()
    if action in ("update check", "update plan"):
        from deployment.release_readonly import resolve_release
        return reader.update_plan(resolve_release(options.deployment_digest))
    if action in ("history", "update history"):
        return reader.history("update" if action == "update history" else None)
    if action.startswith("logs"):
        return reader.logs(action.split()[1] if " " in action else None, options.operation_id)
    if action in ("backup status", "backup list"):
        return reader.backups(listing=action == "backup list")
    if action == "backup verify":
        return reader.backup_verify(options.snapshot_id)
    if action == "backup schedule":
        return reader.schedule()
    if action == "cloud status":
        return reader.cloud()
    if action == "config show":
        value = dict(reader.configuration())
        if "format" in value:
            value["configFormat"] = value.pop("format")
        return value
    if action == "restore plan":
        return {"status": "BLOCKED_PLAN", "reasonCode": "P1_R3A_REQUIRED", "applyAllowed": False,
                "snapshotId": options.snapshot_id, "backup": reader.backups(), "restore": unavailable("NOT_RESTORED"),
                "nextAction": "Нужен отдельный P1-R3A план с подтверждённой целью и разрешением владельца; decrypt и restore не выполняются."}
    raise CLIError("Команда не найдена.", "USAGE")


def configure_output():
    # Redirected Windows streams may use a legacy code page, and -I ignores
    # PYTHONIOENCODING/PYTHONUTF8. The public byte contract is always UTF-8.
    # StringIO and other Unicode-only capture streams need no reconfiguration.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="backslashreplace")


def main(argv: list[str] | None = None) -> int:
    configure_output()
    arguments = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in arguments
    action = "help"
    try:
        options = command_parser().parse_intermixed_args(arguments)
        words = options.words
        if options.help or words[:1] == ["help"]:
            topic = " ".join(words[1:] if words[:1] == ["help"] else words)
            return emit("help", {"status": "OK", "help": help_document(topic)}, as_json=as_json)
        action = " ".join(words) if words else "status"
        action = {"check": "update check", "backup": "backup status", "cloud": "cloud status"}.get(action, action)
        if action not in SPECS and action not in ("register", "prepare"):
            action = "invalid"
            raise CLIError("Неизвестная команда. Выполните asa help.", "USAGE")
        if options.deployment_digest:
            require(re.fullmatch(r"sha256:[a-f0-9]{64}", options.deployment_digest) is not None, "Неверный deployment digest.")
            require(action in ("install", "update", "update check", "update plan", "update apply"), "Digest не относится к этой команде.")
        for value, expression, name in ((options.snapshot_id, r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", "snapshot"),
                                         (options.operation_id, r"[a-f0-9]{32}", "operation")):
            require(value is None or re.fullmatch(expression, value) is not None, "Неверный " + name + " ID.")
        if action in ("register", "prepare"):
            require(not options.registry, "Служебная регистрация использует только системный реестр.")
            if os.name == "nt":
                require(action == "register" and options.root, "Windows использует регистрацию установленного checkout.")
                result = register_windows(Path(options.root))
            else:
                require(options.bundle and (action == "prepare" or options.root), "Нужен проверенный bundle и путь установки для register.")
                result = register_linux(Path(options.root) if action == "register" else None, Path(options.bundle))
            return emit(action, {"status": "OK", "executable": result}, as_json=as_json)
        require(not options.bundle and not options.profile, "Служебные параметры не относятся к этой команде.")
        require(not options.config_file or action == "install", "--config-file применяется только при явной установке.")
        registry = Path(options.registry) if options.registry else (windows_home() / "commands.json" if os.name == "nt" else LINUX_REGISTRY)
        if action in WRITE_ACTIONS:
            require(not options.registry, "Пользовательский --registry разрешён только для диагностики.")
        document = read_registry(registry)
        record = registry_entry(document, options, install=action == "install")
        if action in WRITE_ACTIONS:
            require(os.name == "nt" or os.geteuid() == 0, "Для изменения выполните sudo asa; чтения доступны без sudo.")
            if action != "install":
                require(record.get("bundle") or os.name == "nt" and record.get("root"), "Изменение разрешено только зарегистрированной установке.")
            if action == "cloud sync":
                if not options.snapshot_id:
                    own_modules()
                    from deployment.cli_observe import Observer
                    options.snapshot_id = Observer(record).delivery_snapshot()
            if action in ("update", "update apply") and os.name != "nt" and not options.operation_id:
                plan = observe("update plan", record, options)
                # The manager revalidates current state and policy under its
                # existing lock. The public plan does not authorize a write.
                options.deployment_digest = plan["target"]["deploymentDigest"]
                if not as_json:
                    emit("update plan", plan, code=0)
            # An explicit operation ID resumes its durable mode/release/pin.
            # Resolving stable again here would break recovery of older
            # protocol-1 journals that have release but no deployment digest.
            return (run_windows if os.name == "nt" else run_linux)(action, record, options)
        value = observe(action, record, options)
        code = 0 if value.get("status") in ("OK", "RECORDED", "PLANNED") else 2 if value.get("status") in ("BLOCKED", "BLOCKED_PLAN") else 1
        if not words and not as_json:
            compact_status(value)
        else:
            emit(action, value, as_json=as_json, code=code)
        if not words and not as_json and sys.stdin.isatty() and sys.stdout.isatty():
            print("\nМеню: 1 — справка; 2 — диагностика; 3 — диски; 4 — проверка update; Enter — выход.")
            try:
                choice = input("Выбор: ").strip()
            except EOFError:
                return code
            menu = {"1": ["help"], "2": ["doctor"], "3": ["disk"], "4": ["update", "check"]}
            if choice in menu:
                return main([*menu[choice], *(["--root", options.root] if options.root else []), "--no-color"])
        return code
    except KeyboardInterrupt:
        return emit(action, {"status": "INTERRUPTED", "reasonCode": "INTERRUPTED",
                             "message": "Прервано. Проверьте asa status и журнал операции перед продолжением."}, as_json=as_json, code=130)
    except Exception as exc:
        # No traceback, arbitrary exception text, subprocess output or supplied
        # argument value can escape through the public operator surface.
        reason = getattr(exc, "code", "CLI_UNAVAILABLE")
        if not isinstance(reason, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason):
            reason = "CLI_UNAVAILABLE"
        message = str(exc) if isinstance(exc, CLIError) else "Сведения или операция недоступны. Проверьте права, конфигурацию и соединение; приватные подробности скрыты."
        return emit(action, {"status": "BLOCKED", "reasonCode": reason, "message": message}, as_json=as_json, code=2)


def compact_status(value):
    installed, database, services = (value.get(key, {}) for key in ("installed", "database", "services"))
    local = value.get("backup", {}).get("lastLocalSuccess", {})
    print("ASA Lab · " + value.get("status", "UNAVAILABLE"))
    print("Установка: " + (value.get("root") or "не выбрана"))
    print("CLI: " + CLI_VERSION + " · записанный выпуск: " + installed.get("revision", "UNAVAILABLE"))
    print("PostgreSQL сейчас: " + str(database.get("schema", "UNAVAILABLE")))
    rows = services.get("containers", [])
    healthy = sum(row.get("running") is True and row.get("health") == "healthy" for row in rows)
    print("Сервисы: " + services.get("status", "UNAVAILABLE") + " · healthy " + str(healthy) + "/" + str(len(rows)))
    print("Последняя локальная копия: " + (local.get("snapshotAt") or "UNAVAILABLE") + " · " + local.get("status", "UNAVAILABLE"))
    print("Справка: asa help · подробности: asa status · безопасная проверка: asa check")


if __name__ == "__main__":
    raise SystemExit(main())

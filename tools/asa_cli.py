#!/usr/bin/env python3
"""Portable, concise ASA Lab command installed by verified setup.

The command never changes Docker, source or configuration directly.  All
mutating operations are delegated to the existing guarded setup/manager.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

FORMAT = "asa-command-v1"
REPO = "spikeal8-maker/asa-lab"
COMMANDS = ("status", "check", "update")
LINUX_REGISTRY = Path("/etc/asa-lab/commands.json")
LINUX_COMMAND = Path("/usr/local/bin/asa")
WINDOWS_HEADER = ":: ASA Lab verified setup command v1"


class CLIError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CLIError(message)


def path_string(value: str | Path) -> str:
    result = str(value)
    require(bool(result) and "\r" not in result and "\n" not in result, "Недопустимый путь.")
    return result


def read_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as reader:
            value = json.load(reader)
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
        bundle = check_ordinary_path(bundle)
        require((bundle / "asa-setup.sh").is_file()
                and (bundle / "setup-bundle.json").is_file(), "Отсутствует проверенный ASA Setup bundle.")
        require(bool(re.fullmatch(r"[a-f0-9]{40}", bundle.name)) and
                str(bundle).startswith("/opt/asa-setup/"), "Путь ASA Setup bundle не подтверждён.")
        record["bundle"] = str(bundle)
    return record


def read_registry(path: Path) -> dict:
    if not path.exists():
        return {"format": FORMAT, "installations": []}
    check_ordinary_path(path, need_file=True)
    if os.name != "nt" and path == LINUX_REGISTRY:
        meta = path.stat()
        require(meta.st_uid == 0 and not meta.st_mode & 0o022, "Реестр команд не принадлежит root.")
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
    return {"format": FORMAT, "installations": [*other, record]}


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


def register_linux(root: Path, bundle: Path, *, registry: Path = LINUX_REGISTRY,
                   executable: Path = LINUX_COMMAND) -> str:
    require(os.name == "posix" and os.geteuid() == 0, "Регистрация Linux требует штатный root setup.")
    record = installation_record(root, bundle=bundle)
    parent = registry.parent
    require(parent.is_absolute(), "Недопустимый путь системного реестра.")
    if not parent.exists():
        parent.mkdir(mode=0o755)
    check_ordinary_path(parent)
    require(parent.stat().st_uid == 0 and not parent.stat().st_mode & 0o022,
            "Каталог реестра должен принадлежать root.")
    doc = upsert_registry(read_registry(registry), record)
    program = executable
    content = (
        "#!/bin/sh\n"
        "# ASA Lab verified setup CLI; use the official pinned bundle only.\n"
        "exec /usr/bin/python3 -I -B " + json.dumps(str(bundle / "tools" / "asa_cli.py")) + ' "$@"\n'
    ).encode("utf-8")
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


def status(root: Path, project: str) -> int:
    release = read_json(root / ".asa" / "installed-release.json")
    operation_path = root / ".asa" / "last-operation.json"
    operation = read_json(operation_path) if operation_path.is_file() else {}
    print("ASA Lab · статус")
    print(f"[OK] Версия: {release['revision'][:8]} · схема {release['schema']}")
    if operation.get("status") == "success":
        print("[OK] Последняя операция: успешно")
    else:
        print("[!] Последняя операция: проверка требуется")
    docker = subprocess.run(["docker", "ps", "--filter", "label=com.docker.compose.project=" + project,
                             "--format", "{{.Names}}|{{.Status}}"],
                            capture_output=True, text=True, timeout=15, check=False)
    if docker.returncode != 0:
        print("[X] Docker недоступен")
        return 1
    rows = [line.split("|", 1) for line in docker.stdout.splitlines() if "|" in line]
    healthy = sum("healthy" in row[1].lower() and "unhealthy" not in row[1].lower() for row in rows)
    print(f"[{'OK' if rows and len(rows)==healthy else '!'}] Контейнеры: {healthy}/{len(rows)} healthy")
    backup = operation.get("backup")
    if isinstance(backup, str) and backup.startswith(str(root / "backups") + os.sep):
        print(f"[OK] Backup: {Path(backup).name}")
    else:
        print("[!] Backup: нет подтверждения в квитанции")
    return 0 if rows and healthy == len(rows) and operation.get("status") == "success" else 1


def run_linux(action: str, record: dict) -> int:
    require(os.geteuid() == 0, "В 1Panel выполните команду от root либо используйте sudo.")
    root = check_ordinary_path(Path(record["root"]))
    current = installation_record(root)
    require(current["project"] == record["project"] and current["profile"] == record["profile"],
            "Идентификатор установки изменился; запуск остановлен.")
    if action == "status":
        return status(root, current["project"])
    bundle = check_ordinary_path(Path(record["bundle"]))
    require((bundle / "setup-bundle.json").is_file() and (bundle / "asa-setup.sh").is_file(),
            "Проверенный пакет установки отсутствует.")
    # Never treat an absent installation as an opportunity for a fresh installation.
    require((root / ".asa" / "setup.json").is_file(), "Не найден действующий setup receipt; новый install запрещён.")
    cmd = ["/bin/bash", str(bundle / "asa-setup.sh"),
           "check" if action == "check" else "auto", "--root", str(root)]
    return run_reduced(cmd, action)


def run_windows(action: str, record: dict) -> int:
    root = check_ordinary_path(Path(record["root"]))
    current = installation_record(root)
    require(current["project"] == record["project"] and current["profile"] == record["profile"],
            "Идентификатор установки изменился; запуск остановлен.")
    if action == "status":
        return status(root, current["project"])
    if action == "check":
        cmd = [sys.executable, str(root / "tools" / "asa_manager.py"), "check", "--root", str(root),
               "--profile", current["profile"]]
    else:
        script = root / "tools" / "asa-setup.ps1"
        require(script.is_file(), "Штатный Windows-установщик отсутствует.")
        powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
        require(powershell is not None, "PowerShell не найден.")
        cmd = [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), "-Root", str(root),
               "-Mode", "update", "-Profile", current["profile"], "-Apply"]
    return run_reduced(cmd, action)


def run_reduced(command: list[str], action: str) -> int:
    """Do not echo unbounded JSON or private diagnostics in the 1Panel terminal."""
    print("ASA Lab · " + ("проверка" if action == "check" else "обновление"))
    if action == "update":
        print("[i] Используется штатный установщик; БД/MinIO защищены его проверками.")
    process = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, errors="replace", timeout=None, check=False)
    chunks = process.stdout.splitlines()
    if process.returncode == 0:
        print("[OK] Штатная операция завершилась успешно")
        for line in chunks:
            stripped = line.strip()
            if stripped.startswith(("1. ", "2. ", "3. ", "4. ", "5. ", "6. ")):
                print(stripped[:210])
            if "NO_CHANGE" in stripped or "AVAILABLE revision=" in stripped:
                print("[i] " + stripped[:160])
    else:
        print(f"[X] Остановлено: код {process.returncode}; никакого второго запуска нет")
        for line in chunks[-50:]:
            if any(word in line for word in ("BLOCKED", "SAFE_ACTION", "ОСТАНОВЛЕНО", "Следующее действие:")):
                print(line.strip()[:200])
    # The original installer result stays authoritative. No invented PASS/backup receipt.
    return process.returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ASA Lab: status/check/update на любой поддерживаемой установке")
    parser.add_argument("action", choices=(*COMMANDS, "register"))
    parser.add_argument("--root")
    parser.add_argument("--bundle")
    parser.add_argument("--profile")
    parser.add_argument("--registry")
    options = parser.parse_args(argv)
    try:
        if options.action == "register":
            require(options.root, "Для регистрации обязателен проверенный путь установки.")
            if os.name == "nt":
                result = register_windows(Path(options.root))
            else:
                require(options.bundle, "Для регистрации Linux требуется pinned bundle.")
                result = register_linux(Path(options.root), Path(options.bundle))
            print("[OK] Команда asa зарегистрирована: " + result)
            return 0
        registry = Path(options.registry) if options.registry else (
            windows_home() / "commands.json" if os.name == "nt" else LINUX_REGISTRY)
        entry = choose_root(read_registry(registry), options.root)
        return (run_windows if os.name == "nt" else run_linux)(options.action, entry)
    except (CLIError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print("[X] " + str(exc)[:220], file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

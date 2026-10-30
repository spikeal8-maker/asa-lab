"""One system timer per installation, independent of application auto-update."""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .backup_workflow import cloud_project, now, private_directory, read_private
from .contracts import Blocked, require
from .paths import atomic_bytes, plain_paths


def validate_schedule(settings):
    require(isinstance(settings, dict) and set(settings) <= {"enabled", "time", "timezone", "maxAgeHours"},
            "BACKUP_SCHEDULE", "Неизвестный параметр расписания.")
    require(type(settings.get("enabled", False)) is bool, "BACKUP_SCHEDULE", "enabled должен быть логическим значением.")
    clock = settings.get("time", "03:00")
    zone = settings.get("timezone", "Europe/Moscow")
    age = settings.get("maxAgeHours", 26)
    require(isinstance(clock, str) and re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", clock),
            "BACKUP_SCHEDULE", "Время задаётся в формате ЧЧ:ММ.")
    require(isinstance(zone, str) and re.fullmatch(r"[A-Za-z0-9_+/-]{1,80}", zone),
            "BACKUP_SCHEDULE", "Нужен корректный часовой пояс IANA.")
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise Blocked("BACKUP_SCHEDULE_TIMEZONE", "Часовой пояс не найден.", "Установите tzdata и проверьте сохранённый часовой пояс.") from exc
    require(type(age) is int and 1 <= age <= 8760, "BACKUP_SCHEDULE", "Допустимый возраст копии должен быть 1..8760 часов.")
    return {"enabled": settings.get("enabled", False), "time": clock, "timezone": zone, "maxAgeHours": age}


def unit_name(installation_id):
    cloud_project(installation_id)
    return "asa-backup-" + hashlib.sha256(installation_id.encode()).hexdigest()[:20]


def _quoted(value, *, environment=True):
    require(isinstance(value, str) and value and not any(ord(char) < 32 for char in value),
            "BACKUP_SCHEDULE_PATH", "В пути службы недопустим управляющий символ.")
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
    return '"' + (escaped.replace("$", "$$") if environment else escaped) + '"'


def render_units(root, installation_id, operator, settings, entrypoint):
    """Return systemd contents; does not install units or enable the schedule."""
    settings = validate_schedule(settings)
    root, entrypoint = Path(root), Path(entrypoint)
    require(root.is_absolute() and entrypoint.is_absolute(), "BACKUP_SCHEDULE_PATH", "Пути установки и загрузчика должны быть абсолютными.")
    require(isinstance(operator, str) and re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}\$?", operator),
            "BACKUP_SCHEDULE_OPERATOR", "Некорректное имя оператора службы.")
    name = unit_name(installation_id)
    arguments = ["/usr/bin/python3", "-I", str(entrypoint), "backup", "--root", str(root), "--scheduled", "--non-interactive"]
    command = " ".join(_quoted(arg) for arg in arguments)
    condition = " ".join(_quoted(arg) for arg in [*arguments, "--schedule-budget-check"])
    marker = "# ASA installation: " + installation_id
    service = f"""{marker}
[Unit]
Description=ASA Lab complete backup ({installation_id})
After=docker.service network-online.target
Wants=network-online.target
StartLimitIntervalSec=3600
StartLimitBurst=3

[Service]
Type=oneshot
User={operator}
WorkingDirectory={_quoted(str(root), environment=False)}
ExecCondition={condition}
ExecStart={command}
UMask=0077
TimeoutStartSec=7800
Restart=on-failure
RestartSec=300
RestartPreventExitStatus=130
NoNewPrivileges=true
PrivateTmp=true
StandardOutput=journal
StandardError=journal
"""
    timer = f"""{marker}
[Unit]
Description=ASA Lab daily backup timer ({installation_id})

[Timer]
OnCalendar=*-*-* {settings['time']}:00 {settings['timezone']}
Persistent=true
AccuracySec=60
RandomizedDelaySec=0
Unit={name}.service

[Install]
WantedBy=timers.target
"""
    return {name + ".service": service, name + ".timer": timer}


def _systemctl(*args):
    try:
        result = subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=40, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked("BACKUP_SYSTEMD_UNAVAILABLE", "Системный systemd недоступен.",
                      "Проверьте системную службу на полном Ubuntu-хосте; пользовательский bus не требуется.") from exc
    require(result.returncode == 0, "BACKUP_SYSTEMD", "Команда системного планировщика не выполнена.",
            "Проверьте systemctl status соответствующего ASA backup timer.")
    return result.stdout


def install_schedule(root, installation_id, operator, settings, entrypoint, *, unit_directory=Path("/etc/systemd/system")):
    """A narrowly privileged helper. Only deterministic units of this ID change."""
    require(hasattr(os, "geteuid") and os.geteuid() == 0, "BACKUP_SCHEDULE_ROOT",
            "Для установки системного timer необходим root.", "Запустите asa-setup.sh schedule из root-терминала или через sudo.")
    import pwd
    settings = validate_schedule(settings)
    root, entrypoint, directory = Path(root), Path(entrypoint), Path(unit_directory)
    plain_paths(root, ())
    plain_paths(entrypoint.parent, (entrypoint.name,))
    try:
        account = pwd.getpwnam(operator)
    except KeyError as exc:
        raise Blocked("BACKUP_SCHEDULE_OPERATOR", "Оператор службы отсутствует.", "Проверьте сохранённого владельца установки.") from exc
    require(root.is_dir() and root.stat().st_uid == account.pw_uid, "BACKUP_SCHEDULE_OWNER", "Каталог установки принадлежит другому оператору.")
    require(entrypoint.is_file() and entrypoint.stat().st_uid == 0 and not entrypoint.stat().st_mode & 0o022,
            "BACKUP_SCHEDULE_TRUST", "Служба должна вызывать проверенный загрузчик, принадлежащий root.")
    require(all(path.stat().st_uid == 0 and not path.stat().st_mode & 0o022 for path in entrypoint.parents),
            "BACKUP_SCHEDULE_TRUST", "Родительский каталог загрузчика допускает подмену другим пользователем.")
    plain_paths(directory, ())
    require(directory.is_dir() and directory.stat().st_uid == 0 and not directory.stat().st_mode & 0o022,
            "BACKUP_SCHEDULE_DIRECTORY", "Каталог systemd не прошёл проверку владельца и прав.")
    units = render_units(root, installation_id, operator, settings, entrypoint)
    marker = "# ASA installation: " + installation_id
    for existing in directory.glob("asa-backup-*.service"):
        plain_paths(directory, (existing.name,))
        text = existing.read_text(encoding="utf-8")
        if marker in text or "WorkingDirectory=" + _quoted(str(root), environment=False) in text:
            require(existing.name in units and text.startswith(marker + "\n"),
                    "BACKUP_SCHEDULE_DUPLICATE", "Для этой установки уже существует другое задание backup.",
                    "Разберите существующее задание до включения нового; оно не удаляется автоматически.")
    for name in units:
        target = directory / name
        plain_paths(directory, (name,))
        if target.exists():
            info = target.stat()
            require(info.st_uid == 0 and not stat.S_IMODE(info.st_mode) & 0o022
                    and target.read_text(encoding="utf-8").startswith(marker + "\n"),
                    "BACKUP_SCHEDULE_CONFLICT", "Одноимённый unit принадлежит другой конфигурации.")
    # Validate systemd calendar syntax against this machine before any write.
    try:
        checked = subprocess.run(["systemd-analyze", "calendar", "*-*-* " + settings["time"] + ":00 " + settings["timezone"]],
                                 capture_output=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked("BACKUP_SYSTEMD_UNAVAILABLE", "Не удалось проверить календарь systemd.", "Проверьте системный планировщик.") from exc
    require(checked.returncode == 0, "BACKUP_SCHEDULE_CALENDAR", "Systemd отклонил сохранённое расписание.")
    for name, content in units.items():
        atomic_bytes(directory / name, content.encode("utf-8"), mode=0o644)
    _systemctl("daemon-reload")
    timer = unit_name(installation_id) + ".timer"
    _systemctl("enable" if settings["enabled"] else "disable", "--now", timer)
    result = schedule_status(root, installation_id, settings)
    require(not settings["enabled"] or result.get("running") is True,
            "BACKUP_SCHEDULE_INACTIVE", "Настройка сохранена, но timer не запущен.")
    # Keep this root-owned administrative receipt outside operator-owned .asa.
    return result


def scheduled_operation_id(installation_id, settings, instant=None):
    """Retries and a missed persistent trigger reuse the same daily slot ID."""
    settings = validate_schedule(settings)
    instant = instant or dt.datetime.now(dt.timezone.utc)
    local = instant.astimezone(ZoneInfo(settings["timezone"]))
    hour, minute = map(int, settings["time"].split(":"))
    day = local.date() if (local.hour, local.minute) >= (hour, minute) else local.date() - dt.timedelta(days=1)
    material = installation_id + "|" + day.isoformat() + "|" + settings["time"] + "|" + settings["timezone"]
    return hashlib.sha256(material.encode()).hexdigest()[:32]


def scheduled_attempt(root, installation_id, settings, *, consume=True, instant=None):
    """Claim at most three durable starts per daily slot, before the main lock.

    ExecCondition only checks this budget. Its exit status 2 skips a depleted
    service without a restart, while ExecStart exclusively claims an attempt.
    Slow network failures therefore cannot evade a systemd rate limit. A crash
    after claim creation consumes that attempt even if its JSON was not written.
    """
    operation_id = scheduled_operation_id(installation_id, settings, instant)
    state = Path(root) / ".asa"
    plain_paths(state, ())
    info = state.stat()
    require(stat.S_ISDIR(info.st_mode) and (os.name == "nt" or
            (info.st_uid == os.geteuid() and not info.st_mode & 0o077)),
            "BACKUP_PRIVATE_DIRECTORY", "Каталог состояния должен принадлежать оператору и иметь права 0700.")
    directory = state / "setup-schedule-attempts" / operation_id
    plain_paths(directory, ())
    if consume:
        private_directory(directory.parent)
        private_directory(directory)
    elif not directory.exists():
        return operation_id
    for path in (directory.parent, directory):
        info = path.stat()
        require(stat.S_ISDIR(info.st_mode) and (os.name == "nt" or
                (info.st_uid == os.geteuid() and not info.st_mode & 0o077)),
                "BACKUP_PRIVATE_DIRECTORY", "Каталог попыток расписания не прошёл проверку владельца и прав.")
    for attempt in range(1, 4):
        path = directory / (str(attempt) + ".json")
        plain_paths(directory, (path.name,))
        try:
            if not consume:
                info = path.lstat()
            else:
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write((json.dumps({"format": "asa-backup-scheduled-attempt-v1",
                        "installationId": installation_id, "operationId": operation_id,
                        "attempt": attempt, "at": now()}, sort_keys=True) + "\n").encode())
                    stream.flush()
                    os.fsync(stream.fileno())
                if os.name != "nt":
                    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                return operation_id
        except FileNotFoundError:
            if not consume:
                return operation_id
            raise
        except FileExistsError:
            info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and (os.name == "nt" or
                (info.st_uid == os.geteuid() and not info.st_mode & 0o077)),
                "SCHEDULE_ATTEMPT_FILE", "Файл попытки расписания не прошёл проверку владельца и прав.")
    raise Blocked("SCHEDULE_RETRY_EXHAUSTED", "Три попытки этого суточного backup уже использованы.",
                  "Проверьте status и причину сбоя; для явного продолжения выполните resume. Timer повторит попытку в следующем суточном слоте.")


def schedule_status(root, installation_id, settings):
    settings = validate_schedule(settings)
    name = unit_name(installation_id)
    result = {"format": "asa-backup-schedule-v1", "installationId": installation_id,
              "configuration": settings, "installed": False, "running": False, "observedAt": now(),
              "nextRun": None, "lastRun": None, "lastLocalSuccess": None, "lastCloudSuccess": None}
    try:
        text = _systemctl("show", name + ".timer", "--property=LoadState,ActiveState,UnitFileState,NextElapseUSecRealtime,LastTriggerUSec")
        value = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
        result.update(installed=value.get("LoadState") == "loaded",
                      running=value.get("ActiveState") == "active" and value.get("UnitFileState") == "enabled",
                      nextRun=value.get("NextElapseUSecRealtime") or None, lastRun=value.get("LastTriggerUSec") or None)
        service = _systemctl("show", name + ".service", "--property=Result,ExecMainStatus,ExecMainExitTimestamp,NRestarts")
        result["lastServiceResult"] = dict(line.split("=", 1) for line in service.splitlines() if "=" in line)
    except Blocked as exc:
        result["error"] = exc.code
    for key, filename in (("lastLocalSuccess", "last-local-success.json"), ("lastCloudSuccess", "last-cloud-success.json")):
        path = Path(root) / ".asa" / "setup-backups" / filename
        if path.exists():
            pointer = json.loads(read_private(path))
            timestamp = dt.datetime.fromisoformat(pointer["at"])
            hours = max(0, (dt.datetime.now(dt.timezone.utc) - timestamp).total_seconds() / 3600)
            result[key] = {**pointer, "ageHours": round(hours, 2), "tooOld": hours > settings["maxAgeHours"]}
    return result

"""Six-point Russian operator report and an independent machine contract."""

import datetime as dt
import json
import os
import sys


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def result(operation_id, installation_id, mode, *, outcome="PENDING", code=2, **values):
    return {"format": "asa-setup-result-v1", "operationId": operation_id, "installationId": installation_id,
            "mode": mode, "outcome": outcome, "exitCode": code, "observedAt": now(),
            "actionExecuted": False, "executionCompleted": False, "applicationAccepted": False, "dataProtectionConfirmed": False,
            "dependencies": {"status": "UNVERIFIED"}, "version": {"status": "UNVERIFIED"},
            "data": {"status": "UNVERIFIED"}, "backup": {"status": "UNVERIFIED"},
            "site": {"status": "UNVERIFIED"}, "diagnostics": {"status": "UNVERIFIED"},
            "postActions": [], "nextAction": "Проверьте состояние через asa-setup status.", **values}


_FAILED = frozenset(("FAILED", "ERROR", "failed", "environment_failed"))
_OK = frozenset(("OK", "ACCEPTED", "PRESERVED", "INITIALIZED", "RUNNING", "passed",
                 "NO_CHANGE", "CHECKED", "OBSERVED", "READY", "NOT_REQUIRED"))
_ROWS = ("dependencies", "version", "data", "backup", "site", "diagnostics")
_COMMAND_OUTCOMES = frozenset(("ERROR", "BLOCKED", "NO_CHANGE", "CHECKED",
                               "CONFIGURED", "STATUS", "PLANNED", "PREPARATION_REQUIRED"))
_BACKUP_COMMANDS = frozenset(("backup", "retry-cloud", "cloud-retry"))


def _state(check):
    return (check.get("status") or check.get("outcome")) if isinstance(check, dict) else check if isinstance(check, str) else None


def _mandatory_summary(item):
    """Do not hide an explicit mandatory check behind a successful row."""
    if not isinstance(item, dict):
        return "FAILED" if _state(item) in _FAILED else "INCOMPLETE"
    state = _state(item)
    checks = item.get("checks", {})
    checks = checks.values() if isinstance(checks, dict) else checks if isinstance(checks, list) else ()
    states = [_mandatory_summary(check) if isinstance(check, dict) else _state(check) for check in checks
              if not isinstance(check, dict) or check.get("required", True) is not False]
    if state in _FAILED or any(check in _FAILED for check in states):
        return "FAILED"
    if any(check not in _OK for check in states):
        return "INCOMPLETE"
    return state if state in _OK else "INCOMPLETE"


def _site_summary(site):
    """Aggregate current technical, browser and owner acceptance evidence."""
    if not isinstance(site, dict):
        return "INCOMPLETE"
    technical = _mandatory_summary(site.get("technical", {}))
    browser = _mandatory_summary(site.get("browser", {}))
    owner = _mandatory_summary(site.get("owner", {})) if "owner" in site else "NOT_REQUIRED"
    if _state(site) in _FAILED or any(state in _FAILED for state in (technical, browser, owner)):
        return "FAILED"
    if technical == "passed" and browser == "passed" and owner in ("READY", "NOT_REQUIRED"):
        return "OK"
    return "INCOMPLETE"


def _schedule_ok(receipt):
    schedule = receipt.get("schedule", {})
    return (not schedule.get("configuration", {}).get("enabled", False)
            or schedule.get("installed") is True and schedule.get("running") is True)


def _schedule_summary(schedule):
    """A schedule action must confirm the selected enabled or disabled state."""
    if not isinstance(schedule, dict):
        return "INCOMPLETE"
    if _state(schedule) in _FAILED:
        return "FAILED"
    configuration = schedule.get("configuration", {})
    enabled = configuration.get("enabled") if isinstance(configuration, dict) else None
    if (type(enabled) is not bool or schedule.get("error") or schedule.get("installed") is not True
            or schedule.get("running") is not enabled):
        return "INCOMPLETE"
    return "OK"


def _backup_summary(receipt):
    """Local backup is mandatory; the selected policy governs cloud evidence."""
    required = ("local", "encryption", "cloud") if receipt.get("policy") == "required" else ("local",)
    states = [_mandatory_summary(receipt.get(field, {})) for field in required]
    blocked_failure = (receipt.get("policy") == "best-effort" and receipt.get("outcome") == "BLOCKED"
                       and any(_state(receipt.get(field)) in _FAILED for field in ("encryption", "cloud")))
    if _state(receipt) in _FAILED or receipt.get("outcome") == "ERROR" or any(state in _FAILED for state in states) or blocked_failure:
        return "FAILED"
    if receipt.get("outcome") == "BLOCKED" or any(state != "OK" for state in states) or not _schedule_ok(receipt):
        return "INCOMPLETE"
    if receipt.get("outcome") == "WARNING" or any(_state(receipt.get(field)) != "OK" for field in ("encryption", "cloud")):
        return "WARNING"
    return "OK"


def _report_rows(value):
    """Use the same six summaries for saved JSON and terminal output."""
    rows = {key: dict(value[key]) if isinstance(value.get(key), dict) else {} for key in _ROWS}
    local = dict(rows["backup"]["local"]) if isinstance(rows["backup"].get("local"), dict) else {}
    if local.get("error") == "BACKUP_RESUME_SNAPSHOT_MISSING":
        never_started = (local.get("executionStatus") == "NOT_RUN" and not local.get("previouslyVerified")
                         and not rows["backup"].get("snapshotAt")
                         and not any(local.get(key) for key in ("verifiedAt", "manifestSha256")))
        local["status"] = "NOT_RUN" if never_started else "FAILED"
        rows["backup"]["local"] = local
    for key in ("dependencies", "version", "data"):
        rows[key]["status"] = _mandatory_summary(rows[key])
    technical = rows["site"].get("technical", {})
    checks = technical.get("checks", {}) if isinstance(technical, dict) else {}
    if isinstance(checks, dict):
        for key, fields in (("version", ("manifest", "configuration", "runtime", "images")), ("data", ("data",))):
            observed = {name: checks[name] for name in fields if name in checks}
            if observed:
                rows[key]["technicalChecks"] = observed
                states = [_mandatory_summary(item) if isinstance(item, dict) else _state(item) for item in observed.values()]
                if any(state in _FAILED for state in states):
                    rows[key]["status"] = "FAILED"
                elif any(state not in _OK for state in states) and rows[key]["status"] != "FAILED":
                    rows[key]["status"] = "INCOMPLETE"
    if value.get("mode") == "install" and "owner" not in rows["site"]:
        rows["site"]["owner"] = {"status": "not_run"}
    rows["site"]["status"] = _site_summary(rows["site"])
    rows["backup"]["status"] = _backup_summary(rows["backup"])
    if value.get("mode") == "schedule":
        failed = _state(value.get("backup")) in _FAILED
        rows["backup"]["status"] = "FAILED" if failed else _schedule_summary(rows["backup"].get("schedule", {}))
        action = value.get("rootActions", {})
        if action and _state(action) != "OK" and rows["backup"]["status"] != "FAILED":
            rows["backup"]["status"] = "INCOMPLETE"
    if _state(value.get("retention")) in _FAILED:
        rows["backup"]["status"] = "FAILED"
    elif value.get("retention", {}).get("status") == "DEFERRED" and rows["backup"]["status"] == "OK":
        rows["backup"]["status"] = "WARNING"
    # An optional collector cannot turn application acceptance into a failure.
    rows["diagnostics"]["status"] = "passed" if _mandatory_summary(rows["diagnostics"]) == "passed" else "warning"
    return rows


def finalize(value):
    """A performed mandatory failure is an error; missing evidence is incomplete."""
    value.update(_report_rows(value))
    receipt = value["backup"]
    protected = all(_mandatory_summary(receipt.get(field, {})) == "OK" for field in ("local", "encryption", "cloud"))
    accepted = value["site"]["status"] == "OK"
    value.update(applicationAccepted=accepted, dataProtectionConfirmed=protected)
    mandatory = ("dependencies", "version", "data", "backup", "site")
    failed = any(value[key]["status"] == "FAILED" for key in mandatory)
    # SIGINT retains its process contract even when earlier evidence failed.
    if value.get("outcome") == "INTERRUPTED":
        value["exitCode"] = 130
        return value
    if failed:
        value.update(outcome="ERROR", exitCode=1,
                     nextAction=value.get("nextAction") or "Проверьте причину обязательной проверки и повторите приёмку этой операции.")
        return value
    if value.get("outcome") in _COMMAND_OUTCOMES:
        return value
    mode = value.get("mode")
    if mode in _BACKUP_COMMANDS:
        required = ("backup",)
    elif mode == "schedule":
        required = ("backup",)
    elif mode == "repair-collector":
        required = ()
    else:
        required = mandatory
    incomplete = any(value[key]["status"] == "INCOMPLETE" for key in required)
    if receipt.get("outcome") == "BLOCKED":
        value.update(outcome="BLOCKED", exitCode=2)
    elif incomplete:
        value.update(outcome="INCOMPLETE", exitCode=2,
                     nextAction=("Выполните asa-setup.sh schedule; выбранное ежедневное расписание ещё не подтверждено."
                         if accepted and not _schedule_ok(receipt) else "Проверьте причины и выполните acceptance для этой операции; новая миграция не запускается."))
    else:
        warning = (receipt["status"] == "WARNING" if mode in _BACKUP_COMMANDS or mode == "schedule" else
                   value["diagnostics"]["status"] != "passed" if mode == "repair-collector" else
                   not protected or receipt["status"] == "WARNING" or value["diagnostics"]["status"] != "passed")
        value.update(outcome="WARNING" if warning else "ACCEPTED", exitCode=0,
                     nextAction=value.get("nextAction") if mode in _BACKUP_COMMANDS or mode in ("schedule", "repair-collector") else
                     "Можно работать." if not warning else "Приложение принято; выполните действие по указанному предупреждению backup или диагностики.")
    return value


def render(value, *, as_json=False, stream=None):
    stream = stream or sys.stdout
    # Old and directly constructed reports also receive an honest aggregate.
    value = finalize(dict(value))
    if as_json:
        print(json.dumps(value, ensure_ascii=True, sort_keys=True), file=stream)
        return
    names = {"ACCEPTED": "готово", "WARNING": "готово с предупреждением", "NO_CHANGE": "текущая версия уже установлена",
             "INCOMPLETE": "приёмка не завершена", "BLOCKED": "остановлено до подтверждения", "ERROR": "ошибка выполнения",
             "INTERRUPTED": "прервано", "CHECKED": "проверено", "STATUS": "наблюдение", "CONFIGURED": "настройки сохранены",
             "PLANNED": "план без выполнения", "OK": "подтверждено", "PRESERVED": "сохранены", "INITIALIZED": "созданы",
             "RUNNING": "работает", "TECHNICAL_OK": "техническая проверка пройдена", "TECHNICAL_ONLY": "только техническая проверка",
             "UNVERIFIED": "не подтверждено", "NOT_CONFIGURED": "не настроено", "NOT_RUN": "не выполнялось",
             "passed": "проверено", "warning": "предупреждение", "incomplete": "не завершено", "FAILED": "ошибка",
             "PENDING": "ожидает", "not_run": "не выполнялось", "failed": "ошибка", "OBSERVED": "наблюдалось",
             "historical_passed": "принято ранее для этой версии и конфигурации", "PREPARATION_REQUIRED": "подготовка зависимостей"}
    tty = bool(getattr(stream, "isatty", lambda: False)())
    unicode_ok = tty and "ascii" not in (getattr(stream, "encoding", None) or "utf-8").lower()
    if unicode_ok:
        try:
            "✓⚠✗—".encode(getattr(stream, "encoding", None) or "utf-8")
        except UnicodeEncodeError:
            unicode_ok = False
    colors = tty and "NO_COLOR" not in os.environ and os.environ.get("TERM") != "dumb"
    outcome = value.get("outcome", "UNKNOWN")
    def marker(state):
        kind = "ok" if state in ("OK", "ACCEPTED", "PRESERVED", "INITIALIZED", "RUNNING", "passed", "NO_CHANGE", "CHECKED", "TECHNICAL_OK", "OBSERVED") else "error" if state in ("ERROR", "FAILED", "failed", "environment_failed") else "warn"
        symbols = {"ok": ("✓", "[OK]", "32"), "error": ("✗", "[X]", "31"), "skip": ("—", "[-]", "37"), "warn": ("⚠", "[!]", "33")}
        glyph, ascii_glyph, color = symbols[kind]
        text = glyph if unicode_ok else ascii_glyph
        return "\033[" + color + "m" + text + "\033[0m" if colors else text
    title = names.get(outcome, outcome)
    if value.get("mode") in ("install", "update"):
        prefix = "УСТАНОВЛЕНО" if value["mode"] == "install" else "ОБНОВЛЕНО"
        if outcome == "ACCEPTED":
            title = prefix + " — ГОТОВО К РАБОТЕ"
        elif outcome == "WARNING":
            title = prefix + " — ЕСТЬ ПРЕДУПРЕЖДЕНИЯ"
        elif outcome == "INCOMPLETE":
            title = prefix + " — ПРИЁМКА НЕ ЗАВЕРШЕНА"
        elif outcome == "NO_CHANGE":
            title = "УЖЕ АКТУАЛЬНО — приёмка не завершена" if value.get("exitCode") == 2 else "УЖЕ АКТУАЛЬНО — результат текущей проверки ниже"
        elif value.get("previousRuntime", {}).get("previousRuntimeVerified") and outcome == "BLOCKED":
            title = "НЕ ОБНОВЛЕНО — ПРЕЖНЯЯ ВЕРСИЯ РАБОТАЕТ"
        elif value.get("automaticRollback") is False and outcome in ("BLOCKED", "ERROR"):
            title = "СБОЙ ПОСЛЕ ПЕРЕКЛЮЧЕНИЯ — состояние требует проверки"
        elif outcome == "INTERRUPTED":
            title = "ОПЕРАЦИЯ ПРЕРВАНА — СОСТОЯНИЕ ТРЕБУЕТ ПРОВЕРКИ"
    print(f"{marker('WARNING' if outcome == 'WARNING' else 'OK' if value.get('exitCode') == 0 else 'ERROR' if value.get('exitCode') == 1 else 'PENDING')} ASA Setup: {title} (код {value.get('exitCode', 2)})", file=stream)
    print(f"Операция: {value.get('operationId') or 'наблюдение'}; установка: {value.get('installationId') or 'не подтверждена'}", file=stream)
    labels = (("dependencies", "Зависимости и владелец"), ("version", "Версия приложения"),
              ("data", "PostgreSQL и файлы"), ("backup", "Резервирование"),
              ("site", "Сайт и пользовательский путь"), ("diagnostics", "Диагностика"))
    for index, (key, label) in enumerate(labels, 1):
        item = value.get(key, {})
        state = item.get("status") or item.get("outcome") or "UNVERIFIED"
        print(f"{index}. {marker(state)} {label}: {names.get(state, state)}", file=stream)
        if key == "data" and item.get("source"):
            print("   Источник: " + item["source"], file=stream)
        if key == "version":
            print(f"   Было: {item.get('previous') or 'не подтверждено'}; выбрано: {item.get('selected') or 'не выбрано'}; runtime: {item.get('running') or 'не подтверждено'}", file=stream)
        if key == "backup":
            for field, title in (("local", "Локальная копия"), ("encryption", "AGE"), ("cloud", "Yandex/readback"), ("restore", "Восстановление")):
                status = item.get(field, {}).get('status', 'UNVERIFIED')
                print(f"   {title}: {names.get(status, status)}", file=stream)
            schedule = item.get("schedule", {})
            schedule_state = _schedule_summary(schedule)
            schedule_label = ("активно" if schedule["configuration"]["enabled"] else "отключено") if schedule_state == "OK" else "не подтверждено"
            print(f"   Расписание: {schedule_label}; следующий запуск: {schedule.get('nextRun') or 'не подтверждён'}", file=stream)
            if item.get("snapshotId"):
                print(f"   Снимок: {item['snapshotId']}; время: {item.get('snapshotAt') or 'не подтверждено'}", file=stream)
            if value.get("retention", {}).get("status") == "DEFERRED":
                retention = value["retention"]
                print("   Очистка старых копий отложена: " + retention.get("reasonCode", "CLOUD_UNAVAILABLE"), file=stream)
                print("   " + retention.get("nextAction", "Повторите резервирование после восстановления облачной связи."), file=stream)
            elif _state(value.get("retention")) in _FAILED:
                retention = value["retention"]
                print("   Очистка старых копий: ошибка — " + retention.get("reasonCode", "RETENTION_FAILED"), file=stream)
                print("   " + retention.get("nextAction", "Проверьте сохранённый план очистки и целостность старых копий."), file=stream)
        if key == "site":
            print(f"   Адрес: {item.get('url') or 'не подтверждён'}; сайт: {names.get(item.get('technical', {}).get('status', 'not_run'), 'не подтверждено')}; пользовательский путь: {names.get(item.get('browser', {}).get('status', 'not_run'), 'не подтверждено')}", file=stream)
        if item.get("reasonCode"):
            print(f"   Причина: {item['reasonCode']}", file=stream)
    if value.get("reasonCode"):
        print(f"Причина остановки: {value['reasonCode']}", file=stream)
    print("Следующее действие: " + value.get("nextAction", "status"), file=stream)
    if value.get("logPath"):
        print("Защищённый журнал: " + value["logPath"], file=stream)
    if value.get("version", {}).get("source"):
        print("Источник выпуска: " + value["version"]["source"], file=stream)
    print("Машинный отчёт: asa-setup.sh status --json", file=stream)

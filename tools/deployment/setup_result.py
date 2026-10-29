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


def _site_summary(site):
    """Aggregate mandatory current checks; never report technical-only as OK."""
    if not isinstance(site, dict) or not any(key in site for key in ("technical", "browser", "owner")):
        return None
    technical = site.get("technical", {}).get("status")
    browser = site.get("browser", {}).get("status")
    owner = site.get("owner", {}).get("status", "NOT_REQUIRED")
    if any(state in ("FAILED", "ERROR", "failed", "environment_failed") for state in (technical, browser, owner)):
        return "FAILED"
    if technical == "passed" and browser == "passed" and owner in ("READY", "NOT_REQUIRED"):
        return "OK"
    return "INCOMPLETE"


def finalize(value):
    """Never convert missing acceptance or cloud evidence into an accepted run."""
    summary = _site_summary(value.get("site", {}))
    if summary is not None:
        value["site"]["status"] = summary
    if value.get("outcome") in ("ERROR", "INTERRUPTED", "BLOCKED", "NO_CHANGE", "CHECKED", "CONFIGURED", "STATUS", "PLANNED"):
        return value
    technical = value.get("site", {}).get("technical", {}).get("status")
    browser = value.get("site", {}).get("browser", {}).get("status")
    owner = value.get("site", {}).get("owner", {}).get("status", "NOT_REQUIRED")
    receipt = value.get("backup", {})
    protected = receipt.get("local", {}).get("status") == "OK" and receipt.get("encryption", {}).get("status") == "OK" and receipt.get("cloud", {}).get("status") == "OK"
    accepted = technical == "passed" and browser == "passed" and owner in ("READY", "NOT_REQUIRED")
    schedule = receipt.get("schedule", {})
    schedule_required = schedule.get("configuration", {}).get("enabled", False)
    schedule_ok = not schedule_required or schedule.get("running") is True and schedule.get("installed") is True
    value.update(applicationAccepted=accepted, dataProtectionConfirmed=protected)
    if receipt.get("outcome") == "ERROR":
        value.update(outcome="ERROR", exitCode=1)
    elif receipt.get("outcome") == "BLOCKED":
        value.update(outcome="BLOCKED", exitCode=2)
    elif not accepted or not schedule_ok:
        value.update(outcome="INCOMPLETE", exitCode=2,
                     nextAction=("Выполните asa-setup.sh schedule; выбранное ежедневное расписание ещё не подтверждено."
                         if accepted and not schedule_ok else "Проверьте причины и выполните acceptance для этой операции; новая миграция не запускается."))
    else:
        warning = not protected or value.get("diagnostics", {}).get("status") != "passed"
        value.update(outcome="WARNING" if warning else "ACCEPTED", exitCode=0,
                     nextAction="Можно работать." if not warning else "Приложение принято; выполните действие по указанному предупреждению backup или диагностики.")
    return value


def render(value, *, as_json=False, stream=None):
    stream = stream or sys.stdout
    # Old and directly constructed reports also receive an honest aggregate.
    value = {**value, "site": {**value.get("site", {})}}
    summary = _site_summary(value["site"])
    if summary is not None:
        value["site"]["status"] = summary
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
        kind = "ok" if state in ("OK", "ACCEPTED", "PRESERVED", "INITIALIZED", "RUNNING", "passed", "NO_CHANGE", "CHECKED", "TECHNICAL_OK", "OBSERVED") else "error" if state in ("ERROR", "FAILED", "failed", "environment_failed") else "skip" if state in ("NOT_RUN", "not_run", "NOT_REQUIRED", "DISABLED") else "warn"
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
    print(f"{marker('OK' if value.get('exitCode') == 0 else 'ERROR' if value.get('exitCode') == 1 else 'PENDING')} ASA Setup: {title} (код {value.get('exitCode', 2)})", file=stream)
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
            print(f"   Расписание: {'активно' if schedule.get('running') else 'не подтверждено'}; следующий запуск: {schedule.get('nextRun') or 'не подтверждён'}", file=stream)
            if item.get("snapshotId"):
                print(f"   Снимок: {item['snapshotId']}; время: {item.get('snapshotAt') or 'не подтверждено'}", file=stream)
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

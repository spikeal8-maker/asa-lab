"""Human-facing feedback for the production updater."""

import datetime as dt
import json
from pathlib import Path
import re
import unicodedata

from .contracts import Blocked, REPOSITORY


_MOSCOW = dt.timezone(dt.timedelta(hours=3))
_SHA = re.compile(r"[0-9a-f]{40}")

_PHASES = {
    "preflight": "проверка установки",
    "release": "поиск выпуска",
    "requirements": "проверка требований к обновлению",
    "images": "загрузка компонентов",
    "prepare": "подготовка установки",
    "migration": "проверка плана изменений базы",
    "backup": "создание резервной копии",
    "switch": "переключение и запуск новой версии",
    "health": "проверка сайта и редактора Scratch",
    "logs": "проверка сбора журналов",
}
_PROGRESS = {
    "images": "Загружаю компоненты выпуска.",
    "prepare": "Проверяю совместимость конфигурации.",
    "migration": "Проверяю план изменений базы.",
    "backup": "Создаю и проверяю резервную копию базы, файлов и настроек.",
    "switch": "Запускаю новую версию. Сайт может кратко прерваться.",
    "health": "Проверяю доступность сайта и редактора Scratch.",
    "logs": "Проверяю сбор журналов.",
}
_FAILURES = {
    "OFFSITE_BACKUP": "Нужна подтверждённая полная облачная копия текущей версии за последние 36 часов.",
    "LOCKED": "Уже выполняется другая операция обслуживания.",
    "MAINTENANCE": "Предыдущая операция требует проверки.",
    "FAILED_SWITCH": "Предыдущее переключение завершилось с ошибкой.",
    "ROLLBACK_PENDING": "Предыдущая операция требует проверки.",
    "RELEASE_DOWNGRADE": "У этого выпуска версия базы ниже текущей.",
    "RELEASE_SELECTION_PENDING": "Уже сохранён выбор выпуска для продолжения предыдущей установки.",
    "DIRTY": "В каталоге приложения есть локальные изменения.",
    "ORIGIN": "Каталог установки связан с другим репозиторием.",
    "SPACE": "Недостаточно свободного места.",
    "HEALTH": "Сайт и компоненты не прошли проверку готовности.",
    "TOOL": "Не запустился один из инструментов обслуживания.",
    "OPERATOR_INSTALLATION": "Постоянная команда должна быть привязана к действующей установке ASA Lab.",
    "INTERRUPTED": "Команда прервана оператором.",
}
# Operator wording for older releases whose public PR titles were technical.
_NOTES = {
    "1103": "Полное резервное копирование работает без остановки сайта. Штатные остановки исключены из графика ошибок.",
    "1197": "Исправлена проверка крупных файлов MinIO при создании резервной копии.",
}


def moscow_time(value):
    if not isinstance(value, str):
        return None
    try:
        moment = dt.datetime.fromisoformat(value)
        if moment.utcoffset() is not None:
            return moment.astimezone(_MOSCOW).strftime("%d.%m.%Y в %H:%M МСК")
    except (ValueError, OverflowError):
        pass
    return None


def installation_time(install, running):
    try:
        receipt = json.loads((install.state / "last-operation.json").read_text(encoding="utf-8"))
        selected = receipt["selected"]
        if receipt["status"] == "success" and all(selected[k] == running[k] for k in ("revision", "schema")):
            return moscow_time(receipt["at"])
    except (KeyError, TypeError, OSError, ValueError):
        pass
    return None


def release_changes(install, previous, selected):
    if not all(isinstance(revision, str) and _SHA.fullmatch(revision) for revision in (previous, selected)):
        return ()
    try:
        history = install.git(
            "log", "--first-parent", "--no-show-signature", "--no-notes", "--max-count=12",
            "--format=%s%x1f%b%x1e", f"{previous}..{selected}", "--",
            "apps", "packages", "tools", "infra", "compose.yaml", "compose.production.yaml",
        )
    except (Blocked, OSError, ValueError):
        return ()
    notes = []
    for entry in history.split("\x1e"):
        subject, separator, body = entry.strip().partition("\x1f")
        if not separator:
            continue
        merge = re.fullmatch(r"Merge pull request #(\d+) from .+", subject)
        if merge:
            note = _NOTES.get(merge[1])
            title = next((line.strip() for line in body.splitlines() if line.strip()), "")
        else:
            note, title = None, subject
        if not note:
            title = re.sub(r"^\w+(?:\([^)]*\))?!?:\s*", "", title)
            note = "".join(char for char in title if not unicodedata.category(char).startswith("C"))
        if note and note not in notes:
            notes.append(note[:160])
        if len(notes) == 4:
            break
    return notes


class OperatorOutput:
    def __init__(self, action, stream):
        self.action = action
        self.stream = stream
        self.phase = "preflight"
        self.shown = set()
        self.install = self.previous = self.selected = None
        self.switch_started = self.backup_done = False
        self.emit("Проверяю обновления ASA Lab." if action == "check" else "Проверяю, можно ли обновить ASA Lab.")

    def emit(self, message):
        if self.stream is not None:
            try:
                print(message, file=self.stream, flush=True)
            except (OSError, ValueError):
                # Losing the terminal must not interrupt a database migration.
                self.stream = None

    def stage(self, phase):
        self.phase = phase
        if self.action == "update" and phase in _PROGRESS and phase not in self.shown:
            self.emit(_PROGRESS[phase])
            self.shown.add(phase)

    def installed(self, install, running, release):
        self.install, self.previous, self.selected = install, running, release
        if "installed" in self.shown:
            return
        date = installation_time(install, running)
        when = f"Установлено {date}" if date else "Дата установки неизвестна"
        self.emit(f"{when}. Версия базы {running['schema']}.")
        self.shown.add("installed")

    def continuing(self):
        self.emit("Проверяю выпуск, сохранённый при предыдущей попытке.")

    def available(self, published_at):
        if "available" in self.shown:
            return
        date = moscow_time(published_at)
        when = f"от {date}" if date else "с неподтверждённой датой публикации"
        self.emit(f"Выпуск {when}. Версия базы {self.selected['schema']}.")
        previous, selected = self.previous["revision"], self.selected["revision"]
        notes = release_changes(self.install, previous, selected)
        if notes:
            self.emit("Изменения в этом обновлении")
            for note in notes:
                self.emit(f"  • {note}")
        elif _SHA.fullmatch(previous) and _SHA.fullmatch(selected):
            self.emit(f"Полный список изменений на GitHub\nhttps://github.com/{REPOSITORY}/compare/{previous[:12]}...{selected[:12]}")
        self.shown.add("available")

    def checked(self):
        self.emit("Можно устанавливать. Запустите sudo asa update.")
        self.emit("Установка проверит план изменений базы и сделает резервную копию.")

    def current(self):
        self.emit("Установлен актуальный выпуск. Сайт отвечает. Обновление не требуется.")

    def saved(self):
        if not self.backup_done:
            self.emit("Резервная копия создана и проверена.")
        self.backup_done = True

    def completed(self, collection):
        self.emit(f"ASA Lab обновлён. Сайт отвечает. Версия базы {self.selected['schema']}.")
        if not isinstance(collection, dict) or collection.get("state") != "running":
            self.emit("Работу сборщика журналов подтвердить не удалось. Проверьте sudo asa report.")

    def failed(self, code):
        if self.action == "check":
            self.emit("Устанавливать пока нельзя.")
        else:
            self.emit(f"Обновление остановлено. Этап — {_PHASES[self.phase]}.")
        reason = _FAILURES.get(code)
        if not reason and code.startswith("CI_"):
            reason = "GitHub не подтвердил проверки выбранного выпуска."
        if not reason and code.startswith("BACKUP"):
            reason = "Резервная копия не прошла проверку."
        if not reason and self.phase == "migration":
            reason = "Не удалось подтвердить план изменений базы."
        if not reason:
            reason = f"Не удалось завершить этап «{_PHASES[self.phase]}»."
        self.emit(reason)
        if self.action == "update":
            if self.backup_done:
                self.emit("Проверенная резервная копия создана.")
            previous_interruption = code in ("LOCKED", "MAINTENANCE", "FAILED_SWITCH", "ROLLBACK_PENDING")
            if not self.switch_started and not previous_interruption:
                self.emit("Эта попытка остановилась до переключения сайта и применения изменений базы.")
            if self.install is not None and code != "LOCKED":
                try:
                    observed = self.install.readiness()
                except (Blocked, OSError, KeyError, TypeError, ValueError):
                    self.emit("Подтвердить доступность сайта сейчас не удалось.")
                else:
                    if all(observed.get(k) == self.previous[k] for k in ("revision", "schema")):
                        self.emit("Сайт отвечает на прежней версии.")
                    elif all(observed.get(k) == self.selected[k] for k in ("revision", "schema")):
                        self.emit("Сайт отвечает на новой версии. Проверьте состояние операции.")
                    else:
                        self.emit("Сайт отвечает. Его выпуск требует проверки.")
        if self.switch_started or code in ("MAINTENANCE", "FAILED_SWITCH", "ROLLBACK_PENDING"):
            self.emit("Проверьте состояние командой sudo asa repair-plan.")
        elif code != "LOCKED":
            self.emit("Технические подробности проверки доступны по команде sudo asa check --verbose.")

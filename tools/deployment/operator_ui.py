"""Human-readable, non-executing progress view for the existing ASA manager CLI.

This module is presentation only: it never calls Docker, Git, SQL, HTTP,
writes a receipt, changes an exit code or authorizes an update.
"""

import os
import re
import sys

FIELDS = (
    ("environment", "Окружение и доступ"),
    ("version", "Опубликованный релиз"),
    ("backup", "Локальная резервная копия"),
    ("deployment", "Контейнеры и переключение"),
    ("http", "Доступность сайта"),
    ("browser", "Вход и работа пользователя"),
)

LABELS = {
    "OK": ("✓", "[OK]", "32"),
    "INFO": ("·", "[..]", "36"),
    "WARN": ("!", "[!]", "33"),
    "ERROR": ("✗", "[X]", "31"),
    "SKIP": ("-", "[-]", "90"),
}


def safe_text(value, *, maximum=240):
    """Prevent untrusted error/path text from injecting terminal control codes."""
    clean = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", str(value))
    return clean[:maximum] + ("…" if len(clean) > maximum else "")


class OperatorView:
    def __init__(self, stream=None, environ=None):
        self.stream = sys.stdout if stream is None else stream
        self.environ = os.environ if environ is None else environ
        self.state = {field: ("SKIP", "не выполнялось") for field, _ in FIELDS}
        self.opened = False
        is_tty = bool(getattr(self.stream, "isatty", lambda: False)())
        encoding = getattr(self.stream, "encoding", None) or "utf-8"
        try:
            "✓✗·".encode(encoding)
            self.unicode = is_tty
        except (LookupError, UnicodeError):
            self.unicode = False
        self.color = (
            is_tty
            and "NO_COLOR" not in self.environ
            and self.environ.get("CLICOLOR") != "0"
            and self.environ.get("TERM", "") != "dumb"
        )

    def _mark(self, state):
        glyph, fallback, ansi = LABELS[state]
        label = glyph if self.unicode else fallback
        return f"\033[{ansi}m{label}\033[0m" if self.color else label

    def _line(self, text=""):
        print(text, file=self.stream, flush=True)

    def begin(self, mode):
        self.opened = True
        self._line()
        self._line("=== ASA Lab | " + safe_text(mode) + " ===")
        self._line("Источник: опубликованный проверенный stable (не произвольный main).")

    def stage(self, number, label):
        self._line(f"\n[{number}/7] {safe_text(label)}")

    def set(self, field, state, description):
        if field not in self.state or state not in LABELS:
            raise ValueError("Unknown progress field or status")
        self.state[field] = (state, safe_text(description))

    def highlight_version(self, current, release, *, same):
        old = current.get("revision") if current else None
        new = release["revision"]
        old_schema = current.get("schema") if current else None
        new_schema = release["schema"]
        if same:
            description = f"Уже установлено: {new[:12]} · схема {new_schema}"
            self.set("version", "OK", description)
            self._line(f"{self._mark('OK')} Обновлений нет: {description}")
        else:
            suffix = (
                f" (схема {old_schema} → {new_schema})"
                if current else f" (схема {new_schema})"
            )
            description = f"{(old or 'новая установка')[:12]} → {new[:12]}" + suffix
            self.set("version", "WARN", description)
            self._line(f"{self._mark('WARN')} Доступно обновление: {description}")

    def finish(self, outcome, *, message=""):
        titles = {
            "UPDATED": "ОБНОВЛЕНО — техническая проверка завершена",
            "NO_CHANGE": "ОБНОВЛЕНИЙ НЕТ — текущий релиз сохранён",
            "AVAILABLE": "ОБНОВЛЕНИЕ ДОСТУПНО — установка не запускалась",
            "SKIP": "ПРОПУЩЕНО — вне разрешённого окна",
            "BLOCKED": "ОСТАНОВЛЕНО — требуется проверка",
        }
        severity = (
            "ERROR" if outcome == "BLOCKED" else
            "WARN" if outcome in ("AVAILABLE", "SKIP") else "OK"
        )
        self._line()
        self._line("=== ИТОГ ASA Lab ===")
        self._line(f"{self._mark(severity)} {titles.get(outcome, safe_text(outcome))}")
        for index, (field, label) in enumerate(FIELDS, start=1):
            state, detail = self.state[field]
            self._line(f" {index}. {self._mark(state)} {label}: {detail}")
        if message:
            self._line("Следующее действие: " + safe_text(message, maximum=500))
        self._line("Машинные коды UPDATED / NO_CHANGE / AVAILABLE / BLOCKED сохранены.")
        self._line("===================")

    def blocked(self, code, action):
        if not self.opened:
            self.begin("ОПЕРАЦИЯ")
        if self.state["deployment"][0] == "INFO":
            self.set(
                "deployment", "WARN",
                "Состояние после сбоя не подтверждено; проверьте runtime и maintenance.json",
            )
        self.finish("BLOCKED", message=f"{safe_text(code)}: {safe_text(action)}")

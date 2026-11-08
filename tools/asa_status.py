"""Read-only, compact ASA status and diagnostics for the portable operator command."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys

SERVICES = ("web", "api", "postgres", "minio", "search", "scratch")


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def run_read_only(args: list[str], timeout: int = 15) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True)


def containers(project: str) -> dict[str, dict[str, str]]:
    result = run_read_only([
        "docker", "ps", "--all", "--filter", f"label=com.docker.compose.project={project}",
        "--format", "{{.Names}}|{{.State}}|{{.Status}}",
    ])
    observed: dict[str, dict[str, str]] = {}
    for line in result.stdout.splitlines():
        fields = line.split("|", 2)
        if len(fields) != 3:
            continue
        name, state, description = fields
        for service in SERVICES:
            if name == f"{project}-{service}-1":
                observed[service] = {"name": name, "state": state, "status": description}
    return observed


def newest_backup(root: Path) -> tuple[str, dict]:
    directory = root / "backups"
    try:
        candidates = sorted(directory.glob("*/manifest.json"), reverse=True)
        if candidates:
            return candidates[0].parent.name, load_json(candidates[0])
    except OSError:
        pass
    return "нет", {}


def installed_state(root: Path) -> tuple[dict, dict]:
    config = load_json(root / ".asa" / "installation.json")
    release = load_json(root / ".asa" / "installed-release.json")
    return config, release


def version(root: Path) -> None:
    config, release = installed_state(root)
    if not release:
        print("ASA Lab: установленный релиз не найден")
    else:
        print(f"Установленный SHA: {release.get('revision', 'неизвестно')}")
        print(f"Схема по manifest: {release.get('schema', 'неизвестно')}")
    if config:
        print(f"Профиль: {config.get('profile', 'неизвестно')}")
        print(f"Проект Compose: {config.get('project', 'неизвестно')}")
    try:
        source = run_read_only(["git", "-C", str(root), "rev-parse", "HEAD"], 8).stdout.strip()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        source = "недоступен"
    print(f"Checkout SHA: {source}")
    if release and release.get("revision") != source:
        print("ПРИМЕЧАНИЕ: checkout SHA и SHA запущенного релиза различаются")


def status(root: Path, include_load: bool) -> int:
    config, release = installed_state(root)
    project = config.get("project")
    if not isinstance(project, str) or not project:
        print("ASA: отсутствует .asa/installation.json с идентификатором проекта", file=sys.stderr)
        return 2
    print(f"ASA Lab | {project} | профиль {config.get('profile', 'неизвестно')}")
    print(f"Релиз: {release.get('revision', 'неизвестно')} | схема: {release.get('schema', 'неизвестно')}")
    try:
        observed = containers(project)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"Docker: не удалось прочитать состояние ({type(error).__name__})", file=sys.stderr)
        return 3
    healthy = 0
    for service in SERVICES:
        item = observed.get(service)
        good = bool(item and item["state"] == "running" and "(healthy)" in item["status"])
        healthy += int(good)
        print(f"  {service:10} {'healthy' if good else (item['status'] if item else 'нет контейнера')}")
    print(f"Контейнеры: {healthy}/{len(SERVICES)} healthy")
    name, manifest = newest_backup(root)
    backup_schema = (manifest.get("runtime") or {}).get("schema")
    if manifest.get("complete") is True:
        text = f"{name} | схема {backup_schema}"
        if isinstance(backup_schema, int) and isinstance(release.get("schema"), int) and backup_schema < release["schema"]:
            text += " | УСТАРЕЛА для текущей схемы"
        print(f"Локальная копия: {text}")
    else:
        print("Локальная копия: нет проверенного полного manifest (только наличие файлов)")
    # Local receipts cannot attest remote availability without an independent cloud readback.
    print("Яндекс Диск: фактическая удалённая копия не проверяется этой командой")
    if include_load:
        try:
            load = os.getloadavg()
            print(f"Load average (1/5/15 мин): {load[0]:.2f} / {load[1]:.2f} / {load[2]:.2f}")
        except (AttributeError, OSError):
            print("Load average: недоступен")
        print("Среднее использование CPU за 1/24 ч: нет подтверждённой истории измерений")
    return 0 if healthy == len(SERVICES) else 4


def logs(root: Path, service: str | None, tail: int) -> int:
    if service not in SERVICES:
        print("ASA: допустимые журналы: " + ", ".join(SERVICES), file=sys.stderr)
        return 2
    if not 1 <= tail <= 2000:
        print("ASA: --tail должен быть от 1 до 2000", file=sys.stderr)
        return 2
    config, _ = installed_state(root)
    project = config.get("project")
    if not isinstance(project, str) or not project:
        print("ASA: проект не определён", file=sys.stderr)
        return 2
    try:
        observed = containers(project)
        item = observed.get(service)
        if item is None:
            print(f"ASA: контейнер {service} отсутствует в проекте {project}", file=sys.stderr)
            return 3
        return subprocess.run(["docker", "logs", "--tail", str(tail), item["name"]], check=False).returncode
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"ASA: журналы недоступны ({type(error).__name__})", file=sys.stderr)
        return 3


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "report", "version", "logs"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("service", nargs="?")
    parser.add_argument("--tail", type=int, default=100)
    args = parser.parse_args(argv)
    if args.action == "version":
        if args.service:
            parser.error("version не принимает службу")
        version(args.root)
        return 0
    if args.action == "logs":
        return logs(args.root, args.service or "api", args.tail)
    if args.service:
        parser.error("служба допустима только с logs")
    return status(args.root, include_load=args.action == "report")


if __name__ == "__main__":
    raise SystemExit(main())

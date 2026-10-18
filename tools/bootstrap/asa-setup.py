#!/usr/bin/env python3
"""ASA Lab setup assistant: human dialogs and machine-readable agent contract.

A small, standard-library frontend for install-ubuntu-1panel.py. It does not
implement a second deployment engine or persist credentials. PLAN is read-only.
APPLY is explicitly approved, invokes only the canonical bootstrap wrapper,
and never silently restores a backup into an existing installed release.
"""
from __future__ import annotations

import argparse
import getpass
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys

SCHEMA = 1
ACTIONS = {"install", "school-lan", "doctor", "backup", "verify-backup",
           "restore-check", "update"}
KEYS = {
    "schema_version", "action", "root", "operator", "profile", "admin_cidr",
    "panel_port", "school_lan_https", "school_lan_interface",
    "school_lan_follow_interface", "data_mode", "restore_backup",
    "restore_snapshot", "target_hostname", "fresh_empty_confirmed",
    "max_snapshot_age_hours", "min_active_students", "min_seats",
    "panel_archive", "backup_dir", "database", "encrypted_archive",
}
FORBIDDEN = re.compile(r"(password|secret|token|oauth|private.key|age.identity)", re.I)
USER = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
IFACE = re.compile(r"^(auto|[A-Za-z0-9_.-]{1,15})$")
SNAPSHOT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$")
DATABASE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,50}_test$")
ROOTS_FORBIDDEN = {"/", "/etc", "/home", "/root", "/usr", "/var", "/opt",
                   "/tmp", "/srv", "/dev", "/proc", "/sys"}
BOOTSTRAP = Path(__file__).resolve().parent / "install-ubuntu-1panel.py"


class SetupBlocked(ValueError):
    pass


def host_facts() -> dict:
    sudo_user = os.environ.get("SUDO_USER", "")
    operator = sudo_user if USER.fullmatch(sudo_user) and sudo_user != "root" else ""
    if not operator:
        current = getpass.getuser()
        operator = current if USER.fullmatch(current) and current != "root" else ""
    ssh = os.environ.get("SSH_CONNECTION", "").split()
    return {
        "platform": sys.platform,
        "hostname": socket.gethostname(),
        "operator": operator,
        "ssh_client": ssh[0] if len(ssh) == 4 else None,
        "docker_present": bool(shutil.which("docker")),
        "whiptail_present": bool(shutil.which("whiptail")),
        "gui_available": bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")),
    }


def _path(value: object, label: str, *, file: bool = False) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise SetupBlocked(f"{label} must be a nonempty absolute path")
    selected = Path(value)
    if not selected.is_absolute():
        raise SetupBlocked(f"{label} must be absolute")
    if ".." in selected.parts:
        raise SetupBlocked(f"{label} cannot contain parent traversal")
    if selected.is_symlink():
        raise SetupBlocked(f"{label} may not be a symlink")
    selected = selected.resolve(strict=False)
    if label == "root" and (str(selected) in ROOTS_FORBIDDEN or len(selected.parts) < 3):
        raise SetupBlocked("ASA root must be a dedicated subdirectory such as /srv/asa-lab")
    if selected.is_symlink():
        raise SetupBlocked(f"{label} may not be a symlink")
    if file and selected.exists() and not selected.is_file():
        raise SetupBlocked(f"{label} must point to a regular file")
    return selected


def _flag(config: dict, key: str, default: bool = False) -> bool:
    value = config.get(key, default)
    if not isinstance(value, bool):
        raise SetupBlocked(f"{key} must be true or false")
    return value


def _number(config: dict, key: str, default: int, upper: int) -> int:
    value = config.get(key, default)
    if type(value) is not int or not 0 <= value <= upper:
        raise SetupBlocked(f"{key} must be an integer from 0 to {upper}")
    return value


def _admin_cidr(value: object) -> str:
    if not isinstance(value, str):
        raise SetupBlocked("admin_cidr must be a CIDR")
    try:
        network = ipaddress.ip_network(value, strict=True)
    except ValueError as exc:
        raise SetupBlocked("admin_cidr must identify an exact administrator network") from exc
    if network.version != 4 or network.prefixlen < 16:
        raise SetupBlocked("admin_cidr must be IPv4 /16 or narrower")
    if not network.is_private and network.prefixlen != 32:
        raise SetupBlocked("public administrator network must be one /32 address")
    return str(network)


def build_plan(config: dict, *, facts: dict | None = None, files: bool = True) -> dict:
    """Pure planning except optional existence checks; no subprocess/network/updates."""
    facts = facts or host_facts()
    if not isinstance(config, dict):
        raise SetupBlocked("Answers must be a JSON object")
    if type(config.get("schema_version")) is not int or config["schema_version"] != SCHEMA:
        raise SetupBlocked("Unsupported setup answers schema_version")
    unknown = set(config) - KEYS
    if unknown:
        raise SetupBlocked("Unsupported answer keys: " + ", ".join(sorted(unknown)))
    if any(FORBIDDEN.search(key) for key in config):
        raise SetupBlocked("Secrets and OAuth tokens may not be stored in setup answers")
    action = config.get("action")
    if not isinstance(action, str) or action not in ACTIONS:
        raise SetupBlocked("Unsupported action")
    profile = config.get("profile", "production")
    if profile not in ("production", "staging", "dev"):
        raise SetupBlocked("Unsupported deployment profile")
    root = _path(config.get("root", "/srv/asa-lab"), "root")
    operator = config.get("operator") or facts.get("operator")
    missing = []
    if not operator:
        missing.append("operator: the existing Ubuntu system account")
    elif not USER.fullmatch(str(operator)) or operator == "root":
        raise SetupBlocked("operator must be a non-root Linux account name")
    if action == "school-lan" and profile != "production":
        raise SetupBlocked("school-lan requires production")
    if action == "install" and profile == "dev":
        raise SetupBlocked("The 1Panel bootstrap supports staging or production, not dev install")
    interface = config.get("school_lan_interface", "auto")
    if not isinstance(interface, str) or not IFACE.fullmatch(interface):
        raise SetupBlocked("school_lan_interface must be auto or a physical interface name")
    follow = _flag(config, "school_lan_follow_interface")
    https = _flag(config, "school_lan_https", action == "install" and profile == "production")
    if (https or follow or interface != "auto") and profile != "production":
        raise SetupBlocked("Secure school LAN options require production")
    if action not in ("install", "school-lan") and (follow or interface != "auto" or
                                                      config.get("school_lan_https", False)):
        raise SetupBlocked("LAN configuration belongs only to install/school-lan")
    if action == "school-lan" and not https:
        https = True
    data_mode = config.get("data_mode")
    marker = root / ".asa" / "installed-release.json"
    installed = marker.is_file() if files else False
    if files and action in ("doctor", "backup", "update", "school-lan", "restore-check") and not installed:
        missing.append("root: existing ASA installation with installed-release.json")
    argv = [sys.executable, str(BOOTSTRAP), action, "--root", str(root),
            "--profile", profile]
    if operator:
        argv.extend(["--operator", str(operator)])
    stages = ["Check existing installation identity"]
    preparation = None
    if action == "install":
        cidr = config.get("admin_cidr")
        if not cidr:
            missing.append("admin_cidr: approved SSH/1Panel administrator subnet")
        else:
            argv.extend(["--admin-cidr", _admin_cidr(cidr)])
        port = _number(config, "panel_port", 19192, 65535)
        if port < 1024:
            raise SetupBlocked("panel_port must be an unprivileged TCP port")
        argv.extend(["--panel-port", str(port)])
        if config.get("panel_archive"):
            archive = _path(config["panel_archive"], "panel_archive", file=True)
            if files and not archive.is_file():
                missing.append("panel_archive: verified local 1Panel archive file")
            argv.extend(["--panel-archive", str(archive)])
        if installed:
            if data_mode in ("restore", "encrypted"):
                raise SetupBlocked("Existing ASA release detected: never automatically overwrite live database")
            stages.append("Existing install: doctor only; no restore or reset")
        else:
            if profile == "production":
                if data_mode not in ("empty", "restore", "encrypted"):
                    missing.append("data_mode: restore, encrypted archive or explicitly empty new school")
                elif data_mode == "empty":
                    if not _flag(config, "fresh_empty_confirmed"):
                        missing.append("fresh_empty_confirmed: acknowledge an intentionally EMPTY new school")
                    argv.append("--fresh-empty")
                    stages.append("Explicitly initialize a new EMPTY production database")
                else:
                    if data_mode == "encrypted":
                        archive_arg = config.get("encrypted_archive")
                        if not archive_arg:
                            missing.append("encrypted_archive: existing .tar.age file on Ubuntu")
                            snapshot = None
                        else:
                            archive = _path(archive_arg, "encrypted_archive", file=True)
                            match = re.fullmatch(
                                r"asa-lab-(\d{8}T\d{6}Z-[a-f0-9]{8})\.tar\.age",
                                archive.name)
                            if not match:
                                raise SetupBlocked("Encrypted archive must have the canonical ASA name")
                            snapshot = match.group(1)
                            if files and not archive.is_file():
                                missing.append("encrypted_archive: archive file is missing")
                        sid = config.get("restore_snapshot") or snapshot
                        if snapshot and sid != snapshot:
                            raise SetupBlocked("Snapshot identifier differs from archive filename")
                        if snapshot:
                            restore = Path("/srv/asa-restore") / snapshot
                            if files and restore.exists():
                                missing.append("extraction: approved private output already exists; no overwrite")
                            age_binary = shutil.which("age") if files else "/usr/bin/age"
                            identity_path = os.environ.get("ASA_AGE_IDENTITY_FILE")
                            if files and not age_binary:
                                missing.append("age: install the trusted age CLI on Ubuntu")
                            if not identity_path or (files and not Path(identity_path).is_file()):
                                missing.append("ASA_AGE_IDENTITY_FILE: point to an approved, protected identity file")
                            preparation = {"archive": str(archive), "output": str(restore)}
                            stages.append("Decrypt and verify encrypted archive in a private, new directory")
                    else:
                        sid = config.get("restore_snapshot")
                        backup = config.get("restore_backup")
                        if not backup:
                            missing.append("restore_backup: verified extracted ASA backup directory")
                        else:
                            restore = _path(backup, "restore_backup")
                            if files and not (restore / "manifest.json").is_file():
                                missing.append("restore_backup: directory must contain a verified manifest.json")
                    if data_mode != "encrypted" and (
                            not isinstance(sid, str) or not SNAPSHOT.fullmatch(sid)):
                        missing.append("restore_snapshot: exact approved snapshot identifier")
                    if data_mode == "encrypted" and not sid:
                        missing.append("restore_snapshot: canonical encrypted backup name")
                    if data_mode == "encrypted" and snapshot:
                        argv.extend(["--require-restore", "--restore-backup", str(restore)])
                    elif data_mode == "restore" and backup:
                        argv.extend(["--require-restore", "--restore-backup", str(restore)])
                    if sid:
                        argv.extend(["--restore-snapshot", str(sid)])
                    hostname = config.get("target_hostname") or facts.get("hostname")
                    if not hostname or not SNAPSHOT.fullmatch(str(hostname)):
                        missing.append("target_hostname: exact Ubuntu hostname")
                    else:
                        argv.extend(["--target-hostname", str(hostname)])
                    for key, limit in (("max_snapshot_age_hours", 8760),
                                       ("min_active_students", 10000000),
                                       ("min_seats", 10000000)):
                        argv.extend(["--"+key.replace("_", "-"),
                                     str(_number(config, key, 0, limit))])
                    stages.append("Verify source data and restore PostgreSQL, MinIO and keys with rollback")
            elif data_mode in ("restore", "encrypted"):
                raise SetupBlocked("This wizard permits school-data restore only for production")
        if https:
            argv.append("--school-lan-https")
        stages.extend(["Install/verify Docker and 1Panel with canonical manager",
                       "Validate ASA release and schema"])
    if action == "school-lan":
        stages.append("Reconcile existing school HTTPS without touching data volumes")
    if action in ("install", "school-lan") and https:
        if interface != "auto":
            argv.extend(["--school-lan-interface", interface])
        if follow:
            argv.append("--school-lan-follow-interface")
        stages.append("Verify HTTPS origin and generate public Windows client kit")
    if action in ("verify-backup", "restore-check"):
        backup = config.get("backup_dir")
        if not backup:
            missing.append("backup_dir: extracted complete backup directory")
        else:
            selected = _path(backup, "backup_dir")
            if files and not (selected / "manifest.json").is_file():
                missing.append("backup_dir: missing manifest.json")
            argv.extend(["--backup-dir", str(selected)])
    if action == "restore-check":
        database = config.get("database", "asalab_bootstrap_test")
        if not isinstance(database, str) or not DATABASE.fullmatch(database):
            raise SetupBlocked("Disposable restore-check database must end with _test")
        argv.extend(["--database", database])
        stages.append("Isolated restore rehearsal; active database remains intact")
    if action in ("doctor", "backup", "verify-backup", "update"):
        stages.append("Run canonical ASA lifecycle manager")
    if facts.get("platform") != "linux":
        missing.append("host: Ubuntu Linux is required for this 1Panel bootstrap")
    return {
        "schema_version": SCHEMA, "action": action, "root": str(root),
        "profile": profile, "installed_release_detected": installed,
        "ready": not missing, "required_input": missing, "stages": stages,
        "command": argv, "will_modify_live_data": bool(
            action == "install" and not installed and profile == "production"
            and data_mode == "restore"),
        "needs_windows_ca_trust": bool(https),
        "cloud_oauth_ready": False, "preparation": preparation,
        "acceptance": "Browser login and project save/reopen still require real acceptance",
    }


class Prompt:
    def __init__(self, *, graphical: bool):
        self.root = None
        self.whiptail = bool(not graphical and sys.stdin.isatty()
                             and shutil.which("whiptail"))
        if graphical:
            import tkinter as tk
            self.tk = tk
            from tkinter import simpledialog, messagebox, filedialog
            self.simpledialog, self.messagebox, self.filedialog = (
                simpledialog, messagebox, filedialog)
            self.root = tk.Tk()
            self.root.withdraw()

    def ask(self, label: str, default: str = "", *, folder: bool = False) -> str:
        if self.root is not None:
            if folder:
                result = self.filedialog.askdirectory(title=label)
            else:
                result = self.simpledialog.askstring("ASA Lab: установка", label,
                                                     initialvalue=default,
                                                     parent=self.root)
            if result is None:
                raise SetupBlocked("Setup cancelled by operator")
            return result.strip()
        if not sys.stdin.isatty():
            raise SetupBlocked("No terminal: use --plan/--execute --answers with a JSON file")
        if self.whiptail:
            dialog = subprocess.run(["whiptail", "--title", "ASA Lab",
                "--output-fd", "1", "--inputbox", label, "13", "78", default],
                capture_output=True, text=True, check=False)
            if dialog.returncode != 0:
                raise SetupBlocked("Setup cancelled by operator")
            return dialog.stdout.strip() or default
        result = input(f"{label} [{default}]: ").strip()
        return result or default

    def yes(self, label: str, default: bool = False) -> bool:
        if self.root is not None:
            return bool(self.messagebox.askyesno("ASA Lab", label, parent=self.root))
        if self.whiptail:
            result = subprocess.run(["whiptail", "--title", "ASA Lab",
                                     "--yesno", label, "13", "78"],
                                    check=False)
            return result.returncode == 0
        response = self.ask(label + " (да/нет)", "да" if default else "нет")
        return response.casefold() in ("да", "д", "yes", "y")

    def message(self, label: str) -> None:
        if self.root is not None:
            self.messagebox.showinfo("ASA Lab", label, parent=self.root)
        else:
            print(label)

    def close(self):
        if self.root is not None:
            self.root.destroy()


def interactive_answers(facts: dict, prompt: Prompt) -> dict:
    choice = prompt.ask("Действие: 1 - новая установка; 2 - школьный HTTPS; "
                        "3 - диагностика; 4 - backup", "1")
    action = {"1": "install", "2": "school-lan", "3": "doctor", "4": "backup"}.get(choice)
    if action is None:
        raise SetupBlocked("Unknown action")
    data = {"schema_version": 1, "action": action,
            "root": prompt.ask("Каталог ASA Lab на Ubuntu", "/srv/asa-lab"),
            "profile": "production",
            "operator": prompt.ask("Системный пользователь Ubuntu",
                                   facts.get("operator") or "admins")}
    if action == "install":
        source = facts.get("ssh_client")
        suggest = f"{source}/32" if source and ":" not in source else ""
        data["admin_cidr"] = prompt.ask("Разрешённая сеть администратора CIDR "
                                         "(для удалённого SSH обычно /32)", suggest)
        data["panel_port"] = int(prompt.ask("TCP-порт панели 1Panel", "19192"))
        if not (Path(data["root"]) / ".asa/installed-release.json").is_file():
            use_restore = prompt.yes("Восстановить существующих учеников и проекты "
                                     "из резервной копии?", True)
            if use_restore:
                encrypted = prompt.yes("Копия зашифрована в формате .tar.age?", False)
                if encrypted:
                    data["data_mode"] = "encrypted"
                    data["encrypted_archive"] = prompt.file(
                        "Выберите зашифрованный ASA .tar.age архив, доступный НА ЭТОМ сервере")
                    os.environ["ASA_AGE_IDENTITY_FILE"] = prompt.file(
                        "Выберите закрытый age identity файл. Он НЕ сохраняется в JSON")
                else:
                    data["data_mode"] = "restore"
                    data["restore_backup"] = prompt.ask(
                        "Папка распакованной ПРОВЕРЕННОЙ копии", folder=True)
                    data["restore_snapshot"] = prompt.ask(
                        "Идентификатор снимка из имени архива")
                data["target_hostname"] = facts["hostname"]
            else:
                phrase = prompt.ask("Для новой ПУСТОЙ школы введите ровно: ПУСТАЯ ШКОЛА")
                data["data_mode"] = "empty"
                data["fresh_empty_confirmed"] = (phrase == "ПУСТАЯ ШКОЛА")
    if action in ("install", "school-lan"):
        data["school_lan_https"] = True
        data["school_lan_interface"] = prompt.ask(
            "Физический интерфейс школьной сети (auto при однозначном выборе)", "auto")
        data["school_lan_follow_interface"] = prompt.yes(
            "Автоматически следовать смене частного IP на ЭТОМ интерфейсе?", False)
    return data


def execute(plan: dict, *, graphical: bool = False) -> int:
    if not plan["ready"]:
        raise SetupBlocked("Missing required decisions: " + "; ".join(plan["required_input"]))
    if plan.get("preparation"):
        details = plan["preparation"]
        age_path = os.environ.get("ASA_AGE_IDENTITY_FILE", "")
        age_binary = shutil.which("age")
        if not age_binary or not age_path or not Path(age_path).is_file():
            raise SetupBlocked("Age CLI and private identity file are required before recovery")
        if Path(details["output"]).exists():
            raise SetupBlocked("Private extraction folder already exists; will not overwrite")
        helper = Path(__file__).resolve().parent / "prepare-age-backup.py"
        if not helper.is_file():
            raise SetupBlocked("Same-revision age verification helper is missing")
        stage = [sys.executable, str(helper), "--archive", details["archive"],
                 "--age", age_binary, "--identity", age_path,
                 "--extract", "--output", details["output"]]
        if os.geteuid() != 0:
            if graphical and shutil.which("pkexec"):
                stage = ["pkexec", *stage]
            elif shutil.which("sudo"):
                stage = ["sudo", *stage]
            else:
                raise SetupBlocked("Root permission required for protected backup extraction")
        if subprocess.run(stage, check=False).returncode != 0:
            raise SetupBlocked("Encrypted backup verification/extraction failed; install not started")
    if os.geteuid() != 0:
        if graphical:
            if not shutil.which("pkexec"):
                raise SetupBlocked("Graphical Ubuntu needs pkexec to request administrator permission")
            command = ["pkexec", *plan["command"]]
        else:
            if not shutil.which("sudo"):
                raise SetupBlocked("Use sudo or run as root on Ubuntu")
            command = ["sudo", *plan["command"]]
    else:
        command = plan["command"]
    # No shell=True; neither credentials nor OAuth tokens are passed as CLI args.
    return subprocess.run(command, check=False).returncode


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("inspect", "plan", "execute", "wizard"))
    parser.add_argument("--answers", type=Path, help="JSON decisions, NO passwords/tokens")
    parser.add_argument("--approve", action="store_true",
                        help="Explicit agent approval to execute the planned operation")
    parser.add_argument("--ui", choices=("auto", "gui", "terminal"), default="auto")
    arguments = parser.parse_args(argv)
    try:
        facts = host_facts()
        if arguments.operation == "inspect":
            print(json.dumps({"schema_version": SCHEMA, "facts": facts,
                "supported_actions": sorted(ACTIONS),
                "bot_protocol": "plan --answers FILE; execute --answers FILE --approve",
                "secrets_policy": "No credentials or OAuth tokens in answers, CLI or logs",
                "restore_input": "Verified EXTRACTED directory or local encrypted .tar.age; direct cloud OAuth not yet available"},
                ensure_ascii=False, indent=2))
            return 0
        if arguments.operation == "wizard":
            if arguments.answers:
                raise SetupBlocked("Wizard asks the person; do not combine with --answers")
            graphical = arguments.ui == "gui" or (
                arguments.ui == "auto" and facts["gui_available"])
            try:
                ui = Prompt(graphical=graphical)
            except ImportError as exc:
                if arguments.ui == "gui":
                    raise SetupBlocked("Tkinter GUI is unavailable on this host") from exc
                graphical = False
                ui = Prompt(graphical=False)
            try:
                data = interactive_answers(facts, ui)
                plan = build_plan(data, facts=facts)
                if not plan["ready"]:
                    raise SetupBlocked("; ".join(plan["required_input"]))
                stages = "\n".join(f"- {step}" for step in plan["stages"])
                if not ui.yes("Проверены выбранные данные. Выполнить?\n" + stages):
                    ui.message("Отменено, сервер и данные не изменялись")
                    return 0
            finally:
                ui.close()
            return execute(plan, graphical=graphical)
        if arguments.answers is None or not arguments.answers.is_file():
            raise SetupBlocked("Use --answers with a readable JSON file")
        with arguments.answers.open(encoding="utf-8") as stream:
            data = json.load(stream)
        plan = build_plan(data, facts=facts)
        print(json.dumps(plan, ensure_ascii=False, indent=2), flush=True)
        if arguments.operation == "plan":
            return 0
        if not arguments.approve:
            raise SetupBlocked("Execution requires --approve; plan never modifies the host")
        return execute(plan)
    except (SetupBlocked, OSError, json.JSONDecodeError, ValueError) as error:
        print("ASA_SETUP_BLOCKED: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

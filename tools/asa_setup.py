#!/usr/bin/env python3
"""One operator CLI for install, update, backup and truthful acceptance."""

import argparse
import copy
import datetime as dt
import json
import io
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid
from contextlib import redirect_stdout

sys.dont_write_bytecode = True
# The root-owned launcher invokes Python -I; only this verified tools directory
# is added. No cwd, PYTHONPATH or user site module chooses deployment code.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from deployment import backup_schedule, backup_workflow, collector, setup_acceptance, setup_discovery, setup_host
from deployment.contracts import Blocked, require, validate_release
from deployment.setup_config import load_config, prepare_config, prepare_onboarding, private_json, read_installed_release, replace_legacy_manager_state, save_private, validate_config
from deployment.setup_operation import Engine, Runtime, Store, bootstrap_observation, bootstrap_record, inventory_key
from deployment.setup_result import finalize, render, result
from deployment.system import Installation, operation_lock

SETUP_PROTOCOL = 1
READ_ONLY = {"status", "check", "doctor", "diagnose", "restore-plan"}


def parser():
    value = argparse.ArgumentParser(description="ASA Lab: установка, update, backup и проверяемая приёмка")
    value.add_argument("command", nargs="?", default="auto", choices=("auto", "check", "status", "resume", "backup",
        "retry-cloud", "cloud-retry", "configure", "cloud-configure", "schedule", "doctor", "diagnose", "repair-collector", "restore-plan", "acceptance"))
    value.add_argument("--root", type=Path, default=Path.cwd())
    value.add_argument("--config-file", "--config", type=Path)
    value.add_argument("--operation-id")
    value.add_argument("--snapshot-id")
    value.add_argument("--non-interactive", action="store_true")
    value.add_argument("--scheduled", action="store_true")
    value.add_argument("--schedule-budget-check", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--check", action="store_true")
    value.add_argument("--json", action="store_true")
    value.add_argument("--defer-report", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--render-last", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--render-action", choices=("schedule", "repair-collector"), help=argparse.SUPPRESS)
    value.add_argument("--root-action", choices=("schedule", "repair-collector"), help=argparse.SUPPRESS)
    value.add_argument("--collector-user-action", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--lock-fd", type=int, help=argparse.SUPPRESS)
    return value


def _reason(discovery):
    reason = discovery.get("reasons", [{}])[0]
    raise Blocked(reason.get("code", "DISCOVERY"), reason.get("message", "Установка не подтверждена."),
                  reason.get("action", "Проверьте Docker, владельца и исходный каталог; данные не удалять."))


def validate_fresh_selection(root, config, inventory):
    require(not (root / ".env").exists() and not (root / ".asa/setup.json").exists(),
            "FRESH_CHANGED", "В новом каталоге появились чужие настройки.")
    selected = setup_discovery.classify_installation(root, inventory, project=config["project"])
    if selected["state"] != "FRESH":
        _reason(selected)
    return selected


def _observe(args, config, discovery):
    operation_id = uuid.uuid4().hex
    value = result(operation_id, config.get("installationId") if config else None, args.command,
                   outcome="STATUS", code=2, data={"status": discovery["state"], "identity": discovery.get("dataIdentity")})
    value["discovery"] = discovery
    value["dependencies"] = {"status": "OBSERVED", "host": setup_host.system_state(), "tools": setup_host.inspect_dependencies()}
    if args.command == "restore-plan":
        value["backup"] = {"restore": setup_acceptance.restore_status(operation_id, args.snapshot_id), "status": "BLOCKED_PLAN"}
        value.update(outcome="PLANNED", reasonCode="BLOCKED_PLAN", nextAction="Для реального архива нужен отдельный утверждённый P1-R3A restore-план; decrypt и restore запрещены.")
        return value
    if not config or discovery["state"] not in ("MANAGED", "LEGACY", "STOPPED", "INTERRUPTED"):
        value["nextAction"] = discovery["reasons"][0]["action"]
        return value
    if not (args.root / ".env").exists():
        value["nextAction"] = "Продолжите первичную настройку: resume --operation-id " + discovery.get("operationId", "<ID>")
        return value
    runtime = Runtime(args.root, config, json_output=args.json)
    installed = args.root / ".asa/installed-release.json"
    if installed.exists():
        release = read_installed_release(args.root)
        value["version"] = {"status": "RECORDED", "selected": release["revision"]}
        technical = setup_acceptance.technical_acceptance(runtime.install, release, operation_id)
        value["site"] = {"url": config["entryOrigin"], "status": "TECHNICAL_ONLY", "technical": technical,
                         "browser": {"status": "not_run", "reasonCode": "READ_ONLY"}}
        if technical["status"] == "passed":
            value["version"].update(status="RUNNING", running=release["revision"])
            value["exitCode"] = 0
    value["diagnostics"] = setup_acceptance.collector_observation(runtime.install, operation_id)
    pointer = args.root / ".asa/setup-backups/last-local-success.json"
    if pointer.exists():
        saved = private_json(pointer)
        receipt = backup_workflow.verify_receipt(runtime.install, snapshot_id=saved["snapshotId"], installation_id=config["installationId"])
        value["backup"] = {**receipt, "evidenceScope": "saved-snapshot-at-recorded-delivery-time"}
    value["backup"]["schedule"] = backup_schedule.schedule_status(args.root, config["installationId"], config.get("backup", {}).get("schedule", {}))
    value["backup"]["restore"] = {"status": "UNVERIFIED"}
    for label, name in (("lastAttempt", "setup-last-attempt.json"), ("lastSuccessful", "setup-last-successful.json")):
        path = args.root / ".asa" / name
        if path.exists():
            previous = private_json(path)
            value[label] = {key: previous.get(key) for key in ("operationId", "outcome", "observedAt", "applicationAccepted", "dataProtectionConfirmed")}
    if args.command == "check":
        selected = runtime.select()
        value["version"]["available"] = selected["revision"]
        value["outcome"] = "CHECKED"
    value["nextAction"] = "Можно проверить журнал последней попытки; status не запускает миграции, backup или браузерные изменения."
    return value


def _root_receipt(root, owner, value):
    """Publish a new owner-readable inode; never chown an existing user path."""
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    name = ".setup-root-" + uuid.uuid4().hex + ".tmp"
    try:
        for component in (root / ".asa").parts[1:]:
            next_directory = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_directory
        descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(descriptor, "wb") as stream:
            os.fchown(stream.fileno(), owner["uid"], owner["gid"])
            stream.write((json.dumps(value, ensure_ascii=True) + "\n").encode())
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, "setup-root-actions.json", src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        try:
            os.unlink(name, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)


def root_action(args):
    from asa_setup_launcher import verify_bundle
    require(os.geteuid() == 0, "ROOT_ACTION", "Системная регистрация выполняется через asa-setup.sh.")
    verify_bundle(Path(__file__).resolve().parents[1])
    owner = setup_host.check_owner(args.root)
    config = load_config(args.root, owner["uid"], policy=False)
    require(owner["uid"] == config["operatorUid"] != 0, "ROOT_ACTION_OWNER", "Не подтверждён владелец системной регистрации.")
    previous_path = args.root / ".asa/setup-last-attempt.json"
    previous = private_json(previous_path, owner=owner["uid"]) if previous_path.exists() else {}
    value = {"format": "asa-setup-root-actions-v1", "operationId": previous.get("operationId") or uuid.uuid4().hex,
             "installationId": config["installationId"], "kind": args.root_action, "status": "FAILED"}
    with operation_lock(args.root, operator_uid=owner["uid"]) as descriptor:
        # All inputs and modules are from the attested bundle. Only saved
        # settings and this installation's deterministic units are consumed.
        try:
            discovery = setup_discovery.classify_installation(args.root, setup_discovery.docker_inventory(),
                project=config["project"], saved_identity=config.get("dataIdentity"))
            require(discovery["state"] in ("MANAGED", "LEGACY", "STOPPED"), "ROOT_ACTION_IDENTITY",
                    "Перед системной регистрацией не подтверждены исходные ресурсы установки.")
            if args.root_action == "schedule":
                value["schedule"] = backup_schedule.install_schedule(args.root, config["installationId"], owner["name"],
                    config["backup"].get("schedule", {}), Path(__file__).resolve())
            else:
                os.environ["SUDO_USER"] = owner["name"]  # derived from ownership proof
                install = Installation(args.root, config["profile"])
                install.identity()
                registration = args.root / ".asa/collector-runner.json"
                previous_runner = private_json(registration, owner=owner["uid"]) if registration.exists() else {}
                if previous_runner.get("mode") == "user":
                    value["collector"] = user_collector_child(args.root, owner, descriptor, value["operationId"])
                else:
                    collector.prepare(install)
                    collector.reconcile(install)
                    value["collector"] = setup_acceptance.collector_observation(install, uuid.uuid4().hex)
                require(value["collector"]["status"] == "passed", "COLLECTOR_UNVERIFIED", "Свежий цикл и процесс collector пока не подтверждены.")
            value["status"] = "OK"
        except (Blocked, OSError, ValueError) as error:
            value["reasonCode"] = getattr(error, "code", type(error).__name__)
        _root_receipt(args.root, owner, value)
    print(json.dumps(value, ensure_ascii=True))
    return 0 if value["status"] == "OK" else 2


def user_collector_child(root, owner, lock_fd, operation_id):
    """Maintain an existing user service through its verified user's own bus."""
    from asa_setup_launcher import operator_environment
    from deployment.paths import plain_paths
    runtime = Path("/run/user") / str(owner["uid"])
    plain_paths(runtime, ("bus",))
    require(runtime.is_dir() and runtime.stat().st_uid == owner["uid"] and not runtime.stat().st_mode & 0o077
            and (runtime / "bus").exists() and stat.S_ISSOCK((runtime / "bus").stat().st_mode)
            and (runtime / "bus").stat().st_uid == owner["uid"], "COLLECTOR_USER_BUS",
            "Проверенный systemd user bus оператора недоступен.", "Откройте действующую сессию оператора и повторите repair-collector; системный сервис вместо пользовательского не создаётся.")
    environment = operator_environment(owner)
    environment.update(XDG_RUNTIME_DIR=str(runtime), DBUS_SESSION_BUS_ADDRESS="unix:path=" + str(runtime / "bus"))
    completed = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--collector-user-action",
        "--root", str(root), "--operation-id", operation_id, "--lock-fd", str(lock_fd)],
        cwd=root, env=environment, user=owner["uid"], group=owner["gid"],
        extra_groups=os.getgrouplist(owner["name"], owner["gid"]), pass_fds=(lock_fd,),
        capture_output=True, encoding="utf-8", timeout=120, check=False)
    require(completed.returncode == 0 and len(completed.stdout) <= 65536, "COLLECTOR_USER_REPAIR", "Пользовательский collector не подтвердил готовность.")
    report = json.loads(completed.stdout)
    require(report.get("format") == "asa-setup-acceptance-v1" and report.get("kind") == "collector"
            and report.get("operationId") == operation_id and report.get("status") == "passed",
            "COLLECTOR_USER_REPAIR", "Ответ пользовательского collector не совпадает с операцией.")
    return report


def collector_user_action(args, config):
    require(args.operation_id and args.lock_fd is not None, "COLLECTOR_USER_REPAIR", "Для user repair нужен проверенный handoff.")
    with operation_lock(args.root, inherited_fd=args.lock_fd):
        install = Installation(args.root, config["profile"])
        registration = private_json(args.root / ".asa/collector-runner.json")
        require(registration.get("mode") == "user", "COLLECTOR_RUNNER_MODE", "Установка не использует пользовательский collector.")
        install.identity()
        with redirect_stdout(io.StringIO()):
            collector.prepare(install)
            collector.reconcile(install)
        report = setup_acceptance.collector_observation(install, args.operation_id)
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report["status"] == "passed" else 2


def render_last(args, config):
    with operation_lock(args.root):
        path = args.root / ".asa/setup-last-attempt.json"
        if args.render_action:
            action = private_json(args.root / ".asa/setup-root-actions.json")
            require(action.get("format") == "asa-setup-root-actions-v1" and action.get("installationId") == config["installationId"]
                    and action.get("kind") == args.render_action, "ROOT_ACTION_IDENTITY", "Результат системного действия не принадлежит этой установке.")
            store = Store(args.root, config["installationId"])
            journal = store.create(args.render_action, config["project"])
            output = result(journal["operationId"], config["installationId"], args.render_action,
                outcome="ACCEPTED" if action["status"] == "OK" else "BLOCKED", code=0 if action["status"] == "OK" else 2,
                actionExecuted=True, executionCompleted=action["status"] == "OK", rootActions=action,
                nextAction="Можно работать." if action["status"] == "OK" else "Проверьте указанный системный сервис через doctor.")
            if args.render_action == "schedule":
                output["backup"] = {"status": action["status"], "schedule": action.get("schedule", {}), "restore": {"status": "UNVERIFIED"}}
            else:
                output["diagnostics"] = action.get("collector", {"status": "warning", "reasonCode": action.get("reasonCode")})
            store.finish(journal, output)
            render(output, as_json=args.json)
            return output["exitCode"]
        value = private_json(path)
        require(value.get("installationId") == config["installationId"], "RESULT_IDENTITY", "Отчёт относится к другой установке.")
        receipt_path = args.root / ".asa/setup-root-actions.json"
        if receipt_path.exists():
            receipt = private_json(receipt_path)
            if receipt.get("operationId") == value["operationId"] and receipt.get("installationId") == config["installationId"]:
                value["rootActions"] = receipt
        if value.get("postActions"):
            value["backup"]["schedule"] = backup_schedule.schedule_status(args.root, config["installationId"], config["backup"].get("schedule", {}))
            finalize(value)
        save_private(path, value)
        if value.get("applicationAccepted") and value["exitCode"] == 0:
            save_private(args.root / ".asa/setup-last-successful.json", value)
        operation_path = args.root / ".asa/setup-operations" / (value["operationId"] + ".json")
        if operation_path.exists():
            store = Store(args.root, config["installationId"])
            journal = store.read(value["operationId"])
            if journal["mode"] == "install" and journal["phase"] == "configured":
                journal["result"] = value
                store.save(journal)
            else:
                store.finish(journal, value)
    render(value, as_json=args.json)
    return value["exitCode"]


def _new_snapshot_id():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]


def _snapshot_pin(journal, supplied):
    stage = journal.get("stages", {}).get("cloud_delivery", {})
    pinned = journal.get("snapshotId") or stage.get("snapshotId") or stage.get("evidence", {}).get("snapshotId")
    require(not (pinned and supplied and pinned != supplied), "BACKUP_IDENTITY", "Snapshot ID операции уже закреплён.")
    pinned = pinned or supplied
    require(isinstance(pinned, str) and backup_workflow.SNAPSHOT.fullmatch(pinned), "SNAPSHOT_REQUIRED", "Для доставки нужен прежний snapshot ID.")
    return pinned


def _route_auxiliary_resume(args, store, pending):
    if args.command == "resume" and store:
        requested = store.read(args.operation_id) if args.operation_id else pending
        if requested and requested["mode"] in ("backup", "retry-cloud"):
            args.command = requested["mode"]
            args.operation_id = requested["operationId"]


def _auxiliary_journal(args, config, runtime, store, pending):
    command, operation_id = args.command, args.operation_id
    if args.scheduled:
        require(command == "backup", "SCHEDULE_COMMAND", "Scheduled разрешён только для backup.")
        operation_id = getattr(args, "scheduled_operation_id", None) or backup_schedule.scheduled_operation_id(config["installationId"], config["backup"].get("schedule", {}))
    requested = store.read(operation_id) if operation_id and store.path(operation_id).exists() else None
    parent = None
    if requested and requested.get("parentOperationId"):
        parent = store.read(requested["parentOperationId"])
        store.validate_child(requested, parent)
        require(pending and pending["operationId"] == parent["operationId"], "DEPENDENT_PARENT_STATE", "Для продолжения нужен незавершённый родительский журнал.")
    elif requested and requested["mode"] in ("install", "update"):
        parent, requested = requested, None
        require(pending and pending["operationId"] == parent["operationId"], "DEPENDENT_PARENT_STATE", "Родительская операция уже завершена; используйте отдельную команду backup или retry-cloud.")
    elif pending and pending["mode"] in ("install", "update") and not requested:
        require(operation_id is None, "OPERATION_PENDING", "Новый top-level журнал нельзя создавать при незавершённой установке.")
        parent = pending
    elif pending:
        require((requested and pending["operationId"] == requested["operationId"])
                or (not requested and operation_id in (None, pending["operationId"]) and pending["mode"] == command),
                "OPERATION_PENDING", "Есть незавершённая операция.", "Выполните resume --operation-id " + pending["operationId"] + ".")
        requested = requested or pending
    if requested:
        require(requested["mode"] == command, "OPERATION_MODE", "Операция относится к другой команде.")
        return requested, parent
    if parent:
        require(command == "retry-cloud" or (command == "backup" and not args.scheduled and parent["mode"] == "install"),
                "OPERATION_PENDING", "При незавершённой установке разрешены только её доставка или новая первая копия.",
                "Выполните resume --operation-id " + parent["operationId"] + ".")
        children = store.children(parent)
        active = [child for child in children if child["state"] in ("RUNNING", "VERIFY_ONLY", "RECOVERY_REQUIRED")]
        if active:
            require(active[0]["mode"] == command, "DEPENDENT_PENDING", "Сначала завершите другое зависимое действие.",
                    "Выполните resume --operation-id " + active[0]["operationId"] + ".")
            return active[0], parent
        if command == "retry-cloud":
            require(args.snapshot_id, "SNAPSHOT_REQUIRED", "Для доставки нужен прежний snapshot ID.")
            matching = [child for child in children if child["mode"] == command and child["snapshotId"] == args.snapshot_id]
            if matching:
                return max(matching, key=lambda child: child["startedAt"]), parent
            saved = backup_workflow.verify_receipt(runtime.install, snapshot_id=args.snapshot_id, installation_id=config["installationId"])
            source = saved["operationId"]
            require(source == parent["operationId"] or any(child["operationId"] == source and child["mode"] == "backup"
                    and child["snapshotId"] == args.snapshot_id for child in children),
                    "DEPENDENT_SOURCE", "Этот снимок не принадлежит родительской операции или её первой копии.")
            return store.create_child(parent, command, snapshot_id=args.snapshot_id, source_operation_id=source), parent
        require(parent.get("stages", {}).get("switch", {}).get("status") == "done" and parent["stages"].get("first_backup"),
                "FIRST_BACKUP_STAGE", "Новая первая копия разрешена только после подтверждённого переключения и прерванного backup.")
        # A kill after receipt completion but before parent adoption must reuse
        # that exact child, not start a second export with another snapshot.
        unadopted = [child for child in children if child["mode"] == "backup"
                     and child.get("stages", {}).get("backup", {}).get("evidence", {}).get("local", {}).get("status") == "OK"
                     and parent["stages"]["first_backup"].get("backupOperationId") != child["operationId"]]
        if unadopted:
            return max(unadopted, key=lambda child: child["startedAt"]), parent
        store.event(parent, "recover_first_backup", "intent")
        recovered = runtime.recover_acceptance_backup(parent)
        store.event(parent, "recover_first_backup", "done", evidence=recovered)
        technical = runtime.technical(parent)
        require(technical["status"] == "passed", "FIRST_BACKUP_RUNTIME", "Runtime установки не подтверждён; новая копия не запускается.")
        previous = runtime.incomplete_first_backup(parent, store.backup_context(parent))
        return store.create_child(parent, command, snapshot_id=_new_snapshot_id(), replaces_snapshot_id=previous), parent
    return store.create(command, config["project"], operation_id=operation_id), None


def _auxiliary(args, config, runtime, store, pending):
    command = args.command
    if command in ("schedule", "repair-collector"):
        raise Blocked("ROOT_ACTION_REQUIRED", "Нужна системная регистрация этой установки.", "Выполните sudo bash asa-setup.sh " + command + " --root " + str(args.root))
    journal, parent = _auxiliary_journal(args, config, runtime, store, pending)
    if parent:
        others = [child for child in store.children(parent, active=True) if child["operationId"] != journal["operationId"]]
        require(not others, "DEPENDENT_PENDING", "Сначала завершите активное зависимое действие.",
                "Выполните resume --operation-id " + others[0]["operationId"] + "." if others else "")
    journal["state"] = "RUNNING"
    store.save(journal)
    runtime.operation_id = journal["operationId"]
    output = result(journal["operationId"], config["installationId"], command)
    if parent:
        output["parentOperationId"] = parent["operationId"]
    try:
        runtime.identity()
        if command == "backup":
            store.event(journal, "backup_recovery", "intent")
            recovered = runtime.recover_owned_backup(journal)
            store.event(journal, "backup_recovery", "done", evidence=recovered)
            current = runtime.current()
            require(not journal.get("backupRuntime") or journal["backupRuntime"] == current,
                    "BACKUP_RUNTIME_CHANGED", "Runtime изменился после начала резервирования; повторный export запрещён.")
            if parent:
                require(runtime.technical(parent)["status"] == "passed", "FIRST_BACKUP_RUNTIME", "Runtime родительской установки не подтверждён.")
            journal.setdefault("backupRuntime", current)
            journal.setdefault("backupPolicy", copy.deepcopy(config["backup"]))
            if not journal.get("snapshotId"):
                journal["snapshotId"] = runtime.known_backup_snapshot(journal) if journal["stages"].get("backup") else _new_snapshot_id()
            require(not args.snapshot_id or args.snapshot_id == journal["snapshotId"], "BACKUP_IDENTITY", "Snapshot ID операции уже закреплён.")
            store.save(journal)
            runtime.preflight()
            runtime.estimate()
            runtime.backup_preflight()
            if journal["stages"].get("backup"):
                store.event(journal, "backup_continuation", "intent", snapshotId=journal["snapshotId"])
                receipt = runtime.resume_saved_backup(journal, journal["snapshotId"])
                store.event(journal, "backup_continuation", "done", evidence=receipt)
            else:
                store.event(journal, "backup", "intent", snapshotId=journal["snapshotId"])
                receipt = runtime.backup(journal, hold=False, snapshot_id=journal["snapshotId"])
            store.event(journal, "backup", "done", evidence=receipt)
            if parent and receipt.get("local", {}).get("status") == "OK":
                receipt = runtime.verified_child_backup(parent, journal)
                previous = parent["stages"]["first_backup"]
                if previous.get("backupOperationId") != journal["operationId"]:
                    parent.setdefault("firstBackupHistory", []).append(copy.deepcopy(previous))
                store.event(parent, "first_backup", "done", evidence=receipt, backupOperationId=journal["operationId"])
                store.event(journal, "parent_receipt", "done", snapshotId=receipt["snapshotId"], parentOperationId=parent["operationId"])
        elif command in ("retry-cloud", "cloud-retry"):
            journal["snapshotId"] = _snapshot_pin(journal, args.snapshot_id)
            journal.setdefault("backupPolicy", copy.deepcopy(config["backup"]))
            store.event(journal, "cloud_delivery", "intent", snapshotId=journal["snapshotId"])
            saved = backup_workflow.verify_receipt(runtime.install, snapshot_id=journal["snapshotId"], installation_id=config["installationId"])
            if parent:
                require(saved["operationId"] == journal["parentBinding"]["sourceOperationId"], "DEPENDENT_SOURCE", "Квитанция принадлежит другой исходной операции.")
            receipt = backup_workflow.retry_delivery(runtime.install, snapshot_id=journal["snapshotId"],
                installation_id=config["installationId"], policy=journal["backupPolicy"])
            store.event(journal, "cloud_delivery", "done", evidence=receipt)
        else:
            raise Blocked("COMMAND", "Неизвестная служебная операция.", "Проверьте --help.")
        output.update(actionExecuted=True, backup=receipt, outcome=receipt["outcome"],
                      executionCompleted=receipt["outcome"] in ("ACCEPTED", "WARNING"),
                      exitCode=0 if receipt["outcome"] in ("ACCEPTED", "WARNING") else 1 if receipt["outcome"] == "ERROR" else 2,
                      dataProtectionConfirmed=all(receipt.get(key, {}).get("status") == "OK" for key in ("local", "encryption", "cloud")),
                      nextAction="Проверьте дату и readback копии; восстановимость реального архива остаётся UNVERIFIED.")
        if parent:
            output["nextAction"] = "Выполните resume --operation-id " + parent["operationId"] + " для завершения приёмки установки."
            if receipt.get("local", {}).get("status") != "OK":
                output["nextAction"] = "Проверьте место и исходный incomplete snapshot, затем backup --operation-id " + parent["operationId"] + " для новой зависимой копии."
            elif receipt["outcome"] == "BLOCKED" and receipt.get("encryption", {}).get("status") == "OK":
                output["nextAction"] = "Выполните retry-cloud --snapshot-id " + receipt["snapshotId"] + ", затем resume --operation-id " + parent["operationId"] + "."
        elif command == "backup" and receipt.get("local", {}).get("status") != "OK":
            output["nextAction"] = "Проверьте место и сохранённый incomplete snapshot. Для новой копии выполните backup без прежнего operation ID."
        output["backup"]["schedule"] = backup_schedule.schedule_status(args.root, config["installationId"], config["backup"].get("schedule", {}))
        # Explicit retention settings are the sole authorization for deletion.
        if command == "backup" and output["exitCode"] == 0 and any(config["backup"].get("retention", {}).get(key) is not None for key in ("localKeep", "remoteKeep")):
            protected = [receipt["snapshotId"]]
            if pending:
                protected += [pending.get("stages", {}).get("backup", {}).get("evidence", {}).get("snapshotId")]
            store.event(journal, "retention", "intent")
            output["retention"] = backup_workflow.apply_retention(runtime.install, installation_id=config["installationId"],
                policy=config["backup"], protected_snapshot_ids=[item for item in protected if item])
            store.event(journal, "retention", "done")
    except KeyboardInterrupt:
        output.update(outcome="INTERRUPTED", exitCode=130, reasonCode="INTERRUPTED", nextAction="Выполните resume --operation-id " + journal["operationId"] + "; snapshot ID уже закреплён.")
    except (Blocked, OSError, ValueError, subprocess.SubprocessError) as error:
        output.update(outcome="BLOCKED" if isinstance(error, Blocked) else "ERROR", exitCode=2 if isinstance(error, Blocked) else 1,
                      reasonCode=getattr(error, "code", type(error).__name__), nextAction=error.action if isinstance(error, Blocked) else "Проверьте защищённый журнал операции.")
    return store.finish(journal, output)


def execute(args):
    args.root = args.root.absolute()
    if args.check:
        args.command = "check"
    args.command = {"cloud-retry": "retry-cloud", "diagnose": "doctor"}.get(args.command, args.command)
    if args.root_action:
        return root_action(args)
    require(os.geteuid() != 0, "BLOCKED_OWNER", "Для исполнения приложения нужен подтверждённый непривилегированный владелец.",
            "Запускайте asa-setup.sh из root-терминала; если прежняя установка принадлежит root, отдельно согласуйте переход владельца без массового chown.")
    owner = setup_host.check_owner(args.root, operator_uid=os.geteuid())
    config = load_config(args.root, owner["uid"], required=False, policy=False)
    orphan = bootstrap_record(args.root, owner["uid"]) if config is None else None
    if orphan:
        config = orphan["bootstrapConfig"]
    require(not args.schedule_budget_check or args.scheduled, "SCHEDULE_COMMAND", "Проверка бюджета разрешена только для scheduled backup.")
    if args.scheduled:
        require(args.command == "backup" and config is not None, "SCHEDULE_COMMAND", "Scheduled требует backup и сохранённую конфигурацию.")
        args.scheduled_operation_id = backup_schedule.scheduled_attempt(args.root, config["installationId"],
            config["backup"].get("schedule", {}), consume=not args.schedule_budget_check)
        if args.schedule_budget_check:
            return 0
    if args.collector_user_action:
        require(config, "CONFIG_MISSING", "Нет сохранённой конфигурации collector.")
        return collector_user_action(args, config)
    if args.render_last:
        require(config, "CONFIG_MISSING", "Нет сохранённой конфигурации.")
        return render_last(args, config)
    inventory = setup_discovery.docker_inventory()
    store = Store(args.root, config["installationId"]) if config else None
    pending = store.pending() if store else None
    _route_auxiliary_resume(args, store, pending)
    discovery = bootstrap_observation(args.root, inventory, orphan) if orphan else setup_discovery.classify_installation(args.root, inventory,
                project=config.get("project") if config else None, saved_identity=config.get("dataIdentity") if config else None, pending_operation=pending)
    if args.command in READ_ONLY:
        output = _observe(args, config, discovery)
        render(output, as_json=args.json)
        return output["exitCode"]
    if discovery["state"] not in ("FRESH", "MANAGED", "LEGACY", "STOPPED", "INTERRUPTED"):
        _reason(discovery)
    fresh = discovery["state"] == "FRESH" or bool(pending and pending["mode"] == "install")
    install = Installation(args.root, config["profile"] if config else None) if (args.root / ".env").exists() else None
    if args.command in ("configure", "cloud-configure"):
        require(not pending or pending["phase"] == "configured", "OPERATION_PENDING", "Нельзя изменить политику незавершённой операции.")
    config = prepare_config(args.root, owner["uid"], previous=config, supplied=args.config_file, install=install,
                            fresh=fresh, non_interactive=args.non_interactive,
                            reconfigure=args.command in ("configure", "cloud-configure"))
    if install:
        require(config["project"] == install.project and config["profile"] == install.profile
                and config["entryOrigin"] == install.env.get("ASA_UPDATE_ENTRY_ORIGIN"),
                "CONFIG_RUNTIME_DRIFT", "Сохранённые project, профиль или адрес не совпадают с runtime.",
                "Изменение адреса и профиля требует отдельного проверенного перехода; auto сохраняет текущую установку.")
        require(not install.settings.get("instanceId") or install.settings["instanceId"] == config["installationId"],
                "CONFIG_IDENTITY", "Installation ID не совпадает с прежними метаданными.")
    if pending and pending.get("backupPolicy"):
        old_policy = pending["backupPolicy"]
        require(config["backup"]["policy"] == old_policy["policy"]
                and config["backup"].get("ageRecipient") == old_policy.get("ageRecipient")
                and config["backup"].get("cloud", {}).get("enabled") == old_policy.get("cloud", {}).get("enabled"),
                "BACKUP_POLICY_CHANGED", "Политику и recipient незавершённой операции нельзя заменять.")
    onboarding = prepare_onboarding(config, non_interactive=args.non_interactive) if fresh and args.command in ("auto", "resume", "acceptance", "configure", "cloud-configure") and not (pending and pending.get("stages", {}).get("owner_grant", {}).get("status") == "done") else None
    with operation_lock(args.root, inherited_fd=args.lock_fd) as lock_fd:
        # An unknown resource created during prompting invalidates FRESH. The
        # own lock file is expected; Docker inventory must remain identical.
        observed = setup_discovery.docker_inventory()
        require(inventory_key(observed) == inventory_key(inventory), "DISCOVERY_CHANGED", "Ресурсы изменились во время подготовки.", "Повторите check; новая операция не запущена.")
        if discovery["state"] == "FRESH":
            validate_fresh_selection(args.root, config, observed)
        if discovery.get("dataIdentity"):
            require(not config.get("dataIdentity") or config["dataIdentity"] == discovery["dataIdentity"],
                    "DATA_IDENTITY_CHANGED", "Сохранённые хранилища отличаются от Docker.")
            config["dataIdentity"] = discovery["dataIdentity"]
        if install:
            install.identity()
            if not install.settings.get("instanceId"):
                # Adoption binds proved existing resources; it does not reset
                # .env, initialize a database, create backups or change images.
                replace_legacy_manager_state(args.root, "installation.json", {**install.settings, "format": "asa-installation-v1",
                    "instanceId": config["installationId"], "profile": install.profile, "project": install.project})
        store = Store(args.root, config["installationId"])
        if fresh and not pending and args.command in ("auto", "configure", "cloud-configure"):
            pending = store.create("install", config["project"], bootstrap={"config": config, "inventory": observed})
        if orphan:
            bootstrap_observation(args.root, observed, orphan)
        save_private(args.root / ".asa/setup.json", config)
        if onboarding:
            save_private(Path(config.get("onboardingFile", args.root / ".asa/onboarding.json")), onboarding)
        store = Store(args.root, config["installationId"])
        runtime = Runtime(args.root, config, lock_fd=lock_fd, defer_report=args.defer_report, json_output=args.json)
        pending = store.pending()
        _route_auxiliary_resume(args, store, pending)
        if args.command in ("configure", "cloud-configure"):
            journal = pending or store.create("install" if fresh else "configure", config["project"])
            store.event(journal, "configured", "done")
            output = result(journal["operationId"], config["installationId"], "configure", outcome="CONFIGURED", code=0,
                actionExecuted=True, executionCompleted=True, postActions=[{"kind": "schedule"}] if not fresh else [],
                nextAction="Настройки сохранены. Выполните auto для установки или обновления.")
            if fresh:
                journal["result"] = output
                store.save(journal)
                save_private(args.root / ".asa/setup-last-attempt.json", output)
            else:
                store.finish(journal, output)
        elif args.command in ("auto", "resume", "acceptance"):
            if args.operation_id:
                journal = store.read(args.operation_id)
            elif pending:
                journal = pending
            else:
                require(args.command == "auto", "OPERATION_REQUIRED", "Нужен operation ID последней установки.", "Укажите --operation-id из отчёта.")
                journal = store.create("install" if fresh else "update", config["project"])
            require(journal["mode"] in ("install", "update"), "OPERATION_MODE", "Журнал относится к другой операции.")
            if journal.get("state") == "TERMINAL" and args.command != "acceptance":
                output = journal["result"]
            else:
                output = Engine(runtime, store).execute(journal, resume=bool(pending or args.command == "resume"), acceptance_only=args.command == "acceptance")
        else:
            output = _auxiliary(args, config, runtime, store, pending)
    if not args.defer_report:
        render(output, as_json=args.json)
    return output["exitCode"]


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        return execute(args)
    except KeyboardInterrupt:
        output = result(None, None, args.command, outcome="INTERRUPTED", code=130, reasonCode="INTERRUPTED",
                        nextAction="Выполните status; незавершённую операцию продолжайте по её ID.")
    except (Blocked, OSError, ValueError, KeyError, TypeError) as error:
        output = result(None, None, args.command, outcome="BLOCKED" if isinstance(error, Blocked) else "ERROR",
            code=2 if isinstance(error, Blocked) else 1, reasonCode=getattr(error, "code", type(error).__name__),
            nextAction=error.action if isinstance(error, Blocked) else "Проверьте исходную конфигурацию и доступ оператора; приватные подробности не выводятся.")
    render(output, as_json=args.json)
    return output["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())

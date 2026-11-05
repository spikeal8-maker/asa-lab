"""Invocation-bound acceptance of an installation, never an update/repair hook.

Technical observation and diagnostics are read-only. Browser acceptance alone
uses the reviewed operations component to maintain its own private TEST fixture.
Neither a historical receipt nor a healthy container accepts a user journey.
"""

import contextlib
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time
import uuid

from . import collector
from .contracts import Blocked, attest_editor_env, exact_origin, require, validate_release, verify_embedded_entry_http
from .paths import plain_paths
from .releases import apply_release_environment, validate_resolved_images
from .system import run


OPS_REVISION = "88f3f76144d8b499fe70a3c9beccba16c80e0856"
BROWSER_SHA256 = "7e28aa8254011eb082331c2800909f1ce7f07b4da73473ed3942aacdb1691adc"
FIXTURE_SHA256 = "64de2bc8478d5aaa60f60fa1b0035448d8c467cf0ffcc92a0aa0be22d3b4786f"
PLAYWRIGHT_VERSION = "1.56.0"
REQUIRED_CHECKS = ("teacher_login", "student_login", "course_open", "existing_project_open",
                   "scratch_save_reopen", "electronics_save_reopen")
IDENTIFIER = re.compile(r"[a-f0-9]{32}\Z")
SAFE_CODE = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,79}\Z")
MAX_REPORT_BYTES = 65536


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _binding(install, operation_id, installation_id=None):
    require(isinstance(operation_id, str) and IDENTIFIER.fullmatch(operation_id),
            "OPERATION_ID", "Некорректный идентификатор операции.")
    generation = install.settings.get("instanceId")
    require(isinstance(generation, str) and IDENTIFIER.fullmatch(generation),
            "INSTALLATION_ID", "Установка не имеет подтверждённого instanceId.")
    selected = installation_id or generation
    require(isinstance(selected, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", selected),
            "INSTALLATION_ID", "Некорректный идентификатор установки.")
    return {"operationId": operation_id, "installationId": selected, "instanceId": generation}


def _report(kind, binding):
    return {"format": "asa-setup-acceptance-v1", "kind": kind, **binding,
            "startedAt": now(), "finishedAt": None, "status": "incomplete", "checks": {}}


def _finish(report, status, reason=None):
    report.update(status=status, finishedAt=now())
    if reason:
        report["reasonCode"] = reason if isinstance(reason, str) and SAFE_CODE.fullmatch(reason) else "ACCEPTANCE_FAILED"
    return report


def _safe_code(error, default):
    code = getattr(error, "code", None)
    return code if isinstance(code, str) and SAFE_CODE.fullmatch(code) else default


def storage_identity(records):
    """Capture only persistent identities, never container environments or data."""
    result = {}
    for service, destination in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data")):
        require(service in records, "IDENTITY_MISSING", "Отсутствует обязательное хранилище.")
        mounts = [m for m in records[service].get("mounts", []) if m.get("Destination") == destination]
        require(len(mounts) == 1 and mounts[0].get("Type") in ("volume", "bind"),
                "IDENTITY_VOLUME", "Не удалось подтвердить постоянное хранилище.")
        mount = mounts[0]
        result[service] = {key: mount.get(key) for key in ("Type", "Name", "Source", "Destination", "Driver")}
    return result


def technical_acceptance(install, release, operation_id, *, expected_data=None):
    """Observe exact runtime, resolved images, stores and the configured entry.

    expected_data is a previously captured storage_identity, not a supplied
    assertion that volumes are safe. The canonical manager independently checks
    the current configuration/container relationship on every observation.
    """
    report = _report("technical", _binding(install, operation_id))
    report["checks"] = {key: "not_run" for key in ("manifest", "configuration", "runtime", "images", "data", "entry")}
    stage = "manifest"
    try:
        validate_release(release)
        report["revision"], report["schema"] = release["revision"], release["schema"]
        report["checks"][stage] = "passed"
        stage = "configuration"
        apply_release_environment(install, release)
        validate_resolved_images(install, release)
        entry = exact_origin(install.env.get("ASA_UPDATE_ENTRY_ORIGIN"))
        attest_editor_env(entry, install.env.get("ASA_BLOCKS_PARENT_ORIGIN"),
                          install.env.get("ASA_BLOCKS_RUNTIME_ORIGIN"), install.profile)
        report["entryOrigin"] = entry
        report["checks"][stage] = "passed"
        stage = "runtime"
        records = install.identity()
        require(all(records.get(name, {}).get("running") is True for name in (*release["images"], "postgres")),
                "SERVICE_STOPPED", "Обязательный сервис не работает.")
        ready = install.readiness(release["revision"], release["schema"])
        report["runtime"] = {"revision": ready["revision"], "schema": ready["schema"]}
        report["checks"][stage] = "passed"
        stage = "images"
        image_evidence = {}
        for name, reference in release["images"].items():
            record = records[name]
            require(record.get("image") == reference, "IMAGE_DRIFT", "Сервис использует другой образ.")
            actual = run(["docker", "inspect", "--format", "{{.Image}}", record["id"]], capture=True, timeout=30)
            expected = run(["docker", "image", "inspect", "--format", "{{.Id}}", reference], capture=True, timeout=30)
            require(re.fullmatch(r"sha256:[a-f0-9]{64}", actual) and actual == expected,
                    "IMAGE_DRIFT", "Идентичность фактически запущенного образа не подтверждена.")
            image_evidence[name] = {"reference": reference, "imageId": actual}
        report["images"] = image_evidence
        report["checks"][stage] = "passed"
        stage = "data"
        data = storage_identity(records)
        require(expected_data is None or data == expected_data, "DATA_IDENTITY_CHANGED",
                "Изменились идентификаторы PostgreSQL или MinIO.")
        report["dataIdentity"] = data
        report["checks"][stage] = "passed"
        stage = "entry"
        verify_embedded_entry_http(entry, release["revision"])
        report["entry"] = {"reachable": True, "tls": "verified" if entry.startswith("https://") else "not_applicable"}
        report["checks"][stage] = "passed"
        return _finish(report, "passed")
    except (Blocked, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as exc:
        report["checks"][stage] = "failed"
        return _finish(report, "failed", _safe_code(exc, "TECHNICAL_CHECK_FAILED"))


def _read_pinned(path, expected):
    path = Path(path)
    require(path.is_absolute(), "BROWSER_COMPONENT_PATH", "Путь компонента приёмки должен быть абсолютным.")
    try:
        plain_paths(path, ())
    except ValueError as exc:
        raise Blocked("BROWSER_COMPONENT_PATH", "Компонент приёмки имеет небезопасный путь.",
                      "Переустановите проверенный пакет приёмки.") from exc
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 1024**2,
                "BROWSER_COMPONENT_FILE", "Компонент приёмки не является обычным ограниченным файлом.")
        if os.name != "nt":
            require(before.st_uid in (0, os.geteuid()) and not before.st_mode & 0o022,
                    "BROWSER_COMPONENT_OWNER", "Небезопасные права компонента приёмки.")
        raw = os.read(fd, 1024**2 + 1)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
                and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == expected,
                "BROWSER_COMPONENT_HASH", "Компонент приёмки не совпадает с проверенным выпуском.")
        return raw
    finally:
        os.close(fd)


def _python_path(value):
    require(isinstance(value, str) and Path(value).is_absolute(), "BROWSER_PYTHON_PATH",
            "Python приёмки должен иметь абсолютный путь.")
    path = Path(value)
    # A normal venv uses bin/python -> system Python. Validate the parent and
    # resolved executable, while preserving the venv path when launching.
    plain_paths(path.parent, ())
    resolved = path.resolve(strict=True)
    plain_paths(resolved, ())
    metadata = resolved.stat()
    require(stat.S_ISREG(metadata.st_mode) and os.access(path, os.X_OK), "BROWSER_PYTHON_PATH",
            "Python приёмки недоступен для исполнения.")
    if os.name != "nt":
        require(metadata.st_uid in (0, os.geteuid()) and not metadata.st_mode & 0o022,
                "BROWSER_PYTHON_OWNER", "Небезопасные права Python приёмки.")
    return path


def _fixture_parent(value):
    require(isinstance(value, str) and Path(value).is_absolute() and Path(value).suffix == ".json",
            "BROWSER_FIXTURE_PATH", "Требуется абсолютный путь приватного fixture.json.")
    path = Path(value)
    plain_paths(path, ())
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = path.parent.stat()
    if os.name != "nt":
        require(metadata.st_uid == os.geteuid() and not metadata.st_mode & 0o077,
                "BROWSER_FIXTURE_PERMISSIONS", "Каталог приёмки должен быть приватным и принадлежать оператору.")
    return path


# The reviewed source bytes are sent over stdin, not imported from a mutable
# directory. No custom __init__, pyc, PYTHONPATH, shell or configured command can
# replace the pinned fixture. The child uses an actual pinned Playwright runtime.
_BROWSER_LAUNCHER = r'''
import base64, contextlib, hashlib, importlib.metadata, io, json, os, sys, types
payload = json.load(sys.stdin)
binding = payload['binding']
envelope = dict(format='asa-browser-invocation-v1', **binding)
try:
    if importlib.metadata.version('playwright') != payload['runtimeVersion']:
        raise RuntimeError('RUNTIME_VERSION')
    from playwright.sync_api import sync_playwright
except Exception:
    print(json.dumps(dict(envelope, status='environment_failed', reasonCode='BROWSER_RUNTIME_UNAVAILABLE')))
    raise SystemExit(3)
try:
    sources = {}
    for name, value in payload['sources'].items():
        raw = base64.b64decode(value['data'], validate=True)
        if hashlib.sha256(raw).hexdigest() != value['sha256']:
            raise RuntimeError('COMPONENT_HASH')
        sources[name] = raw
    package = types.ModuleType('asa_ops')
    package.__path__ = []
    sys.modules['asa_ops'] = package
    fixture = types.ModuleType('asa_ops.acceptance_fixture')
    fixture.__file__ = payload['fixtureComponentPath']
    sys.modules[fixture.__name__] = fixture
    exec(compile(sources['fixture'], fixture.__file__, 'exec'), fixture.__dict__)
    browser = types.ModuleType('_asa_reviewed_browser')
    browser.__file__ = payload['componentPath']
    saved_path = list(sys.path)
    exec(compile(sources['browser'], browser.__file__, 'exec'), browser.__dict__)
    sys.path[:] = saved_path
    os.environ.update(ASA_ACCEPTANCE_ORIGIN=binding['entryOrigin'],
                      ASA_ACCEPTANCE_REVISION=binding['revision'],
                      ASA_ACCEPTANCE_INSTALLATION_ID=binding['installationId'],
                      ASA_ACCEPTANCE_INSTANCE_ID=binding['instanceId'])
    sys.argv = [browser.__file__, '--fixture', payload['fixturePath']]
    capture = io.StringIO()
    with fixture.locked_fixture(fixture.bound_path(payload['fixturePath'], binding['instanceId'])):
        with contextlib.redirect_stdout(capture):
            result = browser.main()
    raw = capture.getvalue()
    if len(raw.encode()) > 65536:
        raise RuntimeError('REPORT_SIZE')
    report = json.loads(raw)
    print(json.dumps(dict(envelope, status='completed', returncode=result, report=report)))
    raise SystemExit(result)
except SystemExit:
    raise
except Exception:
    print(json.dumps(dict(envelope, status='environment_failed', reasonCode='BROWSER_ENVIRONMENT_FAILED')))
    raise SystemExit(3)
'''


def validate_browser_report(payload, binding, returncode):
    """Reject stale, foreign, partial or contradictory child evidence."""
    require(isinstance(payload, dict) and payload.get("format") == "asa-browser-invocation-v1"
            and all(payload.get(key) == value for key, value in binding.items()),
            "BROWSER_REPORT_BINDING", "Браузерный отчёт относится к другой операции или установке.")
    if payload.get("status") == "environment_failed":
        require(returncode == 3 and payload.get("reasonCode") in ("BROWSER_RUNTIME_UNAVAILABLE", "BROWSER_ENVIRONMENT_FAILED"),
                "BROWSER_REPORT_EXIT", "Код завершения браузерной приёмки противоречит отчёту.")
        return {"status": "environment_failed", "reasonCode": payload["reasonCode"],
                "checks": {key: "not_run" for key in REQUIRED_CHECKS}}
    require(payload.get("status") == "completed" and type(payload.get("returncode")) is int
            and payload["returncode"] == returncode and returncode in (0, 2),
            "BROWSER_REPORT_EXIT", "Код завершения браузерной приёмки противоречит отчёту.")
    observed = payload.get("report")
    require(isinstance(observed, dict) and observed.get("revision") == binding["revision"]
            and observed.get("entry_origin") == binding["entryOrigin"],
            "BROWSER_REPORT_BINDING", "Пользовательский сценарий проверял другую версию или адрес.")
    checks = observed.get("checks")
    require(isinstance(checks, dict) and set(checks) == set(REQUIRED_CHECKS)
            and all(type(value) is bool for value in checks.values()),
            "BROWSER_REPORT_CHECKS", "Браузерный отчёт не содержит все обязательные проверки.")
    passed = all(checks.values())
    require((passed and returncode == 0 and observed.get("error") is None) or
            (not passed and returncode == 2), "BROWSER_REPORT_EXIT", "Неполная приёмка не может иметь успешный исход.")
    result = {"status": "passed" if passed else "failed",
              "checks": {key: "passed" if checks[key] else "failed" for key in REQUIRED_CHECKS}}
    error = observed.get("error")
    if not passed:
        result["reasonCode"] = "BROWSER_USER_FLOW_FAILED"
        if isinstance(error, dict):
            result["error"] = {key: value for key, value in error.items()
                               if key in ("stage", "code") and isinstance(value, str) and SAFE_CODE.fullmatch(value)}
    return result


def _run_browser(command, *, cwd, payload, stdout, stderr, environment, timeout):
    """Own and reap the complete browser process group before releasing a lock."""
    require(os.name == "posix", "BROWSER_PLATFORM", "Этот пакет приёмки поддерживает Linux.")
    process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.PIPE, stdout=stdout,
                               stderr=stderr, env=environment, start_new_session=True)
    try:
        process.communicate(json.dumps(payload).encode(), timeout=timeout)
    except BaseException:
        # Only the session created by this invocation is addressed. The child
        # is not reaped before killpg, so its PID cannot be reused underneath us.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        # Kill remaining descendants even if their Python parent has already
        # obeyed TERM. Reap the group leader only AFTER the last group signal.
        time.sleep(0.2)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)
        raise
    return process.returncode


def browser_acceptance(install, release, operation_id, browser, *, installation_id=None):
    report = _report("browser", _binding(install, operation_id, installation_id))
    report["checks"] = {key: "not_run" for key in REQUIRED_CHECKS}
    if not browser:
        return _finish(report, "incomplete", "BROWSER_NOT_CONFIGURED")
    try:
        validate_release(release)
        require(isinstance(browser, dict) and not set(browser) - {"componentPath", "componentSha256", "pythonPath", "fixturePath", "timeoutSeconds", "browsersPath"},
                "BROWSER_CONFIGURATION", "Неподдерживаемые настройки браузерной приёмки.")
        require(browser.get("componentSha256") == BROWSER_SHA256, "BROWSER_COMPONENT_PIN",
                "В настройках не указан утверждённый компонент приёмки.")
        timeout = browser.get("timeoutSeconds", 600)
        require(type(timeout) is int and 30 <= timeout <= 1800, "BROWSER_TIMEOUT_CONFIGURATION",
                "Тайм-аут приёмки должен быть от 30 до 1800 секунд.")
        component = Path(browser["componentPath"])
        require(component.name == "browser_acceptance.py", "BROWSER_COMPONENT_PATH", "Неверное имя компонента приёмки.")
        fixture_component = component.with_name("acceptance_fixture.py")
        source = _read_pinned(component, BROWSER_SHA256)
        fixture_source = _read_pinned(fixture_component, FIXTURE_SHA256)
        python = _python_path(browser["pythonPath"])
        fixture = _fixture_parent(browser["fixturePath"])
        origin = exact_origin(install.env.get("ASA_UPDATE_ENTRY_ORIGIN"))
        attest_editor_env(origin, install.env.get("ASA_BLOCKS_PARENT_ORIGIN"),
                          install.env.get("ASA_BLOCKS_RUNTIME_ORIGIN"), install.profile)
        binding = {key: report[key] for key in ("operationId", "installationId", "instanceId")}
        binding.update(revision=release["revision"], entryOrigin=origin, invocationId=uuid.uuid4().hex,
                       componentSha256=BROWSER_SHA256, fixtureSha256=FIXTURE_SHA256)
        import base64
        payload = {"binding": binding, "runtimeVersion": PLAYWRIGHT_VERSION,
                   "componentPath": str(component), "fixtureComponentPath": str(fixture_component),
                   "fixturePath": str(fixture), "sources": {
                       "browser": {"data": base64.b64encode(source).decode(), "sha256": BROWSER_SHA256},
                       "fixture": {"data": base64.b64encode(fixture_source).decode(), "sha256": FIXTURE_SHA256}}}
        # Never inherit injection knobs or application/provider credentials.
        environment = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "XDG_CACHE_HOME") if key in os.environ}
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        if browser.get("browsersPath"):
            cache = Path(browser["browsersPath"])
            require(cache.is_absolute(), "BROWSER_CACHE_PATH", "Нужен абсолютный путь runtime браузера.")
            plain_paths(cache, ())
            metadata = cache.stat()
            require(cache.is_dir() and (os.name == "nt" or (metadata.st_uid == os.geteuid()
                    and not metadata.st_mode & 0o022)), "BROWSER_CACHE_OWNER", "Владелец runtime браузера не подтверждён.")
            environment["PLAYWRIGHT_BROWSERS_PATH"] = str(cache)
        with tempfile.TemporaryFile(dir=fixture.parent) as stdout, tempfile.TemporaryFile(dir=fixture.parent) as stderr:
            returncode = _run_browser([str(python), "-I", "-B", "-c", _BROWSER_LAUNCHER],
                                      cwd=install.root, payload=payload, stdout=stdout,
                                      stderr=stderr, environment=environment, timeout=timeout)
            require(stdout.seek(0, os.SEEK_END) <= MAX_REPORT_BYTES, "BROWSER_REPORT_SIZE", "Браузерный отчёт слишком большой.")
            stdout.seek(0)
            observed = json.loads(stdout.read(MAX_REPORT_BYTES).decode("utf-8"))
        outcome = validate_browser_report(observed, binding, returncode)
        report.update(outcome, revision=release["revision"], entryOrigin=origin, invocationId=binding["invocationId"],
                      componentSha256=BROWSER_SHA256, componentRevision=OPS_REVISION)
        return _finish(report, outcome["status"], outcome.get("reasonCode"))
    except subprocess.TimeoutExpired:
        return _finish(report, "environment_failed", "BROWSER_TIMEOUT")
    except FileNotFoundError:
        return _finish(report, "incomplete", "BROWSER_COMPONENT_MISSING")
    except (Blocked, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as exc:
        return _finish(report, "incomplete", _safe_code(exc, "BROWSER_ENVIRONMENT_FAILED"))


def _fresh(value, seconds=90):
    try:
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(value.replace("Z", "+00:00"))).total_seconds()
        return 0 <= age < seconds
    except (AttributeError, TypeError, ValueError):
        return False


def collector_observation(install, operation_id):
    """Observe process, system/user manager and latest cycle, without repair."""
    report = _report("collector", _binding(install, operation_id))
    report["required"] = False
    report["checks"] = {"process": "not_run", "manager": "not_run", "cycle": "not_run"}
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            value = collector.status(install)
        mode = value.get("mode")
        report["mode"] = mode if mode in ("system", "user", "windows-task") else None
        process, cycle = value.get("process", {}), value.get("cycle", {})
        pid = process.get("pid")
        process_ok = value.get("state") == "running" and type(pid) is int and pid > 0
        if process_ok and os.name != "nt":
            try:
                os.kill(pid, 0)
            except (OSError, TypeError, ValueError):
                process_ok = False
        report["checks"]["process"] = "passed" if process_ok else "warning"
        cycle_ok = (cycle.get("state") == "ok" and cycle.get("coverageComplete") is True
                    and _fresh(cycle.get("checkedAt")))
        report["checks"]["cycle"] = "passed" if cycle_ok else "warning"
        report["cycleCheckedAt"] = cycle.get("checkedAt") if _fresh(cycle.get("checkedAt"), 86400 * 365) else None
        manager_ok = False
        if os.name != "nt" and mode in ("system", "user"):
            registration = collector.read_json(install.state / "collector-runner.json", {})
            name = registration.get("name")
            require(name in ("asa-log-collector-" + install.project + ".service", "asa-log-collector.service"),
                    "COLLECTOR_RUNNER_IDENTITY", "Неизвестная служба диагностики.")
            command = ["systemctl"] + (["--user"] if mode == "user" else [])
            result = subprocess.run(command + ["show", name, "--property=ActiveState", "--property=MainPID", "--property=LoadState"],
                                    capture_output=True, text=True, timeout=15)
            properties = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
            manager_ok = (result.returncode == 0 and properties.get("LoadState") == "loaded"
                          and properties.get("ActiveState") == "active" and properties.get("MainPID") == str(pid))
        report["checks"]["manager"] = "passed" if manager_ok else "warning"
        return _finish(report, "passed" if process_ok and cycle_ok and manager_ok else "warning",
                       None if process_ok and cycle_ok and manager_ok else "COLLECTOR_NEEDS_ATTENTION")
    except (Blocked, OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as exc:
        return _finish(report, "warning", _safe_code(exc, "COLLECTOR_UNAVAILABLE"))


def restore_status(operation_id, snapshot_id=None):
    """Expose the approved real-archive contract; never infer restore from auto.

    This is the unchanged P1-R3A admission policy at the pinned operations SHA.
    A release that enables real restoration must supply new reviewed provenance,
    genuine owner signing pin and approved images; a configured AGE recipient
    cannot modify this policy. Synthetic CI restore evidence is separate.
    """
    require(isinstance(operation_id, str) and IDENTIFIER.fullmatch(operation_id),
            "OPERATION_ID", "Некорректный идентификатор операции.")
    require(snapshot_id is None or isinstance(snapshot_id, str) and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", snapshot_id),
            "RESTORE_SNAPSHOT_ID", "Некорректный идентификатор архива.")
    report = _report("real_archive_restore", {"operationId": operation_id, "installationId": None})
    report.update(snapshotId=snapshot_id, contractRevision=OPS_REVISION, recoverability="UNVERIFIED",
                  executionAllowed=False, ownerPinProvisioned=False, approvedImageSets=[],
                  blockingCodes=["BLOCKED_PLAN", "BLOCKED_KEY_ACCESS"],
                  nextAction="Использовать отдельный согласованный restore-план с настоящим owner pin и разрешёнными образами.")
    return _finish(report, "blocked" if snapshot_id else "not_run", "BLOCKED_PLAN" if snapshot_id else None)

"""Unprivileged host preflight and the public ownership adapter for setup."""

import datetime as dt
import os
from pathlib import Path
import shutil
import socket
import subprocess
import urllib.error
from urllib.parse import urlsplit
import urllib.request

from asa_setup_launcher import SetupBlocked, dependency_plan, platform_info, validate_owner
from .contracts import Blocked, exact_origin


def check_platform():
    value = platform_info()
    if not value["supported"]:
        raise Blocked("PLATFORM", "Поддержанный профиль: Ubuntu 24.04 amd64, Python 3.11+.",
                      "Используйте заявленную платформу; исходная установка сохранена.")
    return value


def check_owner(root, backup_directory=None, operator_uid=None):
    try:
        return validate_owner(root, backup_directory, operator_uid)
    except SetupBlocked as exc:
        raise Blocked(exc.code, str(exc), exc.action) from exc


def inspect_dependencies(cloud=False):
    try:
        return dependency_plan(cloud=cloud)
    except SetupBlocked as exc:
        raise Blocked(exc.code, str(exc), exc.action) from exc


def disk_budget(path, *, snapshot_bytes, image_bytes=0, snapshot_entries=None, verify_download=True):
    """Reserve local set + tar + ciphertext + optional readback before downtime."""
    if type(snapshot_bytes) is not int or snapshot_bytes < 0 or type(image_bytes) is not int or image_bytes < 0:
        raise Blocked("SPACE_ESTIMATE", "Размер полного снимка и образов не определён.", "Получите оценку до остановки писателей.")
    if snapshot_entries is not None and (type(snapshot_entries) is not int or snapshot_entries < 0):
        raise Blocked("SPACE_ESTIMATE", "Число файлов и каталогов снимка не определено.", "Подтвердите число объектов до остановки писателей.")
    current = Path(path)
    while not current.exists():
        if current == current.parent:
            raise Blocked("SPACE_PATH", "Не найден диск для резервирования.", "Проверьте каталог резервных копий.")
        current = current.parent
    usage = shutil.disk_usage(current)
    filesystem = os.statvfs(current)
    required = int(snapshot_bytes * (4 if verify_download else 3) * 1.1) + image_bytes + 2 * 1024 ** 3
    # Byte size cannot bound the number of tiny objects. Runtime supplies the
    # observed MinIO entry count, including directories and private metadata.
    entries = snapshot_entries if snapshot_entries is not None else snapshot_bytes // 16384
    inodes_required = max(1024, (entries * 11 + 9) // 10 + 128)
    result = {"path": str(current), "freeBytes": usage.free, "requiredBytes": required,
              "freeInodes": filesystem.f_favail, "requiredInodes": inodes_required, "snapshotEntries": snapshot_entries,
              "sufficient": usage.free >= required and (filesystem.f_files == 0 or filesystem.f_favail >= inodes_required)}
    if not result["sufficient"]:
        raise Blocked("SPACE", "Недостаточно места или inodes для полного backup, шифрования и проверки доставки.",
                      "Освободите место согласованным способом; чужие данные автоматически не удаляются.")
    return result


def network_preflight(entry_origin, *, registry="ghcr.io", timeout=10):
    """Verify DNS and a TLS registry response without fetching user data."""
    origin = exact_origin(entry_origin)
    host = urlsplit(origin).hostname
    result = {"entryOrigin": origin, "registry": registry, "dns": False, "registryTls": False}
    try:
        socket.getaddrinfo(host, None)
        socket.getaddrinfo(registry, 443)
        result["dns"] = True
        request = urllib.request.Request("https://" + registry + "/v2/", method="HEAD")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                result["registryTls"] = response.status in (200, 401)
        except urllib.error.HTTPError as exc:
            # Registry authentication challenge proves DNS/TCP/TLS, not access
            # to the required private package (the immutable image pull does).
            result["registryTls"] = exc.code == 401
    except (OSError, ValueError):
        raise Blocked("NETWORK", "DNS или HTTPS-доступ к registry не подтверждён.",
                      "Восстановите сеть и повторите check; текущий сайт не переключается.")
    if not result["registryTls"]:
        raise Blocked("REGISTRY", "HTTPS-проверка registry не пройдена.", "Проверьте доступ к registry и системное время.")
    return result


def system_state():
    """Report separate systemd/1Panel/time evidence; no service mutations."""
    result = {"observedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "systemd": False,
              "onePanel": "UNVERIFIED", "timeSynchronized": "UNVERIFIED"}
    if not Path("/run/systemd/system").is_dir():
        return result
    result["systemd"] = True
    try:
        clock = subprocess.run(["systemctl", "show", "systemd-timesyncd.service", "-p", "ActiveState", "--value"],
                               capture_output=True, text=True, timeout=10, check=False)
        if clock.returncode == 0:
            result["timeService"] = clock.stdout.strip()
        synced = subprocess.run(["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
                                capture_output=True, text=True, timeout=10, check=False)
        if synced.returncode == 0 and synced.stdout.strip() in ("yes", "no"):
            result["timeSynchronized"] = synced.stdout.strip() == "yes"
        for service in ("1panel.service", "1panel-core.service"):
            checked = subprocess.run(["systemctl", "show", service, "-p", "ActiveState", "--value"],
                                     capture_output=True, text=True, timeout=10, check=False)
            if checked.returncode == 0 and checked.stdout.strip() == "active":
                result["onePanel"] = "ACTIVE"
                result["onePanelService"] = service
                break
    except (OSError, subprocess.TimeoutExpired):
        pass
    return result


def check_ports(ports, *, existing=False):
    """New targets never silently pick replacement ports when one is occupied."""
    result = []
    for port in ports:
        if type(port) is not int or not 1024 <= port <= 65535:
            raise Blocked("PORT", "Некорректный порт установки.", "Исправьте сохранённую конфигурацию портов.")
        if existing:
            result.append({"port": port, "state": "VERIFY_EXISTING_BINDING"})
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as stream:
                stream.bind(("127.0.0.1", port))
            result.append({"port": port, "state": "AVAILABLE"})
        except OSError as exc:
            raise Blocked("PORT_BUSY", f"Порт {port} уже занят; новая установка не начата.",
                          "Проверьте владельца порта; порт существующего сайта автоматически не меняется.") from exc
    return result

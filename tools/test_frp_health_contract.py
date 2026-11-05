#!/usr/bin/env python3
"""Actual, isolated FRP health-check contract. Never connects to a deployed tunnel."""

from __future__ import annotations

import argparse
from contextlib import ExitStack
import copy
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import platform
import queue
import re
import secrets
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tools/deployment/frp-release.json"
UPSTREAM = "https://github.com/fatedier/frp"
PLATFORMS = ("linux-amd64", "windows-amd64")
MAX_MEMBER = 64 * 1024 * 1024
DOMAIN = "frp-health-contract.invalid"


class ContractError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ContractError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(65536), b""):
            value.update(block)
    return value.hexdigest()


def manifest_data(value):
    require(set(value) == {
        "schemaVersion", "upstreamRepository", "candidateVersion", "baselineVersion", "releases"
    }, "Unknown or missing release manifest fields")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and
            value["upstreamRepository"] == UPSTREAM,
            "Unsupported manifest schema or upstream")
    versions = [value["baselineVersion"], value["candidateVersion"]]
    require(len(set(versions)) == 2 and all(
        isinstance(v, str) and re.fullmatch(r"\d+\.\d+\.\d+", v) for v in versions
    ), "Two distinct pinned versions are required")
    require(set(value["releases"]) == set(versions), "Release roles must match the manifest")
    for version, release in value["releases"].items():
        require(set(release) == {"publishedAt", "releaseUrl", "assets"}, "Unknown release fields")
        require(release["releaseUrl"] == f"{UPSTREAM}/releases/tag/v{version}", "Wrong release source")
        require(set(release["assets"]) == set(PLATFORMS), "Both amd64 platforms must be pinned")
        for target, asset in release["assets"].items():
            require(set(asset) == {"file", "url", "sha256", "sizeBytes"}, "Unknown asset fields")
            extension = ".zip" if target.startswith("windows") else ".tar.gz"
            name = f"frp_{version}_{target.replace('-', '_')}{extension}"
            require(asset["file"] == name, "Unexpected archive name")
            require(asset["url"] == f"{UPSTREAM}/releases/download/v{version}/{name}",
                    "Asset URL must name the official pinned GitHub release")
            require(isinstance(asset["sha256"], str) and
                    re.fullmatch(r"[0-9a-f]{64}", asset["sha256"]), "Invalid SHA-256")
            require(type(asset["sizeBytes"]) is int and 0 < asset["sizeBytes"] <= MAX_MEMBER,
                    "Archive size must be positive and bounded")
    return value


def verify_archive(path, asset):
    require(path.is_file() and not path.is_symlink(), "Archive must be a regular file")
    require(path.stat().st_size == asset["sizeBytes"], "Archive size mismatch")
    require(digest(path) == asset["sha256"], "Archive SHA-256 mismatch")


def download(asset, cache):
    cache.mkdir(parents=True, exist_ok=True)
    require(cache.is_dir() and not cache.is_symlink(), "Cache must be a real directory")
    destination = cache / asset["file"]
    if destination.exists() or destination.is_symlink():
        verify_archive(destination, asset)
        return destination
    request = urllib.request.Request(asset["url"], headers={"User-Agent": "ASA-Lab-FRP-contract/1"})
    started = time.monotonic()
    # No token, custom mirror, certificate bypass, or caller-supplied download URL.
    with urllib.request.urlopen(request, timeout=20) as response:
        final = urllib.parse.urlsplit(response.url)
        require(final.scheme == "https" and final.hostname in {
            "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"
        }, "Unexpected GitHub release redirect")
        if response.headers.get("Content-Length"):
            require(int(response.headers["Content-Length"]) == asset["sizeBytes"],
                    "Download Content-Length mismatch")
        with destination.open("xb") as target:
            total = 0
            while block := response.read(65536):
                total += len(block)
                require(total <= asset["sizeBytes"], "Download exceeds pinned size")
                require(time.monotonic() - started < 90, "Download exceeded 90 seconds")
                target.write(block)
    verify_archive(destination, asset)
    return destination


def extract_binaries(archive, version, target, destination):
    destination.mkdir()
    prefix = f"frp_{version}_{target.replace('-', '_')}/"
    suffix = ".exe" if target.startswith("windows") else ""
    names = [f"frpc{suffix}", f"frps{suffix}", "LICENSE"]
    result = {}
    with (zipfile.ZipFile(archive) if suffix else tarfile.open(archive, "r:gz")) as package:
        for name in names:
            if suffix:
                matches = [entry for entry in package.infolist() if entry.filename == prefix + name]
                require(len(matches) == 1, f"Missing or duplicate archive member: {name}")
                entry = matches[0]
                mode = entry.external_attr >> 16
                require(not entry.is_dir() and not stat.S_ISLNK(mode), "Archive links are forbidden")
                size, stream = entry.file_size, package.open(entry)
            else:
                matches = [entry for entry in package.getmembers() if entry.name == prefix + name]
                require(len(matches) == 1 and matches[0].isfile(), "Archive member must be regular")
                entry = matches[0]
                size, stream = entry.size, package.extractfile(entry)
            require(0 < size <= MAX_MEMBER, "Unbounded archive member")
            path = destination / name
            with stream, path.open("xb") as output:
                total = 0
                while block := stream.read(65536):
                    total += len(block)
                    require(total <= size, "Archive member exceeds declared size")
                    output.write(block)
                require(total == size, "Truncated archive member")
            if name != "LICENSE":
                path.chmod(0o700)
                result[name.removesuffix(".exe")] = path
    return result


def native_environment():
    env = {key: value for key, value in os.environ.items()
           if key.lower() not in {"http_proxy", "https_proxy", "all_proxy", "ftp_proxy", "no_proxy"}}
    env["NO_PROXY"] = env["no_proxy"] = "127.0.0.1,localhost"
    return env


class NativeProcess:
    def __init__(self, name, binary, config, logs, token):
        self.name = name
        self.lines = []
        self.condition = threading.Condition()
        self.log_error = None
        self.path = logs / f"{name}.log"
        self.process = subprocess.Popen(
            [str(binary), "-c", str(config)], cwd=config.parent, env=native_environment(),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        self.reader = threading.Thread(target=self.read, args=(token,), daemon=True)
        self.reader.start()

    def read(self, token):
        total = 0
        with self.path.open("x", encoding="utf-8") as output:
            for raw in self.process.stdout:
                line = raw.replace(token, "[synthetic-test-token]")
                total += len(line.encode("utf-8"))
                with self.condition:
                    if total <= 2 * 1024 * 1024 and len(self.lines) < 10000:
                        output.write(line)
                        output.flush()
                        self.lines.append(line.rstrip())
                    else:
                        self.log_error = "Native log exceeded its bounded budget"
                    self.condition.notify_all()

    def alive(self):
        require(self.process.poll() is None,
                f"{self.name} exited unexpectedly: {self.process.returncode}; see {self.path.name}")
        require(not self.log_error, self.log_error or "")

    def count(self, marker):
        with self.condition:
            return sum(marker in line for line in self.lines)

    def wait(self, marker, count, seconds=6):
        end = time.monotonic() + seconds
        with self.condition:
            while sum(marker in line for line in self.lines) < count:
                self.alive()
                remaining = end - time.monotonic()
                require(remaining > 0, f"{self.name}: timed out waiting for {marker}")
                self.condition.wait(min(remaining, 0.1))

    def stop(self):
        # Only the Popen handle created above is ever terminated. No name/PID search.
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        self.reader.join(timeout=2)
        return {"name": self.name, "pid": self.process.pid,
                "exitCode": self.process.returncode, "stopped": self.process.poll() is not None}


class Backend:
    def __init__(self):
        self.token = secrets.token_hex(16)
        self.steps = queue.Queue()
        self.automatic = threading.Event()
        self.closing = threading.Event()
        self.responses = []
        backend = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def reply(self, status, body):
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_GET(self):
                if self.path == "/health/ready":
                    end = time.monotonic() + 8
                    while not backend.closing.is_set():
                        try:
                            step = backend.steps.get(timeout=0.05)
                            status = step["status"]
                            break
                        except queue.Empty:
                            if backend.automatic.is_set():
                                status, step = 200, None
                                break
                            if time.monotonic() > end:
                                status, step = 503, None
                                break
                    else:
                        return
                    backend.responses.append(status)
                    self.reply(status, b"{}")
                    if step:
                        step["sent"].set()
                elif self.path == "/roundtrip":
                    self.echo(b"")
                else:
                    self.reply(404, b"{}")

            def do_POST(self):
                size = int(self.headers.get("Content-Length", "0"))
                if self.path != "/roundtrip" or not 0 <= size <= 65536:
                    self.reply(400, b"{}")
                    return
                self.echo(self.rfile.read(size))

            def echo(self, body):
                self.reply(200, json.dumps({
                    "token": backend.token, "method": self.command,
                    "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
                    "host": self.headers.get("Host"),
                }).encode())

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def submit(self, status):
        step = {"status": status, "sent": threading.Event()}
        self.steps.put(step)
        require(step["sent"].wait(6), "Controlled health response was not requested")

    def stop(self):
        self.closing.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def reserve_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name == "nt":
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    return sock


def roundtrip(port, backend, method="GET", payload=b""):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
    try:
        connection.request(method, "/roundtrip", body=payload,
                           headers={"Host": DOMAIN, "Connection": "close"})
        response = connection.getresponse()
        body = response.read(65537)
        require(len(body) <= 65536, "Unbounded HTTP response")
        if response.status == 200:
            expected = {"token": backend.token, "method": method,
                        "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload),
                        "host": DOMAIN}
            require(json.loads(body) == expected, "HTTP response did not come from the fixture backend")
        return response.status
    finally:
        connection.close()


def wait_listener(port, process):
    end = time.monotonic() + 6
    while True:
        process.alive()
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            require(time.monotonic() < end, "Selected loopback test port did not open")
            time.sleep(0.05)


def fixture(version, role, binaries, directory, logs):
    with ExitStack() as resources:
        return run_fixture(version, role, binaries, directory, logs, resources)


def run_fixture(version, role, binaries, directory, logs, resources):
    directory.mkdir()
    backend = Backend()
    resources.callback(backend.stop)
    control_reservation = reserve_port()
    resources.callback(control_reservation.close)
    http_reservation = reserve_port()
    resources.callback(http_reservation.close)
    ports = {"control": control_reservation.getsockname()[1],
             "http": http_reservation.getsockname()[1], "backend": backend.port}
    auth = secrets.token_hex(32)
    server_config, client_config = directory / "frps.toml", directory / "frpc.toml"
    server_config.write_text(
        f'bindAddr = "127.0.0.1"\nbindPort = {ports["control"]}\n'
        f'proxyBindAddr = "127.0.0.1"\nvhostHTTPPort = {ports["http"]}\n'
        f'auth.method = "token"\nauth.token = "{auth}"\n'
        'transport.tls.force = true\ntransport.tcpMux = true\n'
        'log.to = "console"\nlog.level = "info"\nlog.disablePrintColor = true\n',
        encoding="utf-8",
    )
    client_config.write_text(
        f'serverAddr = "127.0.0.1"\nserverPort = {ports["control"]}\n'
        f'auth.method = "token"\nauth.token = "{auth}"\nloginFailExit = false\n'
        'transport.tls.enable = true\ntransport.tcpMux = true\ntransport.poolCount = 1\n'
        'transport.tcpMuxKeepaliveInterval = 30\n'
        'log.to = "console"\nlog.level = "trace"\nlog.disablePrintColor = true\n'
        '[[proxies]]\nname = "health-contract"\ntype = "http"\nlocalIP = "127.0.0.1"\n'
        f'localPort = {backend.port}\ncustomDomains = ["{DOMAIN}"]\n'
        'healthCheck.type = "http"\nhealthCheck.path = "/health/ready"\n'
        'healthCheck.timeoutSeconds = 10\nhealthCheck.maxFailed = 3\nhealthCheck.intervalSeconds = 1\n',
        encoding="utf-8",
    )
    server_config.chmod(0o600)
    client_config.chmod(0o600)
    result = {"role": role, "version": version, "ports": ports, "bindAddress": "127.0.0.1",
              "healthFixture": {"timeoutSeconds": 10, "intervalSeconds": 1, "maxFailed": 3},
              "steps": [], "cleanup": []}
    processes = []
    stopped_processes = set()
    server = client = None
    failed_marker = "health check status change to failed"
    success_marker = "do one health check success"
    failure_marker = "do one health check failed:"
    try:
        control_reservation.close()
        http_reservation.close()
        server = NativeProcess(f"{role}-frps", binaries["frps"], server_config, logs, auth)
        processes.append(server)
        wait_listener(ports["control"], server)
        wait_listener(ports["http"], server)
        client = NativeProcess(f"{role}-frpc", binaries["frpc"], client_config, logs, auth)
        processes.append(client)

        def step(status, expect_up, label):
            marker = success_marker if status == 200 else failure_marker
            count = client.count(marker)
            backend.submit(status)
            client.wait(marker, count + 1)
            server.alive()
            client.alive()
            if expect_up:
                # Allow route registration on first success, then require real HTTP responses.
                end = time.monotonic() + 4
                while roundtrip(ports["http"], backend) != 200:
                    require(time.monotonic() < end, f"{label}: proxy did not become available")
                    time.sleep(0.05)
                time.sleep(0.1)
                require(roundtrip(ports["http"], backend) == 200, f"{label}: unstable proxy")
            else:
                client.wait(failed_marker, 1)
                end = time.monotonic() + 4
                while roundtrip(ports["http"], backend) == 200:
                    require(time.monotonic() < end, f"{label}: unhealthy proxy still routed")
                    time.sleep(0.05)
            result["steps"].append({"label": label, "healthStatus": status,
                                    "proxyAvailable": expect_up,
                                    "unhealthyTransitions": client.count(failed_marker)})

        step(200, True, "initial-healthy")
        for index in range(1, 4):
            expect_up = not (role == "baseline" and index == 3)
            step(503, expect_up, f"alternating-failure-{index}")
            if expect_up:
                require(client.count(failed_marker) == 0,
                        "Proxy was removed after non-consecutive failures")
            if index < 3:
                step(200, True, f"alternating-recovery-{index}")
        if role == "baseline":
            require(client.count(failed_marker) == 1, "Old-version defect was not reproduced")
            require(backend.responses == [200, 503, 200, 503, 200, 503],
                    "Baseline health responses did not follow the controlled sequence")
            result["outcome"] = "EXPECTED_DEFECT_REPRODUCED"
            return result

        require(client.count(failed_marker) == 0, "Candidate retained the cumulative counter defect")
        step(200, True, "reset-before-consecutive")
        for index in range(1, 4):
            step(503, index < 3, f"consecutive-failure-{index}")
            require(client.count(failed_marker) == (1 if index == 3 else 0),
                    "Wrong consecutive failure threshold")
        step(200, True, "first-success-restores")
        require(client.count(failed_marker) == 1, "Unhealthy transition emitted more than once")
        require(backend.responses == [200, 503, 200, 503, 200, 503, 200, 503, 503, 503, 200],
                "Candidate health responses did not follow the controlled sequence")
        payload = (b"synthetic-frp-roundtrip-" + backend.token.encode()) * 256
        require(roundtrip(ports["http"], backend, "POST", payload) == 200,
                "Synthetic HTTP body roundtrip failed")
        result["httpRoundtrip"] = {"get": "PASS", "postBytes": len(payload), "post": "PASS"}

        backend.automatic.set()
        login_count = client.count("login to server success")
        original_client_pid = client.process.pid
        result["cleanup"].append(server.stop())
        stopped_processes.add(server)
        # Same fixed ports and same synthetic credentials. Only our server is restarted.
        server = NativeProcess(f"{role}-frps-reconnected", binaries["frps"], server_config, logs, auth)
        processes.append(server)
        wait_listener(ports["control"], server)
        client.wait("login to server success", login_count + 1, seconds=20)
        end = time.monotonic() + 6
        while roundtrip(ports["http"], backend) != 200:
            require(time.monotonic() < end, "HTTP route did not recover after owned reconnect")
            time.sleep(0.1)
        require(client.process.pid == original_client_pid, "Client was replaced during reconnect")
        require(roundtrip(ports["http"], backend, "POST", payload) == 200,
                "HTTP body roundtrip failed after reconnect")
        result["reconnect"] = {"status": "PASS", "sameClientPid": original_client_pid,
                               "samePorts": True, "newSuccessfulLogin": True}
        result["outcome"] = "PASS"
        return result
    finally:
        control_reservation.close()
        http_reservation.close()
        cleanup_errors = []
        for process in reversed(processes):
            if process not in stopped_processes:
                try:
                    result["cleanup"].append(process.stop())
                except Exception as exc:
                    cleanup_errors.append(f"{process.name}: {exc}")
                    result["cleanup"].append({
                        "name": process.name, "pid": process.process.pid,
                        "exitCode": process.process.poll(),
                        "stopped": process.process.poll() is not None, "error": str(exc),
                    })
        result["actualHealthResponses"] = backend.responses
        result["allOwnedProcessesStopped"] = all(item["stopped"] for item in result["cleanup"])
        if cleanup_errors or not result["allOwnedProcessesStopped"]:
            result["outcome"] = "FAIL"
        (logs / f"{role}-result.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        require(not cleanup_errors and result["allOwnedProcessesStopped"],
                "Owned process cleanup failed: " + "; ".join(cleanup_errors))


def windows_powershell_environment(parent):
    # pwsh -> Python -> powershell.exe bypasses pwsh's direct-launch path cleanup.
    # Let Windows PowerShell construct its own standard module search path:
    # https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_psmodulepath#starting-windows-powershell-from-powershell-7
    return {key: value for key, value in parent.items() if key.casefold() != "psmodulepath"}


def module_probe_snapshot(process):
    # Keep the actual result before evaluating an oracle; never dump the environment.
    return {"exitCode": process.returncode,
            "stdout": process.stdout[-16384:], "stderr": process.stderr[-16384:],
            "stdoutCharacters": len(process.stdout), "stderrCharacters": len(process.stderr)}


def check_windows_module_environment(directory, powershell, logs):
    parent = dict(os.environ)
    unavailable = directory / "empty-module-search-path"
    unavailable.mkdir()
    payload = directory / "sha256 module fixture.bin"
    payload.write_bytes(bytes(range(256)) * 1025)
    probe = directory / "module-hash-probe.ps1"
    probe.write_text(
        'param([Parameter(Mandatory = $true)][string]$Path)\n'
        "$ErrorActionPreference = 'Stop'\n"
        "[Console]::WriteLine('FRP_PROBE_VERSION=' + $PSVersionTable.PSVersion.ToString())\n"
        "[Console]::WriteLine('FRP_PROBE_EDITION=' + $PSVersionTable.PSEdition)\n"
        "[Console]::WriteLine('FRP_PROBE_PSHOME=' + $PSHOME)\n"
        "[Console]::WriteLine('FRP_PROBE_IS64BIT=' + [Environment]::Is64BitProcess)\n"
        "[Console]::WriteLine('FRP_PROBE_MODULEPATH=' + $env:PSModulePath)\n"
        "[Console]::WriteLine('FRP_PROBE_WINPSMODULEPATH=' + $env:WinPSModulePath)\n"
        "[Console]::WriteLine('FRP_PROBE_AUTOLOAD=' + [string]$PSModuleAutoLoadingPreference)\n"
        "foreach ($loaded in @(Get-Module -Name Microsoft.PowerShell.Utility)) {\n"
        "  [Console]::WriteLine('FRP_PROBE_INITIAL_UTILITY=' + $loaded.Path)\n"
        "}\n"
        "$command = Get-Command -Name 'Get-FileHash' -ErrorAction Stop\n"
        "[Console]::WriteLine('FRP_PROBE_COMMAND_TYPE=' + $command.CommandType)\n"
        "[Console]::WriteLine('FRP_PROBE_COMMAND_MODULE=' + $command.ModuleName)\n"
        "[Console]::WriteLine('FRP_PROBE_COMMAND_MODULE_PATH=' + $command.Module.Path)\n"
        "[Console]::WriteLine('FRP_PROBE_COMMAND_MODULE_VERSION=' + $command.Module.Version)\n"
        '$hash = (& $command -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()\n'
        '[ordered]@{ version = $PSVersionTable.PSVersion.ToString(); '
        'edition = $PSVersionTable.PSEdition; module = $command.ModuleName; sha256 = $hash } '
        '| ConvertTo-Json -Compress\n',
        encoding="utf-8",
    )
    command = [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned",
               "-File", str(probe), "-Path", str(payload)]
    # A child-only negative control: never modify the parent or machine module path.
    inherited = windows_powershell_environment(parent)
    inherited["PSMODULEPATH"] = str(unavailable)
    rejected = subprocess.run(command, env=inherited, text=True, encoding="utf-8",
                              errors="replace", stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=15)
    evidence_path = logs / "windows-module-probes.json"
    evidence = {"schemaVersion": 1, "negativeModulePath": str(unavailable),
                "expectedSha256": digest(payload), "negative": module_probe_snapshot(rejected),
                "restored": None}
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    restored = subprocess.run(command, env=windows_powershell_environment(inherited),
                              text=True, encoding="utf-8", errors="replace",
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    evidence["restored"] = module_probe_snapshot(restored)
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    # Collect both real child outcomes first, but preserve every existing pass condition.
    require(rejected.returncode != 0 and "Get-FileHash" in rejected.stdout + rejected.stderr,
            "Empty module search path did not reproduce the Windows cmdlet-resolution failure; "
            f"exit={rejected.returncode}; see {evidence_path.name}")
    require(restored.returncode == 0,
            "Windows PowerShell default module restoration failed: "
            f"{(restored.stdout + restored.stderr)[-2000:]}")
    result = json.loads(restored.stdout.splitlines()[-1])
    require(result["version"].startswith("5.1.") and result["edition"] == "Desktop",
            "The native staging regression requires actual Windows PowerShell 5.1")
    require(result["module"] == "Microsoft.PowerShell.Utility" and
            result["sha256"] == digest(payload), "Restored native SHA-256 differs from Python")
    require(dict(os.environ) == parent, "Windows child setup modified the parent environment")
    return {"status": "PASS", "negativeControl": "isolated_empty_module_directory",
            "negativeExitCode": rejected.returncode, "restoredExitCode": restored.returncode,
            "powershellVersion": result["version"], "module": result["module"],
            "sampleBytes": payload.stat().st_size, "sha256": result["sha256"],
            "parentEnvironmentUnchanged": True}


def staging_checks(directory, manifest, binary, revision, logs):
    if os.name != "nt":
        return {"status": "NOT_RUN", "reason": "Native Windows PowerShell 5.1 is required"}
    powershell = "powershell.exe"
    script = ROOT / "tools/frp-client-stage.ps1"
    module_environment = check_windows_module_environment(directory, powershell, logs)

    def invoke(destination, expected):
        return subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned",
             "-File", str(script), "-ExpectedRevision", expected, "-Destination", str(destination)],
            cwd=ROOT, env=windows_powershell_environment(os.environ),
            text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150,
        )

    wrong = directory / "wrong-revision"
    rejected = invoke(wrong, "0" * 40)
    require(rejected.returncode != 0 and not wrong.exists(), "Wrong revision was not rejected")
    existing = directory / "existing"
    existing.mkdir()
    sentinel = existing / "preserve.txt"
    sentinel.write_bytes(b"owner-existing-directory-must-survive")
    rejected = invoke(existing, revision)
    require(rejected.returncode != 0 and sentinel.read_bytes() ==
            b"owner-existing-directory-must-survive" and len(list(existing.iterdir())) == 1,
            "Existing destination was changed")
    target = directory / "new-stage"
    staged = invoke(target, revision)
    require(staged.returncode == 0, f"Native staging failed: {staged.stdout[-3000:]}")
    receipt = json.loads((target / "receipt.json").read_text(encoding="utf-8-sig"))
    require(receipt["status"] == "staged_only" and receipt["sourceRevision"] == revision,
            "Staging receipt has wrong identity or status")
    require(receipt["version"] == manifest["candidateVersion"], "Staged wrong release")
    require(digest(target / "frpc.exe") == digest(binary), "Stager produced a different client binary")
    require(set(p.name for p in target.iterdir()) == {
        "frpc.exe", "LICENSE", "receipt.json",
        manifest["releases"][manifest["candidateVersion"]]["assets"]["windows-amd64"]["file"],
    }, "Stager wrote unexpected files")
    return {"status": "PASS", "wrongRevisionRejected": True, "existingDirectoryPreserved": True,
            "binarySha256": receipt["binarySha256"], "receipt": receipt,
            "moduleEnvironment": module_environment,
            "powershell": "Windows PowerShell 5.1", "executionPolicy": "process-only RemoteSigned"}


class IntegrityTests(unittest.TestCase):
    def test_module_probe_evidence_keeps_exit_and_bounded_both_streams(self):
        success = subprocess.CompletedProcess(["powershell.exe"], 0, "metadata\n{}\n", "")
        snapshot = module_probe_snapshot(success)
        self.assertEqual((snapshot["exitCode"], snapshot["stdout"], snapshot["stderr"]),
                         (0, success.stdout, ""))
        failed = subprocess.CompletedProcess(["powershell.exe"], 1, "s" * 17000, "e" * 18000)
        snapshot = module_probe_snapshot(failed)
        self.assertEqual(snapshot["exitCode"], 1)
        self.assertEqual((len(snapshot["stdout"]), len(snapshot["stderr"])), (16384, 16384))
        self.assertEqual((snapshot["stdoutCharacters"], snapshot["stderrCharacters"]), (17000, 18000))

    def test_windows_child_environment_preserves_everything_except_module_search_path(self):
        parent = {"PSMODULEPATH": "pwsh7-upper", "PSModulePath": "pwsh7-mixed",
                  "psmodulepath": "pwsh7-lower", "WinPSModulePath": "preserve-winps-hint",
                  "PSModulePathExtra": "preserve-unrelated", "PATH": "preserve-executable-path",
                  "HTTPS_PROXY": "preserve-proxy", "PSExecutionPolicyPreference": "RemoteSigned"}
        before = parent.copy()
        expected = {"WinPSModulePath": "preserve-winps-hint", "PSModulePathExtra": "preserve-unrelated",
                    "PATH": "preserve-executable-path", "HTTPS_PROXY": "preserve-proxy",
                    "PSExecutionPolicyPreference": "RemoteSigned"}
        self.assertEqual(windows_powershell_environment(parent), expected)
        self.assertEqual(parent, before)
        self.assertEqual(windows_powershell_environment(expected), expected)
        self.assertIsNot(windows_powershell_environment(expected), expected)

    def test_manifest_rejects_untrusted_source_and_unknown_fields(self):
        good = json.loads(MANIFEST.read_text())
        for change in ("source", "unknown", "size"):
            bad = copy.deepcopy(good)
            asset = bad["releases"][bad["candidateVersion"]]["assets"]["linux-amd64"]
            if change == "source":
                asset["url"] = "https://example.invalid/frp.tar.gz"
            elif change == "unknown":
                asset["skipChecksum"] = True
            else:
                asset["sizeBytes"] = MAX_MEMBER + 1
            with self.assertRaises(ContractError):
                manifest_data(bad)

    def test_corrupt_cache_is_rejected_without_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "archive.zip"
            path.write_bytes(b"tampered")
            asset = {"sizeBytes": len(b"tampered"), "sha256": "0" * 64}
            with self.assertRaises(ContractError):
                verify_archive(path, asset)
            self.assertEqual(path.read_bytes(), b"tampered")

    def test_archive_symlink_is_never_extracted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "bad.tar.gz"
            with tarfile.open(archive, "w:gz") as package:
                entry = tarfile.TarInfo("frp_0.71.1_linux_amd64/frpc")
                entry.type = tarfile.SYMTYPE
                entry.linkname = "/outside-fixture"
                package.addfile(entry)
            with self.assertRaises(ContractError):
                extract_binaries(archive, "0.71.1", "linux-amd64", root / "extracted")
            self.assertFalse((root / "extracted/frpc").exists())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True, help="New report directory")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / "tmp/frp-verified-downloads")
    args = parser.parse_args()
    require(not args.output_dir.exists() and not args.output_dir.is_symlink(),
            "Report directory already exists; select a new explicitly owned directory")
    args.output_dir.mkdir(parents=True)
    logs = args.output_dir.resolve()
    report = {"schemaVersion": 1, "success": False, "liveApply": False,
              "publicFrpsCompatibility": "NOT_VERIFIED", "startedAt": time.time(),
              "runner": {"platform": platform.platform(), "python": platform.python_version()},
              "artifacts": [], "runs": []}
    try:
        require(platform.machine().lower() in {"x86_64", "amd64"}, "Only amd64 is supported")
        require(sys.platform in {"linux", "win32"}, "Only Linux and Windows are supported")
        target = "windows-amd64" if os.name == "nt" else "linux-amd64"
        manifest = manifest_data(json.loads(MANIFEST.read_text()))
        report["manifestSha256"] = digest(MANIFEST)
        revision = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                                           text=True, timeout=10).strip()
        report["sourceRevision"] = revision
        report["sourceDirty"] = bool(subprocess.check_output(
            ["git", "-C", str(ROOT), "status", "--porcelain=v1"], text=True, timeout=10).strip())
        report["sourceFiles"] = {name: digest(ROOT / name) for name in (
            "tools/deployment/frp-release.json", "tools/frp-client-stage.ps1",
            "tools/test_frp_health_contract.py", "docs/deployment/FRP_HEALTH_COUNTER.md",
            ".github/workflows/frp-health-contract.yml",
        )}
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(IntegrityTests)
        checks = unittest.TextTestRunner(verbosity=1).run(suite)
        require(checks.wasSuccessful(), "Artifact integrity checks failed")
        report["integrityTests"] = checks.testsRun
        with tempfile.TemporaryDirectory(prefix="asa-frp-health-") as temporary:
            workspace = Path(temporary)
            candidate_binary = None
            for role in ("baseline", "candidate"):
                version = manifest[f"{role}Version"]
                asset = manifest["releases"][version]["assets"][target]
                archive = download(asset, args.cache_dir)
                binaries = extract_binaries(archive, version, target, workspace / f"{role}-binaries")
                binary_versions = {}
                for name, binary in binaries.items():
                    actual = subprocess.check_output([str(binary), "--version"], text=True,
                                                     timeout=5, env=native_environment()).strip()
                    require(actual == version, "Native binary version differs from the pinned release")
                    binary_versions[name] = {"version": actual, "sha256": digest(binary)}
                report["artifacts"].append({"role": role, "target": target, **asset,
                                             "binaries": binary_versions})
                print(f"Running actual {role} FRP {version} on loopback", flush=True)
                result = fixture(version, role, binaries, workspace / role, logs)
                report["runs"].append(result)
                if role == "candidate":
                    candidate_binary = binaries["frpc"]
            report["staging"] = staging_checks(workspace, manifest, candidate_binary, revision, logs)
        report["success"] = True
        print("Candidate PASS; baseline defect EXPECTED_DEFECT_REPRODUCED; public compatibility NOT_VERIFIED",
              flush=True)
        return 0
    except (Exception, KeyboardInterrupt) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        print(report["error"], file=sys.stderr, flush=True)
        return 1
    finally:
        report["finishedAt"] = time.time()
        (logs / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())

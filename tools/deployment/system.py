"""Local process execution, installation identity and exclusive operation locks."""

from contextlib import contextmanager
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

from .contracts import Blocked, atomic_json, attest_database_targets, read_env, require


def run(args, *, cwd=None, env=None, capture=False, output=None, input_data=None):
    started = time.monotonic()
    try:
        result = subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, input=input_data,
                                stdout=output if output else subprocess.PIPE if capture else None,
                                stderr=subprocess.PIPE if capture or output else None,
                                text=not output, encoding="utf-8" if not output else None,
                                errors="replace" if not output else None)
    except OSError as exc:
        raise Blocked("TOOL", f"Cannot execute {args[0]}: {exc}", "Install the required tool and retry.") from exc
    require(result.returncode == 0, "COMMAND", f"{Path(str(args[0])).name} {args[1] if len(args) > 1 else ''} failed (exit {result.returncode}).",
            "Inspect the named stage. Running data is preserved; never delete volumes to retry.")
    if not capture and not output:
        print(f"STAGE elapsed={time.monotonic() - started:.1f}s tool={Path(str(args[0])).name}", flush=True)
    return result.stdout.strip() if capture else result


@contextmanager
def operation_lock(root):
    path = Path(root) / ".asa" / "operation.lock"
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    stream = path.open("a+b")
    try:
        if stream.seek(0, os.SEEK_END) == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise Blocked("LOCKED", "Another maintenance operation is running.", "Wait for it to finish; do not start a second updater.") from exc
        yield
    finally:
        stream.close()


class Installation:
    def __init__(self, root, profile=None):
        self.root = Path(root).resolve()
        self.state = self.root / ".asa"
        self.env = read_env(self.root / ".env") if (self.root / ".env").exists() else {}
        self.settings = json.loads((self.state / "installation.json").read_text(encoding="utf-8")) if (self.state / "installation.json").exists() else {}
        self.profile = profile or self.settings.get("profile", "production")
        require(self.profile in ("dev", "production", "staging", "base"), "PROFILE", "Unsupported profile.")
        self.project = self.env.get("COMPOSE_PROJECT_NAME", "asa-lab-dev")
        import re
        require(re.fullmatch(r"[a-z0-9][a-z0-9_-]*", self.project), "PROJECT", "Invalid project name.")
        self.files = ["compose.yaml"] + ([] if self.profile == "base" else [f"compose.{self.profile}.yaml"])
        if (self.root / "compose.frp.yaml").exists():
            self.files.append("compose.frp.yaml")
        self.process_env = dict(os.environ)
        # The private environment is authoritative; shell leftovers cannot redirect data.
        for key in tuple(self.process_env):
            if key.startswith(("ASA_", "COMPOSE_", "POSTGRES_", "MIGRATION_")) or key == "APP_DATABASE_URL":
                self.process_env.pop(key)
        self.process_env.update(self.env)
        self.process_env["COMPOSE_PROJECT_NAME"] = self.project
        if (self.state / "installed-release.json").exists():
            from .contracts import validate_release
            installed = validate_release(json.loads((self.state / "installed-release.json").read_text(encoding="utf-8")))
            self.process_env.update({"ASA_BUILD_REVISION": installed["revision"], "ASA_EXPECTED_SCHEMA_VERSION": str(installed["schema"])})
            for service, image in installed["images"].items():
                self.process_env[f"ASA_{service.upper()}_IMAGE"] = image
        self.compose_args = ["docker", "compose", "--project-directory", str(self.root), "-p", self.project]
        for file in self.files:
            self.compose_args += ["-f", str(self.root / file)]

    def compose(self, *args, **kwargs):
        return run(self.compose_args + list(args), cwd=self.root, env=self.process_env, **kwargs)

    def git(self, *args):
        return run(["git", *args], cwd=self.root, capture=True)

    def containers(self):
        ids = run(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project"], capture=True).split()
        if not ids:
            return []
        # Read only metadata required for identity; do not emit private environment.
        template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}'
        return [json.loads(line) for line in run(["docker", "inspect", "--format", template, *ids], capture=True).splitlines()]

    def identity(self, existing=True):
        records = self.containers()
        selected = {}
        expected_files = [os.path.normcase(str(self.root / f)).replace("\\", "/") for f in self.files]
        for record in records:
            labels = record["labels"] or {}
            service = labels.get("com.docker.compose.service")
            if service not in ("postgres", "api", "web", "scratch", "minio"):
                continue
            project = labels.get("com.docker.compose.project")
            root = labels.get("com.docker.compose.project.working_dir", "")
            same_root = bool(root) and os.path.normcase(str(Path(root).resolve())) == os.path.normcase(str(self.root))
            if project != self.project:
                require(not same_root, "IDENTITY_PROJECT", "This directory already belongs to another Compose project.")
                if not existing and (project or "").startswith("asa-lab"):
                    raise Blocked("IDENTITY_EXISTING", "An ASA installation already exists.", "Use the canonical PostgreSQL directory; do not install a second stack.")
                continue
            require(self.env, "IDENTITY_ENV", "Existing installation has no private .env.")
            require(same_root, "IDENTITY_ROOT", "Container belongs to another deployment directory.", "Run from the directory recorded on PostgreSQL.")
            actual_files = [os.path.normcase(str(Path(item).resolve())).replace("\\", "/") for item in labels.get("com.docker.compose.project.config_files", "").split(",") if item]
            require(actual_files == expected_files, "IDENTITY_FILES", "Compose profile/transport differs from the existing installation.", "Preserve the existing profile and transport overlays.")
            require(service not in selected, "IDENTITY_DUPLICATE", f"Multiple {service} containers in the installation.")
            selected[service] = record
        if existing:
            require("postgres" in selected, "IDENTITY_MISSING", "Canonical PostgreSQL container is absent.")
        if selected:
            self.data_identity(selected)
        return selected

    def container_environment(self, record):
        # Capture privately in memory; never print credential-bearing inspect data.
        values = json.loads(run(["docker", "inspect", "--format", "{{json .Config.Env}}", record["id"]], capture=True))
        return dict(value.split("=", 1) for value in values if "=" in value)

    def data_identity(self, records):
        config = json.loads(self.compose("config", "--format", "json", capture=True))
        for service, destination in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data")):
            if service not in records:
                continue
            declared = [v for v in config["services"][service].get("volumes", []) if v["target"] == destination]
            actual = [v for v in records[service].get("mounts", []) if v["Destination"] == destination]
            require(len(declared) == len(actual) == 1 and declared[0]["type"] == actual[0]["Type"] == "volume",
                    "IDENTITY_VOLUME", f"Unsupported or missing persistent mount for {service}.")
            name = config["volumes"].get(declared[0]["source"], {}).get("name")
            require(name and name == actual[0].get("Name"), "IDENTITY_VOLUME", f"Persistent volume identity changed for {service}.",
                    "Keep the original volume; a data migration requires a separate explicit operation.")
        if "postgres" in records:
            attest_database_targets(config, self.container_environment(records["postgres"]),
                                    self.container_environment(records["api"]) if "api" in records else None)

    def readiness(self, revision=None, schema=None):
        port = int(self.env.get("ASA_WEB_PORT", "4610"))
        def read(path):
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/{path}", timeout=5) as response:
                return json.load(response)
        ready, web = read("health/ready"), read("build-metadata.json")
        deployment = ready.get("deployment", {})
        rev = revision or deployment.get("revision")
        require(ready.get("status") == "ready" and deployment.get("revision") == rev
                and web.get("revision") == rev and deployment.get("synchronized") is True,
                "HEALTH", "Web/API revisions or readiness differ.")
        require(schema is None or deployment.get("schemaVersion") == deployment.get("expectedSchemaVersion") == schema,
                "HEALTH", "Schema versions differ.")
        scratch = self.compose("exec", "-T", "scratch", "wget", "-qO-", "http://127.0.0.1:8080/asa-commit.txt", capture=True)
        require(scratch == rev, "HEALTH", "Scratch revision differs.")
        scratch_port = int(self.env.get("ASA_BLOCKS_PORT", "4613"))
        with urllib.request.urlopen(f"http://127.0.0.1:{scratch_port}/healthz", timeout=5) as response:
            require(response.status == 200, "HEALTH", "Published Scratch port is unavailable.")
        return {"revision": rev, "schema": deployment.get("schemaVersion")}

    def wait_ready(self, revision, schema):
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            try:
                return self.readiness(revision, schema)
            except (Blocked, OSError, ValueError):
                time.sleep(3)
        raise Blocked("HEALTH", "New services did not become ready within five minutes.", "Inspect migration and service logs; no database rollback is automatic.")

    def receipt(self, value):
        value = {"at": dt.datetime.now(dt.timezone.utc).isoformat(), **value}
        atomic_json(self.state / "last-operation.json", value)

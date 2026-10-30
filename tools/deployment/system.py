"""Local process execution, installation identity and exclusive operation locks."""

from contextlib import contextmanager
import datetime as dt
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import urllib.request

from .contracts import Blocked, atomic_json, attest_database_targets, attest_proxy_policy, read_env, require
from .resources import pool_configuration


def run(args, *, cwd=None, env=None, capture=False, output=None, input_data=None, input_file=None, timeout=None):
    started = time.monotonic()
    try:
        result = subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, input=input_data, stdin=input_file,
                                stdout=output if output else subprocess.PIPE if capture else None,
                                stderr=subprocess.PIPE if capture or output else None,
                                text=not output, encoding="utf-8" if not output else None,
                                errors="replace" if not output else None, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise Blocked("COMMAND_TIMEOUT", f"{Path(str(args[0])).name} exceeded its time budget.",
                      "Inspect the recorded operation before retrying; its outcome may be incomplete.") from exc
    except OSError as exc:
        raise Blocked("TOOL", f"Cannot execute {args[0]}: {exc}", "Install the required tool and retry.") from exc
    require(result.returncode == 0, "COMMAND", f"{Path(str(args[0])).name} {args[1] if len(args) > 1 else ''} failed (exit {result.returncode}).",
            "Inspect the named stage. Running data is preserved; never delete volumes to retry.")
    if not capture and not output:
        print(f"STAGE elapsed={time.monotonic() - started:.1f}s tool={Path(str(args[0])).name}", flush=True)
    return result.stdout.strip() if capture else result


@contextmanager
def operation_lock(root, *, inherited_fd=None, operator_uid=None):
    """One lock shared by all managers, backups and setup, transferable by exec.

    A handoff keeps the *same open file description*, so there is no unlock
    window. Descriptor numbers and environment variables grant no authority:
    the opened descriptor must match the private canonical lock inode.
    """
    from .paths import plain_paths
    path = Path(root) / ".asa" / "operation.lock"
    plain_paths(path, ())
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = path.parent.stat()
    expected_uid = (os.geteuid() if os.name != "nt" else None) if operator_uid is None else operator_uid
    require(os.name == "nt" or os.geteuid() in (0, expected_uid), "LOCK_OWNER", "Only the proven operator or root supervisor can hold this lock.")
    # Legacy managers used an owner-controlled 0755 state directory. Reading
    # the directory does not permit replacing its lock; group/other write does.
    # New setup secret stores enforce their separate 0700 contract.
    require(os.name == "nt" or (metadata.st_uid == expected_uid and not metadata.st_mode & 0o022),
            "LOCK_OWNER", "The operation directory has unsafe ownership or permissions.")
    if inherited_fd is None:
        if os.name == "nt":
            descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
        else:
            # Walk lexical components using directory FDs. In particular a
            # privileged supervisor must not follow a raced user symlink.
            directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
            try:
                for component in path.absolute().parent.parts[1:]:
                    following = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                    os.close(directory)
                    directory = following
                created = False
                try:
                    descriptor = os.open(path.name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
                    created = True
                except FileExistsError:
                    descriptor = os.open(path.name, os.O_RDWR | os.O_NOFOLLOW, dir_fd=directory)
                if created and os.geteuid() == 0 and expected_uid != 0:
                    os.fchown(descriptor, expected_uid, -1)
            finally:
                os.close(directory)
    else:
        require(type(inherited_fd) is int and inherited_fd >= 3, "LOCK_HANDOFF", "Invalid inherited operation lock.")
        descriptor = os.dup(inherited_fd)
    stream = os.fdopen(descriptor, "r+b")
    try:
        metadata, actual = os.fstat(stream.fileno()), path.stat(follow_symlinks=False)
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1
                and (metadata.st_dev, metadata.st_ino) == (actual.st_dev, actual.st_ino)
                and (os.name == "nt" or (metadata.st_uid == expected_uid and not metadata.st_mode & 0o022)),
                "LOCK_HANDOFF", "Operation lock identity or permissions differ.")
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
        os.set_inheritable(stream.fileno(), False)
        if os.name != "nt":
            os.fchmod(stream.fileno(), 0o600)
        yield stream.fileno()
    finally:
        stream.close()


class Installation:
    def __init__(self, root, profile=None):
        self.root = Path(root).resolve()
        self.state = self.root / ".asa"
        self.env = read_env(self.root / ".env") if (self.root / ".env").exists() else {}
        attest_proxy_policy(self.env)
        pool_configuration(self.env)
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
            if service not in ("postgres", "api", "web", "scratch", "minio", "search"):
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
            require(config["services"]["postgres"]["image"] == records["postgres"]["image"], "DATABASE_ENGINE",
                    "The PostgreSQL engine image changed.", "Upgrade the database engine as a separate backed-up operation before application updates.")
            attest_database_targets(config, self.container_environment(records["postgres"]),
                                    self.container_environment(records["api"]) if "api" in records else None)

    def readiness(self, revision=None, schema=None, *, deadline=None):
        def remaining(maximum=None):
            if deadline is None:
                return maximum
            available = deadline - time.monotonic()
            require(available > 0, "HEALTH_TIMEOUT", "Readiness exceeded the recorded operation deadline.",
                    "Inspect the pinned runtime; a late response is not acceptance within the write-freeze window.")
            return min(available, maximum) if maximum is not None else available

        def command(*args):
            options = {"capture": True}
            if deadline is not None:
                options["timeout"] = remaining()
            output = self.compose(*args, **options)
            remaining()
            return output

        port = int(self.env.get("ASA_WEB_PORT", "4610"))
        def read(path):
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/{path}", timeout=remaining(5)) as response:
                payload = json.load(response)
            remaining()
            return payload
        ready, web = read("health/ready"), read("build-metadata.json")
        deployment = ready.get("deployment", {})
        rev = revision or deployment.get("revision")
        require(ready.get("status") == "ready" and deployment.get("revision") == rev
                and web.get("revision") == rev and deployment.get("synchronized") is True,
                "HEALTH", "Web/API revisions or readiness differ.")
        require(schema is None or deployment.get("schemaVersion") == deployment.get("expectedSchemaVersion") == schema,
                "HEALTH", "Schema versions differ.")
        scratch = command("exec", "-T", "scratch", "wget", "-qO-", "http://127.0.0.1:8080/asa-commit.txt")
        require(scratch == rev, "HEALTH", "Scratch revision differs.")
        if self.process_env.get("ASA_SEARCH_IMAGE"):
            search = command("exec", "-T", "search", "cat", "/usr/local/share/asa-search/asa-commit.txt")
            require(search == rev, "HEALTH", "Search revision differs.")
            command("exec", "-T", "search", "/usr/local/searxng/.venv/bin/python", "-c",
                    "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3).read()")
        scratch_port = int(self.env.get("ASA_BLOCKS_PORT", "4613"))
        with urllib.request.urlopen(f"http://127.0.0.1:{scratch_port}/healthz", timeout=remaining(5)) as response:
            require(response.status == 200, "HEALTH", "Published Scratch port is unavailable.")
        remaining()
        return {"revision": rev, "schema": deployment.get("schemaVersion")}

    def wait_ready(self, revision, schema):
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            try:
                return self.readiness(revision, schema, deadline=deadline)
            except (Blocked, OSError, ValueError):
                time.sleep(min(3, max(0, deadline - time.monotonic())))
        raise Blocked("HEALTH", "New services did not become ready within five minutes.", "Inspect migration and service logs; no database rollback is automatic.")

    def receipt(self, value):
        value = {"at": dt.datetime.now(dt.timezone.utc).isoformat(), **value}
        atomic_json(self.state / "last-operation.json", value)

"""Explicit, read-only attestation for the supported source-mounted review layout.

This adapter is used only by the legacy transition commands.  It deliberately
does not make ordinary Installation.identity/readiness accept a legacy runtime.
Plans contain hashes of private values, never environment or credential values.
"""

from copy import deepcopy
import hashlib
import json
import ntpath
import os
from pathlib import Path
import posixpath
import re
import stat
import urllib.error
import urllib.request

from .contracts import Blocked, REPOSITORY, attest_editor_env, file_hash, require
from .paths import plain_paths
from .system import Installation, run


REVIEW_FILES = ("compose.yaml", "compose.dev.yaml", ".asa/local-review/compose.review.yaml")
REVIEW_SERVICES = frozenset(("postgres", "migration", "minio", "minio-init", "api", "web", "scratch", "search"))
REVIEW_WRITERS = frozenset(("api", "web", "scratch", "minio"))
REVIEW_NETWORKS = {"postgres": {"database"}, "migration": {"database"}, "minio": {"application"},
                   "minio-init": {"application"}, "api": {"application", "database"},
                   "web": {"application", "scratch-runtime"}, "scratch": {"scratch-runtime"}, "search": {"application"}}
SOURCE_BINDS = {
    ("api", "/workspace/apps/api/src"): "apps/api/src",
    ("api", "/workspace/packages/contracts/dist"): "packages/contracts/dist",
    ("api", "/workspace/.asa/local-review"): ".asa/local-review",
    ("web", "/workspace/apps/web/src"): "apps/web/src",
    ("web", "/workspace/.asa/local-review"): ".asa/local-review",
}
REVIEW_API_ENTRYPOINT = ["/bin/sh", "/workspace/.asa/local-review/api-watch.sh"]
REVIEW_WEB_ENTRYPOINT = ["node", "/workspace/node_modules/vite/bin/vite.js", "--config", "/workspace/.asa/local-review/vite.config.mts"]
SHA = re.compile(r"[a-f0-9]{40}")
IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def normalized_path(value):
    """Compare Windows Compose labels without accepting container-side aliases."""
    return os.path.normcase(os.path.abspath(str(value))).replace("\\", "/").rstrip("/")


def plain_input(root, relative):
    path = Path(relative)
    require(isinstance(relative, str) and relative and not path.is_absolute()
            and ".." not in path.parts and "\\" not in relative and ":" not in relative,
            "LEGACY_PATH", "An input path is not a canonical relative path.")
    try:
        plain_paths(root, [relative])
    except (OSError, ValueError) as failure:
        raise Blocked("LEGACY_PATH", "A legacy input is redirected or cannot be verified.",
                      "Preserve the files and inspect the path; links and reparse points are not supported.") from failure
    target = Path(root) / relative
    require(target.resolve().is_relative_to(Path(root).resolve()), "LEGACY_PATH", "A legacy input escapes the installation.")
    return target


def input_inventory(root, relative_paths):
    """Hash every mounted byte and explicit file; reject links, devices and races."""
    result = {}
    for relative in sorted(set(relative_paths)):
        path = plain_input(root, relative)
        require(path.exists(), "LEGACY_INPUT", "A required legacy input is absent.")
        paths = [path] if path.is_file() else sorted(path.rglob("*"))
        for candidate in paths:
            name = candidate.relative_to(root).as_posix()
            plain_input(root, name)
            info = candidate.lstat()
            if stat.S_ISDIR(info.st_mode):
                continue
            require(stat.S_ISREG(info.st_mode), "LEGACY_INPUT", "A runtime input is not a regular file.")
            before = (info.st_size, info.st_mtime_ns, info.st_ino)
            checksum = file_hash(candidate)
            after = candidate.stat()
            require(before == (after.st_size, after.st_mtime_ns, after.st_ino),
                    "LEGACY_DRIFT", "A runtime input changed while it was read.")
            result[name] = {"bytes": info.st_size, "sha256": checksum}
    return result


def configured_ports(service):
    ports = []
    for port in service.get("ports", []):
        require(isinstance(port, dict) and port.get("host_ip") == "127.0.0.1"
                and port.get("protocol", "tcp") == "tcp" and str(port.get("published", "")).isdigit(),
                "LEGACY_PORT", "Legacy ports must be explicit existing loopback TCP bindings.")
        ports.append((str(port["target"]) + "/tcp", "127.0.0.1", str(port["published"])))
    return sorted(ports)


def ancestor_pids(records):
    """Only the current invocation's launch chain is exempt from author checks."""
    parents = {int(record["pid"]): int(record.get("parent", 0)) for record in records}
    exempt, current = {os.getpid()}, os.getpid()
    while parents.get(current) and parents[current] not in exempt:
        current = parents[current]
        exempt.add(current)
    return exempt


def actual_ports(record):
    return sorted((target, item["HostIp"], item["HostPort"])
                  for target, bindings in (record.get("ports") or {}).items()
                  for item in (bindings or []))


def tmpfs_mounts(value):
    if isinstance(value, dict):
        items = value.items()
    else:
        items = [str(item).partition(":")[::2] for item in (value or [])]
    return sorted((path, tuple(sorted(option for option in str(options).split(",") if option))) for path, options in items)


def security_options(value):
    return sorted("no-new-privileges" if option in ("no-new-privileges:true", "no-new-privileges=true") else option
                  for option in (value or []))


def validate_review_configuration(root, base, config):
    """Validate the reviewed overlay's actual semantics, not its filename.

    The supported policy is intentionally closed: a new layout needs an explicit
    reviewed adapter and tests.  Root-specific locations are derived, not stored.
    """
    require(set(base.get("services", {})) == set(config.get("services", {})) == REVIEW_SERVICES,
            "LEGACY_SERVICES", "The review layout must contain exactly the eight known ASA services.")
    require({k: v for k, v in base.items() if k != "services"}
            == {k: v for k, v in config.items() if k != "services"},
            "LEGACY_OVERLAY", "The review overlay changes installation networks, volumes or project.")
    for name in REVIEW_SERVICES - {"api", "web"}:
        require(config["services"][name] == base["services"][name],
                "LEGACY_OVERLAY", f"The review overlay changes unsupported service {name}.")
    validate_review_services(root, base["services"], config["services"], config.get("name"))
    expected_volumes = {"postgres-data", "blocks-object-data", "application-logs"}
    require(set(config.get("volumes", {})) == expected_volumes,
            "LEGACY_VOLUME", "Unknown persistent storage is not covered by this adapter.")
    project = config.get("name")
    for key, volume in config["volumes"].items():
        require(volume.get("name") == f"{project}_{key}" and not volume.get("external")
                and not volume.get("driver_opts"), "LEGACY_VOLUME", "A volume is foreign or redirected.")
    require(set(config.get("networks", {})) == {"application", "database", "scratch-runtime"},
            "LEGACY_NETWORK", "Unknown network in the legacy layout.")
    for key, network in config["networks"].items():
        require(network.get("name") == f"{project}_{key}" and not network.get("external")
                and not network.get("driver_opts") and not network.get("ipam"),
                "LEGACY_NETWORK", "A legacy network is foreign or manually addressed.")
        require(bool(network.get("internal", False)) == (key == "database"),
                "LEGACY_NETWORK", "Legacy network isolation differs from the supported layout.")
    for name, service in config["services"].items():
        require(not service.get("privileged") and not service.get("devices") and not service.get("cap_add")
                and not service.get("network_mode") and not service.get("pid") and not service.get("ipc")
                and not service.get("volumes_from"), "LEGACY_SECURITY", "Unsupported container privilege or namespace.")
        require(set(service.get("networks", {})) == REVIEW_NETWORKS[name],
                "LEGACY_NETWORK", "Service network membership differs from the supported layout.")
        for mount in service.get("volumes", []):
            if mount.get("type") == "bind":
                relative = SOURCE_BINDS.get((name, mount.get("target")))
                if relative is None and name == "api" and mount.get("target") == "/var/lib/asa-logs":
                    relative = ".asa/diagnostics/store"
                require(relative is not None and mount.get("read_only") is True,
                        "LEGACY_MOUNT", "Unknown or writable review bind mount.")
                require(normalized_path(mount.get("source", "")) == normalized_path(Path(root) / relative),
                        "LEGACY_MOUNT", "Review mount source differs from the supported input.")
                plain_input(root, relative)
            else:
                allowed = {("postgres", "/var/lib/postgresql/data"): "postgres-data",
                           ("minio", "/data"): "blocks-object-data",
                           ("api", "/var/lib/asa-application-logs"): "application-logs"}
                require(mount.get("type") == "volume"
                        and mount.get("source") == allowed.get((name, mount.get("target"))),
                        "LEGACY_MOUNT", "Unknown persistent review mount.")
        ports = configured_ports(service)
        require([value[0] for value in ports] == ({"api": ["4611/tcp"], "web": ["8080/tcp"], "scratch": ["8080/tcp"]}.get(name, [])),
                "LEGACY_PORT", "Unknown service publication in the review layout.")
    return config


def review_healthcheck(service):
    endpoint = "http://127.0.0.1:4611/health/live" if service == "api" else "http://127.0.0.1:8080/"
    return {"test": ["CMD", "node", "-e", f"fetch('{endpoint}').then(r=>{{if(!r.ok)process.exit(1)}}).catch(()=>process.exit(1))"],
            "interval": "10s", "timeout": "5s", "retries": 12,
            "start_period": "45s" if service == "api" else "30s"}


def validate_review_services(root, base, services, project):
    """The API watcher/Vite shape observed in the source review installation.

    These fields are an explicit legacy compatibility policy, not new runtime
    configuration.  Every remaining field must equal the tracked base recipe.
    Exact existing image IDs and every mounted byte are additionally sealed in
    the transition plan; the image's tag is never treated as provenance.
    """
    api, web = services["api"], services["web"]
    revision = api.get("environment", {}).get("ASA_BUILD_REVISION")
    require(isinstance(revision, str) and SHA.fullmatch(revision)
            and web.get("environment", {}).get("VITE_ASA_BUILD_REVISION") == revision,
            "LEGACY_OVERLAY", "Review build declarations need the same explicit source revision.")
    image = api.get("image", "")
    require(isinstance(project, str) and image == web.get("image")
            and image == f"{project}-workspace:ai-review-{revision[:8]}",
            "LEGACY_IMAGE", "The review services do not use the declared shared workspace image.")
    entry = base["api"].get("environment", {}).get("ASA_BLOCKS_RUNTIME_ORIGIN")
    for name, actual in (("api", api), ("web", web)):
        expected = deepcopy(base[name])
        expected.pop("build", None)
        expected.update(image=image, working_dir="/workspace", user="0:0", read_only=False,
                        entrypoint=REVIEW_API_ENTRYPOINT if name == "api" else REVIEW_WEB_ENTRYPOINT,
                        healthcheck=review_healthcheck(name))
        expected["environment"] = {**expected.get("environment", {}), **({
            "ASA_BUILD_REVISION": revision,
            "NODE_EXTRA_CA_CERTS": "/workspace/docker/certs/russian-trusted-root-ca.pem",
            "ASA_COMFYUI_BASE_URL": "http://host.docker.internal:8188",
            "TSC_WATCHFILE": "FixedPollingInterval",
            "TSC_WATCHDIRECTORY": "DynamicPriorityPolling",
        } if name == "api" else {
            "VITE_ASA_BUILD_REVISION": revision,
            "VITE_ASA_BLOCKS_RUNTIME_ORIGIN": entry,
        })}
        # Compose versions omit false read_only and the create_host_path=true
        # default of the observed bind shorthand differently. All referenced
        # paths already exist and are separately attested; no path is created.
        # Unknown bind options, paths and modes remain part of exact comparison.
        expected["volumes"] = [*expected.get("volumes", []), *[
            {"type": "bind", "source": str(Path(root) / relative), "target": target,
             "read_only": True, "bind": {"create_host_path": True}}
            for (service, target), relative in SOURCE_BINDS.items() if service == name]]
        actual_copy = deepcopy(actual)
        for value in (expected, actual_copy):
            value.setdefault("read_only", False)
            for mount in value.get("volumes", []):
                if mount.get("type") == "bind":
                    mount["source"] = normalized_path(mount["source"])
                    if (name, mount.get("target")) in SOURCE_BINDS:
                        mount.setdefault("bind", {}).setdefault("create_host_path", True)
            value["volumes"] = sorted(value.get("volumes", []), key=lambda mount: mount["target"])
        require(expected == actual_copy, "LEGACY_OVERLAY", f"Unsupported {name} review override.",
                "Inspect the actual overlay and running configuration; a different layout requires a separately reviewed adapter.")


def attest_legacy_storage(config, env):
    require(env.get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000",
            "BACKUP_STORAGE", "Legacy transition supports only the installation's local MinIO.")
    mapping = {"ASA_OBJECT_STORAGE_ACCESS_KEY": "MINIO_ROOT_USER",
               "ASA_OBJECT_STORAGE_SECRET_KEY": "MINIO_ROOT_PASSWORD"}
    services = config["services"]
    for key, minio_key in mapping.items():
        value = env.get(key)
        require(isinstance(value, str) and value and services["minio"]["environment"].get(minio_key) == value
                and services["minio-init"]["environment"].get(key) == value
                and services["api"]["environment"].get(key) == value,
                "LEGACY_ENV", "Effective object credentials differ from preserved private configuration.")
    require(bool(env.get("ASA_OBJECT_STORAGE_BUCKET"))
            and services["api"]["environment"].get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000"
            and services["api"]["environment"].get("ASA_OBJECT_STORAGE_BUCKET") == env["ASA_OBJECT_STORAGE_BUCKET"]
            and services["minio-init"]["environment"].get("ASA_OBJECT_STORAGE_BUCKET") == env["ASA_OBJECT_STORAGE_BUCKET"],
            "LEGACY_ENV", "Effective object storage location differs from the preserved configuration.")


def assert_snapshot_equal(expected, observed, *, allow_stopped=False):
    left, right = deepcopy(expected), deepcopy(observed)
    if allow_stopped:
        # This is a quiescence assertion, not permission to ignore process state.
        # Only the four explicitly stopped writers may differ from the plan;
        # every one must actually be stopped at each copy/switch boundary.
        for name in REVIEW_WRITERS:
            require(right.get("containers", {}).get(name, {}).get("running") is False,
                    "LEGACY_DRIFT", "A legacy writer is still running or restarted during backup.")
            left["containers"][name]["running"] = False
    require(left == right, "LEGACY_DRIFT", "Installation inputs changed after the transition was planned.",
            "Keep the running installation and create a fresh reviewed plan; never reuse a stale plan.")


def mount_source_path(value):
    """Docker daemon volume paths stay POSIX even for a Windows client."""
    require(isinstance(value, (str, os.PathLike)) and str(value),
            "LEGACY_SHARED_STORAGE", "A foreign mount has no verifiable source path.")
    value = str(value)
    if re.match(r"^[A-Za-z]:[\\/]", value) or value.startswith("\\\\"):
        return ntpath.normcase(ntpath.normpath(value)).replace("\\", "/")
    require(value.startswith("/"), "LEGACY_SHARED_STORAGE", "A foreign mount source is not absolute.")
    return "/" + posixpath.normpath(value).lstrip("/")


def attest_foreign_mounts(root, config, foreign, volumes=()):
    protected_volumes = {value["name"] for value in config.get("volumes", {}).values()}
    protected_paths = [mount_source_path(root), *[mount_source_path(volume["Mountpoint"]) for volume in volumes]]
    for record in foreign:
        for mount in record.get("mounts") or []:
            require(not (mount.get("Type") == "volume" and mount.get("Name") in protected_volumes),
                    "LEGACY_SHARED_STORAGE", "A foreign container shares this installation's persistent storage.")
            if mount.get("Type") == "bind":
                source = mount_source_path(mount.get("Source", ""))
                overlap = any(source == protected or source.startswith(protected.rstrip("/") + "/")
                              or protected.startswith(source.rstrip("/") + "/") for protected in protected_paths)
                require(not overlap, "LEGACY_SHARED_STORAGE", "A foreign container shares source files or persistent storage.")


def foreign_identity(record):
    return {**{key: record.get(key) for key in ("id", "name", "imageId", "running", "mounts", "ports", "networkMode")},
            "networks": sorted((record.get("networks") or {}).keys())}


def attest_foreign_networks(config, foreign, selected):
    protected = {network["name"] for network in config["networks"].values()}
    all_records = [*selected.values(), *foreign]
    owned_ids = {record["id"] for record in selected.values()}
    for record in foreign:
        require(record.get("networkMode") != "host" and not protected.intersection(record["networks"]), "LEGACY_SHARED_NETWORK",
                "A foreign container can access this installation's private service networks.")
        # Containers sharing another container's network namespace have no
        # NetworkSettings.Networks of their own. Follow their exact namespace
        # owner as well, so an invisible SQL/S3 writer cannot pass quiescence.
        current, seen = record, set()
        while str(current.get("networkMode", "")).startswith("container:"):
            target = current["networkMode"].split(":", 1)[1]
            matches = [item for item in all_records if item["id"] == target
                       or str(item.get("name", "")).lstrip("/") == target
                       or re.fullmatch(r"[a-f0-9]{12,64}", target) and item["id"].startswith(target)]
            require(len(matches) == 1 and matches[0]["id"] not in seen,
                    "LEGACY_SHARED_NETWORK", "A foreign network namespace owner cannot be verified.")
            current = matches[0]
            seen.add(current["id"])
            require(current["id"] not in owned_ids and current.get("networkMode") != "host"
                    and not protected.intersection(current["networks"]),
                    "LEGACY_SHARED_NETWORK", "A foreign container shares an ASA network namespace.")


class LegacyInstallation(Installation):
    """The narrowly supported review adapter.  All ordinary commands stay strict."""

    def __init__(self, root, profile="dev"):
        try:
            plain_paths(root, [".env", *REVIEW_FILES])
        except (OSError, ValueError) as failure:
            raise Blocked("LEGACY_PATH", "Legacy root or configuration is redirected.", "Inspect the canonical root.") from failure
        super().__init__(root, profile)
        require(self.profile == "dev", "LEGACY_PROFILE", "Only the explicitly supported dev review layout can be adopted.")
        require(not (self.state / "installed-release.json").exists(), "LEGACY_ALREADY_INSTALLED",
                "This installation already has an official release receipt.", "Use ordinary release verification; do not downgrade or re-adopt it.")
        require(not (self.root / "compose.frp.yaml").exists(), "LEGACY_OVERLAY", "An additional transport overlay requires its own adapter.")
        require(bool(self.env), "IDENTITY_ENV", "Existing legacy private configuration is missing.")
        self.files = list(REVIEW_FILES)
        self.compose_args = ["docker", "compose", "--project-directory", str(self.root), "-p", self.project]
        for file in self.files:
            self.compose_args += ["-f", str(self.root / file)]
        self._records = None
        self._foreign = None
        self._configuration = None

    def configuration(self):
        # Base Compose is still source controlled.  Dirty overlay/source inputs
        # are explicitly inventoried; changing the base recipe needs another adapter.
        require(not self.git("status", "--porcelain", "--", *REVIEW_FILES[:2]),
                "LEGACY_BASE", "Base Compose files have unpublished changes.")
        require(self.git("remote", "get-url", "origin").removesuffix(".git") in
                (f"https://github.com/{REPOSITORY}", f"git@github.com:{REPOSITORY}"),
                "ORIGIN", "Legacy source belongs to another Git repository.")
        base_args = self.compose_args[:-2]
        base = json.loads(run(base_args + ["config", "--format", "json"], cwd=self.root,
                              env=self.process_env, capture=True))
        config = json.loads(self.compose("config", "--format", "json", capture=True))
        validate_review_configuration(self.root, base, config)
        attest_legacy_storage(config, self.env)
        require(config.get("name") == self.project, "IDENTITY_PROJECT", "Effective Compose project differs.")
        self._configuration = config
        self._base_configuration = base
        return config

    def git(self, *args):
        # Even `git status` may refresh the index unless optional locks are off.
        # This adapter never writes a Git ref, index or source file.
        return run(["git", *args], cwd=self.root,
                   env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}, capture=True)

    def containers(self):
        ids = run(["docker", "ps", "-aq"], capture=True).split()
        if not ids:
            return []
        template = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"imageId":{{json .Image}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}},"networks":{{json .NetworkSettings.Networks}},"networkMode":{{json .HostConfig.NetworkMode}}}'
        return [json.loads(line) for line in run(["docker", "inspect", "--format", template, *ids], capture=True).splitlines()]

    def identity(self, existing=True):
        require(existing, "LEGACY_EXISTING", "Legacy adoption cannot create an installation.")
        config = self.configuration()
        selected, foreign = {}, []
        expected_files = [normalized_path(self.root / name) for name in self.files]
        for record in self.containers():
            labels = record.get("labels") or {}
            root = labels.get("com.docker.compose.project.working_dir", "")
            same_root = bool(root) and normalized_path(root) == normalized_path(self.root)
            if labels.get("com.docker.compose.project") != self.project:
                require(not same_root, "IDENTITY_PROJECT", "Canonical root belongs to another project.")
                foreign.append(foreign_identity(record))
                continue
            require(same_root, "IDENTITY_ROOT", "A project container comes from another root.")
            actual_files = [normalized_path(item) for item in labels.get("com.docker.compose.project.config_files", "").split(",") if item]
            require(actual_files == expected_files, "IDENTITY_FILES", "Legacy Compose files or their order differ.")
            name = labels.get("com.docker.compose.service")
            require(name in REVIEW_SERVICES and name not in selected
                    and labels.get("com.docker.compose.oneoff", "False").lower() == "false",
                    "IDENTITY_DUPLICATE", "Unknown, duplicate or one-off service in the installation.")
            require(IMAGE_ID.fullmatch(record.get("imageId", "")), "LEGACY_IMAGE", "A container has no exact image identity.")
            require(record.get("image") == config["services"][name].get("image"),
                    "LEGACY_IMAGE", "A running image differs from the effective Compose reference.")
            require(actual_ports(record) == configured_ports(config["services"][name]),
                    "LEGACY_PORT", "Actual published ports differ from the planned configuration.")
            self._attest_mounts(name, record, config)
            self._attest_container_config(name, record, config["services"][name])
            # Runtime addresses change on restart and are never installation identity.
            networks = sorted((record.get("networks") or {}).keys())
            declared_networks = sorted(config["networks"][key]["name"] for key in config["services"][name].get("networks", {}))
            require(networks == declared_networks, "LEGACY_NETWORK", "Container networks differ from the declared ASA networks.")
            selected[name] = {**record, "networks": networks,
                              "labels": {key: value for key, value in labels.items() if key.startswith("com.docker.compose.")}}
        require(set(selected) == REVIEW_SERVICES and selected["postgres"]["running"],
                "IDENTITY_MISSING", "All eight legacy services and a running PostgreSQL are required.")
        self._volumes = self.attest_volume_ownership(config)
        attest_foreign_mounts(self.root, config, foreign, self._volumes)
        attest_foreign_networks(config, foreign, selected)
        self.data_identity(selected)
        self._records, self._foreign = selected, sorted(foreign, key=lambda item: item["id"])
        return selected

    def attest_volume_ownership(self, config):
        names = {value["name"]: key for key, value in config["volumes"].items()}
        observed = json.loads(run(["docker", "volume", "inspect", *sorted(names)], capture=True))
        require(isinstance(observed, list) and len(observed) == len(names)
                and {item.get("Name") for item in observed} == set(names),
                "LEGACY_VOLUME", "The existing volume set cannot be verified.")
        for item in observed:
            labels = item.get("Labels") or {}
            require(item.get("Driver") == "local" and item.get("Scope") == "local"
                    and not item.get("Options") and item.get("CreatedAt") and item.get("Mountpoint")
                    and labels.get("com.docker.compose.project") == self.project
                    and labels.get("com.docker.compose.volume") == names[item["Name"]],
                    "LEGACY_VOLUME", "A volume has foreign ownership or unsupported storage options.")
        # Creation time also detects removal/recreation under the same name.
        return [{key: item.get(key) for key in ("Name", "Driver", "Scope", "Options", "Labels", "CreatedAt", "Mountpoint")}
                for item in sorted(observed, key=lambda value: value["Name"])]

    def _attest_mounts(self, name, record, config):
        expected = []
        for mount in config["services"][name].get("volumes", []):
            kind = mount["type"]
            source = config["volumes"][mount["source"]]["name"] if kind == "volume" else normalized_path(mount["source"])
            expected.append((kind, source, mount["target"], not mount.get("read_only", False)))
        observed = []
        for mount in record.get("mounts", []):
            kind = mount.get("Type")
            require(kind in ("bind", "volume"), "LEGACY_MOUNT", "An actual mount is not covered by the adapter.")
            source = mount.get("Name") if kind == "volume" else normalized_path(mount.get("Source", ""))
            observed.append((kind, source, mount.get("Destination"), mount.get("RW")))
        require(sorted(expected) == sorted(observed), "LEGACY_MOUNT", "Actual mounts differ from the effective configuration.")

    def _attest_container_config(self, name, record, configured):
        # Inspect private values only for the already selected project.  Persist
        # only hashes after comparing declared values with the actual process.
        raw = json.loads(run(["docker", "inspect", record["id"]], capture=True))[0]
        image = json.loads(run(["docker", "image", "inspect", record["image"]], capture=True))[0]
        require(image["Id"] == record["imageId"], "LEGACY_IMAGE", "A mutable old image tag moved after container creation.")
        defaults, actual = image.get("Config") or {}, raw["Config"]
        for field, docker_field in (("command", "Cmd"), ("entrypoint", "Entrypoint"), ("working_dir", "WorkingDir"), ("user", "User")):
            declared = configured.get(field)
            # Compose emits null for inherited image fields in some versions.
            # An explicit empty entrypoint/command still clears the image value.
            expected = declared if declared is not None else defaults.get(docker_field)
            if field in ("command", "entrypoint") and declared is not None:
                # `compose config` serializes literal dollars as $$; Docker
                # receives one literal $. Never unescape image defaults.
                expected = [part.replace("$$", "$") for part in declared] if isinstance(declared, list) else declared.replace("$$", "$")
            # Compose discards the image CMD when an explicit entrypoint is
            # selected; it does not append the inherited Node default command.
            if field == "command" and declared is None and configured.get("entrypoint") is not None:
                expected = None
            require(actual.get(docker_field) == expected or (not actual.get(docker_field) and not expected),
                    "LEGACY_PROCESS", f"Actual {name} process differs from Compose and its exact image.")
        environment = dict(value.split("=", 1) for value in actual.get("Env", []) if "=" in value)
        for key, value in configured.get("environment", {}).items():
            require(environment.get(key) == str(value), "LEGACY_ENV", "Actual container configuration differs from the private environment.")
        require(bool(raw["HostConfig"].get("ReadonlyRootfs")) == bool(configured.get("read_only", False))
                and not raw["HostConfig"].get("Privileged") and not raw["HostConfig"].get("CapAdd")
                and not raw["HostConfig"].get("Devices") and not raw["HostConfig"].get("DeviceRequests")
                and not raw["HostConfig"].get("VolumesFrom") and not raw["HostConfig"].get("PidMode")
                and raw["HostConfig"].get("IpcMode") in (None, "", "private"),
                "LEGACY_SECURITY", "Actual container privilege differs from the supported layout.")
        require(sorted(raw["HostConfig"].get("CapDrop") or []) == sorted(configured.get("cap_drop") or [])
                and tmpfs_mounts(raw["HostConfig"].get("Tmpfs")) == tmpfs_mounts(configured.get("tmpfs"))
                and security_options(raw["HostConfig"].get("SecurityOpt")) == security_options(configured.get("security_opt")),
                "LEGACY_SECURITY", "Actual capabilities or temporary mounts differ from Compose.")
        record["configurationSha256"] = digest({"Config": actual, "HostConfig": raw["HostConfig"]})

    def active_authors(self):
        """Read process metadata only; inability to inventory processes is closed."""
        root = normalized_path(self.root).casefold()
        found = []
        if os.name == "nt":
            from .legacy_authors import CIM_PROCESS_SCRIPT, windows_active_authors
            records = json.loads(run(["powershell", "-NoProfile", "-NonInteractive", "-Command", CIM_PROCESS_SCRIPT], capture=True))
            if isinstance(records, dict):
                records = [records]
            exempt = ancestor_pids([{"pid": value["ProcessId"], "parent": value.get("ParentProcessId", 0)} for value in records])
            return windows_active_authors(self.root, records, exempt)
        else:
            require(Path("/proc").is_dir(), "LEGACY_AUTHORS", "Cannot prove the absence of active source authors on this host.")
            records = []
            for process in Path("/proc").iterdir():
                if not process.name.isdigit():
                    continue
                try:
                    parent = next(int(line.split(":", 1)[1]) for line in process.joinpath("status").read_text().splitlines() if line.startswith("PPid:"))
                    cwd = process.joinpath("cwd").resolve(strict=True)
                    command = process.joinpath("cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
                    name = process.joinpath("comm").read_text().strip()
                except (FileNotFoundError, ProcessLookupError, PermissionError):
                    continue
                records.append({"pid": int(process.name), "parent": parent, "cwd": cwd, "command": command, "name": name})
            exempt = ancestor_pids(records)
            for record in records:
                if record["pid"] in exempt:
                    continue
                cwd, command = record["cwd"], record["command"]
                if cwd.is_relative_to(self.root) or root in command.casefold():
                    found.append({"pid": record["pid"], "name": record["name"]})
        return found

    def assert_inactive(self):
        git_dir = Path(self.git("rev-parse", "--absolute-git-dir"))
        common = Path(self.git("rev-parse", "--git-common-dir"))
        if not common.is_absolute():
            common = self.root / common
        for directory in {git_dir.resolve(), common.resolve()}:
            require(not any(directory.glob("*.lock")) and not any((directory / "refs").rglob("*.lock")),
                    "LEGACY_AUTHOR", "A Git operation is active in this worktree or its common repository.")
        require(not self.active_authors(), "LEGACY_AUTHOR", "A process is using the canonical source worktree.",
                "Wait for its author or development process to finish; do not stop it or mutate mounted files.")

    def git_snapshot(self):
        env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
        def read(*args):
            return run(["git", *args], cwd=self.root, env=env, capture=True)
        index = Path(read("rev-parse", "--git-path", "index"))
        if not index.is_absolute():
            index = self.root / index
        status = read("status", "--porcelain=v1", "-z", "--untracked-files=all")
        changed = set(read("diff", "--name-only", "-z", "HEAD").split("\0"))
        changed.update(read("ls-files", "--others", "--exclude-standard", "-z").split("\0"))
        changed.discard("")
        paths = []
        deleted = []
        for name in sorted(changed):
            path = plain_input(self.root, name)
            (paths if path.exists() else deleted).append(name)
        return {"head": read("rev-parse", "HEAD"), "branch": read("symbolic-ref", "--short", "HEAD"),
                "tree": read("rev-parse", "HEAD^{tree}"), "indexPath": str(index.resolve()),
                "indexHash": file_hash(index) if index.exists() else None,
                "status": status, "worktreePaths": paths, "deletedPaths": deleted,
                "stagedPatchSha256": digest(read("diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv")),
                "unstagedPatchSha256": digest(read("diff", "--binary", "--no-ext-diff", "--no-textconv"))}

    def legacy_readiness(self, entry_origin):
        attest_editor_env(entry_origin, self.env.get("ASA_BLOCKS_PARENT_ORIGIN"),
                          self.env.get("ASA_BLOCKS_RUNTIME_ORIGIN"), self.profile)
        saved_entry = self.env.get("ASA_UPDATE_ENTRY_ORIGIN")
        require(saved_entry in (None, "", entry_origin), "EDITOR_ENTRY", "The plan entry differs from saved private configuration.")
        def fetch(path):
            with urllib.request.urlopen(entry_origin + path, timeout=10) as response:
                require(response.status == 200 and response.geturl() == entry_origin + path,
                        "LEGACY_HEALTH", "Legacy entry redirects or is unavailable.")
                return response.headers.get("Content-Type", ""), response.read(1024 * 1024)
        content_type, body = fetch("/api/version")
        require("application/json" in content_type, "LEGACY_HEALTH", "Legacy API version is not JSON.")
        api = json.loads(body)
        require(isinstance(api, dict), "LEGACY_HEALTH", "Legacy API version is not a metadata object.")
        revision, schema = api.get("revision"), api.get("schemaVersion")
        require(isinstance(revision, str) and SHA.fullmatch(revision) and type(schema) is int and schema > 0
                and api.get("expectedSchemaVersion") == schema and api.get("synchronized") is True,
                "LEGACY_HEALTH", "Legacy API revision or database schema is not confirmed.")
        observed_schema = self.compose("exec", "-T", "postgres", "sh", "-eu", "-c",
                                       'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COALESCE(max(version::integer),0) FROM schema_migrations"', capture=True)
        require(observed_schema == str(schema), "LEGACY_HEALTH", "Actual database schema differs from legacy API metadata.")
        try:
            kind, body = fetch("/build-metadata.json")
            missing = False
        except urllib.error.HTTPError as failure:
            missing = failure.code == 404 and failure.geturl() == entry_origin + "/build-metadata.json"
            failure.close()
            require(missing, "LEGACY_HEALTH", "Legacy Web metadata request failed unexpectedly.")
            kind, body = "", b""
        if missing:
            web = {"revision": None, "status": "unverified", "reason": "metadata_endpoint_absent"}
        elif "application/json" in kind:
            metadata = json.loads(body)
            require(isinstance(metadata, dict) and isinstance(metadata.get("revision"), str)
                    and SHA.fullmatch(metadata["revision"]), "LEGACY_HEALTH", "Web JSON metadata has no exact revision.")
            web = {"revision": metadata["revision"], "status": "verified_metadata"}
        else:
            require("text/html" in kind and b"<html" in body.lower(), "LEGACY_HEALTH", "Unrecognized legacy Web metadata response.")
            web = {"revision": None, "status": "unverified", "reason": "metadata_endpoint_returns_html"}
        portal_type, portal = fetch("/")
        require("text/html" in portal_type and b"<html" in portal.lower(), "LEGACY_HEALTH", "Legacy portal is not available.")
        scratch = self.compose("exec", "-T", "scratch", "wget", "-qO-", "http://127.0.0.1:8080/asa-commit.txt", capture=True)
        require(SHA.fullmatch(scratch), "LEGACY_HEALTH", "Legacy Scratch has no verifiable build metadata.")
        # A legacy review can intentionally mix source/image revisions.  It is
        # recorded as such, never promoted to the ordinary exact-release state.
        return {"kind": "legacy-review", "api": {"revision": revision, "schema": schema},
                "web": web, "scratch": {"revision": scratch, "status": "verified_metadata"}}

    def database_history(self):
        raw = self.compose("exec", "-T", "postgres", "sh", "-eu", "-c",
                           'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COALESCE(json_agg(x ORDER BY x.version),\'[]\'::json) FROM (SELECT version, checksum FROM schema_migrations) x"',
                           capture=True)
        history = json.loads(raw)
        require(isinstance(history, list) and history
                and all(isinstance(row, dict) and str(row.get("version", "")).isdigit()
                        and isinstance(row.get("checksum"), str) for row in history),
                "LEGACY_SCHEMA", "Applied migration history cannot be attested.")
        return {"schema": max(int(row["version"]) for row in history), "historySha256": digest(history)}

    def snapshot(self, entry_origin, *, _runtime=None):
        self.assert_inactive()
        before = self.git_snapshot()
        records = self.identity()
        relative = {".env", *self.files, *before["worktreePaths"]}
        for name, service in self._configuration["services"].items():
            for mount in service.get("volumes", []):
                value = SOURCE_BINDS.get((name, mount.get("target")))
                if value:
                    relative.add(value)
        inputs = input_inventory(self.root, relative)
        runtime = _runtime if _runtime is not None else self.legacy_readiness(entry_origin)
        require(self._configuration["services"]["api"]["environment"]["ASA_BUILD_REVISION"] == runtime["api"]["revision"],
                "LEGACY_HEALTH", "Observed API metadata differs from its declared review revision.")
        database = self.database_history()
        require(database["schema"] == runtime["api"]["schema"], "LEGACY_SCHEMA", "Database migration state changed during the transition.")
        require(before == self.git_snapshot() and inputs == input_inventory(self.root, relative),
                "LEGACY_DRIFT", "Source or index changed while planning.")
        self.assert_inactive()
        return {"root": str(self.root), "project": self.project, "profile": self.profile,
                "entryOrigin": entry_origin, "files": self.files, "containers": records,
                "volumeIdentity": self._volumes,
                "inputs": inputs, "runtime": runtime, "git": before, "database": database,
                "entryOriginWasSaved": bool(self.env.get("ASA_UPDATE_ENTRY_ORIGIN")),
                "migration": {"seedDev": str(self._configuration["services"]["migration"].get("environment", {}).get("ASA_SEED_DEV", "false")).lower() == "true"},
                "configSha256": digest(self._configuration), "baseConfigSha256": digest(self._base_configuration),
                "foreignSha256": digest(self._foreign)}

    def revalidate(self, snapshot, entry_origin=None, *, allow_stopped=False):
        entry = entry_origin or snapshot["entryOrigin"]
        observed = self.snapshot(entry, _runtime=snapshot["runtime"] if allow_stopped else None)
        assert_snapshot_equal(snapshot, observed, allow_stopped=allow_stopped)
        return observed

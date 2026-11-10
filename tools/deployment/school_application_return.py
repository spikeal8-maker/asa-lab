"""Exact School 307 → 308 application return, initially for native qualification."""

import copy
import json
import os
import re
import sys
import uuid
from urllib.parse import urlsplit

from . import application_rollback as shared, releases
from .backup import export_backup
from .contracts import attest_database_targets, require, validate_release, verify_embedded_entry_http
from .system import Installation, run


FORMAT = "asa-school-308-application-return-v1"
RELEASES = {
    "original": ("3e8713476cafedda3e24a39665458e833efd7c22", 307,
                 "sha256:7ce56323d2149ba12788b61af6d7f341ac2a8934a624074c0175be483252a4c5",
                 "e4af51ab466c1ec6b94bf14a4eead6956ca2b782a12ef8e8f9c4c437543b073a"),
    "fallback": ("406ac609474bae731bd324e8e4fac6993bb9bc8b", 308,
                 "sha256:551145bba910d7a59372ff99e927ee5c5c9536c8cdf6398a97469223a9d83854",
                 "67615175966b77f3d2d6971c5e21a9392f46d2ce5c45ea5f29f8ac266c142ae2"),
    "forward": ("64176e85dece6a05e0ab8986fcb7fa0b1b33aa00", 308,
                "sha256:c3246502677bcda62133748d4603aa3f0e9e634536388a7b0db3f16cb065b341",
                "f6a2cfe517dd68ccd72e125f03b46db027b4234a1bfc250c28d2aff6cc893626"),
}
FORWARD_DIGEST = RELEASES["forward"][2]
INITIAL_CHECKOUT = "6e57e0ae6a6a8b4702e99249bf7b4f65fb011caa"
MIGRATION = "migrations/0308_ai_eight_tool_registry.sql"
MIGRATION_BLOB = "5369c32f1d1eb024a7a21361ce3ca61fbf267be5"
MIGRATION_ROW = {"version": "0308", "checksum": "85722956cf9ec5aa183e8b710f720c7f2356d761bc47466f756b87f8358bbf9a"}
MIGRATION_ARGV = ["node", "tools/migrate.mjs", "--apply"]
MIGRATION_ENV = ("MIGRATION_DATABASE_URL", "MIGRATION_EXPECT_DATABASE", "MIGRATION_CONFIRM")
MIGRATION_WORKDIR = "/app"
SERVICES = ("api", "web", "scratch", "search", "minio")
WRITERS = ("web", "api", "scratch", "search")
LABEL = "asa.school-308-return"
MARKER = "maintenance.json"
PHASES = ("prepared", "quiescing", "creating", "migrating", "switching", "forward_accepted",
          "returning", "returned")
HEX64 = re.compile(r"[a-f0-9]{64}")


def require_fixture(install):
    require(sys.platform == "linux" and install.profile == install.settings.get("profile") == "dev"
            and re.fullmatch(r"asa-lab-school308-native-[a-z0-9][a-z0-9-]{0,23}", install.project)
            and install.settings.get("project") == install.project
            and install.settings.get("automaticUpdates") is False
            and isinstance(install.settings.get("instanceId"), str) and install.settings["instanceId"]
            and "compose.frp.yaml" not in install.files
            and urlsplit(install.env.get("ASA_UPDATE_ENTRY_ORIGIN", "")).hostname in ("127.0.0.1", "::1")
            and install.env.get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000",
            "SCHOOL_RETURN_QUALIFICATION_ONLY",
            "School 308 return is restricted to the named Linux native fixture until exact qualification is accepted.")
    shared.attest_private_state(install)
    shared.attest_access([(install.root / ".env", True), (install.state / "installation.json", True)])


def active(install):
    journal = shared._read(install.state / shared.JOURNAL, optional=True)
    return journal is not None and journal.get("format") == FORMAT


def guard(install):
    require(not active(install), "SCHOOL_RETURN_PENDING",
            "This installation is bound to a School 308 operation.",
            "Use rollback-plan or rollback from the exact external tools checkout.")


def _manifest(side, value):
    release = validate_release(value)
    revision, schema, _, fingerprint = RELEASES[side]
    require(release["revision"] == revision and release["schema"] == schema
            and set(release["images"]) == set(SERVICES) and shared.digest(release) == fingerprint,
            "SCHOOL_RETURN_RELEASE", "Manifest differs from the exact official School 308 declaration.")
    return release


def _sources(install):
    shared._clean(install.root)
    head = install.git("rev-parse", "HEAD")
    require(head in {INITIAL_CHECKOUT, *(item[0] for item in RELEASES.values())},
            "SCHOOL_RETURN_SOURCE", "Checkout is outside the declared source identities.")
    original, fallback, forward = (RELEASES[side][0] for side in RELEASES)
    for revision in (original, fallback, forward, head):
        install.git("merge-base", "--is-ancestor", revision, "origin/main")
    install.git("merge-base", "--is-ancestor", original, fallback)
    install.git("merge-base", "--is-ancestor", fallback, forward)
    for revision in (fallback, forward, head):
        expected = "" if revision in (original, INITIAL_CHECKOUT) else "A\t" + MIGRATION
        require(install.git("diff", "--name-status", "--no-renames", original, revision, "--",
                            "migrations", "tools/migrate.mjs", "Dockerfile.api", "infra/minio",
                            *(name for name in install.files if not name.startswith(".asa/"))) == expected,
                "SCHOOL_RETURN_SOURCE", "Migration or deployment source differs from the declared transition.")
    require(all(install.git("rev-parse", f"{revision}:{MIGRATION}") == MIGRATION_BLOB
                for revision in (fallback, forward)),
            "SCHOOL_RETURN_SCHEMA", "The two schema 308 releases must ship the exact same migration.")
    names = install.git("ls-tree", "-r", "--name-only", original, "--", "migrations").splitlines()
    versions = [match[1] for name in names if (match := re.fullmatch(r"migrations/(\d{4})_[a-z0-9_]+\.sql", name))]
    require(len(set(versions)) == len(versions) and max(versions, default="") == "0307",
            "SCHOOL_RETURN_SCHEMA", "The original release migration set is invalid.")
    return head, set(versions)


def _database(install):
    # Acquire the migrator's lock before the SELECT's READ COMMITTED snapshot,
    # so a commit concurrent with lock acquisition cannot leave a stale ledger.
    query = r"""BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
      SET LOCAL statement_timeout = '5s';
      SELECT pg_try_advisory_xact_lock(7761001) AS ledger_fenced
      \gset
      \if :ledger_fenced
      SELECT json_build_object('databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
        'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
        'ledger',(SELECT json_agg(x ORDER BY x.version) FROM (SELECT version,checksum FROM public.schema_migrations) x));
      \else
      \echo SCHOOL_RETURN_LEDGER_BUSY
      \endif
      ROLLBACK;"""
    output = install.compose("exec", "-T", "postgres", "sh", "-eu", "-c",
                             'exec psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -',
                             input_data=query, capture=True)
    require(output != "SCHOOL_RETURN_LEDGER_BUSY", "SCHOOL_RETURN_MIGRATION_ACTIVE",
            "Another PostgreSQL migrator owns the ledger lock. Inspect the exact writer before recovery.")
    result = json.loads(output)
    rows = result["ledger"]
    require(all(isinstance(result.get(key), str) and re.fullmatch(r"[0-9]{1,32}", result[key])
                for key in ("databaseOid", "systemIdentifier"))
            and isinstance(rows, list) and 0 < len(rows) < 1000
            and all(isinstance(row, dict) and set(row) == {"version", "checksum"}
                    and isinstance(row["version"], str) and re.fullmatch(r"\d{4}", row["version"])
                    and isinstance(row["checksum"], str) and HEX64.fullmatch(row["checksum"]) for row in rows)
            and [row["version"] for row in rows] == sorted({row["version"] for row in rows}),
            "SCHOOL_RETURN_SCHEMA", "Cannot attest the live PostgreSQL identity and complete migration history.")
    return {key: result[key] for key in ("databaseOid", "systemIdentifier")}, rows


def _history_side(rows, binding):
    observed = shared.digest(rows)
    require(observed in (binding["history307"], binding["history308"]),
            "SCHOOL_RETURN_SCHEMA", "The live migration ledger is neither exact 307 nor the attested 308 extension.")
    return "original" if observed == binding["history307"] else "fallback"


def _model(install, manifests, side):
    config = releases.validate_resolved_images(install, manifests[side])
    database = config["networks"]["database"]
    require(config["name"] == install.project and database.get("internal") is True
            and database.get("name") == install.project + "_database" and not database.get("external")
            and all(not config["services"][name].get("ports") for name in ("postgres", "minio"))
            and all(port.get("host_ip") in ("127.0.0.1", "::1")
                    for service in config["services"].values() for port in service.get("ports", [])),
            "SCHOOL_RETURN_QUALIFICATION_ONLY", "The isolated fixture must publish ports only on loopback.")
    normalized = copy.deepcopy(config)
    for name, service in normalized["services"].items():
        image_service = {"migration": "api", "minio-init": "minio"}.get(name, name)
        if image_service in SERVICES:
            service["image"] = "qualified-" + image_service
        args = service.get("build", {}).get("args", {})
        if "ASA_BUILD_REVISION" in args:
            require(args["ASA_BUILD_REVISION"] == manifests[side]["revision"],
                    "SCHOOL_RETURN_CONFIG", "Compose build revision does not match the declared side.")
            args["ASA_BUILD_REVISION"] = "qualified-revision"
    env = normalized["services"]["api"]["environment"]
    require(str(env.get("ASA_EXPECTED_SCHEMA_VERSION")) == str(manifests[side]["schema"]),
            "SCHOOL_RETURN_CONFIG", "Compose expected schema does not match the declared side.")
    env["ASA_EXPECTED_SCHEMA_VERSION"] = "qualified-schema"
    return config, shared.digest(normalized)


def _database_network(install, network_id=None):
    name = install.project + "_database"
    [network] = json.loads(run(["docker", "network", "inspect", network_id or name], capture=True))
    labels = network.get("Labels") or {}
    require(network["Name"] == name and network["Internal"] is True
            and labels.get("com.docker.compose.project") == install.project
            and labels.get("com.docker.compose.network") == "database" and HEX64.fullmatch(network["Id"])
            and (network_id is None or network_id == network["Id"]),
            "SCHOOL_RETURN_DATA", "The PostgreSQL network is outside the isolated fixture.")
    return network


def _identity(install, config, manifests, images):
    records = install.identity()
    postgres = records["postgres"]
    require(postgres["running"], "SCHOOL_RETURN_DATA", "The canonical PostgreSQL container is not running.")
    for name in records.keys() - {"postgres"}:
        record = records[name]
        actual = run(["docker", "inspect", "--format", "{{.Image}}", record["id"]], capture=True)
        require(any(record["image"] == manifest["images"][name] and actual == images[side][name]
                    for side, manifest in manifests.items()),
                "SCHOOL_RETURN_RUNTIME", "A running or stopped service is outside the exact declared image set.")
    volumes = {}
    for service, destination in (("postgres", "/var/lib/postgresql/data"), ("minio", "/data")):
        mounts = [v for v in config["services"][service].get("volumes", []) if v["target"] == destination]
        require(len(mounts) == 1 and mounts[0]["type"] == "volume",
                "SCHOOL_RETURN_DATA", "The declared PostgreSQL or MinIO volume is missing.")
        key = mounts[0]["source"]
        declaration = config["volumes"][key]
        name = declaration["name"]
        require(name == f"{install.project}_{key}" and not declaration.get("external"),
                "SCHOOL_RETURN_DATA", "The fixture cannot use a foreign or external data volume.")
        observed = json.loads(run(["docker", "volume", "inspect", name], capture=True))
        labels = (observed[0].get("Labels") or {}) if len(observed) == 1 else {}
        require(len(observed) == 1 and observed[0]["Name"] == name
                and labels.get("com.docker.compose.project") == install.project
                and labels.get("com.docker.compose.volume") == key,
                "SCHOOL_RETURN_DATA", "The persistent PostgreSQL or MinIO volume identity differs.")
        volumes[service] = {"name": name, "sha256": shared.digest(observed[0])}
    require(volumes["postgres"]["name"] != volumes["minio"]["name"],
            "SCHOOL_RETURN_DATA", "PostgreSQL and MinIO must keep distinct persistent volumes.")
    network = _database_network(install)
    database, history = _database(install)
    binding = {"root": str(install.root), "project": install.project, "profile": install.profile,
               "envSha256": shared.file_digest(install.root / ".env"),
               "settingsSha256": shared.file_digest(install.state / "installation.json"),
               "composeFiles": {name: shared.file_digest(install.root / name) for name in install.files},
               "postgres": {"id": postgres["id"], "reference": postgres["image"],
                            "imageId": run(["docker", "inspect", "--format", "{{.Image}}", postgres["id"]], capture=True)},
               "database": database, "databaseNetworkId": network["Id"], "volumes": volumes}
    return binding, history, records


def _exact_runtime(records, release):
    require(set(records) == {"postgres", *SERVICES}
            and all(records[name]["running"] and records[name]["image"] == image
                    for name, image in release["images"].items()),
            "SCHOOL_RETURN_RUNTIME", "The complete managed runtime does not use the expected exact images.")


def _as_release(install, release):
    target = Installation(install.root, install.profile)
    releases.apply_release_environment(target, release)
    return target


def _attest_images(manifests, *, fetch):
    result = {}
    for side, release in manifests.items():
        if fetch:
            releases.fetch_images(release)
        result[side] = {name: shared.image_identity(reference, None if name == "minio" else release["revision"])
                        for name, reference in release["images"].items()}
        shared.minio_binaries(result[side]["minio"])
    return result


def _load(install):
    journal = shared._read(install.state / shared.JOURNAL)
    require(set(journal) == {"format", "id", "phase", "payload", "payloadSha256", "migrationId", "returnedSide"}
            and journal["format"] == FORMAT and isinstance(journal["id"], str)
            and re.fullmatch(r"[a-f0-9]{32}", journal["id"]) and journal["phase"] in PHASES
            and (journal["migrationId"] is None or isinstance(journal["migrationId"], str)
                 and HEX64.fullmatch(journal["migrationId"]))
            and journal["returnedSide"] in (None, "original", "fallback")
            and (journal["phase"] in ("returning", "returned")) == (journal["returnedSide"] is not None)
            and isinstance(journal["payload"], dict) and shared.digest(journal["payload"]) == journal["payloadSha256"],
            "SCHOOL_RETURN_JOURNAL", "The School 308 operation capsule is invalid.")
    payload = journal["payload"]
    require(set(payload) == {"manifests", "images", "tooling", "ci", "initialCheckout", "configSha256",
                             "binding", "backup", "priorReceiptSha256", "createdAt"}
            and all(isinstance(payload[key], dict) for key in ("manifests", "images", "binding", "backup", "tooling", "ci"))
            and set(payload["manifests"]) == set(RELEASES)
            and all(isinstance(payload[key], str) and HEX64.fullmatch(payload[key])
                    for key in ("configSha256", "priorReceiptSha256"))
            and all(isinstance(payload["binding"].get(key), str) and HEX64.fullmatch(payload["binding"][key])
                    for key in ("history307", "history308"))
            and payload["binding"]["history307"] != payload["binding"]["history308"],
            "SCHOOL_RETURN_JOURNAL", "The School 308 operation capsule is incomplete.")
    for side, release in payload["manifests"].items():
        _manifest(side, release)
    return journal


def _persist(install, journal, phase, **fields):
    journal.update(phase=phase, **fields)
    shared._write(install.state / shared.JOURNAL, journal)


def _link(journal):
    return {"operationId": journal["id"], "eligibilitySha256": journal["payloadSha256"]}


def _markers(install, journal):
    state = install.state
    marker = shared._read(state / MARKER, optional=True)
    prior = shared._read(state / "last-operation.json", optional=True)
    linked = prior is not None and prior.get("applicationRollback") == _link(journal)
    expected = {"phase": FORMAT, "applicationRollback": _link(journal)}
    require(marker in (None, expected) and not (state / "failed-switch.json").exists()
            and not (state / "release-selection.json").exists()
            and (linked or shared.digest(prior) == journal["payload"]["priorReceiptSha256"])
            and (marker is not None or linked or journal["phase"] == "prepared"),
            "SCHOOL_RETURN_OPERATION", "The School 308 capsule does not own the installation's current operation.")
    return expected


def _backup_binding(install, payload, path, *, at=None):
    binding = payload["binding"]
    candidate = {"previous": payload["manifests"]["original"], "binding": binding,
                 "images": {"ids": {"previous": payload["images"]["original"]}}}
    return shared._backup(install, path, candidate, at=at)


def _assert_binding(install, journal, model_side):
    payload = journal["payload"]
    manifests = payload["manifests"]
    model = _as_release(install, manifests[model_side])
    config, config_sha = _model(model, manifests, model_side)
    actual, history, records = _identity(model, config, manifests, payload["images"])
    expected = {key: value for key, value in payload["binding"].items() if key not in ("history307", "history308")}
    require(actual == expected and config_sha == payload["configSha256"],
            "SCHOOL_RETURN_DATA", "The instance, private configuration, PostgreSQL or MinIO volume changed.")
    return _history_side(history, payload["binding"]), records


def _attest_writer_scope(install, payload, *, allowed_api=None, owned_migration=None):
    # An original, finished Compose migration is retained byte-for-byte. A
    # second, active or unidentified migration is a competing ledger writer.
    candidates = run(["docker", "ps", "-aq", "--no-trunc", "--filter",
                      f"label=com.docker.compose.project={install.project}", "--filter",
                      "label=com.docker.compose.service=migration"], capture=True).splitlines()
    require(len(candidates) <= 1 and all(HEX64.fullmatch(value) for value in candidates),
            "SCHOOL_RETURN_MIGRATION", "Cannot identify a single dormant canonical migration container.")
    if candidates:
        [record] = json.loads(run(["docker", "inspect", candidates[0]], capture=True))
        labels = record["Config"]["Labels"]
        require(record["Id"] == candidates[0] and record["State"]["Status"] == "exited"
                and record["State"]["ExitCode"] == 0 and record["HostConfig"]["RestartPolicy"]["Name"] == "no"
                and record["Image"] == payload["images"]["original"]["api"]
                and record["Config"]["Image"] == payload["manifests"]["original"]["images"]["api"]
                and labels.get("com.docker.compose.project") == install.project
                and labels.get("com.docker.compose.project.working_dir") == str(install.root)
                and labels.get("com.docker.compose.service") == "migration"
                and labels.get("com.docker.compose.project.config_files") == ",".join(str(install.root / name) for name in install.files)
                and labels.get("com.docker.compose.oneoff", "").lower() == "false",
                "SCHOOL_RETURN_MIGRATION_ACTIVE", "An unowned or active Compose migration can write to the fixture.")
    binding = payload["binding"]
    network = _database_network(install, binding["databaseNetworkId"])
    members = set(network.get("Containers") or {})
    postgres_id = binding["postgres"]["id"]
    require(postgres_id in members and members <= {postgres_id, allowed_api, owned_migration},
            "SCHOOL_RETURN_MIGRATION_ACTIVE", "Unexpected containers are attached to the fixture PostgreSQL network.")


def _migration_environment(config):
    return {key: config["services"]["migration"]["environment"][key] for key in MIGRATION_ENV}


def _env_map(entries):
    require(isinstance(entries, list) and all(isinstance(item, str) and "=" in item for item in entries),
            "SCHOOL_RETURN_MIGRATION", "Cannot attest the migration image environment.")
    values = dict(item.split("=", 1) for item in entries)
    require(len(values) == len(entries), "SCHOOL_RETURN_MIGRATION", "Duplicate migration environment keys.")
    return values


def _migration_name(install, journal):
    return f"{install.project}-return-{journal['id']}"


def _migration_container(install, journal):
    candidates = run(["docker", "ps", "-aq", "--no-trunc", "--filter", f"label={LABEL}={journal['id']}"],
                     capture=True).splitlines()
    require(len(candidates) <= 1 and all(HEX64.fullmatch(value) for value in candidates)
            and (not candidates or journal["migrationId"] in (None, candidates[0])),
            "SCHOOL_RETURN_MIGRATION", "The operation's migration container identity is ambiguous.")
    if not candidates:
        return None
    container = candidates[0]
    [record] = json.loads(run(["docker", "inspect", container], capture=True))
    labels = record["Config"]["Labels"]
    payload = journal["payload"]
    release = payload["manifests"]["forward"]
    model = _as_release(install, release)
    config, _ = _model(model, payload["manifests"], "forward")
    image = payload["images"]["forward"]["api"]
    expected_env = _env_map(json.loads(run(["docker", "image", "inspect", "--format", "{{json .Config.Env}}",
                                          image], capture=True))) | _migration_environment(config)
    network = _database_network(install, payload["binding"]["databaseNetworkId"])
    endpoint = record["NetworkSettings"]["Networks"]
    network_id = endpoint.get(network["Name"], {}).get("NetworkID")
    host = record["HostConfig"]
    require(record["Id"] == container and record["Name"] == "/" + _migration_name(install, journal)
            and record["Image"] == image
            and record["Config"]["Image"] == release["images"]["api"]
            and record["Config"]["User"] == config["services"]["migration"]["user"] == "node"
            and record["Config"]["WorkingDir"] == MIGRATION_WORKDIR
            and [record["Path"], *record["Args"]] == MIGRATION_ARGV
            and labels.get(LABEL) == journal["id"] and labels.get(LABEL + ".project") == install.project
            and labels.get(LABEL + ".root") == str(install.root)
            and not any(key.startswith("com.docker.compose.") for key in labels)
            and host["RestartPolicy"]["Name"] == "no" and host["ReadonlyRootfs"] is True
            and host["Privileged"] is False and host["NetworkMode"] == network["Id"]
            and host.get("CapDrop") == ["ALL"] and not host.get("CapAdd")
            and host.get("SecurityOpt") in (["no-new-privileges=true"], ["no-new-privileges:true"])
            and host.get("Tmpfs") == {"/tmp": ""} and not host.get("PortBindings")
            and not [mount for mount in record["Mounts"] if mount["Type"] != "tmpfs"]
            and set(endpoint) == {network["Name"]}
            and (network_id == network["Id"] or (network_id == "" and record["State"]["Status"] == "created"))
            and _env_map(record["Config"]["Env"]) == expected_env,
            "SCHOOL_RETURN_MIGRATION", "The owned migration container does not match the isolated exact apply command.")
    return record


def _seal_migration(install, journal, *, check=False):
    record = _migration_container(install, journal)
    if record is not None:
        require(record["State"]["Status"] in ("created", "exited", "dead"),
                "SCHOOL_RETURN_MIGRATION_ACTIVE", "The exact migration container may still commit. Wait for it to exit.")
        if not check:
            # No --force. Removal and start serialize at Docker, and a delayed
            # start request for this exact ID cannot reach a removed container.
            run(["docker", "rm", record["Id"]], capture=True)
        return record["Id"]
    return None


def _stop_writers(install):
    install.compose("stop", *WRITERS)
    records = install.identity()
    require(all(not records.get(name, {}).get("running") for name in WRITERS),
            "SCHOOL_RETURN_WRITERS", "Application writers did not stop.")


def _migrate(install, journal):
    require(_assert_binding(install, journal, "original")[0] == "original",
            "SCHOOL_RETURN_SCHEMA", "The live original ledger changed after writer shutdown.")
    payload = journal["payload"]
    _attest_writer_scope(install, payload)
    release = payload["manifests"]["forward"]
    target = _as_release(install, release)
    config, _ = _model(target, payload["manifests"], "forward")
    attest_database_targets(config, config["services"]["postgres"]["environment"])
    environment = _migration_environment(config)
    _persist(install, journal, "creating")
    # Docker create fails on a name collision. This container never belongs to
    # Compose's migration service and cannot replace or stop an existing one.
    container = run(["docker", "create", "--name", _migration_name(install, journal), "--pull", "never",
                     "--network", payload["binding"]["databaseNetworkId"],
                     "--label", f"{LABEL}={journal['id']}", "--label", f"{LABEL}.project={install.project}",
                     "--label", f"{LABEL}.root={install.root}", "--restart", "no",
                     "--entrypoint", MIGRATION_ARGV[0], "--workdir", MIGRATION_WORKDIR, "--user", "node",
                     "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                     *(part for key in MIGRATION_ENV for part in ("--env", key)),
                     release["images"]["api"], *MIGRATION_ARGV[1:]], env={**os.environ, **environment}, capture=True)
    record = _migration_container(install, journal)
    require(record is not None and record["Id"] == container and record["State"]["Status"] == "created",
            "SCHOOL_RETURN_MIGRATION", "The pinned one-shot was not created in the stopped state.")
    _persist(install, journal, "migrating", migrationId=record["Id"])
    run(["docker", "start", "-a", record["Id"]], capture=True)
    finished = _migration_container(install, journal)
    require(finished is not None and finished["State"]["Status"] == "exited" and finished["State"]["ExitCode"] == 0,
            "SCHOOL_RETURN_MIGRATION", "The pinned one-shot did not exit successfully.")
    _seal_migration(install, journal)
    _attest_writer_scope(install, payload)
    require(_assert_binding(install, journal, "forward")[0] == "fallback",
            "SCHOOL_RETURN_SCHEMA", "The exact schema 308 transaction did not commit.")


def _switch(install, journal, side):
    payload = journal["payload"]
    release = payload["manifests"][side]
    _sources(install)
    if install.git("rev-parse", "HEAD") != release["revision"]:
        install.git("switch", "--detach", release["revision"])
    target = _as_release(install, release)
    schema_side = "original" if side == "original" else "fallback"
    require(_assert_binding(target, journal, side)[0] == schema_side,
            "SCHOOL_RETURN_SCHEMA", "The selected release does not match the persisted live database.")
    for stage in (("minio", "search", "scratch"), ("api",), ("web",)):
        target.compose("up", "-d", "--no-build", "--no-deps", "--pull", "never", "--wait", "--wait-timeout", "180", *stage)
        if stage == ("api",):
            shared._api_ready(target, release)
    _verify_running(target, journal, side)
    shared._write(install.state / "installed-release.json", release)
    target.receipt({"status": "success", "phase": "verify_entry", "trigger": "manual",
                    "action": "update" if side == "forward" else "rollback", "selected": release,
                    "previous": payload["manifests"]["original" if side == "forward" else "forward"],
                    "backup": payload["backup"]["path"], "applicationRollback": _link(journal),
                    "entryHttp": "pass", "userFlow": "not_run", "automaticDatabaseRestore": False})
    shared._sync(install.state)


def _verify_running(target, journal, side):
    release = journal["payload"]["manifests"][side]
    require(target.git("rev-parse", "HEAD") == release["revision"],
            "SCHOOL_RETURN_SOURCE", "The completed checkout does not match the declared release.")
    target.wait_ready(release["revision"], release["schema"])
    verify_embedded_entry_http(target.env["ASA_UPDATE_ENTRY_ORIGIN"], release["revision"])
    history_side, records = _assert_binding(target, journal, side)
    require(history_side == ("original" if side == "original" else "fallback"),
            "SCHOOL_RETURN_SCHEMA", "The running release does not match the live migration history.")
    _exact_runtime(records, release)


def _clear_marker(install, journal):
    _markers(install, journal)
    (install.state / MARKER).unlink(missing_ok=True)
    shared._sync(install.state)


def forward(install, *, check=False):
    require_fixture(install)
    require(all(not (install.state / name).exists() for name in
                (shared.JOURNAL, MARKER, "failed-switch.json", "release-selection.json")),
            "SCHOOL_RETURN_PENDING", "An operation or release selection already owns this installation.")
    shared._clean(install.root)
    install.git("fetch", "origin", "main:refs/remotes/origin/main")
    head, versions = _sources(install)
    require(head in (RELEASES["original"][0], INITIAL_CHECKOUT),
            "SCHOOL_RETURN_SOURCE", "A new operation requires the declared original checkout.")
    tooling = shared.tool_identity(install)
    releases.assert_general_ci(tooling["revision"])
    manifests = {side: _manifest(side, releases.discover_release(spec[2])) for side, spec in RELEASES.items()}
    require(_manifest("original", shared._read(install.state / "installed-release.json")) == manifests["original"],
            "SCHOOL_RETURN_RELEASE", "Installed release is outside the declared original identity.")
    ci = {side: shared._ci_identity(release) for side, release in manifests.items()}
    images = _attest_images(manifests, fetch=True)
    original = manifests["original"]
    install.readiness(original["revision"], original["schema"])
    verify_embedded_entry_http(install.env["ASA_UPDATE_ENTRY_ORIGIN"], original["revision"])
    config, config_sha = _model(install, manifests, "original")
    for side in ("fallback", "forward"):
        model = _as_release(install, manifests[side])
        require(_model(model, manifests, side)[1] == config_sha,
                "SCHOOL_RETURN_CONFIG", "The effective model differs beyond exact image, revision and schema fields.")
    binding, rows, records = _identity(install, config, manifests, images)
    _exact_runtime(records, original)
    _attest_writer_scope(install, {"binding": binding, "manifests": manifests, "images": images},
                         allowed_api=records["api"]["id"])
    actual_versions = {row["version"] for row in rows}
    require(actual_versions == versions or (actual_versions == versions - {"0146"} and "0151" in actual_versions),
            "SCHOOL_RETURN_SCHEMA", "Original live ledger is not the complete declared 307 history.")
    model = _as_release(install, manifests["forward"])
    output = model.compose("run", "--rm", "--no-deps", "--pull", "never", "--entrypoint", "node",
                           "migration", "tools/migrate.mjs", "--plan", capture=True)
    require(output.splitlines() == ["Planned 1 pending migration(s); read-only, no changes applied.",
                                   "db:migrate --plan PASS"],
            "SCHOOL_RETURN_SCHEMA", "The exact published forward migration must plan one pending migration.")
    if check:
        print("SCHOOL_RETURN_PREFLIGHT pass; native qualification only, no installation switch")
        return
    binding.update(history307=shared.digest(rows), history308=shared.digest([*rows, MIGRATION_ROW]))
    payload = {"manifests": manifests, "images": images, "tooling": tooling, "ci": ci,
               "initialCheckout": head, "configSha256": config_sha, "binding": binding}
    backup = export_backup(install)
    payload.update(backup=_backup_binding(install, payload, backup), createdAt=shared.stamp(),
                   priorReceiptSha256=shared.digest(shared._read(install.state / "last-operation.json", optional=True)))
    journal = {"format": FORMAT, "id": uuid.uuid4().hex, "payload": payload, "payloadSha256": shared.digest(payload),
               "migrationId": None, "returnedSide": None}
    require(_assert_binding(install, journal, "original")[0] == "original"
            and _sources(install)[0] == head and shared.tool_identity(install) == tooling,
            "SCHOOL_RETURN_DRIFT", "Eligibility changed after backup and before arming the switch.")
    _persist(install, journal, "prepared")
    shared._write(install.state / MARKER, _markers(install, journal))
    _persist(install, journal, "quiescing")
    _stop_writers(install)
    _migrate(install, journal)
    _persist(install, journal, "switching")
    _switch(install, journal, "forward")
    _persist(install, journal, "forward_accepted")
    _clear_marker(install, journal)
    print(f"UPDATED {manifests['forward']['revision']} schema=308; user flow NOT_RUN")


def rollback(install, *, check=False):
    require_fixture(install)
    journal = _load(install)
    marker = _markers(install, journal)
    payload = journal["payload"]
    head, _ = _sources(install)
    require(head in (payload["initialCheckout"], *(release["revision"] for release in payload["manifests"].values()))
            and shared.tool_identity(install) == payload["tooling"]
            and _attest_images(payload["manifests"], fetch=False) == payload["images"],
            "SCHOOL_RETURN_DRIFT", "The source, immutable images or external tools changed.")
    require(_backup_binding(install, payload, payload["backup"]["path"], at=payload["createdAt"]) == payload["backup"],
            "SCHOOL_RETURN_BACKUP", "The linked pre-update backup changed.")
    owned_migration = _seal_migration(install, journal, check=True)
    installed = shared._read(install.state / "installed-release.json")
    installed_side = next((side for side, release in payload["manifests"].items() if release == installed), None)
    require(installed_side is not None, "SCHOOL_RETURN_RELEASE", "The installed manifest is outside the operation.")
    side, records = _assert_binding(install, journal, installed_side)
    api = records.get("api", {})
    _attest_writer_scope(install, payload, allowed_api=api.get("id") if api.get("running") else None,
                         owned_migration=owned_migration)
    require(journal["returnedSide"] in (None, side),
            "SCHOOL_RETURN_SCHEMA", "The observed database no longer matches the previously chosen return release.")
    if check or journal["phase"] == "returned":
        if journal["phase"] == "returned":
            require(installed_side == side, "SCHOOL_RETURN_RELEASE", "Completed return receipt differs.")
            _verify_running(_as_release(install, payload["manifests"][side]), journal, side)
            if not check:
                _clear_marker(install, journal)
        print(f"SCHOOL_RETURN {'ELIGIBLE' if check else 'ALREADY_COMPLETE'} side={side} schema={payload['manifests'][side]['schema']}")
        return
    shared._write(install.state / MARKER, marker)
    _stop_writers(install)
    _seal_migration(install, journal)
    _attest_writer_scope(install, payload)
    # A just-completed migration may win the race with the observational
    # preflight. Only this post-seal read may select the return artifact.
    side, _ = _assert_binding(install, journal, installed_side)
    require(journal["returnedSide"] in (None, side),
            "SCHOOL_RETURN_SCHEMA", "A previously recorded return destination changed.")
    _persist(install, journal, "returning", returnedSide=side)
    _switch(install, journal, side)
    _persist(install, journal, "returned")
    _clear_marker(install, journal)
    print(f"SCHOOL_RETURN_COMPLETE revision={payload['manifests'][side]['revision']} schema={payload['manifests'][side]['schema']}")

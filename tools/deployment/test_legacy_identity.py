"""Regression checks for the closed legacy-review identity adapter."""

from copy import deepcopy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deployment.contracts import Blocked
from deployment.legacy_identity import (LegacyInstallation, REVIEW_FILES, REVIEW_SERVICES, REVIEW_WRITERS, SOURCE_BINDS,
                                        actual_ports, assert_snapshot_equal, attest_foreign_mounts, attest_legacy_storage, configured_ports,
                                        input_inventory, plain_input, validate_review_configuration)


def review_fixture(root):
    """Observed review shape, expressed independently of the production helper."""
    project, revision = "asa-lab-dev", "a" * 40
    services = {name: {"image": f"legacy-{name}:base", "security_opt": ["no-new-privileges:true"], "cap_drop": ["ALL"], "environment": {}}
                for name in REVIEW_SERVICES}
    for name, networks in {"postgres": ["database"], "migration": ["database"], "api": ["application", "database"],
                           "web": ["application", "scratch-runtime"], "scratch": ["scratch-runtime"],
                           "minio": ["application"], "minio-init": ["application"], "search": ["application"]}.items():
        services[name]["networks"] = {network: None for network in networks}
    services["postgres"]["volumes"] = [{"type": "volume", "source": "postgres-data", "target": "/var/lib/postgresql/data"}]
    services["minio"]["volumes"] = [{"type": "volume", "source": "blocks-object-data", "target": "/data"}]
    services["api"].update(build={"context": str(root), "dockerfile": "Dockerfile.api"}, user="node", read_only=True,
                           environment={"ASA_BLOCKS_RUNTIME_ORIGIN": "http://127.0.0.1:4610", "APP_DATABASE_URL": "postgres://app:private@postgres:5432/asalab"},
                           ports=[{"target": 4611, "published": "4611", "host_ip": "127.0.0.1", "protocol": "tcp"}],
                           volumes=[{"type": "volume", "source": "application-logs", "target": "/var/lib/asa-application-logs"},
                                    {"type": "bind", "source": str(root / ".asa/diagnostics/store"), "target": "/var/lib/asa-logs", "read_only": True, "bind": {"create_host_path": True}}])
    services["web"].update(build={"context": str(root), "dockerfile": "Dockerfile.web"}, user="65534:65534", read_only=True,
                           ports=[{"target": 8080, "published": "4610", "host_ip": "127.0.0.1", "protocol": "tcp"}])
    services["scratch"]["ports"] = [{"target": 8080, "published": "4613", "host_ip": "127.0.0.1", "protocol": "tcp"}]
    base = {"name": project, "services": services,
            "networks": {key: {"name": f"{project}_{key}"} for key in ("application", "database", "scratch-runtime")},
            "volumes": {key: {"name": f"{project}_{key}"} for key in ("postgres-data", "blocks-object-data", "application-logs")}}
    base["networks"]["database"]["internal"] = True
    full = deepcopy(base)
    for name, target in (("api", "http://127.0.0.1:4611/health/live"), ("web", "http://127.0.0.1:8080/")):
        service = full["services"][name]
        service.pop("build")
        service.update(image="asa-lab-dev-workspace:ai-review-aaaaaaaa", working_dir="/workspace", user="0:0", read_only=False,
                       entrypoint=["/bin/sh", "/workspace/.asa/local-review/api-watch.sh"] if name == "api" else ["node", "/workspace/node_modules/vite/bin/vite.js", "--config", "/workspace/.asa/local-review/vite.config.mts"],
                       healthcheck={"test": ["CMD", "node", "-e", f"fetch('{target}').then(r=>{{if(!r.ok)process.exit(1)}}).catch(()=>process.exit(1))"],
                                    "interval": "10s", "timeout": "5s", "retries": 12, "start_period": "45s" if name == "api" else "30s"})
        service["environment"].update({"ASA_BUILD_REVISION": revision, "NODE_EXTRA_CA_CERTS": "/workspace/docker/certs/russian-trusted-root-ca.pem",
                                       "ASA_COMFYUI_BASE_URL": "http://host.docker.internal:8188", "TSC_WATCHFILE": "FixedPollingInterval",
                                       "TSC_WATCHDIRECTORY": "DynamicPriorityPolling"} if name == "api" else
                                      {"VITE_ASA_BUILD_REVISION": revision, "VITE_ASA_BLOCKS_RUNTIME_ORIGIN": "http://127.0.0.1:4610"})
        for (owner, destination), source in SOURCE_BINDS.items():
            if owner == name:
                service.setdefault("volumes", []).append({"type": "bind", "source": str(root / source), "target": destination,
                                                          "read_only": True, "bind": {"create_host_path": True}})
    return base, full


class ReviewPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.base, self.full = review_fixture(self.root)

    def test_observed_api_watcher_and_vite_shape_is_accepted(self):
        self.assertIs(validate_review_configuration(self.root, self.base, self.full), self.full)

    def test_unknown_environment_process_security_and_health_override_are_rejected(self):
        changes = [lambda service: service.update(command=["sh", "-c", "foreign"]),
                   lambda service: service.update(entrypoint=["node", "foreign.js"]),
                   lambda service: service["environment"].update(UNKNOWN_SETTING="private"),
                   lambda service: service["environment"].update(APP_DATABASE_URL="postgres://foreign/other"),
                   lambda service: service.update(working_dir="/other"),
                   lambda service: service.update(cap_add=["SYS_ADMIN"]),
                   lambda service: service["healthcheck"].update(test=["CMD", "true"]),
                   lambda service: service.update(image="arbitrary:tag")]
        for change in changes:
            full = deepcopy(self.full)
            change(full["services"]["api"])
            with self.subTest(change=change), self.assertRaises(Blocked):
                validate_review_configuration(self.root, self.base, full)

    def test_unknown_overlay_service_and_foreign_root_mount_fail_closed(self):
        cases = [lambda full: full["services"].update(unknown={"image": "busybox"}),
                 lambda full: full["services"]["minio"].update(command=["foreign"]),
                 lambda full: full["services"]["api"]["volumes"][-1].update(source=str(self.root.parent / "foreign")),
                 lambda full: full["services"]["api"]["volumes"][-1].update(read_only=False),
                 lambda full: full["services"]["api"]["volumes"].append({"type": "bind", "source": str(self.root), "target": "/unknown", "read_only": True})]
        for change in cases:
            full = deepcopy(self.full)
            change(full)
            with self.subTest(change=change), self.assertRaises(Blocked):
                validate_review_configuration(self.root, self.base, full)

    def test_foreign_volume_is_refused_even_if_base_was_already_redirected(self):
        self.base["volumes"]["postgres-data"]["name"] = "foreign_postgres-data"
        self.full["volumes"]["postgres-data"]["name"] = "foreign_postgres-data"
        with self.assertRaises(Blocked) as failure:
            validate_review_configuration(self.root, self.base, self.full)
        self.assertEqual(failure.exception.code, "LEGACY_VOLUME")

    def test_volume_order_is_irrelevant_but_modes_and_paths_are_exact(self):
        self.full["services"]["api"]["volumes"].reverse()
        validate_review_configuration(self.root, self.base, self.full)

    def test_private_credential_change_never_appears_in_blocked_output(self):
        self.full["services"]["api"]["environment"]["APP_DATABASE_URL"] = "postgres://admin:private-sensitive-value@foreign/production"
        with self.assertRaises(Blocked) as failure:
            validate_review_configuration(self.root, self.base, self.full)
        self.assertNotIn("private-sensitive-value", str(failure.exception))


class InputTests(unittest.TestCase):
    def test_nested_overlay_and_binary_runtime_bytes_are_inventoried(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".asa/local-review").mkdir(parents=True)
            (root / ".asa/local-review/compose.review.yaml").write_bytes(b"services:\r\n  api: {}\r\n")
            (root / ".asa/local-review/runtime.bin").write_bytes(b"\x00\xff\x10")
            inventory = input_inventory(root, [".asa/local-review"])
            self.assertEqual(set(inventory), {".asa/local-review/compose.review.yaml", ".asa/local-review/runtime.bin"})
            before = inventory[".asa/local-review/compose.review.yaml"]
            (root / ".asa/local-review/compose.review.yaml").write_bytes(b"services:\n  api: {}\n")
            self.assertNotEqual(before, input_inventory(root, [".asa/local-review"])[".asa/local-review/compose.review.yaml"])

    def test_outside_absolute_and_noncanonical_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            for path in ("../outside", "/etc/passwd", "a/../../x", "C:/outside", "a\\b"):
                with self.subTest(path=path), self.assertRaises(Blocked):
                    plain_input(root, path)

    def test_symlink_and_hardlink_inputs_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "original").write_text("private")
            os.link(root / "original", root / "hardlink")
            with self.assertRaises(Blocked):
                input_inventory(root, ["hardlink"])
            (root / "hardlink").unlink()
            try:
                (root / "redirected").symlink_to(root / "original")
            except OSError:
                return  # Windows runner may not permit symlink creation.
            with self.assertRaises(Blocked):
                input_inventory(root, ["redirected"])

    def test_source_change_during_hashing_is_not_a_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "source").write_text("before")
            def moving_file(path):
                path.write_text("changed length")
                return "a" * 64
            with patch("deployment.legacy_identity.file_hash", side_effect=moving_file), self.assertRaises(Blocked) as failure:
                input_inventory(root, ["source"])
            self.assertEqual(failure.exception.code, "LEGACY_DRIFT")

    def test_windows_reparse_points_are_rejected_even_if_not_symlinks(self):
        with tempfile.TemporaryDirectory() as root:
            with patch("deployment.legacy_identity.plain_paths", side_effect=ValueError("junction")), self.assertRaises(Blocked) as failure:
                plain_input(root, "source")
            self.assertEqual(failure.exception.code, "LEGACY_PATH")


class SnapshotTests(unittest.TestCase):
    def snapshot(self):
        return {"root": "/owned", "project": "asa-lab-dev", "inputs": {"file": {"sha256": "a", "bytes": 1}},
                "git": {"indexHash": "index", "head": "source"},
                "containers": {name: {"id": name, "running": name not in ("migration", "minio-init"), "imageId": "sha256:a", "mounts": []}
                               for name in REVIEW_SERVICES}, "foreignSha256": "foreign"}

    def stopped_snapshot(self, expected):
        observed = deepcopy(expected)
        for name in REVIEW_WRITERS:
            observed["containers"][name]["running"] = False
        return observed

    def test_only_writer_running_state_can_differ_during_controlled_backup(self):
        expected = self.snapshot()
        observed = self.stopped_snapshot(expected)
        assert_snapshot_equal(expected, observed, allow_stopped=True)
        with self.assertRaises(Blocked):
            assert_snapshot_equal(expected, observed)
        observed["containers"]["postgres"]["running"] = False
        with self.assertRaises(Blocked):
            assert_snapshot_equal(expected, observed, allow_stopped=True)

    def test_resumed_writers_started_auxiliaries_and_changed_search_are_rejected(self):
        expected = self.snapshot()
        for name in ("api", "minio", "web", "scratch", "migration", "minio-init", "search"):
            observed = self.stopped_snapshot(expected)
            observed["containers"][name]["running"] = name != "search"
            with self.subTest(service=name), self.assertRaises(Blocked):
                assert_snapshot_equal(expected, observed, allow_stopped=True)

    def test_source_index_container_mount_and_foreign_drift_block(self):
        expected = self.snapshot()
        changes = [lambda value: value["inputs"]["file"].update(sha256="changed"),
                   lambda value: value["git"].update(indexHash="changed"),
                   lambda value: value["containers"]["api"].update(imageId="sha256:b"),
                   lambda value: value["containers"]["api"].update(id="replacement"),
                   lambda value: value["containers"]["api"].update(mounts=["foreign"]),
                   lambda value: value.update(foreignSha256="changed")]
        for change in changes:
            observed = self.stopped_snapshot(expected)
            change(observed)
            with self.subTest(change=change), self.assertRaises(Blocked) as failure:
                assert_snapshot_equal(expected, observed, allow_stopped=True)
            self.assertEqual(failure.exception.code, "LEGACY_DRIFT")

    def test_compare_does_not_mutate_the_sealed_plan(self):
        expected = self.snapshot()
        original = deepcopy(expected)
        assert_snapshot_equal(expected, self.stopped_snapshot(expected), allow_stopped=True)
        self.assertEqual(expected, original)


class PortTests(unittest.TestCase):
    def test_exact_loopback_bindings_match(self):
        configured = {"ports": [{"target": 8080, "published": "4610", "host_ip": "127.0.0.1", "protocol": "tcp"}]}
        record = {"ports": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "4610"}]}}
        self.assertEqual(configured_ports(configured), actual_ports(record))

    def test_implicit_public_or_dynamic_port_is_rejected(self):
        for port in ({"target": 8080, "published": "4610"},
                     {"target": 8080, "published": "4610", "host_ip": "0.0.0.0"},
                     {"target": 8080, "published": "4610-4620", "host_ip": "127.0.0.1"}):
            with self.subTest(port=port), self.assertRaises(Blocked):
                configured_ports({"ports": [port]})


class StorageIsolationTests(unittest.TestCase):
    def test_foreign_container_cannot_share_owned_volume_or_source_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "owned"
            root.mkdir()
            config = {"volumes": {"postgres-data": {"name": "asa-lab-dev_postgres-data"},
                                  "blocks-object-data": {"name": "asa-lab-dev_blocks-object-data"}}}
            mounts = [{"Type": "volume", "Name": value["name"]} for value in config["volumes"].values()]
            mounts += [{"Type": "bind", "Source": str(path)} for path in (root, root.parent, root / "apps/api")]
            for mount in mounts:
                with self.subTest(mount=mount), self.assertRaises(Blocked) as failure:
                    attest_foreign_mounts(root, config, [{"mounts": [mount]}])
                self.assertEqual(failure.exception.code, "LEGACY_SHARED_STORAGE")
            attest_foreign_mounts(root, config, [{"mounts": [{"Type": "volume", "Name": "foreign_data"},
                                                           {"Type": "bind", "Source": str(root.parent / "neighbour")}]}])

    def test_volume_labels_driver_and_options_are_attested_and_creation_is_pinned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\n")
            install = LegacyInstallation(root)
            config = {"volumes": {"postgres-data": {"name": "asa-lab-dev_postgres-data"}}}
            volume = {"Name": "asa-lab-dev_postgres-data", "Driver": "local", "Scope": "local", "Options": None,
                      "CreatedAt": "2026-10-01T00:00:00Z", "Mountpoint": "/var/lib/docker/volumes/owned/_data",
                      "Labels": {"com.docker.compose.project": "asa-lab-dev", "com.docker.compose.volume": "postgres-data"}}
            with patch("deployment.legacy_identity.run", return_value=json.dumps([volume])):
                self.assertEqual(install.attest_volume_ownership(config)[0]["CreatedAt"], volume["CreatedAt"])
            for change in ({"Driver": "nfs"}, {"Options": {"device": "/foreign"}}, {"Labels": {}}, {"CreatedAt": None}):
                with self.subTest(change=change), patch("deployment.legacy_identity.run", return_value=json.dumps([{**volume, **change}])), self.assertRaises(Blocked):
                    install.attest_volume_ownership(config)


class ActualContainerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\n")
        self.install = LegacyInstallation(self.root)
        self.record = {"id": "container", "image": "local-review:old", "imageId": "sha256:" + "a" * 64}
        self.config = {"image": "local-review:old", "command": ["node", "review.js"], "user": "node",
                       "read_only": True, "environment": {"A_PRIVATE_KEY": "do-not-print-this"},
                       "cap_drop": ["ALL"], "tmpfs": ["/tmp"], "security_opt": ["no-new-privileges:true"]}
        self.raw = {"Config": {"Cmd": ["node", "review.js"], "Entrypoint": None, "WorkingDir": "/app", "User": "node",
                               "Env": ["A_PRIVATE_KEY=do-not-print-this"]},
                    "HostConfig": {"ReadonlyRootfs": True, "CapDrop": ["ALL"], "Tmpfs": {"/tmp": ""},
                                   "SecurityOpt": ["no-new-privileges:true"]}}
        self.image = {"Id": self.record["imageId"], "Config": {"WorkingDir": "/app"}}

    def test_actual_image_process_keys_and_mount_policy_are_attested(self):
        with patch("deployment.legacy_identity.run", side_effect=[json.dumps([self.raw]), json.dumps([self.image])]):
            self.install._attest_container_config("api", self.record, self.config)
        self.assertEqual(len(self.record["configurationSha256"]), 64)
        self.assertNotIn("do-not-print", json.dumps(self.record))

    def test_mutable_old_tag_move_is_rejected(self):
        self.image["Id"] = "sha256:" + "b" * 64
        with patch("deployment.legacy_identity.run", side_effect=[json.dumps([self.raw]), json.dumps([self.image])]), self.assertRaises(Blocked) as failure:
            self.install._attest_container_config("api", self.record, self.config)
        self.assertEqual(failure.exception.code, "LEGACY_IMAGE")

    def test_explicit_entrypoint_discards_image_cmd_without_allowing_arbitrary_actual_command(self):
        self.config.pop("command")
        self.config["entrypoint"] = ["/bin/sh", "/workspace/.asa/local-review/api-watch.sh"]
        self.image["Config"]["Cmd"] = ["node"]
        self.raw["Config"].update(Entrypoint=self.config["entrypoint"], Cmd=None)
        with patch("deployment.legacy_identity.run", side_effect=[json.dumps([self.raw]), json.dumps([self.image])]):
            self.install._attest_container_config("api", self.record, self.config)
        self.raw["Config"]["Cmd"] = ["unapproved-command"]
        with patch("deployment.legacy_identity.run", side_effect=[json.dumps([self.raw]), json.dumps([self.image])]), self.assertRaises(Blocked):
            self.install._attest_container_config("api", self.record, self.config)

    def test_actual_secret_mismatch_blocks_without_printing_either_value(self):
        self.raw["Config"]["Env"] = ["A_PRIVATE_KEY=another-private-key"]
        with patch("deployment.legacy_identity.run", side_effect=[json.dumps([self.raw]), json.dumps([self.image])]), self.assertRaises(Blocked) as failure:
            self.install._attest_container_config("api", self.record, self.config)
        self.assertEqual(failure.exception.code, "LEGACY_ENV")
        self.assertNotIn("private-key", str(failure.exception))
        self.assertNotIn("do-not-print", str(failure.exception))

    def test_unknown_actual_commands_privileges_and_tmpfs_fail_closed(self):
        mutations = [lambda raw: raw["Config"].update(Cmd=["sh", "-c", "foreign"]),
                     lambda raw: raw["HostConfig"].update(Privileged=True),
                     lambda raw: raw["HostConfig"].update(CapAdd=["SYS_ADMIN"]),
                     lambda raw: raw["HostConfig"].update(SecurityOpt=[]),
                     lambda raw: raw["HostConfig"].update(Devices=[{"PathOnHost": "/dev/sda"}]),
                     lambda raw: raw["HostConfig"].update(Tmpfs={"/tmp": "", "/app": ""})]
        for mutation in mutations:
            raw = deepcopy(self.raw)
            mutation(raw)
            with self.subTest(mutation=mutation), patch("deployment.legacy_identity.run", side_effect=[json.dumps([raw]), json.dumps([self.image])]), self.assertRaises(Blocked):
                self.install._attest_container_config("api", deepcopy(self.record), self.config)

    def test_foreign_named_volume_and_extra_mount_are_rejected(self):
        config = {"services": {"postgres": {"volumes": [{"type": "volume", "source": "postgres-data", "target": "/var/lib/postgresql/data"}]}},
                  "volumes": {"postgres-data": {"name": "asa-lab-dev_postgres-data"}}}
        record = {"mounts": [{"Type": "volume", "Name": "foreign_postgres-data", "Destination": "/var/lib/postgresql/data", "RW": True}]}
        with self.assertRaises(Blocked) as failure:
            self.install._attest_mounts("postgres", record, config)
        self.assertEqual(failure.exception.code, "LEGACY_MOUNT")
        record["mounts"][0]["Name"] = "asa-lab-dev_postgres-data"
        self.install._attest_mounts("postgres", record, config)
        record["mounts"].append({"Type": "bind", "Source": str(self.root), "Destination": "/foreign", "RW": False})
        with self.assertRaises(Blocked):
            self.install._attest_mounts("postgres", record, config)

    def test_private_storage_keys_are_exact_not_regenerated_or_taken_from_overlay(self):
        env = {"ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000", "ASA_OBJECT_STORAGE_ACCESS_KEY": "old-access",
               "ASA_OBJECT_STORAGE_SECRET_KEY": "old-secret", "ASA_OBJECT_STORAGE_BUCKET": "old-bucket"}
        config = {"services": {"api": {"environment": dict(env)},
                               "minio-init": {"environment": dict(env)},
                               "minio": {"environment": {"MINIO_ROOT_USER": "old-access", "MINIO_ROOT_PASSWORD": "old-secret"}}}}
        attest_legacy_storage(config, env)
        for name, key in (("api", "ASA_OBJECT_STORAGE_SECRET_KEY"), ("minio", "MINIO_ROOT_PASSWORD"), ("minio-init", "ASA_OBJECT_STORAGE_BUCKET")):
            changed = deepcopy(config)
            changed["services"][name]["environment"][key] = "foreign-secret"
            with self.subTest(name=name), self.assertRaises(Blocked) as failure:
                attest_legacy_storage(changed, env)
            self.assertNotIn("foreign-secret", str(failure.exception))


class LegacyMetadataTests(unittest.TestCase):
    def installation(self, root):
        (root / ".env").write_text("ASA_BLOCKS_PARENT_ORIGIN=http://127.0.0.1:4610\nASA_BLOCKS_RUNTIME_ORIGIN=http://127.0.0.1:4610\n")
        return LegacyInstallation(root)

    def responses(self, web=None, schema=261):
        api = {"revision": "a" * 40, "schemaVersion": schema, "expectedSchemaVersion": schema, "synchronized": True}
        return {"/api/version": ("application/json", json.dumps(api).encode()),
                "/build-metadata.json": ("text/html", b"<html>legacy portal</html>") if web is None else ("application/json", json.dumps({"revision": web}).encode()),
                "/": ("text/html", b"<html>portal</html>")}

    def fetcher(self, responses):
        def fetch(url, **kwargs):
            value, body = responses[url.removeprefix("http://127.0.0.1:4610")]
            stream = io.BytesIO(body)
            stream.status = 200
            stream.headers = {"Content-Type": value}
            stream.geturl = lambda: url
            return stream
        return fetch

    def test_html_web_metadata_stays_unknown_and_never_uses_api_sha(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            install = self.installation(root)
            with patch("deployment.legacy_identity.urllib.request.urlopen", side_effect=self.fetcher(self.responses())), patch.object(install, "compose", side_effect=["261", "b" * 40]):
                runtime = install.legacy_readiness("http://127.0.0.1:4610")
            self.assertEqual(runtime["kind"], "legacy-review")
            self.assertEqual(runtime["api"]["revision"], "a" * 40)
            self.assertIsNone(runtime["web"]["revision"])
            self.assertEqual(runtime["web"]["status"], "unverified")
            self.assertEqual(runtime["scratch"]["revision"], "b" * 40)
            self.assertFalse((root / ".asa/installed-release.json").exists())

    def test_actual_database_schema_must_match_api(self):
        with tempfile.TemporaryDirectory() as directory:
            install = self.installation(Path(directory))
            with patch("deployment.legacy_identity.urllib.request.urlopen", side_effect=self.fetcher(self.responses())), patch.object(install, "compose", return_value="260"), self.assertRaises(Blocked) as failure:
                install.legacy_readiness("http://127.0.0.1:4610")
            self.assertEqual(failure.exception.code, "LEGACY_HEALTH")

    def test_missing_web_metadata_is_unknown_but_unexpected_http_failure_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            install = self.installation(Path(directory))
            normal = self.fetcher(self.responses())
            for status in (404, 500):
                def fetch(url, **kwargs):
                    if url.endswith("/build-metadata.json"):
                        raise urllib.error.HTTPError(url, status, "unavailable", {}, None)
                    return normal(url, **kwargs)
                with self.subTest(status=status), patch("deployment.legacy_identity.urllib.request.urlopen", side_effect=fetch), patch.object(install, "compose", side_effect=["261", "b" * 40]):
                    if status == 404:
                        self.assertEqual(install.legacy_readiness("http://127.0.0.1:4610")["web"]["reason"], "metadata_endpoint_absent")
                    else:
                        with self.assertRaises(Blocked):
                            install.legacy_readiness("http://127.0.0.1:4610")

    def test_existing_saved_entry_cannot_be_overridden(self):
        with tempfile.TemporaryDirectory() as directory:
            install = self.installation(Path(directory))
            install.env["ASA_UPDATE_ENTRY_ORIGIN"] = "http://127.0.0.1:9999"
            with patch("deployment.legacy_identity.urllib.request.urlopen") as fetch, self.assertRaises(Blocked):
                install.legacy_readiness("http://127.0.0.1:4610")
            fetch.assert_not_called()

    def test_official_receipt_refuses_re_adoption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\n")
            (root / ".asa").mkdir()
            (root / ".asa/installed-release.json").write_text("{}")
            # Re-adoption must never turn malformed official metadata into legacy.
            with self.assertRaises(Blocked):
                LegacyInstallation(root)


class AuthorTests(unittest.TestCase):
    def test_active_author_blocks_before_snapshot_or_service_operations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\n")
            git = root / ".git"
            git.mkdir()
            install = LegacyInstallation(root)
            with patch.object(install, "git", return_value=str(git)), patch.object(install, "active_authors", return_value=[{"pid": 123, "name": "editor"}]), patch.object(install, "identity") as identity, self.assertRaises(Blocked) as failure:
                install.snapshot("http://127.0.0.1:4610")
            self.assertEqual(failure.exception.code, "LEGACY_AUTHOR")
            identity.assert_not_called()

    def test_common_git_lock_blocks_even_with_inactive_editor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\n")
            git = root / ".git"
            git.mkdir()
            (git / "index.lock").write_text("")
            install = LegacyInstallation(root)
            with patch.object(install, "git", return_value=str(git)), patch.object(install, "active_authors", return_value=[]), self.assertRaises(Blocked) as failure:
                install.assert_inactive()
            self.assertEqual(failure.exception.code, "LEGACY_AUTHOR")


if __name__ == "__main__":
    unittest.main()

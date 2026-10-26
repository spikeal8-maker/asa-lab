"""Focused regression tests for the ASA test-only Docker refresh operator.

All tests are local and never touch Docker, GitHub, credentials or live data.
Run: python3 -m unittest tools.test_asa_test_refresh -v
"""
import io
import os
import json
import sys
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from tools.asa_test_refresh import (
    Blocked, SAFE_DB, env_read, env_replace, extract_snapshot, image_overrides,
    merge_student_keys, sha256, source_services, ensure_source_service_secrets,
    normalize_minio_stage, introduced_runtime_services, reconcile_database_rollback,
    compose, attest_build_contexts, image_proof, verify_images, assert_staged_schema,
    build_source_images, run,
)


def base_env():
    return {
        "POSTGRES_DB": "asalab",
        "COMPOSE_PROJECT_NAME": "asa-lab-dev",
        "ASA_SETTINGS_ENCRYPTION_KEY": "shared-1",
        "CLASSROOM_CODE_SECRET": "shared-2",
        "ASA_BLOCKS_RUNTIME_SIGNING_KEY": "shared-3",
        "ASA_OBJECT_STORAGE_ACCESS_KEY": "shared-4",
        "ASA_OBJECT_STORAGE_SECRET_KEY": "shared-5",
        "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks",
        "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"local": "aaa"}),
        "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "local",
        "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": json.dumps({"local": "bbb"}),
        "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "local",
    }


class EnvironmentSafetyTests(unittest.TestCase):
    def test_env_read_keeps_quoted_json_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / ".env"
            p.write_text("FOO='{\"a\":\"b\"}'\nBAR=123\n")
            self.assertEqual(env_read(p), {"FOO": '{"a":"b"}', "BAR": "123"})

    def test_duplicate_environment_key_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / ".env"
            p.write_text("A=x\nA=y\n")
            with self.assertRaises(Blocked):
                env_read(p)

    def test_replace_preserves_unrelated_secrets_and_0600_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp) / ".env"
            old.write_text("ASA_BUILD_REVISION='old'\nUNTOUCHED_PASSWORD='private-secret'\n")
            candidate = Path(tmp) / "candidate.env"
            env_replace(old, {"ASA_BUILD_REVISION": "new"}, candidate)
            self.assertIn("UNTOUCHED_PASSWORD='private-secret'", candidate.read_text())
            self.assertIn("ASA_BUILD_REVISION='new'", candidate.read_text())
            self.assertEqual(stat.S_IMODE(candidate.stat().st_mode), 0o600)
            self.assertEqual(old.read_text(), "ASA_BUILD_REVISION='old'\nUNTOUCHED_PASSWORD='private-secret'\n")

    def test_missing_replace_key_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp) / ".env"
            old.write_text("EXISTING=x\n")
            with self.assertRaises(Blocked):
                env_replace(old, {"MISSING": "x"}, Path(tmp) / "next")

    def test_newlines_quotes_are_not_permitted_in_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = Path(tmp) / ".env"
            old.write_text("EXISTING=x\n")
            for malicious in ("x\nUNTRUSTED=1", "a'b", "value\r\n"):
                with self.subTest(malicious=malicious), self.assertRaises(Blocked):
                    env_replace(old, {"EXISTING": malicious}, Path(tmp) / "next")

    def test_merge_uses_both_local_and_archive_keyrings(self):
        live = base_env()
        archived = {**live,
                    "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"backup": "ccc"}),
                    "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": json.dumps({"backup": "ddd"}),
                    "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "backup",
                    "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "backup"}
        candidate = merge_student_keys(live, archived)
        self.assertEqual(json.loads(candidate["ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON"]),
                         {"local": "aaa", "backup": "ccc"})
        self.assertEqual(json.loads(candidate["ASA_STUDENT_CODE_LOOKUP_KEYS_JSON"]),
                         {"local": "bbb", "backup": "ddd"})
        self.assertNotIn("POSTGRES_PASSWORD", candidate)

    def test_conflicting_key_ids_block_restore(self):
        live = base_env()
        archived = {**live, "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"local": "different"})}
        with self.assertRaisesRegex(Blocked, "Conflicting"):
            merge_student_keys(live, archived)

    def test_secret_mismatch_blocks_restore(self):
        live = base_env()
        archived = {**live, "ASA_SETTINGS_ENCRYPTION_KEY": "wrong-key"}
        with self.assertRaisesRegex(Blocked, "Protected secret"):
            merge_student_keys(live, archived)

    def test_different_compose_identity_blocks_restore(self):
        live = base_env()
        archived = {**live, "COMPOSE_PROJECT_NAME": "another-service"}
        with self.assertRaises(Blocked):
            merge_student_keys(live, archived)

    def test_deterministic_sha_tag_and_schema(self):
        sha = "a" * 40
        result = image_overrides(sha, 255)
        self.assertEqual(result["ASA_EXPECTED_SCHEMA_VERSION"], "255")
        self.assertEqual(result["ASA_BUILD_REVISION"], sha)
        self.assertEqual(result["ASA_WEB_IMAGE"], "asa-lab-web:git-aaaaaaaaaaaa")
        self.assertEqual(len(result), 7)

    def test_database_name_restrictions(self):
        self.assertTrue(SAFE_DB.fullmatch("asa_refresh_1234_test"))
        for value in ("asalab", "asa_refresh_foo", "'; DROP DATABASE;", "/tmp/test", "A_TEST"):
            self.assertIsNone(SAFE_DB.fullmatch(value))


class SnapshotSafetyTests(unittest.TestCase):
    def write_tar(self, path: Path, name: str, *, symlink: bool = False) -> None:
        with tarfile.open(path, "w") as tar:
            info = tarfile.TarInfo(name)
            if symlink:
                info.type = tarfile.SYMTYPE
                info.linkname = "/etc/passwd"
                tar.addfile(info)
            else:
                data = b"not a real backup"
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))

    def test_rejects_parent_directory_traversal_before_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "bad.tar"
            self.write_tar(archive, "snapshot/../../escaped-file")
            with self.assertRaises(Blocked):
                extract_snapshot(archive, None, parent / "out", None)
            self.assertFalse((parent / "escaped-file").exists())

    def test_rejects_symlink_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "link.tar"
            self.write_tar(archive, "snapshot/link", symlink=True)
            with self.assertRaises(Blocked):
                extract_snapshot(archive, None, parent / "out", None)

    def test_rejects_bad_archive_digest_without_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "good.tar"
            self.write_tar(archive, "snapshot/file")
            with self.assertRaisesRegex(Blocked, "SHA256 mismatch"):
                extract_snapshot(archive, None, parent / "out", "f" * 64)
            self.assertFalse((parent / "out").exists())

    def test_accepted_simple_archive_calls_canonical_backup_validator(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            archive = parent / "archive.tar"
            self.write_tar(archive, "snapshot/marker.txt")
            with patch("tools.asa_test_refresh.verify_backup", return_value={"complete": True}) as verify:
                result = extract_snapshot(archive, None, parent / "out", sha256(archive))
            self.assertEqual(result.name, "snapshot")
            verify.assert_called_once()




class ComposeEvolutionTests(unittest.TestCase):
    def test_new_search_service_is_detected_for_build_and_health(self):
        sha = "a" * 40
        tag = ":git-" + sha[:12]
        services = {
            "postgres": {"image": "postgres:17.7", "restart": "always"},
            "api": {"image": "asa-lab-api" + tag, "restart": "always", "build": {}},
            "migration": {"image": "asa-lab-api" + tag, "restart": "no", "build": {}},
            "scratch": {"image": "asa-lab-scratch" + tag, "restart": "unless-stopped", "build": {}},
            "web": {"image": "asa-lab-web" + tag, "restart": "always", "build": {}},
            "minio": {"image": "asa-lab-minio" + tag, "restart": "unless-stopped", "build": {}},
            "minio-init": {"image": "asa-lab-minio" + tag, "restart": "no"},
            "search": {"image": "asa-lab-search" + tag, "restart": "unless-stopped", "build": {}},
        }
        with patch("tools.asa_test_refresh.docker",
                   return_value=json.dumps({"services": services})):
            builds, runtime, refs = source_services(Path("/nonexistent"), Path("/absent"),
                                                   Path("/absent/overlay"), sha)
        self.assertIn("search", builds)
        self.assertIn("search", runtime)
        self.assertNotIn("migration", builds)
        self.assertNotIn("minio-init", runtime)
        self.assertEqual(len(refs), 5)

    def test_search_secret_is_private_and_stable_across_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".asa" / "test-refresh").mkdir(parents=True)
            overlay = root / "candidate.env"
            overlay.write_text("FOO='bar'\n")
            config = json.dumps({"services": {"search": {"image": "tag"}}})
            with patch("tools.asa_test_refresh.docker", return_value=config):
                ensure_source_service_secrets(root, root, overlay, "a" * 40)
                first = env_read(overlay)["ASA_SEARCH_SECRET"]
                ensure_source_service_secrets(root, root, overlay, "a" * 40)
            self.assertRegex(first, r"^[a-f0-9]{64}$")
            self.assertEqual(overlay.read_text().count("ASA_SEARCH_SECRET="), 1)
            keyfile = root / ".asa" / "test-refresh" / "search-secret"
            self.assertEqual(keyfile.read_text().strip(), first)
            self.assertEqual(stat.S_IMODE(keyfile.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(overlay.stat().st_mode), 0o600)

    def test_invalid_existing_search_secret_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".asa" / "test-refresh").mkdir(parents=True)
            overlay = root / "candidate.env"
            overlay.write_text("ASA_SEARCH_SECRET='bad'\n")
            with patch("tools.asa_test_refresh.docker",
                       return_value=json.dumps({"services": {"search": {}}})):
                with self.assertRaisesRegex(Blocked, "invalid"):
                    ensure_source_service_secrets(root, root, overlay, "a" * 40)

    def test_unpinned_new_service_image_is_rejected(self):
        sha = "b" * 40
        services = {
            "postgres": {"image": "postgres:17.7", "restart": "always"},
            "api": {"image": "asa-lab-api:git-" + sha[:12], "restart": "always", "build": {}},
            "scratch": {"image": "asa-lab-scratch:git-" + sha[:12], "restart": "always", "build": {}},
            "web": {"image": "asa-lab-web:git-" + sha[:12], "restart": "always", "build": {}},
            "minio": {"image": "asa-lab-minio:git-" + sha[:12], "restart": "always", "build": {}},
            "search": {"image": "asa-lab-search:latest", "restart": "always", "build": {}},
        }
        with patch("tools.asa_test_refresh.docker",
                   return_value=json.dumps({"services": services})):
            with self.assertRaisesRegex(Blocked, "Unpinned"):
                source_services(Path("/none"), Path("/none"), Path("/none"), sha)



class RealFailureRegressionTests(unittest.TestCase):
    def test_root_owned_minio_staging_corrected_before_switch(self):
        """2026-10-26: rsync archive 0700 root:root caused unhealthy MinIO."""
        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp) / "asa-refresh-1234-staged" / "_data"
            (staged / ".minio.sys").mkdir(parents=True)
            staged.chmod(0o700)
            (staged / ".minio.sys").chmod(0o700)
            uid = os.getuid() if os.getuid() else 1000
            gid = os.getgid() if os.getgid() else 1000
            calls = []
            def fake_run(*args, **kwargs):
                calls.append(args)
                if args[:2] == ("docker", "inspect"):
                    return json.dumps([{"Config": {"User": f"{uid}:{gid}"}}])
                if args[0] == "chown":
                    if os.geteuid() == 0:
                        os.chown(staged, uid, gid)
                        os.chown(staged / ".minio.sys", uid, gid)
                    return ""
                raise AssertionError("Unexpected command")
            with patch("tools.asa_test_refresh.docker", return_value="minio-id") as compose_call, \
                 patch("tools.asa_test_refresh.run", side_effect=fake_run):
                normalize_minio_stage(Path("/untouched"), staged)
            compose_call.assert_called_once_with(Path("/untouched"), "ps", "-a", "-q", "minio")
            self.assertIn(("chown", "-R", f"{uid}:{gid}", str(staged)), calls)
            self.assertEqual(staged.stat().st_uid, uid)
            self.assertEqual((staged / ".minio.sys").stat().st_gid, gid)

    def test_no_root_minio_uid_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp) / "asa-refresh-1234-staged" / "_data"
            (staged / ".minio.sys").mkdir(parents=True)
            with patch("tools.asa_test_refresh.docker", return_value="cid"), \
                 patch("tools.asa_test_refresh.run",
                       return_value=json.dumps([{"Config": {"User": "0:0"}}])):
                with self.assertRaisesRegex(Blocked, "Refusing"):
                    normalize_minio_stage(Path("/noupdate"), staged)

    def test_new_search_is_introduced_and_requires_rollback_cleanup(self):
        sha = "d" * 40
        suffix = ":git-" + sha[:12]
        old = {"services": {
            "api": {"image": "asa-lab-api" + suffix, "restart": "always", "build": {}},
            "web": {"image": "asa-lab-web" + suffix, "restart": "always", "build": {}},
            "scratch": {"image": "asa-lab-scratch" + suffix, "restart": "always", "build": {}},
            "minio": {"image": "asa-lab-minio" + suffix, "restart": "unless-stopped", "build": {}},
            "postgres": {"image": "postgres:17", "restart": "always"},
        }}
        candidate = {"services": {
            **old["services"],
            "search": {"image": "asa-lab-search" + suffix, "restart": "unless-stopped", "build": {}},
        }}
        def config(*a, **kw):
            return json.dumps(candidate if kw.get("source") else old)
        with patch("tools.asa_test_refresh.docker", side_effect=config):
            self.assertEqual(introduced_runtime_services(
                Path("/test"), Path("/source"), Path("/test/overlay"), sha), ["search"])

    def test_db_partial_rename_rolls_back_even_without_phase_update(self):
        with patch("tools.asa_test_refresh.db_names", return_value={"old_backup", "staging"}), \
             patch("tools.asa_test_refresh.database_query") as query:
            reconcile_database_rollback(Path("/test"), "old_backup", "staging")
            self.assertEqual(query.call_count, 1)
            self.assertIn("ALTER DATABASE old_backup RENAME TO asalab",
                          query.call_args.args[1])

    def test_db_promoted_rollback_retains_candidate_name(self):
        with patch("tools.asa_test_refresh.db_names", return_value={"old_backup", "asalab"}), \
             patch("tools.asa_test_refresh.database_query") as query:
            reconcile_database_rollback(Path("/test"), "old_backup", "staging")
            self.assertEqual(query.call_count, 3)
            commands = [x.args[1] for x in query.call_args_list]
            self.assertIn("ALTER DATABASE asalab RENAME TO staging", commands[1])
            self.assertIn("ALTER DATABASE old_backup RENAME TO asalab", commands[2])

    def test_ambiguous_db_swap_stops_instead_of_destroying(self):
        with patch("tools.asa_test_refresh.db_names",
                   return_value={"old_backup", "asalab", "staging"}), \
             patch("tools.asa_test_refresh.database_query") as query:
            with self.assertRaisesRegex(Blocked, "Ambiguous"):
                reconcile_database_rollback(Path("/test"), "old_backup", "staging")
            query.assert_not_called()



class ExactSourceBuildProvenanceTests(unittest.TestCase):
    def test_build_context_is_pinned_source_but_runtime_keeps_existing_root(self):
        root = Path("/srv/live-asa")
        source = Path("/srv/sha-checkout")
        env = root / ".asa" / "candidate.env"
        runtime = compose(root, source, env)
        build = compose(root, source, env, source_build=True)
        self.assertEqual(runtime[:4], ["docker", "compose", "--project-directory", str(root)])
        self.assertEqual(build[:4], ["docker", "compose", "--project-directory", str(source)])
        self.assertIn(str(root / ".env"), build)
        self.assertIn(str(env), build)
        self.assertIn(str(source / "compose.yaml"), build)

    def test_source_build_context_outside_worktree_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "installed"
            source = Path(tmp) / "new-git-sha"
            source.mkdir()
            context = json.dumps({"services": {"api": {"build": {"context": str(root)}}}})
            with patch("tools.asa_test_refresh.docker", return_value=context):
                with self.assertRaisesRegex(Blocked, "escaped pinned Git checkout"):
                    attest_build_contexts(root, source, root / "overlay", ["api"])
            valid = json.dumps({"services": {"api": {"build": {"context": str(source)}}}})
            with patch("tools.asa_test_refresh.docker", return_value=valid) as call:
                attest_build_contexts(root, source, root / "overlay", ["api"])
                self.assertTrue(call.call_args.kwargs.get("source_build"))

    def test_cache_cannot_reuse_fake_tag_without_private_image_proof(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "installed"
            source = Path(tmp) / "new-git-sha"
            source.mkdir()
            root.mkdir()
            sha = "e" * 40
            image = f"asa-lab-api:git-{sha[:12]}"
            with patch("tools.asa_test_refresh.source_services",
                       return_value=(["api"], ["api"], {image: "api"})), \
                 patch("tools.asa_test_refresh.run", return_value="sha256:validated-build"):
                with self.assertRaisesRegex(Blocked, "no attested source-build proof"):
                    image_proof(root, source, root / "candidate.env", sha, create=False)
                image_proof(root, source, root / "candidate.env", sha, create=True)
                image_proof(root, source, root / "candidate.env", sha, create=False)
            proof = root / ".asa" / "test-refresh" / "verified-images" / f"{sha}.json"
            self.assertEqual(stat.S_IMODE(proof.stat().st_mode), 0o600)
            with patch("tools.asa_test_refresh.source_services",
                       return_value=(["api"], ["api"], {image: "api"})), \
                 patch("tools.asa_test_refresh.run", return_value="sha256:tampered"):
                with self.assertRaisesRegex(Blocked, "proof mismatch"):
                    image_proof(root, source, root / "candidate.env", sha, create=False)

    def test_new_sha_label_over_old_code_is_rejected_by_migration_checksum(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "new-checkout"
            (source / "migrations").mkdir(parents=True)
            (source / "migrations" / "0260_provenance.sql").write_text(
                "-- modern migration, not in previously deployed code\n")
            sha = "a" * 40
            refs = {f"asa-lab-{name}:git-{sha[:12]}": name
                    for name in ("api", "web", "scratch")}
            def fake_run(*argv, **kwargs):
                if argv[:3] == ("docker", "image", "inspect"):
                    return sha if "--format" in argv else ""
                if "stat" in argv:
                    return "644"
                if "sha256sum" in argv:
                    return "0" * 64 + "  " + argv[-1]
                raise AssertionError(f"unexpected command: {argv}")
            with patch("tools.asa_test_refresh.source_services",
                       return_value=(["api", "web", "scratch"], [], refs)), \
                 patch("tools.asa_test_refresh.run", side_effect=fake_run):
                with self.assertRaisesRegex(Blocked, "API source provenance mismatch"):
                    verify_images(Path(tmp) / "live", source, Path(tmp) / "overlay", sha)

    def test_migration_must_reach_exact_source_schema_before_switch(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            (source / "migrations").mkdir()
            (source / "migrations" / "0260_new_schema.sql").write_text("-- latest\n")
            with self.assertRaisesRegex(Blocked, "Isolated database schema mismatch"):
                assert_staged_schema(source, ["94", "31", "1712", "0255"])
            self.assertEqual(assert_staged_schema(source, ["94", "31", "1712", "0260"]), 260)




class BoundedBuildObservabilityTests(unittest.TestCase):
    def test_one_pinned_service_per_build_and_safe_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            logdir = root / "job"
            logdir.mkdir()
            events = []
            actions = []
            def fake_docker(*args, **kwargs):
                actions.append((args, kwargs))
                return ""
            def phase(name, **kwargs):
                events.append((name, kwargs))
            with patch("tools.asa_test_refresh.docker", side_effect=fake_docker):
                build_source_images(root, source, root / "candidate.env",
                                    ["api", "scratch"], logdir, phase)
            self.assertEqual([x[0] for x in actions],
                             [("build", "api"), ("build", "scratch")])
            self.assertTrue(all(k["source_build"] is True for _, k in actions))
            self.assertTrue(all(1 <= k["timeout"] <= 1200 for _, k in actions))
            self.assertEqual(actions[0][1]["log"].name, "build-api.log")
            self.assertEqual(actions[1][1]["log"].name, "build-scratch.log")
            self.assertEqual([p for p, _ in events],
                             ["image_build", "image_build", "image_build_complete"])
            self.assertEqual(events[-1][1]["completed_services"], ["api", "scratch"])
            self.assertEqual(events[1][1]["active_service"], "scratch")

    def test_unbounded_build_timeout_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            with patch("tools.asa_test_refresh.docker") as docker_call:
                with self.assertRaisesRegex(Blocked, "per-service build timeout"):
                    build_source_images(path, path, path, ["api"], path,
                                        lambda *a, **kw: None, service_timeout=5000)
                docker_call.assert_not_called()

    def test_build_output_log_is_private_and_not_echoed(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "private.log"
            result = run(sys.executable, "-c", "print('SYNTHETIC_DO_NOT_DISCLOSE')",
                         timeout=15, log=log)
            self.assertEqual(result, "")
            self.assertIn("SYNTHETIC_DO_NOT_DISCLOSE", log.read_text())
            self.assertEqual(stat.S_IMODE(log.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()

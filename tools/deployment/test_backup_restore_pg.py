"""Actual pg_dump/pg_restore, only in the dedicated disposable GitHub PG17 service.

PostgreSQL is real; MinIO/filesystem and image receipts use synthetic adapters.
This does not claim a full application or object-storage acceptance.
"""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import backup
from deployment.contracts import Blocked, verify_backup
from deployment.system import run

ENABLED = (os.environ.get("GITHUB_ACTIONS") == "true"
           and os.environ.get("ASA_TEST_POSTGRES_RESTORE") == "1")
SOURCE = Path(__file__).resolve().parents[2]
REVISION = "e" * 40


class PostgresFixture:
    def __init__(self, root, container):
        self.root, self.container = Path(root), container
        self.state = self.root / ".asa"
        self.state.mkdir()
        self.files, self.settings, self.profile = ["compose.yaml"], {}, "dev"
        self.project = "asa-restore-synthetic"
        self.database = "asa_source_" + uuid.uuid4().hex + "_test"
        self.env = {"POSTGRES_USER": "postgres", "POSTGRES_DB": self.database,
                    "ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000"}
        (self.root / ".env").write_text("ASA_TEST_SECRET=synthetic-fixture-only\n")
        (self.root / "compose.yaml").write_text("services: {}\n")
        self.objects = self.root / "synthetic-objects"
        self.objects.mkdir()
        (self.objects / "fixture.txt").write_text("synthetic object bytes")
        self.created, self.calls, self.remote_files = [], [], set()

    def command(self, args, env=None):
        command = ["docker", "exec", "--user", "postgres", "-i"]
        for key, value in {**self.env, **(env or {})}.items():
            command += ["-e", f"{key}={value}"]
        return command + [self.container, *args]

    def execute(self, *args, env=None, **kwargs):
        return run(self.command(args, env), **kwargs)

    def create(self, name):
        assert re.fullmatch(r"asa_[a-z_]+[a-f0-9]{32}_test", name)
        # Refuse anything already present; cleanup owns only successful creates.
        assert self.sql("SELECT count(*) FROM pg_database WHERE datname='" + name + "'", "postgres") == "0"
        self.execute("createdb", "-U", "postgres", name, capture=True)
        self.created.append(name)

    def sql(self, sql, database=None):
        return self.execute("psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                            "-d", database or self.database, input_data=sql + "\n", capture=True)

    def identity(self):
        self.calls.append(("identity",))
        return {name: {"id": name, "image": "synthetic-" + name, "running": True}
                for name in ("postgres", "minio")}

    def readiness(self):
        return {"revision": REVISION, "schema": 271}

    def wait_ready(self, revision, schema):
        assert (revision, schema) == (REVISION, 271)

    def compose(self, *args, **kwargs):
        self.calls.append(args)
        if args[:1] in (("stop",), ("start",)):
            return ""
        if args[:1] == ("config",):
            return json.dumps({"services": {"postgres": {}, "minio": {}}})
        assert args[:2] == ("exec", "-T")
        index, env = 2, {}
        while args[index] == "-e":
            key, value = args[index + 1].split("=", 1)
            env[key] = value
            index += 2
        assert args[index] == "postgres"
        command = args[index + 1:]
        if command[0] == "sh" and "createdb" in command[3]:
            self.create(env["RESTORE_DATABASE"])
            return ""
        if command[0] == "sh" and 'umask 077; cat > "$1"' == command[3]:
            self.remote_files.add(command[-1])
            result = self.execute(*command, env=env, **kwargs)
            self.execute("test", "-f", command[-1], capture=True)
            assert self.execute("stat", "-c", "%a:%U", command[-1], capture=True) == "600:postgres"
            return result
        return self.execute(*command, env=env, **kwargs)

    def synthetic_storage(self, args, **kwargs):
        if args[:2] == ["docker", "cp"]:
            assert args[2] == "minio:/data/."
            shutil.copytree(self.objects, args[3], dirs_exist_ok=True)
            return ""
        assert args[:3] == ["docker", "inspect", "--format"]
        return "sha256:" + "f" * 64

    def cleanup(self):
        for remote in self.remote_files:
            self.execute("rm", "-f", remote, capture=True)
        for name in reversed(self.created):
            # Every name was absent before this test created it in this service.
            self.execute("dropdb", "-U", "postgres", name, capture=True)


@unittest.skipUnless(ENABLED, "requires the dedicated disposable GitHub PostgreSQL service")
class BackupRestorePostgresTests(unittest.TestCase):
    def exercise(self, catalog):
        container = os.environ.get("ASA_TEST_POSTGRES_CONTAINER", "")
        self.assertRegex(container, r"^[a-f0-9]{12,64}$")
        with tempfile.TemporaryDirectory(prefix="asa-restore-ci-") as directory:
            install = PostgresFixture(directory, container)
            try:
                version = int(install.sql("SHOW server_version_num", "postgres"))
                self.assertTrue(170000 <= version < 180000, "fixture must use PostgreSQL 17")
                install.sql("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='asalab_app') THEN CREATE ROLE asalab_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN; END IF; END $$;", "postgres")
                install.create(install.database)
                install.sql("""
                    CREATE TABLE schema_migrations(version integer PRIMARY KEY);
                    INSERT INTO schema_migrations VALUES(271);
                    CREATE TABLE ai_assistant_config(singleton_key boolean PRIMARY KEY,
                        provider varchar NOT NULL, model varchar NOT NULL);
                    CREATE TABLE projects(id integer PRIMARY KEY, content text NOT NULL);
                    INSERT INTO projects VALUES(1,'synthetic visible'),(2,'synthetic hidden');
                    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE projects FORCE ROW LEVEL SECURITY;
                    CREATE POLICY owned_fixture ON projects TO asalab_app USING(id=1);
                    REVOKE ALL ON projects FROM PUBLIC,asalab_app;
                    GRANT SELECT ON projects TO asalab_app;
                """)
                if catalog:
                    install.sql("""
                        CREATE TABLE ai_ollama_cloud_models(id varchar PRIMARY KEY,
                            model varchar NOT NULL, capabilities jsonb NOT NULL, active boolean NOT NULL);
                        ALTER TABLE ai_ollama_cloud_models ENABLE ROW LEVEL SECURITY;
                        REVOKE ALL ON ai_ollama_cloud_models FROM PUBLIC,asalab_app;
                        INSERT INTO ai_ollama_cloud_models VALUES('ollama-cloud/fixture:27b','fixture:27b','["completion"]',true);
                    """)
                    # Use the actual released CHECK-function definition, not a permissive stub.
                    migration = (SOURCE / "migrations/0271_ai_ollama_cloud_catalog.sql").read_text()
                    prefix = "CREATE OR REPLACE FUNCTION public.ai_model_provider_matches"
                    definition = prefix + migration.split(prefix, 1)[1].split("$$;", 1)[0] + "$$;"
                    install.sql(definition)
                    provider, model = "ollama-cloud", "ollama-cloud/fixture:27b"
                else:
                    install.sql("CREATE FUNCTION public.ai_model_provider_matches(varchar,varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT $1='openai' AND $2='gpt-5-mini' $$;")
                    provider, model = "openai", "gpt-5-mini"
                install.sql("""
                    REVOKE ALL ON FUNCTION ai_model_provider_matches(varchar,varchar) FROM PUBLIC,asalab_app;
                    ALTER TABLE ai_assistant_config ADD CONSTRAINT ai_assistant_config_model_catalog_check
                        CHECK(public.ai_model_provider_matches(provider,model));
                """)
                install.sql(f"INSERT INTO ai_assistant_config VALUES(true,'{provider}','{model}');")
                original = install.sql("SELECT provider||'|'||model FROM ai_assistant_config")
                with patch.object(backup, "run", side_effect=install.synthetic_storage):
                    exported = backup.export_backup(install)
                manifest = verify_backup(exported)
                self.assertEqual(manifest["runtime"], install.readiness())
                self.assertEqual((exported / "private.env").read_bytes(), (install.root / ".env").read_bytes())
                self.assertEqual((exported / "objects/fixture.txt").read_text(), "synthetic object bytes")
                if catalog:
                    # Negative control: a standard unplanned restore really fails this CHECK.
                    raw_target = "asa_unplanned_" + uuid.uuid4().hex + "_test"
                    install.create(raw_target)
                    remote = "/tmp/asa-negative-" + uuid.uuid4().hex + ".dump"
                    install.remote_files.add(remote)
                    backup.upload_dump(install, exported / "database.dump", remote)
                    result = subprocess.run(install.command(["pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "-U", "postgres", "-d", raw_target, remote]), capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("ai_assistant_config_model_catalog_check", result.stderr)
                target = "asa_restored_" + uuid.uuid4().hex + "_test"
                backup.restore_check(install, exported, target)
                self.assertEqual(install.sql("SELECT provider||'|'||model FROM ai_assistant_config", target), original)
                self.assertEqual(install.sql("SELECT count(*) FROM projects", target), "2")
                self.assertEqual(install.sql("SET ROLE asalab_app; SELECT count(*) FROM projects", target).splitlines()[-1], "1")
                self.assertEqual(backup.privileges(install, target), manifest["applicationPrivileges"])
                owners = "SELECT string_agg(tablename||':'||tableowner,',' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'"
                self.assertEqual(install.sql(owners, target), install.sql(owners))
                self.assertEqual(install.sql("SELECT prosecdef FROM pg_proc WHERE proname='ai_model_provider_matches'", target), "t")
                self.assertEqual(install.sql("SELECT has_function_privilege('asalab_app','public.ai_model_provider_matches(varchar,varchar)','EXECUTE')", target), "f")
                with self.assertRaises(Blocked):
                    install.sql("INSERT INTO ai_assistant_config VALUES(false,'ollama-cloud','missing-model')", target)
                with self.assertRaises(Blocked) as existing:
                    backup.restore_check(install, exported, target)
                self.assertEqual(existing.exception.code, "RESTORE_EXISTS")
                self.assertEqual(install.sql("SELECT count(*) FROM projects", target), "2")
                self.assertEqual(install.sql("SELECT provider||'|'||model FROM ai_assistant_config"), original)
                self.assertEqual(verify_backup(exported), manifest)
                for remote_file in install.remote_files:
                    if not remote_file.startswith("/tmp/asa-negative-"):
                        install.execute("test", "!", "-e", remote_file, capture=True)
            finally:
                install.cleanup()

    def test_catalog_backed_config_real_custom_export_and_restore(self):
        self.exercise(catalog=True)

    def test_older_custom_export_without_optional_catalog(self):
        self.exercise(catalog=False)


if __name__ == "__main__":
    unittest.main()

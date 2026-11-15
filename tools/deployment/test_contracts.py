import datetime as dt
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import (Blocked, DEFAULT_WINDOW, REGISTRY, SERVICES, atomic_json,
                                  attest_database_targets, attest_embedded_editor, attest_proxy_policy, proxy_provenance_diagnostic, exact_origin, in_window, inventory_files, read_env, safe_member,
                                  validate_release, verify_backup, verify_embedded_entry_http)
from deployment.backup import recovery_configuration
from deployment.system import Installation, operation_lock, run
from deployment.releases import assert_ci, assert_general_ci, validate_resolved_images
import asa_manager


def release():
    return {"format": "asa-deployment-v2", "repository": "spikeal8-maker/asa-lab",
            "revision": "a" * 40, "schema": 159, "platform": "linux/amd64", "publicationRunId": 12,
            "images": {name: f"{REGISTRY}/{name}@sha256:" + "b" * 64 for name in SERVICES}}


def compose_config():
    return {"services": {
        "postgres": {"image": "postgres:17.7-bookworm", "environment": {"POSTGRES_DB": "asalab"}, "volumes": [{"type": "volume", "target": "/var/lib/postgresql/data", "source": "postgres-data"}]},
        "minio": {"volumes": [{"type": "volume", "target": "/data", "source": "objects"}]},
        "api": {"environment": {"APP_DATABASE_URL": "postgres://asalab_app:synthetic@postgres:5432/asalab"}},
        "migration": {"environment": {"MIGRATION_DATABASE_URL": "postgres://admin:synthetic@postgres:5432/asalab", "MIGRATION_EXPECT_DATABASE": "asalab", "MIGRATION_CONFIRM": "APPLY:asalab"}},
    }, "volumes": {"postgres-data": {"name": "asa-lab-dev_postgres-data"}, "objects": {"name": "asa-lab-dev_objects"}}}


class ProxyPolicyTests(unittest.TestCase):
    def test_default_and_explicit_ipv4_ipv6_ingress_are_valid(self):
        attest_proxy_policy({})
        attest_proxy_policy({'ASA_TRUSTED_PROXY_CIDRS': '172.16.0.0/12,fd00::/64',
                             'ASA_INGRESS_TRUSTED_PROXY_CIDRS': '192.0.2.7/32 2001:db8::7/128'})

    def test_panel_ingress_requires_one_host_and_its_own_port(self):
        panel = {'ASA_PANEL_INGRESS_PEER': '172.19.0.1', 'ASA_PANEL_INGRESS_PORT': '4615'}
        attest_proxy_policy(panel)
        diagnostic = proxy_provenance_diagnostic(panel)
        self.assertEqual(diagnostic['state'], 'external_policy_unverified')
        self.assertEqual(diagnostic['panelIngressPeer'], '172.19.0.1')
        for overrides in (
            {'ASA_PANEL_INGRESS_PEER': '172.19.0.0/16'},
            {'ASA_PANEL_INGRESS_PEER': '127.0.0.1\nservers'},
            {'ASA_PANEL_INGRESS_PEER': '0.0.0.0'},
            {'ASA_PANEL_INGRESS_PEER': '224.0.0.1'},
            {'ASA_PANEL_INGRESS_PORT': '0'},
            {'ASA_PANEL_INGRESS_PORT': '04610'},
            {'ASA_PANEL_INGRESS_PEER': '127.0.0.1', 'ASA_PANEL_INGRESS_PORT': '4610'},
            {'ASA_BLOCKS_PORT': '4615'},
            {'ASA_API_PORT': '4615'},
            {'ASA_PANEL_INGRESS_PORT': '65536'},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(Blocked) as failure:
                attest_proxy_policy(panel | overrides)
            self.assertEqual(failure.exception.code, 'PROXY_POLICY')

    def test_only_production_reserves_the_default_panel_ingress_port(self):
        env = {'ASA_WEB_PORT': '4615'}
        attest_proxy_policy(env, profile='dev')
        with self.assertRaises(Blocked):
            attest_proxy_policy(env, profile='production')
        attest_proxy_policy(env | {'ASA_PANEL_INGRESS_PORT': '4616'}, profile='production')
        with self.assertRaises(Blocked):
            attest_proxy_policy({'ASA_PANEL_INGRESS_PEER': '172.19.0.1'}, profile='production')

    def test_malformed_unbounded_and_injected_policies_block_before_operations(self):
        for key in ('ASA_TRUSTED_PROXY_CIDRS', 'ASA_INGRESS_TRUSTED_PROXY_CIDRS'):
            for raw in ('', '0.0.0.0/0', '::/0', '172.16.0.0/99', 'private_ranges',
                        '127.0.0.1/32 } servers {', 'x' * 2049):
                with self.subTest(key=key, raw=raw), self.assertRaises(Blocked) as failure:
                    attest_proxy_policy({key: raw})
                self.assertEqual(failure.exception.code, 'PROXY_POLICY')
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, '.env').write_text('ASA_INGRESS_TRUSTED_PROXY_CIDRS=0.0.0.0/0\n')
            with patch('deployment.system.run') as command, self.assertRaises(Blocked):
                Installation(directory)
            command.assert_not_called()


class EmbeddedEntryTests(unittest.TestCase):
    def test_transient_public_404_is_retried_and_permanent_failure_names_the_path(self):
        from urllib.error import HTTPError
        origin, revision = 'https://asa.example.test', 'a' * 40
        responses = {'/health/ready': json.dumps({'status':'ready', 'deployment':{'revision':revision,'synchronized':True}}),
                     '/build-metadata.json':json.dumps({'revision':revision}),
                     '/runtime-config.js':'globalThis.__ASA_RUNTIME_CONFIG__='+json.dumps({'blocksRuntimeOrigin':origin})+';',
                     '/internal/blocks/':'<html data-asa-scratch-host="m1-002a">Scratch</html>', '/internal/blocks/healthz':'ok'}
        attempts = {}
        def fetch(url, **kwargs):
            path = url.removeprefix(origin); attempts[path] = attempts.get(path, 0) + 1
            if path == '/internal/blocks/' and attempts[path] == 1:
                raise HTTPError(url,404,'not found',{},None)
            value = io.BytesIO(responses[path].encode()); value.status = 200; value.geturl = lambda: url
            return value
        with patch('deployment.contracts.urlopen', side_effect=fetch), patch('deployment.contracts.time.sleep'):
            verify_embedded_entry_http(origin, revision)
        self.assertEqual(attempts['/internal/blocks/'],2)
        for status, expected in ((404, 3), (401, 1)):
            with patch('deployment.contracts.urlopen', side_effect=lambda *a,**k: (_ for _ in ()).throw(HTTPError(a[0],status,'private text',{},None))) as mocked, patch('deployment.contracts.time.sleep'):
                with self.assertRaises(Blocked) as failure: verify_embedded_entry_http(origin, revision)
            self.assertEqual(mocked.call_count,expected)
            self.assertIn('/health/ready',str(failure.exception)); self.assertNotIn('private text',str(failure.exception))

    def config(self, origin, parent, public=''):
        return {'services': {'api': {'environment': {'ASA_BLOCKS_RUNTIME_ORIGIN': origin, 'ASA_PUBLIC_WEB_ORIGINS': public}},
                             'scratch': {'environment': {'ASA_BLOCKS_PARENT_ORIGIN': parent}}}}

    def test_single_local_or_explicit_public_portal_is_valid(self):
        attest_embedded_editor(self.config('http://127.0.0.1:4610', 'http://127.0.0.1:4610'),
                               'http://127.0.0.1:4610', 'dev')
        attest_embedded_editor(self.config('http://127.0.0.1:4610', 'http://127.0.0.1:4610'),
                               'http://127.0.0.1:4610', 'production')
        attest_embedded_editor(self.config('http://172.23.104.170:4610', 'http://172.23.104.170:4610'),
                               'http://172.23.104.170:4610', 'dev')
        attest_embedded_editor(self.config('https://asa-lab.ru', 'https://asa-lab.ru', 'https://asa-lab.ru'),
                               'https://asa-lab.ru', 'production')

    def test_old_saved_separate_origin_blocks_before_service_switch(self):
        for origin, parent, public in [('http://localhost:4613', 'http://127.0.0.1:4610', ''),
                                       ('https://scratch.example.test', 'https://asa-lab.ru', 'https://asa-lab.ru'),
                                       ('https://scratch.example.test', 'https://scratch.example.test', 'https://asa-lab.ru')]:
            with self.subTest(origin=origin), self.assertRaises(Blocked) as problem:
                attest_embedded_editor(self.config(origin, parent, public), 'https://asa-lab.ru', 'production')
            self.assertEqual(problem.exception.code, 'EDITOR_ENTRY')

    def test_owner_lan_address_must_not_silently_fall_back_to_localhost(self):
        with self.assertRaises(Blocked) as problem:
            attest_embedded_editor(self.config('http://localhost:4610', 'http://localhost:4610'),
                                   'http://172.23.104.170:4610', 'dev')
        self.assertEqual(problem.exception.code, 'EDITOR_ENTRY')

    def test_missing_owner_entry_blocks_before_update(self):
        with self.assertRaises(Blocked) as problem:
            attest_embedded_editor(self.config('http://127.0.0.1:4610', 'http://127.0.0.1:4610'), None, 'dev')
        self.assertEqual(problem.exception.code, 'EDITOR_ENTRY')

    def test_non_loopback_production_http_is_rejected(self):
        origin = 'http://172.23.104.170:4610'
        with self.assertRaises(Blocked) as problem:
            attest_embedded_editor(self.config(origin, origin), origin, 'production')
        self.assertEqual(problem.exception.code, 'EDITOR_ENTRY')

    def test_http_probe_requires_same_revision_and_runtime_origin(self):
        origin, revision = 'http://172.23.104.170:4610', 'a' * 40
        responses = {
            '/health/ready': json.dumps({'status': 'ready', 'deployment': {'revision': revision, 'synchronized': True}}),
            '/build-metadata.json': json.dumps({'revision': revision}),
            '/runtime-config.js': 'globalThis.__ASA_RUNTIME_CONFIG__=' + json.dumps({'blocksRuntimeOrigin': origin}) + ';',
            '/internal/blocks/': '<html data-asa-scratch-host="m1-002a">Scratch</html>',
            '/internal/blocks/healthz': 'ok',
        }
        verify_embedded_entry_http(origin, revision, responses.__getitem__)
        responses['/runtime-config.js'] = 'globalThis.__ASA_RUNTIME_CONFIG__={"blocksRuntimeOrigin":"http://localhost:4610"};'
        with self.assertRaises(Blocked) as problem:
            verify_embedded_entry_http(origin, revision, responses.__getitem__)
        self.assertEqual(problem.exception.code, 'EDITOR_ENTRY')
        responses['/runtime-config.js'] = 'globalThis.__ASA_RUNTIME_CONFIG__=' + json.dumps({'blocksRuntimeOrigin': origin}) + ';'
        responses['/internal/blocks/'] = '<html>Portal SPA fallback</html>'
        with self.assertRaises(Blocked) as problem:
            verify_embedded_entry_http(origin, revision, responses.__getitem__)
        self.assertEqual(problem.exception.code, 'EDITOR_ENTRY')
        responses['/internal/blocks/'] = '<html data-asa-scratch-host="m1-002a">Scratch</html>'
        responses['/internal/blocks/healthz'] = '<html>Portal SPA fallback</html>'
        with self.assertRaises(Blocked) as problem:
            verify_embedded_entry_http(origin, revision, responses.__getitem__)
        self.assertEqual(problem.exception.code, 'EDITOR_ENTRY')


class WindowTests(unittest.TestCase):
    def test_exact_moscow_boundaries_independent_of_host_timezone(self):
        for timestamp, expected in [
            ("2026-09-26T23:59:59+00:00", False),
            ("2026-09-27T00:00:00+00:00", True),
            ("2026-09-27T01:59:59+00:00", True),
            ("2026-09-27T02:00:00+00:00", False),
            ("2026-09-28T00:30:00+00:00", False),
        ]:
            with self.subTest(timestamp=timestamp):
                self.assertEqual(in_window(DEFAULT_WINDOW, dt.datetime.fromisoformat(timestamp)), expected)

    def test_late_download_does_not_start_maintenance(self):
        self.assertFalse(in_window(DEFAULT_WINDOW, dt.datetime.fromisoformat("2026-09-27T01:46:00+00:00"), 15))

    def test_invalid_window_is_not_silently_defaulted(self):
        for field, value in [("start", "03:99"), ("end", "02:00"), ("weekday", 7), ("utcOffsetMinutes", "180")]:
            with self.subTest(field=field), self.assertRaises(Blocked):
                in_window({**DEFAULT_WINDOW, field: value})


class ReleaseTests(unittest.TestCase):
    @staticmethod
    def ci_fixture():
        revision = "a" * 40
        general = {"id": 11, "name": "ASA Lab Governance and Code Gates", "path": ".github/workflows/spec-validation.yml",
                   "head_sha": revision, "head_branch": "main", "status": "completed", "conclusion": "success",
                   "run_number": 1, "run_attempt": 1, "event": "push"}
        publication = {"id": 12, "name": "ASA Portable Release", "path": ".github/workflows/portable-release.yml",
                       "display_title": "Release " + revision, "head_sha": "b" * 40, "head_branch": "main",
                       "status": "completed", "conclusion": "success", "run_attempt": 1, "event": "workflow_run"}
        names = ["Governance contracts", "Format lint types contracts build", "PostgreSQL tests and RLS",
                 "Access A real browser journeys", "ASA / required"]
        publication_names = ["gate", "contracts (ubuntu-latest)", "contracts (windows-latest)", "publish",
                             "build (api, Dockerfile.api, runtime)", "build (web, Dockerfile.web, runtime)",
                             "build (scratch, infra/scratch-editor/Dockerfile)", "build (minio, infra/minio/Dockerfile)",
                             "build (search, infra/search/Dockerfile)"]
        def jobs(run, labels):
            return [{"id": run["id"] * 100 + n, "run_id": run["id"], "run_attempt": 1, "name": name,
                     "head_sha": run["head_sha"], "status": "completed", "conclusion": "success", "runner_id": 100,
                     "started_at": "2026-11-02T10:00:00Z", "completed_at": "2026-11-02T10:01:00Z"}
                    for n, name in enumerate(labels)]
        return {"general": general, "publication": publication,
                "general_jobs": jobs(general, names), "publication_jobs": jobs(publication, publication_names)}

    @staticmethod
    def ci_response(fixture):
        def respond(request, **kwargs):
            path = request.full_url.split("/actions/runs", 1)[1]
            if path.startswith("?"):
                payload = {"total_count": len(fixture.get("runs", [fixture["general"]])),
                           "workflow_runs": fixture.get("runs", [fixture["general"]])}
            elif "/jobs?" in path:
                kind = "general" if path.startswith("/11/") else "publication"
                rows = fixture[kind + "_jobs"]
                payload = {"total_count": len(rows), "jobs": rows}
            else:
                payload = fixture["general" if path == "/11" else "publication"]
            return io.BytesIO(json.dumps(payload).encode())
        return respond

    @classmethod
    def ci_retry_fixture(cls, kind):
        fixture = cls.ci_fixture()
        fixture[kind]["run_attempt"] = 2
        name = "PostgreSQL tests and RLS" if kind == "general" else "publish"
        previous = next(job for job in fixture[kind + "_jobs"] if job["name"] == name)
        retried = {**previous, "id": 9999, "run_attempt": 2,
                   "started_at": "2026-11-02T10:02:00Z", "completed_at": "2026-11-02T10:03:00Z"}
        fixture[kind + "_jobs"].append(retried)
        return fixture, previous, retried

    def test_partial_retry_retains_actual_same_source_successes(self):
        for kind in ("general", "publication"):
            for reverse in (False, True):
                fixture, previous, retried = self.ci_retry_fixture(kind)
                previous["conclusion"] = "failure"
                if reverse:
                    fixture[kind + "_jobs"].reverse()
                with self.subTest(kind=kind, reverse=reverse), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)):
                    assert_ci(release())

    def test_newer_nonpassing_retry_overrides_previous_success(self):
        for kind in ("general", "publication"):
            for result in ("failure", "cancelled", "skipped", "timed_out", "neutral", "queued", "in_progress", "waiting"):
                fixture, previous, retried = self.ci_retry_fixture(kind)
                if result in ("queued", "in_progress", "waiting"):
                    retried.update(status=result, conclusion=None, started_at=None, completed_at=None, runner_id=0)
                else:
                    retried["conclusion"] = result
                self.assertEqual(previous["conclusion"], "success")
                with self.subTest(kind=kind, result=result), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                    assert_ci(release())

    def test_every_retry_row_is_source_bound_and_unambiguous(self):
        for kind in ("general", "publication"):
            for row in ("previous", "retried"):
                for change in ({"run_id": 77}, {"head_sha": "c" * 40}, {"run_attempt": 0}, {"run_attempt": 3},
                               {"run_attempt": True}, {"run_attempt": "2"}, {"name": None}, {"name": ""},
                               {"status": "unknown"}, {"conclusion": None}):
                    fixture, previous, retried = self.ci_retry_fixture(kind)
                    (previous if row == "previous" else retried).update(change)
                    with self.subTest(kind=kind, row=row, change=change), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                        assert_ci(release())
            for duplicate_id in (False, True):
                fixture, previous, retried = self.ci_retry_fixture(kind)
                fixture[kind + "_jobs"].append({**retried, "id": retried["id"] if duplicate_id else 9998})
                with self.subTest(kind=kind, duplicate_id=duplicate_id), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                    assert_ci(release())

    def test_partial_retry_cannot_hide_missing_job_or_current_attempt(self):
        for kind in ("general", "publication"):
            for missing in ("required", "current_attempt"):
                fixture, previous, retried = self.ci_retry_fixture(kind)
                name = "Governance contracts" if kind == "general" else "gate"
                if missing == "required":
                    fixture[kind + "_jobs"] = [job for job in fixture[kind + "_jobs"] if job["name"] != name]
                else:
                    fixture[kind + "_jobs"] = [job for job in fixture[kind + "_jobs"] if job["run_attempt"] < 2]
                with self.subTest(kind=kind, missing=missing), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                    assert_ci(release())

    def test_aggregate_newer_failure_overrides_older_success(self):
        fixture, previous, retried = self.ci_retry_fixture("general")
        aggregate = next(job for job in fixture["general_jobs"] if job["name"] == "ASA / required")
        fixture["general_jobs"].append({**aggregate, "id": 9998, "run_attempt": 2, "conclusion": "failure"})
        with patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
            assert_ci(release())

    def test_partial_retry_job_pages_cannot_be_truncated(self):
        for kind in ("general", "publication"):
            fixture, previous, retried = self.ci_retry_fixture(kind)
            base = self.ci_response(fixture)
            def truncated(request, **kwargs):
                if f"/{fixture[kind]['id']}/jobs?" in request.full_url:
                    return io.BytesIO(json.dumps({"total_count": 99, "jobs": fixture[kind + "_jobs"]}).encode())
                return base(request, **kwargs)
            with self.subTest(kind=kind), patch("deployment.releases.urllib.request.urlopen", side_effect=truncated), self.assertRaises(Blocked) as denied:
                assert_ci(release())
            self.assertEqual(denied.exception.code, "CI_UNAVAILABLE")

    def test_overall_success_cannot_hide_skipped_general_job(self):
        fixture = self.ci_fixture()
        fixture["general_jobs"][2]["conclusion"] = "skipped"
        with patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
            assert_ci(release())

    def test_overall_success_cannot_hide_skipped_publication(self):
        fixture = self.ci_fixture()
        for job in fixture["publication_jobs"]:
            if job["name"] == "publish":
                job["conclusion"] = "skipped"
        with patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
            assert_ci(release())

    def test_minio_init_must_use_the_verified_server_image(self):
        from unittest.mock import MagicMock
        candidate = release()
        services = {name: {"image": candidate["images"][name]} for name in SERVICES}
        services["migration"] = {"image": candidate["images"]["api"]}
        services["minio-init"] = {"image": candidate["images"]["minio"]}
        services["postgres"] = {"environment": {}}
        config = {"services": services}
        install = MagicMock(profile="dev")
        install.compose.return_value = json.dumps(config)
        with patch("deployment.releases.attest_embedded_editor"), patch("deployment.releases.attest_database_targets"):
            self.assertEqual(validate_resolved_images(install, candidate), config)
            services["minio-init"]["image"] = "docker.io/minio/mc:unverified"
            install.compose.return_value = json.dumps(config)
            with self.assertRaisesRegex(Blocked, "minio-init"):
                validate_resolved_images(install, candidate)

    def test_publication_and_general_ci_must_both_match(self):
        for change in ({}, {"name": "Release " + "a" * 40}, {"name": "Unrelated workflow"},
                       {"path": ".github/workflows/other.yml"}, {"status": "in_progress"},
                       {"conclusion": "failure"}, {"head_branch": "feature"}, {"display_title": "Release " + "b" * 40},
                       {"id": 13}, {"event": "pull_request"}):
            fixture = self.ci_fixture()
            fixture["publication"].update(change)
            with self.subTest(change=change), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)):
                if (change and "name" not in change) or change.get("name") == "Unrelated workflow":
                    with self.assertRaises(Blocked):
                        assert_ci(release())
                else:
                    assert_ci(release())
        fixture = self.ci_fixture()
        fixture["runs"] = [fixture["general"], {**fixture["general"], "id": 13, "run_number": 2, "conclusion": "failure"}]
        with patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
            assert_ci(release())

    def test_full_and_legacy_general_have_actual_successful_jobs(self):
        for legacy in (False, True):
            fixture = self.ci_fixture()
            if legacy:
                fixture["general_jobs"].pop()
            with self.subTest(legacy=legacy), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)):
                assert_ci(release())
                assert_general_ci("a" * 40)

    def test_every_required_job_must_be_present_and_successful(self):
        for kind in ("general", "publication"):
            for index in range(len(self.ci_fixture()[kind + "_jobs"])):
                for result in ("missing", "skipped", "failure", "cancelled", "not_applicable", "neutral"):
                    fixture = self.ci_fixture()
                    jobs = fixture[kind + "_jobs"]
                    # The aggregate is optional only for genuine pre-aggregate releases.
                    if kind == "general" and index == 4 and result == "missing":
                        continue
                    if result == "missing":
                        jobs.pop(index)
                    else:
                        jobs[index]["conclusion"] = result
                    with self.subTest(kind=kind, index=index, result=result), \
                            patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                        assert_ci(release())

    def test_jobs_cannot_use_stale_source_attempt_or_synthetic_success(self):
        for kind in ("general", "publication"):
            for change in ({"run_id": 99}, {"run_id": True}, {"run_attempt": 2}, {"run_attempt": True}, {"head_sha": "c" * 40},
                           {"status": "in_progress"}, {"runner_id": 0}, {"runner_id": True},
                           {"started_at": None}, {"completed_at": "2026-11-01T00:00:00Z"}):
                fixture = self.ci_fixture()
                fixture[kind + "_jobs"][0].update(change)
                with self.subTest(kind=kind, change=change), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                    assert_ci(release())
            fixture = self.ci_fixture()
            fixture[kind + "_jobs"].append({**fixture[kind + "_jobs"][0], "id": 9999})
            with self.subTest(kind=kind, duplicate=True), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                assert_ci(release())

    def test_general_identity_is_exact_and_newest_attempt_is_required(self):
        for change in ({"path": ".github/workflows/other.yml"}, {"head_sha": "c" * 40}, {"head_branch": "feature"},
                       {"event": "pull_request"}, {"status": "in_progress"}, {"conclusion": "cancelled"},
                       {"run_attempt": 2}, {"run_attempt": True}, {"run_number": None}):
            fixture = self.ci_fixture()
            fixture["general"].update(change)
            with self.subTest(change=change), patch("deployment.releases.urllib.request.urlopen", side_effect=self.ci_response(fixture)), self.assertRaises(Blocked):
                assert_ci(release())

    def test_paginated_general_and_jobs_are_complete_and_bound(self):
        fixture = self.ci_fixture()
        general = fixture["general"]
        runs = [{**general, "id": 2000 + i, "name": "Other workflow"} for i in range(100)] + [general]
        jobs = fixture["general_jobs"] + [{**fixture["general_jobs"][0], "id": 3000 + i, "name": f"Other {i}"} for i in range(100)]
        base = self.ci_response(fixture)
        seen = []
        def paginated(request, **kwargs):
            from urllib.parse import parse_qs, urlsplit
            parsed = urlsplit(request.full_url)
            page = int(parse_qs(parsed.query).get("page", ["1"])[0])
            seen.append(parsed.path + "?" + parsed.query)
            if parsed.path.endswith("/actions/runs"):
                rows, key = runs, "workflow_runs"
            elif parsed.path.endswith("/11/jobs"):
                self.assertEqual(parse_qs(parsed.query)["filter"], ["all"])
                rows, key = jobs, "jobs"
            else:
                return base(request, **kwargs)
            return io.BytesIO(json.dumps({"total_count": len(rows), key: rows[(page - 1) * 100:page * 100]}).encode())
        with patch("deployment.releases.urllib.request.urlopen", side_effect=paginated):
            assert_ci(release())
        self.assertTrue(any("/11/jobs?filter=all&per_page=100&page=2" in path for path in seen))
        self.assertTrue(any("head_sha=" in path and "page=2" in path for path in seen))

    def test_truncated_duplicate_and_oversized_api_listings_block(self):
        fixture = self.ci_fixture()
        for payload in ({"total_count": 2, "workflow_runs": [fixture["general"]]},
                        {"total_count": 2, "workflow_runs": [fixture["general"], fixture["general"]]},
                        {"total_count": 1001, "workflow_runs": []}, {"workflow_runs": []},
                        {"total_count": True, "workflow_runs": []}, {"total_count": 1, "workflow_runs": [None]}):
            base = self.ci_response(fixture)
            def respond(request, **kwargs):
                if "/actions/runs?" in request.full_url:
                    return io.BytesIO(json.dumps(payload).encode())
                return base(request, **kwargs)
            with self.subTest(payload=payload), patch("deployment.releases.urllib.request.urlopen", side_effect=respond), self.assertRaises(Blocked):
                assert_ci(release())

    def test_run_or_attempt_changes_during_verification_block(self):
        for kind in ("general", "publication"):
            fixture = self.ci_fixture()
            base = self.ci_response(fixture)
            identity = fixture[kind]["id"]
            def respond(request, **kwargs):
                if request.full_url.endswith(f"/actions/runs/{identity}"):
                    return io.BytesIO(json.dumps({**fixture[kind], "run_attempt": 2}).encode())
                return base(request, **kwargs)
            with self.subTest(kind=kind), patch("deployment.releases.urllib.request.urlopen", side_effect=respond), self.assertRaises(Blocked):
                assert_ci(release())
        fixture = self.ci_fixture()
        base = self.ci_response(fixture)
        listings = 0
        def new_general(request, **kwargs):
            nonlocal listings
            if "/actions/runs?" in request.full_url:
                listings += 1
                if listings == 2:
                    newest = {**fixture["general"], "id": 13, "run_number": 2}
                    return io.BytesIO(json.dumps({"total_count": 1, "workflow_runs": [newest]}).encode())
            return base(request, **kwargs)
        with patch("deployment.releases.urllib.request.urlopen", side_effect=new_general), self.assertRaises(Blocked):
            assert_ci(release())

    def assert_publication_concurrency(self, workflow):
        # Pin this small workflow contract without adding a YAML dependency.
        start, end = "\nconcurrency:\n", "\njobs:\n"
        self.assertEqual(workflow.count(start), 1)
        self.assertEqual(workflow.count(end), 1)
        self.assertLess(workflow.index(start), workflow.index(end))
        self.assertEqual(workflow.split(start, 1)[1].split(end, 1)[0],
                         "  group: asa-stable-release\n  cancel-in-progress: false\n  queue: max\n")

    def test_publication_retains_pending_candidates_and_protects_running_release(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/portable-release.yml").read_text()
        self.assert_publication_concurrency(workflow)

    def test_publication_concurrency_rejects_candidate_loss_or_split_publication(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/portable-release.yml").read_text()
        for old, new in (("  queue: max\n", ""), ("  queue: max\n", "  queue: single\n"),
                         ("  cancel-in-progress: false\n", "  cancel-in-progress: true\n"),
                         ("  group: asa-stable-release\n", "  group: release-${{ github.sha }}\n")):
            with self.subTest(replacement=new), self.assertRaises(AssertionError):
                self.assert_publication_concurrency(workflow.replace(old, new))

    def publication_gate_script(self, workflow=None):
        # This single reviewed heredoc is tested in stdlib-only deployment CI.
        # Exact layout bounds deliberately reject drift instead of parsing YAML.
        if workflow is None:
            workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/portable-release.yml").read_text()
        start, end = "\n  gate:\n", "\n  build:\n"
        self.assertEqual(workflow.count(start), 1)
        self.assertEqual(workflow.count(end), 1)
        self.assertLess(workflow.index(start), workflow.index(end))
        gate = workflow.split(start, 1)[1].split(end, 1)[0]
        source_marker = "      - id: source\n"
        checkout = ("    steps:\n      - uses: actions/checkout@v4\n        with:\n"
                    "          ref: ${{ github.workflow_sha }}\n"
                    "          fetch-depth: 0\n          persist-credentials: false\n")
        self.assertEqual(gate.count(checkout), 1)
        self.assertEqual(gate.count(source_marker), 1)
        source = gate.split(source_marker, 1)[1]
        opening, closing = "        run: |\n          python -P - <<'PY'\n", "\n          PY"
        self.assertEqual(source.count(opening), 1)
        body = source.split(opening, 1)[1]
        self.assertEqual(body.count(closing), 1)
        body, tail = body.split(closing, 1)
        self.assertEqual(tail, "")
        self.assertTrue(body and all(line.startswith(" " * 10) for line in body.splitlines()))
        return "\n".join(line[10:] for line in body.splitlines())

    def run_publication_gate(self, remote, revision="a" * 40, general_error=None, ancestor=True):
        script = self.publication_gate_script()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "output"
            environment = {"GITHUB_OUTPUT": str(output)}
            if revision is not None:
                environment["REVISION"] = revision
            order = []
            def current_main(*args, **kwargs):
                order.append("main")
                self.assertFalse(output.exists())
                if isinstance(remote, Exception):
                    raise remote
                return remote
            def general(candidate):
                order.append("general")
                self.assertEqual(candidate, revision)
                self.assertFalse(output.exists())
                if general_error:
                    raise general_error
            def check_ancestor(candidate, main):
                order.append("ancestry")
                self.assertEqual((candidate, main), (revision, remote))
                self.assertFalse(output.exists())
                return ancestor
            failure = None
            with patch.dict(os.environ, environment, clear=True), \
                    patch("deployment.publication.canonical_main", side_effect=current_main), \
                    patch("deployment.publication.is_ancestor", side_effect=check_ancestor), \
                    patch("deployment.releases.assert_general_ci", side_effect=general):
                try:
                    exec(compile(script, "portable-release-gate", "exec"), {})
                except Blocked as problem:
                    failure = problem
            return failure, output.read_text() if output.exists() else "", order

    def test_publication_gate_executes_the_same_full_general_verifier(self):
        failure, output, order = self.run_publication_gate("b" * 40)
        self.assertIsNone(failure)
        self.assertEqual(order, ["main", "ancestry", "general"])
        self.assertEqual(output, "revision=" + "a" * 40 + "\n")

    def test_publication_gate_rejects_foreign_revision_before_general_and_output(self):
        failure, output, order = self.run_publication_gate("b" * 40, ancestor=False)
        self.assertEqual(failure.code, "RELEASE_SOURCE")
        self.assertEqual((output, order), ("", ["main", "ancestry"]))
        for revision in (None, "", "a" * 39, "g" * 40, "a" * 40 + "\n"):
            with self.subTest(revision=revision):
                failure, output, order = self.run_publication_gate("a" * 40, revision)
                self.assertEqual(failure.code, "RELEASE_SOURCE")
                self.assertEqual((output, order), ("", []))

    def test_publication_gate_tool_or_incomplete_general_failure_emits_no_revision(self):
        problem = Blocked("COMMAND", "canonical main fetch failed", "retry")
        failure, output, order = self.run_publication_gate(problem)
        self.assertIs(failure, problem)
        self.assertEqual((output, order), ("", ["main"]))
        problem = Blocked("CI_BLOCKED", "partial", "wait")
        failure, output, order = self.run_publication_gate("b" * 40, general_error=problem)
        self.assertIs(failure, problem)
        self.assertEqual((output, order), ("", ["main", "ancestry", "general"]))

    def test_only_a_guarded_normal_build_can_publish_stable(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/portable-release.yml").read_text()
        self.assertIn("\n  contracts:\n    needs: gate\n", workflow)
        self.assertIn("\n  build:\n    needs: [gate, contracts]\n", workflow)
        self.assertIn("\n  publish:\n    needs: [gate, build]\n", workflow)
        promotion = ("        run: python -P -m deployment.publication\n"
                     "      - uses: docker/build-push-action@v6\n"
                     "        if: steps.promotion.outputs.promote == 'true'\n")
        self.assertEqual(workflow.count(promotion), 1)
        self.assertEqual(workflow.count("/deployment:stable"), 1)
        self.assertIn("/deployment:stable", workflow.split(promotion, 1)[1])

    def test_pinned_set(self):
        self.assertEqual(validate_release(release())["schema"], 159)

    def test_mutable_and_foreign_images_are_refused(self):
        for image in [f"{REGISTRY}/api:latest", "evil.example/api@sha256:" + "b" * 64,
                      f"{REGISTRY}/web@sha256:" + "b" * 64]:
            candidate = release()
            candidate["images"]["api"] = image
            with self.subTest(image=image), self.assertRaises(Blocked):
                validate_release(candidate)

    def test_incomplete_manifest(self):
        for field in ["schema", "revision", "publicationRunId", "platform", "images"]:
            candidate = release()
            del candidate[field]
            with self.subTest(field=field), self.assertRaises(Blocked):
                validate_release(candidate)

    def test_origin_rejects_injection_credentials_and_path(self):
        for value in ["https://host/path", "https://user:pass@host", "https://host\";alert(1)",
                      "https://host?x", "https://host#x", "https://host:99999", "*"]:
            with self.subTest(value=value), self.assertRaises((Blocked, ValueError)):
                exact_origin(value)
        self.assertEqual(exact_origin("http://localhost:4613"), "http://localhost:4613")


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ["database.dump", "globals.sql", "private.env"]:
            (self.root / name).write_bytes(b"fixture")
        (self.root / "objects").mkdir()
        (self.root / "objects" / "saved-media").write_bytes(b"user-media")
        atomic_json(self.root / "manifest.json", {"format": "asa-backup-v1", "complete": True,
                    "files": inventory_files(self.root), "runtime": {"revision": "a" * 40}})

    def tearDown(self):
        self.temp.cleanup()

    def test_complete_backup(self):
        self.assertEqual(len(verify_backup(self.root)["files"]), 4)

    def test_binary_dump_stream_is_not_text_decoded(self):
        payload = b"PGDMP\x00\xff\r\n\x1a\x80" * 1024
        source = self.root / "binary-source"
        destination = self.root / "binary-copy"
        source.write_bytes(payload)
        with source.open("rb") as incoming, destination.open("wb") as outgoing:
            run([sys.executable, "-c", "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())"], input_file=incoming, output=outgoing)
        self.assertEqual(destination.read_bytes(), payload)

    def test_corrupt_database(self):
        (self.root / "database.dump").write_bytes(b"changed")
        with self.assertRaises(Blocked):
            verify_backup(self.root)

    def test_missing_media_is_not_success(self):
        (self.root / "objects" / "saved-media").unlink()
        with self.assertRaises(Blocked):
            verify_backup(self.root)

    def test_added_file_is_not_ignored(self):
        (self.root / "unexpected").write_bytes(b"x")
        with self.assertRaises(Blocked):
            verify_backup(self.root)

    def test_traversal_and_windows_paths(self):
        for value in ["../private.env", "C:/secret", "/etc/passwd", "objects/../../secret", "..\\secret", "objects//file"]:
            with self.subTest(value=value), self.assertRaises(Blocked):
                safe_member(self.root, value)

    def test_duplicate_environment_rejected(self):
        file = self.root / ".env"
        file.write_text("POSTGRES_DB=one\nPOSTGRES_DB=two\n")
        with self.assertRaises(Blocked):
            read_env(file)

    def test_second_operation_cannot_acquire_lock(self):
        with operation_lock(self.root):
            with self.assertRaises(Blocked):
                with operation_lock(self.root):
                    self.fail("Second lock was admitted")


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".env").write_text("COMPOSE_PROJECT_NAME=asa-lab-dev\n")
        self.install = Installation(self.root, "dev")
        from unittest.mock import MagicMock
        self.install.compose = MagicMock(return_value=json.dumps(compose_config()))
        self.install.container_environment = MagicMock(return_value={"POSTGRES_DB": "asalab"})

    def tearDown(self):
        self.temp.cleanup()

    def record(self, **overrides):
        labels = {"com.docker.compose.project": "asa-lab-dev", "com.docker.compose.service": "postgres",
                  "com.docker.compose.project.working_dir": str(self.root),
                  "com.docker.compose.project.config_files": ",".join(str(self.root / p) for p in self.install.files)}
        labels.update(overrides)
        return {"labels": labels, "image": "postgres:17.7-bookworm", "running": True, "mounts": [{"Type": "volume", "Destination": "/var/lib/postgresql/data", "Name": "asa-lab-dev_postgres-data"}]}

    def test_changed_pgdata_or_engine_cannot_initialize_a_new_empty_database(self):
        for section, key, value in (("environment", "PGDATA", "/var/lib/postgresql/data/new"), (None, "image", "postgres:18")):
            config = compose_config()
            target = config["services"]["postgres"]
            (target[section] if section else target)[key] = value
            self.install.compose.return_value = json.dumps(config)
            with self.subTest(key=key), patch.object(self.install, "containers", return_value=[self.record()]), self.assertRaises(Blocked):
                self.install.identity()

    def test_renamed_and_external_database_volumes_are_refused(self):
        for name in ("asa-lab-dev_new-data", "external-other-database"):
            config = compose_config()
            config["volumes"]["postgres-data"]["name"] = name
            self.install.compose.return_value = json.dumps(config)
            with self.subTest(name=name), patch.object(self.install, "containers", return_value=[self.record()]), self.assertRaisesRegex(Blocked, "Persistent volume identity changed"):
                self.install.identity()

    def test_changed_object_volume_is_refused(self):
        minio = self.record(**{"com.docker.compose.service": "minio"})
        minio["mounts"] = [{"Type": "volume", "Destination": "/data", "Name": "different-objects"}]
        with patch.object(self.install, "containers", return_value=[self.record(), minio]), self.assertRaises(Blocked):
            self.install.identity()

    def test_database_targets_match_backup(self):
        config = compose_config()
        attest_database_targets(config, {"POSTGRES_DB": "asalab"}, config["services"]["api"]["environment"])
        for service, key in (("api", "APP_DATABASE_URL"), ("migration", "MIGRATION_DATABASE_URL")):
            for url in ("postgres://user:synthetic@external:5432/asalab", "postgres://user:synthetic@postgres:5432/other",
                        "postgres://user:synthetic@postgres:5432/asalab_delivery_restore_test"):
                candidate = compose_config()
                candidate["services"][service]["environment"][key] = url
                with self.subTest(service=service, url=url), self.assertRaises(Blocked):
                    attest_database_targets(candidate, {"POSTGRES_DB": "asalab"})
        with self.assertRaises(Blocked):
            attest_database_targets(config, {"POSTGRES_DB": "asalab"}, {"APP_DATABASE_URL": "postgres://user:synthetic@postgres:5432/other"})

    def test_backup_configuration_uses_running_revision(self):
        (self.root / ".git").mkdir()
        for file in self.install.files:
            (self.root / file).write_text("candidate configuration")
        calls = []
        def git(*args):
            calls.append(args)
            return args[-1] if args[0] == "ls-files" else "old runtime configuration"
        with patch.object(self.install, "git", side_effect=git):
            snapshot = recovery_configuration(self.install, {"revision": "a" * 40})
        self.assertTrue(all(text == "old runtime configuration\n" for text in snapshot["files"].values()))
        self.assertTrue(all(args[1].startswith("a" * 40 + ":") for args in calls if args[0] == "show"))
        atomic_json(self.install.state / "runtime-configuration.json", snapshot)
        with patch.object(self.install, "git", side_effect=AssertionError("must preserve snapshot across manager restart")):
            self.assertEqual(recovery_configuration(self.install, {"revision": "a" * 40}), snapshot)

    def test_canonical_directory(self):
        with patch.object(self.install, "containers", return_value=[self.record()]):
            self.assertIn("postgres", self.install.identity())

    def test_equivalent_compose_file_paths_are_canonicalized(self):
        record = self.record()
        record["labels"]["com.docker.compose.project.config_files"] = ",".join(str(self.root) + os.sep + "." + os.sep + p for p in self.install.files)
        with patch.object(self.install, "containers", return_value=[record]):
            self.assertIn("postgres", self.install.identity())

    def test_old_checkout_different_profile_and_duplicate_refused(self):
        inventories = [[self.record(**{"com.docker.compose.project.working_dir": str(self.root / "old")})],
                       [self.record(**{"com.docker.compose.project.config_files": "compose.yaml"})],
                       [self.record(), self.record()]]
        for records in inventories:
            with patch.object(self.install, "containers", return_value=records), self.assertRaises(Blocked):
                self.install.identity()

    def test_external_shell_cannot_redirect_project(self):
        with patch.dict(os.environ, {"COMPOSE_PROJECT_NAME": "wrong", "ASA_API_IMAGE": "evil:latest"}):
            install = Installation(self.root, "dev")
        self.assertEqual(install.process_env["COMPOSE_PROJECT_NAME"], "asa-lab-dev")
        self.assertNotIn("ASA_API_IMAGE", install.process_env)


class UpdateBoundaryTests(unittest.TestCase):
    def test_changed_release_prepares_optional_host_only_after_native_source_selection(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock(root=Path(root), state=Path(root), settings={}, profile='dev')
            install.readiness.return_value = {'revision': release()['revision'], 'schema': release()['schema']}
            install.env = {'ASA_UPDATE_ENTRY_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_PARENT_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_RUNTIME_ORIGIN': 'http://127.0.0.1:4610'}
            order = []
            def prepare(selected):
                self.assertEqual(order, ['native-source'])
                order.append('prepare')
                return {'state': 'degraded', 'readerGroupChanged': False, 'applicationCollection': 'embedded'}
            with patch.object(asa_manager, 'doctor'), patch.object(asa_manager, 'clean_checkout'), \
                    patch.object(asa_manager, 'discover_release', return_value=release()), \
                    patch.object(asa_manager, 'prepare_collector', side_effect=prepare), \
                    patch.object(asa_manager, 'assert_ci'), patch.object(asa_manager, 'fetch_images'), \
                    patch.object(asa_manager, 'selected_source', side_effect=lambda *args, **kwargs: order.append('native-source')), \
                    patch.object(asa_manager, 'Installation', return_value=install), \
                    patch.object(asa_manager, 'apply_release_environment'), patch.object(asa_manager, 'validate_resolved_images'), \
                    patch.object(asa_manager, 'check_resources', side_effect=Blocked('TEST_STOP', 'stop before data actions', 'test')), \
                    self.assertRaises(Blocked) as caught:
                asa_manager.update(install)
            self.assertEqual(caught.exception.code, 'TEST_STOP')
            self.assertEqual(order, ['native-source', 'prepare'])

    def test_acknowledge_recovers_only_known_switch_phases_and_recorded_runtime(self):
        from unittest.mock import MagicMock
        for phase in ('switch', 'verify_entry', 'backup'):
            for matching_runtime in (True, False):
                with self.subTest(phase=phase, matching_runtime=matching_runtime), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory); state = root / '.asa'; state.mkdir()
                    install = MagicMock(); install.root = root; install.state = state
                    install.readiness.return_value = {'revision': ('a' if matching_runtime else 'b') * 40}
                    operation = {'phase':phase, 'selected':{'revision':'a'*40}}
                    atomic_json(state / 'maintenance.json', operation)
                    atomic_json(state / 'failed-switch.json', operation)
                    with patch.object(asa_manager, 'Installation', return_value=install), patch.object(asa_manager, 'doctor') as doctor, patch('sys.stderr', io.StringIO()):
                        result = asa_manager.main(['acknowledge', '--root', str(root)])
                    accepted = phase in ('switch', 'verify_entry') and matching_runtime
                    self.assertEqual(result, 0 if accepted else 2)
                    self.assertEqual((state / 'maintenance.json').exists(), not accepted)
                    self.assertEqual((state / 'failed-switch.json').exists(), not accepted)
                    if accepted:
                        self.assertEqual(len(list(state.glob('reviewed-*.json'))), 1)
                        self.assertEqual(len(list(state.glob('acknowledged-*.json'))), 1)
                    doctor.assert_called_once_with(install); install.compose.assert_not_called()

    def test_missing_owner_entry_stops_before_release_or_backup(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.root = install.state = Path(root)
            install.settings = {}
            install.profile = 'dev'
            install.readiness.return_value = {'revision':release()['revision'],'schema':release()['schema']}
            install.env = {'ASA_BLOCKS_PARENT_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_RUNTIME_ORIGIN': 'http://127.0.0.1:4610'}
            with patch.object(asa_manager, 'doctor'), patch.object(asa_manager, 'clean_checkout'), \
                    patch.object(asa_manager, 'discover_release') as discover, \
                    patch.object(asa_manager, 'export_backup') as backup, self.assertRaises(Blocked):
                asa_manager.update(install, check=True)
            discover.assert_not_called()
            backup.assert_not_called()
            install.compose.assert_not_called()

    def test_same_release_does_not_stop_or_back_up(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.root = install.state = Path(root)
            install.settings = {}
            install.profile = 'dev'
            install.readiness.return_value = {'revision':release()['revision'],'schema':release()['schema']}
            install.env = {'ASA_UPDATE_ENTRY_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_PARENT_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_RUNTIME_ORIGIN': 'http://127.0.0.1:4610'}
            candidate = release()
            atomic_json(install.state / "installed-release.json", candidate)
            install.readiness.return_value = {"revision": candidate["revision"], "schema": candidate["schema"]}
            install.identity.return_value = {name: {"image": ref} for name, ref in candidate["images"].items()}
            with patch.object(asa_manager, "doctor"), patch.object(asa_manager, "clean_checkout"), \
                    patch.object(asa_manager, "discover_release", return_value=candidate), \
                    patch.object(asa_manager, "prepare_collector", return_value={'readerGroupChanged': False}), \
                    patch.object(asa_manager, "reconcile_collector") as collector, \
                    patch.object(asa_manager, "Installation", return_value=install), \
                    patch.object(asa_manager, "assert_ci"), patch.object(asa_manager, "verify_embedded_entry_http"), \
                    patch.object(asa_manager, "export_backup") as backup, \
                    patch.object(asa_manager, "selected_source") as switch:
                asa_manager.update(install)
            backup.assert_not_called()
            switch.assert_not_called()
            install.compose.assert_not_called()
            collector.assert_called_once_with(install)
            event = json.loads((install.root/'.asa/operations/events.jsonl').read_text())
            self.assertEqual(event['status'], 'succeeded')
            self.assertEqual(event['phase'], 'verify_entry')
            self.assertEqual(event['revision'], candidate['revision'])
            self.assertNotIn('archiveSha256', event)

    def test_backup_failure_never_switches_running_services(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.root = install.state = Path(root)
            install.settings = {}
            install.profile = 'dev'
            install.readiness.return_value = {'revision':release()['revision'],'schema':release()['schema']}
            install.env = {'ASA_UPDATE_ENTRY_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_PARENT_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_RUNTIME_ORIGIN': 'http://127.0.0.1:4610'}
            with patch.object(asa_manager, "doctor"), patch.object(asa_manager, "clean_checkout"), \
                    patch.object(asa_manager, "discover_release", return_value=release()), \
                    patch.object(asa_manager, "prepare_collector", return_value={'readerGroupChanged': True}), \
                    patch.object(asa_manager, "assert_ci"), patch.object(asa_manager, "fetch_images"), \
                    patch.object(asa_manager, "selected_source"), patch.object(asa_manager, "Installation", return_value=install), \
                    patch.object(asa_manager, "apply_release_environment"), patch.object(asa_manager, "validate_resolved_images"), \
                    patch.object(asa_manager, "check_resources"), \
                    patch.object(asa_manager, "export_backup", side_effect=Blocked("BACKUP", "disk full", "free space")) as backup, \
                    self.assertRaises(Blocked):
                asa_manager.update(install)
            self.assertFalse(any(call.args[0] in ("up", "stop") for call in install.compose.call_args_list))
            self.assertFalse((install.state / "installed-release.json").exists())
            backup.assert_called_once_with(install, trigger='manual')

    def test_outside_window_does_not_touch_docker_or_network(self):
        from unittest.mock import MagicMock
        install = MagicMock()
        install.settings = {"automaticUpdates": True, "window": DEFAULT_WINDOW}
        with patch.object(asa_manager, "in_window", return_value=False), patch.object(asa_manager, "doctor") as doctor, patch.object(asa_manager, "discover_release") as discover:
            asa_manager.update(install, scheduled=True)
            doctor.assert_not_called()
            discover.assert_not_called()

    def test_selected_release_budget_blocks_before_backup_or_service_stop(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock(root=Path(root), state=Path(root), settings={}, profile='dev')
            install.readiness.return_value = {'revision': release()['revision'], 'schema': release()['schema']}
            install.env = {'ASA_UPDATE_ENTRY_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_PARENT_ORIGIN': 'http://127.0.0.1:4610',
                           'ASA_BLOCKS_RUNTIME_ORIGIN': 'http://127.0.0.1:4610'}
            with patch.object(asa_manager, 'doctor'), patch.object(asa_manager, 'clean_checkout'), \
                    patch.object(asa_manager, 'discover_release', return_value=release()), \
                    patch.object(asa_manager, 'prepare_collector', return_value={'readerGroupChanged': True}), \
                    patch.object(asa_manager, 'assert_ci'), patch.object(asa_manager, 'fetch_images'), \
                    patch.object(asa_manager, 'selected_source'), patch.object(asa_manager, 'Installation', return_value=install), \
                    patch.object(asa_manager, 'apply_release_environment'), patch.object(asa_manager, 'validate_resolved_images'), \
                    patch.object(asa_manager, 'check_resources', side_effect=Blocked('RESOURCE_CONNECTIONS', 'too many', 'reduce pool')), \
                    patch.object(asa_manager, 'export_backup') as backup, self.assertRaises(Blocked) as failure:
                asa_manager.update(install)
            self.assertEqual(failure.exception.code, 'RESOURCE_CONNECTIONS')
            backup.assert_not_called()
            self.assertFalse(any(call.args[0] in ('up', 'stop') for call in install.compose.call_args_list))

    def test_red_ci_never_creates_backup_or_switches_services(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.state = Path(root)
            with patch.object(asa_manager, "doctor"), patch.object(asa_manager, "clean_checkout"), \
                    patch.object(asa_manager, "discover_release", return_value=release()), \
                    patch.object(asa_manager, "assert_ci", side_effect=Blocked("CI_BLOCKED", "red", "repair")), \
                    patch.object(asa_manager, "export_backup") as backup, self.assertRaises(Blocked):
                asa_manager.update(install)
            backup.assert_not_called()
            install.compose.assert_not_called()

    def test_previous_failed_switch_is_not_retried(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as root:
            install = MagicMock()
            install.state = Path(root)
            (install.state / "failed-switch.json").write_text("{}")
            with patch.object(asa_manager, "discover_release") as discover, self.assertRaises(Blocked):
                asa_manager.update(install)
            discover.assert_not_called()


class ProxyProvenanceDiagnosticTests(unittest.TestCase):
    def test_default_is_explicitly_unverified_and_does_not_mutate_configuration(self):
        env = {'POSTGRES_PASSWORD': 'never-emit-this'}
        before = dict(env)
        result = proxy_provenance_diagnostic(env)
        self.assertEqual(result['state'], 'loopback_only')
        self.assertFalse(result['verifiedVisitorIp'])
        self.assertNotIn('never-emit-this', json.dumps(result))
        self.assertEqual(env, before)

    def test_explicit_private_gateway_is_configuration_not_proof(self):
        result = proxy_provenance_diagnostic({'ASA_INGRESS_TRUSTED_PROXY_CIDRS': '172.19.0.1/32'})
        self.assertEqual(result['state'], 'external_policy_unverified')
        self.assertFalse(result['verifiedVisitorIp'])
        for raw in ('0.0.0.0/0', '::/0', '127.0.0.1/32;secret'):
            with self.assertRaises(Blocked):
                proxy_provenance_diagnostic({'ASA_INGRESS_TRUSTED_PROXY_CIDRS': raw})

    def test_doctor_reports_unverified_policy_without_config_write(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            install = SimpleNamespace(root=Path(directory), env={}, project='synthetic', profile='dev', identity=lambda **_: {})
            output = io.StringIO()
            with patch('asa_manager.run'), patch('asa_manager.check_resources'), patch('asa_manager.collector_status', return_value={'state': 'unavailable', 'detail': 'test'}), patch('sys.stdout', output):
                asa_manager.doctor(install, existing=False)
            self.assertIn('CLIENT_PROVENANCE', output.getvalue())
            self.assertIn('"verifiedVisitorIp": false', output.getvalue())
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()

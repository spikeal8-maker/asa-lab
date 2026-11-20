"""Regression: an updated ASA release waits for Docker health, not just HTTP ready."""

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import system
from deployment.contracts import Blocked


class UpdateHealthWaitTests(unittest.TestCase):
    def setUp(self):
        self.install = object.__new__(system.Installation)
        self.install.process_env = {"ASA_SEARCH_IMAGE": "ghcr.io/example/search@sha256:" + "b" * 64}
        self.records = {
            name: {"id": chr(97 + index) * 64, "running": True}
            for index, name in enumerate(("postgres", "web", "api", "scratch", "minio", "search"))
        }

    def test_all_six_are_healthy(self):
        with patch.object(self.install, "identity", return_value=self.records), \
             patch.object(system, "run", return_value="\n".join(["healthy"] * 6)) as run:
            self.assertTrue(self.install.compose_health())
        self.assertEqual(run.call_args.args[0][:4],
                         ["docker", "inspect", "--format",
                          "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}"])

    def test_five_healthy_one_starting_is_not_success(self):
        with patch.object(self.install, "identity", return_value=self.records), \
             patch.object(system, "run", return_value="\n".join(["healthy"] * 5 + ["starting"])):
            with self.assertRaises(Blocked) as caught:
                self.install.compose_health()
        self.assertEqual(caught.exception.code, "HEALTH")

    def test_missing_or_stopped_container_is_not_success(self):
        for change in ("missing", "stopped"):
            records = {name: dict(value) for name, value in self.records.items()}
            if change == "missing":
                records.pop("web")
            else:
                records["web"]["running"] = False
            with self.subTest(change=change), patch.object(self.install, "identity", return_value=records), \
                 patch.object(system, "run") as run, self.assertRaises(Blocked):
                self.install.compose_health()
                run.assert_not_called()

    def test_wait_ready_retries_after_docker_health_recovers(self):
        website = {"revision": "a" * 40, "schema": 307}
        with patch.object(self.install, "readiness", return_value=website) as readiness, \
             patch.object(self.install, "compose_health",
                          side_effect=[Blocked("HEALTH", "starting"), True]) as health, \
             patch.object(system.time, "monotonic", return_value=0), \
             patch.object(system.time, "sleep") as sleep:
            self.assertEqual(self.install.wait_ready("a" * 40, 307), website)
        self.assertEqual(readiness.call_count, 2)
        self.assertEqual(health.call_count, 2)
        sleep.assert_called_once_with(3)

    def test_wait_ready_fails_closed_when_health_never_recovers(self):
        website = {"revision": "a" * 40, "schema": 307}
        with patch.object(self.install, "readiness", return_value=website), \
             patch.object(self.install, "compose_health",
                          side_effect=Blocked("HEALTH", "starting")), \
             patch.object(system.time, "monotonic", side_effect=[0, 0, 301]), \
             patch.object(system.time, "sleep"):
            with self.assertRaises(Blocked) as caught:
                self.install.wait_ready("a" * 40, 307)
        self.assertEqual(caught.exception.code, "HEALTH")

    def test_pre_search_release_requires_five_services(self):
        self.install.process_env = {}
        records = {key: value for key, value in self.records.items() if key != "search"}
        with patch.object(self.install, "identity", return_value=records), \
             patch.object(system, "run", return_value="\n".join(["healthy"] * 5)):
            self.assertTrue(self.install.compose_health())


if __name__ == "__main__":
    unittest.main()

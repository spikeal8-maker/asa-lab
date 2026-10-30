"""Synthetic safety checks for offline-friendly support-image preflight.

Only stubs are used: no Docker Engine, registry, database or network actions.
"""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked
from deployment.releases import prepare_support_images

POSTGRES_REF = "postgres:17.7-bookworm"
PG_ID = "sha256:" + "a" * 64
OTHER_ID = "sha256:" + "b" * 64
MINIO_ID = "sha256:" + "c" * 64
MINIO_REF = "ghcr.io/spikeal8-maker/asa-lab/minio@sha256:" + "d" * 64
CONFIG = {
    "services": {
        "postgres": {"image": POSTGRES_REF},
        "minio": {"image": MINIO_REF},
        "minio-init": {"image": MINIO_REF},
    },
}
RELEASE = {"images": {"minio": MINIO_REF}}
RECORDS = {
    "postgres": {
        "id": "fake-running-postgres-container-id",
        "image": POSTGRES_REF,
        "running": True,
    },
}


def simulated_docker(args, *, capture=False):
    assert capture is True, "No Docker mutation should occur during preflight"
    assert args[0] == "docker"
    if args[1:4] == ["image", "inspect", "--format"] and args[-1] == MINIO_REF:
        return MINIO_ID
    if args[1:4] == ["image", "inspect", "--format"] and args[-1] == POSTGRES_REF:
        return PG_ID
    if args[1:3] == ["inspect", "--format"] and args[-1] == RECORDS["postgres"]["id"]:
        return PG_ID
    raise AssertionError("Unexpected Docker command: " + repr(args))


class SupportImageCacheTests(unittest.TestCase):
    def setUp(self):
        self.install = Mock()
        self.config = {
            "services": {key: dict(value) for key, value in CONFIG["services"].items()}
        }
        self.records = {key: dict(value) for key, value in RECORDS.items()}

    def test_existing_engine_skips_docker_hub_even_if_network_is_down(self):
        with patch("deployment.releases.run", side_effect=simulated_docker) as run:
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.install.compose.assert_not_called()
        self.assertEqual(run.call_count, 3)
        self.assertFalse(any("pull" in call.args[0] for call in run.call_args_list))

    def test_missing_postgres_tag_fails_closed_before_backup_or_pull(self):
        def missing(args, **kwargs):
            if args[1:4] == ["image", "inspect", "--format"] and args[-1] == POSTGRES_REF:
                raise Blocked("COMMAND", "image not found", "Look at the cache")
            return simulated_docker(args, **kwargs)

        with patch("deployment.releases.run", side_effect=missing), self.assertRaises(Blocked) as error:
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.assertEqual(error.exception.code, "POSTGRES_IMAGE_MISSING")
        self.install.compose.assert_not_called()

    def test_retagged_postgres_ref_does_not_upgrade_live_engine(self):
        def retagged(args, **kwargs):
            if args[1:4] == ["image", "inspect", "--format"] and args[-1] == POSTGRES_REF:
                return OTHER_ID
            return simulated_docker(args, **kwargs)

        with patch("deployment.releases.run", side_effect=retagged), self.assertRaises(Blocked) as error:
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.assertEqual(error.exception.code, "POSTGRES_IMAGE_DRIFT")
        self.install.compose.assert_not_called()

    def test_changed_engine_reference_blocks_before_inspection(self):
        self.records["postgres"]["image"] = "postgres:18"
        with patch("deployment.releases.run", side_effect=simulated_docker), self.assertRaises(Blocked) as err:
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.assertEqual(err.exception.code, "DATABASE_ENGINE")
        self.install.compose.assert_not_called()

    def test_absent_or_stopped_database_stops_before_switch(self):
        for records in ({}, {"postgres": {**RECORDS["postgres"], "running": False}}):
            with self.subTest(records=records), patch("deployment.releases.run", side_effect=simulated_docker), self.assertRaises(Blocked) as error:
                prepare_support_images(self.install, RELEASE, self.config, records)
            self.assertEqual(error.exception.code, "POSTGRES_RUNNING")
        self.install.compose.assert_not_called()

    def test_invalid_running_content_id_is_never_trusted(self):
        def wrong_id(args, **kwargs):
            if args[1:3] == ["inspect", "--format"]:
                return "invalid"
            return simulated_docker(args, **kwargs)
        with patch("deployment.releases.run", side_effect=wrong_id), self.assertRaises(Blocked) as error:
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.assertEqual(error.exception.code, "POSTGRES_IMAGE_ID")
        self.install.compose.assert_not_called()

    def test_minio_init_must_use_pinned_verified_local_digest(self):
        self.config["services"]["minio-init"]["image"] = "minio:latest"
        with patch("deployment.releases.run") as run, self.assertRaises(Blocked) as error:
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.assertEqual(error.exception.code, "IMAGE_OVERRIDE")
        run.assert_not_called()
        self.install.compose.assert_not_called()

    def test_missing_pinned_minio_image_is_not_replaced_with_mutable_tag(self):
        def missing(args, **kwargs):
            if args[1:4] == ["image", "inspect", "--format"] and args[-1] == MINIO_REF:
                raise Blocked("COMMAND", "image not found", "Check download")
            return simulated_docker(args, **kwargs)
        with patch("deployment.releases.run", side_effect=missing), self.assertRaises(Blocked) as error:
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.assertEqual(error.exception.code, "MINIO_IMAGE_MISSING")
        self.install.compose.assert_not_called()

    def test_fresh_install_still_pulls_postgres_but_not_minio_init(self):
        with patch("deployment.releases.run", side_effect=simulated_docker) as run:
            prepare_support_images(self.install, RELEASE, self.config, {}, fresh=True)
        self.install.compose.assert_called_once_with("pull", "postgres")
        self.assertEqual(run.call_count, 1)

    def test_cache_preflight_not_allowed_to_write_secrets_or_receipts(self):
        with patch("deployment.releases.run", side_effect=simulated_docker):
            prepare_support_images(self.install, RELEASE, self.config, self.records)
        self.assertFalse(self.install.save_settings.called)
        self.assertFalse(self.install.receipt.called)
        self.assertFalse(self.install.git.called)


if __name__ == "__main__":
    unittest.main()

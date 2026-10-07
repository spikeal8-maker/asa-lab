import copy
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.backup import attest_backup_mounts
from deployment.contracts import Blocked


class BackupMountTests(unittest.TestCase):
    def config(self, root):
        return {"services": {
            "postgres": {"volumes": [{"type": "volume", "target": "/var/lib/postgresql/data"}]},
            "minio": {"volumes": [{"type": "volume", "target": "/data"}]},
            "api": {"environment": {"ASA_LOG_STORE": "/var/lib/asa-logs"}, "volumes": [{
                "type": "bind", "source": str(Path(root) / ".asa" / "diagnostics" / "store"),
                "target": "/var/lib/asa-logs", "read_only": True}]},
        }}

    def test_exact_read_only_host_logs_and_legacy_installation(self):
        with tempfile.TemporaryDirectory() as root:
            config = self.config(root)
            self.assertTrue(attest_backup_mounts(root, config))
            config["services"]["api"]["volumes"] = []
            self.assertFalse(attest_backup_mounts(root, config))

    def test_custom_or_writable_mounts_remain_blocked(self):
        with tempfile.TemporaryDirectory() as root:
            for change in ({"read_only": False}, {"read_only": "true"},
                           {"source": str(Path(root) / "custom")},
                           {"target": "/data"}, {"type": "volume"}):
                config = self.config(root)
                config["services"]["api"]["volumes"][0].update(change)
                with self.subTest(change=change), self.assertRaises(Blocked) as problem:
                    attest_backup_mounts(root, config)
                self.assertEqual(problem.exception.code, "BACKUP_MOUNTS")
            config = self.config(root)
            config["services"]["web"] = copy.deepcopy(config["services"]["api"])
            with self.assertRaises(Blocked):
                attest_backup_mounts(root, config)
            config = self.config(root)
            config["services"]["api"]["environment"]["ASA_LOG_STORE"] = "/custom"
            with self.assertRaises(Blocked):
                attest_backup_mounts(root, config)
            config = self.config(root)
            config["services"]["api"]["volumes"].append({"type": "volume", "target": "/extra"})
            with self.assertRaises(Blocked):
                attest_backup_mounts(root, config)


if __name__ == "__main__":
    unittest.main()

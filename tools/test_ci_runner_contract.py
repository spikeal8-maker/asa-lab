"""Offline isolated-runner contract; never starts Docker or accesses a database."""

from copy import deepcopy
import subprocess
import unittest

from tools.test_ci_image_transport import ROOT, parse_yaml


BASELINE = "bd8b35a5346628ad03965b02f82391b2f105975e"
RESULTS_TMPFS = "/workspace/test-results:mode=1777"


def check_runner(model):
    runner = model["services"]["test-runner"]
    for variable in ("CI", "GITHUB_ACTIONS"):
        # Empty stays empty, and literal false stays false: no default true.
        assert runner["environment"][variable] == "${" + variable + ":-}"
    assert runner["tmpfs"].count(RESULTS_TMPFS) == 1
    assert runner["read_only"] is True
    assert runner["user"] == "${ASA_TEST_UID:-1000}:${ASA_TEST_GID:-1000}"
    assert runner["security_opt"] == ["no-new-privileges:true"]
    assert runner["cap_drop"] == ["ALL"]
    assert "ports" not in runner


class IsolatedRunnerContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Existing parser also accepts Compose's !override sequence tag.
        cls.model = parse_yaml((ROOT / "compose.test.yaml").read_text(encoding="utf-8"))

    def test_writable_results_with_existing_security(self):
        check_runner(self.model)

    def test_rejects_false_to_true_promotion_and_lost_isolation(self):
        for key, value in (("CI", "true"), ("GITHUB_ACTIONS", "${GITHUB_ACTIONS:-true}")):
            changed = deepcopy(self.model)
            changed["services"]["test-runner"]["environment"][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                check_runner(changed)
        for key, value in (("tmpfs", ["/tmp"]), ("read_only", False), ("cap_drop", [])):
            changed = deepcopy(self.model)
            changed["services"]["test-runner"][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                check_runner(changed)

    def test_bounded_repair_preserves_every_other_compose_setting(self):
        # Dated integration proof, not a new production Compose model.
        baseline = subprocess.check_output(
            ["git", "show", BASELINE + ":compose.test.yaml"], cwd=ROOT
        ).decode("utf-8")
        restored = deepcopy(self.model)
        runner = restored["services"]["test-runner"]
        del runner["environment"]["CI"]
        del runner["environment"]["GITHUB_ACTIONS"]
        runner["tmpfs"].remove(RESULTS_TMPFS)
        self.assertEqual(restored, parse_yaml(baseline))


if __name__ == "__main__":
    unittest.main()

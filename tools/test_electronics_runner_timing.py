"""Reference class registration before a real-time Electronics qualification run."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runner_timing", Path(__file__).with_name("electronics-runner-timing.py"))
timing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timing)


class ReferenceHardwareTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.proc = self.root / "proc"
        self.mount = self.root / "cgroup"
        self.leaf = self.mount / "actions/job"
        self.leaf.mkdir(parents=True)
        (self.proc / "self").mkdir(parents=True)
        self.write_info()
        self.write_scope()
        (self.proc / "self/status").write_text("Cpus_allowed_list:\t0-3\n")
        (self.mount / "cgroup.controllers").write_text("cpu cpuset memory")
        (self.leaf.parent / "cpu.max").write_text("400000 100000")
        (self.leaf / "cpu.max").write_text("max 100000")
        (self.leaf / "cpuset.cpus.effective").write_text("0-3")

    def write_scope(self, member="/actions/job", mount_root="/"):
        target = self.mount.as_posix().replace(" ", r"\040")
        (self.proc / "self/cgroup").write_text("0::" + member)
        (self.proc / "self/mountinfo").write_text(f"27 1 0:29 {mount_root} {target} rw - cgroup2 cgroup rw\n")

    def write_info(self, pairs=None):
        pairs = [timing.REFERENCE_MODEL] * 4 if pairs is None else pairs
        (self.proc / "cpuinfo").write_text("\n\n".join(
            f"processor : {cpu}\nvendor_id : {vendor}\nmodel name : {model}"
            for cpu, (vendor, model) in enumerate(pairs)
        ))

    def hardware(self):
        return timing.classify_test_runner(self.proc, timing.sample_resources(self.proc), True)

    def test_reference_is_classified_before_and_independently_of_the_result(self):
        with patch.object(timing.platform, "system", return_value="Linux"), patch.object(timing, "calibration", return_value={}):
            before = timing.sample("test-runner", "before", self.proc)
            self.assertEqual(before["hardwareClass"], {"referenceId": "intel-xeon-6975p-c-4vcpu", "status": "reference", "reason": "model-affinity-and-visible-quotas-match"})
            self.assertNotIn("hardwareClass", timing.sample("host", "before", self.proc))
            self.assertNotIn("hardwareClass", timing.sample("test-runner", "after", self.proc))
            self.assertLess(len(json.dumps(before, separators=(",", ":")).encode()), 3000)

    def test_other_cpu_and_exact_model_identity(self):
        for pair in [("AuthenticAMD", "AMD EPYC 9V74 80-Core Processor"), ("GenuineIntel", "Intel(R) Xeon(R) 6975P-C ES")]:
            self.write_info([pair]*4)
            self.assertEqual(self.hardware()["status"], "other")

    def test_incomplete_or_mixed_cpu_records_are_unverified(self):
        for pairs in [[],[timing.REFERENCE_MODEL]*3,[timing.REFERENCE_MODEL]*3+[("GenuineIntel", "Unknown")]]:
            self.write_info(pairs)
            self.assertEqual(self.hardware()["status"], "unverified")

    def test_quota_in_current_or_parent_has_to_cover_four_processors(self):
        for path in [self.leaf / "cpu.max", self.leaf.parent / "cpu.max"]:
            old = path.read_text()
            path.write_text("399999 100000")
            self.assertEqual(self.hardware()["reason"],"cpu-quota-below-four")
            path.write_text(old)
        (self.leaf / "cpu.max").write_text("nonsense")
        self.assertEqual(self.hardware()["status"], "unverified")
        (self.leaf / "cpu.max").unlink()
        self.assertEqual(self.hardware()["status"], "unverified")

    def test_masks_are_valid_and_four_cpus_are_effectively_available(self):
        path = self.proc / "self/status"
        path.write_text("Cpus_allowed_list: 1-3")
        self.assertEqual(self.hardware()["reason"], "different-vcpu-count")
        for mask in ["", "0-2,2", "0-3,4", "-1", "0-1000000"]:
            path.write_text("Cpus_allowed_list: "+mask)
            self.assertEqual(self.hardware()["status"], "unverified")
        path.write_text("Cpus_allowed_list: 0-3")
        (self.leaf / "cpuset.cpus.effective").unlink()
        self.assertEqual(self.hardware()["status"], "unverified")

    def test_standard_namespaced_docker_mount_uses_its_actual_quota(self):
        self.write_scope("/", "/")
        (self.mount / "cpu.max").write_text("max 100000")
        (self.mount / "cpuset.cpus.effective").write_text("0-3")
        self.assertEqual(self.hardware()["status"], "reference")
        (self.mount / "cpu.max").write_text("200000 100000")
        self.assertEqual(self.hardware()["status"], "other")
        (self.mount / "cpu.max").unlink()
        self.assertEqual(self.hardware()["status"], "unverified")

    def test_missing_parent_or_non_linux_is_unverified(self):
        self.assertEqual(timing.classify_test_runner(self.proc, {}, False)["status"], "unverified")
        (self.mount / "cgroup.controllers").unlink()
        self.assertEqual(self.hardware()["status"], "unverified")
        (self.leaf.parent / "cpu.max").unlink()
        self.assertEqual(self.hardware()["status"], "unverified")

    def test_only_missing_quota_at_the_hierarchy_root_is_optional(self):
        quota = self.mount / "cpu.max"
        self.assertFalse(quota.exists())
        self.assertEqual(self.hardware()["status"], "reference")
        quota.write_text("200000 100000")
        self.assertEqual(self.hardware()["status"], "other")
        original_open = Path.open
        for error in (PermissionError, OSError):
            with self.subTest(error=error):
                def open_path(path, *args, **kwargs):
                    if path == quota:
                        raise error("cgroup quota is unreadable")
                    return original_open(path, *args, **kwargs)

                with patch.object(Path, "open", open_path):
                    self.assertEqual(self.hardware()["status"], "unverified")

    def test_delegated_mount_cannot_attest_to_quotas_above_its_root(self):
        self.write_scope("/delegated/actions/job", "/delegated")
        self.assertEqual(self.hardware()["status"], "unverified")
        quota = self.mount / "cpu.max"
        quota.write_text("max 100000")
        self.assertEqual(self.hardware()["status"], "unverified")
        quota.write_text("200000 100000")
        self.assertEqual(self.hardware()["status"], "other")


if __name__ == "__main__":
    unittest.main()

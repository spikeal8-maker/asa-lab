"""Offline General v1 regressions; real temporary Git and existing effect helper."""

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import yaml

import devex_ci_contract as contract

ROOT = Path(__file__).resolve().parents[1]
REF = "refs/pull/999/merge"


class GeneralContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="asa-general-contract-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {key: value for key, value in os.environ.items() if key not in
                    ("GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE")}
        self.run_git("init", "-q")
        for name in contract.CONTROLS:
            original = ROOT / name
            target = self.root / name
            if original.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                (target / "control.txt").write_text("accepted control\n")
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(original.read_bytes())
        for name in [*contract.PRODUCTION, "apps/web/src/components/CollectPicker.spec.ts",
                     "tools/devex_ci_contract.py"]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / name).read_bytes())
        (self.root / ".gitignore").write_text(".asa/\n")
        self.base = self.commit()
        css = self.root / "apps/web/src/components/collect-picker.css"
        css.write_text(css.read_text(encoding="utf-8").replace("min-height: 34px", "min-height: 44px"),
                       encoding="utf-8")
        self.head = self.commit()
        self.merge_sha = self.merge_candidate()

    def run_git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, env=self.env,
                                       stderr=subprocess.DEVNULL).decode().strip()

    def commit(self):
        self.run_git("add", "--all")
        self.run_git("-c", "user.name=General fixture", "-c", "user.email=fixture@example.invalid",
                     "commit", "-qm", "bounded fixture")
        return self.run_git("rev-parse", "HEAD")

    def merge_candidate(self, treeish=None, parents=None):
        base, head = parents or (self.base, self.head)
        return self.run_git("-c", "user.name=General fixture", "-c", "user.email=fixture@example.invalid",
                            "commit-tree", (treeish or self.head) + "^{tree}",
                            "-p", base, "-p", head, "-m", "event merge candidate")

    def proof(self):
        tests = ["apps/web/src/components/CollectPicker.spec.ts"]
        paths = sorted([*contract.PRODUCTION, *tests, *contract.BROWSER_INPUTS])
        digest = hashlib.sha256()
        for name in paths:
            digest.update(name.encode() + b"\0" + (self.root / name).read_bytes() + b"\0")
        return dict(eligible=True, profile_id="collect-picker-presentation-v1", version=1,
                    surface_id="SURF-PROJECT-COLLECTION-PICKER", local_effect_class="L0_LOCAL_UI",
                    test_ids=contract.LOCAL_IDS, test_files=tests, protected_paths=paths,
                    source_digest=digest.hexdigest(), ci_test_files=[contract.BROWSER],
                    ci_test_ids=["TST-COLLECT-PICKER-BROWSER-001"])

    def plan(self, event="pull_request", ref=REF, proof=None, base_ref="main"):
        self.merge_sha = self.merge_candidate() if event == "pull_request" else self.head
        self.event, self.ref = event, ref
        self.base_ref = base_ref
        return contract.select(self.root, self.head, self.base, event, ref,
                               self.merge_sha, base_ref,
                               self.proof() if proof is None else proof)

    def needs(self, plan):
        needs = {job: {"result": "success", "outputs": {}} for job in contract.NEEDS}
        needs["selection"]["outputs"]["plan"] = json.dumps(plan)
        if plan["route"] == "FAST":
            for job in contract.FULL_JOBS[1:]:
                needs[job]["result"] = "skipped"
        if plan["route"] in ("PARALLEL", "FAST"):
            needs["changed-ui"]["outputs"]["evidence"] = json.dumps(dict(
                version=contract.VERSION, plan=plan, run_id="123", attempt="2",
                local_checks=contract.LOCAL_IDS, browser=contract.BROWSER, browser_cases=24,
                status="FOCUSED_PASS"))
        else:
            needs["changed-ui"]["result"] = "skipped"
        return needs

    def summarize(self, plan, needs):
        return contract.summarize(self.root, plan, needs, self.head, self.base,
                                  self.event, self.ref, self.merge_sha, self.base_ref, "123", "2")

    def integration_existing_ast_helper_real_css_effect_and_unsupported_effect(self):
        def prove():
            result = subprocess.run(["node", str(ROOT / "tools/devex-local-ui.mjs"), "--prove", self.base],
                                    cwd=self.root, env=self.env, capture_output=True, text=True,
                                    check=True, timeout=45)
            return json.loads(result.stdout)
        proof = prove()
        plan = self.plan(proof=proof)
        expected_route = "FAST" if contract.FAST_ENABLED else "PARALLEL"
        self.assertEqual(plan["route"], expected_route, proof)
        report = self.summarize(plan, self.needs(plan))
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["full_regression_verified"], expected_route == "PARALLEL")
        self.assertFalse(report["release_ready"])
        css = self.root / "apps/web/src/components/collect-picker.css"
        css.write_text(css.read_text(encoding="utf-8").replace("min-height: 44px", "min-width: 44px"),
                       encoding="utf-8")
        self.head = self.commit()
        proof = prove()
        self.assertFalse(proof["eligible"])
        self.assertEqual(self.plan(proof=proof)["route"], "FULL")

    def test_cheap_candidate_is_not_authorization_without_proof(self):
        plan = contract.select(self.root, self.head, self.base, "pull_request", REF, self.merge_sha, "main")
        self.assertTrue(plan["candidate"])
        self.assertEqual(plan["route"], "FULL")

    def test_main_and_non_main_base_are_always_full_even_with_valid_fast_proof(self):
        for event, ref, base_ref in [("push", "refs/heads/main", "main"), ("pull_request", REF, "work")]:
            with mock.patch.object(contract, "FAST_ENABLED", True):
                plan = self.plan(event, ref, base_ref=base_ref)
                report = self.summarize(plan, self.needs(plan))
            self.assertEqual(plan["route"], "FULL")
            self.assertTrue(report["full_regression_verified"])
            self.assertFalse(report["release_ready"])
        with self.assertRaises(ValueError):
            self.plan("push", "refs/heads/codex/work")

    def test_bootstrap_missing_accepted_contract_is_full(self):
        self.run_git("rm", "tools/devex_ci_contract.py")
        self.base = self.commit()
        path = "tools/devex_ci_contract.py"
        (self.root / path).write_bytes((ROOT / path).read_bytes())
        self.head = self.commit()
        plan = self.plan()
        self.assertEqual(plan["route"], "FULL")
        self.assertFalse(plan["candidate"])

    def test_critical_unmapped_test_and_control_changes_are_full(self):
        for name in ["tools/control.txt", ".github/control.txt", "docs/testing/control.txt",
                     "docs/agent/control.txt", "apps/api/security.ts", "migrations/999.sql",
                     "unknown.txt", "apps/web/src/components/CollectPicker.spec.ts"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("changed\n")
            self.head = self.commit()
            self.assertEqual(self.plan()["route"], "FULL", name)

    def test_unknown_source_dirty_checkout_and_invalid_proof_block(self):
        for head in ["", "f" * 40, self.base]:
            with self.assertRaises(ValueError):
                contract.classify(self.root, head, self.base, "pull_request", REF, self.merge_sha, "main")
        for base in ["", "0" * 40, "f" * 40]:
            with self.assertRaises(ValueError):
                contract.select(self.root, self.head, base, "pull_request", REF, self.merge_sha, "main")
        for patch in [dict(eligible="true"), dict(version=True), dict(source_digest="f" * 64),
                      dict(test_files=[]), dict(protected_paths=[]), dict(ci_test_files=[]),
                      dict(profile_id="unreviewed")]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.plan(proof={**self.proof(), **patch})
        (self.root / "unknown.txt").write_text("untracked")
        with self.assertRaises(ValueError):
            self.plan()

    def test_merge_candidate_must_bind_exact_parents_and_tree(self):
        for wrong in (self.head, self.merge_candidate(parents=(self.head, self.base)),
                      self.merge_candidate(treeish=self.base)):
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                contract.classify(self.root, self.head, self.base, "pull_request", REF, wrong, "main")

    def test_forged_or_stale_plan_source_and_wrong_fast_selection_never_pass(self):
        with mock.patch.object(contract, "FAST_ENABLED", False):
            self.assertEqual(self.plan()["route"], "PARALLEL")
        # Independently exercise the future accepted-base opt-in. In FAST mode
        # native cancellation, absence or unjustified skips must never pass.
        activation = mock.patch.object(contract, "FAST_ENABLED", True)
        activation.start()
        self.addCleanup(activation.stop)
        plan = self.plan()
        self.assertEqual(plan["route"], "FAST")
        report = self.summarize(plan, self.needs(plan))
        self.assertFalse(report["full_regression_verified"])
        self.assertFalse(report["release_ready"])
        for patch in [dict(version="unknown"), dict(source_sha=self.base), dict(base_sha=self.head),
                      dict(merge_candidate_sha=self.head), dict(tree_sha="f" * 40), dict(base_ref="work"),
                      dict(route="FULL"), dict(route="OTHER"), dict(candidate=False),
                      dict(controls={}), dict(release_ready=True)]:
            forged = {**plan, **patch}
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.summarize(forged, self.needs(forged))
        for job in contract.NEEDS:
            for result in ["failure", "cancelled", "unknown", None]:
                needs = self.needs(plan)
                needs[job]["result"] = result
                with self.subTest(job=job, result=result), mock.patch.object(contract, "validate_plan"), self.assertRaises(ValueError):
                    self.summarize(plan, needs)
            needs = self.needs(plan)
            del needs[job]
            with mock.patch.object(contract, "validate_plan"), self.assertRaises(ValueError):
                self.summarize(plan, needs)
        for job in ("governance", "selection", "changed-ui"):
            needs = self.needs(plan)
            needs[job]["result"] = "skipped"
            with mock.patch.object(contract, "validate_plan"), self.assertRaises(ValueError):
                self.summarize(plan, needs)

    def test_parallel_candidate_requires_full_jobs_and_rejects_unaccepted_fast(self):
        with mock.patch.object(contract, "FAST_ENABLED", False):
            plan = self.plan()
            self.assertEqual(plan["route"], "PARALLEL")
            self.assertEqual(self.summarize(plan, self.needs(plan))["status"], "PASS")
            forged = {**plan, "route": "FAST"}
            with self.assertRaises(ValueError):
                self.summarize(forged, self.needs(forged))
            for job in contract.FULL_JOBS:
                needs = self.needs(plan)
                needs[job]["result"] = "skipped"
                with mock.patch.object(contract, "validate_plan"):
                    self.assertNotEqual(self.summarize(plan, needs)["status"], "PASS")

    def test_missing_full_release_jobs_and_fast_evidence_never_pass(self):
        full = self.plan("push", "refs/heads/main")
        for job in contract.FULL_JOBS:
            for result in ["skipped", "cancelled", "failure", "not_applicable", "unknown"]:
                needs = self.needs(full)
                needs[job]["result"] = result
                with mock.patch.object(contract, "validate_plan"):
                    self.assertNotEqual(self.summarize(full, needs)["status"], "PASS")
        plan = self.plan()
        for patch in [dict(attempt="1"), dict(run_id="other"), dict(browser_cases=23),
                      dict(local_checks=[]), dict(plan=full), dict(status="LOCAL_PASS")]:
            needs = self.needs(plan)
            evidence = json.loads(needs["changed-ui"]["outputs"]["evidence"])
            needs["changed-ui"]["outputs"]["evidence"] = json.dumps({**evidence, **patch})
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.summarize(plan, needs)
        for job in ["selection", "changed-ui"]:
            needs = self.needs(plan)
            needs[job]["outputs"] = {}
            with self.assertRaises((KeyError, ValueError)):
                self.summarize(plan, needs)

    def test_workflow_authorization_pins_and_supported_reusable_execution(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/spec-validation.yml").read_text(encoding="utf-8"))
        contract.check_wiring(workflow)
        self.assertEqual(workflow["on"], {"push": {"branches": ["main"]}, "pull_request": {}})
        for job in ["code", "postgres-tests", "access-a-browser"]:
            self.assertEqual(workflow["jobs"][job]["if"],
                             "needs.selection.outputs.route == 'FULL' || needs.selection.outputs.route == 'PARALLEL'")
        # Code has not installed Python validator requirements. A temporary
        # environment from a previous wrapper invocation has already gone away;
        # this result must bootstrap its own dependencies using the existing CLI.
        canonical = "node tools/devex-python.mjs tools/test_devex_ci_contract.py --helper-integration"
        integration = [step["run"] for step in workflow["jobs"]["code"]["steps"]
                       if "--helper-integration" in step.get("run", "")]
        self.assertEqual(integration, [canonical])
        catalog = yaml.safe_load((ROOT / "docs/testing/test-catalog.yaml").read_text(encoding="utf-8"))
        registered = [entry["command"] for entry in catalog["tests"]
                      if entry["id"] == "TST-DEVEX-CI-EFFECT-INTEGRATION-001"]
        self.assertEqual(registered, [canonical])
        for job in ["selection", "required", "changed-ui"]:
            changed = deepcopy(workflow)
            changed["jobs"][job]["continue-on-error"] = True
            with self.assertRaises(ValueError):
                contract.check_wiring(changed)
        reusable = yaml.safe_load((ROOT / ".github/workflows/devex-changed.yml").read_text(encoding="utf-8"))
        contract.check_bounded_wiring(reusable)
        for patch in [{"continue-on-error": True}, {"if": "false"}]:
            changed = deepcopy(reusable)
            changed["jobs"]["collect-picker"]["steps"][0].update(patch)
            with self.assertRaises(ValueError):
                contract.check_bounded_wiring(changed)
        changed = deepcopy(reusable)
        changed["jobs"]["collect-picker"]["steps"][-1]["with"]["name"] = "unbound-evidence"
        with self.assertRaises(ValueError):
            contract.check_bounded_wiring(changed)
        self.assertEqual(set(reusable["on"]), {"workflow_call"})
        steps = reusable["jobs"]["collect-picker"]["steps"]
        commands = "\n".join(step.get("run", "") for step in steps)
        self.assertIn("pnpm dev:check --changed", commands)
        self.assertIn("pnpm exec nx run web:build", commands)
        self.assertIn("pnpm exec playwright test --config playwright.settings-ui.config.ts " + contract.BROWSER,
                      commands)
        self.assertNotIn("gate:data", commands)
        self.assertNotIn("pnpm build", commands)
        self.assertEqual(steps[-2]["run"], "python3 tools/devex_ci_contract.py evidence")


if __name__ == "__main__":
    if sys.argv[1:] == ["--helper-integration"]:
        suite = unittest.TestSuite([GeneralContractTests(
            "integration_existing_ast_helper_real_css_effect_and_unsupported_effect")])
        sys.exit(0 if unittest.TextTestRunner().run(suite).wasSuccessful() else 1)
    unittest.main()

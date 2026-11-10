#!/usr/bin/env python3
"""General applicability v1: accepted-base effect proof, never release evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

VERSION = "general-collect-picker-v1"
# Enable only in a separately reviewed main commit after a real same-candidate
# PARALLEL pilot passes. The selector runs the version in the accepted PR base.
FAST_ENABLED = False
PRODUCTION = {"apps/web/src/components/CollectPicker.tsx",
              "apps/web/src/components/collect-picker.css"}
TEST_PATTERN = r"apps/web/src/components/CollectPicker(?:\.[A-Za-z0-9][A-Za-z0-9-]*)?\.spec\.ts"
LOCAL_IDS = ["TST-COLLECT-PICKER-FORMAT-001", "TST-COLLECT-PICKER-LINT-001",
             "TST-COLLECT-PICKER-UNIT-001"]
BROWSER = "e2e/project-collections-baseline.spec.ts"
BROWSER_INPUTS = ["playwright.settings-ui.config.ts", "e2e/fixtures/project-collections.ts", BROWSER]
# Existing routing/runner/catalog controls, compared as complete Git trees where
# appropriate. A PR cannot add a selector exception or weaken its own tests.
CONTROLS = ["tools", ".github", "docs/agent", "docs/testing", "package.json",
            "pnpm-lock.yaml", ".prettierrc.json", ".prettierignore", "AGENTS.md",
            "docs/architecture/DEVEX_LOCAL_UI_PROFILE_CONTRACT.md", *BROWSER_INPUTS]
FULL_JOBS = ("governance", "code", "postgres-tests", "access-a-browser")
NEEDS = (*FULL_JOBS, "selection", "changed-ui")
# Versioned semantic fingerprints for the new authorization jobs. Original full
# job commands remain under the existing immutable-image semantic guard. Names
# and YAML formatting are deliberately excluded; unsafe added steps are not.
AUTHORIZATION_JOBS_V1 = {
    "selection": "83a26e5cea3ba82662411a999c5774d8673cd962f39d78a53eca64570fa09cb8",
    "changed-ui": "d9eefba6f2ca0cfa4d4c23a3e1726e5c1ab6d402dbb0970dd32244422d02cef4",
    "required": "ababe19447335538c149376c5f3b324c7caf4a959a016f39ad616052d667a77d",
}


def semantic_job(job):
    controls = {key: value for key, value in job.items() if key != "name"}
    if "steps" in controls:
        controls["steps"] = [{key: value for key, value in step.items() if key != "name"}
                             for step in controls["steps"]]
    return controls


def check_wiring(workflow):
    require(workflow.get("jobs", {}).get("required", {}).get("name") == "ASA / required",
            "General required check name drift")
    for name, expected in AUTHORIZATION_JOBS_V1.items():
        job = semantic_job(workflow.get("jobs", {}).get(name, {}))
        observed = hashlib.sha256(json.dumps(job, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        require(observed == expected, "General v1 authorization job drift: " + name)


def check_bounded_wiring(workflow):
    controls = {key: value for key, value in workflow.items() if key != "name"}
    controls["jobs"] = {name: semantic_job(job) for name, job in workflow["jobs"].items()}
    observed = hashlib.sha256(json.dumps(controls, sort_keys=True,
                                        separators=(",", ":")).encode()).hexdigest()
    require(observed == "ab488d666240bf5206e7dd0b3caf9f5654101eec16bd3f2e70b7c8989e3372dc",
            "General v1 actual bounded checks drift")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, stderr=subprocess.DEVNULL)


def exact_sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) and value != "0" * 40


def source(root, head, base, event, ref, merge_candidate, base_ref):
    require(exact_sha(head) and git(root, "rev-parse", "HEAD").decode().strip() == head,
            "Checkout differs from exact event HEAD")
    require(not git(root, "status", "--porcelain", "--untracked-files=all"), "Dirty source")
    git(root, "diff", "--check")
    tree = git(root, "rev-parse", "--verify", head + "^{tree}").decode().strip()
    require(exact_sha(merge_candidate), "Missing exact event merge candidate")
    if event == "pull_request":
        require(exact_sha(base) and re.fullmatch(r"refs/pull/[1-9][0-9]*/merge", ref),
                "Unknown pull request base or merge ref")
        parents = git(root, "show", "-s", "--format=%P", merge_candidate).decode().split()
        require(parents == [base, head], "Event merge parents do not bind the exact base and source")
        candidate_tree = git(root, "rev-parse", "--verify", merge_candidate + "^{tree}").decode().strip()
        require(candidate_tree == tree, "Source tree differs from the event merge candidate; update the branch")
    else:
        require(event == "push" and ref == "refs/heads/main" and base_ref == "main"
                and merge_candidate == head, "Unknown full General event source")
    return tree


def classify(root, head, base, event, ref, merge_candidate, base_ref):
    tree = source(root, head, base, event, ref, merge_candidate, base_ref)
    plan = dict(version=VERSION, source_sha=head, base_sha=base, event=event, ref=ref,
                merge_candidate_sha=merge_candidate, tree_sha=tree, base_ref=base_ref,
                route="FULL", candidate=False, merge_base="", reason="Full event or unknown impact",
                integration_ready=False, release_ready=False)
    if event != "pull_request" or base_ref != "main":
        return plan
    try:
        git(root, "show", base + ":tools/devex_ci_contract.py")
    except subprocess.CalledProcessError:
        return plan
    try:
        require(git(root, "rev-parse", "--verify", base + "^{commit}").decode().strip() == base,
                "Unknown base")
        merge = git(root, "merge-base", base, head).decode().strip()
        plan["merge_base"] = merge
        git(root, "diff", "--check", merge, head, "--")
        raw = git(root, "diff", "--name-status", "-z", "--no-renames", merge, head, "--").decode()
        tokens = raw.split("\0")
        require(tokens[-1] == "" and len(tokens[:-1]) % 2 == 0, "Malformed changes")
        changes = list(zip(tokens[:-1:2], tokens[1:-1:2]))
        candidate = bool(changes) and all(
            (state == "M" and path in PRODUCTION) or
            (state == "A" and re.fullmatch(TEST_PATTERN, path) and path !=
             "apps/web/src/components/CollectPicker.spec.ts") for state, path in changes)
        controls = {path: git(root, "rev-parse", base + ":" + path).decode().strip()
                    for path in CONTROLS}
        candidate = candidate and all(git(root, "rev-parse", head + ":" + path).decode().strip()
                                      == identity for path, identity in controls.items())
        # Bootstrap/obsolete branches without this accepted contract cannot opt in.
        candidate = candidate and git(root, "show", base + ":tools/devex_ci_contract.py") == \
            git(root, "show", head + ":tools/devex_ci_contract.py")
        plan.update(candidate=candidate, controls=controls,
                    reason="Existing effect proof required" if candidate else "Unsupported diff or control drift")
    except (subprocess.CalledProcessError, ValueError, UnicodeError):
        plan.update(candidate=False, reason="Unknown base, controls or changes")
    return plan


def validate_proof(root, proof):
    require(isinstance(proof, dict) and type(proof.get("eligible")) is bool, "Malformed effect proof")
    if not proof["eligible"]:
        return False
    require(proof.get("profile_id") == "collect-picker-presentation-v1"
            and type(proof.get("version")) is int and proof["version"] == 1
            and proof.get("surface_id") == "SURF-PROJECT-COLLECTION-PICKER"
            and proof.get("test_ids") == LOCAL_IDS and proof.get("ci_test_files") == [BROWSER]
            and proof.get("ci_test_ids") == ["TST-COLLECT-PICKER-BROWSER-001"], "Unknown proof profile")
    tests = proof.get("test_files")
    require(isinstance(tests, list) and tests and all(isinstance(p, str) and
            re.fullmatch(TEST_PATTERN, p) for p in tests) and tests == sorted(set(tests)),
            "Unknown component family")
    actual_tests = sorted(name for name in git(root, "ls-files", "-z").decode().split("\0")
                          if re.fullmatch(TEST_PATTERN, name))
    require(tests == actual_tests, "Incomplete component source binding")
    protected = sorted([*PRODUCTION, *tests, *BROWSER_INPUTS])
    require(proof.get("protected_paths") == protected, "Missing source binding")
    digest = hashlib.sha256()
    for name in protected:
        cursor = root
        for part in Path(name).parts:
            cursor /= part
            require(not cursor.is_symlink(), "Symlink source")
        digest.update(name.encode() + b"\0" + cursor.read_bytes() + b"\0")
    require(proof.get("source_digest") == digest.hexdigest(), "Stale source proof")
    return proof.get("local_effect_class") in ("L0_LOCAL_UI", "L1_UI_BEHAVIOR")


def select(root, head, base, event, ref, merge_candidate, base_ref, proof=None):
    plan = classify(root, head, base, event, ref, merge_candidate, base_ref)
    if plan["candidate"] and proof is not None and validate_proof(root, proof):
        if FAST_ENABLED:
            plan.update(route="FAST", proof=proof, reason="Pinned L0/L1 effect; Data/Access NOT_APPLICABLE")
        else:
            plan.update(route="PARALLEL", proof=proof, reason="Pinned L0/L1 effect; full General remains mandatory")
    return plan


def validate_plan(root, plan, head, base, event, ref, merge_candidate, base_ref):
    require(isinstance(plan, dict), "Missing plan")
    expected = select(root, head, base, event, ref, merge_candidate, base_ref, plan.get("proof"))
    require(plan == expected, "Unknown, forged or stale plan/source binding")
    return expected


def summarize(root, plan, needs, head, base, event, ref, merge_candidate, base_ref, run_id, attempt):
    validate_plan(root, plan, head, base, event, ref, merge_candidate, base_ref)
    require(isinstance(needs, dict) and set(needs) == set(NEEDS), "Missing/unknown native jobs")
    require(needs["selection"]["result"] == "success", "Selection did not succeed")
    require(json.loads(needs["selection"]["outputs"]["plan"]) == plan, "Native selection binding differs")
    route = plan["route"]
    if route == "FULL":
        require(needs["changed-ui"]["result"] == "skipped", "Unexpected bounded job on FULL route")
    else:
        require(route in ("PARALLEL", "FAST") and event == "pull_request", "Unknown/unsafe route")
        require(needs["changed-ui"]["result"] == "success", "Applicable bounded checks did not succeed")
        evidence = json.loads(needs["changed-ui"]["outputs"]["evidence"])
        require(evidence == dict(version=VERSION, plan=plan, run_id=run_id, attempt=attempt,
                                 local_checks=LOCAL_IDS, browser=BROWSER, browser_cases=24,
                                 status="FOCUSED_PASS"), "Missing/incomplete actual bounded evidence")
    if route in ("FULL", "PARALLEL"):
        # Keep the original four-success semantics as the authoritative full path.
        from ci_required import summarize as full_summary
        report = full_summary(head, git(root, "rev-parse", "HEAD").decode().strip(),
                              {job: needs[job] for job in FULL_JOBS})
        if route == "PARALLEL":
            report["checks"]["changed-ui"] = "PASS"
    else:
        require(needs["governance"]["result"] == "success", "Applicable governance did not succeed")
        require(all(needs[job]["result"] == "skipped" for job in FULL_JOBS[1:]),
                "Contradictory full/FAST selection")
        report = dict(status="PASS", source_sha=head, full_regression_verified=False,
                      checks={"governance": "PASS", "changed-ui": "PASS",
                              "code": "NOT_APPLICABLE", "postgres-tests": "NOT_APPLICABLE",
                              "access-a-browser": "NOT_APPLICABLE"},
                      integration_ready=False, release_ready=False)
    report.update(version=VERSION, route=route, plan=plan, release_status="RELEASE_NOT_READY")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("classify", "select", "validate", "evidence", "required"))
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    env = os.environ
    binding = tuple(env.get(key, "") for key in
                    ("SOURCE_SHA", "BASE_SHA", "EVENT_NAME", "EVENT_REF", "MERGE_CANDIDATE_SHA", "BASE_REF"))
    directory = args.root / ".asa/devex"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        if args.mode in ("classify", "select"):
            proof = json.loads((directory / "ci-proof.json").read_text()) if args.mode == "select" and (directory / "ci-proof.json").exists() else None
            report = select(args.root, *binding, proof)
            (directory / "general-plan.json").write_text(json.dumps(report, indent=2) + "\n")
            if env.get("GITHUB_OUTPUT"):
                with open(env["GITHUB_OUTPUT"], "a") as output:
                    output.write("candidate=" + str(report["candidate"]).lower() + "\n")
                    output.write("merge_base=" + report["merge_base"] + "\nroute=" + report["route"] + "\n")
                    output.write("plan=" + json.dumps(report, separators=(",", ":")) + "\n")
        else:
            plan = json.loads(env.get("GENERAL_PLAN", ""))
            report = plan
            if args.mode in ("validate", "evidence"):
                validate_plan(args.root, plan, *binding)
            if args.mode == "evidence":
                require(plan["route"] in ("PARALLEL", "FAST"), "No bounded evidence for FULL plan")
                report = dict(version=VERSION, plan=plan, run_id=env["GITHUB_RUN_ID"],
                              attempt=env["GITHUB_RUN_ATTEMPT"], local_checks=LOCAL_IDS,
                              browser=BROWSER, browser_cases=24, status="FOCUSED_PASS")
                local = json.loads((directory / "ci-check.json").read_text(encoding="utf-8"))
                timings = [{key: item.get(key) for key in ("id", "state", "duration_s", "exit_code")}
                           for item in local["checks"] if item["id"] in LOCAL_IDS]
                (directory / "ci-result.json").write_text(
                    json.dumps({**report, "checks": timings}, indent=2) + "\n", encoding="utf-8")
                with open(env["GITHUB_OUTPUT"], "a") as output:
                    output.write("evidence=" + json.dumps(report, separators=(",", ":")) + "\n")
            elif args.mode == "required":
                from ci_required import unique_object
                needs = json.loads(env.get("ASA_REQUIRED_NEEDS_JSON", ""), object_pairs_hook=unique_object)
                report = summarize(args.root, plan, needs, *binding,
                                   env["GITHUB_RUN_ID"], env["GITHUB_RUN_ATTEMPT"])
        print(json.dumps(report, indent=2))
        return 0 if report.get("status", "PASS") == "PASS" or args.mode == "evidence" else 1
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as exc:
        print(json.dumps(dict(status="BLOCKED", error=str(exc), full_regression_verified=False,
                              release_ready=False, integration_ready=False)))
        return 1


if __name__ == "__main__":
    sys.exit(main())

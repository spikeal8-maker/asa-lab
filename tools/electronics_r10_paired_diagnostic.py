"""R10 diagnostic v1: two unchanged R4 cases, once per immutable source.

This is not a full R4 qualification. Docker is available only in the genuine
existing R4/browser workflow_dispatch job. Every image proof invokes that
source's original CLI; this helper neither substitutes GitHub identity nor
imports proof functions around their runtime guards.
"""

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import subprocess
import sys
import time


PROFILE = "r10-paired-regression"
WORKFLOW = ".github/workflows/electronics-r4-m1-focused.yml"
PROOF = "tools/test_ci_image_transport.py"
SPEC = "e2e/electronics-ready-cadence.spec.ts"
TITLES = (
    "Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases",
    "Classroom D2-D4: ordered joint LEDs, five delays, Reset and cookies-only saved reopen",
)
GREP = "(?:" + "|".join(re.escape(title) for title in TITLES) + ")$"
BUILD_ARGS = (
    "NODE_IMAGE=mirror.gcr.io/library/node@sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2",
    "CADDY_IMAGE=mirror.gcr.io/library/caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83",
    "BUILDKIT_SYNTAX=mirror.gcr.io/docker/dockerfile@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720",
)
# Trees cover unchanged test helpers and every referenced owner asset. The
# product trees deliberately differ: each phase builds its own complete source.
EQUAL_INPUTS = (
    "e2e", SPEC, "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json", ".npmrc",
    ".dockerignore", "Dockerfile.api", "Dockerfile.web", "docker/web/Caddyfile",
    "compose.yaml", "compose.test.yaml", ".github/compose.registry-ci.yaml",
    "playwright.config.ts", PROOF, "tools/electronics-failure-reporter.mjs", WORKFLOW,
    "docs/product/electronics/evidence/ci-image-transport-545-receipt.json",
    "docs/product/electronics/evidence/ci-image-transport-classroom-d13-receipt.json",
    "docs/product/projects/evidence/ci-node-transport-429-receipt.json",
    "docs/product/electronics/examples/D2_D4_3x330ohm_red_LED.schematic.json",
    "docs/product/electronics/lessons/D2_D4_CLASSROOM.md",
    "apps/web/public/assets/electronics",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def revision(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None,
            "Both revisions must be immutable lowercase 40-hex Git SHAs")
    return value


def git(root, *arguments):
    return subprocess.run(["git", "--no-optional-locks", "-C", str(root), *arguments],
                          check=True, capture_output=True, text=True).stdout.strip()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def ci_context():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and platform.system() == "Linux"
            and platform.machine() in ("x86_64", "amd64"),
            "BLOCKED: paired diagnostic is restricted to disposable GitHub Linux amd64 CI")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    require(repository == "spikeal8-maker/asa-lab"
            and os.environ.get("GITHUB_JOB") == "browser"
            and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and os.environ.get("ASA_ELECTRONICS_QUALIFICATION_PROFILE") == PROFILE
            and re.fullmatch(re.escape(repository + "/" + WORKFLOW)
                             + r"@refs/heads/[^\s@]+", os.environ.get("GITHUB_WORKFLOW_REF", "")),
            "BLOCKED: use the genuine R4/browser opt-in diagnostic dispatch")
    run_id, attempt = os.environ.get("GITHUB_RUN_ID", ""), os.environ.get("GITHUB_RUN_ATTEMPT", "")
    require(re.fullmatch(r"[0-9]+", run_id) and re.fullmatch(r"[0-9]+", attempt),
            "BLOCKED: missing exact disposable run/attempt identity")
    workspace = Path(os.environ.get("GITHUB_WORKSPACE", ""))
    temporary = Path(os.environ.get("RUNNER_TEMP", ""))
    require(workspace.is_absolute() and workspace.resolve() == workspace
            and temporary.is_absolute() and temporary.resolve() == temporary,
            "BLOCKED: CI workspace/temp must be real absolute directories")
    require(Path(__file__).resolve() == workspace / "tools/electronics_r10_paired_diagnostic.py"
            and git(workspace, "rev-parse", "HEAD") == revision(os.environ.get("GITHUB_SHA")),
            "BLOCKED: control helper must come from the exact dispatched checkout")
    return workspace, temporary, run_id, attempt


def source_receipt(root, expected):
    require(root.is_dir() and root.resolve() == root, "Source checkout must be a real directory")
    require(git(root, "rev-parse", "--show-toplevel") == str(root), "Source is not its own checkout")
    actual = git(root, "rev-parse", "HEAD")
    require(actual == revision(expected), "Actual Git HEAD differs from requested immutable source")
    require(not git(root, "status", "--porcelain=v1", "--untracked-files=all"),
            "Source checkout must be clean before building")
    objects = {path: git(root, "rev-parse", "HEAD:" + path) for path in EQUAL_INPUTS}
    hashes = {path: hashlib.sha256((root / path).read_bytes()).hexdigest()
              for path in (SPEC, "pnpm-lock.yaml")}
    workflow = (root / WORKFLOW).read_text(encoding="utf-8")
    require(all(argument in workflow for argument in BUILD_ARGS),
            "Original R4 pinned build arguments differ from diagnostic v1")
    return {"requestedRevision": expected, "actualRevision": actual,
            "sourceRoot": str(root), "cleanBeforeBuild": True,
            "gitObjects": objects, "sha256": hashes}


def validate_sources(before_root, after_root, before, after):
    receipts = [source_receipt(before_root, before), source_receipt(after_root, after)]
    require(receipts[0]["gitObjects"] == receipts[1]["gitObjects"],
            "BLOCKED: original tests/helpers, lock, fixtures or image contract differ between phases")
    require(receipts[0]["sha256"] == receipts[1]["sha256"],
            "BLOCKED: actual test/lock bytes differ between phases")
    return receipts


def project_name(run_id, attempt, phase):
    require(re.fullmatch(r"[0-9]+", run_id) and re.fullmatch(r"[0-9]+", attempt)
            and phase in ("before", "after"), "Invalid disposable project identity")
    return f"asa-lab-electronics-r10-{run_id}-{attempt}-{phase}"


def phase_environment(source_sha, project):
    # GITHUB_* and RUNNER_TEMP remain the genuine job context. Only the source
    # and existing test qualification variables change between the two phases.
    environment = dict(os.environ)
    environment.update({
        "CI": "true", "NX_SKIP_NX_CACHE": "true", "ASA_BUILD_REVISION": source_sha,
        "ASA_IMAGE_TAG": source_sha, "ASA_ELECTRONICS_EXPECTED_SHA": source_sha,
        "ASA_ELECTRONICS_FAILURE_REPORT": "true",
        "ASA_ELECTRONICS_QUALIFICATION_PROFILE": "strict-real-time",
        "ASA_ELECTRONICS_BROWSER_SHARD": "", "COMPOSE_PROJECT_NAME": project,
        "ASA_TEST_UID": "1000", "ASA_TEST_GID": "1000",
    })
    return environment


def compose_command(temporary):
    return ["docker", "compose", "-f", "compose.yaml", "-f", "compose.test.yaml",
            "-f", ".github/compose.registry-ci.yaml", "-f",
            str(temporary / "asa-electronics-postgres.yaml"), "--profile", "test"]


class Commands:
    def __init__(self, root, environment, output, receipt, prefix=""):
        self.root, self.environment, self.output = root, environment, output
        self.receipt, self.prefix = receipt, prefix

    def run(self, name, arguments, timeout=240, check=True):
        log = self.output / f"{self.prefix}{name}.log"
        row = {"name": name, "argv": arguments, "cwd": str(self.root),
               "log": log.name, "startedAt": utc_now()}
        self.receipt.setdefault("commands", []).append(row)
        write_json(self.output / "phase.json", self.receipt)
        print(f"[{self.receipt['phase']}] {name}: {shlex.join(arguments)}", flush=True)
        started = time.monotonic()
        with log.open("x", encoding="utf-8") as stream:
            try:
                result = subprocess.run(arguments, cwd=self.root, env=self.environment,
                                        stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
                row["exitCode"] = result.returncode
            except subprocess.TimeoutExpired:
                row.update(exitCode=124, timedOut=True)
            except OSError as error:
                row.update(exitCode=127, infrastructureError=str(error))
        row.update(durationSeconds=round(time.monotonic() - started, 3), endedAt=utc_now())
        write_json(self.output / "phase.json", self.receipt)
        print(f"[{self.receipt['phase']}] {name}: exit={row['exitCode']}", flush=True)
        if check:
            require(row["exitCode"] == 0, f"BLOCKED: {name} exited {row['exitCode']}; see {log}")
        return row


def read_journal(path, expected_sha, exit_code):
    require(path.is_file(), "BLOCKED: missing original incremental failure journal")
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    starts = [row for row in rows if row.get("event") == "started"]
    begins = [row for row in rows if row.get("event") == "begin"]
    ends = [row for row in rows if row.get("event") == "end"]
    tests = [row for row in rows if row.get("event") == "testEnd"]
    require(len(starts) == len(begins) == len(ends) == 1
            and starts[0].get("expectedSourceSha") == expected_sha
            and starts[0].get("qualificationProfile") == "strict-real-time"
            and begins[0].get("expectedTestCount") == 2 and len(tests) == 2,
            "BLOCKED: incomplete run or not exactly two original test attempts")
    require(sorted(row.get("titlePath", [""])[-1] for row in tests) == sorted(TITLES)
            and all(row.get("location", {}).get("file") == SPEC
                    and row.get("retry") == 0 and row.get("expectedStatus") == "passed"
                    and row.get("status") in ("passed", "failed", "timedOut") for row in tests),
            "BLOCKED: skipped, retried, interrupted or different test cases")
    end = ends[0]
    require(end.get("runnerErrorCount") == 0 and end.get("dataEventsOmitted") == 0
            and end.get("evidenceLimited") is False
            and not any(row.get("event") in ("runnerError", "capacityReached") for row in rows),
            "BLOCKED: runner/setup error or incomplete journal")
    observed = end.get("observedAttemptCounts", {})
    require(sum(observed.values()) == 2
            and all(observed.get(state, 0) == sum(row["status"] == state for row in tests)
                    for state in ("passed", "failed", "timedOut", "skipped", "interrupted", "unknown")),
            "BLOCKED: journal attempt counts disagree")
    passed = all(row["status"] == "passed" for row in tests)
    require((passed and exit_code == 0 and end.get("status") == "passed")
            or (not passed and exit_code == 1 and end.get("status") in ("failed", "timedout")),
            "BLOCKED: process exit and original test outcomes disagree")
    return {"status": "PASS" if passed else "FAIL", "expectedTestCount": 2,
            "actualTestCount": 2, "attemptsPerTest": 1, "tests": tests,
            "journalSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "end": end}


def cleanup(commands, compose):
    commands.run("stack-state", [*compose, "ps", "-a"], timeout=60, check=False)
    commands.run("stack-logs", [*compose, "logs", "--no-color"], timeout=60, check=False)
    result = commands.run("cleanup", [*compose, "down", "-v", "--remove-orphans"],
                          timeout=120, check=False)
    empty = commands.run("cleanup-empty", ["docker", "ps", "--all", "--quiet", "--filter",
                                          "label=com.docker.compose.project=" + commands.receipt["projectName"]],
                         timeout=60, check=False)
    clean = (result["exitCode"] == 0 and empty["exitCode"] == 0
             and not (commands.output / empty["log"]).read_text(encoding="utf-8").strip())
    commands.receipt["cleanup"] = "PASS" if clean else "BLOCKED"
    write_json(commands.output / "phase.json", commands.receipt)
    return clean


def run_phase(phase, root, sha, temporary, project, output, source):
    output.mkdir()
    receipt = {"phase": phase, "source": source, "projectName": project,
               "status": "BLOCKED", "startedAt": utc_now(), "cleanupRequired": False}
    environment = phase_environment(sha, project)
    receipt["environment"] = {key: environment[key] for key in (
        "CI", "NX_SKIP_NX_CACHE", "ASA_BUILD_REVISION", "ASA_IMAGE_TAG",
        "ASA_ELECTRONICS_EXPECTED_SHA", "ASA_ELECTRONICS_FAILURE_REPORT",
        "ASA_ELECTRONICS_QUALIFICATION_PROFILE", "ASA_ELECTRONICS_BROWSER_SHARD",
        "COMPOSE_PROJECT_NAME", "ASA_TEST_UID", "ASA_TEST_GID")}
    receipt["buildArguments"] = list(BUILD_ARGS)
    commands = Commands(root, environment, output, receipt)
    compose = compose_command(temporary)
    try:
        for relative in ("e2e/artifacts/electronics-simulation", "reports"):
            directory = root / relative
            directory.mkdir(parents=True, exist_ok=True)
            require(directory.resolve() == directory, "Evidence directory must not be a symlink")
            directory.chmod(0o777)
        # These are the original immutable source's CLI invocations, in the same
        # order as the existing R4/browser job. Its runtime allowlist still runs.
        commands.run("prepare-postgres", ["python3", PROOF, "--prepare-electronics-postgres"])
        receipt["cleanupRequired"] = True
        commands.run("compose-proof", ["python3", PROOF, "--electronics-compose-model-check"])
        arguments = [item for value in BUILD_ARGS for item in ("--build-arg", value)]
        commands.run("build", [*compose, "build", *arguments,
                               "migration", "api", "web", "test-runner"], timeout=900)
        commands.run("built-image-proof", ["python3", PROOF, "--electronics-built-images"])
        commands.run("start-postgres", [*compose, "up", "-d", "--wait", "--wait-timeout", "120", "postgres"])
        commands.run("postgres-image-proof", ["python3", PROOF, "--electronics-pulled-postgres"])
        commands.run("migrate", [*compose, "run", "--rm", "--no-deps", "migration"])
        commands.run("start-editor", [*compose, "up", "-d", "--wait", "--wait-timeout", "240",
                                      "--no-deps", "api", "web"], timeout=300)
        # No alternate config, assertion, timeout, test fixture or reporter. The
        # grep selects the two existing titles; their original journal proves
        # actual execution. max-failures=0 preserves the second case after FAIL.
        test_command = [*compose, "run", "--rm", "--no-deps", "-e", "NX_SKIP_NX_CACHE=true",
                        "-e", "ASA_ELECTRONICS_EXPECTED_SHA", "-e", "ASA_ELECTRONICS_QUALIFICATION_PROFILE",
                        "-e", "ASA_ELECTRONICS_FAILURE_REPORT", "test-runner", "corepack", "pnpm", "exec",
                        "playwright", "test", SPEC, "--workers=1", "--retries=0", "--max-failures=0",
                        "--grep", GREP]
        test_run = commands.run("original-tests", test_command, timeout=1200, check=False)
        receipt["testExitCode"] = test_run["exitCode"]
        receipt["result"] = read_journal(root / "reports/electronics-failures.ndjson", sha,
                                         test_run["exitCode"])
        receipt["status"] = receipt["result"]["status"]
        commands.run("tracked-source-unchanged", ["git", "diff", "--exit-code", "HEAD", "--"], timeout=60)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        receipt.update(status="BLOCKED", blockedReason=str(error))
    finally:
        if receipt["cleanupRequired"] and not cleanup(commands, compose):
            receipt.update(status="BLOCKED", blockedReason="Disposable stack cleanup failed; second phase cannot share its runner safely")
        receipt["endedAt"] = utc_now()
        write_json(output / "phase.json", receipt)
    return receipt


def run_pair(before, after, run_one, checkpoint):
    results = []
    for phase, arguments in (("before", before), ("after", after)):
        if results and results[-1].get("cleanup") == "BLOCKED":
            result = {"phase": phase, "status": "BLOCKED",
                      "blockedReason": "Previous phase cleanup failed; shared runner is not isolated"}
        else:
            result = run_one(phase, *arguments)
        results.append(result)
        checkpoint(results)
    return results


def fallback_cleanup(workspace, temporary, run_id, attempt, before, after):
    for phase, sha in (("before", before), ("after", after)):
        output = workspace / "reports/r10-paired" / phase
        receipt_path = output / "phase.json"
        if not receipt_path.is_file():
            continue
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        if not receipt.get("cleanupRequired") or receipt.get("cleanup") == "PASS":
            continue
        project = project_name(run_id, attempt, phase)
        root = workspace / ("paired-" + phase)
        require(receipt.get("projectName") == project and receipt.get("phase") == phase
                and receipt.get("source", {}).get("actualRevision") == sha
                and root.resolve() == root and git(root, "rev-parse", "HEAD") == sha,
                "BLOCKED: cleanup receipt does not identify this exact disposable phase")
        commands = Commands(root, phase_environment(sha, project), output, receipt, "fallback-")
        require(cleanup(commands, compose_command(temporary)), "BLOCKED: fallback cleanup failed")


def execute(before, after):
    workspace, temporary, run_id, attempt = ci_context()
    output = workspace / "reports/r10-paired"
    output.mkdir(parents=True, exist_ok=False)
    summary = {"format": "asa-electronics-r10-paired-diagnostic-v1", "status": "BLOCKED",
               "fullR4Qualification": False, "controlRevision": os.environ["GITHUB_SHA"],
               "beforeRevision": before, "afterRevision": after, "titles": TITLES,
               "attemptsPerTestPerPhase": 1, "phases": [], "startedAt": utc_now(),
               "runner": {"runId": run_id, "runAttempt": attempt,
                          "name": os.environ.get("RUNNER_NAME"), "os": platform.platform(),
                          "machine": platform.machine(), "logicalCpus": os.cpu_count(),
                          "imageOS": os.environ.get("ImageOS"), "imageVersion": os.environ.get("ImageVersion")}}
    write_json(output / "paired.json", summary)

    def checkpoint(results):
        summary["phases"] = results
        write_json(output / "paired.json", summary)

    try:
        roots = (workspace / "paired-before", workspace / "paired-after")
        sources = validate_sources(*roots, before, after)
        summary["equalInputs"] = sources[0]["gitObjects"]
        arguments = [(roots[index], sha, temporary, project_name(run_id, attempt, phase), output / phase, sources[index])
                     for index, (phase, sha) in enumerate((("before", before), ("after", after)))]
        results = run_pair(*arguments, run_phase, checkpoint)
        states = [row["status"] for row in results]
        summary["status"] = "BLOCKED" if "BLOCKED" in states else "FAIL" if "FAIL" in states else "PASS"
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        summary["blockedReason"] = str(error)
    summary["endedAt"] = utc_now()
    write_json(output / "paired.json", summary)
    print(json.dumps({"status": summary["status"], "fullR4Qualification": False,
                      "receipt": str(output / "paired.json")}), flush=True)
    return {"PASS": 0, "FAIL": 1, "BLOCKED": 2}[summary["status"]]


def self_test():
    """Offline adversarial checks: no Docker, browser, network or source writes."""
    from tempfile import TemporaryDirectory
    from unittest.mock import patch

    count = 0

    def rejected(action, label):
        nonlocal count
        try:
            action()
        except ValueError:
            count += 1
            return
        raise AssertionError("Expected rejection: " + label)

    for value in (None, "", "main", "a" * 39, "a" * 41, "A" * 40, "g" * 40, "a" * 40 + "\n", "$(id)"):
        rejected(lambda value=value: revision(value), "invalid immutable revision")
    require(revision("a" * 40) == "a" * 40, "Full SHA was rejected")
    count += 1
    with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}, clear=True):
        rejected(ci_context, "local execution")
    for value in ("", "../other", "asa-lab-dev", "1;true"):
        rejected(lambda value=value: project_name(value, "1", "before"), "foreign project identity")
    with patch.dict(os.environ, {"GITHUB_JOB": "browser", "GITHUB_WORKFLOW_REF": "original"}, clear=True):
        environment = phase_environment("a" * 40, "asa-lab-electronics-r10-1-1-before")
        require(environment["GITHUB_JOB"] == "browser" and environment["GITHUB_WORKFLOW_REF"] == "original",
                "Phase environment changed GitHub identity")
        count += 1
    calls = []
    results = run_pair((), (), lambda phase: calls.append(phase) or {"phase": phase, "status": "FAIL", "cleanup": "PASS"}, lambda results: None)
    require(calls == ["before", "after"] and len(results) == 2, "First assertion failure skipped after")
    count += 1
    calls.clear()
    results = run_pair((), (), lambda phase: calls.append(phase) or {"phase": phase, "status": "BLOCKED", "cleanup": "BLOCKED"}, lambda results: None)
    require(calls == ["before"] and results[1]["status"] == "BLOCKED", "Failed cleanup allowed shared runner reuse")
    count += 1
    started = {"event": "started", "expectedSourceSha": "a" * 40, "qualificationProfile": "strict-real-time"}
    tests = [{"event": "testEnd", "titlePath": [SPEC, title], "location": {"file": SPEC},
              "retry": 0, "expectedStatus": "passed", "status": "passed"} for title in TITLES]
    ended = {"event": "end", "status": "passed", "runnerErrorCount": 0, "dataEventsOmitted": 0,
             "evidenceLimited": False, "observedAttemptCounts": {"passed": 2}}
    valid = [started, {"event": "begin", "expectedTestCount": 2}, *tests, ended]
    with TemporaryDirectory(prefix="asa-r10-diagnostic-static-") as directory:
        path = Path(directory) / "failure.ndjson"
        root = Path(directory)
        with patch(__name__ + ".git", side_effect=[str(root), "b" * 40]):
            rejected(lambda: source_receipt(root, "a" * 40), "actual HEAD mismatch")
        with patch(__name__ + ".git", side_effect=[str(root), "a" * 40, " M product.ts"]):
            rejected(lambda: source_receipt(root, "a" * 40), "dirty source checkout")
        with patch(__name__ + ".source_receipt", side_effect=[{"gitObjects": {"test": "a"}}, {"gitObjects": {"test": "b"}}]):
            rejected(lambda: validate_sources(root, root, "a" * 40, "b" * 40), "different test/lock input")

        def check(rows, exit_code=0):
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            return read_journal(path, "a" * 40, exit_code)

        require(check(valid)["actualTestCount"] == 2, "Valid two-test journal rejected")
        count += 1
        for label, mutate in (
            ("source mismatch", lambda rows: rows[0].update(expectedSourceSha="b" * 40)),
            ("different profile", lambda rows: rows[0].update(qualificationProfile="classroom-d13-v2")),
            ("all skipped", lambda rows: [row.update(status="skipped") for row in rows[2:4]]),
            ("retry", lambda rows: rows[2].update(retry=1)),
            ("wrong test", lambda rows: rows[2].update(titlePath=["different test"])),
            ("wrong count", lambda rows: rows[1].update(expectedTestCount=1)),
            ("missing end", lambda rows: rows.pop()),
            ("runner failure", lambda rows: rows[-1].update(runnerErrorCount=1)),
            ("journal truncation", lambda rows: rows[-1].update(evidenceLimited=True)),
        ):
            changed = deepcopy(valid)
            mutate(changed)
            rejected(lambda changed=changed: check(changed), label)
        failed = deepcopy(valid)
        failed[2]["status"] = "failed"
        failed[-1].update(status="failed", observedAttemptCounts={"passed": 1, "failed": 1})
        require(check(failed, 1)["status"] == "FAIL", "Original assertion failure was hidden")
        count += 1
        rejected(lambda: check(failed, 0), "swallowed process failure")
    print(f"R10 paired diagnostic static challenges: PASS ({count} cases; no Docker/browser)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check-revisions", action="store_true")
    modes.add_argument("--cleanup-only", action="store_true")
    modes.add_argument("--self-test", action="store_true")
    parser.add_argument("--before-revision")
    parser.add_argument("--after-revision")
    options = parser.parse_args()
    if options.self_test:
        self_test()
        return 0
    before, after = revision(options.before_revision), revision(options.after_revision)
    require(before != after, "Before and after must identify two distinct immutable sources")
    if options.check_revisions:
        print(json.dumps({"beforeRevision": before, "afterRevision": after, "immutableRevisions": "PASS"}))
        return 0
    if options.cleanup_only:
        fallback_cleanup(*ci_context(), before, after)
        return 0
    return execute(before, after)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print("BLOCKED: " + str(error), file=sys.stderr)
        sys.exit(2)

"""Complete the frozen clock-reference cases on the already selected strict CI runner."""
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HARDWARE = "intel-xeon-6975p-c-4vcpu"
GATE = ["pnpm", "gate:electronics-m1:browser", "--workers=1"]
REPORT_FILE = "electronics-failures.ndjson"
WALL_CASES = {
    '8a29f5cd1c1d4876027f-7521807377fd0a02650b': ('s1', (
        '', '', 'electronics-classroom-timing.spec.ts',
        'Classroom D13: visible 100, 200, 300, 150 and asymmetric phases on one circuit',
    )),
    '8a29f5cd1c1d4876027f-65bd89a58d918807aecb': ('s1', (
        '', '', 'electronics-classroom-timing.spec.ts',
        'Classroom D13: failed edit, correction, Reset and cookies-only saved reopen',
    )),
    '8a29f5cd1c1d4876027f-c8addcb544c9ea57c3dd': ('s1', (
        '', '', 'electronics-classroom-timing.spec.ts',
        'Classroom D13: open LED stays dark while real D13 L blinks',
    )),
    '8a29f5cd1c1d4876027f-c8307bf97d812b7fb04a': ('s1', (
        '', '', 'electronics-classroom-timing.spec.ts',
        'Classroom D13: reversed LED stays dark while real D13 L blinks',
    )),
    '8a29f5cd1c1d4876027f-b8da7c26a72f991e6b63': ('s1', (
        '', '', 'electronics-classroom-timing.spec.ts',
        'Classroom D13: sixty-second bounded running and responsive Stop',
    )),
    'c9f765b305866cb2bfbc-405b76819f0fee002998': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    )),
    'c9f765b305866cb2bfbc-884aafffe44324076569': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    )),
    'c9f765b305866cb2bfbc-faa1efe16ae5862bf596': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino execution: no-delay realtime, production frames and painted LEDs',
    )),
    'c9f765b305866cb2bfbc-2277bed08d46e8c12cb8': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino execution: independent ports, production frames and painted LEDs',
    )),
    'c9f765b305866cb2bfbc-0c67f4fc7fdc9efb8b63': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
    )),
    'c9f765b305866cb2bfbc-4ea95af6ef815e757a40': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    )),
    'c9f765b305866cb2bfbc-d1f588579d1bb9be8565': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
    )),
    'c9f765b305866cb2bfbc-2c34694ca34608b66dfb': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    )),
    'c9f765b305866cb2bfbc-aa4e36b3d083db1102e8': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts',
        'Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history',
    )),
    'c9f765b305866cb2bfbc-d6ba2ceda3c1d09b3be6': ('s2', (
        '', '', 'electronics-ready-cadence.spec.ts', 'Classroom D2-D4 next visible slice',
        'Classroom D2-D4: ordered joint LEDs, five delays, Reset and cookies-only saved reopen',
    )),
    'fb1e0875f7e4e1e7b7a8-655bf9a4a41c489e2b97': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'delays: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-b116e5799a0f3a1531df': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'button-serial: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-8b6a23fc50c30f8a05df': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'short20: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-b72452cced04bccae016': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'short30: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-04c93d5c353061eaca6d': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'short50: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-366e89864680367d6078': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'short100: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-92687e32f6a67d121bb7': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'long1000: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-8749d998e7560cf1782a': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'long5000: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-b88ca66aeacbd72caec9': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'long10000: strict real time and acknowledged native evidence',
    )),
    'fb1e0875f7e4e1e7b7a8-dda64177233e2de6b3cb': ('arduino-realtime', (
        '', '', 'electronics-interactions.spec.ts', 'Issue 682 acknowledged native realtime baseline',
        'long20000: strict real time and acknowledged native evidence',
    )),
}

ORIGINAL = {key: label for key, label in WALL_CASES.items() if label[0] == "arduino-realtime"}
REMAINING = {key: label for key, label in WALL_CASES.items() if key not in ORIGINAL}
END_STATUSES = ("passed", "failed", "timedOut", "skipped", "interrupted", "unknown")


def verify(equal, message):
    if not equal:
        raise ValueError(message)


def hardware_class(observation):
    if not isinstance(observation, dict):
        return "unverified"
    classified = observation.get("hardwareClass")
    if not isinstance(classified, dict):
        return "unverified"
    if (observation.get("status"), observation.get("scope"), observation.get("phase"),
        observation.get("architecture"), classified.get("referenceId")) != (
            "available", "test-runner", "before", "x86_64", HARDWARE
        ):
        return "unverified"
    return classified.get("status", "unverified")


def load_report(path, head, expected):
    raw = path.read_bytes()
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines()]
    verify(len(rows) == len(expected) + 3 and
           all(row["schemaVersion"] == 1 and row["sequence"] == i
               for i, row in enumerate(rows, 1)), "incomplete report")
    start, begin, *tests, end = rows
    verify(start["event"] == "started" and start["expectedSourceSha"] == head and
           start["qualificationProfile"] == "strict-real-time" and start["mode"] == "test" and
           begin["event"] == "begin" and begin["expectedTestCount"] == len(expected), "incorrect report identity")
    verify(len({row["testId"] for row in tests}) == len(expected), "duplicate test identity")
    counts = Counter()
    failures = []
    for row in tests:
        key = row["testId"]
        verify(row["event"] == "testEnd" and row["expectedStatus"] == "passed" and row["retry"] == 0 and
               row["status"] in ("passed", "failed", "timedOut") and key in expected and
               tuple(row["titlePath"]) == expected[key][1] and
               Path(row["location"]["file"]).name == expected[key][1][2], "unexpected test result")
        counts[row["status"]] += 1
        if row["status"] != "passed":
            failures.append(key)
    verify(end["event"] == "end" and end["status"] == ("failed" if failures else "passed") and
           end["dataEventsOmitted"] == end["runnerErrorCount"] == 0 and not end["evidenceLimited"] and
           end["observedAttemptCounts"] == {status: counts[status] for status in END_STATUSES},
           "incomplete or conflicting report footer")
    return {
        "before": begin.get("runnerTiming", {}),
        "ids": sorted(expected),
        "failedIds": failures,
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def pending(report, original_outcome):
    observed = hardware_class(report["before"])
    if observed == "other":
        return "REFERENCE_ABSENT"
    if observed != "reference":
        return "REFERENCE_UNVERIFIED"
    if report["failedIds"]:
        return "REFERENCE_FAILED"
    return "RUN_REMAINING" if original_outcome == "success" else "REFERENCE_INCOMPLETE"


def list_entries(suite, parents=()):
    for spec in suite.get("specs", []):
        verify(len(spec["tests"]) == 1, "more than one project selected")
        yield spec["id"], ("", "", *parents, spec["title"])
    for child in suite.get("suites", []):
        yield from list_entries(child, (*parents, child["title"]))


def assert_selection(report):
    collected = list(list_entries(report))
    verify(not report["errors"] and len(collected) == len(REMAINING) and
           dict(collected) == {key: label[1] for key, label in REMAINING.items()},
           "discovery does not match the frozen 15-case roster")


def store(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def finish(head, target, original_path, extra_path, original_outcome, exit_code):
    data = {"head": head, "scope": "strict-clock-reference-only",
            "hardwareClass": HARDWARE, "referenceRequired": len(WALL_CASES),
            "githubRunId": os.environ.get("GITHUB_RUN_ID"),
            "githubRunAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
            "runner": os.environ.get("RUNNER_NAME"),
            "originalGateOutcome": original_outcome or None,
            "observedIds": []}
    try:
        original = load_report(original_path, head, ORIGINAL)
        data.update(status=pending(original, original_outcome), original=original)
        if data["status"] == "REFERENCE_INCOMPLETE":
            data["reason"] = "the original browser gate did not complete successfully"
        if hardware_class(original["before"]) == "reference":
            data["observedIds"].extend(original["ids"])
        if data["status"] == "RUN_REMAINING" and exit_code is not None:
            data["remainingGateExitCode"] = exit_code
            selected_before = json.loads((extra_path.parent / "reference-before.json").read_text())
            verify(hardware_class(selected_before) == "reference", "second process preflight hardware did not match")
            extra = load_report(extra_path, head, REMAINING)
            data["remaining"] = extra
            verify(hardware_class(extra["before"]) == "reference", "second browser before hardware did not match")
            data["observedIds"].extend(extra["ids"])
            if extra["failedIds"]:
                data["status"] = "REFERENCE_FAILED"
            else:
                verify(exit_code == 0, "the real Playwright command failed outside a case")
                data["status"] = "REFERENCE_PASSED"
    except (OSError, TypeError, ValueError, KeyError) as error:
        data.update(status="REFERENCE_INCOMPLETE", reason=str(error))
    decision = data["status"]
    if decision == "RUN_REMAINING":
        data.update(status="REFERENCE_INCOMPLETE", reason="remaining browser checks have not finished")
    store(target, data)
    return decision


def selector(titles):
    # Playwright uses an ECMAScript RegExp with no slash delimiters.
    escapes = str.maketrans({char: "\\" + char for char in r"\.^$|?*+()[]{}"})
    return "(?:^| )(?:" + "|".join(title.translate(escapes) for title in titles) + ")$"


def run(work_dir):
    check = subprocess.check_output(["python3", "tools/electronics-runner-timing.py", "test-runner", "before"])
    before = json.loads(check)
    store(work_dir / "reference-before.json", before)
    verify(hardware_class(before) == "reference", "the routed container does not match the reference")
    command = [*GATE, "--grep", selector(label[1][-1] for label in REMAINING.values())]
    listed = subprocess.check_output([*command, "--list", "--reporter=json"], text=True, encoding="utf-8")
    report = json.loads(listed[listed.index("\n{") + 1:] if not listed.startswith("{") else listed)
    assert_selection(report)
    store(work_dir / "reference-discovery.json", {"ids": sorted(REMAINING)})
    report_environment = {**os.environ, "ASA_ELECTRONICS_FAILURE_REPORT": "true"}
    return subprocess.run(command, env=report_environment, check=False).returncode


if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    verify(len(ORIGINAL) == 10 and len(REMAINING) == 15, "clock case roster changed")
    if mode == "run" and not args:
        sys.exit(run(Path("/workspace/reports")))
    head, target, original, extra, original_outcome, *result = args
    verify(re.fullmatch(r"[a-f0-9]{40}", head), "exact source SHA required")
    verify((mode, len(result)) in {("plan", 0), ("finish", 1)}, "unrecognized command")
    status = finish(head, Path(target), Path(original), Path(extra),
                    original_outcome, int(result[0]) if result else None)
    print(status)
    sys.exit(1 if mode == "finish" and status not in {"REFERENCE_ABSENT", "REFERENCE_PASSED"} else 0)

"""Plan and verify the strict Electronics qualification on the preassigned CI cohort."""
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

UNIVERSAL_COUNTS = {"s1": 83, "s2": 127, "s3": 0, "s4": 42}
UNIVERSAL_ROSTER_SHA256 = "de66b050228b2007489a207cf64061f3f65ade0b68990f2e8c8662cfc6a39d9c"
SLOTS = (*UNIVERSAL_COUNTS, "arduino-realtime")
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


def list_entries(suite, parents=()):
    for spec in suite.get("specs", []):
        verify(len(spec["tests"]) == 1, "more than one project selected")
        yield spec["id"], ("", "", *parents, spec["title"])
    for child in suite.get("suites", []):
        yield from list_entries(child, (*parents, child["title"]))


def selector(titles):
    # Playwright uses an ECMAScript RegExp with no slash delimiters.
    escapes = str.maketrans({char: "\\" + char for char in r"\.^$|?*+()[]{}"})
    return "(?:^| )(?:" + "|".join(title.translate(escapes) for title in titles) + ")$"


def store(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def collect(arguments):
    listed = subprocess.check_output([*GATE, *arguments, "--list", "--reporter=json"],
                                     text=True, encoding="utf-8")
    report = json.loads(listed[listed.index("\n{") + 1:] if not listed.startswith("{") else listed)
    entries = list(list_entries(report))
    verify(not report["errors"] and len(entries) == len(dict(entries)), "incorrect Playwright roster")
    return dict(entries)


def clock_selector():
    return selector(label[1][-1] for label in WALL_CASES.values())


def roster(shard, output):
    cases = collect(["--grep-invert", clock_selector(), "--shard", shard])
    verify(not (cases.keys() & WALL_CASES.keys()), "universal roster contains reference cases")
    store(output, cases)


def run_reference():
    before = json.loads(subprocess.check_output(
        ["python3", "tools/electronics-runner-timing.py", "test-runner", "before"],
    ))
    store(Path("reports/reference-before.json"), before)
    verify(hardware_class(before) == "reference", "reference container no longer eligible")
    arguments = ["--grep", clock_selector()]
    verify(collect(arguments) == {key: label[1] for key, label in WALL_CASES.items()},
           "discovery does not match all 25 frozen strict cases")
    environment = {**os.environ, "ASA_ELECTRONICS_FAILURE_REPORT": "true"}
    return subprocess.run([*GATE, *arguments], env=environment, check=False).returncode


def qualification(head, inputs, browser_result, run, attempt):
    data = {"head": head, "run": run, "attempt": attempt, "slots": {},
            "errors": [], "universalIds": [], "referenceIds": []}
    universals = set()
    references = 0
    for slot in SLOTS:
        path = inputs / slot
        result = data["slots"][slot] = {}
        try:
            verify(read(path / "identity.json") == [head, slot, run, attempt], "wrong cohort run or SHA")
            first = read(path / "assignment.json")
            kind = hardware_class(first)
            result["hardware"] = kind
            if slot in UNIVERSAL_COUNTS:
                roster_rows = read(path / "universal-roster.json")
                verify(len(roster_rows) == UNIVERSAL_COUNTS[slot]
                       and not (roster_rows.keys() & (universals | WALL_CASES.keys())),
                       "incorrect or overlapping universal roster")
                outcome = read(path / "universal-exit.json")
                if roster_rows:
                    expected = {key: (slot, tuple(titles)) for key, titles in roster_rows.items()}
                    universal = result["universal"] = load_report(path / "universal.ndjson", head, expected)
                    universals.update(universal["ids"])
                    if universal["failedIds"] or outcome != "success":
                        data["errors"].append(f"{slot}: universal qualification failed")
                else:
                    verify(outcome == "skipped" and not (path / "universal.ndjson").exists(),
                           "unexpected execution for the empty discovery shard")
            if kind == "reference":
                observed_before = read(path / "reference-before.json")
                physical = result["reference"] = load_report(path / "reference.ndjson", head, WALL_CASES)
                verify(hardware_class(observed_before) == hardware_class(physical["before"]) == "reference",
                       "reference assignment and browser hardware differ")
                code = read(path / "reference-exit.json")
                if not physical["failedIds"] and code == 0:
                    references += 1
                else:
                    data["errors"].append(f"{slot}: strict reference qualification failed")
            else:
                verify(not any((path / name).exists() for name in ("reference.ndjson", "reference-exit.json")),
                       "reference attempt without prequalification")
        except (OSError, TypeError, ValueError, KeyError, IndexError) as error:
            data["errors"].append(f"{slot}: {error}")
    data["universalIds"] = sorted(universals)
    data["referenceIds"] = sorted(WALL_CASES) if references else []
    if len(universals) != 252:
        data["errors"].append(f"Expected 252 distinct universal cases, observed {len(universals)}")
    elif hashlib.sha256(("\n".join(data["universalIds"]) + "\n").encode()).hexdigest() != UNIVERSAL_ROSTER_SHA256:
        data["errors"].append("Universal test identities differ from the frozen complete roster")
    data["paceProofs"] = {}
    for mode in ("overload", "slow-cpu"):
        try:
            path = inputs / "s4" / f"{mode}-receipt.json"
            verify(bool(read(path)), f"Empty {mode} proof")
            data["paceProofs"][mode] = hashlib.sha256(path.read_bytes()).hexdigest()
        except (OSError, TypeError, ValueError) as error:
            data["errors"].append(f"{mode}: {error}")
    if not references:
        data["errors"].append("No successful prequalified reference measurement")
    if browser_result != "success":
        data["errors"].append("A cohort job or generic pace proof did not complete successfully")
    data["status"] = "failed" if data["errors"] else "passed"
    return data


if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    verify(len(WALL_CASES) == 25, "clock case roster changed")
    if mode == "pattern" and not args:
        print(clock_selector())
    elif mode == "roster":
        shard, output = args
        roster(shard, Path(output))
    elif mode == "classify":
        (sample,) = args
        print(hardware_class(read(Path(sample))))
    elif mode == "reference" and not args:
        sys.exit(run_reference())
    elif mode == "aggregate":
        head, inputs, output, browser_result, run, attempt = args
        verify(re.fullmatch(r"[a-f0-9]{40}", head), "exact source SHA required")
        data = qualification(head, Path(inputs), browser_result, run, attempt)
        store(Path(output), data)
        print(f"{data['status']}: {len(data['universalIds'])}/252 universal, "
              f"{len(data['referenceIds'])}/25 strict reference")
        for error in data["errors"]:
            print(error)
        sys.exit(int(data["status"] != "passed"))
    else:
        raise ValueError("unrecognized clock qualification command")

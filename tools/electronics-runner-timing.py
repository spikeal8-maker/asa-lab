"""Sample Linux runner resources outside the timed Electronics browser scenarios."""

import datetime
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import sys
import time


def read_path(path, limit=8192):
    try:
        with path.open(encoding="utf-8", errors="replace") as stream:
            return stream.read(limit).strip()
    except OSError:
        return None


def named_fields(text, names, separator=" "):
    rows = (line.partition(separator) for line in (text or "").splitlines())
    return {key.strip(): value.strip() for key, _, value in rows if key.strip() in names}


def cgroup_mount(proc):
    membership = next(
        (line[3:] for line in (read_path(proc / "self/cgroup") or "").splitlines()
         if line.startswith("0::/")), None,
    )
    if membership is None:
        return None
    for line in (read_path(proc / "self/mountinfo", 65536) or "").splitlines():
        mount, _, details = line.partition(" - ")
        if not details.startswith("cgroup2 "):
            continue
        if len(mount.split()) < 5:
            continue
        root, target = (
            re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), value)
            for value in mount.split()[3:5]
        )
        try:
            relative = PurePosixPath(membership).relative_to(root)
        except ValueError:
            continue
        if ".." in relative.parts:
            continue
        if not Path(target).is_absolute():
            continue
        return root, Path(target), Path(target).joinpath(*relative.parts)
    return None


def sample_resources(proc=Path("/proc")):
    cpu_columns = "user nice system idle iowait irq softirq steal guest guestNice".split()
    cpu_rows = (read_path(proc / "stat") or "").splitlines()
    cpu_values = cpu_rows[0].split()[1:] if cpu_rows and cpu_rows[0].startswith("cpu ") else []
    location = cgroup_mount(proc)
    cgroup = location[2] if location else None
    cgroup_stats = None
    if cgroup is not None:
        try:
            cgroup_stats = {
                "directoryInode": str(cgroup.stat().st_ino),
                **{key: read_path(cgroup / key) for key in (
                    "cpu.max", "cpu.stat", "cpu.pressure", "cpuset.cpus.effective",
                    "memory.current", "memory.max", "memory.peak", "memory.events", "memory.pressure",
                )},
            }
        except OSError:
            pass
    return {
        "allowedCpuList": named_fields(read_path(proc / "self/status"), {"Cpus_allowed_list"}, ":")
        .get("Cpus_allowed_list"),
        # /proc totals visible to this process can be host-wide even in Docker.
        "procAggregate": {
            "scope": "kernel-visible totals; may be host-wide inside Docker",
            "cpuTicks": dict(zip(cpu_columns, map(int, cpu_values))),
            "clockTicksPerSecond": os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else None,
            "loadAvg": (read_path(proc / "loadavg") or "").split()[:4],
            "cpuPressure": read_path(proc / "pressure/cpu"),
            "memoryPressure": read_path(proc / "pressure/memory"),
            "memory": named_fields(read_path(proc / "meminfo"),
                                   {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}, ":"),
        },
        # Read the reporting process's membership, not an arbitrary Docker or host cgroup.
        "selfCgroupV2": cgroup_stats,
    }


REFERENCE_CLASS = "intel-xeon-6975p-c-4vcpu"
REFERENCE_MODEL = ("GenuineIntel", "Intel(R) Xeon(R) 6975P-C")


def cpu_list(text):
    """Parse a kernel CPU list. Reject contradictory, malformed or excessive masks."""
    cpus = set()
    if not isinstance(text, str):
        return None
    for item in text.split(","):
        match = re.fullmatch(r"([0-9]{1,5})(?:-([0-9]{1,5}))?", item)
        if not match:
            return None
        first = int(match[1])
        last = int(match[2] or match[1])
        if first > last or last >= 8192 or any(cpu in cpus for cpu in range(first, last + 1)):
            return None
        cpus.update(range(first, last + 1))
    return cpus


def runner_cpu_models(proc, allowed):
    """The summary cpuinfo model can belong to an unrelated CPU on a large host."""
    found = {}
    # Only classify a complete source. Do not trust a partially read final processor record.
    try:
        with (proc / "cpuinfo").open(encoding="utf-8") as stream:
            raw = stream.read(1_048_577)
    except (OSError, UnicodeError):
        return None
    if not raw or len(raw) > 1_048_576:
        return None
    for record in re.split(r"\n[ \t]*\n", raw.strip()):
        fields = {}
        for line in record.splitlines():
            key, _, value = line.partition(":")
            key = key.strip()
            if key in ("processor", "vendor_id", "model name"):
                if key in fields:
                    return None
                fields[key] = value.strip()
        identifier = fields.get("processor", "")
        if not re.fullmatch(r"[0-9]{1,5}", identifier):
            return None
        cpu = int(identifier)
        if cpu in allowed:
            if cpu in found or not fields.get("vendor_id") or not fields.get("model name"):
                return None
            found[cpu] = (fields["vendor_id"], fields["model name"])
    return set(found.values()) if found.keys() == allowed else None


def visible_parent_quotas(proc):
    location = cgroup_mount(proc)
    if not location:
        return [], False
    root, mount, current = location
    quotas = []
    # The leaf quota was sampled separately, including when Docker exposes
    # the leaf as the root of the process's own cgroup namespace.
    while current != mount:
        current = current.parent
        try:
            with (current / "cpu.max").open(encoding="utf-8") as stream:
                quotas.append(stream.read(8192).strip())
        except FileNotFoundError:
            # The actual hierarchy root has no cpu.max of its own.
            if current != mount or root != "/":
                return quotas, False
            controllers = read_path(current / "cgroup.controllers")
            if not controllers or "cpu" not in controllers.split():
                return quotas, False
        except (OSError, UnicodeError):
            return quotas, False
    # An explicitly delegated subtree has unknown ancestor quotas.
    return quotas, root == "/"


def classify_visible_hardware(cpu, resources, parent_quotas, hierarchy_visible):
    """Use only CPU identity and capacity visible to this process before the run."""
    def result(status, reason):
        return {"status": status, "referenceId": REFERENCE_CLASS, "reason": reason}

    affinity = cpu_list(resources.get("allowedCpuList"))
    group = resources.get("selfCgroupV2") or {}
    cpuset = cpu_list(group.get("cpuset.cpus.effective"))
    if not affinity or not cpuset or not affinity.issubset(cpuset):
        return result("unverified", "cpu-mask-unverified")
    if not cpu or not all(cpu):
        return result("unverified", "cpu-model-unverified")
    if cpu != REFERENCE_MODEL:
        return result("other", "different-cpu-model")
    if len(affinity) != 4:
        return result("other", "different-vcpu-count")
    for quota in [group.get("cpu.max"), *parent_quotas]:
        match = re.fullmatch(r"(max|[0-9]{1,20}) ([1-9][0-9]{0,19})", quota or "")
        if not match or match[1] == "0":
            return result("unverified", "cpu-quota-unverified")
        if match[1] != "max" and int(match[1]) < 4 * int(match[2]):
            return result("other", "cpu-quota-below-four")
    if not hierarchy_visible:
        return result("unverified", "cgroup-unavailable")
    return result("reference", "model-affinity-and-visible-quotas-match")


def classify_test_runner(proc, resources, linux):
    if not linux:
        return {"status": "unverified", "referenceId": REFERENCE_CLASS, "reason": "linux-data-unavailable"}
    allowed = cpu_list(resources.get("allowedCpuList"))
    models = runner_cpu_models(proc, allowed) if allowed else None
    cpu = next(iter(models)) if models and len(models) == 1 else None
    parent_quotas, hierarchy_visible = visible_parent_quotas(proc)
    return classify_visible_hardware(cpu, resources, parent_quotas, hierarchy_visible)

def reference_work(iterations):
    value = 0x43C0FFEE
    for index in range(iterations):
        value = (value * 1664525 + index + 1013904223) & 0xFFFFFFFF
    return value


def calibration(proc):
    iterations = 800_000
    reference_work(10_000)
    sched_path = proc / "thread-self/schedstat"
    initial_sched = (read_path(sched_path) or "").split()
    start_wall = time.perf_counter_ns()
    start_cpu = time.thread_time_ns()
    checksum = reference_work(iterations)
    thread_cpu = time.thread_time_ns() - start_cpu
    wall = time.perf_counter_ns() - start_wall
    final_sched = (read_path(sched_path) or "").split()
    return {
        "work": "lcg32-v1",
        "iterations": iterations,
        "checksum": checksum,
        "pythonVersion": platform.python_version(),
        "wallNs": wall,
        "threadCpuNs": thread_cpu,
        "calibrationRunQueueNs": (int(final_sched[1]) - int(initial_sched[1])
                                  if len(initial_sched) >= 2 and len(final_sched) >= 2 else None),
        "scope": "calibration thread only",
    }


def sample(scope, phase, proc=Path("/proc")):
    # Exclude the reference workload from both ends of the scenario's counter delta.
    first = calibration(proc) if phase == "before" else None
    observed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    resources = sample_resources(proc)
    cpu = named_fields(read_path(proc / "cpuinfo"), {"model name", "vendor_id"}, ":")
    return {
        "status": "available",
        "scope": scope,
        "phase": phase,
        "observedAtUtc": observed_at,
        "kernel": platform.release(),
        "architecture": platform.machine(),
        "cpu": cpu,
        **({"hardwareClass": classify_test_runner(proc, resources, platform.system() == "Linux")}
           if scope == "test-runner" and phase == "before" else {}),
        **({"runnerImageOs": os.environ.get("ImageOS", "")[:128],
            "runnerImageVersion": os.environ.get("ImageVersion", "")[:128]} if scope == "host" else {}),
        **resources,
        # The calibration and its schedstat describe this reference thread only.
        "reference": first if first is not None else calibration(proc),
    }


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("host", "test-runner") or sys.argv[2] not in ("before", "after"):
        sys.exit("usage: electronics-runner-timing.py host|test-runner before|after")
    scope, phase = sys.argv[1:]
    try:
        row = json.dumps(sample(scope, phase), separators=(",", ":"))
        if len(row.encode("utf-8")) > 3000:
            raise ValueError("Oversize timing sample")
    except (OSError, ValueError):
        unavailable = {"status": "unavailable", "scope": scope, "phase": phase}
        if scope == "test-runner" and phase == "before":
            unavailable["hardwareClass"] = {"status": "unverified", "referenceId": REFERENCE_CLASS,
                                            "reason": "timing-sample-unavailable"}
        row = json.dumps(unavailable)
    print(row)

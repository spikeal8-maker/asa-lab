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


def cgroup_path(proc):
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
        return Path(target).joinpath(*relative.parts)
    return None


def sample_resources(proc=Path("/proc")):
    cpu_columns = "user nice system idle iowait irq softirq steal guest guestNice".split()
    cpu_rows = (read_path(proc / "stat") or "").splitlines()
    cpu_values = cpu_rows[0].split()[1:] if cpu_rows and cpu_rows[0].startswith("cpu ") else []
    cgroup = cgroup_path(proc)
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
        row = json.dumps({"status": "unavailable", "scope": scope, "phase": phase})
    print(row)

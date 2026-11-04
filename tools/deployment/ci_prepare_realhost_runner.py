#!/usr/bin/env python3
"""Free space only in the explicitly opted-in standard ASA GitHub-hosted job.

The two SDK roots follow actions/runner-images commit
9df30d63b790ea2057d1f50295a8f8a9a303bd88, images/ubuntu/scripts/build/
install-android-sdk.sh and install-dotnetcore-sdk.sh. These source contracts do
not establish the contents or free space of a particular runner. Android's SDK
contents are intentionally writable in that image; its protected root and all
ancestors still must be ordinary directories. Descendant symlinks are unlinked,
never followed. Mount aliases, hardlinked files and special nodes are rejected.

Only JSON with fixed SDK IDs is printed. The ordinary workflow shell writes it
to runner-preparation.json; this privileged process never writes an artifact.
No target/path/threshold override, package operation, Docker call or network
request is exposed. The existing VM preflight remains the authority afterwards.
"""

import contextlib
import json
import os
from pathlib import PurePosixPath
import platform
import re
import signal
import stat
import sys
import time

GIB = 1024 ** 3
REQUIRED_FREE = 24 * GIB
RESERVE = 3 * GIB
SECONDS = 120
MAX_ENTRIES = 1_000_000
MAX_DEPTH = 40
REPOSITORY = "spikeal8-maker/asa-lab"
TARGETS = (("android", "/usr/local/lib/android"), ("dotnet", "/usr/share/dotnet"))
EXPECTED_ENV = {
    "CI": "true", "GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
    "RUNNER_OS": "Linux", "RUNNER_ARCH": "X64", "ImageOS": "ubuntu24",
    "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_WORKFLOW": "ASA Real Host Acceptance",
    "GITHUB_JOB": "realhost", "ASA_REALHOST_RUNNER_CLEANUP": "1",
    "ASA_REALHOST_RUNNER_LABEL": "ubuntu-24.04", "ASA_REALHOST_PUBLIC_REPOSITORY": "true",
}
REASONS = frozenset({"BLOCKED_RUNNER_CONTEXT", "BLOCKED_RUNNER_REVISION", "BLOCKED_RUNNER_PATH",
    "BLOCKED_PROTECTED_PATH_ALIAS", "BLOCKED_RUNNER_PLATFORM", "BLOCKED_RUNNER_PRIVILEGE",
    "BLOCKED_MOUNT_IDENTITY", "BLOCKED_CLEANUP_DEADLINE", "BLOCKED_CLEANUP_ENTRY_LIMIT",
    "BLOCKED_SDK_NODE_TYPE", "BLOCKED_SDK_ROOT_TYPE", "BLOCKED_SDK_IDENTITY_CHANGED",
    "BLOCKED_SDK_MOUNT_ALIAS", "BLOCKED_SDK_HARDLINK", "BLOCKED_SDK_ROOT_PERMISSIONS",
    "BLOCKED_HOST_FREE_DISK", "BLOCKED_CLEANUP_IO"})


class Blocked(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def require(value, code):
    if not value:
        raise Blocked(code)


def absolute(value):
    require(isinstance(value, str) and 1 < len(value) <= 1024 and value.startswith("/")
            and str(PurePosixPath(value)) == value and ".." not in value.split("/")
            and not any(ord(char) < 32 for char in value), "BLOCKED_RUNNER_PATH")
    return PurePosixPath(value)


def guard_environment(environment):
    require(all(environment.get(key) == value for key, value in EXPECTED_ENV.items()), "BLOCKED_RUNNER_CONTEXT")
    require(re.fullmatch(r"[a-f0-9]{40}", environment.get("SOURCE_REVISION", "")), "BLOCKED_RUNNER_REVISION")
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        require(re.fullmatch(r"[1-9][0-9]{0,19}", environment.get(key, "")), "BLOCKED_RUNNER_CONTEXT")
    event = environment.get("GITHUB_EVENT_NAME")
    ref = environment.get("GITHUB_WORKFLOW_REF", "")
    prefix = re.escape(REPOSITORY + "/.github/workflows/setup-realhost.yml@")
    expected = r"refs/pull/[1-9][0-9]*/merge" if event == "pull_request" else r"refs/heads/[A-Za-z0-9_./-]+"
    require(event in ("pull_request", "workflow_dispatch") and re.fullmatch(prefix + expected, ref),
            "BLOCKED_RUNNER_CONTEXT")
    workspace, temporary = absolute(environment.get("GITHUB_WORKSPACE")), absolute(environment.get("RUNNER_TEMP"))
    for _, value in TARGETS:
        target = absolute(value)
        require(all(not path.is_relative_to(target) and not target.is_relative_to(path)
                    for path in (workspace, temporary)), "BLOCKED_PROTECTED_PATH_ALIAS")
    return workspace, temporary


def guard_platform(release, architecture, uid):
    require(sys.platform == "linux" and release.get("ID") == "ubuntu" and release.get("VERSION_ID") == "24.04"
            and architecture == "x86_64" and hasattr(os, "O_PATH") and hasattr(os, "O_NOFOLLOW"),
            "BLOCKED_RUNNER_PLATFORM")
    require(uid == 0, "BLOCKED_RUNNER_PRIVILEGE")


def mount_id(descriptor):
    # Kernel fdinfo distinguishes same-device bind mounts as well as devices.
    with open(f"/proc/self/fdinfo/{descriptor}", "rb") as source:
        raw = source.read(4097)
    require(len(raw) <= 4096, "BLOCKED_MOUNT_IDENTITY")
    matches = re.findall(rb"^mnt_id:\s*([0-9]+)$", raw, re.M)
    require(len(matches) == 1, "BLOCKED_MOUNT_IDENTITY")
    return int(matches[0])


def identity(info):
    return info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode)


class Budget:
    def __init__(self):
        self.deadline, self.entries = time.monotonic() + SECONDS, 0

    def check(self, *, entry=False, depth=0):
        self.entries += int(entry)
        require(time.monotonic() < self.deadline, "BLOCKED_CLEANUP_DEADLINE")
        require(self.entries <= MAX_ENTRIES and depth <= MAX_DEPTH, "BLOCKED_CLEANUP_ENTRY_LIMIT")


@contextlib.contextmanager
def deadline_alarm():
    def expired(*_):
        raise Blocked("BLOCKED_CLEANUP_DEADLINE")
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, SECONDS)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


class Tree:
    """Descriptor-relative traversal; production supplies only an opened '/'."""
    def __init__(self, root_fd, budget):
        self.root_fd, self.budget = root_fd, budget
        self.root = os.fstat(root_fd)
        self.mount = mount_id(root_fd)

    def open_child(self, parent, name, *, protected=False):
        self.budget.check()
        before = os.stat(name, dir_fd=parent, follow_symlinks=False)
        directory = stat.S_ISDIR(before.st_mode)
        require(directory or stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode), "BLOCKED_SDK_NODE_TYPE")
        require(not protected or directory, "BLOCKED_SDK_ROOT_TYPE")
        flags = os.O_RDONLY | os.O_DIRECTORY if directory else os.O_PATH
        descriptor = os.open(name, flags | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            actual = os.fstat(descriptor)
            require(identity(actual) == identity(before), "BLOCKED_SDK_IDENTITY_CHANGED")
            require(actual.st_dev == self.root.st_dev and mount_id(descriptor) == self.mount, "BLOCKED_SDK_MOUNT_ALIAS")
            require(not stat.S_ISREG(actual.st_mode) or actual.st_nlink == 1, "BLOCKED_SDK_HARDLINK")
            require(not protected or actual.st_uid == self.root.st_uid and not actual.st_mode & 0o022,
                    "BLOCKED_SDK_ROOT_PERMISSIONS")
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise

    def directory(self, path, *, protected=False):
        descriptor = os.dup(self.root_fd)
        try:
            for part in absolute(str(path)).parts[1:]:
                child = self.open_child(descriptor, part, protected=protected)
                os.close(descriptor)
                descriptor = child
                require(stat.S_ISDIR(os.fstat(descriptor).st_mode), "BLOCKED_RUNNER_PATH")
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise

    def unchanged(self, parent, name, descriptor):
        require(identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) == identity(os.fstat(descriptor)),
                "BLOCKED_SDK_IDENTITY_CHANGED")
        require(mount_id(descriptor) == self.mount, "BLOCKED_SDK_MOUNT_ALIAS")

    def walk(self, descriptor, result, *, remove=False, depth=0):
        self.budget.check(depth=depth)
        with os.scandir(descriptor) as entries:
            for entry in entries:
                self.budget.check(entry=True, depth=depth)
                child = self.open_child(descriptor, entry.name)
                try:
                    info = os.fstat(child)
                    directory = stat.S_ISDIR(info.st_mode)
                    if not remove:
                        result["auditedEntries"] += 1
                        result["auditedAllocatedBytes"] += info.st_blocks * 512
                        result["symlinkEntries"] += int(stat.S_ISLNK(info.st_mode))
                    if directory:
                        self.walk(child, result, remove=remove, depth=depth + 1)
                    self.unchanged(descriptor, entry.name, child)
                    if remove:
                        self.budget.check()
                        (os.rmdir if directory else os.unlink)(entry.name, dir_fd=descriptor)
                        result["removedEntries"] += 1
                finally:
                    os.close(child)

    def remove_sdk(self, path, result):
        parent = self.directory(path.parent, protected=True)
        try:
            try:
                target = self.open_child(parent, path.name, protected=True)
            except FileNotFoundError:
                result["status"] = "ABSENT"
                return
            try:
                result.update(status="AUDITING", auditedEntries=1, auditedAllocatedBytes=os.fstat(target).st_blocks * 512,
                              symlinkEntries=0, removedEntries=0)
                self.walk(target, result)  # Reject the entire unsafe tree before deleting its first entry.
                self.unchanged(parent, path.name, target)
                result["status"] = "REMOVING"
                self.walk(target, result, remove=True)
                self.unchanged(parent, path.name, target)
                self.budget.check()
                os.rmdir(path.name, dir_fd=parent)
                result["removedEntries"] += 1
                result["status"] = "REMOVED"
            finally:
                os.close(target)
        finally:
            os.close(parent)


def free_bytes(descriptor):
    value = os.fstatvfs(descriptor)
    return value.f_bavail * value.f_frsize


def prepare(environment):
    started = time.monotonic()
    result = {"format": "asa-realhost-runner-preparation-v1", "status": "BLOCKED", "reasonCode": "BLOCKED_RUNNER_CONTEXT",
        "requiredFreeBytes": REQUIRED_FREE, "reserveBytes": RESERVE, "cleanupDeadlineSeconds": SECONDS,
        "beforeFreeBytes": None, "afterFreeBytes": None, "targets": {name: {"status": "NOT_ATTEMPTED"} for name, _ in TARGETS}}
    root_fd = temporary_fd = workspace_fd = None
    active = None
    try:
        workspace, temporary = guard_environment(environment)
        guard_platform(platform.freedesktop_os_release(), platform.machine(), os.geteuid())
        result.update(runnerVerified=True, sourceRevision=environment["SOURCE_REVISION"],
                      runId=int(environment["GITHUB_RUN_ID"]), runAttempt=int(environment["GITHUB_RUN_ATTEMPT"]))
        with deadline_alarm():
            root_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            tree = Tree(root_fd, Budget())
            require(tree.root.st_uid == 0 and stat.S_ISDIR(tree.root.st_mode) and not tree.root.st_mode & 0o022,
                    "BLOCKED_RUNNER_PLATFORM")
            temporary_fd = tree.directory(temporary)
            workspace_fd = tree.directory(workspace)
            result["beforeFreeBytes"] = result["afterFreeBytes"] = free_bytes(temporary_fd)
            for name, path in TARGETS:
                if result["afterFreeBytes"] >= REQUIRED_FREE:
                    result["targets"][name]["status"] = "NOT_NEEDED"
                    continue
                active = result["targets"][name]
                tree.remove_sdk(absolute(path), active)
                result["afterFreeBytes"] = free_bytes(temporary_fd)
                active = None
            require(result["afterFreeBytes"] >= REQUIRED_FREE, "BLOCKED_HOST_FREE_DISK")
            result.update(status="PASS", reasonCode="ALREADY_SUFFICIENT" if result["beforeFreeBytes"] >= REQUIRED_FREE else "SPACE_READY")
    except BaseException as error:
        if active is not None:
            active["status"] = "PARTIAL" if active.get("status") == "REMOVING" else "BLOCKED"
        reason = getattr(error, "code", None)
        result.update(status="BLOCKED", reasonCode=reason if isinstance(reason, str) and reason in REASONS else "BLOCKED_CLEANUP_IO")
    finally:
        if temporary_fd is not None:
            try:
                result["afterFreeBytes"] = free_bytes(temporary_fd)
                if result["status"] == "PASS" and result["afterFreeBytes"] < REQUIRED_FREE:
                    result.update(status="BLOCKED", reasonCode="BLOCKED_HOST_FREE_DISK")
            except OSError:
                result.update(status="BLOCKED", reasonCode="BLOCKED_CLEANUP_IO", afterFreeBytes=None)
        for descriptor in (workspace_fd, temporary_fd, root_fd):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    result.update(status="BLOCKED", reasonCode="BLOCKED_CLEANUP_IO")
        result["elapsedSeconds"] = round(time.monotonic() - started, 3)
    return result


def main():
    result = prepare(os.environ)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

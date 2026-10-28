import ctypes
import json
import ntpath
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked
from deployment.legacy_authors import (CIM_PROCESS_SCRIPT, WindowsProcessProbe, WindowsProbeError,
                                       WindowsAuthorBlocked, find_windows_authors, observe_windows_authors,
                                       read_peb_cwd, windows_active_authors)


class DirectoryLayoutTests(unittest.TestCase):
    def fixture(self, width, directory=r"C:\Users\operator\ASA-lab"):
        peb, parameters, address = 0x10000, 0x20000, 0x30000
        raw = directory.encode("utf-16-le")
        pointer_offset, directory_offset = (0x20, 0x38) if width == 8 else (0x10, 0x24)
        descriptor = struct.pack("<HH4xQ" if width == 8 else "<HHI", len(raw), len(raw) + 2, address)
        memory = {(peb + pointer_offset, width): struct.pack("<Q" if width == 8 else "<I", parameters),
                  (parameters + 8, 4): struct.pack("<I", 1),
                  (parameters + directory_offset, len(descriptor)): descriptor, (address, len(raw)): raw}
        return peb, parameters, address, memory

    def test_native_and_wow64_read_only_current_directory_fields(self):
        for width in (8, 4):
            peb, _, _, memory = self.fixture(width)
            observed = []
            def read(address, size):
                observed.append((address, size))
                return memory[address, size]
            with self.subTest(width=width):
                self.assertEqual(read_peb_cwd(read, peb, width), r"C:\Users\operator\ASA-lab")
                self.assertEqual(set(observed), set(memory))
                self.assertLessEqual(max(size for _, size in observed), 100)

    def test_malformed_uninitialized_relative_and_truncated_fields_fail_closed(self):
        for case in ("uninitialized", "odd", "oversized", "pointer", "relative", "truncated", "nul"):
            peb, parameters, address, memory = self.fixture(8, "relative" if case == "relative" else
                                                          "C:\\private\x00wrong" if case == "nul" else r"C:\owned")
            key = (parameters + 0x38, 16)
            if case == "uninitialized": memory[parameters + 8, 4] = struct.pack("<I", 0)
            if case == "odd": memory[key] = struct.pack("<HH4xQ", 11, 12, address)
            if case == "oversized": memory[key] = struct.pack("<HH4xQ", 65534, 65534, address)
            if case == "pointer": memory[key] = struct.pack("<HH4xQ", 16, 18, 0)
            if case == "truncated": memory[key] = memory[key][:-1]
            with self.subTest(case=case), self.assertRaises(Blocked):
                read_peb_cwd(lambda address, size: memory[address, size], peb, 8)

    def test_changed_directory_bytes_or_pointer_fail_closed(self):
        for change in ("descriptor", "value", "parameters"):
            peb, parameters, address, memory = self.fixture(8)
            counts = {}
            target = (parameters + 0x38, 16) if change == "descriptor" else (
                (peb + 0x20, 8) if change == "parameters" else next(key for key in memory if key[0] == address))
            def read(pointer, size):
                key = (pointer, size)
                counts[key] = counts.get(key, 0) + 1
                value = memory[key]
                return bytes([value[0] ^ 1]) + value[1:] if key == target and counts[key] > 1 else value
            with self.subTest(change=change), self.assertRaises(Blocked):
                read_peb_cwd(read, peb, 8)


class AuthorFixture:
    root = r"C:\Users\operator\ASA-lab"
    sid = "S-1-5-21-1-2-3-1001"
    created = 134000000000000000
    current_pid = 10

    def record(self, pid, name="python.exe", command="python watcher.py", **values):
        return {"ProcessId": pid, "ParentProcessId": 10, "Name": name,
                "CommandLine": command, "CreationTime": str(self.created + pid * 100), **values}

    def fixtures(self, *, name="python.exe", command="python watcher.py", sid=None):
        records = [self.record(10), self.record(30, name, command)]
        owners = [{"pid": 10, "name": "python.exe", "sid": self.sid},
                  {"pid": 30, "name": name, "sid": self.sid if sid is None else sid}]
        return records, owners

    def observe(self, records, owners, read=None, **kwargs):
        return observe_windows_authors(
            self.root, records, owners, kwargs.pop("exempt", {10}), read or Mock(return_value=r"C:\unrelated"),
            current_pid=10, read_identity=kwargs.pop("read_identity", Mock()),
            windows_directory=r"C:\Windows", read_image=kwargs.pop("read_image", Mock(return_value=r"C:\Windows\System32\svchost.exe")),
            **kwargs)

    def probe(self, owners):
        probe = Mock(windows_directory=r"C:\Windows")
        probe.operator_context = {"tokenElevated": False, "seDebugPrivilegeEnabled": False}
        probe.inventory.return_value = owners
        probe.cwd.return_value = r"C:\unrelated"
        probe.image.return_value = r"C:\Windows\System32\svchost.exe"
        return probe

    def scan(self, records, probe, *, enforce=False, exempt=None):
        with patch("deployment.legacy_authors.WindowsProcessProbe", return_value=probe), \
                patch("deployment.legacy_authors.os.getpid", return_value=10):
            return windows_active_authors(self.root, records, {10} if exempt is None else exempt,
                                          report_only=not enforce)

    def observation(self, report, pid):
        values = [item for item in report.observations if item.get("pid") == pid]
        self.assertTrue(values, f"No observation for PID {pid}")
        return values


class AuthorInventoryTests(AuthorFixture, unittest.TestCase):
    def test_relative_command_in_live_cwd_is_an_active_author(self):
        records, owners = self.fixtures()
        read = Mock(return_value=self.root + r"\apps\api")
        identity = Mock()
        report = self.observe(records, owners, read, read_identity=identity)
        self.assertEqual(report.authors, [{"pid": 30, "name": "python.exe"}])
        self.assertFalse(report.unknown)
        identity.assert_called_once_with(30, self.created + 3000)
        read.assert_called_once_with(30, self.created + 3000)

    def test_arbitrary_process_denied_cwd_is_unknown_even_with_unrelated_command(self):
        records, owners = self.fixtures(name="custom-tool.exe", command="custom-tool")
        report = self.observe(records, owners, Mock(side_effect=PermissionError("private detail must not leak")))
        self.assertEqual([item["pid"] for item in report.unknown], [30])
        self.assertNotIn("private detail", json.dumps(report.as_dict()))
        self.assertEqual(self.observe(records, owners, Mock(return_value=self.root)).authors,
                         [{"pid": 30, "name": "custom-tool.exe"}])

    def test_sid_is_not_required_to_detect_a_creation_checked_author(self):
        records, owners = self.fixtures(command="editor " + self.root + r"\file.py")
        owners[1]["sid"] = None
        identity = Mock()
        report = self.observe(records, owners, read_identity=identity)
        self.assertEqual(report.authors, [{"pid": 30, "name": "python.exe"}])
        self.assertFalse(report.unknown)
        identity.assert_called_once_with(30, self.created + 3000)

    def test_missing_sid_never_substitutes_for_command_cwd_or_lifetime(self):
        records, owners = self.fixtures()
        owners[1]["sid"] = None
        report = self.observe(records, owners)
        self.assertEqual([item["pid"] for item in report.unknown], [30])
        self.assertEqual(report.unknown[0]["stage"], "WTS.OwnerSid")
        self.assertEqual(report.unknown[0]["reason"], "owner_sid_unavailable")
        for missing in ("command", "cwd", "identity"):
            current = [dict(item) for item in records]
            kwargs = {}
            read = Mock(return_value=r"C:\outside")
            if missing == "command": current[1]["CommandLine"] = None
            if missing == "cwd": read.side_effect = PermissionError()
            if missing == "identity": kwargs["read_identity"] = Mock(side_effect=PermissionError())
            with self.subTest(missing=missing):
                self.assertEqual([item["pid"] for item in self.observe(current, owners, read, **kwargs).unknown], [30])

    def test_missing_changed_or_duplicate_identity_metadata_fails_closed(self):
        for case in ("record", "time", "name", "duplicate_owner", "duplicate_record"):
            records, owners = self.fixtures(name="custom.exe", command="custom")
            if case == "record": records.pop()
            if case == "time": records[1]["CreationTime"] = None
            if case == "name": owners[1]["name"] = "different.exe"
            if case == "duplicate_owner": owners.append(dict(owners[1]))
            if case == "duplicate_record": records.append(dict(records[1]))
            with self.subTest(case=case):
                try:
                    report = self.observe(records, owners)
                except Blocked:
                    continue
                self.assertTrue(report.unknown)

    def test_verified_system_role_has_full_image_and_lifetime_evidence(self):
        records, owners = self.fixtures(name="svchost.exe", command=None, sid="S-1-5-18")
        read = Mock(side_effect=PermissionError())
        identity, image = Mock(), Mock(return_value=r"C:\Windows\System32\svchost.exe")
        report = self.observe(records, owners, read, read_identity=identity, read_image=image)
        self.assertFalse(report.unknown)
        self.assertEqual(self.observation(report, 30)[0]["state"], "EXCLUDED")
        identity.assert_called_once_with(30, self.created + 3000)
        image.assert_called_once_with(30, self.created + 3000)
        read.assert_not_called()
        for sid, name in (("S-1-5-18", "python.exe"), (self.sid, "svchost.exe")):
            records, owners = self.fixtures(name=name, command=None, sid=sid)
            with self.subTest(sid=sid, name=name):
                self.assertTrue(self.observe(records, owners, read).unknown)

    def test_system_name_sid_or_path_alone_never_excludes_a_process(self):
        records, owners = self.fixtures(name="custom.exe", command=None, sid="S-1-5-18")
        for image in (r"C:\Program Files\Custom\custom.exe", r"C:\Windows\System32-foreign\custom.exe",
                      r"C:\Windows\System32\other.exe"):
            with self.subTest(image=image):
                self.assertTrue(self.observe(records, owners, read_image=Mock(return_value=image)).unknown)
        self.assertTrue(self.observe(records, owners, read_image=Mock(side_effect=PermissionError())).unknown)

    def test_cwd_boundary_and_extended_windows_path(self):
        records, owners = self.fixtures()
        self.assertFalse(self.observe(records, owners, Mock(return_value=self.root + "-neighbour")).authors)
        self.assertEqual(self.observe(records, owners, Mock(return_value="\\\\?\\" + self.root)).authors,
                         [{"pid": 30, "name": "python.exe"}])

    def test_only_proven_exit_is_excluded_not_access_denied_or_reused_pid(self):
        records, owners = self.fixtures()
        report = self.observe(records, owners, read_identity=Mock(side_effect=ProcessLookupError()))
        self.assertFalse(report.unknown)
        self.assertTrue(any("exit" in item["reason"] for item in self.observation(report, 30)))
        for problem in (PermissionError(), Blocked("LEGACY_AUTHORS", "PID reused", "Repeat read-only observation")):
            with self.subTest(problem=type(problem).__name__):
                self.assertEqual([item["pid"] for item in self.observe(records, owners, read_identity=Mock(side_effect=problem)).unknown], [30])

    def test_invocation_editor_ancestor_and_reused_ancestor_are_not_exempt(self):
        records, owners = self.fixtures(name="Code.exe", command="Code.exe " + self.root)
        self.assertEqual(self.observe(records, owners, exempt={10, 30}).authors, [{"pid": 30, "name": "Code.exe"}])
        report = self.observe(records, owners, exempt={10, 30}, read_identity=Mock(side_effect=PermissionError()))
        self.assertEqual([item["pid"] for item in report.unknown], [30])

    def test_missing_identity_probe_cannot_claim_a_verified_exclusion(self):
        records, owners = self.fixtures()
        self.assertTrue(self.observe(records, owners, read_identity=None).unknown)

    def test_error_identifies_requested_right_without_exposing_process_contents(self):
        records, owners = self.fixtures()
        error = WindowsProbeError(stage="OpenProcess", rights=0x1000, winerror=5, reason="identity_unavailable")
        report = self.observe(records, owners, read_identity=Mock(side_effect=error))
        observed = report.unknown[0]
        self.assertEqual(observed["stage"], "OpenProcess")
        self.assertEqual(observed["rights"], 0x1000)
        self.assertEqual(observed["winerror"], 5)
        self.assertEqual(str(observed["creationTime"]), records[1]["CreationTime"])
        encoded = json.dumps(report.as_dict())
        self.assertNotIn("watcher.py", encoded)
        self.assertNotIn(self.root, encoded)


class OperatorContextTests(unittest.TestCase):
    def fake_probe(self, enabled):
        probe = object.__new__(WindowsProcessProbe)
        probe.kernel, probe.advapi = Mock(), Mock()
        probe.kernel.GetCurrentProcess.return_value = 77
        def open_token(handle, rights, output):
            self.assertEqual(rights, 0x0008)
            output._obj.value = 88
            return 1
        def lookup(machine, name, output):
            self.assertIsNone(machine)
            self.assertEqual(name, "SeDebugPrivilege")
            output._obj.low, output._obj.high = 20, 0
            return 1
        def information(token, kind, output, size, required):
            if kind == 3:
                payload = struct.pack("<IIiI", 1, 20, 0, 2 if enabled else 0)
                required._obj.value = len(payload)
                if output is None: return 0
                ctypes.memmove(output, payload, len(payload))
                return 1
            self.assertEqual(kind, 20)
            output._obj.value = 1
            required._obj.value = ctypes.sizeof(output._obj)
            return 1
        probe.advapi.OpenProcessToken.side_effect = open_token
        probe.advapi.LookupPrivilegeValueW.side_effect = lookup
        probe.advapi.GetTokenInformation.side_effect = information
        return probe

    def test_enabled_debug_privilege_stops_without_adjusting_the_token(self):
        probe = self.fake_probe(True)
        with patch("deployment.legacy_authors.ctypes.get_last_error", return_value=122, create=True), \
                self.assertRaises(WindowsProbeError) as failure:
            probe.check_operator_privileges()
        self.assertEqual(failure.exception.reason, "debug_privilege_enabled")
        probe.advapi.AdjustTokenPrivileges.assert_not_called()
        probe.kernel.OpenProcess.assert_not_called()
        probe.kernel.CloseHandle.assert_called_once()

    def test_elevation_and_disabled_debug_are_reported_without_adjustment(self):
        probe = self.fake_probe(False)
        with patch("deployment.legacy_authors.ctypes.get_last_error", return_value=122, create=True):
            context = probe.check_operator_privileges()
        self.assertTrue(context["tokenElevated"])
        self.assertTrue(context["seDebugPrivilegePresent"])
        self.assertFalse(context["seDebugPrivilegeEnabled"])
        probe.advapi.AdjustTokenPrivileges.assert_not_called()
        probe.kernel.CloseHandle.assert_called_once()


class ProductionEntrypointTests(AuthorFixture, unittest.TestCase):
    def background(self):
        records = [self.record(10), self.record(20, "svchost.exe", None),
                   self.record(21, "RuntimeBroker.exe", "RuntimeBroker.exe"),
                   self.record(22, "explorer.exe", "explorer.exe"), self.record(23, "node.exe", "node worker.js")]
        owners = [{"pid": item["ProcessId"], "name": item["Name"],
                   "sid": "S-1-5-18" if item["ProcessId"] == 20 else self.sid} for item in records]
        return records, owners

    def test_full_production_entrypoint_classifies_a_mixed_windows_background(self):
        records, owners = self.background()
        probe = self.probe(owners)
        report = self.scan(records, probe)
        self.assertEqual({item["pid"] for item in report.observations}, {10, 20, 21, 22, 23})
        self.assertFalse(report.authors)
        self.assertFalse(report.unknown)
        self.assertEqual(self.scan(records, probe, enforce=True), [])
        self.assertGreaterEqual(probe.inventory.call_count, 4)
        self.assertTrue(all(item.get("reason") for item in report.observations))

    def test_unknown_background_does_not_mask_a_controlled_relative_author(self):
        records, owners = self.background()
        records += [self.record(30), self.record(31, "private.exe", None)]
        owners += [{"pid": 30, "name": "python.exe", "sid": self.sid}, {"pid": 31, "name": "private.exe", "sid": None}]
        probe = self.probe(owners)
        probe.cwd.side_effect = lambda pid, created: self.root if pid == 30 else r"C:\outside"
        def identity(pid, created):
            if pid == 31: raise WindowsProbeError(stage="OpenProcess", rights=0x1000, winerror=5)
        probe.identity.side_effect = identity
        with self.assertRaises(WindowsAuthorBlocked) as failure:
            self.scan(records, probe, enforce=True)
        report = failure.exception.report
        self.assertEqual(report.authors, [{"pid": 30, "name": "python.exe"}])
        self.assertEqual([item["pid"] for item in report.unknown], [31])
        self.assertIn("31", str(failure.exception))

    def test_parent_relative_and_normalized_absolute_arguments_detect_authors(self):
        cases = [
            (self.root, r"C:\Users\operator", r"notepad.exe .\ASA-lab\draft.txt"),
            (self.root, r"C:\Users\operator\neighbour", r"notepad.exe ..\ASA-lab\draft.txt"),
            (self.root, r"C:\Users\operator", r"notepad.exe C:\Users\operator\neighbour\..\ASA-lab\draft.txt"),
            (r"C:\Users\operator\ASA Lab", r"C:\Users\operator", 'notepad.exe ".\\ASA Lab\\draft file.txt"'),
        ]
        for root, cwd, command in cases:
            records, owners = self.background()
            records.append(self.record(30, "notepad.exe", command))
            owners.append({"pid": 30, "name": "notepad.exe", "sid": None})
            probe = self.probe(owners)
            probe.cwd.side_effect = lambda pid, created, directory=cwd: directory if pid == 30 else r"C:\outside"
            with self.subTest(command=command), patch.object(self, "root", root):
                report = self.scan(records, probe)
                self.assertIn(30, [item["pid"] for item in report.authors])

    def test_drive_relative_and_inline_shell_cannot_claim_unrelated_without_context(self):
        for name, command in (
                ("notepad.exe", r"notepad.exe C:ASA-lab\draft.txt"),
                ("notepad.exe", r"notepad.exe .\ASA-lab.\draft.txt"),
                ("notepad.exe", 'notepad.exe ".\\ASA-lab \\draft.txt"'),
                ("notepad.exe", r"notepad.exe \\.\C:\Users\operator\other\..\ASA-lab\draft.txt"),
                ("cmd.exe", r"cmd.exe /c cd .. & notepad ASA-lab\draft.txt"),
                ("powershell.exe", r"powershell.exe -Command Set-Location ..; notepad .\ASA-lab\draft.txt")):
            records, owners = self.background()
            records.append(self.record(30, name, command))
            owners.append({"pid": 30, "name": name, "sid": self.sid})
            probe = self.probe(owners)
            probe.cwd.return_value = r"D:\outside"
            with self.subTest(command=command):
                report = self.scan(records, probe)
                self.assertTrue(any(item.get("pid") == 30 for item in report.unknown) or
                                any(item["pid"] == 30 for item in report.authors))

    def test_slash_rooted_filename_with_equals_never_becomes_an_unrelated_option(self):
        for sid in (self.sid, None):
            records, owners = self.background()
            records.append(self.record(30, "python.exe", r"python.exe /Users/operator/ASA-lab/watcher=1.py"))
            owners.append({"pid": 30, "name": "python.exe", "sid": sid})
            probe = self.probe(owners)
            probe.cwd.return_value = r"C:\outside"
            with self.subTest(sid_available=sid is not None), self.assertRaises(WindowsAuthorBlocked) as failure:
                self.scan(records, probe, enforce=True)
            self.assertEqual([item["pid"] for item in failure.exception.report.unknown], [30])
            self.assertEqual(failure.exception.report.unknown[0]["reason"], "command_path_context_ambiguous")

    def test_missing_owner_with_only_lexical_outside_paths_remains_unknown(self):
        # A potential junction target is not observable in this fixture. There
        # is no canonical filesystem proof authorizing a new missing-SID exclusion.
        records, owners = self.background()
        records.append(self.record(30, "notepad.exe", r"notepad.exe C:\work\asa-link\draft.txt"))
        owners.append({"pid": 30, "name": "notepad.exe", "sid": None})
        probe = self.probe(owners)
        probe.cwd.return_value = r"C:\outside"
        with self.assertRaises(WindowsAuthorBlocked) as failure:
            self.scan(records, probe, enforce=True)
        self.assertEqual([item["pid"] for item in failure.exception.report.unknown], [30])
        self.assertEqual(failure.exception.report.unknown[0]["stage"], "WTS.OwnerSid")
        def exited(pid, created):
            if pid == 30:
                raise ProcessLookupError()
        probe.identity.side_effect = exited
        report = self.scan(records, probe)
        self.assertFalse(report.unknown)
        self.assertEqual(self.observation(report, 30)[0]["reason"], "confirmed_exited")

    def test_native_system_image_cannot_hide_relative_author_arguments(self):
        records, owners = self.background()
        records.append(self.record(30, "cscript.exe", r"cscript.exe .\ASA-lab\writer.js"))
        owners.append({"pid": 30, "name": "cscript.exe", "sid": "S-1-5-18"})
        for denied in (False, True):
            probe = self.probe(owners)
            probe.image.side_effect = lambda pid, created: r"C:\Windows\System32\cscript.exe" if pid == 30 else r"C:\Windows\System32\svchost.exe"
            def cwd(pid, created):
                if pid == 30:
                    if denied: raise PermissionError()
                    return r"C:\Users\operator"
                return r"C:\outside"
            probe.cwd.side_effect = cwd
            with self.subTest(denied=denied):
                report = self.scan(records, probe)
                self.assertTrue(any(item.get("pid") == 30 for item in report.unknown) or
                                any(item["pid"] == 30 for item in report.authors))

    def test_new_process_during_inventory_and_same_name_pid_reuse_block(self):
        records, owners = self.background()
        probe = self.probe(owners)
        probe.inventory.side_effect = [owners, owners + [{"pid": 50, "name": "python.exe", "sid": self.sid}]]
        with self.assertRaises(WindowsAuthorBlocked):
            self.scan(records, probe, enforce=True)
        probe = self.probe(owners)
        calls = {}
        def reused(pid, created):
            calls[pid] = calls.get(pid, 0) + 1
            if pid == 23 and calls[pid] > 1:
                raise WindowsProbeError(stage="GetProcessTimes", reason="pid_reused")
        probe.identity.side_effect = reused
        with self.assertRaises(WindowsAuthorBlocked) as failure:
            self.scan(records, probe, enforce=True)
        self.assertTrue(any(item.get("pid") == 23 for item in failure.exception.report.unknown))

    def test_cim_process_missing_from_wts_requires_confirmed_exit(self):
        records, owners = self.background()
        records.append(self.record(50))
        probe = self.probe(owners)
        with self.assertRaises(WindowsAuthorBlocked):
            self.scan(records, probe, enforce=True)
        probe.identity.side_effect = lambda pid, created: (_ for _ in ()).throw(ProcessLookupError()) if pid == 50 else None
        report = self.scan(records, probe)
        self.assertFalse(report.unknown)
        self.assertTrue(any(item.get("pid") == 50 and "exit" in item["reason"] for item in report.observations))

    def test_author_appearing_after_plan_stops_actual_apply_before_backup(self):
        from deployment import legacy
        from deployment.test_legacy_transition import TransitionOrderingTests
        records, owners = self.background()
        probe = self.probe(owners)
        self.assertEqual(self.scan(records, probe, enforce=True), [])
        records.append(self.record(30))
        owners.append({"pid": 30, "name": "python.exe", "sid": self.sid})
        probe.cwd.side_effect = lambda pid, created: self.root if pid == 30 else r"C:\outside"
        fixture = TransitionOrderingTests()
        with fixture.fixture() as (root, path, private, events, install):
            def revalidate(*args, **kwargs):
                authors = self.scan(records, probe, enforce=True)
                if authors: raise Blocked("LEGACY_AUTHOR", "New source author", "Save the active work first")
            install.revalidate.side_effect = revalidate
            with self.assertRaises(Blocked) as failure:
                legacy.apply_plan(root, path, output=private, database="legacy_test", object_sandbox=True)
            self.assertEqual(failure.exception.code, "LEGACY_AUTHOR")
            self.assertNotIn("full_backup", events)
            self.assertNotIn("source_switch", events)
            self.assertNotIn("live_migration", events)


@unittest.skipUnless(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8, "Real Windows x64 process APIs are required")
class NativeWindowsAuthorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            WindowsProcessProbe()
        except WindowsProbeError as failure:
            if failure.reason == "debug_privilege_enabled":
                raise unittest.SkipTest("Runner debug privilege is enabled; full native suite runs in a restricted disposable child")
            raise

    def records(self):
        output = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", CIM_PROCESS_SCRIPT],
                                capture_output=True, text=True, encoding="utf-8", check=True, timeout=60)
        value = json.loads(output.stdout)
        return value if isinstance(value, list) else [value]

    def full_scan(self, root, records=None):
        probe = WindowsProcessProbe()
        native_inventory = probe.inventory
        snapshots = []
        def inventory():
            observed = native_inventory()
            snapshots.append(observed)
            return observed
        # Instrument the complete native inventory; never select only our PIDs.
        with patch("deployment.legacy_authors.WindowsProcessProbe", return_value=probe), \
                patch.object(probe, "inventory", side_effect=inventory):
            report = windows_active_authors(root, records, {os.getpid()}, report_only=True)
        self.assertGreaterEqual(len(snapshots), 2)
        self.assertGreater(len(snapshots[0]), 2)
        self.assertTrue({item["pid"] for item in snapshots[0]}.issubset(
            {item["pid"] for item in report.observations}))
        self.assertTrue(all(item.get("reason") and item["state"] in {"AUTHOR", "EXCLUDED", "UNKNOWN"}
                            for item in report.observations))
        return report

    def test_real_full_background_has_a_justified_result_in_current_operator_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            report = self.full_scan(root)
            # BLOCKED is an honest qualified collector outcome, not deployment PASS.
            print("WINDOWS_FULL_BACKGROUND=" + json.dumps({
                "observations": len(report.observations), "authors": len(report.authors),
                "unknown": len(report.unknown), "installationAllowed": not (report.authors or report.unknown)}))
            self.assertTrue(report.observations)

    def test_real_relative_author_is_found_among_full_native_background(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "watcher.py").write_text("import sys\nprint('ready', flush=True)\nsys.stdin.read()\n", encoding="utf-8")
            child = subprocess.Popen([sys.executable, "watcher.py"], cwd=root, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                records = self.records()
                record = next(value for value in records if value["ProcessId"] == child.pid)
                self.assertNotIn(str(root), record["CommandLine"])
                report = self.full_scan(root)
                self.assertIn(child.pid, [value["pid"] for value in report.authors])
                probe = WindowsProcessProbe()
                self.assertEqual(ntpath.normcase(probe.cwd(child.pid, int(record["CreationTime"]))), ntpath.normcase(str(root)))
                with self.assertRaises(Blocked):
                    probe.identity(child.pid, int(record["CreationTime"]) - 10000000)
                try:
                    authors = windows_active_authors(root, self.records(), {os.getpid()})
                except WindowsAuthorBlocked as failure:
                    self.assertIn(child.pid, [value["pid"] for value in failure.report.authors])
                else:
                    self.assertIn(child.pid, [value["pid"] for value in authors])
            finally:
                child.communicate("", timeout=10)
                self.assertEqual(child.returncode, 0)

    def test_real_exited_process_is_reidentified_without_losing_background(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            child = subprocess.Popen([sys.executable, "-c", "import sys;print('ready',flush=True);sys.stdin.read()"],
                                     cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                records = self.records()
            finally:
                child.communicate("", timeout=10)
            report = self.full_scan(root, records)
            self.assertNotIn(child.pid, [value["pid"] for value in report.authors])
            self.assertTrue(any(item.get("pid") == child.pid and "exit" in item.get("reason", "")
                                for item in report.observations))

    def test_real_parent_directory_relative_argument_is_an_author(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory).resolve()
            root = parent / "ASA Lab"
            root.mkdir()
            (root / "watcher.py").write_text("import sys\nprint('ready', flush=True)\nsys.stdin.read()\n", encoding="utf-8")
            child = subprocess.Popen([sys.executable, r"ASA Lab\watcher.py"], cwd=parent, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                records = self.records()
                record = next(item for item in records if item["ProcessId"] == child.pid)
                self.assertNotIn(str(root), record["CommandLine"])
                report = self.full_scan(root)
                self.assertIn(child.pid, [item["pid"] for item in report.authors])
            finally:
                child.communicate("", timeout=10)
                self.assertEqual(child.returncode, 0)

    def test_real_read_only_diagnostic_cli_uses_full_collector(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, "-B", "-m", "deployment.legacy_authors", "--root", str(Path(directory).resolve()), "--diagnose"],
                cwd=Path(__file__).resolve().parents[1], capture_output=True, encoding="utf-8", timeout=90)
            self.assertIn(result.returncode, (0, 2), result.stderr)
            report = json.loads(result.stdout)
            self.assertGreater(len(report["observations"]), 2)
            self.assertFalse(report["operatorContext"]["seDebugPrivilegeEnabled"])
            self.assertEqual(result.returncode == 0, report["status"] == "CLEAR")
            self.assertFalse(any(key in item for item in report["observations"] for key in ("CommandLine", "cwd", "image")))


def remove_debug_privilege_from_test_child():
    """Only the disposable CI child calls this; removal cannot enable a privilege.

    GitHub's Windows runner may begin with SeDebugPrivilege enabled. Production
    refuses that context. Remove this one privilege from this child's own token
    before running the unchanged production entrypoint; never alter the parent,
    impersonate an account, change an ACL or restore/enable the privilege.
    """
    from ctypes import wintypes
    class Luid(ctypes.Structure):
        _fields_ = [("low", wintypes.DWORD), ("high", wintypes.LONG)]
    class LuidAttributes(ctypes.Structure):
        _fields_ = [("luid", Luid), ("attributes", wintypes.DWORD)]
    class TokenPrivileges(ctypes.Structure):
        _fields_ = [("count", wintypes.DWORD), ("privileges", LuidAttributes * 1)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel.GetCurrentProcess.argtypes = []
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi.OpenProcessToken.restype = wintypes.BOOL
    advapi.LookupPrivilegeValueW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(Luid)]
    advapi.LookupPrivilegeValueW.restype = wintypes.BOOL
    advapi.AdjustTokenPrivileges.argtypes = [wintypes.HANDLE, wintypes.BOOL, ctypes.POINTER(TokenPrivileges),
                                            wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
    advapi.AdjustTokenPrivileges.restype = wintypes.BOOL
    token = wintypes.HANDLE()
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 0x0008 | 0x0020, ctypes.byref(token)):
        raise OSError("Cannot open the disposable test child's token")
    try:
        state = TokenPrivileges()
        state.count = 1
        if not advapi.LookupPrivilegeValueW(None, "SeDebugPrivilege", ctypes.byref(state.privileges[0].luid)):
            raise OSError("Cannot identify the debug privilege in the test child")
        state.privileges[0].attributes = 0x00000004  # SE_PRIVILEGE_REMOVED, never ENABLED.
        ctypes.set_last_error(0)
        if not advapi.AdjustTokenPrivileges(token, False, ctypes.byref(state), 0, None, None) or ctypes.get_last_error() != 0:
            raise OSError("Cannot remove debug privilege from the disposable test child")
    finally:
        kernel.CloseHandle(token)
    context = WindowsProcessProbe().operator_context
    if context["seDebugPrivilegePresent"] or context["seDebugPrivilegeEnabled"]:
        raise AssertionError("Disposable test child still has debug privilege")


@unittest.skipUnless(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8, "Real Windows x64 process APIs are required")
class NativeWindowsRestrictedRunnerTests(unittest.TestCase):
    def test_full_native_suite_uses_current_or_restricted_child_context(self):
        try:
            probe = WindowsProcessProbe()
        except WindowsProbeError as failure:
            self.assertEqual(failure.reason, "debug_privilege_enabled")
            result = subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()), "--native-child"],
                                    capture_output=True, text=True, encoding="utf-8", timeout=150)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            expected = unittest.defaultTestLoader.loadTestsFromTestCase(NativeWindowsAuthorTests).countTestCases()
            self.assertIn(f"Ran {expected} tests", result.stderr)
            self.assertNotIn("skipped", result.stderr)
            self.assertIn("WINDOWS_FULL_BACKGROUND=", result.stdout)
            with self.assertRaises(WindowsProbeError) as parent:
                WindowsProcessProbe()
            self.assertEqual(parent.exception.reason, "debug_privilege_enabled")
            print("WINDOWS_RESTRICTED_CHILD=" + result.stdout.strip())
            print(result.stderr.strip())
        else:
            self.assertFalse(probe.operator_context["seDebugPrivilegeEnabled"])


if __name__ == "__main__":
    if sys.argv[1:] == ["--native-child"]:
        remove_debug_privilege_from_test_child()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(NativeWindowsAuthorTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(0 if result.wasSuccessful() else 1)
    unittest.main()

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
from deployment.legacy_authors import (CIM_PROCESS_SCRIPT, WindowsProcessProbe, find_windows_authors,
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


class AuthorInventoryTests(unittest.TestCase):
    root = r"C:\Users\operator\ASA-lab"
    sid = "S-1-5-21-1-2-3-1001"

    def fixtures(self, *, name="python.exe", command="python watcher.py", sid=None):
        records = [{"ProcessId": 30, "ParentProcessId": 10, "Name": name,
                    "CommandLine": command, "CreationTime": "134000000000000000"}]
        owners = [{"pid": 10, "name": "python.exe", "sid": self.sid},
                  {"pid": 30, "name": name, "sid": self.sid if sid is None else sid}]
        return records, owners

    def check(self, records, owners, read, exempt=None):
        return find_windows_authors(self.root, records, owners, {10} if exempt is None else exempt,
                                    read, current_pid=10, windows_directory=r"C:\Windows",
                                    read_image=lambda pid, created: ntpath.join(r"C:\Windows\System32", owners[1]["name"]))

    def test_relative_command_in_live_cwd_is_an_active_author(self):
        records, owners = self.fixtures()
        read = Mock(return_value=self.root + r"\apps\api")
        self.assertEqual(self.check(records, owners, read), [{"pid": 30, "name": "python.exe"}])
        read.assert_called_once_with(30, 134000000000000000)

    def test_arbitrarily_named_same_user_process_is_also_checked(self):
        records, owners = self.fixtures(name="custom-tool.exe", command="custom-tool")
        with self.assertRaises(Blocked):
            self.check(records, owners, Mock(side_effect=PermissionError("private process")))
        self.assertEqual(self.check(records, owners, Mock(return_value=self.root)),
                         [{"pid": 30, "name": "custom-tool.exe"}])

    def test_unknown_sid_missing_command_and_new_process_fail_closed(self):
        for case in ("sid", "command", "record", "time", "name"):
            records, owners = self.fixtures(name="custom.exe", command="custom")
            if case == "sid": owners[1]["sid"] = None
            if case == "command": records[0]["CommandLine"] = None
            if case == "record": records.clear()
            if case == "time": records[0]["CreationTime"] = None
            if case == "name": owners[1]["name"] = "different.exe"
            with self.subTest(case=case), self.assertRaises(Blocked):
                self.check(records, owners, Mock(return_value=r"C:\unrelated"))

    def test_system_owner_exemption_does_not_apply_to_writer_or_same_user(self):
        read = Mock(side_effect=PermissionError())
        records, owners = self.fixtures(name="svchost.exe", command=None, sid="S-1-5-18")
        self.assertEqual(self.check(records, owners, read), [])
        read.assert_not_called()
        for sid, name in (("S-1-5-18", "python.exe"), (self.sid, "svchost.exe")):
            records, owners = self.fixtures(name=name, command=None, sid=sid)
            with self.subTest(sid=sid, name=name), self.assertRaises(Blocked):
                self.check(records, owners, read)

    def test_root_in_command_and_boundary_of_unrelated_cwd(self):
        records, owners = self.fixtures(command="editor " + self.root + r"\file.py")
        read = Mock()
        self.assertEqual(self.check(records, owners, read), [{"pid": 30, "name": "python.exe"}])
        read.assert_not_called()
        records, owners = self.fixtures()
        self.assertEqual(self.check(records, owners, Mock(return_value=self.root + "-neighbour")), [])
        self.assertEqual(self.check(records, owners, Mock(return_value="\\\\?\\" + self.root)),
                         [{"pid": 30, "name": "python.exe"}])

    def test_system_sid_with_custom_or_unverified_executable_does_not_exempt_author(self):
        records, owners = self.fixtures(name="custom.exe", command=None, sid="S-1-5-18")
        for image in (r"C:\Program Files\Custom\custom.exe", r"C:\Windows\System32-foreign\custom.exe",
                      r"C:\Windows\System32\other.exe"):
            with self.subTest(image=image), self.assertRaises(Blocked):
                find_windows_authors(self.root, records, owners, {10}, Mock(), current_pid=10,
                                     windows_directory=r"C:\Windows", read_image=Mock(return_value=image))
        with self.assertRaises(Blocked):
            find_windows_authors(self.root, records, owners, {10}, Mock(), current_pid=10,
                                 windows_directory=r"C:\Windows", read_image=Mock(side_effect=PermissionError()))

    def test_only_confirmed_exited_process_or_invocation_ancestor_is_exempt(self):
        records, owners = self.fixtures()
        self.assertEqual(self.check(records, owners, Mock(side_effect=ProcessLookupError())), [])
        read = Mock(side_effect=PermissionError())
        self.assertEqual(self.check(records, owners, read, {10, 30}), [])
        read.assert_not_called()
        with self.assertRaises(Blocked):
            self.check(records, owners, Mock(side_effect=PermissionError()))

    def test_unverified_current_operator_and_unsupported_manager_fail_closed(self):
        records, owners = self.fixtures()
        owners[0]["sid"] = None
        with self.assertRaises(Blocked):
            self.check(records, owners, Mock())
        with patch("deployment.legacy_authors.ctypes.sizeof", return_value=4), self.assertRaises(Blocked):
            WindowsProcessProbe()


@unittest.skipUnless(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8, "Real Windows x64 process APIs are required")
class NativeWindowsAuthorTests(unittest.TestCase):
    def test_real_relative_child_directory_and_owner_are_observed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "watcher.py").write_text("import sys\nprint('ready', flush=True)\nsys.stdin.read()\n", encoding="utf-8")
            child = subprocess.Popen([sys.executable, "watcher.py"], cwd=root, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                output = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", CIM_PROCESS_SCRIPT],
                                        capture_output=True, text=True, encoding="utf-8", check=True)
                records = json.loads(output.stdout)
                if isinstance(records, dict): records = [records]
                record = next(value for value in records if value["ProcessId"] == child.pid)
                self.assertNotIn(str(root), record["CommandLine"])
                probe = WindowsProcessProbe()
                owners = [value for value in probe.inventory() if value["pid"] in (os.getpid(), child.pid)]
                self.assertEqual(len(owners), 2)
                self.assertEqual(owners[0]["sid"], owners[1]["sid"])
                observed = probe.cwd(child.pid, int(record["CreationTime"]))
                self.assertEqual(ntpath.normcase(observed), ntpath.normcase(str(root)))
                self.assertEqual(ntpath.normcase(probe.image(child.pid, int(record["CreationTime"]))), ntpath.normcase(sys.executable))
                found = find_windows_authors(root, [record], owners, {os.getpid()}, probe.cwd, current_pid=os.getpid())
                self.assertEqual([value["pid"] for value in found], [child.pid])
                with self.assertRaises(Blocked):
                    probe.cwd(child.pid, int(record["CreationTime"]) - 10000000)
            finally:
                child.communicate("", timeout=10)
                self.assertEqual(child.returncode, 0)


if __name__ == "__main__":
    unittest.main()

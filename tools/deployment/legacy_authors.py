"""Read-only Windows author attestation for the bounded legacy transition.

No privileges are enabled and no process is changed. WTS supplies user SIDs in
one native enumeration. Only the PEB process-parameters pointer and the bounded
CurrentDirectory field are read from another process; environment blocks and
arbitrary process memory are never collected or persisted.
"""

import ctypes
from ctypes import wintypes
import ntpath
import os
from pathlib import Path
import platform
import re
import struct

from .contracts import Blocked, require


CIM_PROCESS_SCRIPT = (
    "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);"
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{"
    "ProcessId=$_.ProcessId;ParentProcessId=$_.ParentProcessId;Name=$_.Name;"
    "CommandLine=$_.CommandLine;CreationTime=$(if ($_.CreationDate) {"
    "[string]($_.CreationDate.ToFileTimeUtc()) } else { $null })"
    "} } | ConvertTo-Json -Compress"
)
AUTHOR_NAME = re.compile(
    r"^(?:python(?:w|[0-9.]*)?|node|nodejs|deno|bun|ruby|perl|php|java|dotnet|"
    r"powershell|pwsh|cmd|bash|sh|wsl|git|codex|claude|code(?: - insiders)?|"
    r"cursor|windsurf|notepad(?:\+\+)?|sublime_text|vim|nvim|emacs|devenv)\.exe$", re.I)
MAX_CWD_BYTES = 65532


def author_unknown():
    return Blocked("LEGACY_AUTHORS", "A process author identity or current directory cannot be verified.",
                   "Inspect the active author/process and retry read-only planning; do not change privileges or stop it automatically.")


def read_peb_cwd(read, peb, pointer_size):
    """Decode only the native/WOW64 CurrentDirectory fields, with race checks.

    The Windows native layout is also used by psutil's Windows cwd reader.
    Unsupported layouts/reads fail closed rather than treating cwd as absent.
    """
    require(pointer_size in (4, 8), "LEGACY_AUTHORS", "Unsupported Windows process pointer width.")
    pointer_format = "<Q" if pointer_size == 8 else "<I"
    pointer_offset, directory_offset = (0x20, 0x38) if pointer_size == 8 else (0x10, 0x24)
    descriptor_size = 16 if pointer_size == 8 else 8
    def bounded(address, size):
        require(isinstance(address, int) and address >= 0x10000 and 0 < size <= MAX_CWD_BYTES
                and address + size < 1 << (pointer_size * 8),
                "LEGACY_AUTHORS", "Invalid Windows current-directory pointer or length.")
        data = read(address, size)
        require(isinstance(data, bytes) and len(data) == size,
                "LEGACY_AUTHORS", "Incomplete Windows current-directory observation.")
        return data
    parameters_raw = bounded(peb + pointer_offset, pointer_size)
    parameters = struct.unpack(pointer_format, parameters_raw)[0]
    flags = struct.unpack("<I", bounded(parameters + 8, 4))[0]
    require(flags & 1, "LEGACY_AUTHORS", "Windows process parameters are not initialized.")
    descriptor = bounded(parameters + directory_offset, descriptor_size)
    length, maximum, address = struct.unpack("<HH4xQ" if pointer_size == 8 else "<HHI", descriptor)
    require(0 < length <= maximum <= MAX_CWD_BYTES + 2 and length <= MAX_CWD_BYTES
            and length % 2 == maximum % 2 == 0,
            "LEGACY_AUTHORS", "Invalid Windows current-directory string.")
    value = bounded(address, length)
    require(descriptor == bounded(parameters + directory_offset, descriptor_size)
            and parameters_raw == bounded(peb + pointer_offset, pointer_size)
            and value == bounded(address, length),
            "LEGACY_AUTHORS", "A process changed directory during author attestation.")
    try:
        directory = value.decode("utf-16-le", "strict")
    except UnicodeError as exc:
        raise author_unknown() from exc
    require("\0" not in directory and ntpath.isabs(directory) and ntpath.splitdrive(directory)[0],
            "LEGACY_AUTHORS", "Windows current directory is not an absolute path.")
    return ntpath.normpath(directory)


def system_sid(sid):
    return sid in ("S-1-5-18", "S-1-5-19", "S-1-5-20") or sid.startswith(("S-1-5-90-", "S-1-5-96-"))


def normalized_windows_directory(value):
    path = ntpath.normcase(ntpath.normpath(str(value)))
    if path.startswith("\\\\?\\unc\\"):
        return "\\\\" + path[8:]
    if path.startswith("\\\\?\\") and re.match(r"[a-z]:\\", path[4:]):
        return path[4:]
    return path


def find_windows_authors(root, records, owners, exempt, read_cwd, *, current_pid,
                         read_image=None, windows_directory=None):
    """Join CIM metadata to authoritative WTS SIDs; unknown authors never pass."""
    processes = {int(value["ProcessId"]): value for value in records}
    identities = {int(value["pid"]): value for value in owners}
    require(len(processes) == len(records) and len(identities) == len(owners)
            and current_pid in identities and identities[current_pid].get("sid"),
            "LEGACY_AUTHORS", "Windows process identity inventory is incomplete.")
    operator_sid = identities[current_pid]["sid"]
    protected = normalized_windows_directory(root)
    found = []
    for pid, identity in identities.items():
        if pid in exempt or pid in (0, 4):  # Windows idle/kernel processes have no user cwd.
            continue
        name, sid = identity.get("name", ""), identity.get("sid")
        require(isinstance(sid, str) and sid, "LEGACY_AUTHORS", "A process owner SID cannot be verified.")
        record = processes.get(pid)
        command = record.get("CommandLine") if record else None
        if isinstance(command, str) and protected in ntpath.normcase(command):
            found.append({"pid": pid, "name": name})
            continue
        require(record and record.get("Name", "").casefold() == name.casefold()
                and str(record.get("CreationTime", "")).isdigit(),
                "LEGACY_AUTHORS", "A process has missing or changed identity metadata.")
        # SID alone is insufficient: custom services also run as SYSTEM. Only
        # an observed native Windows system executable may omit a cwd probe.
        # A known interpreter/editor still requires one even under System32.
        if sid != operator_sid and system_sid(sid) and not AUTHOR_NAME.fullmatch(name):
            require(read_image and windows_directory, "LEGACY_AUTHORS", "System executable identity is unavailable.")
            try:
                executable = normalized_windows_directory(read_image(pid, int(record["CreationTime"])))
            except ProcessLookupError:
                continue
            except (OSError, ValueError) as exc:
                raise author_unknown() from exc
            directories = [normalized_windows_directory(ntpath.join(windows_directory, name)) for name in ("System32", "SysWOW64")]
            if ntpath.basename(executable) == name.casefold() and any(executable.startswith(path + "\\") for path in directories):
                continue
        require(isinstance(command, str) and command.strip(),
                "LEGACY_AUTHORS", "An author process has missing or changed metadata.")
        try:
            cwd = normalized_windows_directory(read_cwd(pid, int(record["CreationTime"])))
        except ProcessLookupError:
            continue  # A confirmed exited process cannot still write source files.
        except (OSError, ValueError) as exc:
            raise author_unknown() from exc
        if cwd == protected or cwd.startswith(protected + "\\"):
            found.append({"pid": pid, "name": name})
    return found


class WindowsProcessProbe:
    """Native APIs with bounded buffers and query/read rights only."""

    def __init__(self):
        require(os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8
                and platform.machine().casefold() in ("amd64", "x86_64"),
                "LEGACY_AUTHORS", "Legacy Windows author attestation requires 64-bit x86 Python.")
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        self.ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
        self.wts = ctypes.WinDLL("wtsapi32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.GetExitCodeProcess.restype = wintypes.BOOL
        self.kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)]
        self.kernel.GetProcessTimes.restype = wintypes.BOOL
        self.kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                           ctypes.POINTER(wintypes.DWORD)]
        self.kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.kernel.GetWindowsDirectoryW.argtypes = [wintypes.LPWSTR, wintypes.UINT]
        self.kernel.GetWindowsDirectoryW.restype = wintypes.UINT
        directory = ctypes.create_unicode_buffer(32768)
        length = self.kernel.GetWindowsDirectoryW(directory, len(directory))
        require(0 < length < len(directory) and ntpath.isabs(directory.value),
                "LEGACY_AUTHORS", "Cannot verify the native Windows system directory.")
        self.windows_directory = directory.value
        self.kernel.ReadProcessMemory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                                  ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]
        self.kernel.ReadProcessMemory.restype = wintypes.BOOL
        self.ntdll.NtQueryInformationProcess.argtypes = [wintypes.HANDLE, wintypes.ULONG, ctypes.c_void_p,
                                                        wintypes.ULONG, ctypes.POINTER(wintypes.ULONG)]
        self.ntdll.NtQueryInformationProcess.restype = wintypes.LONG
        self.advapi.IsValidSid.argtypes = [ctypes.c_void_p]
        self.advapi.IsValidSid.restype = wintypes.BOOL
        self.advapi.GetLengthSid.argtypes = [ctypes.c_void_p]
        self.advapi.GetLengthSid.restype = wintypes.DWORD

    def inventory(self):
        class ProcessInfo(ctypes.Structure):
            _fields_ = [("session", wintypes.DWORD), ("pid", wintypes.DWORD),
                        ("name", wintypes.LPWSTR), ("sid", ctypes.c_void_p)]
        values = ctypes.POINTER(ProcessInfo)()
        count = wintypes.DWORD()
        self.wts.WTSEnumerateProcessesW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                                                  ctypes.POINTER(ctypes.POINTER(ProcessInfo)), ctypes.POINTER(wintypes.DWORD)]
        self.wts.WTSEnumerateProcessesW.restype = wintypes.BOOL
        self.wts.WTSFreeMemory.argtypes = [ctypes.c_void_p]
        self.wts.WTSFreeMemory.restype = None
        require(self.wts.WTSEnumerateProcessesW(None, 0, 1, ctypes.byref(values), ctypes.byref(count)),
                "LEGACY_AUTHORS", "Cannot enumerate Windows process owners without changing privileges.")
        try:
            require(0 < count.value <= 100000, "LEGACY_AUTHORS", "Invalid Windows process inventory size.")
            result = []
            for index in range(count.value):
                value = values[index]
                sid = None
                if value.sid:
                    require(self.advapi.IsValidSid(value.sid), "LEGACY_AUTHORS", "Invalid process owner SID.")
                    size = self.advapi.GetLengthSid(value.sid)
                    require(8 <= size <= 68, "LEGACY_AUTHORS", "Invalid process owner SID size.")
                    raw = ctypes.string_at(value.sid, size)
                    require(size == 8 + 4 * raw[1], "LEGACY_AUTHORS", "Invalid process owner SID layout.")
                    sid = "S-" + str(raw[0]) + "-" + str(int.from_bytes(raw[2:8], "big"))
                    sid += "".join("-" + str(struct.unpack_from("<I", raw, offset)[0]) for offset in range(8, size, 4))
                result.append({"pid": value.pid, "name": value.name or "", "sid": sid})
            return result
        finally:
            self.wts.WTSFreeMemory(values)

    def check_creation(self, handle, creation_time):
        times = [wintypes.FILETIME() for _ in range(4)]
        require(self.kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)),
                "LEGACY_AUTHORS", "Cannot verify process creation time.")
        actual_created = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        # CIM dates have microsecond precision; FILETIME uses 100 ns ticks.
        require(actual_created // 10 == creation_time // 10,
                "LEGACY_AUTHORS", "A process ID was reused after the author inventory.")

    def image(self, pid, creation_time):
        handle = self.kernel.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not handle:
            if ctypes.get_last_error() == 87:
                raise ProcessLookupError(pid)
            raise author_unknown()
        try:
            self.check_creation(handle, creation_time)
            value = ctypes.create_unicode_buffer(32768)
            length = wintypes.DWORD(len(value))
            require(self.kernel.QueryFullProcessImageNameW(handle, 0, value, ctypes.byref(length))
                    and 0 < length.value < len(value) and ntpath.isabs(value.value),
                    "LEGACY_AUTHORS", "Cannot attest the executable of a system-owned process.")
            return value.value
        finally:
            self.kernel.CloseHandle(handle)

    def cwd(self, pid, creation_time):
        require(type(pid) is int and pid > 4 and type(creation_time) is int and creation_time > 0,
                "LEGACY_AUTHORS", "Invalid process identity for author attestation.")
        handle = self.kernel.OpenProcess(0x0400 | 0x0010, False, pid)  # QUERY_INFORMATION | VM_READ
        if not handle:
            if ctypes.get_last_error() == 87:  # PID no longer exists.
                raise ProcessLookupError(pid)
            raise author_unknown()
        try:
            def still_alive():
                code = wintypes.DWORD()
                require(self.kernel.GetExitCodeProcess(handle, ctypes.byref(code)),
                        "LEGACY_AUTHORS", "Cannot check process lifetime during author attestation.")
                if code.value != 259:
                    raise ProcessLookupError(pid)
            still_alive()
            self.check_creation(handle, creation_time)
            returned = wintypes.ULONG()
            wow64 = ctypes.c_size_t()
            require(self.ntdll.NtQueryInformationProcess(handle, 26, ctypes.byref(wow64),
                    ctypes.sizeof(wow64), ctypes.byref(returned)) >= 0,
                    "LEGACY_AUTHORS", "Cannot verify Windows process pointer width.")
            if wow64.value:
                peb, width = wow64.value, 4
            else:
                basic = ctypes.create_string_buffer(48)
                require(self.ntdll.NtQueryInformationProcess(handle, 0, basic, len(basic), ctypes.byref(returned)) >= 0,
                        "LEGACY_AUTHORS", "Cannot locate Windows process parameters.")
                peb, width = struct.unpack_from("<Q", basic.raw, 8)[0], 8
            def read(address, size):
                buffer, received = ctypes.create_string_buffer(size), ctypes.c_size_t()
                if not self.kernel.ReadProcessMemory(handle, address, buffer, size, ctypes.byref(received)):
                    still_alive()
                    raise author_unknown()
                require(received.value == size, "LEGACY_AUTHORS", "Incomplete Windows process-directory read.")
                return buffer.raw
            directory = read_peb_cwd(read, peb, width)
            still_alive()
            resolved = Path(directory).resolve(strict=True)
            require(resolved.is_dir(), "LEGACY_AUTHORS", "The observed process current directory is not a directory.")
            return str(resolved)
        finally:
            self.kernel.CloseHandle(handle)


def windows_active_authors(root, records, exempt):
    probe = WindowsProcessProbe()
    return find_windows_authors(root, records, probe.inventory(), exempt, probe.cwd, current_pid=os.getpid(),
                                read_image=probe.image, windows_directory=probe.windows_directory)

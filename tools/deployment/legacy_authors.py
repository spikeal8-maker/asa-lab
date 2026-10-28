"""Read-only Windows author attestation for the bounded legacy transition.

No privileges are enabled and no process is changed. WTS supplies process
identities; missing owner information is never an exclusion. Only the PEB
process-parameters pointer and the bounded CurrentDirectory field are read from another process; environment blocks and
arbitrary process memory are never collected or persisted.
"""

import argparse
import ctypes
from ctypes import wintypes
import json
import ntpath
import os
from pathlib import Path
import platform
import re
import struct
import subprocess

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
    r"powershell|pwsh|cmd|bash|sh|wsl|mshta|cscript|wscript|git|codex|claude|code(?: - insiders)?|"
    r"cursor|windsurf|notepad(?:\+\+)?|sublime_text|vim|nvim|emacs|devenv)\.exe$", re.I)
MAX_CWD_BYTES = 65532
QUERY_LIMITED_INFORMATION = 0x1000
QUERY_DIRECTORY = 0x0400 | 0x0010
TOKEN_QUERY = 0x0008


class WindowsProbeError(Blocked):
    """Safe API diagnostics, without paths, command lines or exception text."""

    def __init__(self, stage, rights=None, winerror=None, reason="observation_unavailable", ntstatus=None):
        super().__init__("LEGACY_AUTHORS", "A required Windows author observation is unavailable.",
                         "Run the reviewed read-only author diagnosis; do not change privileges or stop unknown processes.")
        self.stage, self.rights, self.winerror = stage, rights, winerror
        self.reason, self.ntstatus = reason, ntstatus


class WindowsAuthorReport:
    def __init__(self, observations=()):
        self.observations = list(observations)
        self.operator_context = {}

    @property
    def authors(self):
        return [{"pid": item["pid"], "name": item["name"]} for item in self.observations if item["state"] == "AUTHOR"]

    @property
    def unknown(self):
        return [item for item in self.observations if item["state"] == "UNKNOWN"]

    def as_dict(self):
        counts = {state: sum(item["state"] == state for item in self.observations)
                  for state in ("AUTHOR", "EXCLUDED", "UNKNOWN")}
        return {"status": "BLOCKED" if counts["AUTHOR"] or counts["UNKNOWN"] else "CLEAR",
                "counts": counts, "observations": self.observations, "authors": self.authors,
                "unknown": self.unknown, "operatorContext": self.operator_context}


class WindowsAuthorBlocked(Blocked):
    def __init__(self, report):
        unknown = report.unknown
        first = unknown[0] if unknown else {}
        detail = (f" First unknown PID={first.get('pid')}, stage={first.get('stage')}, "
                  f"rights={first.get('rights')}, winerror={first.get('winerror')}.") if first else ""
        super().__init__("LEGACY_AUTHORS", f"Windows author check has {len(unknown)} unknown observations "
                         f"and {len(report.authors)} related processes." + detail,
                         "Run the reviewed manager's read-only author diagnostic for this installation; "
                         "unknown observations block changes. Do not enable privileges or stop unknown processes.")
        self.report = report


def _observation(pid, name, created, state, reason):
    # Only the basename is diagnostic. No command, cwd, image or owner SID is persisted.
    name = ntpath.basename(name) if isinstance(name, str) else ""
    name = re.sub(r"[\x00-\x1f\x7f]", "?", name)[:260]
    return {"pid": pid, "name": name, "creationTime": str(created) if created is not None else None,
            "state": state, "reason": reason}


def _unknown(item, failure=None, *, stage="metadata", reason="metadata_unavailable"):
    item.update(state="UNKNOWN", reason=reason, stage=stage)
    if isinstance(failure, WindowsProbeError):
        item.update(reason=failure.reason, stage=failure.stage)
        for key in ("rights", "winerror", "ntstatus"):
            value = getattr(failure, key)
            if isinstance(value, int):
                item[key] = value
    elif isinstance(failure, OSError):
        # Never format failure: an OSError may embed private command lines or paths.
        value = getattr(failure, "winerror", None)
        if isinstance(value, int):
            item["winerror"] = value
    return item


def _index(values, key):
    if not isinstance(values, list) or len(values) > 100000:
        raise WindowsProbeError("inventory", reason="invalid_inventory")
    result = {}
    for value in values:
        if not isinstance(value, dict) or type(value.get(key)) is not int or not 0 <= value[key] <= 0xFFFFFFFF:
            raise WindowsProbeError("inventory", reason="invalid_process_id")
        if value[key] in result:
            raise WindowsProbeError("inventory", reason="duplicate_process_id")
        result[value[key]] = value
    return result


def _created(record):
    value = record.get("CreationTime") if isinstance(record, dict) else None
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        return None
    value = str(value)
    return int(value) if value.isdigit() and len(value) <= 20 and 0 < int(value) < (1 << 64) else None


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


def _within_root(path, root):
    path = normalized_windows_directory(path)
    return path == root or path.startswith(root.rstrip("\\") + "\\")


def _command_paths(command, name):
    """Recognize simple Windows argv only; never interpret shell/program code.

    Backslash-escaped quotes, expansion, inline code and drive-relative paths
    require context this collector intentionally does not read. They cannot
    support a negative author proof. Ordinary quoted paths retain their spaces.
    """
    if len(command) > 32767 or any(ord(char) < 32 and char != "\t" for char in command):
        return [], True
    arguments, value, quoted = [], [], False
    for index, char in enumerate(command):
        if char == '"':
            if index and command[index - 1] in ('\\', '"'):
                return [], True
            quoted = not quoted
        elif char in " \t" and not quoted:
            if value:
                arguments.append("".join(value))
                value = []
        else:
            value.append(char)
    if quoted:
        return [], True
    if value:
        arguments.append("".join(value))
    if not arguments:
        return [], True
    executable = ntpath.basename(name).casefold().removesuffix(".exe")
    options = [argument.casefold() for argument in arguments[1:]]
    ambiguous = any(char in command for char in "&|<>^;%$*?~")
    ambiguous |= ntpath.basename(arguments[0]).casefold().removesuffix(".exe") != executable
    if executable in ("cmd", "powershell", "pwsh", "bash", "sh", "wsl"):
        # Shell bodies can change their own effective cwd or expand variables.
        # Even benign-looking inline bodies are outside this parser's contract.
        ambiguous |= (executable == "wsl" and bool(options)
                      or executable == "cmd" and any(value.startswith(("/c", "/k")) for value in options)
                      or executable in ("powershell", "pwsh") and any(value.startswith(("-c", "-e")) for value in options)
                      or executable in ("bash", "sh") and any(value.startswith("-") and "c" in value for value in options))
    if (executable.startswith("python") or executable in ("node", "nodejs", "ruby", "perl", "php", "deno", "bun")):
        ambiguous |= any(value == "eval" or value.startswith(("-c", "-e", "--eval", "--print", "-p", "-r"))
                         for value in options)
    paths = []
    for index, argument in enumerate(arguments):
        if index == 0 and not any(char in argument for char in "\\/:"):
            continue  # An executable basename is resolved by Windows, not cwd alone.
        if argument.startswith(("-", "/")) and "=" in argument:
            argument = argument.split("=", 1)[1]
        elif argument.startswith("-"):
            ambiguous |= any(char in argument for char in "\\/:")
            continue
        if not argument:
            continue
        # Win32 device paths and trailing dots/spaces have extra name-resolution
        # rules. Lexical normpath alone cannot prove that they are unrelated.
        if argument.startswith("\\\\.\\") or any(
                part not in (".", "..") and part.endswith((".", " "))
                for part in argument.replace("/", "\\").split("\\")):
            ambiguous = True
        drive, tail = ntpath.splitdrive(argument)
        if drive and not ntpath.isabs(argument):
            ambiguous = True  # C:relative uses a separate per-drive working directory.
            continue
        if ":" in tail:
            ambiguous = True  # URI/code/alternate-stream syntax is not a plain path.
            continue
        paths.append(argument)
    return paths, bool(ambiguous)


def observe_windows_authors(root, records, owners, exempt, read_cwd, *, current_pid,
                            read_identity=None, read_image=None, windows_directory=None):
    """Classify the complete CIM/WTS union without hiding authors behind UNKNOWN.

    An invocation ancestor can itself be an editor. The caller's historical
    ``exempt`` set is therefore not authority to exclude anything except this
    running collector. Positive and negative observations require the same
    creation-checked process identity. A missing SID never grants an exclusion.
    """
    report = WindowsAuthorReport()
    try:
        processes, identities = _index(records, "ProcessId"), _index(owners, "pid")
    except WindowsProbeError as failure:
        report.observations.append(_unknown(_observation(None, "", None, "UNKNOWN", "invalid_inventory"), failure))
        return report
    protected = normalized_windows_directory(root)
    if not ntpath.isabs(protected) or not ntpath.splitdrive(protected)[0]:
        report.observations.append(_unknown(_observation(None, "", None, "UNKNOWN", "invalid_root"),
                                            stage="root", reason="invalid_root"))
        return report
    operator_sid = identities.get(current_pid, {}).get("sid")
    if current_pid not in identities or current_pid not in processes:
        report.observations.append(_unknown(_observation(current_pid, "", None, "UNKNOWN", "collector_missing"),
                                            stage="inventory", reason="collector_missing"))
    for pid in sorted(set(processes) | set(identities)):
        record, identity = processes.get(pid), identities.get(pid)
        name = (identity or {}).get("name", (record or {}).get("Name", ""))
        created = _created(record)
        item = _observation(pid, name, created, "UNKNOWN", "metadata_unavailable")
        report.observations.append(item)
        if pid in (0, 4):
            item.update(state="EXCLUDED", reason="windows_idle_or_kernel")
            continue
        if pid == current_pid and record and identity:
            item.update(state="EXCLUDED", reason="current_collector")
            continue
        if created is None or not isinstance(name, str) or not name or not record:
            _unknown(item, stage="CIM.Win32_Process", reason="missing_identity_metadata")
            continue
        if not read_identity:
            _unknown(item, stage="identity", reason="identity_probe_unavailable")
            continue
        try:
            read_identity(pid, created)
        except ProcessLookupError:
            item.update(state="EXCLUDED", reason="confirmed_exited")
            continue
        except (Blocked, OSError, ValueError) as failure:
            _unknown(item, failure, stage="identity", reason="identity_unverifiable")
            continue
        if identity is None:
            _unknown(item, stage="inventory", reason="process_missing_from_wts")
            continue
        if not isinstance(record.get("Name"), str) or record["Name"].casefold() != name.casefold():
            _unknown(item, stage="inventory", reason="process_identity_changed")
            continue
        command = record.get("CommandLine")
        command_known = isinstance(command, str) and bool(command.strip())
        if command_known and protected in ntpath.normcase(command):
            item.update(state="AUTHOR", reason="protected_path_in_command")
            continue
        paths, ambiguous_command = _command_paths(command, name) if command_known else ([], False)
        if any(ntpath.isabs(path) and ntpath.splitdrive(path)[0] and _within_root(path, protected) for path in paths):
            item.update(state="AUTHOR", reason="protected_normalized_command_path")
            continue
        needs_directory = any(not ntpath.isabs(path) or not ntpath.splitdrive(path)[0] for path in paths)
        sid = identity.get("sid")
        # This retains the existing narrow native-system-image exception. Its
        # SID and executable conditions are conjunctive, never name-only. If
        # they cannot be observed, try the ordinary cwd/command proof instead.
        image_failure = None
        if (not ambiguous_command and not needs_directory
                and isinstance(operator_sid, str) and operator_sid and isinstance(sid, str) and sid
                and sid != operator_sid and system_sid(sid) and not AUTHOR_NAME.fullmatch(name)):
            if read_image and windows_directory:
                try:
                    executable = normalized_windows_directory(read_image(pid, created))
                    directories = [normalized_windows_directory(ntpath.join(windows_directory, part))
                                   for part in ("System32", "SysWOW64")]
                    if (ntpath.basename(executable) == name.casefold()
                            and any(executable.startswith(path + "\\") for path in directories)):
                        item.update(state="EXCLUDED", reason="verified_native_system_image")
                        continue
                except ProcessLookupError:
                    item.update(state="EXCLUDED", reason="confirmed_exited")
                    continue
                except (Blocked, OSError, ValueError) as failure:
                    image_failure = failure
        try:
            directory = read_cwd(pid, created)
            if not isinstance(directory, str) or not ntpath.isabs(directory) or not ntpath.splitdrive(directory)[0]:
                raise WindowsProbeError("cwd", reason="invalid_current_directory")
            cwd = normalized_windows_directory(directory)
        except ProcessLookupError:
            item.update(state="EXCLUDED", reason="confirmed_exited")
            continue
        except (Blocked, OSError, ValueError) as failure:
            _unknown(item, failure, stage="cwd", reason="cwd_unverifiable")
            if image_failure:
                item["alternativeProofUnavailable"] = "native_system_image"
            continue
        if _within_root(cwd, protected):
            item.update(state="AUTHOR", reason="protected_current_directory")
        elif not command_known:
            _unknown(item, stage="CIM.CommandLine", reason="command_line_unavailable")
        elif ambiguous_command:
            _unknown(item, stage="CIM.CommandLine", reason="command_path_context_ambiguous")
        elif any(_within_root(ntpath.join(cwd, path), protected) for path in paths):
            item.update(state="AUTHOR", reason="protected_resolved_command_path")
        else:
            # A negative proof combines a real cwd, resolved simple arguments
            # and creation-checked identity. Ambiguous command syntax cannot pass.
            item.update(state="EXCLUDED", reason="verified_unrelated_command_and_cwd")
    return report


def find_windows_authors(root, records, owners, exempt, read_cwd, *, current_pid,
                         read_identity=None, read_image=None, windows_directory=None):
    report = observe_windows_authors(root, records, owners, exempt, read_cwd, current_pid=current_pid,
                                     read_identity=read_identity, read_image=read_image,
                                     windows_directory=windows_directory)
    if report.unknown:
        raise WindowsAuthorBlocked(report)
    return report.authors


class WindowsProcessProbe:
    """Native APIs with bounded buffers and query/read rights only."""

    def __init__(self):
        if not (os.name == "nt" and ctypes.sizeof(ctypes.c_void_p) == 8
                and platform.machine().casefold() in ("amd64", "x86_64")):
            raise WindowsProbeError("platform", reason="requires_windows_x64_python")
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        self.ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
        self.wts = ctypes.WinDLL("wtsapi32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.kernel.GetCurrentProcess.argtypes = []
        self.kernel.GetCurrentProcess.restype = wintypes.HANDLE
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
        if not 0 < length < len(directory) or not ntpath.isabs(directory.value):
            raise WindowsProbeError("GetWindowsDirectoryW", winerror=ctypes.get_last_error(),
                                    reason="windows_directory_unverifiable")
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
        self.advapi.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        self.advapi.OpenProcessToken.restype = wintypes.BOOL
        self.advapi.GetTokenInformation.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p,
                                                   wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        self.advapi.GetTokenInformation.restype = wintypes.BOOL
        self.operator_context = self.check_operator_privileges()

    def check_operator_privileges(self):
        """Inspect the existing token; never enable, disable or impersonate it."""
        class Luid(ctypes.Structure):
            _fields_ = [("low", wintypes.DWORD), ("high", wintypes.LONG)]
        self.advapi.LookupPrivilegeValueW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(Luid)]
        self.advapi.LookupPrivilegeValueW.restype = wintypes.BOOL
        token = wintypes.HANDLE()
        if not self.advapi.OpenProcessToken(self.kernel.GetCurrentProcess(), TOKEN_QUERY, ctypes.byref(token)):
            raise WindowsProbeError("OpenProcessToken(self)", TOKEN_QUERY, ctypes.get_last_error(), "operator_token_unavailable")
        try:
            required = wintypes.DWORD()
            self.advapi.GetTokenInformation(token, 3, None, 0, ctypes.byref(required))  # TokenPrivileges
            error = ctypes.get_last_error()
            if error != 122 or not 4 <= required.value <= 65536:
                raise WindowsProbeError("GetTokenInformation(TokenPrivileges)", TOKEN_QUERY, error, "operator_privileges_unavailable")
            buffer = ctypes.create_string_buffer(required.value)
            if not self.advapi.GetTokenInformation(token, 3, buffer, len(buffer), ctypes.byref(required)):
                raise WindowsProbeError("GetTokenInformation(TokenPrivileges)", TOKEN_QUERY, ctypes.get_last_error(),
                                        "operator_privileges_unavailable")
            count = struct.unpack_from("<I", buffer.raw)[0]
            if count > 1024 or 4 + count * 12 > required.value or required.value > len(buffer):
                raise WindowsProbeError("GetTokenInformation(TokenPrivileges)", TOKEN_QUERY, reason="invalid_token_privileges")
            debug = Luid()
            if not self.advapi.LookupPrivilegeValueW(None, "SeDebugPrivilege", ctypes.byref(debug)):
                raise WindowsProbeError("LookupPrivilegeValueW", winerror=ctypes.get_last_error(),
                                        reason="debug_privilege_unverifiable")
            present, enabled = False, False
            for offset in range(4, 4 + count * 12, 12):
                low, high, attributes = struct.unpack_from("<IiI", buffer.raw, offset)
                if (low, high) == (debug.low, debug.high):
                    present, enabled = True, bool(attributes & 0x00000002)
            if enabled:
                raise WindowsProbeError("GetTokenInformation(TokenPrivileges)", TOKEN_QUERY,
                                        reason="debug_privilege_enabled")
            elevation, size = wintypes.DWORD(), wintypes.DWORD()
            if not self.advapi.GetTokenInformation(token, 20, ctypes.byref(elevation), ctypes.sizeof(elevation), ctypes.byref(size)):
                raise WindowsProbeError("GetTokenInformation(TokenElevation)", TOKEN_QUERY, ctypes.get_last_error(),
                                        "operator_elevation_unavailable")
            if size.value != ctypes.sizeof(elevation):
                raise WindowsProbeError("GetTokenInformation(TokenElevation)", TOKEN_QUERY, reason="invalid_token_elevation")
            return {"tokenElevated": bool(elevation.value), "seDebugPrivilegePresent": present,
                    "seDebugPrivilegeEnabled": False}
        finally:
            self.kernel.CloseHandle(token)

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
        if not self.wts.WTSEnumerateProcessesW(None, 0, 1, ctypes.byref(values), ctypes.byref(count)):
            raise WindowsProbeError("WTSEnumerateProcessesW", winerror=ctypes.get_last_error(), reason="inventory_unavailable")
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

    def check_creation(self, handle, creation_time, rights=QUERY_LIMITED_INFORMATION):
        times = [wintypes.FILETIME() for _ in range(4)]
        if not self.kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)):
            raise WindowsProbeError("GetProcessTimes", rights, ctypes.get_last_error(), "creation_time_unavailable")
        actual_created = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        # CIM dates have microsecond precision; FILETIME uses 100 ns ticks.
        if actual_created // 10 != creation_time // 10:
            raise WindowsProbeError("GetProcessTimes", rights, reason="pid_reused")

    def _open(self, pid, creation_time, rights):
        if not (type(pid) is int and 4 < pid <= 0xFFFFFFFF and type(creation_time) is int
                and 0 < creation_time < (1 << 64)):
            raise WindowsProbeError("identity", rights, reason="invalid_process_identity")
        handle = self.kernel.OpenProcess(rights, False, pid)
        if not handle:
            error = ctypes.get_last_error()
            if error == 87:  # A validated, previously enumerated PID no longer exists.
                raise ProcessLookupError(pid)
            raise WindowsProbeError("OpenProcess", rights, error, "process_handle_unavailable")
        return handle

    def _alive(self, handle, rights):
        code = wintypes.DWORD()
        if not self.kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
            raise WindowsProbeError("GetExitCodeProcess", rights, ctypes.get_last_error(), "process_lifetime_unavailable")
        if code.value != 259:
            raise ProcessLookupError()

    def identity(self, pid, creation_time):
        handle = self._open(pid, creation_time, QUERY_LIMITED_INFORMATION)
        try:
            self._alive(handle, QUERY_LIMITED_INFORMATION)
            self.check_creation(handle, creation_time)
            self._alive(handle, QUERY_LIMITED_INFORMATION)
        finally:
            self.kernel.CloseHandle(handle)

    def image(self, pid, creation_time):
        handle = self._open(pid, creation_time, QUERY_LIMITED_INFORMATION)
        try:
            self._alive(handle, QUERY_LIMITED_INFORMATION)
            self.check_creation(handle, creation_time)
            value = ctypes.create_unicode_buffer(32768)
            length = wintypes.DWORD(len(value))
            if not self.kernel.QueryFullProcessImageNameW(handle, 0, value, ctypes.byref(length)):
                raise WindowsProbeError("QueryFullProcessImageNameW", QUERY_LIMITED_INFORMATION, ctypes.get_last_error(),
                                        "executable_unavailable")
            if not 0 < length.value < len(value) or not ntpath.isabs(value.value):
                raise WindowsProbeError("QueryFullProcessImageNameW", QUERY_LIMITED_INFORMATION, reason="invalid_executable_path")
            self._alive(handle, QUERY_LIMITED_INFORMATION)
            return value.value
        finally:
            self.kernel.CloseHandle(handle)

    def cwd(self, pid, creation_time):
        handle = self._open(pid, creation_time, QUERY_DIRECTORY)
        try:
            self._alive(handle, QUERY_DIRECTORY)
            self.check_creation(handle, creation_time, QUERY_DIRECTORY)
            returned = wintypes.ULONG()
            wow64 = ctypes.c_size_t()
            status = self.ntdll.NtQueryInformationProcess(handle, 26, ctypes.byref(wow64),
                                                         ctypes.sizeof(wow64), ctypes.byref(returned))
            if status < 0:
                raise WindowsProbeError("NtQueryInformationProcess(ProcessWow64Information)", QUERY_DIRECTORY,
                                        reason="process_pointer_width_unavailable", ntstatus=status & 0xFFFFFFFF)
            if wow64.value:
                peb, width = wow64.value, 4
            else:
                basic = ctypes.create_string_buffer(48)
                status = self.ntdll.NtQueryInformationProcess(handle, 0, basic, len(basic), ctypes.byref(returned))
                if status < 0:
                    raise WindowsProbeError("NtQueryInformationProcess(ProcessBasicInformation)", QUERY_DIRECTORY,
                                            reason="process_parameters_unavailable", ntstatus=status & 0xFFFFFFFF)
                peb, width = struct.unpack_from("<Q", basic.raw, 8)[0], 8
            def read(address, size):
                buffer, received = ctypes.create_string_buffer(size), ctypes.c_size_t()
                if not self.kernel.ReadProcessMemory(handle, address, buffer, size, ctypes.byref(received)):
                    error = ctypes.get_last_error()
                    self._alive(handle, QUERY_DIRECTORY)
                    raise WindowsProbeError("ReadProcessMemory(CurrentDirectory)", QUERY_DIRECTORY, error,
                                            "current_directory_unavailable")
                if received.value != size:
                    raise WindowsProbeError("ReadProcessMemory(CurrentDirectory)", QUERY_DIRECTORY,
                                            reason="incomplete_current_directory_read")
                return buffer.raw
            try:
                directory = read_peb_cwd(read, peb, width)
            except WindowsProbeError:
                raise
            except (Blocked, ValueError, struct.error):
                raise WindowsProbeError("ReadProcessMemory(CurrentDirectory)", QUERY_DIRECTORY,
                                        reason="current_directory_changed_or_invalid") from None
            self._alive(handle, QUERY_DIRECTORY)
            try:
                resolved = Path(directory).resolve(strict=True)
                if not resolved.is_dir():
                    raise WindowsProbeError("ResolveCurrentDirectory", reason="current_directory_not_directory")
            except OSError as failure:
                raise WindowsProbeError("ResolveCurrentDirectory", winerror=getattr(failure, "winerror", None),
                                        reason="current_directory_unresolvable") from None
            self._alive(handle, QUERY_DIRECTORY)
            return str(resolved)
        finally:
            self.kernel.CloseHandle(handle)


def _finish_inventory(report, records, owners, probe):
    """A new process or reused PID after the scan is UNKNOWN, never a clean result."""
    try:
        final = _index(probe.inventory(), "pid")
        initial, processes = _index(owners, "pid"), _index(records, "ProcessId")
    except (Blocked, OSError, ValueError) as failure:
        report.observations.append(_unknown(_observation(None, "", None, "UNKNOWN", "final_inventory_unavailable"),
                                            failure, stage="inventory", reason="final_inventory_unavailable"))
        return
    if os.getpid() not in final:
        report.observations.append(_unknown(_observation(None, "", None, "UNKNOWN", "collector_missing"),
                                            stage="inventory", reason="collector_missing_from_final_inventory"))
    observed_pids = {item["pid"] for item in report.observations}
    for pid in sorted(set(final) - set(initial)):
        if pid in (0, 4, os.getpid()):
            continue
        # A previously recorded CIM PID can also have vanished and reappeared.
        item = next((item for item in report.observations if item["pid"] == pid), None)
        if item is None:
            item = _observation(pid, final[pid].get("name", ""), None, "UNKNOWN", "process_appeared_during_scan")
            report.observations.append(item)
        _unknown(item, stage="inventory", reason="process_appeared_during_scan")
    for item in report.observations:
        pid = item["pid"]
        if pid in (None, 0, 4, os.getpid()) or pid not in observed_pids or item["state"] == "UNKNOWN":
            continue
        if item["reason"] == "confirmed_exited" and pid not in final:
            continue
        created = _created(processes.get(pid))
        if created is None:
            _unknown(item, stage="inventory", reason="missing_identity_metadata")
            continue
        try:
            probe.identity(pid, created)
        except ProcessLookupError:
            item.update(state="EXCLUDED", reason="confirmed_exited")
            continue
        except (Blocked, OSError, ValueError) as failure:
            _unknown(item, failure, stage="identity", reason="final_identity_unverifiable")
            continue
        if pid not in final or pid not in initial:
            _unknown(item, stage="inventory", reason="process_inventory_changed")
        elif any(final[pid].get(key) != initial[pid].get(key) for key in ("name", "sid")):
            _unknown(item, stage="inventory", reason="process_identity_changed")
        elif item["reason"] == "confirmed_exited":
            _unknown(item, stage="inventory", reason="process_reappeared_after_exit")


def collect_windows_records():
    try:
        result = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", CIM_PROCESS_SCRIPT],
                                capture_output=True, text=True, encoding="utf-8", check=True, timeout=45)
        records = json.loads(result.stdout)
        if isinstance(records, dict):
            records = [records]
        _index(records, "ProcessId")
        return records
    except (subprocess.SubprocessError, OSError, ValueError, WindowsProbeError):
        raise WindowsProbeError("CIM.Win32_Process", reason="metadata_collection_failed") from None


def windows_active_authors(root, records=None, exempt=(), *, report_only=False):
    """The production entrypoint and read-only diagnostic use the same full scan."""
    try:
        probe = WindowsProcessProbe()
        if records is None:
            records = collect_windows_records()
        owners = probe.inventory()
        report = observe_windows_authors(root, records, owners, exempt, probe.cwd, current_pid=os.getpid(),
                                          read_identity=probe.identity, read_image=probe.image,
                                          windows_directory=probe.windows_directory)
        context = getattr(probe, "operator_context", {})
        if isinstance(context, dict):
            report.operator_context = context
        _finish_inventory(report, records, owners, probe)
    except (Blocked, OSError, ValueError) as failure:
        report = WindowsAuthorReport([_unknown(_observation(None, "", None, "UNKNOWN", "collector_unavailable"),
                                               failure, stage="collector", reason="collector_unavailable")])
    if report_only:
        return report
    if report.unknown:
        raise WindowsAuthorBlocked(report)
    return report.authors


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read-only Windows author diagnosis; never changes privileges or processes.")
    parser.add_argument("--root", required=True, help="Absolute protected installation directory")
    parser.add_argument("--diagnose", required=True, action="store_true", help="Print only safe author observations")
    args = parser.parse_args(argv)
    root = Path(args.root)
    try:
        if not root.is_absolute() or not root.is_dir():
            report = WindowsAuthorReport([_unknown(_observation(None, "", None, "UNKNOWN", "invalid_root"),
                                                   stage="root", reason="invalid_root")])
        else:
            report = windows_active_authors(root.resolve(strict=True), report_only=True)
    except (Blocked, OSError, ValueError):
        report = WindowsAuthorReport([_unknown(_observation(None, "", None, "UNKNOWN", "invalid_root"),
                                               stage="root", reason="root_unresolvable")])
    print(json.dumps(report.as_dict(), ensure_ascii=True, sort_keys=True))
    return 2 if report.unknown or report.authors else 0


if __name__ == "__main__":
    raise SystemExit(main())

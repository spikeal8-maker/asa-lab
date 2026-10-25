"""Bounded host memory attribution. Never reads argv, paths, environment or titles."""
import os
import json
from pathlib import Path
import re
import sys
import subprocess
import time

MAX_PROCESSES = 4096
TOP_NAMES = 8
CAPTURE_SECONDS = 2


def process_name(value):
    # Executable basenames only; reject arbitrary text rather than sanitizing it.
    return value.lower() if re.fullmatch(r'[A-Za-z0-9_. -]{1,64}', value) else 'other'


def aggregate(rows, deadline, clock=time.monotonic):
    groups = {}
    inspected = skipped = 0
    reason = None
    iterator = iter(rows)
    while inspected < MAX_PROCESSES:
        if clock() >= deadline:
            reason = 'deadline'
            break
        try:
            row = next(iterator)
        except StopIteration:
            break
        inspected += 1
        if row is None:
            skipped += 1
            continue
        name, working, private = row
        group = groups.setdefault(process_name(name), dict(count=0, workingSetBytes=0, privateCommitBytes=0))
        group['count'] += 1
        group['workingSetBytes'] += working
        if private is None:
            group['privateCommitBytes'] = None
        elif group['privateCommitBytes'] is not None:
            group['privateCommitBytes'] += private
    else:
        reason = 'process_limit'
    leaders = sorted(groups.items(), key=lambda item: (-item[1]['workingSetBytes'], item[0]))[:TOP_NAMES]
    return dict(state='partial' if reason or skipped else 'available', reason=reason,
                inspectedProcesses=inspected, unavailableProcesses=skipped,
                rankedBy='workingSetBytes', leaders=[dict(name=name, **values) for name, values in leaders])


def linux_processes(proc):
    with os.scandir(proc) as entries:
        for entry in entries:
            if not entry.name.isdecimal():
                continue
            try:
                # Read only the fixed kernel status projection, never cmdline/environ.
                with open(Path(entry.path) / 'status', encoding='utf-8', errors='replace') as stream:
                    lines = stream.read(16384).splitlines()
                fields = dict(line.split(':', 1) for line in lines if ':' in line)
                working = int(fields['VmRSS'].split()[0]) * 1024
                yield fields['Name'].strip(), working, None
            except (OSError, KeyError, ValueError):
                yield None


def windows_processes():
    import ctypes as c
    from ctypes import wintypes as w
    class Entry(c.Structure):
        _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('pid', w.DWORD),
                    ('heap', c.c_size_t), ('module', w.DWORD), ('threads', w.DWORD),
                    ('parent', w.DWORD), ('priority', w.LONG), ('flags', w.DWORD), ('name', w.WCHAR * 260)]
    class Counters(c.Structure):
        _fields_ = [('size', w.DWORD), ('faults', w.DWORD)] + [(name, c.c_size_t) for name in
            ('peakWorking', 'working', 'peakPaged', 'paged', 'peakNonpaged', 'nonpaged', 'pagefile', 'peakPagefile', 'private')]
    kernel = c.WinDLL('kernel32', use_last_error=True)
    psapi = c.WinDLL('psapi', use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
    kernel.OpenProcess.restype = w.HANDLE
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    kernel.Process32FirstW.argtypes = kernel.Process32NextW.argtypes = [w.HANDLE, c.POINTER(Entry)]
    psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, c.POINTER(Counters), w.DWORD]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == c.c_void_p(-1).value:
        raise OSError('snapshot_unavailable')
    try:
        entry = Entry(); entry.size = c.sizeof(entry)
        present = kernel.Process32FirstW(snapshot, c.byref(entry))
        while present:
            handle = kernel.OpenProcess(0x410, False, entry.pid)
            try:
                counters = Counters(); counters.size = c.sizeof(counters)
                if handle and psapi.GetProcessMemoryInfo(handle, c.byref(counters), counters.size):
                    yield entry.name, counters.working, counters.private
                else:
                    yield None
            finally:
                if handle: kernel.CloseHandle(handle)
            present = kernel.Process32NextW(snapshot, c.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)


def windows_pagefile():
    import ctypes as c
    from ctypes import wintypes as w
    class Pagefile(c.Structure):
        _fields_ = [('size', w.DWORD), ('reserved', w.DWORD), ('total', c.c_size_t),
                    ('used', c.c_size_t), ('peak', c.c_size_t)]
    totals = [0, 0]
    callback_type = c.WINFUNCTYPE(w.BOOL, c.c_void_p, c.POINTER(Pagefile), w.LPCWSTR)
    def receive(context, info, filename):
        # Filename is deliberately never inspected or retained.
        totals[0] += info.contents.total
        totals[1] += info.contents.used
        return True
    callback = callback_type(receive)
    psapi = c.WinDLL('psapi', use_last_error=True)
    psapi.EnumPageFilesW.argtypes = [callback_type, c.c_void_p]
    if not psapi.EnumPageFilesW(callback, None):
        return dict(state='unavailable', reason='read_failed')
    # Windows native page size; allocation granularity is a different quantity.
    import mmap
    return dict(state='available', totalBytes=totals[0] * mmap.PAGESIZE,
                usedBytes=totals[1] * mmap.PAGESIZE)


def capture_native_memory(proc=Path('/proc'), clock=time.monotonic):
    deadline = clock() + CAPTURE_SECONDS
    result = dict(units='bytes', captureLimitSeconds=CAPTURE_SECONDS, processLimit=MAX_PROCESSES,
                  topNamesLimit=TOP_NAMES, workingSetSemantics='includes_shared_pages_not_unique_physical_memory',
                  paging=dict(state='unavailable', reason='unsupported'),
                  pagefile=dict(state='unavailable', reason='unsupported'))
    rows = None
    try:
        if os.name == 'nt':
            rows = windows_processes()
            result['pagefile'] = windows_pagefile()
        elif sys.platform.startswith('linux'):
            rows = linux_processes(proc)
            try:
                with (proc / 'vmstat').open() as stream:
                    counters = dict(line.split() for line in stream.read(65536).splitlines())
                result['paging'] = dict(state='available', unit='pages', kind='swap_io_cumulative',
                                        pagesIn=int(counters['pswpin']), pagesOut=int(counters['pswpout']))
            except (OSError, KeyError, ValueError):
                result['paging'] = dict(state='unavailable', reason='read_failed')
        else:
            result['processes'] = dict(state='unavailable', reason='unsupported')
            return result
        result['processes'] = aggregate(rows, deadline, clock)
        if sys.platform.startswith('linux') and os.name != 'nt':
            result['processes']['privateCommitReason'] = 'unsupported_linux_semantics'
    except (OSError, ValueError):
        result['processes'] = dict(state='unavailable', reason='read_failed')
    finally:
        if rows is not None: rows.close()
    return result


def unavailable(reason):
    return dict(units='bytes', processes=dict(state='unavailable', reason=reason),
                pagefile=dict(state='unavailable', reason=reason),
                paging=dict(state='unavailable', reason=reason))


def capture_memory(deadline=None, clock=time.monotonic):
    """Isolate synchronous native calls; only our fresh helper may be terminated."""
    started = clock()
    deadline = min(deadline if deadline is not None else started + CAPTURE_SECONDS,
                   started + CAPTURE_SECONDS)
    if deadline <= started:
        return unavailable('deadline')
    try:
        child = subprocess.Popen([sys.executable, '-E', str(Path(__file__).resolve()), '--capture'],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=0x08000000 if os.name == 'nt' else 0)
    except OSError:
        return unavailable('helper_start_failed')
    try:
        remaining = deadline - clock()  # Includes helper startup in the shared budget.
        if remaining <= 0:
            raise subprocess.TimeoutExpired('memory_helper', 0)
        output, _ = child.communicate(timeout=remaining)
    except subprocess.TimeoutExpired:
        child.kill()
        child.communicate()  # Reap only this owned child; never leave a helper behind.
        return unavailable('deadline')
    if child.returncode != 0 or len(output) > 8192:
        return unavailable('helper_failed')
    try:
        result = json.loads(output)
        if not isinstance(result, dict) or not isinstance(result.get('processes'), dict):
            raise ValueError('invalid envelope')
        return result
    except (ValueError, UnicodeError):
        return unavailable('helper_failed')


if __name__ == '__main__' and sys.argv[1:] == ['--capture']:
    print(json.dumps(capture_native_memory(), separators=(',', ':')))

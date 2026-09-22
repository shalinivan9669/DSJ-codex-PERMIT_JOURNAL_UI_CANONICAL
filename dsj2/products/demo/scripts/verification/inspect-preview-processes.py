"""Read only the specified owned Node processes' CWD/environment for a safe restart.

Full inherited environments remain in the ignored .runtime directory. The evidence
report contains command lines, non-secret settings, and a redacted database target.
No process is stopped or changed by this helper.
"""
import ctypes as c
from ctypes import wintypes as w
import json
import pathlib
import sys
from urllib.parse import urlsplit

kernel = c.WinDLL("kernel32", use_last_error=True)
nt = c.WinDLL("ntdll")
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.ReadProcessMemory.argtypes = [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)]
kernel.ReadProcessMemory.restype = w.BOOL
kernel.CloseHandle.argtypes = [w.HANDLE]
nt.NtQueryInformationProcess.argtypes = [w.HANDLE, w.ULONG, c.c_void_p, w.ULONG, c.c_void_p]
nt.NtQueryInformationProcess.restype = c.c_long

def inspect(pid):
    handle = kernel.OpenProcess(0x410, False, pid)
    if not handle:
        raise c.WinError(c.get_last_error())
    try:
        def read(address, size):
            buf = c.create_string_buffer(size)
            count = c.c_size_t()
            if not kernel.ReadProcessMemory(handle, address, buf, size, c.byref(count)):
                raise c.WinError(c.get_last_error())
            return buf.raw[:count.value]
        def pointer(address):
            return int.from_bytes(read(address, 8), "little")
        def unicode(address):
            descriptor = read(address, 16)
            return read(int.from_bytes(descriptor[8:16], "little"), int.from_bytes(descriptor[:2], "little")).decode("utf-16-le")
        basic = c.create_string_buffer(48)
        if nt.NtQueryInformationProcess(handle, 0, basic, 48, None) != 0:
            raise RuntimeError("NtQueryInformationProcess failed")
        peb = int.from_bytes(basic.raw[8:16], "little")
        params = pointer(peb + 0x20)
        environment_address = pointer(params + 0x80)
        data = bytearray()
        for offset in range(0, 1024 * 1024, 2):
            pair = read(environment_address + offset, 2)
            data.extend(pair)
            if len(data) >= 4 and data[-4:] == b"\0\0\0\0":
                break
        entries = bytes(data).decode("utf-16-le").rstrip("\0").split("\0")
        env = dict(entry.split("=", 1) for entry in entries if "=" in entry and not entry.startswith("="))
        cwd = unicode(params + 0x38)
        command = unicode(params + 0x70)
        private = pathlib.Path(".runtime") / f"preview-process-{pid}.json"
        private.write_text(json.dumps({"pid": pid, "cwd": cwd, "command": command, "env": env}, ensure_ascii=False, indent=2), encoding="utf-8")
        safe = {k: v for k, v in env.items() if k.startswith(("DEMO_", "NEXT_")) and not any(s in k for s in ("PASSWORD", "SECRET", "TOKEN", "EMAIL"))}
        parsed = urlsplit(env.get("DATABASE_URL", ""))
        return {"pid": pid, "cwd": cwd, "command": command, "safeEnvironment": safe,
                "databaseTarget": {"hostname": parsed.hostname, "port": parsed.port, "database": parsed.path},
                "privateRestartSnapshot": str(private)}
    finally:
        kernel.CloseHandle(handle)

records = [inspect(int(pid)) for pid in sys.argv[1:]]
pathlib.Path("docs/evidence/commercial-acceptance/browser/user-preview-processes.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(records, ensure_ascii=False, indent=2))

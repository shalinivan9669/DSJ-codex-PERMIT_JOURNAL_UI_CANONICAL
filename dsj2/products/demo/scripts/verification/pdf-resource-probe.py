"""Execute bounded synthetic allocation/CPU probes in disposable child processes."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]


def limited_probe(mode):
    path = root / "scripts/security/pdf_limits.py"
    spec = importlib.util.spec_from_file_location("pdf_limits", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    resource_mode = module.apply_limits()
    print(json.dumps({"resourceMode": resource_mode}), flush=True)
    if mode == "memory":
        blocks = []
        try:
            for _ in range(600):
                blocks.append(bytearray(1024 * 1024))
        except MemoryError:
            print(json.dumps({"memoryRejected": True, "allocatedMiB": len(blocks)}), flush=True)
            return
        raise AssertionError("OS did not enforce the 256 MiB process allocation limit")
    while True:
        pass


if len(sys.argv) == 3 and sys.argv[1] == "--probe":
    limited_probe(sys.argv[2])
else:
    results = []
    for mode in ("memory", "cpu"):
        started = time.monotonic()
        child = subprocess.run([sys.executable, "-I", str(Path(__file__).resolve()), "--probe", mode],
                               capture_output=True, text=True, timeout=8)
        elapsed = time.monotonic() - started
        rows = [json.loads(line) for line in child.stdout.splitlines()]
        assert rows and rows[0]["resourceMode"] in ("windows-job", "posix-rlimit")
        if mode == "memory":
            assert child.returncode == 0 and rows[-1]["memoryRejected"]
            assert rows[-1]["allocatedMiB"] < 256
        else:
            assert child.returncode != 0 and 2 <= elapsed < 8
        results.append({"probe": mode, "status": "PASS", "durationSeconds": round(elapsed, 3),
                        "exitCode": child.returncode, "results": rows})
    print(json.dumps({"status": "PASS", "memoryLimitMiB": 256, "cpuLimitSeconds": 3,
                      "probes": results}, indent=2))

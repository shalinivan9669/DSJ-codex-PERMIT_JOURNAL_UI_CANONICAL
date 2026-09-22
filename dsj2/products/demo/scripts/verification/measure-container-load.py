"""Record actual server-container resources while running a bounded test command.

The command after -- is executed without a shell. Only containers carrying the
explicit Compose project label are sampled. No secrets or command arguments are
copied into the report. Docker raw stats are retained alongside numeric values.
"""

import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import time


def byte_count(value):
    match = re.fullmatch(r"([\d.]+)\s*([kKMGT]?i?B)", value.strip())
    if not match:
        raise ValueError(f"Unrecognized Docker byte value: {value!r}")
    unit = match.group(2)
    power = "BKMGT".index(unit[0].upper()) if unit != "B" else 0
    return round(float(match.group(1)) * (1024 if "i" in unit else 1000) ** power)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.project != "demo-commercial-release":
        parser.error("Only the isolated acceptance project is permitted")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.interval < 1:
        parser.error("A command and interval >= 1 second are required")
    args.output.mkdir(parents=True, exist_ok=True)
    docker = ["/home/admin/demo-commercial-runtime/docker/docker", "--config", "/home/admin/demo-commercial-runtime", "-H", "unix:///home/admin/demo-commercial-runtime/docker.sock"]

    def capture(arguments):
        return subprocess.check_output(docker + arguments, text=True, timeout=20)

    ids = capture(["ps", "-q", "--filter", f"label=com.docker.compose.project={args.project}"]).split()
    if len(ids) not in (5, 6):
        raise RuntimeError(f"Expected five servers plus optional TLS container, found {len(ids)}")
    details = json.loads(capture(["inspect", *ids]))
    environment = {
        "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "intervalSeconds": args.interval,
        "host": {"kernel": os.uname().release, "logicalCpus": os.cpu_count()},
        "servers": [{"id": item["Id"], "name": item["Name"], "image": item["Image"], "cpuLimit": item["HostConfig"]["NanoCpus"] / 1e9, "memoryLimitBytes": item["HostConfig"]["Memory"], "readOnly": item["HostConfig"]["ReadonlyRootfs"], "user": item["Config"]["User"]} for item in details],
        "limitations": "Docker CPU% uses host CPU accounting, memory excludes reclaimable cache per Docker stats. Block/network IO counters are cumulative per container, not per job. Shared Windows/WSL host; no p95 claim from three repetitions.",
    }
    (args.output / "server-environment.json").write_text(json.dumps(environment, indent=2), encoding="utf-8")
    started = time.monotonic()
    peaks = {}
    sample_errors = []
    samples = 0
    with (args.output / "resources.jsonl").open("w", encoding="utf-8") as stream, (args.output / "raw-docker-stats.jsonl").open("w", encoding="utf-8") as raw_stream, (args.output / "benchmark.log").open("w", encoding="utf-8") as log:
        child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        while True:
            sample_at = time.monotonic()
            try:
                lines = capture(["stats", "--no-stream", "--format", "{{json .}}", *ids]).splitlines()
                raw_stream.write(json.dumps({"elapsedSeconds": time.monotonic() - started, "lines": lines}) + "\n")
                raw_stream.flush()
                stats = []
                for line in lines:
                    raw = json.loads(line)
                    memory_used, memory_limit = map(byte_count, raw["MemUsage"].split("/"))
                    disk_read, disk_write = map(byte_count, raw["BlockIO"].split("/"))
                    row = {"name": raw["Name"], "cpuPercent": float(raw["CPUPerc"].rstrip("%")), "memoryBytes": memory_used, "memoryLimitBytes": memory_limit, "blockReadBytes": disk_read, "blockWriteBytes": disk_write, "pids": int(raw["PIDs"]), "raw": raw}
                    stats.append(row)
                    peak = peaks.setdefault(row["name"], {"cpuPercent": 0, "memoryBytes": 0, "pids": 0})
                    for key in peak:
                        peak[key] = max(peak[key], row[key])
                stream.write(json.dumps({"elapsedSeconds": time.monotonic() - started, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "containers": stats}) + "\n")
                stream.flush()
                samples += 1
            except (subprocess.SubprocessError, ValueError, KeyError) as error:
                sample_errors.append(str(error))
            if child.poll() is not None:
                break
            time.sleep(max(0, args.interval - (time.monotonic() - sample_at)))
    report = {"exitCode": child.returncode, "elapsedSeconds": time.monotonic() - started, "samples": samples, "peaks": peaks, "sampleErrors": sample_errors}
    (args.output / "resource-summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
    raise SystemExit(child.returncode or (1 if sample_errors or not samples else 0))


if __name__ == "__main__":
    main()

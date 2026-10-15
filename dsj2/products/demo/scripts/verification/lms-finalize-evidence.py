"""Publish one reviewed factual acceptance set after the implementation commit exists.

This script never promotes an unexecuted assertion or a failed command to PASS.
The coordinator supplies reviewed FINAL_FACTS.json with actual reports and commands.
"""
import csv
import hashlib
import io
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/evidence/lms-one-run-20261015"
HANDOFF = ROOT / "docs/handoffs/2026-10-15-lms-one-run"
BASE = "8c0833407675d8d31c786f37a55572357d7b9805"
sys.path.insert(0, str(ROOT / "scripts/verification"))
from lms_browser_acceptance import validate_browser_acceptance
REQUIRED = ["pnpm lint", "pnpm format:check", "pnpm typecheck", "pnpm test",
            "pnpm test:integration", "pnpm test:render", "pnpm test:e2e",
            "pnpm build", "node scripts/verification/autonomy.mjs", "git diff --check"]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def evidence_exists(value):
    # Evidence is local to this product; a source path may refer to an actual test.
    path = value.split("#", 1)[0]
    candidates = [OUT / path, ROOT / path]
    return any(p.is_file() and p.resolve().is_relative_to(ROOT.resolve()) for p in candidates)


def validate_ux_measurement_shape(measurement):
    for field in ("role", "phase", "goal", "result", "startState", "preconditions"):
        assert measurement.get(field), (measurement.get("measurementId"), field)
    assert isinstance(measurement.get("actualSteps"), (list, str))
    assert measurement["status"] == "MEASURED"
    missing = measurement["missingMeasuredOrDescriptiveFields"]
    assert isinstance(missing, list) and not missing
    metric_fields = ("clicks", "keyboardActions", "filledFields", "repeatedFields", "decisions",
                     "navigation", "dialogs", "confirmations", "manualRefresh", "elapsedMilliseconds")
    for field in metric_fields:
        value = measurement["recordedMetrics"][field]
        assert type(value) in (int, float) and math.isfinite(value) and value >= 0, (measurement["measurementId"], field)
    if not measurement["actualSteps"]:
        assert all(measurement["recordedMetrics"][field] == 0 for field in metric_fields[:-1])


def validate_reviewed_external_gates(path, expected, review):
    assert review["status"] == "PASS_LOCAL_GATE_DOCUMENTATION"
    assert path.name == "EXTERNAL_GATES_REVIEWED.json"
    bindings = [item for item in review["files"] if item["path"] == path.name]
    assert len(bindings) == 1
    raw = path.read_bytes()
    actual_hash = hashlib.sha256(raw).hexdigest()
    assert actual_hash == bindings[0]["sha256"].lower(), "Reviewed external gate bytes changed"
    assert json.loads(raw.decode("utf-8-sig")) == expected, "FINAL_FACTS external gates differ from reviewed data"
    return {"path": path.name, "sha256": actual_hash}


def external_gate_envelope(reviewed, binding, commit, checked_at):
    external_ids = {"PROVIDER_SANDBOX_ACCEPTED", "PRODUCTION_ACCEPTED", "LMK_MARK_CONFIRMED"}
    assert len(reviewed["gates"]) == 3 and {gate["id"] for gate in reviewed["gates"]} == external_ids
    assert all(gate["status"] == "BLOCKED_EXTERNAL_INPUTS" for gate in reviewed["gates"])
    local = {
        "id": "LOCAL_ACCEPTED", "status": "PASS", "owner": "Local implementation coordinator",
        "scope": "Accepted local synthetic LMS and sanitary workflow only; no provider, production or LMK acceptance.",
        "prerequisites": ["44 local criteria and 49 local requirement rows passed",
                          "All mandatory commands executed with their actual outcomes preserved; functional, UX, file, security, concurrency, restore and load evidence accepted, and exact browser coverage verified including any separately recorded affected-case correction",
                          "Accepted evidence is bound to the delivered implementation commit"],
        "evidencePaths": ["ACCEPTANCE_RESULTS.json", "MVP_COVERAGE_FINAL.tsv", "COMMANDS.json",
                          "UX_ACTIONS.json", "RUN_MANIFEST.json"],
    }
    return {**reviewed, "checkedAt": checked_at, "implementationCommit": commit,
            "reviewedSource": binding, "gates": [local, *reviewed["gates"]]}


def main():
    facts = json.loads((OUT / "FINAL_FACTS.json").read_text(encoding="utf8"))
    browser_acceptance = validate_browser_acceptance(
        ROOT, OUT, facts["browserFullRun"], facts.get("browserAcceptanceEnvelopePath"))
    assert browser_acceptance["coverageVerified"] is True
    assert facts["browserAcceptance"] == browser_acceptance, "Browser acceptance binding changed"
    gate_binding = validate_reviewed_external_gates(
        OUT / "EXTERNAL_GATES_REVIEWED.json", facts["externalGates"],
        json.loads((OUT / "ROOT_GATES_FINAL_REVIEW.json").read_text(encoding="utf-8-sig")))
    commit = facts["implementationCommit"]
    assert len(commit) == 40 and commit != BASE
    assert git("rev-parse", f"{commit}^{{commit}}") == commit
    assert git("rev-parse", "HEAD") == commit, "Publish before the separate evidence commit"
    assert subprocess.run(["git", "merge-base", "--is-ancestor", BASE, commit], cwd=ROOT).returncode == 0
    assert not git("diff", "--name-only", commit, "--", ".", ":(exclude)docs/evidence"), "Code changed after its commit"
    assert not git("ls-files", "--others", "--exclude-standard", "--", ".", ":(exclude)docs/evidence"), "Uncommitted new source is not covered by the implementation commit"

    criteria = facts["criteria"]
    expected_ids = ({f"L{i:02}" for i in range(1, 11)} | {f"E{i:02}" for i in range(1, 13)}
                    | {f"S{i:02}" for i in range(1, 13)} | {f"UX{i:02}" for i in range(1, 11)})
    assert len(criteria) == 44 and {c["criterionId"] for c in criteria} == expected_ids
    for criterion in criteria:
        assert criterion["status"] == "PASS" and criterion["actual"]
        assert criterion["subcases"] and criterion["evidencePaths"]
        for field in ("requirementIds", "title", "checkedAt", "environment", "fixtureVersion",
                      "preconditions", "stepsOrCommand", "expected", "externalDependencies"):
            assert criterion.get(field), (criterion["criterionId"], field)
        assert all(evidence_exists(p) for p in criterion["evidencePaths"])
        for case in criterion["subcases"]:
            excluded = case.get("excludedByUserInstruction", False)
            if excluded:
                assert criterion["criterionId"] in {"UX01", "UX10"}
                assert case["status"] == "NOT_RUN"
                assert "Продолжить без исходного браузерного замера" in case["actual"]
            else:
                assert case["status"] == "PASS", (criterion["criterionId"], case)
            assert case["actual"] and case["evidencePaths"]
            assert all(evidence_exists(p) for p in case["evidencePaths"]), case["evidencePaths"]
        criterion["sourceRevision"] = {"implementationCommit": commit, "branch": git("branch", "--show-current")}

    commands = facts["commands"]
    finals = {c["command"]: c for c in commands if c.get("finalRequiredRun")}
    assert set(REQUIRED).issubset(finals)
    for command in REQUIRED:
        record = finals[command]
        assert record["startedAt"] and record["finishedAt"], command
        if command == "pnpm test:e2e":
            raw = browser_acceptance["rawFullCommand"]
            assert record["exitCode"] == raw["exitCode"] and record["status"] == raw["status"]
            assert record["browserAcceptanceMode"] == browser_acceptance["mode"]
            assert record["browserCoverageVerified"] is True
            full_command_path = f"agent-c/{facts['browserFullRun']}/command.json"
            full_log_path = f"agent-c/{facts['browserFullRun']}/command.log"
            full_command_sha = digest(OUT / full_command_path)
            assert any(item["path"] == full_command_path and item["sha256"] == full_command_sha
                       for item in browser_acceptance["requiredEvidence"])
            original_command = json.loads((OUT / full_command_path).read_text(encoding="utf-8-sig"))
            assert raw["recordPath"] == full_command_path and raw["sha256"] == full_command_sha
            assert raw["record"] == original_command
            assert all(record.get(key) == value for key, value in original_command.items())
            assert record["commandEvidencePath"] == full_command_path
            assert record["commandEvidenceSha256"] == full_command_sha
            assert record["command"] == original_command["command"] == "pnpm test:e2e"
            assert record["runId"] == original_command["runId"] == facts["browserFullRun"]
            assert record["startedAt"] == original_command["startedAt"]
            assert record["finishedAt"] == original_command["endedAt"]
            assert record["logPath"] == full_log_path and record["logSha256"] == digest(OUT / full_log_path)
        else:
            assert record["exitCode"] == 0, command
        assert record["cwd"] == str(ROOT) and evidence_exists(record["logPath"]), command
    assert facts["ux"]["completeCurrentMeasurements"] is True
    assert facts["ux"]["missingCurrentMeasurements"] == []
    assert facts["ux"]["before"]["excludedByUserInstruction"] is True
    scenarios = facts["ux"]["requiredSection8Scenarios"]
    assert len(scenarios) == 8 and {s["id"] for s in scenarios} == set("ABCDEFGH")
    assert all(s["status"] == "PASS" and s["actual"] for s in scenarios)
    measurements = facts["ux"]["afterCurrentMeasurements"]
    assert measurements
    for measurement in measurements:
        validate_ux_measurement_shape(measurement)
        source = OUT / measurement["sourcePath"]
        assert source.is_file() and source.resolve().is_relative_to(OUT.resolve())
        assert digest(source).lower() == measurement["sourceSha256"].lower()
    assert facts["load"]["p95Ms"] < 1000 and facts["load"]["unexpected5xxPercent"] < 1
    assert facts["load"]["observedInFlight"] == 100

    now = datetime.now(timezone.utc).isoformat()
    by_id = {c["criterionId"]: c for c in criteria}
    source = (HANDOFF / "MVP_COVERAGE.tsv").read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(source), delimiter="\t")
    original_fields = reader.fieldnames
    rows = list(reader)
    assert len(rows) == 52 and len({row["ID"] for row in rows}) == 52
    added = ["runId", "actualStatus", "criterionIds", "evidencePaths", "sourceRevision", "checkedAt",
             "actualResult", "externalPrerequisites", "unresolvedReason"]
    with (OUT / "MVP_COVERAGE_FINAL.tsv").open("w", encoding="utf8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=original_fields + added, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            external = row["ID"].startswith("EXT")
            ids = [value for value in row["Приёмка"].split(";") if value in by_id]
            item = facts["externalRows"][row["ID"]] if external else None
            assert external or ids, row["ID"]
            paths = item["evidencePaths"] if external else sorted({p for key in ids for p in by_id[key]["evidencePaths"]})
            writer.writerow({**row, "runId": facts["runId"],
                             "actualStatus": "BLOCKED_EXTERNAL_INPUTS" if external else "PASS",
                             "criterionIds": ";".join(ids), "evidencePaths": ";".join(paths),
                             "sourceRevision": commit, "checkedAt": now,
                             "actualResult": item["actual"] if external else " | ".join(f"{key}: {by_id[key]['actual']}" for key in ids),
                             "externalPrerequisites": item["prerequisites"] if external else facts["localExternalBoundary"],
                             "unresolvedReason": item["reason"] if external else ""})

    prefix = git("rev-parse", "--show-prefix")
    repo = Path(git("rev-parse", "--show-toplevel"))
    changed = git("diff", "--name-only", BASE, commit, "--", ".").splitlines()
    source_files = [{"path": path.removeprefix(prefix), "sha256": digest(repo / path)} for path in changed if (repo / path).is_file()]
    manifest = {**facts["manifest"], "runId": facts["runId"], "finishedAt": now, "baseCommit": BASE,
                "implementationCommit": commit, "implementationTree": git("rev-parse", f"{commit}^{{tree}}"),
                "branch": git("branch", "--show-current"), "productPath": str(ROOT),
                "sourceFiles": source_files, "handoffFiles": [{"path": p.name, "sha256": digest(p)} for p in sorted(HANDOFF.iterdir()) if p.is_file()],
                "reviewedExternalGates": gate_binding,
                "localAccepted": True, "finalCodeDirtyPaths": [], "evidenceCommit": "Separate following commit; deliberately not self-referenced"}
    write("RUN_MANIFEST.json", manifest)
    write("ACCEPTANCE_RESULTS.json", {"runId": facts["runId"], "implementationCommit": commit,
          "localAccepted": True, "criteriaCount": 44, "criteria": criteria})
    write("COMMANDS.json", {"runId": facts["runId"], "implementationCommit": commit, "commands": commands})
    write("UX_ACTIONS.json", {**facts["ux"], "implementationCommit": commit})
    # Candidate evidence binds the immutable reviewed snapshot, never this final envelope.
    write("EXTERNAL_GATES.json", external_gate_envelope(facts["externalGates"], gate_binding, commit, now))
    for name, key in [("FINAL_ACCEPTANCE_RU.txt", "finalText"), ("REPRODUCE_RU.txt", "reproduceText")]:
        (OUT / name).write_text(facts[key].replace("{IMPLEMENTATION_COMMIT}", commit).rstrip() + "\n", encoding="utf8")
    print(json.dumps({"criteria": 44, "requirements": 52, "localRequirementsPassed": 49,
                      "externalBlocked": 3, "implementationCommit": commit}, ensure_ascii=False))


if __name__ == "__main__":
    main()

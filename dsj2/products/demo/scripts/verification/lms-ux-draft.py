"""Collect original measured UX values without completing absent fields by guesswork."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from lms_browser_acceptance import validate_browser_acceptance

root = Path(__file__).resolve().parents[2]
evidence = root / "docs/evidence/lms-one-run-20261015"
destination = evidence / "agent-c"
required = ["clicks", "keyboardActions", "filledFields", "repeatedFields", "decisions", "navigation", "dialogs", "confirmations", "manualRefresh", "elapsedMilliseconds"]
sources = [
    ("agent-c/learning-live/actions.json", "scenarios", "prepared and learner first attempt"),
    ("agent-c/first-entry-live/registration-actions.json", None, "first registration"),
    ("agent-c/first-entry-live/course-actions.json", None, "first course authoring"),
    ("agent-c/targeted-batches-clock-20261015-01/lms-assignment-batches-live/actions.json", "measurements", "mixed batch recovery"),
    ("agent-b/operator-live/actions.json", "metrics", "prepared document operation and separate director approval"),
    ("agent-b/selection-regression04/lms-selection-regression-live/acceptance.json", "measurements", "external source first entry/correction and explicit selection regression"),
]
records = []
for relative, key, kind in sources:
    path = evidence / relative
    if not path.is_file():
        records.append({"expectedPath": relative, "status": "NOT_RUN", "reason": "Expected measurement file absent; do not substitute code or screenshots."})
        continue
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    items = data[key] if key else [data]
    for i, item in enumerate(items):
        metrics = dict(item.get("counts", {}))
        for field in required + ["selections", "fileSelections", "manualSaveButtons", "authenticationRepeatedFields", "businessRepeatedFields"]:
            if field in item:
                metrics[field] = item[field]
        if "fields" in item and "filledFields" not in metrics:
            metrics["filledFields"] = item["fields"]
        functional_only = "selection-regression" in relative and not str(item.get("scenario", "")).startswith("Д:")
        records.append({
            "measurementId": f"{relative}#{i}", "measurementKind": kind,
            "sourcePath": relative, "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "actualRecordedAt": data.get("checkedAt", data.get("measuredAt")),
            "scenario": item.get("scenario", kind), "role": item.get("role"),
            "phase": item.get("phase", data.get("phase")),
            "goal": item.get("goal", data.get("goal")),
            "result": item.get("result", data.get("result")),
            "startState": item.get("startState", item.get("startBoundary")),
            "preconditions": item.get("preconditions", item.get("prerequisites", data.get("setup", data.get("preconditions")))),
            "actualSteps": item.get("actualSteps", item.get("steps", item.get("actions"))),
            "recordedMetrics": metrics,
            "missingMeasuredFields": [field for field in required if field not in metrics],
            "rawActualRecord": item,
            "actionBudgetEvidence": not functional_only,
            "status": "FUNCTIONAL_MEASUREMENT_ONLY" if functional_only else "MEASURED_PARTIAL_SCHEMA" if any(field not in metrics for field in required) else "MEASURED",
            "timingBoundary": "Automated scenario wall time includes verification-only replay and screenshot; not a human-only task timing." if item.get("verificationOnly") else "Actual automated scenario wall time at the recorded source boundary; not inferred human-only timing.",
            "measurementBoundary": "Copied recorded values only. Missing metrics are not inferred as zero; final full-suite instrumentation will replace the relevant incomplete measurement.",
        })

additional = [
    "agent-c/targeted-batches-clock-20261015-01/lms-conflict-live/result.json",
    "agent-b/paper-run04/lms-paper-signature-live/acceptance.json",
    "agent-b/geometry-run01/lms-geometry-live/geometry.json",
    "agent-b/selection-regression04/lms-selection-regression-live/acceptance.json",
    "agent-a/video-browser/PLAYBACK_ACCEPTANCE.json",
    "root-public-browser/results.json",
]
section8 = [
    {"id": "A", "title": "Complete first input", "status": "NOT_RUN", "actual": "Separate registration and course-authoring measurements exist. Linked first-flow authored but not executed."},
    {"id": "B", "title": "Prepared operator repeat", "status": "MEASURED", "actual": "Prepared assignment1 click, continuation1 click, document preparation1 click and download1 click; separate director decision explicitly recorded. Older operator schema lacks keyboard/manualRefresh and approval time; final instrumentation pending."},
    {"id": "C", "title": "Automatic sanitary preparation", "status": "NOT_RUN", "actual": "Real outbox/crash/restored-worker zero-operator-action server proofs pass. Linked browser/persistent-worker first-flow measurement pending."},
    {"id": "D", "title": "Ineligible sources and mandatory signatures", "status": "NOT_RUN", "actual": "Server and paper UI negative proofs exist; unified whole-scenario action measurement not yet recorded."},
    {"id": "E", "title": "Permitted reviewed external source", "status": "MEASURED", "actual": "Production web04 actual selection-regression04: unknown-date external add+review4clicks5fields1file, later correction2clicks2newfields0files, initially-known source add+review5clicks6fields1file. All three Д scenarios include complete actual action categories/timing and repeatedFields0. Earlier selection/pagination cases remain functional measurements with absent fields explicitly flagged."},
    {"id": "F", "title": "Mixed batch with one error", "status": "MEASURED", "actual": "Actual1/10/100/250 runs preserve successful rows, repair one known employer, retry only failed row;2 clicks+1 keyboard action and0 repeated fields. New identical-name choice extension awaits final execution."},
    {"id": "G", "title": "Unknown provider outcome", "status": "NOT_RUN", "actual": "Real persisted test-adapter UNKNOWN/lookup/no-blind-retry proofs pass; they do not invent an unperformed browser action measurement."},
    {"id": "H", "title": "Ordinary DEMO current regression", "status": "NOT_RUN", "actual": "Current ordinary draft probe passed; full legacy suite pending. Original before measurement excluded by user instruction."},
]
report = {
    "draftOnly": True, "localAccepted": False, "generatedAt": datetime.now(timezone.utc).isoformat(),
    "before": json.loads((destination / "baseline-scope-adjustment.json").read_text(encoding="utf8")),
    "afterCurrentMeasurements": [record for record in records if record.get("actionBudgetEvidence", True)], "requiredSection8Scenarios": section8,
    "functionalOrVisualEvidenceNotActionBudgets": [{"path": p, "exists": (evidence / p).is_file()} for p in additional] + [record for record in records if not record.get("actionBudgetEvidence", True)],
    "finalPending": ["Execute linked first-flow", "Execute full production browser suite with current complete measurement schema", "Do not infer operator/recovery/extension timing from unexecuted newer spec", "Do not claim before/after time saving", "Coordinator must reconcile remaining negative/external/unknown UI action measurements"],
}
current_run = os.environ.get("LMS_UX_CURRENT_RUN", "critical-lms-20261015-01")
batch_run = os.environ.get("LMS_UX_BATCH_RUN", "batch-ambiguity-20261015-02")
current_groups = [
    ("learning", current_run, "lms-learning-live/actions.json", "scenarios", "lms-learning-live.spec.ts", "prepared repeat and learning"),
    ("firstFlow", current_run, "lms-first-flow-live/actions.json", None, "lms-first-flow-live.spec.ts", "complete first entry"),
    ("automatic", current_run, "lms-first-flow-live/automatic-preparation-restart.json", "preparationMetrics", "lms-first-flow-live.spec.ts", "automatic preparation"),
    ("operator", current_run, "lms-operator-live/actions.json", "metrics", "lms-operator-live.spec.ts", "prepared document operation"),
    ("ordinary", current_run, "lms-demo-current-cycle/actions.json", "measurements", "lms-demo-baseline.spec.ts", "current ordinary regression"),
    ("negative", current_run, "lms-negative-states-live/acceptance.json", "measurements", "lms-negative-states-live.spec.ts", "negative and unknown states"),
    ("external", current_run, "lms-selection-regression-live/acceptance.json", "measurements", "lms-selection-regression-live.spec.ts", "external source entry and correction"),
    ("batch", batch_run, "lms-assignment-batches-live/actions.json", "measurements", "lms-assignment-batches-live.spec.ts", "mixed prepared batch"),
    ("ambiguousIdentity", batch_run, "lms-assignment-batches-live/actions.json", "ambiguousSelection", "lms-assignment-batches-live.spec.ts", "explicit ambiguous person selection"),
    ("initialCenterSetup", "first-flow-linked-20261015-03", "lms-first-flow-live/center-template-review.json", None, "lms-first-flow-live.spec.ts", "one-time center template review and approval"),
    ("slowOnline", current_run, "lms-slow-response-live/acceptance.json", "measurements", "lms-slow-response-live.spec.ts", "controlled slow online response"),
    ("copyOriginal", current_run, "lms-copy-original-live/acceptance.json", "measurements", "lms-copy-original-live.spec.ts", "prepared copy of original document"),
]

def passed_file(run, filename):
    results = evidence / "agent-c" / run / "results.json"
    if not results.is_file():
        return False
    def specs(suite):
        yield from suite.get("specs", [])
        for child in suite.get("suites", []):
            yield from specs(child)
    matching = [spec for spec in specs(json.loads(results.read_text(encoding="utf-8-sig"))) if Path(spec.get("file", "").replace("\\", "/")).name == filename]
    return bool(matching) and all(test.get("results") and test["results"][-1].get("status") == "passed" for spec in matching for test in spec.get("tests", []))

def matching_full_suite_pass(run, batch, evidence_root):
    """Only a completed matching mandatory command can clear the full-run task."""
    folder = evidence_root / "agent-c" / run
    command_path, results_path = folder / "command.json", folder / "results.json"
    if run != batch or not command_path.is_file() or not results_path.is_file():
        return False
    command = json.loads(command_path.read_text(encoding="utf-8-sig"))
    results = json.loads(results_path.read_text(encoding="utf-8-sig"))
    expected = command.get("expectedTests")
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 219:
        return False
    stats = results.get("stats", {})
    def test_cases(suite):
        for spec in suite.get("specs", []):
            yield from spec.get("tests", [])
        for child in suite.get("suites", []):
            yield from test_cases(child)
    tests = list(test_cases(results))
    return (
        command.get("runId") == run
        and command.get("command") == "pnpm test:e2e"
        and command.get("status") == "PASS"
        and command.get("exitCode") == 0
        and command.get("testSourceUnchanged") is True
        and bool(command.get("endedAt") or command.get("finishedAt"))
        and stats.get("expected") == expected
        and all(stats.get(key) == 0 for key in ("unexpected", "skipped", "flaky"))
        and results.get("errors") == []
        and len(tests) == expected
        and all(
            test.get("expectedStatus") == "passed"
            and len(test.get("results", [])) == 1
            and test["results"][0].get("status") == "passed"
            for test in tests
        )
    )

current, availability, missing_current = [], {}, []
for group, run, suffix, key, spec, default_phase in current_groups:
    relative = f"agent-c/{run}/{suffix}"
    path = evidence / relative
    availability[group] = False
    if not path.is_file() or not passed_file(run, spec):
        missing_current.append({"group": group, "sourcePath" if path.is_file() else "expectedPath": relative, "reason": "Missing completed measurement or enclosing actual test did not pass."})
        continue
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    raw_items = data.get(key) if key else data
    if raw_items is None:
        missing_current.append({"group": group, "sourcePath": relative, "reason": "Required measurement was not present in this actual historical run; current source code is not execution evidence."})
        continue
    items = raw_items if isinstance(raw_items, list) else [raw_items]
    for index, item in enumerate(items):
        if group == "external" and not str(item.get("scenario", "")).startswith("Д:"):
            continue
        metrics = dict(item.get("counts", {}))
        for field in required + ["selections", "fileSelections", "authenticationRepeatedFields", "businessRepeatedFields"]:
            if field in item:
                metrics[field] = item[field]
        if "fields" in item and "filledFields" not in metrics:
            metrics["filledFields"] = item["fields"]
        added = []
        def mapped(field, aliases=(), descriptive=None):
            if item.get(field) is not None:
                return item[field]
            for alias in aliases:
                if item.get(alias) is not None:
                    added.append({"field": field, "sourceField": alias, "kind": "descriptive alias; numeric values unchanged"})
                    return item[alias]
            if descriptive is not None:
                added.append({"field": field, "kind": "editorial description of the recorded scenario; no numeric inference", "value": descriptive})
            return descriptive
        actual_steps = mapped("actualSteps", ("steps", "actions"))
        scenario = item.get("scenario", default_phase)
        record = {
            "measurementId": f"{relative}#{key or 'root'}/{index}", "group": group, "scenario": scenario,
            "sourcePointer": f"/{key}/{index}" if isinstance(raw_items, list) else f"/{key}" if key else "/",
            "sourcePath": relative, "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "enclosingPassedTest": {"path": f"agent-c/{run}/results.json", "file": spec},
            "role": mapped("role"), "phase": mapped("phase", descriptive=default_phase),
            "goal": mapped("goal", descriptive=scenario),
            "result": mapped("result", descriptive=data.get("status")),
            "startState": mapped("startState", ("startBoundary",)),
            "preconditions": mapped("preconditions", ("prerequisites",), data.get("setup", data.get("prerequisites", item.get("startState")))),
            "actualSteps": actual_steps, "recordedMetrics": metrics,
            "metadataAdd": added, "rawActualRecord": item,
            "timingBoundary": item.get("timingBoundary", "Automated wall time includes verification-only replay and screenshot; not human-only timing." if item.get("verificationOnly") else "Actual automated measurement at the recorded scenario boundary, including explicitly described waits and verification."),
        }
        missing = [field for field in required if field not in metrics]
        missing += [field for field in ["role", "phase", "goal", "result", "startState", "preconditions"] if not record.get(field)]
        if not isinstance(actual_steps, (str, list)):
            missing.append("actualSteps")
        record["missingMeasuredOrDescriptiveFields"] = missing
        record["status"] = "MEASURED_PARTIAL_SCHEMA" if missing else "MEASURED"
        current.append(record)
        availability[group] = True

requirements = {
    "A": ("firstFlow",), "B": ("learning", "operator"), "C": ("automatic",),
    "D": ("negative",), "E": ("external",), "F": ("batch",), "G": ("negative",), "H": ("ordinary",),
}
for scenario in report["requiredSection8Scenarios"]:
    needed = requirements[scenario["id"]]
    matching = [record for record in current if record["group"] in needed]
    ready = all(availability.get(group) for group in needed) and all(not record["missingMeasuredOrDescriptiveFields"] for record in matching)
    scenario["status"] = "PASS" if ready else "NOT_RUN"
    scenario["actual"] = "Actual passing browser tests and their recorded measurements are linked below; this does not establish a passing full suite." if ready else "One or more complete current measurements remain absent or their enclosing browser test has not passed. No absent value is inferred as zero."
    scenario["measurementIds"] = [record["measurementId"] for record in matching]
    scenario["sources"] = [{"sourcePath": record["sourcePath"], "sourceSha256": record["sourceSha256"]} for record in matching]
report["historicalPartialMeasurements"] = report["afterCurrentMeasurements"]
report["afterCurrentMeasurements"] = current
report["missingCurrentMeasurements"] = missing_current
report["completeCurrentMeasurements"] = all(s["status"] == "PASS" for s in report["requiredSection8Scenarios"])
report["currentRun"] = current_run
report["batchRun"] = batch_run
full_suite_passed = matching_full_suite_pass(current_run, batch_run, evidence)
report["matchingMandatoryFullSuitePassed"] = full_suite_passed
acceptance_envelope = os.environ.get("LMS_BROWSER_ACCEPTANCE_ENVELOPE")
browser_acceptance = None
if current_run == batch_run and (full_suite_passed or acceptance_envelope):
    browser_acceptance = validate_browser_acceptance(root, evidence, current_run, acceptance_envelope)
coverage_verified = bool(browser_acceptance and browser_acceptance["coverageVerified"])
report["browserCoverageVerified"] = coverage_verified
report["browserAcceptanceMode"] = browser_acceptance["mode"] if browser_acceptance else "NOT_VERIFIED"
report["browserAcceptance"] = browser_acceptance
report["permanentLimitations"] = ["Original historical browser measurement was excluded by explicit user instruction. No historical before/after time saving is claimed."]
report["finalPending"] = []
if report["requiredSection8Scenarios"][0]["status"] != "PASS":
    report["finalPending"].append("Complete the matching linked first-flow measurement")
if not report["completeCurrentMeasurements"] or missing_current:
    report["finalPending"].append("Complete all required current measurements")
if not coverage_verified:
    report["finalPending"].append("Verify complete matching browser coverage and every affected recheck without rewriting raw command outcomes")
report["finalPending"].append("Bind the reviewed measurements and raw source hashes to the final implementation commit")
report["publicationEvidence"] = "FINAL_PUBLICATION_MANIFEST.json; separately generated audit covers these exact canonical bytes"
(destination / "UX_ACTIONS_DRAFT.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps({"historicalRecords": len(records), "currentMeasurements": len(current), "currentPartialSchemas": sum(bool(r["missingMeasuredOrDescriptiveFields"]) for r in current), "scenarios": {s["id"]: s["status"] for s in report["requiredSection8Scenarios"]}, "missingCurrentGroups": [m["group"] for m in missing_current]}))

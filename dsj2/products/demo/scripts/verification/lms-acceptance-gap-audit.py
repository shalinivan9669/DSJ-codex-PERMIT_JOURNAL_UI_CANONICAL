"""Collect the exact 44/52 definitions and current evidence without declaring acceptance."""
import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = root / "docs/handoffs/2026-10-15-lms-one-run"
evidence = root / "docs/evidence/lms-one-run-20261015"
destination = evidence / "agent-c"
criteria = []
lines = (source / "ACCEPTANCE_AND_VERIFICATION_RU.txt").read_text(encoding="utf-8-sig").splitlines()
requirements = list(csv.DictReader((source / "MVP_COVERAGE.tsv").open(encoding="utf-8-sig"), delimiter="\t"))
assert len(requirements) == 52

proof = {
    "identity": ["agent-c/lms-http-01.log", "agent-c/first-entry-run02/results.json", "agent-a/recovery-race-after.log"],
    "learning": ["agent-c/lms-learning-02.log", "agent-c/learning-run04/results.json"],
    "audit": ["agent-c/lms-audit-03.log", "agent-c/lms-audit-03-command.json", "agent-c/AUDIT_ACCEPTANCE.json"],
    "matrix": ["root-policy-tests.log", "agent-c/lms-http-01.log", "agent-a/accounting-boundaries.log", "agent-a/UNKNOWN_ROLE_ACCEPTANCE.json", "agent-c/lms-audit-03.log"],
    "editor": ["agent-c/first-entry-run02/results.json", "agent-c/first-entry-live/course-actions.json"],
    "materials": ["agent-a/domain-materials-gc.log", "agent-a/PROXY_ACCEPTANCE.json", "agent-a/material-boundaries.log"],
    "video": ["agent-a/video-browser/PLAYBACK_ACCEPTANCE.json", "agent-c/critical-lms-20261015-01/lms-video-live/PLAYBACK_ACCEPTANCE.json", "agent-c/critical-lms-20261015-01/results.json"],
    "boundaries": ["agent-a/exam-boundaries.log", "agent-a/external-exams-final.log", "agent-a/route-calendar-boundaries.log"],
    "exam": ["agent-a/external-exams-final.log", "agent-c/learning-run04/results.json", "agent-a/route-calendar-boundaries.log"],
    "documents": ["root-documents-test.log", "agent-a/document-scheduling.log", "root-document-projection-01.log", "root-document-projection-01.json", "agent-b/operator-run03/results.json", "agent-b/operator-live/actions.json", "agent-b/paper-run04/lms-paper-signature-live/acceptance.json", "root-public-browser/results.json", "agent-a/route-calendar-boundaries.log"],
    "documentVisualReview": ["ROOT_DOCUMENT_VISUAL_REVIEW.json"],
    "sanitary": ["agent-c/lms-regulatory-07.log", "agent-c/lms-regulatory-07-command.json", "agent-a/route-calendar-boundaries.log"],
    "external": ["agent-a/external-manual-evidence.log", "agent-a/external-exams-final.log", "root-external-date-03.log"],
    "ops": ["agent-a/STORAGE_ACCEPTANCE.json", "agent-a/RESTORED_OUTBOX_ACCEPTANCE.json", "agent-c/load-1792017682452.json", "agent-a/accounting-boundaries.log", "agent-c/template-upgrade/acceptance.json", "agent-c/template-upgrade/command03.json", "agent-c/template-upgrade/command03.log"],
    "batch": ["agent-c/targeted-batches-clock-20261015-01/results.json", "agent-c/lms-batches-clock-01-command.json", "agent-c/batch-ambiguity-20261015-02/results.json", "agent-c/batch-ambiguity-20261015-02/lms-assignment-batches-live/actions.json"],
    "identitySelection": ["agent-c/lms-identity-selection-01.log", "agent-c/lms-identity-selection-01-command.json", "agent-c/AMBIGUOUS_SELECTION_ACCEPTANCE.json"],
    "legacyOutcome": ["agent-c/lms-legacy-outcome-01.log", "agent-c/lms-legacy-outcome-01-command.json", "agent-c/LEGACY_AUTO_BOUNDARY_ACCEPTANCE.json"],
    "geometry": ["agent-b/geometry-run01/lms-geometry-live/geometry.json"],
    "gates": ["PERSONAL_DATA_DEPLOYMENT_GATES_RU.txt", "PROVIDER_CONNECTION_PACKET_RU.txt", "root-policy-tests.log", "EXTERNAL_GATES.json"],
    "roleScope": ["agent-c/conditional-instructor-scope.json", "agent-a/UNKNOWN_ROLE_ACCEPTANCE.json", "agent-a/accounting-boundaries.log"],
    "signing": ["command-test-05.log"],
    "sanitaryVisual": ["agent-c/sanitary-files-1792014509550/visual-review.json"],
}
mapping = {
    "L01": ["identity"], "L02": ["matrix", "documents", "roleScope"], "L03": ["identity", "learning", "documents", "roleScope"],
    "L04": ["editor", "learning", "boundaries"], "L05": ["materials"], "L06": ["materials", "video"],
    "L07": ["learning", "video", "documents", "ops", "batch"], "L08": ["learning", "batch", "identitySelection"],
    "L09": ["learning", "geometry"], "L10": ["identity", "learning", "ops", "audit"],
    "E01": ["boundaries", "editor"], "E02": ["exam"], "E03": ["exam", "batch", "boundaries"],
    "E04": ["exam"], "E05": ["boundaries"], "E06": ["boundaries"],
    "E07": ["exam", "external", "documents", "legacyOutcome"], "E08": ["documents"], "E09": ["documents", "signing"],
    "E10": ["documents"], "E11": ["documents", "sanitary", "external"], "E12": ["documents", "documentVisualReview", "sanitaryVisual"],
    "S01": ["sanitary", "external", "exam", "legacyOutcome"], "S02": ["sanitary", "ops"],
    "S03": ["sanitary", "external", "editor"], "S04": ["sanitary"], "S05": ["sanitary", "ops"],
    "S06": ["sanitary"], "S07": ["sanitary"], "S08": ["sanitary"], "S09": ["sanitary", "gates", "geometry"],
    "S10": ["sanitary", "external", "sanitaryVisual"], "S11": ["ops", "batch"], "S12": ["gates"],
    "UX01": ["documents"], "UX02": ["learning", "documents"], "UX03": ["learning", "documents", "batch"],
    "UX04": ["editor", "learning", "batch"], "UX05": ["batch"], "UX06": ["sanitary", "geometry"],
    "UX07": ["geometry", "documents"], "UX08": ["learning", "identity", "batch"],
    "UX09": ["learning", "geometry", "batch"], "UX10": ["editor", "learning", "documents", "batch"],
}
pending = {
    "L04": ["Actual critical first-flow reached course/PDF/exam and worker restart, then exposed a real document snapshot name-fallback mismatch. Root fix and targeted regression pass; complete fresh first-flow must rerun on the rebuilt API."],
    "L06": ["Actual critical video test now passed including logout/login; bind this exact evidence to final source."],
    "L07": ["Linked first-flow text/PDF and exam were reached, but the enclosing whole flow failed later at document preparation. Complete fresh rerun remains required."],
    "L08": ["Actual complete batch-ambiguity-02 passed all four group sizes and explicit selection by distinguishing visible person data. Complete mandatory suite remains pending."],
    "L10": ["Actual audit/permission/restart tests now pass; final source/runtime manifest and all-log privacy reconciliation by coordinator remain."],
    "E03": ["Include new expiry/restart race test with latest client-clock UI proof in final source binding."],
    "E08": ["Final full DEMO regression and linked first-entry flow await execution."],
    "E10": ["Linked first-flow actual UI QR publication awaits execution; separate public24-view and exact paper binding browser evidence pass."],
    "E12": ["Full render and mandatory complete browser command still pending; no final criterion PASS."],
    "S02": ["Persistent local integration worker / linked first-flow list execution pending; restored independent worker PASS already recorded."],
    "S11": ["Full integration02 passed280/280 with quiet100-learner load; final production build02 passed. Full browser03 stopped after portal fixture failure, targeted portal correction passed; complete fresh browser command and final renderer evidence remain to bind."],
    "S12": ["Coordinator to publish final EXTERNAL_GATES and reconcile P01-P13 with final policy tests."],
    "UX01": ["Complete current DEMO regression pending. Original browser baseline explicitly excluded by user; no before/after timing claim."],
    "UX04": ["Final unchanged old DEMO autosave/manual/imported/cleared regression pending."],
    "UX06": ["Linked first-entry automatic sanitary flow pending; internal no-UI worker assertions already pass."],
    "UX10": ["New linked first-entry test measures whole course/people/exam/documents/sanitary chain; execution pending.", "Merge all UX schemas with explicit keyboard/fields/repeated/decisions/navigation/dialogs/manualRefresh/time and separate participant decisions.", "Original browser baseline excluded by user; retain NOT_RUN subcase with scope adjustment."],
}
for index, line in enumerate(lines):
    match = re.match(r"^((?:L|E|S)\d{2}|UX\d{2}) — (.+)$", line)
    if not match:
        continue
    key, title = match.groups()
    paths = list(dict.fromkeys(p for category in mapping[key] for p in proof[category]))
    criteria.append({"criterionId": key, "title": title, "requirementIds": [row["ID"] for row in requirements if key in row["Приёмка"].split(";")],
        "sourceDefinition": lines[index + 1], "auditStatus": "EVIDENCE_COLLECTED_NOT_FINAL_ACCEPTANCE",
        "existingEvidencePaths": [p for p in paths if (evidence / p).is_file()],
        "missingIndexedPaths": [p for p in paths if not (evidence / p).is_file()],
        "remainingChecks": pending.get(key, ["Coordinator final review of every mandatory subcase and bind results to delivered tree."])})
assert len(criteria) == 44 and len({row["criterionId"] for row in criteria}) == 44
scope = {"subcase": "Original fresh browser baseline before LMS implementation", "status": "NOT_RUN",
    "excludedByUserInstruction": True, "instruction": "Продолжить без исходного браузерного замера",
    "instructionReportedByCoordinator": True,
    "documentGeneratedAtUtc": datetime.now(timezone.utc).isoformat(),
    "userInstructionTimestampUtc": None,
    "timestampMeaning": "This is report-generation time, not the time of the user's message. Agent C received the exact quote from the coordinator; original message timestamp is not supplied in this evidence.",
    "actualRetainedEvidence": ["agent-c/baseline-build-command.json", "agent-c/baseline-build.log", "agent-c/baseline-db-deploy.log"],
    "archivedBaseCommit": "8c0833407675d8d31c786f37a55572357d7b9805",
    "archiveSha256": "4D1AE93537DF142928C55E3816AF352475F9A49783C56F35851D8B464CEA5577",
    "ordinaryDraftProbeCaveat": "agent-c/baseline was current development code with LMS navigation already integrated; it is not a preimplementation browser measurement.",
    "noBeforeAfterTimeSavingClaim": True}
(destination / "baseline-scope-adjustment.json").write_text(json.dumps(scope, ensure_ascii=False, indent=2), encoding="utf-8")
report = {"purpose": "Independent gap map for coordinator; does not declare LOCAL_ACCEPTED or replace final 44/52 artifacts.",
    "checkedAt": datetime.now(timezone.utc).isoformat(), "criteriaCount": 44, "requirementCount": 52,
    "localRequirements": len([r for r in requirements if not r["ID"].startswith("EXT")]),
    "externalRequirements": [{"id": r["ID"], "status": "BLOCKED_EXTERNAL_INPUTS", "requiredInputs": r["Ограничения и входы"]} for r in requirements if r["ID"].startswith("EXT")],
    "baselineScopeAdjustment": scope, "criteria": criteria}
(destination / "acceptance-gap-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"criteria": len(criteria), "requirements": len(requirements), "local": report["localRequirements"], "missingIndexedPaths": sorted({p for r in criteria for p in r["missingIndexedPaths"]})}))

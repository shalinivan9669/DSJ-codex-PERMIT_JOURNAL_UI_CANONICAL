"""Publish exact reviewed evidence only after verified complete browser case coverage.

This offline reviewer never discovers files recursively, runs a browser, edits
source evidence, changes acceptance status, or overwrites an existing report.
See --help. The selection JSON supplies files [{path, sha256}], entrypoints,
and any exact, independently reviewed non-secret scanner matches.
"""

import argparse
import hashlib
import importlib.util
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path


PRODUCT = Path(__file__).resolve().parents[2]
EVIDENCE = PRODUCT / "docs/evidence/lms-one-run-20261015"
REFERENCE_KEYS = {
    "evidencePaths", "sourcePath", "sourcePaths", "logPath", "logPaths",
    "recordPath", "reportPath", "reportPaths", "runtimeManifest",
    "discoveryManifest",
}
TEXT_SUFFIXES = {".json", ".txt", ".log", ".md", ".jsonl", ".tsv"}
REVIEWED_FIXTURE_SUMMARIES = {
    # Entire actual diagnosis read by Agent A; this exact summary contains no
    # raw account/fixture setup. Any byte change requires a new explicit review.
    "agent-b/DOMAIN_GRADE_FIXTURE_REVIEW.json": "4c05fb7ce2906571444baf8e804e83a459bad942025fc3cb99695d5880ad247a",
    "agent-b/PHOTO_FIXTURE_CANDIDATE_REVIEW_07.json": "3f96c109864f47350411dddaa687d8518e7097e9e2310c03960d17d54d07d947",
    "agent-b/PHOTO_FIXTURE_PATCH_PROPOSAL_07.json": "dc77596b6379d4c453e9d950d073260cdbe18d4a5202ba2c6fcf986c28df9fcf",
}
RULES = {
    "syntheticCredential": re.compile(r"Synthetic-LMS-only-\d{8}!"),
    "bearerValue": re.compile(r"\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}"),
    "privateKey": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "passwordDatabaseUrl": re.compile(r"postgres(?:ql)?://[^:\s/]+:[^@\s]+@", re.I),
    "tokenUrl": re.compile(r"(?:[?&](?:token|secret)=|/(?:invite|recovery)/)[A-Za-z0-9_-]{16,}", re.I),
    "credentialAssignment": re.compile(
        r'''["']?(?:password|accessToken|refreshToken|csrfToken|sessionToken|client_secret|private_key|api_key|authorization)["']?\s*[:=]\s*["'](?!REDACTED|\[REDACTED\]|<redacted>|false|true|null|none|\s*["'])[^"'\r\n]{5,}["']''', re.I
    ),
    "serializedAnswerKey": re.compile(r'"correctOptionIds"\s*:\s*\[\s*"'),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fail(code):
    # Never include matching values or raw command/environment text in errors.
    raise RuntimeError(code)


def within(base, relative):
    normalized = str(relative).replace("\\", "/")
    path = (base / normalized).resolve()
    if not path.is_relative_to(base.resolve()) or not path.is_file():
        fail("MISSING_OR_OUTSIDE_EXPLICIT_ROOT:" + normalized)
    return path


def read(relative):
    return json.loads(within(EVIDENCE, relative).read_text(encoding="utf-8-sig"))


def bound(relative):
    data = within(EVIDENCE, relative).read_bytes()
    return {"path": relative, "bytes": len(data), "sha256": sha(data)}


def cases(suite):
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            yield (spec["id"], test["projectId"]), test
    for child in suite.get("suites", []):
        yield from cases(child)


def validated_browser(run_id, envelope_path=None):
    module_path = PRODUCT / "scripts/verification/lms_browser_acceptance.py"
    spec = importlib.util.spec_from_file_location("lms_browser_acceptance", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate_browser_acceptance(PRODUCT, EVIDENCE, run_id, envelope_path)


def completed_browser(run_id, envelope_path=None):
    acceptance = validated_browser(run_id, envelope_path)
    return acceptance["rawFullCommand"]["stats"], {item["path"] for item in acceptance["requiredEvidence"]}


def forbidden(relative):
    path = Path(relative)
    parts = {p.lower() for p in path.parts}
    name = path.name.lower()
    approved_summary = (
        relative in REVIEWED_FIXTURE_SUMMARIES
        and sha(within(EVIDENCE, relative).read_bytes()) == REVIEWED_FIXTURE_SUMMARIES[relative]
    )
    return (
        bool(parts & {"test-results", ".runtime", "pre-final-render-files", "traces"})
        or any(p.startswith(".playwright-artifacts") for p in parts)
        or "fixture" in name and not approved_summary
        or name.endswith("checkpoint.json")
        or name in {"first-flow-command-rejection.json", "first-flow-command-rejection-02.json"}
        or name.startswith("runtime-api") or name.startswith("runtime-web")
        or name.startswith("runtime-render") or name.startswith("runtime-integration")
        or name.startswith("worker-") and name.endswith(".log")
        or name.endswith((".cjs", ".cjs.txt", ".zip", ".mp4", ".dump", ".bak"))
        or name == "error-context.md"
    )


def reference_values(value, pointer=""):
    if isinstance(value, dict):
        for key, item in value.items():
            at = pointer + "/" + key
            if key in REFERENCE_KEYS:
                if isinstance(item, str):
                    yield at, item
                elif isinstance(item, list):
                    for index, entry in enumerate(item):
                        if isinstance(entry, str):
                            yield at + "/" + str(index), entry
            yield from reference_values(item, at)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from reference_values(item, pointer + "/" + str(index))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("browser", "final"))
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--acceptance-envelope", help="Exact reviewed affected-case reconciliation; raw full command status is retained")
    parser.add_argument("--selection", type=Path, required=True, help="Explicit reviewed file hashes, entrypoints, and optional exact-match review annotations")
    parser.add_argument("--initial-sha256", required=True)
    parser.add_argument("--code-manifest", type=Path, help="Explicit code paths/hashes for source references pending coordinator commit binding")
    args = parser.parse_args()
    if not re.fullmatch(r"full-e2e-\d{8}-\d+", args.run_id):
        fail("INVALID_RUN_ID")
    initial_path = "EVIDENCE_PUBLICATION_FINAL_REVIEW.json"
    initial_bytes = within(EVIDENCE, initial_path).read_bytes()
    if sha(initial_bytes) != args.initial_sha256.lower():
        fail("IMMUTABLE_INITIAL_REVIEW_CHANGED")
    initial = json.loads(initial_bytes)
    if initial.get("status") != "PASS":
        fail("INITIAL_REVIEW_NOT_PASS")
    # Shared guard runs before scanning or writing. A failed full invocation
    # is accepted only with exact reviewed affected-case PASS reconciliation.
    acceptance = validated_browser(args.run_id, args.acceptance_envelope)
    stats = acceptance["rawFullCommand"]["stats"]
    required = {item["path"] for item in acceptance["requiredEvidence"]}
    selection = json.loads(args.selection.read_text(encoding="utf-8-sig"))
    entries = selection["files"]
    if not entries or len({x["path"] for x in entries}) != len(entries):
        fail("EMPTY_OR_DUPLICATE_SELECTION")
    names = {x["path"] for x in entries}
    if not required.issubset(names):
        fail("MANDATORY_BROWSER_EVIDENCE_NOT_SELECTED")
    selected_hashes = {item["path"]: item["sha256"].lower() for item in entries}
    if any(selected_hashes[item["path"]] != item["sha256"] for item in acceptance["requiredEvidence"]):
        fail("VALIDATED_BROWSER_EVIDENCE_SELECTION_CHANGED")
    output_name = "FULL_BROWSER_PUBLICATION_REVIEW.json" if args.stage == "browser" else "FINAL_PUBLICATION_MANIFEST.json"
    if output_name in names or (EVIDENCE / output_name).exists():
        fail("SELF_HASH_CYCLE_OR_REPORT_ALREADY_EXISTS")
    inherited = {x["path"]: x["sha256"] for x in initial["selectedFiles"]}
    if args.stage == "final":
        previous = read("FULL_BROWSER_PUBLICATION_REVIEW.json")
        if previous.get("status") != "PASS" or previous.get("runId") != args.run_id:
            fail("FRESH_BROWSER_PRIVACY_REVIEW_MISSING")
        if previous.get("browserAcceptance") != acceptance or previous.get("browserAcceptanceEnvelope") != args.acceptance_envelope:
            fail("REVIEWED_BROWSER_ACCEPTANCE_CHANGED")
        for item in previous["files"]:
            if bound(item["path"])["sha256"] != item["sha256"]:
                fail("REVIEWED_BROWSER_FILE_CHANGED:" + item["path"])
            inherited[item["path"]] = item["sha256"]
        if not {initial_path, "FULL_BROWSER_PUBLICATION_REVIEW.json"}.issubset(names):
            fail("FINAL_MANIFEST_MUST_INCLUDE_PRIOR_IMMUTABLE_REVIEWS")
    approved_matches = selection.get("reviewedNonSecretMatches", [])
    findings, matched_reviews, files, document_checks = [], [], [], []

    def scan(relative, content, digest):
        for rule, pattern in RULES.items():
            for hit in pattern.finditer(content):
                line = content.count("\n", 0, hit.start()) + 1
                approval = next((x for x in approved_matches if x.get("path") == relative and x.get("sha256") == digest and x.get("rule") == rule and x.get("line") == line and x.get("reason") and x.get("reviewer")), None)
                record = {"path": relative, "rule": rule, "line": line, "sha256": digest}
                if approval:
                    matched_reviews.append({**record, "reason": approval["reason"], "reviewer": approval["reviewer"]})
                else:
                    findings.append(record)

    for entry in sorted(entries, key=lambda x: x["path"]):
        relative = entry["path"]
        if forbidden(relative):
            fail("FORBIDDEN_PRIVATE_SELECTION:" + relative)
        path = within(EVIDENCE, relative)
        data = path.read_bytes()
        digest = sha(data)
        if digest != entry["sha256"].lower():
            fail("SELECTION_CHANGED_SINCE_REVIEW:" + relative)
        suffix = path.suffix.lower()
        if suffix in TEXT_SUFFIXES:
            text = data.decode("utf-8-sig")
            if suffix == ".json":
                json.loads(text)
            scan(relative, text, digest)
        elif suffix in {".docx", ".xlsx"}:
            with zipfile.ZipFile(path) as archive:
                members = archive.namelist()
                if any("vba" in n.lower() or "/embeddings/" in n.lower() for n in members):
                    fail("UNREVIEWED_ACTIVE_OR_EMBEDDED_CONTENT:" + relative)
                for member in members:
                    if member.endswith((".xml", ".rels", ".json")):
                        scan(relative + "::" + member, archive.read(member).decode("utf-8-sig"), digest)
            if suffix == ".xlsx":
                from openpyxl import load_workbook
                workbook = load_workbook(path, read_only=True, data_only=False)
                if workbook._external_links:
                    fail("WORKBOOK_EXTERNAL_LINKS:" + relative)
                cells = [v for sheet in workbook for row in sheet.values for v in row if v is not None]
                if any(isinstance(v, str) and v.startswith("=") for v in cells):
                    fail("WORKBOOK_FORMULA_REQUIRES_SEPARATE_REVIEW:" + relative)
                scan(relative + "::cells", "\n".join(map(str, cells)), digest)
                document_checks.append({"path": relative, "cells": len(cells), "formulas": 0, "externalLinks": 0})
        elif suffix == ".pdf":
            from pypdf import PdfReader
            pdf = PdfReader(path)
            if pdf.is_encrypted or list(pdf.attachments):
                fail("UNREVIEWED_PDF_ENCRYPTION_OR_ATTACHMENTS:" + relative)
            scan(relative, "\n".join(p.extract_text() or "" for p in pdf.pages), digest)
            scan(relative + "::metadata", str(dict(pdf.metadata or {})), digest)
            document_checks.append({"path": relative, "pages": len(pdf.pages), "attachments": 0})
        elif suffix != ".png":
            fail("UNSUPPORTED_SELECTION_FORMAT:" + relative)
        if suffix not in TEXT_SUFFIXES and inherited.get(relative) != digest:
            review = entry.get("contentReview", {})
            if review.get("actuallyReviewed") is not True or not review.get("reviewer") or not review.get("method"):
                fail("NEW_MEDIA_REQUIRES_ACTUAL_CONTENT_REVIEW:" + relative)
        files.append({"path": relative, "bytes": len(data), "sha256": digest})
    if findings:
        print(json.dumps({"status": "SCAN_FAILED_NO_REPORT_WRITTEN", "findings": findings}, ensure_ascii=False))
        fail("SELECTED_SECRET_SCAN_FINDINGS")

    code = {}
    if args.code_manifest:
        for item in json.loads(args.code_manifest.read_text(encoding="utf-8-sig"))["files"]:
            if sha(within(PRODUCT, item["path"]).read_bytes()) != item["sha256"].lower():
                fail("CODE_MANIFEST_CHANGED:" + item["path"])
            code[item["path"]] = item["sha256"]
    closure, missing = [], []
    entrypoints = selection.get("entrypoints", [])
    if args.stage == "final" and not entrypoints:
        fail("FINAL_DEPENDENCY_ENTRYPOINTS_REQUIRED")
    for entrypoint in entrypoints:
        if entrypoint not in names:
            fail("DEPENDENCY_ENTRYPOINT_NOT_SELECTED:" + entrypoint)
        for pointer, target in reference_values(read(entrypoint)):
            normalized = target.replace("\\", "/").split("#", 1)[0]
            for prefix in (str(EVIDENCE).replace("\\", "/") + "/", "docs/evidence/lms-one-run-20261015/"):
                if normalized.startswith(prefix):
                    normalized = normalized[len(prefix):]
            if normalized.startswith(str(PRODUCT).replace("\\", "/") + "/"):
                normalized = normalized[len(str(PRODUCT)) + 1:]
            item = {"referrer": entrypoint, "jsonPointer": pointer, "target": target}
            if normalized in names:
                closure.append({**item, "resolution": "EXACT_SELECTED_EVIDENCE", "path": normalized})
            elif normalized in code:
                closure.append({**item, "resolution": "EXPLICIT_CODE_SOURCE_MANIFEST", "path": normalized, "sha256": code[normalized]})
            else:
                # A historical missing measurement may remain honest metadata
                # under expectedPath/status NOT_RUN. It cannot masquerade as a
                # published evidence/source/log reference through an exemption.
                missing.append(item)
    if missing:
        print(json.dumps({"status": "DEPENDENCY_GAPS_NO_REPORT_WRITTEN", "missing": missing}, ensure_ascii=False))
        fail("REFERENCES_NOT_SELECTED_OR_CODE_BOUND")
    replacements = []
    for item in files:
        previous = inherited.get(item["path"])
        if previous and previous != item["sha256"]:
            replacements.append({"path": item["path"], "reviewedPreviousSha256": previous, "newlyReviewedSha256": item["sha256"], "previousBytesRetained": "Consult review-snapshots/INITIAL_SELECTED_MUTABLE_SNAPSHOTS.json; no historical bytes reconstructed"})
    # Check hashes once more immediately before writing the immutable report.
    if sha(within(EVIDENCE, initial_path).read_bytes()) != args.initial_sha256.lower():
        fail("INITIAL_REVIEW_CHANGED_DURING_SCAN")
    if any(bound(x["path"])["sha256"] != x["sha256"] for x in files):
        fail("SELECTED_FILE_CHANGED_DURING_SCAN")
    if any(bound(item["path"])["sha256"] != item["sha256"] for item in acceptance["requiredEvidence"]):
        fail("VALIDATED_BROWSER_EVIDENCE_CHANGED_DURING_SCAN")
    report = {
        "status": "PASS", "runId": args.run_id, "stage": args.stage,
        "reviewedAtUtc": datetime.now(timezone.utc).isoformat(),
        "scope": "Privacy of exact selected bytes and explicit reference closure only; this is not overall functional or production acceptance.",
        "overallAcceptance": False, "localAccepted": False,
        "initialReview": {"path": initial_path, "sha256": args.initial_sha256.lower()},
        "actualFullBrowserStats": stats, "browserAcceptance": acceptance,
        "browserAcceptanceEnvelope": args.acceptance_envelope, "selectedCount": len(files),
        "scan": {"findings": [], "ruleNames": list(RULES), "reviewedNonSecretMatches": matched_reviews, "documentChecks": document_checks},
        "dependencyClosure": {"entrypoints": entrypoints, "references": closure, "unresolved": []},
        "replacementHistory": replacements,
        "exclusions": "No recursive folder publication, raw fixtures/ZIP, traces, private runtime/session/worker logs, credential-bearing rejected commands or .cjs helpers. Private references must be rewritten to reviewed sanitized summaries before this script accepts closure.",
        "selfHashCycle": False, "files": files,
    }
    if args.stage == "final":
        report["selectedFiles"] = files
    # Exclusive creation preserves the prior report, including a prior run ID.
    with (EVIDENCE / output_name).open("x", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({"status": "PASS", "report": output_name, "sha256": bound(output_name)["sha256"], "files": len(files)}))


if __name__ == "__main__":
    main()

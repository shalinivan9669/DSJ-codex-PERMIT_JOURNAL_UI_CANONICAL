"""Read-only integrity/scope check for the LMS implementation handoff, Python 3.10+."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath


def main() -> int:
    root = Path(__file__).resolve().parent
    errors: list[str] = []
    manifest_path = root / "PACKAGE_MANIFEST.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(json.dumps({"passed": False, "errors": [str(exc)]}, ensure_ascii=True))
        return 1
    expected: set[str] = set()
    for entry in manifest.get("files", []):
        name = entry.get("path", "")
        rel = PurePosixPath(name)
        if not name or rel.is_absolute() or ".." in rel.parts or "\\" in name or ":" in name:
            errors.append(f"Unsafe manifest path: {name!r}")
            continue
        if name in expected:
            errors.append(f"Duplicate manifest path: {name}")
            continue
        expected.add(name)
        file = root.joinpath(*rel.parts)
        if not file.is_file() or not file.resolve().is_relative_to(root):
            errors.append(f"Missing or external file: {name}")
            continue
        data = file.read_bytes()
        if len(data) != entry.get("bytes"):
            errors.append(f"Size mismatch: {name}")
        if hashlib.sha256(data).hexdigest().upper() != entry.get("sha256"):
            errors.append(f"SHA256 mismatch: {name}")
        if file.suffix in {".txt", ".tsv", ".json", ".py"}:
            try:
                content = data.decode("utf-8")
                if "\ufffd" in content:
                    errors.append(f"Replacement character: {name}")
            except UnicodeDecodeError:
                errors.append(f"Not UTF-8: {name}")
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
    extras = actual - expected - {"PACKAGE_MANIFEST.json"}
    if extras:
        errors.append("Unlisted files: " + ", ".join(sorted(extras)))
    required = {
        "00_START_HERE_RU.txt", "LAUNCH_PROMPT_RU.txt", "PROMPT_IMPLEMENT_LMS_ONE_RUN_RU.txt",
        "TZ_LMS_MVP_RU.txt", "IMPLEMENTATION_DETAILS_RU.txt", "MVP_COVERAGE.tsv",
        "UX_OPERATOR_CONTRACT_RU.txt", "ACCEPTANCE_AND_VERIFICATION_RU.txt",
        "SOURCE_BASELINE_RU.txt", "EXTERNAL_INPUTS_AND_RELEASE_GATES_RU.txt",
        "LEGAL_AND_PROVIDER_RU.txt", "EVIDENCE_INDEX_RU.txt", "SOURCE_LMS_REQUIREMENTS.docx",
        "SOURCE_EXTRACT.txt", "MODEL_AND_RUN_NOTES_RU.txt", "PACKAGE_QA_RU.txt", "verify_package.py", ".gitattributes",
    }
    if expected != required:
        errors.append(f"Manifest file set differs: missing={sorted(required-expected)}, extra={sorted(expected-required)}")
    row_count = 0
    criterion_count = 0
    try:
        with (root / "MVP_COVERAGE.tsv").open(encoding="utf-8", newline="") as file:
            rows = list(csv.DictReader(file, delimiter="\t"))
        row_count = len(rows)
        ids = [r["ID"] for r in rows]
        wanted = {f"{prefix}{i:02}" for prefix, count in [("MVP", 25), ("SAN", 12), ("OPS", 2), ("UX", 10), ("EXT", 3)] for i in range(1, count+1)}
        if len(ids) != 52 or len(set(ids)) != 52 or set(ids) != wanted:
            errors.append("Coverage IDs differ from the agreed 52 requirements")
        for row in rows:
            if len(row) != 9 or any(v is None or not v.strip() for v in row.values()):
                errors.append(f"Malformed coverage row: {row.get('ID')}")
            status = "BLOCKED_EXTERNAL_INPUTS" if row["ID"].startswith("EXT") else "NOT_RUN"
            if row["Исходный статус"] != status:
                errors.append(f"Initial status changed: {row['ID']}")
        acceptance = (root / "ACCEPTANCE_AND_VERIFICATION_RU.txt").read_text(encoding="utf-8")
        definitions = re.findall(r"^(L\d{2}|E\d{2}|S\d{2}|UX\d{2})(?=[\s.:—–])", acceptance, re.M)
        criterion_count = len(definitions)
        wanted_criteria = {f"{prefix}{i:02}" for prefix, count in [("L", 10), ("E", 12), ("S", 12), ("UX", 10)] for i in range(1, count+1)}
        if len(definitions) != 44 or set(definitions) != wanted_criteria:
            errors.append("Acceptance definitions differ from the required 44 criteria")
        for row in rows:
            referenced = set(re.findall(r"\b(?:L|E|S|UX)\d{2}\b", row["Приёмка"]))
            if referenced - wanted_criteria:
                errors.append(f"Unknown acceptance reference: {row['ID']}")
        original = root / "SOURCE_LMS_REQUIREMENTS.docx"
        if hashlib.sha256(original.read_bytes()).hexdigest().upper() != manifest["source_docx_sha256"]:
            errors.append("Original DOCX hash differs")
        with zipfile.ZipFile(original) as docx:
            if docx.testzip() is not None or "word/document.xml" not in docx.namelist():
                errors.append("Invalid original DOCX")
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        errors.append(f"Content check failed: {exc}")
    result = {
        "passed": not errors,
        "files_checked": len(expected),
        "coverage_rows": row_count,
        "acceptance_definitions": criterion_count,
        "application_implemented_or_tested": False,
        "scope": "package integrity and requirement inventory only",
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())

"""Read-only audit of files downloaded by the real browser company scenario."""

import hashlib
import json
from pathlib import Path
import sys
import zipfile

from openpyxl import load_workbook


evidence = Path(sys.argv[1]).resolve()
result = json.loads((evidence / "company-12-18-result.json").read_text(encoding="utf-8"))
artifacts = result["artifacts"]
assert len(artifacts) == 38
counts = {kind: sum(a["format"] == kind for a in artifacts) for kind in ("DOCX", "PDF", "XLSX", "ZIP")}
assert counts == {"DOCX": 18, "PDF": 18, "XLSX": 1, "ZIP": 1}
for artifact in artifacts:
    content = (evidence / artifact["file"]).read_bytes()
    assert len(content) == artifact["size"]
    assert hashlib.sha256(content).hexdigest() == artifact["sha256"]

archive = next(a for a in artifacts if a["format"] == "ZIP")
with zipfile.ZipFile(evidence / archive["file"]) as bundle:
    manifest = json.loads(bundle.read("manifest.json"))
    assert manifest["complete"] is True
    assert len(manifest["files"]) == 37
    for member in manifest["files"]:
        content = bundle.read(member["file"])
        assert hashlib.sha256(content).hexdigest() == member["sha256"]
        assert len(content) == member["size"]
        standalone = next(a for a in artifacts if a["id"] == member["id"])
        assert standalone["sha256"] == member["sha256"]
    assert len(bundle.namelist()) == 39

spreadsheet = next(a for a in artifacts if a["format"] == "XLSX")
book = load_workbook(evidence / spreadsheet["file"], read_only=True, data_only=False)
sheet = book.active
rows = list(sheet.iter_rows(values_only=True))
assert len(rows) == 19
header = rows[0]
assert len(header) == 28
flat = {str(value) for row in rows[1:] for value in row if value is not None}
for document in result["documents"]:
    assert document["number"] in flat
    if document["registrationNumber"]:
        assert document["registrationNumber"] in flat
assert all(cell.data_type != "f" for row in sheet.iter_rows() for cell in row)
book.close()

summary = {
    "requestId": result["requestId"],
    "status": "PASS",
    "downloadedArtifacts": counts,
    "standaloneSha256Checked": len(artifacts),
    "zip": {"members": 39, "manifestFiles": 37, "complete": True, "hashesAndSizesMatch": True},
    "xlsx": {"dataRows": 18, "columns": 28, "allIssuedNumbersPresent": True, "psWitnessAndRegistrationPresent": True, "formulaCells": 0},
    "limitation": "Files belong to the v5 browser cycle. Visual print conformance is a separate gate; final v6 person workflow is retested separately.",
}
(evidence / "company-export-audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))

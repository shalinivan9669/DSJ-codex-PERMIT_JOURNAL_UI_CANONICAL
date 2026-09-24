"""Verify a success-only open/export check cannot mask page/text failures."""
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
output = root / "negative-controls"
output.mkdir(exist_ok=True)
inputs = root.parent / "printing" / "word-final-v11"
exports = root / "final-v11"
controls = [
    ("wrong-page-count", "biot-protocol-short", "biot-protocol-short", 999, "WORD_PDF_PAGE_COUNT_MISMATCH"),
    ("wrong-document-text", "biot-itr-certificate-short", "biot-protocol-short", 1, "SOURCE_WORDS_MISSING_IN_PDF"),
]
results = []
for name, source, pdf, pages, error in controls:
    target = output / (name + ".json")
    run = subprocess.run([sys.executable, "-X", "utf8", str(root / "audit-word-pdf.py"), "--source", str(inputs / (source + ".docx")), "--pdf", str(exports / (pdf + ".word.pdf")), "--word-pages", str(pages), "--word-text", str(exports / (pdf + ".word-body.txt")), "--output", str(target)], capture_output=True, text=True, encoding="utf-8")
    result = json.loads(target.read_text(encoding="utf-8"))
    passed = run.returncode == 1 and error in result["errors"]
    results.append(dict(control=name, status="PASS" if passed else "FAIL", expectedError=error, actualErrors=result["errors"], exitCode=run.returncode))
(output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
assert all(r["status"] == "PASS" for r in results), results
print(json.dumps(results))

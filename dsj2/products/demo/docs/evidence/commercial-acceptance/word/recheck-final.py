"""Audit already-exported immutable Word PDFs after a checker correction."""
import json
from pathlib import Path
import subprocess
import sys
import hashlib
import pypdfium2 as pdfium

root = Path(__file__).resolve().parent
inputs = root.parent / "printing" / "word-final-v11"
output = root / "final-v11"
results_path = output / "word-results.json"
results = json.loads(results_path.read_text(encoding="utf-8-sig"))
backup = output / "word-results-before-watermark-check-fix.json"
if not backup.exists(): backup.write_bytes(results_path.read_bytes())
manifest = json.loads((inputs / "manifest.json").read_text(encoding="utf-8-sig"))
manifest_by_name = {Path(f["docxPath"]).name: f for f in manifest["files"]}
rendered = []
for item in results["documents"]:
    stem = Path(item["file"]).stem
    source, pdf = inputs / item["file"], output / (stem + ".word.pdf")
    audit_path = output / (stem + ".audit.json")
    pages = json.loads(audit_path.read_text(encoding="utf-8"))["wordPages"]
    check = subprocess.run([sys.executable, "-X", "utf8", str(root / "audit-word-pdf.py"), "--source", str(source), "--pdf", str(pdf), "--word-pages", str(pages), "--word-text", str(output / (stem + ".word-body.txt")), "--output", str(audit_path), "--reference-pdf", str(inputs / (stem + ".pdf"))], check=False)
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    pinned = manifest_by_name[item["file"]]
    assert audit["sourceSha256"] == pinned["docxSha256"] == item["docxSha256"]
    assert hashlib.sha256((inputs / (stem + ".pdf")).read_bytes()).hexdigest() == pinned["pdfSha256"]
    item.update(status=audit["status"], pages=pages, pdfPages=audit["pdfPages"], expectedWords=audit["expectedUniqueWords"], pdf=pdf.name, audit=audit_path.name, pdfSha256=audit["pdfSha256"], referencePdfSha256=pinned["pdfSha256"], templateVersion=pinned["version"], templateSha256=pinned["templateSha256"], visualReview="REQUIRED_SEPARATELY")
    item.pop("error", None)
    if check.returncode: item["error"] = ", ".join(audit["errors"])
    with pdfium.PdfDocument(pdf) as document:
        for i, page in enumerate(document):
            png = output / (stem + f".page-{i + 1}.png")
            page.render(scale=1.6).to_pil().save(png)
            rendered.append(dict(document=item["file"], page=i + 1, image=png.name, imageSha256=hashlib.sha256(png.read_bytes()).hexdigest(), review="PENDING"))
results["auditCorrection"] = "Excluded only the exact DEMO notice line from 8pt body minimum; original exported PDF bytes unchanged. First checks retained in word-results-before-watermark-check-fix.json."
results["fontRequirement"] = "Bundled Liberation Serif and Sans 2.1.5; exact files and temporary session cleanup in font-session.json."
results_path.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(output / "rendered-pages.json").write_text(json.dumps(rendered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"documents": len(results["documents"]), "passed": sum(i["status"] == "PASS" for i in results["documents"]), "renderedPages": len(rendered)}))

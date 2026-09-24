"""Bind Word acceptance to immutable, currently selected template/DOCX hashes."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--manifest", required=True)
parser.add_argument("--runs", nargs="+", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
manifest_path = Path(args.manifest).resolve()
manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
hash_file = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
candidates = {}
for folder in args.runs:
    run_root = Path(folder).resolve()
    results = json.loads((run_root / "word-results.json").read_text(encoding="utf-8-sig"))
    font_session = json.loads((run_root / "font-session.json").read_text(encoding="utf-8-sig"))
    assert len(font_session["fonts"]) == 8 and all(f["removed"] for f in font_session["fonts"])
    assert font_session["version"] == "2.1.5"
    for document in results["documents"]:
        if document["status"] == "PASS" and document.get("visualReview") == "PASS":
            candidates[document["docxSha256"]] = (run_root, results, document)
combined = []
missing = []
for pinned in manifest["files"]:
    source = Path(pinned["docxPath"])
    reference = Path(pinned["pdfPath"])
    assert hash_file(source) == pinned["docxSha256"]
    assert hash_file(reference) == pinned["pdfSha256"]
    match = candidates.get(pinned["docxSha256"])
    if not match:
        missing.append(dict(file=source.name, sourceSha256=pinned["docxSha256"], reason="No exact-byte Word structural+visual PASS"))
        continue
    run_root, run, document = match
    pdf = run_root / document["pdf"]
    assert hash_file(pdf) == document["pdfSha256"]
    audit_path = run_root / (source.stem + ".final-reference.audit.json")
    check = subprocess.run([sys.executable, "-X", "utf8", str(root / "audit-word-pdf.py"), "--source", str(source), "--pdf", str(pdf), "--word-pages", str(document["pages"]), "--word-text", str(run_root / (source.stem + ".word-body.txt")), "--output", str(audit_path), "--reference-pdf", str(reference)], check=False)
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    if check.returncode:
        missing.append(dict(file=source.name, reason="Final reference audit failed", errors=audit["errors"]))
        continue
    combined.append(dict(file=source.name, template=pinned["template"], templateVersion=pinned["version"], templateSha256=pinned["templateSha256"], docxSha256=pinned["docxSha256"], wordPdfSha256=document["pdfSha256"], linuxPdfSha256=pinned["pdfSha256"], pages=document["pages"], expectedUniqueWords=audit["expectedUniqueWords"], minimumBodyFontPt=min(p["minimumBodyFontPt"] for p in audit["pages"]), wordVersion=run["wordVersion"], wordBuild=run["wordBuild"], evidenceFolder=str(run_root.relative_to(root)), audit=str(audit_path.relative_to(root)), structuralStatus="PASS", visualStatus="PASS"))
status = "PASS" if len(combined) == 20 and not missing else "INCOMPLETE"
result = dict(status=status, sourceManifest=str(manifest_path), sourceManifestSha256=hash_file(manifest_path), rendererVersion=manifest["rendererVersion"], expectedDocuments=20, passedDocuments=len(combined), pages=sum(d["pages"] for d in combined), supportedFontEnvironment="Bundled Liberation Serif/Sans 2.1.5, 8 exact TTF files; registered only for verification session and all removed afterwards. Font hashes in each referenced font-session.json.", documents=combined, missing=missing, limitations=["Physical printer, duplex alignment and ruler measurements are outside this Word gate.", "Regulatory fitness of supplied historical forms is a separate gate.", "Opening without the supplied fonts is not covered: the retained no-font test demonstrated Times New Roman substitution and a Kazakh Unicode mismatch."])
(root / "final-active.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(dict(status=status, passedDocuments=len(combined), missing=missing), ensure_ascii=False))
raise SystemExit(0 if status == "PASS" else 1)

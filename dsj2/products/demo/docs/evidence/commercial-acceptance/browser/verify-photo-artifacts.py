"""Verify actual downloaded bytes and render final PDFs for explicit visual review."""
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile
import pdfplumber
import pypdfium2

root = Path(sys.argv[1])
result = json.loads((root / "photo-result.json").read_text(encoding="utf-8"))
records = []
matches = []
for entry in result["artifacts"]:
    source = root / entry["file"]
    data = source.read_bytes()
    assert hashlib.sha256(data).hexdigest() == entry["sha256"], source
    if entry["format"] == "DOCX":
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            embedded = [name for name in package.namelist() if name.startswith("word/media/") and hashlib.sha256(package.read(name)).hexdigest() == result["normalizedPhotoSha256"]]
            matches.append({"file": entry["file"], "provenance": entry["provenance"], "exactPhotoMatches": embedded})
    if entry["format"] != "PDF" or entry["provenance"] != "ORIGINAL":
        continue
    pdf = pypdfium2.PdfDocument(str(source))
    with pdfplumber.open(source) as doc:
        for index, page in enumerate(doc.pages):
            png = source.with_suffix(f".page-{index + 1}.png")
            pdf[index].render(scale=1.6).to_pil().save(png)
            outside = [c.get("text") for c in page.chars if c["x0"] < -1 or c["top"] < -1 or c["x1"] > page.width + 1 or c["bottom"] > page.height + 1]
            assert not outside, (source, index, outside)
            assert page.extract_text().strip(), (source, index, "empty page")
            records.append({"pdf": source.name, "page": index + 1, "png": png.name, "width": page.width, "height": page.height, "characters": len(page.chars), "images": [{k: image.get(k) for k in ("x0", "top", "x1", "bottom", "srcsize")} for image in page.images], "outsideSheetCharacters": outside, "visualStatus": "REQUIRES_REVIEW"})
    pdf.close()
output = {"status": "AUTOMATED_PASS_VISUAL_PENDING", "requestId": result["requestId"], "artifactCount": len(result["artifacts"]), "matches": matches, "pages": records}
(root / "pdf-visual-review.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"artifacts": output["artifactCount"], "originalPages": len(records), "exactPhotoMatches": sum(len(item["exactPhotoMatches"]) for item in matches)}))

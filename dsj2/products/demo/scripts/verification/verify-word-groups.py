"""Generate real group fixtures, then inspect PDFs exported by Microsoft Word."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests/render"))
from test_group_protocol import FORMS, group_fixture, render_docx
from test_render import fixture, MANIFEST, STORE

OUT = ROOT / "docs/evidence/final-completion/word"
OUT.mkdir(parents=True, exist_ok=True)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def generate():
    fixtures = []
    for form in FORMS:
        for count in [1, 2, 25, 100]:
            snapshot = group_fixture(form, count)
            target = OUT / f"{form}-{count}.docx"
            render_docx(snapshot, target)
            fixtures.append({"form": form, "count": count, "path": str(target), "sha256": digest(target)})
    (OUT / "fixtures.json").write_text(json.dumps(fixtures, indent=2), encoding="utf8")
    print(json.dumps({"generated": len(fixtures)}))

def generate_individual():
    from PIL import Image
    fixtures = json.loads((OUT / "fixtures.json").read_text(encoding="utf8"))
    fixtures = [f for f in fixtures if f.get("mode") != "INDIVIDUAL"]
    photo = STORE / "word-synthetic-photo.png"
    Image.new("RGB", (480, 640), (70, 115, 150)).save(photo)
    for template in MANIFEST["templates"]:
        snapshot = fixture(template["id"])
        snapshot["items"][0]["fullNameRu"] = "Тестов-Примеров Александр Константинович"
        snapshot["items"][0]["fullNameKz"] = "Әділбек Өмірсерік Қанатұлы"
        if template.get("photo"):
            snapshot["items"][0]["photoAssetId"] = "word-synthetic-photo"
            snapshot["photos"]["word-synthetic-photo"] = photo.name
        target = OUT / f"individual-{template['id']}-long.docx"
        render_docx(snapshot, target)
        fixtures.append({"mode":"INDIVIDUAL", "form":template["id"], "count":1, "path":str(target), "sha256":digest(target), "expectedRu":snapshot["items"][0]["fullNameRu"], "expectedKz":snapshot["items"][0]["fullNameKz"]})
    (OUT / "fixtures.json").write_text(json.dumps(fixtures, indent=2), encoding="utf8")
    print(json.dumps({"generatedIndividual": len(MANIFEST["templates"]), "total":len(fixtures)}))

def inspect():
    import pymupdf
    from PIL import Image, ImageDraw
    fixtures = json.loads((OUT / "fixtures.json").read_text(encoding="utf8"))
    conversions = json.loads((OUT / "word-conversions.json").read_text(encoding="utf-8-sig"))
    results = []
    thumbnails = []
    for fixture in fixtures:
        source = Path(fixture["path"])
        assert digest(source) == fixture["sha256"], "Word must not change source bytes"
        pdf = source.with_suffix(".word.pdf")
        document = pymupdf.open(pdf)
        seen = []
        pages = []
        for n, page in enumerate(document):
            words = page.get_text("words")
            text = " ".join(page.get_text().split())
            people = re.findall(r"Слушатель\s+(\d{3})", text)
            seen.extend(map(int, people))
            heading = "Фамилия" if fixture["form"] == "ptm-protocol" else "Ф.И.О."
            if people and fixture.get("mode") != "INDIVIDUAL":
                assert heading in text, f"Missing continued heading: {pdf.name}, page {n+1}"
            assert all(w[0] >= -1 and w[1] >= -1 and w[2] <= page.rect.width+1 and w[3] <= page.rect.height+1 for w in words), f"Off-page text: {pdf.name}, page {n+1}"
            image_path = OUT / f"{source.stem}-word-page-{n+1}.png"
            page.get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(image_path)
            thumb = Image.open(image_path).convert("RGB")
            thumb.thumbnail((298, 421))
            tile = Image.new("RGB", (320, 450), "#dddddd")
            tile.paste(thumb, ((320-thumb.width)//2, 22))
            ImageDraw.Draw(tile).text((5, 4), f"{source.stem} p{n+1}", fill="black")
            thumbnails.append(tile)
            pages.append({"page": n+1, "participants": people, "headings": heading in text})
        if fixture.get("mode") == "INDIVIDUAL":
            full_text = " ".join(" ".join(page.get_text().split()) for page in document)
            assert fixture["expectedRu"] in full_text, f"Lost long RU name: {pdf.name}"
            # Some official forms contain RU-only name fields by contract.
            if fixture["form"] not in ["ps-witness", "ps-protocol"]:
                assert fixture["expectedKz"] in full_text, f"Lost KZ name: {pdf.name}"
        else:
            assert seen == list(range(1, fixture["count"]+1)), f"Lost or duplicate participant: {pdf.name}: {seen}"
        results.append({**fixture, "status": "PASS", "pdfSha256": digest(pdf), "pages": pages})
    for start in range(0, len(thumbnails), 12):
        batch = thumbnails[start:start+12]
        sheet = Image.new("RGB", (320*4, 450*((len(batch)+3)//4)), "white")
        for i, tile in enumerate(batch):
            sheet.paste(tile, ((i%4)*320, (i//4)*450))
        sheet.save(OUT / f"contact-sheet-{start//12+1}.png")
    report = {"status": "PASS", "engine": conversions["engine"], "documents": len(results), "totalPages": len(thumbnails), "sourceUnchanged": True, "checks": ["all participants exactly once in order", "continued roster column headings", "no text outside page", "source DOCX hashes unchanged"], "physicalPrint": "NOT_RUN", "results": results}
    (OUT / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    print(json.dumps({k:v for k,v in report.items() if k != "results"}, ensure_ascii=False))

if __name__ == "__main__":
    {"generate": generate, "generate-individual": generate_individual, "inspect": inspect}[sys.argv[1]]()

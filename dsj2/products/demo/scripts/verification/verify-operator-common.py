"""Read-only verification of real UI-generated files against the saved server resolution."""
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pymupdf
from openpyxl import load_workbook

root = Path(sys.argv[1]).resolve()
source = json.loads((root / "files-checkpoint.json").read_text(encoding="utf-8"))
expected = {item["rowId"]: item for item in source["expected"]}
assert len(expected) == 100

def normal(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value)).replace("\u00ad", ""))

def date_only(value):
    value = str(value)
    if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", value):
        return "-".join(reversed(value.split(".")))
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), value
    return value

review_dir = root / "review-pages"
review_dir.mkdir(exist_ok=True)
records = []
for file in source["files"]:
    path = root / file["path"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == file["sha256"]
    if file["format"] not in ["DOCX", "PDF"]:
        continue
    row = expected[file["rowId"]]
    pages = None
    if file["format"] == "DOCX":
        with ZipFile(path) as package:
            xml = ET.fromstring(package.read("word/document.xml"))
            text = " ".join(node.text or "" for node in xml.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))
    else:
        with pymupdf.open(path) as document:
            pages = len(document)
            assert pages > 0
            text = "\n".join(page.get_text() for page in document)
            for page in document:
                for word in page.get_text("words"):
                    assert word[0] >= -1 and word[1] >= -1 and word[2] <= page.rect.width + 1 and word[3] <= page.rect.height + 1, (path.name, page.number, word)
                if row["personnelNumber"] in ["000001", "000002", "000100"]:
                    page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(review_dir / f"{row['personnelNumber']}-{page.number + 1}.png")
    value = normal(text)
    for key in ["fullNameRu", "fullNameKz", "trainingSubject"]:
        assert normal(row[key]) in value, (path.name, key, row[key])
    assert normal(".".join(reversed(row["documentDate"].split("-")))) in value, (path.name, "documentDate")
    for other in expected.values():
        if other["rowId"] != row["rowId"] and other["fullNameRu"] != row["fullNameRu"]:
            assert normal(other["fullNameRu"]) not in value, (path.name, "foreign person", other["fullNameRu"])
    records.append({"file": file["path"], "format": file["format"], "rowId": file["rowId"], "subject": row["trainingSubject"], "pages": pages, "status": "PASS"})
assert sum(record["format"] == "DOCX" for record in records) == 100
assert sum(record["format"] == "PDF" for record in records) == 100

with (root / "common-values.xlsx").open("rb") as file:
    workbook = load_workbook(file, data_only=False)
    sheet = workbook.active
    values = list(sheet.values)
    headers = values.pop(0)
    assert len(values) == 100
    by_personnel = {row["personnelNumber"]: row for row in expected.values()}
    for value in values:
        row = dict(zip(headers, value))
        personnel = row["Табельный номер"]
        assert isinstance(personnel, str) and personnel.startswith("0")
        expected_row = by_personnel[personnel]
        assert row["ФИО RU"] == expected_row["fullNameRu"]
        assert row["Программа / тема обучения"] == expected_row["trainingSubject"]
        assert date_only(row["Дата документа"]) == expected_row["documentDate"]
        assert date_only(row["Начало обучения"]) == expected_row["trainingStart"]
        assert date_only(row["Окончание обучения"]) == expected_row["trainingEnd"]
        assert str(row["Объём обучения, часов"]) == expected_row["hours"]
    assert not any(cell.data_type == "f" for cells in sheet for cell in cells)
    workbook.close()
result = {"status": "PASS", "requestId": source["requestId"], "rows": 100, "docx": 100, "pdf": 100, "xlsxRows": 100, "overrideSubjects": sorted({row["trainingSubject"] for row in expected.values()}), "mappedPrintedFieldsMatch": ["fullNameRu", "fullNameKz", "trainingSubject", "documentDate"], "xlsxAdditionalDateOnlyFieldsMatch": ["trainingStart", "trainingEnd"], "allHashesMatch": True, "noCrossPersonNameLeak": True, "noOutOfPageWords": True, "visualReviewRequired": ["000001", "000002", "000100"], "limitation": "The approved BIOT worker card does not print training start/end or hours; these fields are compared between UI/server resolution and XLSX. Physical print and legal approval are outside this test.", "files": records}
(root / "file-verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({key: value for key, value in result.items() if key != "files"}, ensure_ascii=False))

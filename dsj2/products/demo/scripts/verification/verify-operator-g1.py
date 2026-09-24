"""Independently inspect every real G1 PDF; preserve the manifest's PB protocol field contract."""
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
from collections import Counter
import pymupdf

root = Path(sys.argv[1]).resolve()
product = Path(__file__).resolve().parents[2]
result = json.loads((root / "g1-result.json").read_text(encoding="utf-8"))
people = json.loads((product / "tests/fixtures/operator-value/100_people.json").read_text(encoding="utf-8"))["people"]
event = next(event for event in json.loads((product / "tests/fixtures/operator-value/training_events.json").read_text(encoding="utf-8"))["events"] if event["id"] == "PB-G1")
def normal(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value).replace("\u00ad", ""))
review = root / "review-pages"
review.mkdir(exist_ok=True)
records = []
seen = []
for file in result["files"]:
    path = root / file["path"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == file["sha256"]
    if file["format"] != "PDF":
        continue
    with pymupdf.open(path) as document:
        assert len(document) > 0
        text = normal("\n".join(page.get_text() for page in document))
        assert result["groupNumber"] in text
        matched = [person for person in people if normal(person["fullNameRu"]) in text]
        if file["ownerKind"] == "GROUP":
            assert len(matched) == 100
            for person in people:
                assert normal(person["fullNameKz"]) in text
            for name, count in Counter(normal(person["fullNameRu"]) for person in people).items():
                assert text.count(name) == count, (name, text.count(name), count)
            assert event["hours"] + "-часовой" in text
            assert ".".join(reversed(event["protocolDate"].split("-"))) in text
            prefix = "group"
        else:
            assert sum(len(page.get_images(full=True)) for page in document) >= 1, (path.name, "missing embedded photo")
            person = next(person for person in people if person["externalPersonKey"] == file["externalId"])
            assert file["number"] in text
            assert normal(person["fullNameRu"]) in text
            assert all(other["fullNameRu"] == person["fullNameRu"] for other in matched), (file["path"], "other person's name")
            seen.append(person["externalPersonKey"])
            assert normal(person["fullNameKz"]) in text
            assert normal(event["trainingSubject"]) in text
            prefix = person["personnelNumber"]
        for page in document:
            assert all(word[0] >= -1 and word[1] >= -1 and word[2] <= page.rect.width + 1 and word[3] <= page.rect.height + 1 for word in page.get_text("words")), (path.name, page.number)
            if file["ownerKind"] == "GROUP" or prefix in ["000001", "000003", "000100"]:
                page.get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2)).save(review / f"{prefix}-{page.number + 1}.png")
        records.append({"file": file["path"], "ownerKind": file["ownerKind"], "pages": len(document), "matchedPeople": len(matched), "status": "PASS"})
assert len(records) == 101
assert len(seen) == len(set(seen)) == 100
assert sum(record["ownerKind"] == "GROUP" for record in records) == 1
keyboard_download = root / "keyboard-download.pdf"
keyboard_match = None
if keyboard_download.exists():
    downloaded_hash = hashlib.sha256(keyboard_download.read_bytes()).hexdigest()
    assert any(file["format"] == "PDF" and file["sha256"] == downloaded_hash for file in result["files"])
    assert keyboard_download.read_bytes().startswith(b"%PDF-")
    keyboard_match = True

evidence = {"keyboardDownloadedPdfMatchesIssuedArtifact": keyboard_match, "status": "PASS", "requestId": result["requestId"], "all204HashesMatch": True, "individualPdfs": 100, "groupPdfs": 1, "all100PeopleExactlyOnceAcrossCards": True, "all100CardsContainEmbeddedPhoto": True, "allRuKzPreserved": True, "groupHas100People": True, "noOffPageWords": True, "pbGroupSubjectLimitation": "Approved manifest pb-protocol 9-group-2 maps HOURS and PROTOCOL_DATE/NUMBER but not SUBJECT; card subject and persisted event are checked separately.", "physicalPrint": "NOT_RUN", "files": records}
(root / "pdf-verification.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({key: value for key, value in evidence.items() if key != "files"}, ensure_ascii=False))

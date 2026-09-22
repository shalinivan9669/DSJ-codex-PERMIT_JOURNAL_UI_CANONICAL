"""Reject empty, truncated or structurally different Word PDF exports."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
import pdfplumber
from pypdf import PdfReader

parser = argparse.ArgumentParser()
for key in ("source", "pdf", "word-text", "output"):
    parser.add_argument("--" + key, required=True)
parser.add_argument("--word-pages", required=True, type=int)
parser.add_argument("--reference-pdf")
args = parser.parse_args()
source, pdf = Path(args.source), Path(args.pdf)
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

def normalize(value):
    value = unicodedata.normalize("NFKC", value).replace("\u00ad", "")
    return re.sub(r"\s+", "", value.translate(str.maketrans({"‐": "-", "‑": "-", "−": "-"})))

def paragraph_text(paragraph):
    parts = []
    def visit(node):
        if node is not paragraph and node.tag == "{" + ns["w"] + "}p":
            return  # Do not concatenate nested textbox/table paragraphs into their anchor paragraph.
        if node.tag == "{" + ns["w"] + "}t": parts.append(node.text or "")
        if node.tag in {"{" + ns["w"] + "}br", "{" + ns["w"] + "}tab"}: parts.append(" ")
        for child in node: visit(child)
    visit(paragraph)
    return "".join(parts).strip()

paragraphs = []
with zipfile.ZipFile(source) as package:
    document_root = ET.fromstring(package.read("word/document.xml"))
    relationship_root = ET.fromstring(package.read("word/_rels/document.xml.rels"))
    relationships = {r.attrib["Id"]: "word/" + r.attrib["Target"].lstrip("/") for r in relationship_root}
    active_parts = {"word/document.xml"}
    for section in document_root.findall(".//w:sectPr", ns):
        first_page_special = section.find("w:titlePg", ns) is not None
        for ref in list(section.findall("w:headerReference", ns)) + list(section.findall("w:footerReference", ns)):
            kind = ref.attrib.get("{" + ns["w"] + "}type", "default")
            is_active = (kind == "first" and first_page_special) or (kind == "default" and (not first_page_special or args.word_pages > 1)) or (kind == "even" and args.word_pages > 1)
            target = relationships.get(ref.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"))
            if is_active and target:
                active_parts.add(target)
    for name in package.namelist():
        if name in active_parts:
            for p in ET.fromstring(package.read(name)).findall(".//w:p", ns):
                value = paragraph_text(p)
                if len(normalize(value)) >= 3:
                    paragraphs.append(value)
with pdfplumber.open(pdf) as document:
    pages = []
    for i, p in enumerate(document.pages):
        characters = [c for c in p.chars if c.get("text", "").strip()]
        # The known DEMO notice is intentionally 7pt. Exclude only its exact
        # text line, never an entire top band where issuer text could occur.
        top_lines = {}
        for c in p.chars:
            if c["top"] < 55:
                top_lines.setdefault(round(c["top"], 1), []).append(c)
        notice_tops = {top for top, chars in top_lines.items() if normalize("".join(c["text"] for c in sorted(chars, key=lambda c: c["x0"]))) == normalize("ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ")}
        body_characters = [c for c in characters if round(c["top"], 1) not in notice_tops]
        pages.append({"page": i + 1, "widthPt": round(p.width, 2), "heightPt": round(p.height, 2), "textCharacters": len(p.extract_text() or ""), "minimumFontPt": round(min((c["size"] for c in characters), default=0), 3), "minimumBodyFontPt": round(min((c["size"] for c in body_characters), default=0), 3), "excludedDemoNoticeLines": len(notice_tops), "outOfPageCharacters": sum(c["x0"] < -1 or c["x1"] > p.width + 1 or c["top"] < -1 or c["bottom"] > p.height + 1 for c in characters), "text": p.extract_text() or ""})
pdf_text = "\n".join(p["text"] for p in pages)
reader = PdfReader(pdf)
stream_text = "\n".join(p.extract_text() or "" for p in reader.pages)
pdf_fonts = sorted({str(font.get_object().get("/BaseFont", "")) for page in reader.pages for font in page.get("/Resources", {}).get("/Font", {}).values()})
pdf_norm = normalize(pdf_text) + "\n" + normalize(stream_text)
word_norm = normalize(Path(args.word_text).read_text(encoding="utf-8-sig"))
unique_paragraphs = sorted(set(paragraphs))
missing_paragraphs = [p for p in unique_paragraphs if normalize(p) not in pdf_norm]
expected_words = sorted(set(w for p in unique_paragraphs for w in re.findall(r"[^\W_]+(?:[-–][^\W_]+)*", p, re.UNICODE) if len(w) >= 4))
missing_words = [w for w in expected_words if normalize(w) not in pdf_norm]
missing_in_word = [w for w in expected_words if normalize(w) not in word_norm]
errors = []
if not pages or len(pages) != args.word_pages: errors.append("WORD_PDF_PAGE_COUNT_MISMATCH")
if not pdf_norm or not word_norm: errors.append("EMPTY_EXPORTED_TEXT")
if missing_words: errors.append("SOURCE_WORDS_MISSING_IN_PDF")
if missing_in_word: errors.append("SOURCE_WORDS_MISSING_IN_WORD_BODY")
if any(p["textCharacters"] < 5 for p in pages): errors.append("EMPTY_OR_NEAR_EMPTY_PAGE")
if any(p["minimumBodyFontPt"] < 7.8 for p in pages): errors.append("BELOW_8PT_BODY_TEXT")
if any(p["outOfPageCharacters"] for p in pages): errors.append("TEXT_OUTSIDE_PAGE")
reference = None
if args.reference_pdf and not Path(args.reference_pdf).is_file(): errors.append("REFERENCE_PDF_MISSING")
if args.reference_pdf and Path(args.reference_pdf).is_file():
    with pdfplumber.open(args.reference_pdf) as other:
        other_norm = normalize("\n".join(p.extract_text() or "" for p in other.pages))
        reference = {"file": str(Path(args.reference_pdf).resolve()), "pages": len(other.pages), "pageCountMatches": len(other.pages) == len(pages), "sizesMatch": len(other.pages) == len(pages) and all(abs(p.width - pages[i]["widthPt"]) < 1 and abs(p.height - pages[i]["heightPt"]) < 1 for i, p in enumerate(other.pages)), "sourceWordsMissing": [w for w in expected_words if normalize(w) not in other_norm]}
        if not reference["pageCountMatches"]: errors.append("LIBREOFFICE_WORD_PAGE_COUNT_DRIFT")
        if not reference["sizesMatch"]: errors.append("LIBREOFFICE_WORD_PAGE_SIZE_DRIFT")
summary = {"status": "PASS" if not errors else "FAIL", "source": str(source.resolve()), "pdf": str(pdf.resolve()), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "pdfSha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "wordPages": args.word_pages, "pdfPages": len(pages), "sourceParagraphs": len(unique_paragraphs), "expectedUniqueWords": len(expected_words), "missingSourceWordsInPdf": missing_words, "missingSourceWordsInWordBody": missing_in_word, "paragraphsReflowedOrMissing": missing_paragraphs, "pdfFonts": pdf_fonts, "activeSourceParts": sorted(active_parts), "errors": errors, "pages": [{k: v for k, v in p.items() if k != "text"} for p in pages], "reference": reference, "visualReview": "REQUIRED_SEPARATELY"}
Path(args.output).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
pdf.with_suffix(".txt").write_text(pdf_text, encoding="utf-8")
print(json.dumps({"status": summary["status"], "pages": len(pages), "errors": errors, "missingWords": missing_words}, ensure_ascii=False))
raise SystemExit(0 if not errors else 1)

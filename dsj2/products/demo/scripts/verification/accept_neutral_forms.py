"""Read back final Word/application PDFs and bind evidence to current sources.

This never repairs a PDF or overwrites a historical artifact. Run after the
fresh renderer/Word exports; a mismatch is an error requiring regeneration.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import hashlib
import json
import os
import posixpath
import re
import sys
import unicodedata

from lxml import etree as E
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.runtime/neutral-forms-final-20261005'
EVIDENCE = ROOT / 'docs/evidence/neutral-forms-20261005'
os.environ['DEMO_RENDER_EVIDENCE_ROOT'] = str(OUT)
os.environ['DEMO_ARTIFACT_ROOT'] = str(OUT / 'store')
sys.path.insert(0, str(ROOT / 'scripts/render'))
from neutral_identity import OLD_IMAGE_HASHES
from renderer import render_docx

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
OLD_TEXT = re.compile(r'\bстандарт\b|солтанов|флеглер|жакибеков|баянов|есен\s+д\.|анет\s+баба|160440010815|технологии\s+гостеприимства|саратов|QNP\s+Solutions', re.I)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compact(text):
    # Word's embedded-font ToUnicode map uses Latin schwa for the visibly
    # identical Kazakh Cyrillic character in these retained source fonts.
    text = text.translate(str.maketrans({'Ə': 'Ә', 'ə': 'ә'}))
    return re.sub(r'\s+', '', unicodedata.normalize('NFC', text)).replace('\u00ad', '')


def leaf_values(value, key=''):
    if isinstance(value, dict):
        for name, child in value.items():
            yield from leaf_values(child, key + '.' + name)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from leaf_values(child, key + '.' + str(index))
    elif isinstance(value, str) and len(compact(value)) >= 8:
        yield key, value


def audit_case(record, rerender=True):
    name = record['case']
    source = OUT / (name + '.docx')
    snapshot = json.loads((OUT / (name + '.snapshot.json')).read_text(encoding='utf8'))
    if rerender:
        with TemporaryDirectory(prefix='neutral-readback-', dir=OUT) as folder:
            candidate = Path(folder) / 'reproduced.docx'
            render_docx(snapshot, candidate)
            if sha(candidate) != sha(source):
                raise ValueError('FINAL_SOURCE_DRIFT: ' + name)
    with ZipFile(source) as archive:
        files = {n: archive.read(n) for n in archive.namelist()}
        media = {n: hashlib.sha256(archive.read(n)).hexdigest()
                 for n in archive.namelist() if n.startswith('word/media/')}
        text = '\n'.join(''.join(t.text or '' for t in E.fromstring(archive.read(n)).iter(W + 't'))
                         for n in archive.namelist() if n.startswith('word/') and n.endswith('.xml'))
        old_parts = [n for n in archive.namelist()
                     if hashlib.sha256(archive.read(n)).hexdigest() in OLD_IMAGE_HASHES]
        forbidden_parts = [n for n in archive.namelist()
                           if n.startswith(('docProps/', 'customXml/', 'word/comments', 'word/people', 'word/embeddings/'))]
    old_text = []
    types = E.fromstring(files['[Content_Types].xml'])
    defaults = {n.get('Extension') for n in types if n.get('Extension')}
    overrides = {n.get('PartName', '').lstrip('/') for n in types if n.get('PartName')}
    if overrides - files.keys():
        raise ValueError('DANGLING_CONTENT_TYPE: ' + name)
    for part, data in files.items():
        if part != '[Content_Types].xml' and part not in overrides and part.rsplit('.', 1)[-1] not in defaults:
            raise ValueError('UNDECLARED_PART: ' + name + ' ' + part)
        if part.endswith(('.xml', '.rels')):
            tree = E.fromstring(data)
            content = ' '.join(tree.itertext()) + ' '.join(v for node in tree.iter() for v in node.attrib.values())
            old_text.extend({'part': part, 'match': match} for match in OLD_TEXT.findall(content))
            if part.endswith('.rels'):
                owner = part.split('/_rels/')[0] if '/_rels/' in part else ''
                for rel in tree:
                    target = posixpath.normpath(posixpath.join(owner, rel.get('Target', ''))).lstrip('/')
                    if rel.get('TargetMode') == 'External' or target not in files:
                        raise ValueError('UNSAFE_OR_DANGLING_RELATION: ' + name + ' ' + part + ' ' + target)
    markers = re.findall(r'\{\{[^}]+\}\}', text)
    if old_parts or forbidden_parts or old_text or markers:
        raise ValueError('PACKAGE_IDENTITY_FAILURE: ' + name)
    # Actual snapshot values which have a printed slot in this particular form
    # must survive both converters. Schema-specific slot presence is covered
    # separately by the render tests (not inferred from the PDF itself).
    expected = [(key, value) for key, value in leaf_values(snapshot)
                if compact(value) in compact(text)]
    checks = {}
    for kind, suffix in [('application', '.pdf'), ('word', '.word.pdf')]:
        target = OUT / (name + suffix)
        pdf = pymupdf.open(target)
        output = compact(''.join(page.get_text() for page in pdf))
        missing = [{'field': key, 'value': value} for key, value in expected
                   if compact(value) not in output]
        outside = []
        for number, page in enumerate(pdf, 1):
            outside.extend({'page': number, 'word': list(word[:5])}
                           for word in page.get_text('words')
                           if word[0] < -.1 or word[1] < -.1 or
                           word[2] > page.rect.width + .1 or word[3] > page.rect.height + .1)
        checks[kind] = {'pages': len(pdf), 'sha256': sha(target),
                        'snapshotPrintedValuesChecked': len(expected),
                        'missingPrintedValues': missing, 'outsidePage': outside}
        if missing or outside:
            raise ValueError('PDF_READBACK_FAILURE: ' + name + ' ' + kind + ' ' + json.dumps(checks[kind], ensure_ascii=False))
    record.update(docx=str(source), docxSha256=sha(source), media=media,
                  oldImages=old_parts, oldText=old_text, unfilled=markers,
                  forbiddenPackageParts=forbidden_parts,
                  applicationPdf=str(OUT / (name + '.pdf')),
                  applicationPdfSha256=checks['application']['sha256'],
                  pdfChecks=checks, currentSourceReproductionByteIdentical=rerender)
    return record


def main():
    inventory = json.loads((OUT / 'inventory.json').read_text(encoding='utf8'))
    results = []
    for record in inventory:
        results.append(audit_case(record))
        print(record['case'] + ': current DOCX + Word + application PDF PASS', flush=True)
    (OUT / 'inventory.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    (EVIDENCE / 'case-inventory.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    sources = [*list((ROOT / 'scripts/render').glob('*.py')),
               ROOT / 'scripts/render/neutral_forms_sources.json',
               ROOT / 'scripts/render/legacy_reference_sources.json',
               ROOT / 'assets/templates/manifest.json']
    (EVIDENCE / 'accepted-source-hashes.json').write_text(
        json.dumps({p.relative_to(ROOT).as_posix(): sha(p) for p in sources}, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()

"""Read-only historical comparison: never modifies retained source files."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZipFile

from lxml import etree as E
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/render'))
sys.path.insert(0, str(ROOT / 'tests/render'))
from renderer import convert_pdf, render_one
from sanitize_templates import deterministic_zip
from package_xml import normalize_package
from test_render import fixture


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    args = parser.parse_args()
    output = ROOT / 'docs/evidence/dsj-forms-ux/templates/comparison'
    output.mkdir(parents=True, exist_ok=True)
    experimental = ROOT.parents[1] / 'docs/experimental/biot'
    records = []
    candidates = [
        ('worker', 'biot-worker-card', 'biot-card-template.docx', 'biot-worker-card.v15.docx'),
        ('itr', 'biot-itr-certificate', 'biot-itr-certificate-template.docx', 'biot-itr-certificate.v13.docx'),
        ('protocol', 'biot-protocol', 'biot-protocol-template.docx', 'biot-protocol.v9.docx'),
    ]
    manifest = json.loads((ROOT / 'assets/templates/manifest.json').read_text(encoding='utf8'))
    for name, tid, original, historical in candidates:
        snapshot = fixture(tid)
        for variant, source in [('original', experimental / original), ('historical', args.archive / historical),
                                ('current', ROOT / 'assets/templates' / next(t['file'] for t in manifest['templates'] if t['id'] == tid))]:
            checksum = hashlib.sha256(source.read_bytes()).hexdigest()
            docx = output / f'{name}-{variant}.docx'
            if variant == 'original':
                # Copies preserve original sample content for accurate source comparison.
                docx.write_bytes(source.read_bytes())
            else:
                deterministic_zip(docx, normalize_package(render_one(snapshot, snapshot['items'][0], source)))
            pdf = docx.with_suffix('.pdf')
            convert_pdf(docx, pdf)
            document = pymupdf.open(pdf)
            for index, page in enumerate(document, 1):
                page.get_pixmap(matrix=pymupdf.Matrix(1.3, 1.3)).save(output / f'{name}-{variant}-{index}.png')
            records.append({'category': name, 'variant': variant, 'source': str(source), 'sourceSha256': checksum,
                            'docx': str(docx.relative_to(ROOT)), 'pdf': str(pdf.relative_to(ROOT)), 'pages': len(document)})
            print(name, variant, len(document), flush=True)
            assert hashlib.sha256(source.read_bytes()).hexdigest() == checksum
    (output / 'sources.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()

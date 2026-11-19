"""Keep all three managed BiOT worker issuer labels inside their physical panels."""
import os
from collections import defaultdict
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from test_archive_forms import snapshot
from renderer import convert_pdf, render_docx


@unittest.skipUnless(os.environ.get('DEMO_SOFFICE'), 'pinned converter required')
class ManagedBiotBandTests(unittest.TestCase):
    def test_bilingual_text_stays_in_its_original_half(self):
        import pymupdf

        for ru, kz in [('ТОО Учебный центр ДЕМО', 'ДЕМО оқу орталығы ЖШС'),
                       ('ТОО Образцовый учебный центр по безопасности и охране труда',
                        'Үлгілі қауіпсіздік пен еңбекті қорғау оқу орталығы ЖШС')]:
            with self.subTest(ru=ru), TemporaryDirectory() as tmp:
                data = snapshot('biot-worker-card')
                data.update(templateVersion='22', demoMode=True)
                data['issuer'].update(nameRu=ru, nameKz=kz)
                docx = Path(tmp) / 'card.docx'
                render_docx(data, docx)
                pdf = docx.with_suffix('.pdf')
                convert_pdf(docx, pdf)
                with pymupdf.open(pdf) as doc:
                    self.assertEqual(len(doc), 2)
                    for page, expected in zip(doc, (2, 1)):
                        frames = sorted((d['rect'] for d in page.get_drawings()
                                         if d['type'] == 's' and d['rect'].width > 500 and d['rect'].height > 150),
                                        key=lambda r: r.y0)
                        self.assertEqual(len(frames), expected)
                        rows = defaultdict(list)
                        for block in page.get_text('rawdict')['blocks']:
                            for line in block.get('lines', ()):
                                for span in line['spans']:
                                    if span['color'] == 0x0070C0:
                                        for char in span['chars']:
                                            if char['c'].strip():
                                                rows[round(char['origin'][1], 1)].append(char)
                        self.assertEqual(len(rows), expected)
                        for chars, frame in zip((rows[key] for key in sorted(rows)), frames):
                            self.assertEqual(''.join(c['c'] for c in chars), ''.join((ru + '/' + kz).split()))
                            bounds = pymupdf.Rect(chars[0]['bbox'])
                            for char in chars[1:]:
                                bounds |= pymupdf.Rect(char['bbox'])
                            self.assertTrue(frame.contains(bounds), (frame, bounds))
                            # The fold is printed at x=298 pt on both pages of this source.
                            self.assertLess(bounds.x1, 298)

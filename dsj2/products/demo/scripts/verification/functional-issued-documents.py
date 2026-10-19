"""Inspect actual browser-issued files; never creates or changes business records."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
runtime = root / '.runtime/functional-completion-20261019/run-01'
out = root / 'docs/evidence/functional-completion-20261019/run-01/documents'
case_name = sys.argv[1] if len(sys.argv) > 1 else 'primary'
if case_name not in ('primary', 'sanitary', 'credential'):
    raise ValueError('Unknown document case')
if case_name != 'primary':
    out = out / case_name
learner_name = 'Учебный слушатель 13' if case_name == 'sanitary' else 'Учебный слушатель 01'
if case_name == 'credential':
    learner_name = json.loads((runtime / 'credential-result.private.json').read_text(encoding='utf-8'))['learner']['displayName']
sys.path.insert(0, str(runtime / 'qr-deps'))
import zxingcpp

report = []
for file in sorted(out.glob('issued-*')):
    if file.suffix not in ['.pdf', '.docx']:
        continue
    item = {'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size}
    if file.suffix == '.docx':
        with zipfile.ZipFile(file) as archive:
            xml = ElementTree.fromstring(archive.read('word/document.xml'))
            text = '\n'.join(x.text or '' for x in xml.iter() if x.tag.endswith('}t'))
            item.update(validZip=archive.testzip() is None, mediaFiles=len([n for n in archive.namelist() if n.startswith('word/media/')]))
    else:
        pdf = pdfium.PdfDocument(str(file))
        item['pages'] = len(pdf)
        texts, pictures, codes = [], [], []
        for i in range(len(pdf)):
            page = pdf[i]
            texts.append(page.get_textpage().get_text_range())
            picture = page.render(scale=2).to_pil().convert('RGB')
            codes.extend(code.text for code in zxingcpp.read_barcodes(picture))
            picture.thumbnail((640, 950))
            canvas = Image.new('RGB', (660, picture.height+35), '#edf3f4')
            canvas.paste(picture, ((660-picture.width)//2, 25))
            ImageDraw.Draw(canvas).text((12, 8), f'{file.stem} / {i+1}', fill='#123a46')
            pictures.append(canvas)
        text='\n'.join(texts)
        contact = Image.new('RGB',(660*len(pictures),max(p.height for p in pictures)),'#edf3f4')
        for i,p in enumerate(pictures): contact.paste(p,(660*i,0))
        contact.save(out / f'{file.stem}-pages.png')
        item.update(qrCodes=list(dict.fromkeys(codes)), nonemptyPages=[len(t.strip()) for t in texts])
    item.update(hasLearner=learner_name in text, hasSyntheticMark='СИНТЕТИЧЕСКИЙ' in text.upper(), hasNumber='LMS-' in text, unresolvedPlaceholders='{{' in text or '{%' in text)
    report.append(item)
(out / 'file-inspection.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))

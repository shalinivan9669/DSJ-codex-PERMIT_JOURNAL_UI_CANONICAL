"""Correct Latin schwa in static Kazakh source labels; never rewrite user data."""
import hashlib,json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from package_xml import normalize_package
from sanitize_templates import deterministic_zip
ROOT=Path(__file__).resolve().parents[2]
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));report=[]
    for template in manifest['templates']:
        if template['id'] not in ['biot-worker-card','pb-card','ptm-card']:continue
        source=directory/template['file'];before=hashlib.sha256(source.read_bytes()).hexdigest()
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        changed=0
        for name,data in list(files.items()):
            if not name.endswith('.xml'):continue
            tree=E.fromstring(data);part_changed=False
            for text in tree.iter(W+'t'):
                if text.text and '\u018f' in text.text:
                    assert '{{' not in text.text
                    changed+=text.text.count('\u018f');text.text=text.text.replace('\u018f','\u04d8');part_changed=True
            if part_changed:files[name]=E.tostring(tree,xml_declaration=True,encoding='utf-8')
        assert changed>0
        output=directory/(template['id']+'.v14.docx');deterministic_zip(output,normalize_package(files))
        template.update(version=14,file=output.name,previousTemplateSha256=before,sha256=hashlib.sha256(output.read_bytes()).hexdigest())
        report.append({'id':template['id'],'staticLabelReplacements':changed,'from':'U+018F LATIN CAPITAL LETTER SCHWA','to':'U+04D8 CYRILLIC CAPITAL LETTER SCHWA','previousSha256':before,'sha256':template['sha256']})
        target=archive/source.name
        if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
        else:source.rename(target)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v14-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()

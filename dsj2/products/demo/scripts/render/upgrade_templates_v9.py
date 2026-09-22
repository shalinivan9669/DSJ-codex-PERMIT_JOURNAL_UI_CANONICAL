"""Immutable migration of all active forms to Word-readable OOXML packages."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from package_xml import normalize_package
from sanitize_templates import deterministic_zip

ROOT=Path(__file__).resolve().parents[2]


def main():
    directory=ROOT/'assets/templates';archive=ROOT/'docs/evidence/commercial-acceptance/printing/historical-inputs'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf8'));report=[]
    for template in manifest['templates']:
        if template['version']==9:continue
        source=directory/template['file']
        with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
        before=hashlib.sha256(source.read_bytes()).hexdigest()
        output=directory/(template['id']+'.v9.docx')
        deterministic_zip(output,normalize_package(files))
        template.update(version=9,file=output.name,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),previousTemplateSha256=before)
        report.append({'template':template['id'],'before':source.name,'beforeSha256':before,'after':output.name,'afterSha256':template['sha256'],'changes':['declared-only MC Ignorable prefixes','remove invalid empty typed document metadata','remove content-type overrides of deleted parts','UTF-8 XML declarations','schema order of pPr/rPr/trPr/sectPr children'],'physicalGeometry':'unchanged'})
        target=archive/source.name
        if target.exists():assert target.read_bytes()==source.read_bytes();source.unlink()
        else:source.rename(target)
    manifest['rendererVersion']='demo-ooxml-4'
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'v9-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


if __name__=='__main__':main()

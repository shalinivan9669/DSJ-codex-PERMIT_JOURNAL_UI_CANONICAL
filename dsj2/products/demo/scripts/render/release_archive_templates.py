"""Stage an immutable archive-form release after candidate acceptance.

This does not register or approve tenant templates. --apply only installs local
bundled assets; history and the separately approved tenant versions are retained.
"""
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile

from lxml import etree as E
from archive_forms import MARKER, POLICY, identify_archive
from sanitize_templates import deterministic_zip

ROOT = Path(__file__).resolve().parents[2]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
IDS = ['biot-worker-card', 'biot-protocol', 'biot-itr-protocol', 'ptm-card',
       'ptm-protocol', 'pb-card', 'pb-protocol', 'ps-card', 'ps-protocol']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stage(candidates, output, manifest_path):
    output = output.resolve()
    manifest_path = manifest_path.resolve()
    if output.is_relative_to(manifest_path.parent):
        raise ValueError('RELEASE_STAGE_INSIDE_BUNDLED_ASSETS')
    original = manifest_path.read_bytes()
    manifest = json.loads(original)
    output.mkdir(parents=True, exist_ok=True)
    selected = {}
    for template_id in IDS:
        candidate_id = 'biot-protocol' if template_id=='biot-itr-protocol' else template_id
        path = candidates/(candidate_id+'.docx')
        if not identify_archive(path, candidate_id):
            raise ValueError('RELEASE_ARCHIVE_POLICY:'+template_id)
        with ZipFile(path) as archive:
            files = {name:archive.read(name) for name in archive.namelist()}
        marker = json.loads(files[MARKER])
        if candidate_id != template_id:
            marker['templateId'] = template_id
            files[MARKER] = json.dumps(marker, ensure_ascii=False, sort_keys=True).encode('utf8')
        selected[template_id] = (files, marker)
    released = []
    history = manifest.setdefault('archivedTemplates', [])
    for kind in ['templates', 'groupTemplates']:
        for index, old in enumerate(manifest.get(kind, [])):
            if old['id'] not in selected:
                continue
            template_id = old['id']
            if old.get('renderPolicy')==POLICY:
                raise ValueError('RELEASE_ALREADY_INSTALLED:'+template_id)
            files, marker = selected[template_id]
            new = deepcopy(old)
            if kind == 'templates':
                version = int(old['version'])+1
                filename = f'{template_id}.v{version}.docx'
            else:
                version = str(int(str(old['version']).split('-')[0])+1)+'-group-1'
                number = re.search(r'\.group-v([0-9]+)\.docx$', old['file'])
                if number is None:
                    raise ValueError('RELEASE_GROUP_FILENAME')
                filename = f'{template_id}.group-v{int(number[1])+1}.docx'
            target = output/filename
            deterministic_zip(target, files)
            new.update(version=version, file=filename, sha256=sha(target.read_bytes()),
                       fields=marker['fields'], sourceSha256=marker['sourceSha256'],
                       sourceArchiveSha256='8e0f85f825b2e58b668ae7a1c43c173a19175a53977ed999441cc365bb234bda',
                       formRevision=POLICY, renderPolicy=POLICY,
                       photo=any(item['kind']=='PHOTO' for item in marker.get('dynamicMedia', [])),
                       previousTemplateSha256=old['sha256'],
                       verificationStatus='ENGINEERING_TEMPLATE_REQUIRES_RENDER_ACCEPTANCE',
                       legalApproval='REQUIRED_BY_ISSUER')
            root = E.fromstring(files['word/document.xml'])
            new['sections'] = [dict(page.attrib) for section in root.iter(W+'sectPr')
                               for page in section.findall(W+'pgSz')]
            for obsolete in ['restoration','sourceImagesRemoved','sourceIdentityImagesReplaced']:
                new.pop(obsolete, None)
            new['sourceIdentityPolicy'] = 'FROZEN_CENTRE_AND_RECIPIENT_DATA_NO_SPECIMEN_IDENTITIES'
            if kind == 'groupTemplates':
                new['groupRenderer'] = 'archive_forms.py:render_archive_group'
            key = (old['id'], str(old['version']), old.get('ownerKind', 'INDIVIDUAL'))
            if not any((entry['id'],str(entry['version']),entry.get('ownerKind','INDIVIDUAL'))==key for entry in history):
                history.append(deepcopy(old))
            manifest[kind][index] = new
            released.append(new)
    manifest['rendererVersion'] = 'demo-ooxml-15/libreoffice-26.2.6.3'
    staged = output/'manifest.json'
    staged.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    report = {'previousManifestSha256':sha(original), 'manifestSha256':sha(staged.read_bytes()),
              'released':[{key:item[key] for key in ['id','version','file','sha256']} for item in released],
              'unchangedTemplates':['biot-itr-certificate','ps-witness'],
              'tenantRegistrationApplied':False}
    (output/'release-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidates', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    directory = ROOT/'assets/templates'
    manifest_path = directory/'manifest.json'
    report = stage(args.candidates.resolve(), args.out.resolve(), manifest_path)
    if args.apply:
        if sha(manifest_path.read_bytes())!=report['previousManifestSha256']:
            raise ValueError('RELEASE_MANIFEST_CHANGED')
        for item in report['released']:
            target = directory/item['file']
            if target.exists() and sha(target.read_bytes())!=item['sha256']:
                raise ValueError('RELEASE_IMMUTABLE_VERSION_CONFLICT:'+item['file'])
        for item in report['released']:
            (directory/item['file']).write_bytes((args.out/item['file']).read_bytes())
        manifest_path.write_bytes((args.out/'manifest.json').read_bytes())
    print(json.dumps({'files':len(report['released']), 'applied':args.apply}))


if __name__ == '__main__':
    main()

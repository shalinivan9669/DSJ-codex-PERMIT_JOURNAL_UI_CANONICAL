"""Select new immutable versions containing unchanged verified reference DOCX.

The source copies and their checksums were extracted from 90d5b5e. This command
only verifies those copies and selects them; it never rewrites an older file.
"""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]


def select_reference_forms():
    directory = ROOT / 'assets/templates'
    registry = json.loads((ROOT / 'scripts/render/legacy_reference_sources.json').read_text(encoding='utf-8'))
    path = directory / 'manifest.json'; manifest = json.loads(path.read_text(encoding='utf-8'))
    records = []
    for reference in registry['templates']:
        old = next(item for item in manifest['templates'] if item['id'] == reference['id'])
        if reference['version'] != int(old['version']) + 1:
            raise ValueError('REFERENCE_REQUIRES_NEW_VERSION:' + reference['id'])
        source = directory / reference['file']; data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != reference['sha256'] or reference['sha256'] != old['sourceSha256']:
            raise ValueError('REFERENCE_SOURCE_HASH_MISMATCH:' + reference['id'])
        entry = deepcopy(old)
        entry.update(version=reference['version'], file=reference['file'], sha256=reference['sha256'],
                     previousTemplateSha256=old['sha256'], formRevision='DSJ_90D5_EXACT_REFERENCE',
                     renderPolicy=registry['policy'], sourceImagesRemoved=False,
                     sourceIdentityImagesReplaced=False, verificationStatus='PENDING_REFERENCE_PRODUCTION_REVIEW',
                     restoration={'sourceFile':reference['sourcePath'].removeprefix('dsj2/docs/experimental/'),
                                  'sourceSha256':reference['sha256'], 'sourceCommit':registry['sourceCommit'],
                                  'layoutPolicy':registry['policy'], 'sourcePackageUnmodified':True,
                                  'dataPolicy':'FROZEN_SNAPSHOT_VALUES_IN_EXISTING_FIELDS'})
        manifest['templates'][manifest['templates'].index(old)] = entry
        records.append({'id':reference['id'], 'previousFile':old['file'], **reference})
        if reference['id'].endswith('-protocol'):
            prior = next(item for item in manifest['groupTemplates'] if item['id'] == reference['id'])
            index = int(re.search(r'group-v(\d+)', prior['file'])[1]) + 1
            group_file = reference['id'] + f'.group-v{index}.docx'
            target = directory / group_file
            if target.exists():
                if target.read_bytes() != data:
                    raise ValueError('REFERENCE_GROUP_FILE_ALREADY_EXISTS:' + group_file)
            else:
                target.write_bytes(data)
            group = deepcopy(entry)
            group.update(file=group_file, version=str(reference['version']) + '-group-1', ownerKind='GROUP',
                         protocolSemantics='GROUP', groupContractVersion=1,
                         groupRenderer='legacy_reference.py:source-row-clone-v1', previousTemplateSha256=prior['sha256'])
            manifest['groupTemplates'][manifest['groupTemplates'].index(prior)] = group
    manifest['rendererVersion'] = 'demo-ooxml-10/libreoffice-26.2.6.3'
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = {'policy':registry['policy'], 'sourceCommit':registry['sourceCommit'],
              'sourcePackageUnmodified':True, 'helperNormalization':'LF_LINE_ENDINGS_ONLY',
              'helpers':registry['helpers'], 'templates':records,
              'permittedDataChanges':['existing cached field/text values from the frozen snapshot',
                                      'DATE cached value frozen without active DATE instructions',
                                      'source PS witness empty month cell populated',
                                      'original participant roster row cloned for group data'],
              'layoutChanges':[]}
    (directory / 'legacy-reference-provenance.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'templates':len(manifest['templates']), 'groups':len(manifest['groupTemplates']), 'policy':registry['policy']}


if __name__ == '__main__':
    print(json.dumps(select_reference_forms()))

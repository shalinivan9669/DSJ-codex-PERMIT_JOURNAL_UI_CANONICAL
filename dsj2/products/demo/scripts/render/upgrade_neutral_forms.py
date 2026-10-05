"""Create new immutable neutral versions from the retained audit baseline."""
from pathlib import Path
from zipfile import ZipFile
import hashlib,json,sys
from neutral_identity import sanitize_identity
from neutral_forms import neutral_payload,POLICY
from sanitize_templates import deterministic_zip
ROOT=Path(__file__).resolve().parents[2]

def main():
    evidence=ROOT/'docs/evidence/neutral-forms-20261005'
    manifest=json.loads((evidence/'manifest-before.json').read_text(encoding='utf8'))
    sources=[]
    for kind in ['templates','groupTemplates']:
        for t in manifest[kind]:
            source=ROOT/'assets/templates'/t['file']
            if hashlib.sha256(source.read_bytes()).hexdigest()!=t['sha256']:
                raise ValueError('SOURCE_TEMPLATE_HASH_MISMATCH:'+t['file'])
            # Exact audit data is only used to enumerate the old sample slots;
            # replacement values are opaque neutral markers, never that data.
            snap=json.loads((evidence/'template-fixtures.json').read_text(encoding='utf8'))[t['id']]
            payload=neutral_payload(snap,snap['items'][0])
            with ZipFile(source) as z: files={n:z.read(n) for n in z.namelist()}
            files=sanitize_identity(files,payload)
            old={k:t[k] for k in ['file','version','sha256']}
            if kind=='templates':
                version=int(t['version'])+1; filename=t['id']+'.v'+str(version)+'.docx'
            else:
                import re
                v=int(re.search(r'group-v(\d+)',t['file'])[1])+1
                version=str(int(str(t['version']).split('-')[0])+1)+'-group-1'; filename=t['id']+f'.group-v{v}.docx'
            metadata={'policy':POLICY,'templateId':t['id'],'version':version,'sourceSha256':old['sha256']}
            path=ROOT/'assets/templates'/filename
            if path.exists():
                # A local file may already be registered elsewhere. Never
                # infer that it is mutable from a local checksum or flag.
                raise ValueError('NEW_VERSION_ALREADY_EXISTS:'+filename)
            deterministic_zip(path,files)
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            t.update(version=version,file=filename,sha256=digest,renderPolicy=POLICY,formRevision=POLICY,
                     sourceImagesRemoved=True,sourceIdentityImagesReplaced=True,verificationStatus='PENDING_LOCAL_ACCEPTANCE',
                     previousTemplateSha256=old['sha256'],restoration={'sourceFile':old['file'],'sourceSha256':old['sha256'],'layoutPolicy':POLICY,'sourcePackageUnmodified':False,'dataPolicy':'FROZEN_SNAPSHOT_VALUES_IN_EXISTING_FIELDS'})
            if kind=='groupTemplates': t['groupRenderer']='neutral_forms.py:source-row-clone-v1'
            slots=[{k:r[k] for k in ['matchText','mode','paragraphContains'] if k in r} for r in payload.get('sourceLiteralValues',[])+payload.get('textReplacements',[])]
            sources.append({'id':t['id'],'version':version,'file':filename,'sha256':digest,'previous':old,'kind':kind,'slots':slots})
    manifest['rendererVersion']='demo-ooxml-12/libreoffice-26.2.6.3'
    (ROOT/'assets/templates/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    registry={'policy':POLICY,'templates':sources}
    (ROOT/'scripts/render/neutral_forms_sources.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (evidence/'new-versions.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('Created',len(sources),'new versions')
if __name__=='__main__': main()

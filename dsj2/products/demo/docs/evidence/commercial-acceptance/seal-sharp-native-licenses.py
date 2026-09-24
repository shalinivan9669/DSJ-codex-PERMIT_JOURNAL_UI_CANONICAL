from pathlib import Path
import hashlib,json,re,shutil
ROOT=Path.cwd();OUT=ROOT/'licenses/sharp-libvips';P=OUT/'collection.json';report=json.loads(P.read_text(encoding='utf8'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
inventory_path=ROOT/'docs/evidence/commercial-acceptance/npm-licenses-linux-final-r5-collected.json'
inventory=json.loads(inventory_path.read_text(encoding='utf8'))
package=next(p for group in inventory['groups'].values() for p in group if isinstance(p,dict) and p.get('name')=='@img/sharp-libvips-linux-x64')
readme=package['licenseTexts'][0]['text'];readme_path=OUT/'installed-package-README.md';readme_path.write_text(readme,encoding='utf8')
declarations={m[0].strip():m[1].strip() for m in re.findall(r'^\|\s*([^|]+)\|\s*([^|]+)\|',readme,re.M) if m[0].strip() not in ['Library','---------------']}
assert len(declarations)==29 and {r['name'] for r in report['components']}==set(declarations)
report['installedReadme']={'inventoryPath':inventory_path.relative_to(ROOT).as_posix(),'inventorySha256':sha(inventory_path),'path':readme_path.relative_to(ROOT).as_posix(),'sha256':sha(readme_path)}
for row in report['components']:row['packageDeclaredLicense']=declarations[row['name']]
all_files=[f for r in report['components'] for f in r['files']]+report['supplementalLicenseVersions']
for f in all_files:
 assert f['status']=='COLLECTED';path=ROOT/f['localPath'];assert sha(path)==f['sha256']
report['collectionTotals']={'inventoryComponents':29,'matchedInstalledVersionEntries':28,'upstreamComponentFiles':sum(len(r['files']) for r in report['components']),'supplementalFullLicenseVersions':len(report['supplementalLicenseVersions']),'bytes':sum((ROOT/f['localPath']).stat().st_size for f in all_files)}
P.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
lines=['# Native dependency attribution: sharp-libvips1.3.3','',
'Exact target: `@img/sharp-libvips-linux-x64@1.3.3`; upstream build commit `'+report['gitHead']+'`.',
'These are the license texts and notices from the versioned upstream sources listed below. Files retain original bytes and copyright wording; collection.json records exact URLs and SHA-256. This is a text-collection result, not complete binary redistribution clearance.','',
'This software is based in part on the work of the Independent JPEG Group.',
'This software uses the FreeType project. Its original FTL terms and copyright notices are reproduced in freetype/docs__FTL.TXT.','',
'| Component | Exact version / embedded source | Declaration in package README | Collected original files |',
'| --- | --- | --- | --- |']
for row in report['components']:
 files=', '.join('['+f['path']+']('+str(Path(f['localPath']).relative_to('licenses/sharp-libvips')).replace('\\','/')+')' for f in row['files'])
 lines.append('| '+row['name']+' | '+row['version']+' | '+row['packageDeclaredLicense'].replace('|','\\|')+' | '+files+' |')
lines+=['','Collection limits:','']+['- '+v for v in report['remaining']]
lines+=['','The README declares LGPLv3 using upstream later-version permissions; upstream original LGPL2.1 texts and complete LGPL3/GPL3 terms are all retained. This bundle does not silently replace upstream terms with a build-script Apache license.','',
'The original exact build recipe is in build-build__posix.sh, including GLib and mozjpeg patches and source modifications; versions are in build-versions.properties. These small files are provenance, not a corresponding-source archive.','']
(OUT/'README.md').write_text('\n'.join(lines),encoding='utf8')
notice=['Native notices for @img/sharp-libvips-linux-x64@1.3.3','This software is based in part on the work of the Independent JPEG Group.','See README.md for exact versions, provenance and remaining redistribution obligations.','']
for row in report['components']:
 for f in row['files']:
  notice+=['='*78,row['name']+' '+row['version']+' — '+f['path'],f['url'],'SHA-256 '+f['sha256'],'='*78,(ROOT/f['localPath']).read_text(encoding='utf8')]
for f in report['supplementalLicenseVersions']:
 notice+=['='*78,'Supplemental full terms: '+f['path'],f['url'],'SHA-256 '+f['sha256'],'='*78,(ROOT/f['localPath']).read_text(encoding='utf8')]
(OUT/'THIRD_PARTY_NOTICES.txt').write_text('\n\n'.join(notice)+'\n',encoding='utf8')
dest=ROOT/'docs/evidence/commercial-acceptance'
for name in ['collect-sharp-native-licenses.py','complete-sharp-native-licenses.py','seal-sharp-native-licenses.py']:shutil.copyfile(ROOT/'.runtime'/name,dest/name)
result={'status':report['collectionStatus'],'distributionComplianceStatus':report['distributionComplianceStatus'],'totals':report['collectionTotals'],'sha256':{str(p.relative_to(ROOT)):sha(p) for p in [P,OUT/'README.md',OUT/'THIRD_PARTY_NOTICES.txt']},'remaining':report['remaining']}
(dest/'sharp-native-license-final-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(result,ensure_ascii=False))

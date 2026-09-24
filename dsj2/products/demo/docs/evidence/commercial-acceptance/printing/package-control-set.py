import hashlib,json,os,sys
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
ROOT=Path.cwd();OUT=ROOT/'docs/evidence/commercial-acceptance/printing'
sys.path.insert(0,str(ROOT/'scripts/render'))
from renderer import export_registry
from openpyxl import load_workbook
sha=lambda b:hashlib.sha256(b).hexdigest()
files={};rows=[]
for t in json.loads((ROOT/'assets/templates/manifest.json').read_text(encoding='utf8'))['templates']:
 for variant in ['short','long']:
  case=t['id']+'-'+variant
  for ext in ['docx','pdf','fixture.json']:
   files[case+'.'+ext]=(OUT/(case+'.'+ext)).read_bytes()
  snap=json.loads(files[case+'.fixture.json']);item=snap['items'][0]
  rows.append(dict(item,id=case,requestId='CONTROL-'+case,status='SYNTHETIC_CONTROL',templateId=t['id'],direction=t['id'].split('-')[0].upper(),documentKind='-'.join(t['id'].split('-')[1:]),revision=1))
registry=OUT/'control-registry.xlsx';export_registry({'items':rows},registry)
wb=load_workbook(registry,read_only=True);actual=list(wb.active.values);assert len(actual)==21;assert 'reason' in actual[0] and 'education' in actual[0];wb.close()
files['control-registry.xlsx']=registry.read_bytes()
files['README_RU.txt']='''СИНТЕТИЧЕСКИЙ КОНТРОЛЬНЫЙ КОМПЛЕКТ DEMO
20 случаев: десять исторических форм, короткие и длинные данные.
Каждый случай независим, номера и люди синтетические. XLSX — каталог контрольных случаев, не реестр выпущенных документов. Архив собран проверяющим из артефактов матрицы; это не результат HTTP ZIP endpoint.
Все DOCX/PDF соответствуют финальной матрице и Word manifest. Метки ДЕМО сохраняются.
Верхняя полоса корочек содержит выдающую организацию RU/KZ.
Печать PDF: A4, фактический размер 100%, автоматическую двустороннюю печать пока не включать. Страницы двухстраничных форм нельзя автоматически считать лицом и оборотом. Схема и контроль линейки находятся в PHYSICAL_PRINT_RU.md продукта.
Word 16.0.17932: требуется Liberation Serif/Sans 2.1.5 (поставлены в fonts с лицензией). Серверный PDF уже содержит закреплённые шрифты.
Нормативная пригодность BIOT и физическая печать BLOCKED: исторические BIOT формы расходятся с действующей редакцией, требуется утверждение эмитента и измерение на доступном физическом принтере.
SHA-256 каждого файла указан в manifest.json. Все страницы базовой матрицы и выборка стресс-пакетов проверены отдельно; отчёт PRINTING_REPORT_RU.md продукта.
'''.encode('utf8')
for p in (ROOT/'assets/fonts').iterdir():
 if p.is_file():files['fonts/'+p.name]=p.read_bytes()
files['manifest.json']=(json.dumps({'scope':'Synthetic engineering control set, not an issuance archive','wordManifestSha256':sha((OUT/'word-final-biot-v15/manifest.json').read_bytes()),'documents':20,'pdfPages':28,'registryRows':20,'files':[{'path':n,'bytes':len(b),'sha256':sha(b)} for n,b in sorted(files.items())]},ensure_ascii=False,indent=2)+'\n').encode('utf8')
zipfile=OUT/'control-print-set.zip'
with ZipFile(zipfile,'w',ZIP_DEFLATED) as z:
 for name,content in sorted(files.items()):z.writestr(name,content)
with ZipFile(zipfile) as z:
 assert set(z.namelist())==set(files)
 for name,content in files.items():assert z.read(name)==content
report={'status':'PASS','path':zipfile.relative_to(ROOT).as_posix(),'sha256':sha(zipfile.read_bytes()),'bytes':zipfile.stat().st_size,'entries':len(files),'documents':20,'pdfPages':28,'registryRows':20,'verification':'Every ZIP entry compared byte-for-byte to standalone source; XLSX read back with 20 rows and field headers.'}
(OUT/'control-print-set-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(report))


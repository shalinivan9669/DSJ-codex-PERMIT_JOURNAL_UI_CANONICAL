"""Fields and bounded layout preflight for the 2026 BIOT paper appendices.

Only immutable templates carrying BIOT2026 captions use this layout policy.
Historical snapshots keep their original templates and geometry.
"""
from pathlib import Path
import re
from PIL import ImageFont

ROOT=Path(__file__).resolve().parents[2]
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
CATEGORIES={
 'WORKER':('Рабочие','Жұмысшылар'),
 'OHS_SPECIALIST_SPECIAL':('Специалисты по безопасности и охране труда','Еңбек қауіпсіздігі және еңбекті қорғау жөніндегі мамандар'),
 'INSPECTOR_SPECIAL':('Технические инспекторы по охране труда','Еңбекті қорғау жөніндегі техникалық инспекторлар'),
 'COUNCIL_SPECIAL':('Председатели производственных советов по безопасности и охране труда','Еңбек қауіпсіздігі және еңбекті қорғау жөніндегі өндірістік кеңестердің төрағалары'),
}
CHECK_TYPES={'PERIODIC':('периодический','мерзімді'),'REPEAT':('повторный','қайта')}

def current_fields(snapshot,item):
 a=item['assignment'];issuer=snapshot['issuer'];commission=issuer.get('commission',[])
 both=lambda x,y:' / '.join(filter(None,[x,y]))
 category=CATEGORIES.get(a.get('biotCategory'),('',''));check=CHECK_TYPES.get(a.get('biotCheckType'),('',''))
 employer=lambda suffix:', '.join(filter(None,[item.get('workplace'+suffix),item.get('employerAddress'+suffix)]))
 f={'REGISTRATION_NUMBER_DISPLAY':item.get('registrationNumber') or item.get('number',''),
    'EMPLOYER_BIN':item.get('employerBin',''),'EMPLOYER_NAME_ADDRESS_BOTH':both(employer('Ru'),employer('Kz')),
    'DEPARTMENT_BOTH':both(item.get('departmentRu'),item.get('departmentKz')),
    'ISSUER_BIN':issuer.get('bin',''),'ISSUER_HEAD_NAME':issuer.get('headName',''),
    'BIOT_CATEGORY_RU':category[0],'BIOT_CATEGORY_KZ':category[1],
    'BIOT_CHECK_TYPE_RU':check[0],'BIOT_CHECK_TYPE_KZ':check[1],
    'BIOT_INDUSTRY_RU':a.get('biotIndustryRu',''),'BIOT_INDUSTRY_KZ':a.get('biotIndustryKz',''),
    'BIOT_KNOWLEDGE_RESULT':a.get('biotKnowledgeResult',''),'BIOT_PROCTORING_RESULT':a.get('biotProctoringResult',''),
    'BIOT_UNIQUE_NUMBER':a.get('biotUniqueNumber') or item.get('credentialNumber',''),'BIOT_NOTES':a.get('biotNotes',''),
    'PRODUCTION_HOURS':str(a.get('productionHours') or '')}
 for index,prefix in enumerate(['CHAIR','MEMBER_1','MEMBER_2']):
  member=commission[index] if len(commission)>index else {}
  f[prefix+'_NAME']=member.get('name','');f[prefix+'_POSITION']=member.get('position','')
 return f

def assert_page_fit(tree):
 """Measure the fixed font paragraphs before issuance, never truncate or shrink.

Rendered PDF page/cell assertions remain the independent acceptance oracle.
This deliberately reserves 8pt at the page bottom for converter rounding.
"""
 section=next(tree.iter(W+'sectPr'));size=section.find(W+'pgSz');margin=section.find(W+'pgMar')
 width=(int(size.get(W+'w'))-int(margin.get(W+'left'))-int(margin.get(W+'right')))/20
 available=(int(size.get(W+'h'))-int(margin.get(W+'top'))-int(margin.get(W+'bottom')))/20-8
 def paragraph_height(p,space):
  value=''.join((n.text or '') if n.tag==W+'t' else '\n' for n in p.iter() if n.tag in [W+'t',W+'br'])
  sz=p.find('.//'+W+'sz');points=int(sz.get(W+'val'))/2 if sz is not None else 10
  font=ImageFont.truetype(str(ROOT/'assets/fonts/LiberationSerif-Regular.ttf'),round(points*10))
  spacing=p.find(W+'pPr/'+W+'spacing');line=float(spacing.get(W+'line',str((points+2)*20)))/20 if spacing is not None else points+2
  extra=sum(float(spacing.get(W+k,'0'))/20 for k in ['before','after']) if spacing is not None else 0
  lines=0
  for raw in value.split('\n'):
   current='';count=1
   for token in re.findall(r'[^\s/–—-]+(?:[/–—-]|\s*)',raw):
    if font.getlength(token.strip())/10>space:raise ValueError('PRINT_LAYOUT_OVERFLOW')
    if current and font.getlength(current+token)/10>space:count+=1;current=token
    else:current+=token
   lines+=count
  return lines*line+extra
 def table_height(table):
  total=0
  for row in table.findall(W+'tr'):
   heights=[]
   for cell in row.findall(W+'tc'):
    cell_width=float(cell.find(W+'tcPr/'+W+'tcW').get(W+'w'))/20-9
    heights.append(7+sum(paragraph_height(p,cell_width) for p in cell.findall(W+'p')))
   total+=max(heights)
  return total
 body=tree.find(W+'body');height=0
 for child in body:
  if child.tag==W+'p':height+=paragraph_height(child,width)
  elif child.tag==W+'tbl':height+=table_height(child)
 if height>available:raise ValueError('PRINT_LAYOUT_OVERFLOW')

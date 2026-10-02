"""An optional, filled English appendix in the same issued DOCX/PDF.

Original KZ/RU contents stay first. An appendix is a translation of that same
record, with the same reserved numbers, never a separately numbered issuance.
Only supplied English fields and factual structured outcomes are accepted.
"""
from copy import deepcopy
from datetime import date
import json
from lxml import etree as E

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
TITLES = {
    'biot-worker-card':'Occupational safety and health credential',
    'biot-itr-certificate':'Occupational safety and health certificate',
    'biot-protocol':'Occupational safety and health examination protocol',
    'biot-itr-protocol':'Occupational safety and health examination protocol',
    'ptm-card':'Fire safety training credential',
    'ptm-protocol':'Fire safety examination protocol',
    'pb-card':'Industrial safety credential',
    'pb-protocol':'Industrial safety examination protocol',
    'ps-card':'Vocational training credential',
    'ps-protocol':'Vocational qualification examination protocol',
    'ps-witness':'Vocational training certificate',
}
OUTCOMES = {'PASSED':'Passed','FAILED':'Failed','ABSENT':'Absent'}
SIGNERS = {
    'biot-worker-card':2,'biot-itr-certificate':1,'ptm-card':1,
    'pb-card':1,'ps-card':3,'ps-witness':1,
    'biot-protocol':3,'biot-itr-protocol':3,'ptm-protocol':3,'pb-protocol':3,'ps-protocol':3,
}
CATEGORY_EN = {'WORKER':'Worker','ITR':'Engineering and technical personnel',
    'OHS_SPECIALIST_SPECIAL':'Occupational safety and health specialist',
    'INSPECTOR_SPECIAL':'Technical occupational safety inspector',
    'COUNCIL_SPECIAL':'Chair of the occupational safety production council'}


def result_en(assignment):
    value = assignment.get('resultEn','').strip()
    if value: return value
    return OUTCOMES.get((assignment.get('outcome') or {}).get('status'), '')


def validate_english(snapshot):
    if snapshot.get('englishAppendix') is not True: return
    missing = []
    issuer = snapshot.get('issuer',{})
    for key in ['nameEn','cityEn']:
        if not issuer.get(key,'').strip(): missing.append('issuer.'+key)
    if (issuer.get('addressRu') or issuer.get('addressKz')) and not issuer.get('addressEn','').strip():
        missing.append('issuer.addressEn')
    for index,member in enumerate(issuer.get('commission',[])[:SIGNERS[snapshot['templateId']]]):
        for field in ['name','position']:
            if member.get(field,'').strip() and not member.get(field+'En','').strip():missing.append(f'issuer.commission.{index}.{field}En')
    for field in ['headName','approvalBasis']:
        if issuer.get(field,'').strip() and not issuer.get(field+'En','').strip():missing.append('issuer.'+field+'En')
    for index,item in enumerate(snapshot.get('items',[])):
        for key in ['fullNameEn','positionEn','workplaceEn']:
            if not item.get(key,'').strip(): missing.append(f'items.{index}.{key}')
        assignment=item['assignment']
        if not assignment.get('trainingSubjectEn','').strip():missing.append(f'items.{index}.assignment.trainingSubjectEn')
        if not result_en(assignment):missing.append(f'items.{index}.assignment.resultEn')
        for field in ['reason','education']:
            if assignment.get(field,'').strip() and not assignment.get(field+'En','').strip():
                missing.append(f'items.{index}.assignment.{field}En')
        for field in ['biotIndustry','biotKnowledgeResult','biotProctoringResult','biotNotes']:
            if (assignment.get(field) or assignment.get(field+'Ru') or assignment.get(field+'Kz')) and not assignment.get(field+'En','').strip():missing.append(f'items.{index}.assignment.{field}En')
        for field in ['employerAddress','department']:
            if (item.get(field+'Ru') or item.get(field+'Kz')) and not item.get(field+'En','').strip():missing.append(f'items.{index}.{field}En')
    if missing:raise ValueError('ENGLISH_FIELDS_REQUIRED:'+','.join(missing))
    english_values=[value for key,value in issuer.items() if key.endswith('En')]
    for item in snapshot.get('items',[]):
        english_values.extend(value for key,value in item.items() if key.endswith('En'))
        english_values.extend(value for key,value in item['assignment'].items() if key.endswith('En'))
    if any(len(token)>80 for value in english_values for token in str(value).split()):
        raise ValueError('PRINT_LAYOUT_OVERFLOW')


def text_paragraph(value, size=22, bold=False, keep=False):
    p=E.Element(W+'p'); props=E.SubElement(p,W+'pPr')
    E.SubElement(props,W+'spacing',{W+'before':'0',W+'after':'60',W+'line':'240',W+'lineRule':'auto'})
    if keep:E.SubElement(props,W+'keepNext')
    r=E.SubElement(p,W+'r');rp=E.SubElement(r,W+'rPr')
    E.SubElement(rp,W+'rFonts',{W+'ascii':'Liberation Sans',W+'hAnsi':'Liberation Sans',W+'cs':'Liberation Sans'})
    E.SubElement(rp,W+'sz',{W+'val':str(size)});E.SubElement(rp,W+'color',{W+'val':'000000'})
    E.SubElement(rp,W+'lang',{W+'val':'en-US'})
    if bold:E.SubElement(rp,W+'b')
    E.SubElement(r,W+'t').text=str(value)
    return p


def display_date(value):
    if not value:return ''
    parsed=date.fromisoformat(value)
    months=['January','February','March','April','May','June','July','August','September','October','November','December']
    return f'{parsed.day:02} {months[parsed.month-1]} {parsed.year}'


def english_header(files,snapshot):
    header=E.Element(W+'hdr',nsmap={'w':W[1:-1]})
    label=('DEMO - NOT AN ISSUED DOCUMENT' if snapshot.get('demoMode') else
           'PREVIEW - NOT AN ISSUED DOCUMENT' if snapshot.get('mode')=='draft-preview' else snapshot['issuer']['nameEn'])
    header.append(text_paragraph(label,size=16))
    part='word/demo-english-header.xml';rid='rIdDemoEnglishHeader'
    files[part]=E.tostring(header,xml_declaration=True,encoding='utf-8')
    rels=E.fromstring(files['word/_rels/document.xml.rels'])
    if not any(r.get('Id')==rid for r in rels):E.SubElement(rels,PKG+'Relationship',Id=rid,Type=R[1:-1]+'/header',Target='demo-english-header.xml')
    files['word/_rels/document.xml.rels']=E.tostring(rels,xml_declaration=True,encoding='utf-8')
    content=E.fromstring(files['[Content_Types].xml'])
    if not any(n.get('PartName')=='/'+part for n in content):
        E.SubElement(content,CT+'Override',PartName='/'+part,ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml')
    files['[Content_Types].xml']=E.tostring(content,xml_declaration=True,encoding='utf-8')
    return rid


def add_form_table(parent,panels,widths):
    table=E.SubElement(parent,W+'tbl');props=E.SubElement(table,W+'tblPr')
    E.SubElement(props,W+'tblW',{W+'w':str(sum(widths)),W+'type':'dxa'})
    E.SubElement(props,W+'tblLayout',{W+'type':'fixed'})
    borders=E.SubElement(props,W+'tblBorders')
    for side in ['top','left','bottom','right','insideV']:
        E.SubElement(borders,W+side,{W+'val':'single',W+'sz':'6',W+'color':'222222'})
    grid=E.SubElement(table,W+'tblGrid')
    for width in widths:E.SubElement(grid,W+'gridCol',{W+'w':str(width)})
    row=E.SubElement(table,W+'tr')
    for paragraphs,width in zip(panels,widths):
        cell=E.SubElement(row,W+'tc');pr=E.SubElement(cell,W+'tcPr')
        E.SubElement(pr,W+'tcW',{W+'w':str(width),W+'type':'dxa'})
        margins=E.SubElement(pr,W+'tcMar')
        for side in ['top','bottom','left','right']:E.SubElement(margins,W+side,{W+'w':'140',W+'type':'dxa'})
        for paragraph in paragraphs:cell.append(paragraph)
    return table


def translated_details(snapshot,item):
    a=item['assignment'];values=[]
    for label,value in [('Employee category',CATEGORY_EN.get(item.get('employeeCategory'),'')),
        ('Training start',display_date(a.get('trainingStart'))),('Training end',display_date(a.get('trainingEnd'))),
        ('Training hours',a.get('hours','')),('Practical training hours',a.get('productionHours','')),
        ('Validity','Unlimited' if a.get('validityMode')=='UNLIMITED' else display_date(a.get('validUntil'))),
        ('Reason for training',a.get('reasonEn','')),('Education',a.get('educationEn','')),
        ('Employer identification number',item.get('employerBin','')),('Employer address',item.get('employerAddressEn','')),
        ('Department',item.get('departmentEn','')),('Industry',a.get('biotIndustryEn','')),
        ('Knowledge assessment',a.get('biotKnowledgeResultEn','')),('Proctoring result',a.get('biotProctoringResultEn','')),
        ('Unique number',a.get('biotUniqueNumber','')),('Notes',a.get('biotNotesEn',''))]:
        if value:values.append((label,str(value)))
    if a.get('biotCategory'):values.append(('Training category',CATEGORY_EN.get(a['biotCategory'],a['biotCategory'])))
    if a.get('biotCheckType'):values.append(('Knowledge check type',{'PERIODIC':'Periodic','REPEAT':'Repeat'}.get(a['biotCheckType'],a['biotCheckType'])))
    return values


def signer_paragraphs(snapshot,size=20):
    paragraphs=[];tid=snapshot['templateId'];issuer=snapshot['issuer']
    for index,member in enumerate(issuer.get('commission',[])[:SIGNERS[tid]]):
        role=('Head of the training centre' if tid=='ptm-card' else 'Commission chair') if index==0 else 'Commission member'
        name=issuer.get('headNameEn') if tid=='ptm-card' and issuer.get('headNameEn') else member.get('nameEn','')
        paragraphs.append(text_paragraph(role+': '+name,size=size))
        if member.get('positionEn'):paragraphs.append(text_paragraph(member['positionEn'],size=size))
        paragraphs.append(text_paragraph('Signature: ____________________',size=size))
    if tid in ['biot-worker-card','ptm-card','pb-card','ps-card','ps-witness']:
        paragraphs.append(text_paragraph('Seal',size=size))
    return paragraphs


def append_individual_form(body,snapshot,item):
    """A filled translated form: identity, training, examination and signatures."""
    tid=snapshot['templateId'];a=item['assignment'];issuer=snapshot['issuer']
    body.append(text_paragraph(TITLES[tid],size=28,bold=True,keep=True))
    number=item.get('number','');registration=item.get('registrationNumber','')
    if tid in ['biot-itr-certificate','ps-witness']:
        body.append(text_paragraph('Certificate number: '+number,size=24,bold=True))
        body.append(text_paragraph('This certificate confirms that',size=22))
        body.append(text_paragraph(item['fullNameEn'],size=30,bold=True,keep=True))
        body.append(text_paragraph(('completed vocational training and the qualification examination for the profession of ' if tid=='ps-witness' else 'completed the training programme and knowledge assessment for ')+item['positionEn']+'.',size=22))
        body.append(text_paragraph('Training programme: '+a['trainingSubjectEn'],size=22,bold=True))
        body.append(text_paragraph('Employer or workplace: '+item['workplaceEn'],size=22))
        body.append(text_paragraph('Assessment result: '+result_en(a),size=22))
        for label,value in translated_details(snapshot,item):body.append(text_paragraph(label+': '+value,size=20))
        body.append(text_paragraph('Examination protocol: '+(item.get('protocolNumber') or a.get('externalBasisNumber',''))+' dated '+display_date(a.get('protocolDate')),size=20))
        if registration:body.append(text_paragraph('Registration number: '+registration,size=20))
        body.append(text_paragraph('Issue date: '+display_date(a.get('documentDate')),size=20))
        for paragraph in signer_paragraphs(snapshot):body.append(paragraph)
    else:
        left=[text_paragraph('Credential number: '+number,size=24,bold=True),text_paragraph(item['fullNameEn'],size=24,bold=True),
              text_paragraph('Position or profession: '+item['positionEn'],size=20),text_paragraph('Employer or workplace: '+item['workplaceEn'],size=20),
              text_paragraph('Issue date: '+display_date(a.get('documentDate')),size=20)]
        left.extend(text_paragraph(label+': '+value,size=20) for label,value in translated_details(snapshot,item))
        right=[text_paragraph('Training and examination',size=24,bold=True),
            text_paragraph('The holder completed the training programme and was assessed on knowledge of '+a['trainingSubjectEn']+'.',size=20),
            text_paragraph('Assessment result: '+result_en(a),size=20),
            text_paragraph('Examination protocol: '+(item.get('protocolNumber') or a.get('externalBasisNumber','')),size=20),
            text_paragraph('Protocol date: '+display_date(a.get('protocolDate')),size=20)]
        if registration:right.append(text_paragraph('Registration number: '+registration,size=20))
        right.extend(signer_paragraphs(snapshot))
        add_form_table(body,[left,right],[4873,4873]);body.append(text_paragraph('',size=4))
        if tid=='ps-card':
            body.append(text_paragraph('Printed form instructions: Personnel operating industrial boilers, supervising the technical condition of boilers, gas facilities, hoisting equipment and other industrial facilities must hold the appropriate credential. Personnel serving industrial facilities undergo a repeat knowledge assessment once every 12 months.',size=18))
    if issuer.get('approvalBasisEn'):body.append(text_paragraph('Authority for the examination: '+issuer['approvalBasisEn'],size=18))
    if issuer.get('bin'):body.append(text_paragraph('Issuer identification number: '+issuer['bin'],size=18))


def append_english_pages(files,snapshot):
    if snapshot.get('englishAppendix') is not True:return files
    validate_english(snapshot)
    protocol=snapshot['templateId'].endswith('-protocol')
    root=E.fromstring(files['word/document.xml']);body=root.find(W+'body')
    original=body.find(W+'sectPr')
    if original is None:raise ValueError('ENGLISH_ORIGINAL_SECTION_MISSING')
    boundary=text_paragraph('',size=2)
    boundary_pr=boundary.find(W+'pPr');boundary_pr.remove(boundary_pr.find(W+'spacing'))
    section=deepcopy(original)
    # This section describes the original content and its existing start type.
    # Forcing nextPage here can split a continuous original booklet section.
    boundary_pr.append(section)
    body.remove(original);body.append(boundary)
    appendix=E.Element(W+'sectPr')
    E.SubElement(appendix,W+'type',{W+'val':'nextPage'})
    rid=english_header(files,snapshot)
    for kind in ['default','first','even']:E.SubElement(appendix,W+'headerReference',{W+'type':kind,R+'id':rid})
    metadata=json.loads(files.get('demo/original-form.json',b'{}'))
    if (metadata.get('version')==2 and metadata.get('layoutPolicy')=='SOURCE_FIDELITY_V2') or 'word/demo-footer.xml' in files:
        # The appendix has its own English mark and can use another page size.
        # Stop it inheriting the source form's page-relative footer overlay.
        part='word/demo-english-footer.xml';footer_rid='rIdDemoEnglishFooter'
        footer=E.Element(W+'ftr',nsmap={'w':W[1:-1]});E.SubElement(footer,W+'p')
        files[part]=E.tostring(footer,xml_declaration=True,encoding='utf-8')
        rels=E.fromstring(files['word/_rels/document.xml.rels'])
        if not any(r.get('Id')==footer_rid for r in rels):
            E.SubElement(rels,PKG+'Relationship',Id=footer_rid,Type=R[1:-1]+'/footer',Target='demo-english-footer.xml')
        files['word/_rels/document.xml.rels']=E.tostring(rels,xml_declaration=True,encoding='utf-8')
        content=E.fromstring(files['[Content_Types].xml'])
        if not any(n.get('PartName')=='/'+part for n in content):
            E.SubElement(content,CT+'Override',PartName='/'+part,ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml')
        files['[Content_Types].xml']=E.tostring(content,xml_declaration=True,encoding='utf-8')
        for kind in ['default','first','even']:
            E.SubElement(appendix,W+'footerReference',{W+'type':kind,R+'id':footer_rid})
    E.SubElement(appendix,W+'pgSz',({W+'w':'16838',W+'h':'11906',W+'orient':'landscape'} if protocol else {W+'w':'11906',W+'h':'16838'}))
    E.SubElement(appendix,W+'pgMar',{W+'top':'1080',W+'right':'1080',W+'bottom':'1080',W+'left':'1080',W+'header':'360',W+'footer':'360',W+'gutter':'0'})
    body.append(text_paragraph('English appendix',size=28,bold=True,keep=True))
    if protocol:body.append(text_paragraph(TITLES[snapshot['templateId']],size=24,bold=True,keep=True))
    body.append(text_paragraph('Translation of the attached Kazakh and Russian record. The document identifiers below refer to the same issuance.',size=18))
    issuer=snapshot['issuer'];body.append(text_paragraph('Issuing organisation: '+issuer['nameEn']))
    body.append(text_paragraph('City: '+issuer['cityEn']))
    if issuer.get('addressEn'):body.append(text_paragraph('Address: '+issuer['addressEn']))
    if protocol:
        first=snapshot['items'][0];assignment=first['assignment']
        body.append(text_paragraph('Protocol number: '+first.get('protocolNumber',first.get('number',''))))
        body.append(text_paragraph('Protocol date: '+display_date(assignment.get('protocolDate'))))
        body.append(text_paragraph('Training programme: '+assignment['trainingSubjectEn']))
        body.append(text_paragraph('Participants: '+str(len(snapshot['items']))))
        if issuer.get('bin'):body.append(text_paragraph('Issuer identification number: '+issuer['bin'],size=18))
        if issuer.get('approvalBasisEn'):body.append(text_paragraph('Authority for the examination: '+issuer['approvalBasisEn'],size=18))
        for index,member in enumerate(issuer.get('commission',[])[:3]):
            body.append(text_paragraph(('Commission chair: ' if index==0 else 'Commission member: ')+member.get('nameEn','')+' — '+member.get('positionEn',''),size=18))
        table=E.SubElement(body,W+'tbl');props=E.SubElement(table,W+'tblPr')
        E.SubElement(props,W+'tblW',{W+'w':'14678',W+'type':'dxa'})
        E.SubElement(props,W+'tblLayout',{W+'type':'fixed'})
        borders=E.SubElement(props,W+'tblBorders')
        for side in ['top','left','bottom','right','insideH','insideV']:E.SubElement(borders,W+side,{W+'val':'single',W+'sz':'4',W+'color':'999999'})
        widths=[500,3300,2400,3200,5278];grid=E.SubElement(table,W+'tblGrid')
        for width in widths:E.SubElement(grid,W+'gridCol',{W+'w':str(width)})
        rows=[['No.','Full name','Position or profession','Employer or workplace','Result and record details']]
        for index,item in enumerate(snapshot['items'],1):
            record=item['assignment']
            details=[result_en(record)]
            for label,value in [('Credential number',item.get('credentialNumber','')),('Issue date',display_date(record.get('documentDate'))),('Training start',display_date(record.get('trainingStart'))),('Training end',display_date(record.get('trainingEnd'))),('Training hours',record.get('hours','')),('Practical training hours',record.get('productionHours','')),('Validity','Unlimited' if record.get('validityMode')=='UNLIMITED' else display_date(record.get('validUntil'))),('Education',record.get('educationEn','')),('Reason for training',record.get('reasonEn',''))]:
                if value:details.append(label+': '+str(value))
            details.extend(label+': '+value for label,value in translated_details(snapshot,item) if label not in ['Training start','Training end','Training hours','Practical training hours','Validity','Education','Reason for training'])
            rows.append([str(index),item['fullNameEn'],item['positionEn'],item['workplaceEn'],'; '.join(details)])
        for index,values in enumerate(rows):
            row=E.SubElement(table,W+'tr');rpr=E.SubElement(row,W+'trPr');E.SubElement(rpr,W+'cantSplit')
            if index==0:E.SubElement(rpr,W+'tblHeader')
            for value,width in zip(values,widths):
                cell=E.SubElement(row,W+'tc');cp=E.SubElement(cell,W+'tcPr')
                E.SubElement(cp,W+'tcW',{W+'w':str(width),W+'type':'dxa'})
                margins=E.SubElement(cp,W+'tcMar')
                for side in ['top','bottom','left','right']:E.SubElement(margins,W+side,{W+'w':'80',W+'type':'dxa'})
                cell.append(text_paragraph(value,size=18,bold=index==0))
        body.append(text_paragraph('',size=4))
        # Keep all signatures in one compact three-column block below the roster.
        # A one-person protocol must not acquire a page of isolated signatures.
        panels=[]
        for index,member in enumerate(issuer.get('commission',[])[:3]):
            panels.append([text_paragraph('Commission chair' if index==0 else 'Commission member',size=18,bold=True),
                text_paragraph(member.get('nameEn',''),size=18),text_paragraph(member.get('positionEn',''),size=18),
                text_paragraph('Signature: ____________________',size=18)])
        if panels:add_form_table(body,panels,[14678//len(panels)]*len(panels));body.append(text_paragraph('',size=4))
    else:
        for index,item in enumerate(snapshot['items']):
            if index:
                paragraph=text_paragraph('',size=2);E.SubElement(paragraph.find(W+'pPr'),W+'pageBreakBefore');body.append(paragraph)
            append_individual_form(body,snapshot,item)
    body.append(appendix)
    files['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='utf-8')
    return files

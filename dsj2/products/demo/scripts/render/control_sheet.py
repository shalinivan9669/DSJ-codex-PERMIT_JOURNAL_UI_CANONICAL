"""Unnumbered customer data review, deliberately separate from issued credentials."""
from pathlib import Path
import tempfile
from lxml import etree as E
from sanitize_templates import deterministic_zip

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def control_sheet(payload, out, convert_pdf):
    root = E.Element('{%s}document' % W, nsmap={'w': W})
    body = E.SubElement(root, '{%s}body' % W)
    def sub(parent, name, **attributes):
        return E.SubElement(parent, '{%s}%s' % (W, name), {'{%s}%s' % (W, key): str(value) for key, value in attributes.items()})
    def paragraph(parent, text, bold=False):
        p=sub(parent, 'p'); run=sub(p, 'r'); props=sub(run, 'rPr')
        sub(props, 'rFonts', ascii='DejaVu Sans', hAnsi='DejaVu Sans', cs='DejaVu Sans')
        sub(props, 'sz', val=17)
        if bold: sub(props, 'b')
        node=sub(run, 't'); node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve'); node.text=str(text or '')
    paragraph(body, payload['notice'], True)
    paragraph(body, 'Редакция: %s. Сверка сведений; не ЭЦП и не результат экзамена.' % payload['revision'])
    columns=[('personnelNumber','Таб. №'),('fullNameRu','ФИО RU / KZ'),('workplaceRu','Работодатель / должность'),('programLabel','Документ / программа'),('trainingStart','Обучение'),('documentDate','Оформление')]
    table=sub(body,'tbl'); props=sub(table,'tblPr'); sub(props,'tblW',w=15000,type='dxa'); sub(props,'tblLayout',type='fixed')
    borders=sub(props,'tblBorders')
    for edge in ['top','bottom','left','right','insideH','insideV']: sub(borders,edge,val='single',sz=4,color='CCCCCC')
    grid=sub(table,'tblGrid')
    widths=[1000,3300,3300,3900,1800,1700]
    for width in widths: sub(grid,'gridCol',w=width)
    for index,row in enumerate([dict(columns)]+payload['rows']):
        tr=sub(table,'tr'); trprops=sub(tr,'trPr'); sub(trprops,'cantSplit')
        if index==0: sub(trprops,'tblHeader')
        for (key,title),width in zip(columns,widths):
            cell=sub(tr,'tc'); sub(sub(cell,'tcPr'),'tcW',w=width,type='dxa')
            value=row.get(key,'')
            if index:
                extra={'fullNameRu':row.get('fullNameKz'), 'workplaceRu':row.get('positionRu'), 'programLabel':row.get('trainingSubject'), 'trainingStart':row.get('trainingEnd')}.get(key)
                if extra: value=str(value or '')+' / '+str(extra)
            paragraph(cell,value,index==0)
    paragraph(body,'Контрольная сумма согласуемых сведений: '+payload['meaningfulHash'])
    sect=sub(body,'sectPr'); sub(sect,'pgSz',w=16838,h=11906,orient='landscape'); sub(sect,'pgMar',top=700,bottom=700,left=700,right=700,header=300,footer=300,gutter=0)
    document=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    with tempfile.TemporaryDirectory(prefix='demo-control-sheet-') as temp:
        docx=Path(temp)/'control.docx'
        deterministic_zip(docx,{
          '[Content_Types].xml':b'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
          '_rels/.rels':b'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
          'word/document.xml':document,
        })
        result=convert_pdf(docx,out)
    return {**result,'purpose':'CUSTOMER_DATA_REVIEW','rows':len(payload['rows']),'meaningfulHash':payload['meaningfulHash']}

"""Restore the retained DSJ design as new versions, without altering any source.

The archive is an explicit build-time input only. Runtime stays autonomous.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZipFile
from lxml import etree as E
from package_xml import normalize_package
from sanitize_templates import deterministic_zip, replace_text_nodes

ROOT = Path(__file__).resolve().parents[2]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
V = '{urn:schemas-microsoft-com:vml}'
MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'
NS = {'w': W[1:-1]}
SOURCES = {
    'biot-worker-card': ('biot-worker-card.v15.docx', 17),
    'biot-itr-certificate': ('biot-itr-certificate.v13.docx', 15),
    'biot-protocol': ('biot-protocol.v9.docx', 11),
    'biot-itr-protocol': ('biot-protocol.v9.docx', 2),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def set_text(paragraph, value):
    nodes = list(paragraph.iter(W+'t'))
    if nodes:
        nodes[0].text = value
        for node in nodes[1:]: node.text = ''
    else:
        E.SubElement(E.SubElement(paragraph, W+'r'), W+'t').text = value


def restore_protocol(tree):
    """Keep the six historic columns; repair source semantics and flowing signs."""
    body = tree.find(W+'body')
    roster = next(t for t in tree.iter(W+'tbl') if '№' in ''.join(t.find(W+'tr').itertext()))
    E.SubElement(roster.find(W+'tblPr'), W+'tblCaption', {W+'val':'DSJ_RESTORED_BIOT_PROTOCOL'})
    for old in roster.find(W+'tblPr').findall(W+'jc'): roster.find(W+'tblPr').remove(old)
    E.SubElement(roster.find(W+'tblPr'), W+'jc', {W+'val':'center'})
    for p in tree.iter(W+'p'):
        nodes = p.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t', namespaces=NS)
        value = ''.join(n.text or '' for n in nodes)
        if value.strip() == '{{WORKPLACE_KZ}}':
            set_text(p, '{{WORKPLACE_BOTH}}')
        if 'бiлiмiн тексеру түрi' in value:
            set_text(p, 'Білімін тексеру түрі: {{BIOT_CHECK_TYPE_KZ}}')
        if 'вид проверки знаний' in value:
            set_text(p, 'Вид проверки знаний: {{BIOT_CHECK_TYPE_RU}}')
    data = roster.findall(W+'tr')[2].findall(W+'tc')
    for index, value in [(1, '{{FULL_NAME_BOTH}}'), (2, '{{WORKPLACE_BOTH}}'), (3, '{{POSITION_BOTH}}'), (5, '{{BIOT_NOTES}}')]:
        paragraphs = data[index].findall(W+'p')
        set_text(paragraphs[0], value)
        for paragraph in paragraphs[1:]: set_text(paragraph, '')
    # The source has three floating columns (names, signature lines, labels).
    # A single unbordered table retains that left-to-right arrangement while
    # following a 100-member roster, without hard-coded page coordinates.
    tables = [t for t in body.findall(W+'tbl') if t is not roster]
    assert len(tables) == 3, 'DSJ_SIGNATURE_SOURCE_CONTRACT'
    names, signs, labels = tables
    signature = E.Element(W+'tbl')
    pr = E.SubElement(signature, W+'tblPr')
    E.SubElement(pr, W+'tblW', {W+'w':'9360', W+'type':'dxa'})
    E.SubElement(pr, W+'tblLayout', {W+'type':'fixed'})
    borders = E.SubElement(pr, W+'tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:
        E.SubElement(borders, W+side, {W+'val':'nil'})
    grid = E.SubElement(signature, W+'tblGrid')
    for width in [2760, 3300, 3300]: E.SubElement(grid, W+'gridCol', {W+'w':str(width)})
    label_values = ['Комиссия төрағасы: / Председатель комиссии:', '', 'Комиссия мүшелері: / Члены комиссии:', '', 'М.О. / М.П.', '']
    for index in range(6):
        row = E.SubElement(signature, W+'tr')
        E.SubElement(E.SubElement(row, W+'trPr'), W+'cantSplit')
        for column, source in enumerate([labels, names, signs]):
            rows = source.findall(W+'tr')
            cell = deepcopy(rows[min(index, len(rows)-1)].find(W+'tc'))
            cp = cell.find(W+'tcPr')
            cp.find(W+'tcW').set(W+'w', str([2760, 3300, 3300][column]))
            paragraphs = cell.findall(W+'p')
            if column == 0:
                set_text(paragraphs[0],label_values[index])
                for extra in paragraphs[1:]:cell.remove(extra)
            for p in cell.iter(W+'p'):
                if column == 1 and index % 2 == 0: set_text(p, '{{'+['CHAIR_NAME','MEMBER_1_NAME','MEMBER_2_NAME'][index//2]+'}}')
                pp = p.find(W+'pPr')
                if pp is None: pp = E.Element(W+'pPr'); p.insert(0, pp)
                for old in pp.findall(W+'keepNext'): pp.remove(old)
                if index < 5: E.SubElement(pp, W+'keepNext')
            row.append(cell)
    insert = body.index(tables[0])
    for table in tables: body.remove(table)
    body.insert(insert, signature)
    return tree


def issuer_slot(tree):
    """Replace the source's fixed logo with the actual versioned issuer name.

    Uses the original logo coordinates; no former issuer image/data is reused.
    """
    title = next(b for b in tree.iter(W+'txbxContent') if ''.join(b.itertext()).strip() == 'Сертификат')
    alternate = next(a for a in title.iterancestors() if a.tag == MC+'AlternateContent')
    clone = deepcopy(alternate)
    for anchor in clone.iter(WP+'anchor'):
        anchor.find(WP+'positionH/'+WP+'posOffset').text = '7173118'
        anchor.find(WP+'positionV/'+WP+'posOffset').text = '213518'
        for extent in [anchor.find(WP+'extent'), anchor.find('.//'+A+'xfrm/'+A+'ext')]:
            extent.set('cx','3215614'); extent.set('cy','753770')
        props = anchor.find(WP+'docPr'); props.set('id','970001'); props.set('name','DSJIssuerSlot')
    for shape in clone.iter(V+'shape'):
        style = shape.get('style','')
        for key, number in [('margin-left',7173118/12700),('margin-top',213518/12700),('width',3215614/12700),('height',753770/12700)]:
            style = re.sub(r'(^|;)'+key+r':-?[\d.]+pt', lambda m:m[1]+key+':'+str(number)+'pt', style)
        shape.set('style',style); shape.set('id','DSJIssuerSlot')
    for box in clone.iter(W+'txbxContent'):
        for child in list(box): box.remove(child)
        p = E.SubElement(box,W+'p'); pr = E.SubElement(p,W+'pPr')
        E.SubElement(pr,W+'jc',{W+'val':'center'})
        E.SubElement(pr,W+'spacing',{W+'before':'0',W+'after':'0',W+'line':'280',W+'lineRule':'exact'})
        r = E.SubElement(p,W+'r'); rp = E.SubElement(r,W+'rPr')
        E.SubElement(rp,W+'rFonts',{W+'ascii':'Liberation Sans',W+'hAnsi':'Liberation Sans',W+'cs':'Liberation Sans'})
        E.SubElement(rp,W+'sz',{W+'val':'24'}); E.SubElement(rp,W+'szCs',{W+'val':'24'})
        E.SubElement(r,W+'t').text = '{{ISSUER_BOTH}}'
    alternate.addnext(clone)


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--replace-unpublished', action='store_true', help='Only before these new versions have been provisioned or issued')
    args = parser.parse_args()
    directory = ROOT/'assets/templates'
    manifest = json.loads((directory/'manifest.json').read_text(encoding='utf8'))
    historical = json.loads((args.archive/'manifest-before-biot-2026.json').read_text(encoding='utf8'))
    previous_report = json.loads((directory/'dsj-restoration-changes.json').read_text(encoding='utf8')) if (directory/'dsj-restoration-changes.json').exists() else []
    report = []
    for tid, (filename, version) in SOURCES.items():
        source = args.archive/filename; source_checksum = sha(source)
        old = next(t for t in manifest['templates'] if t['id'] == tid)
        original_entry = next((r for r in previous_report if r['id']==tid), None)
        old_checksum = old.get('previousTemplateSha256') if old.get('formRevision')=='DSJ_RESTORED_2026_09' else old['sha256']
        old_file = original_entry['previous'] if original_entry else old['file']
        historic = next(t for t in historical['templates'] if t['id'] == ('biot-protocol' if tid.endswith('protocol') else tid))
        assert source_checksum == historic['sha256'], 'DSJ_ARCHIVE_HASH_MISMATCH'
        with ZipFile(source) as z: files = {n:z.read(n) for n in z.namelist()}
        tree = E.fromstring(files['word/document.xml'])
        if tid.endswith('protocol'): tree = restore_protocol(tree)
        if tid == 'biot-itr-certificate': issuer_slot(tree)
        if tid == 'biot-worker-card':
            for p in tree.iter(W+'p'):
                nodes = p.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces=NS)
                # The historic printed captions already state these roles.
                # Repeating profile positions in the name line wastes the
                # bounded panel and can reject normal server number lengths.
                for member in ['CHAIR','MEMBER_1','MEMBER_2']:
                    replace_text_nodes(nodes,re.escape('{{'+member+'}}'),'{{'+member+'_NAME}}')
            for box in tree.iter(W+'txbxContent'):
                if '{{CHAIR_NAME}}' not in ''.join(box.itertext()):continue
                shape=next(n for n in box.iterancestors() if E.QName(n).localname in ['shape','anchor'])
                # Source panel is 172.25pt tall. The content starts at 18.6pt;
                # 150pt stays inside it and uses previously unused bottom space
                # for the server's full-length protocol number (no font shrink).
                if shape.tag==V+'shape':
                    shape.set('style',re.sub(r'height:[\d.]+pt','height:150pt',shape.get('style','')))
                else:
                    for extent in [shape.find(WP+'extent'),shape.find('.//'+A+'xfrm/'+A+'ext')]:extent.set('cy',str(150*12700))
        files['word/document.xml'] = E.tostring(tree,xml_declaration=True,encoding='utf-8')
        target = directory/f'{tid}.v{version}.docx'
        if target.exists() and not args.replace_unpublished: raise ValueError('NEW_TEMPLATE_VERSION_ALREADY_EXISTS:'+target.name)
        deterministic_zip(target, normalize_package(files))
        fields = sorted(set(re.findall(r'\{\{([A-Z0-9_]+)\}\}', ''.join(''.join(E.fromstring(data).itertext()) for name,data in files.items() if name.endswith('.xml')))))
        template = deepcopy(historic)
        template.update(id=tid,version=version,file=target.name,sha256=sha(target),previousTemplateSha256=old_checksum,
                        fields=fields,formRevision='DSJ_RESTORED_2026_09',historicalTemplate=filename,historicalTemplateSha256=source_checksum,
                        verificationStatus='PENDING_CURRENT_RENDER_REVIEW',protocolSemantics='INDIVIDUAL' if tid.endswith('protocol') else None,
                        restoration={'sourceManifest':'manifest-before-biot-2026.json','sourceForm':historic.get('sourceSha256'),
                                     'reason':'Restore retained DSJ design requested by issuer; preserve source mapping and layout repairs.'})
        for stale in ['sample','regulatoryReview','verification']: template.pop(stale,None)
        manifest['templates'][manifest['templates'].index(old)] = template
        if tid.endswith('protocol'):
            previous = next(t for t in manifest['groupTemplates'] if t['id'] == tid)
            group = deepcopy(template); group_file = directory/f'{tid}.group-v2.docx'
            if group_file.exists() and not args.replace_unpublished: raise ValueError('NEW_GROUP_TEMPLATE_VERSION_ALREADY_EXISTS')
            group_file.write_bytes(target.read_bytes())
            group.update(version=f'{version}-group-1',file=group_file.name,protocolSemantics='GROUP',ownerKind='GROUP',groupContractVersion=1,
                         groupRenderer='group_protocol.py:v1',previousTemplateSha256=previous.get('previousTemplateSha256') if previous.get('formRevision')=='DSJ_RESTORED_2026_09' else previous['sha256'])
            manifest['groupTemplates'][manifest['groupTemplates'].index(previous)] = group
        assert sha(source) == source_checksum
        report.append({'id':tid,'previous':old_file,'restored':target.name,'historical':filename,'originalSha256':historic.get('sourceSha256'),
                       'historicalSha256':source_checksum,'sha256':template['sha256'],'geometry':'retained DSJ source; protocol signatures flow in original three columns',
                       'corrections':['independent RU/KZ employer cell','explicit check type','signature names without duplicated positions','blank signature lines'] if tid.endswith('protocol') else ['actual issuer in original logo slot'] if tid=='biot-itr-certificate' else ['retained repaired panel insets and Cyrillic Kazakh labels']})
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    (directory/'dsj-restoration-changes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == '__main__': main()

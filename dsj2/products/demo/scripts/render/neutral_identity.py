"""Identity cleanup for NEUTRAL_FORMS_V1 only. Never applied to old packages."""
from copy import deepcopy
import hashlib
import posixpath
from lxml import etree as E
from legacy_reference import source_literal_values, complex_fields, set_cached_value

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
V = '{urn:schemas-microsoft-com:vml}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
OLD_IMAGE_HASHES = {
    '4c1e7489d3350c451e9d3ea355356a15133097bc443e64549b8b342c181a8c03',
    '02eefee335db15397778441c2f249884f01c3a7f3c00f2ec0d336e52ca9e047a',
    '4a68945b73ad53915df8560bca147848f186476a12f0f165e98a9f17b7e37780',
    '06eb8b79a4d5029ed34e4c71a546b664406de228c57dfcc98a63969338682a1c',
    '2325b248f0883dfce64b7068a6e763edaf0e5d2f4e517b4fac40e87e897cf91d',
}
LOGOS = {h for h in OLD_IMAGE_HASHES if h.startswith(('4c1e','02ee'))}

def slot(replacement):
    identity = '\0'.join(replacement.get(k, '') for k in ['matchText','mode','paragraphContains'])
    return '{{N_' + hashlib.sha256(identity.encode()).hexdigest()[:16] + '}}'

def slot_replacements(payload, tokenize=False):
    result = []
    for r in payload.get('sourceLiteralValues', []) + payload.get('textReplacements', []):
        if tokenize:
            result.append({**r, 'replaceText':slot(r)})
        else:
            result.append({'matchText':slot(r), 'replaceText':r['replaceText']})
    return result

def logo_shape(parent, image):
    """Replace a VML image with native editable neutral text in the same slot."""
    shape = image.getparent()
    while shape is not None and E.QName(shape).localname not in ['shape','rect','drawing']:
        shape = shape.getparent()
    if shape is None:
        raise ValueError('NEUTRAL_LOGO_SLOT_UNSUPPORTED')
    if E.QName(shape).localname == 'drawing':
        # Source protocol logos are DrawingML inline pictures. Keep their
        # paragraph alignment, replace artwork by a small inline text frame.
        run = shape.getparent()
        run.remove(shape)
        prop = run.find(W+'rPr')
        if prop is None: prop=E.SubElement(run,W+'rPr')
        E.SubElement(prop,W+'sz',{W+'val':'16'})
        E.SubElement(prop,W+'color',{W+'val':'666666'})
        E.SubElement(prop,W+'bdr',{W+'val':'single',W+'sz':'4',W+'space':'4',W+'color':'999999'})
        E.SubElement(run,W+'t').text='  ЛОГОТИП  '
        return
    for child in list(shape): shape.remove(child)
    for attr in list(shape.attrib):
        if E.QName(attr).localname not in ['id','style']: del shape.attrib[attr]
    shape.tag=V+'rect'
    shape.set('fillcolor','#ffffff'); shape.set('strokecolor','#999999'); shape.set('strokeweight','0.6pt')
    box=E.SubElement(shape,V+'textbox',{'inset':'2pt,2pt,2pt,2pt'})
    content=E.SubElement(box,W+'txbxContent'); p=E.SubElement(content,W+'p')
    pp=E.SubElement(p,W+'pPr'); E.SubElement(pp,W+'jc',{W+'val':'center'})
    E.SubElement(pp,W+'spacing',{W+'before':'0',W+'after':'0'})
    r=E.SubElement(p,W+'r'); rp=E.SubElement(r,W+'rPr')
    E.SubElement(rp,W+'rFonts',{W+'ascii':'Arial',W+'hAnsi':'Arial',W+'cs':'Arial'})
    E.SubElement(rp,W+'sz',{W+'val':'16'}); E.SubElement(rp,W+'color',{W+'val':'666666'})
    E.SubElement(r,W+'t').text='ЛОГОТИП'

def sanitize_identity(files, payload):
    original=dict(files)
    result=source_literal_values(files, slot_replacements(payload, True))
    # Remove every source image, including unreferenced media, rather than
    # overlaying an old logo or leaving a signature hidden in the ZIP.
    excluded=('word/media/','customXml/','word/embeddings/','docProps/','word/comments','word/people')
    removed={n for n in result if n.startswith(excluded)}
    for n in removed: result.pop(n,None)
    for name,data in list(result.items()):
        if not name.endswith(('.xml','.rels')): continue
        tree=E.fromstring(data)
        if name.endswith('.rels'):
            for rel in list(tree):
                kind=rel.get('Type','')
                if rel.get('TargetMode')=='External' or any('/'+x in kind for x in ['image','oleObject','customXml','comments','people','thumbnail','attachedTemplate','metadata/core-properties','extended-properties','custom-properties']): tree.remove(rel)
        elif name=='[Content_Types].xml':
            for node in list(tree):
                if node.get('PartName','').lstrip('/') in removed: tree.remove(node)
        elif name.startswith('docProps/'):
            for node in tree.iter():
                if len(node)==0: node.text=''
        elif name.startswith('word/'):
            relname=posixpath.join(posixpath.dirname(name),'_rels',posixpath.basename(name)+'.rels')
            rels={}
            if relname in original:
                for rel in E.fromstring(original[relname]):
                    target=posixpath.normpath(posixpath.join(posixpath.dirname(name),rel.get('Target','')))
                    if target in original: rels[rel.get('Id')]=hashlib.sha256(original[target]).hexdigest()
            for image in list(tree.iter()):
                if E.QName(image).localname not in ['imagedata','blip']: continue
                rid=image.get(R+'id') or image.get(R+'embed')
                if rels.get(rid) in LOGOS:
                    logo_shape(tree,image)
                else:
                    target=image
                    while target.getparent() is not None and E.QName(target).localname not in ['shape','rect','drawing']:
                        target=target.getparent()
                    if target.getparent() is not None: target.getparent().remove(target)
            for paragraph in tree.iter(W+'p'):
                for field in complex_fields(paragraph):
                    if field['instruction'].upper().startswith('MERGEFIELD'):
                        set_cached_value(field,'')
            for node in list(tree.iter()):
                if not isinstance(node.tag,str): continue
                local=E.QName(node).localname
                if local in ['binData','OLEObject','mailMerge','docVars','commentRangeStart','commentRangeEnd','commentReference','object']:
                    if node.getparent() is not None: node.getparent().remove(node)
                    continue
                for attr in list(node.attrib):
                    if E.QName(attr).localname in ['gfxdata','descr','title','alt','author','lastModifiedBy']:
                        del node.attrib[attr]
        result[name]=E.tostring(tree,encoding='utf-8',xml_declaration=True)
    return result

"""Portable OOXML package declarations and schema-ordered property containers."""
from lxml import etree as E

W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
MC='{http://schemas.openxmlformats.org/markup-compatibility/2006}'
ORDER={
    'pPr':'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange',
    'rPr':'rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange',
    'trPr':'cnfStyle divId gridBefore gridAfter wBefore wAfter cantSplit trHeight tblHeader tblCellSpacing jc hidden ins del trPrChange',
    'sectPr':'headerReference footerReference footnotePr endnotePr type pgSz pgMar paperSrc pgBorders lnNumType pgNumType cols formProt vAlign noEndnote titlePg textDirection bidi rtlGutter docGrid printerSettings sectPrChange',
}


def normalize_package(files):
    """Keep content/geometry; discard stale metadata and invalid compatibility hints.

    Sanitized source metadata must be absent, not empty typed values. XML encoding
    uses the IANA name accepted by Word/System.Xml. Ignorable can mention only
    namespaces still declared after the legacy merge-field transformation.
    """
    for name,data in list(files.items()):
        if not name.endswith(('.xml','.rels')):continue
        root=E.fromstring(data)
        # Sanitization removed source signatures/seals, including a:blip. Keeping
        # the now empty picture container makes Word reject ITR and PS witness.
        for picture in list(root.iter('{http://schemas.openxmlformats.org/drawingml/2006/picture}pic')):
            if any(E.QName(n).localname=='blip' for n in picture.iter()):continue
            drawing=next((n for n in picture.iterancestors() if n.tag==W+'drawing'),None)
            if drawing is None:continue
            alternate=next((n for n in drawing.iterancestors() if n.tag==MC+'AlternateContent'),None)
            target=alternate if alternate is not None and not any((n.text or '').strip() for n in alternate.iter(W+'t')) else drawing
            if target.getparent() is not None:target.getparent().remove(target)
        if name.startswith('docProps/'):
            for child in list(root):root.remove(child)
        if name=='[Content_Types].xml':
            for child in list(root):
                part=child.get('PartName')
                if part and part.lstrip('/') not in files:root.remove(child)
        for node in root.iter():
            value=node.get(MC+'Ignorable')
            if value:
                valid=' '.join(prefix for prefix in value.split() if prefix in node.nsmap)
                if valid:node.set(MC+'Ignorable',valid)
                else:del node.attrib[MC+'Ignorable']
            if node.tag==MC+'Choice' and any(prefix not in node.nsmap for prefix in node.get('Requires','').split()):
                raise ValueError('OOXML_UNDECLARED_REQUIRED_NAMESPACE')
            if node.tag.startswith(W) and E.QName(node).localname in ORDER:
                order={W+key:i for i,key in enumerate(ORDER[E.QName(node).localname].split())}
                children=list(node)
                for child in children:node.remove(child)
                for child in sorted(children,key=lambda child:order.get(child.tag,len(order))):node.append(child)
        files[name]=E.tostring(root,xml_declaration=True,encoding='utf-8')
    return files

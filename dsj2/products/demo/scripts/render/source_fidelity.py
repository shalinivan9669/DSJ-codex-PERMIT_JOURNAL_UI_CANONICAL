"""Opt-in layout for immutable SOURCE_FIDELITY_V2 template packages.

Keep source anchors, mixed runs, underlines and paragraph styles. Replace only
sample padding in populated slots, then fit their variable runs within the
existing panel. Earlier package versions never enter this module.
"""
from functools import lru_cache
from copy import deepcopy
from pathlib import Path
import re

from lxml import etree as E
from PIL import ImageFont

ROOT = Path(__file__).resolve().parents[2]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w':W[1:-1]}
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'
V = '{urn:schemas-microsoft-com:vml}'


def child(parent, tag):
    node = parent.find(W+tag)
    if node is None:
        node = E.Element(W+tag)
        parent.insert(0,node)
    return node


def add_floating_mark(files,text):
    """Page overlay anchored in a footer, without reserving a new header band.

    Header distance in the source cards can exceed their zero top margin. A new
    header then moves the body even when its drawing is absolute. New footers
    use zero distance and inherit from the first section: repeating references
    on continuous sections makes Writer apply the final section's top margin.
    The lower strip avoids renewal panels and issuer bands at the top edge.
    """
    document=E.fromstring(files['word/document.xml'])
    rels=E.fromstring(files['word/_rels/document.xml.rels'])
    page=next(document.iter(W+'pgSz'));width=int(page.get(W+'w'))/20;height=int(page.get(W+'h'))/20
    run=E.Element(W+'r');child(child(run,'rPr'),'sz').set(W+'val','1')
    pict=E.SubElement(run,W+'pict')
    shape=E.SubElement(pict,V+'rect',id='DemoSampleMarkV2',stroked='f',filled='f',
                       style=f'position:absolute;margin-left:36pt;margin-top:{height-18}pt;width:{width-72}pt;height:10pt;z-index:251659264;mso-position-horizontal-relative:page;mso-position-vertical-relative:page')
    box=E.SubElement(E.SubElement(shape,V+'textbox',inset='0,0,0,0'),W+'txbxContent')
    paragraph=E.SubElement(box,W+'p');props=E.SubElement(paragraph,W+'pPr')
    E.SubElement(props,W+'jc',{W+'val':'center'});E.SubElement(props,W+'spacing',{W+'before':'0',W+'after':'0',W+'line':'160',W+'lineRule':'exact'})
    mark=E.SubElement(paragraph,W+'r');style=E.SubElement(mark,W+'rPr')
    E.SubElement(style,W+'sz',{W+'val':'14'});E.SubElement(style,W+'color',{W+'val':'9C2020'})
    E.SubElement(mark,W+'t').text=text
    references={n.get(R+'id') for n in document.iter(W+'footerReference')}
    parts=[(rel.get('Target').lstrip('/') if rel.get('Target').startswith('/') else 'word/'+rel.get('Target'))
           for rel in rels if rel.get('Id') in references]
    if not parts:
        part='word/demo-footer.xml';footer=E.Element(W+'ftr',nsmap={'w':W[1:-1],'v':V[1:-1]})
        anchor=E.SubElement(footer,W+'p');props=E.SubElement(anchor,W+'pPr')
        E.SubElement(props,W+'spacing',{W+'before':'0',W+'after':'0',W+'line':'1',W+'lineRule':'exact'})
        paragraph_mark=E.SubElement(props,W+'rPr')
        for tag in ['sz','szCs']:E.SubElement(paragraph_mark,W+tag,{W+'val':'1'})
        files[part]=E.tostring(footer,xml_declaration=True,encoding='utf8');parts=[part]
        E.SubElement(rels,PKG+'Relationship',Id='rIdDemoFooterV2',Type=R[1:-1]+'/footer',Target='demo-footer.xml')
        sections=list(document.iter(W+'sectPr'))
        for kind in ['default','first','even']:
            sections[0].insert(0,E.Element(W+'footerReference',{W+'type':kind,R+'id':'rIdDemoFooterV2'}))
        for section in sections:
            margins=section.find(W+'pgMar')
            if margins is not None:margins.set(W+'footer','0')
        ct=E.fromstring(files['[Content_Types].xml'])
        E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/word/demo-footer.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml')
        files['[Content_Types].xml']=E.tostring(ct,xml_declaration=True,encoding='utf8')
    for part in set(parts):
        if part not in files:continue
        footer=E.fromstring(files[part]);anchor=next(footer.iter(W+'p'),None)
        if anchor is None:anchor=E.SubElement(footer,W+'p')
        anchor.append(deepcopy(run));files[part]=E.tostring(footer,xml_declaration=True,encoding='utf8')
    files['word/document.xml']=E.tostring(document,xml_declaration=True,encoding='utf8')
    files['word/_rels/document.xml.rels']=E.tostring(rels,xml_declaration=True,encoding='utf8')


class Typography:
    def __init__(self, styles):
        self.root = E.fromstring(styles)
        self.styles = {n.get(W+'styleId'):n for n in self.root.findall(W+'style')}

    def property(self, paragraph, run, tag):
        # pPr/rPr formats the paragraph MARK, not its text runs. Word/LO resolve
        # unstyled text through character/paragraph styles and docDefaults.
        candidates = [run.find(W+'rPr')]
        run_style=run.find(W+'rPr/'+W+'rStyle')
        if run_style is not None:
            character=self.styles.get(run_style.get(W+'val'))
            if character is not None:candidates.append(character.find(W+'rPr'))
        style = paragraph.find(W+'pPr/'+W+'pStyle')
        key = style.get(W+'val') if style is not None else 'Normal'
        seen = set()
        while key in self.styles and key not in seen:
            seen.add(key); current = self.styles[key]
            candidates.append(current.find(W+'rPr'))
            base = current.find(W+'basedOn');key = base.get(W+'val') if base is not None else None
        candidates.append(self.root.find(W+'docDefaults/'+W+'rPrDefault/'+W+'rPr'))
        for props in candidates:
            node = props.find(W+tag) if props is not None else None
            if node is not None:return node
        return None

    def size(self, paragraph, run):
        node = self.property(paragraph,run,'sz')
        return float(node.get(W+'val'))/2 if node is not None else 11

    def mark_size(self, paragraph):
        node=paragraph.find(W+'pPr/'+W+'rPr/'+W+'sz')
        return float(node.get(W+'val'))/2 if node is not None else self.size(paragraph,E.Element(W+'r'))

    def font(self, paragraph, run, size=None):
        node = self.property(paragraph,run,'rFonts')
        name = node.get(W+'ascii','') if node is not None else ''
        family = 'LiberationSerif' if any(s in name for s in ['Serif','Times','Cambria']) else 'LiberationMono' if any(s in name for s in ['Mono','Courier']) else 'LiberationSans'
        enabled=lambda n:n is not None and n.get(W+'val','1') not in ['0','false','off']
        bold=enabled(self.property(paragraph,run,'b'));italic=enabled(self.property(paragraph,run,'i'))
        suffix='BoldItalic' if bold and italic else 'Bold' if bold else 'Italic' if italic else 'Regular'
        return cached_font(family+'-'+suffix+'.ttf',round((size or self.size(paragraph,run))*10))


@lru_cache(maxsize=256)
def cached_font(name,size):
    return ImageFont.truetype(str(ROOT/'assets/fonts'/name),size)


def dimensions(box):
    shape=next((n for n in box.iterancestors() if E.QName(n).localname in ['shape','rect','anchor']),None)
    if shape is None:return 260,160
    if E.QName(shape).localname=='anchor':
        extent=next((n for n in shape if E.QName(n).localname=='extent'),None)
        if extent is not None:return int(extent.get('cx'))/12700,int(extent.get('cy'))/12700
    style=shape.get('style','')
    values=[re.search(r'(?:^|;)'+key+r':([\d.]+)pt',style) for key in ['width','height']]
    return tuple(float(m[1]) if m else fallback for m,fallback in zip(values,[260,160]))


def prepare_layout(tree, template_id, has_photo, styles):
    if template_id not in ['biot-worker-card','ptm-card','pb-card','ps-card','biot-itr-certificate']:return []
    typography=Typography(styles); states=[]
    for box in tree.iter(W+'txbxContent'):
        text=''.join(box.itertext())
        if template_id=='ps-card' and '{{FULL_NAME' not in text:
            for node in box.iter(W+'t'):
                node.text=re.sub(r'\{\{(?:CHAIR|MEMBER_1|MEMBER_2)_NAME\}\}','',node.text or '')
            text=''.join(box.itertext())
        if not any(token in text for token in ['{{FULL_NAME','{{NUMBER}}','{{PROTOCOL_NUMBER}}','{{SUBJECT}}']):continue
        certificate=template_id=='biot-itr-certificate'
        if certificate and '{{FULL_NAME_RU}}' not in text:continue
        width,height=dimensions(box);paragraphs=[]
        front='{{FULL_NAME' in text
        for paragraph in box.findall(W+'p'):
            nodes=paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces=NS)
            label=''.join(n.text or '' for n in nodes)
            dynamic=[];offset=0
            matches=[m.span() for m in re.finditer(r'\{\{[A-Z0-9_]+\}\}',label)]
            for node in nodes:
                end=offset+len(node.text or '')
                if any(offset<b and end>a for a,b in matches):
                    run=node.getparent()
                    if run not in dynamic:dynamic.append(run)
                offset=end
            if certificate and not dynamic:continue
            if dynamic and not certificate:
                # Cached underlined space strings sized for one sample are not
                # real field capacity. Keep the styled runs, not that padding.
                for node in nodes:node.text=re.sub(r'[\s\u00a0]{2,}',' ',node.text or '')
                for tab in list(paragraph.iter(W+'tab')):
                    if tab.getparent().tag!=W+'r':continue
                    tab.tag=W+'t';tab.text=' ';tab.attrib.clear()
                nodes=paragraph.xpath('./w:r/w:t | ./w:hyperlink/w:r/w:t',namespaces=NS)
                # Empty cached result runs sometimes carry a 24pt font solely
                # for a long underline. Transfer their separator to the adjacent
                # text so that invisible padding cannot enlarge the live line.
                previous=None
                for node in nodes:
                    if (node.text or '').isspace():
                        if previous is not None and not (previous.text or '').endswith(' '):previous.text=(previous.text or '')+' '
                        node.text=''
                    elif node.text:previous=node
                if nodes:nodes[0].text=(nodes[0].text or '').lstrip()
                for node in nodes:node.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
            props=child(paragraph,'pPr')
            if not certificate:
                indent=child(props,'ind')
                title='{{NUMBER}}' in label and any(s in label.upper() for s in ['УДОСТОВЕРЕНИЕ','КУӘ','КУƏ'])
                minimum=24 if front and template_id=='biot-worker-card' else 18 if front and template_id=='ptm-card' else 8 if front and template_id=='pb-card' else 0
                if front and template_id in ['pb-card','ps-card'] and not title:minimum=100 if template_id=='pb-card' else 88
                indent.set(W+'left',str(max(round(minimum*20),int(indent.get(W+'left','0')))))
                indent.set(W+'right',str(max(8*20,int(indent.get(W+'right','0')))))
                if title:
                    child(props,'jc').set(W+'val','center')
                    indent.set(W+'left',str(round(minimum*20)));indent.set(W+'right','160')
                    for key in ['firstLine','hanging']:indent.set(W+key,'0')
                if front and template_id=='ptm-card' and dynamic and not any(t in label for t in ['{{NUMBER}}','{{ISSUER']):
                    indent.set(W+'right',str(max(76*20,int(indent.get(W+'right','0')))))
                if template_id=='ps-card' and front and title and not any(p.get('title') for p in paragraphs):
                    # The source issuer strip occupies the upper edge of the
                    # panel. Keep the first title below that strip as well as
                    # inside its original frame; reserve only this heading gap.
                    spacing=child(props,'spacing');spacing.set(W+'before',str(max(440,int(spacing.get(W+'before','0')))))
            paragraphs.append({'node':paragraph,'dynamic':dynamic,'title':not certificate and title,'sizes':{run:typography.size(paragraph,run) for run in dynamic}})
        states.append({'box':box,'width':width,'height':height,'paragraphs':paragraphs,'typography':typography,'certificate':certificate,'compactStaticPadding':template_id=='ps-card' and front})
    return states


def measure(paragraph,width,typography):
    indent=paragraph.find(W+'pPr/'+W+'ind')
    left=float(indent.get(W+'left','0'))/20 if indent is not None else 0
    right=float(indent.get(W+'right','0'))/20 if indent is not None else 0
    first=(float(indent.get(W+'firstLine','0'))-float(indent.get(W+'hanging','0')))/20 if indent is not None else 0
    available=max(10,width-10-left-right)
    blank=not ''.join(n.text or '' for n in paragraph.iter(W+'t')).strip()
    mark_size=typography.mark_size(paragraph) if blank else 1
    used=max(0,first);lines=1;line_height=mark_size*1.12;max_height=line_height;overflow=False
    for run in paragraph.xpath('./w:r | ./w:hyperlink/w:r',namespaces=NS):
        value=''.join(n.text or '' for n in run.iter(W+'t'))
        if not value.strip():continue
        font=typography.font(paragraph,run);size=typography.size(paragraph,run)
        max_height=max(max_height,size*1.12);line_height=max(line_height,size*1.12)
        for word in re.findall(r'\S+|\s+',value):
            length=font.getlength(word)/10
            if length>available and not word.isspace():overflow=True
            if used+length>available and used>0 and not word.isspace():lines+=1;used=0
            used+=length
    spacing=paragraph.find(W+'pPr/'+W+'spacing')
    before=float(spacing.get(W+'before','0'))/20 if spacing is not None else 0
    after=float(spacing.get(W+'after','0'))/20 if spacing is not None else 0
    if spacing is not None and spacing.get(W+'line'):
        source=float(spacing.get(W+'line'))
        line_height=max(line_height,source/20 if spacing.get(W+'lineRule') in ['exact','atLeast'] else max_height*source/240)
    return lines*line_height+before+after,overflow,lines


def fit_layout(states):
    for state in states:
        typography=state['typography'];paragraphs=state['paragraphs']
        available_height=60 if state['certificate'] else state['height']-4
        if sum(measure(p['node'],530 if state['certificate'] else state['width'],typography)[0] for p in paragraphs)>available_height:
            # Blank sample spacer paragraphs are the first elastic element.
            # Keep every labelled line and never resize/move the surrounding box.
            retained=[]
            for p in paragraphs:
                node=p['node']
                if not ''.join(node.itertext()).strip() and not any(E.QName(n).localname in ['drawing','pict','br'] for n in node.iter()):
                    node.getparent().remove(node)
                else:retained.append(p)
            paragraphs=retained
        # All source styles are retained until the content actually exceeds the
        # panel. Only variable runs are reduced; legal values are never cut.
        for decrement in [n/2 for n in range(51)]:
            if decrement:
                for p in paragraphs:
                    for run,size in p['sizes'].items():
                        fitted=max(min(size,8),size-decrement)
                        for tag in ['sz','szCs']:child(child(run,'rPr'),tag).set(W+'val',str(round(fitted*2)))
            measurements=[measure(p['node'],530 if state['certificate'] else state['width'],typography) for p in paragraphs]
            height=sum(m[0] for m in measurements)
            if height<=available_height and not any(m[1] for m in measurements):break
        else:
            # A source sample can spend several points above every populated
            # line. Release that elastic padding after exhausting readable run
            # fitting, retaining the first heading's frame clearance.
            heading_seen=False
            for p in paragraphs:
                protected=p.get('title') and not heading_seen
                heading_seen=heading_seen or p.get('title',False)
                if protected or (not p['dynamic'] and not state.get('compactStaticPadding')):continue
                spacing=p['node'].find(W+'pPr/'+W+'spacing')
                if spacing is not None:
                    spacing.set(W+'before','0');spacing.set(W+'after','0')
            measurements=[measure(p['node'],530 if state['certificate'] else state['width'],typography) for p in paragraphs]
            if sum(m[0] for m in measurements)>available_height or any(m[1] for m in measurements):raise ValueError('PRINT_LAYOUT_OVERFLOW')
        # Exact source line heights below the populated font cause overprinting.
        # Raise only those populated paragraphs to the fitted font's line height.
        for p in paragraphs:
            if not p['dynamic']:continue
            spacing=p['node'].find(W+'pPr/'+W+'spacing')
            if spacing is not None and spacing.get(W+'lineRule','auto')=='auto' and int(spacing.get(W+'line','240'))<240:
                spacing.set(W+'line','240')

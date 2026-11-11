"""Delivery copies with visible signature evidence; never rewrite signed originals.

The detached CMS refers to sourcePdfSha256, NOT to this decorated DOCX/PDF.
Only the caller supplies accepted evidence. This module does no verification and
must not infer signatures from names already printed in an original template.
"""
from io import BytesIO
import hashlib
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from zipfile import ZipFile

from lxml import etree as E
import qrcode

from sanitize_templates import deterministic_zip
from source_fidelity import Typography, W, dimensions, measure

R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
PIC = '{http://schemas.openxmlformats.org/drawingml/2006/picture}'
MARKER = 'demo/signature-copy.json'
ROLE_LABELS = {'DIRECTOR': 'Директор', 'CHAIR': 'Председатель комиссии',
               'TEACHER': 'Преподаватель', 'MEMBER': 'Член комиссии'}
CARD_IDS = {'biot-worker-card', 'ptm-card', 'pb-card', 'ps-card'}
SIGNATURE_LABEL = re.compile(r'комисси|комиссия|төрағ|торағ|руководител|басшысы', re.I)
POPULATED_NUMBER = re.compile(r'(?:[A-ZА-ЯЁ]+[-–])\d{3,}|\d{1,2}\.\d{1,2}\.\d{4}', re.I)


def text(node):
    return ''.join(n.text or '' for n in node.iter(W + 't'))


def _value(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError('SIGNATURE_COPY_INPUT_INVALID')
    if re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', value):
        raise ValueError('SIGNATURE_COPY_INPUT_INVALID')
    return ' '.join(value.split())


def _payload(payload):
    result = dict(payload)
    if result.get('format') not in ('PDF', 'DOCX') or not isinstance(result.get('localTest'), bool):
        raise ValueError('SIGNATURE_COPY_INPUT_INVALID')
    for field, limit in [('templateId', 100), ('documentNumber', 160),
                         ('sourcePdfArtifactId', 100), ('sourcePdfSha256', 64)]:
        result[field] = _value(result.get(field), limit)
    if not re.fullmatch(r'[a-f0-9]{64}', result['sourcePdfSha256']):
        raise ValueError('SIGNATURE_COPY_SOURCE_HASH_INVALID')
    signers = result.get('signers')
    if not isinstance(signers, list) or len(signers) > 30:
        raise ValueError('SIGNATURE_COPY_INPUT_INVALID')
    result['signers'] = [{field: _value(s.get(field), limit) for field, limit in
                          [('role', 100), ('displayName', 300), ('receivedAt', 100), ('identityNote', 1000)]}
                         for s in signers if isinstance(s, dict)]
    if len(result['signers']) != len(signers):
        raise ValueError('SIGNATURE_COPY_INPUT_INVALID')
    pending = result.get('pendingRoles', [])
    if not isinstance(pending, list) or len(pending) > 30:
        raise ValueError('SIGNATURE_COPY_INPUT_INVALID')
    result['pendingRoles'] = [_value(role, 100) for role in pending]
    if signers:
        url = _value(result.get('verificationUrl'), 2048)
        parsed = urlsplit(url)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or not re.fullmatch(r'/signature-evidence/[a-zA-Z0-9-]{1,100}', parsed.path)):
            raise ValueError('SIGNATURE_COPY_URL_INVALID')
        result['verificationUrl'] = url
    return result


def initials(name):
    """Display the certificate surname unchanged; do not alter source document names."""
    if name == 'Имя владельца сертификата не определено':
        return 'имя владельца не определено'
    words = name.split()
    return words[0] + ((' ' + ' '.join(word[0] + '.' for word in words[1:])) if len(words) > 1 else '')


def paragraph(value, size=10, bold=False, color='183B4E', after=4, keep=False):
    p = E.Element(W + 'p')
    props = E.SubElement(p, W + 'pPr')
    E.SubElement(props, W + 'keepNext', {W + 'val': '1' if keep else '0'})
    E.SubElement(props, W + 'keepLines')
    E.SubElement(props, W + 'spacing', {W + 'before': '0', W + 'after': str(round(after * 20)),
                                      W + 'line': str(round(size * 1.18 * 20)), W + 'lineRule': 'atLeast'})
    E.SubElement(props, W + 'ind', {W + 'left': '0', W + 'right': '0', W + 'firstLine': '0'})
    E.SubElement(props, W + 'jc', {W + 'val': 'left'})
    run = E.SubElement(p, W + 'r'); style = E.SubElement(run, W + 'rPr')
    E.SubElement(style, W + 'rFonts', {W + key: 'Liberation Sans' for key in ['ascii', 'hAnsi', 'eastAsia', 'cs']})
    if bold:
        E.SubElement(style, W + 'b')
    E.SubElement(style, W + 'color', {W + 'val': color})
    for tag in ['sz', 'szCs']:
        E.SubElement(style, W + tag, {W + 'val': str(round(size * 2))})
    E.SubElement(run, W + 't').text = value
    return p


def _compact_lines(payload):
    names = list(dict.fromkeys(initials(s['displayName']) for s in payload['signers']))
    prefix = 'ТЕСТ ЭЦП. ' if payload['localTest'] else ''
    if payload['pendingRoles']:
        prefix += 'Частично. '
    return [prefix + 'Подписано ЭЦП: ' + '; '.join(names)]


def _compact_box(box, lines, typography):
    """Keep all original nonblank text and run sizes; reclaim only spacer padding."""
    width, height = dimensions(box)
    for p in list(box.findall(W + 'p')):
        if not text(p).strip() and not any(E.QName(n).localname in ['drawing', 'pict', 'br', 'fldChar'] for n in p.iter()):
            box.remove(p)
    original = list(box.findall(W + 'p'))
    marks = [paragraph(line, 7, bold=index == 0, after=0) for index, line in enumerate(lines)]
    total = lambda: sum(measure(p, width, typography)[0] for p in original + marks)
    if total() > height - 6:
        for p in original:
            props = p.find(W + 'pPr')
            if props is None:
                continue
            spacing = props.find(W + 'spacing')
            if spacing is not None:
                spacing.set(W + 'before', '0'); spacing.set(W + 'after', '0')
    # Never silently clip a signer or squeeze the original typeface. The caller
    # should surface this explicit layout failure instead of delivering a false mark.
    if total() > height - 4 or any(measure(p, width, typography)[1] for p in marks):
        raise ValueError('SIGNATURE_COPY_MARK_DOES_NOT_FIT')
    box.extend(marks)


def _add_compact_marks(document, payload, typography):
    template = payload['templateId']
    boxes = list(document.iter(W + 'txbxContent'))
    selected = []
    for box in boxes:
        label = text(box)
        if template in CARD_IDS:
            candidate = bool(SIGNATURE_LABEL.search(label) and POPULATED_NUMBER.search(label))
        elif template == 'biot-itr-certificate':
            candidate = bool(SIGNATURE_LABEL.search(label))
        else:
            candidate = False
        if candidate:
            selected.append(box)
    lines = _compact_lines(payload)
    for box in selected:
        _compact_box(box, lines, typography)
    if not selected:
        if template in CARD_IDS or template == 'biot-itr-certificate':
            raise ValueError('SIGNATURE_COPY_ACTIVE_PANEL_NOT_FOUND')
        body = document.find(W + 'body')
        end = body.find(W + 'sectPr')
        index = body.index(end) if end is not None else len(body)
        for line in lines:
            body.insert(index, paragraph(line, 8, after=2)); index += 1
    return len(selected)


def _relationship(files, target, kind):
    rels = E.fromstring(files['word/_rels/document.xml.rels'])
    used = {node.get('Id') for node in rels}; index = 1
    while 'rIdSignatureCopy' + str(index) in used:
        index += 1
    identifier = 'rIdSignatureCopy' + str(index)
    E.SubElement(rels, PKG + 'Relationship', Id=identifier, Type=R[1:-1] + '/' + kind, Target=target)
    files['word/_rels/document.xml.rels'] = E.tostring(rels, xml_declaration=True, encoding='utf-8')
    return identifier


def _content_type(files, part, content_type):
    root = E.fromstring(files['[Content_Types].xml'])
    E.SubElement(root, CT + 'Override', PartName='/' + part, ContentType=content_type)
    files['[Content_Types].xml'] = E.tostring(root, xml_declaration=True, encoding='utf-8')


def _qr(files, url, document):
    code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=4)
    code.add_data(url); code.make(fit=True)
    buffer = BytesIO(); code.make_image(fill_color='black', back_color='white').save(buffer, format='PNG')
    part = 'word/media/signature-copy-qr.png'
    files[part] = buffer.getvalue(); _content_type(files, part, 'image/png')
    identifier = _relationship(files, 'media/signature-copy-qr.png', 'image')
    p = paragraph('', after=4)
    drawing = E.SubElement(p.find(W + 'r'), W + 'drawing')
    inline = E.SubElement(drawing, WP + 'inline', distT='0', distB='0', distL='0', distR='0')
    side = str(round(110 * 12700))
    E.SubElement(inline, WP + 'extent', cx=side, cy=side)
    ids = [int(n.get('id', '0')) for n in document.iter(WP + 'docPr') if n.get('id', '0').isdigit()]
    E.SubElement(inline, WP + 'docPr', id=str(max(ids, default=0) + 1), name='Сведения о подписях', descr=url)
    graphic = E.SubElement(inline, A + 'graphic'); data = E.SubElement(graphic, A + 'graphicData', uri=PIC[1:-1])
    pic = E.SubElement(data, PIC + 'pic'); nv = E.SubElement(pic, PIC + 'nvPicPr')
    E.SubElement(nv, PIC + 'cNvPr', id='0', name='signature-copy-qr.png'); E.SubElement(nv, PIC + 'cNvPicPr')
    fill = E.SubElement(pic, PIC + 'blipFill'); E.SubElement(fill, A + 'blip', {R + 'embed': identifier})
    E.SubElement(E.SubElement(fill, A + 'stretch'), A + 'fillRect')
    shape = E.SubElement(pic, PIC + 'spPr'); transform = E.SubElement(shape, A + 'xfrm')
    E.SubElement(transform, A + 'off', x='0', y='0'); E.SubElement(transform, A + 'ext', cx=side, cy=side)
    E.SubElement(E.SubElement(shape, A + 'prstGeom', prst='rect'), A + 'avLst')
    return p


def _evidence_sheet(files, document, payload):
    body = document.find(W + 'body'); previous = body.find(W + 'sectPr')
    if previous is not None:
        body.remove(previous)
    else:
        previous = E.Element(W + 'sectPr')
    # sectPr/type controls where THIS section starts. Keep the source's final
    # continuous section continuous; changing it to nextPage creates a blank
    # source page (PS card) or pushes its last signature line onto one (witness).
    # The new evidence section below supplies its own nextPage transition.
    boundary = E.SubElement(body, W + 'p'); props = E.SubElement(boundary, W + 'pPr')
    E.SubElement(props, W + 'spacing', {W + 'before': '0', W + 'after': '0', W + 'line': '1', W + 'lineRule': 'exact'})
    props.append(previous)
    heading = 'ТЕСТ ЭЦП — проверка НУЦ не выполнялась' if payload['localTest'] else 'Копия с отметками ЭЦП'
    body.append(paragraph(heading, 16, bold=True, color='9C2020' if payload['localTest'] else '183B4E', after=10, keep=True))
    body.append(paragraph('Лист сведений об электронных подписях', 12, bold=True, after=8, keep=True))
    body.append(paragraph('Документ: ' + payload['documentNumber'], 10, after=8))
    if payload['localTest']:
        body.append(paragraph('Тестовый режим. Действительность сертификата, цепочка доверия и статус отзыва в НУЦ не проверены. Отметки не подтверждают юридическую действительность подписи.', 10, color='9C2020', after=8))
    for signer in payload['signers']:
        role = ROLE_LABELS.get(signer['role'], signer['role'])
        body.append(paragraph(role + ': ' + signer['displayName'], 11, bold=True, after=3, keep=True))
        body.append(paragraph('Подпись получена сервером: ' + signer['receivedAt'], 9, after=3, keep=True))
        body.append(paragraph(signer['identityNote'], 9, after=8))
    if payload['pendingRoles']:
        body.append(paragraph('ПОДПИСАНО ЧАСТИЧНО. Ожидаются: ' + ', '.join(ROLE_LABELS.get(r, r) for r in payload['pendingRoles']) + '.', 10, bold=True, color='9C2020', after=8))
    body.append(paragraph('Это производная печатная копия. Отделённые подписи CMS относятся к исходному PDF, а не к файлу с этими отметками. Исходный документ и подписи сохраняются отдельно.', 9, after=8))
    body.append(paragraph('SHA-256 исходного PDF:', 9, bold=True, after=2, keep=True))
    # Two exact halves stay legible and cannot overflow a narrow inherited style.
    digest = payload['sourcePdfSha256']
    body.append(paragraph(digest[:32] + ' ' + digest[32:], 9, after=4))
    body.append(paragraph('Исходный файл: ' + payload['sourcePdfArtifactId'], 8, after=8))
    body.append(_qr(files, payload['verificationUrl'], document))
    caption = ('QR открывает сведения в приложении после входа. Это не публичная проверка НУЦ.'
               if payload['localTest'] else 'QR открывает сохранённые сведения о подписях в приложении после входа.')
    body.append(paragraph(caption, 9, after=4))
    body.append(paragraph(payload['verificationUrl'], 8, after=0))
    section = E.SubElement(body, W + 'sectPr')
    # A separate A4 section prevents the card's landscape dimensions, zero
    # margins, sample footer or stationery from leaking into this evidence sheet.
    for tag in ['header', 'footer']:
        part = 'word/signature-copy-' + tag + '.xml'
        root = E.Element(W + ('hdr' if tag == 'header' else 'ftr'), nsmap={'w': W[1:-1]})
        E.SubElement(root, W + 'p'); files[part] = E.tostring(root, xml_declaration=True, encoding='utf-8')
        _content_type(files, part, 'application/vnd.openxmlformats-officedocument.wordprocessingml.' + tag + '+xml')
        identifier = _relationship(files, Path(part).name, tag)
        for kind in ['default', 'first', 'even']:
            E.SubElement(section, W + tag + 'Reference', {W + 'type': kind, R + 'id': identifier})
    E.SubElement(section, W + 'type', {W + 'val': 'nextPage'})
    E.SubElement(section, W + 'pgSz', {W + 'w': '11906', W + 'h': '16838'})
    E.SubElement(section, W + 'pgMar', {W + 'top': '850', W + 'right': '850', W + 'bottom': '850', W + 'left': '850', W + 'header': '0', W + 'footer': '0', W + 'gutter': '0'})


def signature_copy(payload, out, convert_pdf):
    payload = _payload(payload)
    source = Path(payload['inputPath']); original = source.read_bytes()
    if source.resolve() == Path(out).resolve():
        raise ValueError('SIGNATURE_COPY_OUTPUT_MUST_DIFFER')
    if not payload['signers']:
        if payload['format'] == 'DOCX':
            Path(out).write_bytes(original)
        else:
            convert_pdf(str(source), out)
        return {'signatureCopy': False, 'signerCount': 0}
    with ZipFile(BytesIO(original)) as archive:
        if len(archive.infolist()) > 2000 or sum(n.file_size for n in archive.infolist()) > 100 * 1024 * 1024:
            raise ValueError('SIGNATURE_COPY_PACKAGE_LIMIT')
        files = {name: archive.read(name) for name in archive.namelist()}
    if MARKER in files:
        raise ValueError('SIGNATURE_COPY_REQUIRES_ORIGINAL')
    parser = E.XMLParser(resolve_entities=False, no_network=True)
    document = E.fromstring(files['word/document.xml'], parser)
    count = _add_compact_marks(document, payload, Typography(files['word/styles.xml']))
    _evidence_sheet(files, document, payload)
    files['word/document.xml'] = E.tostring(document, xml_declaration=True, encoding='utf-8')
    evidence = {key: payload[key] for key in ['templateId', 'documentNumber', 'sourcePdfArtifactId',
                'sourcePdfSha256', 'localTest', 'signers', 'pendingRoles', 'verificationUrl']}
    evidence.update(version=1, originalDocxSha256=hashlib.sha256(original).hexdigest(), detachedSignatureTarget='ORIGINAL_PDF')
    files[MARKER] = json.dumps(evidence, ensure_ascii=False, sort_keys=True).encode('utf8')
    with TemporaryDirectory(prefix='signature-copy-') as work:
        decorated = Path(work) / 'signature-copy.docx'
        deterministic_zip(decorated, files)
        if payload['format'] == 'DOCX':
            Path(out).write_bytes(decorated.read_bytes())
        else:
            convert_pdf(str(decorated), out)
    return {'signatureCopy': True, 'signerCount': len(payload['signers']), 'markedPanels': count,
            'sourcePdfSha256': payload['sourcePdfSha256'], 'evidenceSheet': True}

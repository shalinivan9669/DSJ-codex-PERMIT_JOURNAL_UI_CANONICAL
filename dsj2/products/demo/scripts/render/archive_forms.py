"""Opt-in filling of user archive forms; never changes historical layout policies."""
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from posixpath import normpath, dirname, relpath
from zipfile import ZipFile
import hashlib
import json
import os
import re

from lxml import etree as E
from PIL import Image, ImageOps, ImageFont, ImageDraw
from request_limits import MAX_REQUEST_ROWS
from sanitize_templates import deterministic_zip
from template_validation import inspect_package

POLICY = 'USER_ARCHIVE_20261109_V1'
LAYOUT_POLICY = 'SOURCE_RUN_STYLES_WITH_BOUNDED_ADAPTIVE_FIT'
MARKER = 'demo/archive-form.json'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'
TOKEN = re.compile(r'\{\{([A-Z][A-Z0-9_]*)\}\}')
PART = re.compile(r'word/(?:archive-[0-9]+/)*(?:document|header[^/]*|footer[^/]*)\.xml\Z')
MEDIA = re.compile(r'word/(?:archive-[0-9]+/)*media/[A-Za-z0-9_.-]+\.(?:png|jpe?g)\Z', re.I)
IDS = frozenset({'biot-worker-card', 'biot-itr-certificate', 'biot-protocol',
    'biot-itr-protocol', 'ptm-card', 'ptm-protocol', 'pb-card', 'pb-protocol',
    'ps-card', 'ps-protocol', 'ps-witness'})


def _require(value, code):
    if not value:
        raise ValueError('ARCHIVE_' + code)


def _marker(data, template_id):
    _require(len(data) <= 65536, 'MARKER_LIMIT')
    try:
        marker = json.loads(data)
    except (ValueError, UnicodeError) as error:
        raise ValueError('ARCHIVE_MARKER_INVALID') from error
    _require(isinstance(marker, dict) and set(marker) <= {
        'policy', 'templateId', 'sourceSha256', 'fields', 'roster', 'rosters', 'dynamicMedia', 'fieldLayoutPolicy'}, 'MARKER_INVALID')
    _require(marker.get('policy') == POLICY and marker.get('templateId') == template_id
             and template_id in IDS, 'IDENTITY_MISMATCH')
    _require(isinstance(marker.get('sourceSha256'), str)
             and re.fullmatch(r'[a-f0-9]{64}', marker['sourceSha256']), 'SOURCE_HASH_INVALID')
    fields = marker.get('fields')
    _require(isinstance(fields, list) and 0 < len(fields) <= 256
             and all(isinstance(key, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', key) for key in fields)
             and len(set(fields)) == len(fields), 'FIELDS_INVALID')
    _require(not ('roster' in marker and 'rosters' in marker), 'ROSTER_INVALID')
    rosters = marker.get('rosters', [marker['roster']] if 'roster' in marker else [])
    _require(isinstance(rosters, list) and len(rosters) <= 8, 'ROSTER_INVALID')
    for roster in rosters:
        _require(isinstance(roster, dict) and set(roster) == {'headerRows', 'tableIndex'}
                 and type(roster['headerRows']) is int and roster['headerRows'] in [1, 2]
                 and type(roster['tableIndex']) is int and 0 <= roster['tableIndex'] < 1000
                 and template_id.endswith('-protocol'), 'ROSTER_INVALID')
    _require(len({roster['tableIndex'] for roster in rosters}) == len(rosters), 'ROSTER_INVALID')
    if 'fieldLayoutPolicy' in marker:
        _require(marker['fieldLayoutPolicy'] == LAYOUT_POLICY, 'LAYOUT_POLICY_UNKNOWN')
    media = marker.get('dynamicMedia', [])
    _require(isinstance(media, list) and len(media) <= 32, 'MEDIA_INVALID')
    names = set()
    for entry in media:
        _require(isinstance(entry, dict) and set(entry) == {'part', 'kind'}
                 and isinstance(entry.get('part'), str) and MEDIA.fullmatch(entry['part'])
                 and entry.get('kind') in ['PHOTO', 'LOGO', 'ISSUER_NAME'] and entry['part'] not in names, 'MEDIA_INVALID')
        names.add(entry['part'])
    return marker


def identify_archive(path, template_id):
    with ZipFile(path) as archive:
        if MARKER not in archive.namelist():
            return False
        _require(archive.getinfo(MARKER).file_size <= 65536, 'MARKER_LIMIT')
        _marker(archive.read(MARKER), template_id)
    return True


def _ps_decision_fields(basis, qualifications_ru, qualifications_kz, passed):
    ru_values = list(dict.fromkeys(value for value in qualifications_ru if value))
    kz_values = list(dict.fromkeys(value for value in qualifications_kz if value))
    ru = '«' + '; '.join(ru_values) + '»' if ru_values else ''
    kz = '«' + '; '.join(kz_values) + '»' if kz_values else ''
    ru_prefix = ('На основании ' + basis + ' комиссия ') if basis else 'Комиссия '
    kz_prefix = (basis + ' негізінде комиссия ') if basis else 'Комиссия '
    if passed:
        ru_action = 'приняла экзамен на присвоение ' + ('квалификаций ' if len(ru_values) > 1 else 'квалификации ')
        kz_action = 'емтихан қабылдады және ' + kz + (' біліктіліктерін растады' if len(kz_values) > 1 else ' біліктілігін растады')
    else:
        ru_action = 'рассмотрела результаты экзаменов по ' + ('квалификациям ' if len(ru_values) > 1 else 'квалификации ')
        kz_action = kz + (' біліктіліктері бойынша' if len(kz_values) > 1 else ' біліктілігі бойынша') + ' емтихан нәтижелерін қарады'
    return {'PS_DECISION_RU': (ru_prefix + ru_action + ru).strip(),
            'PS_DECISION_KZ': (kz_prefix + kz_action).strip()}


def archive_fields(snapshot, item, ordinal=1):
    from renderer import validated_fields
    from legacy_snapshot_fields import bilingual_parts, factual_assessment_text
    assignment = item['assignment']
    nonpassed = {'FAILED': ('Не сдал', 'Тапсырмады'), 'ABSENT': ('Не явился', 'Келмеді'),
                 'UNKNOWN': ('Не подтверждено', 'Расталмаған')}
    status = (assignment.get('outcome') or {}).get('status')
    if status != 'PASSED' and status not in nonpassed:
        status = 'UNKNOWN'
    if status in nonpassed:
        ru, kz = nonpassed[status]
        origins = assignment.get('fieldOrigins') or {}
        actual = factual_assessment_text(assignment.get('result'), origins.get('result'))
        actual_kz = factual_assessment_text(assignment.get('resultKz'), origins.get('resultKz'))
        if actual and not actual_kz and re.fullmatch(r'[\d\s/.,%+-]+', actual):
            actual_kz = actual
        ru += '; ' + actual if actual else ''
        kz += '; ' + actual_kz if actual_kz else ''
        assignment = {**assignment, 'result': ru + ' / ' + kz, 'resultRu': ru, 'resultKz': kz}
    values = validated_fields(snapshot, {**item, 'assignment': assignment})
    for prefix, name in [('SUBJECT', 'trainingSubject'), ('RESULT', 'result'), ('REASON', 'reason')]:
        scalar = str(assignment.get(name) or assignment.get(name + 'Ru') or assignment.get(name + 'Kz') or '').strip()
        if prefix == 'RESULT' and re.fullmatch(r'[\d\s/.,%+-]+', scalar) and re.search(r'\d', scalar):
            # A numeric score is one value, not a RU/KZ slash separator.
            ru, kz = (str(assignment.get(name + lang) or scalar).strip() for lang in ['Ru', 'Kz'])
        else:
            ru, kz = bilingual_parts(assignment.get(name), assignment.get(name + 'Ru'), assignment.get(name + 'Kz'))
        values.update({prefix + '_RU': ru, prefix + '_KZ': kz,
                       prefix + '_BOTH': ' / '.join(dict.fromkeys(part for part in [ru, kz] if part))})
    if status == 'PASSED':
        if snapshot['templateId'] == 'biot-worker-card':
            values['EXAM_STATEMENT_RU'] = 'В том, что он сдал экзамены на знание ' + values['SUBJECT_BOTH']
            values['EXAM_STATEMENT_KZ'] = 'Бойынша емтихан тапсырғаны туралы берілді.'
        elif snapshot['templateId'] == 'ptm-card':
            values['EXAM_STATEMENT_RU'] = 'В том, что он (она) сдал (сдала) экзамены на знание ' + values['SUBJECT_RU']
            values['EXAM_STATEMENT_KZ'] = 'Ол ' + values['SUBJECT_KZ'] + ' біліміне емтихан тапсырды'
        else:
            values['EXAM_STATEMENT_RU'] = 'Сдал(а) экзамен' + (' по программе: ' + values['SUBJECT_RU'] if values['SUBJECT_RU'] else '')
            values['EXAM_STATEMENT_KZ'] = (values['SUBJECT_KZ'] + ' бағдарламасы бойынша ' if values['SUBJECT_KZ'] else '') + 'емтихан тапсырды'
        values['QUALIFICATION_STATUS_RU'] = 'в том, что ему присвоена квалификация'
        values['QUALIFICATION_STATUS_KZ'] = 'біліктілік берілгендігі туралы'
    else:
        values['EXAM_STATEMENT_RU'] = ('Результат экзамена: ' + values['RESULT_RU'] if values['RESULT_RU'] else 'Результат экзамена не подтверждён') + ('. Программа: ' + values['SUBJECT_RU'] if values['SUBJECT_RU'] else '')
        values['EXAM_STATEMENT_KZ'] = ('Емтихан нәтижесі: ' + values['RESULT_KZ'] if values['RESULT_KZ'] else 'Емтихан нәтижесі расталмаған') + ('. Бағдарлама: ' + values['SUBJECT_KZ'] if values['SUBJECT_KZ'] else '')
        values['QUALIFICATION_STATUS_RU'] = 'Присвоение квалификации не подтверждено'
        values['QUALIFICATION_STATUS_KZ'] = 'Біліктілік берілгені расталмаған'
    head = snapshot['issuer'].get('headName', '')
    values.update(HEAD=head, HEAD_NAME=head, ISSUER_HEAD_NAME=head, ROW_NUMBER=str(ordinal), ONE=str(ordinal))
    issuer_name = str(snapshot['issuer'].get('nameRu') or snapshot['issuer'].get('nameKz') or '')
    values['MEMBERS_FROM_SECOND'] = '; '.join(
        ' — '.join(str(person.get(key) or '') for key in ['name', 'position'] if person.get(key))
        + (', ' + issuer_name if issuer_name else '')
        for person in snapshot['issuer'].get('commission', [])[2:])
    explicit = any(key in assignment for key in ['psGeneralSubjectRu', 'psGeneralSubjectKz', 'psSpecialSubjectRu', 'psSpecialSubjectKz'])
    for prefix, name in [('PS_GENERAL_SUBJECT', 'psGeneralSubject'), ('PS_SPECIAL_SUBJECT', 'psSpecialSubject')]:
        for lang, suffix in [('RU', 'Ru'), ('KZ', 'Kz')]:
            values[prefix + '_' + lang] = str(assignment.get(name + suffix) or '').strip() if explicit else (
                values['SUBJECT_' + lang] if prefix == 'PS_GENERAL_SUBJECT' else '')
    values['PS_GENERAL_NUMBER'] = '1' if values['PS_GENERAL_SUBJECT_RU'] or values['PS_GENERAL_SUBJECT_KZ'] else ''
    values['PS_SPECIAL_NUMBER'] = '2' if values['PS_SPECIAL_SUBJECT_RU'] or values['PS_SPECIAL_SUBJECT_KZ'] else ''
    values.update(_ps_decision_fields(values['APPROVAL_BASIS'], [values['POSITION_RU']], [values['POSITION_KZ']], status == 'PASSED'))
    for language in ['RU', 'KZ']:
        values['PS_AWARDED_QUALIFICATION_' + language] = values['POSITION_' + language] if status == 'PASSED' else ''
    if snapshot['templateId'] == 'ps-protocol':
        values['CREDENTIAL_NUMBER'] = str(item.get('credentialNumber') or '') if status == 'PASSED' else ''
    return {key: str(value) if value is not None else '' for key, value in values.items()}


def _paragraph_texts(root):
    for paragraph in root.iter(W + 'p'):
        nodes = [node for node in paragraph.iter(W + 't')
                 if next(node.iterancestors(W + 'p'), None) is paragraph]
        if nodes:
            yield nodes


def _tokens(root):
    fields = set()
    for nodes in _paragraph_texts(root):
        text = ''.join(node.text or '' for node in nodes)
        for token in re.findall(r'\{\{[^{}]*\}\}', text):
            match = TOKEN.fullmatch(token)
            _require(match is not None, 'FIELD_INVALID')
            fields.add(match[1])
    return fields


def _fill(root, fields):
    # Match only the original template. Values containing another token are data.
    for nodes in _paragraph_texts(root):
        source = ''.join(node.text or '' for node in nodes)
        spans = []
        offset = 0
        for node in nodes:
            length = len(node.text or '')
            spans.append((node, offset, offset + length))
            offset += length
        for match in reversed(list(TOKEN.finditer(source))):
            _require(match[1] in fields, 'FIELD_UNKNOWN')
            # Bound only fields used by this form: extra descriptive members must
            # not block an unrelated card which has only fixed signature slots.
            value = fields[match[1]]
            if len(value) > 4096 or any(len(token) > 80 for token in value.split()):
                raise ValueError('PRINT_LAYOUT_OVERFLOW')
            for node, start, end in spans:
                if end <= match.start() or start >= match.end():
                    continue
                old = node.text or ''
                left, right = max(0, match.start() - start), min(end, match.end()) - start
                node.text = old[:left] + (value if start <= match.start() < end else '') + old[right:]
                node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')


def _load(path, snapshot, known_fields):
    files = inspect_package(path)
    _require(MARKER in files, 'MARKER_MISSING')
    marker = _marker(files[MARKER], snapshot['templateId'])
    _require(set(marker['fields']) <= set(known_fields), 'FIELD_UNKNOWN')
    trees = {name: E.fromstring(data) for name, data in files.items() if PART.fullmatch(name)}
    found = set().union(*(_tokens(tree) for tree in trees.values()))
    _require(found == set(marker['fields']), 'FIELDS_MISMATCH')
    for name, data in files.items():
        if name.endswith('.xml') and name not in trees:
            _require(not _tokens(E.fromstring(data)), 'FIELD_PART_UNSUPPORTED')
    for entry in marker.get('dynamicMedia', []):
        _require(entry['part'] in files, 'MEDIA_MISSING')
    return files, marker, trees


def _photo_bytes(snapshot, item):
    photo_id = item.get('photoAssetId')
    if not photo_id:
        return None
    key = snapshot.get('photos', {}).get(photo_id)
    _require(isinstance(key, str) and key, 'PHOTO_ASSET_MISSING')
    store = Path(os.environ['DEMO_ARTIFACT_ROOT']).resolve()
    path = (store / key).resolve()
    _require(path.is_relative_to(store) and path.is_file(), 'PHOTO_PATH')
    _require(path.stat().st_size <= 5 * 1024 * 1024, 'PHOTO_LIMIT')
    content = path.read_bytes()
    expected = re.search(r'(?:^|/)([a-f0-9]{64})-[0-9a-f-]{36}\.png$', key.replace('\\', '/'))
    _require(expected is not None and expected[1] == hashlib.sha256(content).hexdigest(), 'PHOTO_HASH_MISMATCH')
    return content


def _media(files, marker, snapshot, item):
    entries = marker.get('dynamicMedia', [])
    photo = _photo_bytes(snapshot, item) if any(entry['kind'] == 'PHOTO' for entry in entries) else None
    for entry in entries:
        with Image.open(BytesIO(files[entry['part']])) as original:
            size, fmt = original.size, original.format
        _require(fmt in ['JPEG', 'PNG'] and 0 < size[0] * size[1] <= 20_000_000, 'MEDIA_FORMAT')
        canvas = Image.new('RGB' if fmt == 'JPEG' else 'RGBA', size,
                           'white' if fmt == 'JPEG' else (255, 255, 255, 0))
        if entry['kind'] == 'PHOTO' and photo:
            with Image.open(BytesIO(photo)) as source:
                _require(source.format in ['JPEG', 'PNG'] and source.width * source.height <= 20_000_000, 'PHOTO_FORMAT')
                fitted = ImageOps.contain(ImageOps.exif_transpose(source).convert('RGBA'), size)
                canvas.paste(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2), fitted)
        if entry['kind'] == 'ISSUER_NAME':
            content = ' / '.join(dict.fromkeys(str(snapshot['issuer'].get(key) or '').strip()
                for key in ['nameRu', 'nameKz'] if str(snapshot['issuer'].get(key) or '').strip()))
            if content:
                draw = ImageDraw.Draw(canvas)
                font_path = Path(__file__).resolve().parents[2] / 'assets/fonts/LiberationSans-Regular.ttf'
                for pixels in range(max(10, min(70, size[1] // 3)), 5, -1):
                    font = ImageFont.truetype(str(font_path), pixels)
                    lines, line = [], ''
                    for word in content.split():
                        candidate = (line + ' ' + word).strip()
                        if draw.textlength(candidate, font=font) > size[0] - 8 and line:
                            lines.append(line); line = word
                        else:
                            line = candidate
                    if line: lines.append(line)
                    height = len(lines) * (pixels + 3)
                    if height <= size[1] - 8 and all(draw.textlength(line, font=font) <= size[0] - 8 for line in lines):
                        break
                else:
                    raise ValueError('PRINT_LAYOUT_OVERFLOW')
                y = max(4, (size[1] - height) // 2)
                for line in lines:
                    draw.text(((size[0] - draw.textlength(line, font=font)) / 2, y), line, font=font, fill='black')
                    y += pixels + 3
        output = BytesIO()
        canvas.save(output, fmt)
        files[entry['part']] = output.getvalue()


def _serialize(tree):
    return E.tostring(tree, encoding='utf-8', xml_declaration=True)


def _fit_empty_biot_renewal_lines(box, typography):
    from source_fidelity import dimensions, child
    shape = next((node for node in box.iterancestors() if E.QName(node).localname in ['shape', 'rect']), None)
    position = re.search(r'(?:^|;)margin-left:([\d.]+)pt', shape.get('style', '') if shape is not None else '')
    if not position or float(position[1]) < 250:
        return
    # The archive's right renewal panel contains cached tab stops beyond its
    # printed border. Shorten only empty writing space, keeping every label.
    width, _ = dimensions(box)
    for paragraph in box.findall(W + 'p'):
        nodes = next(_paragraph_texts(paragraph), [])
        if not ''.join(node.text or '' for node in nodes).lstrip().startswith(('Основание:', 'Негiздеме:', 'Негіздеме:')):
            continue
        for tab in list(paragraph.iter(W + 'tab')):
            if tab.getparent().tag == W + 'r':
                tab.tag = W + 't'; tab.text = ' '; tab.attrib.clear()
                tab.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        nodes = next(_paragraph_texts(paragraph), [])
        reductions = 0
        while sum(typography.font(paragraph, node.getparent()).getlength(node.text or '') / 10 for node in nodes) > width - 20:
            blanks = [node for node in nodes if (node.text or '').isspace() and len(node.text) > 8]
            if not blanks or reductions >= 256:
                raise ValueError('PRINT_LAYOUT_OVERFLOW')
            longest = max(blanks, key=lambda node: len(node.text))
            longest.text = longest.text[:-1]
            reductions += 1
        indent = child(child(paragraph, 'pPr'), 'ind')
        indent.set(W + 'right', str(max(320, int(indent.get(W + 'right', '0')))))


def _prepare_layout(tree, marker, files):
    if marker.get('fieldLayoutPolicy') != LAYOUT_POLICY:
        return []
    from source_fidelity import Typography, dimensions, child
    _require('word/styles.xml' in files, 'LAYOUT_STYLES_REQUIRED')
    typography = Typography(files['word/styles.xml'])
    states = []
    for box in tree.iter(W + 'txbxContent'):
        if not _tokens(box):
            if marker['templateId'] == 'biot-worker-card':
                _fit_empty_biot_renewal_lines(box, typography)
            continue
        width, height = dimensions(box)
        front = any(key.startswith('FULL_NAME') for key in _tokens(box))
        template_id = marker['templateId']
        minimum_left = {'biot-worker-card': 24, 'ptm-card': 22, 'pb-card': 20}.get(template_id, 0) if front else 0
        minimum_right = {'biot-worker-card': 24, 'ptm-card': 8, 'pb-card': 8, 'ps-card': 16}.get(template_id, 0) if front else 0
        paragraphs = []
        for paragraph in box.findall(W + 'p'):
            nodes = next(_paragraph_texts(paragraph), [])
            label = ''.join(node.text or '' for node in nodes)
            spans = [match.span() for match in TOKEN.finditer(label)]
            dynamic, offset = [], 0
            for node in nodes:
                end = offset + len(node.text or '')
                if any(offset < finish and end > start for start, finish in spans):
                    if node.getparent() not in dynamic:
                        dynamic.append(node.getparent())
                offset = end
            if dynamic:
                # Empty sample padding is elastic; named text and field styles remain.
                for node in nodes:
                    node.text = re.sub(r'[\s\u00a0]{2,}', ' ', node.text or '')
                previous = None
                for node in nodes:
                    if (node.text or '').isspace():
                        if previous is not None and not (previous.text or '').endswith(' '):
                            previous.text = (previous.text or '') + ' '
                        node.text = ''
                    elif node.text:
                        previous = node
                for tab in list(paragraph.iter(W + 'tab')):
                    tab.getparent().remove(tab)
                populated = [node for node in nodes if node.text]
                if populated:
                    populated[0].text = populated[0].text.lstrip()
                    populated[-1].text = populated[-1].text.rstrip()
                for node in nodes:
                    node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
            if dynamic or front:
                props = child(paragraph, 'pPr')
                indent = child(props, 'ind')
                # Override inherited negative/hanging first lines without moving the frame.
                indent.set(W + 'left', str(max(minimum_left * 20, int(indent.get(W + 'left', '0')))))
                right = 0 if template_id == 'ps-card' and not dynamic and 'указать профессию' not in label else minimum_right
                indent.set(W + 'right', str(max(right * 20, int(indent.get(W + 'right', '0')))))
                indent.set(W + 'firstLine', str(max(0, int(indent.get(W + 'firstLine', '0')))))
                indent.set(W + 'hanging', '0')
                # These archive panels place the photo beside the lower fields.
                # Reserve its existing space; do not move or resize either shape.
                if front and template_id == 'pb-card' and any(key in label for key in ['{{WORKPLACE_', '{{POSITION_', '{{DOCUMENT_', '{{SUBJECT_', '{{ISSUER_']):
                    indent.set(W + 'left', str(max(2000, int(indent.get(W + 'left', '0')))))
                if front and template_id == 'pb-card' and '{{FULL_NAME_' in label:
                    # The name sits immediately above the fixed photo frame.
                    # Its source 12pt sample crosses that frame even for short names.
                    for run in dynamic:
                        size = min(10, typography.size(paragraph, run))
                        for tag in ['sz', 'szCs']:
                            child(child(run, 'rPr'), tag).set(W + 'val', str(round(size * 2)))
                if front and template_id == 'ptm-card' and any(key in label for key in ['{{POSITION_', '{{WORKPLACE_']):
                    indent.set(W + 'right', str(max(1520, int(indent.get(W + 'right', '0')))))
                if front and template_id == 'ps-card' and '{{NUMBER}}' in label and not any(p.get('title') for p in paragraphs):
                    spacing = child(props, 'spacing')
                    spacing.set(W + 'before', str(max(160, int(spacing.get(W + 'before', '0')))))
                if front and template_id == 'ps-card' and '{{QUALIFICATION_STATUS_KZ}}' in label:
                    indent.set(W + 'left', str(max(800, int(indent.get(W + 'left', '0')))))
                if front and template_id == 'ps-card' and 'указать профессию' in label and not dynamic:
                    # This explanatory source caption otherwise crosses the fold.
                    # Bound its small print independently of the recipient fields.
                    for node in nodes:
                        run = node.getparent()
                        for tag in ['sz', 'szCs']:
                            child(child(run, 'rPr'), tag).set(W + 'val', '11')
            paragraphs.append({'node': paragraph, 'dynamic': dynamic, 'title': '{{NUMBER}}' in label,
                               'fields': set(TOKEN.findall(label)),
                               'sizes': {run: typography.size(paragraph, run) for run in dynamic}})
        states.append({'box': box, 'width': width, 'height': height, 'paragraphs': paragraphs,
                       'typography': typography, 'certificate': False,
                       'compactStaticPadding': template_id == 'ps-card' and front,
                       'compactBilingualName': template_id == 'ps-card' and front})
    return states


def _fit_archive_layout(states):
    from source_fidelity import fit_layout, child
    for state in states:
        try:
            fit_layout([state])
        except ValueError as error:
            if str(error) != 'PRINT_LAYOUT_OVERFLOW' or not state['compactBilingualName']:
                raise
            state['paragraphs'] = [paragraph for paragraph in state['paragraphs'] if paragraph['node'].getparent() is not None]
            # PS puts both names into one slot. Its source label has a stray
            # 9pt final letter among 7pt letters. One bounded 7.5pt name fallback
            # keeps a normal bilingual full name without changing the panel.
            for paragraph in state['paragraphs']:
                if 'FULL_NAME_BOTH' not in paragraph['fields']:
                    continue
                for run in paragraph['node'].findall(W + 'r'):
                    size = min(7.5, paragraph['sizes'][run]) if run in paragraph['sizes'] else min(7, state['typography'].size(paragraph['node'], run))
                    if run in paragraph['sizes']:
                        paragraph['sizes'][run] = size
                    for tag in ['sz', 'szCs']:
                        child(child(run, 'rPr'), tag).set(W + 'val', str(round(size * 2)))
            fit_layout([state])


def _keep_signature_tables(tree, template_id=None):
    """Keep the commission's signature block together without joining roster rows."""
    for table in tree.iter(W + 'tbl'):
        fields = _tokens(table)
        if not {'CHAIR_NAME', 'MEMBER_1_NAME'} <= fields or fields & {
                'ROW_NUMBER', 'ONE', 'FULL_NAME_RU', 'FULL_NAME_KZ', 'FULL_NAME_BOTH'}:
            continue
        props = table.find(W + 'tblPr')
        floating = props.find(W + 'tblpPr') if props is not None else None
        if (template_id == 'ps-protocol' and floating is not None
                and floating.get(W + 'vertAnchor') == 'text'
                and floating.get(W + 'horzAnchor') == 'margin'
                and floating.get(W + 'tblpX', '0') == '0'
                and floating.get(W + 'tblpXSpec') is None
                and floating.get(W + 'tblpYSpec') is None):
            # Writer ignores keepNext across rows of these floating PS blocks.
            # Inline the text-anchored block, retaining its grid, width and gap.
            gap = floating.get(W + 'tblpY', '0')
            if gap.isdigit() and int(gap) <= 80:
                props.remove(floating)
                first_row = table.find(W + 'tr')
                for cell in first_row.findall(W + 'tc') if first_row is not None else []:
                    paragraph = cell.find(W + 'p')
                    if paragraph is None:
                        continue
                    paragraph_props = paragraph.find(W + 'pPr')
                    if paragraph_props is None:
                        paragraph_props = E.Element(W + 'pPr'); paragraph.insert(0, paragraph_props)
                    spacing = paragraph_props.find(W + 'spacing')
                    if spacing is None:
                        spacing = E.Element(W + 'spacing')
                        later = {W + key for key in ['ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange']}
                        position = next((i for i, node in enumerate(paragraph_props) if node.tag in later), len(paragraph_props))
                        paragraph_props.insert(position, spacing)
                    spacing.set(W + 'before', str(int(spacing.get(W + 'before', '0')) + int(gap)))
        for row in table.findall(W + 'tr'):
            props = row.find(W + 'trPr')
            if props is None:
                props = E.Element(W + 'trPr'); row.insert(0, props)
            cant_split = props.find(W + 'cantSplit')
            if cant_split is None:
                cant_split = E.Element(W + 'cantSplit')
                later = {W + key for key in ['trHeight', 'tblHeader', 'tblCellSpacing', 'jc', 'hidden', 'ins', 'del', 'trPrChange']}
                position = next((i for i, node in enumerate(props) if node.tag in later), len(props))
                props.insert(position, cant_split)
            cant_split.set(W + 'val', '1')
        paragraphs = list(table.iter(W + 'p'))
        for index, paragraph in enumerate(paragraphs):
            props = paragraph.find(W + 'pPr')
            if props is None:
                props = E.Element(W + 'pPr'); paragraph.insert(0, props)
            keep_next = props.find(W + 'keepNext')
            if keep_next is not None:
                props.remove(keep_next)
            keep_next = E.Element(W + 'keepNext', {W + 'val': '0' if index == len(paragraphs) - 1 else '1'})
            props.insert(1 if len(props) and props[0].tag == W + 'pStyle' else 0, keep_next)


def _pin_pb_photo_to_source_frame(tree, marker, files):
    """The PB image follows text by default, while its existing frame is page-fixed."""
    photo_parts = {entry['part'] for entry in marker.get('dynamicMedia', []) if entry['kind'] == 'PHOTO'}
    if not photo_parts or 'word/_rels/document.xml.rels' not in files:
        return
    rels = E.fromstring(files['word/_rels/document.xml.rels'])
    photo_ids = {rel.get('Id') for rel in rels if (
        rel.get('Target', '').lstrip('/') if rel.get('Target', '').startswith('/')
        else normpath('word/' + rel.get('Target', ''))) in photo_parts}
    frames = []
    for shape in tree.iter('{urn:schemas-microsoft-com:vml}rect'):
        style = dict(re.findall(r'(?:^|;)\s*([^:;]+):([^;]*)', shape.get('style', '')))
        if style.get('mso-position-vertical-relative') != 'page' or list(shape.iter(W + 'txbxContent')):
            continue
        try:
            top, width, height = (float(style[key].removesuffix('pt')) for key in ['margin-top', 'width', 'height'])
        except (ValueError, KeyError):
            continue
        if 40 <= width <= 80 and 60 <= height <= 100:
            frames.append((top, height))
    if len(frames) != 1:
        return
    wp = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
    a = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
    for anchor in tree.iter(wp + 'anchor'):
        if not any(blip.get(R + 'embed') in photo_ids for blip in anchor.iter(a + 'blip')):
            continue
        extent, position = anchor.find(wp + 'extent'), anchor.find(wp + 'positionV')
        if extent is None or position is None:
            continue
        image_height = int(extent.get('cy', '0')) / 12700
        top, frame_height = frames[0]
        if not 0 < image_height <= frame_height:
            continue
        position.set('relativeFrom', 'page')
        for child in list(position):position.remove(child)
        E.SubElement(position, wp + 'posOffset').text = str(round((top + (frame_height - image_height) / 2) * 12700))


def _trim_pb_card_empty_tail(tree):
    """Discard inert source padding after the last card, never anchors or breaks."""
    body = tree.find(W + 'body')
    if body is None or not len(body) or body[-1].tag != W + 'sectPr':
        return
    inert = {W + name for name in ['p', 'pPr', 'r', 'rPr', 'pStyle', 'tabs', 'tab',
        'spacing', 'ind', 'jc', 'rFonts', 'sz', 'szCs', 'b', 'bCs', 'i', 'iCs',
        'lang', 'proofErr', 'lastRenderedPageBreak', 'br', 't']}
    removed = []
    for paragraph in reversed(list(body)[:-1]):
        if paragraph.tag != W + 'p' or any(
                node.tag not in inert or (node.tag == W + 't' and (node.text or '').strip())
                or (node.tag == W + 'br' and node.get(W + 'type') in ['page', 'column'])
                for node in paragraph.iter()):
            break
        removed.append(paragraph)
    if not removed:
        return
    for paragraph in removed:
        body.remove(paragraph)
    # Word requires a final paragraph after a table. A one-point empty line
    # replaces the archive's hundred-line padding without adding a blank page.
    paragraph = E.Element(W + 'p')
    props = E.SubElement(paragraph, W + 'pPr')
    E.SubElement(props, W + 'spacing', {W + 'before': '0', W + 'after': '0', W + 'line': '20', W + 'lineRule': 'exact'})
    E.SubElement(E.SubElement(props, W + 'rPr'), W + 'sz', {W + 'val': '2'})
    body.insert(len(body) - 1, paragraph)


def render_archive_one(snapshot, item, path):
    fields = archive_fields(snapshot, item)
    files, marker, trees = _load(path, snapshot, fields)
    for name, tree in trees.items():
        if snapshot['templateId'] == 'pb-card' and name == 'word/document.xml':
            _trim_pb_card_empty_tail(tree)
            _pin_pb_photo_to_source_frame(tree, marker, files)
        if _tokens(tree):
            if snapshot['templateId'].endswith('-protocol'):
                _keep_signature_tables(tree, snapshot['templateId'])
            states = _prepare_layout(tree, marker, files)
            _fill(tree, fields)
            if states:
                _fit_archive_layout(states)
            files[name] = _serialize(tree)
    _media(files, marker, snapshot, item)
    return files


def _unique_ids(root, index):
    names, ids = {}, {}
    for node in root.iter(W + 'bookmarkStart'):
        old = node.get(W + 'id')
        _require(len(ids) < 9999, 'BOOKMARK_LIMIT')
        ids[old] = str(index * 10_000 + len(ids) + 1)
        node.set(W + 'id', ids[old])
        name = node.get(W + 'name')
        if name:
            names[name] = name[:28] + f'_a{index}'
            node.set(W + 'name', names[name])
    for node in root.iter(W + 'bookmarkEnd'):
        if node.get(W + 'id') in ids:
            node.set(W + 'id', ids[node.get(W + 'id')])
    drawing = 0
    for node in root.iter():
        if not isinstance(node.tag, str):
            continue
        local = E.QName(node).localname
        if local in ['docPr', 'cNvPr'] and node.get('id'):
            drawing += 1
            _require(drawing < 9999, 'DRAWING_LIMIT')
            node.set('id', str(index * 10_000 + drawing))
        if local in ['shape', 'rect', 'group'] and node.get('id'):
            node.set('id', node.get('id') + f'_a{index}')
        if node.get(W + 'anchor') in names:
            node.set(W + 'anchor', names[node.get(W + 'anchor')])
        if node.tag == W + 'instrText':
            for old, new in names.items():
                node.text = re.sub(r'(?<!\w)' + re.escape(old) + r'(?!\w)', new, node.text or '')


def render_archive_group(snapshot, path):
    items = snapshot['items']
    event = snapshot.get('groupEvent', {})
    _require(event.get('contractVersion') == 1 and snapshot['templateId'].endswith('-protocol'), 'GROUP_VERSION')
    _require(1 <= len(items) <= MAX_REQUEST_ROWS, 'GROUP_ROW_LIMIT')
    _require(len({(item['id'], item['assignment'].get('eventId')) for item in items}) == len(items), 'GROUP_DUPLICATE_MEMBER')
    header = items[0]
    workplace = snapshot.get('groupHeaderWorkplace')
    if workplace is not None:
        _require(isinstance(workplace, dict) and workplace.get('version') == 1
                 and all(isinstance(workplace.get(key), str) for key in ['workplaceRu', 'workplaceKz']), 'GROUP_HEADER_WORKPLACE')
        header = {**header, 'workplaceRu': workplace['workplaceRu'], 'workplaceKz': workplace['workplaceKz']}
    fields = archive_fields(snapshot, header)
    if snapshot['templateId'] == 'ps-protocol':
        unique_qualifications = {'RU': {}, 'KZ': {}}
        for item in items:
            member_fields = archive_fields(snapshot, item)
            for language in unique_qualifications:
                value = member_fields['POSITION_' + language]
                if value:
                    unique_qualifications[language][value] = None
        qualifications = {language: list(values) for language, values in unique_qualifications.items()}
        for language in qualifications:
            fields['POSITION_' + language] = '; '.join(qualifications[language])
            fields['PROFESSION_' + language] = fields['POSITION_' + language]
        fields['POSITION_BOTH'] = ' / '.join(dict.fromkeys(fields['POSITION_' + lang] for lang in ['RU', 'KZ'] if fields['POSITION_' + lang]))
        fields.update(_ps_decision_fields(fields['APPROVAL_BASIS'], qualifications['RU'], qualifications['KZ'],
            all((item['assignment'].get('outcome') or {}).get('status') == 'PASSED' for item in items)))
    files, marker, trees = _load(path, snapshot, fields)
    for tree in trees.values():
        _keep_signature_tables(tree, snapshot['templateId'])
    specs = marker.get('rosters', [marker['roster']] if 'roster' in marker else [])
    _require(specs, 'ROSTER_REQUIRED')
    body = trees['word/document.xml'].find(W + 'body')
    tables = list(body.iter(W + 'tbl'))
    targets = []
    for spec in specs:
        _require(spec['tableIndex'] < len(tables), 'ROSTER_TABLE_MISSING')
        table = tables[spec['tableIndex']]
        rows = table.findall(W + 'tr')
        _require(len(rows) > spec['headerRows'], 'ROSTER_ROW_MISSING')
        prototype = rows[spec['headerRows']]
        _require(bool(_tokens(prototype) & {'ROW_NUMBER', 'ONE'}), 'ROSTER_ORDINAL_REQUIRED')
        targets.append((table, table.index(prototype), prototype))
        table.remove(prototype)
    # Fill common text once before inserting per-person rows.
    for tree in trees.values():
        _fill(tree, fields)
    for table_index, (table, position, prototype) in enumerate(targets):
        for index, item in enumerate(items, 1):
            row = deepcopy(prototype)
            _fill(row, archive_fields(snapshot, item, index))
            _unique_ids(row, table_index * MAX_REQUEST_ROWS + index)
            table.insert(position + index - 1, row)
    for name, tree in trees.items():
        files[name] = _serialize(tree)
    # A single common header has no meaningful per-person photo.
    _require(not any(entry['kind'] == 'PHOTO' for entry in marker.get('dynamicMedia', [])), 'GROUP_PHOTO_UNSUPPORTED')
    _media(files, marker, snapshot, header)
    return files


def _merge_formatting(files, source_files, index):
    """Isolate style/numbering IDs when joining independently authored RU/KZ forms."""
    source_files = dict(source_files)
    style_ids, num_ids = {}, {}
    source_styles = E.fromstring(source_files['word/styles.xml']) if 'word/styles.xml' in source_files else None
    styles = E.fromstring(files['word/styles.xml']) if 'word/styles.xml' in files else E.Element(W + 'styles', nsmap={'w': W[1:-1]})
    paragraph_style = None
    if source_styles is not None:
        for style in source_styles.findall(W + 'style'):
            old = style.get(W + 'styleId')
            style_ids[old] = f'Archive{index}_{old}'
            if style.get(W + 'type') == 'paragraph' and style.get(W + 'default') in ['1', 'true', 'on']:
                paragraph_style = style_ids[old]
        base_id = f'Archive{index}_Defaults'
        base = E.SubElement(styles, W + 'style', {W + 'type': 'paragraph', W + 'styleId': base_id})
        for key in ['pPr', 'rPr']:
            defaults = source_styles.find(W + 'docDefaults/' + W + key + 'Default/' + W + key)
            if defaults is not None:
                base.append(deepcopy(defaults))
        paragraph_style = paragraph_style or style_ids.get('Normal') or base_id
    if 'word/numbering.xml' in source_files:
        numbering = E.fromstring(files.get('word/numbering.xml', f'<w:numbering xmlns:w="{W[1:-1]}"/>'.encode()))
        original = E.fromstring(source_files['word/numbering.xml'])
        abstract_ids = {}
        next_abstract = max([int(node.get(W + 'abstractNumId')) for node in numbering.findall(W + 'abstractNum')] + [-1]) + 1
        next_num = max([int(node.get(W + 'numId')) for node in numbering.findall(W + 'num')] + [0]) + 1
        for node in original.findall(W + 'abstractNum'):
            old = node.get(W + 'abstractNumId')
            abstract_ids[old] = str(next_abstract); next_abstract += 1
            node.set(W + 'abstractNumId', abstract_ids[old])
            for child in node.iter():
                if child.tag in [W + 'pStyle', W + 'styleLink', W + 'numStyleLink'] and child.get(W + 'val') in style_ids:
                    child.set(W + 'val', style_ids[child.get(W + 'val')])
            position = next((i for i, child in enumerate(numbering) if child.tag == W + 'num'), len(numbering))
            numbering.insert(position, deepcopy(node))
        for node in original.findall(W + 'num'):
            old = node.get(W + 'numId')
            num_ids[old] = str(next_num); next_num += 1
            node.set(W + 'numId', num_ids[old])
            reference = node.find(W + 'abstractNumId')
            if reference is not None:
                _require(reference.get(W + 'val') in abstract_ids, 'NUMBERING_REFERENCE_INVALID')
                reference.set(W + 'val', abstract_ids[reference.get(W + 'val')])
            numbering.append(deepcopy(node))
        files['word/numbering.xml'] = _serialize(numbering)

    def remap(tree):
        for node in tree.iter():
            if node.tag in [W + 'pStyle', W + 'rStyle', W + 'tblStyle', W + 'basedOn', W + 'next', W + 'link'] and node.get(W + 'val') in style_ids:
                node.set(W + 'val', style_ids[node.get(W + 'val')])
            if node.tag == W + 'numId' and node.get(W + 'val') in num_ids:
                node.set(W + 'val', num_ids[node.get(W + 'val')])
    if source_styles is not None:
        for style in source_styles.findall(W + 'style'):
            style.set(W + 'styleId', style_ids[style.get(W + 'styleId')])
            style.attrib.pop(W + 'default', None)
            remap(style)
            if style.get(W + 'type') == 'paragraph' and style.find(W + 'basedOn') is None:
                style.insert(0, E.Element(W + 'basedOn', {W + 'val': base_id}))
            styles.append(deepcopy(style))
        files['word/styles.xml'] = _serialize(styles)
    for name, data in source_files.items():
        if not PART.fullmatch(name):
            continue
        tree = E.fromstring(data)
        remap(tree)
        if paragraph_style:
            for paragraph in tree.iter(W + 'p'):
                props = paragraph.find(W + 'pPr')
                if props is None:
                    props = E.Element(W + 'pPr'); paragraph.insert(0, props)
                if props.find(W + 'pStyle') is None:
                    props.insert(0, E.Element(W + 'pStyle', {W + 'val': paragraph_style}))
        source_files[name] = _serialize(tree)
    return source_files


def _isolated_first_section(document):
    """A missing header in a new recipient must not inherit the prior name."""
    document = dict(document)
    root = E.fromstring(document['word/document.xml'])
    section = next(root.iter(W + 'sectPr'), None)
    _require(section is not None, 'BATCH_SECTION_REQUIRED')
    rels = E.fromstring(document['word/_rels/document.xml.rels'])
    types = E.fromstring(document['[Content_Types].xml'])
    for kind, tag in [('header', 'hdr'), ('footer', 'ftr')]:
        existing = {node.get(W + 'type') for node in section.findall(W + kind + 'Reference')}
        missing = {'default', 'first', 'even'} - existing
        if not missing:
            continue
        suffix = 0
        while True:
            part, rid = f'word/{kind}ArchiveBlank{suffix}.xml', 'rIdArchiveBlank' + kind.title() + str(suffix)
            if part not in document and not any(rel.get('Id') == rid for rel in rels):
                break
            suffix += 1
        tree = E.Element(W + tag, nsmap={'w': W[1:-1]})
        E.SubElement(tree, W + 'p')
        document[part] = _serialize(tree)
        E.SubElement(rels, PKG + 'Relationship', Id=rid, Type=R[1:-1] + '/' + kind, Target=part.removeprefix('word/'))
        E.SubElement(types, CT + 'Override', PartName='/' + part, ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + '+xml')
        for value in sorted(missing):
            section.insert(0, E.Element(W + kind + 'Reference', {W + 'type': value, R + 'id': rid}))
    # CT_SectPr requires header references before footer references. Writer can
    # otherwise omit a real first-page header or apply the next section's page
    # style, even though every relationship still resolves to the right part.
    references = [node for node in section if node.tag in [W + 'headerReference', W + 'footerReference']]
    for node in references:
        section.remove(node)
    references.sort(key=lambda node: node.tag == W + 'footerReference')
    for position, node in enumerate(references):
        section.insert(position, node)
    document['word/document.xml'] = _serialize(root)
    document['word/_rels/document.xml.rels'] = _serialize(rels)
    document['[Content_Types].xml'] = _serialize(types)
    return document


def combine_archive_parts(documents):
    """Keep each source section, with independent filled headers and media."""
    _require(isinstance(documents, list) and documents, 'BATCH_EMPTY')
    # Isolate the first source too. A later source's explicit empty footer must
    # not be the only footer found when applying a preview/sample mark: all
    # first/default/even page roles of every source need their own story.
    files = _isolated_first_section(documents[0]) if len(documents) > 1 else dict(documents[0])
    root = E.fromstring(files['word/document.xml'])
    body = root.find(W + 'body')
    rels = E.fromstring(files['word/_rels/document.xml.rels'])
    content_types = E.fromstring(files['[Content_Types].xml'])
    serial = 0
    for document in documents[1:]:
        serial += 1
        while any(name.startswith(f'word/archive-{serial}/') for name in files):
            serial += 1
        index = serial
        document = _merge_formatting(files, _isolated_first_section(document), index)
        source = E.fromstring(document['word/document.xml'])
        other = source.find(W + 'body')
        _unique_ids(source, index)
        source_rels = E.fromstring(document['word/_rels/document.xml.rels'])
        remap = {}
        copied = set()
        for rel in source_rels:
            if not rel.get('Type', '').rsplit('/', 1)[-1] in ['image', 'header', 'footer']:
                continue
            target = rel.get('Target', '')
            original = target.lstrip('/') if target.startswith('/') else normpath('word/' + target)
            _require(original.startswith('word/') and original in document, 'BATCH_RELATIONSHIP_INVALID')
            new_part = f'word/archive-{index}/' + original.removeprefix('word/')
            new_id = f'rIdArchive{index}_{rel.get("Id")}'
            _require(not any(existing.get('Id') == new_id for existing in rels), 'BATCH_RELATIONSHIP_COLLISION')
            remap[rel.get('Id')] = new_id
            copied.add(original)
            copy = deepcopy(rel)
            copy.set('Id', new_id)
            copy.set('Target', new_part.removeprefix('word/'))
            rels.append(copy)
        # Header/footer relationships use their original relative media targets.
        for name in document:
            if MEDIA.fullmatch(name) or re.fullmatch(r'word/(?:archive-[0-9]+/)*_rels/(?:header|footer)[^/]*\.xml\.rels', name):
                copied.add(name)
        for name in copied:
            content = document[name]
            if name.endswith('.rels'):
                relationships = E.fromstring(content)
                owner = name.replace('/_rels/', '/').removesuffix('.rels')
                for relation in relationships:
                    target = relation.get('Target', '')
                    target_part = target.lstrip('/') if target.startswith('/') else normpath(dirname(owner) + '/' + target)
                    _require(relation.get('TargetMode') != 'External' and target_part in copied, 'BATCH_PART_RELATIONSHIP_INVALID')
                    # Preserve relative targets even if the original used an absolute OPC URI.
                    relation.set('Target', relpath(target_part, dirname(owner)))
                content = _serialize(relationships)
            files[f'word/archive-{index}/' + name.removeprefix('word/')] = content
        for override in E.fromstring(document['[Content_Types].xml']):
            if override.tag == CT + 'Default':
                existing = next((entry for entry in content_types if entry.get('Extension') == override.get('Extension')), None)
                _require(existing is None or existing.get('ContentType') == override.get('ContentType'), 'BATCH_CONTENT_TYPE_CONFLICT')
                if existing is None:
                    content_types.insert(0, deepcopy(override))
            part = override.get('PartName', '').lstrip('/')
            if part in copied:
                copy = deepcopy(override)
                copy.set('PartName', f'/word/archive-{index}/' + part.removeprefix('word/'))
                content_types.append(copy)
        for node in source.iter():
            for attr in [R + 'id', R + 'embed', R + 'link']:
                if node.get(attr) in remap:
                    node.set(attr, remap[node.get(attr)])
        section = body.find(W + 'sectPr')
        _require(section is not None, 'BATCH_SECTION_REQUIRED')
        body.remove(section)
        kind = section.find(W + 'type')
        if kind is None:
            kind = E.Element(W + 'type')
            position = next((i for i, child in enumerate(section) if child.tag not in
                            [W + 'headerReference', W + 'footerReference', W + 'footnotePr', W + 'endnotePr']), len(section))
            section.insert(position, kind)
        kind.set(W + 'val', 'nextPage')
        boundary = E.SubElement(body, W + 'p')
        E.SubElement(boundary, W + 'pPr').append(section)
        for child in other:
            body.append(deepcopy(child))
    files['word/document.xml'] = _serialize(root)
    for part, kind in [('word/styles.xml', 'styles'), ('word/numbering.xml', 'numbering')]:
        if part in files:
            if not any(rel.get('Type', '').endswith('/' + kind) for rel in rels):
                E.SubElement(rels, PKG + 'Relationship', Id='rIdArchive' + kind.title(), Type=R[1:-1] + '/' + kind, Target=part.removeprefix('word/'))
            if not any(entry.get('PartName') == '/' + part for entry in content_types):
                E.SubElement(content_types, CT + 'Override', PartName='/' + part, ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + '+xml')
    files['word/_rels/document.xml.rels'] = _serialize(rels)
    files['[Content_Types].xml'] = _serialize(content_types)
    return files


def render_archive_document(snapshot, output, path):
    from english_appendix import validate_english, append_english_pages
    from package_xml import normalize_package
    from source_fidelity import add_floating_mark
    validate_english(snapshot)
    _require(1 <= len(snapshot['items']) <= MAX_REQUEST_ROWS, 'ROW_LIMIT')
    if snapshot.get('groupEvent'):
        files = render_archive_group(snapshot, path)
    else:
        documents = [render_archive_one(snapshot, item, path) for item in snapshot['items']]
        files = documents[0] if len(documents) == 1 else combine_archive_parts(documents)
    if snapshot.get('demoMode') or snapshot.get('mode') == 'draft-preview':
        files = _isolated_first_section(files)
        add_floating_mark(files, 'ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ' if snapshot.get('demoMode')
                          else 'ПРЕДПРОСМОТР — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ ДОКУМЕНТОМ')
    if snapshot.get('englishAppendix'):
        files = append_english_pages(files, snapshot)
    deterministic_zip(output, normalize_package(files))

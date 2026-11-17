"""Semantic text slots of the four pinned SOL card originals.

Only actual values are replaced. Word's runs, inter-field spacing, rectangles,
tabs, signature lines, margins, alternate stories and repeat panels stay put.
"""
from collections import Counter
from copy import deepcopy
import re

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SOURCE = {
    'biot-worker-card': ('Б и ОТ/1 Б и ОТ - шаблон sol.docx', 'd32a773cafc9120e856a15301da9d0389e1525656a1dd0d3c302e9338227ead1'),
    'ps-card': ('Профессии/1 Профессии - шаблон sol.docx', '08c7183a4afe21ccb388f4b45e218d99d719902fd3b1daffaa8388fd57bede70'),
}
# Count includes only printed strip stories, not ordinary issuer fields.
STRIP_COUNTS = {'biot-worker-card': 24, 'ps-card': 36, 'pb-card': 32, 'ptm-card': 8}
ISSUER_STAMP = re.compile(r'ТОО\s+QNP\s+Solutions', re.I)


def card_blueprint(template_id, legacy_blueprint):
    plan = deepcopy(legacy_blueprint)
    if template_id not in STRIP_COUNTS or plan['id'] != template_id:
        raise ValueError('ORIGINAL_CARD_NOT_SUPPORTED')
    if template_id in SOURCE:
        plan['source'], plan['sourceSha256'] = SOURCE[template_id]
        # These old paths and the PS photo rectangle belong to a different
        # DOCX. SOL explicitly has no photo holder or source portrait here.
        for key in ('textSlots', 'paragraphSlots', 'photoShapes', 'appendSources'):
            plan.pop(key, None)
        plan['media'] = []
    if template_id == 'biot-worker-card':
        plan['mergeFields'] = {k: v for k, v in plan['mergeFields'].items()
                               if k not in ('Выдано_ФИО', 'Берілді_ТАƏ')}
        plan['mergeFields'].update({'ФИО': 'FULL_NAME_RU', 'Берілді': 'FULL_NAME_KZ', 'Номер_серии': 'SERIES'})
    return plan


def _runs(paragraph):
    return [node for node in paragraph.iter(W + 't')
            if next(node.iterancestors(W + 'p'), None) is paragraph]


def _text(nodes):
    return ''.join(node.text or '' for node in nodes)


def _replace(nodes, pattern, replacement, group=0):
    """Replace an anchored text span across split runs, excluding nested boxes."""
    source = _text(nodes)
    matches = list(re.finditer(pattern, source))
    spans, cursor = [], 0
    for node in nodes:
        end = cursor + len(node.text or '')
        spans.append((node, cursor, end))
        cursor = end
    for match in reversed(matches):
        left, right = match.span(group)
        for node, start, end in spans:
            if start >= right or end <= left or start == end:
                continue
            old = node.text or ''
            node.text = (old[:max(0, left-start)] + (replacement if start <= left < end else '')
                         + old[min(end, right)-start:])
    return len(matches)


def _one(nodes, pattern, replacement, group=0):
    if _replace(nodes, pattern, replacement, group) != 1:
        raise ValueError('ORIGINAL_CARD_SLOT_MISMATCH')


def _static_text(nodes, replacement):
    # Leave original padding before/after the literal, including any runs of a
    # different size/color. The value inherits the first content run, not padding.
    _one(nodes, r'^\s*(\S(?:[\s\S]*?\S)?)\s*$', replacement, 1)


def original_card_fields(template_id, fields, item):
    result = dict(fields)
    passed = ((item['assignment'].get('outcome') or {}).get('status') == 'PASSED')
    if template_id in ('biot-worker-card', 'ptm-card'):
        # The source has separate styled runs for the statement and the subject.
        # Preserve them, but never hard-code a positive result on a preview.
        ru = fields['SUBJECT_RU']
        ru_sentence = fields['EXAM_STATEMENT_RU']
        # The original BIOT puts an abbreviated bilingual acronym after the
        # Russian label. Full course names need their respective language rows.
        suffix = fields['SUBJECT_BOTH'] if passed and template_id == 'biot-worker-card' else ru
        split = bool(suffix and ru_sentence.endswith(suffix))
        result['SOURCE_EXAM_LEAD_RU'] = (ru_sentence[:-len(suffix)] if split else ru_sentence).rstrip()
        result['SOURCE_EXAM_SUBJECT_RU'] = ru if split else ''
        if template_id == 'biot-worker-card':
            result['SOURCE_EXAM_LEAD_KZ'] = ((fields['SUBJECT_KZ']+' бойынша емтихан тапсырғаны туралы берілді.').strip()
                                             if passed and fields['SUBJECT_KZ'] else fields['EXAM_STATEMENT_KZ'])
        else:
            # For nonpassing results the complete factual sentence already
            # contains the subject; do not append the source's positive suffix.
            result.update(SOURCE_EXAM_LEAD_KZ='Ол' if passed else fields['EXAM_STATEMENT_KZ'],
                          SOURCE_EXAM_SUBJECT_KZ=fields['SUBJECT_KZ'] if passed else '',
                          SOURCE_EXAM_TAIL_KZ='біліміне емтихан тапсырды' if passed else '')
    if template_id == 'ps-card':
        result.update(SOURCE_STUDIES_RU=(
            'В процессе обучения изучены дисциплины и сданы экзамены по следующим дисциплинам'
            if passed else 'Результаты проверки знаний по дисциплинам'),
                      SOURCE_STUDIES_KZ=(
            'Оқыту процісінде пәндер зерделенді және келесі пәндер бойынша емтихандар тапсырылды'
            if passed else 'Пәндер бойынша білімді тексеру нәтижелері'))
    return result


def apply_original_card_slots(template_id, trees, blueprint):
    if template_id not in STRIP_COUNTS or blueprint['id'] != template_id:
        raise ValueError('ORIGINAL_CARD_NOT_SUPPORTED')
    counts = Counter()
    for tree in trees.values():
        for p in tree.iter(W + 'p'):
            nodes = _runs(p)
            text = _text(nodes)
            words = ' '.join(text.split())
            if not words:
                continue
            # These bands are repetitions of the issuer in a single language.
            # The old blueprints collapsed them into one bilingual string.
            if ISSUER_STAMP.search(text):
                if ISSUER_STAMP.sub('', text).strip():
                    raise ValueError('ORIGINAL_CARD_UNEXPECTED_ISSUER_STRIP')
                counts['stamp'] += _replace(nodes, ISSUER_STAMP, '{{ISSUER_RU}}')
            elif template_id == 'biot-worker-card':
                if words.startswith('комиссии ') or (words.startswith('Член комиссии ')
                                                      and not words.startswith('Член комиссии М.О')):
                    chair = words.startswith('комиссии ')
                    _one(nodes, r'комиссии\s+(\S(?:.*?\S)?)\s*$', '{{CHAIR_NAME}}' if chair
                         else '{{MEMBER_1_NAME}}', 1)
                    counts['chair' if chair else 'member'] += 1
                elif words.startswith('В том, что') and '{{SUBJECT_BOTH}}' in text:
                    _one(nodes, r'В том, что он сдал экзамены на знание', '{{SOURCE_EXAM_LEAD_RU}}')
                    _one(nodes, re.escape('{{SUBJECT_BOTH}}'), '{{SOURCE_EXAM_SUBJECT_RU}}')
                    counts['ru'] += 1
                elif words.startswith('Бойынша емтихан тапсырғаны') and words.endswith('.'):
                    _static_text(nodes, '{{SOURCE_EXAM_LEAD_KZ}}')
                    counts['kz'] += 1
            elif template_id == 'ps-card':
                if words.startswith('в том, что ему присвоена квалификация'):
                    _static_text(nodes, '{{QUALIFICATION_STATUS_RU}}')
                elif words == 'біліктілік берілгендігі туралы':
                    _static_text(nodes, '{{QUALIFICATION_STATUS_KZ}}')
                elif words.startswith('В процессе обучения изучены'):
                    _static_text(nodes, '{{SOURCE_STUDIES_RU}}')
                elif words.startswith('Оқыту процісінде пәндер'):
                    _static_text(nodes, '{{SOURCE_STUDIES_KZ}}')
            elif template_id == 'pb-card':
                if words.startswith('ТОО «QNP') and 'Solutions' in words:
                    _static_text(nodes, '{{ISSUER_BOTH}}' if words.endswith('ЖШС') else '{{ISSUER_RU}}')
                    counts['issuer'] += 1
                elif re.fullmatch(r'[^\W\d_]+\s+[А-ЯӘІӨҰҮҚҒҢҺ]\.\s*[А-ЯӘІӨҰҮҚҒҢҺ]\.', words):
                    _static_text(nodes, '{{CHAIR_NAME}}')
                    counts['chair'] += 1
                elif words.startswith('{{DOCUMENT_YEAR}}') and '{{DOCUMENT_DAY}}' in text:
                    for unit in ['YEAR', 'DAY', 'MONTH']:
                        _one(nodes, re.escape('{{DOCUMENT_'+unit+'}}'), '{{PROTOCOL_'+unit+'}}')
                    counts['protocolDates'] += 1
            elif template_id == 'ptm-card':
                if words.startswith('«QNP') and '/ ТОО «QNP' in words:
                    _one(nodes, r'«QNP\s+Solutions»\s+ЖШС', '{{ISSUER_KZ}}')
                    _one(nodes, r'ТОО\s+«QNP-\s*Solutions»', '{{ISSUER_RU}}')
                    counts['issuer'] += 1
                elif words.startswith('Оқу орталығының басшысы') and '_' in text:
                    _one(nodes, r'_(?!_)(\S.*?\S)\s*$', '{{HEAD_NAME}}', 1)
                    counts['head'] += 1
                elif words.startswith('Действительно до') and '{{VALID_DAY_MONTH}}' in text:
                    _one(nodes, re.escape('{{PROTOCOL_DAY_MONTH}}'), '')
                elif words.startswith('{{VALID_YEAR}}') and 'дейін жарамды' in words:
                    _one(nodes, re.escape('{{PROTOCOL_DAY_MONTH}}'), '{{VALID_DAY_MONTH}}')
                elif words.startswith('В том, что') and '{{SUBJECT_RU}}' in text:
                    _one(nodes, r'В том, что он \(она\) сдал \(сдала\) экзамены на знание', '{{SOURCE_EXAM_LEAD_RU}}')
                    _one(nodes, re.escape('{{SUBJECT_RU}}'), '{{SOURCE_EXAM_SUBJECT_RU}}')
                    counts['ru'] += 1
                elif words.startswith('Ол ') and '{{SUBJECT_KZ}}' in text:
                    _one(nodes, 'Ол', '{{SOURCE_EXAM_LEAD_KZ}}')
                    _one(nodes, re.escape('{{SUBJECT_KZ}}'), '{{SOURCE_EXAM_SUBJECT_KZ}}')
                    _one(nodes, 'біліміне емтихан тапсырды', '{{SOURCE_EXAM_TAIL_KZ}}')
                    counts['kz'] += 1
    expected = {
        'biot-worker-card': {'chair': 4, 'member': 4, 'ru': 4, 'kz': 4},
        'ps-card': {},
        'ptm-card': {'issuer': 2, 'head': 2, 'ru': 2, 'kz': 2},
        'pb-card': {'issuer': 14, 'chair': 2, 'protocolDates': 2},
    }[template_id]
    if counts != Counter(stamp=STRIP_COUNTS[template_id], **expected):
        raise ValueError('ORIGINAL_CARD_SLOT_COVERAGE:'+str(dict(counts)))

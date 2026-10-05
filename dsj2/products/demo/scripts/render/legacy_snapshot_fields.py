"""Frozen DEMO values for the unmodified 90d5b5e Word filling mechanics.

Field names, literal matching and photo slots come from
dsj2/apps/api/src/biot-cards/biot-cards.service.ts at 90d5b5e. This module
does not edit a template, calculate training dates or fit document typography.
"""
from datetime import date
import re


RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
             'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
KZ_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым',
             'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан']


def text(value):
    return str(value).strip() if value is not None else ''


def factual_assessment_text(value, origin=None):
    if origin in ['COURSE', 'AUTO']:
        return ''
    value = text(value)
    literal = re.sub(r'\s+', '', value).lower()
    placeholders = ['', 'хорошо', 'жақсы', 'жаксы', 'сдал', 'тапсырды', 'прошел', 'прошёл', 'өтті',
                    'сдал/тапсырды', 'тапсырды/сдал', 'прошел/өтті', 'өтті/прошел',
                    'несдал', 'тапсырмады', 'неявился', 'келмеді', 'неподтверждено', 'расталмаған',
                    'несдал/тапсырмады', 'неявился/келмеді', 'неподтверждено/расталмаған']
    return '' if all(part in placeholders for part in literal.split('/')) else value


def frozen_date(value, field):
    try:
        return date.fromisoformat(text(value))
    except ValueError as error:
        raise ValueError('LEGACY_REFERENCE_DATE_REQUIRED:' + field) from error


def date_fields(value):
    return {'year': str(value.year), 'yearShort': str(value.year)[-2:],
            'day': str(value.day), 'dayPadded': f'{value.day:02d}',
            'month': f'{value.month:02d}', 'dayMonth': value.strftime('%d.%m'),
            'display': value.strftime('%d.%m.%Y'),
            'monthRu': RU_MONTHS[value.month - 1], 'monthKz': KZ_MONTHS[value.month - 1],
            'ruProtocol': f'«{value.day:02d}» {RU_MONTHS[value.month - 1]} {value.year} г.',
            'kzProtocol': f'«{value.day:02d}» {KZ_MONTHS[value.month - 1]} {value.year} ж.',
            'ruCertificate': f'{value.day} {RU_MONTHS[value.month - 1]} {value.year} г.'}


def training_date_fields(value, field):
    """An omitted optional training date leaves its slots blank, without a fallback.

    The draft contract allows a missing or partial period. A supplied invalid
    date still fails, and neither issue nor commission dates complete the period.
    """
    if not text(value):
        return {key: '' for key in ['year', 'yearShort', 'day', 'monthRu', 'monthKz']}
    return date_fields(frozen_date(value, field))


def bilingual_parts(value, ru=None, kz=None):
    """Use explicit data, never substitute the legacy hard-coded passing grade."""
    pieces = text(value).split('/', 1)
    return text(ru) or pieces[0].strip(), text(kz) or pieces[-1].strip()


def photo_slot(template_id):
    # Exact CARD_PHOTO_CONFIG, service lines 172-203 (values are Word points).
    specs = {'ptm-card': ('PTM', '215.4', '123.75', '51', '67.5', '251689984'),
             'pb-card': ('PB', '-2.1', '121.5', '59.8', '79.65', '251709952'),
             'ps-card': ('PS', '8', '108', '56', '74', '251709952')}
    if template_id not in specs:
        return None
    kind, left, top, width, height, zindex = specs[template_id]
    return {'mode': 'floating_rect', 'shapeId': 'DSJPhotoSlot' + kind,
            'style': f'position:absolute;margin-left:{left}pt;margin-top:{top}pt;width:{width}pt;height:{height}pt;z-index:{zindex};visibility:visible;mso-wrap-style:square;mso-width-percent:0;mso-height-percent:0;mso-wrap-distance-left:9pt;mso-wrap-distance-top:0;mso-wrap-distance-right:9pt;mso-wrap-distance-bottom:0;mso-position-horizontal:absolute;mso-position-horizontal-relative:text;mso-position-vertical:absolute;mso-position-vertical-relative:page;mso-width-relative:page;mso-height-relative:page;v-text-anchor:top'}


def company_label(ru, kz):
    # combineCompanyRuKzLabel, service lines 879-910.
    if ru and kz:
        if re.match(r'^(ТОО|ИП|АО)\s+(.+?)\s+(ЖШС|ЖК|АҚ)$', ru):
            return ru
        russian = re.match(r'^(ТОО|ИП|АО)\s+(.+)$', ru)
        kazakh = re.match(r'^(.+?)\s+(ЖШС|ЖК|АҚ)$', kz)
        if russian and kazakh:
            a, b = russian[2].strip(), kazakh[1].strip()
            return russian[1] + ' ' + (a if len(a) >= len(b) else b) + ' ' + kazakh[2]
    return ru or kz


def source_literals(snapshot, assignment, item):
    """Existing source data slots, applied before fields so values are not re-edited."""
    issuer = snapshot.get('issuer', {})
    commission = issuer.get('commission', [])
    # The same sample person is the chair in most forms, but the explicitly
    # labelled head/director in these two source forms.
    member = lambda index: (text(issuer.get('headName')) if index == 0 and snapshot['templateId'] in ['ptm-card', 'ps-witness']
                            else text(commission[index].get('name')) if len(commission) > index else '')
    result_ru, result_kz = bilingual_parts(assignment.get('result'), assignment.get('resultRu'), assignment.get('resultKz'))
    pairs = [(source, member(index)) for index, names in enumerate([
        ['Солтанова Н.Н.', 'Солтанова Н. Н.', 'Cолтанова Н.Н.'],
        ['Флеглер А.Т.', 'Флеглер А.С.', 'Жакибеков А.Т.'],
        ['Баянов Ф.', 'Есен Д.А.']]) for source in names]
    pairs.extend((source, result_ru) for source in ['Хорошо', 'хорошо'])
    pairs.extend((source, result_kz) for source in ['Жаксы', 'жаксы', 'Жақсы', 'жақсы'])
    pairs.extend([(source, text(assignment.get('result'))) for source in ['Прошел/Өтті', 'Прошел/ Өтті', 'Өтті/прошел', 'Тапсырды/сдал']])
    pairs.extend([('периодическая/мерзімді', text(assignment.get('reason'))),
                  ('периодическая /мерзімді', text(assignment.get('reason'))),
                  ('Жоғары/высшее', text(assignment.get('education')))])
    hours = text(assignment.get('hours'))
    pairs.extend([('10-часовой', hours + '-часовой' if hours else ''),
                  ('10 сағаттық', hours + ' сағаттық' if hours else '')])
    # Only text fields are mapped here. Original artwork is the adapter's policy.
    issuer_ru = text(issuer.get('nameRu'))
    issuer_kz = text(issuer.get('nameKz')) or issuer_ru
    pairs.extend([('ТОО «Аттестационный центр Стандарт» ЖШС', issuer_ru),
                  ('ТОО «Аттестационный центр Стандарт»', issuer_ru),
                  ('«Аттестационный центр Стандарт» ЖШС', issuer_kz),
                  ('ТОО Аттестационный центр Стандарт', issuer_ru),
                  ('Аттестационный центр Стандарт ЖШС', issuer_kz),
                  ('Республика Казахстан, 100012, г. Астана ул. Анет баба д. 9/3 кв. (офис) 83', text(issuer.get('addressRu'))),
                  ('БИН: 160440010815', 'БИН: ' + text(issuer.get('bin'))),
                  ('Кала/город: Астана', 'Кала/город: ' + text(issuer.get('cityRu')))])
    if snapshot['templateId'] == 'ps-card':
        workplace = text(item.get('workplaceRu')) or text(item.get('workplaceKz'))
        pairs.extend([('ТОО QNP Solutions', workplace), ('ТОО QNP  Solutions', workplace),
                      ('ТОО Аттестац', issuer_ru)])
    if snapshot['templateId'] == 'biot-itr-certificate' and 'trainingSubjectKz' in assignment:
        # New snapshots carry the selected course program explicitly. The
        # source form has literal course-name slots rather than merge fields.
        pairs.extend([('Безопасность и охрана труда', text(assignment.get('trainingSubject'))),
                      ('Еңбек қауіпсіздігі және еңбекті қорғау', text(assignment.get('trainingSubjectKz')) or text(assignment.get('trainingSubject')))])
    if snapshot['templateId'] == 'ps-witness':
        pairs.extend([('Астана қаласы', text(issuer.get('cityKz')) + ' қаласы'),
                      ('город Астана', 'город ' + text(issuer.get('cityRu')))])
    basis = text(issuer.get('approvalBasis'))
    if snapshot['templateId'] in ['biot-protocol', 'biot-itr-protocol']:
        pairs.extend([('приказа от «09 февраля 2026 г. № 02-П', basis),
                      ('2026 ж. «09» ақпан № 02-П бұйрықтың', basis),
                      ('анықтады: мерзімді', 'анықтады: ' + text(assignment.get('reason'))),
                      ('установила:          периодический,', 'установила:          ' + text(assignment.get('reason')) + ',')])
    elif snapshot['templateId'] == 'ps-protocol':
        pairs.append(('приказа № 04-П «09» февраля 2026 г.', basis))
    elif snapshot['templateId'] == 'ptm-protocol':
        # This is the source's internal commission order, not a statute. The
        # saved basis is free text: never infer an order date/number from it.
        pairs.extend([('приказом «О создании квалификационной комиссии по вопросам проверки знаний по пожарной безопасности в объеме\u00a0пожарно-технического минимума»', basis),
                      ('от «09» февраля 2026 г. № 03-П ', ''),
                      ('«09» ақпан 2026 ж. «Өрт-техникалық минимум көлемінде өрт қауіпсіздігі бойынша білімді тексеру мәселелері бойынша Біліктілік комиссиясын құру туралы»', basis),
                      ('№ 03-П бұйрығына (өкіміне) ', '')])
    return [{'matchText': old, 'replaceText': new} for old, new in pairs if old != new]


def protocol_replacements(tid, dates, workplace, workplace_kz):
    """Legacy service 923-1055; date/company values are already frozen."""
    if tid.startswith('biot-'):
        spacer = ' ' * 111
        return [{'matchText': '«18» қараша 2025 ж.' + spacer + '«18» ноября 2025 г.',
                 'replaceText': dates['kzProtocol'] + spacer + dates['ruProtocol']}]
    if tid == 'ptm-protocol':
        company = (workplace + ' ' + workplace_kz.split()[-1]).strip() if workplace and workplace_kz else workplace or workplace_kz
        return [
            {'matchText': 'ТОО «Аттестационный центр Стандарт» ЖШС', 'replaceText': company},
            {'matchText': '«19» ноября 2025 г. приняла экзамен по пожарной безопасности в объеме пожарно-технического минимума и установила следующие результаты/ «19» қараша 2025 ж. өрт қауіпсіздігі көлемінде өрт-техникалық минимум  білімін  тексеруді өткізді және келесі нәтижені орнатты:',
             'replaceText': dates['ruProtocol'] + ' приняла экзамен по пожарной безопасности в объеме пожарно-технического минимума и установила следующие результаты/ ' + dates['kzProtocol'] + ' өрт қауіпсіздігі көлемінде өрт-техникалық минимум  білімін  тексеруді өткізді және келесі нәтижені орнатты:'}]
    if tid == 'pb-protocol':
        return [{'matchText': '«13» қараша 2025 г. «13» ноября 2025 г.',
                 'replaceText': dates['kzProtocol'] + '\t' + dates['ruProtocol'],
                 'mode': 'paragraph', 'rightTabStopPt': 474.75}]
    return []


def build_legacy_payload(snapshot, item):
    tid = snapshot['templateId']
    assignment = item['assignment']
    outcome = assignment.get('outcome') or {}
    status = outcome.get('status')
    nonpassed = {'FAILED': ('Не сдал', 'Тапсырмады'),
                 'ABSENT': ('Не явился', 'Келмеді'),
                 'UNKNOWN': ('Не подтверждено', 'Расталмаған')}
    if status in nonpassed:
        # The saved status remains authoritative even if an old/manual
        # positive result phrase survived an import. Work on a copy only.
        ru, kz = nonpassed[status]
        origins = assignment.get('fieldOrigins') or {}
        actual = factual_assessment_text(assignment.get('result'), origins.get('result'))
        actual_kz = factual_assessment_text(assignment.get('resultKz'), origins.get('resultKz'))
        # A numeric score such as 30/100 is one assessment value, not two
        # language spellings separated by a slash.
        if actual and not actual_kz and re.fullmatch(r'[\d\s/.,%+-]+', actual):
            actual_kz = actual
        if actual:
            ru += '; ' + actual
        if actual_kz:
            kz += '; ' + actual_kz
        assignment = {**assignment, 'result': ru + '/' + kz, 'resultRu': ru, 'resultKz': kz}
    issue = date_fields(frozen_date(assignment.get('documentDate'), 'documentDate'))
    protocol = date_fields(frozen_date(assignment.get('protocolDate', assignment.get('documentDate')), 'protocolDate'))
    name = text(item.get('fullNameRu'))
    name_kz = text(item.get('fullNameKz')) or name
    issued_to = text(item.get('issuedTo')) or name_kz
    position = text(item.get('positionRu')) or text(item.get('positionKz'))
    position_kz = text(item.get('positionKz')) or position
    if tid.startswith('ps-'):
        profession_ru = text(assignment.get('professionRu')) or text(assignment.get('professionKz')) or position
        profession_kz = text(assignment.get('professionKz')) or text(assignment.get('professionRu')) or position_kz
        if tid in ['ps-witness', 'ps-protocol']:
            position = text(assignment.get('psQualificationRu')) or text(assignment.get('psQualificationKz')) or profession_ru
            position_kz = text(assignment.get('psQualificationKz')) or text(assignment.get('psQualificationRu')) or profession_kz
        else:
            position, position_kz = profession_ru, profession_kz
    workplace = text(item.get('workplaceRu')) or text(item.get('workplaceKz'))
    workplace_kz = text(item.get('workplaceKz')) or workplace
    number = text(item.get('number'))
    protocol_number = text(item.get('protocolNumber'))
    subject = text(assignment.get('trainingSubject'))
    fields = {}
    payload = {'fields': fields, 'textReplacements': [], 'fieldStyleOverrides': {},
               'photoSlot': photo_slot(tid), 'scopedFieldValues': [],
               'sourceLiteralValues': source_literals(snapshot, assignment, item)}
    if tid == 'biot-worker-card':
        # buildBiotMergeFields, service lines 1163-1220.
        fields.update({'Берілді': issued_to, 'В_том_что_он': subject,
                       'ГОД': issue['year'], 'День_месяц': issue['dayMonth'],
                       'Должность': position, 'Жұмыс__орны_': workplace_kz,
                       'Лауазымы': position_kz, 'Место_работы__': workplace,
                       'Номер_серии': text(item.get('seriesNumber')),
                       'Номер_удостоверения': number, 'Протокол_': protocol_number,
                       'ФИО': name})
        payload['scopedFieldValues'].append({'scope': 'kazakh-position', 'fields': {'Номер_серии': position_kz}})
    elif tid == 'biot-itr-certificate':
        # buildBiotItrCertificateFields/Replacements, service lines 1736-1763.
        fields['Full_Name'] = text(item.get('issuedTo')) or name
        payload['textReplacements'] = [
            {'matchText': '24 марта 2026\u202fг.', 'replaceText': issue['ruCertificate']},
            {'matchText': 'БТ-СРТ-00001', 'replaceText': number}]
    elif tid == 'ptm-card':
        expiry = date_fields(frozen_date(assignment.get('validUntil'), 'validUntil'))
        fields.update({'В_том_что': subject, 'Год': issue['year'],
                       'Действительно_Год': expiry['year'], 'Действительно_Мес': '',
                       'Должность': position, 'Емтихан_тапсырды': (text(assignment.get('trainingSubjectKz')) or subject) if 'trainingSubjectKz' in assignment else 'ӨТМ',
                       'Жұмыс_орны': workplace_kz, 'Лауазымы': position_kz,
                       'Месяц': issue['dayMonth'], 'Место_работы': workplace,
                       'Номер_удостоверения': number, 'Протокол_': protocol_number, 'ФИО': name})
        payload['scopedFieldValues'].append({'scope': 'expiry-date', 'fields': {
            'Год': expiry['year'], 'Месяц': expiry['dayMonth'], 'Действительно_Мес': ''}})
    elif tid == 'pb-card':
        expiry = date_fields(frozen_date(assignment.get('validUntil'), 'validUntil'))
        fields.update({'"Месяц"': issue['month'], 'Год': issue['year'],
                       'Действительно_Год': expiry['year'], 'День': issue['dayPadded'],
                       'Жұмыс_орны_лауазымы': workplace if workplace == workplace_kz else workplace + '/' + workplace_kz,
                       'Месяц': issue['month'], 'Номер_удостоверения': number,
                       'Прослушала_курс': subject, 'Протокол_': protocol_number, 'ФИО': name,
                       'должность': position if position == position_kz else position + '/' + position_kz})
        payload['scopedFieldValues'].append({'scope': 'expiry-date', 'fields': {
            'Год': expiry['year'], 'День': expiry['dayPadded'], 'Месяц': expiry['month'], '"Месяц"': expiry['month']}})
    elif tid == 'ps-card':
        subject_ru, subject_kz = bilingual_parts(subject, assignment.get('trainingSubjectRu'), assignment.get('trainingSubjectKz'))
        # Explicit two-discipline data is resolved before issuance. Missing
        # keys retain the old snapshot mapping so past frozen files never gain
        # a new course retrospectively.
        explicit_disciplines = any(key in assignment for key in ['psGeneralSubjectRu', 'psGeneralSubjectKz', 'psSpecialSubjectRu', 'psSpecialSubjectKz'])
        general_ru = text(assignment.get('psGeneralSubjectRu')) if explicit_disciplines else subject_ru
        general_kz = text(assignment.get('psGeneralSubjectKz')) if explicit_disciplines else subject_kz
        special_ru = text(assignment.get('psSpecialSubjectRu')) if explicit_disciplines else ''
        special_kz = text(assignment.get('psSpecialSubjectKz')) if explicit_disciplines else ''
        result_ru, result_kz = bilingual_parts(assignment.get('result'), assignment.get('resultRu'), assignment.get('resultKz'))
        fields.update({'M_1__пп': '1' if general_ru or general_kz else '', 'M_1_Наименование_дисциплины': general_ru,
                       'M_1_Пәндер_атауы_': general_kz, 'M_2__пп': '2' if special_ru or special_kz else '',
                       'M_2_Наименование_дисциплины': special_ru, 'M_2_Пәндер_атауы_': special_kz,
                       'Баға': result_kz, 'Біліктілік_берілгендігі_туралы': position_kz,
                       'Выдано_ФИО': text(item.get('issuedTo')) or name,
                       'ГОД': issue['year'], 'День_месяц': issue['dayMonth'], 'Номер_серии': '',
                       'Номер_удостоверения': number, 'Оценка': result_ru,
                       'Протокол_': protocol_number, 'в_том_что_ему_присвоена_квалификация_': position})
        # These are the existing legacy service overrides, not a new fitting pass.
        payload['fieldStyleOverrides'] = {
            **{field: {'fontSize': 22} for field in ['Выдано_ФИО', 'Біліктілік_берілгендігі_туралы', 'в_том_что_ему_присвоена_квалификация_']},
            **{field: {'fontSize': 16} for field in ['Протокол_', 'День_месяц', 'ГОД']},
            **{field: {'fontSize': 13} for field in ['M_1__пп', 'M_1_Пәндер_атауы_', 'M_1_Наименование_дисциплины', 'M_2__пп', 'M_2_Пәндер_атауы_', 'M_2_Наименование_дисциплины', 'Баға', 'Оценка']}}
    elif tid in ['biot-protocol', 'biot-itr-protocol']:
        fields.update({'"Должность_1"': '', 'Должность': position,
                       'Жұмыс__орны_': workplace_kz or workplace, 'Лауазымы': position_kz,
                       'Место_работы__': workplace or workplace_kz,
                       'Номер_удостоверения': text(assignment.get('biotNotes')), 'Примечание_1': '',
                       'Протокол_': protocol_number, 'ФИО': name, 'ФИО_1': ''})
    elif tid == 'ptm-protocol':
        workplace_with_prefix = workplace if re.match(r'^(ТОО|ИП|АО)\s+', workplace) else 'ТОО ' + workplace
        fields.update({'"Должность_РУС_1"': '', '"ФИО_1"': '', '"Организация_РУС_1"': '',
                       'Должность': position, 'Лауазымы': position_kz, 'Место_работы': workplace_with_prefix,
                       'Номер_Уд_1': '', 'Протокол_': protocol_number, 'ФИО': name})
    elif tid == 'pb-protocol':
        fields.update({'"Образование_РУС_1"': '', 'ДОЛЖНОСТЬ_РУС_1': '',
                       'Жұмыс_орны_лауазымы': company_label(workplace, workplace_kz),
                       'Протокол_': protocol_number, 'ФИО': name, 'ФИО_РУС_1': '',
                       'должность': position if position == position_kz else position + '/' + position_kz})
    elif tid == 'ps-protocol':
        fields.update({'"Номер_удостоверения"': text(item.get('credentialNumber')), '"Образование_РУС_1"': '',
                       'ГОД': protocol['year'], 'День_месяц': protocol['dayMonth'],
                       'Номер_Уд_1': '', 'Протокол_': protocol_number,
                       'Выдано_ФИО': text(item.get('issuedTo')) or name,
                       'ФИО_1': '', 'в_том_что_ему_присвоена_квалификация_': position})
    elif tid == 'ps-witness':
        start = training_date_fields(assignment.get('trainingStart'), 'trainingStart')
        end = training_date_fields(assignment.get('trainingEnd'), 'trainingEnd')
        issuer = snapshot.get('issuer', {})
        fields.update({'{{KB_NUMBER}}': 'КБ № ' + number,
                       '{{REGISTRATION_NUMBER}}': text(item.get('registrationNumber')),
                       '{{FULL_NAME_RU}}': name, '{{FULL_NAME_KZ}}': name_kz,
                       '{{PROFESSION_RU}}': position, '{{PROFESSION_KZ}}': position_kz,
                       '{{EDU_ORG_RU}}': text(issuer.get('nameRu')),
                       '{{EDU_ORG_KZ}}': text(issuer.get('nameKz')) or text(issuer.get('nameRu')),
                       '{{PROTOCOL_NUMBER_DISPLAY}}': protocol_number,
                       '{{ISSUE_DAY}}': issue['day'], '{{ISSUE_MONTH_RU}}': issue['monthRu'],
                       '{{ISSUE_MONTH_KZ}}': issue['monthKz'], '{{ISSUE_YEAR_SHORT}}': issue['yearShort']})
        for prefix, values in [('TRAINING_START', start), ('TRAINING_END', end)]:
            for suffix, key in [('DAY', 'day'), ('MONTH_RU', 'monthRu'), ('MONTH_KZ', 'monthKz'),
                                ('YEAR_SHORT', 'yearShort'), ('YEAR_FULL', 'year')]:
                fields['{{' + prefix + '_' + suffix + '}}'] = values[key]
        payload['scopedFieldValues'].append({'scope': 'witness-protocol-date', 'fields': {
            '{{ISSUE_DAY}}': protocol['day'], '{{ISSUE_MONTH_RU}}': protocol['monthRu'],
            '{{ISSUE_MONTH_KZ}}': protocol['monthKz'], '{{ISSUE_YEAR_SHORT}}': protocol['yearShort'],
            '{{TRAINING_END_YEAR_FULL}}': protocol['year']}})
    else:
        raise ValueError('LEGACY_REFERENCE_TEMPLATE_UNKNOWN:' + tid)
    if tid.endswith('-protocol'):
        payload['textReplacements'] = protocol_replacements(tid, protocol, workplace, workplace_kz)
        if tid == 'ptm-protocol':
            # The legacy protocol mapper owns this company literal. Do not
            # consume its match before the copied generator applies it.
            payload['sourceLiteralValues'] = [replacement for replacement in payload['sourceLiteralValues']
                                               if replacement['matchText'] != 'ТОО «Аттестационный центр Стандарт» ЖШС']
            for replacement in payload['sourceLiteralValues']:
                if replacement['matchText'] in ['ТОО «Аттестационный центр Стандарт»', '«Аттестационный центр Стандарт» ЖШС']:
                    # Match the header's standalone issuer slot, never consume
                    # the longer legacy employer literal before its fill pass.
                    replacement['mode'] = 'paragraph'
            payload['sourceLiteralValues'].extend({
                'matchText': 'ТОО «Аттестационный центр Стандарт» ЖШС',
                'replaceText': text(snapshot.get('issuer', {}).get('nameRu')),
                'paragraphContains': role,
            } for role in ['Директор', 'Начальник УМО', 'Преподаватель'])
    if tid.endswith('-card') and protocol != issue:
        # The adapter selects existing protocol-date fields by source context.
        # Applying these values must not touch paragraph/run formatting.
        payload['scopedFieldValues'].append({
            'scope': 'protocol-date',
            'fields': {'ГОД': protocol['year'], 'Год': protocol['year'],
                       'День_месяц': protocol['dayMonth'], 'День': protocol['dayPadded'],
                       'Месяц': protocol['dayMonth'] if tid == 'ptm-card' else protocol['month'],
                       '"Месяц"': protocol['month']}})
    return payload

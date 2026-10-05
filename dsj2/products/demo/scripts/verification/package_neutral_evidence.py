"""Package verified local neutral-form artifacts and their acceptance report."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import re
import shutil
import subprocess

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'docs/evidence/neutral-forms-20261005'
OUT = ROOT / '.runtime/neutral-forms-final-20261005'
OLD = ROOT / '.runtime/document-audit-20261005'
GROUP = ROOT / '.runtime/neutral-protocols'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def link(path, label):
    return '[' + label + '](<' + str(Path(path).resolve()).replace('\\', '/') + '>)'


def comparison_boards():
    records = []
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 22)
    cases = [('biot-itr-certificate-normal', 1), ('biot-worker-card-long', 1),
             ('pb-card-long', 1), ('ps-card-normal', 1),
             ('ps-witness-normal', 2), ('biot-protocol-group25', 2),
             ('pb-protocol-group25', 2)]
    folder = OUT / 'before-after'
    folder.mkdir(exist_ok=True)
    for name, page in cases:
        sources = [OLD / (name + '.word.pdf'), OUT / (name + '.word.pdf')]
        tiles = []
        for source in sources:
            pdf = pymupdf.open(source)
            pix = pdf[page - 1].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5))
            tiles.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
        width = max(t.width for t in tiles)
        height = max(t.height for t in tiles)
        board = Image.new('RGB', (width * 2 + 30, height + 90), '#dedede')
        draw = ImageDraw.Draw(board)
        for index, tile in enumerate(tiles):
            x = index * (width + 30)
            board.paste(tile, (x, 80))
            draw.text((x + 12, 8), ('ДО — исходный аудит' if index == 0 else 'ПОСЛЕ — новая версия'), font=font, fill='black')
            draw.text((x + 12, 39), name + ' / стр. ' + str(page), font=font, fill='black')
        destination = folder / (name + '.png')
        board.save(destination)
        before, after = [read(p / (name + '.snapshot.json')) for p in [OLD, OUT]]
        before.pop('templateVersion', None)
        after.pop('templateVersion', None)
        records.append({'case': name, 'page': page, 'image': str(destination),
                        'sourcePdfs': [str(p) for p in sources],
                        'sourceSha256': [sha(p) for p in sources],
                        'sameSnapshotExceptTemplateVersion': before == after,
                        'noteRu': 'Те же данные.' if before == after else
                        'Те же длинные ФИО/должность/работодатель; после исправления дополнительно удлинены номера и RU/KZ курс.'})
    save(EVIDENCE / 'before-after.json', records)
    return records


def main():
    inventory = read(EVIDENCE / 'case-inventory.json')
    manifest = read(ROOT / 'assets/templates/manifest.json')
    baseline = read(EVIDENCE / 'preservation-before.json')
    app_group = read(GROUP / 'final-pdf-readback.json')
    word_group = read(GROUP / 'final-word-pdf-readback.json')
    batch = read(GROUP / 'bookmark-batch/bookmark-batch-verification.json')
    assert batch['sourceSha256'] == sha(ROOT / 'scripts/render/neutral_forms.py')
    assert batch['word']['pages'] == batch['application']['pages'] == 2
    assert batch['application']['sameDocxAsWord'] and batch['application']['sourceUnchanged']
    assert batch['word']['allNamesExactlyOnce'] and batch['application']['allNamesExactlyOnce']
    assert batch['application']['wholeCommissionOnEachPage']
    assert batch['application']['visualReview']['status'] == 'PASS'
    save(EVIDENCE / 'batch-bookmarks-verification.json', batch)
    for path, digest in read(EVIDENCE / 'accepted-source-hashes.json').items():
        assert sha(ROOT / path) == digest, path
    assert len(inventory) == 30 and len(app_group) == len(word_group) == 30
    for row in inventory:
        assert row['currentSourceReproductionByteIdentical']
        assert sha(row['docx']) == row['docxSha256']
        for engine, suffix in [('application', '.pdf'), ('word', '.word.pdf')]:
            checks = row['pdfChecks'][engine]
            assert not checks['missingPrintedValues'] and not checks['outsidePage']
            assert sha(OUT / (row['case'] + suffix)) == checks['sha256']
    for row in app_group + word_group:
        for key in ['allFullNamesExactlyOnce', 'allNamesInOrder', 'allMemberResultsPreserved',
                    'allMemberResultsOnSamePageAsName', 'noOutsidePageWords', 'headersOnEveryMemberPage', 'allCommissionNamesInSignatureBlock']:
            assert row[key], (row['case'], key)
        assert row['lastPageMembers']
        assert row['signaturePages'] == [row['pages']]
        assert sha(row['docx']) == row['sha256Docx']
        assert sha(row['pdf']) == row['pdfSha256']
    log = (ROOT / '.runtime/neutral-render-acceptance.log').read_text(encoding='utf-8-sig')
    rendered = re.search(r'Ran (\d+) tests in ([\d.]+)s\s+OK\b', log)
    assert rendered, 'Final pnpm test:render has not passed'
    changed = [p for p, digest in baseline.items() if not (ROOT / p).is_file() or sha(ROOT / p) != digest]
    assert set(changed) <= {'assets/templates/manifest.json', 'scripts/render/renderer.py', 'docs/evidence/progress.md'}, changed
    preservation = {'status': 'PASS', 'baselineFiles': len(baseline),
                    'byteIdenticalFiles': len(baseline) - len(changed), 'changed': changed,
                    'oldTemplateFiles': sum(p.startswith('assets/templates/') and p != 'assets/templates/manifest.json' for p in baseline),
                    'originalAuditAndSavedArtifactFiles': sum(p.startswith(('.runtime/document-audit-20261005/', '.runtime/manual20-files-v1/')) for p in baseline),
                    'originalAuditAndSavedArtifactsUnchanged': True,
                    'preexistingUserFilesPreserved': True,
                    'registrationEvidence': 'registration-history-upgrade.json'}
    save(EVIDENCE / 'preservation-after.json', preservation)
    comparisons = comparison_boards()
    matrix = []
    for kind, records in [('individual', manifest['templates']), ('group', manifest['groupTemplates'])]:
        for template in records:
            cases = [c for c in inventory if c['templateId'] == template['id'] and c['kind'] == kind]
            matrix.append({'templateId': template['id'], 'kind': kind, 'version': template['version'],
                           'file': template['file'], 'templateSha256': sha(ROOT / 'assets/templates' / template['file']),
                           'status': 'PASS_LOCAL_WORD_AND_APPLICATION_PDF', 'cases': [c['case'] for c in cases],
                           'wordPages': sum(c['pdfChecks']['word']['pages'] for c in cases),
                           'applicationPages': sum(c['pdfChecks']['application']['pages'] for c in cases),
                           'scaleCases': [r['count'] for r in app_group if r['templateId'] == template['id']] if kind == 'group' else []})
    fixes = [
        ('DOC-01', 'Логотип был графикой в ZIP; замена строк его не удаляла.', 'Новые пакеты очищены от исходной графики; нейтральный редактируемый блок ЛОГОТИП.', 'Все16 новых шаблонов +30 итоговых DOCX: XML/атрибуты/связи/media/известные SHA; Word и PDF.'),
        ('DOC-02', 'Печати и подписи свидетельства были отдельными перекрывающими рисунками.', 'Рисунки удалены; отдельная нейтральная рамка МЕСТО ДЛЯ ПЕЧАТИ и строки подписи.', 'Обе страницы и языковые половины normal/long, длинная регистрация; Word и PDF.'),
        ('DOC-03', 'Неиспользуемая картинка чужой организации оставалась в media.', 'Удалены все исходные media, свойства, миниатюры, вложения и лишние связи новых пакетов.', 'Поиск известных хешей во всех ZIPparts; отрицательный тест с внедрённой скрытой графикой.'),
        ('DOC-04', 'Фиксированные узкие блоки ИТР и большой межбуквенный интервал обрезали строки.', 'Согласованы размеры/шрифты/интервалы заголовка, имени, курса, дат и издателя; контроль переполнения.', 'Обычные, длинные и стрессовые значения; полный текст и визуальный просмотр Word/PDF.'),
        ('DOC-05', 'Плавающие поля ПБ пересекались с фото и соседними строками.', 'Потоковые таблицы, отдельная колонка фото, полные даты и переносы полей.', 'Normal/long/photo, обе страницы, отдельный пакет с разными фото двух получателей.'),
        ('DOC-06', 'Повторная полоса ПС имела ширину за пределами листа.', 'Ширина полосы согласована с карточкой; сохранены RU/KZ издатель и работодатель.', 'Все6 страниц normal/long/photo в обоих конвертерах; полный работодатель и дисциплины.'),
        ('DOC-07', 'Две копии БиОТ использовали разную геометрию и плавающие блоки.', 'Одинаковые таблицы двух копий, согласованные ширины и переносы.', 'Сравнение структуры копий, normal/long, обе страницы Word/PDF, overflow preflight.'),
        ('DOC-08', 'Неверные tblHeader, разрывы строк и автоматическая нумерация таблиц.', 'Только настоящие заголовки повторяются; cantSplit; явные1..N; контроль высоты строки.', 'Все5 форм ×1/2/25/100/250/400; каждый участник/результат/порядок, заголовки на всех страницах.'),
        ('DOC-09', 'Плавающий/разрываемый блок комиссии отделялся от таблицы; Writer сливал соседние таблицы.', 'Комиссия в одном блоке со связью с последними участниками; у ПБ в замыкающей строке таблицы. Удалены только исходные дубли правовых форм.', 'Все30 масштабных случаев в Word и PDF: целая комиссия и участники на последнем листе; пустых хвостов нет.'),
        ('DOC-10', 'Разные движки по-разному обрабатывали исходные блоки, высоты и привязки.', 'Новая отдельная политика NEUTRAL_FORMS_V1 с нормализованной геометрией и проверкой переполнения.', 'Те же30 DOCX отдельно Word16.0.17932 и renderer.convert_pdf/LibreOffice26.2.6.3; все страницы основного комплекта просмотрены.'),
    ]
    acceptance = {'date': '2026-10-05', 'status': 'PASS_LOCAL_WORD_AND_APPLICATION_PDF',
                  'branch': 'codex/operator-flow-refinement-20261003', 'head': 'a9c9ef2015d8e6c9f9c34f2fb897332f00329430',
                  'policy': 'NEUTRAL_FORMS_V1', 'renderer': 'demo-ooxml-12/libreoffice-26.2.6.3',
                  'matrix': matrix, 'findings': [{'id': i, 'causeRu': c, 'fixRu': f, 'verificationRu': v, 'status': 'FIXED_VERIFIED'} for i,c,f,v in fixes],
                  'mainCases': 30, 'mainWordPages': sum(c['wordPages'] for c in matrix),
                  'mainApplicationPages': sum(c['applicationPages'] for c in matrix),
                  'allMainPagesVisuallyReviewed': True, 'scaleCases': 30,
                  'scaleApplicationPages': sum(c['pages'] for c in app_group),
                  'scaleWordPages': sum(c['pages'] for c in word_group),
                  'renderTests': {'status': 'PASS', 'tests': int(rendered[1]), 'seconds': float(rendered[2])},
                  'finalCodeFocusedChecks': {'status': 'PASS', 'cases': 14, 'protocolModuleFinalPbChecks': 7,
                    'batchRegressionChecks': 2, 'sameBatchDocxWordAndApplicationPages': 2,
                    'note': 'After the full-suite imports, final namespace/PB-footer corrections were covered by focused reruns. The three new employer tests explicitly distinguish the marked commission footer from participant rows; all value/count assertions remain.'},
                  'unitTests': {'root': 189, 'web': 211, 'status': 'PASS'},
                  'focusedIntegrationTests': {'existingArtifactHistoryRegistration': 11, 'newAdditiveTemplateUpgrade': 1, 'status': 'PASS'},
                  'lint': 'PASS', 'typecheck': 'PASS', 'build': 'PASS',
                  'physicalPrint': 'NOT_PERFORMED', 'productionChanged': False,
                  'fullIntegrationOrE2ESuiteClaimed': False,
                  'minorObservations': ['PTM long: перенос внутри длинного слова должности без дефиса, все символы сохранены.', 'В Word у заглушки ЛОГОТИП ПТМ левая линия контура не видна; текст и поля полны; в PDF приложения контур полный.'],
                  'historicalEvidence': preservation, 'comparisons': comparisons}
    save(EVIDENCE / 'acceptance-matrix.json', acceptance)
    save(EVIDENCE / 'group-scale-application.json', app_group)
    save(EVIDENCE / 'group-scale-word.json', word_group)
    print_instructions = ('# Контрольная печать DEMO\n\nСинтетические документы. Печатать PDF из папки application-pdf, масштаб 100% / фактический размер, без подгонки.\n\n'
                          'Проверить на бумаге: физические рамки и размеры карточек; читаемость длинных ФИО/RU/KZ курса; края полос издателя; отдельную область фото; места подписи и печати; последовательность лиц/оборотов и сгибы; последнюю страницу группы с комиссией.\n\n'
                          'Для первого контроля печатать односторонне. Затем согласовать переворот по нужному краю для конкретного бланка и принтера. Физическая печать в этой проверке не выполнялась.\n')
    (OUT / 'CONTROL_PRINT.md').write_text(print_instructions, encoding='utf8')
    checksums = {}
    kit = OUT / 'DEMO-neutral-control-kit-20261005.zip'
    with ZipFile(kit, 'w', ZIP_DEFLATED) as archive:
        for row in inventory:
            for suffix, folder in [('.docx', 'docx'), ('.pdf', 'application-pdf'), ('.word.pdf', 'word-comparison'), ('.snapshot.json', 'snapshots')]:
                path = OUT / (row['case'] + suffix)
                name = folder + '/' + path.name
                archive.write(path, name)
                checksums[name] = sha(path)
        archive.write(OUT / 'CONTROL_PRINT.md', 'CONTROL_PRINT.md')
        checksums['CONTROL_PRINT.md'] = sha(OUT / 'CONTROL_PRINT.md')
        archive.writestr('checksums.json', json.dumps(checksums, indent=2))
    save(EVIDENCE / 'control-kit.json', {'path': str(kit), 'sha256': sha(kit), 'entries': checksums})
    scale_kit = OUT / 'DEMO-neutral-group-scale-20261005.zip'
    scale_checksums = {}
    with ZipFile(scale_kit, 'w', ZIP_DEFLATED) as archive:
        for row in app_group:
            for suffix in ['.docx', '.pdf', '.word.pdf', '.snapshot.json']:
                path = GROUP / (row['case'] + suffix)
                archive.write(path, path.name)
                scale_checksums[path.name] = sha(path)
        archive.writestr('checksums.json', json.dumps(scale_checksums, indent=2))
    save(EVIDENCE / 'group-scale-kit.json', {'path': str(scale_kit), 'sha256': sha(scale_kit), 'entries': scale_checksums})
    lines = ['# Новые печатные формы DEMO — локальная приёмка 05.10.2026', '',
             '**Результат: PASS Word и PDF приложения.** Исправлены DOC-01…DOC-10;16 новых версий, отдельная политика NEUTRAL_FORMS_V1. Физическая печать не выполнялась;production не менялся.', '',
             'Worktree: `' + str(ROOT) + '`. Ветка `codex/operator-flow-refinement-20261003`, HEAD `a9c9ef2015d8e6c9f9c34f2fb897332f00329430`.', '',
             'Основной комплект:30 DOCX,30 PDF приложения и30 экспортов Word; просмотрены все ' + str(acceptance['mainWordPages']) + ' + ' + str(acceptance['mainApplicationPages']) + ' страниц. Стресс-проверка:5 групповых форм ×1,2,25,100,250,400 участников —3890 записей в каждом движке; ' + str(acceptance['scaleApplicationPages']) + ' страниц приложения и ' + str(acceptance['scaleWordPages']) + ' страниц Word. Все страницы прочитаны программно; визуально просмотрены малые случаи и окончания больших групп.', '',
             link(kit, 'Скачать полный контрольный комплект DOCX + PDF + Word + snapshots + SHA256'), '',
             link(scale_kit, 'Скачать все30 групповых случаев1–400: DOCX + PDF приложения + Word'), '',
             '## Матрица16 форм', '', '|Форма|Вид|Новая версия|Word / PDF, страниц основного комплекта|Результат|', '|---|---|---|---|---|']
    lines += ['|'+r['templateId']+'|'+r['kind']+'|'+str(r['version'])+'|'+str(r['wordPages'])+' / '+str(r['applicationPages'])+'|PASS|' for r in matrix]
    lines += ['', '## DOC-01…DOC-10', '', '|Дефект|Причина|Исправление|Новая проверка|', '|---|---|---|---|']
    lines += ['|'+'|'.join(row)+'|' for row in fixes]
    lines += ['', '## Проверки', '',
              '- `pnpm test:render`: '+rendered[1]+' тестов PASS. После последних исправлений отдельно повторены14 целевых проверок текущего кода и7 проверок протоколов ПБ: реальные DOCX/PDF всех11 форм, данные в ячейках, карточки/фото, независимость XML namespace, работодатели RU/KZ и запрет перезаписи существующих версий.',
              '- `pnpm test`:189 основных +211 web =400 PASS. `pnpm lint`, `pnpm typecheck`, `pnpm build`:PASS.',
              '-12 целевых интеграционных тестов PASS: история артефактов, авторизованное скачивание, регистрация и добавление новых версий. Полный integration/E2E-прогон не заявляется.',
              '-16 новых шаблонов и30 итоговых DOCX: весь ZIP, XML/атрибуты, колонтитулы, связи, media, известные хеши старых изображений, свойства/миниатюры/вложения. Исходной символики нет.',
              '-Все30 финальных DOCX повторно сформированы текущим кодом:байты совпали. Ошибки переполнения дают `PRINT_LAYOUT_OVERFLOW` до выпуска.',
              '-После объединения документов закладки получают уникальные ID и имена; ссылки сохраняются внутри своего получателя. Две пакетные регрессии PASS. Один и тот же объединённый DOCX ПБ на двух получателей проверен в Word и конвертере приложения:2 страницы, каждый получатель один раз в правильном порядке, комиссия целиком. '+link(EVIDENCE/'batch-bookmarks-verification.json','Доказательства пакетной проверки')+'.',
              '', '## История и регистрация', '',
              'Сохранены все '+str(preservation['oldTemplateFiles'])+' прежних файлов каталога шаблонов и '+str(preservation['originalAuditAndSavedArtifactFiles'])+' файлов прежнего аудита/сохранённого комплекта. Вне manifest и renderer прежние проверяемые файлы не изменялись; прежний progress сохранён и дополнен.', '',
              'В изолированной локальной БД16 старых версий сохранены,16 новых добавлены как несогласованные. Исторический snapshot и артефакт неизменны; авторизованное HTTP-скачивание до/после имеет одинаковыйSHA256; повторный старый LEGACY_REFERENCE_90D5-рендер даёт прежние байты. Повторная регистрация не создаёт дубликаты. Согласование и подпись реального выпуска не имитировались.', '',
              link(EVIDENCE/'preservation-after.json','Контроль сохранности')+' · '+link(EVIDENCE/'registration-history-upgrade.json','Проверка регистрации/истории'), '',
              '## До/после', '']
    for row in comparisons:
        lines += ['**'+row['case']+'** — '+row['noteRu'], '', '!['+row['case']+']('+str(Path(row['image']).resolve()).replace('\\','/')+')', '']
    lines += ['## Файлы основного комплекта', '', '|Сценарий|DOCX|PDF приложения|PDF Word|', '|---|---|---|---|']
    for row in inventory:
        name=row['case']
        lines.append('|'+name+'|'+link(OUT/(name+'.docx'),'DOCX')+'|'+link(OUT/(name+'.pdf'),'PDF')+'|'+link(OUT/(name+'.word.pdf'),'Word PDF')+'|')
    lines += ['', '## Изменения реализации', '',
              'Новые16DOCX и manifest/реестрSHA; `renderer.py` dispatch; `neutral_forms.py`, `neutral_identity.py`, `neutral_cards.py`, `neutral_certificates.py`, `neutral_protocols.py`; additive upgrade и verification helpers; новые регрессии и три точечных адаптации прежних тестов. Старые legacy helpers и templates не переписаны. Полный список: '+link(EVIDENCE/'changed-files.json','changed-files.json')+'.', '',
              '## Границы и контрольная печать', '',
              print_instructions.split('\n\n',1)[1],
              'Две небольшие особенности ПТМ сохранены в матрице: перенос внутри длинного слова должности без дефиса и невидимая левая линия рамки ЛОГОТИП в Word. Данные полны, пересечений нет. Word может кодировать казахскую ә как визуально идентичную ə в извлечённом PDF-тексте; сравнение нормализует только эту пару.', '',
              'Новые версии требуют обычного согласования шаблона в центре. Зарегистрированные immutable contract не обновляются при повторном setup. Production-миграции, публикация и отправка третьим лицам не выполнялись.', '']
    report = '\n'.join(lines)
    report = re.sub(r'([А-Яа-яЁё])(\d)', r'\1 \2', report)
    report = re.sub(r'(\d)([А-Яа-яЁё])', r'\1 \2', report)
    report = re.sub(r'([;:])(?=[А-Яа-яЁёA-Za-z0-9])', r'\1 ', report)
    (EVIDENCE/'REPORT_RU.md').write_text(report, encoding='utf8')
    print('Acceptance matrix, report, before/after boards, print kit written.')


if __name__ == '__main__':
    main()

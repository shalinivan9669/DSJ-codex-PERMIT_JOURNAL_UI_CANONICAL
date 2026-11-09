"""Read only ordinary, row-anchored XLSX images; never follow external links."""
import base64
import io
import posixpath
import re
from lxml import etree as E
from PIL import Image

SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
ART = 'http://schemas.openxmlformats.org/drawingml/2006/main'
MAX_PHOTOS = 250
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024


def xml(archive, path):
    return E.fromstring(archive.read(path), E.XMLParser(resolve_entities=False, no_network=True))


def related(archive, source, identifier, kind):
    path = posixpath.join(posixpath.dirname(source), '_rels', posixpath.basename(source) + '.rels')
    relationships = xml(archive, path)
    matches = [r for r in relationships if r.tag == '{' + PKG + '}Relationship' and r.get('Id') == identifier]
    if len(matches) != 1:
        raise ValueError('PHOTO_RELATION_INVALID')
    relation = matches[0]
    target = relation.get('Target', '')
    if (relation.get('TargetMode', 'Internal') != 'Internal' or relation.get('Type') != REL + '/' + kind
            or not target or any(c in target for c in '\\%?#') or re.match(r'^[a-z][a-z0-9+.-]*:', target, re.I)):
        raise ValueError('PHOTO_RELATION_INVALID')
    path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(source), target))
    expected = {'worksheet': 'xl/worksheets/', 'drawing': 'xl/drawings/', 'image': 'xl/media/'}[kind]
    if not path.startswith(expected) or '/' in path[len(expected):] or path not in archive.namelist():
        raise ValueError('PHOTO_RELATION_INVALID')
    return path


def workbook_photos(archive, sheet_name, headers, data_rows):
    """Top-left anchor in the Фото column explicitly owns the photo's row."""
    names = archive.namelist()
    if len(names) != len(set(names)) or any(n.startswith('/') or '\\' in n or '..' in n.split('/') for n in names):
        raise ValueError('IMPORT_ARCHIVE_INVALID')
    workbook = xml(archive, 'xl/workbook.xml')
    sheets = workbook.findall('{' + SHEET + '}sheets/{' + SHEET + '}sheet')
    selected = [s for s in sheets if s.get('name') == sheet_name]
    if len(selected) != 1:
        raise ValueError('IMPORT_SHEET_UNKNOWN')
    sheet_path = related(archive, 'xl/workbook.xml', selected[0].get('{' + REL + '}id'), 'worksheet')
    sheet = xml(archive, sheet_path)
    photo_columns = [i for i, h in enumerate(headers) if re.sub(r'\s+', '', str(h)).lower() in
                     ['фото', 'фотография', 'фотосотрудника', 'photo', 'photograph']]
    photos, errors, claimed = [], [], set()
    row_numbers = {r['rowNumber'] for r in data_rows}
    total = 0
    count = 0
    for cell in sheet.findall(".//{" + SHEET + "}c"):
        if cell.get("vm") is not None:
            match = re.fullmatch(r"[A-Z]+(\d+)", cell.get("r", ""))
            errors.append({"code": "PHOTO_UNSUPPORTED", **({"row": int(match[1])} if match else {})})
    for unsupported in ['picture', 'legacyDrawing', 'legacyDrawingHF']:
        if sheet.find('{' + SHEET + '}' + unsupported) is not None:
            errors.append({'code': 'PHOTO_UNSUPPORTED'})
    for drawing in sheet.findall('{' + SHEET + '}drawing'):
        drawing_path = related(archive, sheet_path, drawing.get('{' + REL + '}id'), 'drawing')
        for anchor in xml(archive, drawing_path):
            count += 1
            if count > MAX_PHOTOS:
                raise ValueError('PHOTO_COUNT_LIMIT')
            row = None
            try:
                if anchor.tag not in ['{' + DRAW + '}oneCellAnchor', '{' + DRAW + '}twoCellAnchor']:
                    raise ValueError('PHOTO_ANCHOR_INVALID')
                starts = anchor.findall('{' + DRAW + '}from')
                if len(starts) != 1:
                    raise ValueError('PHOTO_ANCHOR_INVALID')
                row_text = starts[0].findtext('{' + DRAW + '}row', '')
                col_text = starts[0].findtext('{' + DRAW + '}col', '')
                if not re.fullmatch(r'\d{1,5}', row_text) or not re.fullmatch(r'\d{1,3}', col_text):
                    raise ValueError('PHOTO_ANCHOR_INVALID')
                row, column = int(row_text) + 1, int(col_text)
                if len(photo_columns) != 1 or column != photo_columns[0]:
                    raise ValueError('PHOTO_COLUMN_REQUIRED')
                if row not in row_numbers:
                    raise ValueError('PHOTO_ROW_MISSING')
                if row in claimed:
                    photos = [p for p in photos if p['sourceRow'] != row]
                    raise ValueError('PHOTO_AMBIGUOUS')
                claimed.add(row)
                pictures = anchor.findall('{' + DRAW + '}pic')
                if len(pictures) != 1 or anchor.find('{' + DRAW + '}grpSp') is not None:
                    raise ValueError('PHOTO_UNSUPPORTED')
                blips = pictures[0].findall('.//{' + ART + '}blip')
                if len(blips) != 1 or blips[0].get('{' + REL + '}link'):
                    raise ValueError('PHOTO_RELATION_INVALID')
                path = related(archive, drawing_path, blips[0].get('{' + REL + '}embed'), 'image')
                info = archive.getinfo(path)
                if info.file_size > MAX_PHOTO_BYTES:
                    raise ValueError('PHOTO_TOO_LARGE')
                raw = archive.read(path)
                total += len(raw)
                if total > MAX_TOTAL_BYTES:
                    raise ValueError('PHOTO_TOTAL_LIMIT')
                if raw.startswith(b'\x89PNG\r\n\x1a\n') and path.lower().endswith('.png'):
                    mime = 'image/png'
                elif raw.startswith(b'\xff\xd8\xff') and path.lower().endswith(('.jpg', '.jpeg')):
                    mime = 'image/jpeg'
                else:
                    raise ValueError('PHOTO_TYPE')
                with Image.open(io.BytesIO(raw)) as image:
                    if image.format not in ['PNG', 'JPEG'] or getattr(image, 'n_frames', 1) != 1 or image.width * image.height > 20_000_000:
                        raise ValueError('PHOTO_DECODE')
                    image.verify()
                photos.append({'sourceRow': row, 'mimeType': mime, 'base64': base64.b64encode(raw).decode('ascii')})
            except (ValueError, KeyError, E.XMLSyntaxError, OSError, Image.DecompressionBombError) as error:
                code = str(error) if re.fullmatch(r'PHOTO_[A-Z_]+', str(error)) else 'PHOTO_DECODE'
                if code == 'PHOTO_TOTAL_LIMIT':
                    raise
                errors.append({'code': code, **({'row': row} if row is not None else {})})
    for row in data_rows:
        row['errors'].extend(e['code'] for e in errors if e.get('row') == row['rowNumber'])
    invalid = {e.get('row') for e in errors}
    return [p for p in photos if p['sourceRow'] not in invalid], errors


def import_template(out):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.utils import get_column_letter
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Данные'
    headers = ['Табельный номер', 'Категория сотрудника', 'ФИО RU', 'ФИО KZ', 'Должность RU', 'Должность KZ',
               'Место работы RU', 'Место работы KZ', 'Дата документа', 'Начало обучения', 'Окончание обучения', 'Фото']
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill('solid', fgColor='163E45')
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    sheet.row_dimensions[1].height = 34
    for col in range(1, len(headers) + 1):
        sheet.column_dimensions[get_column_letter(col)].width = 26 if col != 12 else 18
    for row in range(2, 22):
        sheet.row_dimensions[row].height = 90
        for col in range(1, 13):
            sheet.cell(row, col).number_format = '@'
    category = DataValidation(type='list', formula1='"Рабочий,ИТР"', allow_blank=True)
    sheet.add_data_validation(category)
    category.add('B2:B10001')
    sheet.freeze_panes = 'C2'
    instructions = workbook.create_sheet('Инструкция')
    instructions.column_dimensions['A'].width = 110
    lines = [
        'Safirebrief — импорт сотрудников',
        'Заполняйте лист «Данные». Одна строка — один сотрудник. Примерных сотрудников в шаблоне нет.',
        'ФИО и должность можно дополнить после импорта. Табельные номера хранятся как текст, с ведущими нулями.',
        'Категория: Рабочий или ИТР. В одной заявке можно указать обе категории.',
        'Даты вводите текстом ГГГГ-ММ-ДД, например 2026-01-31. Пустые колонки дат удалите, если нужны общие даты заявки.',
        'Фото: Вставка → Рисунки → обычный JPG или PNG. Верхний левый угол изображения поместите в колонку «Фото» напротив сотрудника.',
        'Одна фотография на строку. Формулы IMAGE, внешние ссылки, группированные рисунки и изображения внутри ячейки не поддерживаются.',
        'Фото можно добавить отдельным файлом в карточке сотрудника после импорта.',
        'Файл — до 5 МиБ; до 250 фото; каждое фото — до 5 МиБ и 20 Мп, суммарно до 20 МиБ после распаковки.',
        'Перед добавлением проверьте строки и фотографии в предварительном просмотре. Ошибочные строки можно исключить.',
        'Повторная загрузка того же файла и листа не добавляет уже импортированные строки повторно.',
    ]
    for index, line in enumerate(lines, 1):
        cell = instructions.cell(index, 1, line)
        cell.alignment = Alignment(wrap_text=True, vertical='top')
        instructions.row_dimensions[index].height = 42 if index > 1 else 26
    instructions['A1'].font = Font(bold=True, size=16)
    workbook.save(out)
    return {'format': 'XLSX', 'columns': len(headers)}

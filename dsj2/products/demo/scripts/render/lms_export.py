"""Bounded-memory XLSX output for the trusted server-created JSONL spool."""
import json
from pathlib import Path
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill, Alignment


def export_lms_rows(payload, out):
    columns = payload['columns']
    if not 1 <= len(columns) <= 100:
        raise ValueError('EXPORT_COLUMNS_LIMIT')
    wb = Workbook(write_only=True)
    ws = wb.create_sheet('Реестр')
    ws.freeze_panes = 'A2'
    for index in range(len(columns)):
        from openpyxl.utils import get_column_letter
        ws.column_dimensions[get_column_letter(index + 1)].width = 26

    def cells(values, header=False):
        for value in values:
            cell = WriteOnlyCell(ws, value=str(value if value is not None else ''))
            # Explicit string type prevents formulas, external links, and numeric ID conversion.
            cell.data_type = 's'
            cell.number_format = '@'
            cell.alignment = Alignment(vertical='top', wrap_text=True)
            if header:
                cell.font = Font(bold=True, color='FFFFFF')
                cell.fill = PatternFill('solid', fgColor='163E45')
            yield cell

    ws.append(list(cells([column['title'] for column in columns], True)))
    count = 0
    with Path(payload['itemsFile']).open(encoding='utf8') as source:
        for line in source:
            row = json.loads(line)
            ws.append(list(cells([row.get(column['field'], '') for column in columns])))
            count += 1
    wb.save(out)
    return {'rows': count, 'columns': [column['title'] for column in columns], 'format': 'XLSX'}

"""Synthetic workbook input for the human-accessible Excel import regression."""
from pathlib import Path
import sys
from openpyxl import Workbook

target = Path(sys.argv[1])
count = int(sys.argv[2]) if len(sys.argv) > 2 else 400
company = sys.argv[3] if len(sys.argv) > 3 else "СИНТЕТИЧЕСКИЙ импорт 400"
if not 1 <= count <= 10001:
    raise ValueError("Synthetic fixture resource guard")
workbook = Workbook()
sheet = workbook.active
sheet.title = "Сотрудники"
sheet.append([
    "ФИО RU", "ФИО KZ", "Должность RU", "Должность KZ",
    "Место работы RU", "Место работы KZ", "БИН работодателя",
    "Юридический адрес работодателя RU", "Юридический адрес работодателя KZ",
    "Табельный номер", "Внешний ID", "Категория сотрудника",
])
for number in range(1, count + 1):
    sheet.append([
        f"Синтетический Слушатель {number:03d}",
        f"Синтетикалық Қатысушы {number:03d}",
        "Электромонтёр", "Электрмонтер",
        f"ТОО {company}", f"{company} ЖШС", "000000000400",
        "СИНТЕТИЧЕСКИЙ адрес, 400", "СИНТЕТИКАЛЫҚ мекенжай, 400",
        f"{number:06d}", f"synthetic-excel-{number:06d}", "WORKER",
    ])
sheet.freeze_panes = "A2"
target.parent.mkdir(parents=True, exist_ok=True)
workbook.save(target)
workbook.close()
print(f"Synthetic XLSX: {count} rows")

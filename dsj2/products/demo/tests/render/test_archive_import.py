import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "scripts/render"))
from renderer import import_table


class ArchiveWorkbookImport(unittest.TestCase):
    def test_original_forms_accept_named_rows_and_drop_historical_issuance_fields(self):
        examples = {
            "biot": {"D": "fullNameRu", "F": "positionRu", "G": "workplaceKz"},
            "pb": {"C": "fullNameRu", "E": "positionRu", "J": "trainingSubject"},
            "ptm": {"C": "fullNameRu", "D": "positionKz", "G": "workplaceRu"},
            "ps": {"C": "fullNameRu", "E": "psQualificationRu", "S": "psSpecialSubjectRu"},
        }
        with tempfile.TemporaryDirectory() as folder:
            dst = Path(folder)
            for name, columns in examples.items():
                with self.subTest(course=name):
                    src = root / "assets/import-templates" / (name + ".xlsx")
                    empty = import_table({"inputPath": str(src)}, dst / "blank.json")
                    self.assertEqual(empty["count"], 0)
                    wb = load_workbook(src)
                    ws = wb.active
                    ws["A2"] = "OLD-SERIES-00001"
                    ws["B2"] = "OLD-ISSUANCE-00001"
                    ws["DA2"] = "OLD-PROTOCOL-RECIPIENT"
                    ws.cell(1, 301).number_format = "@"
                    for column, field in columns.items():
                        ws[column + "2"] = "Учебное " + field
                    ws["DA3"] = "OLD-PROTOCOL-ONLY-ROW"
                    filled = dst / (name + ".xlsx")
                    wb.save(filled)
                    parsed = import_table({"inputPath": str(filled)}, dst / "parsed.json")
                    self.assertEqual(parsed["archive"]["course"], name.upper())
                    self.assertEqual(parsed["count"], 1)
                    row = parsed["rawRows"][0]
                    self.assertEqual(row["rowNumber"], 2)
                    self.assertEqual(row["errors"], [])
                    fields = dict(zip(parsed["archive"]["fields"], row["values"]))
                    for field in columns.values():
                        self.assertEqual(fields[field], "Учебное " + field)
                    self.assertFalse(any("OLD-" in value for value in row["values"]))
                    self.assertNotIn("result", fields)
                    ws["DA1"] = "Посторонняя колонка"
                    wb.save(filled)
                    with self.assertRaisesRegex(ValueError, "IMPORT_DIMENSION_LIMIT"):
                        import_table({"inputPath": str(filled)}, dst / "unknown.json")
                    wb.close()


if __name__ == "__main__":
    unittest.main()

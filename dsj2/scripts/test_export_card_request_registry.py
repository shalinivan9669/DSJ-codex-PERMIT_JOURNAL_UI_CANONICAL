import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook


SCRIPT = Path(__file__).with_name("export_card_request_registry.py")


class RegistryExportTest(unittest.TestCase):
    def test_untrusted_values_are_literal_text_not_formulas(self):
        payload = {
            "request": {
                "title": '=HYPERLINK("https://invalid.example","click")',
                "certificateTypeLabel": "БиОТ",
                "requestCompanyRu": "=1+1",
            },
            "items": [{
                "index": 1,
                "fullName": "=1+1",
                "positionRu": "+текст",
                "certificateNumber": "000123",
                "protocolNumber": "=SUM(1,2)",
            }],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "registry.xlsx"
            subprocess.run(
                [sys.executable, str(SCRIPT), str(output)],
                input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                check=True,
                capture_output=True,
            )
            workbook = load_workbook(output, data_only=False)
            summary = workbook["Заявка"]
            registry = workbook["Реестр"]
            for cell in (summary["B1"], summary["B6"], registry["B2"], registry["D2"], registry["J2"]):
                self.assertEqual(cell.data_type, "s")
                self.assertTrue(cell.value.startswith("="))
            self.assertEqual(registry["E2"].value, "+текст")
            self.assertEqual(registry["I2"].value, "000123")
            self.assertEqual(registry["A2"].value, 1)
            self.assertEqual(registry["A2"].data_type, "n")

    def test_non_numeric_index_is_also_written_as_text(self):
        payload = {"request": {}, "items": [{"index": "=1+1"}]}
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "registry.xlsx"
            subprocess.run(
                [sys.executable, str(SCRIPT), str(output)],
                input=json.dumps(payload).encode("utf-8"),
                check=True,
                capture_output=True,
            )
            cell = load_workbook(output, data_only=False)["Реестр"]["A2"]
            self.assertEqual(cell.value, "=1+1")
            self.assertEqual(cell.data_type, "s")


if __name__ == "__main__":
    unittest.main()

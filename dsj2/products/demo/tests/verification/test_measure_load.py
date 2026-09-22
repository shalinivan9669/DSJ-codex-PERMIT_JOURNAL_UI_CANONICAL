"""Regression for real Docker telemetry's decimal lowercase kB output."""

import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[2] / "scripts/verification/measure-container-load.py"
spec = importlib.util.spec_from_file_location("measure_container_load", source)
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)


class DockerBytesTest(unittest.TestCase):
    def test_real_decimal_and_binary_units(self):
        for raw, expected in [("8.19kB ", 8190), (" 0B", 0), ("1.5MiB", 1572864), ("2GB", 2000000000), ("1KiB", 1024)]:
            with self.subTest(raw=raw):
                self.assertEqual(measure.byte_count(raw), expected)

    def test_unrecognized_units_fail_explicitly(self):
        for raw in ["N/A", "1MB/s", "10", "", "NaNB"]:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    measure.byte_count(raw)


if __name__ == "__main__":
    unittest.main()

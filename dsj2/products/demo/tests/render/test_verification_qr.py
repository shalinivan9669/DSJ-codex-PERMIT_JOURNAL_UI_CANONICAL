import sys
import unittest
import tempfile
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts/render"))
from verification_qr import verification_qr


class VerificationQrTests(unittest.TestCase):
    def test_png_and_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "qr.png"
            verification_qr({"url": "https://example.test/verify/" + "a" * 64}, out)
            with Image.open(out) as image:
                self.assertEqual(image.format, "PNG")
                self.assertGreater(image.width, 200)
                self.assertEqual(image.width, image.height)
            for url in ["javascript:alert(1)", "https://example.test/private",
                        "https://example.test/verify/" + "a"*64 + "?person=secret"]:
                with self.assertRaisesRegex(ValueError, "VERIFICATION_URL_INVALID"):
                    verification_qr({"url": url}, out)

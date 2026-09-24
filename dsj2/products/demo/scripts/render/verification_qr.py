"""Explicitly published verification link; separate from immutable issued bytes."""
import re
from urllib.parse import urlsplit
import qrcode


def verification_qr(payload, out):
    url = payload.get("url", "")
    parsed = urlsplit(url)
    if (len(url) > 2048 or parsed.scheme not in ("http", "https")
            or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment
            or not re.fullmatch(r"/verify/[a-f0-9]{64}", parsed.path)):
        raise ValueError("VERIFICATION_URL_INVALID")
    code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,
                         box_size=8, border=4)
    code.add_data(url)
    code.make(fit=True)
    picture = code.make_image(fill_color="black", back_color="white")
    picture.save(out)
    return {"width": picture.size[0], "height": picture.size[1], "format": "PNG"}

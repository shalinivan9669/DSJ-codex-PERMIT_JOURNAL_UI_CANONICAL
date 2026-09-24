"""Decode static PNG/JPEG under the same process limits as PDF validation."""

import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import warnings
import zlib


def emit(code, **details):
    print(json.dumps({"code": code, **details}, separators=(",", ":")))


def main():
    try:
        spec = importlib.util.spec_from_file_location("pdf_limits", Path(__file__).with_name("pdf_limits.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        resource_mode = module.apply_limits()
        from PIL import Image, ImageFile, PngImagePlugin
        import PIL
        if PIL.__version__ != "12.3.0":
            raise RuntimeError("Unsupported image validator version")
    except Exception:
        emit("IMAGE_VALIDATOR_UNAVAILABLE")
        return

    class Rejected(Exception):
        pass

    Image.MAX_IMAGE_PIXELS = 16_000_000
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    PngImagePlugin.MAX_TEXT_CHUNK = 1024 * 1024
    PngImagePlugin.MAX_TEXT_MEMORY = 4 * 1024 * 1024
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    try:
        data = sys.stdin.buffer.read(1048577)
        if not data or len(data) > 1048576:
            raise Rejected("IMAGE_RESOURCE_LIMIT")
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            expected = "PNG"
            # The decoder may ignore bytes after IEND; reject appended content
            # and invalid ancillary CRCs too while preserving accepted bytes.
            offset = 8
            chunks = 0
            while True:
                if offset + 12 > len(data):
                    raise Rejected("IMAGE_INVALID")
                size, kind = struct.unpack(">I4s", data[offset:offset + 8])
                end = offset + 12 + size
                if end > len(data) or size > 1048576:
                    raise Rejected("IMAGE_INVALID")
                if zlib.crc32(data[offset + 4:end - 4]) != struct.unpack(">I", data[end - 4:end])[0]:
                    raise Rejected("IMAGE_INVALID")
                if (chunks == 0 and kind != b"IHDR") or (chunks > 0 and kind == b"IHDR"):
                    raise Rejected("IMAGE_INVALID")
                chunks += 1
                if chunks > 4096:
                    raise Rejected("IMAGE_RESOURCE_LIMIT")
                offset = end
                if kind == b"IEND":
                    if size or end != len(data):
                        raise Rejected("IMAGE_INVALID")
                    break
        elif data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
            expected = "JPEG"
        else:
            raise Rejected("IMAGE_INVALID")
        with Image.open(io.BytesIO(data)) as source:
            if source.format != expected or getattr(source, "n_frames", 1) != 1:
                raise Rejected("IMAGE_INVALID")
            width, height = source.size
            if not (0 < width <= 8192 and 0 < height <= 8192) or width * height > 16_000_000:
                raise Rejected("IMAGE_RESOURCE_LIMIT")
            source.verify()
        with Image.open(io.BytesIO(data)) as decoded:
            decoded.load()  # verify() alone does not decode JPEG pixels.
        emit("IMAGE_SAFE", parser="Pillow", version=PIL.__version__, format=expected,
             width=width, height=height, resourceMode=resource_mode)
    except Rejected as error:
        emit(str(error))
    except (MemoryError, RecursionError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        emit("IMAGE_RESOURCE_LIMIT")
    except Exception:
        emit("IMAGE_INVALID")


if __name__ == "__main__":
    main()

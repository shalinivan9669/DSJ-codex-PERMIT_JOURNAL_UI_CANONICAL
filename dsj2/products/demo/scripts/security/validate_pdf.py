"""Validate a static PDF without rewriting bytes or executing/rendering content.

Input is bounded binary stdin; stdout is one small JSON result. This process must
remain separate from the API: parsing/decompression runs under OS memory/CPU
limits and the caller enforces a wall deadline and bounded concurrency.
"""

import importlib.util
import io
import json
import logging
from pathlib import Path
import sys
import zlib


def emit(code, **details):
    print(json.dumps({"code": code, **details}, separators=(",", ":")))


def main():
    try:
        spec = importlib.util.spec_from_file_location("pdf_limits", Path(__file__).with_name("pdf_limits.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        resource_mode = module.apply_limits()
        import pypdf
        from pypdf import PdfReader, overwrite_configuration, filters
        from pypdf.errors import LimitReachedError
        from pypdf.generic import (ArrayObject, DictionaryObject, IndirectObject,
                                   NameObject, NullObject, StreamObject)
        if pypdf.__version__ != "6.19.0":
            raise RuntimeError("Unsupported PDF validator version")
    except Exception:
        emit("PDF_VALIDATOR_UNAVAILABLE")
        return

    class Rejected(Exception):
        pass

    class ParseWarning(logging.Handler):
        def emit(self, record):
            # A parser repair/warning is not evidence of a valid static file.
            if record.levelno >= logging.WARNING:
                raise Rejected("PDF_INVALID")

    logger = logging.getLogger("pypdf")
    logger.handlers = [ParseWarning()]
    logger.propagate = False
    logger.setLevel(logging.WARNING)
    stream_limit = 8 * 1024 * 1024
    overwrite_configuration(
        maximum_declared_stream_length=1048576,
        array_based_stream_maximum_output_length=stream_limit,
        zlib_maximum_output_length=stream_limit,
        lzw_maximum_output_length=stream_limit,
        run_length_maximum_output_length=stream_limit,
        jbig2_maximum_output_length=stream_limit,
        jbig2dec_binary=None,
        page_tree_maximum_entries=501,
        page_tree_maximum_depth=64,
        disable_legacy_handling=True,
    )

    def strict_flate(data):
        # pypdf deliberately recovers truncated/checksum-broken Flate streams,
        # even when PdfReader(strict=True). Upload validation must not recover.
        decoder = zlib.decompressobj()
        output = decoder.decompress(data, stream_limit + 1)
        if len(output) > stream_limit or decoder.unconsumed_tail:
            raise LimitReachedError("PDF decompression limit")
        if not decoder.eof or decoder.unused_data:
            raise Rejected("PDF_INVALID")
        return output

    filters.decompress = strict_flate
    banned_keys = {
        "/AA", "/OpenAction", "/JavaScript", "/JS", "/Launch",
        "/EmbeddedFiles", "/EmbeddedFile", "/EF", "/AF", "/Collection",
        "/RichMedia", "/RichMediaContent", "/RichMediaSettings", "/XFA",
        "/Movie", "/Sound", "/Rendition", "/3DD", "/3DA", "/3DV",
        "/SubmitForm", "/ImportData", "/GoToR", "/GoToE", "/URI",
        "/OPI", "/Ref", "/Alternates", "/PS",
    }
    banned_names = {
        "/Action", "/JavaScript", "/Launch", "/EmbeddedFile", "/Filespec",
        "/RichMedia", "/Movie", "/Sound", "/Rendition", "/3D", "/Screen",
        "/FileAttachment", "/SubmitForm", "/ResetForm", "/ImportData",
        "/GoToR", "/GoToE", "/URI", "/Hide", "/Named", "/Thread",
        "/SetOCGState", "/RichMediaExecute", "/GoTo3DView", "/Trans", "/PS",
    }
    allowed_filters = {"/FlateDecode", "/ASCIIHexDecode", "/ASCII85Decode",
                       "/LZWDecode", "/RunLengthDecode", "/DCTDecode", "/JPXDecode",
                       "/CCITTFaxDecode"}
    try:
        data = sys.stdin.buffer.read(1048577)
        if not data or len(data) > 1048576:
            raise Rejected("PDF_RESOURCE_LIMIT")
        if not data.startswith(b"%PDF-") or not data.rstrip().endswith(b"%%EOF"):
            raise Rejected("PDF_INVALID")
        reader = PdfReader(io.BytesIO(data), strict=True, root_object_recovery_limit=10000)
        if reader.is_encrypted:
            raise Rejected("PDF_ENCRYPTED_REJECTED")
        if reader.trailer.get("/Root") is None or reader.root_object.get("/Type") != "/Catalog":
            raise Rejected("PDF_INVALID")
        refs = []
        for generation, entries in reader.xref.items():
            for number in entries:
                if number and not reader.xref_free_entry.get(generation, {}).get(number, False):
                    refs.append(IndirectObject(number, generation, reader))
        refs.extend(IndirectObject(number, 0, reader) for number in reader.xref_objStm)
        if len(refs) > 10000:
            raise Rejected("PDF_RESOURCE_LIMIT")
        visited_refs, visited_containers = set(), set()
        stack = [(reader.trailer, 0)] + [(ref, 0) for ref in refs]
        nodes = decoded_bytes = 0
        while stack:
            value, depth = stack.pop()
            nodes += 1
            if nodes > 50000 or depth > 64:
                raise Rejected("PDF_RESOURCE_LIMIT")
            if isinstance(value, IndirectObject):
                key = (value.idnum, value.generation)
                if key in visited_refs:
                    continue
                visited_refs.add(key)
                resolved = value.get_object()
                if resolved is None or isinstance(resolved, NullObject):
                    raise Rejected("PDF_INVALID")
                stack.append((resolved, depth + 1))
            elif isinstance(value, (DictionaryObject, ArrayObject)):
                if id(value) in visited_containers:
                    continue
                visited_containers.add(id(value))
                if isinstance(value, DictionaryObject):
                    if any(str(key) in banned_keys for key in value):
                        raise Rejected("ACTIVE_PDF_REJECTED")
                    if "/A" in value:
                        # /A also represents static attributes in tagged PDFs.
                        # Permit only declared structure attributes; still walk
                        # every entry to reject nested active dictionaries.
                        attributes = value["/A"]
                        entries = attributes if isinstance(attributes, ArrayObject) else [attributes]
                        if value.get("/Type") != "/StructElem":
                            raise Rejected("ACTIVE_PDF_REJECTED")
                        for entry in entries:
                            if isinstance(entry, IndirectObject):
                                entry = entry.get_object()
                            if isinstance(entry, (int, float)):
                                continue  # Tagged-PDF attribute revision number.
                            if (not isinstance(entry, DictionaryObject)
                                    or entry.get("/O") not in ("/Layout", "/Table", "/List", "/PrintField", "/UserProperties")
                                    or any(key in entry for key in ("/S", "/Next", "/Type"))):
                                raise Rejected("ACTIVE_PDF_REJECTED")
                    if isinstance(value, StreamObject):
                        if any(key in value for key in ("/F", "/FFilter", "/FDecodeParms")):
                            raise Rejected("ACTIVE_PDF_REJECTED")
                        encoding = value.get("/Filter", [])
                        if isinstance(encoding, IndirectObject):
                            encoding = encoding.get_object()
                        encodings = encoding if isinstance(encoding, ArrayObject) else [encoding] if encoding else []
                        if len(encodings) > 4 or any(str(item) not in allowed_filters for item in encodings):
                            raise Rejected("PDF_UNSUPPORTED_FILTER")
                        expanded = value.get_data()
                        decoded_bytes += len(expanded)
                        if len(expanded) > stream_limit or decoded_bytes > 32 * 1024 * 1024:
                            raise Rejected("PDF_RESOURCE_LIMIT")
                    stack.extend((entry, depth + 1) for pair in value.items() for entry in pair)
                else:
                    stack.extend((entry, depth + 1) for entry in value)
            elif isinstance(value, NameObject) and str(value) in banned_names:
                raise Rejected("ACTIVE_PDF_REJECTED")
        pages = len(reader.pages)
        if pages < 1:
            raise Rejected("PDF_INVALID")
        if pages > 500:
            raise Rejected("PDF_RESOURCE_LIMIT")
        emit("PDF_SAFE", parser="pypdf", version=pypdf.__version__, objects=len(visited_refs),
             pages=pages, decodedBytes=decoded_bytes, resourceMode=resource_mode)
    except Rejected as error:
        emit(str(error))
    except (LimitReachedError, MemoryError, RecursionError):
        emit("PDF_RESOURCE_LIMIT")
    except Exception:
        emit("PDF_INVALID")


if __name__ == "__main__":
    main()

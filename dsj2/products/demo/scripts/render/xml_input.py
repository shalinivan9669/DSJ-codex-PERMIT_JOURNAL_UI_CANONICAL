"""Bound untrusted OOXML before openpyxl enters its XML readers.

Expat CVE-2026-66046 needs DTD attribute declarations. Reject the DOCTYPE start
event, before the internal subset or attribute normalization is processed. This
also handles UTF-16 and chunk boundaries, which a byte substring scan would miss.
This is an input-path mitigation, not a claim that the native library is patched.
"""
from xml.parsers import expat


def validate_xlsx_xml(archive):
    for info in archive.infolist():
        if not info.filename.lower().endswith(('.xml', '.rels')):
            continue
        parser = expat.ParserCreate()
        depth = 0

        def reject_doctype(*_args):
            raise ValueError('IMPORT_XML_DTD_FORBIDDEN')

        def start(_name, attributes):
            nonlocal depth
            depth += 1
            if depth > 128:
                raise ValueError('IMPORT_XML_DEPTH_LIMIT')
            if len(attributes) > 128:
                raise ValueError('IMPORT_XML_ATTRIBUTE_LIMIT')

        def end(_name):
            nonlocal depth
            depth -= 1

        parser.StartDoctypeDeclHandler = reject_doctype
        parser.EntityDeclHandler = reject_doctype
        parser.ExternalEntityRefHandler = reject_doctype
        parser.StartElementHandler = start
        parser.EndElementHandler = end
        with archive.open(info) as stream:
            while chunk := stream.read(64 * 1024):
                parser.Parse(chunk, False)
            parser.Parse(b'', True)

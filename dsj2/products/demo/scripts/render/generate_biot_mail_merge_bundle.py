#!/usr/bin/env python3

import json
import sys
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from generate_biot_card import (
    DOC_REL,
    REL,
    attach_photo,
    collect_namespaces as collect_doc_namespaces,
    ensure_content_type_default,
    next_relationship_id,
    replace_literal_text_nodes,
    register_namespaces as register_doc_namespaces,
    replace_fields,
    replace_literal_paragraphs,
    strip_mail_merge,
    trim_trailing_empty_body_paragraphs,
    validate_field_style_overrides,
    validate_photo_payload,
    validate_text_replacements,
)


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
W = f"{{{WORD_NS}}}"


def read_json_stdin() -> object:
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def normalize_value(value: object) -> str:
    if value is None:
        return ""
    return str(value).replace("\r\n", " ").replace("\n", " ").strip()


def normalize_header(value: object) -> str:
    return " ".join(normalize_value(value).split())

def validate_payload(payload: object) -> list[dict[str, object]]:
    if not isinstance(payload, dict):
        raise RuntimeError("Передан некорректный payload генератора общего документа.")

    rows = payload.get("rows")

    if not isinstance(rows, list) or not rows:
        raise RuntimeError("Для общего документа нужен список сотрудников.")

    normalized_rows: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("Одна из строк общего документа передана в неверном формате.")

        if "fields" in row:
            fields = row.get("fields")
            if not isinstance(fields, dict):
                raise RuntimeError("Одна из строк общего документа передана в неверном формате.")
            normalized_rows.append(
                {
                    "fields": {str(key): normalize_value(value) for key, value in fields.items()},
                    "photo": validate_photo_payload(row.get("photo")),
                    "textReplacements": validate_text_replacements(row.get("textReplacements")),
                    "fieldStyleOverrides": validate_field_style_overrides(
                        row.get("fieldStyleOverrides")
                    ),
                }
            )
        else:
            normalized_rows.append(
                {
                    "fields": {str(key): normalize_value(value) for key, value in row.items()},
                    "photo": None,
                    "textReplacements": [],
                    "fieldStyleOverrides": {},
                }
            )

    return normalized_rows


def build_page_break_paragraph() -> ET.Element:
    paragraph = ET.Element(f"{W}p")
    run = ET.SubElement(paragraph, f"{W}r")
    br = ET.SubElement(run, f"{W}br")
    br.set(f"{W}type", "page")
    return paragraph


def render_filled_docx_bytes(
    template_path: Path,
    row_fields: dict[str, str],
    photo: dict[str, object] | None,
    text_replacements: list[dict[str, str]],
    field_style_overrides: dict[str, dict[str, int]],
) -> bytes:
    output = BytesIO()

    with ZipFile(template_path) as source_zip:
        file_map = {}
        for source_info in source_zip.infolist():
            if source_info.filename == "word/_rels/settings.xml.rels":
                continue
            file_map[source_info.filename] = source_zip.read(source_info.filename)

    file_map["word/document.xml"] = replace_fields(
        file_map["word/document.xml"],
        row_fields,
        field_style_overrides,
    )
    file_map["word/document.xml"] = replace_literal_paragraphs(
        file_map["word/document.xml"],
        text_replacements,
    )
    file_map["word/document.xml"] = replace_literal_text_nodes(
        file_map["word/document.xml"],
        text_replacements,
    )
    if "word/settings.xml" in file_map:
        file_map["word/settings.xml"] = strip_mail_merge(
            file_map["word/settings.xml"].decode("utf-8")
        ).encode("utf-8")

    if photo is not None:
        (
            file_map["word/document.xml"],
            file_map["word/_rels/document.xml.rels"],
            file_map["[Content_Types].xml"],
            media_name,
            image_bytes,
        ) = attach_photo(
            file_map["word/document.xml"],
            file_map["word/_rels/document.xml.rels"],
            file_map["[Content_Types].xml"],
            photo,
        )
        file_map[f"word/media/{media_name}"] = image_bytes

    file_map["word/document.xml"] = trim_trailing_empty_body_paragraphs(
        file_map["word/document.xml"]
    )

    with ZipFile(output, "w", compression=ZIP_DEFLATED) as target_zip:
        for file_name, data in file_map.items():
            target_zip.writestr(file_name, data)

    return output.getvalue()


def build_preview_document(template_path: Path, output_path: Path, rows: list[dict[str, object]]) -> None:
    rendered_docs = [
        render_filled_docx_bytes(
            template_path,
            row["fields"],
            row["photo"],
            row.get("textReplacements", []),
            row.get("fieldStyleOverrides", {}),
        )
        for row in rows
    ]
    base_doc_bytes = rendered_docs[0]

    with ZipFile(BytesIO(base_doc_bytes)) as base_zip:
        file_map = {
            source_info.filename: base_zip.read(source_info.filename)
            for source_info in base_zip.infolist()
        }

    document_xml = file_map["word/document.xml"]
    namespaces = collect_doc_namespaces(document_xml)
    register_doc_namespaces(namespaces)
    root = ET.fromstring(document_xml)
    body = root.find(f"{W}body")
    rels_root = ET.fromstring(file_map["word/_rels/document.xml.rels"])

    if body is None:
        raise RuntimeError("В шаблоне не найден body документа Word.")

    section_properties = None
    if len(body) > 0 and body[-1].tag == f"{W}sectPr":
        section_properties = deepcopy(body[-1])
        body.remove(body[-1])

    for rendered_doc_bytes in rendered_docs[1:]:
        with ZipFile(BytesIO(rendered_doc_bytes)) as rendered_zip:
            rendered_root = ET.fromstring(rendered_zip.read("word/document.xml"))
            rendered_body = rendered_root.find(f"{W}body")
            rendered_rels_root = ET.fromstring(rendered_zip.read("word/_rels/document.xml.rels"))

            if rendered_body is None:
                raise RuntimeError("Не удалось прочитать одну из сформированных страниц документа.")

            for relationship in rendered_rels_root.findall(f"{REL}Relationship"):
                if relationship.attrib.get("Type") != IMAGE_REL_TYPE:
                    continue

                old_relationship_id = relationship.attrib.get("Id")
                target = relationship.attrib.get("Target")

                if not old_relationship_id or not target:
                    continue

                media_name = f"preview-{len(file_map)}-{Path(target).name}"
                new_target = f"media/{media_name}"
                new_relationship_id = next_relationship_id(rels_root)

                ET.SubElement(
                    rels_root,
                    f"{REL}Relationship",
                    {
                        "Id": new_relationship_id,
                        "Type": IMAGE_REL_TYPE,
                        "Target": new_target,
                    },
                )

                for element in rendered_root.iter():
                    if element.attrib.get(f"{DOC_REL}id") == old_relationship_id:
                        element.set(f"{DOC_REL}id", new_relationship_id)

                file_map[f"word/{new_target}"] = rendered_zip.read(f"word/{target}")
                extension = Path(media_name).suffix.lstrip(".").lower()
                if extension in {"jpg", "jpeg"}:
                    file_map["[Content_Types].xml"] = ensure_content_type_default(
                        file_map["[Content_Types].xml"],
                        extension,
                        "image/jpeg",
                    )
                elif extension == "png":
                    file_map["[Content_Types].xml"] = ensure_content_type_default(
                        file_map["[Content_Types].xml"],
                        extension,
                        "image/png",
                    )

        body.append(build_page_break_paragraph())

        for child in list(rendered_body):
            if child.tag == f"{W}sectPr":
                continue
            body.append(deepcopy(child))

    if section_properties is not None:
        body.append(section_properties)

    file_map["word/document.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    file_map["word/_rels/document.xml.rels"] = ET.tostring(
        rels_root,
        encoding="utf-8",
        xml_declaration=True,
    )

    with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as target_zip:
        for file_name, data in file_map.items():
            target_zip.writestr(file_name, data)


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "Usage: generate_biot_mail_merge_bundle.py <template.docx> <output.docx>",
            file=sys.stderr,
        )
        return 1

    template_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not template_path.exists():
        print("DOCX-шаблон не найден.", file=sys.stderr)
        return 1

    try:
        rows = validate_payload(read_json_stdin())
        build_preview_document(template_path, output_path, rows)
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

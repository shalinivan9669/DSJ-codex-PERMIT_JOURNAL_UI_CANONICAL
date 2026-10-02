#!/usr/bin/env python3

import base64
import json
import re
import sys
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile


MAIL_MERGE_PATTERN = re.compile(r"<w:mailMerge>.*?</w:mailMerge>", re.DOTALL)
MERGEFIELD_NAME_PATTERN = re.compile(r'^MERGEFIELD\s+(".*?"|[^\s\\]+)')
RESERVED_NAMESPACE_PREFIX_PATTERN = re.compile(r"ns\d+$")
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
VML_NS = "urn:schemas-microsoft-com:vml"
OFFICE_NS = "urn:schemas-microsoft-com:office:office"
W = f"{{{WORD_NS}}}"
V = f"{{{VML_NS}}}"
REL = f"{{{REL_NS}}}"
DOC_REL = f"{{{DOC_REL_NS}}}"
CT = f"{{{CONTENT_TYPES_NS}}}"
O = f"{{{OFFICE_NS}}}"


def read_json_stdin() -> object:
    return json.loads(sys.stdin.buffer.read().decode("utf-8"))


def normalize_value(value: object) -> str:
    if value is None:
        return ""
    return str(value).replace("\r\n", " ").replace("\n", " ").strip()


def collect_namespaces(xml_bytes: bytes) -> dict[str, str]:
    namespaces: dict[str, str] = {}
    for _event, namespace in ET.iterparse(BytesIO(xml_bytes), events=("start-ns",)):
        prefix, uri = namespace
        namespaces[prefix] = uri
    return namespaces


def register_namespaces(namespaces: dict[str, str]) -> None:
    for prefix, uri in namespaces.items():
        # ElementTree reserves the ns\d+ prefix family for auto-generated output.
        # Re-registering them raises ValueError, but skipping them preserves the
        # original XML semantics and lets ElementTree allocate them as needed.
        if RESERVED_NAMESPACE_PREFIX_PATTERN.fullmatch(prefix):
            continue
        ET.register_namespace(prefix, uri)


def get_field_char_type(run: ET.Element) -> str | None:
    field_char = run.find(f"{W}fldChar")
    if field_char is None:
        return None
    return field_char.attrib.get(f"{W}fldCharType")


def normalize_instr_text(value: str | None) -> str:
    return " ".join((value or "").split())


def normalize_match_text(value: str | None) -> str:
    return " ".join((value or "").split())


def extract_merge_field_name(instr_text: str) -> str | None:
    match = MERGEFIELD_NAME_PATTERN.match(instr_text)
    if not match:
        return None
    return match.group(1)


def set_text_value(text_node: ET.Element, value: str) -> None:
    text_node.text = value
    if value.startswith(" ") or value.endswith(" "):
        text_node.set(f"{{{XML_NS}}}space", "preserve")


def get_run_font_size(run: ET.Element) -> int | None:
    size_node = run.find(f"{W}rPr/{W}sz")
    if size_node is None:
        return None

    raw_value = size_node.attrib.get(f"{W}val")
    if raw_value is None:
        return None

    try:
        return int(raw_value)
    except ValueError:
        return None


def ensure_times_new_roman(run: ET.Element) -> None:
    rpr = run.find(f"{W}rPr")
    if rpr is None:
        rpr = ET.Element(f"{W}rPr")
        run.insert(0, rpr)

    rfonts = rpr.find(f"{W}rFonts")
    if rfonts is None:
        rfonts = ET.Element(f"{W}rFonts")
        rpr.insert(0, rfonts)

    for attr_name in ("ascii", "hAnsi", "cs", "eastAsia"):
        rfonts.set(f"{W}{attr_name}", "Times New Roman")

    if rpr.find(f"{W}sz") is None:
        sz = ET.Element(f"{W}sz")
        sz.set(f"{W}val", "20")
        rpr.append(sz)

    if rpr.find(f"{W}szCs") is None:
        sz_cs = ET.Element(f"{W}szCs")
        sz_cs.set(f"{W}val", "20")
        rpr.append(sz_cs)


def set_run_font_size(run: ET.Element, size_half_points: int | None) -> None:
    if size_half_points is None:
        return

    rpr = run.find(f"{W}rPr")
    if rpr is None:
        rpr = ET.Element(f"{W}rPr")
        run.insert(0, rpr)

    sz = rpr.find(f"{W}sz")
    if sz is None:
        sz = ET.Element(f"{W}sz")
        rpr.append(sz)
    sz.set(f"{W}val", str(int(size_half_points)))

    sz_cs = rpr.find(f"{W}szCs")
    if sz_cs is None:
        sz_cs = ET.Element(f"{W}szCs")
        rpr.append(sz_cs)
    sz_cs.set(f"{W}val", str(int(size_half_points)))


def pick_result_text_node(runs: list[ET.Element]) -> tuple[ET.Element, ET.Element, list[ET.Element]]:
    candidates: list[tuple[ET.Element, int | None, ET.Element]] = []

    for run in runs:
        run_size = get_run_font_size(run)
        for text_node in run.findall(f".//{W}t"):
            candidates.append((text_node, run_size, run))

    if not candidates:
        raise RuntimeError("В шаблоне не найден результат для одного из merge-полей.")

    # Word-шаблоны корочек иногда держат рядом несколько пустых run разного кегля.
    # Берем самый крупный кегль не больше 12pt (w:sz=24), чтобы текст не выделялся.
    bounded_candidates = [
        (text_node, font_size)
        for text_node, font_size, _run in candidates
        if font_size is not None and font_size <= 24
    ]

    if bounded_candidates:
        target_size = max(font_size for _text_node, font_size in bounded_candidates)
        chosen_text_node, chosen_run = next(
            (text_node, run)
            for text_node, font_size, run in candidates
            if font_size == target_size and font_size is not None and font_size <= 24
        )
    else:
        sized_candidates = [
            (text_node, font_size, run)
            for text_node, font_size, run in candidates
            if font_size is not None
        ]

        if sized_candidates:
            target_size = min(font_size for _text_node, font_size, _run in sized_candidates)
            chosen_text_node, chosen_run = next(
                (text_node, run)
                for text_node, font_size, run in sized_candidates
                if font_size == target_size
            )
        else:
            chosen_text_node, _font_size, chosen_run = candidates[0]

    remaining_text_nodes = [
        text_node for text_node, _font_size, _run in candidates if text_node is not chosen_text_node
    ]
    return chosen_text_node, chosen_run, remaining_text_nodes


def decode_image_data_url(data_url: str) -> tuple[str, bytes, str]:
    match = re.match(r"^data:image/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$", data_url, re.IGNORECASE)
    if not match:
        raise RuntimeError("Передан некорректный формат фото.")

    image_type = match.group(1).lower()
    extension = "jpg" if image_type in {"jpg", "jpeg"} else "png"
    content_type = "image/jpeg" if extension == "jpg" else "image/png"
    return content_type, base64.b64decode(match.group(2)), extension


def validate_photo_payload(photo: object | None) -> dict[str, object] | None:
    if photo is None:
        return None

    if not isinstance(photo, dict):
        raise RuntimeError("Передан некорректный payload фото.")

    data_url = photo.get("dataUrl")
    slot = photo.get("slot")

    if not isinstance(data_url, str) or not data_url.strip():
        raise RuntimeError("Для фото не передан dataUrl.")

    if not isinstance(slot, dict):
        raise RuntimeError("Для фото не передан слот вставки.")

    mode = slot.get("mode")
    if mode == "existing_rect":
        rect_id = slot.get("rectId")
        if not isinstance(rect_id, str) or not rect_id.strip():
            raise RuntimeError("Не указан rectId для вставки фото.")
    elif mode == "floating_rect":
        shape_id = slot.get("shapeId")
        style = slot.get("style")
        if not isinstance(shape_id, str) or not shape_id.strip() or not isinstance(style, str) or not style.strip():
            raise RuntimeError("Некорректная конфигурация плавающего фото-слота.")
    else:
        raise RuntimeError("Неизвестный режим вставки фото.")

    file_name = photo.get("fileName")
    return {
        "dataUrl": data_url.strip(),
        "fileName": file_name.strip() if isinstance(file_name, str) and file_name.strip() else "",
        "slot": slot,
    }


def validate_text_replacements(payload: object | None) -> list[dict[str, object]]:
    if payload is None:
        return []

    if not isinstance(payload, list):
        raise RuntimeError("Передан некорректный список текстовых замен.")

    replacements: list[dict[str, object]] = []
    for entry in payload:
        if not isinstance(entry, dict):
            raise RuntimeError("Одна из текстовых замен передана в неверном формате.")

        raw_match_text = entry.get("matchText")
        raw_replace_text = entry.get("replaceText")
        match_text = "" if raw_match_text is None else str(raw_match_text).replace("\r\n", " ").replace("\n", " ")
        replace_text = "" if raw_replace_text is None else str(raw_replace_text).replace("\r\n", " ").replace("\n", " ")
        mode = normalize_value(entry.get("mode")) or "paragraph"
        right_tab_stop_pt = entry.get("rightTabStopPt")

        if not match_text.strip():
            raise RuntimeError("Одна из текстовых замен не содержит исходный текст.")

        if mode not in {"paragraph", "text", "styled_paragraph"}:
            raise RuntimeError("Одна из текстовых замен содержит неизвестный режим.")

        if right_tab_stop_pt is not None and not isinstance(right_tab_stop_pt, (int, float)):
            raise RuntimeError("Одна из текстовых замен содержит некорректный tab stop.")

        segments_payload = entry.get("segments")
        segments: list[dict[str, object]] = []
        if mode == "styled_paragraph":
            if not isinstance(segments_payload, list) or not segments_payload:
                raise RuntimeError("Одна из styled-замен не содержит сегменты текста.")

            for segment in segments_payload:
                if not isinstance(segment, dict):
                    raise RuntimeError("Один из сегментов styled-замены передан в неверном формате.")

                segment_text = segment.get("text")
                if not isinstance(segment_text, str) or not segment_text:
                    raise RuntimeError("Один из сегментов styled-замены не содержит текст.")

                bold = segment.get("bold")
                if bold is not None and not isinstance(bold, bool):
                    raise RuntimeError("Один из сегментов styled-замены содержит некорректный bold-флаг.")

                segments.append(
                    {
                        "text": segment_text.replace("\r\n", " ").replace("\n", " "),
                        "bold": bold,
                    }
                )

        replacements.append(
            {
                "matchText": match_text,
                "replaceText": replace_text,
                "mode": mode,
                "rightTabStopPt": right_tab_stop_pt,
                "segments": segments,
            }
        )

    return replacements


def validate_field_style_overrides(payload: object | None) -> dict[str, dict[str, int]]:
    if payload is None:
        return {}

    if not isinstance(payload, dict):
        raise RuntimeError("Передан некорректный список стилевых настроек полей.")

    overrides: dict[str, dict[str, int]] = {}
    for field_name, raw_settings in payload.items():
        if not isinstance(raw_settings, dict):
            raise RuntimeError("Одна из стилевых настроек поля передана в неверном формате.")

        font_size = raw_settings.get("fontSize")
        if font_size is not None and not isinstance(font_size, int):
            raise RuntimeError("Размер шрифта для одного из полей указан неверно.")

        overrides[str(field_name)] = {
            "fontSize": font_size,
        }

    return overrides


def validate_payload(
    payload: object,
) -> tuple[
    dict[str, str],
    dict[str, object] | None,
    list[dict[str, object]],
    dict[str, dict[str, int]],
]:
    if not isinstance(payload, dict):
        raise RuntimeError("Переданы некорректные данные merge-полей.")

    fields = payload.get("fields")
    if not isinstance(fields, dict):
        raise RuntimeError("Переданы некорректные данные merge-полей.")

    return (
        {str(key): normalize_value(value) for key, value in fields.items()},
        validate_photo_payload(payload.get("photo")),
        validate_text_replacements(payload.get("textReplacements")),
        validate_field_style_overrides(payload.get("fieldStyleOverrides")),
    )


def is_blank_text_run(run: ET.Element) -> bool:
    text_nodes = run.findall(f".//{W}t")
    if not text_nodes:
        return False
    return all(((text_node.text or "").strip() == "") for text_node in text_nodes)


def fill_field_result(
    children: list[ET.Element],
    separate_index: int,
    end_index: int,
    value: str,
    font_size_override: int | None = None,
) -> None:
    result_runs = [child for child in children[separate_index + 1 : end_index] if child.tag == f"{W}r"]
    target_text_node, target_run, remaining_text_nodes = pick_result_text_node(result_runs)
    ensure_times_new_roman(target_run)
    set_run_font_size(target_run, font_size_override)
    set_text_value(target_text_node, value)
    for text_node in remaining_text_nodes:
        text_node.text = ""


def fill_field_result_without_separate(
    parent: ET.Element,
    children: list[ET.Element],
    end_index: int,
    value: str,
    font_size_override: int | None = None,
) -> None:
    result_runs: list[ET.Element] = []

    for child in children[end_index + 1 :]:
        if child.tag != f"{W}r":
            break

        if get_field_char_type(child) is not None or child.find(f"{W}instrText") is not None:
            break

        if not is_blank_text_run(child):
            break

        result_runs.append(child)

    if not result_runs:
        run = ET.Element(f"{W}r")
        text_node = ET.SubElement(run, f"{W}t")
        ensure_times_new_roman(run)
        set_run_font_size(run, font_size_override)
        set_text_value(text_node, value)
        parent.insert(end_index + 1, run)
        return

    target_text_node, target_run, remaining_text_nodes = pick_result_text_node(result_runs)
    ensure_times_new_roman(target_run)
    set_run_font_size(target_run, font_size_override)
    set_text_value(target_text_node, value)
    for text_node in remaining_text_nodes:
        text_node.text = ""


def find_run_for_text_node(paragraph: ET.Element, target_text_node: ET.Element) -> ET.Element | None:
    for run in paragraph.findall(f".//{W}r"):
        for text_node in run.findall(f".//{W}t"):
            if text_node is target_text_node:
                return run
    return None


def clone_run_style(source_run: ET.Element) -> ET.Element:
    cloned_run = ET.Element(f"{W}r")
    source_rpr = source_run.find(f"{W}rPr")
    if source_rpr is not None:
        cloned_run.append(deepcopy(source_rpr))
    ensure_times_new_roman(cloned_run)
    return cloned_run


def set_run_bold(run: ET.Element, bold: bool | None) -> None:
    rpr = run.find(f"{W}rPr")
    if rpr is None:
        rpr = ET.Element(f"{W}rPr")
        run.insert(0, rpr)

    for tag_name in (f"{W}b", f"{W}bCs"):
        for node in list(rpr.findall(tag_name)):
            rpr.remove(node)

    if bold is None:
        return

    attrs = {} if bold else {f"{W}val": "0"}
    ET.SubElement(rpr, f"{W}b", attrs)
    ET.SubElement(rpr, f"{W}bCs", attrs)


def insert_run_after(paragraph: ET.Element, anchor_run: ET.Element, new_run: ET.Element) -> ET.Element:
    children = list(paragraph)
    anchor_index = children.index(anchor_run)
    paragraph.insert(anchor_index + 1, new_run)
    return new_run


def apply_tabbed_paragraph_replacement(
    paragraph: ET.Element,
    anchor_run: ET.Element,
    anchor_text_node: ET.Element,
    replacement_text: str,
    remaining_text_nodes: list[ET.Element],
) -> None:
    left_text, right_text = replacement_text.split("\t", 1)
    set_text_value(anchor_text_node, left_text)

    for text_node in remaining_text_nodes:
        text_node.text = ""

    tab_run = clone_run_style(anchor_run)
    ET.SubElement(tab_run, f"{W}tab")
    insert_run_after(paragraph, anchor_run, tab_run)

    right_run = clone_run_style(anchor_run)
    right_text_node = ET.SubElement(right_run, f"{W}t")
    set_text_value(right_text_node, right_text)
    insert_run_after(paragraph, tab_run, right_run)


def replace_fields(
    document_xml_bytes: bytes,
    fields: dict[str, str],
    field_style_overrides: dict[str, dict[str, int]] | None = None,
) -> bytes:
    namespaces = collect_namespaces(document_xml_bytes)
    register_namespaces(namespaces)
    root = ET.fromstring(document_xml_bytes)
    replaced_fields: set[str] = set()
    field_style_overrides = field_style_overrides or {}

    for parent in root.iter():
        children = list(parent)
        if not children:
            continue

        index = 0
        while index < len(children):
            child = children[index]
            if child.tag != f"{W}r" or get_field_char_type(child) != "begin":
                index += 1
                continue

            separate_index = None
            end_index = None
            field_instruction_parts: list[str] = []

            for cursor in range(index + 1, len(children)):
                sibling = children[cursor]
                if sibling.tag != f"{W}r":
                    continue

                field_char_type = get_field_char_type(sibling)
                if field_char_type == "separate" and separate_index is None:
                    separate_index = cursor
                    continue

                if field_char_type == "end":
                    end_index = cursor
                    break

                for instr_text in sibling.findall(f"{W}instrText"):
                    if instr_text.text:
                        field_instruction_parts.append(instr_text.text)

            if end_index is None:
                raise RuntimeError("Одно из merge-полей не удалось корректно разобрать в шаблоне.")

            field_instruction = normalize_instr_text("".join(field_instruction_parts))
            field_name = extract_merge_field_name(field_instruction)

            if field_name and field_name in fields:
                font_size_override = field_style_overrides.get(field_name, {}).get("fontSize")
                if separate_index is not None:
                    fill_field_result(
                        children,
                        separate_index,
                        end_index,
                        normalize_value(fields[field_name]),
                        font_size_override,
                    )
                else:
                    fill_field_result_without_separate(
                        parent,
                        children,
                        end_index,
                        normalize_value(fields[field_name]),
                        font_size_override,
                    )
                replaced_fields.add(field_name)

            index = end_index + 1

    missing_fields = [field_name for field_name in fields if field_name not in replaced_fields]
    if missing_fields:
        raise RuntimeError(f"Поля не найдены в DOCX-шаблоне: {', '.join(missing_fields)}")

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def replace_literal_paragraphs(
    document_xml_bytes: bytes, replacements: list[dict[str, object]]
) -> bytes:
    paragraph_replacements = [
        replacement
        for replacement in replacements
        if replacement.get("mode", "paragraph") in {"paragraph", "styled_paragraph"}
    ]

    if not paragraph_replacements:
        return document_xml_bytes

    namespaces = collect_namespaces(document_xml_bytes)
    register_namespaces(namespaces)
    root = ET.fromstring(document_xml_bytes)
    replaced_matches: set[str] = set()

    def ensure_right_tab_stop(paragraph: ET.Element, position_pt: float) -> None:
        ppr = paragraph.find(f"{W}pPr")
        if ppr is None:
            ppr = ET.Element(f"{W}pPr")
            paragraph.insert(0, ppr)

        tabs = ppr.find(f"{W}tabs")
        if tabs is None:
            tabs = ET.Element(f"{W}tabs")
            ppr.insert(0, tabs)
        else:
            for child in list(tabs):
                tabs.remove(child)

        ET.SubElement(
            tabs,
            f"{W}tab",
            {
                f"{W}val": "right",
                f"{W}pos": str(int(round(float(position_pt) * 20))),
            },
        )

    def strip_tab_runs(paragraph: ET.Element) -> None:
        for run in paragraph.findall(f"{W}r"):
            for tab in run.findall(f"{W}tab"):
                run.remove(tab)

    def replace_paragraph_with_styled_runs(
        paragraph: ET.Element,
        source_run: ET.Element,
        segments: list[dict[str, object]],
    ) -> None:
        children = list(paragraph)
        first_run_index = next(
            (index for index, child in enumerate(children) if child.tag == f"{W}r"),
            len(children),
        )

        for child in list(paragraph):
            if child.tag in {f"{W}r", f"{W}proofErr"}:
                paragraph.remove(child)

        insert_index = first_run_index
        previous_run: ET.Element | None = None

        for segment in segments:
            new_run = clone_run_style(source_run)
            set_run_bold(new_run, segment.get("bold"))
            text_node = ET.SubElement(new_run, f"{W}t")
            set_text_value(text_node, str(segment["text"]))

            if previous_run is None:
                paragraph.insert(insert_index, new_run)
            else:
                insert_run_after(paragraph, previous_run, new_run)
            previous_run = new_run

    for paragraph in root.findall(f".//{W}p"):
        text_nodes = paragraph.findall(f".//{W}t")
        if not text_nodes:
            continue

        paragraph_text = "".join((text_node.text or "") for text_node in text_nodes)
        normalized_paragraph_text = normalize_match_text(paragraph_text)
        for replacement in paragraph_replacements:
            match_text = replacement["matchText"]
            if (
                paragraph_text != match_text
                and normalized_paragraph_text != normalize_match_text(match_text)
            ):
                continue

            target_run = find_run_for_text_node(paragraph, text_nodes[0])
            if target_run is not None:
                ensure_times_new_roman(target_run)
            if replacement.get("mode") == "styled_paragraph":
                if target_run is None:
                    raise RuntimeError("Для styled-замены не найден исходный run в абзаце.")
                replace_paragraph_with_styled_runs(
                    paragraph,
                    target_run,
                    replacement.get("segments") or [],
                )
                replaced_matches.add(match_text)
                break
            if replacement.get("rightTabStopPt") is not None:
                ensure_right_tab_stop(paragraph, float(replacement["rightTabStopPt"]))
                strip_tab_runs(paragraph)
            if (
                replacement.get("rightTabStopPt") is not None
                and "\t" in replacement["replaceText"]
                and target_run is not None
            ):
                apply_tabbed_paragraph_replacement(
                    paragraph,
                    target_run,
                    text_nodes[0],
                    replacement["replaceText"],
                    text_nodes[1:],
                )
            else:
                set_text_value(text_nodes[0], replacement["replaceText"])
                for text_node in text_nodes[1:]:
                    text_node.text = ""
            replaced_matches.add(match_text)
            break

    missing_matches = [
        replacement["matchText"]
        for replacement in paragraph_replacements
        if replacement["matchText"] not in replaced_matches
    ]
    if missing_matches:
        raise RuntimeError(
            f"Текстовые блоки не найдены в DOCX-шаблоне: {', '.join(missing_matches)}"
        )

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def replace_literal_text_nodes(
    document_xml_bytes: bytes, replacements: list[dict[str, object]]
) -> bytes:
    text_replacements = [
        replacement for replacement in replacements if replacement.get("mode") == "text"
    ]

    if not text_replacements:
        return document_xml_bytes

    namespaces = collect_namespaces(document_xml_bytes)
    register_namespaces(namespaces)
    root = ET.fromstring(document_xml_bytes)
    replaced_matches: set[str] = set()

    for paragraph in root.findall(f".//{W}p"):
        for run in paragraph.findall(f".//{W}r"):
            text_nodes = run.findall(f".//{W}t")
            if not text_nodes:
                continue

            for text_node in text_nodes:
                raw_text = text_node.text or ""
                normalized_text = normalize_match_text(raw_text)

                for replacement in text_replacements:
                    match_text = replacement["matchText"]
                    if (
                        raw_text != match_text
                        and normalized_text != normalize_match_text(match_text)
                    ):
                        continue

                    ensure_times_new_roman(run)
                    set_text_value(text_node, replacement["replaceText"])
                    replaced_matches.add(match_text)
                    break

    missing_matches = [
        replacement["matchText"]
        for replacement in text_replacements
        if replacement["matchText"] not in replaced_matches
    ]
    if missing_matches:
        raise RuntimeError(
            f"Текстовые фрагменты не найдены в DOCX-шаблоне: {', '.join(missing_matches)}"
        )

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def ensure_content_type_default(content_types_xml: bytes, extension: str, content_type: str) -> bytes:
    root = ET.fromstring(content_types_xml)
    for default_node in root.findall(f"{CT}Default"):
        if default_node.attrib.get("Extension", "").lower() == extension.lower():
            default_node.set("ContentType", content_type)
            return ET.tostring(root, encoding="utf-8", xml_declaration=True)

    ET.SubElement(
        root,
        f"{CT}Default",
        {
            "Extension": extension,
            "ContentType": content_type,
        },
    )
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def next_relationship_id(rels_root: ET.Element) -> str:
    max_number = 0
    for relation in rels_root.findall(f"{REL}Relationship"):
        rel_id = relation.attrib.get("Id", "")
        match = re.match(r"rId(\d+)$", rel_id)
        if match:
            max_number = max(max_number, int(match.group(1)))
    return f"rId{max_number + 1}"


def add_image_relationship(rels_xml: bytes, media_target: str) -> tuple[bytes, str]:
    root = ET.fromstring(rels_xml)
    relationship_id = next_relationship_id(root)
    ET.SubElement(
        root,
        f"{REL}Relationship",
        {
            "Id": relationship_id,
            "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
            "Target": media_target,
        },
    )
    return ET.tostring(root, encoding="utf-8", xml_declaration=True), relationship_id


def apply_image_to_rect(rect: ET.Element, relationship_id: str, title: str) -> None:
    for child in list(rect):
        if child.tag == f"{V}imagedata":
            rect.remove(child)

    rect.set("stroked", "f")
    rect.set("filled", "t")

    image_node = ET.SubElement(rect, f"{V}imagedata")
    image_node.set(f"{DOC_REL}id", relationship_id)
    image_node.set(f"{O}title", title)


def find_photo_rect(root: ET.Element, rect_id: str) -> ET.Element | None:
    for rect in root.findall(f".//{V}rect"):
        if rect.attrib.get("id") == rect_id:
            return rect
    return None


def insert_floating_photo(root: ET.Element, relationship_id: str, title: str, slot: dict[str, object]) -> None:
    body = root.find(f"{W}body")
    if body is None:
        raise RuntimeError("В шаблоне не найден body документа Word.")

    first_paragraph = next((child for child in body if child.tag == f"{W}p"), None)
    if first_paragraph is None:
        raise RuntimeError("В шаблоне не найден абзац для вставки фото.")

    run = ET.Element(f"{W}r")
    pict = ET.SubElement(run, f"{W}pict")
    rect = ET.SubElement(
        pict,
        f"{V}rect",
        {
            "id": str(slot["shapeId"]),
            "style": str(slot["style"]),
            "stroked": "f",
            "filled": "t",
        },
    )
    image_node = ET.SubElement(rect, f"{V}imagedata")
    image_node.set(f"{DOC_REL}id", relationship_id)
    image_node.set(f"{O}title", title)
    first_paragraph.insert(0, run)


def attach_photo(
    document_xml_bytes: bytes,
    rels_xml: bytes,
    content_types_xml: bytes,
    photo: dict[str, object],
) -> tuple[bytes, bytes, bytes, str, bytes]:
    content_type, image_bytes, extension = decode_image_data_url(str(photo["dataUrl"]))
    media_name = f"generated-photo-{abs(hash(str(photo.get('fileName', 'photo'))))}.{extension}"
    media_target = f"media/{media_name}"
    updated_rels_xml, relationship_id = add_image_relationship(rels_xml, media_target)

    namespaces = collect_namespaces(document_xml_bytes)
    register_namespaces(namespaces)
    root = ET.fromstring(document_xml_bytes)
    slot = photo["slot"]

    if not isinstance(slot, dict):
        raise RuntimeError("Передан некорректный слот фото.")

    title = str(photo.get("fileName") or "")
    if slot.get("mode") == "existing_rect":
        rect = find_photo_rect(root, str(slot["rectId"]))
        if rect is None:
            raise RuntimeError("В шаблоне не найден прямоугольник для вставки фото.")
        apply_image_to_rect(rect, relationship_id, title)
    else:
        insert_floating_photo(root, relationship_id, title, slot)

    updated_document_xml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    updated_content_types_xml = ensure_content_type_default(content_types_xml, extension, content_type)
    return updated_document_xml, updated_rels_xml, updated_content_types_xml, media_name, image_bytes


def paragraph_has_rendered_content(paragraph: ET.Element) -> bool:
    if any((text_node.text or "").strip() for text_node in paragraph.findall(f".//{W}t")):
        return True

    for tag_name in (
        "drawing",
        "pict",
        "object",
        "fldChar",
        "instrText",
        "br",
        "lastRenderedPageBreak",
        "bookmarkStart",
        "bookmarkEnd",
        "commentReference",
        "footnoteReference",
        "endnoteReference",
    ):
        if paragraph.find(f".//{W}{tag_name}") is not None:
            return True

    return False


def trim_trailing_empty_body_paragraphs(document_xml_bytes: bytes) -> bytes:
    namespaces = collect_namespaces(document_xml_bytes)
    register_namespaces(namespaces)
    root = ET.fromstring(document_xml_bytes)
    body = root.find(f"{W}body")
    if body is None:
        return document_xml_bytes

    children = list(body)
    if not children:
        return document_xml_bytes

    # Some Word templates keep dozens of top-level empty paragraphs after the
    # last positioned shape; Word renders them as extra blank pages.
    last_content_index = len(children) - 1
    if children[-1].tag == f"{W}sectPr":
        last_content_index -= 1

    removed_any = False
    while last_content_index >= 0:
        child = children[last_content_index]
        if child.tag != f"{W}p" or paragraph_has_rendered_content(child):
            break

        body.remove(child)
        removed_any = True
        last_content_index -= 1

    if not removed_any:
        return document_xml_bytes

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def strip_mail_merge(settings_xml: str) -> str:
    return MAIL_MERGE_PATTERN.sub("", settings_xml)


def render(
    template_path: Path,
    output_path: Path,
    fields: dict[str, str],
    photo: dict[str, object] | None = None,
    text_replacements: list[dict[str, object]] | None = None,
    field_style_overrides: dict[str, dict[str, int]] | None = None,
) -> None:
    with ZipFile(template_path) as source_zip:
        file_map = {}
        for source_info in source_zip.infolist():
            if source_info.filename == "word/_rels/settings.xml.rels":
                continue
            file_map[source_info.filename] = source_zip.read(source_info.filename)

    file_map["word/document.xml"] = replace_fields(
        file_map["word/document.xml"],
        fields,
        field_style_overrides,
    )
    file_map["word/document.xml"] = replace_literal_paragraphs(
        file_map["word/document.xml"], text_replacements or []
    )
    file_map["word/document.xml"] = replace_literal_text_nodes(
        file_map["word/document.xml"], text_replacements or []
    )
    if "word/settings.xml" in file_map:
        settings_xml = file_map["word/settings.xml"].decode("utf-8")
        file_map["word/settings.xml"] = strip_mail_merge(settings_xml).encode("utf-8")

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

    with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as target_zip:
        for file_name, data in file_map.items():
            target_zip.writestr(file_name, data)


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: generate_biot_card.py <template.docx> <output.docx>", file=sys.stderr)
        return 1

    template_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    if not template_path.exists():
        print("DOCX-шаблон не найден.", file=sys.stderr)
        return 1

    try:
        fields, photo, text_replacements, field_style_overrides = validate_payload(
            read_json_stdin()
        )
        render(
            template_path,
            output_path,
            fields,
            photo,
            text_replacements,
            field_style_overrides,
        )
    except Exception as error:  # noqa: BLE001
        print(str(error), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

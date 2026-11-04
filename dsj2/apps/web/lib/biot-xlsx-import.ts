import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { Unzip, UnzipInflate } from "fflate";

export type BiotImportRow = {
  rowNumber: number;
  fullName: string;
  positionRu: string;
  positionKz: string;
  certificateNumber: string;
  protocolNumber: string;
  witnessCertificateNumber: string;
  witnessRegistrationNumber: string;
  photo: { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" } | null;
};

export type BiotImportResult = {
  rows: BiotImportRow[];
  errors: Array<{ rowNumber: number; field: string; message: string }>;
};

const HEADERS = ["ФИО", "Должность RU", "Должность KZ", "Номер удостоверения", "Номер протокола", "Номер КБ", "Регистрационный номер"];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_ROWS = 100;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 40_000_000;
const MAX_PHOTO_SIDE = 12_000;
const SHEET_DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const INVALID_FILE = "Не удалось прочитать файл XLSX. Проверьте файл и используйте шаблон приложения.";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) current = (current >>> 1) ^ (current & 1 ? 0xedb88320 : 0);
  return current >>> 0;
});

function directoryNames(data: Uint8Array): Map<string, { crc: number; size: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let pos = data.length - 22; pos >= Math.max(0, data.length - 65557); pos -= 1) {
    if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === data.length) { end = pos; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error(INVALID_FILE);
  const count = view.getUint16(end + 10, true);
  const length = view.getUint32(end + 12, true);
  let pos = view.getUint32(end + 16, true);
  const directoryStart = pos;
  if (!count || count > MAX_FILES || count !== view.getUint16(end + 8, true) || pos + length !== end) throw new Error(INVALID_FILE);
  const names = new Map<string, { crc: number; size: number }>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index += 1) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) throw new Error(INVALID_FILE);
    const flags = view.getUint16(pos + 8, true);
    const compression = view.getUint16(pos + 10, true);
    const size = view.getUint32(pos + 20, true);
    const unpacked = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    const next = pos + 46 + nameLength + extraLength + commentLength;
    if (flags & 1 || (compression !== 0 && compression !== 8) || size === 0xffffffff || unpacked === 0xffffffff || next > end || local + 30 > end || view.getUint32(local, true) !== 0x04034b50) throw new Error(INVALID_FILE);
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    if (local + 30 + localNameLength + localExtraLength + size > directoryStart || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== compression) throw new Error(INVALID_FILE);
    const name = decoder.decode(data.subarray(pos + 46, pos + 46 + nameLength));
    const localName = decoder.decode(data.subarray(local + 30, local + 30 + localNameLength));
    if (name !== localName || names.has(name)) throw new Error(INVALID_FILE);
    names.set(name, { crc: view.getUint32(pos + 16, true), size: unpacked });
    pos = next;
  }
  if (pos !== end) throw new Error(INVALID_FILE);
  return names;
}

function unpack(data: Uint8Array): Map<string, Uint8Array> {
  const directory = directoryNames(data);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let count = 0;
  let completed = 0;
  const unzip = new Unzip((entry) => {
    count += 1;
    const name = entry.name;
    if (count > MAX_FILES || !name || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === "." || part === "..") || files.has(name)) {
      throw new Error(INVALID_FILE);
    }
    const expected = directory.get(name);
    if (!expected || expected.size > MAX_UNPACKED_BYTES || (entry.originalSize !== undefined && entry.originalSize > MAX_UNPACKED_BYTES)) throw new Error(INVALID_FILE);
    files.set(name, new Uint8Array());
    const chunks: Uint8Array[] = [];
    let length = 0;
    let crc = 0xffffffff;
    entry.ondata = (error, chunk, final) => {
      if (error) throw new Error(INVALID_FILE);
      total += chunk.length;
      length += chunk.length;
      if (total > MAX_UNPACKED_BYTES) throw new Error("Файл слишком большой после распаковки. Используйте файл меньшего размера.");
      for (let index = 0; index < chunk.length; index += 1) crc = CRC_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8);
      chunks.push(chunk);
      if (final) {
        if (length !== expected.size || ((crc ^ 0xffffffff) >>> 0) !== expected.crc) throw new Error(INVALID_FILE);
        const combined = new Uint8Array(length);
        let offset = 0;
        for (const part of chunks) { combined.set(part, offset); offset += part.length; }
        files.set(name, combined);
        completed += 1;
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  // Small compressed chunks bound each inflate step even if the ZIP declares false sizes.
  for (let offset = 0; offset < data.length; offset += 1024) {
    unzip.push(data.subarray(offset, offset + 1024), offset + 1024 >= data.length);
  }
  if (!count || count !== completed || count !== directory.size || [...files.keys()].some((name) => !directory.has(name))) throw new Error(INVALID_FILE);
  return files;
}

function xml(files: Map<string, Uint8Array>, name: string) {
  const bytes = files.get(name);
  if (!bytes) throw new Error(INVALID_FILE);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(source)) throw new Error(INVALID_FILE);
  let malformed = false;
  const doc = new DOMParser({ onError: () => { malformed = true; } }).parseFromString(source, "application/xml");
  if (malformed || !doc.documentElement) throw new Error(INVALID_FILE);
  return doc;
}

function sheetPath(target: string): string {
  if (!target || target.includes("\\") || target.includes("%") || target.includes("?") || target.includes("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) throw new Error(INVALID_FILE);
  const parts = (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!normalized.length) throw new Error(INVALID_FILE); normalized.pop(); }
    else normalized.push(part);
  }
  const path = normalized.join("/");
  if (!path.startsWith("xl/worksheets/") || !path.endsWith(".xml")) throw new Error(INVALID_FILE);
  return path;
}

function childElements(parent: XmlElement, namespace: string, name: string): XmlElement[] {
  return Array.from(parent.childNodes).filter((node): node is XmlElement =>
    node.nodeType === 1 && (node as XmlElement).namespaceURI === namespace && (node as XmlElement).localName === name,
  );
}

function relationsPath(part: string): string {
  const index = part.lastIndexOf("/");
  return `${part.slice(0, index)}/_rels/${part.slice(index + 1)}.rels`;
}

function relatedPart(files: Map<string, Uint8Array>, source: string, id: string, type: "drawing" | "image"): string {
  let relationships: ReturnType<typeof xml>;
  try { relationships = xml(files, relationsPath(source)); }
  catch { throw new Error("Фото: отсутствует или повреждено описание связи с рисунком."); }
  const matches = Array.from(relationships.getElementsByTagNameNS(PACKAGE_REL_NS, "Relationship"))
    .filter((rel) => rel.getAttribute("Id") === id);
  if (!id || matches.length !== 1 || (matches[0].getAttribute("TargetMode") && matches[0].getAttribute("TargetMode") !== "Internal") ||
      matches[0].getAttribute("Type") !== `${OFFICE_REL_NS}/${type}`) {
    throw new Error("Фото: повреждена или недопустима связь с изображением. Используйте встроенные JPG или PNG.");
  }
  const target = matches[0].getAttribute("Target") ?? "";
  if (!target || target.includes("\\") || target.includes("%") || target.includes("?") || target.includes("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    throw new Error("Фото: внешние или повреждённые ссылки не поддерживаются.");
  }
  const parts = (target.startsWith("/") ? target.slice(1) : `${source.slice(0, source.lastIndexOf("/") + 1)}${target}`).split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!normalized.length) throw new Error("Фото: повреждена ссылка на изображение.");
      normalized.pop();
    } else normalized.push(part);
  }
  const path = normalized.join("/");
  const allowed = type === "drawing" ? /^xl\/drawings\/[^/]+\.xml$/i : /^xl\/media\/[^/]+\.(png|jpe?g)$/i;
  if (!allowed.test(path) || !files.has(path)) throw new Error("Фото: файл изображения или его описание не найдено; нужны встроенные JPG или PNG.");
  return path;
}

export function validateBiotPhoto(bytes: Uint8Array, path: string): { mimeType: "image/jpeg" | "image/png"; width: number; height: number } {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("Фото: размер изображения должен быть не больше 10 МиБ.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let mimeType: "image/jpeg" | "image/png";
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (png && /\.png$/i.test(path) && bytes.length >= 24 && view.getUint32(8) === 13 &&
      bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82) {
    mimeType = "image/png";
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (/\.jpe?g$/i.test(path) && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = "image/jpeg";
    let pos = 2;
    const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (pos < bytes.length) {
      if (bytes[pos++] !== 0xff) break;
      while (bytes[pos] === 0xff) pos += 1;
      const marker = bytes[pos++];
      if (marker === 0xd9 || marker === 0xda || marker === undefined) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (pos + 2 > bytes.length) break;
      const size = view.getUint16(pos);
      if (size < 2 || pos + size > bytes.length) break;
      if (frames.has(marker) && size >= 7) {
        height = view.getUint16(pos + 3);
        width = view.getUint16(pos + 5);
        break;
      }
      pos += size;
    }
  } else {
    throw new Error("Фото: поддерживаются только встроенные изображения JPG и PNG.");
  }
  if (!width || !height || width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE || width * height > MAX_PHOTO_PIXELS) {
    throw new Error("Фото: изображение повреждено или его размеры слишком велики.");
  }
  return { mimeType, width, height };
}

function integerChild(parent: XmlElement, name: string): number | null {
  const items = childElements(parent, SHEET_DRAWING_NS, name);
  if (items.length !== 1 || !/^\d+$/.test(items[0].textContent ?? "")) return null;
  const value = Number(items[0].textContent);
  return Number.isSafeInteger(value) ? value : null;
}

function embeddedPhotos(
  files: Map<string, Uint8Array>, sheet: XmlElement, worksheetPath: string,
  rows: BiotImportRow[], errors: BiotImportResult["errors"],
) {
  if (Array.from(sheet.childNodes).some((node) => node.nodeType === 1 && ["picture", "legacyDrawing", "legacyDrawingHF", "drawingHF"].includes((node as XmlElement).localName ?? ""))) {
    throw new Error("Фото: фоновые и устаревшие рисунки не поддерживаются; вставьте обычное фото поверх ячейки H.");
  }
  const drawings = Array.from(sheet.getElementsByTagNameNS("*", "drawing"));
  if (!drawings.length) return;
  if (drawings.length !== 1) throw new Error("Фото: найдено несколько наборов рисунков. Используйте шаблон с одним фото на строку.");
  const drawingRef = drawings[0].getAttributeNS(OFFICE_REL_NS, "id") || drawings[0].getAttribute("r:id") || "";
  const drawingPath = relatedPart(files, worksheetPath, drawingRef, "drawing");
  let document: ReturnType<typeof xml>;
  try { document = xml(files, drawingPath); }
  catch { throw new Error("Фото: повреждено описание рисунков на листе «Данные»."); }
  if (!document.documentElement) throw new Error(INVALID_FILE);
  const anchors = Array.from(document.documentElement.childNodes).filter((node): node is XmlElement => node.nodeType === 1);
  const rowsByNumber = new Map(rows.map((row) => [row.rowNumber, row]));
  const usedRows = new Set<number>();
  const usedPictures = new Set<string>();
  const rowElements = Array.from(sheet.getElementsByTagNameNS("*", "row"));
  const sheetDefaults = Array.from(sheet.getElementsByTagNameNS("*", "sheetFormatPr"));
  const defaultHeight = sheetDefaults.length === 1 ? Number(sheetDefaults[0].getAttribute("defaultRowHeight") || "15") : 15;

  for (const anchor of anchors) {
    if (anchor.namespaceURI !== SHEET_DRAWING_NS || !["oneCellAnchor", "twoCellAnchor"].includes(anchor.localName ?? "")) {
      throw new Error("Фото: найдён рисунок без однозначной привязки к строке. Разместите фото в колонке H нужной строки.");
    }
    const from = childElements(anchor, SHEET_DRAWING_NS, "from");
    if (from.length !== 1) throw new Error("Фото: не удалось определить строку изображения.");
    const row = integerChild(from[0], "row");
    const col = integerChild(from[0], "col");
    const rowOff = integerChild(from[0], "rowOff");
    const colOff = integerChild(from[0], "colOff");
    if (row === null || col === null || rowOff === null || colOff === null || row >= 1048576) throw new Error("Фото: не удалось определить строку изображения.");
    const rowNumber = row + 1;
    const addError = (message: string) => errors.push({ rowNumber, field: "Фото", message });
    if (col !== 7) { addError("Верхний левый угол фото должен находиться в колонке H этой строки."); continue; }
    const target = rowsByNumber.get(rowNumber);
    if (!target) { addError("Фото находится вне заполненной строки сотрудника."); continue; }
    if (usedRows.has(rowNumber)) { addError("В строке должно быть только одно фото."); continue; }
    usedRows.add(rowNumber);
    const rowNode = rowElements.find((item) => Number(item.getAttribute("r")) === rowNumber);
    const height = rowNode?.getAttribute("ht") ? Number(rowNode.getAttribute("ht")) : defaultHeight;
    if (!Number.isFinite(height) || height <= 0 || rowNode?.getAttribute("hidden") === "1" || rowNode?.getAttribute("hidden") === "true") {
      addError("Невозможно определить видимые границы строки для фото."); continue;
    }
    const rowHeight = Math.round(height * 12700);
    if (rowOff >= rowHeight) { addError("Верхняя граница фото находится вне строки."); continue; }
    const mergedRanges = Array.from(sheet.getElementsByTagNameNS("*", "mergeCell"));
    if (mergedRanges.some((merge) => {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(merge.getAttribute("ref") ?? "");
      if (!match || Number(match[2]) === Number(match[4])) return false;
      const columnNumber = (label: string) => Array.from(label).reduce((sum, character) => sum * 26 + character.charCodeAt(0) - 64, 0);
      return columnNumber(match[1]) <= 8 && columnNumber(match[3]) >= 8 && Number(match[2]) <= rowNumber && Number(match[4]) >= rowNumber;
    })) { addError("Ячейка H объединена с другой строкой; разделите ячейки перед импортом фото."); continue; }
    if (anchor.localName === "twoCellAnchor") {
      const to = childElements(anchor, SHEET_DRAWING_NS, "to");
      const endRow = to.length === 1 ? integerChild(to[0], "row") : null;
      const endOff = to.length === 1 ? integerChild(to[0], "rowOff") : null;
      const endCol = to.length === 1 ? integerChild(to[0], "col") : null;
      const endColOff = to.length === 1 ? integerChild(to[0], "colOff") : null;
      if (endCol === null || endColOff === null || endCol < col || (endCol === col && endColOff <= colOff) || endRow === null || endOff === null || !((endRow === row && endOff > rowOff && endOff <= rowHeight) || (endRow === row + 1 && endOff === 0))) {
        addError("Фото должно целиком помещаться по высоте внутри одной строки."); continue;
      }
    } else {
      const ext = childElements(anchor, SHEET_DRAWING_NS, "ext");
      const cy = ext.length === 1 ? Number(ext[0].getAttribute("cy")) : NaN;
      if (!Number.isSafeInteger(cy) || cy <= 0 || rowOff + cy > rowHeight) {
        addError("Фото должно целиком помещаться по высоте внутри одной строки."); continue;
      }
    }
    const pictures = childElements(anchor, SHEET_DRAWING_NS, "pic");
    if (pictures.length !== 1 || childElements(anchor, SHEET_DRAWING_NS, "sp").length ||
        childElements(anchor, SHEET_DRAWING_NS, "graphicFrame").length || childElements(anchor, SHEET_DRAWING_NS, "grpSp").length) {
      addError("В строке поддерживается только одно обычное встроенное фото."); continue;
    }
    const picture = pictures[0];
    const blips = Array.from(picture.getElementsByTagNameNS(DRAWING_NS, "blip"));
    const transforms = Array.from(picture.getElementsByTagNameNS(DRAWING_NS, "xfrm"));
    const crops = Array.from(picture.getElementsByTagNameNS(DRAWING_NS, "srcRect"));
    if (blips.length !== 1 || blips[0].getAttributeNS(OFFICE_REL_NS, "link") || blips[0].getAttribute("r:link") ||
        transforms.some((item) => Number(item.getAttribute("rot") || 0) !== 0 || ["1", "true"].includes(item.getAttribute("flipH") ?? "") || ["1", "true"].includes(item.getAttribute("flipV") ?? "")) ||
        crops.some((item) => ["l", "r", "t", "b"].some((name) => Number(item.getAttribute(name) || 0) !== 0))) {
      addError("Внешние ссылки, поворот, отражение и обрезка фото не поддерживаются; вставьте исходное фото."); continue;
    }
    const imageRef = blips[0].getAttributeNS(OFFICE_REL_NS, "embed") || blips[0].getAttribute("r:embed") || "";
    try {
      const path = relatedPart(files, drawingPath, imageRef, "image");
      if (usedPictures.has(path)) { addError("Одно и то же вложение не может назначаться нескольким сотрудникам."); continue; }
      usedPictures.add(path);
      const bytes = files.get(path)!;
      const { mimeType } = validateBiotPhoto(bytes, path);
      target.photo = { bytes, mimeType };
    } catch (error) {
      addError(error instanceof Error ? error.message.replace(/^Фото: /, "") : "Не удалось прочитать фото.");
    }
  }
}

// Rich strings can include phonetic annotations (rPh) which are not cell text.
function richText(element: XmlElement): string {
  const parts: string[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== 1) continue;
    const item = child as XmlElement;
    if (item.localName === "t") parts.push(item.textContent ?? "");
    if (item.localName === "r") {
      for (const runChild of Array.from(item.childNodes)) {
        if (runChild.nodeType === 1 && (runChild as XmlElement).localName === "t") {
          parts.push(runChild.textContent ?? "");
        }
      }
    }
  }
  return parts.join("");
}

// Decode once: Excel encodes a literal "_x0041_" as "_x005F_x0041_".
function decodeExcelString(value: string): string {
  return value.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function hasInvalidTextCharacters(value: string): boolean {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) return true;
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0xd800 && code <= 0xdfff;
  });
}

function parseWorkbook(files: Map<string, Uint8Array>): BiotImportResult {
  if (Array.from(files.keys()).some((path) => /^xl\/richdata\//i.test(path))) {
    throw new Error("Фото: изображения Excel «Поместить в ячейку» не поддерживаются; вставьте обычный рисунок поверх ячейки H.");
  }
  const workbook = xml(files, "xl/workbook.xml");
  const sheets = Array.from(workbook.getElementsByTagNameNS("*", "sheet"));
  const dataSheets = sheets.filter((sheet) => sheet.getAttribute("name") === "Данные");
  if (dataSheets.length !== 1) throw new Error("Не найден единственный лист «Данные». Используйте шаблон приложения.");
  const relId = dataSheets[0].getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || dataSheets[0].getAttribute("r:id");
  const relationships = xml(files, "xl/_rels/workbook.xml.rels");
  const matches = Array.from(relationships.getElementsByTagNameNS("*", "Relationship")).filter((rel) => rel.getAttribute("Id") === relId);
  if (!relId || matches.length !== 1 || matches[0].getAttribute("TargetMode") === "External") throw new Error(INVALID_FILE);
  const worksheetPath = sheetPath(matches[0].getAttribute("Target") ?? "");
  const worksheet = xml(files, worksheetPath);
  const sharedStrings = files.has("xl/sharedStrings.xml")
    ? Array.from(xml(files, "xl/sharedStrings.xml").getElementsByTagNameNS("*", "si")).map(richText)
    : [];
  const errors: BiotImportResult["errors"] = [];
  const rows: BiotImportRow[] = [];
  const seen = new Set<number>();
  const numberRows = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  let header: string[] | null = null;
  const rowElements = Array.from(worksheet.getElementsByTagNameNS("*", "row"));
  if (rowElements.length > 10000) throw new Error("В файле слишком много строк. Используйте шаблон меньшего размера.");
  for (const row of rowElements) {
    const rowNumber = Number(row.getAttribute("r"));
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1048576 || seen.has(rowNumber)) throw new Error(INVALID_FILE);
    seen.add(rowNumber);
    const values = Array<string>(8).fill("");
    let hasContent = false;
    const usedColumns = new Set<number>();
    for (const cell of Array.from(row.getElementsByTagNameNS("*", "c"))) {
      const ref = cell.getAttribute("r") ?? "";
      const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(ref);
      if (!match || Number(match[2]) !== rowNumber) throw new Error(INVALID_FILE);
      let column = 0;
      for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
      if (usedColumns.has(column)) throw new Error(INVALID_FILE);
      usedColumns.add(column);
      const formulas = cell.getElementsByTagNameNS("*", "f");
      const type = cell.getAttribute("t");
      const valueNode = cell.getElementsByTagNameNS("*", "v")[0];
      const inline = cell.getElementsByTagNameNS("*", "is")[0];
      const raw = valueNode?.textContent ?? "";
      const field = column === 8 ? "Фото" : HEADERS[column - 1] ?? `Столбец ${match[1]}`;
      if (cell.hasAttribute("vm")) { errors.push({ rowNumber, field: "Фото", message: "Изображения Excel «Поместить в ячейку» не поддерживаются; вставьте обычный рисунок поверх ячейки H." }); hasContent = true; continue; }
      if (formulas.length) { const isImage = Array.from(formulas).some((formula) => /(?:^|[^A-Z])(?:_xlfn\.)?DISPIMG\s*\(/i.test(formula.textContent ?? "")); errors.push({ rowNumber, field: isImage ? "Фото" : field, message: isImage ? "Формула DISPIMG не поддерживается; вставьте обычный рисунок поверх ячейки H." : "Формулы не поддерживаются; введите текст." }); hasContent = true; continue; }
      if (column === 8 && rowNumber !== 1) {
        if (raw.trim() || inline || cell.hasAttribute("vm")) {
          errors.push({ rowNumber, field, message: "Вставьте фото как обычный рисунок поверх ячейки H; текст и фото внутри ячейки не поддерживаются." });
          hasContent = true;
        }
        continue;
      }
      let value = "";
      if (type === "inlineStr") value = inline ? richText(inline) : "";
      else if (type === "s") {
        if (!/^\d+$/.test(raw) || Number(raw) >= sharedStrings.length) throw new Error(INVALID_FILE);
        value = sharedStrings[Number(raw)];
      } else if (type === "str") value = raw;
      else if (raw.trim() || inline) {
        errors.push({ rowNumber, field, message: "Укажите значение как текст, чтобы не потерять данные." });
        hasContent = true;
      }
      value = decodeExcelString(value).trim();
      if (value) hasContent = true;
      if (hasInvalidTextCharacters(value)) {
        errors.push({ rowNumber, field, message: "Значение содержит недопустимые символы." });
      }
      if (value.startsWith("=")) {
        errors.push({ rowNumber, field, message: "Значения, начинающиеся с ‘=’, не поддерживаются." });
      }
      if (column <= 8) values[column - 1] = value;
      else if (value) errors.push({ rowNumber, field, message: "В шаблоне предусмотрены только столбцы A–H." });
    }
    if (rowNumber === 1) { header = values; continue; }
    if (!hasContent) continue;
    if (rows.length >= MAX_ROWS) throw new Error("В файле больше 100 заполненных строк. Разделите данные на несколько заявок.");
    const [fullName, positionRu, positionKz, certificateNumber, protocolNumber, witnessCertificateNumber, witnessRegistrationNumber] = values;
    if (fullName.length < 3 || fullName.length > 255) errors.push({ rowNumber, field: HEADERS[0], message: "Укажите ФИО длиной от 3 до 255 символов." });
    if (!positionRu && !positionKz) errors.push({ rowNumber, field: "Должность", message: "Укажите должность хотя бы на одном языке." });
    for (const index of [1, 2, 4]) if (values[index].length > 255) errors.push({ rowNumber, field: HEADERS[index], message: "Максимальная длина — 255 символов." });
    for (const index of [3, 5]) if (values[index] && (values[index].length < 3 || values[index].length > 100)) errors.push({ rowNumber, field: HEADERS[index], message: "Укажите от 3 до 100 символов или оставьте поле пустым." });
    if (witnessRegistrationNumber.length > 100) errors.push({ rowNumber, field: HEADERS[6], message: "Максимальная длина — 100 символов." });
    for (const index of [3, 4, 5, 6]) {
      const value = values[index];
      if (!value) continue;
      const firstRow = numberRows[index - 3].get(value);
      if (firstRow !== undefined) errors.push({ rowNumber, field: HEADERS[index], message: `Номер повторяется в строке ${firstRow}.` });
      else numberRows[index - 3].set(value, rowNumber);
    }
    rows.push({ rowNumber, fullName, positionRu, positionKz, certificateNumber, protocolNumber, witnessCertificateNumber, witnessRegistrationNumber, photo: null });
  }
  if (!header || HEADERS.some((expected, index) => header?.[index] !== expected) || (header[7] && header[7] !== "Фото") || errors.some((error) => error.rowNumber === 1)) throw new Error("Заголовки листа «Данные» не совпадают с шаблоном приложения.");
  if (!worksheet.documentElement) throw new Error(INVALID_FILE);
  embeddedPhotos(files, worksheet.documentElement, worksheetPath, rows, errors);
  if (!rows.length && !errors.length) throw new Error("На листе «Данные» нет заполненных строк.");
  return { rows, errors };
}

export async function readBiotWorkbook(file: File): Promise<BiotImportResult> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Выберите файл Excel в формате .xlsx.");
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) throw new Error("Размер файла должен быть больше нуля и не превышать 5 МБ.");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new Error(INVALID_FILE);
    return parseWorkbook(unpack(bytes));
  } catch (error) {
    if (error instanceof Error && (error.message === INVALID_FILE || error.message.startsWith("Файл слишком") || error.message.startsWith("В файле") || error.message.startsWith("Не найден") || error.message.startsWith("Заголовки") || error.message.startsWith("На листе") || error.message.startsWith("Фото:"))) throw error;
    throw new Error(INVALID_FILE);
  }
}

import { readFile, open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { fail } from "../core";

export const learningFileExtensions: Record<string, string> = {
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
  "text/vtt": "vtt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const officeTypes: Record<string, { main: string; type: string }> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    main: "word/document.xml",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    main: "ppt/presentation.xml",
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    main: "xl/workbook.xml",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
};
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function validateOfficeContainer(bytes: Buffer, mimeType: string) {
  const wanted = officeTypes[mimeType];
  if (!wanted) throw new Error("OFFICE_TYPE");
  let eocd = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65557);
    at--
  ) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) || bytes.readUInt16LE(eocd + 6))
    throw new Error("ZIP_DIRECTORY");
  const entries = bytes.readUInt16LE(eocd + 10),
    size = bytes.readUInt32LE(eocd + 12),
    offset = bytes.readUInt32LE(eocd + 16);
  if (
    entries < 2 ||
    entries > 2000 ||
    entries !== bytes.readUInt16LE(eocd + 8) ||
    offset + size !== eocd ||
    eocd + 22 + bytes.readUInt16LE(eocd + 20) !== bytes.length
  )
    throw new Error("ZIP_BOUNDS");
  const names = new Set<string>();
  let total = 0,
    at = offset,
    contentTypes = "",
    main = "";
  for (let n = 0; n < entries; n++) {
    if (at + 46 > eocd || bytes.readUInt32LE(at) !== 0x02014b50)
      throw new Error("ZIP_ENTRY");
    const flags = bytes.readUInt16LE(at + 8),
      method = bytes.readUInt16LE(at + 10),
      packed = bytes.readUInt32LE(at + 20),
      unpacked = bytes.readUInt32LE(at + 24),
      nameLength = bytes.readUInt16LE(at + 28),
      extra = bytes.readUInt16LE(at + 30),
      comment = bytes.readUInt16LE(at + 32),
      local = bytes.readUInt32LE(at + 42);
    if (at + 46 + nameLength + extra + comment > eocd)
      throw new Error("ZIP_ENTRY_BOUNDS");
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8"),
      lower = name.toLowerCase();
    if (
      !name ||
      names.has(lower) ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.includes(":") ||
      name.split("/").some((part) => part === "..") ||
      [...name].some((char) => char.charCodeAt(0) < 32) ||
      /vbaproject|activex|\.exe$|\.js$|\.vbs$|\.cmd$|\.bat$|\.ps1$/.test(lower)
    )
      throw new Error("OFFICE_UNSAFE_ENTRY");
    names.add(lower);
    total += unpacked;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      unpacked > 20 * 1024 * 1024 ||
      total > 100 * 1024 * 1024 ||
      unpacked > Math.max(1024 * 1024, packed * 200)
    )
      throw new Error("OFFICE_EXPANSION_LIMIT");
    if (
      local + 30 > offset ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method
    )
      throw new Error("ZIP_LOCAL_ENTRY");
    const localNameLength = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28),
      dataAt = local + 30 + localNameLength + localExtra;
    if (
      bytes
        .subarray(local + 30, local + 30 + localNameLength)
        .toString("utf8") !== name ||
      dataAt + packed > offset
    )
      throw new Error("ZIP_LOCAL_BOUNDS");
    const raw = bytes.subarray(dataAt, dataAt + packed),
      decoded =
        method === 0
          ? raw
          : inflateRawSync(raw, { maxOutputLength: 20 * 1024 * 1024 });
    if (
      decoded.length !== unpacked ||
      crc32(decoded) !== bytes.readUInt32LE(at + 16)
    )
      throw new Error("ZIP_LENGTH_MISMATCH");
    if (lower.endsWith(".xml") || lower.endsWith(".rels")) {
      const xml = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
      if (/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject/i.test(xml))
        throw new Error("OFFICE_ACTIVE_CONTENT");
      if (name === "[Content_Types].xml") contentTypes = xml;
      if (name === wanted.main) main = xml;
    }
    at += 46 + nameLength + extra + comment;
  }
  if (
    at !== eocd ||
    !contentTypes.includes(wanted.type) ||
    !contentTypes.includes(`/${wanted.main}`) ||
    !main.trim().startsWith("<")
  )
    throw new Error("OFFICE_CONTENT_TYPE");
}
export function validateLearningText(bytes: Buffer, mimeType: string) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim() || text.includes("\0")) throw new Error("TEXT_INVALID");
  if (mimeType === "text/vtt") {
    if (
      !/^WEBVTT(?:[^\r\n]*)\r?\n/.test(text) ||
      /<\/?(?:script|iframe|img|style|object|svg)\b|^STYLE\s*$|^REGION\s*$/im.test(
        text,
      )
    )
      throw new Error("VTT_INVALID");
    const timing =
      /^(?:\d{2,}:)?\d{2}:\d{2}\.\d{3} --> (?:\d{2,}:)?\d{2}:\d{2}\.\d{3}(?:\s+[^\r\n]*)?$/;
    if (
      !text.split(/\r?\n/).some((line) => timing.test(line)) ||
      text
        .split(/\r?\n/)
        .some((line) => line.includes("-->") && !timing.test(line))
    )
      throw new Error("VTT_TIMING");
  }
}
export async function validateLearningFile(
  file: Express.Multer.File,
  evidence: boolean,
) {
  if (
    (file.mimetype === "application/octet-stream" ||
      file.mimetype === "text/plain") &&
    file.originalname.toLowerCase().endsWith(".vtt")
  )
    file.mimetype = "text/vtt";
  const video = file.mimetype.startsWith("video/"),
    text = file.mimetype.startsWith("text/"),
    limit =
      video && !evidence
        ? 512 * 1024 * 1024
        : text
          ? 2 * 1024 * 1024
          : 20 * 1024 * 1024;
  const allowed = evidence
    ? ["application/pdf", "image/png", "image/jpeg"]
    : Object.keys(learningFileExtensions);
  if (!allowed.includes(file.mimetype) || file.size <= 0 || file.size > limit)
    fail(
      400,
      "MATERIAL_TYPE",
      evidence
        ? "Используйте PDF, PNG или JPEG до 20 МиБ"
        : "Используйте PDF, изображение, DOCX/PPTX/XLSX, TXT/VTT до 20 МиБ (текст до 2 МиБ) или MP4/WebM до 512 МиБ",
    );
  try {
    const handle = await open(file.path, "r"),
      signature = Buffer.alloc(16);
    try {
      await handle.read(signature, 0, 16, 0);
    } finally {
      await handle.close();
    }
    if (officeTypes[file.mimetype])
      validateOfficeContainer(await readFile(file.path), file.mimetype);
    else if (text)
      validateLearningText(await readFile(file.path), file.mimetype);
    else if (file.mimetype.startsWith("image/")) {
      const info = await sharp(file.path, {
        limitInputPixels: 40000000,
        failOn: "error",
      }).metadata();
      if (
        !info.width ||
        !info.height ||
        !(
          {
            "image/png": "png",
            "image/jpeg": "jpeg",
            "image/webp": "webp",
          } as Record<string, string>
        )[file.mimetype] ||
        info.format !==
          (
            {
              "image/png": "png",
              "image/jpeg": "jpeg",
              "image/webp": "webp",
            } as Record<string, string>
          )[file.mimetype]
      )
        throw new Error("IMAGE_TYPE");
    } else if (
      file.mimetype === "application/pdf"
        ? signature.subarray(0, 5).toString() !== "%PDF-"
        : file.mimetype === "video/mp4"
          ? signature.subarray(4, 8).toString() !== "ftyp"
          : !signature
              .subarray(0, 4)
              .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    )
      throw new Error("SIGNATURE");
  } catch {
    fail(
      400,
      "MATERIAL_SIGNATURE",
      "Содержимое файла не соответствует безопасному поддерживаемому формату",
    );
  }
}

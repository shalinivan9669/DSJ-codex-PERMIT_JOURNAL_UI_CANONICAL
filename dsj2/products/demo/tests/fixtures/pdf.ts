import { deflateSync } from "node:zlib";

// Structurally complete synthetic PDF fixtures. None are executed or rendered.
export function pdfObjects(objects: (string | Buffer)[], root = 1): Buffer {
  const parts = [Buffer.from("%PDF-1.7\n%synthetic-only\n")];
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.from(objects[index]),
      Buffer.from("\nendobj\n"),
    );
  }
  const xref = Buffer.concat(parts).length;
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

export function pdfStream(bytes: Buffer, extra = ""): Buffer {
  return Buffer.concat([
    Buffer.from(`<< /Length ${bytes.length} ${extra} >>\nstream\n`),
    bytes,
    Buffer.from("\nendstream"),
  ]);
}

export function syntheticPdf(
  note = "Synthetic source",
  catalog = "",
  page = "",
  extra: (string | Buffer)[] = [],
): Buffer {
  const comment = `% ${note.replace(/[^\x20-\x7e]/g, " ")}\n`;
  return pdfObjects([
    `<< /Type /Catalog /Pages 2 0 R ${catalog} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R ${page} >>`,
    pdfStream(Buffer.from(comment)),
    ...extra,
  ]);
}

export function objectStreamPdf(active: boolean): Buffer {
  const parts = [Buffer.from("%PDF-1.7\n%synthetic-object-stream\n")];
  const offsets = new Map<number, number>();
  const put = (id: number, value: string | Buffer) => {
    offsets.set(id, Buffer.concat(parts).length);
    parts.push(
      Buffer.from(`${id} 0 obj\n`),
      Buffer.from(value),
      Buffer.from("\nendobj\n"),
    );
  };
  const compressed = [
    `<< /Type /Catalog /Pages 2 0 R ${active ? "/Open#41ction 4 0 R" : ""} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
    active
      ? "<< /S /Java#53cript /J#53 (void 0) >>"
      : "<< /Producer (Synthetic benign compressed metadata) >>",
  ];
  let current = 0;
  const header = compressed
    .map((body, index) => {
      const offset = current;
      current += Buffer.byteLength(body + " ");
      return `${index + 1} ${offset} `;
    })
    .join("");
  put(
    5,
    pdfStream(
      deflateSync(Buffer.from(header + compressed.join(" ") + " ")),
      `/Type /ObjStm /N 4 /First ${Buffer.byteLength(header)} /Filter /FlateDecode`,
    ),
  );
  const xrefOffset = Buffer.concat(parts).length;
  const entries = Buffer.alloc(7 * 7);
  for (let id = 0; id <= 6; id++) {
    const offset = id * 7;
    entries[offset] = id === 0 ? 0 : id <= 4 ? 2 : 1;
    entries.writeUInt32BE(
      id <= 4 ? (id === 0 ? 0 : 5) : id === 6 ? xrefOffset : offsets.get(id)!,
      offset + 1,
    );
    entries.writeUInt16BE(id === 0 ? 65535 : id <= 4 ? id - 1 : 0, offset + 5);
  }
  put(
    6,
    pdfStream(
      entries,
      "/Type /XRef /Size 7 /Root 1 0 R /W [1 4 2] /Index [0 7]",
    ),
  );
  parts.push(Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`));
  return Buffer.concat(parts);
}

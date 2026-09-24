import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { PRODUCT_ROOT } from "@demo/printing";
import { join } from "node:path";
import { validatePdfAttachment } from "../apps/api/src/pdf-attachment";
import { syntheticPdf, objectStreamPdf, pdfStream } from "./fixtures/pdf";

const code = (expected: string) => (error: unknown) =>
  (error as { getResponse(): { code: string } }).getResponse().code ===
  expected;

test("PDF semantic validation preserves safe classic and compressed-object documents", async () => {
  for (const bytes of [
    syntheticPdf("Literal /JavaScript in printable comment is not an action"),
    objectStreamPdf(false),
    syntheticPdf(
      "Tagged PDF layout",
      "/StructTreeRoot << /Type /StructTreeRoot /K [<< /Type /StructElem /S /P /A << /O /Layout /Placement /Block >> >>] >>",
    ),
  ]) {
    const copy = Buffer.from(bytes);
    await validatePdfAttachment(bytes);
    assert.deepEqual(bytes, copy);
  }
});

test("PDF semantic validation rejects escaped names, compressed active objects, nested actions and attachments", async (t) => {
  const inputs = [
    [
      "escaped catalog action",
      syntheticPdf("", "/Open#41ction << /S /Java#53cript /J#53 (void 0) >>"),
    ],
    ["compressed active objects", objectStreamPdf(true)],
    [
      "action disguised as structure attribute",
      syntheticPdf(
        "",
        "/StructTreeRoot << /Type /StructTreeRoot /K [<< /Type /StructElem /S /P /A << /O /Layout /S /Java#53cript /JS (void 0) >> >>] >>",
      ),
    ],
    [
      "nested page additional actions",
      syntheticPdf(
        "",
        "",
        "/Annots [<< /Subtype /Widget /A#41 << /E << /S /Launch /F (synthetic.txt) >> >> >>]",
      ),
    ],
    [
      "unreferenced active object",
      syntheticPdf("", "", "", ["<< /S /JavaScript /JS (void 0) >>"]),
    ],
    [
      "external action",
      syntheticPdf(
        "",
        "",
        "/Annots [<< /Subtype /Link /A << /S /URI /URI (https://example.test/) >> >>]",
      ),
    ],
    [
      "embedded source",
      syntheticPdf("", "/Names << /Embedded#46iles << /Names [] >> >>"),
    ],
    ["XFA", syntheticPdf("", "/AcroForm << /X#46A (synthetic) >>")],
    [
      "remote stream",
      syntheticPdf("", "", "", [
        pdfStream(Buffer.alloc(0), "/F (https://example.test/source)"),
      ]),
    ],
  ] as const;
  for (const [title, bytes] of inputs)
    await t.test(title, () =>
      assert.rejects(validatePdfAttachment(bytes), code("ACTIVE_PDF_REJECTED")),
    );
});

test("PDF validator fails closed on malformed input and bounded decompression", async (t) => {
  await t.test("corrupt Flate stream cannot be silently recovered", () =>
    assert.rejects(
      validatePdfAttachment(
        syntheticPdf("", "", "", [
          pdfStream(
            Buffer.from("broken compressed stream"),
            "/Filter /FlateDecode",
          ),
        ]),
      ),
      code("PDF_INVALID"),
    ),
  );
  await t.test("truncated Flate stream cannot be silently recovered", () =>
    assert.rejects(
      validatePdfAttachment(
        syntheticPdf("", "", "", [
          pdfStream(
            deflateSync(Buffer.from("synthetic")).subarray(0, -3),
            "/Filter /FlateDecode",
          ),
        ]),
      ),
      code("PDF_INVALID"),
    ),
  );
  await t.test("encrypted source", () =>
    assert.rejects(
      validatePdfAttachment(
        readFileSync(join(PRODUCT_ROOT, "tests/fixtures/encrypted.pdf")),
      ),
      code("PDF_ENCRYPTED_REJECTED"),
    ),
  );
  await t.test("truncated fake PDF", () =>
    assert.rejects(
      validatePdfAttachment(Buffer.from("%PDF-1.4\nsynthetic\n%%EOF")),
      code("PDF_INVALID"),
    ),
  );
  await t.test("corrupt xref", () =>
    assert.rejects(
      validatePdfAttachment(
        Buffer.from(
          syntheticPdf()
            .toString()
            .replace(/startxref\n\d+/, "startxref\n1"),
        ),
      ),
      code("PDF_INVALID"),
    ),
  );
  await t.test("decompression limit", () =>
    assert.rejects(
      validatePdfAttachment(
        syntheticPdf("", "", "", [
          pdfStream(
            deflateSync(Buffer.alloc(9 * 1024 * 1024)),
            "/Filter /FlateDecode",
          ),
        ]),
      ),
      code("PDF_RESOURCE_LIMIT"),
    ),
  );
  await t.test("excessive nesting", () =>
    assert.rejects(
      validatePdfAttachment(
        syntheticPdf("", `/Metadata [${"[".repeat(70)}0${"]".repeat(70)}]`),
      ),
      code("PDF_RESOURCE_LIMIT"),
    ),
  );
  await t.test("unknown filter", () =>
    assert.rejects(
      validatePdfAttachment(
        syntheticPdf("", "", "", [
          pdfStream(Buffer.from("x"), "/Filter /UnknownFilter"),
        ]),
      ),
      code("PDF_INVALID"),
    ),
  );
});

test("missing PDF parser fails closed and releases its concurrency slot", async () => {
  const python = process.env.DEMO_PYTHON;
  try {
    process.env.DEMO_PYTHON = join(PRODUCT_ROOT, "missing-pdf-python-runtime");
    await assert.rejects(
      validatePdfAttachment(syntheticPdf()),
      code("PDF_VALIDATOR_UNAVAILABLE"),
    );
  } finally {
    if (python === undefined) delete process.env.DEMO_PYTHON;
    else process.env.DEMO_PYTHON = python;
  }
  await validatePdfAttachment(syntheticPdf());
});

test("PDF parser concurrency is bounded without retaining an unbounded queue", async () => {
  const first = validatePdfAttachment(syntheticPdf("1"));
  const second = validatePdfAttachment(syntheticPdf("2"));
  await assert.rejects(
    validatePdfAttachment(syntheticPdf("3")),
    code("PDF_VALIDATOR_BUSY"),
  );
  await Promise.all([first, second]);
  await validatePdfAttachment(syntheticPdf("slot released"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { artifactUrl, downloadArtifact } from "../lib/api";

test("ordinary views request the signature print copy while explicit originals retain the exact endpoint", () => {
  assert.equal(
    artifactUrl("saved/pdf", { inline: true }),
    "/api/artifacts/saved%2Fpdf?copy=signature-print&inline=1",
  );
  assert.equal(
    artifactUrl("saved/pdf", { original: true }),
    "/api/artifacts/saved%2Fpdf",
  );
  assert.equal(
    artifactUrl("file", {
      prefix: "/lms/commission/issuance/artifacts",
      inline: true,
    }),
    "/api/lms/commission/issuance/artifacts/file?copy=signature-print&inline=1",
  );
  assert.equal(
    artifactUrl("file", {
      prefix: "/lms/commission/issuance/artifacts",
      original: true,
    }),
    "/api/lms/commission/issuance/artifacts/file",
  );
});

test("download keeps the server's print-copy filename and offers the raw original without rewriting its bytes", async (t) => {
  const requests: string[] = [];
  const downloads: { href: string; download: string }[] = [];
  const blobs: Blob[] = [];
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        const link = {
          href: "",
          download: "",
          click() {
            downloads.push({ href: link.href, download: link.download });
          },
        };
        return link;
      },
    },
  });
  t.after(() => {
    if (priorDocument)
      Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = String(input);
    requests.push(url);
    const printCopy = url.includes("copy=signature-print");
    return new Response(
      printCopy ? "derived PDF bytes" : "exact original PDF",
      {
        headers: {
          "content-disposition": printCopy
            ? "attachment; filename*=UTF-8''signature-print.pdf"
            : 'attachment; filename="original.pdf"',
        },
      },
    );
  });
  t.mock.method(URL, "createObjectURL", (blob: Blob) => {
    blobs.push(blob);
    return `blob:test-${blobs.length}`;
  });
  t.mock.method(URL, "revokeObjectURL", () => {});
  await downloadArtifact("saved-pdf", "fallback.pdf");
  await downloadArtifact("saved-pdf", "fallback.pdf", { original: true });
  assert.deepEqual(requests, [
    "/api/artifacts/saved-pdf?copy=signature-print",
    "/api/artifacts/saved-pdf",
  ]);
  assert.deepEqual(downloads, [
    { href: "blob:test-1", download: "signature-print.pdf" },
    { href: "blob:test-2", download: "original.pdf" },
  ]);
  assert.deepEqual(await Promise.all(blobs.map((blob) => blob.text())), [
    "derived PDF bytes",
    "exact original PDF",
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { uploadPhoto } from "../../apps/api/src/files";
import type { Context } from "../../apps/api/src/core";

test("non-raster photo bytes never reach Sharp metadata, regardless of name or MIME", async (t) => {
  const sharp = createRequire(join(__dirname, "../../apps/api/package.json"))(
    "sharp",
  ) as { prototype: { metadata(): Promise<unknown> } };
  const metadata = t.mock.method(sharp.prototype, "metadata", async () => {
    throw new Error("Unexpected native image metadata call");
  });
  const context: Context = {
    tenantId: "synthetic-decoder-boundary",
    userId: "synthetic-decoder-boundary",
    role: "ADMIN",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: "synthetic",
  };
  for (const input of [
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "synthetic">]><svg>&x;</svg>',
    "<html>synthetic</html>",
    "%PDF-1.7 synthetic",
    "GIF89a synthetic",
    "",
  ]) {
    const buffer = Buffer.from(input);
    await assert.rejects(
      uploadPhoto(
        context,
        {
          buffer,
          size: buffer.length,
          originalname: "claimed-portrait.png",
          mimetype: "image/png",
        } as Express.Multer.File,
        {},
      ),
      (error: unknown) => {
        const response = error as {
          getStatus(): number;
          getResponse(): { code: string };
        };
        return (
          response.getStatus() === 400 &&
          response.getResponse().code === "PHOTO_TYPE"
        );
      },
    );
  }
  assert.equal(metadata.mock.callCount(), 0);
});

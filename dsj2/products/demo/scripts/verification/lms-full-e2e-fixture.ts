import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { LIMITS } from "../../packages/contracts/src";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { assertTestDatabase } from "../../tests/integration/test-database";
import {
  LMS_PASSWORD,
  LMS_FIXTURE_VERSION,
} from "../../tests/integration/lms-fixture";

async function main() {
  assertTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/demo_test_lms_browser_20261015");
  const director = await db.user.findUniqueOrThrow({
    where: { email: "lms-director-20261015@example.test" },
  });
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: director.tenantId },
  });
  assert.equal(tenant.demoOnly, true);
  const roles = ["ADMIN", "OPERATOR"] as const;
  for (const role of roles) {
    const email = `lms-full-${role.toLowerCase()}-20261015@example.test`;
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      assert.equal(existing.tenantId, director.tenantId);
      assert.equal(existing.role, role);
    } else
      await db.user.create({
        data: {
          tenantId: director.tenantId,
          role,
          email,
          displayName: `Синтетический ${role}`,
          passwordHash: await passwordHash(LMS_PASSWORD),
        },
      });
  }
  const directory = path.resolve(".runtime/lms-one-run/e2e-fixtures");
  await mkdir(directory, { recursive: true });
  const sharp = createRequire(path.resolve("apps/api/package.json"))("sharp");
  // Deterministic non-person test pattern; no user's image or likeness.
  const width = 3000,
    height = 4000;
  const raw = Buffer.alloc(width * height * 3);
  let seed = 20261015;
  for (let offset = 0; offset < raw.length; offset++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    raw[offset] = seed >>> 24;
  }
  const large = await sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 40 })
    .toBuffer();
  const largeMetadata = await sharp(large).metadata();
  assert.equal(largeMetadata.format, "jpeg");
  assert.equal(largeMetadata.width, width);
  assert.equal(largeMetadata.height, height);
  assert.ok(width * height <= LIMITS.imagePixels);
  assert.ok(large.length > 1024 * 1024, "POSITIVE_LARGE_PHOTO_GT_1_MIB");
  assert.ok(
    large.length <= LIMITS.photoBytes,
    "POSITIVE_LARGE_PHOTO_WITHIN_5_MIB_LIMIT",
  );
  const portrait = await sharp({
    create: {
      width: 300,
      height: 400,
      channels: 3,
      background: { r: 50, g: 110, b: 170 },
    },
  })
    .png()
    .toBuffer();
  await writeFile(path.join(directory, "large-synthetic.jpg"), large);
  await writeFile(path.join(directory, "portrait-test-pattern.png"), portrait);
  const manifest = {
    fixtureVersion: LMS_FIXTURE_VERSION,
    synthetic: true,
    tenantId: director.tenantId,
    roles: ["DIRECTOR", ...roles],
    database: {
      host: url.hostname,
      port: url.port,
      name: url.pathname.slice(1),
    },
    images: [
      {
        name: "large-synthetic.jpg",
        width,
        height,
        bytes: large.length,
        sha256: createHash("sha256").update(large).digest("hex"),
      },
      {
        name: "portrait-test-pattern.png",
        width: 300,
        height: 400,
        bytes: portrait.length,
        sha256: createHash("sha256").update(portrait).digest("hex"),
      },
    ],
  };
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(JSON.stringify(manifest));
}
main().finally(() => db.$disconnect());

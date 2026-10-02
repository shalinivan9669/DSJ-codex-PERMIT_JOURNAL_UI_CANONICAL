import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Prisma } from "@demo/database";
import { canManageCenter } from "@demo/contracts";
import { ArtifactStore, buildZip } from "@demo/printing";
import { db, audit, fail, hash, type Context } from "./core";

const EXCLUDED_MODELS = new Set(["Session"]);
const MAX_ROWS_PER_TABLE = 100_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
type ExportRow = Record<string, unknown>;
type ExportFile = {
  id: string;
  storageKey: string;
  sha256: string;
  size: number;
  format: string;
  fileName: string;
  references: Array<{ table: string; id: string; field: string }>;
};

/** Consistent owner export. Session secrets and password/token hashes are deliberately excluded. */
export async function tenantExportSnapshot(c: Context) {
  if (!canManageCenter(c.role))
    fail(403, "ROLE_DENIED", "Полная выгрузка доступна директору центра");
  return db.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: c.tenantId },
      });
      const tables: Record<string, ExportRow[]> = {};
      const models = Prisma.dmmf.datamodel.models.filter(
        (model) =>
          model.fields.some((field) => field.name === "tenantId") &&
          !EXCLUDED_MODELS.has(model.name),
      );
      for (const model of models) {
        const delegateName = model.name[0].toLowerCase() + model.name.slice(1);
        const delegate = (
          tx as unknown as Record<
            string,
            { findMany(input: unknown): Promise<ExportRow[]> }
          >
        )[delegateName];
        const rows = await delegate.findMany({
          where: { tenantId: c.tenantId },
          take: MAX_ROWS_PER_TABLE + 1,
        });
        if (rows.length > MAX_ROWS_PER_TABLE)
          fail(
            413,
            "TENANT_EXPORT_TOO_LARGE",
            "Для этого объёма используйте административную архивную выгрузку с проверкой восстановления",
          );
        tables[model.name] = rows.map((row) => {
          const clean = { ...row };
          for (const secret of [
            "passwordHash",
            "tokenHash",
            "csrfHash",
            "secretHash",
          ])
            delete clean[secret];
          return clean;
        });
      }
      return {
        contractVersion: 1,
        createdAt: new Date().toISOString(),
        tenant,
        tables,
        excluded: [
          "Sessions",
          "Password hashes",
          "Public bearer token hashes",
          "Invitation secret hashes",
        ],
        limitation:
          "Переносимая выгрузка данных и файлов владельца. Для восстановления работающей установки используется проверенный backup/restore с секретами в отдельном защищённом процессе.",
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 20_000, timeout: 60_000 },
  );
}
export async function exportTenant(c: Context) {
  const snapshot = await tenantExportSnapshot(c);
  const store = new ArtifactStore();
  const files = new Map<string, ExportFile>();
  let totalBytes = 0;
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    for (const row of rows) {
      for (const field of ["storageKey", "originalStorageKey"]) {
        const key = row[field];
        if (typeof key !== "string" || !key) continue;
        const reference = { table, id: String(row.id || ""), field };
        if (files.has(key)) {
          files.get(key)!.references.push(reference);
          continue;
        }
        const expectedHash =
          field === "originalStorageKey"
            ? undefined
            : typeof row.sha256 === "string"
              ? row.sha256
              : typeof row.checksum === "string"
                ? row.checksum
                : undefined;
        let bytes: Buffer;
        try {
          bytes = await store.read(key, expectedHash);
        } catch {
          fail(
            409,
            "TENANT_EXPORT_INCOMPLETE",
            "Исходный файл отсутствует или повреждён. Полная выгрузка не создана",
            { table, id: row.id, field },
          );
        }
        if (
          field !== "originalStorageKey" &&
          typeof row.size === "number" &&
          row.size !== bytes.length
        )
          fail(
            409,
            "TENANT_EXPORT_INCOMPLETE",
            "Размер исходного файла не совпадает с реестром",
            { table, id: row.id },
          );
        totalBytes += bytes.length;
        if (totalBytes > MAX_FILE_BYTES)
          fail(
            413,
            "TENANT_EXPORT_TOO_LARGE",
            "Файлы превышают 128 МБ. Используйте административную архивную выгрузку с проверкой восстановления",
          );
        files.set(key, {
          id: hash(key),
          storageKey: key,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
          format: basename(key).split(".").pop()?.toUpperCase() || "BIN",
          fileName: `files/${basename(key)}`,
          references: [reference],
        });
      }
    }
  }
  const inventory = [...files.values()];
  const exportId = randomUUID();
  const index = Buffer.from(
    JSON.stringify(
      {
        ...snapshot,
        exportId,
        files: inventory.map(
          ({ storageKey, fileName, sha256, size, references }) => ({
            storageKey,
            fileName,
            sha256,
            size,
            references,
          }),
        ),
      },
      null,
      2,
    ),
  );
  if (index.length > 32 * 1024 * 1024)
    fail(
      413,
      "TENANT_EXPORT_TOO_LARGE",
      "Индекс выгрузки превышает 32 МБ. Используйте административный backup/restore",
    );
  const indexFile = await store.put(index, "json");
  const records = [
    {
      id: exportId,
      ...indexFile,
      format: "JSON",
      fileName: "tenant-data.json",
    },
    ...inventory,
  ];
  const result = await buildZip(
    records,
    `TENANT-EXPORT-${exportId}`,
    records.length,
    [],
    {
      coverText:
        "Выгрузка владельца центра. tenant-data.json содержит таблицы, устойчивые связи и соответствие файлов их контрольным суммам. Сессионные секреты, пароли и токены доступа не включены. Это не выгрузка работодателя.",
      includeInventory: true,
    },
  );
  if (result.metadata.complete !== true)
    fail(
      409,
      "TENANT_EXPORT_INCOMPLETE",
      "Один из файлов изменился во время сборки. Повторите выгрузку после проверки хранения",
    );
  await audit(db, c, "TENANT_DATA_EXPORTED", c.tenantId, {
    exportId,
    tableCount: Object.keys(snapshot.tables).length,
    fileCount: inventory.length,
    fileBytes: totalBytes,
  });
  return {
    buffer: result.buffer,
    mimeType: "application/zip",
    fileName: `OT-CENTER-data-${exportId}.zip`,
    sha256: createHash("sha256").update(result.buffer).digest("hex"),
  };
}

import { promises as fs } from "node:fs";
import path from "node:path";
const directory = path.resolve("docs/evidence/commercial-acceptance");
const read = async (file) =>
  JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const matrix = await read(path.join(directory, "matrix.json"));
for (const owner of ["security", "browser", "printing", "word", "operations"]) {
  const contribution = await read(
    path.join(directory, owner, "matrix-updates.json"),
  );
  for (const update of contribution.requirements) {
    const row = matrix.requirements.find((entry) => entry.id === update.id);
    if (!row) throw new Error(`Unknown requirement ${update.id}`);
    row.observations ||= {};
    row.observations[owner] = update;
    if (
      (update.status === "PASS" && !["FAIL", "BLOCKED"].includes(row.status)) ||
      update.status === "FAIL" ||
      (update.status === "BLOCKED" && row.status !== "FAIL")
    ) {
      Object.assign(row, update);
      row.observations ||= {};
      row.observations[owner] = update;
    } else if (row.status === "NOT RUN") {
      for (const key of [
        "scenario",
        "environment",
        "result",
        "artifact",
        "defect",
        "fix",
        "retest",
        "limitation",
      ]) {
        if (update[key]) row[key] = update[key];
      }
    }
  }
}
matrix.currentBaseRevision = "3ad8e6bb5aba016df01da8f387c1bbe19a93011f";
matrix.updatedAt = new Date().toISOString();
matrix.overall =
  "IN_PROGRESS: subsystem PASS is not unconditional commercial release approval";
await fs.writeFile(
  path.join(directory, "matrix.json"),
  JSON.stringify(matrix, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      ["PASS", "FAIL", "BLOCKED", "NOT RUN"].map((status) => [
        status,
        matrix.requirements.filter((row) => row.status === status).length,
      ]),
    ),
  ),
);

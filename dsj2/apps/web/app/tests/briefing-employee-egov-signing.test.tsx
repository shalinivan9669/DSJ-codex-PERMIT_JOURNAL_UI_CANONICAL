import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { getBriefingEgovStatusLabel } from "../../components/employee-presence-signing-panel";

test("briefing eGov panel exposes the required Russian status labels", () => {
  assert.equal(getBriefingEgovStatusLabel("QR_GENERATED"), "Ожидаем сканирование");
  assert.equal(getBriefingEgovStatusLabel("WAITING_FOR_USER"), "Ожидаем подтверждение в eGov Mobile");
  assert.equal(getBriefingEgovStatusLabel("VERIFYING"), "Проверяем подпись");
  assert.equal(getBriefingEgovStatusLabel("COMPLETED"), "Сотрудник подписал");
  assert.equal(getBriefingEgovStatusLabel("EXPIRED"), "Сессия истекла");
  assert.equal(getBriefingEgovStatusLabel("CANCELLED"), "Подписание отклонено");
});

test("briefing employee flow offers eGov QR and tablet signing without my-instructions", async () => {
  const source = await readFile(
    new URL("../../components/employee-presence-signing-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\/api\/signing\/sessions\/\$\{session\.id\}/);
  assert.match(source, /eGov Mobile QR/);
  assert.match(source, /Подпись на планшете/);
  assert.match(source, /egov-local\/complete/);
  assert.match(source, /tablet\/submit/);
  assert.match(source, /toDataURL\("image\/png"\)/);
  assert.doesNotMatch(source, /my-instructions/);
});

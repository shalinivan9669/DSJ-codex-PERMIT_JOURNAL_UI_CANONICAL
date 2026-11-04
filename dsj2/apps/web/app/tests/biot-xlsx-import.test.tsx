import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readBiotWorkbook } from "../../lib/biot-xlsx-import";

const template = new URL("../../public/templates/biot-table.xlsx", import.meta.url);

async function workbookWith(row: string, extra?: (files: Record<string, Uint8Array>) => void) {
  const files = unzipSync(new Uint8Array(await readFile(template)));
  const path = "xl/worksheets/sheet1.xml";
  const xml = strFromU8(files[path]);
  files[path] = strToU8(xml.replace(/<x:row r="2"[^>]*>.*?<\/x:row>/, `<x:row r="2">${row}</x:row>`));
  extra?.(files);
  return new File([zipSync(files) as BlobPart], "table.xlsx");
}

const valid = '<x:c r="A2" t="inlineStr"><x:is><x:t>Иванов Иван</x:t></x:is></x:c><x:c r="B2" t="inlineStr"><x:is><x:t>Инженер</x:t></x:is></x:c><x:c r="D2" t="inlineStr"><x:is><x:t>00123</x:t></x:is></x:c>';

test("imports a populated copy of the real template and preserves leading zeroes", async () => {
  const result = await readBiotWorkbook(await workbookWith(valid));
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows.map(({ rowNumber, fullName, positionRu, certificateNumber }) => ({ rowNumber, fullName, positionRu, certificateNumber })), [{ rowNumber: 2, fullName: "Иванов Иван", positionRu: "Инженер", certificateNumber: "00123" }]);
});

test("decodes Excel escape sequences without decoding escaped literal sequences twice", async () => {
  const file = await workbookWith(valid.replace("00123", "ID_x005F_x0041_"));
  const result = await readBiotWorkbook(file);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].certificateNumber, "ID_x0041_");
});

test("rejects escaped formulas and control characters that cannot be stored safely", async () => {
  const file = await workbookWith(valid.replace("00123", "_x003D_1+1") + '<x:c r="E2" t="inlineStr"><x:is><x:t>A_x0000_B</x:t></x:is></x:c>');
  const result = await readBiotWorkbook(file);
  assert.ok(result.errors.some((error) => error.field === "Номер удостоверения" && error.message.includes("начинающиеся")));
  assert.ok(result.errors.some((error) => error.field === "Номер протокола" && error.message.includes("недопустимые символы")));
});

test("does not append Excel phonetic annotations to rich text values", async () => {
  const input = valid.replace("<x:t>Иванов Иван</x:t>", "<x:r><x:t>Иванов </x:t></x:r><x:r><x:t>Иван</x:t></x:r><x:rPh><x:t>PHONETIC</x:t></x:rPh>");
  const result = await readBiotWorkbook(await workbookWith(input));
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].fullName, "Иванов Иван");
});

test("decodes shared rich strings and leaves their phonetic annotations out", async () => {
  const input = valid.replace('<x:c r="A2" t="inlineStr"><x:is><x:t>Иванов Иван</x:t></x:is></x:c>', '<x:c r="A2" t="s"><x:v>0</x:v></x:c>');
  const file = await workbookWith(input, (files) => {
    files["xl/sharedStrings.xml"] = strToU8('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>Иванов </t></r><r><t>Иван_xD83D__xDE00_</t></r><rPh><t>PHONETIC</t></rPh></si></sst>');
  });
  const result = await readBiotWorkbook(file);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].fullName, "Иванов Иван😀");
});

test("reports missing fields and avoids exposing their contents", async () => {
  const result = await readBiotWorkbook(await workbookWith('<x:c r="A2" t="inlineStr"><x:is><x:t>И</x:t></x:is></x:c>'));
  assert.ok(result.errors.some((error) => error.rowNumber === 2 && error.field === "ФИО"));
  assert.ok(result.errors.some((error) => error.field === "Должность"));
});

test("rejects spreadsheet formulas and text that would become a formula in export", async () => {
  const input = valid + '<x:c r="E2"><x:f>1+1</x:f><x:v>2</x:v></x:c><x:c r="F2" t="inlineStr"><x:is><x:t> =2+2</x:t></x:is></x:c>';
  const result = await readBiotWorkbook(await workbookWith(input));
  assert.ok(result.errors.some((error) => error.field === "Номер протокола"));
  assert.ok(result.errors.some((error) => error.field === "Номер КБ" && error.message.includes("начинающиеся")));
});

test("rejects numeric identifiers instead of silently losing leading zeroes", async () => {
  const numeric = valid.replace('<x:c r="D2" t="inlineStr"><x:is><x:t>00123</x:t></x:is></x:c>', '<x:c r="D2"><x:v>123</x:v></x:c>');
  const result = await readBiotWorkbook(await workbookWith(numeric));
  assert.ok(result.errors.some((error) => error.rowNumber === 2 && error.field === "Номер удостоверения"));
});

test("reports duplicated nonempty numbers by row and field without revealing their values", async () => {
  const numbers = '<x:c r="E2" t="str"><x:v>PROT-1</x:v></x:c><x:c r="F2" t="str"><x:v>WIT-1</x:v></x:c><x:c r="G2" t="str"><x:v>REG-1</x:v></x:c>';
  const file = await workbookWith(valid + numbers, (files) => {
    const key = "xl/worksheets/sheet1.xml";
    const thirdRow = (valid + numbers).replaceAll("2\"", "3\"").replace("00123", " 00123 ");
    files[key] = strToU8(strFromU8(files[key]).replace(/<x:row r="3"[^>]*>.*?<\/x:row>/, `<x:row r="3">${thirdRow}</x:row>`));
  });
  const result = await readBiotWorkbook(file);
  const duplicates = result.errors.filter((error) => error.rowNumber === 3 && error.message.includes("повторяется"));
  assert.deepEqual(duplicates.map((error) => error.field), ["Номер удостоверения", "Номер протокола", "Номер КБ", "Регистрационный номер"]);
  assert.ok(duplicates.every((error) => error.message.includes("строке 2")));
  assert.ok(duplicates.every((error) => !/00123|PROT-1|WIT-1|REG-1/.test(error.message)));
});

test("number duplicate checks are case-sensitive and ignore blanks", async () => {
  const file = await workbookWith(valid.replace("00123", "abc"), (files) => {
    const key = "xl/worksheets/sheet1.xml";
    const thirdRow = valid.replaceAll("2\"", "3\"").replace("00123", "ABC");
    files[key] = strToU8(strFromU8(files[key]).replace(/<x:row r="3"[^>]*>.*?<\/x:row>/, `<x:row r="3">${thirdRow}</x:row>`));
  });
  const result = await readBiotWorkbook(file);
  assert.equal(result.errors.length, 0);
});

test("rejects unexpected headers, invalid archive, and oversized expanded archive", async () => {
  const badHeader = await workbookWith(valid, (files) => {
    files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]).replace("Должность RU", "Другой заголовок"));
  });
  await assert.rejects(() => readBiotWorkbook(badHeader), /Заголовки/);
  await assert.rejects(() => readBiotWorkbook(new File(["not a zip"], "table.xlsx")), /Не удалось прочитать/);
  const expanded = await workbookWith(valid, (files) => { files["extra.xml"] = new Uint8Array(17 * 1024 * 1024); });
  await assert.rejects(() => readBiotWorkbook(expanded), /Не удалось прочитать|слишком большой/);
});

test("rejects XML document type declarations", async () => {
  const file = await workbookWith(valid, (files) => {
    files["xl/workbook.xml"] = strToU8('<!DOCTYPE a [<!ENTITY a "x">]>' + strFromU8(files["xl/workbook.xml"]));
  });
  await assert.rejects(() => readBiotWorkbook(file), /Не удалось прочитать/);
});

test("rejects a truncated archive even if the worksheets were present", async () => {
  const file = await workbookWith(valid);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await assert.rejects(() => readBiotWorkbook(new File([bytes.subarray(0, bytes.length - 22) as BlobPart], "table.xlsx")), /Не удалось прочитать/);
});

test("rejects a modified worksheet whose ZIP checksum is unchanged", async () => {
  const file = await workbookWith(valid);
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const bytes = zipSync(files, { level: 0 });
  const marker = strToU8("00123");
  const index = bytes.findIndex((_, position) => marker.every((byte, offset) => bytes[position + offset] === byte));
  assert.ok(index >= 0);
  bytes[index + 4] = "4".charCodeAt(0);
  await assert.rejects(() => readBiotWorkbook(new File([bytes as BlobPart], "table.xlsx")), /Не удалось прочитать/);
});

test("limits actual expansion when ZIP headers understate the uncompressed size", async () => {
  const file = await workbookWith(valid, (files) => { files["extra.xml"] = new Uint8Array(17 * 1024 * 1024); });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const filename = strToU8("extra.xml");
  let changed = 0;
  for (let i = 46; i <= bytes.length - filename.length; i += 1) {
    if (!filename.every((byte, index) => bytes[i + index] === byte)) continue;
    if (view.getUint32(i - 30, true) === 0x04034b50) { view.setUint32(i - 30 + 22, 1, true); changed += 1; }
    if (view.getUint32(i - 46, true) === 0x02014b50) { view.setUint32(i - 46 + 24, 1, true); changed += 1; }
  }
  assert.equal(changed, 2);
  await assert.rejects(() => readBiotWorkbook(new File([bytes as BlobPart], "table.xlsx")), /слишком большой|Не удалось прочитать/);
});

test("rejects more than 100 filled data rows", async () => {
  const file = await workbookWith(valid, (files) => {
    const key = "xl/worksheets/sheet1.xml";
    let document = strFromU8(files[key]);
    for (let number = 3; number <= 101; number += 1) {
      const row = valid.replaceAll("A2", `A${number}`).replaceAll("B2", `B${number}`).replaceAll("D2", `D${number}`);
      document = document.replace(new RegExp(`<x:row r="${number}"[^>]*>.*?</x:row>`), `<x:row r="${number}">${row}</x:row>`);
    }
    document = document.replace("</x:sheetData>", `<x:row r="102">${valid.replaceAll("A2", "A102").replaceAll("B2", "B102").replaceAll("D2", "D102")}</x:row></x:sheetData>`);
    files[key] = strToU8(document);
  });
  await assert.rejects(() => readBiotWorkbook(file), /больше 100/);
});

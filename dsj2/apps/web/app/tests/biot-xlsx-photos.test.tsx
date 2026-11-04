import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readBiotWorkbook, validateBiotPhoto } from "../../lib/biot-xlsx-import";

const template = new URL("../../public/templates/biot-table.xlsx", import.meta.url);
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGO8ExDFwMDAxAAGABL0AYqPFZ0FAAAAAElFTkSuQmCC", "base64"));
const jpegUrl = new URL("./fixtures/biot-photo-test.jpg", import.meta.url);
const dataRow = '<x:c r="A2" t="inlineStr"><x:is><x:t>Тестовый сотрудник</x:t></x:is></x:c><x:c r="B2" t="inlineStr"><x:is><x:t>Инженер</x:t></x:is></x:c>';
const relBase = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ns = `xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${relBase}"`;
const marker = (row = 1, col = 7, rowOff = 0) => `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff></xdr:from>`;
const pic = (id = "image1") => `<xdr:pic><xdr:blipFill><a:blip r:embed="${id}"/></xdr:blipFill></xdr:pic>`;
const one = (row = 1, col = 7, cy = 100000, id = "image1") => `<xdr:oneCellAnchor>${marker(row, col)}<xdr:ext cx="100000" cy="${cy}"/>${pic(id)}<xdr:clientData/></xdr:oneCellAnchor>`;
const two = (row = 1, endRow = 2, endOffset = 0) => `<xdr:twoCellAnchor>${marker(row)}<xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${endRow}</xdr:row><xdr:rowOff>${endOffset}</xdr:rowOff></xdr:to>${pic()}<xdr:clientData/></xdr:twoCellAnchor>`;

async function workbookWithPhotos(anchor: string, configure?: (files: Record<string, Uint8Array>) => void) {
  const files = unzipSync(new Uint8Array(await readFile(template)));
  const path = "xl/worksheets/sheet1.xml";
  let worksheet = strFromU8(files[path]);
  worksheet = worksheet.replace(/<x:row r="2"[^>]*>.*?<\/x:row>/s, `<x:row r="2" ht="30" customHeight="1">${dataRow}</x:row>`);
  worksheet = worksheet.replace("</x:worksheet>", `<x:drawing xmlns:r="${relBase}" r:id="draw1"/></x:worksheet>`);
  files[path] = strToU8(worksheet);
  files["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="draw1" Type="${relBase}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  files["xl/drawings/drawing1.xml"] = strToU8(`<xdr:wsDr ${ns}>${anchor}</xdr:wsDr>`);
  files["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="${relBase}/image" Target="../media/image1.png"/><Relationship Id="image2" Type="${relBase}/image" Target="../media/image2.jpg"/></Relationships>`);
  files["xl/media/image1.png"] = png;
  files["xl/media/image2.jpg"] = new Uint8Array(await readFile(jpegUrl));
  configure?.(files);
  return new File([zipSync(files) as BlobPart], "photos.xlsx");
}

test("extracts a PNG anchored fully inside H2", async () => {
  const result = await readBiotWorkbook(await workbookWithPhotos(one()));
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].photo?.mimeType, "image/png");
  assert.deepEqual(result.rows[0].photo?.bytes, png);
});

test("accepts a two-cell anchor ending at the next row boundary", async () => {
  const result = await readBiotWorkbook(await workbookWithPhotos(two()));
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows[0].photo?.bytes, png);
});

test("extracts JPEG", async () => {
  const result = await readBiotWorkbook(await workbookWithPhotos(one(1, 7, 100000, "image2")));
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].photo?.mimeType, "image/jpeg");
  assert.deepEqual(result.rows[0].photo?.bytes, new Uint8Array(await readFile(jpegUrl)));
});

test("rejects ambiguous, outside-row, and duplicate photographs", async () => {
  for (const anchor of [one(1, 6), one(2, 7), one(1, 7, 500000), two(1, 2, 1), one() + one(1, 7, 100000, "image2")]) {
    const result = await readBiotWorkbook(await workbookWithPhotos(anchor));
    assert.ok(result.errors.some((error) => error.field === "Фото"));
  }
  const unsupported = await workbookWithPhotos('<xdr:absoluteAnchor/>');
  await assert.rejects(() => readBiotWorkbook(unsupported), /без однозначной привязки/);
});

test("rejects cell images, DISPIMG, and sheet backgrounds", async () => {
  const rich = await workbookWithPhotos(one(), (files) => { files["xl/richData/richValue.xml"] = strToU8("<richValue/>"); });
  await assert.rejects(() => readBiotWorkbook(rich), /Поместить в ячейку/);
  for (const cell of ['<x:c r="H2" vm="1"/>', '<x:c r="H2"><x:f>_xlfn.DISPIMG("image",1)</x:f></x:c>']) {
    const result = await readBiotWorkbook(await workbookWithPhotos(one(), (files) => {
      const key = "xl/worksheets/sheet1.xml";
      files[key] = strToU8(strFromU8(files[key]).replace(dataRow, dataRow + cell));
    }));
    assert.ok(result.errors.some((error) => error.field === "Фото"));
  }
  for (const element of ["picture", "legacyDrawing"]) {
    const file = await workbookWithPhotos(one(), (files) => {
      const key = "xl/worksheets/sheet1.xml";
      files[key] = strToU8(strFromU8(files[key]).replace("</x:worksheet>", `<x:${element}/></x:worksheet>`));
    });
    await assert.rejects(() => readBiotWorkbook(file), /фоновые и устаревшие/);
  }
});

test("rejects missing, external, incorrect-format and oversized photos", async () => {
  const badImage = await readBiotWorkbook(await workbookWithPhotos(one(), (files) => { files["xl/media/image1.png"] = strToU8("not an image"); }));
  assert.ok(badImage.errors.some((error) => error.field === "Фото"));
  const missing = await readBiotWorkbook(await workbookWithPhotos(one(), (files) => { delete files["xl/media/image1.png"]; }));
  assert.ok(missing.errors.some((error) => error.field === "Фото"));
  const external = await readBiotWorkbook(await workbookWithPhotos(one(), (files) => {
    const key = "xl/drawings/_rels/drawing1.xml.rels";
    files[key] = strToU8(strFromU8(files[key]).replace('Target="../media/image1.png"', 'Target="https://invalid.example/a.png" TargetMode="External"'));
  }));
  assert.ok(external.errors.some((error) => error.field === "Фото"));
  const oversized = await readBiotWorkbook(await workbookWithPhotos(one(), (files) => { files["xl/media/image1.png"] = new Uint8Array(10 * 1024 * 1024 + 1); }));
  assert.ok(oversized.errors.some((error) => error.field === "Фото" && error.message.includes("10 МиБ")));
});

test("limits actual image dimensions and checks format signatures", () => {
  const huge = new Uint8Array(png);
  new DataView(huge.buffer).setUint32(16, 12001);
  assert.throws(() => validateBiotPhoto(huge, "x.png"), /размеры слишком велики/);
  assert.throws(() => validateBiotPhoto(png, "x.jpg"), /только встроенные изображения/);
  assert.throws(() => validateBiotPhoto(new Uint8Array(0), "x.png"), /размер изображения/);
});

test("rejects reuse of the same attachment for two employees", async () => {
  const result = await readBiotWorkbook(await workbookWithPhotos(one() + one(2), (files) => {
    const key = "xl/worksheets/sheet1.xml";
    const third = dataRow.replaceAll("2\"", "3\"");
    files[key] = strToU8(strFromU8(files[key]).replace(/<x:row r="3"[^>]*>.*?<\/x:row>/s, `<x:row r="3" ht="30">${third}</x:row>`));
  }));
  assert.ok(result.errors.some((error) => error.field === "Фото" && error.message.includes("нескольким сотрудникам")));
});

test("rejects an invalid drawing relationship and malformed end anchor", async () => {
  const broken = await workbookWithPhotos(one(), (files) => { delete files["xl/worksheets/_rels/sheet1.xml.rels"]; });
  await assert.rejects(() => readBiotWorkbook(broken));
  const invalid = await readBiotWorkbook(await workbookWithPhotos(two().replace("<xdr:col>8</xdr:col>", "<xdr:col>-1</xdr:col>")));
  assert.ok(invalid.errors.some((error) => error.field === "Фото"));
});

test("rejects pictures spanning merged rows and text or an in-cell image in H", async () => {
  const merged = await readBiotWorkbook(await workbookWithPhotos(one(), (files) => {
    const key = "xl/worksheets/sheet1.xml";
    files[key] = strToU8(strFromU8(files[key]).replace("</x:worksheet>", '<x:mergeCells count="1"><x:mergeCell ref="H2:H3"/></x:mergeCells></x:worksheet>'));
  }));
  assert.ok(merged.errors.some((error) => error.field === "Фото" && error.message.includes("объединена")));
  const text = await readBiotWorkbook(await workbookWithPhotos(one(), (files) => {
    const key = "xl/worksheets/sheet1.xml";
    files[key] = strToU8(strFromU8(files[key]).replace(dataRow, dataRow + '<x:c r="H2" t="inlineStr"><x:is><x:t>Текст</x:t></x:is></x:c>'));
  }));
  assert.ok(text.errors.some((error) => error.field === "Фото" && error.message.includes("рисунок")));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateOfficeContainer,
  validateLearningText,
} from "../apps/api/src/lms/material-validation";
import { creditPlayback } from "../apps/api/src/lms/engine";

function crc32(bytes: Buffer) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function officeFixture(extraName?: string) {
  const files = [
    {
      name: "[Content_Types].xml",
      text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "word/document.xml",
      text: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
    },
    ...(extraName ? [{ name: extraName, text: "test" }] : []),
  ];
  const locals: Buffer[] = [],
    entries: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name),
      data = Buffer.from(file.text),
      local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    entries.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(entries),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const docx =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
test("OOXML requires bounded matching contents and rejects traversal, macros, tampering and wrong type", () => {
  const valid = officeFixture();
  assert.doesNotThrow(() => validateOfficeContainer(valid, docx));
  assert.throws(() =>
    validateOfficeContainer(
      valid,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
  assert.throws(() =>
    validateOfficeContainer(officeFixture("../outside.xml"), docx),
  );
  assert.throws(() =>
    validateOfficeContainer(officeFixture("word/vbaProject.bin"), docx),
  );
  const changed = Buffer.from(valid);
  changed[90] ^= 1;
  assert.throws(() => validateOfficeContainer(changed, docx));
  const oversized = Buffer.from(valid),
    central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversized.writeUInt32LE(101 * 1024 * 1024, central + 24);
  assert.throws(() => validateOfficeContainer(oversized, docx));
});
test("VTT and UTF8 are bounded passive text, malformed timing and active markup are rejected", () => {
  assert.doesNotThrow(() =>
    validateLearningText(
      Buffer.from(
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nСинтетический текст\n",
      ),
      "text/vtt",
    ),
  );
  assert.throws(() =>
    validateLearningText(
      Buffer.from("WEBVTT\n\nwrong --> bad\ntext"),
      "text/vtt",
    ),
  );
  assert.throws(() =>
    validateLearningText(
      Buffer.from(
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<script>bad</script>",
      ),
      "text/vtt",
    ),
  );
  assert.throws(() =>
    validateLearningText(Buffer.from([0xff, 0x00]), "text/plain"),
  );
});
test("video respects explicit rate, configured threshold, no-seek policy and interval union", () => {
  const base = {
    intervals: [] as [number, number][],
    previousPosition: 0,
    position: 20,
    elapsedSeconds: 10,
    duration: 40,
    playing: true,
    playbackRate: 2,
    allowedPlaybackRates: [1, 2],
    minimumPercent: 50,
  };
  const first = creditPlayback(base);
  assert.equal(first.watchedSeconds, 20);
  assert.equal(first.completed, true);
  assert.equal(
    creditPlayback({ ...base, allowedPlaybackRates: [1] }).watchedSeconds,
    0,
  );
  assert.equal(
    creditPlayback({ ...base, intervals: first.intervals }).watchedSeconds,
    20,
  );
  const seek = creditPlayback({
    ...base,
    playing: false,
    position: 39,
    allowSeekAhead: false,
  });
  assert.equal(seek.position, 0);
  assert.equal(seek.seekBlocked, true);
  assert.equal(seek.completed, false);
  assert.equal(
    creditPlayback({ ...base, position: 40, elapsedSeconds: 1 }).completed,
    false,
  );
});

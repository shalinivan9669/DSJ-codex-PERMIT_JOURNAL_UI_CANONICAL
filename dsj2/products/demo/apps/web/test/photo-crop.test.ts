import test from "node:test";
import assert from "node:assert/strict";
import {
  photoCrop,
  photoMetadata,
  preparePhoto,
  previewSize,
  PHOTO_PROCESS_TIMEOUT_MS,
} from "../lib/photo-crop";

function png(width: number, height: number) {
  const buffer = new ArrayBuffer(33);
  const view = new DataView(buffer);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buffer;
}
function jpeg(width: number, height: number, orientation: number) {
  const bytes = new Uint8Array(2 + 36 + 19 + 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe1);
  view.setUint16(4, 34);
  bytes.set([69, 120, 105, 102, 0, 0], 6);
  view.setUint16(12, 0x4949);
  view.setUint16(14, 42, true);
  view.setUint32(16, 8, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 0x112, true);
  view.setUint16(24, 3, true);
  view.setUint32(26, 1, true);
  view.setUint16(30, orientation, true);
  view.setUint16(38, 0xffc0);
  view.setUint16(40, 17);
  bytes[42] = 8;
  view.setUint16(43, height);
  view.setUint16(45, width);
  view.setUint16(57, 0xffd9);
  return bytes.buffer;
}

test("image headers enforce the pixel boundary before decoder work and map EXIF axes", () => {
  assert.deepEqual(photoMetadata(png(5000, 4000)), {
    width: 5000,
    height: 4000,
    orientation: 1,
  });
  assert.throws(() => photoMetadata(png(5001, 4000)), /20 мегапикселей/);
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8])
    assert.deepEqual(
      photoMetadata(jpeg(1200, 800, orientation)),
      orientation >= 5
        ? { width: 800, height: 1200, orientation }
        : { width: 1200, height: 800, orientation },
    );
  for (const buffer of [
    new ArrayBuffer(0),
    new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    new TextEncoder().encode("<svg>invalid raster</svg>").buffer,
  ])
    assert.throws(() => photoMetadata(buffer), /исправный PNG или JPEG/);
});

test("preview never exceeds 1600px; original-coordinate crops remain within all rotated bounds", () => {
  assert.deepEqual(previewSize({ width: 5000, height: 4000 }), {
    width: 1600,
    height: 1280,
  });
  assert.deepEqual(previewSize({ width: 240, height: 320 }), {
    width: 240,
    height: 320,
  });
  for (const size of [
    { width: 5000, height: 4000 },
    { width: 401, height: 599 },
  ]) {
    for (const rotation of [0, 90, 180, 270])
      for (const zoom of [1, 1.55, 3])
        for (const x of [0, 50, 100])
          for (const y of [0, 50, 100]) {
            const crop = photoCrop(size, rotation, zoom, x, y);
            assert.ok(crop.x >= 0 && crop.y >= 0);
            assert.ok(
              crop.x + crop.width <=
                (rotation % 180 ? size.height : size.width),
            );
            assert.ok(
              crop.y + crop.height <=
                (rotation % 180 ? size.width : size.height),
            );
            assert.ok(Math.abs(crop.height - (crop.width * 4) / 3) < 1);
          }
  }
});

test("processing cancels immediately and closes a late native bitmap", async (t) => {
  let complete!: (value: ImageBitmap) => void;
  let called!: () => void;
  let closed = false;
  const started = new Promise<void>((resolve) => {
    called = resolve;
  });
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (() => {
    called();
    return new Promise<ImageBitmap>((resolve) => {
      complete = resolve;
    });
  }) as typeof createImageBitmap;
  t.after(() => {
    globalThis.createImageBitmap = original;
  });
  const controller = new AbortController();
  const operation = preparePhoto(
    new File([png(5000, 4000)], "large.png"),
    controller.signal,
  );
  await started;
  controller.abort();
  await assert.rejects(operation, /остановлена/);
  complete({
    close() {
      closed = true;
    },
  } as ImageBitmap);
  await Promise.resolve();
  assert.equal(closed, true);
});

test("processing timeout releases the caller without waiting for a hung decoder", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (() =>
    new Promise(() => {})) as typeof createImageBitmap;
  t.after(() => {
    globalThis.createImageBitmap = original;
  });
  const operation = preparePhoto(
    new File([png(5000, 4000)], "large.png"),
    new AbortController().signal,
  );
  const rejected = assert.rejects(operation, /15 секунд/);
  t.mock.timers.tick(PHOTO_PROCESS_TIMEOUT_MS);
  await rejected;
});

test("native preview receives oriented 1600px dimensions while original dimensions are retained", async (t) => {
  const original = globalThis.createImageBitmap;
  const bitmap = { close() {} } as ImageBitmap;
  globalThis.createImageBitmap = ((
    _file: Blob,
    options: ImageBitmapOptions,
  ) => {
    assert.deepEqual(options, {
      imageOrientation: "from-image",
      resizeWidth: 1280,
      resizeHeight: 1600,
      resizeQuality: "high",
    });
    return Promise.resolve(bitmap);
  }) as typeof createImageBitmap;
  t.after(() => {
    globalThis.createImageBitmap = original;
  });
  const file = new File([jpeg(5000, 4000, 6)], "EXIF6.jpg");
  const result = await preparePhoto(file, new AbortController().signal);
  assert.equal(result.bitmap, bitmap);
  assert.equal(result.width, 4000);
  assert.equal(result.height, 5000);
});

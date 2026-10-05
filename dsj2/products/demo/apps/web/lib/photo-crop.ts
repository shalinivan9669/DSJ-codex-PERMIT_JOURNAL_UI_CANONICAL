import { LIMITS } from "@demo/contracts";

export const PHOTO_PREVIEW_SIDE = 1600;
export const PHOTO_PROCESS_TIMEOUT_MS = 15_000;
export const PHOTO_POST_TIMEOUT_MS = 65_000;
export type PhotoSize = { width: number; height: number };
export type PhotoCrop = PhotoSize & { x: number; y: number };
export type PreparedPhoto = PhotoSize & { bitmap: ImageBitmap };

function exifOrientation(view: DataView, offset: number, length: number) {
  const end = offset + length;
  if (length < 8) return 1;
  const little = view.getUint16(offset) === 0x4949;
  if (!little && view.getUint16(offset) !== 0x4d4d) return 1;
  if (view.getUint16(offset + 2, little) !== 42) return 1;
  const directory = offset + view.getUint32(offset + 4, little);
  if (directory < offset || directory + 2 > end) return 1;
  const count = view.getUint16(directory, little);
  for (let i = 0; i < count; i++) {
    const tag = directory + 2 + i * 12;
    if (tag + 12 > end) break;
    if (
      view.getUint16(tag, little) === 0x112 &&
      view.getUint16(tag + 2, little) === 3 &&
      view.getUint32(tag + 4, little) === 1
    ) {
      const value = view.getUint16(tag + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Read dimensions before native decoding, including EXIF's displayed axes. */
export function photoMetadata(
  bytes: ArrayBuffer,
): PhotoSize & { orientation: number } {
  const view = new DataView(bytes);
  let width = 0,
    height = 0,
    orientation = 1;
  if (
    view.byteLength >= 24 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a
  ) {
    width = view.getUint32(16);
    height = view.getUint32(20);
    for (let offset = 8; offset + 12 <= view.byteLength; ) {
      const length = view.getUint32(offset);
      if (offset + length + 12 > view.byteLength) break;
      if (view.getUint32(offset + 4) === 0x65584966)
        orientation = exifOrientation(view, offset + 8, length);
      offset += length + 12;
    }
  } else if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    for (let offset = 2; offset + 4 <= view.byteLength; ) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > view.byteLength) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
      }
      if (
        marker === 0xe1 &&
        length >= 16 &&
        view.getUint32(offset + 4) === 0x45786966 &&
        view.getUint16(offset + 8) === 0
      )
        orientation = exifOrientation(view, offset + 10, length - 8);
      offset += length + 2;
    }
  }
  if (!width || !height)
    throw new Error(
      "Не удалось прочитать изображение. Выберите исправный PNG или JPEG.",
    );
  if (width * height > LIMITS.imagePixels)
    throw new Error(
      "Изображение превышает 20 мегапикселей. Уменьшите его размер.",
    );
  return orientation >= 5
    ? { width: height, height: width, orientation }
    : { width, height, orientation };
}

export function previewSize(size: PhotoSize): PhotoSize {
  const ratio = Math.min(
    1,
    PHOTO_PREVIEW_SIDE / Math.max(size.width, size.height),
  );
  return {
    width: Math.max(1, Math.round(size.width * ratio)),
    height: Math.max(1, Math.round(size.height * ratio)),
  };
}

export function photoCrop(
  size: PhotoSize,
  rotation: number,
  zoom: number,
  x: number,
  y: number,
): PhotoCrop {
  const width = rotation % 180 ? size.height : size.width;
  const height = rotation % 180 ? size.width : size.height;
  const cropWidth = Math.max(
    1,
    Math.floor(Math.min(width, (height * 3) / 4) / zoom),
  );
  const cropHeight = Math.max(1, Math.floor((cropWidth * 4) / 3));
  return {
    x: Math.round(((width - cropWidth) * x) / 100),
    y: Math.round(((height - cropHeight) * y) / 100),
    width: cropWidth,
    height: cropHeight,
  };
}

/** Every draw uses only the one downsampled bitmap and the 300x400 output. */
export function drawPhotoCrop(
  target: HTMLCanvasElement,
  photo: PreparedPhoto,
  crop: PhotoCrop,
  rotation: number,
) {
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("Браузер не смог открыть предпросмотр фотографии.");
  const width = rotation % 180 ? photo.height : photo.width;
  const height = rotation % 180 ? photo.width : photo.height;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.save();
  ctx.scale(target.width / crop.width, target.height / crop.height);
  ctx.translate(-crop.x, -crop.y);
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(
    photo.bitmap,
    -photo.width / 2,
    -photo.height / 2,
    photo.width,
    photo.height,
  );
  ctx.restore();
}

export function preparePhoto(
  file: File,
  signal: AbortSignal,
): Promise<PreparedPhoto> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => finish(new Error("Обработка фотографии остановлена."));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "Обработка заняла больше 15 секунд. Выберите другое фото или повторите попытку.",
          ),
        ),
      PHOTO_PROCESS_TIMEOUT_MS,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void (async () => {
      if (file.size > LIMITS.photoBytes)
        throw new Error(
          "Файл больше 5 МБ. Выберите изображение меньшего размера.",
        );
      const metadata = photoMetadata(await file.arrayBuffer());
      if (finished) return;
      const size = previewSize(metadata);
      // Native asynchronous decoding/downsampling avoids a full-resolution
      // canvas on the UI thread. Browser applies EXIF before explicit rotation;
      // the API applies autoOrient() then the same explicit rotation.
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: "high",
      });
      if (finished) {
        bitmap.close();
        return;
      }
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve({ bitmap, width: metadata.width, height: metadata.height });
    })().catch((error: unknown) =>
      finish(
        error instanceof Error
          ? new Error(
              error.name === "InvalidStateError"
                ? "Не удалось прочитать изображение. Выберите исправный PNG или JPEG."
                : error.message,
            )
          : new Error("Не удалось обработать фотографию."),
      ),
    );
  });
}

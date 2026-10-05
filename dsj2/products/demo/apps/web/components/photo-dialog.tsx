"use client";
import { useEffect, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, ApiError, errorText } from "@/lib/api";
import {
  drawPhotoCrop,
  photoCrop,
  preparePhoto,
  PHOTO_POST_TIMEOUT_MS,
  type PreparedPhoto,
} from "@/lib/photo-crop";

type PhotoStage =
  | "select"
  | "processing"
  | "cropping"
  | "uploading"
  | "attaching"
  | "error";
export type PhotoSaveOptions = { signal: AbortSignal };

export function PhotoDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string, options: PhotoSaveOptions) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null);
  const [stage, setStage] = useState<PhotoStage>("select");
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState("");
  const [uploadedId, setUploadedId] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const bitmap = useRef<PreparedPhoto | null>(null);
  const operation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const busy = stage === "uploading" || stage === "attaching";
  const crop = prepared ? photoCrop(prepared, rotation, zoom, x, y) : null;

  function invalidate() {
    operation.current++;
    active.current?.abort();
    active.current = null;
  }
  function disposeBitmap() {
    bitmap.current?.bitmap.close();
    bitmap.current = null;
  }
  function close() {
    invalidate();
    disposeBitmap();
    onClose();
  }
  useEffect(
    () => () => {
      operation.current++;
      active.current?.abort();
      bitmap.current?.bitmap.close();
      bitmap.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!prepared || !canvas.current) return;
    try {
      drawPhotoCrop(
        canvas.current,
        prepared,
        photoCrop(prepared, rotation, zoom, x, y),
        rotation,
      );
    } catch (caught) {
      setError(errorText(caught));
      setStage("error");
    }
  }, [prepared, rotation, zoom, x, y]);

  async function choose(next: File) {
    invalidate();
    const current = operation.current;
    const controller = new AbortController();
    active.current = controller;
    disposeBitmap();
    setPrepared(null);
    setFile(null);
    setUploadedId("");
    setError("");
    setStage("processing");
    setRotation(0);
    setZoom(1);
    setX(50);
    setY(50);
    try {
      const photo = await preparePhoto(next, controller.signal);
      if (operation.current !== current) {
        photo.bitmap.close();
        return;
      }
      bitmap.current = photo;
      setPrepared(photo);
      setFile(next);
      setStage("cropping");
    } catch (caught) {
      if (operation.current !== current) return;
      setError(errorText(caught));
      setStage("error");
    } finally {
      if (operation.current === current) active.current = null;
    }
  }
  function stop() {
    invalidate();
    setStage(prepared ? "cropping" : "select");
    setError(
      "Загрузка остановлена. Можно повторить сохранение или выбрать другое фото.",
    );
  }
  function editCrop(update: () => void) {
    setUploadedId("");
    setError("");
    setStage("cropping");
    update();
  }
  async function upload() {
    if (!file || !prepared || !crop || busy) return;
    invalidate();
    const current = operation.current;
    const controller = new AbortController();
    active.current = controller;
    setError("");
    let attachment = Boolean(uploadedId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      const aborted = () => reject(new Error("Загрузка остановлена."));
      controller.signal.addEventListener("abort", aborted, { once: true });
      removeAbort = () =>
        controller.signal.removeEventListener("abort", aborted);
    });
    try {
      let id = uploadedId;
      if (!id) {
        setStage("uploading");
        const body = new FormData();
        body.set("file", file);
        body.set("rotation", String(rotation));
        body.set("crop", JSON.stringify(crop));
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                "Сервер не ответил за 65 секунд. Повторите сохранение фотографии.",
              ),
            );
            controller.abort();
          }, PHOTO_POST_TIMEOUT_MS);
        });
        const result = await Promise.race([
          api<{ id?: string; assetId?: string }>("/photos", {
            method: "POST",
            body,
            signal: controller.signal,
          }),
          timeout,
          cancelled,
        ]);
        clearTimeout(timer);
        if (operation.current !== current) return;
        id = result?.assetId || result?.id || "";
        if (!id) throw new Error("Сервер не вернул идентификатор фото.");
        setUploadedId(id);
      }
      attachment = true;
      setStage("attaching");
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              "Не удалось дождаться сохранения заявки. Повторите прикрепление.",
            ),
          );
          controller.abort();
        }, PHOTO_POST_TIMEOUT_MS);
      });
      await Promise.race([
        onSaved(id, { signal: controller.signal }),
        cancelled,
        timeout,
      ]);
      if (operation.current !== current || controller.signal.aborted) return;
      close();
    } catch (caught) {
      if (operation.current !== current) return;
      const message =
        caught instanceof ApiError && caught.status === 429
          ? "Сервер ограничил частоту загрузки. Подождите немного и повторите сохранение."
          : caught instanceof ApiError && caught.status === 503
            ? "Сервис фотографий временно недоступен. Повторите сохранение позже."
            : caught instanceof ApiError && caught.status === 413
              ? "Файл больше допустимого размера 5 МБ. Выберите другое фото."
              : errorText(caught);
      setError(
        attachment
          ? `Фото загружено, но не прикреплено к заявке. ${message}`
          : message,
      );
      setStage("error");
    } finally {
      clearTimeout(timer);
      removeAbort?.();
      if (operation.current === current) {
        active.current = null;
        setStage((previous) =>
          previous === "uploading" || previous === "attaching"
            ? "cropping"
            : previous,
        );
      }
    }
  }
  return (
    <Modal title="Фото для печати" onClose={close}>
      <p>PNG или JPEG до 5 МБ. Кадр 3 × 4.</p>
      {error && <Notice>{error}</Notice>}
      <div
        role="status"
        aria-live="polite"
        aria-busy={stage === "processing" || busy}
      >
        {stage === "processing"
          ? "Обрабатываем фотографию…"
          : stage === "uploading"
            ? "Загружаем фотографию…"
            : stage === "attaching"
              ? "Сохраняем фото в заявке…"
              : ""}
      </div>
      <label className="upload-zone">
        Выбрать фотографию
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (next) void choose(next);
          }}
        />
      </label>
      {file && <small>{file.name}</small>}
      {prepared && crop && (
        <div className="photo-editor">
          <canvas
            ref={canvas}
            width={300}
            height={400}
            aria-label="Предпросмотр обрезанной фотографии"
          />
          <div>
            <label>
              Поворот
              <select
                aria-label="Поворот"
                disabled={busy}
                value={rotation}
                onChange={(event) =>
                  editCrop(() => setRotation(Number(event.target.value)))
                }
              >
                <option value="0">Без поворота</option>
                <option value="90">90° вправо</option>
                <option value="180">180°</option>
                <option value="270">90° влево</option>
              </select>
            </label>
            <label>
              Масштаб
              <input
                disabled={busy}
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(event) =>
                  editCrop(() => setZoom(Number(event.target.value)))
                }
              />
            </label>
            <label>
              По горизонтали
              <input
                disabled={busy}
                type="range"
                min="0"
                max="100"
                value={x}
                onChange={(event) =>
                  editCrop(() => setX(Number(event.target.value)))
                }
              />
            </label>
            <label>
              По вертикали
              <input
                disabled={busy}
                type="range"
                min="0"
                max="100"
                value={y}
                onChange={(event) =>
                  editCrop(() => setY(Number(event.target.value)))
                }
              />
            </label>
            <small>
              {crop.width} × {crop.height} px в печатном кадре
            </small>
            {crop.width < 354 && (
              <Notice kind="info">
                Для качественной печати 3 × 4 см рекомендуется кадр не менее 354
                × 472 px.
              </Notice>
            )}
          </div>
        </div>
      )}
      <div className="modal-actions">
        {busy || stage === "processing" ? (
          <button onClick={stop}>Остановить</button>
        ) : (
          <button onClick={close}>Отмена</button>
        )}
        <button
          className="primary"
          disabled={!file || !prepared || busy || stage === "processing"}
          onClick={() => void upload()}
        >
          {stage === "uploading"
            ? "Загружаем…"
            : stage === "attaching"
              ? "Сохраняем…"
              : uploadedId
                ? "Повторить прикрепление"
                : "Сохранить фото"}
        </button>
      </div>
    </Modal>
  );
}

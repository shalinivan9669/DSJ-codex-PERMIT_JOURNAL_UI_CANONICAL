"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { matchBulkPhotos, photoEmployerScope } from "@/lib/bulk-photos";
import type { Recipient } from "@/lib/types";

export function BulkPhotoDialog({
  items,
  customerId,
  disabled = false,
  onApply,
  onClose,
}: {
  items: Recipient[];
  customerId?: string | null;
  disabled?: boolean;
  onApply: (updates: Record<string, string>) => Promise<boolean | undefined>;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<"EXTERNAL_ID" | "PERSONNEL_NUMBER">(
    "EXTERNAL_ID",
  );
  const [scope, setScope] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [throttled, setThrottled] = useState(false);
  const cancelled = useRef(false);
  const resumeWait = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      cancelled.current = true;
      resumeWait.current?.();
    },
    [],
  );
  const errorRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(
    () =>
      matchBulkPhotos(items, files, { mode, employerScope: scope, customerId }),
    [items, files, mode, scope, customerId],
  );
  const scopes = [
    ...new Map(
      items
        .filter((item) => photoEmployerScope(item, customerId))
        .map((item) => [
          photoEmployerScope(item, customerId),
          [
            item.workplaceRu || item.employerBin || "Заказчик заявки",
            item.employmentPeriod || "Текущий период",
          ].join(" · "),
        ]),
    ).entries(),
  ];
  const selected = matches.rows.filter(
    (row) =>
      row.category === "matched" &&
      (replace || !items.find((item) => item.id === row.rowId)?.photoAssetId),
  );
  async function apply() {
    if (!confirmed || matches.errors.length || !selected.length) return;
    setBusy(true);
    cancelled.current = false;
    setError("");
    const ready = { ...uploaded };
    try {
      // Bounded sequential uploads preserve completed assets for a safe retry.
      for (const row of selected) {
        if (cancelled.current) throw new Error("Загрузка остановлена.");
        if (ready[row.fileIndex]) continue;
        const data = new FormData();
        data.set("file", files[row.fileIndex]);
        let result: { assetId?: string; id?: string } | undefined;
        for (let attempt = 0; !result; attempt++) {
          if (cancelled.current) throw new Error("Загрузка остановлена.");
          try {
            result = await api<{ assetId?: string; id?: string }>("/photos", {
              method: "POST",
              body: data,
            });
          } catch (cause) {
            if (
              !(cause instanceof ApiError) ||
              cause.status !== 429 ||
              attempt >= 3
            )
              throw cause;
            // The API deliberately limits upload traffic. Keep the same file and
            // already accepted assets while waiting for its minute-long window.
            setThrottled(true);
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(
                resolve,
                Math.max(1000, cause.retryAfterMs ?? 61_000),
              );
              resumeWait.current = () => {
                clearTimeout(timeout);
                resolve();
              };
            });
            resumeWait.current = undefined;
            setThrottled(false);
          }
        }
        const assetId = result.assetId || result.id;
        if (!assetId)
          throw new Error("Сервер не вернул сохранённую фотографию");
        ready[row.fileIndex] = assetId;
        setUploaded({ ...ready });
      }
      if (cancelled.current) throw new Error("Загрузка остановлена.");
      const applied = await onApply(
        Object.fromEntries(
          selected.map((row) => [row.rowId!, ready[row.fileIndex]]),
        ),
      );
      if (applied) onClose();
      else
        throw new Error(
          "Не удалось сохранить сопоставление в заявку. Проверьте сообщение о редакции и повторите применение.",
        );
    } catch (cause) {
      setError(
        errorText(cause) +
          " Успешно загруженные фото сохранены. Повторите применение для оставшихся файлов.",
      );
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setThrottled(false);
      setBusy(false);
    }
  }
  const locked = disabled || busy;
  return (
    <Modal
      title="Фотографии по списку"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p>
        Назовите файлы по внешнему ID человека (например, DEMO-P001.jpg) или по
        табельному номеру (000001.png). Проверьте совпадения и примените
        фотографии к списку.
      </p>
      <div ref={errorRef} tabIndex={-1}>
        {error && <Notice>{error}</Notice>}
      </div>
      <label className="field">
        Ключ в имени файла
        <select
          disabled={locked}
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as typeof mode);
            setConfirmed(false);
          }}
        >
          <option value="EXTERNAL_ID">Внешний ID человека</option>
          <option value="PERSONNEL_NUMBER">
            Табельный номер у работодателя
          </option>
        </select>
      </label>
      {mode === "PERSONNEL_NUMBER" && (
        <label className="field">
          Работодатель и период
          <select
            disabled={locked}
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setConfirmed(false);
            }}
          >
            <option value="">Выберите работодателя</option>
            {scopes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Фотографии PNG/JPEG
        <input
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          multiple
          disabled={locked}
          onChange={(event) => {
            setFiles(Array.from(event.target.files || []));
            setUploaded({});
            setConfirmed(false);
            setError("");
          }}
        />
      </label>
      {matches.errors.map((message) => (
        <Notice key={message}>{message}</Notice>
      ))}
      {!!files.length && (
        <>
          <p role="status">
            Совпало: {matches.matched}. Неоднозначных файлов:{" "}
            {matches.ambiguous}. Получателей без подходящего файла:{" "}
            {matches.missing.length}.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Файл</th>
                  <th>Получатель</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {matches.rows.map((row) => (
                  <tr key={row.fileIndex}>
                    <td>{row.fileName}</td>
                    <td>
                      {row.rowId
                        ? items.find((item) => item.id === row.rowId)
                            ?.fullNameRu
                        : "—"}
                    </td>
                    <td>
                      {row.category === "matched"
                        ? "Однозначное совпадение"
                        : row.category === "ambiguous"
                          ? "Уточните ключ: несколько совпадений"
                          : row.category === "invalid"
                            ? row.reason
                            : "Ключ не найден"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="check">
            <input
              type="checkbox"
              disabled={locked}
              checked={replace}
              onChange={(event) => {
                setReplace(event.target.checked);
                setConfirmed(false);
              }}
            />
            Заменить ранее выбранные фотографии
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={locked}
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Проверены однозначные совпадения: применить {selected.length} фото.
            Остальные строки сохранить.
          </label>
          {busy && (
            <p role="status">
              Загрузка: {Object.keys(uploaded).length} из {selected.length}
              {throttled &&
                ". Сервер ограничил частоту загрузки. Продолжим автоматически после паузы; загруженные фото сохранены."}
            </p>
          )}
        </>
      )}
      <div className="actions">
        {busy && (
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              resumeWait.current?.();
            }}
          >
            Остановить загрузку
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Отмена
        </button>
        <button
          type="button"
          disabled={
            locked || !confirmed || !selected.length || !!matches.errors.length
          }
          onClick={() => void apply()}
        >
          {busy ? "Загрузка фотографий…" : `Применить ${selected.length} фото`}
        </button>
      </div>
    </Modal>
  );
}

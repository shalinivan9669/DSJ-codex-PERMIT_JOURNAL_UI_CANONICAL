"use client";
import { useEffect, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import {
  translationReviewIsCurrent,
  type TranslationSnapshot,
} from "@/lib/translation-review";

export function TranslationSuggestion({
  source,
  field,
  target,
  disabled,
  currentText = "",
  compact = false,
  onApply,
}: {
  source: string;
  field: "positionRu" | "trainingSubject";
  target: "kk" | "en";
  disabled: boolean;
  currentText?: string;
  compact?: boolean;
  onApply: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [snapshot, setSnapshot] = useState<TranslationSnapshot | null>(null);
  const serial = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ source, currentText, disabled, onApply });
  latest.current = { source, currentText, disabled, onApply };
  const current = translationReviewIsCurrent(snapshot, source, currentText);
  useEffect(
    () => () => {
      serial.current++;
      controller.current?.abort();
    },
    [],
  );
  function close() {
    serial.current++;
    controller.current?.abort();
    setBusy(false);
    setOpen(false);
  }
  async function suggest() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const attempt = ++serial.current;
    const reviewed = {
      source: latest.current.source,
      destination: latest.current.currentText,
    };
    setSnapshot(reviewed);
    setOpen(true);
    setBusy(true);
    setError("");
    setText("");
    setNote("");
    try {
      const result = await api<{
        items: { translation: string; provider?: string }[];
        providerConfigured: boolean;
      }>("/translations/suggest", {
        method: "POST",
        signal: abort.signal,
        body: json({ target, texts: [{ key: field, text: reviewed.source }] }),
      });
      if (attempt !== serial.current || abort.signal.aborted) return;
      setText(result.items[0]?.translation || "");
      setNote(
        result.items[0]?.translation
          ? "Проверьте терминологию и при необходимости исправьте текст перед применением."
          : "Для этого текста нет предложения. Введите перевод вручную; сервис автоматического перевода пока не подключён.",
      );
    } catch (caught) {
      if (attempt === serial.current && !abort.signal.aborted)
        setError(errorText(caught));
    } finally {
      if (attempt === serial.current) setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className={`text-button${compact ? " recipient-grid-translate" : ""}`}
        disabled={disabled || !source.trim() || busy}
        onClick={() => void suggest()}
      >
        {busy
          ? "Переводим…"
          : compact
            ? "Перевести на KZ"
            : `Предложить перевод · ${target === "kk" ? "KZ" : "EN"}`}
      </button>
      {open && (
        <Modal title="Проверка перевода" onClose={close}>
          <p>
            <strong>Исходный текст:</strong> {snapshot?.source}
          </p>
          {snapshot?.destination && (
            <p>
              Существующий вариант: {snapshot.destination}. Применение заменит
              его только после вашего подтверждения.
            </p>
          )}
          {!current && (
            <Notice>
              Исходный текст или языковой вариант изменился. Старое предложение
              нельзя применить. Получите новый перевод для текущего ввода.
            </Notice>
          )}
          {busy && <p role="status">Получаем предложение…</p>}
          {error && <Notice>{error}</Notice>}
          {note && <p>{note}</p>}
          <label>
            Проверенный перевод
            <textarea
              disabled={busy}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
            />
          </label>
          <div className="modal-actions">
            <button onClick={close}>Отмена</button>
            {(error || !current || (!busy && !text)) && (
              <button
                disabled={busy || disabled || !source.trim()}
                onClick={() => void suggest()}
              >
                Повторить перевод
              </button>
            )}
            <button
              className="primary"
              disabled={disabled || busy || !text.trim() || !current}
              onClick={() => {
                if (
                  latest.current.disabled ||
                  !translationReviewIsCurrent(
                    snapshot,
                    latest.current.source,
                    latest.current.currentText,
                  )
                )
                  return;
                latest.current.onApply(text.trim());
                close();
              }}
            >
              Применить проверенный текст
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

"use client";
import { useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";

export function TranslationSuggestion({
  source,
  field,
  target,
  disabled,
  onApply,
}: {
  source: string;
  field: "positionRu" | "trainingSubject";
  target: "kk" | "en";
  disabled: boolean;
  onApply: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  async function suggest() {
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
        body: json({ target, texts: [{ key: field, text: source }] }),
      });
      setText(result.items[0]?.translation || "");
      setNote(
        result.items[0]?.translation
          ? "Проверьте терминологию и при необходимости исправьте текст перед применением."
          : "Для этого текста нет предложения. Введите перевод вручную; сервис автоматического перевода пока не подключён.",
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="text-button"
        disabled={disabled || !source.trim() || busy}
        onClick={() => void suggest()}
      >
        Предложить перевод · {target === "kk" ? "KZ" : "EN"}
      </button>
      {open && (
        <Modal title="Проверка перевода" onClose={() => setOpen(false)}>
          <p>
            <strong>Исходный текст:</strong> {source}
          </p>
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
            <button onClick={() => setOpen(false)}>Отмена</button>
            <button
              className="primary"
              disabled={busy || !text.trim()}
              onClick={() => {
                onApply(text.trim());
                setOpen(false);
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

"use client";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { downloadExport, errorText } from "@/lib/api";
import {
  documentTitle,
  type Artifact,
  type Draft,
  type Issuance,
} from "@/lib/types";

export function SavedPrintSet({
  draft,
  issuances,
  artifacts,
}: {
  draft: Draft;
  issuances: Issuance[];
  artifacts: Artifact[];
}) {
  const [person, setPerson] = useState(""),
    [form, setForm] = useState(""),
    [format, setFormat] = useState("PDF");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const documents = issuances.flatMap((issuance) =>
    (issuance.documents || []).map((document) => ({
      ...document,
      issuanceStatus: issuance.status,
    })),
  );
  const files = artifacts.flatMap((artifact) => {
    const document = documents.find(
      (value) => value.id === artifact.documentId,
    );
    if (
      !artifact.issuanceId ||
      !document ||
      !["PDF", "DOCX"].includes((artifact.format || "").toUpperCase())
    )
      return [];
    const row = draft.items.find((value) => value.id === document.rowId);
    return [
      {
        artifact,
        document,
        personId: row?.id || "group",
        personName: row?.fullNameRu || "Общий документ события",
      },
    ];
  });
  const people = [
    ...new Map(files.map((file) => [file.personId, file.personName])).entries(),
  ];
  const forms = [...new Set(documents.map((document) => document.templateId))];
  const awaitingSignatures = issuances.some((issuance) =>
    ["RENDERING", "AWAITING_SIGNATURE"].includes(issuance.status || ""),
  );
  const visible = files.filter(
    (file) =>
      (!person || file.personId === person) &&
      (!form || file.document.templateId === form) &&
      (!format || file.artifact.format?.toUpperCase() === format),
  );
  const available = visible.filter(
    (file) => file.artifact.availability !== "MISSING",
  );
  const chosen = selected.filter((id) =>
    available.some((file) => file.artifact.id === id),
  );
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setSelected([]);
    setNotice("");
    setError("");
  }
  async function download() {
    if (!chosen.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await downloadExport(
        `/print-requests/${draft.id}/export`,
        { format: "ZIP", artifactIds: chosen },
        "Выбранные сохранённые документы.zip",
      );
      setNotice(
        "Выбранные оригиналы подготовлены. Состав выдачи и масштаб файлов сохранены.",
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  if (!files.length) return null;
  return (
    <details className="outcome-entry">
      <summary>Выборочная печать и скачивание сохранённых документов</summary>
      <p>
        Выберите человека, форму и формат. Скачивание использует сохранённые
        файлы и номера. Факт передачи или перепечатки фиксируется отдельно в
        согласовании.
      </p>
      <div className="form-grid">
        <label>
          Получатель для выборочной выдачи
          <select
            disabled={busy}
            value={person}
            onChange={(event) => change(setPerson, event.target.value)}
          >
            <option value="">Все получатели</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Форма для выборочной выдачи
          <select
            disabled={busy}
            value={form}
            onChange={(event) => change(setForm, event.target.value)}
          >
            <option value="">Все формы</option>
            {forms.map((id) => (
              <option key={id} value={id}>
                {documentTitle(id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Формат выборочной выдачи
          <select
            disabled={busy}
            value={format}
            onChange={(event) => change(setFormat, event.target.value)}
          >
            <option value="PDF">PDF</option>
            <option value="DOCX">DOCX</option>
            <option value="">PDF и DOCX</option>
          </select>
        </label>
      </div>
      <p>
        <strong>Профиль: сохранённый макет, исходный масштаб 100%.</strong>{" "}
        Размер страниц, ориентация и расположение элементов остаются как в
        оформленном файле. Дополнительная раскладка нескольких документов на
        лист не применяется. В диалоге принтера используйте «Фактический
        размер».
      </p>
      {error && <Notice>{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      <label className="checkbox">
        <input
          type="checkbox"
          disabled={busy || !available.length}
          checked={
            !!available.length &&
            available.every((file) => chosen.includes(file.artifact.id))
          }
          onChange={(event) =>
            setSelected(
              event.target.checked
                ? available.map((file) => file.artifact.id)
                : [],
            )
          }
        />
        Выбрать все доступные файлы по фильтру
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Выбор</th>
              <th>Получатель</th>
              <th>Документ</th>
              <th>Формат</th>
              <th>Состояние</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ artifact, document, personName }) => (
              <tr key={artifact.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Выбрать ${artifact.format} ${document.number} для ${personName}`}
                    disabled={busy || artifact.availability === "MISSING"}
                    checked={chosen.includes(artifact.id)}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? [...chosen, artifact.id]
                          : chosen.filter((id) => id !== artifact.id),
                      )
                    }
                  />
                </td>
                <td>{personName}</td>
                <td>
                  {documentTitle(document.templateId, !document.rowId)} · №{" "}
                  {document.number}
                </td>
                <td>{artifact.format}</td>
                <td>
                  {artifact.availability === "MISSING"
                    ? "Файл недоступен — требуется восстановление"
                    : document.issuanceStatus === "REPLACED"
                      ? "Сохранённая история — выпуск заменён"
                      : document.issuanceStatus === "CANCELLED"
                        ? "Сохранённая история — выпуск отменён"
                        : "Сохранённый оригинал"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>Под выбранный фильтр файлы не найдены.</p>}
      {awaitingSignatures && (
        <p>
          До проверки всех подписей отдельные PDF доступны выше кнопками
          «Печать» и «Скачать». Выборочный комплект ZIP будет доступен после
          подписания.
        </p>
      )}
      <button
        disabled={busy || !chosen.length || awaitingSignatures}
        onClick={() => void download()}
      >
        {busy
          ? "Подготавливаем выбранные файлы…"
          : `Скачать выбранные файлы (${chosen.length})`}
      </button>
    </details>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import { LIMITS } from "@demo/contracts";
import { api, errorText } from "@/lib/api";
import {
  newAssignment,
  templateLabels,
  type AppContext,
  type Assignment,
  type Recipient,
} from "@/lib/types";

export function RecipientDetails({
  recipient,
  disabled,
  onChange,
  context,
  rowIndex,
  fieldErrors,
}: {
  recipient: Recipient;
  disabled: boolean;
  onChange: (recipient: Recipient) => void;
  context: AppContext;
  rowIndex: number;
  fieldErrors: Record<string, string>;
}) {
  const [photoOpen, setPhotoOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("documents");
  function field(index: number, key: string) {
    const path = `items.${rowIndex}.assignments.${index}.${key}`;
    const labels: Record<string, string> = {
      documentDate: "Дата документа",
      validUntil: "Действителен до",
      trainingStart: "Начало обучения",
      trainingEnd: "Окончание обучения",
      protocolDate: "Дата протокола",
      trainingSubject: "Программа / тема обучения",
      result: "Подтверждённый результат / оценка",
      externalBasisNumber: "Внешний номер основания",
      reason: "Причина проверки знаний",
      education: "Образование",
    };
    return {
      "aria-label": labels[key],
      "data-field-path": path,
      "aria-invalid": !!fieldErrors[path],
      "aria-describedby": fieldErrors[path]
        ? `error-${recipient.id}-${index}-${key}`
        : undefined,
    };
  }
  function fieldError(index: number, key: string) {
    const message =
      fieldErrors[`items.${rowIndex}.assignments.${index}.${key}`];
    return message ? (
      <small
        className="field-error"
        id={`error-${recipient.id}-${index}-${key}`}
      >
        {message}
      </small>
    ) : null;
  }
  function changeAssignment(id: string, patch: Partial<Assignment>) {
    onChange({
      ...recipient,
      assignments: recipient.assignments.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  }
  return (
    <>
      <div className="recipient-heading">
        <div>
          <small className="muted">Выбранный получатель</small>
          <h3>{recipient.fullNameRu || "Новый получатель"}</h3>
        </div>
        {recipient.photoAssetId ? (
          <button
            disabled={disabled}
            className="photo-small"
            onClick={() => setPhotoOpen(true)}
            aria-label="Изменить фото получателя"
          >
            <img
              src={`/api/photos/${recipient.photoAssetId}`}
              alt="Фото получателя"
            />
          </button>
        ) : (
          <button
            disabled={disabled}
            className="photo-add"
            onClick={() => setPhotoOpen(true)}
          >
            <Icon name="person" />
            <span>Фото</span>
          </button>
        )}
      </div>
      <div className="tabs" role="tablist" aria-label="Данные получателя">
        <button
          role="tab"
          aria-selected={activeTab === "documents"}
          onClick={() => setActiveTab("documents")}
        >
          Документы ({recipient.assignments.length})
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "person"}
          onClick={() => setActiveTab("person")}
        >
          Личные данные
        </button>
      </div>
      {activeTab === "person" ? (
        <div className="person-fields">
          <label>
            ФИО · RU
            <input
              disabled={disabled}
              value={recipient.fullNameRu}
              onChange={(event) =>
                onChange({ ...recipient, fullNameRu: event.target.value })
              }
            />
          </label>
          <label>
            ФИО · KZ
            <input
              disabled={disabled}
              value={recipient.fullNameKz}
              onChange={(event) =>
                onChange({ ...recipient, fullNameKz: event.target.value })
              }
            />
          </label>
          <div className="helper-line">
            <small>Поля RU и KZ независимы.</small>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() =>
                onChange({ ...recipient, fullNameKz: recipient.fullNameRu })
              }
            >
              Скопировать ФИО RU → KZ
            </button>
          </div>
          {[
            ["positionRu", "Должность · RU"],
            ["positionKz", "Должность · KZ"],
            ["workplaceRu", "Место работы · RU"],
            ["workplaceKz", "Место работы · KZ"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                disabled={disabled}
                value={String(recipient[key as keyof Recipient] || "")}
                onChange={(event) =>
                  onChange({ ...recipient, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <button
            className="text-button"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...recipient,
                positionKz: recipient.positionRu,
                workplaceKz: recipient.workplaceRu,
              })
            }
          >
            Скопировать должность и место работы RU → KZ
          </button>
          {recipient.photoAssetId && (
            <button
              className="text-button danger-text"
              disabled={disabled}
              onClick={() => onChange({ ...recipient, photoAssetId: null })}
            >
              Убрать фото из получателя
            </button>
          )}
        </div>
      ) : (
        <div className="assignment-list">
          {recipient.assignments.map((assignment, index) => (
            <details key={assignment.id} open={index === 0}>
              <summary
                data-field-path={`items.${rowIndex}.assignments.${index}`}
              >
                {templateLabels[assignment.templateId] || assignment.templateId}
                <span>{assignment.documentDate || "Дата не указана"}</span>
              </summary>
              <div className="assignment-fields">
                <label>
                  Форма документа
                  <select
                    aria-label="Форма документа"
                    disabled={disabled}
                    value={assignment.templateId}
                    onChange={(event) =>
                      changeAssignment(assignment.id, {
                        templateId: event.target
                          .value as Assignment["templateId"],
                        ...(event.target.value.endsWith("-protocol")
                          ? { protocolMode: "INDIVIDUAL" as const }
                          : {}),
                      })
                    }
                  >
                    {Object.entries(templateLabels).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-grid compact">
                  <label>
                    Дата документа
                    <input
                      {...field(index, "documentDate")}
                      type="date"
                      disabled={disabled}
                      value={assignment.documentDate}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          documentDate: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "documentDate")}
                  </label>
                  <label>
                    Действителен до
                    <input
                      {...field(index, "validUntil")}
                      type="date"
                      disabled={disabled}
                      value={assignment.validUntil}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          validUntil: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "validUntil")}
                  </label>
                  <label>
                    Начало обучения
                    <input
                      {...field(index, "trainingStart")}
                      type="date"
                      disabled={disabled}
                      value={assignment.trainingStart}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          trainingStart: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "trainingStart")}
                  </label>
                  <label>
                    Окончание обучения
                    <input
                      {...field(index, "trainingEnd")}
                      type="date"
                      disabled={disabled}
                      value={assignment.trainingEnd}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          trainingEnd: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "trainingEnd")}
                  </label>
                  <label>
                    Дата протокола
                    <input
                      {...field(index, "protocolDate")}
                      type="date"
                      disabled={disabled}
                      value={assignment.protocolDate}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          protocolDate: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "protocolDate")}
                  </label>
                  <label>
                    Объём обучения, часов
                    <input
                      disabled={disabled}
                      value={assignment.hours}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          hours: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <label>
                  Программа / тема обучения
                  <textarea
                    {...field(index, "trainingSubject")}
                    disabled={disabled}
                    value={assignment.trainingSubject}
                    onChange={(event) =>
                      changeAssignment(assignment.id, {
                        trainingSubject: event.target.value,
                      })
                    }
                  />
                  {fieldError(index, "trainingSubject")}
                </label>
                <label>
                  Подтверждённый результат / оценка
                  <input
                    {...field(index, "result")}
                    disabled={disabled}
                    value={assignment.result}
                    placeholder="Укажите фактический результат"
                    onChange={(event) =>
                      changeAssignment(assignment.id, {
                        result: event.target.value,
                      })
                    }
                  />
                  {fieldError(index, "result")}
                </label>
                {assignment.templateId === "ptm-protocol" && (
                  <label>
                    Причина проверки знаний
                    <input
                      {...field(index, "reason")}
                      disabled={disabled}
                      maxLength={500}
                      value={assignment.reason || ""}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          reason: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "reason")}
                    <small>
                      Укажите фактическую причину, если она применима.
                    </small>
                  </label>
                )}
                {assignment.templateId === "pb-protocol" && (
                  <label>
                    Образование
                    <input
                      {...field(index, "education")}
                      disabled={disabled}
                      maxLength={500}
                      value={assignment.education || ""}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          education: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "education")}
                    <small>
                      Необязательное поле. Вносите подтверждённые сведения.
                    </small>
                  </label>
                )}
                <label>
                  Основание
                  <select
                    disabled={
                      disabled || assignment.templateId.endsWith("-protocol")
                    }
                    value={assignment.protocolMode}
                    onChange={(event) =>
                      changeAssignment(assignment.id, {
                        protocolMode: event.target
                          .value as Assignment["protocolMode"],
                      })
                    }
                  >
                    <option value="INDIVIDUAL">Индивидуальный документ</option>
                    <option value="EXTERNAL_REFERENCE">
                      Внешний протокол / основание
                    </option>
                  </select>
                </label>
                <label>
                  Внешний номер основания
                  <input
                    {...field(index, "externalBasisNumber")}
                    disabled={disabled}
                    value={assignment.externalBasisNumber}
                    onChange={(event) =>
                      changeAssignment(assignment.id, {
                        externalBasisNumber: event.target.value,
                      })
                    }
                  />
                  {fieldError(index, "externalBasisNumber")}
                </label>
                <small className="muted">
                  Номер печатного документа назначит сервер. Внешний номер
                  основания хранится отдельно.
                </small>
                {!disabled && (
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      onChange({
                        ...recipient,
                        assignments: recipient.assignments.filter(
                          (item) => item.id !== assignment.id,
                        ),
                      })
                    }
                  >
                    Удалить этот документ
                  </button>
                )}
              </div>
            </details>
          ))}
          {!disabled && (
            <button
              className="add-document"
              disabled={recipient.assignments.length >= 10}
              onClick={() =>
                onChange({
                  ...recipient,
                  assignments: [...recipient.assignments, newAssignment()],
                })
              }
            >
              <Icon name="plus" />
              Добавить документ
            </button>
          )}
        </div>
      )}
      <small className="timezone-note">
        Календарные даты центра · {context.tenant.timezone}
      </small>
      {photoOpen && (
        <PhotoDialog
          onClose={() => setPhotoOpen(false)}
          onSaved={(id) => {
            onChange({ ...recipient, photoAssetId: id });
            setPhotoOpen(false);
          }}
        />
      )}
    </>
  );
}
function PhotoDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const orientedWidth = rotation % 180 ? size.height : size.width;
  const orientedHeight = rotation % 180 ? size.width : size.height;
  const width = Math.min(orientedWidth, (orientedHeight * 3) / 4) / zoom;
  const height = (width * 4) / 3;
  const crop = {
    x: Math.round(((orientedWidth - width) * x) / 100),
    y: Math.round(((orientedHeight - height) * y) / 100),
    width: Math.floor(width),
    height: Math.floor(height),
  };
  useEffect(() => {
    if (!file) return;
    imageRef.current = null;
    setSize({ width: 0, height: 0 });
    const url = URL.createObjectURL(file);
    setSource(url);
    const image = new Image();
    image.onload = () => {
      if (image.width * image.height > LIMITS.imagePixels) {
        setError(
          "Изображение превышает 20 мегапикселей. Уменьшите его размер.",
        );
        setFile(null);
        return;
      }
      imageRef.current = image;
      setSize({ width: image.width, height: image.height });
    };
    image.onerror = () => {
      setError(
        "Не удалось прочитать изображение. Выберите исправный PNG или JPEG.",
      );
      setFile(null);
    };
    image.src = url;
    return () => {
      image.onload = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  useEffect(() => {
    const image = imageRef.current;
    const target = canvas.current;
    if (!image || !target || !crop.width) return;
    const oriented = document.createElement("canvas");
    oriented.width = orientedWidth;
    oriented.height = orientedHeight;
    const stage = oriented.getContext("2d");
    const ctx = target.getContext("2d");
    if (!ctx || !stage) return;
    stage.translate(orientedWidth / 2, orientedHeight / 2);
    stage.rotate((rotation * Math.PI) / 180);
    stage.drawImage(image, -size.width / 2, -size.height / 2);
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(
      oriented,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      target.width,
      target.height,
    );
  }, [
    source,
    size,
    rotation,
    zoom,
    x,
    y,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    orientedWidth,
    orientedHeight,
  ]);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("rotation", String(rotation));
      body.set("crop", JSON.stringify(crop));
      const result = await api<{ id?: string; assetId?: string }>("/photos", {
        method: "POST",
        body,
      });
      const id = result.assetId || result.id;
      if (!id) throw new Error("Сервер не вернул идентификатор фото.");
      onSaved(id);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Фото для печати" onClose={onClose}>
      <p>
        PNG или JPEG до 5 МБ. Кадр 3 × 4. После загрузки фото доступно только
        внутри вашего центра.
      </p>
      {error && <Notice>{error}</Notice>}
      <label className="upload-zone">
        Выбрать фотографию
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (!next) return;
            if (next.size > LIMITS.photoBytes) {
              setError(
                "Файл больше 5 МБ. Выберите изображение меньшего размера.",
              );
              return;
            }
            if (!["image/png", "image/jpeg"].includes(next.type)) {
              setError("Допускаются только PNG и JPEG.");
              return;
            }
            setError("");
            setZoom(1);
            setX(50);
            setY(50);
            setRotation(0);
            setFile(next);
          }}
        />
      </label>
      {file && (
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
                value={rotation}
                onChange={(event) => setRotation(Number(event.target.value))}
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
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <label>
              По горизонтали
              <input
                type="range"
                min="0"
                max="100"
                value={x}
                onChange={(event) => setX(Number(event.target.value))}
              />
            </label>
            <label>
              По вертикали
              <input
                type="range"
                min="0"
                max="100"
                value={y}
                onChange={(event) => setY(Number(event.target.value))}
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
        <button disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary"
          disabled={!file || !size.width || busy}
          onClick={() => void upload()}
        >
          {busy ? "Загружаем…" : "Сохранить фото"}
        </button>
      </div>
    </Modal>
  );
}

"use client";
import { useState } from "react";
import type { Recipient } from "@/lib/types";
import { supplementPosition } from "@/lib/common-position";

/** One safe group edit; individual positions remain available in the grid. */
export function RecipientCommonFields({
  items,
  selectedIds,
  disabled,
  onApply,
  onEmployer,
}: {
  items: Recipient[];
  selectedIds: string[];
  disabled: boolean;
  onApply: (items: Recipient[]) => void;
  onEmployer: () => void;
}) {
  const [positionRu, setPositionRu] = useState("");
  const [positionKz, setPositionKz] = useState("");
  const [notice, setNotice] = useState("");
  const ids = new Set(
    selectedIds.length ? selectedIds : items.map((item) => item.id),
  );
  const count = items.filter(
    (item) =>
      ids.has(item.id) &&
      supplementPosition(item, positionRu, positionKz) !== item,
  ).length;
  return (
    <section
      className="recipient-common-fields"
      aria-label="Общие данные людей"
    >
      <div className="form-grid">
        <label>
          Общая должность / профессия · RU
          <input
            value={positionRu}
            maxLength={500}
            disabled={disabled}
            onChange={(event) => {
              setPositionRu(event.target.value);
              setNotice("");
            }}
          />
        </label>
        <label>
          Общая должность / профессия · KZ
          <input
            value={positionKz}
            maxLength={500}
            disabled={disabled}
            onChange={(event) => {
              setPositionKz(event.target.value);
              setNotice("");
            }}
          />
        </label>
      </div>
      <div className="toolbar-actions">
        <button
          disabled={disabled || !count}
          onClick={() => {
            onApply(
              items.map((item) =>
                ids.has(item.id)
                  ? supplementPosition(item, positionRu, positionKz)
                  : item,
              ),
            );
            setNotice(
              `Должность заполнена для ${count} человек. Индивидуальные значения сохранены.`,
            );
          }}
        >
          Заполнить пустые должности ({count})
        </button>
        <button disabled={disabled || !ids.size} onClick={onEmployer}>
          Общий работодатель ({ids.size})
        </button>
      </div>
      <small className="fine-print">
        {selectedIds.length
          ? `Для выбранных ${ids.size} человек`
          : `Для всех ${items.length} человек`}
        . Заполненные должности сохраняются; исключения можно изменить в строке.
      </small>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

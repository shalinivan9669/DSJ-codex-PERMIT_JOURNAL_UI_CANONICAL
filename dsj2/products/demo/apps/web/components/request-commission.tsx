"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal, Notice } from "@demo/ui";
import { canManageSystem, isBlankText } from "@demo/contracts";
import { api } from "@/lib/api";
import {
  commissionSettingsHref,
  commissionTarget,
} from "@/lib/request-commission";
import type { AppContext, Draft, Profile } from "@/lib/types";
import {
  useCabinetError,
  useCabinetLanguage,
  useCabinetText,
} from "./cabinet-language";
import "./request-commission.css";

type ProfileVersion = { id: string; version: number; profile: Profile };

export function RequestCommission({
  draft,
  context,
  eventId,
  commissionRequired = true,
  readonly,
  onApply,
  onClose,
}: {
  draft: Draft;
  context: AppContext;
  eventId?: string;
  commissionRequired?: boolean;
  readonly: boolean;
  onApply: (profile: ProfileVersion, eventId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const tr = useCabinetText();
  const [error, setError] = useCabinetError();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [profiles, setProfiles] = useState<ProfileVersion[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const target = commissionTarget(draft, eventId);
  const currentId = target.profileVersionId || context.profileVersionId;
  const managesSystem = canManageSystem(context.user.role);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      api<{ items: ProfileVersion[] }>("/settings/profiles"),
      currentId
        ? api<{ items: ProfileVersion[] }>(
            `/settings/profiles?versionId=${encodeURIComponent(currentId)}`,
          )
        : Promise.resolve({ items: [] }),
    ])
      .then(([recent, current]) => {
        if (!active) return;
        const versions = [
          ...new Map(
            [...recent.items, ...current.items].map((profile) => [
              profile.id,
              profile,
            ]),
          ).values(),
        ].sort((a, b) => b.version - a.version);
        setProfiles(versions);
        // The latest saved settings are offered, never silently assigned.
        setSelectedId(versions[0]?.id || "");
      })
      .catch((caught) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentId, retry]);

  const selected = profiles.find((profile) => profile.id === selectedId);
  const current = profiles.find((profile) => profile.id === currentId);
  const commissionComplete =
    !!selected &&
    selected.profile.commission.length >= 3 &&
    selected.profile.commission.every((person) => !isBlankText(person.name));
  const complete =
    !!selected?.profile.approved && (!commissionRequired || commissionComplete);
  const changed = !!selected && selected.id !== currentId;

  async function apply() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await onApply(selected, target.eventId);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr(
        commissionRequired
          ? "Комиссия для протокола"
          : "Реквизиты для документов",
      )}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="request-commission">
        {target.title && (
          <p>
            <strong>{target.title}</strong>
          </p>
        )}

        {error && (
          <Notice>
            {error}
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => setRetry((value) => value + 1)}
            >
              {tr("Обновить составы")}
            </button>
          </Notice>
        )}
        {loading ? (
          <p role="status">
            {tr(
              commissionRequired
                ? "Загружаем комиссию…"
                : "Загружаем реквизиты…",
            )}
          </p>
        ) : (
          <>
            <section aria-label={tr("Комиссия в заявке")}>
              <h3>
                {tr("Сейчас в заявке")}
                {current ? ` · ${tr("Версия")} ${current.version}` : ""}
              </h3>
              {commissionRequired ? (
                <CommissionPeople profile={current?.profile} />
              ) : (
                <ProfileDetails profile={current?.profile} />
              )}
            </section>
            {profiles.length > 0 && (
              <section aria-label={tr("Сохранённая комиссия центра")}>
                <label>
                  {tr(
                    commissionRequired
                      ? "Сохранённый состав центра"
                      : "Сохранённые реквизиты центра",
                  )}
                  <select
                    value={selectedId}
                    disabled={busy || readonly}
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    {profiles.map((profile, index) => (
                      <option key={profile.id} value={profile.id}>
                        {tr("Версия")} {profile.version}
                        {index === 0 ? ` — ${tr("последняя сохранённая")}` : ""}
                        {profile.profile.commissionTitle
                          ? ` · ${profile.profile.commissionTitle}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {changed &&
                  (commissionRequired ? (
                    <CommissionPeople profile={selected?.profile} />
                  ) : (
                    <ProfileDetails profile={selected?.profile} />
                  ))}
                {commissionRequired && !commissionComplete && (
                  <p className="field-error">
                    {tr(
                      "Укажите ФИО председателя и двух членов комиссии.",
                    )}
                  </p>
                )}
                {!selected?.profile.approved && (
                  <p className="field-error">
                    {tr(
                      "Подтвердите состав в настройках центра.",
                    )}
                  </p>
                )}
                {complete && !changed && (
                  <p role="status">
                    {tr(
                      commissionRequired
                        ? "Этот состав уже применяется в заявке."
                        : "Эти реквизиты уже применяются в заявке.",
                    )}
                  </p>
                )}
              </section>
            )}
            {!readonly && (
              <>
                {!managesSystem && (
                  <p className="muted">
                    {tr(
                      "Попросите директора заполнить комиссию, затем обновите список.",
                    )}
                  </p>
                )}
                {changed && complete && (
                  <p className="fine-print">
                    {tr(
                      "Обновятся также реквизиты центра и общие настройки обучения.",
                    )}
                  </p>
                )}
                <div className="modal-actions">
                  {managesSystem && (
                    <Link
                      className={`button${!complete ? " primary" : ""}`}
                      aria-disabled={busy || undefined}
                      href={commissionSettingsHref(
                        draft.id,
                        eventId,
                        commissionRequired,
                      )}
                      onClick={(event) => {
                        if (busy) event.preventDefault();
                      }}
                    >
                      {tr(
                        !commissionRequired
                          ? "Исправить реквизиты в настройках"
                          : complete
                            ? "Изменить состав в настройках"
                            : "Заполнить комиссию",
                      )}
                    </Link>
                  )}
                  {!managesSystem && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      {tr("Обновить составы")}
                    </button>
                  )}
                  {changed && complete && (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void apply()}
                    >
                      {tr(
                        busy
                          ? "Применяем и проверяем…"
                          : commissionRequired
                            ? "Применить комиссию к заявке"
                            : "Применить реквизиты к заявке",
                      )}
                    </button>
                  )}
                  {!changed && complete && (
                    <button type="button" onClick={onClose}>
                      {tr("Вернуться к заявке")}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function ProfileDetails({ profile }: { profile?: Profile }) {
  const tr = useCabinetText();
  return (
    <dl className="request-commission-people">
      {(
        [
          ["Учебный центр", profile?.nameRu],
          ["Город · RU", profile?.cityRu],
          ["ФИО руководителя учебного центра", profile?.headName],
          ["БИН учебного центра", profile?.bin],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <dt>{tr(label)}</dt>
          <dd>{value || tr("Не указан")}</dd>
        </div>
      ))}
    </dl>
  );
}

function CommissionPeople({ profile }: { profile?: Profile }) {
  const tr = useCabinetText();
  const t = useCabinetLanguage();
  const people = profile?.commission || [];
  const nameRu = profile?.nameRu.trim() || profile?.nameKz.trim() || "";
  const nameKz = profile?.nameKz.trim() || nameRu;
  return (
    <dl className="request-commission-people">
      <div>
        <dt>{tr("Организация комиссии")}</dt>
        <dd>{t(nameRu, nameKz) || tr("Не указан")}</dd>
      </div>
      {Array.from({ length: Math.max(3, people.length) }, (_, index) => (
        <div key={index}>
          <dt>
            {index === 0
              ? tr("Председатель комиссии")
              : `${tr("Член комиссии")} ${index}`}
          </dt>
          <dd>
            {people[index]?.name.trim() || tr("Не указан")}
            {people[index]?.position && <small>{people[index].position}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

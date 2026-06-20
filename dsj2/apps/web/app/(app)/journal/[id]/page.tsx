import Link from "next/link";
import type { BriefingJournalEntry } from "@dsj/types";
import {
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  Table,
  TableWrapper,
  Td,
  Textarea,
  Th,
} from "@dsj/ui";
import { formatDate, formatDateTime } from "@dsj/utils";
import {
  annulBriefingAction,
  prepareBriefingForSigningAction,
  replaceBriefingAction,
  signBriefingAction,
} from "@/actions/briefing";
import { BriefingEmployeeSigningPanel } from "@/components/employee-presence-signing-panel";
import { SigningForm } from "@/components/signing-form";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { apiFetch } from "@/lib/api";
import { requireRoleAccess } from "@/lib/auth";
import {
  briefingJournalKindLabels,
  briefingTypeLabels,
  getBriefingSignerRoleLabel,
} from "@/lib/labels";
import { getSigningConfig } from "@/lib/signing-config";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function companyQuery(organizationId: string | null | undefined) {
  return organizationId ? `?companyId=${organizationId}` : "";
}

function signerState(record: BriefingJournalEntry, role: string) {
  return record.pendingSigners.find((signer) => signer.role === role) ?? null;
}

function signerParticipantCell(
  record: BriefingJournalEntry,
  signer: BriefingJournalEntry["pendingSigners"][number],
  query: string,
) {
  if (signer.role === "BRIEFED_EMPLOYEE") {
    return (
      <div>
        <Link
          href={`/employees/${record.employee.employeeId}${query}`}
          className="font-medium text-slate-900 transition-colors duration-150 hover:text-[var(--surface-strong)]"
        >
          {record.employee.fullName}
        </Link>
        <p className="mt-1 text-xs text-slate-500">
          {record.employee.jobTitle ?? "Должность не указана"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {record.employee.employeeNumber ?? "Без табельного"} /{" "}
          {getBriefingSignerRoleLabel(signer.role)}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="font-medium text-slate-900">{record.instructor.fullName}</p>
      <p className="mt-1 text-xs text-slate-500">
        {record.instructor.role ?? "Инструктор"}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {getBriefingSignerRoleLabel(signer.role)}
      </p>
    </div>
  );
}

function signingProgressLabel(record: BriefingJournalEntry) {
  const instructor = signerState(record, "BRIEFING_INSTRUCTOR");
  const employee = signerState(record, "BRIEFED_EMPLOYEE");
  const instructorSigned = instructor?.status === "SIGNED";
  const employeeSigned = employee?.status === "SIGNED";

  if (instructorSigned && employeeSigned) {
    return "Полностью подписано";
  }

  if (instructorSigned && !employeeSigned) {
    return "Инструктор подписал, ожидает сотрудник";
  }

  if (!instructorSigned && employeeSigned) {
    return "Сотрудник подписал, ожидает инструктор";
  }

    return "Обе подписи ожидают";
}

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

export default async function BriefingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const session = await requireRoleAccess(["COMPANY_ADMIN", "SAFETY_ENGINEER"]);
  const signingConfig = getSigningConfig();
  const { id } = await params;
  const rawSearchParams = await searchParams;
  const errorMessage =
    typeof rawSearchParams.error === "string" ? rawSearchParams.error : null;
  const record = await apiFetch<BriefingJournalEntry>(`briefing-records/${id}`);
  const query = companyQuery(record.organizationId);
  const signingConfigError = signingConfig.isConfigured ? null : signingConfig.configError;
  const instructorNcalayerReady =
    signingConfig.isConfigured && signingConfig.provider === "NCALAYER";
  const employeeSigner = signerState(record, "BRIEFED_EMPLOYEE");
  const canShowEmployeePresencePanel = Boolean(record.signingDigest && employeeSigner);
  const hasActionContent =
    record.allowedActions.canPrepareSign ||
    canShowEmployeePresencePanel ||
    record.allowedActions.canInstructorSign ||
    record.allowedActions.canAnnul ||
    record.allowedActions.canReplace;

  return (
    <div className="space-y-6">
      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <PageHeader>
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-400">
            Каноническая запись инструктажа
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">
            {record.registrationNo ?? `Черновик #${record.id.slice(0, 8)}`}
          </h1>
          <p className="mt-2 text-sm text-slate-500">{record.topic}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/api/briefings/${record.id}/pdf`}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
          >
            Скачать PDF
          </a>
          {record.allowedActions.canEditDraft ? (
            <Link
              href={`/journal/${record.id}/edit${query}`}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
            >
            Редактировать черновик
            </Link>
          ) : null}
          {record.allowedActions.canInstructorSign ? (
            <a
              href="#briefing-actions"
              className="rounded-xl bg-[var(--surface-strong)] px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--surface-strong-hover)]"
            >
              Подписать инструктором
            </a>
          ) : null}
          {record.allowedActions.canDownloadEvidence && record.documentEnvelopeId ? (
            <a
              href={`/api/document-envelopes/${record.documentEnvelopeId}/evidence-package`}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700"
            >
              Пакет доказательств
            </a>
          ) : null}
        </div>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[24px]">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">
              Юридическая запись
            </h2>
            <StatusBadge value={record.status} />
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                Реестр
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {briefingJournalKindLabels[record.journalKind] ?? record.journalKind}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {briefingTypeLabels[record.briefingType] ?? record.briefingType}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Дата: {formatDate(record.briefingDate)}
              </p>
              {record.briefingTime ? (
                <p className="mt-1 text-sm text-slate-500">
                  Время: {formatDateTime(record.briefingTime)}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-slate-500">
                Подразделение: {record.department?.name ?? "не назначено"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Площадка: {record.workSite?.name ?? "не назначена"}
              </p>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                Участники
              </p>
              <Link
                href={`/employees/${record.employee.employeeId}${query}`}
                className="mt-2 inline-flex text-sm font-semibold text-slate-900 transition-colors duration-150 hover:text-[var(--surface-strong)]"
              >
                {record.employee.fullName}
              </Link>
              <p className="mt-1 text-sm text-slate-500">
                {record.employee.employeeNumber ?? "без табельного"}
                {record.employee.jobTitle ? ` / ${record.employee.jobTitle}` : ""}
              </p>
              <p className="mt-2 text-sm text-slate-700">
                Инструктор: {record.instructor.fullName}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {signingProgressLabel(record)}
              </p>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">
                Содержание
              </p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
                {record.program ?? "Программа инструктажа не указана."}
              </p>
              {record.basis ? (
                <p className="mt-3 text-sm text-slate-600">Основание: {record.basis}</p>
              ) : null}
              {record.unscheduledReason ? (
                <p className="mt-1 text-sm text-slate-600">
                  Причина внепланового/целевого: {record.unscheduledReason}
                </p>
              ) : null}
              {record.notes ? (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-600">
                  {record.notes}
                </p>
              ) : null}
              {record.annulReason ? (
                <p className="mt-3 whitespace-pre-line rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  Причина аннулирования: {record.annulReason}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card id="briefing-actions" className="rounded-[24px]">
            <CardHeader>
              <h2 className="text-lg font-semibold text-slate-950">Действия</h2>
            </CardHeader>
            <CardContent className="space-y-3">
              {record.allowedActions.canPrepareSign ? (
                <form action={prepareBriefingForSigningAction}>
                  <input type="hidden" name="briefingId" value={record.id} />
                  <input type="hidden" name="companyId" value={record.organizationId} />
                  <SubmitButton
                    label="Подготовить к подписи"
                    pendingLabel="Подготовка..."
                  />
                </form>
              ) : null}

              {canShowEmployeePresencePanel ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Сотрудник на месте
                  </h3>
                  <BriefingEmployeeSigningPanel
                    documentId={record.id}
                    employeeName={record.employee.fullName}
                    employeeNumber={record.employee.employeeNumber}
                    employeeJobTitle={record.employee.jobTitle}
                    isSigned={employeeSigner?.status === "SIGNED"}
                  />
                </section>
              ) : null}

              {record.allowedActions.canInstructorSign ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Подпись инструктора
                  </h3>
                  {instructorNcalayerReady ? (
                    <SigningForm
                      mode="NCALAYER"
                      action={signBriefingAction}
                      hiddenFields={[
                        { name: "briefingId", value: record.id },
                        { name: "companyId", value: record.organizationId },
                      ]}
                      digest={record.signingDigest ?? null}
                      bridgeUrl={signingConfig.bridgeUrl ?? ""}
                      bridgeTimeoutMs={signingConfig.bridgeTimeoutMs}
                      bridgeContext={{
                        briefingJournalEntryId: record.id,
                        registrationNo: record.registrationNo ?? null,
                      }}
                      title="Подпись инструктора через NCALayer"
                      description={`Инструктор ${session.user.fullName} подпишет зафиксированную версию своей ЭЦП на этом компьютере.`}
                      submitLabel="Подписать через NCALayer"
                      pendingLabel="Подписание..."
                      bridgeHint="NCALayer запросит сертификат инструктора и сформирует CMS/PKCS#7 для текущего дайджеста."
                      testMode={signingConfig.testMode}
                    />
                  ) : (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      {signingConfig.isConfigured
                        ? "Инструктор может подписать только через NCALayer. Установите SIGNING_PROVIDER=NCALAYER."
                        : signingConfigError}
                    </div>
                  )}
                </section>
              ) : null}

              {record.allowedActions.canAnnul ? (
                <form action={annulBriefingAction} className="space-y-2">
                  <input type="hidden" name="briefingId" value={record.id} />
                  <input type="hidden" name="companyId" value={record.organizationId} />
                  <Textarea
                    name="reason"
                    placeholder="Причина аннулирования"
                    className="min-h-20"
                  />
                  <SubmitButton
                    label="Аннулировать"
                    pendingLabel="Аннулирование..."
                    variant="danger"
                  />
                </form>
              ) : null}

              {record.allowedActions.canReplace ? (
                <form action={replaceBriefingAction} className="space-y-2">
                  <input type="hidden" name="briefingId" value={record.id} />
                  <input type="hidden" name="companyId" value={record.organizationId} />
                  <input type="hidden" name="employeeIds" value={record.employeeId} />
                  <input type="hidden" name="employeeId" value={record.employeeId} />
                  <input type="hidden" name="journalKind" value={record.journalKind} />
                  <input type="hidden" name="departmentId" value={record.departmentId ?? ""} />
                  <input type="hidden" name="workSiteId" value={record.workSiteId ?? ""} />
                  <input type="hidden" name="instructorUserId" value={record.instructorUserId} />
                  <input type="hidden" name="briefingType" value={record.briefingType} />
                  <input type="hidden" name="briefingDate" value={dateInputValue(record.briefingDate)} />
                  <input type="hidden" name="briefingTime" value={record.briefingTime ?? ""} />
                  <input type="hidden" name="topic" value={record.topic} />
                  <input type="hidden" name="program" value={record.program ?? ""} />
                  <input type="hidden" name="basis" value={record.basis ?? ""} />
                  <input type="hidden" name="unscheduledReason" value={record.unscheduledReason ?? ""} />
                  <input type="hidden" name="notes" value={record.notes ?? ""} />
                  <input type="hidden" name="status" value="DRAFT" />
                  <Textarea
                    name="reason"
                    defaultValue="Заменено новым черновиком записи инструктажа."
                    className="min-h-20"
                  />
                  <SubmitButton
                    label="Создать заменяющий черновик"
                    pendingLabel="Создание..."
                    variant="secondary"
                  />
                </form>
              ) : null}

              {!hasActionContent ? (
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  Нет доступных действий для текущего статуса и демо-персоны.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[24px]">
            <CardHeader>
              <h2 className="text-lg font-semibold text-slate-950">
                Доказательства / архив
              </h2>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p>Конверт: {record.documentEnvelopeId ?? "не создан"}</p>
                <p>Версия: {record.currentVersionNo ? `v${record.currentVersionNo}` : "н/д"}</p>
                <p>Дайджест: {record.signingDigest ?? "ожидает"}</p>
                <p>Доказательства: {record.evidenceAvailable ? "доступны" : "ожидают"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                {record.archiveRecordSummary ? (
                  <>
                    <p>Статус архива: {record.archiveRecordSummary.status}</p>
                    <p>Срок хранения: {record.archiveRecordSummary.retentionCode}</p>
                    <p>
                      Дата возможной утилизации:{" "}
                      {record.archiveRecordSummary.disposalEligibleAt
                        ? formatDate(record.archiveRecordSummary.disposalEligibleAt)
                        : "не рассчитано"}
                    </p>
                  </>
                ) : (
                  <p>Архивная запись будет сформирована после второй обязательной подписи.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="rounded-[24px]">
        <CardHeader>
          <h2 className="text-lg font-semibold text-slate-950">
            Ход подписания
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrapper className="border-0">
            <Table>
              <thead>
                <tr>
                  <Th>Участник</Th>
                  <Th>Статус</Th>
                  <Th>Подписант</Th>
                  <Th>Подписано в</Th>
                </tr>
              </thead>
              <tbody>
                {record.pendingSigners.map((signer) => (
                  <tr key={signer.role} className="border-t border-slate-100">
                    <Td>{signerParticipantCell(record, signer, query)}</Td>
                    <Td>
                      <StatusBadge value={signer.status} />
                    </Td>
                    <Td>{signer.signerName ?? "ожидает"}</Td>
                    <Td>
                      {signer.signedAt ? formatDateTime(signer.signedAt) : "ожидает"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrapper>
        </CardContent>
      </Card>

      <Card className="rounded-[24px]">
        <CardHeader>
          <h2 className="text-lg font-semibold text-slate-950">
            Подписи и сводка аудита
          </h2>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_0.35fr]">
          <div className="space-y-3">
            {record.signatures.length ? (
              record.signatures.map((signature) => (
                <div
                  key={signature.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {signature.signerRole
                          ? getBriefingSignerRoleLabel(signature.signerRole)
                          : "Устаревший подписант"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {signature.signerName}
                      </p>
                    </div>
                    <StatusBadge value={signature.status} />
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {signature.provider} / {signature.certificateSerial}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {signature.signerIinMasked}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {signature.signedAt
                      ? formatDateTime(signature.signedAt)
                      : "ожидает"}
                  </p>
                  {signature.verificationResult ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Проверка: {signature.verificationResult}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                Подписи появятся после подписания инструктором и сотрудником.
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <p>События: {record.historySummary.totalEvents}</p>
            <p>Последнее действие: {record.historySummary.lastAction ?? "нет"}</p>
            <p>
              Последний раз:{" "}
              {record.historySummary.lastAt
                ? formatDateTime(record.historySummary.lastAt)
                : "нет"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import type { BriefingJournalEntry } from "@dsj/types";
import { Card, CardContent, CardHeader, PageHeader } from "@dsj/ui";
import { formatDate } from "@dsj/utils";
import { signBriefingAction } from "@/actions/briefing";
import { SigningForm } from "@/components/signing-form";
import { StatusBadge } from "@/components/status-badge";
import { apiFetch } from "@/lib/api";
import { requireRoleAccess } from "@/lib/auth";
import { getSigningConfig } from "@/lib/signing-config";
import {
  briefingJournalKindLabels,
  briefingTypeLabels,
} from "@/lib/labels";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignBriefingPage({
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
  const errorMessage = typeof rawSearchParams.error === "string" ? rawSearchParams.error : null;
  const record = await apiFetch<BriefingJournalEntry>(`briefing-records/${id}`);
  const signingConfigError = signingConfig.isConfigured ? null : signingConfig.configError;
  const instructorNcalayerReady =
    signingConfig.isConfigured && signingConfig.provider === "NCALAYER";
  const detailHref = record.organizationId
    ? `/journal/${record.id}?companyId=${record.organizationId}`
    : `/journal/${record.id}`;

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
            Подпись инструктора
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">
            {record.registrationNo ?? `Черновик #${record.id.slice(0, 8)}`}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Подпись инструктора переводит запись в PARTIALLY_SIGNED и открывает
            самостоятельную подпись сотрудника.
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-400">
            Режим подписи: {signingConfig.provider}
          </p>
        </div>
        <StatusBadge value={record.status} />
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Card className="rounded-[24px]">
          <CardHeader>
            <h2 className="text-lg font-semibold text-slate-950">
              Пакет подписи
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">
                {record.employee.fullName}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {record.employee.employeeNumber ?? "без табельного"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Инструктор: {record.instructor.fullName}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm text-slate-700">{record.topic}</p>
              <p className="mt-2 text-sm text-slate-500">
                {briefingJournalKindLabels[record.journalKind] ?? record.journalKind} /{" "}
                {briefingTypeLabels[record.briefingType] ?? record.briefingType}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {formatDate(record.briefingDate)}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Дайджест: {record.signingDigest ?? "требуется подготовка к подписи"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader>
            <h2 className="text-lg font-semibold text-slate-950">Подпись</h2>
          </CardHeader>
          <CardContent>
            {!record.allowedActions.canInstructorSign ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Для этой записи сейчас недоступна подпись инструктора. Проверьте
                  статус, подготовку к подписи и существующие подписи.
                </div>
                <Link
                  href={detailHref}
                  className="inline-flex rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Вернуться к записи
                </Link>
              </div>
            ) : instructorNcalayerReady ? (
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

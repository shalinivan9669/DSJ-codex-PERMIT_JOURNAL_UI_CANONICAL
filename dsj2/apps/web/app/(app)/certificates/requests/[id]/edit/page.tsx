import Link from "next/link";
import type {
  BiotCardDefaults,
  CardGenerationRequestDetail,
  UserRole,
} from "@dsj/types";
import { PageHeader } from "@dsj/ui";
import { BiotCardGenerator } from "@/components/biot-card-generator";
import { CompanySwitcher } from "@/components/company-switcher";
import { apiFetch } from "@/lib/api";
import { requireRoleAccess } from "@/lib/auth";
import { resolveCompanyContext } from "@/lib/company-context";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EditCardRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const session = await requireRoleAccess(["COMPANY_ADMIN"]);
  const resolvedParams = await params;
  const queryParams = await searchParams;
  const pathname = `/certificates/requests/${resolvedParams.id}/edit`;
  const { companies, activeCompanyId } = await resolveCompanyContext({
    session,
    pathname,
    searchParams: queryParams,
  });
  const scopedQuery = activeCompanyId ? `?companyId=${activeCompanyId}` : "";

  const request = await apiFetch<CardGenerationRequestDetail>(`biot-cards/requests/${resolvedParams.id}${scopedQuery}`);

  const defaultsQuery = new URLSearchParams({
    issueDate: request.issueDate.slice(0, 10),
    certificateType: request.certificateType,
    biotDocumentKind: request.biotDocumentKind,
  });

  if (activeCompanyId) {
    defaultsQuery.set("companyId", activeCompanyId);
  }

  const initialDefaults = await apiFetch<BiotCardDefaults>(
    `biot-cards/defaults?${defaultsQuery.toString()}`,
  );

  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ?? null;
  const returnHref = activeCompanyId
    ? `/certificates/biot-experimental?companyId=${activeCompanyId}`
    : "/certificates/biot-experimental";

  return (
    <div className="space-y-6">
      <PageHeader>
        <div>
          <h1>{request.title}</h1>
          <p>
            Исправь ФИО, должности, номера, фото и данные компании в
            существующей заявке. После сохранения новые скачивания DOCX будут
            использовать обновлённые данные без создания новой заявки.
          </p>
        </div>
        {companies.length > 1 && activeCompanyId ? (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
            <CompanySwitcher
              pathname={pathname}
              companies={companies}
              activeCompanyId={activeCompanyId}
              searchParams={queryParams}
            />
          </div>
        ) : null}
      </PageHeader>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)]">
        <div className="grid gap-4 border-b border-[var(--line)] px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-[var(--ink)]">
              Работаешь с уже сохранённой заявкой
            </h2>
            <p className="text-sm leading-6 text-[var(--muted)]">
              Тип документа и режим заявки зафиксированы, чтобы корректировка
              не ломала нумерацию и повторные выгрузки.
            </p>
          </div>
          <Link
            href={returnHref}
            className="inline-flex h-10 items-center rounded-md border border-[var(--line)] px-4 text-sm font-medium text-[var(--ink)] transition-colors duration-150 hover:bg-[var(--surface-muted)]"
          >
            Вернуться к удостоверениям
          </Link>
        </div>

        <div className="grid gap-4 px-5 py-4 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--ink)]">
              ФИО, должности и фото
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Можно исправить данные по любой строке и сразу использовать их в
              повторной выгрузке документа.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--ink)]">
              Номера удостоверений и протоколов
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Если в заявке была ошибка в нумерации, поправь её здесь. Система
              сохранит обновлённые значения для повторных скачиваний.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--ink)]">
              Название компании и дата выдачи
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Эти поля обновят шаблон и все следующие DOCX-выгрузки по этой же
              заявке.
            </p>
          </div>
        </div>
      </section>

      <BiotCardGenerator
        companyId={activeCompanyId}
        companyName={activeCompany?.name ?? session.user.company?.name ?? null}
        employees={[]}
        trainingAssignments={[]}
        initialDefaults={initialDefaults}
        initialRequests={[]}
        editorMode="edit"
        initialRequest={request}
        returnHref={returnHref}
        canManageSavedRequests={
          (session.user.role as UserRole) === "COMPANY_ADMIN" ||
          (session.user.role as UserRole) === "SUPER_ADMIN"
        }
      />
    </div>
  );
}

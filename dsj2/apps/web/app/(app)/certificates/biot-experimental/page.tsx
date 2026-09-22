import type {
  BiotCardDefaults,
  CardGenerationRequestSummary,
  UserRole,
} from "@dsj/types";
import { EmptyState, PageHeader } from "@dsj/ui";
import { CompanySwitcher } from "@/components/company-switcher";
import { BiotCardGenerator } from "@/components/biot-card-generator";
import { apiFetch } from "@/lib/api";
import { requireRoleAccess } from "@/lib/auth";
import { resolveCompanyContext } from "@/lib/company-context";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BiotExperimentalPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireRoleAccess(["COMPANY_ADMIN", "SAFETY_ENGINEER"]);
  const params = await searchParams;
  const { companies, activeCompanyId } = await resolveCompanyContext({
    session,
    pathname: "/certificates/biot-experimental",
    searchParams: params,
  });
  const scopedQuery = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
  const today = new Date().toISOString().slice(0, 10);
  const defaultsQuery = new URLSearchParams({ issueDate: today });

  if (activeCompanyId) {
    defaultsQuery.set("companyId", activeCompanyId);
  }

  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ?? null;

  const header = (
    <PageHeader>
      <div>
        <h1>Редактор шаблонов удостоверений</h1>
        <p>
          Рабочий экран для подготовки удостоверений и связанных документов по
          шаблонам компании.
        </p>
      </div>
      {companies.length > 1 && activeCompanyId ? (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <CompanySwitcher
            pathname="/certificates/biot-experimental"
            companies={companies}
            activeCompanyId={activeCompanyId}
            searchParams={params}
          />
        </div>
      ) : null}
    </PageHeader>
  );

  if (!activeCompanyId) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState className="items-start text-left">
          Для работы с удостоверениями нужно выбрать компанию.
        </EmptyState>
      </div>
    );
  }



  let initialDefaults: BiotCardDefaults | null = null;
  let initialRequests: CardGenerationRequestSummary[] = [];
  let loadError: string | null = null;

  try {
    [initialDefaults, initialRequests] =
      await Promise.all([
apiFetch<BiotCardDefaults>(
          `biot-cards/defaults?${defaultsQuery.toString()}`,
        ),
        apiFetch<CardGenerationRequestSummary[]>(
          `biot-cards/requests${scopedQuery}`,
        ),
      ]);
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Не удалось загрузить данные удостоверений.";
  }

  if (!initialDefaults) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState className="items-start text-left">
          {loadError ?? "Не удалось загрузить данные удостоверений."}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <BiotCardGenerator
        companyId={activeCompanyId}
        companyName={activeCompany?.name ?? session.user.company?.name ?? null}
        employees={[]}
        trainingAssignments={[]}
        initialDefaults={initialDefaults}
        initialRequests={initialRequests}
        canManageSavedRequests={
          (session.user.role as UserRole) === "COMPANY_ADMIN" ||
          (session.user.role as UserRole) === "SUPER_ADMIN"
        }
      />
    </div>
  );
}

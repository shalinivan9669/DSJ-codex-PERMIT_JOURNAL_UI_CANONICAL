import "server-only";

import { redirect } from "next/navigation";
import { apiFetch } from "./api";

type OrganizationOption = {
  id: string;
  name: string;
};

type SessionLike = {
  user: {
    role: string;
    companyId: string | null;
    company?: {
      name: string;
    } | null;
  };
};

type SearchParamRecord = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" && value.length > 0 ? value : null;
}

function buildRedirectPath(
  pathname: string,
  searchParams: SearchParamRecord,
  activeKey: "companyId" | "organizationId",
  activeId: string,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === activeKey) {
      continue;
    }

    const selected = firstString(value);
    if (selected) {
      params.set(key, selected);
    }
  }

  params.set(activeKey, activeId);
  return `${pathname}?${params.toString()}`;
}

export async function resolveOrganizationContext({
  session,
  pathname,
  searchParams = {},
}: {
  session: SessionLike;
  pathname: string;
  searchParams?: SearchParamRecord;
}) {
  if (session.user.role !== "SUPER_ADMIN") {
    const activeOrganizationId = session.user.companyId;

    return {
      isSuperAdmin: false,
      organizations: activeOrganizationId
        ? [{ id: activeOrganizationId, name: session.user.company?.name ?? "Текущая организация" }]
        : [],
      activeOrganizationId,
    };
  }

  const organizations = await apiFetch<OrganizationOption[]>("core-platform/organizations");

  if (!organizations.length) {
    return {
      isSuperAdmin: true,
      organizations,
      activeOrganizationId: null,
    };
  }

  const requestedOrganizationId = firstString(searchParams.organizationId);

  if (requestedOrganizationId && organizations.some((organization) => organization.id === requestedOrganizationId)) {
    return {
      isSuperAdmin: true,
      organizations,
      activeOrganizationId: requestedOrganizationId,
    };
  }

  redirect(buildRedirectPath(pathname, searchParams, "organizationId", organizations[0].id));
}

export async function resolveCompanyContext({
  session,
  pathname,
  searchParams = {},
}: {
  session: SessionLike;
  pathname: string;
  searchParams?: SearchParamRecord;
}) {
  if (session.user.role !== "SUPER_ADMIN") {
    return {
      isSuperAdmin: false,
      companies: session.user.companyId
        ? [{ id: session.user.companyId, name: session.user.company?.name ?? "Текущая компания" }]
        : [],
      activeCompanyId: session.user.companyId,
    };
  }

  const { companies } = await apiFetch<{ companies: OrganizationOption[] }>("printing/context");

  if (!companies.length) {
    return {
      isSuperAdmin: true,
      companies,
      activeCompanyId: null,
    };
  }

  const requestedCompanyId = firstString(searchParams.companyId);

  if (requestedCompanyId && companies.some((company) => company.id === requestedCompanyId)) {
    return {
      isSuperAdmin: true,
      companies,
      activeCompanyId: requestedCompanyId,
    };
  }

  redirect(buildRedirectPath(pathname, searchParams, "companyId", companies[0].id));
}

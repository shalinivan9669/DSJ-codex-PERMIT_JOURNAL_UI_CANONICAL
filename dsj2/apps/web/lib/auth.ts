import "server-only";

import type { SessionUser, UserRole } from "@dsj/types";
import { cache } from "react";
import { redirect } from "next/navigation";
import { ApiHttpError, apiFetch, getSessionToken } from "./api";

type AuthSessionUser = SessionUser & {
  company?: { name: string } | null;
  department?: { name: string } | null;
};

function getAccessDeniedPath(reason?: string) {
  return reason ? `/access-denied?reason=${encodeURIComponent(reason)}` : "/access-denied";
}

export const getCurrentSession = cache(async () => {
  const token = await getSessionToken();

  if (!token) {
    return null;
  }

  try {
    const user = await apiFetch<AuthSessionUser>("auth/me");

    return {
      token,
      user,
    };
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) return null;
    throw error;
  }
});

export async function requireSession() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export function getDefaultAuthenticatedPath(
  user: Pick<SessionUser, "role" | "hasLinkedEmployeeRecord">,
) {
  if (user.role === "EMPLOYEE_SIGNER") {
    if (!user.hasLinkedEmployeeRecord) {
      return getAccessDeniedPath("employee-link");
    }

    return getAccessDeniedPath();
  }

  return "/certificates";
}

export async function requireRoleAccess(allowedRoles: UserRole[]) {
  const session = await requireSession();

  if (session.user.role === "SUPER_ADMIN") {
    return session;
  }

  if (!allowedRoles.includes(session.user.role as UserRole)) {
    redirect(getAccessDeniedPath());
  }

  if (
    session.user.role === "EMPLOYEE_SIGNER" &&
    allowedRoles.includes("EMPLOYEE_SIGNER") &&
    !session.user.hasLinkedEmployeeRecord
  ) {
    redirect(getAccessDeniedPath("employee-link"));
  }

  return session;
}

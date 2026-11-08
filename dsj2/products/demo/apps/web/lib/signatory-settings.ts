import { isDirectorRole } from "@demo/contracts";

export type SignatoryRole = "DIRECTOR" | "CHAIR" | "MEMBER" | "TEACHER";
export type Signatory = {
  id: string;
  userId: string;
  displayName: string;
  role: SignatoryRole;
  iin: string;
  bin?: string | null;
  active: boolean;
};
export type SignatoryUser = {
  id: string;
  displayName: string;
  role: string;
  active?: boolean;
  disabled?: boolean;
};

export function signatoryRole(value?: string | null): SignatoryRole {
  return value === "CHAIR" || value === "MEMBER" || value === "TEACHER"
    ? value
    : "DIRECTOR";
}

export function eligibleSignatory(user: SignatoryUser, role: SignatoryRole) {
  return (
    user.active !== false &&
    !user.disabled &&
    ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR", "EXPERT"].includes(
      user.role,
    ) &&
    (role !== "TEACHER" ||
      isDirectorRole(user.role) ||
      user.role === "OPERATOR") &&
    (role !== "DIRECTOR" || isDirectorRole(user.role))
  );
}

export function signatoryReturnPath(value?: string | null): string | undefined {
  return value && /^\/requests\/[a-zA-Z0-9_-]+(?:#signing)?$/.test(value)
    ? value
    : undefined;
}

/** Granting replaces the account's role; a revocation changes only its exact target. */
export function mergeSavedSignatory(
  items: Signatory[],
  saved: Signatory,
): Signatory[] {
  return [
    saved,
    ...items
      .filter((entry) => entry.id !== saved.id)
      .map((entry) =>
        saved.active &&
        entry.userId === saved.userId &&
        entry.role === saved.role &&
        entry.active
          ? { ...entry, active: false }
          : entry,
      ),
  ];
}

export function matchingSignatory(
  items: Signatory[],
  value: Pick<Signatory, "userId" | "role" | "displayName" | "iin" | "bin">,
) {
  return items.find(
    (entry) =>
      entry.active &&
      entry.userId === value.userId &&
      entry.role === value.role &&
      entry.displayName === value.displayName.trim() &&
      entry.iin === value.iin &&
      (entry.bin || "") === (value.bin || ""),
  );
}

export function signatoryRevocationPayload(binding: Signatory) {
  if (!binding.active) return undefined;
  return {
    bindingId: binding.id,
    userId: binding.userId,
    displayName: binding.displayName,
    role: binding.role,
    iin: binding.iin,
    ...(binding.bin ? { bin: binding.bin } : {}),
    active: false,
  };
}

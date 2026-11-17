type EmployerGroup = {
  kind: "COMPANY" | "PERSON";
  customerId?: string | null;
  items: readonly { employerId?: string | null }[];
};

/** A named employer in one row never establishes ownership of the other rows. */
export function soleGroupEmployer({ kind, customerId, items }: EmployerGroup) {
  if (kind !== "COMPANY") return undefined;
  const first = items[0]?.employerId || customerId || undefined;
  return first && items.every((row) => (row.employerId || customerId) === first)
    ? first
    : undefined;
}

type ProfileOwner = {
  customerId?: string | null;
  profile?: { customerId?: string | null };
  data?: { customerId?: string | null };
};

export function profileOwner(row: ProfileOwner) {
  return row.customerId || row.profile?.customerId || row.data?.customerId;
}

export function uniqueCustomerProfile<T extends ProfileOwner>(
  profiles: readonly T[],
  customerId: string,
) {
  if (!customerId) return undefined;
  const matches = profiles.filter(
    (p) => profileOwner(p) === customerId && (p.profile || p.data),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

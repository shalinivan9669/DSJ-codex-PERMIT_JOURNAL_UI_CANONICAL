export type SigningPerson = {
  kind: string;
  displayName: string;
  bindingId?: string | null;
  bindingState?: "ACTIVE" | "MISSING" | "REVOKED";
  canSign: boolean;
  signed: boolean;
};

export function signingRole(kind: string): string {
  return (
    {
      DIRECTOR: "Директор",
      CHAIR: "Председатель комиссии",
      MEMBER: "Член комиссии",
      TEACHER: "Преподаватель",
    }[kind] || "Подписант"
  );
}

/** Keep separate capacities, even when the same person occupies two slots. */
export function paperSignerDefaults(signers: SigningPerson[]): string[] {
  return ["DIRECTOR", "CHAIR", "TEACHER"].map((kind) => {
    const name =
      signers.find((person) => person.kind === kind)?.displayName.trim() || "";
    return [signingRole(kind), "Руководитель учебного центра"].includes(name)
      ? ""
      : name;
  });
}

/** Manual paper attestation records these three capacities in this exact order. */
export function attestedSignerName(
  kind: string,
  names?: string[],
): string | undefined {
  if (names?.length !== 3) return undefined;
  return names[["DIRECTOR", "CHAIR", "TEACHER"].indexOf(kind)];
}

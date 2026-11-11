import type { SigningPerson } from "./signing-flow";

/** Include all of the account's assigned capacities; never another person's slot. */
export function ownPendingSigningDocuments<
  T extends {
    artifactId: string | null;
    complete: boolean;
    paperSignature?: unknown;
    requiredSigners: SigningPerson[];
  },
>(documents: readonly T[]): T[] {
  return documents.filter(
    (document) =>
      !!document.artifactId &&
      !document.complete &&
      !document.paperSignature &&
      document.requiredSigners.some(
        (signer) =>
          signer.canSign &&
          !signer.signed &&
          !!signer.bindingId &&
          (!signer.bindingState || signer.bindingState === "ACTIVE"),
      ),
  );
}

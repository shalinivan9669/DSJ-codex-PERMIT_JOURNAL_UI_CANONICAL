# Legal Signing Roadmap

This document captures the current signing state and the target architecture for legally significant signing, eGov Mobile QR, NCALayer, and mock signing.

## Current State

Implemented today:

- Generic `SigningSession`, `ProviderCallbackEvent`, and `SignatureEvidence` persistence and API.
- Provider registry with mock, NCALayer, and an isolated eGov Mobile QR adapter seam.
- Briefing employee signing sessions with `signerEmployeeId` and no required `User` account.
- Development/test-only eGov QR transport and callback simulation behind
  `EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION=true`.
- In-person employee signing on a tablet as a separate non-EDS method. The raw
  handwritten drawing is discarded after hashing; the audit trail keeps the hash,
  document revision, employee, initiator, timestamp, and device request context.
- Encrypted raw callback storage, replay protection, polling, expiry, and canonical
  `BRIEFED_EMPLOYEE` signature creation for briefing journal entries.
- NCALayer bridge flow through `apps/ncalayer-bridge`.
- Mock signing for local and controlled fallback paths.
- Domain-specific signing for briefing records, public briefing invites, protocols, responsibility orders, employee documents, and prototype work permit paths.
- Digest/hash checks and CMS certificate metadata parsing through `@dsj/utils` and provider-specific services.
- Existing persisted signature and evidence primitives: `Signature`, `CertificateMetadata`, `SignatureVerification`, `AuditLog`, `DocumentEnvelope`, `DocumentVersion`, `ArchiveRecord`, and `ExportSnapshot`.
- Evidence package export under `/v1/core-platform/document-envelopes/:envelopeId/evidence-package`, proxied by the web app.

Not implemented yet:

- Production Smart Bridge transport and production callback verification for
  `NITEC-S-5096` / `EGOVMOBILE_QR_SIGN_SERVICE`.
- Signing-specific worker queues for session expiry, provider polling, callback reconciliation, and verification retry.
- External provider-neutral evidence object storage; callback payloads currently use the
  encrypted signing evidence contour in the database.
- Production-wide startup/request guard that rejects mock signing when a legal provider is required.

## Current API Surfaces

The Nest API uses the `/v1` global prefix.

Existing signing routes include:

- `/v1/signatures/briefing-records/:briefingRecordId`
- `/v1/signatures/briefing-records/:briefingRecordId/sign`
- `/v1/signatures/briefing-records/:briefingRecordId/mock-sign`
- `/v1/signatures/briefing-records/:briefingRecordId/employee-sign`
- `/v1/signatures/public/briefing-invites/:inviteToken`
- `/v1/signatures/public/briefing-invites/:inviteToken/sign`
- `/v1/signatures/public/briefing-invites/:inviteToken/mock-sign`
- `/v1/protocols/:id/prepare-sign`
- `/v1/protocols/:id/sign`
- `/v1/responsibility-orders/:id/prepare-sign`
- `/v1/responsibility-orders/:id/sign`
- `/v1/employee-documents/:id/prepare-sign`
- `/v1/employee-documents/:id/sign`
- `/v1/core-platform/signatures`
- `/v1/core-platform/signatures/verification`
- `/v1/core-platform/document-envelopes/:envelopeId/evidence-package`

The generic signing API is available alongside these routes. Existing routes remain as
compatibility facades until each document flow is migrated and verified.

The generic session routes below are now active. Briefing employee QR signing is the
first employee-without-account flow migrated to them.

## Target Backend Architecture

Add one `SigningModule` in `apps/api/src/signing`.

Core responsibilities:

- Create, read, cancel, expire, and reconcile signing sessions.
- Resolve a document target and immutable document hash before provider calls.
- Validate signer eligibility using authenticated server-side tenant/company scope.
- Route provider-specific behavior through a stable provider interface.
- Persist signature evidence, verification results, and audit events.
- Attach completed signatures to existing document envelope/version relationships where possible.

Provider interface shape:

```ts
interface SigningProvider {
  createSigningSession(input: CreateSigningSessionInput): Promise<CreateSigningSessionResult>;
  getSigningSessionStatus(input: ProviderSessionRef): Promise<ProviderSessionStatus>;
  cancelSigningSession(input: ProviderSessionRef): Promise<ProviderCancelResult>;
  handleProviderCallback(input: ProviderCallbackInput): Promise<ProviderCallbackResult>;
  verifySignature(input: VerifySignatureInput): Promise<VerifySignatureResult>;
}
```

Provider constants should preserve the existing enum values during migration:

- Existing: `MOCK_NCALAYER`, `NCALAYER`
- Target aliases/new values: `MOCK_PROVIDER`, `NCALAYER_PROVIDER`,
  `EGOV_MOBILE_QR_PROVIDER`, `TABLET_SIGNATURE_PROVIDER`
- Reserved future values: `SMART_BRIDGE_PROVIDER`, `DIGITAL_ID_PROVIDER`

Do not wire eGov directly into protocol, order, briefing, or employee-document services. The provider seam should be generic first.

## Target API Contracts

Canonical backend routes:

- `POST /v1/signing/sessions`
- `GET /v1/signing/sessions/:id`
- `POST /v1/signing/sessions/:id/cancel`
- `POST /v1/signing/sessions/:id/ncalayer/submit`
- `POST /v1/signing/providers/egov-mobile-qr/callback`
- `GET /v1/documents/:type/:id/signatures`
- `GET /v1/documents/:type/:id/signing-state`

`POST /v1/signing/sessions` accepts:

```json
{
  "documentType": "PROTOCOL",
  "documentId": "document-id",
  "provider": "EGOV_MOBILE_QR_PROVIDER",
  "signerUserId": "optional-user-id"
}
```

Response:

```json
{
  "id": "session-id",
  "provider": "EGOV_MOBILE_QR_PROVIDER",
  "status": "WAITING_FOR_USER",
  "documentHash": "sha256",
  "expiresAt": "2026-05-23T12:00:00.000Z",
  "qrUrl": "optional-public-qr-url",
  "deeplink": "optional-deeplink",
  "pollAfterMs": 2000,
  "correlationId": "correlation-id"
}
```

Errors should use:

```json
{
  "code": "SIGNING_PROVIDER_DISABLED",
  "message": "Signing provider is disabled.",
  "correlationId": "correlation-id",
  "details": {}
}
```

`details` must be redacted. Do not expose raw IIN, provider secrets, biometric data, raw CMS payloads, or full provider responses in browser-facing responses.

## Target Database Shape

Add models around the current signature/archive stack rather than replacing it:

- `SigningSession`
- `SigningProviderConfig`
- `SignatureEvidence`
- `ProviderCallbackEvent`
- optional dedicated `SigningAuditLog`, or a strict typed wrapper over `AuditLog`
- optional `SignedDocumentSnapshot` only if `DocumentVersion` and `ExportSnapshot` cannot represent the signed payload lifecycle

Extend existing semantics where practical:

- `Signature` remains the canonical document signature table.
- `SignatureVerification` should support pass, fail, pending, and indeterminate semantics when the implementation phase requires it.
- `DocumentEnvelope` and `DocumentVersion` remain the canonical document relationships.

Suggested session statuses:

- `CREATED`
- `QR_GENERATED`
- `WAITING_FOR_USER`
- `CALLBACK_RECEIVED`
- `SIGNATURE_RECEIVED`
- `VERIFYING`
- `COMPLETED`
- `EXPIRED`
- `FAILED`
- `CANCELLED`

Indexes to plan:

- `SigningSession(organizationId, documentType, documentId)`
- `SigningSession(provider, providerSessionId)`
- `SigningSession(status, expiresAt)`
- `SignatureEvidence(signingSessionId)`
- `ProviderCallbackEvent(provider, providerSessionId, createdAt)`
- unique idempotency key per organization/document/signer/provider where applicable

Raw CMS and provider payloads should be stored in configured evidence storage or redacted JSON fields. Business-layer evidence is append-only; corrections should use superseding records, not mutation.

## Target Worker Architecture

Keep the existing `apps/worker` process and add signing queues:

- `dsj-signing-expiration`
- `dsj-signing-provider-poll`
- `dsj-signing-callback-reconcile`
- `dsj-signature-verification`

Planned jobs:

- `expireSigningSession(sessionId)`
- `pollProviderSession(sessionId)`
- `reconcileProviderCallback(callbackEventId)`
- `verifyAndPersistSignature(sessionId)`
- `cleanupStaleQrPayloads()`

Jobs must use stable job ids, attempts, exponential backoff, bounded failed-job retention, and explicit terminal session states. Existing `dsj-compliance` and `dsj-notifications` behavior should remain unchanged.

## Target Frontend Architecture

Reuse existing document pages instead of creating a separate signing product.

Planned components/hooks:

- `SigningMethodSelector`
- `SigningQrModal`
- `useSigningSessionPolling`
- `SigningStateBadge`
- `SignerList`
- `SignatureHistoryPanel`
- `EvidenceDownloadPanel`
- `SigningFailureDetails`

UI states:

- ready
- provider selection
- QR waiting
- NCALayer waiting
- verifying
- success
- partially signed
- expired
- failed
- cancelled

Server components should load document and signing state. Client components may create sessions and poll through same-origin proxy routes only when needed. Provider secrets and raw evidence must never be exposed through `NEXT_PUBLIC_*` variables or browser payloads.

## Environment Plan

Existing variables:

- `SIGNING_PROVIDER`
- `SIGNING_TEST_MODE`
- `ALLOW_PUBLIC_INVITE_MOCK_SIGNING`
- `NCALAYER_BRIDGE_URL`
- `NCALAYER_BRIDGE_TIMEOUT_MS`

Target variables:

- `SIGNING_PROVIDER_DEFAULT`
- `SIGNING_MOCK_ENABLED`
- `SIGNING_REQUIRE_LEGAL_PROVIDER_IN_PROD`
- `NCALAYER_ENABLED`
- `EGOV_MOBILE_QR_ENABLED`
- `EGOV_MOBILE_QR_BASE_URL`
- `EGOV_MOBILE_QR_CLIENT_ID`
- `EGOV_MOBILE_QR_CLIENT_SECRET`
- `EGOV_MOBILE_QR_CALLBACK_URL`
- `EGOV_MOBILE_QR_CALLBACK_SECRET`
- `EGOV_MOBILE_QR_TIMEOUT_SECONDS`
- `TABLET_SIGNATURE_ENABLED`
- `SIGNING_SESSION_TTL_SECONDS`
- `SIGNATURE_EVIDENCE_STORAGE_MODE`
- `SIGNATURE_EVIDENCE_BUCKET`
- `SIGNATURE_HASH_ALGORITHM`

Production safety rules:

- Production must fail fast when mock signing is enabled while `SIGNING_REQUIRE_LEGAL_PROVIDER_IN_PROD=true`.
- eGov Mobile QR must not enable without base URL, credentials, callback validation, and a public callback URL.
- `EGOV_MOBILE_QR_CALLBACK_URL` must match the deployed API origin.
- Never expose provider credentials as `NEXT_PUBLIC_*`.

## Implementation Phases

1. Phase 0: fix docs/env/deployment drift and document current versus target signing architecture.
2. Phase 1: add generic signing domain, Prisma models, shared contracts, provider registry, and document target resolver.
3. Phase 2: implement generic mock session create/status/cancel and wire one low-risk document type.
4. Phase 3: move NCALayer behind the provider interface and preserve old routes as compatibility wrappers.
5. Phase 4: add eGov Mobile QR adapter, callback endpoint, validation, and callback persistence using official provider documentation.
6. Phase 5: add signing worker queues for expiry, polling, callback reconciliation, and verification retry.
7. Phase 6: harden immutable evidence, audit, redaction, evidence package export, and history UI.
8. Phase 7: complete production readiness, deployment docs, smoke tests, and legal/provider contract confirmation.

## Acceptance Criteria

- Local mock signing can sign at least one migrated document through generic signing sessions.
- Production refuses mock provider when legal provider is required.
- NCALayer works through the session-first flow and verifies digest plus certificate metadata.
- eGov QR sessions fail safely when disabled or misconfigured.
- QR sessions expire through worker processing.
- Callback events are authenticated, persisted, redacted, and reconciled idempotently.
- Evidence includes document hash, signature format, certificate metadata, verification result, and correlation id.
- Signed documents cannot be silently edited; changes use replace, annul, or new version flow.
- UI shows required signers, completed signers, provider, verification status, failure/expiry reason, and evidence availability.
- Existing protocol, employee-document, responsibility-order, briefing, and public invite signing routes remain compatible during migration.

## Known Risks

- eGov Mobile QR official API and callback validation format are not present in this
  repository or available from the public Smart Bridge passport page without the
  required access. Production transport deliberately fails closed.
- Current certificate verification appears metadata/digest focused; legal-grade chain and revocation strategy needs provider/legal confirmation.
- Raw provider responses may contain personal data and must be redacted or stored in controlled evidence storage.
- Raw IIN storage needs explicit legal basis; prefer masked, hashed, or encrypted fields.
- Renaming provider enum values is migration-risky; preserve existing values until data migration is planned.
- API CORS is currently single-origin oriented through `CORS_ORIGIN`; preview and production origins need deliberate handling.

## Smart Bridge Contract Required From The Service Owner

Before production activation, obtain the official technical passport for service
`NITEC-S-5096`, key `EGOVMOBILE_QR_SIGN_SERVICE`, including:

- exact create-session endpoint and HTTP/SOAP method;
- request and response schemas, required headers, namespaces, and encodings;
- client authentication and request-signing algorithm;
- provider session, correlation, QR, deeplink, expiry, and status fields;
- callback endpoint contract, callback identifier, authentication/signature rules, and
  replay semantics;
- CMS/signature container format and signed-content/document-hash binding;
- certificate-chain, revocation, timestamp, and IIN extraction rules;
- provider status mapping, error codes, retry policy, and timeout requirements.

The local `dsj-egov-mock://` QR and callback schema are test fixtures only. They are not
the Smart Bridge production contract.

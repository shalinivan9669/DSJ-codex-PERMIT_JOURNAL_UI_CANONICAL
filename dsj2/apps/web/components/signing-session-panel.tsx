"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import type {
  LegalSigningProvider,
  SigningDocumentType,
  SigningSessionResponse,
} from "@dsj/types";
import { Button, Input, Select } from "@dsj/ui";
import { signWithNcalayerBridge } from "@/lib/ncalayer-bridge";

type SigningSessionPanelProps = {
  documentType: SigningDocumentType;
  documentId: string;
  documentHash: string;
  documentNumber?: string | null;
  signerName: string;
  defaultProvider: LegalSigningProvider;
  availableProviders: LegalSigningProvider[];
  bridgeUrl: string;
  bridgeTimeoutMs: number;
  testMode?: boolean;
};

const providerLabels: Record<LegalSigningProvider, string> = {
  MOCK_PROVIDER: "Mock",
  NCALAYER_PROVIDER: "NCALayer",
  EGOV_MOBILE_QR_PROVIDER: "eGov Mobile QR",
  TABLET_SIGNATURE_PROVIDER: "Подпись на планшете",
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export function SigningSessionPanel({
  documentType,
  documentId,
  documentHash,
  documentNumber,
  signerName,
  defaultProvider,
  availableProviders,
  bridgeUrl,
  bridgeTimeoutMs,
  testMode = false,
}: SigningSessionPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [provider, setProvider] = useState<LegalSigningProvider>(defaultProvider);
  const [session, setSession] = useState<SigningSessionResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mockSignerName, setMockSignerName] = useState(signerName);
  const [mockSignerIin, setMockSignerIin] = useState("");
  const [mockCertificateSerial, setMockCertificateSerial] = useState(
    `MOCKCERT-${documentId.slice(-6).toUpperCase()}`,
  );

  const terminalStatus = session
    ? ["COMPLETED", "EXPIRED", "FAILED", "CANCELLED"].includes(session.status)
    : false;
  const canSubmitMock = provider === "MOCK_PROVIDER" && session?.status === "WAITING_FOR_USER";
  const canSubmitNcalayer =
    provider === "NCALAYER_PROVIDER" && session?.status === "WAITING_FOR_USER";

  const providerOptions = useMemo(
    () => Array.from(new Set(availableProviders.length ? availableProviders : [defaultProvider])),
    [availableProviders, defaultProvider],
  );

  useEffect(() => {
    if (!session || terminalStatus) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const next = await readJson<SigningSessionResponse>(
          await fetch(`/api/signing/sessions/${session.id}`, { cache: "no-store" }),
        );
        setSession(next);

        if (next.status === "COMPLETED") {
          startTransition(() => router.refresh());
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "Failed to poll signing session.");
      }
    }, session.pollAfterMs);

    return () => window.clearTimeout(timeout);
  }, [router, session, startTransition, terminalStatus]);

  useEffect(() => {
    let cancelled = false;
    const value = session?.qrUrl ?? session?.deeplink ?? null;

    if (!value) {
      setQrDataUrl(null);
      return;
    }

    void QRCode.toDataURL(value, {
      margin: 1,
      width: 220,
    }).then((dataUrl) => {
      if (!cancelled) {
        setQrDataUrl(dataUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [session?.deeplink, session?.qrUrl]);

  async function createSession() {
    setError(null);
    const response = await fetch("/api/signing/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${documentType}:${documentId}:${provider}`,
      },
      body: JSON.stringify({
        documentType,
        documentId,
        provider,
      }),
    });
    const created = await readJson<SigningSessionResponse>(response);
    setSession(created);
  }

  async function submitMock() {
    if (!session) {
      return;
    }

    setError(null);
    const response = await fetch(`/api/signing/sessions/${session.id}/mock/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signerName: mockSignerName,
        signerIin: mockSignerIin,
        certificateSerial: mockCertificateSerial,
      }),
    });
    const completed = await readJson<SigningSessionResponse>(response);
    setSession(completed);
    startTransition(() => router.refresh());
  }

  async function submitNcalayer() {
    if (!session) {
      return;
    }

    setError(null);
    const signature = await signWithNcalayerBridge(
      { bridgeUrl, timeoutMs: bridgeTimeoutMs },
      {
        digest: session.documentHash,
        testMode,
        context: {
          protocolId: documentType === "PROTOCOL" ? documentId : undefined,
          responsibilityOrderId:
            documentType === "RESPONSIBILITY_ORDER" ? documentId : undefined,
          employeeDocumentId: documentType === "EMPLOYEE_DOCUMENT" ? documentId : undefined,
          documentNumber,
        },
      },
    );
    const response = await fetch(`/api/signing/sessions/${session.id}/ncalayer/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(signature),
    });
    const completed = await readJson<SigningSessionResponse>(response);
    setSession(completed);
    startTransition(() => router.refresh());
  }

  function run(task: () => Promise<void>) {
    startTransition(() => {
      void task().catch((taskError) => {
        setError(taskError instanceof Error ? taskError.message : "Signing request failed.");
      });
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="signing-provider">
          Provider
        </label>
        <Select
          id="signing-provider"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as LegalSigningProvider);
            setSession(null);
            setQrDataUrl(null);
            setError(null);
          }}
          disabled={Boolean(session && !terminalStatus)}
        >
          {providerOptions.map((option) => (
            <option key={option} value={option}>
              {providerLabels[option]}
            </option>
          ))}
        </Select>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p>Hash: {documentHash}</p>
        {documentNumber ? <p className="mt-1">Document: {documentNumber}</p> : null}
        {session ? <p className="mt-1">Session: {session.id}</p> : null}
        {session ? <p className="mt-1">Status: {session.status}</p> : null}
      </div>

      {!session ? (
        <Button onClick={() => run(createSession)} disabled={isPending}>
          {isPending ? "Creating..." : "Create signing session"}
        </Button>
      ) : null}

      {provider === "MOCK_PROVIDER" && session ? (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700" htmlFor="mockSignerName">
              Signer name
            </label>
            <Input
              id="mockSignerName"
              value={mockSignerName}
              onChange={(event) => setMockSignerName(event.target.value)}
              disabled={!canSubmitMock || isPending}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700" htmlFor="mockSignerIin">
              Signer IIN
            </label>
            <Input
              id="mockSignerIin"
              value={mockSignerIin}
              onChange={(event) => setMockSignerIin(event.target.value.replace(/\D/g, ""))}
              placeholder="980317350011"
              maxLength={12}
              disabled={!canSubmitMock || isPending}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700" htmlFor="mockCertificateSerial">
              Certificate serial
            </label>
            <Input
              id="mockCertificateSerial"
              value={mockCertificateSerial}
              onChange={(event) => setMockCertificateSerial(event.target.value)}
              disabled={!canSubmitMock || isPending}
            />
          </div>
          <Button onClick={() => run(submitMock)} disabled={!canSubmitMock || isPending}>
            {isPending ? "Signing..." : "Submit mock signature"}
          </Button>
        </div>
      ) : null}

      {provider === "NCALAYER_PROVIDER" && session ? (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">
          <p>NCALayer bridge URL: {bridgeUrl || "not configured"}</p>
          <Button onClick={() => run(submitNcalayer)} disabled={!canSubmitNcalayer || isPending}>
            {isPending ? "Signing..." : "Sign through NCALayer"}
          </Button>
        </div>
      ) : null}

      {provider === "EGOV_MOBILE_QR_PROVIDER" && session ? (
        <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-600">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="eGov Mobile signing QR" className="h-[220px] w-[220px]" />
          ) : null}
          {session.deeplink ? (
            <a className="break-all text-slate-900 underline" href={session.deeplink}>
              {session.deeplink}
            </a>
          ) : null}
          <p>Waiting for eGov Mobile callback. Local callback simulation is accepted by the API.</p>
        </div>
      ) : null}

      {session?.status === "COMPLETED" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Signature completed and evidence was attached.
        </div>
      ) : null}

      {session && ["FAILED", "EXPIRED", "CANCELLED"].includes(session.status) ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {session.failureReason ?? `Session ${session.status.toLowerCase()}.`}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
    </div>
  );
}

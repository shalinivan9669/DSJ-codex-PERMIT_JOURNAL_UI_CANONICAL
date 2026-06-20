"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock3,
  PenLine,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import type {
  LegalSigningProvider,
  SigningSessionResponse,
  SigningSessionStatus,
} from "@dsj/types";
import { Button } from "@dsj/ui";

type BriefingEmployeeSigningPanelProps = {
  documentId: string;
  employeeName: string;
  employeeNumber?: string | null;
  employeeJobTitle?: string | null;
  isSigned: boolean;
};

type EmployeeSigningMethod = "EGOV" | "TABLET";

const TERMINAL_STATUSES = new Set<SigningSessionStatus>([
  "COMPLETED",
  "EXPIRED",
  "FAILED",
  "CANCELLED",
]);

export function getBriefingEgovStatusLabel(status: SigningSessionStatus) {
  switch (status) {
    case "CREATED":
    case "QR_GENERATED":
      return "Ожидаем сканирование";
    case "WAITING_FOR_USER":
      return "Ожидаем подтверждение в eGov Mobile";
    case "CALLBACK_RECEIVED":
    case "SIGNATURE_RECEIVED":
    case "VERIFYING":
      return "Проверяем подпись";
    case "COMPLETED":
      return "Сотрудник подписал";
    case "EXPIRED":
      return "Сессия истекла";
    case "FAILED":
    case "CANCELLED":
      return "Подписание отклонено";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message: unknown }).message)
        : "Не удалось выполнить запрос на подписание.";
    throw new Error(message);
  }

  return payload as T;
}

function TabletSignatureCanvas({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange: (value: { dataUrl: string | null; strokeCount: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const activeStrokeSegmentsRef = useRef(0);
  const strokeCountRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "#172554";
  }, []);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return null;
    }

    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) {
      return;
    }

    const nextPoint = point(event);
    if (!nextPoint) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    activeStrokeSegmentsRef.current = 0;
    lastPointRef.current = nextPoint;
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const nextPoint = point(event);
    const lastPoint = lastPointRef.current;

    if (!canvas || !context || !nextPoint || !lastPoint) {
      return;
    }

    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.stroke();
    activeStrokeSegmentsRef.current += 1;
    lastPointRef.current = nextPoint;
  }

  function stopDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (activeStrokeSegmentsRef.current < 1) {
      return;
    }

    strokeCountRef.current += 1;
    onChange({
      dataUrl: event.currentTarget.toDataURL("image/png"),
      strokeCount: strokeCountRef.current,
    });
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    strokeCountRef.current = 0;
    onChange({ dataUrl: null, strokeCount: 0 });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-inner">
        <canvas
          ref={canvasRef}
          width={900}
          height={300}
          className="h-56 w-full touch-none cursor-crosshair"
          aria-label="Поле для рукописной подписи сотрудника"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
        />
        <div className="border-t border-dashed border-slate-200 px-4 py-2 text-center text-xs text-slate-400">
          Подпишите пальцем или стилусом над линией
        </div>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={clear} disabled={disabled}>
        <Trash2 className="mr-2 h-4 w-4" aria-hidden />
        Очистить подпись
      </Button>
    </div>
  );
}

export function BriefingEmployeeSigningPanel({
  documentId,
  employeeName,
  employeeNumber,
  employeeJobTitle,
  isSigned,
}: BriefingEmployeeSigningPanelProps) {
  const router = useRouter();
  const [method, setMethod] = useState<EmployeeSigningMethod | null>(null);
  const [session, setSession] = useState<SigningSessionResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [tabletSignature, setTabletSignature] = useState<string | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const terminal = session ? TERMINAL_STATUSES.has(session.status) : false;

  useEffect(() => {
    if (!session || terminal) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const next = await readJson<SigningSessionResponse>(
          await fetch(`/api/signing/sessions/${session.id}`, { cache: "no-store" }),
        );
        setSession(next);
        setError(null);

        if (next.status === "COMPLETED") {
          router.refresh();
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Не удалось проверить статус подписи.",
        );
        setPollAttempt((value) => value + 1);
      }
    }, session.pollAfterMs);

    return () => window.clearTimeout(timeout);
  }, [pollAttempt, router, session, terminal]);

  useEffect(() => {
    const value = session?.qrUrl ?? session?.deeplink ?? null;

    if (!value || method !== "EGOV") {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;

    void import("qrcode")
      .then((QRCode) =>
        QRCode.toDataURL(value, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 272,
        }),
      )
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Не удалось отобразить QR-код провайдера.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [method, session?.deeplink, session?.qrUrl]);

  async function createSession(
    nextMethod: EmployeeSigningMethod,
    provider: LegalSigningProvider,
  ) {
    setIsBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/signing/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `briefing:${documentId}:employee:${provider}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          documentType: "BRIEFING_JOURNAL_ENTRY",
          documentId,
          provider,
        }),
      });
      const created = await readJson<SigningSessionResponse>(response);
      setMethod(nextMethod);
      setSession(created);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Не удалось создать сессию подписи.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function completeLocalEgov() {
    if (!session) {
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const completed = await readJson<SigningSessionResponse>(
        await fetch(`/api/signing/sessions/${session.id}/egov-local/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        }),
      );
      setSession(completed);
      router.refresh();
    } catch (completionError) {
      setError(
        completionError instanceof Error
          ? completionError.message
          : "Не удалось завершить локальную eGov-сессию.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function submitTabletSignature() {
    if (!session || !tabletSignature || strokeCount < 1 || !confirmed) {
      setError("Поставьте подпись и подтвердите согласие сотрудника.");
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const completed = await readJson<SigningSessionResponse>(
        await fetch(`/api/signing/sessions/${session.id}/tablet/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signatureDataUrl: tabletSignature,
            strokeCount,
            confirmed,
          }),
        }),
      );
      setSession(completed);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Не удалось сохранить подпись на планшете.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  const employeeMeta = [
    employeeNumber || "без табельного номера",
    employeeJobTitle || "должность не указана",
  ].join(" / ");

  if (isSigned || session?.status === "COMPLETED") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Сотрудник подписал инструктаж</p>
            <p className="mt-1 text-emerald-700">{employeeName}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
      <div>
        <p className="font-semibold text-slate-950">{employeeName}</p>
        <p className="mt-1 text-xs text-slate-500">{employeeMeta}</p>
      </div>

      {!method ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <button
            type="button"
            onClick={() =>
              void createSession("EGOV", "EGOV_MOBILE_QR_PROVIDER")
            }
            disabled={isBusy}
            className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-left transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="flex items-center gap-2 font-semibold text-sky-900">
              <QrCode className="h-5 w-5" aria-hidden />
              eGov Mobile QR
            </span>
            <span className="mt-2 block text-sm leading-5 text-sky-800">
              Сотрудник подтверждает ЭЦП в приложении eGov Mobile.
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              void createSession("TABLET", "TABLET_SIGNATURE_PROVIDER")
            }
            disabled={isBusy}
            className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="flex items-center gap-2 font-semibold text-indigo-950">
              <PenLine className="h-5 w-5" aria-hidden />
              Подпись на планшете
            </span>
            <span className="mt-2 block text-sm leading-5 text-indigo-800">
              Сотрудник расписывается пальцем или стилусом на этом устройстве.
            </span>
          </button>
        </div>
      ) : null}

      {method === "EGOV" && session ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              eGov Mobile
            </span>
            <span className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <Clock3 className="h-4 w-4" aria-hidden />
              {getBriefingEgovStatusLabel(session.status)}
            </span>
          </div>

          {session.localSimulation ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">
              Локальный demo-контур. Это проверка пользовательского сценария, а не юридически значимая подпись Smart Bridge.
            </div>
          ) : null}

          {!terminal ? (
            <div className="flex justify-center">
              <div className="grid h-72 w-72 place-items-center rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                {qrDataUrl ? (
                  <Image
                    src={qrDataUrl}
                    alt={`QR eGov Mobile для подписи инструктажа сотрудником ${employeeName}`}
                    width={272}
                    height={272}
                    unoptimized
                  />
                ) : (
                  <span className="text-xs text-slate-400">Готовим QR-код...</span>
                )}
              </div>
            </div>
          ) : null}

          {session.deeplink && !session.localSimulation && !terminal ? (
            <a
              className="block rounded-xl border border-slate-200 px-3 py-2 text-center font-medium text-slate-800 md:hidden"
              href={session.deeplink}
            >
              Открыть в eGov Mobile
            </a>
          ) : null}

          {session.localSimulation && !terminal ? (
            <Button onClick={() => void completeLocalEgov()} disabled={isBusy}>
              <Smartphone className="mr-2 h-4 w-4" aria-hidden />
              {isBusy ? "Подтверждаем..." : "Подтвердить в demo eGov Mobile"}
            </Button>
          ) : null}

          {terminal ? (
            <Button
              onClick={() => {
                setMethod(null);
                setSession(null);
                setError(null);
              }}
              disabled={isBusy}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Выбрать способ заново
            </Button>
          ) : null}
        </div>
      ) : null}

      {method === "TABLET" && session ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm leading-5 text-indigo-950">
            Подпись на планшете является очным подтверждением ознакомления. Это не ЭЦП eGov и не подпись NCALayer.
          </div>
          <TabletSignatureCanvas
            disabled={isBusy || terminal}
            onChange={({ dataUrl, strokeCount: nextStrokeCount }) => {
              setTabletSignature(dataUrl);
              setStrokeCount(nextStrokeCount);
              setError(null);
            }}
          />
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
              disabled={isBusy || terminal}
            />
            <span>
              Сотрудник подтверждает, что ознакомился с зафиксированной версией инструктажа и лично поставил подпись.
            </span>
          </label>
          <Button
            onClick={() => void submitTabletSignature()}
            disabled={isBusy || terminal || !tabletSignature || !confirmed}
          >
            <PenLine className="mr-2 h-4 w-4" aria-hidden />
            {isBusy ? "Сохраняем..." : "Подписать на планшете"}
          </Button>
          {terminal ? (
            <Button
              variant="secondary"
              onClick={() => {
                setMethod(null);
                setSession(null);
                setTabletSignature(null);
                setStrokeCount(0);
                setConfirmed(false);
                setError(null);
              }}
              disabled={isBusy}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
              Выбрать способ заново
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

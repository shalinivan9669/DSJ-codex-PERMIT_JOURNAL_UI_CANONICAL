export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public correlationId?: string,
  ) {
    super(message);
  }
}
let csrf = "";
export const SESSION_EXPIRED_EVENT = "demo:session-expired";
export const BEFORE_LOGOUT_EVENT = "demo:before-logout";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  if (csrf) headers.set("x-csrf-token", csrf);
  headers.set("accept", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "Нет связи с сервером. Ваши изменения остаются на этой странице. Восстановите связь и повторите сохранение.",
    );
  }
  const raw = await response.text();
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : undefined;
  } catch {
    value = undefined;
  }
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const body = value as
      | { message?: string | string[]; error?: string; correlationId?: string }
      | undefined;
    const message = body?.message;
    throw new ApiError(
      response.status,
      Array.isArray(message)
        ? message.join("; ")
        : message ||
            (response.status === 413
              ? "Превышен допустимый размер загрузки."
              : "Сервер не выполнил запрос. Повторите попытку."),
      value,
      body?.correlationId ||
        response.headers.get("x-correlation-id") ||
        undefined,
    );
  }
  return value as T;
}
export function errorText(error: unknown) {
  return error instanceof ApiError && error.correlationId
    ? `${error.message} Код обращения: ${error.correlationId}`
    : error instanceof Error
      ? error.message
      : "Не удалось выполнить действие.";
}
export const json = (body: unknown) => JSON.stringify(body);
export async function downloadArtifact(id: string, fileName: string) {
  let response: Response;
  try {
    response = await fetch(`/api/artifacts/${id}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Повторите скачивание.");
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const raw = await response.text();
    let message = "Не удалось получить сохранённый файл.";
    try {
      message = (JSON.parse(raw) as { message?: string }).message || message;
    } catch {
      /* Use the operator-facing fallback. */
    }
    throw new ApiError(response.status, message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadExport(
  path: string,
  payload: unknown,
  fallbackName: string,
) {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: json(payload),
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Повторите скачивание.");
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    const raw = await response.text();
    let message = "Не удалось получить файл.";
    try {
      message = (JSON.parse(raw) as { message?: string }).message || message;
    } catch {
      /* A non-JSON upstream failure has no safe operator details. */
    }
    throw new ApiError(response.status, message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fallbackName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

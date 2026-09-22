import "server-only";

import { cookies } from "next/headers";

function resolveBaseUrl(
  value: string | undefined,
  fallback: string,
  variableName: string,
) {
  const trimmed = value?.trim();

  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${variableName} обязателен в production.`);
  }

  return fallback;
}

const apiBaseUrl = `${resolveBaseUrl(
  process.env.API_URL,
  "http://localhost:4000",
  "API_URL",
)}/v1`;
const cookieName = (process.env.COOKIE_NAME ?? "dsj_session").trim();

export class ApiHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function normalizeErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const data = payload as {
      message?: string | string[];
      error?: string;
    };

    if (Array.isArray(data.message)) {
      return data.message.join(", ");
    }

    if (typeof data.message === "string") {
      return data.message;
    }

    if (typeof data.error === "string") {
      return data.error;
    }
  }

  return fallback;
}

export function getApiUrl(path: string) {
  return `${apiBaseUrl}/${path}`;
}

export async function getSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(cookieName)?.value ?? null;
}

export async function setSessionToken(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSessionToken() {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName);
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  options?: {
    auth?: boolean;
    token?: string | null;
  },
) {
  const headers = new Headers(init?.headers);
  const authToken =
    options?.token !== undefined
      ? options.token
      : options?.auth === false
        ? null
        : await getSessionToken();

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const response = await fetch(getApiUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Запрос завершился со статусом ${response.status}`;

    const text = await response.text();
    try { message = normalizeErrorMessage(JSON.parse(text), message); }
    catch { if (text) message = text; }
    throw new ApiHttpError(response.status, message);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}


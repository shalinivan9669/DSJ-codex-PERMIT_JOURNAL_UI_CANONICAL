import { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@dsj/types";
import { ApiHttpError, apiFetch, setSessionToken } from "@/lib/api";
import { getDefaultAuthenticatedPath } from "@/lib/auth";
import type { SessionUser } from "@dsj/types";

export async function POST(request: NextRequest) {
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 }); }
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "Проверьте email и пароль." }, { status: 400 });
  try {
    const result = await apiFetch<{ accessToken: string; user: SessionUser }>("auth/login", {
      method: "POST", body: JSON.stringify(parsed.data),
    }, { auth: false });
    await setSessionToken(result.accessToken);
    return NextResponse.json({ destination: getDefaultAuthenticatedPath(result.user) });
  } catch (error) {
    const status = error instanceof ApiHttpError ? error.status : 503;
    return NextResponse.json({ error: status === 401 ? "Неверный email или пароль." : "Сервис входа временно недоступен. Повторите попытку." }, { status });
  }
}

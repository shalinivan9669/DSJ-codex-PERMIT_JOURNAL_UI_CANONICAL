import { type NextRequest } from "next/server";
import { allowedRoute } from "@demo/contracts/src/policy";
import { LIMITS } from "@demo/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A narrow DEMO transport. Its destination is deployment configuration, never client input. */
async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.slice(4);
  if (
    !allowedRoute(
      "api",
      request.method,
      path,
      Object.fromEntries(request.headers.entries()),
    )
  )
    return new Response("Не найдено", { status: 404 });
  const origin = process.env.DEMO_ORIGIN || "http://localhost:3100";
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== origin
  )
    return Response.json(
      { message: "Источник запроса не разрешён." },
      { status: 403 },
    );
  const headers = new Headers();
  for (const name of [
    "cookie",
    "content-type",
    "x-csrf-token",
    "origin",
    "idempotency-key",
    "accept",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let body: Uint8Array | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    const limit = headers.get("content-type")?.startsWith("multipart/form-data")
      ? Math.max(LIMITS.photoBytes, LIMITS.importBytes) + 64 * 1024
      : LIMITS.jsonBytes;
    if (Number(request.headers.get("content-length") || 0) > limit)
      return Response.json(
        { message: "Превышен допустимый размер загрузки." },
        { status: 413 },
      );
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return Response.json(
            { message: "Превышен допустимый размер загрузки." },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  try {
    const base = new URL(
      process.env.DEMO_API_ORIGIN ||
        process.env.DEMO_API_URL ||
        "http://127.0.0.1:4100",
    );
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.pathname !== "/"
    )
      throw new Error("INVALID_API_ORIGIN");
    const response = await fetch(new URL(path + request.nextUrl.search, base), {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
    });
    const output = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of [
      "content-type",
      "content-disposition",
      "content-length",
      "etag",
      "x-correlation-id",
      "retry-after",
    ]) {
      const value = response.headers.get(name);
      if (value) output.set(name, value);
    }
    for (const value of response.headers.getSetCookie())
      output.append("set-cookie", value);
    return new Response(response.body, {
      status: response.status,
      headers: output,
    });
  } catch {
    return Response.json(
      {
        message:
          "Сервис DEMO временно недоступен. Ваши данные остаются на странице.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PATCH,
  proxy as DELETE,
  proxy as PUT,
  proxy as HEAD,
  proxy as OPTIONS,
};

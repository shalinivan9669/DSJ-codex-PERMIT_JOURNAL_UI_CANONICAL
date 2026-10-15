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
    "range",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const lmsUploadLimit =
    request.method === "POST" &&
    headers.get("content-type")?.startsWith("multipart/form-data")
      ? /^\/lms\/courses\/[^/]+\/materials$/.test(path)
        ? 512 * 1024 * 1024 + 64 * 1024
        : /^\/lms\/enrollments\/[^/]+\/external-evidence$/.test(path)
          ? 20 * 1024 * 1024 + 64 * 1024
          : null
      : null;
  let body: Uint8Array | ReadableStream<Uint8Array> | undefined;
  let uploadLimitExceeded = false;
  if (!["GET", "HEAD"].includes(request.method)) {
    const limit =
      lmsUploadLimit ||
      (headers.get("content-type")?.startsWith("multipart/form-data")
        ? Math.max(LIMITS.photoBytes, LIMITS.importBytes) + 64 * 1024
        : LIMITS.jsonBytes);
    if (Number(request.headers.get("content-length") || 0) > limit)
      return Response.json(
        { message: "Превышен допустимый размер загрузки." },
        { status: 413 },
      );
    if (lmsUploadLimit && request.body) {
      let size = 0;
      // Stream private materials to the disk-backed API upload handler while
      // bounding untrusted/chunked requests too. Never retain a video in RAM.
      body = request.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > limit) {
              uploadLimitExceeded = true;
              controller.error(new Error("UPLOAD_LIMIT"));
            } else controller.enqueue(chunk);
          },
        }),
      );
    } else {
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
    const requestOptions: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      ...(lmsUploadLimit ? { duplex: "half" as const } : {}),
      cache: "no-store",
      redirect: "manual",
      // Layout checks cover every selected document in bounded renderer batches.
      // Keep the local transport aligned with the external rewrite timeout.
      signal: AbortSignal.timeout(
        lmsUploadLimit
          ? 600000
          : request.method === "POST" &&
              /^\/print-requests\/[^/]+\/(?:validate|finalize)$/.test(path)
            ? 210000
            : 60000,
      ),
    };
    const response = await fetch(
      new URL(path + request.nextUrl.search, base),
      requestOptions,
    );
    const output = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of [
      "content-type",
      "content-disposition",
      "content-length",
      "accept-ranges",
      "content-range",
      "cache-control",
      "content-security-policy",
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
    if (uploadLimitExceeded)
      return Response.json(
        { message: "Превышен допустимый размер загрузки." },
        { status: 413 },
      );
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

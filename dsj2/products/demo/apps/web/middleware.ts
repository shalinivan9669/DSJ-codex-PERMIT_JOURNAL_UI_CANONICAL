import { NextResponse, type NextRequest } from "next/server";
import { allowedRoute } from "@demo/contracts/src/policy";
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const headers = Object.fromEntries(request.headers.entries());
  const staticPath = path
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%5b/gi, "[")
    .replace(/%5d/gi, "]");
  const safeStatic =
    ["GET", "HEAD"].includes(request.method) &&
    /^\/_next\/static\/[A-Za-z0-9_./()[\]@-]+\.(?:js|css|woff2?|ttf|otf)$/.test(
      staticPath,
    ) &&
    !staticPath
      .split("/")
      .some((segment) => segment === "." || segment === "..") &&
    !request.headers.has("next-action");
  const allowed = path.startsWith("/api/")
    ? allowedRoute("api", request.method, path.slice(4), headers)
    : allowedRoute("web", request.method, path, headers);
  if (!safeStatic && !allowed)
    return new NextResponse("Не найдено", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  return NextResponse.next();
}
export const config = { matcher: "/:path*" };

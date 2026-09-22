import { NextRequest, NextResponse } from "next/server";
import { allowsLegacyRequest } from "../../product-policy/legacy";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!allowsLegacyRequest("web", request.method, path, request.headers.has("next-action"))) {
    return new NextResponse("Not Found", { status: 404 });
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : request.nextUrl.origin;
    if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };

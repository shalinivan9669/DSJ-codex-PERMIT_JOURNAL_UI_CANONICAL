import type { Request, Response, NextFunction } from "express";
import { allowsLegacyPreflight, allowsLegacyRequest } from "../../../../product-policy/legacy";

export function legacyProductBoundary(allowedOrigins: string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const allowed = request.method === "OPTIONS"
      ? allowsLegacyPreflight(request.originalUrl, String(request.headers["access-control-request-method"] ?? ""),
          request.headers.origin, allowedOrigins)
      : allowsLegacyRequest("api", request.method, request.originalUrl, request.headers["next-action"] !== undefined);
    if (!allowed) { response.status(404).json({ statusCode: 404, message: "Not Found" }); return; }
    next();
  };
}

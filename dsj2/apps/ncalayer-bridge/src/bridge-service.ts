import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  ncalayerBridgeHealthSchema,
  ncalayerBridgeSignRequestSchema,
  ncalayerBridgeSignatureSchema,
} from "@dsj/types";
import { parseCmsCertificate, type ParsedCmsCertificate } from "@dsj/utils";
import type { BridgeRuntime } from "./ncalayer-runtime";

type CertificateParser = (cms: string) => ParsedCmsCertificate;

export type BridgeServerOptions = {
  runtime: BridgeRuntime;
  allowedOrigins?: string[];
  parseCertificate?: CertificateParser;
  logger?: Pick<Console, "error" | "info">;
};

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]) {
  try {
    const parsedOrigin = new URL(origin);
    return isLoopbackHostname(parsedOrigin.hostname) || allowedOrigins.includes(origin);
  } catch {
    return false;
  }
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: string[],
) {
  const origin = request.headers.origin;

  if (!origin) {
    return true;
  }

  if (!isAllowedOrigin(origin, allowedOrigins)) {
    writeJson(response, 403, { message: "Origin is not allowed to use the NCALayer bridge." });
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Vary", "Origin");

  return true;
}

function buildBridgeUrl(request: IncomingMessage) {
  const host = request.headers.host;
  return host ? `http://${host}` : null;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

const MAX_REQUEST_BYTES = 1024 * 1024;
class RequestTooLarge extends Error {}

function readJsonBody(request: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    const contentLength = request.headers["content-length"];
    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_REQUEST_BYTES) {
      reject(new RequestTooLarge("Request body exceeds 1 MiB."));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;

    request.on("data", (chunk) => {
      if (exceeded) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_REQUEST_BYTES) {
        exceeded = true;
        chunks.length = 0;
        reject(new RequestTooLarge("Request body exceeds 1 MiB."));
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (exceeded) return;
      const rawBody = Buffer.concat(chunks).toString("utf8").trim();

      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

export function createBridgeServer(options: BridgeServerOptions): Server {
  const allowedOrigins = options.allowedOrigins ?? [];
  const parseCertificate = options.parseCertificate ?? parseCmsCertificate;
  const logger = options.logger ?? console;

  return createServer(async (request, response) => {
    try {
      if (!applyCors(request, response, allowedOrigins)) {
        return;
      }

      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const bridgeUrl = buildBridgeUrl(request);

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const version = await options.runtime.connect();
        writeJson(
          response,
          200,
          ncalayerBridgeHealthSchema.parse({
            ok: true,
            provider: "NCALAYER",
            version,
            bridgeUrl,
          }),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/sign") {
        const rawBody = await readJsonBody(request);
        const payload = ncalayerBridgeSignRequestSchema.parse(rawBody);
        const result = await options.runtime.signDigest({
          digest: payload.digest,
          testMode: payload.testMode,
        });
        const certificate = parseCertificate(result.cms);
        const signedAt = new Date().toISOString();

        writeJson(
          response,
          200,
          ncalayerBridgeSignatureSchema.parse({
            signingDigest: payload.digest,
            signedAt,
            ...certificate,
            cms: result.cms,
            bridgeVersion: result.version,
            bridgeUrl,
          }),
        );
        return;
      }

      writeJson(response, 404, { message: "Bridge endpoint not found." });
    } catch (error) {
      if (error instanceof RequestTooLarge) {
        // Allow the response to flush and the client to stop writing, but do not
        // keep a malicious unfinished upload open indefinitely.
        request.resume();
        const timeout = setTimeout(() => request.destroy(), 2000);
        timeout.unref();
        request.once("end", () => clearTimeout(timeout));
        request.once("close", () => clearTimeout(timeout));
        writeJson(response, 413, { message: error.message });
        return;
      }
      logger.error(error);

      if (error instanceof ZodError) {
        writeJson(response, 400, {
          message: error.issues.map((issue) => issue.message).join(", "),
        });
        return;
      }

      writeJson(response, 503, {
        message: error instanceof Error ? error.message : "The NCALayer bridge request failed.",
      });
    }
  });
}

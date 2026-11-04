import { getSessionToken } from "@/lib/api";
import { getSigningConfig } from "@/lib/signing-config";
import { readLimitedNcalayerBody } from "@/lib/ncalayer-body-limit";

const allowedPaths = new Set(["health", "sign"]);

function jsonResponse(status: number, payload: unknown) {
  return Response.json(payload, { status });
}

function buildBridgeUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path, normalizedBaseUrl).toString();
}

async function proxyNcalayerBridgeRequest(
  request: Request,
  path: string,
) {
  const token = await getSessionToken();

  if (!token) {
    return jsonResponse(401, {
      message: "Авторизуйтесь, чтобы использовать резервный прокси NCALayer.",
    });
  }

  if (!allowedPaths.has(path)) {
    return jsonResponse(404, { message: "NCALayer bridge endpoint not found." });
  }

  const signingConfig = getSigningConfig();

  if (!signingConfig.bridgeUrl) {
    return jsonResponse(503, { message: "NCALAYER_BRIDGE_URL не настроен." });
  }

  const headers = new Headers();
  const contentType = request.headers.get("content-type");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  const body =
    request.method !== "GET" && request.method !== "HEAD"
      ? await readLimitedNcalayerBody(request)
      : undefined;

  if (body === null) {
    return jsonResponse(413, { message: "Размер запроса превышает 1 МиБ." });
  }

  try {
    const response = await fetch(buildBridgeUrl(signingConfig.bridgeUrl, path), {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
    const responseBody = await response.arrayBuffer();
    const responseHeaders = new Headers(response.headers);

    if (!responseHeaders.has("Content-Type")) {
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    }

    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const details =
      error instanceof Error && error.message && error.message !== "fetch failed"
        ? `: ${error.message}`
        : ".";

    return jsonResponse(503, {
      message: `Не удалось подключиться к мосту NCALayer${details}`,
    });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyNcalayerBridgeRequest(request, path.join("/"));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyNcalayerBridgeRequest(request, path.join("/"));
}

import { refuseFrozenRuntime } from "../../../product-policy/legacy";
import fs from "node:fs";
import path from "node:path";
import { createBridgeServer } from "./bridge-service";
import { NcalayerRuntime } from "./ncalayer-runtime";

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parsePort(value: string | undefined, defaultValue: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseAllowedOrigins(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function shouldRejectUnauthorized(
  value: string | undefined,
  wsUrl: string,
) {
  if (value !== undefined) {
    return parseBoolean(value, true);
  }

  try {
    const parsedWsUrl = new URL(wsUrl);
    return !(parsedWsUrl.protocol === "wss:" && isLoopbackHostname(parsedWsUrl.hostname));
  } catch {
    return true;
  }
}

function loadWorkspaceEnv(projectRoot: string) {
  for (const envFileName of [".env.local", ".env"]) {
    const envPath = path.join(projectRoot, envFileName);

    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
}

const workspaceRoot = path.resolve(process.cwd(), "..", "..");

refuseFrozenRuntime("NCALayer bridge");
loadWorkspaceEnv(workspaceRoot);

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = parsePort(process.env.PORT, 13580);
const wsUrl = process.env.NCALAYER_WS_URL?.trim() || "wss://127.0.0.1:13579";
const rejectUnauthorized = shouldRejectUnauthorized(
  process.env.NCALAYER_TLS_REJECT_UNAUTHORIZED,
  wsUrl,
);
const allowedOrigins = parseAllowedOrigins(process.env.NCALAYER_BRIDGE_ALLOWED_ORIGINS);

if (!rejectUnauthorized && wsUrl.startsWith("wss://")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.info(`NCALayer bridge disabled TLS verification for local websocket URL ${wsUrl}.`);
}

const server = createBridgeServer({
  runtime: new NcalayerRuntime({
    wsUrl,
    allowKmdHttpApi: parseBoolean(process.env.NCALAYER_ALLOW_KMD_HTTP_API, true),
  }),
  allowedOrigins,
});

server.listen(port, host, () => {
  console.info(
    `NCALayer bridge listening on http://${host}:${port} with ${allowedOrigins.length} explicit allowed origin(s).`,
  );
});

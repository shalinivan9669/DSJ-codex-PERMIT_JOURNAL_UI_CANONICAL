const PLACEHOLDER_VALUES = new Set([
  "changeme",
  "change-me",
  "default",
  "password",
  "replace-me",
  "secret",
  "test",
]);

type EnvLike = Record<string, string | undefined>;

export function parseBoolean(value: string | undefined, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function trim(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

function isProduction(env: EnvLike) {
  return env.NODE_ENV === "production";
}

function assertStrongSecret(env: EnvLike, name: string, minLength: number) {
  const value = trim(env[name]);

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  const normalized = value.toLowerCase();
  if (
    normalized.startsWith("replace-with") ||
    normalized.startsWith("replace_") ||
    PLACEHOLDER_VALUES.has(normalized)
  ) {
    throw new Error(`${name} must not use a placeholder value.`);
  }

  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters.`);
  }
}

function assertHttpUrl(name: string, value: string, requireHttps: boolean) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http or https.`);
  }

  if (requireHttps && parsed.protocol !== "https:") {
    throw new Error(`${name} must use https in production.`);
  }
}

function assertCorsOrigin(env: EnvLike, appUrl: string | null) {
  const rawOrigin = trim(env.CORS_ORIGIN) ?? appUrl;

  if (!rawOrigin) {
    return;
  }

  const origins = rawOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);

  if (!origins.length) {
    throw new Error("CORS_ORIGIN must include at least one origin.");
  }

  for (const origin of origins) {
    if (origin === "*") {
      throw new Error("CORS_ORIGIN must not be '*'.");
    }

    assertHttpUrl("CORS_ORIGIN", origin, isProduction(env));
  }
}

export function validateSecurityConfig(env: EnvLike = process.env) {
  const production = isProduction(env);
  assertStrongSecret(env, "JWT_SECRET", production ? 32 : 16);
  assertStrongSecret(env, "FIELD_ENCRYPTION_KEY", production ? 32 : 16);
  assertStrongSecret(env, "FIELD_HASH_PEPPER", production ? 32 : 16);

  const appUrl = trim(env.APP_URL);

  if (production && !appUrl) {
    throw new Error("APP_URL is required in production.");
  }

  if (appUrl) {
    assertHttpUrl("APP_URL", appUrl, production);
  }

  assertCorsOrigin(env, appUrl);

  const egovEnabled = parseBoolean(env.EGOV_MOBILE_QR_ENABLED, false);
  const allowLocalSimulation =
    !production && parseBoolean(env.EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION, false);

  if (egovEnabled && !allowLocalSimulation) {
    assertStrongSecret(env, "EGOV_MOBILE_QR_CALLBACK_SECRET", production ? 32 : 16);
    assertStrongSecret(env, "EGOV_MOBILE_QR_CLIENT_SECRET", production ? 32 : 16);

    const baseUrl = trim(env.EGOV_MOBILE_QR_BASE_URL);
    const clientId = trim(env.EGOV_MOBILE_QR_CLIENT_ID);
    const callbackUrl = trim(env.EGOV_MOBILE_QR_CALLBACK_URL);

    if (!baseUrl) {
      throw new Error("EGOV_MOBILE_QR_BASE_URL is required.");
    }

    if (!clientId) {
      throw new Error("EGOV_MOBILE_QR_CLIENT_ID is required.");
    }

    if (!callbackUrl) {
      throw new Error("EGOV_MOBILE_QR_CALLBACK_URL is required.");
    }

    assertHttpUrl("EGOV_MOBILE_QR_BASE_URL", baseUrl, production);
    assertHttpUrl("EGOV_MOBILE_QR_CALLBACK_URL", callbackUrl, production);

    const callback = new URL(callbackUrl);
    if (
      production &&
      (callback.hostname === "localhost" ||
        callback.hostname === "127.0.0.1" ||
        callback.hostname === "::1")
    ) {
      throw new Error("EGOV_MOBILE_QR_CALLBACK_URL must be publicly reachable in production.");
    }
  }
}

type DeploymentEnvironment = Record<string, string | undefined>;

/** Build-time external transport; the browser still uses its own /api origin. */
export function externalApiRewrites(env: DeploymentEnvironment) {
  if (env.VERCEL !== "1" && env.DEMO_EXTERNAL_API_PROXY !== "1") return [];
  let target: URL;
  try {
    target = new URL(env.DEMO_API_ORIGIN || "");
  } catch {
    throw new Error("External DEMO API transport requires DEMO_API_ORIGIN");
  }
  if (
    (env.VERCEL === "1"
      ? target.protocol !== "https:"
      : !["http:", "https:"].includes(target.protocol)) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      "External DEMO API transport requires a plain HTTPS origin",
    );
  }
  return [{ source: "/api/:path*", destination: `${target.origin}/:path*` }];
}

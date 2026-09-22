import manifest from "./product-policy.json";
export const PRODUCT_POLICY = manifest;
export function allowedRoute(
  surface: "api" | "web",
  method: string,
  rawUrl: string,
  headers: Record<string, unknown> = {},
): boolean {
  if (headers["next-action"] !== undefined) return false;
  const path = rawUrl.split("?")[0];
  if (
    !path.startsWith("/") ||
    path.includes("%") ||
    path.includes("\\") ||
    path.includes("//") ||
    path.includes(";") ||
    path.split("/").some((s) => s === "." || s === "..")
  )
    return false;
  return manifest.demoRoutes.some(
    (route) =>
      route.surface === surface &&
      route.method === method &&
      new RegExp(
        "^" + route.path.replace(/:[a-zA-Z]+/g, "[A-Za-z0-9_-]+") + "$",
      ).test(path),
  );
}

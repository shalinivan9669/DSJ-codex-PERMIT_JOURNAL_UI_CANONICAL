/** Local task context only. Secrets and external destinations never become return links. */
export function safeLmsReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const target = new URL(value, "https://demo.invalid");
    if (target.origin !== "https://demo.invalid" ||
      !(target.pathname === "/catalogue" || target.pathname === "/learn" ||
        target.pathname.startsWith("/learn/") || target.pathname === "/lms" ||
        target.pathname.startsWith("/lms/")) ||
      /^\/learn\/(invite|recovery|register)(\/|$)/.test(target.pathname)) return null;
    const query = new URLSearchParams();
    for (const key of ["courseId", "courseVersionId", "versionId", "customerId", "groupId", "sourceOrderId", "sourceRequestId", "orderId", "requestId", "applicationId", "enrollmentId", "lessonId", "id", "reviewId", "type", "view", "new"]) {
      const entry = target.searchParams.get(key);
      if (entry && /^[a-zA-Z0-9_-]{1,100}$/.test(entry)) query.set(key, entry);
    }
    return target.pathname + (query.size ? `?${query}` : "");
  } catch {
    return null;
  }
}

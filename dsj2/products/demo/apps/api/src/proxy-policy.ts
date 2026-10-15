import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";
import type { DemoRequest } from "./core";

export function proxyKeyMatches(
  value: unknown,
  expected = process.env.DEMO_PROXY_KEY || "",
) {
  if (typeof value !== "string" || expected.length < 32) return false;
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
const normalize = (ip: string) => (ip.startsWith("::ffff:") ? ip.slice(7) : ip);
/** Express trust proxy remains disabled. Both the exact peer and shared secret are required. */
export function trustedClientIp(req: Pick<DemoRequest, "socket" | "headers">) {
  const peer = normalize(req.socket.remoteAddress || "");
  const peers = (process.env.DEMO_TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((s) => normalize(s.trim()))
    .filter((s) => isIP(s));
  const candidate = req.headers["x-demo-client-ip"];
  if (
    peers.includes(peer) &&
    proxyKeyMatches(req.headers["x-demo-proxy-key"]) &&
    typeof candidate === "string" &&
    isIP(candidate)
  )
    return normalize(candidate);
  return isIP(peer) ? peer : undefined;
}

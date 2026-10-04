import type { NextConfig } from "next";
import path from "node:path";
import { externalApiRewrites } from "./lib/deployment";
const config: NextConfig = {
  // Allow an acceptance server beside a running local preview without sharing build files.
  distDir: process.env.DEMO_NEXT_DIST_DIR || ".next",
  // Vercel supplies its repository tracing root through Next's own defaults.
  // Overriding it with the nested product root breaks the adapter's app path.
  ...(process.env.VERCEL === "1"
    ? {}
    : {
        output: "standalone",
        outputFileTracingRoot: path.resolve(__dirname, "../.."),
      }),
  poweredByHeader: false,
  transpilePackages: ["@demo/contracts", "@demo/ui"],
  experimental: {
    cpus: 2,
    // External API validation includes the bounded 180s document layout check.
    // Next's 30s proxy default would abort a valid operator request mid-check.
    proxyTimeout: 210_000,
  },
  images: { unoptimized: true },
  async rewrites() {
    return { beforeFiles: externalApiRewrites(process.env) };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Vercel's configured headers override the upstream API response.
        source: "/api/auth/employer-invite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};
export default config;

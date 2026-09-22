import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  // Allow an acceptance server beside a running local preview without sharing build files.
  distDir: process.env.DEMO_NEXT_DIST_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@demo/contracts", "@demo/ui"],
  experimental: { cpus: 2 },
  images: { unoptimized: true },
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
    ];
  },
};
export default config;

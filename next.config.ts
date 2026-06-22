import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs", "node-cron"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Content-Security-Policy is set per-request in middleware.ts (needs a fresh nonce
        // each time) — it doesn't cover api/auth|admin|strava/webhook|cron, which are
        // excluded from middleware's matcher and serve JSON only, never inline scripts.
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options",    value: "nosniff" },
          { key: "X-Frame-Options",           value: "SAMEORIGIN" },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

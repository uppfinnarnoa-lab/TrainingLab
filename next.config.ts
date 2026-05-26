import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs", "node-cron"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options",    value: "nosniff" },
          { key: "X-Frame-Options",           value: "SAMEORIGIN" },
          { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy",   value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.anthropic.com https://generativelanguage.googleapis.com; frame-ancestors 'none';" },
        ],
      },
    ];
  },
};

export default nextConfig;

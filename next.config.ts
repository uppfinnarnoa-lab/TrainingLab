import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// In dev mode, Next.js webpack bundles use eval() for source maps/HMR — unsafe-eval required.
// In production, Next.js builds strip eval(), so unsafe-eval is omitted for stricter security.
const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

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
          { key: "Content-Security-Policy",   value: `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.anthropic.com https://generativelanguage.googleapis.com; frame-src 'self' https://sso.garmin.com; frame-ancestors 'none';` },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// CSP notes:
// - 'self' covers the app's own origin. The app is served under /Reader via Caddy.
// - Inline styles: permitted (Next.js + inline style={} usage). Inline scripts
//   are NOT permitted (no 'unsafe-inline' for script-src) to avoid XSS vectors;
//   'unsafe-eval' is kept only because webpack dev chunks/next runtime require
//   it in a few spots. If anything breaks at runtime we'll switch to per-page
//   nonces.
// - Cover images come from /Reader/api/books/[id]/cover (same origin). We also
//   allow data: and blob: so CSS fallbacks and object-URL previews work.
// - Audio from /Reader/api/tts/... (same origin) + blob:.
// - Connections (fetch) limited to self.
// - LibGen download requests are server-side only, so no client connect-src
//   entries for external mirrors are needed.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {

  serverExternalPackages: ["shared-auth", "pg", "pdf-parse", "epub2", "mammoth", "adm-zip"],
  basePath: "/Reader",
  env: { NEXT_PUBLIC_BASE_PATH: "/Reader" },
  typescript: { ignoreBuildErrors: true },
  experimental: { serverActions: { bodySizeLimit: "250mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

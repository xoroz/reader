import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["shared-auth", "pg", "pdf-parse", "epub2", "mammoth", "adm-zip"],
  basePath: "/Reader",
  env: { NEXT_PUBLIC_BASE_PATH: "/Reader" },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: { serverActions: { bodySizeLimit: "60mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

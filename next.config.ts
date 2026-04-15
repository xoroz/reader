import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["shared-auth", "pg", "pdf-parse", "epub2", "mammoth", "adm-zip"],
  basePath: "/Reader",
  env: { NEXT_PUBLIC_BASE_PATH: "/Reader" },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  experimental: { serverActions: { bodySizeLimit: "60mb" } },
};

export default nextConfig;

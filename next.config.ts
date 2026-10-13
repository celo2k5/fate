import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async redirects() { return [{ source: "/board", destination: "/leaderboards", permanent: false }]; },
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;

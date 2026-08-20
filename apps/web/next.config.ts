import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  transpilePackages: ["@3dena/analysis"],
  poweredByHeader: false,
};

export default nextConfig;

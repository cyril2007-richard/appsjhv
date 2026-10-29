import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "10.237.207.220",
    "10.237.207.220:3000",
    "10.144.106.220",
    "10.144.106.220:3000",
    "192.168.100.21",
    "192.168.100.21:3000",
    "localhost:3000",
    "localhost",
    "*.local",
  ],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

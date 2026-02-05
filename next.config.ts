import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.furusato-tax.jp",
      },
      {
        protocol: "https",
        hostname: "furusato-tax.jp",
      },
    ],
  },
};

export default nextConfig;

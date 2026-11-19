import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.ZYRO_NEXT_DIST || ".next",
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/wallet/testnet/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/zcash-wallet/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/wallet", destination: "/testnet" },
        {
          source: "/api/zcash/testnet/:path*",
          destination: "/wallet/testnet/api/:path*",
        },
      ],
      afterFiles: [
        {
          source: "/api/:path*",
          destination: `${process.env.API_URL || "http://127.0.0.1:4000"}/api/:path*`,
        },
      ],
    };
  },
};
export default config;

import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@adventure-fun/schemas", "@adventure-fun/agent-sdk"],
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001"
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ]
  },
  experimental: {
    // Enable when needed: serverActions, ppr
  },
}

export default nextConfig
